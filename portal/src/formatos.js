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
 *     · `formatoFechaCorta(fechaISO)` — string `YYYY-MM-DD` → `dd/mm/aaaa`
 *       (v1.1.1 de TrackEx, Frente C; ver el bloque de más abajo).
 *   Todas, salvo `formatoFechaCorta`, devuelven `'—'` si el valor es
 *   nulo/no numérico/no es una fecha válida, igual que los helpers que
 *   reemplazan.
 *
 * LIMITACIONES CONOCIDAS
 *   Ninguna — son los mismos criterios de formato que ya tenía la pantalla,
 *   solo centralizados y testeados.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- formatos` — ver `formatos.test.js`.
 *
 * -----------------------------------------------------------------------------
 * TrackEx v1.1.1 — Frente C: FECHA CORTA PARA LOS AVISOS AL CHOFER
 * -----------------------------------------------------------------------------
 *
 *   SÍNTOMA
 *     El aviso de viaje nominado le mostraba al chofer "Carga: 2026-10-28",
 *     la fecha en ISO tal como se guarda.
 *
 *   CAUSA RAÍZ
 *     `fecha_carga` se guarda como string `YYYY-MM-DD` (ver
 *     MODELO_DATOS_TOBE.md) y el aviso lo interpolaba sin formatear. No había
 *     un formateador para ese formato: `formatoFechaLarga` hace `new Date(...)`
 *     y, para un string `YYYY-MM-DD`, JavaScript lo interpreta como medianoche
 *     UTC, que en Argentina (UTC-3) es el día anterior a las 21:00.
 *
 *   ALCANCE
 *     `formatoFechaCorta(fechaISO)` parsea el string con una expresión regular,
 *     SIN crear un `Date`, y devuelve `dd/mm/aaaa`. La usan los avisos al
 *     chofer de `logica-transportista.js` (nominar), `logica-despachos.js`
 *     (cancelar) y `logica-pedidos.js` (cambio de destino).
 *     A diferencia del resto del archivo devuelve `''` y no `'—'` cuando no hay
 *     fecha: quien la usa omite el tramo de texto entero ("Carga: ...") en vez
 *     de mostrar un guion suelto en el cuerpo de una notificación.
 *
 *   LIMITACIONES CONOCIDAS
 *     Valida solo el rango del mes (01–12) y del día (01–31); no detecta fechas
 *     imposibles como 2026-02-31. Alcanza porque `fecha_carga` sale de un
 *     selector de fecha, no de texto libre.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- formatos` (describe `formatoFechaCorta`). A mano:
 *     nominar un despacho con fecha de carga 28/10/2026 y mirar la
 *     notificación del chofer: "Carga: 28/10/2026".
 * ========================================================================== */

const FORMATO_MONEDA = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const FORMATO_ENTERO = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });

/**
 * Patrón de `fecha_carga`: `YYYY-MM-DD`, con ceros a la izquierda. Grupos:
 * año, mes, día.
 */
const PATRON_FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

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

/**
 * Convierte una fecha `YYYY-MM-DD` (formato de `fecha_carga`) en `dd/mm/aaaa`.
 *
 * NO crea un `Date`, a propósito: `new Date('2026-10-28')` es medianoche UTC y
 * en Argentina (UTC-3) eso cae el día 27 a las 21:00, así que formatear con
 * `toLocaleDateString` mostraría una fecha corrida un día. Con la expresión
 * regular se reordenan los textos y no hay zona horaria de por medio.
 *
 * DIFERENCIA CON LAS DEMÁS FUNCIONES DE ESTE ARCHIVO: devuelve `''`, no `'—'`,
 * cuando el valor no sirve. Quien la usa (los avisos al chofer) omite el tramo
 * de texto entero si no hay fecha; un guion suelto en una notificación push
 * se leería como un dato faltante, no como la ausencia de un dato.
 *
 * @param {*} fechaISO Normalmente un string `YYYY-MM-DD`; cualquier otra cosa
 *   (null, undefined, otro formato, un Timestamp) da `''`.
 * @returns {string} `dd/mm/aaaa`, o `''` si no es un string con ese formato, el
 *   mes no está entre 01 y 12 o el día no está entre 01 y 31.
 */
export function formatoFechaCorta(fechaISO) {
  if (typeof fechaISO !== 'string') return '';
  const partes = PATRON_FECHA_ISO.exec(fechaISO);
  if (!partes) return '';
  const [, anio, mes, dia] = partes;
  if (Number(mes) < 1 || Number(mes) > 12) return '';
  if (Number(dia) < 1 || Number(dia) > 31) return '';
  return `${dia}/${mes}/${anio}`;
}
