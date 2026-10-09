/**
 * =============================================================================
 * ChoferScreen.js — Pantalla principal de la app TrackEx (rol: chofer)
 * =============================================================================
 *
 * PROPÓSITO
 * Es la única pantalla operativa de la app. Un chofer autenticado ve acá los
 * viajes que le fueron nominados desde el portal y avanza su ciclo de vida:
 * RECIBIDO → EN_VIAJE (→ FINALIZADO). En paralelo, registra el recorrido GPS
 * del camión para que el portal pueda dibujarlo en Seguimiento.
 *
 * -----------------------------------------------------------------------------
 * MODELO DE DATOS (v2: colección `viajes`)
 * -----------------------------------------------------------------------------
 * Cada documento de `viajes/{id}` es UN viaje (un despacho nominado). Ya no hay
 * pedido con array `despachos` ni escrituras con `arrayUnion`: el chofer se
 * localiza con una consulta indexada, no recorriendo todos los pedidos.
 *
 * LECTURA — consulta en tiempo real:
 *   where chofer_dni == usuario.datos_chofer.dni
 *   where estado in [RECIBIDO, EN_VIAJE]       (índice chofer_dni + estado)
 * Los FINALIZADO / CANCELADO quedan afuera a propósito: la app muestra trabajo
 * pendiente, no historial.
 *
 * Campos del viaje que la pantalla lee (`adaptarViaje` los pasa al objeto de
 * pantalla):
 *   estado                'RECIBIDO' | 'EN_VIAJE' | 'FINALIZADO' | 'CANCELADO'
 *   estado_ts             Timestamp — último cambio de estado
 *   demorado              boolean — la demora es un ATRIBUTO, no un estado
 *   demora_motivo/_ts     texto del chofer / Timestamp del reporte
 *   producto_nombre, cliente_razon_social, origen_texto, destino_texto
 *   volumen, fecha_carga ('AAAA-MM-DD'), patente_tractor, patente_semi
 *   pedido_id, despacho_id
 *
 * ESCRITURA — la hace la lógica compartida (portal/src/shared/, vía
 * `src/compartido.js`), siempre con el `db` de la app por parámetro:
 *   iniciarViaje      RECIBIDO → EN_VIAJE, con la posición de inicio
 *   reportarDemora    demorado = true + motivo (el estado NO cambia)
 *   finalizarViaje    cierra el viaje y empuja el despacho a ENTREGADO
 *   registrarPuntos   lote de puntos GPS en viajes/{id}/gps_puntos (la clave de
 *                     cada punto es su timestamp: reenviar un lote no duplica)
 * Las reglas de `gps_puntos` exigen el viaje en EN_VIAJE, por eso al finalizar
 * el buffer se descarga ANTES de cerrar el viaje.
 *
 * Esta pantalla ya NO escribe `gps_estado` ni `gps_track_*`: la salud del GPS
 * se deriva de `ultima_ts` con `saludGPS()` y los puntos van a la subcolección.
 *
 * PANTALLA: el adaptador ya no trae OV, fecha/banda de entrega, observaciones,
 * horario de carga ni transporte. El JSX los muestra SOLO si el objeto de
 * pantalla los tiene (hoy nunca): nada de etiquetas vacías.
 *
 * -----------------------------------------------------------------------------
 * AVISOS Y PUSH (Frente F)
 * -----------------------------------------------------------------------------
 * La pantalla muestra al comienzo del cuerpo una BANDEJA con los avisos sin leer
 * del chofer (`useAvisos`, avisos.js): viaje nuevo, viaje cancelado, cambio de
 * destino. "Entendido" los marca leídos. El mismo aviso llega además como
 * notificación push, que envía un trigger de Apps Script (PushAvisos.gs) al
 * `push_token` que registra notificaciones.js; la bandeja cubre el caso en que el
 * push no llegó. El permiso de notificaciones se pide en un solo lugar
 * (`asegurarPermisoNotificaciones`) y `logApp` vive en registro.js.
 *
 * -----------------------------------------------------------------------------
 * LAYOUT, TEMA E INSETS (Frente E)
 * -----------------------------------------------------------------------------
 * Estructura (se mantiene): encabezado coloreado, cuerpo con tarjetas y bottom
 * sheets. Raíz = View flex 1; hijos en orden: los tres Modal, el encabezado, el
 * ScrollView (flex 1) y, ÚLTIMO, el PieVersion. El pie es HERMANO del
 * ScrollView, nunca hijo: queda siempre al fondo, sin scrollear ni quedar tapado.
 *
 *   - TEMA: colores de los tokens compartidos vía `useTema()`; estilos en
 *     `crearEstilos(colores, insets)` dentro de un `useMemo` (al final del
 *     archivo). El encabezado es de color en los dos temas (degradé por estado
 *     real del viaje, en `tema/encabezados.js`); el selector de tema (🌓) está
 *     solo acá.
 *   - TIPOGRAFÍA: Montserrat con `fontFamily: fuente(peso)`.
 *   - INSETS (edge-to-edge): el encabezado suma `insets.top` (reemplaza el
 *     padding superior fijo anterior); los laterales respetan notch o cámara; el
 *     pie y los bottom sheets suman `insets.bottom`.
 *   - PANTALLA GRANDE: `ColumnaCentrada` limita el contenido a 600 de ancho; el
 *     degradé y los fondos ocupan todo el ancho.
 *   - La demora es un atributo del viaje (`demorado`), no un estado: se muestra
 *     como badge y no existe la acción de revertirla.
 *

 * -----------------------------------------------------------------------------
 * ARQUITECTURA DE LA CAPTURA GPS — TRES FUENTES INDEPENDIENTES
 * -----------------------------------------------------------------------------
 * El diseño separa a propósito lo crítico de lo complementario, para que la
 * falla de una fuente no arrastre a las otras:
 *
 *   1. PUNTUAL (crítica) — `getCurrentPositionAsync` en el instante exacto en
 *      que el chofer toca Iniciar o Finalizar. Solo requiere permiso de PRIMER
 *      PLANO: sin servicio, sin notificación, sin desvío a Ajustes. Es el camino
 *      más robusto y por eso carga el dato que más importa: dónde arrancó y
 *      dónde terminó el viaje.
 *
 *   2. PRIMER PLANO (complementaria) — `watchPositionAsync` mientras la pantalla
 *      está montada. También alcanza con permiso de primer plano. Garantiza
 *      traza cada vez que el chofer mira el teléfono, aun si nunca concede
 *      "Permitir siempre".
 *
 *   3. SEGUNDO PLANO (complementaria) — `startLocationUpdatesAsync` + TaskManager.
 *      Es la única que sigue con la pantalla bloqueada, y también la más frágil:
 *      exige la cadena completa de permisos y un foreground service.
 *
 * REGLA DE DISEÑO: el viaje SIEMPRE avanza, haya o no ubicación disponible. Un
 * chofer adentro de un galpón o con el GPS apagado no puede quedar trabado sin
 * poder cerrar el viaje. La ausencia de GPS se registra, no bloquea.
 *
 * -----------------------------------------------------------------------------
 * HISTORIAL DE CORRECCIONES (agosto 2026)
 * -----------------------------------------------------------------------------
 * Diagnóstico: los viajes de prueba de Juan y Sofía (13/08) se registraron
 * correctamente en el estado del despacho, pero NO produjeron un solo punto GPS. Se
 * identificaron cuatro causas independientes, todas corregidas acá:
 *
 *   (1) CADENA DE PERMISOS INVERTIDA. `iniciarGPSBackground()` pedía el permiso
 *       de background sin pedir antes el de foreground. La doc de expo-location
 *       para SDK 56 es explícita: en Android no se puede obtener el permiso de
 *       background sin tener antes el de primer plano. La solicitud volvía sin
 *       conceder, la función hacía `return`, y `startLocationUpdatesAsync` jamás
 *       llegaba a ejecutarse.
 *       → Corregido en `activarSeguimiento()`.
 *
 *   (2) FALTABA POST_NOTIFICATIONS. Android 13+ la exige para mostrar la
 *       notificación del foreground service. Sin notificación visible, varios
 *       fabricantes matan el servicio por gestión de batería.
 *       → Corregido en `pedirPermisoNotificaciones()` + app.json.
 *
 *   (3) EL VIAJE ACTIVO VIVÍA EN UNA VARIABLE GLOBAL. La tarea de background
 *       leía `global.exploraViajeActivo`, seteada por un `useEffect`. Cuando
 *       Android despierta la tarea con la app cerrada lo hace en un contexto JS
 *       NUEVO, donde el árbol de React nunca se montó: la global llegaba vacía y
 *       la tarea abortaba en su segunda línea. Sin error, sin log, sin rastro.
 *       → Corregido persistiendo el viaje activo en AsyncStorage.
 *
 *   (4) BUCLE DE REINTENTOS DE PERMISOS. El efecto que arranca el GPS dependía
 *       de `viajes`, que es un array nuevo en cada snapshot de Firestore — o sea
 *       en cada escritura de GPS. Resultado: se re-pedían permisos cada minuto.
 *       → Corregido derivando una clave string estable con `useMemo`.
 *
 * Correcciones adicionales incluidas:
 *   - `startLocationUpdatesAsync` no tenía try/catch: cualquier fallo al arrancar
 *     el servicio quedaba como promesa rechazada sin manejar, invisible en
 *     producción.
 *   - Los `catch` descartaban `err.code`. Ese detalle habría cerrado el
 *     diagnóstico el primer día en vez del cuarto.
 *   - Los puntos GPS se escribían de a uno contra la red: en zonas sin señal la
 *     escritura fallaba y el punto se perdía para siempre. Ahora se bufferean en
 *     disco y se descargan en lote.
 *   - Cadencia 60s/100m era demasiado gruesa (a 80 km/h, un punto cada ~1,3 km).
 *     Ahora 30s/50m.
 *
 * -----------------------------------------------------------------------------
 * DEPENDENCIAS Y ENTORNO
 * -----------------------------------------------------------------------------
 * Expo SDK 56 · expo-location ~56.0.21 · expo-task-manager ~56.0.22
 * @react-native-async-storage/async-storage 2.2.0 · firebase ^12.15.0
 *
 * IMPORTANTE PARA PROBAR: el GPS en segundo plano NO funciona en Expo Go. Hay
 * que usar un development build de EAS. Además, los permisos de Android son
 * "pegajosos": después de dos denegaciones el sistema deja de preguntar, así que
 * entre prueba y prueba hay que desinstalar la app o limpiar permisos desde
 * Ajustes, o se termina midiendo contra un estado sucio.
 *
 * REQUIERE: las reglas de Firestore deben permitir `create` en la colección
 * `app_logs`, o todo el logging remoto falla en silencio.
 * =============================================================================
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, Linking, Modal, TextInput,
  AppState, KeyboardAvoidingView
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, onSnapshot, doc, getDoc, query, where } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { db } from '../config/firebase';
import { APPS_SCRIPT_URL } from '../config/constants';
import { logApp } from '../registro';
import { useAvisos } from '../avisos';
import { asegurarPermisoNotificaciones } from '../notificaciones';
import { useTema } from '../tema/TemaContext';
import { fuente } from '../tema/fuentes';
import { DEGRADE_ENCABEZADO, ETIQUETA_ENCABEZADO, estadoEncabezado } from '../tema/encabezados';
import {
  TAMANO_TITULO_ENCABEZADO, TAMANO_TITULO_VACIO, TAMANO_ICONO_MODAL, TAMANO_ICONO_VACIO,
} from '../tema/dimensiones';
import ColumnaCentrada from '../componentes/ColumnaCentrada';
import PieVersion from '../componentes/PieVersion';
import {
  iniciarViaje, reportarDemora, finalizarViaje, registrarPuntos, VIAJE,
  marca, colorEstado, espacio, radio, tipografia,
} from '../compartido';

/**
 * Colores de una tarjeta de aviso según su tipo. SOLO de tokens:
 *   viaje_nominado      → éxito
 *   despacho_cancelado  → peligro
 *   domicilio_cambiado  → advertencia
 *   otro                → neutro (superficie y borde del tema)
 * El texto y el borde del botón usan el color de texto del tipo, así el
 * contraste no depende del tema claro u oscuro.
 *
 * @param {string} tipo Tipo de aviso.
 * @param {Object} c Colores del tema (para el caso neutro).
 * @returns {{fondo: string, borde: string, texto: string}}
 */
function coloresAviso(tipo, c) {
  switch (tipo) {
    case 'viaje_nominado':
      return { fondo: colorEstado.exitoFondo, borde: colorEstado.exitoBorde, texto: colorEstado.exitoTexto };
    case 'despacho_cancelado':
      return { fondo: colorEstado.peligroFondo, borde: colorEstado.peligroBordeAlterno, texto: colorEstado.peligroTexto };
    case 'domicilio_cambiado':
      return { fondo: colorEstado.advertenciaFondo, borde: colorEstado.advertenciaBordeAlterno, texto: colorEstado.advertenciaTexto };
    default:
      return { fondo: c.superficie, borde: c.borde, texto: c.texto };
  }
}

/**
 * Zona táctil extra (12 en cada lado) de los botones chicos del encabezado
 * ("Salir" y el selector de tema): su texto mide pocos puntos y con el pulgar
 * en el teléfono es fácil errarle.
 */
const HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

/**
 * Identificador de la tarea de background registrada en TaskManager.
 * Debe ser único en toda la app y estable entre versiones: si cambia, una tarea
 * previamente registrada por una versión anterior queda huérfana y corriendo.
 */
const GPS_TASK = 'explora-gps-task';

/* -----------------------------------------------------------------------------
 * CLAVES DE ASYNCSTORAGE
 *
 * Por qué disco y no memoria: la tarea de background puede ejecutarse en un
 * contexto JS donde el componente React nunca se montó. Cualquier variable de
 * módulo o de componente llega vacía ahí. AsyncStorage es el único canal que
 * sobrevive a ese reinicio de contexto. (Ver causa 3 del historial.)
 * -------------------------------------------------------------------------- */

/**
 * Viaje en curso: `{ viajeId }` o ausente si no hay ninguno.
 *
 * MIGRACIÓN: las versiones anteriores guardaban `{ docId, despachoIdx,
 * pedidoId }` (modelo `pedidos_portal`). Esa forma se descarta al arrancar
 * (ver `migrarEstadoLocal`) para no mezclar puntos de modelos distintos.
 */
const KEY_VIAJE_ACTIVO = 'explora:viaje_activo';

/** Cola de puntos GPS pendientes de escritura: `[{ lat, lng, ts }, ...]` con `ts` ISO. */
const KEY_BUFFER_GPS = 'explora:gps_buffer';

/** Último punto aceptado: `{ lat, lng, ts }`. Se usa para el filtro de velocidad. */
const KEY_ULTIMO_PUNTO = 'explora:gps_ultimo_punto';

/* -----------------------------------------------------------------------------
 * PARÁMETROS DE CAPTURA Y FILTRADO
 * -------------------------------------------------------------------------- */

/**
 * Umbral de precisión: si el GPS reporta más de 100m de radio de error,
 * descartamos la lectura — es la causa más común de que la posición "salte"
 * cuando el camión está parado cerca de estructuras metálicas, tanques o
 * galpones (señal rebotada, no movimiento real).
 */
const PRECISION_MAXIMA_METROS = 100;

/**
 * Velocidad máxima físicamente razonable para un camión en ruta/planta.
 * Un salto que implique más que esto entre dos lecturas es ruido de GPS,
 * no movimiento real.
 */
const VELOCIDAD_MAXIMA_KMH = 150;

/**
 * Cadencia de captura, para ambas fuentes continuas (background y primer plano).
 *
 * En Android estos dos valores actúan como umbrales combinados: se emite una
 * lectura cuando pasó el tiempo Y se recorrió la distancia. Con los 60s/100m
 * originales, un camión a 80 km/h (~1,3 km por minuto) generaba un punto cada
 * kilómetro y medio: más un boceto que un recorrido.
 *
 * El costo extra en escrituras lo absorbe el buffer por lotes.
 */
const GPS_INTERVALO_MS = 30000;
const GPS_DISTANCIA_M = 50;

/**
 * Política del buffer local.
 *
 * Se descarga a Firestore cuando se junta BUFFER_MAX_PUNTOS o cuando el punto
 * más viejo supera BUFFER_MAX_EDAD_MS — lo segundo cubre el caso del camión
 * detenido, que genera pocos puntos y no llegaría nunca al umbral por cantidad.
 *
 * BUFFER_TOPE_PUNTOS es una red de seguridad: si el camión pasa horas sin señal
 * el buffer no puede crecer sin control. Al superarlo se descartan los puntos
 * más viejos (se prioriza el tramo reciente).
 */
const BUFFER_MAX_PUNTOS = 10;
const BUFFER_MAX_EDAD_MS = 120000;
const BUFFER_TOPE_PUNTOS = 1000;

/**
 * Timeout de la lectura puntual al iniciar/finalizar viaje.
 *
 * `getCurrentPositionAsync` puede tardar bastante o no fijar posición nunca bajo
 * techo. Sin timeout, el chofer se queda mirando un spinner. A los 10s se corta
 * y se intenta la última posición conocida, siempre que no tenga más de 5
 * minutos: más vieja que eso ya no representa dónde está el camión.
 */
const TIMEOUT_PUNTO_MS = 10000;
const EDAD_MAXIMA_ULTIMA_POSICION_MS = 300000;

/* =============================================================================
 * UTILIDADES DE ÁMBITO DE MÓDULO
 *
 * Todo lo que está acá afuera del componente es deliberado: la tarea de
 * background necesita poder ejecutar estas funciones sin que exista ninguna
 * instancia de React montada.
 * ========================================================================== */

/**
 * Distancia entre dos coordenadas por la fórmula de Haversine.
 *
 * @param {number} lat1 Latitud del primer punto, en grados.
 * @param {number} lng1 Longitud del primer punto, en grados.
 * @param {number} lat2 Latitud del segundo punto, en grados.
 * @param {number} lng2 Longitud del segundo punto, en grados.
 * @returns {number} Distancia en metros.
 */
function distanciaMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000; // radio medio terrestre en metros
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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
async function leerJSON(clave, porDefecto) {
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
async function escribirJSON(clave, valor) {
  try {
    await AsyncStorage.setItem(clave, JSON.stringify(valor));
  } catch (e) {
    console.warn('AsyncStorage write error:', e?.message || e);
  }
}

/**
 * Gancho para que el código de ámbito de módulo (que puede correr sin React
 * montado) pueda pedirle al componente que baje la suscripción de primer
 * plano, cuyo `watchRef` solo existe adentro. Lo registra el EFECTO 5.
 */
const ganchos = { alDescartar: null };

/**
 * Da de baja la tarea de background si estaba corriendo.
 *
 * Está a nivel de módulo (y no dentro del componente) porque `descargarBuffer`
 * la necesita al descartar un viaje cerrado por fuera, y puede ejecutarse en el
 * contexto de la tarea de background. Consulta primero con
 * `hasStartedLocationUpdatesAsync` porque detener una tarea no registrada lanza.
 *
 * @returns {Promise<void>}
 */
async function detenerGPSBackground() {
  try {
    const corriendo = await Location.hasStartedLocationUpdatesAsync(GPS_TASK).catch(() => false);
    if (corriendo) {
      await Location.stopLocationUpdatesAsync(GPS_TASK);
    }
  } catch (err) {
    console.warn('stopLocationUpdates error:', err?.message || err);
  }
}

/**
 * Descarta TODO el estado local de GPS (viaje activo, buffer y último punto).
 *
 * @returns {Promise<void>}
 */
async function limpiarEstadoLocalGPS() {
  await AsyncStorage.removeItem(KEY_BUFFER_GPS).catch(() => {});
  await AsyncStorage.removeItem(KEY_VIAJE_ACTIVO).catch(() => {});
  await AsyncStorage.removeItem(KEY_ULTIMO_PUNTO).catch(() => {});
}

/**
 * Migración en caliente del estado local de GPS.
 *
 * Una instalación que se actualiza con un viaje en curso trae en disco
 * `KEY_VIAJE_ACTIVO` con la forma del modelo viejo (campos `docId` /
 * `despachoIdx`, sin `viajeId`) y un buffer de puntos que pertenecen a ese
 * pedido. Escribirlos contra un viaje del modelo nuevo mezclaría recorridos de
 * dos viajes distintos, así que se descarta todo y se deja constancia.
 *
 * Se considera forma vieja: viaje activo sin `viajeId` string, o buffer con
 * elementos que no son un punto `{ lat, lng, ts }`.
 *
 * @returns {Promise<void>}
 */
async function migrarEstadoLocal() {
  const activo = await leerJSON(KEY_VIAJE_ACTIVO, null);
  const buffer = await leerJSON(KEY_BUFFER_GPS, []);

  const activoViejo = !!activo && typeof activo.viajeId !== 'string';
  const bufferViejo = !Array.isArray(buffer) || buffer.some(p =>
    !p || typeof p.lat !== 'number' || typeof p.lng !== 'number' || !p.ts);
  // Un buffer viejo suelto (sin viaje activo) también se descarta; y si el viaje
  // activo es viejo, sus puntos pertenecen al modelo viejo aunque tengan buena forma.
  if (!activoViejo && !bufferViejo) return;

  await limpiarEstadoLocalGPS();
  await logApp('migracion_descarte', {
    viaje_activo_viejo: String(activoViejo),
    buffer_viejo: String(bufferViejo),
    puntos_descartados: Array.isArray(buffer) ? buffer.length : 0,
  });
}

/**
 * Descarga a Firestore todos los puntos GPS acumulados en el buffer local.
 *
 * Delega en `registrarPuntos` (lógica compartida), que escribe el lote en
 * `viajes/{id}/gps_puntos` y actualiza la última posición del viaje.
 *
 * ADAPTADOR OBLIGATORIO DE `ts`: el buffer guarda `ts` como ISO string, pero
 * `registrarPuntos` espera milisegundos (`Number(ts)`) y DESCARTA EN SILENCIO
 * lo que no entiende. Se convierte con `new Date(ts).getTime()` antes de
 * llamarla. Si el punto trae `precision` o `velocidad` se pasan tal cual.
 *
 * Si la escritura falla, el buffer NO se limpia: queda intacto para el próximo
 * intento (así un tramo sin señal no pierde puntos). Solo se limpia tras la
 * confirmación del servidor.
 *
 * VIAJE CERRADO POR FUERA: las reglas de `gps_puntos` exigen el viaje en
 * EN_VIAJE. Si el coordinador lo cerró a mano y quedan puntos, la escritura da
 * `permission-denied` para siempre. Ante ese código se lee el viaje: si ya no
 * está EN_VIAJE (o no existe) se descarta el buffer, se limpia el viaje activo
 * y se detiene el seguimiento (`gps_descarte`); si sigue EN_VIAJE el error es
 * otro y se conserva el buffer para reintentar.
 *
 * @param {string} viajeId ID del documento en `viajes`.
 * @returns {Promise<void>}
 */
async function descargarBuffer(viajeId) {
  if (!viajeId) return;

  const buffer = await leerJSON(KEY_BUFFER_GPS, []);
  if (!buffer.length) return;

  try {
    const puntos = buffer
      .map(p => ({ ...p, ts: new Date(p.ts).getTime() }))
      .filter(p => Number.isFinite(p.ts));

    await registrarPuntos(db, viajeId, puntos);

    // Solo se limpia si la escritura fue confirmada por el servidor.
    await escribirJSON(KEY_BUFFER_GPS, []);
  } catch (err) {
    console.warn('GPS flush error:', err?.code, err?.message);

    if (err?.code === 'permission-denied') {
      try {
        const snap = await getDoc(doc(db, 'viajes', viajeId));
        const estado = snap.exists() ? snap.data().estado : null;
        if (estado !== VIAJE.EN_VIAJE) {
          await limpiarEstadoLocalGPS();
          await detenerGPSBackground();
          if (ganchos.alDescartar) ganchos.alDescartar();
          await logApp('gps_descarte', {
            viaje_id: viajeId,
            estado_viaje: estado || 'inexistente',
            puntos_descartados: buffer.length,
          });
          return;
        }
      } catch (errLectura) {
        console.warn('GPS descarte: no se pudo leer el viaje', errLectura?.code);
      }
    }

    await logApp('gps_flush_error', {
      code: err?.code || '',
      mensaje: err?.message || '',
      puntos_pendientes: buffer.length,
      viaje_id: viajeId,
    });
  }
}

/**
 * Procesa una lectura de posición: la filtra, la encola y descarga si toca.
 *
 * Punto de entrada COMÚN de las dos fuentes continuas (tarea de background y
 * `watchPositionAsync` de primer plano), para que ambas apliquen exactamente los
 * mismos filtros y compartan un único buffer.
 *
 * Descarta la lectura sin registrarla en tres casos:
 *   1. Coordenadas ausentes o inválidas.
 *   2. No hay viaje activo (llegó una lectura tardía tras finalizar).
 *   3. Precisión peor que PRECISION_MAXIMA_METROS.
 *   4. Implica una velocidad superior a VELOCIDAD_MAXIMA_KMH respecto del
 *      último punto aceptado.
 *
 * El filtro de velocidad compara contra el último punto guardado en disco y no
 * contra lo último escrito en Firestore: es más confiable (no depende de que la
 * escritura anterior haya llegado) y ahorra una lectura de red por punto.
 *
 * @param {Object} coords Objeto `coords` de expo-location.
 * @returns {Promise<void>}
 */
async function registrarPunto(coords) {
  if (!coords || coords.latitude == null || coords.longitude == null) return;

  const viaje = await leerJSON(KEY_VIAJE_ACTIVO, null);
  if (!viaje || !viaje.viajeId) return;

  // Filtro 1: descartar lecturas de baja precisión.
  if (coords.accuracy != null && coords.accuracy > PRECISION_MAXIMA_METROS) return;

  // Filtro 2: descartar saltos que implican velocidad imposible.
  const ultimo = await leerJSON(KEY_ULTIMO_PUNTO, null);
  if (ultimo) {
    const metros = distanciaMetros(ultimo.lat, ultimo.lng, coords.latitude, coords.longitude);
    const segundos = (Date.now() - new Date(ultimo.ts).getTime()) / 1000;
    const kmh = segundos > 0 ? (metros / segundos) * 3.6 : 0;
    if (kmh > VELOCIDAD_MAXIMA_KMH) return;
  }

  const punto = {
    lat: coords.latitude,
    lng: coords.longitude,
    ts: new Date().toISOString(),
  };
  await escribirJSON(KEY_ULTIMO_PUNTO, punto);

  let buffer = await leerJSON(KEY_BUFFER_GPS, []);
  buffer.push(punto);

  // Red de seguridad: conservar los más recientes si el buffer se desbordó.
  if (buffer.length > BUFFER_TOPE_PUNTOS) {
    buffer = buffer.slice(buffer.length - BUFFER_TOPE_PUNTOS);
  }
  await escribirJSON(KEY_BUFFER_GPS, buffer);

  // Dos disparadores de descarga: por cantidad o por antigüedad. El segundo
  // cubre al camión detenido, que nunca llegaría al umbral por cantidad.
  const edadMasViejo = Date.now() - new Date(buffer[0].ts).getTime();
  if (buffer.length >= BUFFER_MAX_PUNTOS || edadMasViejo >= BUFFER_MAX_EDAD_MS) {
    await descargarBuffer(viaje.viajeId);
  }
}

/**
 * Tarea de background de GPS.
 *
 * DEBE definirse en el ámbito superior del módulo: es un requisito de
 * expo-task-manager, porque el sistema operativo la invoca sin que exista
 * necesariamente una instancia de React montada.
 *
 * Android puede entregar varias lecturas juntas en una sola invocación (batching
 * del sistema para ahorrar batería), por eso se recorre `locations` entero en
 * vez de tomar solo el primer elemento como hacía la versión anterior.
 */
TaskManager.defineTask(GPS_TASK, async ({ data, error }) => {
  if (error) {
    console.error('GPS task error:', error);
    await logApp('gps_task_error', {
      code: error?.code || '',
      mensaje: error?.message || '',
    });
    return;
  }
  if (!data) return;

  const { locations } = data;
  if (!locations || !locations.length) return;

  for (const loc of locations) {
    await registrarPunto(loc.coords);
  }
});

/**
 * Convierte un Timestamp de Firestore a ISO 8601.
 *
 * `formatFecha` y `tiempoDesde` esperan ISO string, y el viaje trae Timestamps.
 * Devuelve '' si el valor falta: un `serverTimestamp()` recién escrito por este
 * mismo dispositivo llega como `null` hasta que el servidor lo confirma.
 *
 * @param {*} ts Timestamp de Firestore, Date, string ISO o null.
 * @returns {string} ISO 8601 o ''.
 */
function aISO(ts) {
  if (!ts) return '';
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  if (ts instanceof Date) return ts.toISOString();
  return typeof ts === 'string' ? ts : '';
}

/**
 * Arma el objeto de pantalla a partir de un documento de `viajes`.
 *
 * Es la única frontera entre el modelo de datos y la UI: el JSX solo conoce
 * este objeto. Se conservan los nombres que la pantalla ya usaba (`producto`,
 * `cliente`, `lugar`) para no tocar el diseño.
 *
 * La pantalla decide colores y etiquetas por `estado` (RECIBIDO / EN_VIAJE) y
 * muestra la demora como badge a partir de `demorado`: la demora es un atributo
 * del viaje, no un estado.
 *
 * @param {import('firebase/firestore').QueryDocumentSnapshot} docSnap
 * @returns {Object} Viaje listo para mostrar.
 */
function adaptarViaje(docSnap) {
  const d = docSnap.data();
  const demorado = d.demorado === true;

  return {
    id: docSnap.id,                       // clave de React y del GPS
    estado: d.estado,
    demorado,
    estado_ts: aISO(d.estado_ts),
    producto: d.producto_nombre || '',
    cliente: d.cliente_razon_social || '',
    lugar: d.destino_texto || '',
    origen: d.origen_texto || '',
    volumen: d.volumen,
    fecha_carga: d.fecha_carga || '',
    patente_tractor: d.patente_tractor || '',
    patente_semi: d.patente_semi || '',
    demora_motivo: d.demora_motivo || '',
    demora_ts: aISO(d.demora_ts),
    pedido_id: d.pedido_id || '',
    despacho_id: d.despacho_id || '',
  };
}

/* =============================================================================
 * COMPONENTE
 * ========================================================================== */

/**
 * Pantalla principal del chofer.
 *
 * @param {Object} props
 * @param {Object} props.usuario Perfil autenticado (documento `usuarios/{uid}`
 *   más `uid`). Se usan `datos_chofer.dni` (para filtrar los viajes que le
 *   corresponden), `nombre` (saludo y avisos) y `uid`/`nombre` (que la lógica
 *   compartida anota en el historial).
 * @param {Function} props.onLogout Callback de cierre de sesión, provisto por App.js.
 */
export default function ChoferScreen({ usuario, onLogout }) {
  /** Viajes del chofer abiertos (RECIBIDO / EN_VIAJE), ya adaptados con `adaptarViaje`. */
  const [viajes, setViajes] = useState([]);

  /** True hasta que llega el primer snapshot de Firestore. */
  const [cargando, setCargando] = useState(true);

  /** True mientras hay un cambio de estado en vuelo; deshabilita los botones. */
  const [procesando, setProcesando] = useState(false);

  /** Viaje sobre el que se está reportando una demora, o null. */
  const [modalDemora, setModalDemora] = useState(null);

  /** Texto del motivo de demora que escribe el chofer. */
  const [motivoDemora, setMotivoDemora] = useState('');

  /** Viaje sobre el que se está confirmando la entrega, o null. */
  const [modalFinalizar, setModalFinalizar] = useState(null);

  /** Visibilidad del modal que explica el permiso "Permitir siempre". */
  const [modalPermiso, setModalPermiso] = useState(false);

  /**
   * Estado del seguimiento GPS, para el banner de la interfaz.
   * 'inactivo' | 'sin_permiso' | 'solo_primer_plano' | 'activo' | 'error'
   */
  const [gpsEstado, setGpsEstado] = useState('inactivo');

  /**
   * Viaje activo actual. Es una ref y no estado porque lo consultan funciones
   * asíncronas que pueden resolverse después de un re-render; una ref siempre
   * expone el valor vigente, sin capturas obsoletas por closure.
   */
  const viajeActivoRef = useRef(null);

  /** Suscripción de `watchPositionAsync`, para poder darla de baja. */
  const watchRef = useRef(null);

  /**
   * Marca que se derivó al chofer a la pantalla de Ajustes del sistema, para
   * saber que al volver hay que reevaluar el permiso de background.
   */
  const esperandoAjustesRef = useRef(false);

  const dniUsuario = usuario?.datos_chofer?.dni || '';

  /** Avisos sin leer del chofer (bandeja). Ver avisos.js. */
  const { avisos, marcarLeido } = useAvisos(dniUsuario);

  /* Tema, insets y estilos. `crearEstilos` depende de los números de los insets
     y no del objeto, que cambia de identidad en cada render. */
  const { colores: c, oscuro, modo: modoTema, fijarModo } = useTema();
  const insets = useSafeAreaInsets();
  const s = useMemo(
    () => crearEstilos(c, insets),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, insets.top, insets.bottom, insets.left, insets.right]
  );

  /* ---------------------------------------------------------------------------
   * EFECTO 1 — Suscripción a los viajes del chofer
   *
   * Consulta indexada por `chofer_dni` + `estado` (índice en
   * firestore.indexes.json): trae solo los viajes de este DNI que siguen
   * abiertos, en vez de leer la colección de pedidos entera. Los FINALIZADO
   * quedan afuera a propósito: la app muestra trabajo pendiente, no historial.
   * Depende de `dniUsuario`: si cambia el chofer hay que resuscribirse.
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    if (!dniUsuario) { setCargando(false); return; }

    const consulta = query(
      collection(db, 'viajes'),
      where('chofer_dni', '==', dniUsuario),
      where('estado', 'in', [VIAJE.RECIBIDO, VIAJE.EN_VIAJE])
    );

    const unsub = onSnapshot(consulta, (snap) => {
      const encontrados = snap.docs.map(adaptarViaje);

      // Orden por fecha de carga ascendente ('AAAA-MM-DD' ordena como texto).
      encontrados.sort((a, b) => a.fecha_carga.localeCompare(b.fecha_carga));
      setViajes(encontrados);
      setCargando(false);
    }, (err) => {
      // Callback de error del listener: antes no existía, así que un fallo de
      // permisos o de red dejaba la pantalla en "Cargando..." para siempre.
      setCargando(false);
      logApp('snapshot_error', { code: err?.code || '', mensaje: err?.message || '' });
    });

    return () => unsub();
  }, [dniUsuario]);

  /* ---------------------------------------------------------------------------
   * EFECTO 2 — Mantener al día la ref del viaje activo
   *
   * Deliberadamente sin efectos colaterales: solo actualiza la ref. Corre en
   * cada snapshot, y por eso tiene que ser barato.
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    viajeActivoRef.current =
      viajes.find(v => v.estado === VIAJE.EN_VIAJE) || null;
  }, [viajes]);

  /**
   * Clave estable del viaje activo: su `id` (o '' si no hay ninguno).
   *
   * CORRIGE LA CAUSA 4. `viajes` es un array nuevo en cada snapshot de Firestore
   * — incluida cada escritura de GPS, o sea cada 30 segundos. Un efecto que
   * dependa de él se dispara constantemente, y como lo primero que hacía era
   * pedir permisos, el chofer terminaba acosado por diálogos (fue el síntoma que
   * reportó Sofía).
   *
   * Derivando un string, el efecto de abajo corre solo cuando el viaje activo
   * cambia de verdad.
   */
  const claveViajeActivo = useMemo(() => {
    const activo = viajes.find(v => v.estado === VIAJE.EN_VIAJE);
    return activo ? activo.id : '';
  }, [viajes]);

  /* ---------------------------------------------------------------------------
   * EFECTO 3 — Arranque y parada del seguimiento
   *
   * Con viaje activo: persiste el viaje en disco (para que la tarea de background
   * lo encuentre) y arranca la cadena de permisos.
   *
   * Sin viaje activo: descarga lo que quede en el buffer ANTES de limpiar, para
   * no perder el último tramo, y luego apaga todas las fuentes.
   *
   * La bandera `cancelado` evita tocar estado de React si el componente se
   * desmontó mientras las operaciones asíncronas estaban en vuelo.
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    let cancelado = false;

    async function sincronizar() {
      // Primero se descarta el estado local con la forma del modelo anterior
      // (si lo hay), para no mezclar sus puntos con los del viaje nuevo.
      await migrarEstadoLocal();

      if (claveViajeActivo) {
        const activo = viajeActivoRef.current;
        if (!activo) return;

        await escribirJSON(KEY_VIAJE_ACTIVO, { viajeId: activo.id });

        if (!cancelado) await activarSeguimiento();
      } else {
        // Orden importante: descargar primero, limpiar después.
        const previo = await leerJSON(KEY_VIAJE_ACTIVO, null);
        if (previo) await descargarBuffer(previo.viajeId);

        await AsyncStorage.removeItem(KEY_VIAJE_ACTIVO).catch(() => {});
        await AsyncStorage.removeItem(KEY_ULTIMO_PUNTO).catch(() => {});

        detenerWatchForeground();
        await detenerGPSBackground();

        if (!cancelado) setGpsEstado('inactivo');
      }
    }

    sincronizar();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveViajeActivo]);

  /* ---------------------------------------------------------------------------
   * EFECTO 4 — Reevaluar el permiso al volver de Ajustes
   *
   * En Android 11+ el pedido de background abre la pantalla de Ajustes del
   * sistema en vez de mostrar un diálogo. Cuando el chofer vuelve, este listener
   * detecta el regreso al estado 'active' y verifica si concedió el permiso, sin
   * obligarlo a tocar nada más.
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active' && esperandoAjustesRef.current) {
        esperandoAjustesRef.current = false;
        revisarPermisoBackground();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------------------
   * EFECTO 5 — Limpieza al desmontar
   *
   * Solo da de baja la suscripción de primer plano. La tarea de background NO se
   * detiene acá a propósito: tiene que seguir corriendo con la app cerrada, que
   * es justamente su razón de existir.
   *
   * También registra el gancho que usa `descargarBuffer` cuando descarta un
   * viaje cerrado por fuera: baja el seguimiento de primer plano y apaga el
   * banner. Sin dependencias: se registra una vez al montar.
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    ganchos.alDescartar = () => {
      detenerWatchForeground();
      setGpsEstado('inactivo');
    };
    return () => {
      ganchos.alDescartar = null;
      detenerWatchForeground();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===========================================================================
   * PERMISOS Y ARRANQUE DEL SEGUIMIENTO
   * ======================================================================== */

  /**
   * Asegura el permiso de notificaciones (POST_NOTIFICATIONS en Android 13+).
   *
   * CORRIGE LA CAUSA 2. Android exige que un foreground service muestre una
   * notificación persistente; sin este permiso la notificación no se muestra, el
   * chofer no tiene señal visible de que lo están rastreando, y varios
   * fabricantes (Xiaomi, Samsung, Motorola) matan servicios sin notificación
   * visible por gestión agresiva de batería.
   *
   * Delega en `asegurarPermisoNotificaciones` (notificaciones.js), el ÚNICO lugar
   * que pide este permiso: el registro del token push ya lo pide al ingresar, así
   * que acá normalmente solo se consulta. Antes esta función pedía el permiso
   * por su cuenta con `PermissionsAndroid`; con dos pedidos independientes el
   * chofer podía ver el diálogo dos veces o quedar con criterios distintos.
   *
   * @returns {Promise<boolean>} True si está concedido o si la plataforma no lo exige.
   */
  async function pedirPermisoNotificaciones() {
    return asegurarPermisoNotificaciones();
  }

  /**
   * Cadena de permisos escalonada y arranque de las fuentes de GPS.
   *
   * CORRIGE LA CAUSA 1. El orden no es opcional: la documentación de
   * expo-location para SDK 56 dice que los permisos de primer plano deben
   * concederse ANTES de pedir los de segundo plano, porque la app no puede
   * obtener el permiso de background sin el de foreground. El código anterior
   * pedía background directo, la solicitud volvía sin conceder y el seguimiento
   * jamás arrancaba.
   *
   * Secuencia:
   *   1. Foreground. Si falla, se corta acá y se registra `sin_permiso`.
   *   2. Se arranca YA la fuente de primer plano: no depende de nada más.
   *   3. Notificaciones (solo Android 13+). Si falla, se loguea y se sigue.
   *   4. Background: si ya estaba concedido arranca la tarea; si no, se muestra
   *      el modal explicativo antes de derivar a Ajustes.
   *
   * @returns {Promise<void>}
   */
  async function activarSeguimiento() {
    const fg = await Location.requestForegroundPermissionsAsync().catch(() => null);
    if (!fg || fg.status !== 'granted') {
      setGpsEstado('sin_permiso');
      await logApp('permiso_foreground_denegado', {
        puede_reintentar: fg ? String(fg.canAskAgain) : 'null',
      });
      return;
    }

    // Con el permiso de primer plano ya alcanza para registrar traza mientras el
    // chofer tiene la app abierta. Se arranca siempre, aunque el permiso de
    // background después falle: una fuente degradada es mejor que ninguna.
    await iniciarWatchForeground();
    setGpsEstado('solo_primer_plano');

    const notificaciones = await pedirPermisoNotificaciones();
    if (!notificaciones) {
      await logApp('permiso_notificaciones_denegado');
    }

    const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (bg && bg.status === 'granted') {
      await arrancarTareaBackground();
      return;
    }

    // En Android 11+ `requestBackgroundPermissionsAsync` no muestra diálogo:
    // manda al chofer directo a Ajustes. La propia doc de Expo recomienda
    // explicar antes por qué se necesita. Sin eso, el chofer aterriza en una
    // pantalla del sistema sin entender qué le pidieron.
    setModalPermiso(true);
  }

  /**
   * Confirmación del modal explicativo: dispara el pedido real de background.
   *
   * Marca `esperandoAjustesRef` para que el listener de AppState reevalúe el
   * permiso cuando el chofer vuelva de la pantalla del sistema.
   *
   * @returns {Promise<void>}
   */
  async function continuarPermisoBackground() {
    setModalPermiso(false);
    esperandoAjustesRef.current = true;
    try {
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status === 'granted') {
        esperandoAjustesRef.current = false;
        await arrancarTareaBackground();
      } else {
        await logApp('permiso_background_denegado', {
          puede_reintentar: String(bg.canAskAgain),
        });
      }
    } catch (err) {
      esperandoAjustesRef.current = false;
      await logApp('permiso_background_error', {
        code: err?.code || '',
        mensaje: err?.message || '',
      });
    }
  }

  /**
   * Verifica el permiso de background sin volver a solicitarlo, y arranca la
   * tarea si ya está concedido. Se invoca al regresar de Ajustes.
   *
   * @returns {Promise<void>}
   */
  async function revisarPermisoBackground() {
    const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
    if (bg && bg.status === 'granted') {
      await arrancarTareaBackground();
    }
  }

  /**
   * Registra la tarea de ubicación en segundo plano con su foreground service.
   *
   * El try/catch es CRÍTICO y no existía antes: si `startLocationUpdatesAsync`
   * fallaba (por ejemplo, por un servicio mal declarado en el manifiesto), el
   * rechazo quedaba sin manejar y era completamente invisible en producción. Es
   * plausible que el servicio viniera fallando al arrancar desde siempre.
   *
   * `killServiceOnDestroy: false` mantiene el seguimiento si el chofer saca la
   * app de recientes. Aun así, el comportamiento real varía por fabricante
   * (ver dontkillmyapp.com).
   *
   * @returns {Promise<void>}
   */
  async function arrancarTareaBackground() {
    try {
      const corriendo = await Location.hasStartedLocationUpdatesAsync(GPS_TASK).catch(() => false);
      if (!corriendo) {
        await Location.startLocationUpdatesAsync(GPS_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: GPS_INTERVALO_MS,
          distanceInterval: GPS_DISTANCIA_M,
          showsBackgroundLocationIndicator: true,
          pausesUpdatesAutomatically: false,
          foregroundService: {
            notificationTitle: 'TrackEx · viaje en curso',
            notificationBody: 'Se registra el recorrido hasta que finalices el viaje.',
            notificationColor: colorEstado.acentoVerde,
            killServiceOnDestroy: false,
          },
        });
      }
      setGpsEstado('activo');
      await logApp('gps_background_iniciado');
    } catch (err) {
      setGpsEstado('error');
      await logApp('gps_background_error', {
        code: err?.code || '',
        mensaje: err?.message || '',
      });
      // Se avisa sin alarmar: el viaje funciona igual, lo que se degrada es la traza.
      Alert.alert(
        'Seguimiento limitado',
        'No pudimos activar el registro del recorrido con la app cerrada. El viaje se registra igual, pero conviene avisarle al administrador.'
      );
    }
  }

  /**
   * Suscribe la fuente de primer plano (`watchPositionAsync`).
   *
   * Solo requiere permiso de foreground: ni servicio, ni notificación, ni
   * derivación a Ajustes. Es la red de seguridad para el chofer que nunca
   * concede "Permitir siempre" — mientras mire el teléfono, hay traza.
   *
   * Idempotente: si ya hay una suscripción viva, no crea otra.
   *
   * @returns {Promise<void>}
   */
  async function iniciarWatchForeground() {
    if (watchRef.current) return;
    try {
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: GPS_INTERVALO_MS,
          distanceInterval: GPS_DISTANCIA_M,
        },
        (loc) => { registrarPunto(loc.coords); }
      );
    } catch (err) {
      await logApp('watch_foreground_error', {
        code: err?.code || '',
        mensaje: err?.message || '',
      });
    }
  }

  /**
   * Da de baja la suscripción de primer plano, si existe.
   * Síncrona a propósito: se llama desde funciones de limpieza de efectos.
   */
  function detenerWatchForeground() {
    if (watchRef.current) {
      try { watchRef.current.remove(); } catch (e) { /* la suscripción ya no era válida */ }
      watchRef.current = null;
    }
  }

  /* ===========================================================================
   * CAPTURA PUNTUAL DE POSICIÓN
   * ======================================================================== */

  /**
   * Obtiene una posición única para el momento exacto de iniciar o finalizar.
   *
   * Es la fuente CRÍTICA del diseño: solo necesita permiso de primer plano, no
   * depende del servicio de background ni de la notificación, y por eso es la
   * más robusta de las tres. Antes de este cambio, iniciar y finalizar no
   * capturaban ubicación en absoluto — solo escribían un timestamp — y toda la
   * información de posición dependía de la fuente más frágil.
   *
   * Estrategia en tres pasos:
   *   1. Verificar el permiso; si falta, pedirlo (el chofer puede llegar acá sin
   *      haber pasado por `activarSeguimiento`, por ejemplo al iniciar el primer
   *      viaje del día).
   *   2. `getCurrentPositionAsync` con timeout, porque bajo techo puede no fijar
   *      posición nunca y dejaría el botón colgado.
   *   3. Fallback a la última posición conocida, si no supera los 5 minutos.
   *
   * @returns {Promise<{lat:number,lng:number,ts:string,precision:number|null,origen:string}|null>}
   *   El punto, o null si no se pudo obtener. Null NO bloquea el viaje.
   */
  async function obtenerPuntoActual() {
    try {
      const fg = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!fg || fg.status !== 'granted') {
        const pedido = await Location.requestForegroundPermissionsAsync().catch(() => null);
        if (!pedido || pedido.status !== 'granted') return null;
      }

      // `Promise.race` contra un temporizador: expo-location no expone timeout.
      const posicion = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise((resolve) => setTimeout(() => resolve(null), TIMEOUT_PUNTO_MS)),
      ]).catch(() => null);

      if (posicion && posicion.coords) {
        return {
          lat: posicion.coords.latitude,
          lng: posicion.coords.longitude,
          ts: new Date().toISOString(),
          precision: posicion.coords.accuracy ?? null,
          origen: 'actual',
        };
      }

      // Fallback: mejor una posición de hace unos minutos que ninguna.
      const ultima = await Location.getLastKnownPositionAsync({
        maxAge: EDAD_MAXIMA_ULTIMA_POSICION_MS,
      }).catch(() => null);

      if (ultima && ultima.coords) {
        return {
          lat: ultima.coords.latitude,
          lng: ultima.coords.longitude,
          ts: new Date(ultima.timestamp || Date.now()).toISOString(),
          precision: ultima.coords.accuracy ?? null,
          origen: 'ultima_conocida',
        };
      }

      return null;
    } catch (err) {
      await logApp('punto_actual_error', {
        code: err?.code || '',
        mensaje: err?.message || '',
      });
      return null;
    }
  }

  /* ===========================================================================
   * ACCIONES DEL CHOFER
   *
   * La escritura la hacen las funciones compartidas (`src/compartido.js`):
   * transacciones que revalidan el estado del viaje en el servidor y dejan
   * historial. Acá solo se arma el contexto (posición, buffer GPS, usuario) y se
   * manejan los errores y el aviso al coordinador.
   * ======================================================================== */

  /**
   * Avisa al coordinador vía Apps Script (`chofer_demora` / `chofer_finalizo`).
   *
   * Va DESPUÉS de confirmada la acción y aislado en su propio try: si el Apps
   * Script falla, el viaje ya quedó escrito y no debe revertirse ni reportarse
   * como error al chofer. Antes compartía el catch con la escritura, así que un
   * fallo de red del aviso mostraba "no se pudo actualizar" aunque sí se hubiera
   * actualizado.
   *
   * `ov` va vacío: el viaje no trae el número de OV. Se conserva la clave
   * porque el Apps Script espera el mismo payload que antes.
   *
   * @param {string} accion 'chofer_demora' | 'chofer_finalizo'
   * @param {Object} viaje Viaje adaptado (`adaptarViaje`).
   * @param {string} [motivo] Motivo de la demora, si corresponde.
   * @returns {Promise<void>}
   */
  async function avisarCoordinador(accion, viaje, motivo = '') {
    const payload = {
      accion,
      pedido_id: viaje.pedido_id,
      chofer: usuario?.nombre || dniUsuario,
      producto: viaje.producto,
      cliente: viaje.cliente,
      ov: '',
      lugar: viaje.lugar,
      motivo,
    };
    try {
      await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString());
    } catch (errAviso) {
      await logApp('aviso_apps_script_error', {
        code: errAviso?.code || '',
        mensaje: errAviso?.message || '',
        viaje_id: viaje.id,
      });
    }
  }

  /**
   * Muestra y registra el error de una acción.
   *
   * Los errores de la lógica compartida son `Error` con mensaje en español y sin
   * `code` ("Ya tenés un viaje en curso…"): se muestran tal cual. Los de
   * Firestore traen `code` y un mensaje técnico en inglés: se muestra el código.
   * En los dos casos se registra en `app_logs` — antes se descartaba y esa
   * decisión ocultó el problema durante días.
   *
   * @param {Error} err Error capturado.
   * @param {string} accion 'iniciar' | 'demora' | 'finalizar'
   * @param {Object} viaje Viaje sobre el que se actuaba.
   * @returns {Promise<void>}
   */
  async function manejarErrorAccion(err, accion, viaje) {
    const code = err?.code || err?.name || 'desconocido';
    await logApp('estado_error', {
      code,
      mensaje: err?.message || '',
      viaje_id: viaje?.id || '',
      accion,
      dni: dniUsuario,
    });
    Alert.alert(
      'Error',
      err?.code
        ? `No se pudo actualizar el viaje (${err.code}). Intentá de nuevo.`
        : (err?.message || 'No se pudo actualizar el viaje. Intentá de nuevo.')
    );
  }

  /**
   * Confirma el reporte de demora desde el modal.
   *
   * No captura ubicación: la demora es un evento del viaje, no de posición. Si
   * falla, el modal queda abierto con el texto para poder reintentar.
   *
   * @returns {Promise<void>}
   */
  async function confirmarDemora() {
    const motivo = motivoDemora.trim();
    if (!motivo) { Alert.alert('Error', 'Describí el problema antes de continuar.'); return; }

    const viaje = modalDemora;
    setProcesando(true);
    try {
      await reportarDemora({ db, viaje, motivo, usuario });
      await logApp('estado_actualizado', { viaje_id: viaje.id, estado: 'demorado', dni: dniUsuario });
      await avisarCoordinador('chofer_demora', viaje, motivo);
      setModalDemora(null);
      setMotivoDemora('');
    } catch (err) {
      await manejarErrorAccion(err, 'demora', viaje);
    } finally {
      setProcesando(false);
    }
  }

  /**
   * Confirma la entrega desde el modal.
   *
   * ORDEN (no es opcional):
   *   1. Obtener la posición de fin.
   *   2. Descargar el buffer GPS. Las reglas de `gps_puntos` exigen el viaje en
   *      EN_VIAJE, así que tiene que ir ANTES de cerrarlo: después rebota.
   *   3. `finalizarViaje`, que cierra el viaje y empuja el despacho a ENTREGADO.
   *
   * @returns {Promise<void>}
   */
  async function confirmarFinalizar() {
    const viaje = modalFinalizar;
    setProcesando(true);
    try {
      if (!viaje.despacho_id) {
        throw new Error('El viaje no tiene despacho asociado. Avisale al coordinador.');
      }

      // 1. Posición de fin. Sin ubicación el viaje se cierra igual.
      const posicion = await obtenerPuntoActual();
      if (!posicion) {
        await logApp('punto_no_disponible', { viaje_id: viaje.id, accion: 'finalizar' });
      }

      // 2. Traza pendiente, mientras el viaje todavía está EN_VIAJE.
      const guardado = await leerJSON(KEY_VIAJE_ACTIVO, null);
      if (guardado?.viajeId) await descargarBuffer(guardado.viajeId);

      // 3. Cierre.
      await finalizarViaje({
        db,
        viaje,
        despacho: { id: viaje.despacho_id },
        posicion,
        cerradoPor: 'chofer',
        usuario,
      });

      await logApp('estado_actualizado', { viaje_id: viaje.id, estado: 'finalizado', dni: dniUsuario });
      await avisarCoordinador('chofer_finalizo', viaje);
      setModalFinalizar(null);
    } catch (err) {
      await manejarErrorAccion(err, 'finalizar', viaje);
    } finally {
      setProcesando(false);
    }
  }

  /**
   * Inicia un viaje. Captura la posición de partida.
   *
   * Conserva el flujo de permisos y GPS (`obtenerPuntoActual` pide el permiso de
   * primer plano si falta). Sin ubicación el viaje arranca igual:
   * `iniciarViaje` registra `inicio_origen: 'sin_senal'`. `misViajes` le permite
   * rechazar el inicio si ya hay otro viaje en curso.
   *
   * @param {Object} v Viaje a iniciar (de la lista `viajes`).
   * @returns {Promise<void>}
   */
  async function confirmarIniciar(v) {
    setProcesando(true);
    try {
      const posicion = await obtenerPuntoActual();
      if (!posicion) {
        await logApp('punto_no_disponible', { viaje_id: v.id, accion: 'iniciar' });
      }

      await iniciarViaje({ db, viaje: v, posicion, misViajes: viajes, usuario });
      await logApp('estado_actualizado', { viaje_id: v.id, estado: 'iniciado', dni: dniUsuario });
    } catch (err) {
      await manejarErrorAccion(err, 'iniciar', v);
    } finally {
      setProcesando(false);
    }
  }

  /* ===========================================================================
   * NAVEGACIÓN EXTERNA Y FORMATO
   * ======================================================================== */

  /**
   * Abre los ajustes de la app. Es la salida que se le ofrece al chofer cuando
   * el permiso está denegado y el sistema ya no vuelve a preguntar.
   * Si `openSettings` falla, se dan las instrucciones manuales.
   */
  function abrirAjustes() {
    Linking.openSettings().catch(() => {
      Alert.alert('Ajustes', 'Abrí Ajustes → Apps → TrackEx → Permisos → Ubicación.');
    });
  }

  /**
   * Abre Google Maps con navegación hacia el destino del despacho.
   * @param {string} lugar Dirección de destino en texto libre.
   */
  function abrirGoogleMaps(lugar) {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(lugar)}&travelmode=driving`;
    Linking.openURL(url);
  }

  /**
   * Abre Waze con navegación hacia el destino.
   * Intenta primero el esquema nativo `waze://` y cae a la versión web si la app
   * no está instalada.
   *
   * @param {string} lugar Dirección de destino en texto libre.
   */
  function abrirWaze(lugar) {
    const url = `waze://?q=${encodeURIComponent(lugar)}&navigate=yes`;
    Linking.canOpenURL(url).then(supported => {
      if (supported) Linking.openURL(url);
      else Linking.openURL(`https://waze.com/ul?q=${encodeURIComponent(lugar)}&navigate=yes`);
    });
  }

  /**
   * Convierte una fecha 'AAAA-MM-DD' a 'DD/MM' para mostrar en pantalla.
   * @param {string} str Fecha en formato ISO corto.
   * @returns {string} 'DD/MM', o el original si no matchea, o '—' si está vacío.
   */
  function formatFecha(str) {
    if (!str) return '—';
    const partes = str.split('-');
    return partes.length === 3 ? `${partes[2]}/${partes[1]}` : str;
  }

  /**
   * Expresa cuánto pasó desde un timestamp, en lenguaje natural.
   *
   * OJO: espera ISO 8601. Hay campos en la base guardados con
   * `toLocaleString('es-AR')` en formato 12h SIN AM/PM (`creado_en`,
   * `aceptado_en`), que son ambiguos y no parseables de forma confiable. Está en
   * la lista de defectos a corregir; esta función solo se usa con campos ISO.
   *
   * @param {string} isoStr Timestamp ISO 8601.
   * @returns {string} 'hace X h Y min' o 'hace Y min'.
   */
  function tiempoDesde(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `hace ${h} h ${m} min`;
    return `hace ${m} min`;
  }

  /* ===========================================================================
   * SELECTOR DE TEMA
   * ======================================================================== */

  /**
   * Abre el selector de tema (Automático / Claro / Oscuro).
   *
   * Es un `Alert` con exactamente 3 botones porque Android admite como máximo 3
   * y así no hace falta un modal propio. `cancelable: true` permite cerrarlo
   * tocando afuera. El mensaje dice el modo vigente para que el chofer sepa qué
   * está eligiendo.
   */
  function abrirSelectorTema() {
    const vigente = oscuro ? 'oscuro' : 'claro';
    const actual = modoTema === 'auto' ? `Automático (${vigente})` : vigente[0].toUpperCase() + vigente.slice(1);
    Alert.alert(
      'Tema',
      `Modo actual: ${actual}`,
      [
        { text: 'Automático', onPress: () => fijarModo(null) },
        { text: 'Claro', onPress: () => fijarModo('claro') },
        { text: 'Oscuro', onPress: () => fijarModo('oscuro') },
      ],
      { cancelable: true }
    );
  }

  /* ===========================================================================
   * VALORES DERIVADOS PARA EL RENDER
   * ======================================================================== */

  /**
   * Viaje de referencia del encabezado: el que está en ruta si lo hay; si no, el
   * primero de la lista (ordenada por fecha de carga). El degradé y la etiqueta
   * salen de su ESTADO real, no de la demora (que es un atributo).
   */
  const viajeActivo = viajes.find(v => v.estado === VIAJE.EN_VIAJE) || viajes[0] || null;
  const estadoHeader = estadoEncabezado(viajeActivo);
  const nombreCorto = usuario?.nombre?.split(' ')[0] || 'Chofer';

  /** Hay un viaje en curso (EN_VIAJE), no solo nominado. */
  const hayViajeEnCurso = !!claveViajeActivo;

  /** Hay viaje en curso pero el seguimiento no está corriendo del todo. */
  const seguimientoIncompleto = hayViajeEnCurso && gpsEstado !== 'activo';

  /** Mensajes del banner, uno por estado posible del seguimiento. */
  const textoSeguimiento = {
    sin_permiso: 'El seguimiento está apagado: la app no tiene permiso de ubicación.',
    solo_primer_plano: 'El recorrido solo se registra con la app abierta. Activá "Permitir siempre" para que siga con la pantalla bloqueada.',
    error: 'No pudimos activar el registro del recorrido. Avisale al administrador.',
    inactivo: 'El seguimiento todavía no está activo.',
  };

  /* ===========================================================================
   * RENDER
   *
   * Raíz: View flex 1 con fondo del tema. Hijos EN ESTE ORDEN: los tres Modal,
   * el encabezado, el ScrollView (flex 1) y, ÚLTIMO, el PieVersion. El pie es
   * HERMANO del ScrollView, nunca hijo: así queda siempre al fondo, sin
   * scrollear con el contenido y sin quedar tapado.
   *
   * Los Modal viven en otra ventana nativa. Se les pasa `statusBarTranslucent` y
   * `navigationBarTranslucent` (props de RN 0.85) para que la ventana sea
   * edge-to-edge como la de la app y los insets de `useSafeAreaInsets()` valgan
   * también adentro. A VERIFICAR EN DISPOSITIVO.
   * ======================================================================== */

  return (
    <View style={s.wrap}>

      {/* Modal explicativo del permiso de background.
          Se muestra ANTES de derivar a Ajustes, como recomienda la doc de Expo
          para Android 11+, donde el pedido no muestra diálogo propio. */}
      <Modal visible={modalPermiso} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <ColumnaCentrada style={s.modalContenido}>
              <Text style={s.modalIco}>📍</Text>
              <Text style={s.modalTit}>Permitir ubicación siempre</Text>
              <Text style={s.modalDesc}>
                Para registrar el recorrido del camión con la pantalla bloqueada, Android
                necesita que elijas <Text style={s.negrita}>"Permitir siempre"</Text>.
              </Text>
              <Text style={s.modalDesc}>
                Al continuar se abre la pantalla de Ajustes del sistema. Entrá en
                Ubicación y seleccioná esa opción. Mientras dure el viaje vas a ver una
                notificación que te avisa que el seguimiento está activo.
              </Text>
              <TouchableOpacity style={s.btnVerde} onPress={continuarPermisoBackground}>
                <Text style={s.btnBlanco}>Continuar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnGris} onPress={() => setModalPermiso(false)}>
                <Text style={s.btnGrisTxt}>Ahora no</Text>
              </TouchableOpacity>
            </ColumnaCentrada>
          </View>
        </View>
      </Modal>

      {/* Modal de reporte de demora. El KeyboardAvoidingView evita que el campo
          de texto y los botones queden bajo el teclado. */}
      <Modal visible={!!modalDemora} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent>
        <KeyboardAvoidingView style={s.overlay} behavior="padding">
          <View style={s.modal}>
            <ColumnaCentrada style={s.modalContenido}>
              <Text style={s.modalIco}>⚠️</Text>
              <Text style={s.modalTit}>Reportar demora</Text>
              {modalDemora && <Text style={s.modalSub}>{modalDemora.producto} · {modalDemora.cliente}</Text>}
              <TextInput style={s.textarea} placeholder="Describí el problema (tráfico, desperfecto, clima, etc.)"
                placeholderTextColor={c.textoTenue}
                value={motivoDemora} onChangeText={setMotivoDemora} multiline numberOfLines={3} />
              <TouchableOpacity style={s.btnRojo} onPress={confirmarDemora} disabled={procesando}>
                <Text style={s.btnBlanco}>{procesando ? 'Enviando...' : 'Reportar demora'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnGris} onPress={() => { setModalDemora(null); setMotivoDemora(''); }}>
                <Text style={s.btnGrisTxt}>Cancelar</Text>
              </TouchableOpacity>
            </ColumnaCentrada>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal de confirmación de entrega */}
      <Modal visible={!!modalFinalizar} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent>
        <View style={s.overlay}>
          <View style={s.modal}>
            <ColumnaCentrada style={s.modalContenido}>
              <Text style={s.modalIco}>✅</Text>
              <Text style={s.modalTit}>Confirmar entrega</Text>
              {modalFinalizar && <Text style={s.modalSub}>{modalFinalizar.producto} · {modalFinalizar.cliente}{'\n'}{modalFinalizar.lugar}</Text>}
              <Text style={s.modalDesc}>Al confirmar, el coordinador recibe la notificación y quedás libre para un nuevo viaje.</Text>
              <TouchableOpacity style={s.btnVerde} onPress={confirmarFinalizar} disabled={procesando}>
                <Text style={s.btnBlanco}>{procesando ? 'Confirmando...' : '✓ Confirmar entrega'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnGris} onPress={() => setModalFinalizar(null)}>
                <Text style={s.btnGrisTxt}>Cancelar</Text>
              </TouchableOpacity>
            </ColumnaCentrada>
          </View>
        </View>
      </Modal>

      {/* Encabezado: el degradé y la etiqueta salen del ESTADO del viaje de
          referencia (RECIBIDO / EN_VIAJE); la demora se muestra como badge. El
          degradé ocupa todo el ancho; el contenido va en la columna central. */}
      <LinearGradient colors={DEGRADE_ENCABEZADO[estadoHeader]} style={s.header}>
        <ColumnaCentrada>
          <View style={s.headerTop}>
            <Text style={s.headerAppName}>TrackEx</Text>
            <View style={s.headerAcciones}>
              {/* Selector de tema: Automático / Claro / Oscuro. */}
              <TouchableOpacity onPress={abrirSelectorTema} hitSlop={HIT_SLOP}>
                <Text style={s.btnTema}>🌓</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={onLogout} hitSlop={HIT_SLOP}>
                <Text style={s.btnSalir}>Salir</Text>
              </TouchableOpacity>
            </View>
          </View>
          {cargando ? (
            <Text style={s.headerSub}>Cargando...</Text>
          ) : viajeActivo ? (
            <View style={s.headerContent}>
              <Text style={s.headerSub}>{ETIQUETA_ENCABEZADO[estadoHeader]}</Text>
              <Text style={s.headerTitulo}>{viajeActivo.producto} · {viajeActivo.cliente}</Text>
              <View style={s.badgeRow}>
                {viajeActivo.volumen != null && (
                  <View style={s.badge}><Text style={s.badgeTxt}>{viajeActivo.volumen} tn</Text></View>
                )}
                {viajeActivo.ov ? (
                  <View style={s.badge}><Text style={s.badgeTxt}>OV {viajeActivo.ov}</Text></View>
                ) : null}
                {viajeActivo.estado_ts ? (
                  <View style={s.badge}><Text style={s.badgeTxt}>{tiempoDesde(viajeActivo.estado_ts)}</Text></View>
                ) : null}
                {viajeActivo.demorado ? (
                  <View style={s.badgeDemora}><Text style={s.badgeDemoraTxt}>Demorado</Text></View>
                ) : null}
              </View>
            </View>
          ) : (
            <View style={s.headerContent}>
              <Text style={s.headerSub}>{ETIQUETA_ENCABEZADO.libre}</Text>
              <Text style={s.headerTitulo}>Hola, {nombreCorto}</Text>
              <View style={s.badgeRow}>
                <View style={s.badge}><Text style={s.badgeTxt}>🟢 Libre</Text></View>
              </View>
            </View>
          )}
        </ColumnaCentrada>
      </LinearGradient>

      {/* Cuerpo: ScrollView flex 1. Sin `flex: 1` en su contenido. El inset
          inferior lo maneja el pie, por eso solo lleva un paddingBottom fijo. */}
      <ScrollView style={s.body} contentContainerStyle={s.bodyContenido}>
        <ColumnaCentrada>

          {/* Bandeja de avisos sin leer: una tarjeta por aviso, más nuevo
              primero. Sin avisos, el bloque no se renderiza. El color sale del
              tipo de aviso (ver `coloresAviso`). "Entendido" lo marca leído y
              desaparece de la lista. */}
          {avisos.length > 0 && (
            <View style={s.bandeja}>
              {avisos.map(a => {
                const col = coloresAviso(a.tipo, c);
                return (
                  <View key={a.id} style={[s.aviso, { backgroundColor: col.fondo, borderColor: col.borde }]}>
                    <Text style={[s.avisoTit, { color: col.texto }]}>{a.titulo}</Text>
                    {a.mensaje ? <Text style={[s.avisoMsg, { color: col.texto }]}>{a.mensaje}</Text> : null}
                    <View style={s.avisoPie}>
                      <Text style={[s.avisoTiempo, { color: col.texto }]}>{tiempoDesde(a.creado_en)}</Text>
                      <TouchableOpacity
                        style={[s.btnEntendido, { borderColor: col.texto }]}
                        onPress={() => marcarLeido(a.id)}
                        hitSlop={HIT_SLOP}>
                        <Text style={[s.btnEntendidoTxt, { color: col.texto }]}>Entendido</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* El perfil no tiene DNI: sin él no se puede resolver ningún viaje. */}
          {!dniUsuario && (
            <View style={s.alerta}>
              <Text style={s.alertaTxt}>⚠️ Tu perfil no tiene DNI registrado. Contactá al administrador.</Text>
            </View>
          )}

          {/* Aviso persistente cuando el seguimiento no está corriendo.
              Antes, si el permiso se denegaba el viaje seguía igual y nadie se
              enteraba de que no había traza — ni el chofer ni el coordinador. La
              nota final es deliberada: el chofer tiene que saber que puede seguir
              operando, para que no interprete el aviso como un bloqueo. */}
          {seguimientoIncompleto && (
            <View style={s.gpsAviso}>
              <Text style={s.gpsAvisoTit}>📍 Seguimiento incompleto</Text>
              <Text style={s.gpsAvisoTxt}>
                {textoSeguimiento[gpsEstado] || textoSeguimiento.inactivo}
              </Text>
              <Text style={s.gpsAvisoNota}>
                Podés iniciar y finalizar el viaje igual: esto solo afecta el registro del recorrido.
              </Text>
              <TouchableOpacity style={s.gpsAvisoBtn} onPress={abrirAjustes}>
                <Text style={s.gpsAvisoBtnTxt}>Abrir ajustes de la app</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Estado vacío: sin viajes abiertos. */}
          {!cargando && dniUsuario && viajes.length === 0 && (
            <View style={s.libreWrap}>
              <Text style={s.libreIco}>🟢</Text>
              <Text style={s.libreTit}>Libre</Text>
              <Text style={s.libreSub}>Cuando el transportista te nomine, el viaje aparecerá acá automáticamente.</Text>
            </View>
          )}

          {/* Una tarjeta por viaje abierto. Los campos opcionales (horario de
              carga, entrega, transporte, observaciones) se muestran SOLO si el
              viaje los trae: nada de etiquetas vacías. */}
          {viajes.map(v => (
            <View key={v.id} style={s.card}>
              <View style={s.cardGrid}>
                {v.origen ? <View style={s.field}><Text style={s.lbl}>Origen</Text><Text style={s.val}>{v.origen}</Text></View> : null}
                {v.lugar ? <View style={s.field}><Text style={s.lbl}>Destino</Text><Text style={s.val}>{v.lugar}</Text></View> : null}
                {v.fecha_carga ? <View style={s.field}><Text style={s.lbl}>Fecha carga</Text><Text style={s.val}>{formatFecha(v.fecha_carga)}{v.horario_carga ? ' · ' + v.horario_carga : ''}</Text></View> : null}
                {v.patente_tractor ? <View style={s.field}><Text style={s.lbl}>Unidad</Text><Text style={s.val}>{v.patente_tractor}{v.patente_semi ? ' / ' + v.patente_semi : ''}</Text></View> : null}
                {v.fecha_entrega ? <View style={s.field}><Text style={s.lbl}>Entrega</Text><Text style={s.val}>{formatFecha(v.fecha_entrega)}{v.banda_horaria ? ' · ' + v.banda_horaria : ''}</Text></View> : null}
                {v.transporte ? <View style={s.field}><Text style={s.lbl}>Transporte</Text><Text style={s.val}>{v.transporte}</Text></View> : null}
              </View>

              {/* Observaciones (si el viaje las trae) y motivo de la demora. */}
              {v.obs ? <View style={s.obsBanner}><Text style={s.obsTxt}>📋 {v.obs}</Text></View> : null}
              {v.demorado && v.demora_motivo ? <View style={s.demoraBanner}><Text style={s.demoraTxt}>⚠️ {v.demora_motivo}</Text></View> : null}

              {/* Navegación: solo con el viaje ya en curso. Antes de arrancar no
                  tiene sentido ofrecer ruta. */}
              {v.estado === VIAJE.EN_VIAJE && v.lugar && (
                <View style={s.navWrap}>
                  <Text style={s.navLbl}>📍 {v.lugar}</Text>
                  <View style={s.navBtns}>
                    <TouchableOpacity style={s.btnGoogleMaps} onPress={() => abrirGoogleMaps(v.lugar)}>
                      <Text style={s.btnGoogleMapsTxt}>🗺 Google Maps</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.btnWaze} onPress={() => abrirWaze(v.lugar)}>
                      <Text style={s.btnWazeTxt}>Waze</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Acciones disponibles según el estado.
                  RECIBIDO → Iniciar
                  EN_VIAJE → Finalizar | Reportar demora (solo si aún no está
                             demorado: la demora es un atributo del viaje, ya
                             reportada no se repite ni se revierte). */}
              <View style={s.actions}>
                {v.estado === VIAJE.RECIBIDO && (
                  <TouchableOpacity style={[s.btnPrimario, { opacity: procesando ? 0.7 : 1 }]}
                    disabled={procesando}
                    onPress={() => confirmarIniciar(v)}>
                    {procesando ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimarioTxt}>🚛 Iniciar viaje</Text>}
                  </TouchableOpacity>
                )}
                {v.estado === VIAJE.EN_VIAJE && (
                  <TouchableOpacity style={[s.btnPrimario, { opacity: procesando ? 0.7 : 1 }]}
                    disabled={procesando} onPress={() => setModalFinalizar(v)}>
                    <Text style={s.btnPrimarioTxt}>✓ Finalizar viaje</Text>
                  </TouchableOpacity>
                )}
                {v.estado === VIAJE.EN_VIAJE && !v.demorado && (
                  <TouchableOpacity style={[s.btnSecundario, { opacity: procesando ? 0.7 : 1 }]}
                    disabled={procesando} onPress={() => setModalDemora(v)}>
                    <Text style={s.btnSecundarioTxt}>⚠️ Reportar demora</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </ColumnaCentrada>
      </ScrollView>

      {/* Pie de versión: ÚLTIMO hijo, hermano del ScrollView. */}
      <PieVersion />
    </View>
  );
}

/* =============================================================================
 * ESTILOS
 *
 * `crearEstilos` se llama dentro de un `useMemo` (ver el componente) con los
 * colores del tema y los insets; reemplaza al StyleSheet estático anterior, que
 * no podía cambiar con el tema ni con los insets.
 *
 * Todos los colores salen de los tokens (`c` = tema claro/oscuro;
 * `colorEstado`, `marca`). Tipografía: Montserrat con `fontFamily: fuente(peso)`,
 * nunca la propiedad de peso (en RN usar las dos puede dar negrita simulada).
 *
 * LITERALES DE COLOR PERMITIDOS (no existe token equivalente):
 *   '#33CCFF'              celeste de marca de Waze (botón de Waze)
 *   '#fff'                 texto o íconos sobre fondos de acento (botones de
 *                          acción, encabezado de color)
 *   rgba(255,255,255,x)    blancos translúcidos sobre el encabezado de color
 *   rgba(0,0,0,0.5)        scrim de los bottom sheets
 *   '#000'                 shadowColor de las tarjetas (RN lo exige)
 *
 * Los tamaños sin token (22, 24, 36, 48) están en `tema/dimensiones.js`. Los
 * espaciados que no coinciden con `espacio` (10, 14, 6, 9...) se dejaron como
 * números del diseño original.
 *
 * INSETS (edge-to-edge): el encabezado suma `insets.top` + 28 (antes un 60
 * fijo); los laterales de encabezado, cuerpo y bottom sheets usan
 * `Math.max(inset, espacio.lg)` para respetar notch o cámara en horizontal; los
 * bottom sheets suman `insets.bottom + espacio.xl`; el pie maneja el inset
 * inferior del resto de la pantalla (ver PieVersion).
 * ========================================================================== */

/**
 * Arma los estilos de ChoferScreen.
 *
 * @param {Object} c Colores del tema (`temaClaro` o `temaOscuro`).
 * @param {{top:number,bottom:number,left:number,right:number}} insets Insets seguros.
 * @returns {Object} Estilos de `StyleSheet.create`.
 */
function crearEstilos(c, insets) {
  const peso = tipografia.peso;
  const tam = tipografia.tamano;
  const izq = Math.max(insets.left, espacio.lg);
  const der = Math.max(insets.right, espacio.lg);

  return StyleSheet.create({
    // --- Contenedores generales ---
    wrap: { flex: 1, backgroundColor: c.fondo },
    body: { flex: 1 },
    bodyContenido: { paddingTop: 14, paddingBottom: espacio.lg, paddingLeft: izq, paddingRight: der },

    // --- Encabezado con degradé ---
    header: { paddingTop: insets.top + 28, paddingBottom: espacio.xxl, paddingLeft: izq, paddingRight: der },
    headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: espacio.lg },
    headerAppName: { fontSize: tam.lg, fontFamily: fuente(peso.negrita), color: 'rgba(255,255,255,0.8)' },
    headerAcciones: { flexDirection: 'row', alignItems: 'center', gap: espacio.md },
    btnTema: { fontSize: tam.titulo, padding: espacio.xs },
    btnSalir: { fontSize: tam.md, fontFamily: fuente(peso.normal), color: 'rgba(255,255,255,0.6)', padding: espacio.xs },
    headerContent: { gap: 6 },
    headerSub: { fontSize: tam.xs, fontFamily: fuente(peso.medio), color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 1 },
    headerTitulo: { fontSize: TAMANO_TITULO_ENCABEZADO, fontFamily: fuente(peso.fuerte), color: '#fff', letterSpacing: -0.3 },
    badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: espacio.xs },
    badge: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: radio.pastilla, paddingHorizontal: 10, paddingVertical: espacio.xs },
    badgeTxt: { fontSize: tam.sm, fontFamily: fuente(peso.medio), color: '#fff' },
    badgeDemora: { backgroundColor: colorEstado.advertenciaFondoAlterno, borderRadius: radio.pastilla, paddingHorizontal: 10, paddingVertical: espacio.xs },
    badgeDemoraTxt: { fontSize: tam.sm, fontFamily: fuente(peso.negrita), color: colorEstado.advertenciaTextoFuerte },

    // --- Bandeja de avisos (los colores por tipo se aplican en línea, ver coloresAviso) ---
    bandeja: { gap: espacio.sm, marginBottom: 14 },
    aviso: { borderWidth: 1, borderRadius: radio.lg, padding: espacio.md, gap: 6 },
    avisoTit: { fontSize: tam.lg, fontFamily: fuente(peso.fuerte) },
    avisoMsg: { fontSize: tam.md, fontFamily: fuente(peso.normal), lineHeight: 18 },
    avisoPie: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: espacio.xs },
    avisoTiempo: { fontSize: tam.xs, fontFamily: fuente(peso.normal), opacity: 0.75 },
    btnEntendido: { borderWidth: 1, borderRadius: radio.md, paddingVertical: 6, paddingHorizontal: espacio.md },
    btnEntendidoTxt: { fontSize: tam.sm, fontFamily: fuente(peso.negrita) },

    // --- Aviso de perfil incompleto ---
    alerta: { backgroundColor: colorEstado.advertenciaFondoAlterno, borderRadius: radio.lg, padding: espacio.md, marginBottom: 14 },
    alertaTxt: { fontSize: tam.md, fontFamily: fuente(peso.normal), color: colorEstado.advertenciaTextoFuerte },

    // --- Aviso de seguimiento GPS incompleto ---
    gpsAviso: { backgroundColor: colorEstado.advertenciaFondo, borderWidth: 1, borderColor: colorEstado.advertenciaBordeAlterno, borderRadius: radio.lg, padding: espacio.md, marginBottom: 14, gap: 6 },
    gpsAvisoTit: { fontSize: tam.md, fontFamily: fuente(peso.fuerte), color: colorEstado.advertenciaTexto },
    gpsAvisoTxt: { fontSize: tam.sm, fontFamily: fuente(peso.normal), color: colorEstado.advertenciaTexto, lineHeight: 18 },
    gpsAvisoNota: { fontSize: tam.xs, fontFamily: fuente(peso.normal), color: colorEstado.advertenciaTexto, fontStyle: 'italic' },
    gpsAvisoBtn: { backgroundColor: c.superficie, borderWidth: 1, borderColor: colorEstado.advertenciaBordeAlterno, borderRadius: radio.md, paddingVertical: 9, alignItems: 'center', marginTop: 2 },
    gpsAvisoBtnTxt: { fontSize: tam.md, fontFamily: fuente(peso.negrita), color: colorEstado.advertenciaTexto },

    // --- Estado vacío ---
    libreWrap: { alignItems: 'center', paddingVertical: 60 },
    libreIco: { fontSize: TAMANO_ICONO_VACIO, marginBottom: espacio.md },
    libreTit: { fontSize: TAMANO_TITULO_VACIO, fontFamily: fuente(peso.fuerte), color: c.texto, marginBottom: espacio.sm },
    libreSub: { fontSize: tam.lg, fontFamily: fuente(peso.normal), color: c.textoSuave, textAlign: 'center', lineHeight: 22, paddingHorizontal: 20 },

    // --- Tarjeta de viaje ---
    // '#000': shadowColor de la tarjeta (RN lo exige; no hay token).
    card: { backgroundColor: c.superficie, borderRadius: radio.xl, padding: 14, marginBottom: espacio.md, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
    cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: espacio.md },
    field: { width: '47%' }, // dos columnas con el gap de 10
    lbl: { fontSize: tam.xs, fontFamily: fuente(peso.normal), color: c.textoSuave, marginBottom: 2 },
    val: { fontSize: tam.md, fontFamily: fuente(peso.medio), color: c.texto },
    obsBanner: { backgroundColor: c.fondoAlterno, borderRadius: radio.md, padding: 10, marginBottom: 10 },
    obsTxt: { fontSize: tam.sm, fontFamily: fuente(peso.normal), color: c.textoSecundario },
    demoraBanner: { backgroundColor: colorEstado.advertenciaFondoAlterno, borderRadius: radio.md, padding: 10, marginBottom: 10 },
    demoraTxt: { fontSize: tam.sm, fontFamily: fuente(peso.normal), color: colorEstado.advertenciaTextoFuerte },

    // --- Bloque de navegación externa ---
    navWrap: { backgroundColor: c.fondoAlterno, borderRadius: radio.lg, padding: 10, marginBottom: 10 },
    navLbl: { fontSize: tam.sm, fontFamily: fuente(peso.normal), color: c.textoSecundario, marginBottom: espacio.sm },
    navBtns: { flexDirection: 'row', gap: espacio.sm },
    btnGoogleMaps: { flex: 1, backgroundColor: c.superficie, borderWidth: 1, borderColor: c.borde, borderRadius: radio.md, padding: 10, alignItems: 'center' },
    btnGoogleMapsTxt: { fontSize: tam.md, fontFamily: fuente(peso.medio), color: c.texto },
    // '#33CCFF': celeste de marca de Waze (no hay token); texto blanco encima.
    btnWaze: { flex: 1, backgroundColor: '#33CCFF', borderRadius: radio.md, padding: 10, alignItems: 'center' },
    btnWazeTxt: { fontSize: tam.md, fontFamily: fuente(peso.medio), color: '#fff' },

    // --- Botones de acción ---
    actions: { gap: espacio.sm },
    btnPrimario: { backgroundColor: colorEstado.acentoVerde, borderRadius: radio.lg, padding: 14, alignItems: 'center' },
    btnPrimarioTxt: { color: '#fff', fontSize: tam.xl, fontFamily: fuente(peso.negrita) },
    btnSecundario: { backgroundColor: c.superficie, borderWidth: 1, borderColor: c.borde, borderRadius: radio.lg, padding: espacio.md, alignItems: 'center' },
    btnSecundarioTxt: { fontSize: tam.lg, fontFamily: fuente(peso.normal), color: c.textoSecundario },

    // --- Bottom sheets ---
    // rgba(0,0,0,0.5): scrim del modal (no hay token).
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modal: {
      backgroundColor: c.superficieModal,
      borderTopLeftRadius: radio.pastilla,
      borderTopRightRadius: radio.pastilla,
      paddingTop: espacio.xl,
      paddingBottom: insets.bottom + espacio.xl,
      paddingLeft: Math.max(insets.left, espacio.xl),
      paddingRight: Math.max(insets.right, espacio.xl),
    },
    modalContenido: { gap: 10 },
    modalIco: { fontSize: TAMANO_ICONO_MODAL, textAlign: 'center' },
    modalTit: { fontSize: tam.titulo, fontFamily: fuente(peso.fuerte), color: c.texto, textAlign: 'center' },
    modalSub: { fontSize: tam.md, fontFamily: fuente(peso.normal), color: c.textoSecundario, textAlign: 'center', lineHeight: 20 },
    modalDesc: { fontSize: tam.md, fontFamily: fuente(peso.normal), color: c.textoSecundario, textAlign: 'center', lineHeight: 20 },
    negrita: { fontFamily: fuente(peso.fuerte), color: c.texto },
    textarea: { borderWidth: 1, borderColor: c.borde, backgroundColor: c.fondoAlterno, color: c.texto, fontFamily: fuente(peso.normal), borderRadius: radio.lg, padding: espacio.md, fontSize: tam.lg, minHeight: 80, textAlignVertical: 'top' },
    btnVerde: { backgroundColor: colorEstado.acentoVerde, borderRadius: radio.lg, padding: 14, alignItems: 'center' },
    btnRojo: { backgroundColor: marca, borderRadius: radio.lg, padding: 14, alignItems: 'center' },
    btnGris: { backgroundColor: c.superficie, borderWidth: 1, borderColor: c.borde, borderRadius: radio.lg, padding: espacio.md, alignItems: 'center' },
    btnBlanco: { color: '#fff', fontSize: tam.xl, fontFamily: fuente(peso.negrita) },
    btnGrisTxt: { fontSize: tam.lg, fontFamily: fuente(peso.normal), color: c.textoSecundario },
  });
}
