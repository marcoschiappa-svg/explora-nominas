/* =============================================================================
 * progreso-pedido.test.js — v1.2.0 (rediseño Pedidos)
 * ========================================================================== */

import { progresoPedido } from './progreso-pedido';

describe('progresoPedido', () => {
  test('sin entregas: 0%, done 0, total 0', () => {
    expect(progresoPedido([])).toEqual({ porcentaje: 0, done: 0, total: 0 });
    expect(progresoPedido(null)).toEqual({ porcentaje: 0, done: 0, total: 0 });
    expect(progresoPedido(undefined)).toEqual({ porcentaje: 0, done: 0, total: 0 });
  });

  test('todas sin cubrir: 0%', () => {
    const entregas = [
      { estado: 'pendiente', volumen: 10 },
      { estado: 'pendiente', volumen: 20 },
    ];
    expect(progresoPedido(entregas)).toEqual({ porcentaje: 0, done: 0, total: 2 });
  });

  test('mezcla de etapas, ponderada por cantidad', () => {
    // 10tn pendiente (0), 10tn programada (40), 10tn cumplida (100)
    // -> (10*0 + 10*40 + 10*100) / 30 = 1400/30 = 46.67 -> 47
    const entregas = [
      { estado: 'pendiente', volumen: 10 },
      { estado: 'programada', volumen: 10 },
      { estado: 'cumplida', volumen: 10 },
    ];
    const r = progresoPedido(entregas);
    expect(r.porcentaje).toBe(47);
    expect(r.done).toBe(1);
    expect(r.total).toBe(3);
  });

  test('entregas suspendidas quedan afuera del cálculo', () => {
    const entregas = [
      { estado: 'cumplida', volumen: 10 },
      { estado: 'suspendida', volumen: 999 },
    ];
    // Si la suspendida contara, el resultado sería otro (y total sería 2).
    expect(progresoPedido(entregas)).toEqual({ porcentaje: 100, done: 1, total: 1 });
  });

  test('ponderación por cantidad: una entrega grande pesa más que una chica', () => {
    // 90tn cumplida (100), 10tn pendiente (0) -> (90*100 + 10*0)/100 = 90
    const entregas = [
      { estado: 'cumplida', volumen: 90 },
      { estado: 'pendiente', volumen: 10 },
    ];
    expect(progresoPedido(entregas).porcentaje).toBe(90);

    // Invertido: 10tn cumplida, 90tn pendiente -> 10
    const invertido = [
      { estado: 'cumplida', volumen: 10 },
      { estado: 'pendiente', volumen: 90 },
    ];
    expect(progresoPedido(invertido).porcentaje).toBe(10);
  });

  test('sin volumen cargado en ninguna entrega: promedio simple', () => {
    const entregas = [
      { estado: 'pendiente', volumen: 0 },
      { estado: 'cumplida', volumen: 0 },
    ];
    // (0 + 100) / 2 = 50
    expect(progresoPedido(entregas)).toEqual({ porcentaje: 50, done: 1, total: 2 });
  });

  test('done/total cuenta cumplidas sobre no suspendidas', () => {
    const entregas = [
      { estado: 'cumplida', volumen: 10 },
      { estado: 'cumplida', volumen: 10 },
      { estado: 'programada', volumen: 10 },
      { estado: 'suspendida', volumen: 10 },
    ];
    const r = progresoPedido(entregas);
    expect(r.done).toBe(2);
    expect(r.total).toBe(3);
  });
});
