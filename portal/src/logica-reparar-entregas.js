/* =============================================================================
 * logica-reparar-entregas.js — v1.2.3 (entregas trabadas en `programada`)
 * =============================================================================
 *
 * SÍNTOMA
 *   `verificar-contadores.js --produccion` muestra 6 pedidos con
 *   `entregas_cumplidas = 1` y su única entrega en `programada`, con el despacho
 *   `ENTREGADO` y el viaje `FINALIZADO`. La pantalla de Pedidos lee
 *   `entrega.estado` guardado y muestra "Programada" en entregas ya entregadas.
 *
 * CAUSA RAÍZ
 *   `finalizarViaje()` (`shared/logica-viajes.js`) nunca escribía la entrega:
 *   todo cierre de viaje la dejaba trabada. Está arreglado hacia adelante (ver
 *   el encabezado v1.2.3 de ese archivo); esto repara lo que ya quedó mal.
 *
 * ALCANCE
 *   Dos funciones PURAS, sin Firestore y sin reloj propio (`ahora` es
 *   parámetro). Las escribe `scripts/reparar-entregas-cumplidas.js`.
 *
 *   `armarReparacionEntregas()` — por pedido. Una entrega se repara si:
 *     - no está `cumplida` ni `suspendida`,
 *     - tiene al menos un despacho vivo (no `RECHAZADO`/`CANCELADO`),
 *     - y TODOS sus despachos vivos están `ENTREGADO`.
 *   Cada una pasa a `cumplida` (`estado_ts`, `actualizado_en`) con su registro
 *   `recalcular_estado` (`derivado: false`, razón fija). Los contadores del
 *   pedido se RECUENTAN desde las entregas resultantes, con el mismo criterio
 *   que `verificar-contadores.js` (nunca con increment). No aplica a pedidos
 *   suspendidos (sus contadores no necesitan cuadrar).
 *
 *   `armarCompletarEntregaId()` — para cada viaje abierto (`RECIBIDO` o
 *   `EN_VIAJE`) sin `entrega_id`, lo completa con el `entrega_id` de su
 *   despacho, para que el chofer, al cerrarlo con la versión nueva, deje la
 *   entrega `cumplida`.
 *
 * LIMITACIONES CONOCIDAS
 *   - Una entrega con un despacho vivo que no está `ENTREGADO` no se repara: el
 *     camión todavía no entregó (o el cierre es otro caso). Tampoco una entrega
 *     sin despachos vivos: ahí no hay evidencia de que se haya entregado.
 *   - No se escribe `despacho_cumplido_id`: si hubiera varios despachos
 *     entregados, cuál "cumplió" sería una elección arbitraria.
 *   - El historial de los viajes a los que se les completa `entrega_id` no se
 *     escribe: es un dato de enlace, no un cambio de negocio.
 *
 * CÓMO SE VERIFICA
 *   `logica-reparar-entregas.test.js`. Con datos: correr el script en simulación
 *   y revisar que lista los pedidos que marcaba `verificar-contadores.js`;
 *   ejecutar y volver a correr `verificar-contadores.js` (sin diferencias) y el
 *   script otra vez (sin candidatos).
 *
 * Es CommonJS a propósito, igual que `logica-cierre-administrativo.js`: lo usan
 * scripts de Node (`require`) y jest.
 * ========================================================================== */

const {
  DESPACHO, ENTREGA,
  despachoVivo, viajeAbierto, recontarContadores,
} = require('./logica-cierre-administrativo');

const RAZON = 'Reparación v1.2.3: el viaje se cerró sin actualizar la entrega';

/** ¿Esta entrega está trabada? Ver "ALCANCE" arriba. */
function entregaTrabada(entrega, despachos) {
  if (entrega.estado === ENTREGA.CUMPLIDA || entrega.estado === ENTREGA.SUSPENDIDA) return false;

  const vivos = (despachos || []).filter(d => d.entrega_id === entrega.id && despachoVivo(d));
  return vivos.length > 0 && vivos.every(d => d.estado === DESPACHO.ENTREGADO);
}

function antesContadores(pedido) {
  return {
    entregas_total: pedido.entregas_total || 0,
    entregas_cubiertas: pedido.entregas_cubiertas || 0,
    entregas_cumplidas: pedido.entregas_cumplidas || 0,
  };
}

/**
 * Qué escribir para destrabar las entregas de UN pedido.
 *
 * @param {Object} params
 * @param {Object} params.pedido
 * @param {Array} params.entregas todas las del pedido
 * @param {Array} params.despachos todos los del pedido
 * @param {Date} params.ahora
 * @param {{uid: string, nombre: string}} params.usuario
 * @returns {{aplica: boolean, entregas: Array, pedido: Object|null, historial: Array}}
 *   `entregas`: `[{ id, numero, estadoAnterior, campos }]`. Con `aplica: false`
 *   no hay nada que escribir.
 */
function armarReparacionEntregas({ pedido, entregas, despachos, ahora, usuario }) {
  if (!(ahora instanceof Date) || Number.isNaN(ahora.getTime())) {
    throw new Error('armarReparacionEntregas: `ahora` tiene que ser un Date válido.');
  }
  const sinCambios = { aplica: false, entregas: [], pedido: null, historial: [] };

  if (pedido.suspendido) return sinCambios;

  const listaEntregas = entregas || [];
  const trabadas = listaEntregas.filter(e => entregaTrabada(e, despachos));
  if (trabadas.length === 0) return sinCambios;

  const idsTrabadas = new Set(trabadas.map(e => e.id));
  const nombreUsuario = usuario.nombre || usuario.email || 'Sin identificar';

  const cambiosEntregas = trabadas.map(e => ({
    id: e.id,
    numero: e.numero != null ? e.numero : null,
    estadoAnterior: e.estado,
    campos: { estado: ENTREGA.CUMPLIDA, estado_ts: ahora, actualizado_en: ahora },
  }));

  // Recontado desde las entregas resultantes, no con increment: mismo criterio
  // que `verificar-contadores.js`.
  const contadores = recontarContadores(
    listaEntregas.map(e => (idsTrabadas.has(e.id) ? { ...e, estado: ENTREGA.CUMPLIDA } : e))
  );

  const historial = trabadas.map(e => ({
    entidad_tipo: 'entrega',
    entidad_id: e.id,
    pedido_id: pedido.id,
    accion: 'recalcular_estado',
    campos_modificados: ['estado'],
    antes: { estado: e.estado },
    despues: { estado: ENTREGA.CUMPLIDA },
    usuario_uid: usuario.uid,
    usuario_nombre: nombreUsuario,
    razon: RAZON,
    derivado: false,
    ts: ahora,
  }));

  const antes = antesContadores(pedido);
  const camposCambiados = Object.keys(contadores).filter(k => contadores[k] !== antes[k]);
  if (camposCambiados.length > 0) {
    const antesCambio = {};
    const despuesCambio = {};
    camposCambiados.forEach(k => { antesCambio[k] = antes[k]; despuesCambio[k] = contadores[k]; });
    historial.push({
      entidad_tipo: 'pedido',
      entidad_id: pedido.id,
      pedido_id: pedido.id,
      accion: 'recalcular_contadores',
      campos_modificados: camposCambiados,
      antes: antesCambio,
      despues: despuesCambio,
      usuario_uid: usuario.uid,
      usuario_nombre: nombreUsuario,
      razon: RAZON,
      derivado: true,
      ts: ahora,
    });
  }

  return {
    aplica: true,
    entregas: cambiosEntregas,
    pedido: { ...contadores, actualizado_en: ahora },
    historial,
  };
}

/**
 * Viajes abiertos sin `entrega_id`, y qué `entrega_id` ponerles.
 *
 * @param {Object} params
 * @param {Array} params.viajes todos los viajes
 * @param {Array} params.despachos todos los despachos
 * @returns {{completar: Array<{id: string, pedidoId: string, despachoId: string, entregaId: string}>,
 *            sinResolver: Array<{id: string, pedidoId: string, motivo: string}>}}
 */
function armarCompletarEntregaId({ viajes, despachos }) {
  const despachoPorId = new Map((despachos || []).map(d => [d.id, d]));
  const completar = [];
  const sinResolver = [];

  for (const v of (viajes || [])) {
    if (!viajeAbierto(v) || v.entrega_id) continue;

    const d = despachoPorId.get(v.despacho_id);
    if (!d) {
      sinResolver.push({ id: v.id, pedidoId: v.pedido_id, motivo: 'el despacho del viaje no existe' });
    } else if (!d.entrega_id) {
      sinResolver.push({ id: v.id, pedidoId: v.pedido_id, motivo: 'el despacho no tiene entrega_id' });
    } else {
      completar.push({ id: v.id, pedidoId: v.pedido_id, despachoId: d.id, entregaId: d.entrega_id });
    }
  }

  return { completar, sinResolver };
}

module.exports = {
  armarReparacionEntregas,
  armarCompletarEntregaId,
  entregaTrabada,
  RAZON,
};
