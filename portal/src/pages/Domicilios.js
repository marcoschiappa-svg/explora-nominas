/**
 * =============================================================================
 * Domicilios.js — Direcciones de una organización (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Gestionar las direcciones que se le ofrecen a una organización cuando se le
 * carga un pedido.
 *
 * -----------------------------------------------------------------------------
 * DOS ENTIDADES, NO UNA
 * -----------------------------------------------------------------------------
 * El DOMICILIO existe por sí solo: "Yrigoyen 2933, Puerto General San Martín"
 * es una dirección y no le pertenece a nadie.
 *
 * El VÍNCULO (`organizacion_domicilios`) dice quién la usa. Es lo que responde
 * "qué direcciones le aparecen a este cliente al cargarle un pedido".
 *
 * No son lo mismo que el destino de un pedido: la planta de Explora es destino
 * de 18 pedidos de 8 clientes distintos y **no está en la lista de ninguno de
 * ellos**. Es de Explora. Esos pedidos apuntan al domicilio directamente.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SE ENTRA POR LA ORGANIZACIÓN
 * -----------------------------------------------------------------------------
 * De los 34 domicilios relevados, ninguno tiene dos organizaciones. El caso real
 * es "este cliente entrega acá", no "esta dirección la usan varios".
 *
 * Y es el flujo natural: cuando el comercial está cargando un pedido y la
 * dirección no está, lo que quiere hacer es agregarle una dirección a ese
 * cliente — no dar de alta un domicilio suelto y después acordarse de
 * vincularlo.
 *
 * -----------------------------------------------------------------------------
 * UN SOLO CAMINO PARA AGREGAR
 * -----------------------------------------------------------------------------
 * No hay "buscar existente" y "crear nueva" como opciones separadas: es donde la
 * gente elige mal y termina duplicando. Hay un formulario, y mientras se escribe
 * la calle van apareciendo las direcciones parecidas que ya existen.
 *
 * Si se elige una, se crea solo el vínculo. Si no, se crea la dirección y el
 * vínculo en la misma transacción.
 *
 * Y si lo que se escribió se parece mucho a una existente pero no fue la
 * elegida, se pregunta antes de crear. Ese es el momento —el único— en que se
 * pueden evitar los duplicados: los 50 registros para 34 lugares reales no
 * salieron de que alguien eligiera mal, sino de que escribieron y guardaron.
 * ========================================================================== */

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, getDocs, limit, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { crear, actualizar, enTransaccion, calcularDiferencias } from '../datos';
import { esComercial, motivoSinAcceso } from '../sesion';
import { claveDomicilio } from '../mapa-normalizacion';
import {
  buscarParecidos,
  buscarCasiIgual,
  buscarIdentico,
  textoDomicilio,
} from '../buscar-domicilios';

const FORM_VACIO = {
  calle: '', numero: '', ciudad: '', provincia: '', cp: '',
  maps_link: '', obs: '', alias: '', principal: false,
};

const PROVINCIAS = [
  'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes',
  'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza',
  'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis',
  'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán',
];

export default function Domicilios({ usuario, organizacion, onVolver }) {
  const [domicilios, setDomicilios] = useState([]);   // todos, para el buscador
  const [vinculos, setVinculos] = useState([]);       // los de esta organización
  const [cargando, setCargando] = useState(true);
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [elegido, setElegido] = useState(null);       // domicilio existente elegido
  const [advertencia, setAdvertencia] = useState(null);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  const puedeEditar = esComercial(usuario);
  const sinAcceso = motivoSinAcceso(usuario, ['admin', 'comercial']);

  /* ── Carga ──────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (sinAcceso) { setCargando(false); return; }

    // Todos los domicilios: los necesita el buscador para sugerir. Son decenas,
    // no miles, así que traerlos enteros es más simple y más rápido que
    // consultar en cada tecla.
    const unsubDom = onSnapshot(collection(db, 'domicilios'), (snap) => {
      setDomicilios(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCargando(false);
    }, (err) => { console.error('Domicilios:', err); setCargando(false); });

    const unsubVin = onSnapshot(
      query(collection(db, 'organizacion_domicilios'),
            where('organizacion_id', '==', organizacion.id)),
      (snap) => setVinculos(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Vínculos:', err)
    );

    return () => { unsubDom(); unsubVin(); };
  }, [sinAcceso, organizacion.id]);

  /** Los domicilios de esta organización, resolviendo cada vínculo. */
  const mios = useMemo(() => {
    const porId = new Map(domicilios.map(d => [d.id, d]));
    return vinculos
      .map(v => ({ vinculo: v, domicilio: porId.get(v.domicilio_id) }))
      .filter(x => x.domicilio)
      .sort((a, b) => {
        if (a.vinculo.principal !== b.vinculo.principal) return a.vinculo.principal ? -1 : 1;
        return textoDomicilio(a.domicilio).localeCompare(textoDomicilio(b.domicilio), 'es');
      });
  }, [domicilios, vinculos]);

  /** IDs ya vinculados, para no ofrecerlos de nuevo. */
  const yaVinculados = useMemo(
    () => new Set(vinculos.map(v => v.domicilio_id)),
    [vinculos]
  );

  /**
   * Sugerencias mientras se escribe.
   *
   * Se marcan las que esta organización ya tiene en vez de esconderlas: si
   * alguien está escribiendo una dirección que ya cargó, lo útil es decírselo,
   * no dejar que la escriba entera y recién ahí avisarle.
   */
  const sugerencias = useMemo(() => {
    if (elegido) return [];
    return buscarParecidos(domicilios, form).map(s => ({
      ...s,
      yaEsta: yaVinculados.has(s.domicilio.id),
    }));
  }, [domicilios, form, elegido, yaVinculados]);

  /* ── Acciones ───────────────────────────────────────────────────────────── */

  function abrirForm() {
    setForm(FORM_VACIO);
    setElegido(null);
    setAdvertencia(null);
    setErrores([]);
    setMostrandoForm(true);
  }

  /** Se eligió una dirección de las sugeridas: solo hay que vincularla. */
  function elegirSugerencia(sugerencia) {
    if (sugerencia.yaEsta) {
      setErrores([`${organizacion.razon_social} ya tiene esa dirección.`]);
      return;
    }
    setElegido(sugerencia.domicilio);
    setAdvertencia(null);
    setErrores([]);
  }

  function volverAEscribir() {
    setElegido(null);
    setAdvertencia(null);
  }

  function validar() {
    const problemas = [];
    if (!form.calle.trim())     problemas.push('La calle es obligatoria.');
    if (!form.ciudad.trim())    problemas.push('La ciudad es obligatoria.');
    if (!form.provincia.trim()) problemas.push('La provincia es obligatoria.');
    return problemas;
  }

  /**
   * Guarda. Tres caminos según el estado:
   *
   *   1. Se eligió una dirección existente → solo el vínculo.
   *   2. Lo escrito coincide EXACTO con una existente → se reutiliza, sin
   *      preguntar: no hay nada que decidir.
   *   3. Se escribió una dirección nueva → domicilio + vínculo, en una
   *      transacción. Si se parece mucho a otra, primero se pregunta.
   */
  async function guardar(forzarCreacion = false) {
    setErrores([]);

    // Camino 1
    if (elegido) {
      await vincular(elegido.id, elegido);
      return;
    }

    const problemas = validar();
    if (problemas.length > 0) { setErrores(problemas); return; }

    const nuevo = {
      calle: form.calle.trim(),
      numero: form.numero.trim() || null,
      ciudad: form.ciudad.trim(),
      provincia: form.provincia.trim(),
      cp: form.cp.trim() || null,
    };

    // Camino 2
    const identico = buscarIdentico(domicilios, nuevo);
    if (identico) {
      if (yaVinculados.has(identico.id)) {
        setErrores([`${organizacion.razon_social} ya tiene esa dirección.`]);
        return;
      }
      await vincular(identico.id, identico);
      return;
    }

    // Camino 3, con la pregunta
    if (!forzarCreacion) {
      const casiIgual = buscarCasiIgual(domicilios, nuevo);
      if (casiIgual) { setAdvertencia(casiIgual); return; }
    }

    await crearYVincular(nuevo);
  }

  /** Vincula un domicilio que ya existe. */
  async function vincular(domicilioId, domicilio) {
    setGuardando(true);
    try {
      await crear({
        coleccion: 'organizacion_domicilios',
        datos: {
          organizacion_id: organizacion.id,
          domicilio_id: domicilioId,
          alias: form.alias.trim() || null,
          principal: form.principal,
          // El vínculo es una relación, no una entidad: su clave de
          // deduplicación es el par.
          clave_normalizada: `${organizacion.id}|${domicilioId}`,
        },
        accion: 'vincular_domicilio',
        entidadTipo: 'organizacion_domicilio',
        usuario,
      });
      cerrarForm();
    } catch (err) {
      console.error(err);
      setErrores([traducirError(err)]);
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Crea el domicilio y el vínculo en una transacción.
   *
   * Van juntos a propósito: un domicilio creado sin su vínculo no le aparece a
   * nadie al cargar un pedido, y quedaría suelto sin que nada lo indique. Si
   * falla el segundo, no se escribe el primero.
   */
  async function crearYVincular(nuevo) {
    setGuardando(true);
    try {
      const clave = claveDomicilio(nuevo);

      await enTransaccion(async (tx, anotar) => {
        const refDomicilio = doc(collection(db, 'domicilios'));
        const refVinculo   = doc(collection(db, 'organizacion_domicilios'));

        const datosDomicilio = {
          ...nuevo,
          maps_link: form.maps_link.trim() || null,
          // Lo que se carga desde acá SÍ nace verificado: alguien lo escribió
          // mirando la dirección real. Los que quedan sin verificar son los que
          // entraron por la carga inicial, que salen de parsear texto libre.
          verificado: true,
          estado: 'activo',
          obs: form.obs.trim(),
          clave_normalizada: clave,
          creado_por_uid: usuario.uid,
          creado_en: new Date(),
          actualizado_en: new Date(),
        };

        const datosVinculo = {
          organizacion_id: organizacion.id,
          domicilio_id: refDomicilio.id,
          alias: form.alias.trim() || null,
          principal: form.principal,
          clave_normalizada: `${organizacion.id}|${refDomicilio.id}`,
          creado_por_uid: usuario.uid,
          creado_en: new Date(),
          actualizado_en: new Date(),
        };

        tx.set(refDomicilio, datosDomicilio);
        tx.set(refVinculo, datosVinculo);

        anotar({
          entidadTipo: 'domicilio',
          entidadId: refDomicilio.id,
          accion: 'crear_domicilio',
          diferencias: calcularDiferencias({}, datosDomicilio),
          usuario,
        });

        anotar({
          entidadTipo: 'organizacion_domicilio',
          entidadId: refVinculo.id,
          accion: 'vincular_domicilio',
          diferencias: calcularDiferencias({}, datosVinculo),
          usuario,
        });
      }, 2);

      cerrarForm();
    } catch (err) {
      console.error(err);
      setErrores([traducirError(err)]);
    } finally {
      setGuardando(false);
    }
  }

  function cerrarForm() {
    setMostrandoForm(false);
    setForm(FORM_VACIO);
    setElegido(null);
    setAdvertencia(null);
  }

  /**
   * Desvincula un domicilio de esta organización.
   *
   * El vínculo SE BORRA, a diferencia del resto del modelo. No es una entidad:
   * es una relación, y nada la referencia. El domicilio queda intacto, y los
   * pedidos que lo usan como destino apuntan a él directamente, no al vínculo.
   */
  async function desvincular(x) {
    const dir = textoDomicilio(x.domicilio);
    if (!window.confirm(`¿Sacar "${dir}" de ${organizacion.razon_social}?\n\nLa dirección no se borra: deja de ofrecerse al cargar un pedido para esta organización.`)) return;

    setGuardando(true);
    try {
      const bloqueo = await buscarPedidosVivosCon(x.domicilio.id, organizacion.id);
      if (bloqueo) { window.alert(bloqueo); return; }

      await enTransaccion(async (tx, anotar) => {
        tx.delete(doc(db, 'organizacion_domicilios', x.vinculo.id));
        anotar({
          entidadTipo: 'organizacion_domicilio',
          entidadId: x.vinculo.id,
          accion: 'desvincular_domicilio',
          diferencias: calcularDiferencias(x.vinculo, {}),
          usuario,
        });
      }, 1);
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  /** Marca uno como principal y saca la marca de los demás. */
  async function marcarPrincipal(x) {
    setGuardando(true);
    try {
      for (const otro of mios) {
        const debeSer = otro.vinculo.id === x.vinculo.id;
        if (!!otro.vinculo.principal === debeSer) continue;
        await actualizar({
          coleccion: 'organizacion_domicilios',
          id: otro.vinculo.id,
          cambios: { principal: debeSer },
          accion: 'marcar_domicilio_principal',
          entidadTipo: 'organizacion_domicilio',
          usuario,
        });
      }
    } catch (err) {
      console.error(err);
      window.alert(traducirError(err));
    } finally {
      setGuardando(false);
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────────── */

  if (sinAcceso) {
    return (
      <div style={styles.wrap}>
        <Topbar onVolver={onVolver} />
        <div style={styles.bannerError}>{sinAcceso}</div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <Topbar onVolver={onVolver} />

      <div style={styles.panelHeader}>
        <div>
          <div style={styles.titulo}>Domicilios</div>
          <div style={styles.subtitulo}>{organizacion.razon_social}</div>
        </div>
        {puedeEditar && !mostrandoForm && (
          <button style={styles.btnPrimary} onClick={abrirForm}>+ Agregar</button>
        )}
      </div>

      {/* ── Formulario ─────────────────────────────────────────────────── */}

      {mostrandoForm && (
        <div style={styles.form}>
          {errores.length > 0 && (
            <div style={styles.bannerError}>
              {errores.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {/* Se eligió una existente */}
          {elegido && (
            <div style={styles.bannerOk}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>Se va a vincular esta dirección:</div>
              <div>{textoDomicilio(elegido)}</div>
              <button style={{ ...styles.btnLink, marginTop: 6 }} onClick={volverAEscribir}>
                No es esa, escribir otra
              </button>
            </div>
          )}

          {/* Se parece mucho a una existente */}
          {advertencia && (
            <div style={styles.bannerAviso}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>¿No será esta?</div>
              <div style={{ marginBottom: 8 }}>{textoDomicilio(advertencia)}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={styles.btnPrimary}
                  onClick={() => { setElegido(advertencia); setAdvertencia(null); }}
                >
                  Sí, usar esa
                </button>
                <button
                  style={styles.btnSecundario}
                  disabled={guardando}
                  onClick={() => { setAdvertencia(null); guardar(true); }}
                >
                  No, crear la que escribí
                </button>
              </div>
            </div>
          )}

          {!elegido && (
            <>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.label}>Calle *</label>
                  <input
                    style={styles.input}
                    value={form.calle}
                    onChange={e => { setForm({ ...form, calle: e.target.value }); setAdvertencia(null); }}
                    placeholder="Yrigoyen"
                    autoFocus
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Número</label>
                  <input
                    style={styles.input}
                    value={form.numero}
                    onChange={e => { setForm({ ...form, numero: e.target.value }); setAdvertencia(null); }}
                    placeholder="2933 · KM 55,5 · s/n"
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Ciudad *</label>
                  <input
                    style={styles.input}
                    value={form.ciudad}
                    onChange={e => { setForm({ ...form, ciudad: e.target.value }); setAdvertencia(null); }}
                    placeholder="Puerto General San Martín"
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Provincia *</label>
                  <select
                    style={styles.input}
                    value={form.provincia}
                    onChange={e => setForm({ ...form, provincia: e.target.value })}
                  >
                    <option value="">Elegir...</option>
                    {PROVINCIAS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Código postal</label>
                  <input
                    style={styles.input}
                    value={form.cp}
                    onChange={e => setForm({ ...form, cp: e.target.value })}
                    placeholder="S2200HWA"
                  />
                </div>
                <div style={styles.formField}>
                  <label style={styles.label}>Link de Maps</label>
                  <input
                    style={styles.input}
                    value={form.maps_link}
                    onChange={e => setForm({ ...form, maps_link: e.target.value })}
                  />
                </div>
              </div>

              {/* Sugerencias mientras se escribe */}
              {sugerencias.length > 0 && (
                <div style={styles.sugerencias}>
                  <div style={styles.sugerenciasTitulo}>
                    Direcciones parecidas que ya están cargadas
                  </div>
                  {sugerencias.map(s => (
                    <button
                      key={s.domicilio.id}
                      style={{ ...styles.sugerencia, opacity: s.yaEsta ? 0.5 : 1 }}
                      onClick={() => elegirSugerencia(s)}
                    >
                      <span>{textoDomicilio(s.domicilio)}</span>
                      {s.yaEsta && <span style={styles.sugerenciaNota}>ya la tiene</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          <div style={styles.grid2}>
            <div style={styles.formField}>
              <label style={styles.label}>Alias</label>
              <input
                style={styles.input}
                value={form.alias}
                onChange={e => setForm({ ...form, alias: e.target.value })}
                placeholder="Depósito norte"
              />
              <span style={styles.ayuda}>Cómo la llaman internamente. Opcional.</span>
            </div>
            <div style={styles.formField}>
              <label style={styles.check}>
                <input
                  type="checkbox"
                  checked={form.principal}
                  onChange={e => setForm({ ...form, principal: e.target.checked })}
                />
                <span>Es la dirección principal</span>
              </label>
            </div>
          </div>

          {!elegido && (
            <div style={styles.formField}>
              <label style={styles.label}>Observaciones</label>
              <input
                style={styles.input}
                value={form.obs}
                onChange={e => setForm({ ...form, obs: e.target.value })}
              />
            </div>
          )}

          <div style={{ ...styles.cardActions, marginTop: 12 }}>
            <button
              style={{ ...styles.btnPrimary, opacity: guardando ? 0.6 : 1 }}
              disabled={guardando || !!advertencia}
              onClick={() => guardar(false)}
            >
              {guardando ? 'Guardando...' : (elegido ? 'Vincular' : 'Agregar')}
            </button>
            <button style={styles.btnSecundario} onClick={cerrarForm}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── Lista ──────────────────────────────────────────────────────── */}

      {cargando && <div style={styles.empty}>Cargando...</div>}

      {!cargando && mios.length === 0 && !mostrandoForm && (
        <div style={styles.empty}>
          {organizacion.razon_social} no tiene direcciones cargadas.
          {puedeEditar && ' Agregá una para poder cargarle pedidos.'}
        </div>
      )}

      {mios.map(x => (
        <div key={x.vinculo.id} style={styles.card}>
          <div style={styles.cardRow}>
            <span style={styles.rowDireccion}>
              {textoDomicilio(x.domicilio)}
              {x.vinculo.alias && <span style={styles.rowAlias}> · {x.vinculo.alias}</span>}
            </span>

            {x.vinculo.principal && (
              <span style={{ ...styles.pill, ...PILLS.principal }}>Principal</span>
            )}
            {x.domicilio.verificado === false && (
              <span style={{ ...styles.pill, ...PILLS.sinVerificar }}>Sin verificar</span>
            )}

            {puedeEditar && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {!x.vinculo.principal && (
                  <button
                    style={styles.btnSecundario}
                    disabled={guardando}
                    onClick={() => marcarPrincipal(x)}
                  >
                    Hacer principal
                  </button>
                )}
                <button
                  style={styles.btnSuspender}
                  disabled={guardando}
                  onClick={() => desvincular(x)}
                >
                  Sacar
                </button>
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Auxiliares
 * -------------------------------------------------------------------------- */

function Topbar({ onVolver }) {
  return (
    <div style={styles.topbar}>
      <div style={styles.logoArea}>
        <img src="/logo.png" alt="Explora" style={styles.logoImg} />
      </div>
      <button style={styles.btnVolver} onClick={onVolver}>← Volver</button>
    </div>
  );
}

/**
 * ¿Hay pedidos vivos de esta organización usando este domicilio?
 *
 * Solo mira `destino_domicilio_id`: el origen de un pedido de venta es la planta
 * de Explora, que es de Explora y no se desvincula desde acá.
 */
async function buscarPedidosVivosCon(domicilioId, organizacionId) {
  const q = query(
    collection(db, 'pedidos'),
    where('cliente_org_id', '==', organizacionId),
    where('destino_domicilio_id', '==', domicilioId),
    where('estado', 'in', ['pendiente', 'programado_parcial', 'programado']),
    limit(1)
  );
  const snap = await getDocs(q);
  return snap.empty
    ? null
    : 'Hay pedidos sin cumplir que entregan en esa dirección. Cerralos o suspendelos antes de sacarla.';
}

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Puede ser que tu usuario no tenga '
         + 'permiso, o que falte su documento en el modelo nuevo. '
         + 'Revisá la consola del navegador para el detalle.';
  }
  if (err && err.code === 'failed-precondition') {
    return 'Falta un índice en Firestore. En la consola del navegador hay un '
         + 'link para crearlo con un clic.';
  }
  return (err && err.message) || 'Error desconocido.';
}

/* -----------------------------------------------------------------------------
 * Estilos
 * -------------------------------------------------------------------------- */

const PILLS = {
  principal:    { background: '#E1F5EE', color: '#085041' },
  sinVerificar: { background: '#FEF3C7', color: '#92400E' },
};

const styles = {
  wrap: { maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem' },
  logoArea: { display: 'flex', alignItems: 'center' },
  logoImg: { height: 36, objectFit: 'contain' },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  panelHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' },
  titulo: { fontSize: 18, fontWeight: 500, color: '#111827' },
  subtitulo: { fontSize: 13, color: '#6B7280', marginTop: 2 },
  btnPrimary: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnSecundario: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 12, cursor: 'pointer' },
  btnSuspender: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #A32D2D', background: '#fff', color: '#A32D2D', fontSize: 12, cursor: 'pointer' },
  btnLink: { border: 'none', background: 'none', color: '#C8102E', fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline' },
  empty: { textAlign: 'center', padding: '2rem', color: '#9CA3AF', fontSize: 13, lineHeight: 1.6 },
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
  cardRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#F9FAFB', flexWrap: 'wrap' },
  cardActions: { display: 'flex', gap: 8 },
  pill: { fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, flexShrink: 0 },
  rowDireccion: { fontSize: 13, color: '#111827', flex: 2, minWidth: 200 },
  rowAlias: { fontSize: 12, color: '#9CA3AF' },
  form: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, padding: '1.25rem', marginBottom: 16 },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 4 },
  formField: { display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 },
  label: { fontSize: 11, color: '#9CA3AF' },
  input: { fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%', boxSizing: 'border-box' },
  ayuda: { fontSize: 11, color: '#9CA3AF' },
  check: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', cursor: 'pointer', marginTop: 22 },
  sugerencias: { background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '8px 10px', marginBottom: 12 },
  sugerenciasTitulo: { fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  sugerencia: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 6, border: 'none', background: '#fff', fontSize: 12, color: '#111827', cursor: 'pointer', marginBottom: 4 },
  sugerenciaNota: { fontSize: 11, color: '#9CA3AF', flexShrink: 0 },
  bannerOk: { padding: '10px 14px', borderRadius: 8, background: '#E1F5EE', border: '0.5px solid #5DCAA5', fontSize: 13, color: '#085041', marginBottom: 12 },
  bannerAviso: { padding: '10px 14px', borderRadius: 8, background: '#FEF3C7', border: '0.5px solid #F59E0B', fontSize: 13, color: '#92400E', marginBottom: 12 },
  bannerError: { padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '0.5px solid #FCA5A5', fontSize: 13, color: '#B91C1C', marginBottom: 12, whiteSpace: 'pre-line' },
};
