/* =============================================================================
 * formatos.test.js — v1.2.0 (rediseño NuevoTarifario)
 * Ver el encabezado de `formatos.js` para SÍNTOMA/CAUSA RAÍZ/ALCANCE/
 * LIMITACIONES/CÓMO SE VERIFICA.
 * ========================================================================== */

import { formatoMoneda, formatoKm, formatoPorcentaje, formatoFechaLarga, formatoFechaCorta } from './formatos';

describe('formatoMoneda', () => {
  test('formatea con símbolo de moneda y separador de miles', () => {
    expect(formatoMoneda(9636.69)).toMatch(/^\$\s?9\.637$/);
    expect(formatoMoneda(1200000)).toMatch(/^\$\s?1\.200\.000$/);
  });
  test('redondea al entero más cercano', () => {
    expect(formatoMoneda(100.4)).toMatch(/^\$\s?100$/);
    expect(formatoMoneda(100.6)).toMatch(/^\$\s?101$/);
  });
  test('sin dato devuelve el guion', () => {
    expect(formatoMoneda(null)).toBe('—');
    expect(formatoMoneda(undefined)).toBe('—');
    expect(formatoMoneda(NaN)).toBe('—');
  });
});

describe('formatoKm', () => {
  test('entero con separador de miles', () => {
    expect(formatoKm(1234)).toBe('1.234');
    expect(formatoKm(29)).toBe('29');
  });
  test('sin dato devuelve el guion', () => {
    expect(formatoKm(null)).toBe('—');
    expect(formatoKm(NaN)).toBe('—');
  });
});

describe('formatoPorcentaje', () => {
  test('positivo lleva signo y 2 decimales', () => {
    expect(formatoPorcentaje(5.2)).toBe('+5.20%');
  });
  test('negativo conserva el signo propio', () => {
    expect(formatoPorcentaje(-3.456)).toBe('-3.46%');
  });
  test('cero lleva signo +', () => {
    expect(formatoPorcentaje(0)).toBe('+0.00%');
  });
  test('sin dato devuelve el guion', () => {
    expect(formatoPorcentaje(null)).toBe('—');
    expect(formatoPorcentaje(NaN)).toBe('—');
  });
});

describe('formatoFechaLarga', () => {
  test('Date nativo', () => {
    const texto = formatoFechaLarga(new Date('2026-03-10T12:00:00'));
    expect(texto).toMatch(/2026/);
    expect(texto).toMatch(/marzo/);
  });
  test('Timestamp de Firestore (con toDate)', () => {
    const tsFalso = { toDate: () => new Date('2026-01-05T00:00:00') };
    const texto = formatoFechaLarga(tsFalso);
    expect(texto).toMatch(/enero/);
  });
  test('string ISO', () => {
    const texto = formatoFechaLarga('2026-07-20');
    expect(texto).toMatch(/julio/);
  });
  test('sin dato o inválido devuelve el guion', () => {
    expect(formatoFechaLarga(null)).toBe('—');
    expect(formatoFechaLarga('no es una fecha')).toBe('—');
  });
});

/* TrackEx v1.1.1 — Frente C: fecha corta para los avisos al chofer. */
describe('formatoFechaCorta', () => {
  test('YYYY-MM-DD → dd/mm/aaaa', () => {
    expect(formatoFechaCorta('2026-10-28')).toBe('28/10/2026');
  });
  test('conserva los ceros a la izquierda', () => {
    expect(formatoFechaCorta('2026-01-05')).toBe('05/01/2026');
  });
  test('vacío, null o undefined devuelven cadena vacía (no el guion)', () => {
    expect(formatoFechaCorta('')).toBe('');
    expect(formatoFechaCorta(null)).toBe('');
    expect(formatoFechaCorta(undefined)).toBe('');
  });
  test('otro formato devuelve cadena vacía', () => {
    expect(formatoFechaCorta('28/10/2026')).toBe('');
  });
  test('mes fuera de 01–12 devuelve cadena vacía', () => {
    expect(formatoFechaCorta('2026-13-01')).toBe('');
  });
  test('día fuera de 01–31 devuelve cadena vacía', () => {
    expect(formatoFechaCorta('2026-10-32')).toBe('');
  });
  test('un Timestamp (no string) devuelve cadena vacía', () => {
    expect(formatoFechaCorta({ toDate: () => new Date() })).toBe('');
  });
});
