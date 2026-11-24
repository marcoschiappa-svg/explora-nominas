/* =============================================================================
 * seguimiento-encuadre.js — v1.2.6 — Mapa de Seguimiento
 * =============================================================================
 *
 * SÍNTOMA
 *   (a) En pantallas chicas (notebooks) el mapa de Seguimiento quedaba como un
 *   recuadro gris: Leaflet cargaba pero no dibujaba teselas hasta que el
 *   usuario cambiaba el zoom del navegador o el tamaño de la ventana.
 *   (b) La vista inicial mostraba Argentina entera con países limítrofes, en
 *   vez del área operativa alrededor de Rosario.
 *
 * CAUSA RAÍZ
 *   (a) Leaflet mide el contenedor una vez al crear el mapa. El
 *   ResizeObserver de v1.2.5 llamaba a `invalidateSize()` sincrónicamente y
 *   sin filtrar medidas 0, y encuadraba una sola vez: si esa primera medida
 *   no era la final (fuentes, BarraSuperior, tab, filtros), el zoom y las
 *   teselas pedidas correspondían a un tamaño viejo.
 *   (b) Constante `LIMITES_ARGENTINA` + `fitBounds`.
 *
 * ALCANCE
 *   Este archivo: constantes del encuadre (1) y la función pura
 *   `limitesSimetricos()` (2), separada de Seguimiento.js para poder
 *   testearla sin Leaflet ni Firebase. El uso (ResizeObserver, setView,
 *   zoomSnap, re-encuadre hasta la primera interacción) vive en
 *   Seguimiento.js, ver su encabezado v1.2.6.
 *
 * LIMITACIONES CONOCIDAS
 *   Los límites se calculan en grados, no en metros: en Mercator, la
 *   simetría en latitud no es simetría exacta en píxeles (a esta latitud la
 *   diferencia es de pocos píxeles y siempre a favor de mostrar de más).
 *
 * CÓMO SE VERIFICA
 *   `seguimiento-encuadre.test.js`.
 * ========================================================================== */

// v1.2.6 (1): centro de la vista inicial -- Rosario.
export const CENTRO_ROSARIO = [-32.95, -60.65];

// v1.2.6 (1): [SO, NE] de lo que TIENE que verse siempre, en cualquier
// pantalla: Córdoba capital (oeste), Santa Fe y Paraná (norte), Buenos Aires
// y La Plata (sureste) y el sur de Entre Ríos (este).
export const REGION_OBJETIVO = [[-34.75, -64.35], [-31.25, -58.2]];

/**
 * v1.2.6 (2): límites [SO, NE] centrados en `centro` que contienen `region`
 * entera. Para cada eje toma la mayor distancia del centro a cualquiera de
 * los dos bordes de la región y la aplica hacia ambos lados.
 */
export function limitesSimetricos(centro, region) {
  const [lat, lng] = centro;
  const [[sur, oeste], [norte, este]] = region;
  const dLat = Math.max(Math.abs(lat - sur), Math.abs(norte - lat));
  const dLng = Math.max(Math.abs(lng - oeste), Math.abs(este - lng));
  return [[lat - dLat, lng - dLng], [lat + dLat, lng + dLng]];
}
