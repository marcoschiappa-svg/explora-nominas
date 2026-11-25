/* =============================================================================
 * logica-seguimiento.test.js — v1.2.6 — Traza en vivo y estado del seguimiento
 *
 * Ver la cabecera de `logica-seguimiento.js` y el bloque v1.2.6 de
 * Seguimiento.js. Reproduce los datos de TrackEx 1.1.1 (cada lectura dos
 * veces, a 68 ms) y los formatos de `ts` que llegan de Firestore.
 * ========================================================================== */

import { prepararTraza, resumenTraza, alertaSeguimiento } from './logica-seguimiento';

const T0 = Date.UTC(2026, 10, 24, 17, 0, 0);

/** Doble mínimo de un Timestamp de Firestore. */
function timestamp(ms) {
  return { toMillis: () => ms, toDate: () => new Date(ms) };
}

describe('prepararTraza', () => {
  test('acepta los tres formatos de ts y devuelve ts en ms', () => {
    const traza = prepararTraza([
      { lat: -32.9, lng: -60.6, ts: timestamp(T0) },
      { lat: -32.91, lng: -60.61, ts: new Date(T0 + 30000) },
      { lat: -32.92, lng: -60.62, ts: T0 + 60000 },
    ]);
    expect(traza).toEqual([
      { lat: -32.9, lng: -60.6, ts: T0 },
      { lat: -32.91, lng: -60.61, ts: T0 + 30000 },
      { lat: -32.92, lng: -60.62, ts: T0 + 60000 },
    ]);
  });

  test('colapsa el par duplicado a 68 ms (caso real de la 1.1.1) y no el de 1500 ms', () => {
    const traza = prepararTraza([
      { lat: -32.9, lng: -60.6, ts: timestamp(T0) },
      { lat: -32.9, lng: -60.6, ts: timestamp(T0 + 68) },
      { lat: -32.95, lng: -60.65, ts: timestamp(T0 + 30000) },
      { lat: -32.95, lng: -60.65, ts: timestamp(T0 + 31500) },
    ]);
    expect(traza.map((p) => p.ts)).toEqual([T0, T0 + 30000, T0 + 31500]);
  });

  test('a menos de 1000 ms pero con otras coordenadas se conserva', () => {
    const traza = prepararTraza([
      { lat: -32.9, lng: -60.6, ts: T0 },
      { lat: -32.9001, lng: -60.6, ts: T0 + 200 },
    ]);
    expect(traza).toHaveLength(2);
  });

  test('descarta coordenadas inválidas y ts ilegibles', () => {
    const traza = prepararTraza([
      { lat: NaN, lng: -60.6, ts: T0 },
      { lat: -32.9, lng: Infinity, ts: T0 },
      { lat: '-32.9', lng: -60.6, ts: T0 },
      { lat: 91, lng: -60.6, ts: T0 },
      { lat: -32.9, lng: -181, ts: T0 },
      { lat: -32.9, lng: -60.6, ts: 'ayer' },
      { lat: -32.9, lng: -60.6 },
      null,
      { lat: -32.9, lng: -60.6, ts: T0 },
    ]);
    expect(traza).toEqual([{ lat: -32.9, lng: -60.6, ts: T0 }]);
    expect(prepararTraza(null)).toEqual([]);
  });

  test('ordena una entrada desordenada (y deduplica después de ordenar)', () => {
    const traza = prepararTraza([
      { lat: -32.95, lng: -60.65, ts: T0 + 60000 },
      { lat: -32.9, lng: -60.6, ts: T0 + 50 },
      { lat: -32.92, lng: -60.62, ts: T0 + 30000 },
      { lat: -32.9, lng: -60.6, ts: T0 },
    ]);
    expect(traza.map((p) => p.ts)).toEqual([T0, T0 + 30000, T0 + 60000]);
  });

  test('no muta la entrada', () => {
    const entrada = [
      { lat: -32.95, lng: -60.65, ts: T0 + 60000, precision: 5 },
      { lat: -32.9, lng: -60.6, ts: T0 },
    ];
    const copia = JSON.parse(JSON.stringify(entrada));
    prepararTraza(entrada);
    expect(entrada).toEqual(copia);
  });
});

describe('resumenTraza', () => {
  test('con traza', () => {
    expect(resumenTraza([{ ts: T0 }, { ts: T0 + 1 }, { ts: T0 + 2 }]))
      .toEqual({ cantidad: 3, primero: T0, ultimo: T0 + 2 });
  });

  test('vacía', () => {
    expect(resumenTraza([])).toEqual({ cantidad: 0, primero: null, ultimo: null });
    expect(resumenTraza(undefined)).toEqual({ cantidad: 0, primero: null, ultimo: null });
  });
});

describe('alertaSeguimiento', () => {
  const enViaje = (seguimiento_estado) => ({ estado: 'EN_VIAJE', seguimiento_estado });

  test('limitado → amber', () => {
    expect(alertaSeguimiento(enViaje('limitado'))).toEqual({ tipo: 'amber', msg: 'seguimiento limitado' });
  });

  test('sin_ubicacion → red', () => {
    expect(alertaSeguimiento(enViaje('sin_ubicacion'))).toEqual({ tipo: 'red', msg: 'sin permiso de ubicación' });
  });

  test('completo → null', () => {
    expect(alertaSeguimiento(enViaje('completo'))).toBeNull();
  });

  test('desconocido (app ≤ 1.1.1, sin seguimiento_estado) → null', () => {
    expect(alertaSeguimiento({ estado: 'EN_VIAJE' })).toBeNull();
  });

  test('viaje que no está EN_VIAJE → null aunque tenga estado guardado', () => {
    expect(alertaSeguimiento({ estado: 'RECIBIDO', seguimiento_estado: 'sin_ubicacion' })).toBeNull();
    expect(alertaSeguimiento(null)).toBeNull();
  });
});
