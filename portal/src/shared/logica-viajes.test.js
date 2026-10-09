/* =============================================================================
 * logica-viajes.test.js — Tests de validarCierreManual (Portal Explora)
 * =============================================================================
 *
 * v1.2.0 (RF-02) — Ver el encabezado de `validarCierreManual()`, en
 * `logica-viajes.js`, para el porqué de cada chequeo. Corre con el Jest que
 * ya trae Create React App (`CI=true npm test -- logica-viajes`).
 *
 * Cubre, como mínimo exigido por el prompt de la tarea: futuro con y sin
 * tolerancia, borde de fecha de carga menos un día, con y sin `inicio_ts`.
 * ========================================================================== */

import { validarCierreManual } from './logica-viajes';

const AHORA = new Date('2026-09-20T12:00:00');

describe('validarCierreManual', () => {
  test('sin fecha de fin -- pide elegirla', () => {
    const problemas = validarCierreManual({ finTs: null, fechaCarga: null, inicioTs: null, ahora: AHORA });
    expect(problemas.length).toBeGreaterThan(0);
  });

  test('futuro fuera de la tolerancia de 5 minutos -- rechaza', () => {
    const finTs = new Date(AHORA.getTime() + 10 * 60 * 1000);
    const problemas = validarCierreManual({ finTs, fechaCarga: null, inicioTs: null, ahora: AHORA });
    expect(problemas.some(p => /futura/.test(p))).toBe(true);
  });

  test('futuro dentro de la tolerancia de 5 minutos -- no rechaza por eso', () => {
    const finTs = new Date(AHORA.getTime() + 3 * 60 * 1000);
    const problemas = validarCierreManual({ finTs, fechaCarga: null, inicioTs: null, ahora: AHORA });
    expect(problemas.some(p => /futura/.test(p))).toBe(false);
  });

  test('futuro justo en el borde de la tolerancia (5 min exactos) -- no rechaza', () => {
    const finTs = new Date(AHORA.getTime() + 5 * 60 * 1000);
    const problemas = validarCierreManual({ finTs, fechaCarga: null, inicioTs: null, ahora: AHORA });
    expect(problemas.some(p => /futura/.test(p))).toBe(false);
  });

  test('fin exactamente un día antes de la fecha de carga -- borde válido', () => {
    const finTs = new Date('2026-09-13T10:00:00');
    const problemas = validarCierreManual({
      finTs, fechaCarga: '2026-09-14', inicioTs: null, ahora: new Date('2026-09-20T00:00:00'),
    });
    expect(problemas.some(p => /anterior/.test(p))).toBe(false);
  });

  test('fin dos días antes de la fecha de carga -- rechaza', () => {
    const finTs = new Date('2026-09-12T10:00:00');
    const problemas = validarCierreManual({
      finTs, fechaCarga: '2026-09-14', inicioTs: null, ahora: new Date('2026-09-20T00:00:00'),
    });
    expect(problemas.some(p => /anterior/.test(p))).toBe(true);
  });

  test('sin fecha de carga -- no valida ese chequeo', () => {
    const finTs = new Date('2026-09-01T10:00:00');
    const problemas = validarCierreManual({
      finTs, fechaCarga: null, inicioTs: null, ahora: new Date('2026-09-20T00:00:00'),
    });
    expect(problemas).toEqual([]);
  });

  test('sin inicio_ts -- un viaje cerrado desde RECIBIDO no exige ese orden', () => {
    const finTs = new Date('2026-09-19T08:00:00');
    const problemas = validarCierreManual({
      finTs, fechaCarga: '2026-09-19', inicioTs: null, ahora: new Date('2026-09-20T00:00:00'),
    });
    expect(problemas).toEqual([]);
  });

  test('con inicio_ts, fin anterior o igual al inicio -- rechaza', () => {
    const inicioTs = new Date('2026-09-19T10:00:00');
    const finTs = new Date('2026-09-19T09:00:00');
    const problemas = validarCierreManual({
      finTs, fechaCarga: '2026-09-19', inicioTs, ahora: new Date('2026-09-20T00:00:00'),
    });
    expect(problemas.some(p => /posterior al inicio/.test(p))).toBe(true);
  });

  test('con inicio_ts (Timestamp con .toDate, como llega de Firestore), fin posterior -- ok', () => {
    const inicioTs = { toDate: () => new Date('2026-09-19T09:00:00') };
    const finTs = new Date('2026-09-19T10:00:00');
    const problemas = validarCierreManual({
      finTs, fechaCarga: '2026-09-19', inicioTs, ahora: new Date('2026-09-20T00:00:00'),
    });
    expect(problemas).toEqual([]);
  });
});
