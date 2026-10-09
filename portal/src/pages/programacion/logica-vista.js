/* =============================================================================
 * logica-vista.js — v1.2.0 (rediseño Programación)
 * =============================================================================
 *
 * SÍNTOMA
 *   El diseño aprobado ("Portal Programación", Claude Design) necesita tres
 *   cálculos puros que no existían: cuántas entregas de un pedido están sin
 *   cubrir (para el chip "N sin cubrir" de la lista y del modal), el orden de
 *   las entregas dentro del panel "ENTREGAS" (el diseño pide "sin prioridad:
 *   se ordenan por número", descartando el chip de prioridad que trae el
 *   diseño original), y el mapeo de los siete estados de `DESPACHO`
 *   (`estados.js`) a los tres estilos visuales del diseño (V2 del reporte de
 *   la tarea).
 *
 * CAUSA RAÍZ
 *   Nada de esto vivía en un lugar propio: antes de este rediseño, la lista
 *   de `Programacion.js` no mostraba "N sin cubrir" a nivel pedido (solo lo
 *   calculaba inline en `FilaPrograma`), y no había ningún mapeo a "tres
 *   estilos" -- `estados.js` define SIETE colores, uno por estado, fijos.
 *
 * ALCANCE
 *   Módulo de lógica PURA (sin React, sin Firestore) -- mismo criterio que
 *   `filtros-listado.js`/`estados.js`: se puede testear sin montar ningún
 *   componente. `Programacion.js` y `programacion/ModalDetallePedido.js` lo
 *   importan.
 *
 *   `estiloEstadoDespacho()` -- el mapeo de V2:
 *     - ASIGNADO                       -> 'esperando'  (ámbar, "Esperando
 *       respuesta" es justo la etiqueta que ya trae `ETIQUETA_DESPACHO`).
 *     - ACEPTADO, NOMINADO, ENTREGADO  -> 'confirmada' (verde). El diseño
 *       pide "el resto de los estados vivos posteriores... usa su propia
 *       etiqueta de estados.js, en verde": la ETIQUETA sigue siendo la de
 *       `ETIQUETA_DESPACHO` (Aceptado/Nominado/Entregado), lo que cambia acá
 *       es solo el COLOR del chip.
 *     - PENDIENTE_ASIGNACION           -> 'sinCubrir' (rojo). Es el único
 *       caso que el diseño no contempla explícito: un despacho ya existe
 *       (está "vivo", `entregaSinCubrir()` de `estados.js` da `false`) pero
 *       sin transportista todavía. Se decidió tratarlo como "sin cubrir" --
 *       mismo criterio que ya usa el filtro de transportista de RF-01
 *       (`tieneEntregaSinAsignar`, en `Programacion.js`): un despacho sin
 *       transportista es, en los hechos, algo que todavía no está cubierto
 *       por nadie. Documentado también en el reporte de la tarea.
 *     - RECHAZADO, CANCELADO           -> 'sinCubrir'. No deberían llegar acá
 *       (son "despachos muertos", `estados.js`, y el diseño los pliega bajo
 *       "Ver N anteriores", nunca como una línea de despacho vivo) -- el
 *       mapeo cubre el caso por completitud, no porque se use en la práctica.
 *
 * LIMITACIONES CONOCIDAS
 *   Este modelo de datos no tiene "cantidad sin cubrir" PARCIAL por entrega
 *   (a diferencia de lo que el diseño original parece asumir): una entrega
 *   está cubierta por 0 o más despachos VIVOS, pero cada despacho cubre el
 *   volumen COMPLETO de la entrega (`despacho.volumen = entrega.volumen`,
 *   ver `logica-despachos.js`) -- no hay forma de que una entrega quede
 *   "cubierta a medias". Por eso `contarEntregasSinCubrir()` cuenta entregas
 *   enteras, no volumen parcial, y el modal muestra la fila "Sin cubrir" con
 *   el volumen COMPLETO de la entrega, no una diferencia.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- Programacion` (los tests de este módulo viven en
 *   `Programacion.test.js`, junto con los que ya había de RF-08/Paso 0.2 --
 *   ver el prompt de la tarea, Paso 4).
 * ========================================================================== */

import { DESPACHO, despachoVivo, entregaSinCubrir } from '../../shared/estados';

const DIAS_SEMANA_COMPLETOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES_COMPLETOS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/**
 * "2026-09-28" -> "Lunes 28 de Septiembre del 2026" -- el formato largo que
 * pide el Paso 3 del prompt para la fecha solicitada de cada entrega. Movida
 * tal cual desde `Programacion.js` (`formatearFechaCompleta`, mismo texto
 * exacto que ya producía) -- acá es lógica pura, testeable sin React.
 *
 * @param {string} fechaISO `YYYY-MM-DD`
 * @returns {string}
 */
export function formatearFechaLarga(fechaISO) {
  if (!fechaISO) return '';
  const d = new Date(fechaISO + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return fechaISO;
  const dia = String(d.getDate()).padStart(2, '0');
  return `${DIAS_SEMANA_COMPLETOS[d.getDay()]} ${dia} de ${MESES_COMPLETOS[d.getMonth()]} del ${d.getFullYear()}`;
}

/**
 * Cuántas entregas de un pedido están sin cubrir -- para el chip "N sin
 * cubrir" de la lista (Paso 2) y del modal.
 *
 * @param {Array<{entrega: Object, despachos: Array}>} itemsEntregas la forma
 *   que ya arma `arbol` en `Programacion.js`: una entrada por entrega, con
 *   sus propios despachos (vivos o no).
 * @returns {number}
 */
export function contarEntregasSinCubrir(itemsEntregas) {
  return (itemsEntregas || []).filter(it => entregaSinCubrir(it.entrega, it.despachos)).length;
}

/**
 * El orden del panel "ENTREGAS" del modal: por número, ascendente -- el
 * diseño descarta el chip de prioridad ("No hay prioridad: las entregas se
 * ordenan por número", Paso 3 del prompt). No muta el array de entrada.
 *
 * @param {Array<{entrega: Object, despachos: Array}>} itemsEntregas
 * @returns {Array}
 */
export function ordenarEntregasPorNumero(itemsEntregas) {
  return [...(itemsEntregas || [])].sort((a, b) => (a.entrega.numero || 0) - (b.entrega.numero || 0));
}

/**
 * El estilo visual (V2) de un despacho, a partir de su estado. Ver el
 * encabezado de este archivo para el detalle de cada caso.
 *
 * @param {string} estadoDespacho una de las claves de `DESPACHO` (`estados.js`)
 * @returns {'esperando'|'confirmada'|'sinCubrir'}
 */
export function estiloEstadoDespacho(estadoDespacho) {
  if (estadoDespacho === DESPACHO.ASIGNADO) return 'esperando';
  if ([DESPACHO.ACEPTADO, DESPACHO.NOMINADO, DESPACHO.ENTREGADO].includes(estadoDespacho)) return 'confirmada';
  return 'sinCubrir';
}

/**
 * Separa los despachos de una entrega en vivos (se muestran como una línea
 * cada uno) y no vivos (rechazados/cancelados -- van plegados bajo "Ver N
 * anteriores", Paso 3). Mismo criterio que ya usaba `BloqueEntregaPrograma`
 * antes de este rediseño, ahora en un solo lugar reusable.
 *
 * @param {Array} despachos los de UNA entrega
 * @returns {{vivos: Array, muertos: Array}}
 */
export function separarDespachosPorVida(despachos) {
  const lista = despachos || [];
  return {
    vivos: lista.filter(despachoVivo),
    muertos: lista.filter(d => !despachoVivo(d)),
  };
}
