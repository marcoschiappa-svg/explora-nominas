/**
 * =============================================================================
 * notificaciones.js — Notificaciones push de TrackEx
 * =============================================================================
 *
 * PROPÓSITO
 * Prepara el teléfono para recibir avisos push del coordinador y del
 * transportista (viaje nuevo, viaje cancelado, cambio de destino) y deja el
 * token de este teléfono en el perfil del chofer para que el emisor lo use.
 *
 * FLUJO COMPLETO
 *   1. Portal: nominar o cancelar escribe un documento en `avisos`.
 *   2. Apps Script (`PushAvisos.gs`, trigger de 1 minuto) lo lee, busca el
 *      `push_token` del chofer y lo manda al servicio de push de Expo.
 *   3. Esta app: muestra la notificación, y la bandeja (avisos.js) lista el
 *      aviso hasta que el chofer lo marca como leído.
 *   El envío NO sale de la app ni del navegador: el endpoint de Expo rechaza
 *   CORS y se decidió no usar servidores nuevos.
 *
 * MODELO DE DATOS (escribe `usuarios/{uid}`; las reglas solo permiten estos
 * campos al propio chofer)
 *   push_token      string  — 'ExponentPushToken[...]'; UNO por chofer. Se borra
 *                             al cerrar sesión para que un teléfono que ya no es
 *                             suyo no reciba sus avisos.
 *   actualizado_en  Timestamp
 *
 * DECISIONES
 *   - El canal 'default' de Android ("Avisos de viaje", importancia alta) se
 *     crea ANTES de pedir el permiso: en Android 13+ el diálogo de permiso solo
 *     aparece si ya hay un canal.
 *   - Un solo punto para el permiso (`asegurarPermisoNotificaciones`): lo usan
 *     el registro del token y el servicio de GPS de ChoferScreen, así no se
 *     pide dos veces ni con criterios distintos.
 *   - Todo va en try/catch y nada lanza: en Expo Go de Android el token no se
 *     puede obtener y eso no debe romper la app.
 *
 * DEPENDENCIAS Y ENTORNO
 * expo-notifications ~56.0.21, expo-constants. El token solo se obtiene en un
 * build de EAS (no en Expo Go de Android) y exige `googleServicesFile` (FCM) en
 * app.json: pendiente, fuera de este frente.
 * =============================================================================
 */

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { doc, updateDoc, serverTimestamp, deleteField } from 'firebase/firestore';
import { db } from './config/firebase';
import { logApp } from './registro';

/**
 * Proyecto de EAS esperado. Si el de la configuración no coincide (por ejemplo,
 * un app.json de otro proyecto) el token sería de OTRO proyecto y las
 * notificaciones no llegarían: es preferible no registrar nada y dejar el log.
 */
const PROJECT_ID_EAS = 'd9e00dba-515c-4683-b3ba-d708a3d43d94';

/**
 * Tope de espera de `borrarPushToken`: 3 segundos. Sin red, `updateDoc` queda
 * pendiente indefinidamente (Firestore lo encola) y el cierre de sesión se
 * quedaría esperando.
 */
const TOPE_BORRAR_TOKEN_MS = 3000;

/**
 * Configura cómo se muestran las notificaciones y crea el canal de Android.
 * Se llama UNA vez al arrancar la app (App.js).
 *
 * - `setNotificationHandler`: sin esto, una notificación que llega con la app
 *   abierta no se muestra. Se usan `shouldShowBanner` y `shouldShowList` (los
 *   vigentes en expo-notifications 56; `shouldShowAlert` está deprecado).
 * - El canal 'default' lo referencia el emisor (`channelId: 'default'`).
 *
 * @returns {Promise<void>}
 */
export async function configurarNotificaciones() {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Avisos de viaje',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
  } catch (err) {
    await logApp('notificaciones_config_error', {
      code: err?.code || '',
      mensaje: err?.message || '',
    });
  }
}

/**
 * Se asegura de tener el permiso de notificaciones, pidiéndolo SOLO si hace
 * falta. Es el único lugar de la app que lo pide.
 *
 * Consulta antes (`getPermissionsAsync`) y no vuelve a preguntar si ya está
 * concedido o si el sistema ya no permite preguntar (`canAskAgain` false).
 *
 * @returns {Promise<boolean>} True si el permiso está concedido (o la
 *   plataforma no lo exige, como Android 12 o anterior).
 */
export async function asegurarPermisoNotificaciones() {
  try {
    const actual = await Notifications.getPermissionsAsync();
    if (actual.granted) return true;
    if (actual.canAskAgain === false) return false;
    const pedido = await Notifications.requestPermissionsAsync();
    return !!pedido.granted;
  } catch (err) {
    await logApp('notificaciones_permiso_error', {
      code: err?.code || '',
      mensaje: err?.message || '',
    });
    return false;
  }
}

/**
 * Obtiene el token push de este teléfono y lo guarda en `usuarios/{uid}` si
 * cambió.
 *
 * Se llama cuando el usuario queda autenticado. Si el permiso se deniega, o
 * estamos en Expo Go de Android, simplemente no registra: el chofer sigue
 * viendo los avisos en la bandeja de la app.
 *
 * @param {Object} usuario Perfil autenticado (`uid` y, si ya lo tiene, `push_token`).
 * @returns {Promise<void>}
 */
export async function registrarPushToken(usuario) {
  try {
    if (!usuario?.uid) return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (projectId !== PROJECT_ID_EAS) {
      await logApp('push_project_id_distinto', { project_id: String(projectId || '') });
      return;
    }

    if (!(await asegurarPermisoNotificaciones())) {
      await logApp('push_permiso_denegado');
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    // Solo se escribe si cambió: cada escritura dispara snapshots y cuenta cuota.
    if (token && token !== usuario.push_token) {
      await updateDoc(doc(db, 'usuarios', usuario.uid), {
        push_token: token,
        actualizado_en: serverTimestamp(),
      });
    }
  } catch (err) {
    await logApp('push_registro_error', {
      code: err?.code || '',
      mensaje: err?.message || '',
    });
  }
}

/**
 * Borra el `push_token` del chofer. Se llama al cerrar sesión, ANTES de
 * `signOut` (las reglas exigen estar autenticado para escribir).
 *
 * Espera como máximo 3 segundos (`Promise.race`): si no hay red no debe
 * bloquear el cierre de sesión. Si no llegó a borrarse, el emisor lo limpia
 * solo la próxima vez que Expo responda `DeviceNotRegistered`; hasta entonces
 * ese teléfono podría recibir avisos del chofer anterior.
 *
 * @param {string} uid UID del chofer que cierra sesión.
 * @returns {Promise<void>}
 */
export async function borrarPushToken(uid) {
  if (!uid) return;
  try {
    await Promise.race([
      updateDoc(doc(db, 'usuarios', uid), {
        push_token: deleteField(),
        actualizado_en: serverTimestamp(),
      }),
      new Promise((resolve) => setTimeout(resolve, TOPE_BORRAR_TOKEN_MS)),
    ]);
  } catch (err) {
    await logApp('push_borrado_error', {
      code: err?.code || '',
      mensaje: err?.message || '',
    });
  }
}
