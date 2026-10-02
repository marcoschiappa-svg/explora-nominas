/* =============================================================================
 * extractores-pedidos.js — v1.2.0 (RF-05)
 * =============================================================================
 *
 * SÍNTOMA
 *   `Ciclo de vida` (RF-05) necesita, para su lista y su detalle, las mismas
 *   dos utilidades chicas que ya vivían DENTRO de `Pedidos.js` desde RF-01:
 *   la próxima fecha pendiente de un array de entregas, y el formato de un
 *   Timestamp de Firestore a fecha/hora legible.
 *
 * CAUSA RAÍZ
 *   Eran funciones de módulo (fuera de cualquier componente) en
 *   `Pedidos.js`, pero no exportadas — nadie más las podía importar.
 *
 * ALCANCE
 *   Se mudan ACÁ, sin cambiar una línea de su implementación, y `Pedidos.js`
 *   pasa a importarlas en vez de declararlas — su comportamiento no cambia y
 *   los tests de RF-01 (`filtros-listado.test.js`, que las ejercita
 *   indirectamente vía `Pedidos.js`) siguen en verde.
 *
 *   Lo que NO se mueve para acá: los "extractores" que arma
 *   `extractoresPedidos` dentro de `Pedidos.js` (el `useMemo` con
 *   `clienteId`, `productoId`, `clienteNombre`...). Esos son closures sobre
 *   `orgsPorId`/`prodsPorId`/`usuariosPorId` — mapas que arma esa pantalla — y
 *   operan sobre un PEDIDO completo (`p => ...`). Los de `CicloVida.js` (ver
 *   ese archivo) operan sobre una fila "entrega" distinta (pedido + entrega +
 *   cliente + producto + etapa actual), con su propio armado de mapas: no son
 *   el mismo objeto con otro nombre, forzarlos a compartir función habría
 *   sido más artificial que compartir las dos utilidades genuinamente puras
 *   de abajo.
 *
 * LIMITACIONES CONOCIDAS
 *   Ninguna — son las mismas dos funciones, con el mismo comportamiento.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test` — todos los 131+ tests existentes en verde, incluidos
 *   los que dependían indirectamente de estas dos funciones. `CI=true npm
 *   run build` sin warnings.
 * ========================================================================== */

/** La fecha solicitada más próxima entre las entregas PENDIENTES de un
 * pedido, o `null` si no hay ninguna. Mismo criterio que usaba
 * `comparadorDe()` antes de RF-01 (ver el encabezado de `Pedidos.js`). */
export function proximaFechaPendiente(entregas) {
  const fechas = (entregas || [])
    .filter(e => e.estado === 'pendiente')
    .map(e => e.fecha_solicitada)
    .filter(Boolean)
    .sort();
  return fechas[0] || null;
}

/** Un Timestamp de Firestore a fecha/hora legible, o `''` si no hay nada —
 * mismo criterio que `formatoFecha()` en `HistorialPedido.js`. */
export function formatoFechaTs(ts) {
  if (!ts || typeof ts.toDate !== 'function') return '';
  return ts.toDate().toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
