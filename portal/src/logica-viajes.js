/* =============================================================================
 * logica-viajes.js — Iniciar, demorar, finalizar y el GPS
 * =============================================================================
 *
 * QUE ES
 *   Lo que el chofer hace sobre su viaje, y cómo se registran los puntos de
 *   GPS. Lo usan la pantalla del portal y —cuando se publique— la app.
 *
 * -----------------------------------------------------------------------------
 * EL CIERRE ES EN CASCADA
 * -----------------------------------------------------------------------------
 *   Finalizar un viaje escribe CUATRO documentos: el viaje, su despacho, su
 *   entrega y el pedido. Por eso va en transacción: si el viaje se cerrara y el
 *   despacho no, quedarían diciendo cosas distintas.
 *
 *   Ese empujón del viaje al despacho es lo que hoy no existe. El chofer
 *   finaliza, `estado_chofer` pasa a "finalizado", y `estado` del despacho
 *   sigue diciendo "Nominado" para siempre. Es el defecto que hace que el
 *   coordinador no sepa si el camión entregó.
 *
 * -----------------------------------------------------------------------------
 * LA DEMORA NO ES UN ESTADO
 * -----------------------------------------------------------------------------
 *   Es un atributo del viaje: el camión sigue andando, va tarde. Queda marcado
 *   hasta el final como información, no como semáforo.
 *
 *   Hoy está metida como estado, y por eso `Transportista.js` tiene que filtrar
 *   con `['iniciado','demorado'].includes(...)` — un `includes` que existe solo
 *   porque el modelo confunde una cosa con la otra.
 *
 * -----------------------------------------------------------------------------
 * LA CLAVE DE CADA PUNTO ES SU TIMESTAMP
 * -----------------------------------------------------------------------------
 *   No autogenerada. Vuelve idempotente la escritura: si un lote se reenvía por
 *   un reintento o porque el buffer se vació dos veces, cada punto cae en la
 *   misma clave en vez de duplicarse.
 *
 *   (Los duplicados que se ven hoy en los datos son de otra causa: dos
 *   suscripciones de ubicación activas a la vez en la app, pasando la misma
 *   lectura con timestamps a milisegundos de distancia. Eso se arregla allá.)
 * ========================================================================== */

import { doc, collection, serverTimestamp, writeBatch, increment } from 'firebase/firestore';
import { db } from './firebase';
import { enTransaccion, calcularDiferencias } from './datos';
import { DESPACHO, VIAJE, deltaContadores, viajeAbierto } from './estados';

/* -----------------------------------------------------------------------------
 * v1.2.0 (RF-02) — VALIDACIÓN DEL CIERRE MANUAL
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El cierre manual (`confirmarCerrarManual` en `Programacion.js`) pedía
 *     el motivo con `window.prompt` y nada más: sin fecha de fin propia
 *     (quedaba `serverTimestamp()`, "ahora"), sin forma de corregir un
 *     motivo equivocado, y sin ninguna validación de que ese "ahora" tuviera
 *     sentido contra la fecha de carga o el inicio del viaje.
 *
 *   CAUSA RAÍZ
 *     `finalizarViaje()` ya recibía `finTsManual` para escribir `fin_ts`,
 *     pero ningún lado -- ni la pantalla, ni esta función -- validaba ese
 *     valor. La regla "la validación vive en la lógica, no en la pantalla"
 *     (ver el resto de este archivo) no se cumplía para el cierre manual.
 *
 *   ALCANCE
 *     `validarCierreManual()` es pura -- sin Firestore, para poder testearla
 *     y para que `ModalCierreManual.js` la corra ANTES de guardar, con el
 *     mismo criterio que después revalida `finalizarViaje()` -- ver más
 *     abajo, dentro de la transacción, sobre el viaje RELEÍDO. Tres chequeos:
 *     fin no futuro (5 minutos de tolerancia, por el reloj del celular/PC),
 *     fin no anterior a `fechaCarga` menos un día (fechas LOCALES
 *     `YYYY-MM-DD`, mismo criterio que `filtros-listado.js`), y si el viaje
 *     ya tiene `inicio_ts`, fin estrictamente posterior.
 *
 *   LIMITACIONES CONOCIDAS
 *     La tolerancia de 5 minutos es fija, no configurable. Un reloj muy
 *     desincronizado igual puede colarse dentro de esa ventana.
 *
 *   CÓMO SE VERIFICA
 *     Casos en `logica-viajes.test.js` (o el archivo de tests que corresponda):
 *     futuro con y sin tolerancia, borde de fecha de carga menos un día, con
 *     y sin `inicio_ts`. Manualmente: un cierre manual con fin dos días antes
 *     de la fecha de carga, o con fin en el futuro, no deja guardar -- ni
 *     desde el modal ni si se lo fuerza saltando el modal.
 * -------------------------------------------------------------------------- */

const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

/** "2026-09-14" -> "2026-09-13". Mismo criterio LOCAL que `filtros-listado.js`
 * (no se reusa esa función: este archivo no puede depender de una que a su
 * vez no importa nada de Firestore por diseño, y viceversa -- dos archivos
 * de lógica pura, cada uno autosuficiente). */
function unDiaAntes(fechaISO) {
  const d = new Date(`${fechaISO}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function aFechaISOLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * Valida la fecha de fin de un cierre manual. Devuelve un array de mensajes
 * -- vacío si está todo bien.
 *
 * 1. `finTs` NO puede ser futuro, con 5 minutos de tolerancia -- el reloj del
 *    dispositivo que arma el `Date` no siempre coincide al segundo con el del
 *    servidor.
 * 2. `finTs` no puede ser anterior a `fechaCarga` menos un día -- un viaje no
 *    se cierra antes de que el camión pudiera haber cargado.
 * 3. Si el viaje ya tiene `inicioTs`, `finTs` tiene que ser estrictamente
 *    posterior: no se puede cerrar un viaje antes de que arrancó.
 *
 * @param {Object} params
 * @param {Date} params.finTs
 * @param {string|null} params.fechaCarga `YYYY-MM-DD`, del despacho/viaje
 * @param {*} params.inicioTs `inicio_ts` del viaje -- Timestamp de Firestore,
 *   `Date`, o `null`/`undefined` si el viaje nunca arrancó
 * @param {Date} [params.ahora] inyectable para los tests
 * @returns {string[]}
 */
export function validarCierreManual({ finTs, fechaCarga, inicioTs, ahora }) {
  const mensajes = [];

  if (!finTs || Number.isNaN(finTs.getTime())) {
    return ['Elegí la fecha y hora de fin.'];
  }

  const ahoraDate = ahora || new Date();

  if (finTs.getTime() > ahoraDate.getTime() + TOLERANCIA_FUTURO_MS) {
    mensajes.push('La fecha y hora de fin no puede ser futura.');
  }

  if (fechaCarga) {
    const piso = unDiaAntes(fechaCarga);
    if (aFechaISOLocal(finTs) < piso) {
      mensajes.push(`La fecha de fin no puede ser anterior a ${piso} (un día antes de la fecha de carga).`);
    }
  }

  if (inicioTs) {
    const inicioDate = inicioTs.toDate ? inicioTs.toDate() : new Date(inicioTs);
    if (finTs.getTime() <= inicioDate.getTime()) {
      mensajes.push('La fecha de fin tiene que ser posterior al inicio del viaje.');
    }
  }

  return mensajes;
}

/* -----------------------------------------------------------------------------
 * Iniciar
 * -------------------------------------------------------------------------- */

/**
 * El chofer arranca el viaje.
 *
 * NO toca el despacho: sigue en `NOMINADO` hasta que el viaje se cierre. Son
 * dos ciclos distintos —el compromiso administrativo y el camión andando— y ahí
 * está la separación.
 *
 * `inicio_origen` distingue si la posición es real o la última conocida. Si el
 * chofer arranca sin señal, queda registrado que ese punto no es confiable.
 *
 * @param {Object} params
 * @param {Object} params.viaje
 * @param {Object|null} params.posicion { lat, lng, precision, origen }
 * @param {Array} params.misViajes para verificar que no tenga otro en curso
 */
export async function iniciarViaje({ viaje, posicion, misViajes, usuario }) {
  // Hoy nada impide que un chofer tenga dos viajes iniciados a la vez. Con dos
  // en curso, los puntos de GPS de uno se mezclarían con los del otro.
  const otroEnCurso = (misViajes || []).find(v =>
    v.id !== viaje.id && v.estado === VIAJE.EN_VIAJE);

  if (otroEnCurso) {
    throw new Error(
      'Ya tenés un viaje en curso. Cerralo antes de arrancar otro.'
    );
  }

  return enTransaccion(async (tx, anotar) => {
    const ref = doc(db, 'viajes', viaje.id);
    const snap = await tx.get(ref);

    if (!snap.exists()) throw new Error('El viaje ya no existe. Actualizá la página.');
    const actual = { id: viaje.id, ...snap.data() };

    if (actual.estado !== VIAJE.RECIBIDO) {
      throw new Error(
        actual.estado === VIAJE.EN_VIAJE
          ? 'Este viaje ya está iniciado.'
          : `Este viaje está ${actual.estado} y no se puede iniciar.`
      );
    }

    const cambios = {
      estado: VIAJE.EN_VIAJE,
      estado_ts: serverTimestamp(),
      inicio_ts: serverTimestamp(),
      inicio_lat: posicion ? posicion.lat : null,
      inicio_lng: posicion ? posicion.lng : null,
      inicio_precision: posicion ? posicion.precision : null,
      inicio_origen: posicion ? (posicion.origen || 'actual') : 'sin_senal',
      ultima_lat: posicion ? posicion.lat : null,
      ultima_lng: posicion ? posicion.lng : null,
      ultima_ts: posicion ? serverTimestamp() : null,
      actualizado_en: serverTimestamp(),
    };

    tx.update(ref, cambios);

    anotar({
      entidadTipo: 'viaje',
      entidadId: viaje.id,
      pedidoId: actual.pedido_id,
      accion: 'iniciar_viaje',
      diferencias: calcularDiferencias(actual, cambios),
      usuario,
    });

    return { ok: true };
  }, 1);
}

/* -----------------------------------------------------------------------------
 * Reportar demora
 * -------------------------------------------------------------------------- */

/**
 * El chofer avisa que va tarde.
 *
 * NO cambia el estado. Y queda marcado hasta el final: es información del
 * viaje, no un semáforo que se apaga cuando el camión se recupera.
 */
export async function reportarDemora({ viaje, motivo, usuario }) {
  if (!motivo || !motivo.trim()) {
    throw new Error('Contá qué pasó para que el coordinador sepa.');
  }

  return enTransaccion(async (tx, anotar) => {
    const ref = doc(db, 'viajes', viaje.id);
    const snap = await tx.get(ref);

    if (!snap.exists()) throw new Error('El viaje ya no existe. Actualizá la página.');
    const actual = { id: viaje.id, ...snap.data() };

    if (actual.estado !== VIAJE.EN_VIAJE) {
      throw new Error('Solo se puede reportar una demora con el viaje en curso.');
    }

    const cambios = {
      demorado: true,
      demora_motivo: motivo.trim(),
      demora_ts: serverTimestamp(),
      actualizado_en: serverTimestamp(),
    };

    tx.update(ref, cambios);

    anotar({
      entidadTipo: 'viaje',
      entidadId: viaje.id,
      pedidoId: actual.pedido_id,
      accion: 'reportar_demora',
      diferencias: calcularDiferencias(actual, cambios),
      usuario,
      razon: motivo.trim(),
    });

    return { ok: true };
  }, 1);
}

/* -----------------------------------------------------------------------------
 * Finalizar
 * -------------------------------------------------------------------------- */

/**
 * Cierra el viaje y empuja el despacho a ENTREGADO.
 *
 * -----------------------------------------------------------------------------
 * SOLO TOCA LO QUE UN CHOFER PUEDE TOCAR
 * -----------------------------------------------------------------------------
 *   El chofer NO puede leer ni escribir `entregas`: las reglas lo dejan afuera
 *   por completo (`allow ...: if esInterno()`). Así que esta función YA NO
 *   recibe `entregas` ni `despachos` del pedido, y no intenta escribir el
 *   documento de la entrega.
 *
 *   Lo que SÍ hace, y lo que las reglas tienen que permitirle explícitamente:
 *
 *     viajes/{id}    estado -> FINALIZADO           (ya permitido: es su viaje)
 *     despachos/{id} estado NOMINADO -> ENTREGADO   (regla nueva, ver abajo)
 *     pedidos/{id}   entregas_cumplidas += 1         (regla nueva, ver abajo)
 *
 *   El paso de NOMINADO a ENTREGADO no cambia si la entrega está "cubierta"
 *   —los dos son estados vivos— así que el único contador que se mueve es
 *   `entregas_cumplidas`. `entregas_cubiertas` queda igual.
 *
 * -----------------------------------------------------------------------------
 * v2 (2026-09-18) — EL CIERRE MANUAL TAMBIÉN VALE DESDE `RECIBIDO`
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El botón "Cerrar viaje a mano" de `Programacion.js` nunca aparecía,
 *     ni con un despacho nominado y con chofer asignado desde hacía días.
 *
 *   CAUSA RAÍZ
 *     `puedeCerrarManual` (en `Programacion.js`) exigía `viaje.estado ===
 *     EN_VIAJE`, y esta función tiraba el mismo error para cualquier cosa
 *     que no fuera `EN_VIAJE` -- las dos condiciones coincidían entre sí,
 *     así que no era un desacople entre pantalla y función. El problema es
 *     que `EN_VIAJE` es un estado que, hoy, casi ningún viaje alcanza: el
 *     único lugar que lo escribe es `iniciarViaje()`, y esa función solo se
 *     llama desde `MisViajes.js`. Con la app TrackEx pausada y la pantalla
 *     vieja del chofer (`Chofer.js`, `App.js` módulo `chofer`) escribiendo
 *     únicamente en `pedidos_portal` -- una colección aparte, que esta
 *     función ni lee -- un despacho puede quedar nominado con chofer y
 *     patente puestos, y su viaje se queda en `RECIBIDO` para siempre: nadie
 *     tiene cómo avisarle a Firestore que arrancó.
 *
 *   ALCANCE
 *     El cierre MANUAL (`cerradoPor === 'manual'`) ahora vale desde
 *     `RECIBIDO` además de `EN_VIAJE` -- los dos estados que
 *     `viajeAbierto()` (`estados.js`) considera "todavía se puede cerrar".
 *     El cierre del CHOFER sigue exigiendo `EN_VIAJE` sin cambios: un chofer
 *     nunca debería poder "finalizar" un viaje que él mismo no inició -- ese
 *     botón ni le aparece en `MisViajes.js`.
 *
 *   LIMITACIONES CONOCIDAS
 *     Esto no arregla por qué los viajes no llegan a `EN_VIAJE` -- sigue
 *     siendo cierto que, mientras los choferes no usen `MisViajes.js`, la
 *     posición de inicio y los puntos de GPS de ese viaje van a quedar
 *     vacíos. Es a propósito: cerrar a mano nunca inventa un dato que no se
 *     tiene, ni de inicio ni de fin.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. Manualmente: un despacho
 *     NOMINADO cuyo viaje diga "RECIBIDO" (se ve en la propia tarjeta del
 *     despacho, en Programación) tiene que mostrar "Cerrar viaje a mano", y
 *     al confirmarlo con un motivo, el despacho pasa a ENTREGADO y el viaje
 *     queda "FINALIZADO (cerrado por Explora)" sin posición de fin.
 *
 * @param {Object} params
 * @param {Object} params.viaje
 * @param {Object} params.despacho { id } alcanza — no hace falta el documento
 *   completo, se relee dentro de la transacción
 * @param {Object|null} params.posicion
 * @param {string} params.cerradoPor 'chofer' | 'manual'
 * @param {string|null} params.motivo obligatorio si es manual
 * @param {string|null} params.finTsManual fecha y hora de fin, si es manual
 */
export async function finalizarViaje({
  viaje, despacho, posicion, cerradoPor = 'chofer', motivo = null, finTsManual = null, usuario,
}) {
  if (cerradoPor === 'manual' && (!motivo || !motivo.trim())) {
    throw new Error('El motivo del cierre manual es obligatorio.');
  }
  // 1. Antes se validaba solo el motivo -- `finTsManual` existía como
  //    parámetro y se usaba para escribir `fin_ts`, pero nunca se validaba.
  //    Ver el encabezado v1.2.0 (RF-02) más arriba.
  if (cerradoPor === 'manual' && !finTsManual) {
    throw new Error('La fecha y hora de fin son obligatorias.');
  }

  return enTransaccion(async (tx, anotar) => {
    /* ── Lecturas ────────────────────────────────────────────────────────── */

    const refViaje = doc(db, 'viajes', viaje.id);
    const refDespacho = doc(db, 'despachos', despacho.id);

    const [snapV, snapD] = await Promise.all([tx.get(refViaje), tx.get(refDespacho)]);

    if (!snapV.exists()) throw new Error('El viaje ya no existe. Actualizá la página.');
    if (!snapD.exists()) throw new Error('El despacho ya no existe. Actualizá la página.');

    const viajeActual = { id: viaje.id, ...snapV.data() };
    const despachoActual = { id: despacho.id, ...snapD.data() };

    // El chofer solo puede cerrar lo que él mismo inició -- sigue exigiendo
    // EN_VIAJE, sin cambios. El cierre manual acepta también RECIBIDO: ver
    // el encabezado v2 de más arriba.
    const estadoValido = cerradoPor === 'manual' ? viajeAbierto(viajeActual) : viajeActual.estado === VIAJE.EN_VIAJE;
    if (!estadoValido) {
      throw new Error(
        viajeActual.estado === VIAJE.RECIBIDO
          ? 'El viaje todavía no arrancó.'
          : `El viaje está ${viajeActual.estado} y no se puede cerrar.`
      );
    }

    // 2. El modal ya corrió esta misma validación antes de guardar -- se
    //    vuelve a correr acá, sobre el viaje RELEÍDO (`viajeActual`, no el
    //    que tenía la pantalla al abrir el modal), porque entre que se abrió
    //    el modal y se confirmó pudo haber pasado cualquier cosa. Ver el
    //    encabezado v1.2.0 (RF-02).
    if (cerradoPor === 'manual') {
      const problemas = validarCierreManual({
        finTs: new Date(finTsManual),
        fechaCarga: viajeActual.fecha_carga,
        inicioTs: viajeActual.inicio_ts,
      });
      if (problemas.length > 0) throw new Error(problemas.join(' '));
    }

    /* ── El viaje ────────────────────────────────────────────────────────── */

    const cambiosViaje = {
      estado: VIAJE.FINALIZADO,
      estado_ts: serverTimestamp(),
      fin_ts: finTsManual ? new Date(finTsManual) : serverTimestamp(),
      // Sin esto, un viaje sin posición de fin parece un viaje con el GPS roto:
      // no se sabe si el camión llegó o si alguien lo cerró desde el portal.
      cerrado_por: cerradoPor,
      cierre_motivo: motivo ? motivo.trim() : null,
      actualizado_en: serverTimestamp(),
    };

    // En el cierre manual NO se guarda posición de fin. El coordinador no sabe
    // dónde estaba el camión, y poner la última conocida como si fuera la de
    // entrega sería inventar un dato. `ultima_lat` ya está y dice lo que dice.
    if (cerradoPor === 'chofer' && posicion) {
      cambiosViaje.fin_lat = posicion.lat;
      cambiosViaje.fin_lng = posicion.lng;
      cambiosViaje.fin_precision = posicion.precision;
      cambiosViaje.fin_origen = posicion.origen || 'actual';
      cambiosViaje.ultima_lat = posicion.lat;
      cambiosViaje.ultima_lng = posicion.lng;
      cambiosViaje.ultima_ts = serverTimestamp();
    }

    tx.update(refViaje, cambiosViaje);

    anotar({
      entidadTipo: 'viaje',
      entidadId: viaje.id,
      pedidoId: viajeActual.pedido_id,
      accion: cerradoPor === 'manual' ? 'cerrar_viaje_manual' : 'finalizar_viaje',
      diferencias: calcularDiferencias(viajeActual, cambiosViaje),
      usuario,
      razon: motivo ? motivo.trim() : null,
    });

    /* ── El despacho: acá se destraba ────────────────────────────────────── */

    const cambiosDespacho = {
      estado: DESPACHO.ENTREGADO,
      estado_ts: serverTimestamp(),
      actualizado_en: serverTimestamp(),
    };

    tx.update(refDespacho, cambiosDespacho);

    anotar({
      entidadTipo: 'despacho',
      entidadId: despacho.id,
      pedidoId: viajeActual.pedido_id,
      accion: 'entregar',
      diferencias: calcularDiferencias(despachoActual, cambiosDespacho),
      usuario,
      derivado: true,
    });

    /* ── El pedido: SOLO el contador de cumplidas ────────────────────────── */

    // NOMINADO y ENTREGADO son los dos "vivo": la cobertura no cambia, así que
    // `entregas_cubiertas` no se toca. Lo único que se mueve es `cumplidas`.
    const delta = deltaContadores('programada', 'cumplida');

    tx.update(doc(db, 'pedidos', viajeActual.pedido_id), {
      entregas_cumplidas: increment(delta.cumplidas),
      actualizado_en: serverTimestamp(),
    });

    anotar({
      entidadTipo: 'pedido',
      entidadId: viajeActual.pedido_id,
      pedidoId: viajeActual.pedido_id,
      accion: 'recalcular_contadores',
      diferencias: {
        campos: ['entregas_cumplidas'],
        antes: {},
        despues: { delta_cumplidas: delta.cumplidas },
      },
      usuario,
      derivado: true,
    });

    return { ok: true };
  }, 3);
}

/* -----------------------------------------------------------------------------
 * GPS
 * -------------------------------------------------------------------------- */

/**
 * Escribe puntos de GPS y actualiza la última posición del viaje.
 *
 * NO va en transacción: es un `writeBatch`. No hay que leer nada para decidir
 * qué escribir, y el batch es atómico igual.
 *
 * `puntos_registrados` se incrementa con el operador atómico de Firestore, no
 * leyendo y sumando: dos lotes simultáneos leerían el mismo valor y uno se
 * perdería.
 *
 * La ÚLTIMA POSICIÓN se denormaliza en el viaje porque el mapa en vivo necesita
 * la de N camiones a la vez. Si viviera solo en la subcolección, mostrar 12
 * camiones serían 12 consultas.
 *
 * @param {string} viajeId
 * @param {Array} puntos [{ lat, lng, ts, precision, velocidad }]
 *   `ts` en milisegundos.
 */
export async function registrarPuntos(viajeId, puntos) {
  if (!puntos || puntos.length === 0) return;

  const lote = writeBatch(db);
  const coleccion = collection(db, 'viajes', viajeId, 'gps_puntos');

  for (const p of puntos) {
    const ms = Number(p.ts);
    if (!ms || isNaN(ms)) continue;

    // La clave ES el timestamp. Reenviar el mismo punto pisa el documento con
    // datos idénticos en vez de crear uno nuevo.
    lote.set(doc(coleccion, String(ms)), {
      lat: p.lat,
      lng: p.lng,
      ts: new Date(ms),
      precision: p.precision != null ? p.precision : null,
      velocidad: p.velocidad != null ? p.velocidad : null,
    });
  }

  const ultimo = puntos[puntos.length - 1];

  lote.update(doc(db, 'viajes', viajeId), {
    ultima_lat: ultimo.lat,
    ultima_lng: ultimo.lng,
    ultima_ts: new Date(Number(ultimo.ts)),
    puntos_registrados: increment(puntos.length),
    actualizado_en: serverTimestamp(),
  });

  await lote.commit();
}

/* -----------------------------------------------------------------------------
 * Salud del GPS
 * -------------------------------------------------------------------------- */

/**
 * Qué tan al día está la posición de un viaje.
 *
 * Reemplaza al campo `gps_estado`, que hoy es el literal `"activo"` escrito una
 * vez al nominar y nunca actualizado: no informa nada.
 *
 * Esto sí informa. Un camión en viaje que hace 40 minutos no reporta se ve
 * desde el portal en el momento, en vez de descubrirse revisando el recorrido
 * después. Es exactamente el caso del hueco de 30 minutos que apareció en el
 * diagnóstico.
 *
 * @returns {'no_corresponde'|'sin_datos'|'activo'|'intermitente'|'sin_senal'}
 */
export function saludGPS(viaje) {
  if (!viaje || viaje.estado !== VIAJE.EN_VIAJE) return 'no_corresponde';
  if (!viaje.ultima_ts) return 'sin_datos';

  const ultima = viaje.ultima_ts.toDate
    ? viaje.ultima_ts.toDate()
    : new Date(viaje.ultima_ts);

  const minutos = (Date.now() - ultima.getTime()) / 60000;

  if (minutos < 2) return 'activo';
  if (minutos < 15) return 'intermitente';
  return 'sin_senal';
}

export const ETIQUETA_GPS = {
  no_corresponde: '',
  sin_datos:      'sin ubicación',
  activo:         'ubicación al día',
  intermitente:   'ubicación intermitente',
  sin_senal:      'sin señal hace rato',
};

export const COLOR_GPS = {
  sin_datos:    '#9CA3AF',
  activo:       '#085041',
  intermitente: '#92400E',
  sin_senal:    '#B91C1C',
};
