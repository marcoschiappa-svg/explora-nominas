/**
 * =============================================================================
 * encabezados.js — Degradés y etiquetas del encabezado de ChoferScreen
 * =============================================================================
 *
 * PROPÓSITO
 * Reemplaza a las tablas de colores y etiquetas de `config/constants.js`, que
 * tenían los colores escritos a mano y estaban indexados por la "clave visual"
 * del modelo viejo (recibido / iniciado / demorado). Ahora se indexa por el
 * ESTADO REAL del viaje y los colores salen de los tokens compartidos.
 *
 * DECISIONES
 *   - La demora NO tiene degradé propio: es un atributo del viaje, no un
 *     estado. Se muestra como badge "Demorado" dentro del encabezado.
 *   - Estados: `libre` (sin viajes), RECIBIDO y EN_VIAJE. Los demás no llegan
 *     a la pantalla (la consulta filtra solo RECIBIDO y EN_VIAJE).
 *   - Los degradés no cambian con el tema: el encabezado es de color en
 *     claro y en oscuro (por eso la StatusBar de ChoferScreen es siempre
 *     'light').
 * =============================================================================
 */

import { marca, marcaHover, colorEstado, VIAJE } from '../compartido';

/** Degradé [desde, hasta] por estado. */
export const DEGRADE_ENCABEZADO = {
  libre: [marca, marcaHover],
  [VIAJE.RECIBIDO]: [colorEstado.acentoAzul, colorEstado.acentoAzulFuerte],
  [VIAJE.EN_VIAJE]: [colorEstado.exitoTexto, colorEstado.acentoVerde],
};

/** Etiqueta (sobre el título) por estado. */
export const ETIQUETA_ENCABEZADO = {
  libre: 'Sin viajes activos',
  [VIAJE.RECIBIDO]: 'Viaje recibido',
  [VIAJE.EN_VIAJE]: 'En ruta',
};

/**
 * Clave de estado del encabezado para un viaje (o 'libre' si no hay).
 *
 * @param {{estado: string}|null} viaje Viaje de referencia.
 * @returns {string} 'libre' | VIAJE.RECIBIDO | VIAJE.EN_VIAJE
 */
export function estadoEncabezado(viaje) {
  return viaje && DEGRADE_ENCABEZADO[viaje.estado] ? viaje.estado : 'libre';
}
