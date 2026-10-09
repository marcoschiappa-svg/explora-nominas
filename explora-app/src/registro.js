/**
 * =============================================================================
 * registro.js — Log remoto liviano de la app
 * =============================================================================
 *
 * PROPÓSITO
 * Contiene `logApp`, que escribe eventos en la colección `app_logs` de
 * Firestore. Se extrajo de ChoferScreen.js para que también lo usen otros
 * módulos (notificaciones.js, avisos.js) sin depender de una pantalla. El
 * comportamiento es EXACTAMENTE el que tenía allá.
 *
 * MODELO DE DATOS (escribe `app_logs/{autoId}`)
 *   evento       string  — identificador en snake_case
 *   ts           string  — ISO 8601 del momento del evento
 *   plataforma   string  — 'android' | 'ios'
 *   version_os   string  — versión del sistema operativo
 *   ...extra     campos adicionales que pase quien llama (códigos, ids)
 *
 * REQUIERE una regla de Firestore que permita `create` en `app_logs`
 * (`allow create: if logueado()`), o todo el logging remoto falla en silencio.
 * =============================================================================
 */

import { Platform } from 'react-native';
import { collection, addDoc } from 'firebase/firestore';
import { db } from './config/firebase';

/**
 * Log remoto liviano a la colección `app_logs` de Firestore.
 *
 * MOTIVO: los `catch` genéricos del código anterior descartaban `err.code`, y en
 * un build de release no hay consola. Diagnosticar una falla exigía tener el
 * teléfono del chofer en la mano. Con 12 testers y creciendo, eso no escala.
 *
 * Se traga sus propios errores A PROPÓSITO: el logging jamás debe poder romper
 * el flujo que está intentando observar.
 *
 * @param {string} evento Identificador del evento, en snake_case.
 * @param {Object} [extra] Campos adicionales a adjuntar (códigos, ids, etc.).
 * @returns {Promise<void>}
 */
export async function logApp(evento, extra = {}) {
  try {
    await addDoc(collection(db, 'app_logs'), {
      evento,
      ts: new Date().toISOString(),
      plataforma: Platform.OS,
      version_os: String(Platform.Version),
      ...extra,
    });
  } catch (e) {
    console.warn('app_logs error:', e?.code || e?.message || e);
  }
}
