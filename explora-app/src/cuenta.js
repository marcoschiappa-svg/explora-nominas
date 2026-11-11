/**
 * =============================================================================
 * cuenta.js — Operaciones sobre la cuenta del chofer (hoy: cambiar contraseña)
 * =============================================================================
 *
 * PROPÓSITO
 * Contiene la lógica de cambio de contraseña desde la app (TrackEx v1.1.1,
 * Frente F) y la traducción de sus errores a texto para el chofer. Está fuera
 * del componente de pantalla para que la lógica se pueda leer, probar y reusar
 * sin depender de la interfaz.
 *
 * CONTEXTO
 * Los choferes reciben una contraseña inicial (`<primer nombre>2026`, asignada
 * por portal/scripts/asignar-claves-choferes.js) y hasta ahora la app no tenía
 * forma de cambiarla. El cambio es OPCIONAL: no se obliga a hacerlo.
 *
 * MODELO DE DATOS
 * No lee ni escribe Firestore, salvo el log de `app_logs` (ver registro.js).
 * Escribe en Firebase Auth la contraseña de `auth.currentUser`. Los eventos que
 * registra:
 *   clave_cambiada        — el cambio salió bien (sin campos extra).
 *   clave_cambio_error    — falló; `{ code }` con el código del error de Auth
 *                           (o `sin-sesion`).
 * NUNCA se registra una contraseña, ni la actual ni la nueva.
 *
 * ARQUITECTURA / DECISIONES DE DISEÑO
 *   - REAUTENTICACIÓN SIEMPRE. `updatePassword` falla con
 *     `auth/requires-recent-login` si la sesión no es reciente, y en la app la
 *     sesión dura semanas (persistencia en AsyncStorage). Reautenticar con la
 *     contraseña actual antes de cambiarla evita ese error. Es el mismo
 *     esquema que portal/src/ui/BarraSuperior.js. Además confirma que quien
 *     toca el botón conoce la contraseña, no solo que tiene el teléfono
 *     desbloqueado.
 *   - EL EMAIL SALE DE LA SESIÓN (`user.email`, que para un chofer es
 *     `<dni>@explora-portal.com`), no de un parámetro: el chofer solo puede
 *     cambiar la contraseña de la cuenta con la que está logueado.
 *   - LOS LOGS NO SE ESPERAN (`logApp(...)` sin `await`). Escribir en Firestore
 *     sin señal queda pendiente hasta que vuelva la red; esperarlo dejaría el
 *     botón "Guardando..." colgado después de que la contraseña ya cambió.
 *     `logApp` traga sus propios errores, así que no puede romper el flujo.
 *
 * HISTORIAL DE CORRECCIONES
 * Ninguno todavía: módulo nuevo.
 *
 * DEPENDENCIAS Y ENTORNO
 * firebase ^12.15.0 (`firebase/auth`). Usa el `auth` de config/firebase.js, el
 * que tiene persistencia nativa.
 * =============================================================================
 */

import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth } from './config/firebase';
import { logApp } from './registro';

/**
 * Código del error propio que se lanza cuando no hay sesión. Los códigos de
 * Firebase Auth llevan prefijo `auth/`; este no, para que no se confunda con
 * uno de ellos.
 */
const CODIGO_SIN_SESION = 'sin-sesion';

/**
 * Cambia la contraseña del chofer logueado.
 *
 * Reautentica con la contraseña actual y recién después la actualiza (ver
 * "REAUTENTICACIÓN SIEMPRE" en la cabecera). Si algo falla, registra el
 * código en `app_logs` y relanza el error para que la pantalla muestre
 * `mensajeErrorClave(err.code)`. Ninguna contraseña se registra.
 *
 * @param {string} actual Contraseña actual, tal como la tipeó el chofer.
 * @param {string} nueva Contraseña nueva. La validación de largo y de que no
 *   sea igual a la actual la hace quien llama; Firebase exige al menos 6.
 * @returns {Promise<void>}
 * @throws {Error} Con `code` = `sin-sesion` si no hay usuario logueado, o el
 *   código de Firebase Auth (`auth/wrong-password`, `auth/weak-password`, ...).
 */
export async function cambiarClave(actual, nueva) {
  try {
    const user = auth.currentUser;
    if (!user) {
      const err = new Error('No hay sesión iniciada');
      err.code = CODIGO_SIN_SESION;
      throw err;
    }

    const credencial = EmailAuthProvider.credential(user.email, actual);
    await reauthenticateWithCredential(user, credencial);
    await updatePassword(user, nueva);
  } catch (err) {
    // Solo `code`: es lo único que hace falta para diagnosticar, y así ningún
    // dato de la solicitud (que incluye las contraseñas) puede llegar a `app_logs`.
    logApp('clave_cambio_error', { code: err?.code || '' });
    throw err;
  }

  logApp('clave_cambiada');
}

/**
 * Traduce un código de error de `cambiarClave` a un texto para el chofer.
 *
 * `auth/wrong-password` y `auth/invalid-credential` dicen lo mismo: según la
 * versión del SDK, una contraseña actual incorrecta llega con uno u otro.
 *
 * @param {string} code `err.code` del error lanzado por `cambiarClave`.
 * @returns {string} Mensaje en español, listo para mostrar.
 */
export function mensajeErrorClave(code) {
  switch (code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'La contraseña actual es incorrecta.';
    case 'auth/weak-password':
      return 'La contraseña nueva es muy corta.';
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Esperá unos minutos y probá de nuevo.';
    case 'auth/network-request-failed':
      return 'Sin conexión. Probá de nuevo cuando tengas señal.';
    case CODIGO_SIN_SESION:
      return 'Tu sesión se cerró. Volvé a ingresar.';
    default:
      return 'No se pudo cambiar la contraseña. Probá de nuevo.';
  }
}
