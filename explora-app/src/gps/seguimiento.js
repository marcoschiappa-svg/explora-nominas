/**
 * =============================================================================
 * seguimiento.js — Almacén, gestor y procesamiento de lecturas GPS de la app
 * =============================================================================
 *
 * PROPÓSITO
 * Todo lo de GPS que no es pantalla: las claves de AsyncStorage, el almacén
 * del buffer (con la migración del formato de la v1.1.1), el gestor único de
 * este contexto JS, el punto de entrada común de las lecturas
 * (`procesarUbicaciones`) y el arranque, rearranque y parada del servicio de
 * segundo plano. Lo usan la tarea (`tarea.js`) y `ChoferScreen.js`.
 *
 * -----------------------------------------------------------------------------
 * MODELO DE DATOS (AsyncStorage)
 * -----------------------------------------------------------------------------
 *   explora:viaje_activo      `{ viajeId }` del viaje EN_VIAJE, o ausente. Lo
 *                             escribe ChoferScreen (EFECTO 3). Antes de la
 *                             v1.1.0 tenía la forma `{ docId, despachoIdx,
 *                             pedidoId }`: esa forma se descarta (ver
 *                             `leerViajeActivo`).
 *   explora:gps_buffer        `[{ viajeId, ts (ms), lat, lng, precision,
 *                             velocidad }]`, ordenado por `ts`. La v1.1.1
 *                             guardaba `[{ lat, lng, ts: ISO }]` sin viaje:
 *                             se migra al leer (ver `leerBuffer`).
 *   explora:gps_ultimo_punto  `{ viajeId, ts (ms), lat, lng }`, último punto
 *                             aceptado (filtros de velocidad y duplicados).
 *                             El de la v1.1.1 (`ts` ISO, sin viaje) se ignora
 *                             solo: `evaluarLectura` descarta un último de otro
 *                             viaje.
 *   explora:gps_token         cache del ID token (la maneja `subida.js`).
 * En Firestore no escribe nada directo: la subida es de `subida.js` y los
 * logs de `registro.js`.
 *
 * -----------------------------------------------------------------------------
 * TrackEx v1.1.2 — GPS
 * -----------------------------------------------------------------------------
 * SÍNTOMA: el 24/11/2026 la traza de la pantalla apagada subió horas tarde,
 *   todo junto; hubo lotes rechazados enteros con `permission-denied`
 *   (errores de descarga en ráfaga, con `puntos_pendientes` creciendo de a
 *   uno) y puntos con la hora equivocada.
 * CAUSA RAÍZ:
 *   A. La subida usaba el SDK de Firestore, que en segundo plano queda
 *      esperando sin fallar (timers de JS pausados). → `subida.js`.
 *   B. Primer y segundo plano grababan la misma lectura; descargas
 *      superpuestas mandaban puntos repetidos y una descarga exitosa vaciaba
 *      el buffer entero. → el gestor de `logica-gps.js`, ÚNICO por contexto.
 *   D. El punto se sellaba con `new Date()` al procesarlo y no con el
 *      `timestamp` de la lectura. → `normalizarLectura(loc)` con el objeto
 *      entero.
 *   Además, la tarea se definía dentro de ChoferScreen.js: solo quedaba
 *   definida cuando se importaba la pantalla. → `tarea.js`, importado
 *   primero en `index.js`.
 * ALCANCE: reemplaza las funciones de ámbito de módulo de ChoferScreen.js
 *   v1.1.1 que registraban cada lectura, descargaban el buffer con el SDK y
 *   migraban el estado local al montar, y las copias locales de las
 *   constantes de GPS. El nombre de la tarea (`GPS_TASK`) y las opciones del
 *   servicio NO cambian.
 * LIMITACIONES CONOCIDAS:
 *   - Gestor único por CONTEXTO JS: la tarea puede correr en un contexto sin
 *     React con su propio gestor. Ver la cabecera de logica-gps.js.
 *   - `limpiarEstadoLocalGPS` ya no borra el buffer: puede tener puntos de un
 *     viaje anterior todavía pendientes. Los sube o descarta el gestor.
 *   - `hasStartedLocationUpdatesAsync` informa si la tarea está registrada.
 *     Si el sistema mató el proceso del servicio sin dar de baja la tarea,
 *     puede seguir dando `true` y `asegurarServicio` no rearranca. Se ve en el
 *     teléfono (ver el informe del prompt 2).
 * CÓMO SE VERIFICA: en `app_logs` aparecen `gps_migracion_buffer` (una vez por
 *   teléfono que actualiza con puntos pendientes) y `gps_servicio_reiniciado`
 *   al volver a la app si el sistema había cortado el servicio; en
 *   `gps_puntos`, cada lectura una sola vez y con su hora real.
 *
 * -----------------------------------------------------------------------------
 * DEPENDENCIAS Y ENTORNO
 * -----------------------------------------------------------------------------
 * expo-location ~56.0.21 (`hasStartedLocationUpdatesAsync`,
 * `startLocationUpdatesAsync`, `stopLocationUpdatesAsync`,
 * `getBackgroundPermissionsAsync`), @react-native-async-storage/async-storage
 * 2.2.0. NO importa `firebase/firestore`. Tiene que funcionar en el contexto
 * de segundo plano donde React nunca se montó: nada de estado de React acá.
 * El GPS en segundo plano no funciona en Expo Go: hace falta un build de EAS.
 * =============================================================================
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { logApp } from '../registro';
import {
  crearGestorGPS, normalizarLectura, migrarBufferViejo, FUENTE,
  GPS_INTERVALO_MS, GPS_DISTANCIA_M, colorEstado,
} from '../compartido';
import { enviarLoteRest, consultarEstadoViajeRest } from './subida';

/**
 * Identificador de la tarea de segundo plano registrada en TaskManager.
 * Debe ser único en toda la app y ESTABLE entre versiones: si cambia, la tarea
 * registrada por la v1.1.1 queda huérfana y corriendo.
 */
export const GPS_TASK = 'explora-gps-task';

/* -----------------------------------------------------------------------------
 * CLAVES DE ASYNCSTORAGE
 *
 * Por qué disco y no memoria: la tarea de segundo plano puede ejecutarse en un
 * contexto JS donde el componente React nunca se montó. Cualquier variable de
 * módulo o de componente llega vacía ahí. AsyncStorage es el único canal que
 * sobrevive a ese reinicio de contexto. Mismas claves que la v1.1.1.
 * -------------------------------------------------------------------------- */

/** Viaje en curso: `{ viajeId }` o ausente. */
export const KEY_VIAJE_ACTIVO = 'explora:viaje_activo';

/** Buffer de puntos pendientes de subir (ver la cabecera). */
export const KEY_BUFFER_GPS = 'explora:gps_buffer';

/** Último punto aceptado (ver la cabecera). */
export const KEY_ULTIMO_PUNTO = 'explora:gps_ultimo_punto';

/**
 * Notificación del servicio de segundo plano. Mismos textos, color y
 * `killServiceOnDestroy: false` que la v1.1.1 (estaban en
 * `arrancarTareaBackground` de ChoferScreen). `killServiceOnDestroy: false`
 * mantiene el seguimiento si el chofer saca la app de recientes; el
 * comportamiento real varía por fabricante (dontkillmyapp.com).
 */
export const NOTIFICACION_SERVICIO = {
  notificationTitle: 'TrackEx · viaje en curso',
  notificationBody: 'Se registra el recorrido hasta que finalices el viaje.',
  notificationColor: colorEstado.acentoVerde,
  killServiceOnDestroy: false,
};

/* =============================================================================
 * UTILIDADES DE ALMACENAMIENTO
 * ========================================================================== */

/**
 * Lee y deserializa un valor de AsyncStorage.
 *
 * Nunca lanza: si la clave no existe, el JSON está corrupto o el storage falla,
 * devuelve el valor por defecto. Un error de storage no debe poder tumbar la
 * tarea de GPS ni el flujo del chofer.
 *
 * @param {string} clave Clave de AsyncStorage.
 * @param {*} porDefecto Valor a devolver si no hay dato utilizable.
 * @returns {Promise<*>} El valor deserializado o `porDefecto`.
 */
export async function leerJSON(clave, porDefecto) {
  try {
    const crudo = await AsyncStorage.getItem(clave);
    return crudo ? JSON.parse(crudo) : porDefecto;
  } catch (e) {
    return porDefecto;
  }
}

/**
 * Serializa y guarda un valor en AsyncStorage.
 *
 * Nunca lanza; ante un fallo deja constancia en consola y sigue. Perder una
 * escritura de buffer degrada la traza, no rompe el viaje.
 *
 * @param {string} clave Clave de AsyncStorage.
 * @param {*} valor Valor serializable a JSON.
 * @returns {Promise<void>}
 */
export async function escribirJSON(clave, valor) {
  try {
    await AsyncStorage.setItem(clave, JSON.stringify(valor));
  } catch (e) {
    console.warn('AsyncStorage write error:', e?.message || e);
  }
}

/**
 * `viajeId` del viaje activo guardado en disco, o `null`.
 *
 * Conserva el único caso de la migración al montar de la v1.1.1 que sigue teniendo
 * sentido: un viaje activo con la forma del modelo anterior a la v1.1.0 (sin
 * `viajeId` string) se borra y se registra `migracion_descarte`, como hasta
 * ahora. Sus puntos, si quedaran, se descartan en `leerBuffer` porque no hay
 * viaje al que asignarlos.
 *
 * @returns {Promise<string|null>}
 */
export async function leerViajeActivo() {
  const activo = await leerJSON(KEY_VIAJE_ACTIVO, null);
  if (!activo) return null;
  if (typeof activo.viajeId === 'string' && activo.viajeId) return activo.viajeId;

  await AsyncStorage.removeItem(KEY_VIAJE_ACTIVO).catch(() => {});
  logApp('migracion_descarte', { viaje_activo_viejo: 'true', buffer_viejo: 'false', puntos_descartados: 0 });
  return null;
}

/* =============================================================================
 * ALMACÉN DEL GESTOR
 *
 * Las cuatro funciones que `crearGestorGPS` recibe como `almacen`. El gestor
 * las llama SIEMPRE dentro de su cola serial, así que la migración de
 * `leerBuffer` no se pisa con un agregado o un quitado.
 * ========================================================================== */

/**
 * Lee el buffer, migrando en el momento el formato de la v1.1.1.
 *
 * Por qué acá y no en un efecto de React: la primera lectura después de
 * actualizar puede ocurrir en la tarea de segundo plano, donde ninguna
 * pantalla se montó. Si algún elemento no tiene `viajeId`, se aplica
 * `migrarBufferViejo` con el viaje activo (los puntos viejos son de ese
 * viaje: la v1.1.1 tenía un único buffer por viaje en curso), se persiste y
 * se registra `gps_migracion_buffer` SIN esperarlo.
 *
 * El `ts` migrado es `new Date(iso).getTime()`, el mismo ID de documento que
 * usó la v1.1.1: un punto que ya había subido se reescribe idéntico.
 *
 * @returns {Promise<Array>} Buffer en el formato nuevo (vacío si no hay o
 *   estaba corrupto).
 */
async function leerBuffer() {
  const buffer = await leerJSON(KEY_BUFFER_GPS, []);
  if (!Array.isArray(buffer)) {
    await escribirJSON(KEY_BUFFER_GPS, []);
    logApp('gps_migracion_buffer', { migrados: 0, descartados: 0, buffer_corrupto: 'true' });
    return [];
  }
  const viejos = buffer.filter((p) => !p || typeof p.viajeId !== 'string').length;
  if (viejos === 0) return buffer;

  const viajeId = await leerViajeActivo();
  const { buffer: nuevo, descartados } = migrarBufferViejo(buffer, viajeId);
  await escribirJSON(KEY_BUFFER_GPS, nuevo);
  logApp('gps_migracion_buffer', {
    viaje_id: viajeId || '',
    migrados: viejos - descartados,
    descartados,
  });
  return nuevo;
}

/** Escribe el buffer completo (el gestor ya lo deduplicó y recortó). */
async function escribirBuffer(buffer) {
  await escribirJSON(KEY_BUFFER_GPS, buffer);
}

/** Último punto aceptado, o `null`. */
async function leerUltimo() {
  return leerJSON(KEY_ULTIMO_PUNTO, null);
}

/** Guarda el último punto aceptado. */
async function escribirUltimo(ultimo) {
  await escribirJSON(KEY_ULTIMO_PUNTO, ultimo);
}

/* =============================================================================
 * GESTOR ÚNICO DE ESTE CONTEXTO JS
 * ========================================================================== */

/**
 * Reloj del gestor. `esperar` es la SEGUNDA red de seguridad del límite de
 * tiempo de la subida; la primera es el timeout nativo del XHR (`subida.js`),
 * que corta aunque los timers de JS estén pausados.
 */
const reloj = {
  ahora: () => Date.now(),
  esperar: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
};

/**
 * Log del gestor: lanza `logApp` y NO devuelve su promesa (consecuencia C del
 * prompt 2). El gestor espera a `registrarLog`; si esa espera dependiera de
 * Firestore, una descarga podía quedar trabada en segundo plano.
 *
 * @param {string} evento
 * @param {Object} extra
 */
function registrarLog(evento, extra) {
  logApp(evento, extra);
}

/**
 * El gestor. UNO por contexto JS, creado al importar el módulo: la cola serial
 * y la "única descarga en vuelo" solo valen si todas las fuentes de este
 * contexto (tarea, watch de primer plano, UI) usan la misma instancia.
 */
const gestor = crearGestorGPS({
  almacen: { leerBuffer, escribirBuffer, leerUltimo, escribirUltimo },
  enviarLote: enviarLoteRest,
  consultarEstadoViaje: consultarEstadoViajeRest,
  reloj,
  registrarLog,
});

/* =============================================================================
 * SERVICIO DE SEGUNDO PLANO
 * ========================================================================== */

/**
 * Gancho para que el código de este módulo (que puede correr sin React
 * montado) le pida a la pantalla que baje el watch de primer plano y apague
 * el banner. Lo registra ChoferScreen (EFECTO 5); sin pantalla queda `null`.
 */
export const ganchos = { alDescartar: null };

/**
 * Opciones de `startLocationUpdatesAsync`: las mismas de la v1.1.1.
 *
 * @param {Object} [notificacion=NOTIFICACION_SERVICIO] Opciones del
 *   `foregroundService`.
 * @returns {Object} `LocationTaskOptions` (doc de expo-location SDK 56).
 */
function opcionesServicio(notificacion = NOTIFICACION_SERVICIO) {
  return {
    accuracy: Location.Accuracy.High,
    timeInterval: GPS_INTERVALO_MS,
    distanceInterval: GPS_DISTANCIA_M,
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    foregroundService: notificacion,
  };
}

/**
 * ¿La tarea de segundo plano está corriendo? Llamada nativa local, sin red.
 * Nunca lanza: ante un error responde `false`.
 *
 * @returns {Promise<boolean>}
 */
export async function servicioActivo() {
  return Location.hasStartedLocationUpdatesAsync(GPS_TASK).catch(() => false);
}

/**
 * Arranca el servicio de segundo plano si no está corriendo.
 *
 * LANZA si `startLocationUpdatesAsync` falla: quien llama decide qué mostrar
 * (ChoferScreen muestra "Seguimiento limitado"; `asegurarServicio` lo
 * registra).
 *
 * @param {Object} [notificacion=NOTIFICACION_SERVICIO]
 * @returns {Promise<void>}
 */
export async function iniciarServicio(notificacion = NOTIFICACION_SERVICIO) {
  if (await servicioActivo()) return;
  await Location.startLocationUpdatesAsync(GPS_TASK, opcionesServicio(notificacion));
}

/**
 * Da de baja la tarea de segundo plano si estaba corriendo.
 *
 * Consulta primero con `hasStartedLocationUpdatesAsync` porque detener una
 * tarea no registrada lanza. Nunca lanza.
 *
 * @returns {Promise<void>}
 */
export async function detenerGPSBackground() {
  try {
    if (await servicioActivo()) {
      await Location.stopLocationUpdatesAsync(GPS_TASK);
    }
  } catch (err) {
    console.warn('stopLocationUpdates error:', err?.message || err);
  }
}

/**
 * Borra el viaje activo y el último punto. NO borra el buffer (TrackEx
 * v1.1.2): puede tener puntos pendientes de este u otro viaje, que el gestor
 * sube o descarta solo. La v1.1.1 lo borraba entero y perdía puntos.
 *
 * @returns {Promise<void>}
 */
export async function limpiarEstadoLocalGPS() {
  await AsyncStorage.removeItem(KEY_VIAJE_ACTIVO).catch(() => {});
  await AsyncStorage.removeItem(KEY_ULTIMO_PUNTO).catch(() => {});
}

/**
 * Reacción a un viaje que el gestor descartó (cerrado o borrado por fuera,
 * típicamente un cierre manual del coordinador). Reemplaza la rama
 * `permission-denied` de la descarga del buffer de la v1.1.1.
 *
 * Solo actúa si ese viaje sigue siendo el activo en disco: si el descartado
 * es un viaje anterior con puntos pendientes, el seguimiento del actual no se
 * toca. Los puntos de ese viaje ya los quitó el gestor (`gps_descarte`); acá
 * solo se limpian `viaje_activo` y `ultimo`, se detiene el servicio y se avisa
 * a la pantalla.
 *
 * @param {string} viajeId
 * @returns {Promise<void>}
 */
export async function alViajeDescartado(viajeId) {
  const activo = await leerViajeActivo();
  if (activo && activo !== viajeId) return;
  await limpiarEstadoLocalGPS();
  await detenerGPSBackground();
  if (ganchos.alDescartar) ganchos.alDescartar();
}

/* =============================================================================
 * PUNTOS DE ENTRADA
 * ========================================================================== */

/**
 * Punto de entrada COMÚN de las lecturas de la tarea de segundo plano y del
 * `watchPositionAsync` de primer plano: las dos aplican los mismos filtros y
 * comparten un único buffer y un único gestor.
 *
 * - `normalizarLectura` recibe el objeto ENTERO de expo-location: ahí viene
 *   `timestamp` (la hora de la lectura; defecto D).
 * - `servicioActivo`: para el segundo plano es `true` por definición; para el
 *   primer plano se consulta (llamada nativa local). Con el servicio activo el
 *   gestor ignora la copia de primer plano (`fuenteDebeGrabar`).
 * - Se espera TODO el trabajo (registrar y, si toca, subir) antes de
 *   devolver: la tarea lo espera con `await` y así la headless task mantiene
 *   vivos los timers hasta terminar (consecuencia B).
 *
 * @param {Array<Object>} locations Lecturas de expo-location (`LocationObject`).
 * @param {string} fuente Valor de `FUENTE`.
 * @returns {Promise<void>}
 */
export async function procesarUbicaciones(locations, fuente) {
  if (!Array.isArray(locations) || locations.length === 0) return;

  const viajeId = await leerViajeActivo();
  if (!viajeId) return;

  const activo = fuente === FUENTE.SEGUNDO_PLANO ? true : await servicioActivo();

  let descartado = false;
  for (const loc of locations) {
    const punto = normalizarLectura(loc, viajeId);
    if (!punto) continue;
    const r = await gestor.registrarLectura({ punto, fuente, servicioActivo: activo });
    if (r.descarga && r.descarga.viajesDescartados.includes(viajeId)) {
      descartado = true;
      break; // El viaje se cerró: las lecturas que siguen ya no tienen a dónde ir.
    }
  }

  if (descartado) await alViajeDescartado(viajeId);
}

/**
 * Sube el buffer ahora (`gestor.descargar()`), aplicando `alViajeDescartado`
 * si el viaje activo se descartó. Para la UI: al volver a primer plano, al
 * quedar sin viaje activo y antes de finalizar.
 *
 * @returns {Promise<Object>} El resultado de `descargar()` (ver logica-gps.js).
 */
export async function descargarPendientes() {
  const r = await gestor.descargar();
  const activo = await leerViajeActivo();
  if (activo && r.viajesDescartados.includes(activo)) await alViajeDescartado(activo);
  return r;
}

/**
 * Puntos de un viaje que siguen en el buffer. Lectura directa del disco, sin
 * pasar por la cola del gestor: es solo para un log (`gps_pendientes_al_finalizar`)
 * y una foto un poco desfasada no cambia nada.
 *
 * @param {string} viajeId
 * @returns {Promise<number>}
 */
export async function pendientesDeViaje(viajeId) {
  const buffer = await leerJSON(KEY_BUFFER_GPS, []);
  return Array.isArray(buffer) ? buffer.filter((p) => p && p.viajeId === viajeId).length : 0;
}

/**
 * Rearranca el servicio de segundo plano si el sistema lo cortó. Se usa al
 * volver a primer plano (EFECTO 4 de ChoferScreen).
 *
 * Caso del 24/11: el sistema cortó la captura a las 13:21 y el chofer siguió
 * viaje sin traza. Si hay viaje activo, permiso de segundo plano concedido y
 * el servicio no corre, se arranca con las mismas opciones y se registra
 * `gps_servicio_reiniciado`. Nunca lanza (un fallo se registra como
 * `gps_servicio_reinicio_error`).
 *
 * @param {Object} [opcionesNotificacion=NOTIFICACION_SERVICIO]
 * @returns {Promise<boolean>} Si el servicio quedó activo.
 */
export async function asegurarServicio(opcionesNotificacion = NOTIFICACION_SERVICIO) {
  const viajeId = await leerViajeActivo();
  if (!viajeId) return false;
  if (await servicioActivo()) return true;

  const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
  if (!bg || bg.status !== 'granted') return false;

  try {
    await iniciarServicio(opcionesNotificacion);
    logApp('gps_servicio_reiniciado', { viaje_id: viajeId });
    return true;
  } catch (err) {
    logApp('gps_servicio_reinicio_error', {
      viaje_id: viajeId,
      code: err?.code || '',
      mensaje: err?.message || '',
    });
    return false;
  }
}
