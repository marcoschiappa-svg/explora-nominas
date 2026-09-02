/**
 * =============================================================================
 * MisDespachos.js — Pantalla del transportista (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Donde el transportista ve los despachos que le asignaron, los acepta o
 * rechaza, y nomina la unidad y el chofer.
 *
 * -----------------------------------------------------------------------------
 * VE LOS DE SU EMPRESA, NO LOS SUYOS
 * -----------------------------------------------------------------------------
 * Hoy el vínculo es con el USUARIO: `despacho.transporte_id` guarda el UID de
 * Auth de una persona. Si una empresa tuviera dos personas con acceso al
 * portal, cada una vería solo los despachos que le asignaron a ella.
 *
 * Acá el vínculo es con la ORGANIZACIÓN, así que las dos ven lo de la empresa.
 * Es lo que hace posible que el transportista delegue.
 *
 * Y la consulta TIENE que venir filtrada: las reglas rechazan la lectura de la
 * colección entera.
 *
 * -----------------------------------------------------------------------------
 * NO LEE PEDIDOS
 * -----------------------------------------------------------------------------
 * Las reglas dejan al transportista afuera de `pedidos`, y no habría forma de
 * darle acceso: "los pedidos donde tengo un despacho" es un join, y las reglas
 * de Firestore no consultan otra colección filtrando.
 *
 * Por eso el despacho lleva denormalizado todo lo que esta pantalla muestra:
 * cliente, producto, orden y destino.
 *
 * -----------------------------------------------------------------------------
 * LO QUE CAMBIA RESPECTO DE HOY
 * -----------------------------------------------------------------------------
 *   NOMINAR FUNCIONA. Hoy compara `chofer.empresa` contra `despacho.transporte`
 *   como strings: "Transporte RAD" contra "RAD". Como no coinciden, rechaza
 *   nominaciones válidas. Acá se comparan IDs.
 *
 *   EL CAMIÓN SE ELIGE. Hoy las patentes se escriben a mano en cada
 *   nominación, así que la misma unidad se tipea una y otra vez.
 *
 *   RECHAZAR SOLO ANTES DE ACEPTAR. Aceptar es un compromiso: a partir de ahí
 *   hay que poner un chofer, y si no se puede, se avisa al coordinador.
 *
 * -----------------------------------------------------------------------------
 * REDISENO -- PRIORIDAD DE INFORMACION Y TEMA REAL
 * -----------------------------------------------------------------------------
 *   Antes la fila de arriba de la tarjeta mezclaba estado, cliente, producto,
 *   volumen, fecha, horario Y el numero de despacho en una sola linea plana
 *   -- todo con el mismo peso visual, nada priorizado.
 *
 *   Ahora el cuerpo de la tarjeta sigue un orden explicito, de mas a menos
 *   importante para decidir si aceptar/rechazar/nominar:
 *     1. Cliente, producto, fecha de carga + horario (lo mas grande).
 *     2. Direccion de entrega.
 *     3. OV/OC y volumen (lo mas chico).
 *   El numero de despacho (D-000123) ya NO se muestra -- no hace falta para
 *   responder ni para nominar, y competia por espacio con lo que si hace
 *   falta. Sigue viajando en los payloads del Apps Script y en los alerts
 *   de confirmacion, que no es "pantalla" en el sentido de la tarjeta.
 *
 *   Las 4 pestañas (Para responder / Para nominar / En curso / Cerrados) ya
 *   existian -- no se tocaron los estados que agrupa cada una.
 *
 *   Se fue el Topbar propio (BarraSuperior.js ya cubre logo + volver), y
 *   `styles` paso a `crearEstilos(colores, oscuro)` + `useEstilos()`, mismo
 *   patron que Pedidos.js/Programacion.js. Los grises se reemplazaron por
 *   tonos de rojo (protagonista) y azul (acento) -- mismo criterio y mismos
 *   tonos que se definieron para Programacion.js.
 *
 *   LO QUE SIGUE PENDIENTE (fuera de este archivo): el aviso de que "una
 *   cancelacion que no lo involucra" le sigue apareciendo al transportista
 *   es un problema de quien ESCRIBE el aviso (logica-despachos.js), no de
 *   como esta pantalla los lee -- ya vienen filtrados por organizacion en la
 *   consulta. Y la nominacion de chofer/camion/acoplado por separado
 *   necesita antes partir la entidad "camion" en Camiones.js y cambiar la
 *   firma de nominar() en logica-transportista.js.
 * ========================================================================== */

import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { miOrganizacion, motivoSinAcceso } from '../sesion';
import {
  DESPACHO, ETIQUETA_DESPACHO, COLOR_DESPACHO, ETIQUETA_VIAJE,
  puedeAceptar, puedeRechazar, puedeNominar, despachoVivo,
} from '../estados';
import {
  aceptarDespacho, rechazarDespacho, nominar,
} from '../logica-transportista';
import { llamarAppsScript } from '../logica-despachos';
import { marca, marcaHover, colorEstado, espacio, radio, tipografia } from '../ui/tokens';
import { useTema } from '../ui/TemaContext';
import Boton from '../ui/Boton';
import Tarjeta from '../ui/Tarjeta';
import Pastilla from '../ui/Pastilla';
import Campo from '../ui/Campo';
import Vacio from '../ui/Vacio';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXOlu0PUTAVubDJCXh7WxjZp1ruCH5SMu9YmWbFCNF2ff7l5mn447nV8BIWbQ5-Mz-uQ/exec';

/** Las pestañas, y qué estados entran en cada una -- sin cambios de fondo. */
const SOLAPAS = [
  { id: 'pendientes', label: 'Para responder', estados: [DESPACHO.ASIGNADO] },
  { id: 'nominar',    label: 'Para nominar',   estados: [DESPACHO.ACEPTADO] },
  { id: 'en_curso',   label: 'En curso',       estados: [DESPACHO.NOMINADO] },
  { id: 'cerrados',   label: 'Cerrados',       estados: [DESPACHO.ENTREGADO, DESPACHO.RECHAZADO, DESPACHO.CANCELADO] },
];

/**
 * Reemplaza la escala de grises por tonos de rojo (protagonista, familia de
 * `marca`) y de azul (acento, para referencias y texto "de chrome") -- mismo
 * criterio y mismos valores que Programacion.js, medidos contra las
 * superficies claras/oscuras en esa conversacion.
 */
function paletaTexto(oscuro) {
  return {
    rojo: oscuro ? colorEstado.peligroBordeAlterno : marcaHover,
    azul: oscuro ? '#93C5FD' : colorEstado.acentoAzul,
  };
}

/* =============================================================================
 * Componente
 * ========================================================================== */

export default function MisDespachos({ usuario, onVolver }) {
  const styles = useEstilos();
  const [despachos, setDespachos] = useState([]);
  const [viajes, setViajes] = useState([]);
  const [choferes, setChoferes] = useState([]);
  const [camiones, setCamiones] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [cargando, setCargando] = useState(true);

  const [solapa, setSolapa] = useState('pendientes');
  const [nominando, setNominando] = useState(null);  // { despachoId, choferId, tractorId, acopladoId }
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState('');

  const miOrg = miOrganizacion(usuario);
  const sinAcceso = motivoSinAcceso(usuario, ['admin', 'transportista']);

  /* ── Carga ──────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (sinAcceso || !miOrg) { setCargando(false); return; }

    // Filtrada por organización, siempre. Sin el `where`, las reglas rechazan
    // la consulta entera.
    const unsubs = [
      onSnapshot(
        query(collection(db, 'despachos'), where('transportista_org_id', '==', miOrg)),
        (s) => {
          setDespachos(s.docs.map(d => ({ id: d.id, ...d.data() })));
          setCargando(false);
        },
        (e) => { console.error('Despachos:', e); setCargando(false); }
      ),
      onSnapshot(
        query(collection(db, 'viajes'), where('transportista_org_id', '==', miOrg)),
        (s) => setViajes(s.docs.map(d => ({ id: d.id, ...d.data() })))
      ),
      onSnapshot(
        query(collection(db, 'usuarios'), where('organizacion_id', '==', miOrg)),
        (s) => setChoferes(s.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(u => (u.roles || []).includes('chofer') && u.estado === 'activo'))
      ),
      onSnapshot(
        query(collection(db, 'camiones'), where('organizacion_id', '==', miOrg)),
        (s) => setCamiones(s.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(c => c.estado === 'activo'))
      ),
      // Solo los no leídos: los leídos ya cumplieron su función y no
      // necesitan seguir ocupando lugar en la pantalla. Dos igualdades —sin
      // `orderBy` ni rango— no piden índice compuesto.
      onSnapshot(
        query(collection(db, 'avisos'), where('destinatario_org_id', '==', miOrg), where('leido', '==', false)),
        (s) => setAvisos(s.docs.map(d => ({ id: d.id, ...d.data() })))
      ),
    ];

    return () => unsubs.forEach(u => u());
  }, [sinAcceso, miOrg]);

  /* ── Índices ────────────────────────────────────────────────────────────── */

  const viajePorDespacho = useMemo(
    () => new Map(viajes.map(v => [v.despacho_id, v])),
    [viajes]
  );

  // `camiones` ahora trae tractores Y acoplados mezclados (se distinguen por
  // `tipo`, ver Camiones.js) -- acá se separan para el formulario de
  // nominación, que los elige por separado.
  const tractores = useMemo(() => camiones.filter(c => c.tipo === 'tractor'), [camiones]);
  const acoplados = useMemo(() => camiones.filter(c => c.tipo === 'acoplado'), [camiones]);

  const conteos = useMemo(() => {
    const c = {};
    SOLAPAS.forEach(s => {
      c[s.id] = despachos.filter(d => s.estados.includes(d.estado)).length;
    });
    return c;
  }, [despachos]);

  const visibles = useMemo(() => {
    const def = SOLAPAS.find(s => s.id === solapa);
    return despachos
      .filter(d => def.estados.includes(d.estado))
      .sort((a, b) => (a.fecha_carga || '').localeCompare(b.fecha_carga || ''));
  }, [despachos, solapa]);

  /* ── Acciones ───────────────────────────────────────────────────────────── */

  // Ya no hace falta armar "contexto" con entregas y despachos del pedido:
  // `aceptarDespacho`, `rechazarDespacho` y `nominar` recalculan los
  // contadores del pedido mirando SOLO la transición del propio despacho —una
  // entrega tiene un único despacho vivo a la vez, así que con eso alcanza. Es
  // lo que permite que el transportista dispare el recálculo sin poder leer
  // `entregas` ni `pedidos`. Ver `estados.js` y `logica-transportista.js`.

  /**
   * Marca un aviso como leído. Es lo único que las reglas dejan tocarle a un
   * transportista sobre su propio aviso — no lo puede editar ni borrar.
   */
  async function marcarLeido(aviso) {
    try {
      await updateDoc(doc(db, 'avisos', aviso.id), { leido: true });
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    }
  }

  async function aceptar(d) {
    setOcupado(true);
    setError('');
    try {
      await aceptarDespacho({
        pedido: { id: d.pedido_id },
        despacho: d,
        miOrganizacionId: miOrg,
        usuario,
      });

      const rConf = await llamarAppsScript(APPS_SCRIPT_URL, 'confirmar_despacho', {
        despacho_id: d.numero,
        cliente: d.cliente_razon_social,
        producto: d.producto_nombre,
        volumen: d.volumen,
        ov: d.ov,
        fecha_carga: d.fecha_carga,
        transporte: d.transporte_nombre,
        aceptado_por: usuario.nombre || usuario.email,
      });
      if (!rConf.ok) {
        setError('El despacho se aceptó bien, pero no se pudo avisar al coordinador por mail.');
      }
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    } finally {
      setOcupado(false);
    }
  }

  async function rechazar(d) {
    const motivo = window.prompt(`¿Por qué rechazás el despacho?`);
    if (motivo === null) return;
    if (!motivo.trim()) { window.alert('El motivo es obligatorio.'); return; }

    setOcupado(true);
    setError('');
    try {
      await rechazarDespacho({
        pedido: { id: d.pedido_id },
        despacho: d,
        motivo: motivo.trim(),
        miOrganizacionId: miOrg,
        usuario,
      });

      const rRech = await llamarAppsScript(APPS_SCRIPT_URL, 'rechazar_despacho', {
        despacho_id: d.numero,
        cliente: d.cliente_razon_social,
        producto: d.producto_nombre,
        volumen: d.volumen,
        ov: d.ov,
        fecha_carga: d.fecha_carga,
        transporte: d.transporte_nombre,
        motivo: motivo.trim(),
        rechazado_por: usuario.nombre || usuario.email,
      });
      if (!rRech.ok) {
        setError('El despacho se rechazó bien, pero no se pudo avisar al coordinador por mail.');
      }
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarNominacion(d) {
    const f = nominando;
    if (!f.choferId) { setError('Elegí el chofer.'); return; }
    if (!f.tractorId) { setError('Elegí el tractor.'); return; }

    const chofer = choferes.find(c => c.id === f.choferId);
    const tractor = tractores.find(c => c.id === f.tractorId);
    const acoplado = f.acopladoId ? acoplados.find(c => c.id === f.acopladoId) : null;

    setOcupado(true);
    setError('');

    try {
      const { viajeId } = await nominar({
        pedido: { id: d.pedido_id },
        despacho: d,
        // La entrega no hace falta: el volumen que necesita el viaje ya está
        // en el propio despacho (`d.volumen`), denormalizado.
        entrega: null,
        chofer,
        tractor,
        acoplado,
        // El viaje lleva denormalizado lo que la pantalla del chofer muestra.
        // Sale del despacho, que ya lo tiene: el transportista no lee pedidos.
        pedidoDenormalizado: {
          cliente_razon_social: d.cliente_razon_social,
          producto_nombre: d.producto_nombre,
          origen_texto: '',
          destino_texto: d.destino_texto,
        },
        miOrganizacionId: miOrg,
        usuario,
      });

      const rNom = await llamarAppsScript(APPS_SCRIPT_URL, 'nominar_unidad', {
        despacho_id: d.numero,
        cliente: d.cliente_razon_social,
        producto: d.producto_nombre,
        volumen: d.volumen,
        ov: d.ov,
        fecha_carga: d.fecha_carga,
        transporte: d.transporte_nombre,
        chofer: chofer.nombre,
        dni_chofer: chofer.datos_chofer.dni,
        patente_tractor: tractor.patente,
        patente_semi: acoplado ? acoplado.patente : '',
        nominado_por: usuario.nombre || usuario.email,
      });
      if (!rNom.ok) {
        setError('La unidad se nominó bien, pero no se pudo avisar por mail.');
      }

      setNominando(null);
      // El numero de despacho no se muestra en la tarjeta, pero acá sigue
      // siendo util: es un alert transitorio de confirmacion, no "pantalla".
      window.alert(`✓ Despacho nominado. El viaje ya le aparece a ${chofer.nombre} en la app.`);
      return viajeId;
    } catch (err) {
      console.error(err);
      setError(traducirError(err));
    } finally {
      setOcupado(false);
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────────── */

  if (sinAcceso) {
    return <div style={styles.wrap}><div style={styles.bannerError}>{sinAcceso}</div></div>;
  }

  if (!miOrg) {
    return (
      <div style={styles.wrap}>
        <div style={styles.bannerError}>
          Tu usuario no tiene organización asignada. Pedile a un administrador
          que la cargue desde el módulo de usuarios.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.panelHeader}>
        <div style={styles.titulo}>Mis despachos</div>
      </div>

      {avisos.length > 0 && (
        <div style={styles.avisosWrap}>
          <div style={styles.avisosTitulo}>Avisos ({avisos.length})</div>
          {avisos.map((a, i) => (
            <div key={a.id} style={{ ...styles.avisoItem, borderTop: i === 0 ? 'none' : `0.5px solid ${colorEstado.advertenciaBorde}` }}>
              <span style={styles.avisoMensaje}>{a.mensaje}</span>
              <Boton chico variante="secundario" style={styles.btnMarcarLeido} onClick={() => marcarLeido(a)}>
                Marcar leído
              </Boton>
            </div>
          ))}
        </div>
      )}

      {error && <div style={styles.bannerError}>{error}</div>}

      <div style={styles.solapas}>
        {SOLAPAS.map(s => (
          <button
            key={s.id}
            style={{ ...styles.solapa, ...(solapa === s.id ? styles.solapaActiva : {}) }}
            onClick={() => { setSolapa(s.id); setNominando(null); setError(''); }}
          >
            {s.label}
            {conteos[s.id] > 0 && <span style={styles.solapaConteo}>{conteos[s.id]}</span>}
          </button>
        ))}
      </div>

      {cargando && <Vacio titulo="Cargando..." />}

      {!cargando && visibles.length === 0 && (
        <Vacio titulo={
          (solapa === 'pendientes' && 'No hay despachos esperando tu respuesta.')
          || (solapa === 'nominar' && 'No hay despachos para nominar.')
          || (solapa === 'en_curso' && 'No hay viajes en curso.')
          || (solapa === 'cerrados' && 'Todavía no hay despachos cerrados.')
        } />
      )}

      {visibles.map(d => {
        const col = COLOR_DESPACHO[d.estado] || COLOR_DESPACHO.CANCELADO;
        const viaje = viajePorDespacho.get(d.id);
        const nominandoEste = nominando && nominando.despachoId === d.id;

        return (
          <Tarjeta
            key={d.id}
            style={{ marginBottom: espacio.sm, padding: '14px 16px', opacity: despachoVivo(d) ? 1 : 0.6 }}
          >
            <Pastilla colores={col}>{ETIQUETA_DESPACHO[d.estado] || d.estado}</Pastilla>

            {/* Prioridad 1: cliente, producto, fecha de carga + horario --
                lo que hace falta para decidir si aceptar/rechazar/nominar. */}
            <div style={styles.prioridad1}>
              <div style={styles.cliente}>{d.cliente_razon_social}</div>
              <div style={styles.productoFecha}>
                <span>{d.producto_nombre}</span>
                <span style={styles.separador}>·</span>
                <span>Carga {d.fecha_carga}</span>
                {d.horario_carga && <span>{d.horario_carga}</span>}
              </div>
            </div>

            {/* Prioridad 2: direccion de entrega. */}
            {d.destino_texto && <div style={styles.prioridad2}>{d.destino_texto}</div>}

            {/* Prioridad 3: OV/OC y volumen -- lo menos urgente para
                responder, pero sigue siendo dato real, no se saca. */}
            <div style={styles.prioridad3}>
              {d.ov && <span>{d.ov}</span>}
              {d.ov && <span style={styles.separador}>·</span>}
              <span>{d.volumen} tn</span>
            </div>

            {d.chofer_dni && (
              <div style={styles.nominacion}>
                Chofer {d.chofer_dni} · {d.patente_tractor}
                {d.patente_semi && ` + ${d.patente_semi}`}
                {viaje && <> · {ETIQUETA_VIAJE[viaje.estado] || viaje.estado}</>}
                {viaje && viaje.demorado && <span style={styles.demora}> · demorado</span>}
              </div>
            )}

            {d.rechazo_motivo && (
              <div style={styles.motivo}>Lo rechazaste: {d.rechazo_motivo}</div>
            )}
            {d.cancelacion_motivo && (
              <div style={styles.motivo}>Cancelado por Explora: {d.cancelacion_motivo}</div>
            )}

            {/* Aceptar / rechazar */}
            {(puedeAceptar(d) || puedeRechazar(d)) && (
              <div style={styles.acciones}>
                <Boton disabled={ocupado} onClick={() => aceptar(d)}>
                  Aceptar
                </Boton>
                <Boton variante="peligro" disabled={ocupado} onClick={() => rechazar(d)}>
                  Rechazar
                </Boton>
                <span style={styles.ayuda}>
                  Aceptar es un compromiso: después hay que poner un chofer.
                </span>
              </div>
            )}

            {/* Nominar */}
            {puedeNominar(d) && !nominandoEste && (
              <div style={styles.acciones}>
                <Boton
                  onClick={() => {
                    setError('');
                    setNominando({ despachoId: d.id, choferId: '', tractorId: '', acopladoId: '' });
                  }}
                >
                  Nominar unidad
                </Boton>
              </div>
            )}

            {nominandoEste && (
              <div style={styles.formNominar}>
                {choferes.length === 0 && (
                  <div style={styles.bannerAviso}>
                    No tenés choferes cargados. Cargalos desde el módulo de
                    Usuarios antes de nominar.
                  </div>
                )}
                {tractores.length === 0 && (
                  <div style={styles.bannerAviso}>
                    No tenés tractores cargados. Cargalos desde el módulo de
                    Flota antes de nominar.
                  </div>
                )}

                <div style={styles.formGrid}>
                  <Campo
                    as="select" label="Chofer *"
                    value={nominando.choferId}
                    onChange={e => setNominando({ ...nominando, choferId: e.target.value })}
                  >
                    <option value="">Elegir...</option>
                    {choferes.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                        {c.datos_chofer && c.datos_chofer.dni ? ` — ${c.datos_chofer.dni}` : ''}
                      </option>
                    ))}
                  </Campo>

                  <Campo
                    as="select" label="Tractor *"
                    value={nominando.tractorId}
                    onChange={e => setNominando({ ...nominando, tractorId: e.target.value })}
                  >
                    <option value="">Elegir...</option>
                    {tractores.map(c => (
                      <option key={c.id} value={c.id}>{c.patente}</option>
                    ))}
                  </Campo>

                  <Campo
                    as="select" label="Acoplado"
                    value={nominando.acopladoId}
                    onChange={e => setNominando({ ...nominando, acopladoId: e.target.value })}
                    ayuda="Opcional, si el viaje lleva acoplado."
                  >
                    <option value="">Sin acoplado</option>
                    {acoplados.map(c => (
                      <option key={c.id} value={c.id}>{c.patente}</option>
                    ))}
                  </Campo>
                </div>

                <div style={styles.avisoIrreversible}>
                  La nominación no se puede cambiar después. Si hay que
                  corregirla, el coordinador tiene que cancelar el despacho.
                </div>

                <div style={styles.acciones}>
                  <Boton
                    disabled={ocupado || !nominando.choferId || !nominando.tractorId}
                    onClick={() => confirmarNominacion(d)}
                  >
                    {ocupado ? 'Nominando...' : 'Confirmar nominación'}
                  </Boton>
                  <Boton variante="secundario" onClick={() => setNominando(null)}>
                    Cancelar
                  </Boton>
                </div>
              </div>
            )}
          </Tarjeta>
        );
      })}
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Auxiliares
 * -------------------------------------------------------------------------- */

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la escritura. Puede que el despacho ya no sea de '
         + 'tu empresa, o que la acción no corresponda a su estado. Revisá la '
         + 'consola del navegador.';
  }
  return (err && err.message) || 'Error desconocido.';
}

/* -----------------------------------------------------------------------------
 * Estilos -- crearEstilos(colores, oscuro) + useEstilos(), mismo patron que
 * Pedidos.js/Programacion.js.
 * -------------------------------------------------------------------------- */

function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);

  return {
    wrap: { maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem', background: colores.fondo, color: colores.texto },
    panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
    titulo: { fontSize: 18, fontWeight: 500, color: colores.texto },

    solapas: { display: 'flex', gap: 4, marginBottom: 14, borderBottom: `0.5px solid ${colores.borde}`, flexWrap: 'wrap' },
    solapa: {
      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', background: 'none',
      color: pal.azul, fontSize: 13, cursor: 'pointer', borderBottom: '2px solid transparent',
      fontFamily: tipografia.familia,
    },
    solapaActiva: { color: marca, borderBottomColor: marca, fontWeight: tipografia.peso.negrita },
    solapaConteo: { fontSize: 11, padding: '1px 7px', borderRadius: radio.pastilla, background: colores.fondoAlterno, color: pal.azul },

    // Prioridad 1: lo mas grande e importante -- cliente, producto, fecha +
    // horario. Va en texto pleno (ni gris ni de color), es el dato central.
    prioridad1: { marginTop: 8, marginBottom: 8 },
    cliente: { fontSize: 15, fontWeight: tipografia.peso.negrita, color: colores.texto, marginBottom: 2 },
    productoFecha: { display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 13, color: colores.texto, fontWeight: tipografia.peso.medio },
    separador: { color: colores.borde },

    // Prioridad 2: direccion -- rojo, un escalon menos que el texto pleno.
    prioridad2: { fontSize: 13, color: pal.rojo, marginBottom: 8 },

    // Prioridad 3: OV/OC y volumen -- azul, lo menos urgente de leer.
    prioridad3: { display: 'flex', gap: 6, fontSize: 12, color: pal.azul, marginBottom: 8 },

    nominacion: { fontSize: 12, color: colores.textoSecundario, padding: '6px 10px', background: colores.fondoAlterno, borderRadius: 8, marginBottom: 8 },
    demora: { color: colorEstado.advertenciaTexto, fontWeight: tipografia.peso.medio },
    motivo: { fontSize: 12, color: colorEstado.advertenciaTexto, marginBottom: 8, fontWeight: tipografia.peso.medio },
    acciones: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 },
    ayuda: { fontSize: 11, color: pal.azul },

    formNominar: { marginTop: 10, padding: 12, background: colores.fondoAlterno, borderRadius: 10 },
    formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 },
    avisoIrreversible: { fontSize: 11, color: colorEstado.advertenciaTexto, marginBottom: 8, lineHeight: 1.4, fontWeight: tipografia.peso.medio },
    bannerAviso: { padding: '8px 12px', borderRadius: 8, background: colorEstado.advertenciaFondo, border: `0.5px solid ${colorEstado.advertenciaBorde}`, fontSize: 12, color: colorEstado.advertenciaTexto, marginBottom: 10 },

    avisosWrap: { background: colorEstado.advertenciaFondo, border: `0.5px solid ${colorEstado.advertenciaBorde}`, borderRadius: 10, padding: '10px 14px', marginBottom: 14 },
    avisosTitulo: { fontSize: 11, fontWeight: tipografia.peso.negrita, color: colorEstado.advertenciaTexto, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 },
    avisoItem: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', flexWrap: 'wrap' },
    avisoMensaje: { fontSize: 12, color: colorEstado.advertenciaTexto, flex: 1, minWidth: 200 },
    btnMarcarLeido: { borderColor: colorEstado.advertenciaBorde, color: colorEstado.advertenciaTexto },

    bannerError: { padding: '10px 14px', borderRadius: 8, background: colorEstado.peligroFondo, border: `0.5px solid ${colorEstado.peligroBordeAlterno}`, fontSize: 13, color: colorEstado.peligroTexto, marginBottom: 12, whiteSpace: 'pre-line' },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}
