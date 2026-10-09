/**
 * =============================================================================
 * dimensiones.js — Tamaños de la app que NO tienen token compartido
 * =============================================================================
 *
 * `tipografia.tamano` del portal llega hasta 18px (`titulo`). La app, pensada
 * para el teléfono del chofer, usa títulos más grandes. En vez de repetir el
 * número suelto en cada estilo se nombran acá. Son decisiones de diseño de la
 * app; si alguna se vuelve común con el portal, el lugar correcto es
 * `shared/tokens.js`.
 * =============================================================================
 */

/** Título del viaje en el encabezado de ChoferScreen. */
export const TAMANO_TITULO_ENCABEZADO = 22;

/** Título del estado vacío ("Libre"). */
export const TAMANO_TITULO_VACIO = 24;

/** Título "TrackEx" de la pantalla de login. */
export const TAMANO_TITULO_LOGIN = 26;

/** Ícono (emoji) de los bottom sheets. */
export const TAMANO_ICONO_MODAL = 36;

/** Ícono (emoji) del estado vacío. */
export const TAMANO_ICONO_VACIO = 48;

/** Ancho máximo de la columna central en pantallas grandes (tablets, horizontal). */
export const ANCHO_MAXIMO_COLUMNA = 600;
