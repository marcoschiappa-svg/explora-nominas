/* =============================================================================
 * logica-cierre-administrativo.js — v1.2.3 (cierre administrativo de pedidos)
 * =============================================================================
 *
 * SÍNTOMA
 *   Hay pedidos del modelo nuevo que en la realidad ya se cumplieron (todas sus
 *   entregas son anteriores al 15/10/2026) pero en el portal quedaron abiertos:
 *   entregas `pendiente` o `programada`, despachos `ASIGNADO`/`ACEPTADO`/
 *   `NOMINADO`, viajes `RECIBIDO`/`EN_VIAJE` que nadie cerró. Contaminan las
 *   bandejas de Programación ("Viajes abiertos vencidos", "Sin cubrir") y los
 *   contadores del pedido. Además, los pedidos que se migran desde
 *   `pedidos_portal` (ver `logica-migracion-legacy.js`) tienen que quedar
 *   cerrados sin importar la fecha.
 *
 * CAUSA RAÍZ
 *   No existe ninguna acción que cierre un pedido entero. Las acciones del
 *   portal mueven UN despacho por vez (`finalizarViaje()`, `cancelarDespacho()`)
 *   y exigen datos que en estos casos no se tienen (una hora de llegada real,
 *   un chofer que confirme). No hay forma de decir "este pedido ya pasó".
 *
 * ALCANCE
 *   `armarCierreAdministrativo()` es una función PURA: recibe el árbol del
 *   pedido ya leído y devuelve QUÉ escribir; no lee ni escribe Firestore y no
 *   tiene reloj propio (`ahora` es parámetro). La escritura la hace el script
 *   que la llame (`cerrar-pedidos-anteriores.js`, `migrar-pedidos-legacy.js`).
 *
 *   Cascada (en este orden):
 *     1. Viajes abiertos (`RECIBIDO`/`EN_VIAJE`) de despachos que pasan a
 *        `ENTREGADO` pasan a `FINALIZADO` con los mismos campos que `finalizarViaje()` en un
 *        cierre manual (`cerrado_por: 'manual'`, `cierre_motivo`, `estado_ts`),
 *        con dos diferencias: `fin_ts` queda en `null` (no se inventa una hora
 *        de llegada: `logica-ciclo-vida.js` ya muestra "Sin registro") y se
 *        agrega `cierre_administrativo: true`.
 *     2. y 3. TODO despacho vivo que no esté `ENTREGADO` (`PENDIENTE_ASIGNACION`,
 *        `ASIGNADO`, `ACEPTADO`, `NOMINADO` con o sin viaje) pasa a `ENTREGADO`,
 *        con `estado_ts`, `cierre_administrativo: true` y `cierre_motivo`. No se
 *        inventa un viaje. `RECHAZADO`, `CANCELADO` y `ENTREGADO` no se tocan.
 *        (Ver "v1.2.3, prompt 3" más abajo: antes los vivos sin viaje se
 *        cancelaban.)
 *     4. Entregas no suspendidas y no cumplidas pasan a `cumplida`, con
 *        `cierre_administrativo: true`.
 *     5. Pedido: los tres contadores se RECUENTAN desde las entregas
 *        resultantes (mismo criterio que `verificar-contadores.js`, nunca con
 *        increment) y se agrega `cierre_administrativo`, `cierre_motivo` y
 *        `cierre_ts`. `estadoPedido()` sobre el resultado da `cumplido`.
 *     6. Historial: UN registro `cierre_administrativo` sobre el pedido, con el
 *        formato de `armarHistorial()` (`shared/datos.js`).
 *
 *   También exporta `evaluarCorte()`: la regla de "¿todo el pedido es anterior
 *   a la fecha de corte?" que usa `cerrar-pedidos-anteriores.js`.
 *
 *   NO aplica (devuelve `aplica: false`, sin escrituras) si el pedido está
 *   suspendido, ya está cumplido según `estadoPedido()`, o todas sus entregas
 *   están suspendidas (con `entregas_total` en 0 `estadoPedido()` da
 *   `pendiente` y no hay forma de cerrarlo por contadores).
 *
 * v1.2.3 (prompt 3) — LOS DESPACHOS VIVOS PASAN A `ENTREGADO`, NO A `CANCELADO`
 *
 *   SÍNTOMA
 *     La simulación en producción mostró que NINGUNO de los 61 pedidos a cerrar
 *     tiene viaje: los despachos quedaron aceptados o asignados y nadie nominó
 *     en el portal. Con el criterio anterior, todos esos despachos terminaban
 *     `CANCELADO`, cuando en la realidad el camión fue.
 *
 *   CAUSA RAÍZ
 *     El cierre trataba "sin viaje" como "no pasó". Pero un despacho sin viaje
 *     no significa que no se haya entregado: significa que el portal no
 *     registró la nominación. Dejaba mal el ciclo de vida y cualquier reporte
 *     que cuente despachos; además contradice `estadoEntrega()`
 *     (`shared/estados.js`), que con todos los despachos cancelados deriva
 *     `pendiente`, no `cumplida`.
 *
 *   ALCANCE
 *     Todo despacho vivo que no está `ENTREGADO` pasa a `ENTREGADO` (con
 *     `estado_ts`, `cierre_administrativo: true` y `cierre_motivo`). Los viajes
 *     abiertos se siguen cerrando igual (`FINALIZADO`, `fin_ts: null`,
 *     `cierre_administrativo`); se cierran los de todo despacho que pasa a
 *     `ENTREGADO`, no solo los de los `NOMINADO`. Las entregas sin ningún
 *     despacho siguen pasando a `cumplida` con `cierre_administrativo: true`.
 *     Con esto `estadoEntrega()` sobre los despachos resultantes da `cumplida`
 *     para toda entrega que tenga algún despacho vivo (lo verifica el test de
 *     paridad). El historial ya no lleva `despachos_cancelados`: lleva
 *     `despachos_entregados`. La suspensión de los pedidos migrados
 *     (`aplicarSuspensionAlArbol()` de `logica-migracion-legacy.js`) NO
 *     cambia: ahí cancelar es lo correcto.
 *
 *   LIMITACIONES CONOCIDAS
 *     Una entrega cuyos únicos despachos son `RECHAZADO`/`CANCELADO` pasa a
 *     `cumplida` por el cierre aunque `estadoEntrega()` derive `pendiente` de
 *     sus despachos: el cierre no resucita despachos muertos.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- logica-cierre-administrativo`.
 *
 * UBICACIÓN Y COPIAS LOCALES
 *   Vive en `src/` y en CommonJS por el mismo motivo que `mapa-normalizacion.js`:
 *   lo usan los scripts de Node (`require`) y jest. Por eso NO puede importar
 *   `shared/estados.js` (ES module, compartido con TrackEx). Lleva COPIAS
 *   locales de `DESPACHO`, `VIAJE`, `ENTREGA`, `estadoPedido()`,
 *   `despachoVivo()` y `viajeAbierto()`. `logica-cierre-administrativo.test.js`
 *   tiene pruebas de paridad contra los originales: si alguien cambia
 *   `estados.js`, el test rompe.
 *
 * LIMITACIONES CONOCIDAS
 *   - Un despacho `ENTREGADO` por el cierre y SIN viaje no tiene más registro de
 *     la entrega que `cierre_administrativo`: el ciclo de vida lo muestra
 *     aclarando que no hay hora de llegada registrada.
 *   - Un despacho cuyo único viaje ya estaba `FINALIZADO` o `CANCELADO` pasa a
 *     `ENTREGADO` sin tocar el viaje (se respeta lo que ya dice el viaje).
 *   - El cierre no avisa a nadie: no escribe `avisos`, no manda mails ni toca
 *     el Plan de Producción.
 *   - `usuario.uid` va tal cual al historial; las reglas de Firestore exigen
 *     que sea el del que escribe, pero los scripts usan `firebase-admin` y no
 *     pasan por las reglas.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- logica-cierre-administrativo`: mezcla de entregas,
 *   viajes `EN_VIAJE` y `RECIBIDO`, despachos sin viaje, los tres casos de "no
 *   aplica", despachos muertos intactos, `estadoPedido() === 'cumplido'` en todo
 *   caso que aplica, `evaluarCorte()`, y paridad con `estados.js`.
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * Copias locales de `portal/src/shared/estados.js`
 * -------------------------------------------------------------------------- */

// 1. Copia de `DESPACHO` (estados.js). Paridad verificada en el test.
const DESPACHO = {
  PENDIENTE_ASIGNACION: 'PENDIENTE_ASIGNACION',
  ASIGNADO: 'ASIGNADO',
  ACEPTADO: 'ACEPTADO',
  NOMINADO: 'NOMINADO',
  ENTREGADO: 'ENTREGADO',
  RECHAZADO: 'RECHAZADO',
  CANCELADO: 'CANCELADO',
};

// 2. Copia de `VIAJE` (estados.js).
const VIAJE = {
  RECIBIDO: 'RECIBIDO',
  EN_VIAJE: 'EN_VIAJE',
  FINALIZADO: 'FINALIZADO',
  CANCELADO: 'CANCELADO',
};

// 3. Copia de `ENTREGA` (estados.js).
const ENTREGA = {
  PENDIENTE: 'pendiente',
  PROGRAMADA: 'programada',
  CUMPLIDA: 'cumplida',
  SUSPENDIDA: 'suspendida',
};

// 4. Copia de `PEDIDO` (estados.js): solo los valores que usa `estadoPedido()`.
const PEDIDO = {
  PENDIENTE: 'pendiente',
  PROGRAMADO_PARCIAL: 'programado_parcial',
  PROGRAMADO: 'programado',
  CUMPLIDO: 'cumplido',
  SUSPENDIDO: 'suspendido',
};

// 5. Copia de `DESPACHOS_MUERTOS` y `despachoVivo()` (estados.js).
const DESPACHOS_MUERTOS = [DESPACHO.RECHAZADO, DESPACHO.CANCELADO];

function despachoVivo(d) {
  return !!d && !DESPACHOS_MUERTOS.includes(d.estado);
}

// 6. Copia de `viajeAbierto()` (estados.js).
function viajeAbierto(viaje) {
  return !!viaje && (viaje.estado === VIAJE.RECIBIDO || viaje.estado === VIAJE.EN_VIAJE);
}

// 7. Copia de `estadoPedido()` (estados.js): se deriva de los tres contadores.
function estadoPedido(pedido) {
  if (!pedido) return PEDIDO.PENDIENTE;
  if (pedido.suspendido) return PEDIDO.SUSPENDIDO;

  const total = pedido.entregas_total || 0;
  const cubiertas = pedido.entregas_cubiertas || 0;
  const cumplidas = pedido.entregas_cumplidas || 0;

  if (total === 0) return PEDIDO.PENDIENTE;
  if (cumplidas === total) return PEDIDO.CUMPLIDO;
  if (cubiertas === 0) return PEDIDO.PENDIENTE;
  if (cubiertas === total) return PEDIDO.PROGRAMADO;
  return PEDIDO.PROGRAMADO_PARCIAL;
}

/* -----------------------------------------------------------------------------
 * Recuento de contadores
 * -------------------------------------------------------------------------- */

/**
 * 8. Mismo criterio que `recontar()` de `scripts/verificar-contadores.js`:
 *    total = entregas no suspendidas; cubiertas = `programada` o `cumplida`;
 *    cumplidas = `cumplida`.
 */
function recontarContadores(entregas) {
  const vivas = (entregas || []).filter(e => e.estado !== ENTREGA.SUSPENDIDA);
  return {
    entregas_total: vivas.length,
    entregas_cubiertas: vivas.filter(e => e.estado === ENTREGA.PROGRAMADA || e.estado === ENTREGA.CUMPLIDA).length,
    entregas_cumplidas: vivas.filter(e => e.estado === ENTREGA.CUMPLIDA).length,
  };
}

/* -----------------------------------------------------------------------------
 * Cierre administrativo
 * -------------------------------------------------------------------------- */

/** Códigos de `codigoNoAplica`, para que los scripts distingan los casos. */
const NO_APLICA = {
  SUSPENDIDO: 'suspendido',
  YA_CUMPLIDO: 'ya_cumplido',
  SIN_ENTREGAS_ACTIVAS: 'sin_entregas_activas',
};

function sinCambios(codigo, razon) {
  return {
    aplica: false,
    razonNoAplica: razon,
    codigoNoAplica: codigo,
    pedido: {},
    entregas: [],
    despachos: [],
    viajes: [],
    historial: [],
  };
}

/**
 * Arma el cierre administrativo de UN pedido. No escribe nada.
 *
 * @param {Object} params
 * @param {Object} params.pedido `{ id, ...campos }` con sus contadores
 * @param {Array} params.entregas `[{ id, ...campos }]` TODAS las del pedido
 * @param {Array} params.despachos `[{ id, ...campos }]` TODOS los del pedido
 * @param {Array} params.viajes `[{ id, despacho_id, ...campos }]` los de esos despachos
 * @param {string} params.motivo texto que queda en `cierre_motivo`, en la
 *   `cierre_motivo` de los despachos y en el historial
 * @param {Date} params.ahora instante del cierre (`Date`); `firebase-admin` lo
 *   guarda como `Timestamp`
 * @param {{uid: string, nombre: string}} params.usuario
 * @returns {{aplica: boolean, razonNoAplica: string|null, codigoNoAplica: string|null,
 *   pedido: Object, entregas: Array, despachos: Array, viajes: Array, historial: Array}}
 */
function armarCierreAdministrativo({ pedido, entregas, despachos, viajes, motivo, ahora, usuario }) {
  if (!(ahora instanceof Date) || Number.isNaN(ahora.getTime())) {
    throw new Error('armarCierreAdministrativo: `ahora` tiene que ser un Date válido.');
  }
  if (!motivo || !String(motivo).trim()) {
    throw new Error('armarCierreAdministrativo: el motivo es obligatorio.');
  }
  const listaEntregas = entregas || [];
  const listaDespachos = despachos || [];
  const listaViajes = viajes || [];

  /* ── Cuándo NO aplica ────────────────────────────────────────────────────── */

  // 9. Suspendido: es terminal, no se reabre ni se "cumple".
  if (pedido.suspendido) {
    return sinCambios(NO_APLICA.SUSPENDIDO, 'El pedido está suspendido.');
  }
  // 10. Ya cumplido según los contadores: no hay nada que cerrar.
  if (estadoPedido(pedido) === PEDIDO.CUMPLIDO) {
    return sinCambios(NO_APLICA.YA_CUMPLIDO, 'El pedido ya está cumplido.');
  }
  // 11. Sin entregas activas: con `entregas_total` en 0 el estado nunca llega a
  //     `cumplido`, así que no hay cierre posible por contadores.
  const entregasActivas = listaEntregas.filter(e => e.estado !== ENTREGA.SUSPENDIDA);
  if (entregasActivas.length === 0) {
    return sinCambios(
      NO_APLICA.SIN_ENTREGAS_ACTIVAS,
      'Todas las entregas del pedido están suspendidas (o no tiene entregas).'
    );
  }

  /* ── 1, 2 y 3. Viajes y despachos ───────────────────────────────────────── */

  const cambiosViajes = [];
  const cambiosDespachos = [];
  let despachosEntregados = 0;

  for (const d of listaDespachos) {
    // 12. Los muertos (RECHAZADO/CANCELADO) y los ya ENTREGADO no se tocan.
    if (d.estado === DESPACHO.RECHAZADO || d.estado === DESPACHO.CANCELADO
        || d.estado === DESPACHO.ENTREGADO) continue;

    // 13. Los viajes abiertos del despacho -> FINALIZADO, como
    //     `finalizarViaje()` manual pero con `fin_ts: null` y
    //     `cierre_administrativo: true`. Se cierran los de TODO despacho que
    //     pasa a ENTREGADO: dejar abierto el viaje de un despacho entregado
    //     sería un dato inconsistente.
    const susViajes = listaViajes.filter(v => v.despacho_id === d.id
      || (d.viaje_id && v.id === d.viaje_id));
    for (const v of susViajes.filter(viajeAbierto)) {
      cambiosViajes.push({
        id: v.id,
        campos: {
          estado: VIAJE.FINALIZADO,
          estado_ts: ahora,
          fin_ts: null,
          cerrado_por: 'manual',
          cierre_motivo: motivo,
          cierre_administrativo: true,
          actualizado_en: ahora,
        },
      });
    }

    // 14. v1.2.3 (prompt 3): TODO despacho vivo que no está ENTREGADO pasa a
    //     ENTREGADO -- con o sin viaje, en cualquier estado vivo. El camión
    //     fue; que el portal no lo haya registrado no es que no haya pasado.
    cambiosDespachos.push({
      id: d.id,
      campos: {
        estado: DESPACHO.ENTREGADO,
        estado_ts: ahora,
        cierre_administrativo: true,
        cierre_motivo: motivo,
        actualizado_en: ahora,
      },
    });
    despachosEntregados++;
  }

  /* ── 4. Entregas ─────────────────────────────────────────────────────────── */

  const cambiosEntregas = [];
  const entregasResultantes = listaEntregas.map(e => {
    if (e.estado === ENTREGA.SUSPENDIDA || e.estado === ENTREGA.CUMPLIDA) return e;
    cambiosEntregas.push({
      id: e.id,
      campos: { estado: ENTREGA.CUMPLIDA, cierre_administrativo: true, actualizado_en: ahora },
    });
    return { ...e, estado: ENTREGA.CUMPLIDA };
  });

  /* ── 5. Pedido ───────────────────────────────────────────────────────────── */

  // 16. Recontado desde las entregas resultantes, no con increment.
  const contadores = recontarContadores(entregasResultantes);
  const camposPedido = {
    ...contadores,
    cierre_administrativo: true,
    cierre_motivo: motivo,
    cierre_ts: ahora,
    actualizado_en: ahora,
  };

  /* ── 6. Historial ────────────────────────────────────────────────────────── */

  // 17. UN solo registro, no uno por documento hijo. Mismos campos que
  //     `armarHistorial()` (shared/datos.js); `ts` es `ahora` en vez de
  //     `serverTimestamp()` porque acá no hay cliente de Firestore.
  const antesContadores = {
    entregas_total: pedido.entregas_total || 0,
    entregas_cubiertas: pedido.entregas_cubiertas || 0,
    entregas_cumplidas: pedido.entregas_cumplidas || 0,
  };
  const despues = {};
  const antes = {};
  for (const k of Object.keys(contadores)) {
    if (contadores[k] !== antesContadores[k]) {
      despues[k] = contadores[k];
      antes[k] = antesContadores[k];
    }
  }
  despues.cierre_administrativo = true;
  antes.cierre_administrativo = pedido.cierre_administrativo === true;
  despues.cierre_motivo = motivo;
  antes.cierre_motivo = pedido.cierre_motivo || null;
  const camposModificados = Object.keys(despues);

  // Resumen de lo que cambió cada paso. No son campos del pedido: van aparte
  // de `campos_modificados` para que esa lista siga sirviendo al
  // `array-contains` del historial.
  despues.resumen = {
    viajes_finalizados: cambiosViajes.length,
    despachos_entregados: despachosEntregados,
    entregas_cumplidas_por_cierre: cambiosEntregas.length,
  };
  antes.resumen = null;

  const historial = [{
    entidad_tipo: 'pedido',
    entidad_id: pedido.id,
    pedido_id: pedido.id,
    accion: 'cierre_administrativo',
    campos_modificados: camposModificados,
    antes,
    despues,
    usuario_uid: usuario.uid,
    usuario_nombre: usuario.nombre || usuario.email || 'Sin identificar',
    razon: motivo,
    derivado: false,
    ts: ahora,
  }];

  return {
    aplica: true,
    razonNoAplica: null,
    codigoNoAplica: null,
    pedido: camposPedido,
    entregas: cambiosEntregas,
    despachos: cambiosDespachos,
    viajes: cambiosViajes,
    historial,
  };
}

/* -----------------------------------------------------------------------------
 * Fecha de corte
 * -------------------------------------------------------------------------- */

/**
 * ¿Todo lo que sigue vivo en el pedido es anterior a `corte`?
 *
 * 18. Se cumple si TODAS las entregas no suspendidas tienen
 *     `fecha_solicitada < corte` y TODOS los despachos vivos (incluidos los
 *     `ENTREGADO`) tienen `fecha_carga < corte`. Las fechas son strings
 *     `YYYY-MM-DD` y se comparan como string.
 * 19. Una fecha faltante o con otro formato NO cumple: sin fecha no se puede
 *     afirmar que sea anterior, y un string vacío compararía como "menor".
 *
 * @param {Object} params
 * @param {Array} params.entregas
 * @param {Array} params.despachos
 * @param {string} params.corte `YYYY-MM-DD`
 * @returns {{cumple: boolean, bloqueos: Array<{tipo: string, id: string, numero: *, fecha: string|null, motivo: string}>}}
 */
function evaluarCorte({ entregas, despachos, corte }) {
  const FORMATO = /^\d{4}-\d{2}-\d{2}$/;
  const bloqueos = [];

  for (const e of (entregas || [])) {
    if (e.estado === ENTREGA.SUSPENDIDA) continue;
    const f = e.fecha_solicitada;
    if (!FORMATO.test(f || '')) {
      bloqueos.push({ tipo: 'entrega', id: e.id, numero: e.numero, fecha: f || null, motivo: 'sin fecha válida' });
    } else if (!(f < corte)) {
      bloqueos.push({ tipo: 'entrega', id: e.id, numero: e.numero, fecha: f, motivo: `fecha solicitada ${f} no es anterior al corte` });
    }
  }

  for (const d of (despachos || []).filter(despachoVivo)) {
    const f = d.fecha_carga;
    if (!FORMATO.test(f || '')) {
      bloqueos.push({ tipo: 'despacho', id: d.id, numero: d.numero, fecha: f || null, motivo: 'sin fecha de carga válida' });
    } else if (!(f < corte)) {
      bloqueos.push({ tipo: 'despacho', id: d.id, numero: d.numero, fecha: f, motivo: `fecha de carga ${f} no es anterior al corte` });
    }
  }

  return { cumple: bloqueos.length === 0, bloqueos };
}

module.exports = {
  armarCierreAdministrativo,
  evaluarCorte,
  recontarContadores,
  estadoPedido,
  despachoVivo,
  viajeAbierto,
  NO_APLICA,
  DESPACHO,
  VIAJE,
  ENTREGA,
  PEDIDO,
};
