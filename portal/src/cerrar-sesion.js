/* =============================================================================
 * cerrar-sesion.js — Portal Explora
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * v1.2.7 — LECTURAS COMPARTIDAS
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Con la caché persistente de v1.2.7 (`firebase.js`) y las suscripciones
 *     compartidas (`suscripciones-compartidas.js`), un logout que solo hiciera
 *     `signOut` dejaría suscripciones vivas y documentos cacheados en
 *     IndexedDB al alcance del usuario siguiente.
 *
 *   CAUSA RAÍZ
 *     Ambas cosas sobreviven a `signOut`: las suscripciones viven en un
 *     módulo, no en las pantallas, y la caché vive en el disco del navegador.
 *
 *   ALCANCE
 *     1. `cerrarSesionCompleta()`, en este orden: `cerrarTodasLasSuscripciones()`,
 *        `signOut`, `terminate(db)`, `clearIndexedDbPersistence(db)` y
 *        `window.location.reload()` (la instancia de Firestore terminada no
 *        se puede volver a usar; la recarga crea una nueva).
 *     2. Vive en su propio módulo para no crear un import circular:
 *        `suscripciones-compartidas.js` importa `db` de `firebase.js`.
 *     3. Cada paso va en su try/catch: si uno falla se avisa con
 *        `console.warn` y se sigue, para que el logout termine SIEMPRE en la
 *        recarga. `clearIndexedDbPersistence` además tiene un tiempo límite
 *        (`LIMITE_BORRADO_MS`): si queda bloqueado, se avisa y se recarga.
 *     4. Bandera de módulo `cierreIniciadoAca` (consultada con
 *        `cierreIniciadoEnEstaPestana()`), que se levanta antes de cerrar nada.
 *        `App.js` recarga las pestañas que se enteran de un logout hecho en
 *        OTRA pestaña; con la bandera, la pestaña que inició el cierre no
 *        recarga a mitad del proceso (lo hace este módulo al final).
 *
 *   LIMITACIONES CONOCIDAS
 *     - Otras pestañas abiertas del portal: verificado en el SDK instalado
 *       (@firebase/firestore 4.14.1), `clearIndexedDbPersistence` NO falla
 *       por eso. Borra la base con `indexedDB.deleteDatabase`; las demás
 *       pestañas reciben `versionchange` y hacen `terminate()` de su
 *       Firestore (`setDatabaseDeletedListener`). Desde (4), esas pestañas se
 *       recargan solas al enterarse del logout (`App.js`), así que vuelven a
 *       Login con una instancia nueva. Queda una carrera teórica: si una
 *       pestaña recargada usara Firestore antes de que termine el borrado, se
 *       volvería a terminar; en Login no se usa Firestore hasta iniciar
 *       sesión, así que en la práctica no pasa (y F5 lo arregla). Si alguna
 *       pestaña no libera la base, `deleteDatabase` queda bloqueado: a los
 *       `LIMITE_BORRADO_MS` se avisa y se recarga igual (la caché queda; la
 *       borra el próximo logout).
 *     - (4) también recarga la pestaña cuando la sesión termina por otra
 *       causa que no sea este módulo (sesión vencida o revocada): se ve una
 *       recarga antes del Login, en vez de pasar directo.
 *     - `terminate` no cancela escrituras pendientes, pero el borrado de la
 *       caché SÍ las descarta: una escritura hecha sin conexión y todavía no
 *       enviada se pierde si se cierra sesión antes de recuperar la red.
 *     - Las salidas que no pasan por acá (cerrar el navegador sin logout,
 *       sesión vencida) no borran la caché. `App.js` cierra igual las
 *       suscripciones cuando Auth informa que no hay usuario o que cambió.
 *
 *   CÓMO SE VERIFICA
 *     Cerrar sesión desde la barra superior: la página se recarga en Login y
 *     en DevTools → Application → IndexedDB ya no está
 *     `firestore/[DEFAULT]/<proyecto>/main`. Con dos pestañas abiertas: la
 *     otra queda en Login y en la consola de la que cerró sesión no hay
 *     errores (a lo sumo el warning del borrado).
 * ========================================================================== */

import { signOut } from 'firebase/auth';
import { terminate, clearIndexedDbPersistence } from 'firebase/firestore';
import { auth, db } from './firebase';
import { cerrarTodasLasSuscripciones } from './suscripciones-compartidas';

export const LIMITE_BORRADO_MS = 5000;

// v1.2.7 (4): bandera de módulo -- "el cierre lo inició ESTA pestaña". La
// levanta `cerrarSesionCompleta()` antes de cerrar nada; `App.js` la consulta
// para no recargar a mitad del proceso (la recarga la hace este módulo al
// final). La página se recarga siempre después, así que nunca se baja.
let cierreIniciadoAca = false;

/** v1.2.7 (4): true si `cerrarSesionCompleta()` ya arrancó en esta pestaña. */
export function cierreIniciadoEnEstaPestana() {
  return cierreIniciadoAca;
}

function conLimite(promesa, ms, mensaje) {
  let id;
  const limite = new Promise((_, rechazar) => {
    id = setTimeout(() => rechazar(new Error(mensaje)), ms);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(id));
}

/** v1.2.7 (1): logout que no deja suscripciones ni caché de la sesión. */
export async function cerrarSesionCompleta() {
  cierreIniciadoAca = true; // v1.2.7 (4): antes de cerrar nada.
  // v1.2.7 (3): cada paso en su try/catch; el logout siempre llega a la recarga.
  try {
    cerrarTodasLasSuscripciones();
  } catch (err) {
    console.warn('Cerrar sesión: no se pudieron cerrar las suscripciones:', err);
  }
  try {
    await signOut(auth);
  } catch (err) {
    console.warn('Cerrar sesión: signOut falló:', err);
  }
  try {
    await terminate(db);
  } catch (err) {
    console.warn('Cerrar sesión: terminate falló:', err);
  }
  try {
    await conLimite(
      clearIndexedDbPersistence(db),
      LIMITE_BORRADO_MS,
      'el borrado de la caché no terminó (¿otra pestaña del portal abierta?)'
    );
  } catch (err) {
    console.warn('Cerrar sesión: no se pudo borrar la caché local de Firestore; se recarga igual.', err);
  }
  window.location.reload();
}
