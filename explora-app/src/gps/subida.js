/**
 * =============================================================================
 * subida.js — Subida de puntos GPS, consulta del viaje y token, por XHR
 * =============================================================================
 *
 * PROPÓSITO
 * Implementa las dos dependencias de red del gestor de GPS
 * (`crearGestorGPS`, portal/src/shared/logica-gps.js): `enviarLoteRest` sube un
 * lote con el `commit` de la API REST de Firestore y `consultarEstadoViajeRest`
 * lee el estado del viaje. También obtiene el ID token de Firebase Auth sin
 * usar la red del SDK. Todo pasa por `pedirHttp`, un `XMLHttpRequest` con
 * `xhr.timeout`.
 *
 * -----------------------------------------------------------------------------
 * MODELO DE DATOS
 * -----------------------------------------------------------------------------
 * Escribe (vía `armarCommitRest`, ver logica-gps.js):
 *   viajes/{viajeId}/gps_puntos/{ts}  lat, lng, ts, precision, velocidad
 *   viajes/{viajeId}                  ultima_lat, ultima_lng, ultima_ts,
 *                                     puntos_registrados (increment),
 *                                     actualizado_en (hora del servidor)
 * Lee: viajes/{viajeId}.estado (solo ese campo, con `mask.fieldPaths`).
 * AsyncStorage `explora:gps_token`: `{ token, expiraMs, uid }`, cache del ID
 * token. Vive en el mismo teléfono que la sesión persistida de Firebase Auth.
 *
 * -----------------------------------------------------------------------------
 * ARQUITECTURA / DECISIONES DE DISEÑO — TrackEx v1.1.2 — GPS
 * -----------------------------------------------------------------------------
 * SÍNTOMA: el 24/11/2026 los puntos capturados con la pantalla apagada
 *   (14:42 a 03:19) llegaron todos juntos a las 03:20, cuando el chofer abrió
 *   la app. No hubo error ni log.
 * CAUSA RAÍZ: con la app en segundo plano React Native pausa los timers de JS
 *   (`JavaTimerManager.kt`, RN 0.85) salvo mientras corre una headless task, y
 *   expo-task-manager 56.0.22 solo la registra mientras procesa un evento de
 *   ubicación (`TaskService.java`). El SDK web de Firestore depende de timers
 *   para conectar y reintentar: sus escrituras quedaban pendientes, y una
 *   escritura sin confirmar no falla.
 * ALCANCE: este archivo reemplaza, para la app, a `registrarPuntos` (SDK) y a
 *   la lectura `getDoc` del viaje que hacía la descarga del buffer de la v1.1.1.
 * DECISIONES:
 *   1. XHR CON `xhr.timeout`, NO `fetch`. React Native pasa `xhr.timeout` a
 *      OkHttp como `callTimeout` (NetworkingModule.kt): lo corta el lado
 *      nativo y funciona aunque los timers de JS estén pausados. El abort de
 *      `fetch` con `AbortController` depende de un `setTimeout`.
 *   2. EL TIMEOUT NATIVO GANA AL DEL GESTOR: `TIMEOUT_SUBIDA_MS - 2000`. El
 *      reloj del gestor (`setTimeout`) queda como segunda red de seguridad.
 *   3. TOKEN SIN LA RED DEL SDK: cache propia con margen de 5 minutos y
 *      renovación por XHR contra `securetoken.googleapis.com`. `sembrarToken`
 *      llena la cache con la app abierta, para que la primera subida en
 *      segundo plano no tenga que renovar.
 * LIMITACIONES CONOCIDAS:
 *   - `auth.authStateReady()` NO es solo lectura de disco: al inicializar,
 *     Firebase Auth recarga el usuario persistido contra la red
 *     (`reloadAndSetCurrentUserOrClear` → `_reloadWithoutSaving`). Por eso se
 *     espera con un tope (`TOPE_AUTH_MS`). Dentro del callback de la tarea los
 *     timers corren (headless task), así que el tope funciona.
 *   - La renovación del token por XHR no actualiza el usuario del SDK: el SDK
 *     sigue con su propio token y lo renueva él cuando la app está abierta.
 *     Son dos tokens válidos del mismo usuario; no hay conflicto.
 *   - Si el refresh token fue revocado (usuario deshabilitado o borrado), la
 *     renovación da 400 y la subida queda en `SESION` con el buffer intacto
 *     hasta que el chofer vuelva a iniciar sesión.
 * CÓMO SE VERIFICA: en `app_logs` no aparecen `gps_subida_error` con
 *   `red_o_timeout` en ráfaga con red buena, y en `viajes/{id}/gps_puntos`
 *   los puntos de la pantalla apagada llegan con pocos minutos de atraso
 *   respecto de su `ts` (ver `informe-viajes.js`).
 *
 * -----------------------------------------------------------------------------
 * DEPENDENCIAS Y ENTORNO
 * -----------------------------------------------------------------------------
 * React Native 0.85 (XMLHttpRequest), firebase 12.15 (`auth.authStateReady`,
 * `auth.currentUser.refreshToken`, `auth.app.options`),
 * @react-native-async-storage/async-storage 2.2.0. NO importa
 * `firebase/firestore`. Se prueba solo en un build de EAS: en Expo Go no hay
 * GPS en segundo plano.
 * =============================================================================
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '../config/firebase';
import {
  armarCommitRest, urlCommitRest, urlDocumentoRest, clasificarRespuesta,
  leerEstadoViajeRest, RESULTADO_SUBIDA, TIMEOUT_SUBIDA_MS,
} from '../compartido';

/** Clave de AsyncStorage de la cache del ID token: `{ token, expiraMs, uid }`. */
const KEY_TOKEN = 'explora:gps_token';

/**
 * Vida mínima que tiene que quedarle al token cacheado para usarlo: 5 minutos.
 * Un ID token dura una hora; con 5 minutos de margen un pedido que tarda (hasta
 * 18 s) o un reloj del teléfono algo corrido no llegan con el token vencido.
 */
const MARGEN_TOKEN_MS = 5 * 60 * 1000;

/**
 * Timeout nativo de cada pedido: 2 s menos que `TIMEOUT_SUBIDA_MS` (20 s), para
 * que siempre venza antes el de OkHttp que el reloj del gestor. Así el pedido
 * se corta de verdad (el del gestor solo deja de esperarlo).
 */
const TIMEOUT_HTTP_MS = TIMEOUT_SUBIDA_MS - 2000;

/**
 * Tope de espera de `auth.authStateReady()`: 10 s. La inicialización de Auth
 * recarga el usuario por red (ver LIMITACIONES); sin red, el propio SDK corta
 * a los 30 s. 10 s deja margen dentro del límite de la subida y, si vence, el
 * lote queda en `SESION` con el buffer intacto para el próximo intento.
 */
const TOPE_AUTH_MS = 10000;

/**
 * Pedido HTTP por `XMLHttpRequest` con timeout nativo. NUNCA LANZA.
 *
 * Por qué XHR y no `fetch`: ver la decisión 1 de la cabecera. `onerror`,
 * `ontimeout` y `onabort` llegan como eventos nativos, sin depender de timers
 * de JS.
 *
 * @param {Object} params
 * @param {string} params.metodo 'GET' | 'POST'.
 * @param {string} params.url
 * @param {Object<string,string>} [params.encabezados]
 * @param {string|null} [params.cuerpo] Cuerpo ya serializado.
 * @param {number} params.timeoutMs Timeout nativo en ms.
 * @returns {Promise<{status: number, cuerpo: Object|null}>} `status` 0 si hubo
 *   error de red o venció el timeout; `cuerpo` es el JSON parseado o `null`.
 */
export function pedirHttp({ metodo, url, encabezados = {}, cuerpo = null, timeoutMs }) {
  return new Promise((resolver) => {
    let terminado = false;
    const terminar = (status, texto) => {
      if (terminado) return;
      terminado = true;
      let json = null;
      try {
        json = texto ? JSON.parse(texto) : null;
      } catch (e) {
        json = null;
      }
      resolver({ status, cuerpo: json });
    };

    try {
      const xhr = new XMLHttpRequest();
      xhr.open(metodo, url);
      xhr.timeout = timeoutMs;
      Object.keys(encabezados).forEach((clave) => xhr.setRequestHeader(clave, encabezados[clave]));
      xhr.onload = () => terminar(xhr.status, xhr.responseText);
      xhr.onerror = () => terminar(0, null);
      xhr.ontimeout = () => terminar(0, null);
      xhr.onabort = () => terminar(0, null);
      xhr.send(cuerpo);
    } catch (e) {
      terminar(0, null);
    }
  });
}

/**
 * Espera una promesa con un tope. Usa `setTimeout`: solo sirve donde los
 * timers corren (UI abierta o dentro del callback de la tarea).
 *
 * @param {Promise} promesa
 * @param {number} ms
 * @returns {Promise<boolean>} `true` si la promesa terminó antes del tope.
 */
function terminaAntesDe(promesa, ms) {
  return Promise.race([
    Promise.resolve(promesa).then(() => true, () => true),
    new Promise((resolver) => setTimeout(() => resolver(false), ms)),
  ]);
}

/** Lee la cache del token; `null` si no hay o está corrupta. */
async function leerCacheToken() {
  try {
    const crudo = await AsyncStorage.getItem(KEY_TOKEN);
    const c = crudo ? JSON.parse(crudo) : null;
    return c && typeof c.token === 'string' && Number.isFinite(c.expiraMs) && c.uid ? c : null;
  } catch (e) {
    return null;
  }
}

/** Guarda la cache del token. Nunca lanza: sin cache, se renueva la próxima vez. */
async function guardarCacheToken(valor) {
  try {
    await AsyncStorage.setItem(KEY_TOKEN, JSON.stringify(valor));
  } catch (e) {
    console.warn('gps token: no se pudo guardar la cache', e?.message || e);
  }
}

/**
 * Invalida la cache del token. Se llama ante un 401: el próximo intento
 * renueva en vez de reusar un token que el servidor ya rechazó.
 *
 * @returns {Promise<void>}
 */
export async function invalidarToken() {
  await AsyncStorage.removeItem(KEY_TOKEN).catch(() => {});
}

/**
 * Siembra la cache con el token del SDK. Se llama desde la UI, con la app
 * abierta (los timers corren y el SDK de Auth funciona normalmente), para que
 * la primera subida en segundo plano no tenga que renovar por red.
 *
 * Nunca lanza: es una optimización.
 *
 * @param {import('firebase/auth').User|null} user `auth.currentUser`.
 * @returns {Promise<void>}
 */
export async function sembrarToken(user) {
  if (!user) return;
  try {
    const resultado = await user.getIdTokenResult();
    const expiraMs = new Date(resultado.expirationTime).getTime();
    if (!resultado.token || !Number.isFinite(expiraMs)) return;
    await guardarCacheToken({ token: resultado.token, expiraMs, uid: user.uid });
  } catch (e) {
    console.warn('gps token: no se pudo sembrar', e?.code || e?.message || e);
  }
}

/**
 * Obtiene un ID token válido sin usar la red del SDK de Auth, con el detalle
 * de por qué no lo consiguió (para el log de la subida).
 *
 * Pasos:
 *   1. `auth.authStateReady()` con tope, para saber qué usuario hay (la cache
 *      solo vale para el mismo `uid`).
 *   2. Cache con más de `MARGEN_TOKEN_MS` de vida → la usa.
 *   3. Si no, renueva con el refresh token por XHR. Formato verificado contra
 *      la doc oficial de la API REST de Firebase Auth, "Exchange a refresh
 *      token for an ID token" (https://firebase.google.com/docs/reference/rest/auth):
 *      POST `https://securetoken.googleapis.com/v1/token?key=[API_KEY]`,
 *      `application/x-www-form-urlencoded`, cuerpo
 *      `grant_type=refresh_token&refresh_token=...`; responde en snake_case
 *      `{ expires_in: "3600" (string), token_type, refresh_token, id_token,
 *      user_id, project_id }`.
 *
 * @returns {Promise<{token: string|null, detalle: string|null}>}
 */
async function obtenerTokenConDetalle() {
  const listo = await terminaAntesDe(auth.authStateReady(), TOPE_AUTH_MS);
  const user = auth.currentUser;
  if (!user) return { token: null, detalle: listo ? 'sin_sesion' : 'auth_no_lista' };

  const ahora = Date.now();
  const cache = await leerCacheToken();
  if (cache && cache.uid === user.uid && cache.expiraMs - ahora > MARGEN_TOKEN_MS) {
    return { token: cache.token, detalle: null };
  }

  const apiKey = auth.app.options.apiKey;
  const refresco = user.refreshToken;
  if (!apiKey || !refresco) return { token: null, detalle: 'sin_refresh_token' };

  const r = await pedirHttp({
    metodo: 'POST',
    url: `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`,
    encabezados: { 'Content-Type': 'application/x-www-form-urlencoded' },
    cuerpo: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresco)}`,
    timeoutMs: TIMEOUT_HTTP_MS,
  });
  if (r.status === 0) return { token: null, detalle: 'token_red_o_timeout' };

  const idToken = r.cuerpo && r.cuerpo.id_token;
  const segundos = Number(r.cuerpo && r.cuerpo.expires_in);
  if (r.status !== 200 || typeof idToken !== 'string' || !Number.isFinite(segundos)) {
    const motivo = (r.cuerpo && r.cuerpo.error && r.cuerpo.error.message) || `http_${r.status}`;
    return { token: null, detalle: `token_rechazado: ${motivo}` };
  }

  await guardarCacheToken({ token: idToken, expiraMs: ahora + segundos * 1000, uid: user.uid });
  return { token: idToken, detalle: null };
}

/**
 * ID token válido, o `null` si no hay sesión o no se pudo renovar. Ver
 * `obtenerTokenConDetalle` para los pasos y la referencia de la API.
 *
 * @returns {Promise<string|null>}
 */
export async function obtenerToken() {
  return (await obtenerTokenConDetalle()).token;
}

/**
 * `enviarLote` del gestor: sube un lote con el `commit` REST.
 *
 * Nunca lanza. `SIN_RED` si el pedido no llegó o venció el timeout nativo;
 * `SESION` si no hay token (el gestor conserva el buffer); si no, lo que diga
 * `clasificarRespuesta`. Ante un 401 se invalida la cache del token, para que
 * el próximo intento renueve.
 *
 * @param {{viajeId: string, puntos: Array}} lote
 * @returns {Promise<{resultado: string, detalle: string|null}>}
 */
export async function enviarLoteRest({ viajeId, puntos }) {
  const { token, detalle } = await obtenerTokenConDetalle();
  if (!token) return { resultado: RESULTADO_SUBIDA.SESION, detalle: detalle || 'sin_sesion' };

  const projectId = auth.app.options.projectId;
  const r = await pedirHttp({
    metodo: 'POST',
    url: urlCommitRest(projectId),
    encabezados: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cuerpo: JSON.stringify(armarCommitRest({ projectId, viajeId, puntos })),
    timeoutMs: TIMEOUT_HTTP_MS,
  });

  if (r.status === 0) return { resultado: RESULTADO_SUBIDA.SIN_RED, detalle: 'red_o_timeout' };
  if (r.status === 401) await invalidarToken();
  return {
    resultado: clasificarRespuesta(r.status, r.cuerpo),
    detalle: (r.cuerpo && r.cuerpo.error && r.cuerpo.error.status) || null,
  };
}

/**
 * `consultarEstadoViaje` del gestor: estado del viaje por GET REST.
 *
 * Pide solo el campo `estado` (`mask.fieldPaths`), con el mismo token y
 * timeout que la subida.
 *
 * @param {string} viajeId
 * @returns {Promise<string|null>} El estado, o `null` si el viaje no existe
 *   (404).
 * @throws {Error} En cualquier otro caso (sin red, sin sesión, 403, 5xx): el
 *   gestor lo toma como "no se sabe" y CONSERVA el buffer.
 */
export async function consultarEstadoViajeRest(viajeId) {
  const { token, detalle } = await obtenerTokenConDetalle();
  if (!token) throw new Error(detalle || 'sin_sesion');

  const projectId = auth.app.options.projectId;
  const r = await pedirHttp({
    metodo: 'GET',
    url: `${urlDocumentoRest(projectId, `viajes/${viajeId}`)}?mask.fieldPaths=estado`,
    encabezados: { Authorization: `Bearer ${token}` },
    timeoutMs: TIMEOUT_HTTP_MS,
  });

  if (r.status === 404) return null;
  if (r.status === 200) return leerEstadoViajeRest(r.cuerpo);
  if (r.status === 401) await invalidarToken();
  throw new Error(r.status === 0 ? 'red_o_timeout' : `http_${r.status}`);
}
