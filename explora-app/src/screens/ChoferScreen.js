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
 *   registrarEstadoSeguimiento   campos `seguimiento_*` del viaje (TrackEx
 *                     v1.1.2): permisos, servicio y versión del teléfono; los
 *                     escribe `informarSeguimiento` solo cuando cambian.
 * Los puntos GPS ya NO los escribe la pantalla: los sube el gestor de
 * `src/gps/seguimiento.js` por la API REST (`src/gps/subida.js`), a
 * viajes/{id}/gps_puntos (la clave de cada punto es el `ts` de la lectura:
 * reenviar un lote reescribe idéntico). Las reglas de `gps_puntos` exigen el
 * viaje en EN_VIAJE, por eso al finalizar se suben los pendientes ANTES de
 * cerrar el viaje.
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
 * PERMISO DE NOTIFICACIONES VISIBLE (v1.1.1, Frente B): si el chofer no concedió
 * el permiso (o lo apagó después), no recibe los push y antes no se enteraba. La
 * pantalla lo consulta (`consultarPermisoNotificaciones`, que nunca lo pide) y
 * muestra un aviso con botón: "Activar notificaciones" si el sistema todavía
 * deja preguntar, o "Abrir ajustes de la app" si no. Se reevalúa cada vez que la
 * app vuelve a primer plano (EFECTO 6) y el estado queda en `app_logs`
 * (`push_permiso_estado`) para ver qué choferes las tienen apagadas.
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
 *      exige la cadena completa de permisos y un foreground service. La tarea
 *      se define en `src/gps/tarea.js` (importado primero en `index.js`).
 *
 * UNA SOLA FUENTE CONTINUA GRABA (TrackEx v1.1.2): con el servicio de segundo
 * plano activo no se inicia el watch de primer plano (o se baja si estaba
 * corriendo); sin servicio, graba el watch. Las dos fuentes entran por
 * `procesarUbicaciones` (src/gps/seguimiento.js) y el gestor ignora la copia de
 * primer plano si el servicio corre (`fuenteDebeGrabar`, segunda barrera).
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
 * HISTORIAL DE CORRECCIONES — TrackEx v1.1.2 — GPS (noviembre 2026)
 * -----------------------------------------------------------------------------
 * SÍNTOMA: en el primer uso real (v1.1.1, 24/11/2026) la traza de la pantalla
 *   apagada subió horas tarde y toda junta (558 puntos a las 03:20, cuando el
 *   chofer abrió la app), hubo lotes rechazados enteros (errores de descarga con
 *   `permission-denied` en ráfaga), puntos con la hora equivocada, un teléfono
 *   sin "Permitir siempre" del que nadie se enteró, un servicio que el sistema
 *   cortó a las 13:21 y no volvió, y no se pudo saber si los choferes habían
 *   tocado Finalizar.
 * CAUSAS RAÍZ:
 *   (5) SUBIDA TRABADA EN SEGUNDO PLANO. Con la app en segundo plano React
 *       Native 0.85 pausa los timers de JS (`JavaTimerManager.kt`) salvo
 *       mientras haya una headless task, y expo-task-manager 56.0.22
 *       (`TaskService.java`) la registra solo mientras procesa un evento de
 *       ubicación. El SDK web de Firestore depende de timers para conectar y
 *       reintentar: sus escrituras quedaban pendientes horas, y una escritura
 *       sin confirmar no falla (ni error ni log). `logApp` hacía `await` de
 *       una escritura así y también podía colgar la tarea.
 *       → Subida, consulta del viaje y token por XHR con timeout nativo
 *         (`src/gps/subida.js`); la tarea espera con `await` todo el trabajo
 *         (`src/gps/tarea.js`); `logApp` no bloquea (registro.js).
 *   (6) DOS FUENTES GRABANDO LA MISMA LECTURA + DESCARGAS SUPERPUESTAS. El
 *       watch de primer plano y la tarea grababan las mismas lecturas; dos
 *       descargas a la vez mandaban puntos repetidos y `set()` sobre un punto
 *       existente es un update que la regla prohibía: el lote entero rebotaba.
 *       Una descarga exitosa además vaciaba el buffer completo.
 *       → Una sola fuente graba (ver arriba) y el gestor de logica-gps.js
 *         serializa el buffer, deja una sola descarga en vuelo y quita solo
 *         lo confirmado. Regla de reescritura idéntica (prompt 1).
 *   (7) HORA DEL PUNTO EQUIVOCADA. El registro de lecturas recibía solo
 *       `loc.coords`, descartaba `loc.timestamp` y sellaba con `new Date()` al procesar; con lecturas en
 *       lote, el filtro de velocidad descartaba lecturas válidas.
 *       → `normalizarLectura(loc)` con el objeto entero.
 *   (8) LA TAREA SE DEFINÍA EN ESTA PANTALLA. La doc de expo-task-manager exige
 *       el ámbito global del bundle; acá dependía de que se importara la
 *       pantalla. → `src/gps/tarea.js`, primera línea de `index.js`.
 *   (9) SIN DATO DEL SEGUIMIENTO NI DE LAS ACCIONES. "Ahora no" en el modal de
 *       permiso no dejaba rastro, los logs de permisos no llevaban viaje ni DNI,
 *       y una acción sin red quedaba esperando sin aviso ni log.
 *       → `informarSeguimiento` (campos `seguimiento_*` del viaje),
 *         `permiso_background_pospuesto`, `viaje_id`/`dni` en los logs,
 *         `accion_intento` + límite de 25 s + `accion_sin_confirmar`.
 *   (10) SERVICIO CORTADO POR EL SISTEMA. Nada lo volvía a arrancar.
 *       → `asegurarServicio` al volver a primer plano (EFECTO 4).
 * ALCANCE: el JSX, los estilos, los textos y el flujo de pantallas no cambian
 *   (salvo el aviso nuevo de acción sin confirmar). La tarea conserva nombre y
 *   opciones de servicio.
 * LIMITACIONES CONOCIDAS: ver las cabeceras de `src/gps/*.js` y de
 *   portal/src/shared/logica-gps.js; los puntos que quedan sin subir al
 *   finalizar se pierden (`gps_pendientes_al_finalizar`).
 * CÓMO SE VERIFICA: con `informe-viajes.js` y `app_logs` (ver CHANGELOG
 *   v1.1.2): puntos de pantalla apagada que llegan con pocos minutos de
 *   atraso, sin `gps_subida_error` en ráfaga con red, `seguimiento_estado` en
 *   cada viaje y `accion_intento` antes de cada acción.
 *
 * -----------------------------------------------------------------------------
 * DEPENDENCIAS Y ENTORNO
 * -----------------------------------------------------------------------------
 * Expo SDK 56 · expo-location ~56.0.21 · expo-task-manager ~56.0.22
 * @react-native-async-storage/async-storage 2.2.0 · firebase ^12.15.0
 * expo-constants (versión instalada para `seguimiento_version_app`)
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
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { db, auth } from '../config/firebase';
import { APPS_SCRIPT_URL } from '../config/constants';
import { logApp } from '../registro';
import { useAvisos } from '../avisos';
import {
  asegurarPermisoNotificaciones, consultarPermisoNotificaciones, registrarPushToken,
} from '../notificaciones';
import { useTema } from '../tema/TemaContext';
import { fuente } from '../tema/fuentes';
import { DEGRADE_ENCABEZADO, ETIQUETA_ENCABEZADO, estadoEncabezado } from '../tema/encabezados';
import {
  TAMANO_TITULO_ENCABEZADO, TAMANO_TITULO_VACIO, TAMANO_ICONO_MODAL, TAMANO_ICONO_VACIO,
} from '../tema/dimensiones';
import ColumnaCentrada from '../componentes/ColumnaCentrada';
import PieVersion from '../componentes/PieVersion';
import ModalCambiarClave from '../componentes/ModalCambiarClave';
import {
  iniciarViaje, reportarDemora, finalizarViaje, VIAJE,
  registrarEstadoSeguimiento, cambiosEstadoSeguimiento, FUENTE,
  GPS_INTERVALO_MS, GPS_DISTANCIA_M,
  marca, colorEstado, espacio, radio, tipografia,
} from '../compartido';
import {
  KEY_VIAJE_ACTIVO, escribirJSON, ganchos, servicioActivo, iniciarServicio,
  detenerGPSBackground, limpiarEstadoLocalGPS, procesarUbicaciones,
  descargarPendientes, pendientesDeViaje, asegurarServicio,
} from '../gps/seguimiento';
import { sembrarToken } from '../gps/subida';

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

/* -----------------------------------------------------------------------------
 * PARÁMETROS DE LA CAPTURA PUNTUAL
 *
 * TrackEx v1.1.2 — GPS: las constantes, claves de AsyncStorage y funciones de
 * la captura CONTINUA (filtros, buffer, subida, tarea de segundo plano) se
 * mudaron a `src/gps/` y a `portal/src/shared/logica-gps.js`. Acá quedan solo
 * las de `obtenerPuntoActual`, que es de la pantalla.
 * -------------------------------------------------------------------------- */

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

/**
 * Límite de espera de una acción del chofer (iniciar, demora, finalizar):
 * 25 s. Una transacción de Firestore sin red no falla, queda esperando; el
 * 24/11 no se pudo saber si los choferes habían tocado Finalizar. 25 s cubren
 * una red móvil mala (la transacción hace una lectura y una escritura) sin
 * dejar al chofer mirando "Confirmando..." indefinidamente. Con la app en
 * primer plano los timers corren, así que `Promise.race` alcanza.
 */
const LIMITE_ACCION_MS = 25000;

/**
 * Límite de espera del aviso al coordinador (Apps Script): 15 s. El Apps
 * Script suele contestar en 2 a 5 s; si no contesta en 15, se deja de esperar
 * y se registra en el log, como cualquier otra falla del aviso. La acción ya
 * quedó escrita: el aviso no puede trabar el botón.
 */
const LIMITE_AVISO_MS = 15000;

/** Texto del aviso cuando una acción no confirmó dentro de `LIMITE_ACCION_MS`. */
const TEXTO_SIN_CONFIRMAR = 'No pudimos confirmar si se guardó. Revisá tu conexión: si en unos segundos el viaje no cambió, intentá de nuevo.';

/**
 * Corre una promesa contra un temporizador.
 *
 * Si vence, rechaza con un `Error` de `code: 'sin-confirmar'`; la promesa
 * original sigue en vuelo (no se puede cancelar) y puede terminar después.
 * Solo se usa en primer plano, donde los timers corren.
 *
 * @param {Promise} promesa
 * @param {number} ms
 * @returns {Promise<*>} El valor de la promesa, si terminó a tiempo.
 */
function conLimite(promesa, ms) {
  let temporizador;
  const vencimiento = new Promise((_, rechazar) => {
    temporizador = setTimeout(
      () => rechazar(Object.assign(new Error('sin confirmar'), { code: 'sin-confirmar' })),
      ms
    );
  });
  return Promise.race([promesa, vencimiento]).finally(() => clearTimeout(temporizador));
}

/* =============================================================================
 * UTILIDADES DE ÁMBITO DE MÓDULO
 * ========================================================================== */

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

  /** Visibilidad del modal para cambiar la contraseña (v1.1.1, Frente F). */
  const [modalClave, setModalClave] = useState(false);

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

  /**
   * Último estado del seguimiento informado al viaje (TrackEx v1.1.2 — GPS,
   * punto 3): `{ viajeId, clave }`, donde `clave` es el JSON de
   * `cambiosEstadoSeguimiento`. `informarSeguimiento` solo escribe si cambió,
   * para no reescribir el viaje en cada regreso a primer plano.
   */
  const ultimoSeguimientoRef = useRef({ viajeId: null, clave: '' });

  /**
   * Permiso de notificaciones: `null` mientras no se consultó; luego
   * `{ concedido, puedePreguntar }`. Maneja el aviso "Notificaciones desactivadas".
   */
  const [permisoNotif, setPermisoNotif] = useState(null);

  /**
   * Espejo de `permisoNotif` para comparar con el estado anterior dentro del
   * listener de AppState, que se registra una sola vez y no vería el estado nuevo
   * de React.
   */
  const permisoNotifRef = useRef(null);

  /** Espejo de `usuario` por la misma razón: el listener lo usa para registrar el token. */
  const usuarioRef = useRef(usuario);
  usuarioRef.current = usuario;

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
   * lo encuentre), siembra la cache del token para la subida por REST (sin
   * bloquear) y arranca la cadena de permisos.
   *
   * Sin viaje activo: sube lo pendiente (`descargarPendientes`) ANTES de
   * limpiar, para no perder el último tramo, y luego apaga todas las fuentes.
   * TrackEx v1.1.2 — GPS: se borran SOLO `viaje_activo` y `ultimo`, NO el
   * buffer: puede tener puntos pendientes (por ejemplo, sin red), que el gestor
   * sube o descarta solo. La migración del formato viejo, que antes corría acá
   * al principio, vive ahora en el almacén (`src/gps/seguimiento.js`), porque
   * la primera lectura puede ocurrir en la tarea, sin React.
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

        await escribirJSON(KEY_VIAJE_ACTIVO, { viajeId: activo.id });
        sembrarToken(auth.currentUser); // sin await: es una optimización

        if (!cancelado) await activarSeguimiento();
      } else {
        // Orden importante: subir primero, limpiar después.
        await descargarPendientes();
        // Sin red la descarga puede tardar hasta el límite de la subida; si en
        // ese tiempo arrancó otro viaje, esta limpieza borraría el suyo.
        if (cancelado) return;
        await limpiarEstadoLocalGPS();

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
   * EFECTO 4 — Volver a primer plano: permiso, servicio, subida y estado
   *
   * Cada vez que la app vuelve a 'active' (`alVolverAPrimerPlano`):
   *   1. Si se había derivado al chofer a Ajustes (Android 11+ abre Ajustes en
   *      vez de un diálogo), verifica si concedió el permiso de background,
   *      sin obligarlo a tocar nada más. Igual que antes.
   *   Con viaje en curso, además (TrackEx v1.1.2 — GPS, punto 5):
   *   2. `asegurarServicio`: si el sistema cortó el servicio (caso del 24/11
   *      a las 13:21), lo rearranca; si quedó activo, baja el watch de primer
   *      plano para que grabe una sola fuente.
   *   3. Siembra la cache del token y sube lo pendiente, SIN bloquear la UI.
   *   4. Informa el estado del seguimiento al viaje (`informarSeguimiento`).
   *
   * SIN DEPENDENCIAS A PROPÓSITO: el listener se registra una vez al montar y
   * se da de baja al desmontar. Registrarlo de nuevo en cada render dejaría
   * ventanas sin listener y listeners duplicados. Lo que necesita del estado
   * vigente lo lee por refs (`viajeActivoRef`, `esperandoAjustesRef`,
   * `usuarioRef`, `ultimoSeguimientoRef`) o lo consulta al sistema en el
   * momento (permisos, servicio), así que la closure del primer render no
   * deja nada obsoleto.
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') alVolverAPrimerPlano();
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
   * También registra el gancho (`ganchos.alDescartar`, src/gps/seguimiento.js)
   * que usa `alViajeDescartado` cuando el gestor descarta un viaje cerrado por
   * fuera: baja el seguimiento de primer plano y apaga el banner. Sin
   * dependencias: se registra una vez al montar.
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

  /* ---------------------------------------------------------------------------
   * EFECTO 6 — Permiso de notificaciones: consulta inicial y reevaluación
   *
   * Separado del EFECTO 4 (ubicación) porque son permisos independientes.
   *   a. Al montar consulta el permiso, lo guarda y registra UNA vez
   *      `push_permiso_estado` (para ver en app_logs quién las tiene apagadas).
   *   b. En cada AppState 'active' vuelve a consultar: cubre el regreso de
   *      Ajustes y el caso de que el chofer las apague con la app en segundo
   *      plano. Si pasó de no concedido a concedido, registra el token push.
   *   c. Al desmontar da de baja el listener.
   * Sin dependencias a propósito: se registra una vez y lee el estado vigente
   * por refs (`permisoNotifRef`, `usuarioRef`); `reevaluarPermisoNotif` solo usa
   * refs y setters, así que no captura valores obsoletos.
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    reevaluarPermisoNotif({ registrar: true });
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'active') reevaluarPermisoNotif({ registrar: true });
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===========================================================================
   * PERMISOS Y ARRANQUE DEL SEGUIMIENTO
   * ======================================================================== */

  /**
   * Consulta el permiso de notificaciones y, si cambió respecto del estado
   * anterior (o es la primera consulta), actualiza el estado y registra
   * `push_permiso_estado`.
   *
   * Si pasó de no concedido a concedido y `registrar` es true, registra el token
   * push (`registrarPushToken` solo escribe si el token cambió). `activarNotificaciones`
   * pasa `registrar: false` porque ya lo registró ella misma.
   *
   * @param {{registrar: boolean}} opciones
   * @returns {Promise<void>}
   */
  async function reevaluarPermisoNotif({ registrar }) {
    const nuevo = await consultarPermisoNotificaciones();
    const previo = permisoNotifRef.current;
    if (previo
      && previo.concedido === nuevo.concedido
      && previo.puedePreguntar === nuevo.puedePreguntar) return;

    permisoNotifRef.current = nuevo;
    setPermisoNotif(nuevo);
    await logApp('push_permiso_estado', {
      concedido: nuevo.concedido,
      puede_preguntar: nuevo.puedePreguntar,
    });

    if (registrar && previo && !previo.concedido && nuevo.concedido) {
      await registrarPushToken(usuarioRef.current);
    }
  }

  /**
   * Botón del aviso "Notificaciones desactivadas".
   *
   * Si el sistema todavía deja preguntar, `registrarPushToken` muestra el diálogo
   * (es el único camino que pide el permiso) y registra el token si se concede;
   * después se vuelve a consultar. Si ya no deja preguntar, se manda al chofer a
   * Ajustes y el regreso lo resuelve el EFECTO 6.
   *
   * @returns {Promise<void>}
   */
  async function activarNotificaciones() {
    if (permisoNotif?.puedePreguntar) {
      await registrarPushToken(usuario);
      await reevaluarPermisoNotif({ registrar: false });
    } else {
      abrirAjustes('Notificaciones');
    }
  }

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
   * Datos del viaje y del chofer para los logs de seguimiento (TrackEx v1.1.2
   * — GPS, punto 4). El 24/11 los logs de permisos no decían de qué viaje ni
   * de qué chofer eran, y no se pudieron cruzar con los viajes sin traza. Lee
   * por refs: se usa desde el listener de AppState, que se registra una vez.
   *
   * @returns {{viaje_id: string, dni: string}}
   */
  function datosLog() {
    return {
      viaje_id: viajeActivoRef.current?.id || '',
      dni: usuarioRef.current?.datos_chofer?.dni || '',
    };
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
   *   2. Notificaciones (solo Android 13+). Si falla, se loguea y se sigue.
   *   3. Background:
   *      - ya concedido → arranca la tarea y NO inicia el watch de primer plano
   *        (TrackEx v1.1.2 — GPS, causa B: una sola fuente graba);
   *      - no concedido → inicia el watch como siempre (con el permiso de
   *        primer plano alcanza para registrar traza mientras el chofer mira el
   *        teléfono) y muestra el modal explicativo antes de derivar a Ajustes.
   *   4. En todas las salidas, `informarSeguimiento()` (caso C).
   *
   * @returns {Promise<void>}
   */
  async function activarSeguimiento() {
    try {
      const fg = await Location.requestForegroundPermissionsAsync().catch(() => null);
      if (!fg || fg.status !== 'granted') {
        setGpsEstado('sin_permiso');
        await logApp('permiso_foreground_denegado', {
          ...datosLog(),
          puede_reintentar: fg ? String(fg.canAskAgain) : 'null',
        });
        return;
      }

      const notificaciones = await pedirPermisoNotificaciones();
      if (!notificaciones) {
        await logApp('permiso_notificaciones_denegado');
      }

      const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
      if (bg && bg.status === 'granted') {
        await arrancarTareaBackground();
        return;
      }

      // Sin "Permitir siempre": una fuente degradada es mejor que ninguna.
      await iniciarWatchForeground();
      setGpsEstado('solo_primer_plano');

      // En Android 11+ `requestBackgroundPermissionsAsync` no muestra diálogo:
      // manda al chofer directo a Ajustes. La propia doc de Expo recomienda
      // explicar antes por qué se necesita. Sin eso, el chofer aterriza en una
      // pantalla del sistema sin entender qué le pidieron.
      setModalPermiso(true);
    } finally {
      await informarSeguimiento();
    }
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
          ...datosLog(),
          puede_reintentar: String(bg.canAskAgain),
        });
      }
    } catch (err) {
      esperandoAjustesRef.current = false;
      await logApp('permiso_background_error', {
        ...datosLog(),
        code: err?.code || '',
        mensaje: err?.message || '',
      });
    }
    await informarSeguimiento();
  }

  /**
   * "Ahora no" del modal de permiso (TrackEx v1.1.2 — GPS, caso C).
   *
   * Antes cerrar el modal no dejaba rastro: el 24/11 un chofer quedó todo el
   * viaje sin "Permitir siempre" y no había forma de saberlo. Ahora queda el
   * log `permiso_background_pospuesto` y el estado `limitado` en el viaje.
   *
   * @returns {Promise<void>}
   */
  async function posponerPermisoBackground() {
    setModalPermiso(false);
    logApp('permiso_background_pospuesto', datosLog());
    await informarSeguimiento();
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
    await informarSeguimiento();
  }

  /**
   * Registra la tarea de ubicación en segundo plano con su foreground service.
   *
   * El try/catch es CRÍTICO y no existía antes: si `startLocationUpdatesAsync`
   * fallaba (por ejemplo, por un servicio mal declarado en el manifiesto), el
   * rechazo quedaba sin manejar y era completamente invisible en producción. Es
   * plausible que el servicio viniera fallando al arrancar desde siempre.
   *
   * Las opciones (precisión, cadencia, notificación con
   * `killServiceOnDestroy: false`) son las de siempre y viven en
   * `iniciarServicio` (src/gps/seguimiento.js), que también usa
   * `asegurarServicio` al rearrancar.
   *
   * TrackEx v1.1.2 — GPS: con el servicio activo se baja el watch de primer
   * plano (una sola fuente graba, causa B). Si el servicio falla, se arranca el
   * watch: mientras el chofer mire el teléfono, hay traza. En los dos casos se
   * informa el estado del seguimiento al viaje.
   *
   * @returns {Promise<void>}
   */
  async function arrancarTareaBackground() {
    try {
      await iniciarServicio();
      detenerWatchForeground();
      setGpsEstado('activo');
      await logApp('gps_background_iniciado', datosLog());
    } catch (err) {
      setGpsEstado('error');
      await logApp('gps_background_error', {
        ...datosLog(),
        code: err?.code || '',
        mensaje: err?.message || '',
      });
      await iniciarWatchForeground();
      // Se avisa sin alarmar: el viaje funciona igual, lo que se degrada es la traza.
      Alert.alert(
        'Seguimiento limitado',
        'No pudimos activar el registro del recorrido con la app cerrada. El viaje se registra igual, pero conviene avisarle al administrador.'
      );
    }
    await informarSeguimiento();
  }

  /**
   * Suscribe la fuente de primer plano (`watchPositionAsync`).
   *
   * Solo requiere permiso de foreground: ni servicio, ni notificación, ni
   * derivación a Ajustes. Es la red de seguridad para el chofer que nunca
   * concede "Permitir siempre" — mientras mire el teléfono, hay traza.
   *
   * TrackEx v1.1.2 — GPS: cada lectura va ENTERA (con su `timestamp`) a
   * `procesarUbicaciones`, el mismo punto de entrada que la tarea. Si el
   * servicio de segundo plano está activo, el gestor ignora esta copia
   * (`fuenteDebeGrabar`, segunda barrera después de no iniciar el watch).
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
        (loc) => {
          procesarUbicaciones([loc], FUENTE.PRIMER_PLANO).catch((err) => {
            logApp('watch_foreground_error', {
              ...datosLog(),
              code: err?.code || '',
              mensaje: err?.message || '',
            });
          });
        }
      );
    } catch (err) {
      await logApp('watch_foreground_error', {
        code: err?.code || '',
        mensaje: err?.message || '',
      });
    }
  }

  /**
   * Informa al viaje el estado del seguimiento (TrackEx v1.1.2 — GPS, caso C).
   *
   * El 24/11 un teléfono sin "Permitir siempre" quedó sin traza con la pantalla
   * apagada y el portal no tenía cómo saberlo. Junta:
   *   - permiso de ubicación y de segundo plano (consultas, nunca pedidos);
   *   - notificaciones: se consulta en el momento con
   *     `consultarPermisoNotificaciones` (la misma fuente que `permisoNotif`)
   *     y no se lee el estado de React, porque al volver de Ajustes el
   *     EFECTO 6 puede no haberlo actualizado todavía;
   *   - si el servicio corre (`hasStartedLocationUpdatesAsync`);
   *   - la versión instalada (`Constants.expoConfig.version`, la misma fuente
   *     que `PieVersion` y `registro.js`).
   * Si `cambiosEstadoSeguimiento` difiere de lo último informado para ese
   * viaje, escribe con `registrarEstadoSeguimiento` SIN `await` (es telemetría;
   * el SDK la encola si no hay red) y registra `seguimiento_estado`. Nunca
   * lanza: no puede trabar la cadena de permisos.
   *
   * @returns {Promise<void>}
   */
  async function informarSeguimiento() {
    const viaje = viajeActivoRef.current;
    if (!viaje) return;
    try {
      const [fg, bg, notif, servicio] = await Promise.all([
        Location.getForegroundPermissionsAsync().catch(() => null),
        Location.getBackgroundPermissionsAsync().catch(() => null),
        consultarPermisoNotificaciones(),
        servicioActivo(),
      ]);
      const estado = {
        permisoUbicacion: fg?.status === 'granted',
        permisoSegundoPlano: bg?.status === 'granted',
        notificaciones: notif?.concedido === true,
        servicioActivo: servicio === true,
        versionApp: Constants.expoConfig?.version || '',
      };
      const campos = cambiosEstadoSeguimiento(estado);
      const clave = JSON.stringify(campos);
      const previo = ultimoSeguimientoRef.current;
      if (previo.viajeId === viaje.id && previo.clave === clave) return;
      ultimoSeguimientoRef.current = { viajeId: viaje.id, clave };

      registrarEstadoSeguimiento({ db, viajeId: viaje.id, estado }).catch((err) => {
        // Se olvida lo informado para reintentar en la próxima reevaluación.
        ultimoSeguimientoRef.current = { viajeId: null, clave: '' };
        logApp('seguimiento_estado_error', {
          viaje_id: viaje.id,
          code: err?.code || '',
          mensaje: err?.message || '',
        });
      });
      logApp('seguimiento_estado', { ...datosLog(), viaje_id: viaje.id, ...campos });
    } catch (err) {
      logApp('seguimiento_estado_error', {
        viaje_id: viaje.id,
        code: err?.code || '',
        mensaje: err?.message || '',
      });
    }
  }

  /**
   * Regreso a primer plano: ver EFECTO 4. Nunca lanza (corre desde un
   * listener, donde un rechazo quedaría sin manejar).
   *
   * @returns {Promise<void>}
   */
  async function alVolverAPrimerPlano() {
    try {
      if (esperandoAjustesRef.current) {
        esperandoAjustesRef.current = false;
        await revisarPermisoBackground();
      }
      if (!viajeActivoRef.current) return;

      const activo = await asegurarServicio();
      if (activo) {
        detenerWatchForeground();
        setGpsEstado('activo');
      }

      // Sin bloquear la UI: la subida puede tardar hasta el límite de tiempo.
      sembrarToken(auth.currentUser);
      descargarPendientes().catch(() => {});

      await informarSeguimiento();
    } catch (err) {
      logApp('primer_plano_error', {
        ...datosLog(),
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
   *
   * ACCIONES CON RESULTADO SIEMPRE VISIBLE (TrackEx v1.1.2 — GPS, punto 7).
   * SÍNTOMA: el 24/11 no se pudo saber si los choferes habían tocado Finalizar.
   * CAUSA RAÍZ: una transacción de Firestore sin red no falla, queda esperando;
   * el botón quedaba en "Confirmando..." y no había log hasta que terminaba.
   * CORRECCIÓN:
   *   1. ANTES de escribir se registra `accion_intento` (`accion`, `viaje_id`,
   *      `dni`), sin `await`: queda el rastro de que el chofer tocó el botón.
   *   2. La escritura compartida corre contra `LIMITE_ACCION_MS` (25 s,
   *      `conLimite`). En primer plano los timers corren.
   *   3. Si vence: `accion_sin_confirmar` y el aviso `TEXTO_SIN_CONFIRMAR`.
   * POR QUÉ ES SEGURO REINTENTAR: `iniciarViaje`, `reportarDemora` y
   * `finalizarViaje` son transacciones que leen el viaje y revalidan su estado
   * antes de escribir. Si la primera escritura sí llegó, el reintento falla
   * con un mensaje ("Este viaje ya está iniciado.", "El viaje está FINALIZADO
   * y no se puede cerrar.") en vez de escribir dos veces; en la demora, solo
   * reescribe el mismo atributo `demorado`. Además el snapshot del viaje
   * actualiza la pantalla en cuanto la escritura llega, que es lo que el aviso
   * le pide al chofer que mire.
   * LIMITACIÓN: la transacción vencida no se cancela; puede terminar después
   * del aviso (y entonces la pantalla cambia sola).
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
   * PAYLOAD (TrackEx v1.1.1, Frente D). Todos los campos salen del viaje ya
   * adaptado (`adaptarViaje`): no hay lecturas nuevas a Firestore.
   *   accion, viaje_id, pedido_id, despacho_id, chofer (nombre, o el DNI si no
   *   hay nombre), chofer_dni, producto, cliente, volumen, origen, lugar
   *   (destino), fecha_carga, patente_tractor, patente_semi, motivo y `ov`.
   * `ov` va vacío: el viaje no trae el número de OV, así que el asunto del mail
   * sale con "[—]". No se manda `destinatarios`: el chofer no puede leer la
   * lista de coordinadores en `usuarios`, y el Apps Script usa su lista de
   * respaldo.
   *
   * LECTURA DE LA RESPUESTA. El Apps Script contesta HTTP 200 aun cuando falla
   * (`{"status":"error",...}`), por eso antes el aviso podía no salir sin que
   * nadie se enterara: la acción `chofer_demora` no estaba registrada y la app
   * no leía la respuesta. Ahora se lee el texto y se intenta `JSON.parse`; si
   * `res.ok` es false, si no es JSON o si `status !== 'ok'` se registra
   * `aviso_coordinador_rechazado` (con `http` y los primeros 200 caracteres de
   * la respuesta). Nada de esto se le muestra al chofer: la acción ya quedó
   * escrita y no se revierte. El error de red sigue registrándose como
   * `aviso_apps_script_error`.
   *
   * ES UN PARCHE hasta portal v1.2.4, cuando los avisos pasen a la API de Vercel.
   *
   * LÍMITE DE ESPERA (TrackEx v1.1.2 — GPS, punto 7.5): el `fetch` y la lectura
   * de la respuesta corren contra `LIMITE_AVISO_MS` (15 s). Antes un Apps Script
   * colgado dejaba el botón en "Confirmando..." aunque el viaje ya estuviera
   * escrito. Si vence, se registra `aviso_apps_script_error` con
   * `code: 'sin-confirmar'`, como cualquier otra falla del aviso: el pedido
   * puede igual llegar después.
   *
   * @param {string} accion 'chofer_demora' | 'chofer_finalizo'
   * @param {Object} viaje Viaje adaptado (`adaptarViaje`).
   * @param {string} [motivo] Motivo de la demora, si corresponde.
   * @returns {Promise<void>}
   */
  async function avisarCoordinador(accion, viaje, motivo = '') {
    const payload = {
      accion,
      viaje_id: viaje.id,
      pedido_id: viaje.pedido_id,
      despacho_id: viaje.despacho_id,
      chofer: usuario?.nombre || dniUsuario,
      chofer_dni: dniUsuario,
      producto: viaje.producto,
      cliente: viaje.cliente,
      volumen: viaje.volumen,
      origen: viaje.origen,
      lugar: viaje.lugar,
      fecha_carga: viaje.fecha_carga,
      patente_tractor: viaje.patente_tractor,
      patente_semi: viaje.patente_semi,
      motivo,
      ov: '',
    };
    try {
      const url = APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
      const { res, texto } = await conLimite(
        fetch(url).then(async (r) => ({ res: r, texto: await r.text() })),
        LIMITE_AVISO_MS
      );
      let respuesta = null;
      try {
        respuesta = JSON.parse(texto);
      } catch (errJson) {
        respuesta = null;
      }
      if (!res.ok || !respuesta || respuesta.status !== 'ok') {
        await logApp('aviso_coordinador_rechazado', {
          accion,
          viaje_id: viaje.id,
          http: String(res.status),
          respuesta: String(texto).slice(0, 200),
        });
      }
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
    // Venció `LIMITE_ACCION_MS`: no es un error de la escritura, es que no
    // sabemos si llegó. Ver "ACCIONES CON RESULTADO SIEMPRE VISIBLE".
    if (err?.code === 'sin-confirmar') {
      logApp('accion_sin_confirmar', { accion, viaje_id: viaje?.id || '', dni: dniUsuario });
      Alert.alert('Sin confirmar', TEXTO_SIN_CONFIRMAR);
      return;
    }

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
    logApp('accion_intento', { accion: 'demora', viaje_id: viaje.id, dni: dniUsuario });
    setProcesando(true);
    try {
      await conLimite(reportarDemora({ db, viaje, motivo, usuario }), LIMITE_ACCION_MS);
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
   *   2. Subir lo pendiente (`descargarPendientes`). Las reglas de `gps_puntos`
   *      exigen el viaje en EN_VIAJE, así que tiene que ir ANTES de cerrarlo:
   *      después rebota. Si igual quedan puntos de este viaje (sin red, o la
   *      subida venció), se registra `gps_pendientes_al_finalizar` con la
   *      cantidad y SE FINALIZA IGUAL: el viaje siempre avanza.
   *      LIMITACIÓN: esos puntos ya no pueden subir con el viaje cerrado; el
   *      gestor los descarta en la próxima descarga (`gps_descarte`). Sin red,
   *      este paso puede sumar hasta el límite de la subida (20 s, más la
   *      renovación del token si hiciera falta) antes del cierre.
   *   3. `finalizarViaje`, que cierra el viaje y empuja el despacho a ENTREGADO,
   *      con el límite de `LIMITE_ACCION_MS`.
   *
   * @returns {Promise<void>}
   */
  async function confirmarFinalizar() {
    const viaje = modalFinalizar;
    logApp('accion_intento', { accion: 'finalizar', viaje_id: viaje.id, dni: dniUsuario });
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
      await descargarPendientes();
      const quedan = await pendientesDeViaje(viaje.id);
      if (quedan > 0) {
        logApp('gps_pendientes_al_finalizar', {
          viaje_id: viaje.id,
          dni: dniUsuario,
          puntos_pendientes: quedan,
        });
      }

      // 3. Cierre.
      await conLimite(finalizarViaje({
        db,
        viaje,
        despacho: { id: viaje.despacho_id },
        posicion,
        cerradoPor: 'chofer',
        usuario,
      }), LIMITE_ACCION_MS);

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
    logApp('accion_intento', { accion: 'iniciar', viaje_id: v.id, dni: dniUsuario });
    setProcesando(true);
    try {
      const posicion = await obtenerPuntoActual();
      if (!posicion) {
        await logApp('punto_no_disponible', { viaje_id: v.id, accion: 'iniciar' });
      }

      await conLimite(
        iniciarViaje({ db, viaje: v, posicion, misViajes: viajes, usuario }),
        LIMITE_ACCION_MS
      );
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
   *
   * @param {string} [permiso='Ubicación'] Nombre del permiso, para el texto de respaldo.
   */
  function abrirAjustes(permiso = 'Ubicación') {
    Linking.openSettings().catch(() => {
      Alert.alert('Ajustes', `Abrí Ajustes → Apps → TrackEx → Permisos → ${permiso}.`);
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
              <TouchableOpacity style={s.btnGris} onPress={posponerPermisoBackground}>
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

      {/* Modal para cambiar la contraseña (opcional; v1.1.1, Frente F). */}
      <ModalCambiarClave visible={modalClave} onCerrar={() => setModalClave(false)} />

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
              {/* Cambiar contraseña (opcional). */}
              <TouchableOpacity onPress={() => setModalClave(true)} hitSlop={HIT_SLOP} accessibilityLabel="Cambiar contraseña">
                <Text style={s.btnTema}>🔑</Text>
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

          {/* Aviso de notificaciones desactivadas (Frente B). Reutiliza a propósito
              los estilos del aviso de seguimiento (`gpsAviso*`): es la misma
              familia visual de avisos de permisos. Solo se muestra una vez
              consultado el permiso y si no está concedido. */}
          {permisoNotif !== null && !permisoNotif.concedido && (
            <View style={s.gpsAviso}>
              <Text style={s.gpsAvisoTit}>🔔 Notificaciones desactivadas</Text>
              <Text style={s.gpsAvisoTxt}>
                No vas a recibir avisos de viajes nuevos, cancelaciones ni cambios de destino con la app cerrada. Cuando la abras, los avisos igual aparecen acá arriba.
              </Text>
              <TouchableOpacity style={s.gpsAvisoBtn} onPress={activarNotificaciones}>
                <Text style={s.gpsAvisoBtnTxt}>
                  {permisoNotif.puedePreguntar ? 'Activar notificaciones' : 'Abrir ajustes de la app'}
                </Text>
              </TouchableOpacity>
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
              <TouchableOpacity style={s.gpsAvisoBtn} onPress={() => abrirAjustes()}>
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
