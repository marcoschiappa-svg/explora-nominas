/**
 * =============================================================================
 * compartido.js — Punto ÚNICO de import del código compartido con el portal
 * =============================================================================
 *
 * PROPÓSITO
 * La lógica de negocio de los viajes (iniciar, demorar, finalizar, estado del
 * seguimiento) y la del GPS (filtrar, guardar y subir puntos) viven en
 * `portal/src/shared/` y las usan el portal y esta app. Este archivo las
 * reexporta para que la app importe SIEMPRE de acá y nunca con la ruta cruzada
 * (`../../portal/src/shared/...`) repartida por las pantallas.
 *
 * POR QUÉ UN SOLO PUNTO
 * Si la carpeta compartida se mueve o se renombra, se corrige una línea y no
 * cada pantalla. Además deja a la vista qué parte del código compartido usa la
 * app (la lista de abajo es la superficie completa).
 *
 * HISTORIAL DE CORRECCIONES
 *   TrackEx v1.1.2 — GPS: se exporta `logica-gps.js` (constantes, gestor,
 *   codificación REST) y `registrarEstadoSeguimiento`. `registrarPuntos` deja
 *   de exportarse: la app ya no sube puntos con el SDK de Firestore, porque en
 *   segundo plano sus escrituras quedaban pendientes horas sin fallar (ver
 *   `src/gps/subida.js`). No queda ninguna referencia a `registrarPuntos` en
 *   la app; el portal la sigue teniendo en `logica-viajes.js`.
 *
 * DEPENDENCIAS Y ENTORNO
 * Metro resuelve la ruta cruzada gracias a `metro.config.js` (watchFolders +
 * resolución de `firebase/firestore` siempre desde explora-app/node_modules).
 * Las funciones de viajes reciben `db` por parámetro: la app pasa su propia
 * instancia. `logica-gps.js` no importa nada externo (todo entra inyectado).
 * =============================================================================
 */

export {
  iniciarViaje,
  reportarDemora,
  finalizarViaje,
  saludGPS,
  registrarEstadoSeguimiento,
  cambiosEstadoSeguimiento,
} from '../../portal/src/shared/logica-viajes';

// GPS (TrackEx v1.1.2): constantes, gestor y codificación REST.
export {
  PRECISION_MAXIMA_METROS,
  VELOCIDAD_MAXIMA_KMH,
  GPS_INTERVALO_MS,
  GPS_DISTANCIA_M,
  BUFFER_MAX_PUNTOS,
  BUFFER_MAX_EDAD_MS,
  BUFFER_TOPE_PUNTOS,
  LOTE_MAXIMO_PUNTOS,
  TIMEOUT_SUBIDA_MS,
  FUENTE,
  RESULTADO_SUBIDA,
  crearGestorGPS,
  normalizarLectura,
  migrarBufferViejo,
  armarCommitRest,
  urlCommitRest,
  urlDocumentoRest,
  clasificarRespuesta,
  leerEstadoViajeRest,
} from '../../portal/src/shared/logica-gps';

export { VIAJE, ETIQUETA_VIAJE } from '../../portal/src/shared/estados';

// Tokens de diseño (colores, tema, espaciado, tipografía). La app nunca
// duplica estos valores. OJO: algunos están pensados para CSS y no sirven tal
// cual en React Native (`tipografia.familia`, `sombra.*`).
export {
  marca,
  marcaHover,
  colorEstado,
  temaClaro,
  temaOscuro,
  espacio,
  radio,
  tipografia,
  sombra,
  paletaTexto,
} from '../../portal/src/shared/tokens';
