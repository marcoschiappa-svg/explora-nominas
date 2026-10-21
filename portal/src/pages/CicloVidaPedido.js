/**
 * =============================================================================
 * CicloVidaPedido.js — v1.2.3
 * =============================================================================
 *
 * SÍNTOMA
 *   El ciclo de vida de una entrega (RF-05, v1.2.0) vivía en una pantalla
 *   aparte, `CicloVida.js`, con su propia lista de TODAS las entregas de TODOS
 *   los pedidos. Para ver el ciclo de un pedido había que salir de Pedidos,
 *   buscarlo de nuevo en otra lista y abrir la entrega. Además, los pedidos
 *   migrados y cerrados por cierre administrativo (v1.2.3) tienen viajes con
 *   `fin_ts: null` a propósito, y la línea de tiempo los mostraba como un viaje
 *   cuyo GPS falló ("Sin registro", y encima "Cierre manual").
 *
 * CAUSA RAÍZ
 *   El ciclo de vida es información de UN pedido, pero se llegaba a él por una
 *   lista global. Y `armarCicloDeEntrega()` no conoce los campos
 *   `cierre_administrativo` (campos nuevos de v1.2.3, ver
 *   `MODELO_DATOS_TOBE.md`): lee `fin_ts` y `cerrado_por: 'manual'` tal cual.
 *
 * ALCANCE
 *   Modal "Ciclo de vida — Pedido <OV> <número>", que se abre desde el botón
 *   "Ver ciclo de vida" del detalle del pedido (`Pedidos.js`). Es de SOLO
 *   LECTURA, salvo el cierre manual de un viaje abierto (ver más abajo).
 *
 *   CARGA: al montarse, con lecturas de una sola vez (`getDocs`), no
 *   suscripciones: `despachos` y `viajes` con `where('pedido_id', '==', …)`, e
 *   `historial` con `where('pedido_id', '==', …)` + `orderBy('ts', 'desc')`
 *   invertido en memoria (el índice compuesto `pedido_id ASC + ts DESC` ya
 *   existe: lo usa `HistorialPedido.js`; `armarCicloDeEntrega()` espera el
 *   historial ascendente). Son consultas de igualdad sobre un campo, más esa:
 *   no hacen falta índices nuevos. Un error se muestra en el banner del modal.
 *
 *   CONTENIDO: un selector con las entregas del pedido ("Entrega N · fecha ·
 *   etapa actual") y, abajo, la línea de tiempo completa de la elegida
 *   (`armarCicloDeEntrega()`): las 8 etapas, las ramas cerradas, las marcas y
 *   "Sin registro" donde no hay fuente. Arranca en la primera entrega que no
 *   esté cumplida ni suspendida; si todas lo están, en la primera.
 *
 *   CIERRE MANUAL (sin cambios respecto de RF-05): si la entrega elegida tiene
 *   un viaje abierto (`viajeAbierto()`) y el usuario es admin o coordinador,
 *   "Cerrar viaje a mano" abre `ModalCierreManual`. Al cerrarlo se vuelven a
 *   leer los datos del modal. El comercial no ve el botón.
 *
 *   CIERRE ADMINISTRATIVO (campos nuevos de v1.2.3), resuelto SOLO en esta
 *   pantalla, sin tocar `armarCicloDeEntrega()`:
 *     - `entrega.cierre_administrativo`: aviso "Cerrada administrativamente"
 *       con `pedido.cierre_motivo` y `pedido.cierre_ts`.
 *     - `viaje.cierre_administrativo`: la etapa "Entregado" dice que no hay
 *       hora de llegada registrada a propósito (en vez de "Sin registro"), y la
 *       marca "Cierre manual" (`cerrado_por: 'manual'`) se reemplaza por
 *       "Cierre administrativo".
 *
 *   QUÉ SE MUDÓ DE `CicloVida.js` (que se borra en esta versión): `LineaTiempo`,
 *   `formatoDuracion`, `traducirError`, la parte de `ModalDetalleCiclo` que
 *   arma y muestra el detalle (consulta del historial, despacho/viaje tronco,
 *   marcas, ramas cerradas, cierre manual) y los estilos que usa. Se fue con el
 *   borrado todo lo que era de la LISTA: filas, `BarraFiltros`, orden,
 *   `PastillaEtapa` de filtro, preferencias guardadas y las suscripciones a
 *   colecciones completas.
 *
 * LIMITACIONES CONOCIDAS
 *   - Lee los datos una vez: si alguien cambia el pedido mientras el modal está
 *     abierto, se ve al cerrarlo y volver a abrirlo (o tras un cierre manual).
 *   - El estado "etapa actual" del selector se arma SIN historial (alcanza: las
 *     fechas de las 8 etapas salen de campos, no del historial); solo la
 *     entrega elegida muestra el "quién".
 *   - Una entrega cerrada administrativamente cuyo despacho quedó `CANCELADO`
 *     (sin viaje) no tiene etapa "Entregado" con fecha: se ve el aviso de cierre
 *     administrativo y el resto en "Sin registro".
 *   - Mantiene una copia de la lógica del despacho/viaje "tronco" de
 *     `armarCicloDeEntrega()` (no la expone) para el botón de cierre manual.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. Manual: abrir un pedido migrado, uno
 *   cerrado por corte y uno vivo → "Ver ciclo de vida"; cerrar a mano un viaje
 *   abierto desde el modal; ir y volver entre detalle, historial y ciclo.
 *
 * -----------------------------------------------------------------------------
 * v1.2.3 (prompt 3) — DESPACHO CERRADO ADMINISTRATIVAMENTE, SIN VIAJE
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El cierre administrativo ahora deja los despachos vivos sin viaje en
 *     `ENTREGADO` (antes los cancelaba), con `cierre_administrativo: true`. Para
 *     `armarCicloDeEntrega()` un despacho `ENTREGADO` sin viaje tiene la etapa
 *     "Entregado" con `estado_ts` -- que es el instante del CIERRE, no una
 *     llegada --, y el ciclo mostraba esa fecha como si el camión hubiera
 *     llegado ahí (con "+N días" y, si pasaba la fecha pedida, "Fuera de fecha").
 *
 *   CAUSA RAÍZ
 *     `armarCicloDeEntrega()` no conoce `cierre_administrativo`: sin viaje, usa
 *     `despacho.estado_ts` como fecha de entrega.
 *
 *   ALCANCE
 *     Solo la condición en esta pantalla (la función no cambia, tampoco el
 *     diseño): si el despacho tronco tiene `cierre_administrativo` y no tiene
 *     viaje, la etapa "Entregado" muestra la misma marca "Cierre administrativo
 *     — sin hora de llegada registrada" que con un viaje cerrado
 *     administrativamente, sin fecha ni duración, y se oculta la marca "Fuera de
 *     fecha" (calculada contra esa fecha del cierre).
 *
 *   LIMITACIONES CONOCIDAS
 *     Una entrega cerrada por cierre administrativo cuyo despacho tronco es uno
 *     muerto (`RECHAZADO`/`CANCELADO`) sigue mostrando el aviso de la entrega,
 *     no la nota en "Entregado".
 *
 *   CÓMO SE VERIFICA
 *     Manual: un pedido cerrado por corte con un despacho aceptado y sin viaje:
 *     "Entregado" dice "Cierre administrativo — sin hora de llegada registrada",
 *     sin fecha ni "Fuera de fecha".
 * ========================================================================== */

import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { tieneAlgunRol } from '../sesion';
import { despachoVivo, viajeAbierto } from '../shared/estados';
import { armarCicloDeEntrega, ETIQUETA_ETAPA } from '../logica-ciclo-vida';
import { formatoFechaTs } from '../extractores-pedidos';
import ModalCierreManual from './ModalCierreManual';
import { marca, colorEstado, espacio, radio, tipografia, paletaTexto } from '../shared/tokens';
import { useTema } from '../ui/TemaContext';
import Boton from '../ui/Boton';
import Pastilla from '../ui/Pastilla';
import Modal from '../ui/Modal';

function traducirError(err) {
  if (err && err.code === 'permission-denied') {
    return 'Firestore rechazó la lectura. Revisá la consola del navegador.';
  }
  return (err && err.message) || 'Error desconocido.';
}

function aMillis(ts) {
  return ts && ts.toMillis ? ts.toMillis() : 0;
}

/**
 * @param {Object} props
 * @param {Object} props.pedido con `estado` ya derivado
 * @param {Array} props.entregas las del pedido
 * @param {Object} [props.org] organización cliente
 * @param {Object} [props.prod] producto
 * @param {Object} props.usuario la sesión
 * @param {function} props.onCerrar
 */
export default function CicloVidaPedido({ pedido, entregas, org, prod, usuario, onCerrar }) {
  const styles = useEstilos();

  const [despachos, setDespachos] = useState([]);
  const [viajes, setViajes] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [recarga, setRecarga] = useState(0);
  const [elegidaId, setElegidaId] = useState(null);
  const [cerrandoManual, setCerrandoManual] = useState(null);

  // 1. Lecturas de una sola vez. `recarga` las repite tras un cierre manual.
  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError('');

    Promise.all([
      getDocs(query(collection(db, 'despachos'), where('pedido_id', '==', pedido.id))),
      getDocs(query(collection(db, 'viajes'), where('pedido_id', '==', pedido.id))),
      // 2. Mismo orden que el índice compuesto `pedido_id ASC + ts DESC`; se da
      //    vuelta en memoria porque `armarCicloDeEntrega()` espera ascendente.
      getDocs(query(collection(db, 'historial'), where('pedido_id', '==', pedido.id), orderBy('ts', 'desc'))),
    ])
      .then(([sd, sv, sh]) => {
        if (cancelado) return;
        setDespachos(sd.docs.map(d => ({ id: d.id, ...d.data() })));
        setViajes(sv.docs.map(d => ({ id: d.id, ...d.data() })));
        setHistorial(sh.docs.map(d => ({ id: d.id, ...d.data() })).reverse());
        setCargando(false);
      })
      .catch(err => {
        console.error(err);
        if (!cancelado) { setError(traducirError(err)); setCargando(false); }
      });

    return () => { cancelado = true; };
  }, [pedido.id, recarga]);

  const entregasOrdenadas = useMemo(
    () => entregas.slice().sort((a, b) => (a.numero || 0) - (b.numero || 0)),
    [entregas]
  );

  // 3. Arranca en la primera entrega que no esté cumplida ni suspendida; si
  //    todas lo están, en la primera.
  const entrega = useMemo(() => {
    const elegida = elegidaId && entregasOrdenadas.find(e => e.id === elegidaId);
    if (elegida) return elegida;
    return entregasOrdenadas.find(e => e.estado !== 'cumplida' && e.estado !== 'suspendida')
      || entregasOrdenadas[0] || null;
  }, [elegidaId, entregasOrdenadas]);

  const ahora = useMemo(() => new Date(), [recarga]); // eslint-disable-line react-hooks/exhaustive-deps

  // 4. Etapa actual de cada entrega, para las pastillas: sin historial, igual
  //    que la lista de `CicloVida.js` (las fechas salen de campos).
  const etapaActualPorEntrega = useMemo(() => {
    const m = new Map();
    entregasOrdenadas.forEach(e => {
      m.set(e.id, armarCicloDeEntrega({ entrega: e, pedido, despachos, viajes, historial: [], ahora }).etapaActual.id);
    });
    return m;
  }, [entregasOrdenadas, pedido, despachos, viajes, ahora]);

  const ciclo = useMemo(() => entrega
    ? armarCicloDeEntrega({ entrega, pedido, despachos, viajes, historial, ahora })
    : null,
  [entrega, pedido, despachos, viajes, historial, ahora]);

  // 5. El despacho/viaje "tronco" -- mismo criterio que `logica-ciclo-vida.js`,
  //    recalculado acá (no lo expone `armarCicloDeEntrega()`) para el botón de
  //    cierre manual y para la marca de cierre administrativo.
  const despachoTronco = useMemo(() => {
    if (!entrega) return null;
    const dEntrega = despachos.filter(d => d.entrega_id === entrega.id)
      .slice().sort((a, b) => aMillis(a.creado_en) - aMillis(b.creado_en));
    return dEntrega.find(despachoVivo) || dEntrega[dEntrega.length - 1] || null;
  }, [despachos, entrega]);

  const viajeTronco = useMemo(
    () => despachoTronco ? (viajes.find(v => v.despacho_id === despachoTronco.id) || null) : null,
    [despachoTronco, viajes]
  );

  const puedeCerrarManual = tieneAlgunRol(usuario, ['admin', 'coordinador']) && viajeAbierto(viajeTronco);
  const viajeCerradoAdministrativo = !!(viajeTronco && viajeTronco.cierre_administrativo);
  // 10. v1.2.3 (prompt 3): el cierre deja los despachos vivos sin viaje en
  //     ENTREGADO con `cierre_administrativo`. Su `estado_ts` es la hora del
  //     CIERRE, no de una llegada: la etapa "Entregado" no la muestra.
  const despachoCerradoSinViaje = !!(despachoTronco && despachoTronco.cierre_administrativo && !viajeTronco);
  const sinHoraDeLlegada = viajeCerradoAdministrativo || despachoCerradoSinViaje;
  const entregaCerradaAdministrativo = !!(entrega && entrega.cierre_administrativo);

  const titulo = `Ciclo de vida — Pedido ${pedido.ov || ''} ${pedido.numero || ''}`.replace(/\s+/g, ' ').trim();

  return (
    <>
      <Modal titulo={titulo} onCerrar={onCerrar} ancho={720}>
        <div style={styles.detalleResumen}>
          <span>{org ? org.razon_social : '—'}</span>
          <span>{prod ? prod.nombre : '—'}</span>
          <span>{pedido.volumen} tn</span>
          <span>{entregasOrdenadas.length} entrega(s)</span>
        </div>

        {error && <div style={styles.bannerErrorChico}>{error}</div>}
        {cargando && <div style={styles.usoVacio}>Cargando ciclo de vida...</div>}

        {entregasOrdenadas.length === 0 && !cargando && (
          <div style={styles.usoVacio}>El pedido no tiene entregas.</div>
        )}

        {entregasOrdenadas.length > 0 && (
          <div style={styles.selector}>
            {entregasOrdenadas.map(e => {
              const etapaId = etapaActualPorEntrega.get(e.id);
              const detalle = e.estado === 'suspendida' ? 'Suspendida' : ETIQUETA_ETAPA[etapaId];
              return (
                <PastillaEntrega
                  key={e.id}
                  activo={entrega && e.id === entrega.id}
                  onClick={() => setElegidaId(e.id)}
                  label={`Entrega ${e.numero} · ${e.fecha_solicitada || 'sin fecha'} · ${detalle}`}
                />
              );
            })}
          </div>
        )}

        {entrega && ciclo && !cargando && (
          <>
            <div style={styles.detalleResumen}>
              <span>Entrega {entrega.numero} de {entregasOrdenadas.length}</span>
              <span>{entrega.volumen} tn</span>
              <span>{entrega.fecha_solicitada || 'sin fecha'}</span>
            </div>

            {/* 6. Cierre administrativo de la ENTREGA (campo nuevo v1.2.3). */}
            {entregaCerradaAdministrativo && (
              <div style={styles.avisoCierre}>
                <div style={styles.avisoCierreTitulo}>Cerrada administrativamente</div>
                <div>
                  {pedido.cierre_motivo || 'Sin motivo registrado'}
                  {pedido.cierre_ts ? ` · ${formatoFechaTs(pedido.cierre_ts)}` : ''}
                </div>
              </div>
            )}

            {puedeCerrarManual && (
              <div style={{ marginBottom: espacio.md }}>
                <Boton variante="peligro" chico onClick={() => setCerrandoManual({ despacho: despachoTronco, viaje: viajeTronco })}>
                  Cerrar viaje a mano
                </Boton>
              </div>
            )}

            <div style={styles.marcasFila}>
              {/* 7. Un viaje cerrado administrativamente también tiene
                  `cerrado_por: 'manual'`: se muestra como "Cierre
                  administrativo", no como un cierre manual de una persona. */}
              {viajeCerradoAdministrativo && (
                <Pastilla chico colores={{ bg: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTexto }}>
                  Cierre administrativo
                </Pastilla>
              )}
              {!viajeCerradoAdministrativo && ciclo.marcas.cierreManual && (
                <Pastilla chico colores={{ bg: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTexto }}>
                  Cierre manual{ciclo.marcas.cierreManual.quien ? ` -- ${ciclo.marcas.cierreManual.quien}` : ''}
                </Pastilla>
              )}
              {ciclo.marcas.sinInicio && (
                <Pastilla chico colores={{ bg: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTexto }}>Sin inicio</Pastilla>
              )}
              {ciclo.marcas.demorado && (
                <Pastilla chico colores={{ bg: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTexto }}>Demorado</Pastilla>
              )}
              {ciclo.marcas.fueraDeFecha && !despachoCerradoSinViaje && (
                <Pastilla chico colores={{ bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto }}>Fuera de fecha</Pastilla>
              )}
              {ciclo.marcas.suspendida && (
                <Pastilla chico colores={{ bg: colorEstado.peligroFondo, color: colorEstado.peligroTexto }}>
                  Suspendida{ciclo.marcas.suspendida.quien ? ` -- ${ciclo.marcas.suspendida.quien}` : ''}
                </Pastilla>
              )}
              {ciclo.marcas.reactivada && (
                <Pastilla chico colores={{ bg: colorEstado.exitoFondo, color: colorEstado.exitoTexto }}>
                  Reactivada{ciclo.marcas.reactivada.quien ? ` -- ${ciclo.marcas.reactivada.quien}` : ''}
                </Pastilla>
              )}
            </div>

            <div style={styles.lineaTitulo}>Línea de tiempo</div>
            <LineaTiempo
              etapas={ciclo.etapas}
              etapaActualId={ciclo.etapaActual.id}
              sinHoraDeLlegadaAdministrativa={sinHoraDeLlegada}
            />

            {ciclo.ramasCerradas.length > 0 && (
              <>
                <div style={styles.lineaTitulo}>Ramas cerradas</div>
                {ciclo.ramasCerradas.map(rama => (
                  <div key={rama.despachoId} style={styles.ramaBloque}>
                    <div style={styles.ramaHeader}>
                      Despacho {rama.numero || rama.despachoId} -- {rama.estado === 'RECHAZADO' ? 'Rechazado' : 'Cancelado'}
                      {rama.cerradoTs ? ` -- ${formatoFechaTs({ toDate: () => rama.cerradoTs })}` : ''}
                    </div>
                    {rama.motivo && <div style={styles.ramaMotivo}>Motivo: {rama.motivo}</div>}
                    {rama.quien && <div style={styles.ramaMotivo}>Por: {rama.quien}</div>}
                    <LineaTiempo etapas={rama.etapas} etapaActualId={null} chica />
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </Modal>

      {cerrandoManual && (
        <ModalCierreManual
          viaje={cerrandoManual.viaje}
          despacho={{
            id: cerrandoManual.despacho.id,
            numero: cerrandoManual.despacho.numero,
            fecha_carga: cerrandoManual.despacho.fecha_carga,
          }}
          usuario={usuario}
          // 8. Al cerrar con éxito se vuelven a leer los datos del modal.
          onCerrado={() => { setCerrandoManual(null); setRecarga(n => n + 1); }}
          onCancelar={() => setCerrandoManual(null)}
        />
      )}
    </>
  );
}

function PastillaEntrega({ activo, onClick, label }) {
  const { colores, oscuro } = useTema();
  const pal = paletaTexto(oscuro);
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px', borderRadius: radio.pastilla, border: 'none', cursor: 'pointer',
        fontSize: tipografia.tamano.sm, fontWeight: activo ? tipografia.peso.medio : tipografia.peso.normal,
        background: activo ? marca : colores.fondoAlterno, color: activo ? '#fff' : pal.azul,
        marginRight: 6, marginBottom: 6,
      }}
    >
      {label}
    </button>
  );
}

/**
 * 9. `sinHoraDeLlegadaAdministrativa`: el viaje (o el despacho sin viaje) se
 *    cerró por cierre administrativo: `fin_ts` queda en `null` A PROPÓSITO (no
 *    se inventa una hora de llegada) y, sin viaje, `estado_ts` es la hora del
 *    cierre. En la etapa "Entregado" se dice eso, sin fecha ni duración, en vez
 *    de "Sin registro" (que se leería como un GPS roto) o de la hora del cierre.
 */
function LineaTiempo({ etapas, etapaActualId, chica, sinHoraDeLlegadaAdministrativa }) {
  const styles = useEstilos();
  return (
    <div style={styles.timeline}>
      {etapas.map(e => {
        const notaAdministrativa = sinHoraDeLlegadaAdministrativa && e.id === 'entregado';
        return (
          <div key={e.id} style={styles.timelineItem}>
            <div style={{ ...styles.timelinePunto, ...((e.ts || notaAdministrativa) ? styles.timelinePuntoConDato : {}), ...(e.id === etapaActualId ? styles.timelinePuntoActual : {}) }} />
            <div style={styles.timelineContenido}>
              <div style={{ ...styles.timelineEtiqueta, fontSize: chica ? tipografia.tamano.sm : tipografia.tamano.md }}>
                {e.etiqueta}
              </div>
              <div style={styles.timelineDato}>
                {notaAdministrativa
                  ? 'Cierre administrativo — sin hora de llegada registrada'
                  : (e.ts ? formatoFechaTs({ toDate: () => e.ts }) : 'Sin registro')}
                {e.quien ? ` -- ${e.quien}` : ''}
              </div>
              {!notaAdministrativa && e.duracionDesdeAnteriorMs !== null && e.duracionDesdeAnteriorMs !== undefined && (
                <div style={styles.timelineDuracion}>
                  +{formatoDuracion(e.duracionDesdeAnteriorMs)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatoDuracion(ms) {
  const minutos = Math.round(ms / 60000);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `${horas} h`;
  return `${Math.floor(horas / 24)} día(s)`;
}

/* -----------------------------------------------------------------------------
 * Estilos -- crearEstilos(colores) + useEstilos()
 * -------------------------------------------------------------------------- */

function crearEstilos(colores) {
  return {
    bannerErrorChico: {
      padding: '8px 10px', borderRadius: radio.sm, background: colorEstado.peligroFondo,
      fontSize: tipografia.tamano.sm, color: colorEstado.peligroTexto, marginBottom: espacio.sm,
      overflowWrap: 'anywhere', wordBreak: 'break-word',
    },

    selector: { marginBottom: espacio.md, display: 'flex', flexWrap: 'wrap' },

    avisoCierre: {
      padding: '8px 12px', borderRadius: radio.md, background: colorEstado.advertenciaFondo,
      color: colorEstado.advertenciaTexto, fontSize: tipografia.tamano.sm, marginBottom: espacio.md,
      overflowWrap: 'anywhere',
    },
    avisoCierreTitulo: { fontWeight: tipografia.peso.medio, marginBottom: 2 },

    detalleResumen: { display: 'flex', gap: espacio.md, flexWrap: 'wrap', fontSize: tipografia.tamano.sm, color: colores.textoSecundario, marginBottom: espacio.md },
    marcasFila: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: espacio.md },

    lineaTitulo: { fontSize: tipografia.tamano.md, fontWeight: tipografia.peso.medio, color: colores.texto, margin: `${espacio.md}px 0 ${espacio.sm}px` },

    timeline: { display: 'flex', flexDirection: 'column' },
    timelineItem: { display: 'flex', gap: espacio.sm, paddingBottom: espacio.md, position: 'relative' },
    timelinePunto: { width: 10, height: 10, borderRadius: '50%', background: colores.borde, marginTop: 4, flexShrink: 0 },
    timelinePuntoConDato: { background: colorEstado.acentoVerde },
    timelinePuntoActual: { boxShadow: `0 0 0 3px ${colorEstado.acentoAzulFuerte}33` },
    timelineContenido: { flex: 1 },
    timelineEtiqueta: { color: colores.texto, fontWeight: tipografia.peso.medio },
    timelineDato: { fontSize: tipografia.tamano.sm, color: colores.textoSuave },
    timelineDuracion: { fontSize: tipografia.tamano.xs, color: colores.textoTenue },

    ramaBloque: { padding: espacio.sm, background: colores.fondoAlterno, borderRadius: radio.md, marginBottom: espacio.sm },
    ramaHeader: { fontSize: tipografia.tamano.sm, fontWeight: tipografia.peso.medio, color: colores.texto },
    ramaMotivo: { fontSize: tipografia.tamano.sm, color: colorEstado.peligroTexto },

    usoVacio: { fontSize: tipografia.tamano.sm, color: colores.textoTenue },
  };
}

function useEstilos() {
  const { colores } = useTema();
  return useMemo(() => crearEstilos(colores), [colores]);
}
