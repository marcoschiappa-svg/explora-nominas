/**
 * =============================================================================
 * registro.js — Log remoto liviano de la app
 * =============================================================================
 *
 * PROPÓSITO
 * Contiene `logApp`, que escribe eventos en la colección `app_logs` de
 * Firestore. Se extrajo de ChoferScreen.js para que también lo usen otros
 * módulos (notificaciones.js, avisos.js, src/gps/) sin depender de una
 * pantalla.
 *
 * MODELO DE DATOS (escribe `app_logs/{autoId}`)
 *   evento       string  — identificador en snake_case
 *   ts           string  — ISO 8601 del momento del evento
 *   plataforma   string  — 'android' | 'ios'
 *   version_os   string  — versión del sistema operativo
 *   version_app  string  — versión de TrackEx (`Constants.expoConfig.version`,
 *                          app.json). Los logs SIN este campo vienen de la
 *                          v1.1.0 o anterior: sirve para identificar a quienes
 *                          todavía no actualizaron.
 *   ...extra    campos adicionales que pase quien llama (códigos, ids)
 *
 * ARQUITECTURA
 * `logApp` LANZA la escritura y devuelve enseguida (ver el historial). El
 * `ts` se toma al llamar, no cuando la escritura llega al servidor: un log
 * encolado sin red conserva la hora real del evento.
 *
 * HISTORIAL DE CORRECCIONES
 *   TrackEx v1.1.2 — GPS (consecuencia C del prompt 2). SÍNTOMA: en segundo
 *   plano, la tarea de GPS podía quedar trabada esperando un log. CAUSA RAÍZ:
 *   `logApp` hacía `await addDoc(...)`. Con la app en segundo plano, React
 *   Native pausa los timers de JS (`JavaTimerManager.kt`) salvo mientras corre
 *   una headless task, y el SDK web de Firestore depende de esos timers para
 *   conectar y reintentar: la escritura quedaba pendiente, sin fallar, y el
 *   `await` no volvía nunca. Si la subida de GPS esperaba un log así, quedaba
 *   trabada para siempre. CORRECCIÓN: `logApp` lanza `addDoc` con su propio
 *   `.catch` y devuelve una promesa ya resuelta. La firma no cambia: los
 *   `await logApp(...)` existentes siguen funcionando y dejan de bloquear.
 *   LIMITACIÓN: si el proceso muere con la escritura encolada, ese log se
 *   pierde (el SDK sin persistencia offline lo tiene solo en memoria). Antes
 *   se perdía igual, pero además bloqueaba.
 *
 * REQUIERE una regla de Firestore que permita `create` en `app_logs`
 * (`allow create: if logueado()`), o todo el logging remoto falla en silencio.
 * =============================================================================
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { collection, addDoc } from 'firebase/firestore';
import { db } from './config/firebase';

/**
 * Log remoto liviano a la colección `app_logs` de Firestore.
 *
 * MOTIVO: los `catch` genéricos del código anterior descartaban `err.code`, y en
 * un build de release no hay consola. Diagnosticar una falla exigía tener el
 * teléfono del chofer en la mano. Con 12 testers y creciendo, eso no escala.
 *
 * NO ESPERA la escritura (TrackEx v1.1.2, ver el historial): lanza `addDoc` y
 * devuelve una promesa ya resuelta. Se traga sus propios errores A PROPÓSITO:
 * el logging jamás debe poder romper ni frenar el flujo que está observando.
 *
 * @param {string} evento Identificador del evento, en snake_case.
 * @param {Object} [extra] Campos adicionales a adjuntar (códigos, ids, etc.).
 * @returns {Promise<void>} Siempre resuelta, sin esperar al servidor.
 */
export function logApp(evento, extra = {}) {
  try {
    addDoc(collection(db, 'app_logs'), {
      evento,
      ts: new Date().toISOString(),
      plataforma: Platform.OS,
      version_os: String(Platform.Version),
      version_app: Constants.expoConfig?.version || '',
      ...extra,
    }).catch((e) => {
      console.warn('app_logs error:', e?.code || e?.message || e);
    });
  } catch (e) {
    // `collection`/`addDoc` pueden lanzar sincrónicamente (por ejemplo, un
    // campo `undefined` en `extra`): mismo criterio, nunca rompe.
    console.warn('app_logs error:', e?.code || e?.message || e);
  }
  return Promise.resolve();
}
