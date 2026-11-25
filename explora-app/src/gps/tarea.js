/**
 * =============================================================================
 * tarea.js — Definición de la tarea de GPS en segundo plano
 * =============================================================================
 *
 * PROPÓSITO
 * Contiene SOLO el `TaskManager.defineTask(GPS_TASK, ...)`. Es el único
 * `defineTask` de la app. `index.js` lo importa en su PRIMERA línea.
 *
 * MODELO DE DATOS: no lee ni escribe nada directo; delega en
 * `procesarUbicaciones` (seguimiento.js).
 *
 * -----------------------------------------------------------------------------
 * TrackEx v1.1.2 — GPS
 * -----------------------------------------------------------------------------
 * SÍNTOMA: con la pantalla apagada la traza subía horas tarde, o no subía.
 * CAUSA RAÍZ (dos, relacionadas con este archivo):
 *   1. La tarea se definía dentro de ChoferScreen.js. La doc de
 *      expo-task-manager (SDK 56) exige definirla "in the global scope of your
 *      JavaScript bundle", porque cuando Android levanta la app en segundo
 *      plano "no views are mounted". Importarla primero desde `index.js` la
 *      deja definida sin depender de que se importe ninguna pantalla.
 *   2. Con la app en segundo plano React Native pausa los timers de JS
 *      (`JavaTimerManager.kt`) salvo mientras haya una headless task, y
 *      expo-task-manager 56.0.22 (`TaskService.java`) la registra solo
 *      mientras procesa el evento de ubicación: se libera cuando el callback
 *      termina. Lo que se lanza sin `await` puede quedar congelado.
 * ALCANCE / DECISIONES (consecuencia B del prompt 2):
 *   - El callback ESPERA con `await` todo el trabajo importante (registrar y
 *     subir): así los timers siguen vivos hasta terminar.
 *   - Solo se lanza sin `await` lo que puede esperar: los logs (`logApp` ya no
 *     bloquea, ver registro.js).
 *   - Nunca relanza: un error queda en `gps_task_error` con `code` y `mensaje`.
 * LIMITACIONES CONOCIDAS: si Android entrega lecturas mientras un callback
 *   anterior sigue subiendo, el gestor (único en este contexto) las encola; el
 *   segundo callback puede esperar a la descarga en vuelo.
 * CÓMO SE VERIFICA: `grep defineTask explora-app/src` da una sola línea (esta);
 *   en `app_logs` no aparece `gps_task_error`, y en `gps_puntos` hay puntos
 *   con la pantalla apagada que llegan a los pocos minutos de su `ts`.
 *
 * DEPENDENCIAS Y ENTORNO
 * expo-task-manager ~56.0.22. No funciona en Expo Go: hace falta un build de
 * EAS.
 * =============================================================================
 */

import * as TaskManager from 'expo-task-manager';
import { logApp } from '../registro';
import { FUENTE } from '../compartido';
import { GPS_TASK, procesarUbicaciones } from './seguimiento';

/**
 * Tarea de segundo plano del GPS.
 *
 * Android puede entregar varias lecturas juntas en una sola invocación
 * (batching para ahorrar batería): `procesarUbicaciones` las recorre todas, en
 * orden, con la hora de cada lectura.
 *
 * @param {{data: {locations: Array}|null, error: {code: string|number, message: string}|null}} body
 *   `TaskManagerTaskBody` de expo-task-manager.
 * @returns {Promise<void>} Resuelve cuando terminó de registrar y subir.
 */
TaskManager.defineTask(GPS_TASK, async ({ data, error }) => {
  if (error) {
    logApp('gps_task_error', {
      code: String(error?.code ?? ''),
      mensaje: error?.message || '',
    });
    return;
  }

  try {
    await procesarUbicaciones(data?.locations, FUENTE.SEGUNDO_PLANO);
  } catch (err) {
    // Nunca relanza: un rechazo sin manejar en la tarea es invisible en release.
    logApp('gps_task_error', {
      code: String(err?.code ?? ''),
      mensaje: err?.message || String(err),
    });
  }
});
