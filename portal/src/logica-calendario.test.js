/* =============================================================================
 * logica-calendario.test.js — v1.2.0 (RF-10)
 * Ver el encabezado de `logica-calendario.js` para SÍNTOMA/CAUSA
 * RAÍZ/ALCANCE/LIMITACIONES/CÓMO SE VERIFICA.
 * ========================================================================== */

import { tipoDelDia, evaluarFechaCarga, evaluarFechaEntrega } from './logica-calendario';

function diaDeLaSemana(fechaISO) {
  return new Date(`${fechaISO}T00:00:00`).getDay();
}

describe('tipoDelDia — precedencia', () => {
  test('un día explícito ACTIVO gana sobre la regla semanal', () => {
    const fecha = '2026-07-09';
    const dow = diaDeLaSemana(fecha);
    const dias = new Map([[fecha, { tipo: 'sin_operacion', motivo: 'Feriado 9 de julio', estado: 'activo' }]]);
    const reglas = { dias: { [String(dow)]: 'sin_despacho' } };

    expect(tipoDelDia(fecha, dias, reglas)).toBe('sin_operacion');
  });

  test('un día explícito INACTIVO no anula la regla semanal', () => {
    const fecha = '2026-07-05';
    const dow = diaDeLaSemana(fecha);
    const dias = new Map([[fecha, { tipo: 'sin_operacion', motivo: 'Ya no aplica', estado: 'inactivo' }]]);
    const reglas = { dias: { [String(dow)]: 'sin_operacion' } };

    expect(tipoDelDia(fecha, dias, reglas)).toBe('sin_operacion');
  });

  test('un día explícito INACTIVO sin regla semanal para ese día queda sin marcar', () => {
    const fecha = '2026-07-06';
    const dow = diaDeLaSemana(fecha);
    const dias = new Map([[fecha, { tipo: 'sin_despacho', motivo: 'x', estado: 'inactivo' }]]);
    const reglas = { dias: { [String((dow + 1) % 7)]: 'sin_operacion' } };

    expect(tipoDelDia(fecha, dias, reglas)).toBeNull();
  });

  test('sin día explícito y sin regla, null', () => {
    expect(tipoDelDia('2026-07-06', new Map(), null)).toBeNull();
    expect(tipoDelDia('2026-07-06', new Map(), { dias: {} })).toBeNull();
  });

  test('acepta un objeto plano además de un Map (forma de leerCalendario())', () => {
    const fecha = '2026-08-01';
    const dias = { [fecha]: { tipo: 'sin_operacion', motivo: 'Parada de planta', estado: 'activo' } };
    expect(tipoDelDia(fecha, dias, null)).toBe('sin_operacion');
  });
});

describe('tipoDelDia — bordes de mes y de año', () => {
  test('último día de un mes con regla semanal', () => {
    const fecha = '2026-01-31';
    const dow = diaDeLaSemana(fecha);
    const reglas = { dias: { [String(dow)]: 'sin_operacion' } };
    expect(tipoDelDia(fecha, new Map(), reglas)).toBe('sin_operacion');
  });

  test('primer día del mes siguiente no hereda nada del anterior', () => {
    const fecha = '2026-02-01';
    const dow = diaDeLaSemana(fecha);
    const otroDow = (dow + 1) % 7;
    const reglas = { dias: { [String(otroDow)]: 'sin_operacion' } };
    expect(tipoDelDia(fecha, new Map(), reglas)).toBeNull();
  });

  test('31 de diciembre con día explícito activo', () => {
    const dias = new Map([['2026-12-31', { tipo: 'sin_despacho', motivo: 'Fin de año', estado: 'activo' }]]);
    expect(tipoDelDia('2026-12-31', dias, null)).toBe('sin_despacho');
  });

  test('1 de enero del año siguiente, con regla semanal del mismo día de semana', () => {
    const fecha = '2027-01-01';
    const dow = diaDeLaSemana(fecha);
    const reglas = { dias: { [String(dow)]: 'sin_operacion' } };
    expect(tipoDelDia(fecha, new Map(), reglas)).toBe('sin_operacion');
    // El día anterior (31/12/2026), sin marca propia, no queda afectado.
    expect(tipoDelDia('2026-12-31', new Map(), reglas)).toBe(
      diaDeLaSemana('2026-12-31') === dow ? 'sin_operacion' : null
    );
  });
});

describe('evaluarFechaCarga', () => {
  const fecha = '2026-09-10';

  test('sin_operacion bloquea "Entrega al cliente"', () => {
    const dias = new Map([[fecha, { tipo: 'sin_operacion', motivo: 'Parada', estado: 'activo' }]]);
    const r = evaluarFechaCarga(fecha, 'Entrega al cliente', dias, null);
    expect(r.bloquea).toBe(true);
    expect(r.motivo).toMatch(/Sin operación/);
  });

  test('sin_operacion bloquea "Entrega en planta"', () => {
    const dias = new Map([[fecha, { tipo: 'sin_operacion', motivo: 'Parada', estado: 'activo' }]]);
    const r = evaluarFechaCarga(fecha, 'Entrega en planta', dias, null);
    expect(r.bloquea).toBe(true);
  });

  test('sin_operacion bloquea "Retiro de Proveedores"', () => {
    const dias = new Map([[fecha, { tipo: 'sin_operacion', motivo: 'Parada', estado: 'activo' }]]);
    const r = evaluarFechaCarga(fecha, 'Retiro de Proveedores', dias, null);
    expect(r.bloquea).toBe(true);
  });

  test('sin_despacho bloquea "Entrega al cliente"', () => {
    const dias = new Map([[fecha, { tipo: 'sin_despacho', motivo: 'Feriado', estado: 'activo' }]]);
    const r = evaluarFechaCarga(fecha, 'Entrega al cliente', dias, null);
    expect(r.bloquea).toBe(true);
    expect(r.motivo).toMatch(/Sin despacho/);
  });

  test('sin_despacho NO bloquea "Entrega en planta"', () => {
    const dias = new Map([[fecha, { tipo: 'sin_despacho', motivo: 'Feriado', estado: 'activo' }]]);
    const r = evaluarFechaCarga(fecha, 'Entrega en planta', dias, null);
    expect(r.bloquea).toBe(false);
    expect(r.motivo).toBeNull();
  });

  test('sin_despacho NO bloquea "Retiro de Proveedores"', () => {
    const dias = new Map([[fecha, { tipo: 'sin_despacho', motivo: 'Feriado', estado: 'activo' }]]);
    const r = evaluarFechaCarga(fecha, 'Retiro de Proveedores', dias, null);
    expect(r.bloquea).toBe(false);
  });

  test('día sin marcar no bloquea nada', () => {
    expect(evaluarFechaCarga(fecha, 'Entrega al cliente', new Map(), null)).toEqual({ bloquea: false, motivo: null });
  });
});

describe('evaluarFechaEntrega', () => {
  const fecha = '2026-09-10';

  test('sin_operacion advierte, no bloquea (no tiene "bloquea" en el resultado)', () => {
    const dias = new Map([[fecha, { tipo: 'sin_operacion', motivo: 'Parada', estado: 'activo' }]]);
    const r = evaluarFechaEntrega(fecha, dias, null);
    expect(r.advierte).toBe(true);
    expect(r.motivo).toMatch(/Sin operación/);
    expect(r.bloquea).toBeUndefined();
  });

  test('sin_despacho también advierte', () => {
    const dias = new Map([[fecha, { tipo: 'sin_despacho', motivo: 'Feriado', estado: 'activo' }]]);
    const r = evaluarFechaEntrega(fecha, dias, null);
    expect(r.advierte).toBe(true);
  });

  test('día sin marcar no advierte', () => {
    expect(evaluarFechaEntrega(fecha, new Map(), null)).toEqual({ advierte: false, motivo: null });
  });

  test('día cubierto solo por la regla semanal también advierte', () => {
    const dow = diaDeLaSemana(fecha);
    const reglas = { dias: { [String(dow)]: 'sin_operacion' } };
    const r = evaluarFechaEntrega(fecha, new Map(), reglas);
    expect(r.advierte).toBe(true);
    expect(r.motivo).toMatch(/Regla semanal/);
  });
});
