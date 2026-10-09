/**
 * =============================================================================
 * compartido.js — Punto ÚNICO de import del código compartido con el portal
 * =============================================================================
 *
 * PROPÓSITO
 * La lógica de negocio de los viajes (iniciar, demorar, finalizar, registrar
 * puntos de GPS) vive en `portal/src/shared/` y la usan el portal y esta app.
 * Este archivo la reexporta para que la app importe SIEMPRE de acá y nunca con
 * la ruta cruzada (`../../portal/src/shared/...`) repartida por las pantallas.
 *
 * POR QUÉ UN SOLO PUNTO
 * Si la carpeta compartida se mueve o se renombra, se corrige una línea y no
 * cada pantalla. Además deja a la vista qué parte del código compartido usa la
 * app (la lista de abajo es la superficie completa).
 *
 * DEPENDENCIAS Y ENTORNO
 * Metro resuelve la ruta cruzada gracias a `metro.config.js` (watchFolders +
 * resolución de `firebase/firestore` siempre desde explora-app/node_modules).
 * Las funciones reciben `db` por parámetro: la app pasa su propia instancia.
 * =============================================================================
 */

export {
  iniciarViaje,
  reportarDemora,
  finalizarViaje,
  registrarPuntos,
  saludGPS,
} from '../../portal/src/shared/logica-viajes';

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
