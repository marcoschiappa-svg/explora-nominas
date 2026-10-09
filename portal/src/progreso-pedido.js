/* =============================================================================
 * progreso-pedido.js — v1.2.0 (rediseño Pedidos): progreso puro de un pedido
 * =============================================================================
 *
 * SÍNTOMA
 *   El diseño aprobado ("Portal Pedidos") pide una barra de progreso por
 *   pedido con 5 tramos de aporte -- sin cubrir (0%), programada/despacho
 *   aceptado (20%), nominada (40%), en viaje (70%) y entregada (100%) --
 *   ponderados por la cantidad de cada entrega.
 *
 * CAUSA RAÍZ
 *   No existía ningún cálculo de progreso puro y testeable: `Pedidos.js` hoy
 *   dibuja `BarraProgreso` a partir de tres CONTADORES ya guardados en el
 *   pedido (`entregas_total`/`entregas_cubiertas`/`entregas_cumplidas`, ver
 *   `estadoPedido()` en `estados.js`), no a partir de leer cada entrega.
 *
 * ALCANCE (Y EL FRENO DEL PASO 3 DEL PROMPT)
 *   Esta pantalla NO carga `despachos` ni `viajes` -- se suscribe a
 *   `pedidos` y a `entregas` nada más (ver el `useEffect` principal de
 *   `Pedidos.js`). `entrega.estado` es un campo YA CALCULADO Y GUARDADO por
 *   `estadoEntrega()` (`estados.js`) a partir de los despachos de esa
 *   entrega, pero solo distingue 4 valores: `pendiente` / `programada` /
 *   `cumplida` / `suspendida` -- NO diferencia, dentro de "programada", si el
 *   despacho está ACEPTADO, NOMINADO o EN VIAJE (eso requeriría leer
 *   `despachos` y `viajes`, colecciones que esta pantalla no trae hoy).
 *
 *   Agregar esas dos lecturas nuevas solo para pintar una barra de progreso
 *   más granular es un cambio de alcance mayor al de esta tarea (más
 *   `onSnapshot`, más permisos a revisar, más superficie de re-render por
 *   cada pedido visible) -- así que, siguiendo la regla del prompt ("si hoy
 *   Pedidos no carga despachos ni viajes... frená y reportalo antes de
 *   agregar lecturas"), ACÁ SE FRENÓ: la tabla de 5 etapas del diseño se
 *   colapsa a las 3 que sí se pueden calcular sin leer nada nuevo:
 *
 *     sin cubrir (pendiente)  -> 0%
 *     con camión (programada) -> 40%  (punto medio de 20/40/70 del diseño)
 *     entregada (cumplida)    -> 100%
 *
 *   Se documenta como discrepancia en el reporte de la tarea, no se inventa
 *   una lectura nueva para completar el diseño al pie de la letra.
 *
 *   `entregaSinCubrir`/`estadoEntrega` de `estados.js` NO se llaman acá
 *   porque necesitan la lista de despachos de cada entrega, que este cálculo
 *   no tiene -- se usa directo `entrega.estado`, el mismo campo que ya lee el
 *   resto de `Pedidos.js` (`e.estado !== 'suspendida'`, etc).
 *
 * LIMITACIONES CONOCIDAS
 *   - Una entrega sin `volumen` cargado (o con 0) no aporta a la ponderación
 *     por cantidad; si NINGUNA entrega activa tiene volumen, se promedia
 *     simple (sin ponderar) para no dividir por cero.
 *   - `suspendida` queda afuera del cálculo por completo (ni en el numerador
 *     ni en el denominador de `done/total`) -- mismo criterio que ya usa
 *     `entregaSinCubrir()` en `estados.js`.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- progreso-pedido` -- ver `progreso-pedido.test.js`.
 * ========================================================================== */

import { ENTREGA } from './shared/estados';

// 1. Aporte de cada etapa DISPONIBLE (ver ALCANCE arriba: colapso de 5 a 3).
export const APORTE_ETAPA = {
  [ENTREGA.PENDIENTE]: 0,
  [ENTREGA.PROGRAMADA]: 40,
  [ENTREGA.CUMPLIDA]: 100,
};

/**
 * Progreso de un pedido a partir de sus entregas.
 *
 * @param {Array<{estado: string, volumen: number|string}>} entregas
 * @returns {{ porcentaje: number, done: number, total: number }}
 *   `porcentaje` 0-100 (redondeado), `done` = entregas cumplidas,
 *   `total` = entregas no suspendidas.
 */
export function progresoPedido(entregas) {
  // 2. Las suspendidas no cuentan ni para el numerador ni para el
  //    denominador -- mismo criterio que `entregaSinCubrir()`.
  const activas = (entregas || []).filter(e => e && e.estado !== ENTREGA.SUSPENDIDA);
  const total = activas.length;
  const done = activas.filter(e => e.estado === ENTREGA.CUMPLIDA).length;

  if (total === 0) return { porcentaje: 0, done: 0, total: 0 };

  const sumaVolumen = activas.reduce((s, e) => s + (Number(e.volumen) || 0), 0);

  let porcentaje;
  if (sumaVolumen <= 0) {
    // 3. Sin cantidad cargada en ninguna entrega activa: promedio simple,
    //    para no dividir por cero.
    const suma = activas.reduce((s, e) => s + (APORTE_ETAPA[e.estado] || 0), 0);
    porcentaje = suma / total;
  } else {
    // 4. Ponderado por cantidad -- una entrega de 30tn pesa el triple que
    //    una de 10tn en el promedio.
    const suma = activas.reduce(
      (s, e) => s + (APORTE_ETAPA[e.estado] || 0) * (Number(e.volumen) || 0),
      0
    );
    porcentaje = suma / sumaVolumen;
  }

  return { porcentaje: Math.round(porcentaje), done, total };
}
