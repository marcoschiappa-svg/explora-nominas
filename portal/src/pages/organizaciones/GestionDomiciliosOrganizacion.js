/**
 * =============================================================================
 * organizaciones/GestionDomiciliosOrganizacion.js — v1.2.0 (rediseño Organizaciones)
 * =============================================================================
 *
 * SÍNTOMA
 *   El Paso 4 del rediseño pide un modal "Domicilios — <razón social>" con
 *   la misma gestión que ya tenía `Domicilios.js` (alta con sugerencias,
 *   vincular, desvincular, marcar principal), más una variante de solo
 *   lectura para el coordinador sin comercial (hoy esa pantalla lo bloquea
 *   entero -- ver el encabezado v1.2.0 (RF-07) de `Organizaciones.js`).
 *
 * CAUSA RAÍZ
 *   Esa gestión vivía ENTERA adentro de `Domicilios.js`, mezclada con su
 *   propio `Topbar` y el banner de `sinAcceso` -- no había forma de
 *   reusarla dentro de un modal sin duplicarla.
 *
 * ALCANCE
 *   Extracción 1:1 del cuerpo de `Domicilios.js` (todo menos el `Topbar` y
 *   el banner de `sinAcceso`, que se quedan ahí): MISMA lógica exacta --
 *   `buscarParecidos`/`buscarCasiIgual`/`buscarIdentico`, `vincular()`,
 *   `crearYVincular()` (transacción domicilio+vínculo), `desvincular()`,
 *   `marcarPrincipal()` -- ninguna función nueva. No se agrega edición ni
 *   desactivación de un domicilio: esas acciones no existen hoy y agregarlas
 *   sería lógica de negocio nueva, fuera del alcance de un rediseño visual
 *   (decisión tomada con el usuario al planificar esta tarea).
 *
 *   Se migra a B1 (`crearEstilos(colores,oscuro)` + `useEstilos()` de
 *   `organizaciones/estilos.js`, componentes de `ui/`) porque pasa a vivir
 *   dentro de un modal ya temático -- efecto esperado de la extracción, no
 *   un cambio de alcance. `Domicilios.js` (la pantalla por fuera) se queda
 *   con sus colores fijos de siempre para su propio `Topbar`.
 *
 *   Prop nueva `soloLectura`: oculta "+ Agregar" y las acciones de cada fila
 *   (marcar principal / sacar), deja ver la lista -- resuelve, para el
 *   coordinador sin comercial, la limitación conocida que dejó RF-07 (antes
 *   veía la pantalla entera bloqueada).
 *
 * LIMITACIONES CONOCIDAS
 *   Mismas que `Domicilios.js` ya tenía -- ninguna nueva. La organización
 *   que entra por prop ya viene resuelta (no hay `onVolver`, la cierra el
 *   modal que la envuelve).
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Dentro del modal de Domicilios:
 *   alta con sugerencias, vincular, desvincular y marcar principal
 *   funcionan igual que en `Domicilios.js`. Con `soloLectura`, se ve la
 *   lista sin ningún botón de acción.
 * ========================================================================== */

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, getDocs, limit, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { crear, actualizar, enTransaccion, calcularDiferencias } from '../../datos';
import { claveDomicilio } from '../../mapa-normalizacion';
import {
  buscarParecidos,
  buscarCasiIgual,
  buscarIdentico,
  textoDomicilio,
} from '../../buscar-domicilios';
import Boton from '../../ui/Boton';
import Pastilla from '../../ui/Pastilla';
import Vacio from '../../ui/Vacio';
import { colorEstado } from '../../ui/tokens';
import { useEstilos } from './estilos';

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

const PILLS = {
  principal:    { bg: colorEstado.exitoFondo, color: colorEstado.exitoTexto },
  sinVerificar: { bg: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTextoFuerte },
};

/**
 * @param {Object} props
 * @param {Object} props.usuario
 * @param {Object} props.organizacion
 * @param {boolean} [props.puedeEditar] si puede alta/vincular/desvincular/marcar principal
 * @param {boolean} [props.soloLectura] 1. alias de `!puedeEditar` para quien
 *   llama desde el modal -- ver el encabezado. Si se pasan los dos, manda
 *   `soloLectura`.
 */
export default function GestionDomiciliosOrganizacion({ usuario, organizacion, puedeEditar = true, soloLectura = false }) {
  const styles = useEstilos();
  const editable = puedeEditar && !soloLectura;

  const [domicilios, setDomicilios] = useState([]);   // todos, para el buscador
  const [vinculos, setVinculos] = useState([]);       // los de esta organización
  const [cargando, setCargando] = useState(true);
  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [elegido, setElegido] = useState(null);       // domicilio existente elegido
  const [advertencia, setAdvertencia] = useState(null);
  const [errores, setErrores] = useState([]);
  const [guardando, setGuardando] = useState(false);

  /* ── Carga ──────────────────────────────────────────────────────────────── */

  useEffect(() => {
    // Todos los domicilios: los necesita el buscador para sugerir. Son decenas,
    // no miles, así que traerlos enteros es más simple y más rápido que
    // consultar en cada tecla.
    const unsubDom = onSnapshot(collection(db, 'domicilios'), (snap) => {
      setDomicilios(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCargando(false);
    }, (err) => { console.error('GestionDomiciliosOrganizacion:', err); setCargando(false); });

    const unsubVin = onSnapshot(
      query(collection(db, 'organizacion_domicilios'),
            where('organizacion_id', '==', organizacion.id)),
      (snap) => setVinculos(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
      (err) => console.error('Vínculos:', err)
    );

    return () => { unsubDom(); unsubVin(); };
  }, [organizacion.id]);

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

  return (
    <div>
      {editable && !mostrandoForm && (
        <div style={{ ...styles.cardActions, marginBottom: 12 }}>
          <Boton onClick={abrirForm}>+ Agregar</Boton>
        </div>
      )}

      {/* ── Formulario ─────────────────────────────────────────────────── */}

      {mostrandoForm && editable && (
        <div style={{ marginBottom: 16 }}>
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
              <Boton variante="secundario" chico style={{ marginTop: 6 }} onClick={volverAEscribir}>
                No es esa, escribir otra
              </Boton>
            </div>
          )}

          {/* Se parece mucho a una existente */}
          {advertencia && (
            <div style={styles.bannerAviso}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>¿No será esta?</div>
              <div style={{ marginBottom: 8 }}>{textoDomicilio(advertencia)}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Boton onClick={() => { setElegido(advertencia); setAdvertencia(null); }}>
                  Sí, usar esa
                </Boton>
                <Boton
                  variante="secundario"
                  disabled={guardando}
                  onClick={() => { setAdvertencia(null); guardar(true); }}
                >
                  No, crear la que escribí
                </Boton>
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
            <Boton
              disabled={guardando || !!advertencia}
              onClick={() => guardar(false)}
            >
              {guardando ? 'Guardando...' : (elegido ? 'Vincular' : 'Agregar')}
            </Boton>
            <Boton variante="secundario" onClick={cerrarForm}>Volver a la lista</Boton>
          </div>
        </div>
      )}

      {/* ── Lista ──────────────────────────────────────────────────────── */}

      {!mostrandoForm && (
        <>
          {cargando && <Vacio titulo="Cargando..." />}

          {!cargando && mios.length === 0 && (
            <Vacio
              titulo={`${organizacion.razon_social} no tiene direcciones cargadas.`}
              nota={editable ? 'Agregá una para poder cargarle pedidos.' : undefined}
            />
          )}

          {mios.map(x => (
            <div key={x.vinculo.id} style={styles.domicilioCard}>
              <div style={styles.domicilioRow}>
                <span style={styles.domicilioDireccion}>
                  {textoDomicilio(x.domicilio)}
                  {x.vinculo.alias && <span style={styles.domicilioAlias}> · {x.vinculo.alias}</span>}
                </span>

                {x.vinculo.principal && (
                  <Pastilla chico colores={PILLS.principal}>Principal</Pastilla>
                )}
                {x.domicilio.verificado === false && (
                  <Pastilla chico colores={PILLS.sinVerificar}>Sin verificar</Pastilla>
                )}

                {editable && (
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    {!x.vinculo.principal && (
                      <Boton chico variante="secundario" disabled={guardando} onClick={() => marcarPrincipal(x)}>
                        Hacer principal
                      </Boton>
                    )}
                    <Boton chico variante="peligro" disabled={guardando} onClick={() => desvincular(x)}>
                      Sacar
                    </Boton>
                  </span>
                )}
              </div>
            </div>
          ))}
        </>
      )}
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
