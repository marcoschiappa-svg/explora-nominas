/* =============================================================================
 * seguimiento-encuadre.test.js — v1.2.6 — Mapa de Seguimiento
 * Ver el encabezado "v1.2.6 — Mapa de Seguimiento" de `seguimiento-encuadre.js`
 * para SÍNTOMA/CAUSA RAÍZ/ALCANCE/LIMITACIONES CONOCIDAS/CÓMO SE VERIFICA.
 * ========================================================================== */

import { limitesSimetricos, CENTRO_ROSARIO, REGION_OBJETIVO } from './seguimiento-encuadre';

const cerca = (a, b) => expect(a).toBeCloseTo(b, 6);

describe('limitesSimetricos (v1.2.6 (2))', () => {
  test('Rosario + región objetivo: Córdoba manda en longitud y Buenos Aires en latitud', () => {
    const [[s, o], [n, e]] = limitesSimetricos(CENTRO_ROSARIO, REGION_OBJETIVO);
    // dLat = max(|-32.95 - -34.75|, |-31.25 - -32.95|) = max(1.8, 1.7) = 1.8
    cerca(s, -34.75); cerca(n, -31.15);
    // dLng = max(|-60.65 - -64.35|, |-58.2 - -60.65|) = max(3.7, 2.45) = 3.7
    cerca(o, -64.35); cerca(e, -56.95);
  });

  test('queda centrado en el centro dado', () => {
    const [[s, o], [n, e]] = limitesSimetricos(CENTRO_ROSARIO, REGION_OBJETIVO);
    cerca((s + n) / 2, CENTRO_ROSARIO[0]);
    cerca((o + e) / 2, CENTRO_ROSARIO[1]);
  });

  test('contiene la región entera', () => {
    const [[s, o], [n, e]] = limitesSimetricos(CENTRO_ROSARIO, REGION_OBJETIVO);
    const [[rs, ro], [rn, re]] = REGION_OBJETIVO;
    expect(s).toBeLessThanOrEqual(rs);
    expect(o).toBeLessThanOrEqual(ro);
    expect(n).toBeGreaterThanOrEqual(rn);
    expect(e).toBeGreaterThanOrEqual(re);
  });

  test('si el centro coincide con el centro de la región, devuelve la región', () => {
    const r = limitesSimetricos([0, 0], [[-1, -2], [1, 2]]);
    expect(r).toEqual([[-1, -2], [1, 2]]);
  });
});
