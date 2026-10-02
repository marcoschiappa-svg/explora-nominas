/* =============================================================================
 * formatos.js — v1.2.0 (rediseño NuevoTarifario)
 * =============================================================================
 *
 * SÍNTOMA
 *   `NuevoTarifario.js` tenía sus propios helpers de formato de moneda
 *   (`fmt`) y porcentaje (`fp`), ad-hoc y sin test, y el rediseño necesita
 *   sumar formato de km y de fecha larga con el mismo criterio en varios
 *   componentes nuevos (filas, tabla, modales, historial).
 *
 * CAUSA RAÍZ
 *   No existía un módulo de formato puro y compartido para esta pantalla —
 *   cada función vivía inline dentro de `NuevoTarifario.js`.
 *
 * ALCANCE
 *   Lógica PURA, sin React y sin Firestore:
 *     · `formatoMoneda(n)` — `Intl.NumberFormat('es-AR', { style: 'currency',
 *       currency: 'ARS' })`, redondeado (sin decimales, igual que el `fmt`
 *       que reemplaza).
 *     · `formatoKm(n)` — entero con separador de miles (`es-AR`).
 *     · `formatoPorcentaje(n)` — con signo y 2 decimales.
 *     · `formatoFechaLarga(valor)` — Timestamp de Firestore, Date o string
 *       ISO → fecha larga `es-AR` (`weekday: 'long', day: 'numeric', month:
 *       'long'`), mismo patrón que ya usa `Pedidos.js`.
 *   Todas devuelven `'—'` si el valor es nulo/no numérico/no es una fecha
 *   válida, igual que los helpers que reemplazan.
 *
 * LIMITACIONES CONOCIDAS
 *   Ninguna — son los mismos criterios de formato que ya tenía la pantalla,
 *   solo centralizados y testeados.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- formatos` — ver `formatos.test.js`.
 * ========================================================================== */

const FORMATO_MONEDA = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const FORMATO_ENTERO = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

export function formatoMoneda(n) {
  if (n == null || isNaN(n)) return '—';
  return FORMATO_MONEDA.format(Math.round(Number(n)));
}

export function formatoKm(n) {
  if (n == null || isNaN(n)) return '—';
  return FORMATO_ENTERO.format(Math.round(Number(n)));
}

export function formatoPorcentaje(n) {
  if (n == null || isNaN(n)) return '—';
  const v = Number(n);
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

export function formatoFechaLarga(valor) {
  if (!valor) return '—';
  const d = typeof valor.toDate === 'function' ? valor.toDate()
    : valor instanceof Date ? valor
    : new Date(valor);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
