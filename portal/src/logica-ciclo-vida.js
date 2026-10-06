/* =============================================================================
 * logica-ciclo-vida.js — v1.2.0 (RF-05)
 * =============================================================================
 *
 * SÍNTOMA
 *   No había forma de ver, para UNA entrega puntual, en qué etapa está, cuándo
 *   pasó por cada una, quién la ejecutó y cuánto tardó. `HistorialPedido.js`
 *   muestra todo lo que pasó bajo un PEDIDO entero, mezclado y en orden
 *   cronológico plano — útil para auditar, no para leer de un vistazo el
 *   camino de una entrega puntual.
 *
 * CAUSA RAÍZ
 *   El ciclo de vida de una entrega está repartido en cuatro colecciones
 *   (`entregas`, `despachos`, `viajes`, `historial`) y nadie lo arma en un
 *   solo lugar.
 *
 * ALCANCE
 *   `armarCicloDeEntrega()` es lógica PURA (sin Firestore): recibe la entrega,
 *   su pedido, TODOS los despachos y viajes del pedido, y el `historial` ya
 *   leído (de `where('pedido_id', '==', pedido.id)`), y arma las ocho etapas
 *   fijas del ciclo, más las ramas cerradas (despachos rechazados o
 *   cancelados de esa entrega) y las marcas.
 *
 *   TABLA DE FUENTES (ver V3 del prompt de la tarea — se repite acá para que
 *   quede junto al código que la implementa):
 *
 *     1. Entrega solicitada   campo `entregas.creado_en` (fecha) +
 *                              historial `crear_pedido` (entidad pedido,
 *                              `despues.entregas` con el mismo `numero`) para
 *                              quién, si la entrega nació con el pedido. Si se
 *                              agregó después (`agregarEntregas`), el único
 *                              registro es `crear_entrega`, pero va
 *                              `derivado: true` — se excluye, así que "quién"
 *                              queda "Sin registro" en ese caso; la fecha
 *                              sigue saliendo del campo.
 *     2. Despacho creado      campo `despachos.creado_en` (fecha) + historial
 *                              `aceptar_entrega` (entidad despacho) para quién.
 *     3. Transporte asignado  historial `asignar_transportista` (entidad
 *                              despacho); si el despacho nació YA con
 *                              transportista (se asignó al aceptar la
 *                              entrega), no hay un segundo evento — se usa el
 *                              mismo `aceptar_entrega` de la etapa 2.
 *     4. Aceptado              historial `aceptar_despacho` (entidad despacho).
 *     5. Nominado               historial `nominar` (entidad despacho).
 *     6. Viaje recibido         campo `viajes.creado_en` (fecha) — el
 *                              historial de su creación (`crear_viaje`) es
 *                              `derivado: true` y se excluye; "quién" se toma
 *                              del mismo `nominar` de la etapa 5 (mismo actor,
 *                              misma acción).
 *     7. En viaje                campo `viajes.inicio_ts` (fecha) + historial
 *                              `iniciar_viaje` (entidad viaje) para quién.
 *     8. Entregado               campo `viajes.fin_ts`, o si no hay viaje
 *                              (caso imposible en la práctica, pero
 *                              tolerado), `despachos.estado_ts` cuando el
 *                              despacho está `ENTREGADO`. Historial
 *                              `finalizar_viaje`/`cerrar_viaje_manual`
 *                              (entidad viaje) para quién.
 *
 *   Lo que no tiene fuente queda `ts: null`, `quien: null` — la pantalla lo
 *   muestra como "Sin registro". Nunca se infiere ni se estima.
 *
 *   TOLERANCIA: una entrega sin ningún despacho arma igual las ocho etapas,
 *   con la etapa 1 completa y el resto en "Sin registro". Un despacho de
 *   antes de la v2 de `denormalizadosDe()` (sin campos denormalizados) no
 *   afecta nada acá: esta función nunca lee esos campos, solo IDs y campos
 *   propios del documento (`creado_en`, `estado`, `estado_ts`...). Un viaje
 *   cerrado a mano desde `RECIBIDO` (ver v2 de `finalizarViaje()`, en
 *   `logica-viajes.js`) queda con la etapa "En viaje" en "Sin registro" y la
 *   marca `sinInicio`.
 *
 * LIMITACIONES CONOCIDAS
 *   - La entrega "tronco" (las 8 etapas principales) es el despacho VIVO de
 *     esa entrega, o si no hay ninguno vivo, el ÚLTIMO por `creado_en` —
 *     nunca se combinan datos de dos despachos distintos en una misma etapa.
 *   - Reasignar el transportista más de una vez no agrega una etapa nueva:
 *     "Transporte asignado" muestra la PRIMERA asignación. Las reasignaciones
 *     quedan en `historial` (vía `HistorialPedido.js`), no en esta línea de
 *     tiempo.
 *   - `diasEnEtapaActual` se calcula contra `ahora` (parámetro, por defecto
 *     `new Date()` — inyectable para tests). Si la etapa actual no tiene
 *     fecha (nunca debería pasar: la etapa 1 siempre tiene `entregas.creado_en`),
 *     queda `null`.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- logica-ciclo-vida` — ver `logica-ciclo-vida.test.js`:
 *   despacho sin denormalizados, entrega sin despacho, viaje cerrado a mano
 *   desde RECIBIDO, rechazo seguido de un despacho nuevo, suspensión seguida
 *   de reactivación. `CI=true npm run build` sin warnings.
 * ========================================================================== */

import { DESPACHOS_MUERTOS, despachoVivo } from './estados';

/* -----------------------------------------------------------------------------
 * Utilidades
 * -------------------------------------------------------------------------- */

/** Un valor de fecha del modelo (Timestamp de Firestore, Date, o nada) a
 * `Date` de JS, o `null`. */
function aFecha(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  return null;
}

/** `Date` a `YYYY-MM-DD` LOCAL — mismo criterio que `hoyISO()` del resto del
 * portal, para comparar contra `fecha_solicitada`. */
function aFechaISOLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** El evento MÁS ANTIGUO de `historial` que cumple `filtro` — "cuándo pasó
 * por esta etapa por primera vez". */
function primerEvento(historial, filtro) {
  const eventos = historial.filter(filtro).sort(
    (a, b) => (aFecha(a.ts) || 0) - (aFecha(b.ts) || 0)
  );
  return eventos[0] || null;
}

export const ETIQUETA_ETAPA = {
  entrega_solicitada: 'Entrega solicitada',
  despacho_creado: 'Despacho creado',
  transporte_asignado: 'Transporte asignado',
  aceptado: 'Aceptado',
  nominado: 'Nominado',
  viaje_recibido: 'Viaje recibido',
  en_viaje: 'En viaje',
  entregado: 'Entregado',
};

export const ORDEN_ETAPAS = [
  'entrega_solicitada', 'despacho_creado', 'transporte_asignado', 'aceptado',
  'nominado', 'viaje_recibido', 'en_viaje', 'entregado',
];

/* -----------------------------------------------------------------------------
 * Las 7 etapas que dependen de UN despacho (y, si llega, su viaje) — se usa
 * tanto para el tronco (el despacho vivo, o el último) como para cada rama
 * cerrada (un despacho rechazado o cancelado).
 * -------------------------------------------------------------------------- */
function etapasDeDespacho(despacho, viaje, historial) {
  if (!despacho) {
    return ORDEN_ETAPAS.slice(1).map(id => ({
      id, etiqueta: ETIQUETA_ETAPA[id], ts: null, quien: null, fuente: 'sin_registro',
    }));
  }

  const evAceptarEntrega = historial.find(h =>
    h.entidad_tipo === 'despacho' && h.entidad_id === despacho.id && h.accion === 'aceptar_entrega');

  const etapas = [];

  etapas.push({
    id: 'despacho_creado', etiqueta: ETIQUETA_ETAPA.despacho_creado,
    ts: aFecha(despacho.creado_en),
    quien: evAceptarEntrega ? evAceptarEntrega.usuario_nombre : null,
    fuente: despacho.creado_en ? 'campo:despachos.creado_en' : 'sin_registro',
  });

  const evAsignar = primerEvento(historial, h =>
    h.entidad_tipo === 'despacho' && h.entidad_id === despacho.id && h.accion === 'asignar_transportista');

  let asignado;
  if (evAsignar) {
    asignado = { ts: aFecha(evAsignar.ts), quien: evAsignar.usuario_nombre, fuente: 'historial:asignar_transportista' };
  } else if (despacho.transportista_org_id && evAceptarEntrega) {
    asignado = { ts: aFecha(evAceptarEntrega.ts), quien: evAceptarEntrega.usuario_nombre, fuente: 'historial:aceptar_entrega' };
  } else if (despacho.transportista_org_id) {
    asignado = { ts: aFecha(despacho.creado_en), quien: null, fuente: 'campo:despachos.creado_en' };
  } else {
    asignado = { ts: null, quien: null, fuente: 'sin_registro' };
  }
  etapas.push({ id: 'transporte_asignado', etiqueta: ETIQUETA_ETAPA.transporte_asignado, ...asignado });

  const evAceptar = primerEvento(historial, h =>
    h.entidad_tipo === 'despacho' && h.entidad_id === despacho.id && h.accion === 'aceptar_despacho');
  etapas.push({
    id: 'aceptado', etiqueta: ETIQUETA_ETAPA.aceptado,
    ts: evAceptar ? aFecha(evAceptar.ts) : null,
    quien: evAceptar ? evAceptar.usuario_nombre : null,
    fuente: evAceptar ? 'historial:aceptar_despacho' : 'sin_registro',
  });

  const evNominar = primerEvento(historial, h =>
    h.entidad_tipo === 'despacho' && h.entidad_id === despacho.id && h.accion === 'nominar');
  etapas.push({
    id: 'nominado', etiqueta: ETIQUETA_ETAPA.nominado,
    ts: evNominar ? aFecha(evNominar.ts) : null,
    quien: evNominar ? evNominar.usuario_nombre : null,
    fuente: evNominar ? 'historial:nominar' : 'sin_registro',
  });

  etapas.push({
    id: 'viaje_recibido', etiqueta: ETIQUETA_ETAPA.viaje_recibido,
    ts: viaje ? aFecha(viaje.creado_en) : null,
    // "Quién" sale del mismo `nominar` que crea el viaje -- ver la tabla de
    // fuentes en el encabezado: el historial de `crear_viaje` es derivado y
    // se excluye, pero el actor es el mismo.
    quien: (viaje && evNominar) ? evNominar.usuario_nombre : null,
    fuente: (viaje && viaje.creado_en) ? 'campo:viajes.creado_en' : 'sin_registro',
  });

  const evIniciar = viaje
    ? primerEvento(historial, h => h.entidad_tipo === 'viaje' && h.entidad_id === viaje.id && h.accion === 'iniciar_viaje')
    : null;
  etapas.push({
    id: 'en_viaje', etiqueta: ETIQUETA_ETAPA.en_viaje,
    ts: viaje ? aFecha(viaje.inicio_ts) : null,
    quien: evIniciar ? evIniciar.usuario_nombre : null,
    fuente: (viaje && viaje.inicio_ts) ? 'campo:viajes.inicio_ts' : 'sin_registro',
  });

  const evFinalizar = viaje
    ? primerEvento(historial, h => h.entidad_tipo === 'viaje' && h.entidad_id === viaje.id
        && (h.accion === 'finalizar_viaje' || h.accion === 'cerrar_viaje_manual'))
    : null;
  const tsEntregado = viaje
    ? aFecha(viaje.fin_ts)
    : (despacho.estado === 'ENTREGADO' ? aFecha(despacho.estado_ts) : null);
  etapas.push({
    id: 'entregado', etiqueta: ETIQUETA_ETAPA.entregado,
    ts: tsEntregado,
    quien: evFinalizar ? evFinalizar.usuario_nombre : null,
    fuente: tsEntregado ? (viaje && viaje.fin_ts ? 'campo:viajes.fin_ts' : 'campo:despachos.estado_ts') : 'sin_registro',
  });

  return etapas;
}

/**
 * Arma el ciclo de vida completo de una entrega.
 *
 * @param {Object} params
 * @param {Object} params.entrega
 * @param {Object} params.pedido
 * @param {Array} params.despachos TODOS los del pedido (se filtran acá por
 *   `entrega_id`)
 * @param {Array} params.viajes TODOS los del pedido
 * @param {Array} params.historial De `where('pedido_id', '==', pedido.id)`,
 *   sin ordenar necesariamente — esta función ordena lo que necesita.
 * @param {Date} [params.ahora] inyectable para tests
 * @returns {{etapas: Array, ramasCerradas: Array, etapaActual: Object,
 *   diasEnEtapaActual: number|null, marcas: Object}}
 */
export function armarCicloDeEntrega({ entrega, pedido, despachos = [], viajes = [], historial = [], ahora = new Date() }) {
  // Los registros `derivado: true` se excluyen SIEMPRE, para toda la función
  // -- ver la tabla de fuentes en el encabezado.
  const historialLimpio = (historial || []).filter(h => !h.derivado);

  const despachosDeEntrega = (despachos || [])
    .filter(d => d.entrega_id === entrega.id)
    .slice()
    .sort((a, b) => (aFecha(a.creado_en) || 0) - (aFecha(b.creado_en) || 0));

  const viajePorDespacho = new Map((viajes || []).map(v => [v.despacho_id, v]));

  const despachoTronco = despachosDeEntrega.find(despachoVivo)
    || despachosDeEntrega[despachosDeEntrega.length - 1]
    || null;

  /* ── Etapa 1: Entrega solicitada ──────────────────────────────────────── */

  const evCrearPedido = historialLimpio.find(h =>
    h.entidad_tipo === 'pedido' && h.accion === 'crear_pedido'
    && h.despues && Array.isArray(h.despues.entregas)
    && h.despues.entregas.some(e => e && e.numero === entrega.numero));

  const etapaSolicitada = {
    id: 'entrega_solicitada', etiqueta: ETIQUETA_ETAPA.entrega_solicitada,
    ts: aFecha(entrega.creado_en),
    quien: evCrearPedido ? evCrearPedido.usuario_nombre : null,
    fuente: entrega.creado_en ? 'campo:entregas.creado_en' : 'sin_registro',
  };

  /* ── Tronco: 2 a 8 ────────────────────────────────────────────────────── */

  const viajeTronco = despachoTronco ? (viajePorDespacho.get(despachoTronco.id) || null) : null;
  const etapas = [etapaSolicitada, ...etapasDeDespacho(despachoTronco, viajeTronco, historialLimpio)];

  // Duraciones: contra la última etapa ANTERIOR que sí tiene fecha -- así
  // una etapa sin registro en el medio no rompe la cuenta de la siguiente.
  let ultimaConFecha = null;
  etapas.forEach(e => {
    e.duracionDesdeAnteriorMs = (e.ts && ultimaConFecha) ? (e.ts.getTime() - ultimaConFecha.getTime()) : null;
    if (e.ts) ultimaConFecha = e.ts;
  });

  /* ── Ramas cerradas: despachos rechazados/cancelados que NO son el tronco */

  const ramasCerradas = despachosDeEntrega
    .filter(d => (!despachoTronco || d.id !== despachoTronco.id) && DESPACHOS_MUERTOS.includes(d.estado))
    .map(d => {
      const evCierre = primerEvento(historialLimpio, h =>
        h.entidad_tipo === 'despacho' && h.entidad_id === d.id
        && (h.accion === 'rechazar_despacho' || h.accion === 'cancelar_despacho'));

      return {
        despachoId: d.id,
        numero: d.numero || null,
        estado: d.estado,
        motivo: d.estado === 'RECHAZADO' ? (d.rechazo_motivo || null) : (d.cancelacion_motivo || null),
        cerradoTs: evCierre ? aFecha(evCierre.ts) : aFecha(d.estado_ts),
        quien: evCierre ? evCierre.usuario_nombre : null,
        etapas: etapasDeDespacho(d, viajePorDespacho.get(d.id) || null, historialLimpio),
      };
    });

  /* ── Etapa actual y tiempo en ella ────────────────────────────────────── */

  let etapaActual = etapas[0];
  for (let i = etapas.length - 1; i >= 0; i--) {
    if (etapas[i].ts) { etapaActual = etapas[i]; break; }
  }
  const diasEnEtapaActual = etapaActual.ts
    ? Math.floor((ahora.getTime() - etapaActual.ts.getTime()) / 86400000)
    : null;

  /* ── Marcas ───────────────────────────────────────────────────────────── */

  const marcas = {};

  if (viajeTronco && viajeTronco.cerrado_por === 'manual') {
    const evCierreManual = primerEvento(historialLimpio, h =>
      h.entidad_tipo === 'viaje' && h.entidad_id === viajeTronco.id && h.accion === 'cerrar_viaje_manual');
    marcas.cierreManual = {
      motivo: viajeTronco.cierre_motivo || null,
      quien: evCierreManual ? evCierreManual.usuario_nombre : null,
    };
  }

  if (viajeTronco && viajeTronco.estado === 'FINALIZADO' && !viajeTronco.inicio_ts) {
    marcas.sinInicio = true;
  }

  if (viajeTronco && viajeTronco.demorado) {
    marcas.demorado = true;
  }

  const etapaEntregado = etapas.find(e => e.id === 'entregado');
  if (etapaEntregado && etapaEntregado.ts && entrega.fecha_solicitada) {
    if (aFechaISOLocal(etapaEntregado.ts) > entrega.fecha_solicitada) marcas.fueraDeFecha = true;
  }

  const evSuspender = primerEvento(historialLimpio, h =>
    h.entidad_tipo === 'entrega' && h.entidad_id === entrega.id && h.accion === 'suspender_entrega');
  if (evSuspender) {
    marcas.suspendida = { ts: aFecha(evSuspender.ts), quien: evSuspender.usuario_nombre, motivo: evSuspender.razon || null };
  }

  const evReactivar = primerEvento(historialLimpio, h =>
    h.entidad_tipo === 'entrega' && h.entidad_id === entrega.id && h.accion === 'reactivar_entrega');
  if (evReactivar) {
    marcas.reactivada = { ts: aFecha(evReactivar.ts), quien: evReactivar.usuario_nombre };
  }

  return { etapas, ramasCerradas, etapaActual, diasEnEtapaActual, marcas };
}
