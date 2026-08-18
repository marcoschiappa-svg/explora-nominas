/**
 * =============================================================================
 * ChoferScreen.js — Pantalla principal de la app TrackEx (rol: chofer)
 * =============================================================================
 *
 * PROPÓSITO
 * Es la única pantalla operativa de la app. Un chofer autenticado ve acá los
 * despachos que le fueron nominados desde el portal y avanza su ciclo de vida:
 * recibido → iniciado → (demorado) → finalizado. En paralelo, registra el
 * recorrido GPS del camión para que el portal pueda dibujarlo en Seguimiento.
 *
 * -----------------------------------------------------------------------------
 * MODELO DE DATOS
 * -----------------------------------------------------------------------------
 * Todo vive en la colección `pedidos_portal`. Cada documento es un PEDIDO y
 * contiene un array `despachos`, donde cada elemento es un viaje individual.
 * El chofer no tiene una colección propia: se lo localiza recorriendo todos los
 * pedidos y filtrando los despachos cuyo `dni_chofer` coincide con el suyo.
 *
 * Campos que ESTA pantalla escribe dentro de `despachos[i]`:
 *   estado_chofer          'recibido' | 'iniciado' | 'demorado' | 'finalizado'
 *   estado_chofer_ts       ISO 8601 — momento del último cambio de estado
 *   chofer_inicio_ts       ISO 8601 — momento de tocar "Iniciar viaje"
 *   chofer_fin_ts          ISO 8601 — momento de confirmar la entrega
 *   demora_motivo          texto libre cargado por el chofer
 *   gps_lat / gps_lng      última posición conocida (la usa Seguimiento "en vivo")
 *   gps_ts                 ISO 8601 de esa última posición
 *   gps_estado             'activo' | 'solo_primer_plano' | 'sin_permiso' | 'error'
 *   gps_inicio_lat/lng/ts  posición capturada al iniciar el viaje
 *   gps_fin_lat/lng/ts     posición capturada al finalizar el viaje
 *   gps_inicio_precision   radio de error en metros de esa lectura
 *   gps_fin_precision      idem
 *   gps_inicio_origen      'actual' | 'ultima_conocida'
 *   gps_fin_origen         idem
 *   gps_inicio_estado      'no_disponible' si no se pudo leer posición
 *   gps_fin_estado         idem
 *
 * Y a nivel del DOCUMENTO del pedido (no del despacho):
 *   gps_track_{i}          array de puntos {lat, lng, ts} del despacho i.
 *                          Es lo que Seguimiento usa para dibujar la polilínea.
 *
 * ADVERTENCIA sobre `gps_track_{i}`: Firestore corta en 1 MB por documento. Un
 * pedido con 12 despachos y trazas finas se puede acercar al límite. Lo natural
 * sería mover las trazas a una subcolección; no se hizo todavía porque cambia
 * cómo lee el portal. Pendiente para el rediseño del ciclo de vida del pedido.
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
 * correctamente en `estado_chofer`, pero NO produjeron un solo punto GPS. Se
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
  Platform, PermissionsAndroid, AppState
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { collection, onSnapshot, doc, getDoc, updateDoc, arrayUnion, addDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { db } from '../config/firebase';
import { APPS_SCRIPT_URL, HEADER_COLORS, ESTADO_LABEL } from '../config/constants';

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

/** Viaje en curso: `{ docId, despachoIdx, pedidoId }` o ausente si no hay ninguno. */
const KEY_VIAJE_ACTIVO = 'explora:viaje_activo';

/** Cola de puntos GPS pendientes de escritura: `[{ lat, lng, ts }, ...]`. */
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
 * Log remoto liviano a la colección `app_logs` de Firestore.
 *
 * MOTIVO: los `catch` genéricos del código anterior descartaban `err.code`, y en
 * un build de release no hay consola. Diagnosticar una falla exigía tener el
 * teléfono del chofer en la mano. Con 12 testers y creciendo, eso no escala.
 *
 * Se traga sus propios errores A PROPÓSITO: el logging jamás debe poder romper
 * el flujo que está intentando observar.
 *
 * REQUIERE una regla de Firestore que permita `create` en `app_logs`.
 *
 * @param {string} evento Identificador del evento, en snake_case.
 * @param {Object} [extra] Campos adicionales a adjuntar (códigos, ids, etc.).
 * @returns {Promise<void>}
 */
async function logApp(evento, extra = {}) {
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

/**
 * Descarga a Firestore todos los puntos GPS acumulados en el buffer local.
 *
 * Hace una sola escritura por lote:
 *   - actualiza `gps_lat/lng/ts` del despacho con el último punto (posición
 *     "en vivo" que consume Seguimiento);
 *   - agrega TODOS los puntos del lote a `gps_track_{idx}` con `arrayUnion`.
 *
 * Si la escritura falla, el buffer NO se limpia: queda intacto para el próximo
 * intento. Ese es justamente el mecanismo que hace que un tramo sin señal no
 * pierda puntos.
 *
 * El buffer sí se limpia cuando el destino ya no existe (pedido o despacho
 * borrado), porque en ese caso reintentar es inútil.
 *
 * NOTA: reescribe el array `despachos` completo. Es la limitación del modelo de
 * datos actual — Firestore no permite actualizar un elemento de array por
 * índice. Al escribir por lotes en vez de por punto, la ventana de colisión con
 * otro escritor se reduce mucho, pero no desaparece.
 *
 * @param {{docId: string, despachoIdx: number}} viaje Viaje activo destino.
 * @returns {Promise<void>}
 */
async function descargarBuffer(viaje) {
  if (!viaje || !viaje.docId) return;

  const buffer = await leerJSON(KEY_BUFFER_GPS, []);
  if (!buffer.length) return;

  try {
    const ref = doc(db, 'pedidos_portal', viaje.docId);
    const snap = await getDoc(ref);

    // El pedido ya no existe: descartar el buffer, reintentar no tiene sentido.
    if (!snap.exists()) {
      await escribirJSON(KEY_BUFFER_GPS, []);
      return;
    }

    const pedido = snap.data();
    const despachos = [...(pedido.despachos || [])];
    const actual = despachos[viaje.despachoIdx];

    // El despacho ya no existe (pedido reestructurado): idem.
    if (!actual) {
      await escribirJSON(KEY_BUFFER_GPS, []);
      return;
    }

    const ultimo = buffer[buffer.length - 1];
    despachos[viaje.despachoIdx] = {
      ...actual,
      gps_lat: ultimo.lat,
      gps_lng: ultimo.lng,
      gps_ts: ultimo.ts,
      gps_estado: 'activo',
    };

    const trackField = `gps_track_${viaje.despachoIdx}`;
    await updateDoc(ref, {
      despachos,
      [trackField]: arrayUnion(...buffer),
    });

    // Solo se limpia si la escritura fue confirmada por el servidor.
    await escribirJSON(KEY_BUFFER_GPS, []);
  } catch (err) {
    console.warn('GPS flush error:', err?.code, err?.message);
    await logApp('gps_flush_error', {
      code: err?.code || '',
      mensaje: err?.message || '',
      puntos_pendientes: buffer.length,
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
  if (!viaje) return;

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
    await descargarBuffer(viaje);
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

/* =============================================================================
 * COMPONENTE
 * ========================================================================== */

/**
 * Pantalla principal del chofer.
 *
 * @param {Object} props
 * @param {Object} props.usuario Perfil autenticado. Se usan `dni` (para filtrar
 *   los despachos que le corresponden) y `nombre` (para el saludo y los avisos).
 * @param {Function} props.onLogout Callback de cierre de sesión, provisto por App.js.
 */
export default function ChoferScreen({ usuario, onLogout }) {
  /** Despachos del chofer en estado activo (recibido / iniciado / demorado). */
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

  const dniUsuario = usuario?.dni || '';

  /* ---------------------------------------------------------------------------
   * EFECTO 1 — Suscripción a los despachos del chofer
   *
   * Escucha `pedidos_portal` entero y arma en memoria la lista de despachos que
   * corresponden a este DNI. Es una lectura de colección completa: aceptable con
   * el volumen actual, pero es el primer lugar a revisar si el sistema escala.
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    if (!dniUsuario) { setCargando(false); return; }

    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      const encontrados = [];

      snap.docs.forEach(d => {
        const pedido = d.data();
        (pedido.despachos || []).forEach((despacho, i) => {
          // Solo los despachos de este chofer...
          if (despacho.dni_chofer !== dniUsuario) return;

          // ...y solo los que están en un estado operable. Los 'finalizado'
          // quedan afuera a propósito: la app muestra trabajo pendiente, no
          // historial.
          const estadoChofer = despacho.estado_chofer || '';
          if (!['recibido', 'iniciado', 'demorado'].includes(estadoChofer)) return;

          encontrados.push({
            docId: d.id,                 // id del documento de pedido en Firestore
            pedidoId: pedido.id,         // id legible del pedido (PED-AAMMDD-NNN)
            despachoIdx: i,              // posición dentro del array `despachos`
            uid: pedido.id + '-D' + (i + 1), // clave estable para React
            estado_chofer: estadoChofer,
            estado_chofer_ts: despacho.estado_chofer_ts || '',
            demora_motivo: despacho.demora_motivo || '',
            producto: pedido.producto,
            volumen: despacho.volumen,
            cliente: pedido.cliente,
            ov: pedido.ov,
            lugar: pedido.lugar,
            fecha_carga: despacho.fecha_carga,
            horario_carga: despacho.horario_carga || '',
            fecha_entrega: pedido.fecha_entrega,
            banda_horaria: pedido.banda_horaria || '',
            obs: pedido.obs || '',
            transporte: despacho.transporte,
            patente_tractor: despacho.patente_tractor || '',
            patente_semi: despacho.patente_semi || '',
          });
        });
      });

      encontrados.sort((a, b) => new Date(a.fecha_carga) - new Date(b.fecha_carga));
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
      viajes.find(v => v.estado_chofer === 'iniciado' || v.estado_chofer === 'demorado') || null;
  }, [viajes]);

  /**
   * Clave estable del viaje activo, con formato `docId:despachoIdx`.
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
    const activo = viajes.find(v => v.estado_chofer === 'iniciado' || v.estado_chofer === 'demorado');
    return activo ? `${activo.docId}:${activo.despachoIdx}` : '';
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
      if (claveViajeActivo) {
        const activo = viajeActivoRef.current;
        if (!activo) return;

        await escribirJSON(KEY_VIAJE_ACTIVO, {
          docId: activo.docId,
          despachoIdx: activo.despachoIdx,
          pedidoId: activo.pedidoId,
        });

        if (!cancelado) await activarSeguimiento();
      } else {
        // Orden importante: descargar primero, limpiar después.
        const previo = await leerJSON(KEY_VIAJE_ACTIVO, null);
        if (previo) await descargarBuffer(previo);

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
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    return () => { detenerWatchForeground(); };
  }, []);

  /* ===========================================================================
   * PERMISOS Y ARRANQUE DEL SEGUIMIENTO
   * ======================================================================== */

  /**
   * Solicita POST_NOTIFICATIONS en Android 13+ (API 33).
   *
   * CORRIGE LA CAUSA 2. Android exige que un foreground service muestre una
   * notificación persistente; sin este permiso la notificación no se muestra, el
   * chofer no tiene señal visible de que lo están rastreando, y varios
   * fabricantes (Xiaomi, Samsung, Motorola) matan servicios sin notificación
   * visible por gestión agresiva de batería.
   *
   * Usa `PermissionsAndroid` de React Native para no sumar dependencias.
   *
   * @returns {Promise<boolean>} True si está concedido o si la plataforma no lo exige.
   */
  async function pedirPermisoNotificaciones() {
    if (Platform.OS !== 'android' || Platform.Version < 33) return true;
    try {
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      );
      return res === PermissionsAndroid.RESULTS.GRANTED;
    } catch (e) {
      return false;
    }
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
      await marcarGpsEstado('sin_permiso');
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
            notificationColor: '#0F6E56',
            killServiceOnDestroy: false,
          },
        });
      }
      setGpsEstado('activo');
      await marcarGpsEstado('activo');
      await logApp('gps_background_iniciado');
    } catch (err) {
      setGpsEstado('error');
      await marcarGpsEstado('error');
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
   * Da de baja la tarea de background si estaba corriendo.
   *
   * Consulta primero con `hasStartedLocationUpdatesAsync` porque detener una
   * tarea no registrada lanza excepción.
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

  /**
   * Deja constancia en el despacho del estado del seguimiento.
   *
   * Permite que en el portal se distinga "no arrancó el GPS" de "el chofer no se
   * movió". Sin este campo, un viaje sin traza es ambiguo y el coordinador no
   * puede saber si hay un problema técnico o simplemente no hubo movimiento.
   *
   * Escribe solo si el valor cambió, para no generar escrituras inútiles que
   * además disparan snapshots en todos los dispositivos suscriptos.
   *
   * @param {string} estado 'activo' | 'solo_primer_plano' | 'sin_permiso' | 'error'
   * @returns {Promise<void>}
   */
  async function marcarGpsEstado(estado) {
    const activo = viajeActivoRef.current;
    if (!activo) return;
    try {
      const ref = doc(db, 'pedidos_portal', activo.docId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;

      const pedido = snap.data();
      const despachos = [...(pedido.despachos || [])];
      const actual = despachos[activo.despachoIdx];
      if (!actual) return;
      if (actual.gps_estado === estado) return;

      despachos[activo.despachoIdx] = { ...actual, gps_estado: estado };
      await updateDoc(ref, { despachos });
    } catch (err) {
      console.warn('marcarGpsEstado error:', err?.code, err?.message);
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
   * CAMBIOS DE ESTADO
   * ======================================================================== */

  /**
   * Avanza el estado de un despacho y escribe el resultado en Firestore.
   *
   * Es el corazón del flujo app → portal. Secuencia:
   *   1. Capturar ubicación, si la acción lo pide (inicio / fin).
   *   2. Al finalizar, descargar el buffer ANTES de escribir el estado, para que
   *      el último tramo del recorrido quede guardado mientras el viaje todavía
   *      figura como activo.
   *   3. Releer el pedido, reemplazar el despacho por índice y escribir.
   *   4. Notificar al coordinador vía Apps Script, en su propio try.
   *
   * Sobre el paso 3: se relee el documento en vez de usar el estado local a
   * propósito, para partir del dato más fresco posible. Aun así sigue siendo un
   * read-modify-write sobre el array completo — limitación del modelo de datos,
   * no de este código.
   *
   * Sobre el paso 4: el aviso va DESPUÉS y aislado. Si el Apps Script falla, el
   * estado ya quedó escrito y no debe revertirse ni reportarse como error al
   * chofer. Antes compartía el catch con la escritura, así que un fallo de red
   * del aviso mostraba "no se pudo actualizar el estado" aunque sí se hubiera
   * actualizado.
   *
   * @param {Object} viaje Viaje a modificar (de la lista `viajes`).
   * @param {string} nuevoEstado 'iniciado' | 'demorado' | 'finalizado'
   * @param {Object} [extras] Campos adicionales a fusionar en el despacho.
   * @param {Object} [opciones]
   * @param {boolean} [opciones.capturarUbicacion] Si true, adjunta la posición actual.
   * @returns {Promise<void>}
   */
  async function cambiarEstado(viaje, nuevoEstado, extras = {}, opciones = {}) {
    setProcesando(true);
    try {
      const extrasFinales = { ...extras };

      // --- Paso 1: ubicación puntual --------------------------------------
      if (opciones.capturarUbicacion) {
        const prefijo = nuevoEstado === 'finalizado' ? 'gps_fin' : 'gps_inicio';
        const punto = await obtenerPuntoActual();
        if (punto) {
          extrasFinales[`${prefijo}_lat`] = punto.lat;
          extrasFinales[`${prefijo}_lng`] = punto.lng;
          extrasFinales[`${prefijo}_ts`] = punto.ts;
          extrasFinales[`${prefijo}_precision`] = punto.precision;
          extrasFinales[`${prefijo}_origen`] = punto.origen;
        } else {
          // Sin ubicación el viaje avanza igual: queda registrado el faltante.
          extrasFinales[`${prefijo}_estado`] = 'no_disponible';
          await logApp('punto_no_disponible', {
            pedido_id: viaje?.pedidoId || '',
            estado: nuevoEstado,
          });
        }
      }

      // --- Paso 2: descargar traza pendiente antes de cerrar ---------------
      if (nuevoEstado === 'finalizado') {
        const guardado = await leerJSON(KEY_VIAJE_ACTIVO, null);
        if (guardado) await descargarBuffer(guardado);
      }

      // --- Paso 3: escribir el estado --------------------------------------
      const ref = doc(db, 'pedidos_portal', viaje.docId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('El pedido ya no existe.');

      const pedido = snap.data();
      const nuevosDespachos = [...(pedido.despachos || [])];
      nuevosDespachos[viaje.despachoIdx] = {
        ...nuevosDespachos[viaje.despachoIdx],
        estado_chofer: nuevoEstado,
        estado_chofer_ts: new Date().toISOString(),
        ...extrasFinales,
      };
      await updateDoc(ref, { despachos: nuevosDespachos });

      await logApp('estado_actualizado', {
        pedido_id: viaje.pedidoId || '',
        estado: nuevoEstado,
        dni: dniUsuario,
      });

      // --- Paso 4: aviso al coordinador ------------------------------------
      if (nuevoEstado === 'demorado' || nuevoEstado === 'finalizado') {
        const payload = {
          accion: nuevoEstado === 'demorado' ? 'chofer_demora' : 'chofer_finalizo',
          pedido_id: viaje.pedidoId,
          chofer: usuario?.nombre || dniUsuario,
          producto: viaje.producto,
          cliente: viaje.cliente,
          ov: viaje.ov,
          lugar: viaje.lugar,
          motivo: extras.demora_motivo || '',
        };
        try {
          await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString());
        } catch (errAviso) {
          await logApp('aviso_apps_script_error', {
            code: errAviso?.code || '',
            mensaje: errAviso?.message || '',
            pedido_id: viaje.pedidoId || '',
          });
        }
      }
    } catch (err) {
      // El código de error se muestra Y se registra. Antes se descartaba, y esa
      // decisión ocultó el problema durante días.
      const code = err?.code || err?.name || 'desconocido';
      await logApp('estado_error', {
        code,
        mensaje: err?.message || '',
        pedido_id: viaje?.pedidoId || '',
        estado: nuevoEstado,
        dni: dniUsuario,
      });
      Alert.alert('Error', `No se pudo actualizar el estado (${code}). Intentá de nuevo.`);
    } finally {
      setProcesando(false);
    }
  }

  /**
   * Confirma el reporte de demora desde el modal.
   * No captura ubicación: la demora es un evento de estado, no de posición.
   *
   * @returns {Promise<void>}
   */
  async function confirmarDemora() {
    if (!motivoDemora.trim()) { Alert.alert('Error', 'Describí el problema antes de continuar.'); return; }
    await cambiarEstado(modalDemora, 'demorado', { demora_motivo: motivoDemora.trim() });
    setModalDemora(null);
    setMotivoDemora('');
  }

  /**
   * Confirma la entrega desde el modal. Captura la posición de fin de viaje.
   *
   * @returns {Promise<void>}
   */
  async function confirmarFinalizar() {
    await cambiarEstado(
      modalFinalizar,
      'finalizado',
      { chofer_fin_ts: new Date().toISOString() },
      { capturarUbicacion: true }
    );
    setModalFinalizar(null);
  }

  /**
   * Inicia un viaje. Captura la posición de partida.
   * Se extrajo a función propia para no ensuciar el JSX del botón.
   *
   * @param {Object} v Viaje a iniciar.
   */
  function iniciarViaje(v) {
    cambiarEstado(
      v,
      'iniciado',
      { chofer_inicio_ts: new Date().toISOString() },
      { capturarUbicacion: true }
    );
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
   * VALORES DERIVADOS PARA EL RENDER
   * ======================================================================== */

  /** Viaje que encabeza la pantalla. La lista viene ordenada por fecha de carga. */
  const viajeActivo = viajes[0] || null;
  const estadoActual = viajeActivo?.estado_chofer || 'libre';
  const hc = HEADER_COLORS[estadoActual] || HEADER_COLORS.libre;
  const nombreCorto = usuario?.nombre?.split(' ')[0] || 'Chofer';

  /** Hay un viaje en curso (iniciado o demorado), no solo nominado. */
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
   * ======================================================================== */

  return (
    <View style={s.wrap}>

      {/* Modal explicativo del permiso de background.
          Se muestra ANTES de derivar a Ajustes, como recomienda la doc de Expo
          para Android 11+, donde el pedido no muestra diálogo propio. */}
      <Modal visible={modalPermiso} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={s.modal}>
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
          </View>
        </View>
      </Modal>

      {/* Modal de reporte de demora */}
      <Modal visible={!!modalDemora} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={s.modal}>
            <Text style={s.modalIco}>⚠️</Text>
            <Text style={s.modalTit}>Reportar demora</Text>
            {modalDemora && <Text style={s.modalSub}>{modalDemora.producto} · {modalDemora.cliente}</Text>}
            <TextInput style={s.textarea} placeholder="Describí el problema (tráfico, desperfecto, clima, etc.)"
              value={motivoDemora} onChangeText={setMotivoDemora} multiline numberOfLines={3} />
            <TouchableOpacity style={s.btnRojo} onPress={confirmarDemora} disabled={procesando}>
              <Text style={s.btnBlanco}>{procesando ? 'Enviando...' : 'Reportar demora'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnGris} onPress={() => { setModalDemora(null); setMotivoDemora(''); }}>
              <Text style={s.btnGrisTxt}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal de confirmación de entrega */}
      <Modal visible={!!modalFinalizar} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={s.modal}>
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
          </View>
        </View>
      </Modal>

      {/* Encabezado: cambia de color según el estado del viaje que encabeza.
          NOTA: `paddingTop: 60` está hardcodeado. Es parte del defecto de
          edge-to-edge para Android 15/16, pendiente en commit aparte junto con
          App.js y LoginScreen.js. */}
      <LinearGradient colors={[hc.from, hc.to]} style={s.header}>
        <View style={s.headerTop}>
          <Text style={s.headerAppName}>Portal Explora</Text>
          <TouchableOpacity onPress={onLogout}>
            <Text style={s.btnSalir}>Salir</Text>
          </TouchableOpacity>
        </View>
        {cargando ? (
          <Text style={s.headerSub}>Cargando...</Text>
        ) : viajeActivo ? (
          <View style={s.headerContent}>
            <Text style={s.headerSub}>{ESTADO_LABEL[estadoActual] || estadoActual}</Text>
            <Text style={s.headerTitulo}>{viajeActivo.producto} · {viajeActivo.cliente}</Text>
            <View style={s.badgeRow}>
              <View style={s.badge}><Text style={s.badgeTxt}>{viajeActivo.volumen} tn</Text></View>
              <View style={s.badge}><Text style={s.badgeTxt}>OV {viajeActivo.ov}</Text></View>
              {viajeActivo.estado_chofer_ts && (
                <View style={s.badge}><Text style={s.badgeTxt}>{tiempoDesde(viajeActivo.estado_chofer_ts)}</Text></View>
              )}
            </View>
          </View>
        ) : (
          <View style={s.headerContent}>
            <Text style={s.headerSub}>Sin viajes activos</Text>
            <Text style={s.headerTitulo}>Hola, {nombreCorto}</Text>
            <View style={s.badgeRow}>
              <View style={s.badge}><Text style={s.badgeTxt}>🟢 Libre</Text></View>
            </View>
          </View>
        )}
      </LinearGradient>

      <ScrollView style={s.body} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* El perfil no tiene DNI: sin él no se puede resolver ningún despacho. */}
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

        {/* Estado vacío: sin despachos activos. */}
        {!cargando && dniUsuario && viajes.length === 0 && (
          <View style={s.libreWrap}>
            <Text style={s.libreIco}>🟢</Text>
            <Text style={s.libreTit}>Libre</Text>
            <Text style={s.libreSub}>Cuando el transportista te nomine, el viaje aparecerá acá automáticamente.</Text>
          </View>
        )}

        {/* Una tarjeta por despacho activo. */}
        {viajes.map(v => (
          <View key={v.uid} style={s.card}>
            <View style={s.cardGrid}>
              <View style={s.field}><Text style={s.lbl}>Destino</Text><Text style={s.val}>{v.lugar}</Text></View>
              <View style={s.field}><Text style={s.lbl}>Fecha carga</Text><Text style={s.val}>{formatFecha(v.fecha_carga)}{v.horario_carga ? ' · ' + v.horario_carga : ''}</Text></View>
              {v.fecha_entrega && <View style={s.field}><Text style={s.lbl}>Entrega</Text><Text style={s.val}>{formatFecha(v.fecha_entrega)}{v.banda_horaria ? ' · ' + v.banda_horaria : ''}</Text></View>}
              <View style={s.field}><Text style={s.lbl}>Unidad</Text><Text style={s.val}>{v.patente_tractor}{v.patente_semi ? ' / ' + v.patente_semi : ''}</Text></View>
              <View style={s.field}><Text style={s.lbl}>Transporte</Text><Text style={s.val}>{v.transporte}</Text></View>
            </View>

            {/* Observaciones del pedido y motivo de demora, si los hay. */}
            {v.obs ? <View style={s.obsBanner}><Text style={s.obsTxt}>📋 {v.obs}</Text></View> : null}
            {v.estado_chofer === 'demorado' && v.demora_motivo ? <View style={s.demoraBanner}><Text style={s.demoraTxt}>⚠️ {v.demora_motivo}</Text></View> : null}

            {/* Navegación: solo con el viaje ya en curso. Antes de arrancar no
                tiene sentido ofrecer ruta. */}
            {(v.estado_chofer === 'iniciado' || v.estado_chofer === 'demorado') && v.lugar && (
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
                recibido  → Iniciar
                iniciado  → Finalizar | Reportar demora
                demorado  → Finalizar | Continuar viaje */}
            <View style={s.actions}>
              {v.estado_chofer === 'recibido' && (
                <TouchableOpacity style={[s.btnPrimario, { opacity: procesando ? 0.7 : 1 }]}
                  disabled={procesando}
                  onPress={() => iniciarViaje(v)}>
                  {procesando ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimarioTxt}>🚛 Iniciar viaje</Text>}
                </TouchableOpacity>
              )}
              {v.estado_chofer === 'iniciado' && (
                <>
                  <TouchableOpacity style={[s.btnPrimario, { opacity: procesando ? 0.7 : 1 }]}
                    disabled={procesando} onPress={() => setModalFinalizar(v)}>
                    <Text style={s.btnPrimarioTxt}>✓ Finalizar viaje</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.btnSecundario, { opacity: procesando ? 0.7 : 1 }]}
                    disabled={procesando} onPress={() => setModalDemora(v)}>
                    <Text style={s.btnSecundarioTxt}>⚠️ Reportar demora</Text>
                  </TouchableOpacity>
                </>
              )}
              {v.estado_chofer === 'demorado' && (
                <>
                  <TouchableOpacity style={[s.btnPrimario, { opacity: procesando ? 0.7 : 1 }]}
                    disabled={procesando} onPress={() => setModalFinalizar(v)}>
                    <Text style={s.btnPrimarioTxt}>✓ Finalizar viaje</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.btnSecundario, { opacity: procesando ? 0.7 : 1 }]}
                    disabled={procesando} onPress={() => cambiarEstado(v, 'iniciado')}>
                    <Text style={s.btnSecundarioTxt}>▶ Continuar viaje</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/* =============================================================================
 * ESTILOS
 *
 * Paleta institucional: #0F6E56 (verde Explora), #C8102E (rojo Explora).
 * Los tonos naranjas del bloque `gpsAviso*` son de advertencia, elegidos para
 * distinguirse de `alerta` (perfil incompleto) y `demoraBanner` (demora
 * reportada), que también son avisos pero de otra naturaleza.
 *
 * PENDIENTE: `header.paddingTop: 60` es un valor fijo. Debe reemplazarse por
 * `useSafeAreaInsets()` como parte del arreglo de edge-to-edge para Android
 * 15/16. `react-native-safe-area-context` ya está instalado pero sin usar.
 * ========================================================================== */
const s = StyleSheet.create({
  // --- Contenedores generales ---
  wrap: { flex: 1, backgroundColor: '#F8F8F8' },
  body: { flex: 1, padding: 14 },

  // --- Encabezado con degradé ---
  header: { paddingTop: 60, paddingBottom: 32, paddingHorizontal: 16 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  headerAppName: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  btnSalir: { fontSize: 13, color: 'rgba(255,255,255,0.6)', padding: 4 },
  headerContent: { gap: 6 },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 1 },
  headerTitulo: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  badge: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt: { fontSize: 12, color: '#fff', fontWeight: '500' },

  // --- Aviso de perfil incompleto ---
  alerta: { backgroundColor: '#FAEEDA', borderRadius: 10, padding: 12, marginBottom: 14 },
  alertaTxt: { fontSize: 13, color: '#633806' },

  // --- Aviso de seguimiento GPS incompleto ---
  gpsAviso: { backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA', borderRadius: 10, padding: 12, marginBottom: 14, gap: 6 },
  gpsAvisoTit: { fontSize: 13, fontWeight: '700', color: '#9A3412' },
  gpsAvisoTxt: { fontSize: 12, color: '#9A3412', lineHeight: 18 },
  gpsAvisoNota: { fontSize: 11, color: '#B45309', fontStyle: 'italic' },
  gpsAvisoBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#FED7AA', borderRadius: 8, paddingVertical: 9, alignItems: 'center', marginTop: 2 },
  gpsAvisoBtnTxt: { fontSize: 13, fontWeight: '600', color: '#9A3412' },

  // --- Estado vacío ---
  libreWrap: { alignItems: 'center', paddingVertical: 60 },
  libreIco: { fontSize: 48, marginBottom: 12 },
  libreTit: { fontSize: 24, fontWeight: '700', color: '#111827', marginBottom: 8 },
  libreSub: { fontSize: 14, color: '#9CA3AF', textAlign: 'center', lineHeight: 22, paddingHorizontal: 20 },

  // --- Tarjeta de despacho ---
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  field: { width: '47%' }, // dos columnas con el gap de 10
  lbl: { fontSize: 11, color: '#9CA3AF', marginBottom: 2 },
  val: { fontSize: 13, color: '#111827', fontWeight: '500' },
  obsBanner: { backgroundColor: '#F9FAFB', borderRadius: 8, padding: 10, marginBottom: 10 },
  obsTxt: { fontSize: 12, color: '#6B7280' },
  demoraBanner: { backgroundColor: '#FAEEDA', borderRadius: 8, padding: 10, marginBottom: 10 },
  demoraTxt: { fontSize: 12, color: '#633806' },

  // --- Bloque de navegación externa ---
  navWrap: { backgroundColor: '#F9FAFB', borderRadius: 10, padding: 10, marginBottom: 10 },
  navLbl: { fontSize: 12, color: '#6B7280', marginBottom: 8 },
  navBtns: { flexDirection: 'row', gap: 8 },
  btnGoogleMaps: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, padding: 10, alignItems: 'center' },
  btnGoogleMapsTxt: { fontSize: 13, fontWeight: '500', color: '#111827' },
  btnWaze: { flex: 1, backgroundColor: '#33CCFF', borderRadius: 8, padding: 10, alignItems: 'center' }, // celeste de marca Waze
  btnWazeTxt: { fontSize: 13, fontWeight: '500', color: '#fff' },

  // --- Botones de acción ---
  actions: { gap: 8 },
  btnPrimario: { backgroundColor: '#0F6E56', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnPrimarioTxt: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnSecundario: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, alignItems: 'center' },
  btnSecundarioTxt: { fontSize: 14, color: '#374151' },

  // --- Modales ---
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 10 },
  modalIco: { fontSize: 36, textAlign: 'center' },
  modalTit: { fontSize: 18, fontWeight: '700', color: '#111827', textAlign: 'center' },
  modalSub: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  modalDesc: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 20 },
  negrita: { fontWeight: '700', color: '#111827' },
  textarea: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: 'top' },
  btnVerde: { backgroundColor: '#0F6E56', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnRojo: { backgroundColor: '#C8102E', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnGris: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, alignItems: 'center' },
  btnBlanco: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnGrisTxt: { fontSize: 14, color: '#6B7280' },
});
