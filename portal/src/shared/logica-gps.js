/* =============================================================================
 * logica-gps.js — Captura, buffer y subida de puntos GPS (TrackEx v1.1.2)
 * =============================================================================
 *
 * PROPÓSITO
 *   Toda la lógica de GPS de la app, pura y testeable: filtrar lecturas,
 *   guardarlas en el buffer local, armar los lotes y subirlos a Firestore por
 *   la API REST, con límite de tiempo y sin perder ni duplicar puntos. No
 *   importa `firebase`, React Native, Expo ni AsyncStorage: todo lo que toca
 *   el mundo exterior entra por parámetro (ver `crearGestorGPS`). La usa la
 *   app (TrackEx ≥ 1.1.2) a través de `explora-app/src/compartido.js`.
 *
 * -----------------------------------------------------------------------------
 * MODELO DE DATOS
 * -----------------------------------------------------------------------------
 *   Punto del buffer (lo que se guarda en el teléfono y se sube):
 *     viajeId    string        viaje al que pertenece. Va EN CADA PUNTO: el
 *                              buffer puede tener puntos de un viaje anterior
 *                              que todavía no subieron, y nunca deben ir a otro.
 *     ts         number        ms epoch de la LECTURA (`timestamp` de
 *                              expo-location), no la hora de procesamiento.
 *     lat, lng   number        grados.
 *     precision  number|null   radio de error en metros (`coords.accuracy`).
 *     velocidad  number|null   km/h (`coords.speed` viene en m/s).
 *
 *   Lo que escribe en Firestore (vía `armarCommitRest`):
 *     viajes/{viajeId}/gps_puntos/{ts}
 *       lat, lng (number) · ts (Timestamp) · precision, velocidad (number|null)
 *     viajes/{viajeId}
 *       ultima_lat, ultima_lng (number) · ultima_ts (Timestamp)
 *       puntos_registrados (increment) · actualizado_en (hora del servidor)
 *
 * -----------------------------------------------------------------------------
 * ARQUITECTURA / DECISIONES DE DISEÑO
 * -----------------------------------------------------------------------------
 *   1. FUNCIONES PURAS + UN ORQUESTADOR. Las funciones puras (filtrar, armar
 *      lotes, codificar el commit) no tocan nada. `crearGestorGPS` las combina
 *      con dependencias inyectadas (almacén, envío, reloj, log), y así se
 *      pueden reproducir en Jest los escenarios del 24/11/2026 sin teléfono.
 *
 *   2. SUBIDA POR REST Y NO POR EL SDK. Una escritura del SDK web de
 *      Firestore que no confirma NO falla: queda pendiente, sin error ni log.
 *      El 24/11, 558 puntos capturados entre las 14:42 y las 03:19 llegaron
 *      juntos a las 03:20, cuando el chofer abrió la app. Con `fetch` + límite
 *      de tiempo (`TIMEOUT_SUBIDA_MS`) toda subida termina: bien, o mal y con
 *      log, y se reintenta.
 *
 *   3. LA REESCRITURA ES IDÉNTICA. La clave del punto es su `ts` y el `ts` es
 *      la hora de la lectura: reenviar un lote cuya respuesta se perdió
 *      reescribe documentos idénticos. La regla de `gps_puntos` lo permite
 *      desde esta versión (ver `firestore.rules.produccion`). La codificación
 *      REST es la misma que la del SDK (`codificarValorRest`) para que un punto
 *      escrito por la v1.1.1 y reenviado por la v1.1.2 también quede idéntico.
 *
 *   4. UNA SOLA FUENTE GRABA. `fuenteDebeGrabar` deja grabar al primer plano
 *      solo si el servicio de segundo plano no está activo. Si igual llegan
 *      dos copias, `evaluarLectura` descarta la segunda como `duplicada` o
 *      `muy_cercana`.
 *
 *   5. COLA SERIAL PARA EL BUFFER. Toda lectura/escritura del buffer y del
 *      último punto pasa por una cadena de promesas del gestor: un agregado y
 *      un quitado nunca se pisan. La red queda FUERA de la cola, para que una
 *      red lenta no frene el registro de lecturas.
 *
 *   6. NUNCA SE VACÍA EL BUFFER A CIEGAS. Se quitan solo los puntos que el
 *      servidor confirmó (`quitarConfirmados`), releyendo el buffer: los que
 *      entraron mientras el lote viajaba quedan. La v1.1.1 hacía
 *      `escribir([])` y perdía los puntos de otra descarga en vuelo.
 *
 *   7. UN PUNTO MALO NO TRABA EL BUFFER. Un lote `INVALIDO` se parte en
 *      mitades hasta aislar el punto y descartarlo solo a él. Un viaje cerrado
 *      o inexistente se descarta entero y no bloquea los puntos del viaje que
 *      viene detrás.
 *
 * -----------------------------------------------------------------------------
 * HISTORIAL DE CORRECCIONES
 * -----------------------------------------------------------------------------
 *   TrackEx v1.1.2 — GPS (archivo nuevo). Causas raíz del primer uso real
 *   (TrackEx v1.1.1, 24/11/2026), ver `portal/CHANGELOG.md`:
 *     A. Subida trabada en segundo plano: escrituras del SDK pendientes horas,
 *        sin error. → REST con timeout (punto 2).
 *     B. Lotes rechazados enteros (`permission-denied`): dos fuentes grababan
 *        la misma lectura, descargas superpuestas con puntos repetidos, y
 *        `set()` sobre un punto existente es un update que la regla
 *        prohibía. Además una descarga exitosa vaciaba el buffer completo.
 *        → puntos 3, 4, 5 y 6.
 *     D. Hora del punto equivocada: se sellaba con `new Date()` al procesar.
 *        → `normalizarLectura` usa el `timestamp` de la lectura, y el filtro
 *        de velocidad usa la diferencia de esos `ts`.
 *
 * -----------------------------------------------------------------------------
 * LIMITACIONES CONOCIDAS
 * -----------------------------------------------------------------------------
 *   - La exclusión mutua (cola serial y "una descarga en vuelo") vale dentro
 *     de un mismo contexto JS. Android puede correr la tarea de segundo plano
 *     en un contexto nuevo sin React, con su propio gestor. Dos contextos
 *     vivos a la vez sobre el mismo buffer no se dan en la práctica, pero no
 *     está garantizado. Si pasara, lo peor es un reenvío idéntico (inocuo por
 *     el punto 3) o un punto que vuelve a entrar al buffer y se reenvía.
 *   - El inicio de un corte de red (para el log `gps_subida_recuperada`) vive
 *     en memoria del gestor: si el contexto se reinicia durante el corte, la
 *     recuperación no se loguea (las fallas sí quedaron logueadas).
 *   - Un pedido que venció por timeout puede igual llegar al servidor más
 *     tarde. No hace daño: el reintento reescribe idéntico.
 *   - `puntos_registrados` del viaje es un `increment`: un lote reenviado
 *     porque se perdió la respuesta reescribe los puntos idénticos, pero
 *     vuelve a sumar. El contador puede quedar por encima de la cantidad real
 *     de documentos en `gps_puntos`; la fuente de verdad es la subcolección.
 *
 * -----------------------------------------------------------------------------
 * DEPENDENCIAS Y ENTORNO
 * -----------------------------------------------------------------------------
 *   Solo `./estados` (sin imports externos). Tests en `logica-gps.test.js`
 *   (Jest de CRA: `CI=true npm test -- --watchAll=false`).
 * ========================================================================== */

import { VIAJE } from './estados';

/* -----------------------------------------------------------------------------
 * CONSTANTES
 * -------------------------------------------------------------------------- */

/**
 * Radio de error máximo aceptado, en metros. El mismo valor que usa la app
 * desde la v1.1.0: más de 100 m suele ser señal rebotada contra galpones o
 * tanques, no movimiento real.
 */
export const PRECISION_MAXIMA_METROS = 100;

/**
 * Velocidad máxima creíble entre dos lecturas, en km/h. El mismo valor que usa
 * la app: un camión no la supera, así que un salto mayor es ruido del GPS.
 */
export const VELOCIDAD_MAXIMA_KMH = 150;

/**
 * Separación mínima entre dos lecturas aceptadas, en ms. Con captura cada
 * 30 s, una lectura a menos de 5 s de la última aceptada es la misma
 * observación (dos fuentes o una entrega duplicada del sistema), no una nueva.
 */
export const SEPARACION_MINIMA_MS = 5000;

/**
 * Cadencia de captura (`timeInterval`). El mismo valor que usa hoy la app:
 * con 60 s, un camión a 80 km/h dejaba un punto cada kilómetro y medio.
 */
export const GPS_INTERVALO_MS = 30000;

/**
 * Distancia mínima entre capturas (`distanceInterval`), en metros. El mismo
 * valor que usa hoy la app, combinado con `GPS_INTERVALO_MS`.
 */
export const GPS_DISTANCIA_M = 50;

/**
 * Disparador de descarga por cantidad: con 10 puntos (unos 5 minutos de
 * captura) se sube. El mismo valor que usa hoy la app.
 */
export const BUFFER_MAX_PUNTOS = 10;

/**
 * Disparador de descarga por antigüedad del punto más viejo (2 minutos). Cubre
 * al camión detenido, que genera pocos puntos y nunca llegaría al umbral por
 * cantidad. El mismo valor que usa hoy la app.
 */
export const BUFFER_MAX_EDAD_MS = 120000;

/**
 * Tope del buffer local. Un día entero de viaje a un punto cada 30 s son 2880
 * lecturas: con 3000 el buffer aguanta un día sin red. Al superarlo se
 * conservan los más nuevos. Hasta la v1.1.1 era 1000 (unas 8 horas).
 */
export const BUFFER_TOPE_PUNTOS = 3000;

/**
 * Puntos por pedido de subida. Un commit admite 500 escrituras; 200 (más el
 * update del viaje) mantiene el pedido chico para una red móvil mala. Los 559
 * puntos del 24/11 serían 3 pedidos.
 */
export const LOTE_MAXIMO_PUNTOS = 200;

/**
 * Límite de tiempo de una subida. Una subida que no confirma en 20 s se da por
 * fallida (`SIN_RED`, detalle `timeout`) y se reintenta en la próxima
 * descarga: nunca queda colgada, que fue el defecto A del 24/11.
 */
export const TIMEOUT_SUBIDA_MS = 20000;

/**
 * Tope de rondas de una misma descarga. Tras subir una foto del buffer, si
 * entraron puntos nuevos mientras tanto, se vuelve a leer y subir. 50 rondas
 * son 10.000 puntos: más que el tope del buffer; existe solo para que un
 * defecto no pueda generar un bucle infinito.
 */
const MAX_RONDAS_DESCARGA = 50;

/** Fuentes de lecturas de la app. */
export const FUENTE = {
  SEGUNDO_PLANO: 'segundo_plano',
  PRIMER_PLANO: 'primer_plano',
};

/** Resultado de un intento de subida (ver `clasificarRespuesta`). */
export const RESULTADO_SUBIDA = {
  OK: 'ok',
  SIN_RED: 'sin_red',
  SESION: 'sesion',
  PERMISO: 'permiso',
  VIAJE_INEXISTENTE: 'viaje_inexistente',
  INVALIDO: 'invalido',
  REINTENTAR: 'reintentar',
};

/* -----------------------------------------------------------------------------
 * FUNCIONES PURAS
 * -------------------------------------------------------------------------- */

/**
 * Distancia entre dos coordenadas por la fórmula de Haversine (la misma que
 * usa la app desde la v1.1.0). Precisión de sobra para filtrar saltos.
 *
 * @param {number} lat1 Latitud del primer punto, en grados.
 * @param {number} lng1 Longitud del primer punto, en grados.
 * @param {number} lat2 Latitud del segundo punto, en grados.
 * @param {number} lng2 Longitud del segundo punto, en grados.
 * @returns {number} Distancia en metros.
 */
export function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000; // radio medio terrestre en metros
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** `true` si `x` es un número finito (no NaN, no Infinity, no string). */
function esFinito(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * Convierte una lectura de expo-location en un punto del modelo.
 *
 * `ts` es el `timestamp` de la LECTURA, no `Date.now()`: con entregas
 * atrasadas o en lote (Android agrupa lecturas para ahorrar batería), la hora
 * de procesamiento es incorrecta y el filtro de velocidad descartaba lecturas
 * válidas (defecto D del 24/11). `precision` y `velocidad` se guardan desde
 * esta versión (antes llegaban `null`).
 *
 * @param {{coords: Object, timestamp: number}} lectura Objeto de expo-location.
 * @param {string} viajeId Viaje activo al que pertenece la lectura.
 * @returns {Object|null} Punto `{ viajeId, ts, lat, lng, precision, velocidad }`,
 *   o `null` si falta el `timestamp` o las coordenadas no son números finitos.
 */
export function normalizarLectura(lectura, viajeId) {
  if (!lectura || !lectura.coords) return null;
  const { coords, timestamp } = lectura;
  if (!esFinito(timestamp)) return null;
  if (!esFinito(coords.latitude) || !esFinito(coords.longitude)) return null;

  const precision = esFinito(coords.accuracy) ? coords.accuracy : null;
  // expo-location da m/s; -1 o null significan "no disponible".
  const velocidad = esFinito(coords.speed) && coords.speed >= 0 ? coords.speed * 3.6 : null;

  return {
    viajeId,
    ts: timestamp,
    lat: coords.latitude,
    lng: coords.longitude,
    precision,
    velocidad,
  };
}

/**
 * Decide si una lectura se acepta, contra el último punto aceptado.
 *
 * El orden importa: primero lo que vuelve la lectura inutilizable (`invalida`),
 * después lo que la vuelve repetida (`duplicada`, `muy_cercana`) —que es lo que
 * pasa con dos fuentes, y no conviene loguearlo como imprecisión—, y al final
 * la calidad (`imprecisa`, `salto`). El salto se calcula con la diferencia de
 * los `ts` de LECTURA, no con la hora actual (defecto D).
 *
 * Un `ultimo` de otro viaje se ignora: el primer punto de un viaje no se
 * compara contra el final del anterior.
 *
 * @param {Object|null} punto Punto del modelo (ver `normalizarLectura`).
 * @param {Object|null} ultimo `{ viajeId, ts, lat, lng }` o `null`.
 * @returns {{aceptar: boolean, motivo: string}} motivo: `invalida` |
 *   `duplicada` | `muy_cercana` | `imprecisa` | `salto` | `aceptada`.
 */
export function evaluarLectura(punto, ultimo) {
  const rechazo = (motivo) => ({ aceptar: false, motivo });

  if (!punto || !esFinito(punto.lat) || !esFinito(punto.lng) || !esFinito(punto.ts)
    || Math.abs(punto.lat) > 90 || Math.abs(punto.lng) > 180) {
    return rechazo('invalida');
  }

  const previo = ultimo && ultimo.viajeId === punto.viajeId ? ultimo : null;

  if (previo) {
    if (punto.ts <= previo.ts) return rechazo('duplicada');
    if (punto.ts - previo.ts < SEPARACION_MINIMA_MS) return rechazo('muy_cercana');
  }

  if (punto.precision != null && punto.precision > PRECISION_MAXIMA_METROS) {
    return rechazo('imprecisa');
  }

  if (previo) {
    const metros = distanciaMetros(previo.lat, previo.lng, punto.lat, punto.lng);
    const horas = (punto.ts - previo.ts) / 3600000;
    const kmh = metros / 1000 / horas;
    if (kmh > VELOCIDAD_MAXIMA_KMH) return rechazo('salto');
  }

  return { aceptar: true, motivo: 'aceptada' };
}

/**
 * Decide si una fuente graba su lectura.
 *
 * El segundo plano graba siempre: es la fuente que sobrevive a la pantalla
 * apagada. El primer plano graba solo si el servicio de segundo plano NO está
 * activo (chofer sin "Permitir siempre"). Así cada lectura física la graba una
 * sola fuente: elimina de raíz la doble grabación del 24/11.
 *
 * @param {string} fuente Valor de `FUENTE`.
 * @param {{servicioActivo: boolean}} estado
 * @returns {boolean}
 */
export function fuenteDebeGrabar(fuente, { servicioActivo } = {}) {
  if (fuente === FUENTE.SEGUNDO_PLANO) return true;
  if (fuente === FUENTE.PRIMER_PLANO) return !servicioActivo;
  return false;
}

/** Clave única de un punto dentro del buffer. */
function clavePunto(p) {
  return `${p.viajeId}|${p.ts}`;
}

/**
 * Agrega un punto al buffer, sin mutarlo.
 *
 * Deduplica por `(viajeId, ts)` —la misma clave que el documento en
 * Firestore—, ordena por `ts` y recorta a `BUFFER_TOPE_PUNTOS` conservando los
 * más nuevos (el tramo reciente es el que el portal necesita).
 *
 * @param {Array} buffer
 * @param {Object} punto
 * @returns {Array} Buffer nuevo.
 */
export function agregarAlBuffer(buffer, punto) {
  const base = Array.isArray(buffer) ? buffer : [];
  const clave = clavePunto(punto);
  const sinRepetir = base.some((p) => clavePunto(p) === clave) ? base : [...base, punto];
  const ordenado = [...sinRepetir].sort((a, b) => a.ts - b.ts);
  return ordenado.length > BUFFER_TOPE_PUNTOS
    ? ordenado.slice(ordenado.length - BUFFER_TOPE_PUNTOS)
    : ordenado;
}

/**
 * ¿Toca subir? Por cantidad (`BUFFER_MAX_PUNTOS`) o por antigüedad del punto
 * más viejo (`BUFFER_MAX_EDAD_MS`, el caso del camión detenido).
 *
 * @param {Array} buffer
 * @param {number} ahoraMs
 * @returns {boolean}
 */
export function debeDescargar(buffer, ahoraMs) {
  if (!Array.isArray(buffer) || buffer.length === 0) return false;
  if (buffer.length >= BUFFER_MAX_PUNTOS) return true;
  const masViejo = Math.min(...buffer.map((p) => p.ts));
  return ahoraMs - masViejo >= BUFFER_MAX_EDAD_MS;
}

/**
 * Arma los lotes de subida: agrupados por viaje (un commit escribe un solo
 * viaje), de a lo sumo `LOTE_MAXIMO_PUNTOS`, con los puntos ordenados por `ts`
 * y los viajes en el orden de su punto más viejo (lo pendiente de un viaje
 * anterior sale primero; si está cerrado, se descarta y no frena al actual).
 *
 * @param {Array} buffer
 * @returns {Array<{viajeId: string, puntos: Array}>}
 */
export function armarLotes(buffer) {
  const porViaje = new Map();
  for (const p of [...(buffer || [])].sort((a, b) => a.ts - b.ts)) {
    if (!porViaje.has(p.viajeId)) porViaje.set(p.viajeId, []);
    porViaje.get(p.viajeId).push(p);
  }
  // `Map` conserva el orden de inserción: como se recorrió ordenado por `ts`,
  // los viajes quedan en el orden de su punto más viejo.
  const lotes = [];
  for (const [viajeId, puntos] of porViaje) {
    for (let i = 0; i < puntos.length; i += LOTE_MAXIMO_PUNTOS) {
      lotes.push({ viajeId, puntos: puntos.slice(i, i + LOTE_MAXIMO_PUNTOS) });
    }
  }
  return lotes;
}

/**
 * Quita del buffer SOLO los puntos confirmados de un viaje. Nunca vacía el
 * buffer a ciegas: lo que entró mientras el lote viajaba se queda (defecto B).
 *
 * @param {Array} buffer
 * @param {string} viajeId
 * @param {number[]} tsConfirmados
 * @returns {Array} Buffer nuevo.
 */
export function quitarConfirmados(buffer, viajeId, tsConfirmados) {
  const confirmados = new Set(tsConfirmados);
  return (buffer || []).filter((p) => !(p.viajeId === viajeId && confirmados.has(p.ts)));
}

/**
 * Quita todos los puntos de un viaje (cerrado o inexistente: sus puntos ya no
 * pueden subir y no deben trabar el resto).
 *
 * @param {Array} buffer
 * @param {string} viajeId
 * @returns {Array} Buffer nuevo.
 */
export function quitarViaje(buffer, viajeId) {
  return (buffer || []).filter((p) => p.viajeId !== viajeId);
}

/**
 * Convierte el buffer de TrackEx ≤ 1.1.1 (`[{ lat, lng, ts: ISO }]`, sin
 * viaje) al modelo nuevo.
 *
 * El `ts` en ms es `new Date(iso).getTime()`, EXACTAMENTE lo que usó la v1.1.1
 * como ID del documento: un punto que ya había subido se reescribe idéntico y
 * la regla nueva lo acepta. Sin viaje activo no hay a dónde mandarlos: se
 * descartan todos. Los elementos que ya tienen la forma nueva pasan tal cual.
 *
 * @param {*} bufferViejo Lo que había en disco.
 * @param {string|null} viajeIdActivo
 * @returns {{buffer: Array, descartados: number}}
 */
export function migrarBufferViejo(bufferViejo, viajeIdActivo) {
  if (!Array.isArray(bufferViejo)) return { buffer: [], descartados: 0 };
  const buffer = [];
  let descartados = 0;

  for (const p of bufferViejo) {
    const formaNueva = p && typeof p.viajeId === 'string' && esFinito(p.ts)
      && esFinito(p.lat) && esFinito(p.lng);
    if (formaNueva) {
      buffer.push(p);
      continue;
    }
    const ms = p && typeof p.ts === 'string' ? new Date(p.ts).getTime() : NaN;
    if (!viajeIdActivo || !p || !esFinito(p.lat) || !esFinito(p.lng) || !Number.isFinite(ms)) {
      descartados += 1;
      continue;
    }
    buffer.push({ viajeId: viajeIdActivo, ts: ms, lat: p.lat, lng: p.lng, precision: null, velocidad: null });
  }
  return { buffer, descartados };
}

/**
 * Valor JS → `Value` de la API REST de Firestore, con la MISMA codificación
 * que el SDK web: entero (`Number.isInteger`) como `integerValue` (string, así
 * lo define la API: int64 en JSON), el resto de los números como
 * `doubleValue`. Así un punto escrito por el SDK (v1.1.1) y reescrito por REST
 * (v1.1.2) queda idéntico y la regla de reescritura idéntica lo acepta.
 *
 * Referencia: https://firebase.google.com/docs/firestore/reference/rest/v1/Value
 *
 * @param {*} valor null | number | boolean | string | Date
 * @returns {Object} Value de Firestore.
 * @throws {Error} Para cualquier otro tipo (no hay en el modelo del punto).
 */
export function codificarValorRest(valor) {
  if (valor === null) return { nullValue: null };
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new Error(`codificarValorRest: número no finito (${valor})`);
    return Number.isInteger(valor) ? { integerValue: String(valor) } : { doubleValue: valor };
  }
  if (typeof valor === 'boolean') return { booleanValue: valor };
  if (typeof valor === 'string') return { stringValue: valor };
  if (valor instanceof Date) return { timestampValue: valor.toISOString() };
  throw new Error(`codificarValorRest: tipo no soportado (${typeof valor})`);
}

/**
 * URL del método `commit` de la API REST.
 * Referencia: https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit
 *
 * @param {string} projectId
 * @returns {string}
 */
export function urlCommitRest(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
}

/**
 * Cuerpo JSON del `commit` que sube un lote de puntos de un viaje.
 *
 * Es el equivalente REST de `registrarPuntos()` (`logica-viajes.js`), atómico
 * igual (un commit aplica todas sus escrituras o ninguna):
 *   - Un `Write` con `update` por punto, SIN `updateMask`: reemplaza el
 *     documento entero, la misma semántica que `set()`.
 *   - Al final, un `Write` sobre el viaje con `updateMask` de los tres
 *     `ultima_*` (solo esos campos), `updateTransforms` para
 *     `puntos_registrados` (increment) y `actualizado_en` (hora del
 *     servidor), y `currentDocument.exists: true` para no crear un viaje si
 *     ya no existe (falla con FAILED_PRECONDITION → `VIAJE_INEXISTENTE`).
 *
 * Nombres verificados contra la referencia oficial (25/11/2026):
 *   https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.documents/commit
 *   https://firebase.google.com/docs/firestore/reference/rest/v1/Write
 *     (Write: update, updateMask.fieldPaths, updateTransforms, currentDocument;
 *      FieldTransform: fieldPath, increment, setToServerValue "REQUEST_TIME";
 *      los updateTransforms se aplican después del update, en el mismo Write)
 *   https://firebase.google.com/docs/firestore/reference/rest/v1/Precondition
 *
 * @param {{projectId: string, viajeId: string, puntos: Array}} params
 *   `puntos` no vacío, del mismo viaje.
 * @returns {{writes: Array}}
 */
export function armarCommitRest({ projectId, viajeId, puntos }) {
  const base = `projects/${projectId}/databases/(default)/documents`;
  const ordenados = [...puntos].sort((a, b) => a.ts - b.ts);

  const writes = ordenados.map((p) => ({
    update: {
      name: `${base}/viajes/${viajeId}/gps_puntos/${p.ts}`,
      fields: {
        lat: codificarValorRest(p.lat),
        lng: codificarValorRest(p.lng),
        ts: codificarValorRest(new Date(p.ts)),
        precision: codificarValorRest(p.precision != null ? p.precision : null),
        velocidad: codificarValorRest(p.velocidad != null ? p.velocidad : null),
      },
    },
  }));

  const ultimo = ordenados[ordenados.length - 1];
  writes.push({
    update: {
      name: `${base}/viajes/${viajeId}`,
      fields: {
        ultima_lat: codificarValorRest(ultimo.lat),
        ultima_lng: codificarValorRest(ultimo.lng),
        ultima_ts: codificarValorRest(new Date(ultimo.ts)),
      },
    },
    updateMask: { fieldPaths: ['ultima_lat', 'ultima_lng', 'ultima_ts'] },
    updateTransforms: [
      { fieldPath: 'puntos_registrados', increment: { integerValue: String(ordenados.length) } },
      { fieldPath: 'actualizado_en', setToServerValue: 'REQUEST_TIME' },
    ],
    currentDocument: { exists: true },
  });

  return { writes };
}

/**
 * Traduce la respuesta HTTP de un `commit` a `RESULTADO_SUBIDA`.
 *
 * Por qué cada mapeo:
 *   - 200 → `OK`: el commit es atómico; 200 es que se aplicó entero.
 *   - 401 / UNAUTHENTICATED → `SESION`: token vencido. Se conserva el buffer;
 *     la app renueva el token y reintenta. No es culpa de los puntos.
 *   - 403 / PERMISSION_DENIED → `PERMISO`: o el viaje ya no está EN_VIAJE (se
 *     descarta), o el lote choca con la regla por otra cosa (se conserva). El
 *     gestor lo distingue consultando el viaje.
 *   - NOT_FOUND / FAILED_PRECONDITION → `VIAJE_INEXISTENTE`: falló
 *     `currentDocument.exists` del viaje; esos puntos nunca van a subir.
 *   - INVALID_ARGUMENT → `INVALIDO`: algún dato del lote es malo; el gestor
 *     parte el lote para aislarlo.
 *   - 429, 5xx, ABORTED, UNAVAILABLE, DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED →
 *     `REINTENTAR`: problemas transitorios del servidor.
 *   - Cualquier otro → `REINTENTAR`: ante la duda se conserva el buffer;
 *     descartar puntos por un error desconocido sería perder datos.
 *
 * El `status` de Google (`cuerpo.error.status`) tiene prioridad sobre el HTTP
 * porque es más específico (un 400 puede ser INVALID_ARGUMENT o
 * FAILED_PRECONDITION).
 *
 * @param {number} status Código HTTP.
 * @param {Object|null} cuerpo Cuerpo de la respuesta (`{ error: { status } }`).
 * @returns {string} Valor de `RESULTADO_SUBIDA`.
 */
export function clasificarRespuesta(status, cuerpo) {
  if (status === 200) return RESULTADO_SUBIDA.OK;
  const estado = cuerpo && cuerpo.error && cuerpo.error.status;

  switch (estado) {
    case 'UNAUTHENTICATED': return RESULTADO_SUBIDA.SESION;
    case 'PERMISSION_DENIED': return RESULTADO_SUBIDA.PERMISO;
    case 'NOT_FOUND':
    case 'FAILED_PRECONDITION': return RESULTADO_SUBIDA.VIAJE_INEXISTENTE;
    case 'INVALID_ARGUMENT': return RESULTADO_SUBIDA.INVALIDO;
    case 'ABORTED':
    case 'UNAVAILABLE':
    case 'DEADLINE_EXCEEDED':
    case 'RESOURCE_EXHAUSTED': return RESULTADO_SUBIDA.REINTENTAR;
    default: break;
  }

  if (status === 401) return RESULTADO_SUBIDA.SESION;
  if (status === 403) return RESULTADO_SUBIDA.PERMISO;
  return RESULTADO_SUBIDA.REINTENTAR;
}

/* -----------------------------------------------------------------------------
 * ORQUESTADOR
 * -------------------------------------------------------------------------- */

/**
 * Crea el gestor que registra lecturas y sube el buffer.
 *
 * Toda la lógica de registrar y subir vive acá, con el mundo exterior
 * inyectado, para poder reproducir en tests los escenarios del 24/11 (dos
 * fuentes, red colgada, respuesta perdida, viaje cerrado) sin teléfono.
 *
 * Garantías (dentro de un mismo contexto JS, ver la cabecera):
 *   - Cola serial: el buffer y el último punto solo se leen/escriben dentro
 *     de `enCola`. La red va fuera de la cola.
 *   - Una sola descarga en vuelo: `descargar()` concurrente devuelve la misma
 *     promesa.
 *   - Toda subida termina: `enviarLote` corre contra `TIMEOUT_SUBIDA_MS`.
 *   - Logs solo de fallas, descartes y recuperaciones, nunca por subida
 *     exitosa (para no inflar `app_logs`). Un log que falla no rompe nada.
 *
 * @param {Object} dependencias
 * @param {Object} dependencias.almacen `{ leerBuffer, escribirBuffer,
 *   leerUltimo, escribirUltimo }`, todas asincrónicas (AsyncStorage en la app).
 * @param {Function} dependencias.enviarLote `({ viajeId, puntos }) =>
 *   Promise<{ resultado, detalle? }>` (fetch REST en la app).
 * @param {Function} dependencias.consultarEstadoViaje `(viajeId) =>
 *   Promise<string|null>`; `null` = el viaje no existe.
 * @param {{ahora: Function, esperar: Function}} dependencias.reloj
 * @param {Function} dependencias.registrarLog `(evento, extra) => Promise`.
 * @returns {{registrarLectura: Function, descargar: Function, pendientes: Function}}
 */
export function crearGestorGPS({ almacen, enviarLote, consultarEstadoViaje, reloj, registrarLog }) {
  /** Cola serial: cada operación espera a la anterior, falle o no. */
  let cola = Promise.resolve();
  /** Promesa de la descarga en curso, o `null`. */
  let descargaEnVuelo = null;
  /** Instante (ms) del primer error desde la última subida buena, o `null`. */
  let corteDesdeMs = null;

  /**
   * Encola una operación sobre el buffer. Un error de la operación se propaga
   * a quien la pidió, pero no rompe la cadena para las siguientes.
   */
  function enCola(fn) {
    const resultado = cola.then(fn);
    cola = resultado.catch(() => {});
    return resultado;
  }

  /** Lee el buffer; un valor corrupto cuenta como vacío. Solo dentro de la cola. */
  async function leerBuffer() {
    const b = await almacen.leerBuffer();
    return Array.isArray(b) ? b : [];
  }

  /** Log que nunca lanza: perder un log no puede frenar la subida. */
  async function log(evento, extra) {
    try {
      await registrarLog(evento, extra);
    } catch (e) {
      // A propósito: no hay a dónde reportar que el log falló.
    }
  }

  /**
   * Corre `fn` contra `TIMEOUT_SUBIDA_MS`. Devuelve `{ vencido: true }` si
   * ganó el reloj. Sirve para el envío y para la consulta del viaje: cualquier
   * llamada a la red que pueda colgarse se corta acá.
   */
  async function conLimite(fn) {
    return Promise.race([
      Promise.resolve().then(fn).then((valor) => ({ valor })),
      reloj.esperar(TIMEOUT_SUBIDA_MS).then(() => ({ vencido: true })),
    ]);
  }

  /** Envía un lote con límite de tiempo. Nunca lanza. */
  async function enviarConLimite(lote) {
    try {
      const r = await conLimite(() => enviarLote(lote));
      if (r.vencido) return { resultado: RESULTADO_SUBIDA.SIN_RED, detalle: 'timeout' };
      if (!r.valor || !r.valor.resultado) {
        return { resultado: RESULTADO_SUBIDA.REINTENTAR, detalle: 'respuesta_vacia' };
      }
      return r.valor;
    } catch (err) {
      return { resultado: RESULTADO_SUBIDA.SIN_RED, detalle: (err && err.message) || String(err) };
    }
  }

  /**
   * Cantidad de puntos en el buffer.
   * @returns {Promise<number>}
   */
  function pendientes() {
    return enCola(async () => (await leerBuffer()).length);
  }

  /** Descarta todos los puntos de un viaje y lo loguea. */
  async function descartarViaje(lote, resultado, detalle) {
    const cuantos = await enCola(async () => {
      const buffer = await leerBuffer();
      const nuevo = quitarViaje(buffer, lote.viajeId);
      await almacen.escribirBuffer(nuevo);
      return { quitados: buffer.length - nuevo.length, quedan: nuevo.length };
    });
    await log('gps_descarte', {
      viaje_id: lote.viajeId, resultado, detalle,
      puntos_pendientes: cuantos.quedan, lote: cuantos.quitados,
    });
    return cuantos.quitados;
  }

  /**
   * Sube un lote y aplica el resultado al buffer.
   *
   * @returns {Promise<{resultado, detalle, enviados, descartados, cortar, viajeDescartado}>}
   *   `cortar`: hay que dejar de subir en esta descarga y conservar lo que queda.
   */
  async function procesarLote(lote) {
    const r = await enviarConLimite(lote);
    const vacio = { resultado: r.resultado, detalle: r.detalle || null, enviados: 0, descartados: 0, cortar: false, viajeDescartado: false };
    const errorConservando = async (resultado, detalle) => {
      const quedan = await pendientes();
      await log('gps_subida_error', {
        viaje_id: lote.viajeId, resultado, detalle: detalle || null,
        puntos_pendientes: quedan, lote: lote.puntos.length,
      });
      return { ...vacio, resultado, detalle: detalle || null, cortar: true };
    };

    switch (r.resultado) {
      case RESULTADO_SUBIDA.OK: {
        // Releyendo el buffer: lo que entró mientras el lote viajaba se queda.
        await enCola(async () => {
          const buffer = await leerBuffer();
          await almacen.escribirBuffer(quitarConfirmados(buffer, lote.viajeId, lote.puntos.map((p) => p.ts)));
        });
        return { ...vacio, enviados: lote.puntos.length };
      }

      case RESULTADO_SUBIDA.VIAJE_INEXISTENTE: {
        const descartados = await descartarViaje(lote, r.resultado, r.detalle || 'inexistente');
        return { ...vacio, descartados, viajeDescartado: true };
      }

      case RESULTADO_SUBIDA.PERMISO: {
        // ¿El viaje se cerró (sus puntos ya no pueden subir) o el problema es
        // otro (se conservan)? La consulta también tiene límite de tiempo: una
        // consulta colgada no puede dejar colgada la descarga.
        let estado;
        try {
          const c = await conLimite(() => consultarEstadoViaje(lote.viajeId));
          if (c.vencido) return errorConservando(r.resultado, 'consulta_viaje_timeout');
          estado = c.valor;
        } catch (err) {
          return errorConservando(r.resultado, `consulta_viaje: ${(err && err.message) || err}`);
        }
        if (estado === VIAJE.EN_VIAJE) return errorConservando(r.resultado, r.detalle);
        const descartados = await descartarViaje(lote, r.resultado, estado || 'inexistente');
        return { ...vacio, descartados, viajeDescartado: true };
      }

      case RESULTADO_SUBIDA.INVALIDO: {
        if (lote.puntos.length === 1) {
          const p = lote.puntos[0];
          const quedan = await enCola(async () => {
            const nuevo = quitarConfirmados(await leerBuffer(), lote.viajeId, [p.ts]);
            await almacen.escribirBuffer(nuevo);
            return nuevo.length;
          });
          await log('gps_punto_descartado', {
            viaje_id: lote.viajeId, resultado: r.resultado, detalle: r.detalle || null,
            puntos_pendientes: quedan, lote: 1, ts: p.ts,
          });
          return { ...vacio, descartados: 1 };
        }
        // Partir en mitades hasta aislar el punto malo: un punto malo nunca
        // traba el buffer (el patrón del 24/11).
        const mitad = Math.ceil(lote.puntos.length / 2);
        const total = { ...vacio, resultado: RESULTADO_SUBIDA.OK, detalle: null };
        for (const puntos of [lote.puntos.slice(0, mitad), lote.puntos.slice(mitad)]) {
          const parcial = await procesarLote({ viajeId: lote.viajeId, puntos });
          total.enviados += parcial.enviados;
          total.descartados += parcial.descartados;
          if (parcial.cortar || parcial.viajeDescartado) {
            return { ...total, resultado: parcial.resultado, detalle: parcial.detalle, cortar: parcial.cortar, viajeDescartado: parcial.viajeDescartado };
          }
        }
        return total;
      }

      default:
        // SIN_RED, REINTENTAR, SESION o algo desconocido: se conserva todo.
        return errorConservando(r.resultado, r.detalle);
    }
  }

  /** El cuerpo de una descarga. Nunca lanza. */
  async function ejecutarDescarga() {
    let enviados = 0;
    let descartados = 0;
    let resultado = RESULTADO_SUBIDA.OK;
    let detalle = null;
    const viajesDescartados = [];

    for (let ronda = 0; ronda < MAX_RONDAS_DESCARGA; ronda += 1) {
      // Foto del buffer, leída dentro de la cola.
      const foto = await enCola(leerBuffer);
      if (foto.length === 0) break;

      let progreso = 0;
      let cortado = false;
      for (const lote of armarLotes(foto)) {
        // Un viaje ya descartado en esta descarga puede tener más lotes.
        if (viajesDescartados.includes(lote.viajeId)) continue;
        const r = await procesarLote(lote);
        enviados += r.enviados;
        descartados += r.descartados;
        progreso += r.enviados + r.descartados;
        if (r.viajeDescartado) viajesDescartados.push(lote.viajeId);
        if (r.cortar) {
          resultado = r.resultado;
          detalle = r.detalle;
          cortado = true;
          break;
        }
      }
      // Otra ronda solo si todo salió bien y entraron puntos nuevos mientras
      // tanto; sin progreso no se insiste (evita un bucle sobre el mismo lote).
      if (cortado || progreso === 0) break;
    }

    if (resultado === RESULTADO_SUBIDA.OK) {
      if (corteDesdeMs != null && enviados > 0) {
        await log('gps_subida_recuperada', {
          viaje_id: null, resultado, detalle: null,
          puntos_pendientes: await pendientes(), lote: enviados,
          minutos_corte: Math.round((reloj.ahora() - corteDesdeMs) / 60000),
        });
        corteDesdeMs = null;
      }
    } else if (corteDesdeMs == null) {
      corteDesdeMs = reloj.ahora();
    }

    return { resultado, detalle, enviados, descartados, viajesDescartados, pendientes: await pendientes() };
  }

  /**
   * Sube el buffer. Una sola descarga en vuelo por gestor: si hay una en
   * curso, devuelve la misma promesa (dos descargas superpuestas mandaban los
   * mismos puntos dos veces el 24/11).
   *
   * @returns {Promise<{resultado: string, detalle: string|null, enviados: number,
   *   descartados: number, viajesDescartados: string[], pendientes: number}>}
   *   `viajesDescartados` permite a la app detener el seguimiento de un viaje
   *   cerrado por fuera.
   */
  function descargar() {
    if (descargaEnVuelo) return descargaEnVuelo;
    descargaEnVuelo = ejecutarDescarga().finally(() => { descargaEnVuelo = null; });
    return descargaEnVuelo;
  }

  /**
   * Registra una lectura: filtra por fuente, evalúa contra el último punto,
   * la agrega al buffer y, si toca, descarga.
   *
   * @param {{punto: Object, fuente: string, servicioActivo: boolean}} params
   * @returns {Promise<{motivo: string, descarga?: Object}>}
   */
  async function registrarLectura({ punto, fuente, servicioActivo }) {
    if (!fuenteDebeGrabar(fuente, { servicioActivo })) return { motivo: 'fuente_inactiva' };

    const { motivo, toca } = await enCola(async () => {
      const ultimo = await almacen.leerUltimo();
      const evaluacion = evaluarLectura(punto, ultimo);
      if (!evaluacion.aceptar) return { motivo: evaluacion.motivo, toca: false };
      await almacen.escribirUltimo({ viajeId: punto.viajeId, ts: punto.ts, lat: punto.lat, lng: punto.lng });
      const buffer = agregarAlBuffer(await leerBuffer(), punto);
      await almacen.escribirBuffer(buffer);
      return { motivo: evaluacion.motivo, toca: debeDescargar(buffer, reloj.ahora()) };
    });

    // Fuera de la cola: la red no frena el registro de otras lecturas.
    if (!toca) return { motivo };
    return { motivo, descarga: await descargar() };
  }

  return { registrarLectura, descargar, pendientes };
}
