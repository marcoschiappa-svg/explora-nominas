/**
 * =============================================================================
 * versionMinima.js — Verificación de la versión mínima obligatoria de TrackEx
 * =============================================================================
 *
 * PROPÓSITO
 * TrackEx incluye la lógica de negocio compartida (`portal/src/shared/`) al
 * compilar: cuando esa lógica cambia, los teléfonos con la versión vieja siguen
 * ejecutando la anterior hasta que el chofer actualiza. Este módulo permite
 * exigir una versión mínima, configurable en Firestore sin publicar una build
 * nueva. App.js lo usa para mostrar `ActualizarScreen` en lugar de la app.
 *
 * MODELO DE DATOS (lee `configuracion_app/trackex`; lo crea y edita a mano el
 * administrador desde la consola de Firebase, staging y producción)
 *   version_minima   string     "MAYOR.MENOR.PARCHE", por ejemplo "1.1.1"
 *   actualizado_en   Timestamp  informativo; esta app no lo usa
 * Si el documento no existe, la app NO bloquea.
 *
 * DECISIONES
 *   - La versión instalada sale de `Constants.expoConfig?.version` (app.json),
 *     la misma fuente que `PieVersion.js` y `registro.js`.
 *   - CRITERIO "ANTE LA DUDA, NO BLOQUEAR": se bloquea SOLO si el documento
 *     existe, `version_minima` es válida, la versión instalada es válida y la
 *     instalada es anterior. Error, tope de espera, sin red, documento
 *     inexistente o valores inválidos → no bloquea. Un chofer sin señal tiene
 *     que poder operar: bloquearlo por no poder consultar sería peor que no
 *     bloquear.
 *   - Tope de espera de 5 segundos (`Promise.race`, mismo criterio que
 *     `TOPE_BORRAR_TOKEN_MS` de notificaciones.js): sin red, `getDoc` puede
 *     quedar esperando y la pantalla de carga no puede quedar trabada.
 *   - LOGS: `version_minima_error` (code y mensaje) ante error o tope de espera;
 *     `version_minima_invalida` (con los valores) si alguna versión no tiene el
 *     formato esperado; nada si el documento no existe. La verificación corre
 *     DESPUÉS del login (App.js), con sesión iniciada, así que la regla de
 *     `app_logs` (que exige sesión) deja registrar estos logs normalmente.
 *
 * HISTORIAL
 *   La primera versión corría antes del login, con lectura pública de
 *   `configuracion_app`, y por eso estos logs fallaban en silencio. Se cambió a
 *   lectura con sesión porque la regla pública no pasa el control del Paso 8 de
 *   Procedimiento.md. Este módulo no cambió de lógica: solo cambió cuándo lo
 *   llama App.js.
 *
 * DEPENDENCIAS Y ENTORNO
 * expo-constants, firebase/firestore. Las reglas exigen sesión iniciada para
 * leer `configuracion_app` (portal/firestore.rules.produccion).
 * =============================================================================
 */

import Constants from 'expo-constants';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './config/firebase';
import { logApp } from './registro';
import { compararVersiones } from './versiones';

/**
 * Tope de espera de la lectura: 5 segundos. Alcanza para una conexión móvil
 * mala y evita que la pantalla de carga espere indefinidamente sin red (la
 * lectura de Firestore se encola y no falla sola). Es mayor que los 3 segundos
 * de `TOPE_BORRAR_TOKEN_MS` porque acá es una lectura y no bloquea un cierre de
 * sesión, sino el arranque, donde conviene dar una oportunidad más a la red.
 */
const TOPE_VERSION_MINIMA_MS = 5000;

/**
 * Consulta la versión mínima y decide si la app instalada debe bloquearse.
 *
 * Nunca lanza: cualquier falla devuelve `bloqueada: false` (ver "ante la duda,
 * no bloquear" en la cabecera).
 *
 * @returns {Promise<{bloqueada: boolean, instalada: string, minima: string}>}
 *   `instalada` y `minima` vienen como texto ('' si no hay dato), para mostrarlos
 *   en la pantalla de bloqueo.
 */
export async function verificarVersionMinima() {
  const instalada = Constants.expoConfig?.version || '';
  let minima = '';

  try {
    const snap = await Promise.race([
      getDoc(doc(db, 'configuracion_app', 'trackex')),
      new Promise((_, rechazar) => setTimeout(
        () => rechazar(Object.assign(new Error('tope de espera'), { code: 'tope-de-espera' })),
        TOPE_VERSION_MINIMA_MS
      )),
    ]);

    // Sin documento: nada configurado, no se bloquea ni se registra nada.
    if (!snap.exists()) return { bloqueada: false, instalada, minima };

    const valor = snap.data()?.version_minima;
    minima = typeof valor === 'string' ? valor : '';

    const comparacion = compararVersiones(instalada, minima);
    if (comparacion === null) {
      await logApp('version_minima_invalida', {
        instalada,
        minima: String(valor ?? ''),
      });
      return { bloqueada: false, instalada, minima };
    }

    return { bloqueada: comparacion === -1, instalada, minima };
  } catch (err) {
    await logApp('version_minima_error', {
      code: err?.code || '',
      mensaje: err?.message || '',
    });
    return { bloqueada: false, instalada, minima };
  }
}
