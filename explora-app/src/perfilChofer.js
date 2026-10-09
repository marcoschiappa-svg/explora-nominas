/**
 * =============================================================================
 * perfilChofer.js — Carga y validación del perfil del chofer
 * =============================================================================
 *
 * PROPÓSITO
 * Única función que resuelve "¿este UID puede usar la app?". La usan la
 * restauración de sesión (App.js), `loginDNI`, `loginEmail` e `intentarFaceID`
 * (LoginScreen.js), para que los cuatro caminos validen exactamente igual.
 *
 * MODELO DE DATOS (lee `usuarios/{uid}`; el ID del documento ES el UID de Auth)
 *   estado         'activo' | otro  — solo 'activo' puede entrar
 *   roles          array de strings — tiene que incluir 'chofer'
 *   datos_chofer   { dni, ... }     — el DNI con el que se filtran los viajes
 *   nombre         string           — saludo y registro de historial
 *   email          string           — opcional; si falta se usa el de Auth
 *
 * DECISIÓN: no hay consulta por email ni fallback a `usuarios_portal` (modelo
 * viejo). Si el documento no existe, el chofer todavía no fue habilitado.
 * =============================================================================
 */

import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './config/firebase';

/** Mensajes al usuario, uno por motivo de rechazo. */
export const MENSAJES_PERFIL = {
  no_existe: 'Tu usuario todavía no está habilitado. Contactá al transportista.',
  sin_rol: 'Esta app es solo para choferes. Usá el portal web.',
  inactivo: 'Tu cuenta está inactiva.',
};

/**
 * Lee `usuarios/{uid}` y valida que pueda usar la app.
 *
 * NO cierra la sesión ni toca la UI: devuelve el resultado y cada llamador
 * decide (el login muestra el error, la restauración de sesión hace signOut).
 * Los errores de red o de permisos de Firestore se propagan: el llamador ya
 * los captura y no deben confundirse con "usuario no habilitado".
 *
 * @param {string} uid UID de Firebase Auth.
 * @returns {Promise<{usuario: Object}|{error: string}>} `usuario` trae `uid`,
 *   `email` y todo el documento; `error` es el mensaje listo para mostrar.
 */
export async function cargarPerfilChofer(uid) {
  const snap = await getDoc(doc(db, 'usuarios', uid));
  if (!snap.exists()) return { error: MENSAJES_PERFIL.no_existe };

  const datos = snap.data();
  if (datos.estado !== 'activo') return { error: MENSAJES_PERFIL.inactivo };
  if (!Array.isArray(datos.roles) || !datos.roles.includes('chofer')) {
    return { error: MENSAJES_PERFIL.sin_rol };
  }

  return {
    usuario: { ...datos, uid, email: datos.email || auth.currentUser?.email || '' },
  };
}
