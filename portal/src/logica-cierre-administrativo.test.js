/* =============================================================================
 * logica-cierre-administrativo.test.js — v1.2.3
 * Ver el encabezado de `logica-cierre-administrativo.js` para SÍNTOMA/CAUSA
 * RAÍZ/ALCANCE/LIMITACIONES/CÓMO SE VERIFICA.
 * ========================================================================== */

import * as estados from './shared/estados';

const cierre = require('./logica-cierre-administrativo');
const { armarCierreAdministrativo, evaluarCorte, estadoPedido, DESPACHO, VIAJE, ENTREGA } = cierre;

const AHORA = new Date('2026-10-21T15:00:00Z');
const USUARIO = { uid: 'script:test', nombre: 'Test' };
const MOTIVO = 'Cierre de prueba';

function pedidoBase(o = {}) {
  return {
    id: 'p1', numero: 'PED-2026-000001', suspendido: false,
    entregas_total: 4, entregas_cubiertas: 2, entregas_cumplidas: 1,
    ...o,
  };
}
const entrega = (id, numero, estado, o = {}) => ({ id, pedido_id: 'p1', numero, estado, fecha_solicitada: '2026-09-01', ...o });
const despacho = (id, entrega_id, estado, o = {}) => ({ id, pedido_id: 'p1', entrega_id, numero: id.toUpperCase(), estado, fecha_carga: '2026-09-01', ...o });
const viaje = (id, despacho_id, estado, o = {}) => ({ id, despacho_id, pedido_id: 'p1', estado, ...o });

function cerrar(args) {
  return armarCierreAdministrativo({ motivo: MOTIVO, ahora: AHORA, usuario: USUARIO, viajes: [], ...args });
}

/** Aplica el resultado sobre el árbol, como lo hace el script. */
function aplicar(base, cambios) {
  return base.map(x => {
    const c = cambios.find(y => y.id === x.id);
    return c ? { ...x, ...c.campos } : x;
  });
}

describe('armarCierreAdministrativo — pedido con mezcla de entregas', () => {
  const entregas = [
    entrega('e1', 1, ENTREGA.CUMPLIDA),
    entrega('e2', 2, ENTREGA.PROGRAMADA),
    entrega('e3', 3, ENTREGA.PENDIENTE),
    entrega('e4', 4, ENTREGA.SUSPENDIDA),
  ];
  const despachos = [
    despacho('d1', 'e1', DESPACHO.ENTREGADO),
    despacho('d2', 'e2', DESPACHO.ASIGNADO),
  ];
  const pedido = pedidoBase({ entregas_total: 3, entregas_cubiertas: 2, entregas_cumplidas: 1 });
  const r = cerrar({ pedido, entregas, despachos });

  test('aplica y deja el pedido cumplido', () => {
    expect(r.aplica).toBe(true);
    expect(r.razonNoAplica).toBeNull();
    expect(estadoPedido({ ...pedido, ...r.pedido })).toBe('cumplido');
  });

  test('los contadores se recuentan sin contar la suspendida', () => {
    expect(r.pedido).toMatchObject({
      entregas_total: 3, entregas_cubiertas: 3, entregas_cumplidas: 3,
      cierre_administrativo: true, cierre_motivo: MOTIVO, cierre_ts: AHORA, actualizado_en: AHORA,
    });
  });

  test('solo cambian las entregas pendientes o programadas; la suspendida y la cumplida no', () => {
    expect(r.entregas.map(e => e.id).sort()).toEqual(['e2', 'e3']);
    r.entregas.forEach(e => expect(e.campos).toEqual({
      estado: 'cumplida', cierre_administrativo: true, actualizado_en: AHORA,
    }));
  });

  test('el despacho ENTREGADO no se toca y el ASIGNADO pasa a ENTREGADO con la marca de cierre', () => {
    expect(r.despachos).toHaveLength(1);
    expect(r.despachos[0]).toEqual({
      id: 'd2',
      campos: {
        estado: 'ENTREGADO', estado_ts: AHORA, cierre_administrativo: true, cierre_motivo: MOTIVO, actualizado_en: AHORA,
      },
    });
  });

  test('historial: UN registro con el formato de armarHistorial()', () => {
    expect(r.historial).toHaveLength(1);
    const h = r.historial[0];
    expect(h).toMatchObject({
      entidad_tipo: 'pedido', entidad_id: 'p1', pedido_id: 'p1',
      accion: 'cierre_administrativo', razon: MOTIVO, derivado: false,
      usuario_uid: 'script:test', usuario_nombre: 'Test', ts: AHORA,
    });
    // Solo se listan los contadores que cambiaron (`entregas_total` ya valía 3).
    expect(h.campos_modificados).toEqual(['entregas_cubiertas', 'entregas_cumplidas', 'cierre_administrativo', 'cierre_motivo']);
    expect(h.antes).toMatchObject({ entregas_cubiertas: 2, entregas_cumplidas: 1 });
    expect(h.despues).toMatchObject({ entregas_cubiertas: 3, entregas_cumplidas: 3 });
    expect(h.despues.resumen).toEqual({
      viajes_finalizados: 0, despachos_entregados: 1, entregas_cumplidas_por_cierre: 2,
    });
  });
});

describe('armarCierreAdministrativo — viajes y despachos nominados', () => {
  const entregas = [entrega('e1', 1, ENTREGA.PROGRAMADA), entrega('e2', 2, ENTREGA.PROGRAMADA)];
  const despachos = [
    despacho('d1', 'e1', DESPACHO.NOMINADO, { viaje_id: 'v1' }),
    despacho('d2', 'e2', DESPACHO.NOMINADO, { viaje_id: 'v2' }),
  ];
  const viajes = [
    viaje('v1', 'd1', VIAJE.EN_VIAJE, { inicio_ts: new Date('2026-09-01T10:00:00Z') }),
    viaje('v2', 'd2', VIAJE.RECIBIDO),
  ];
  const pedido = pedidoBase({ entregas_total: 2, entregas_cubiertas: 2, entregas_cumplidas: 0 });
  const r = cerrar({ pedido, entregas, despachos, viajes });

  test('ambos viajes quedan FINALIZADO como cierre manual, con fin_ts null y cierre_administrativo', () => {
    expect(r.viajes.map(v => v.id).sort()).toEqual(['v1', 'v2']);
    r.viajes.forEach(v => expect(v.campos).toEqual({
      estado: 'FINALIZADO', estado_ts: AHORA, fin_ts: null, cerrado_por: 'manual',
      cierre_motivo: MOTIVO, cierre_administrativo: true, actualizado_en: AHORA,
    }));
  });

  test('los dos despachos pasan a ENTREGADO', () => {
    expect(r.despachos.map(d => [d.id, d.campos.estado]).sort()).toEqual([['d1', 'ENTREGADO'], ['d2', 'ENTREGADO']]);
    r.despachos.forEach(d => expect(d.campos.estado_ts).toBe(AHORA));
  });

  test('estadoPedido() da cumplido', () => {
    expect(estadoPedido({ ...pedido, ...r.pedido })).toBe('cumplido');
    expect(r.historial[0].despues.resumen).toMatchObject({ viajes_finalizados: 2, despachos_entregados: 2 });
  });

  test('un viaje ya FINALIZADO no se toca, pero el despacho nominado pasa a ENTREGADO', () => {
    const r2 = cerrar({
      pedido, entregas, despachos,
      viajes: [viaje('v1', 'd1', VIAJE.FINALIZADO), viaje('v2', 'd2', VIAJE.RECIBIDO)],
    });
    expect(r2.viajes.map(v => v.id)).toEqual(['v2']);
    expect(r2.despachos).toHaveLength(2);
  });
});

describe('armarCierreAdministrativo — despachos sin viaje', () => {
  const entregas = [
    entrega('e1', 1, ENTREGA.PROGRAMADA), entrega('e2', 2, ENTREGA.PROGRAMADA),
    entrega('e3', 3, ENTREGA.PROGRAMADA), entrega('e4', 4, ENTREGA.PENDIENTE),
  ];
  const despachos = [
    despacho('d1', 'e1', DESPACHO.ASIGNADO),
    despacho('d2', 'e2', DESPACHO.ACEPTADO),
    despacho('d3', 'e3', DESPACHO.NOMINADO),            // NOMINADO sin viaje
    despacho('d4', 'e4', DESPACHO.PENDIENTE_ASIGNACION),
  ];
  const pedido = pedidoBase({ entregas_total: 4, entregas_cubiertas: 3, entregas_cumplidas: 0 });
  const r = cerrar({ pedido, entregas, despachos });

  test('ASIGNADO, ACEPTADO, PENDIENTE_ASIGNACION y NOMINADO sin viaje van a ENTREGADO, sin crear viajes', () => {
    expect(r.despachos).toHaveLength(4);
    r.despachos.forEach(d => {
      expect(d.campos).toMatchObject({
        estado: 'ENTREGADO', estado_ts: AHORA, cierre_administrativo: true, cierre_motivo: MOTIVO,
      });
      expect(d.campos.cancelacion_motivo).toBeUndefined();
    });
    expect(r.viajes).toEqual([]);
  });

  test('igual el pedido queda cumplido', () => {
    expect(estadoPedido({ ...pedido, ...r.pedido })).toBe('cumplido');
  });
});

describe('armarCierreAdministrativo — despachos muertos', () => {
  test('RECHAZADO y CANCELADO no se tocan', () => {
    const entregas = [entrega('e1', 1, ENTREGA.PROGRAMADA)];
    const despachos = [
      despacho('d0', 'e1', DESPACHO.RECHAZADO),
      despacho('d9', 'e1', DESPACHO.CANCELADO),
      despacho('d1', 'e1', DESPACHO.ASIGNADO),
    ];
    const pedido = pedidoBase({ entregas_total: 1, entregas_cubiertas: 1, entregas_cumplidas: 0 });
    const r = cerrar({ pedido, entregas, despachos });
    expect(r.despachos.map(d => d.id)).toEqual(['d1']);
    expect(estadoPedido({ ...pedido, ...r.pedido })).toBe('cumplido');
  });
});

describe('armarCierreAdministrativo — no aplica', () => {
  const entregas = [entrega('e1', 1, ENTREGA.PENDIENTE)];

  function sinEscrituras(r) {
    expect(r.aplica).toBe(false);
    expect(r.razonNoAplica).toEqual(expect.any(String));
    expect(r.pedido).toEqual({});
    expect(r.entregas).toEqual([]);
    expect(r.despachos).toEqual([]);
    expect(r.viajes).toEqual([]);
    expect(r.historial).toEqual([]);
  }

  test('pedido suspendido', () => {
    const r = cerrar({ pedido: pedidoBase({ suspendido: true }), entregas, despachos: [] });
    sinEscrituras(r);
    expect(r.codigoNoAplica).toBe('suspendido');
  });

  test('pedido ya cumplido', () => {
    const r = cerrar({
      pedido: pedidoBase({ entregas_total: 1, entregas_cubiertas: 1, entregas_cumplidas: 1 }),
      entregas: [entrega('e1', 1, ENTREGA.CUMPLIDA)], despachos: [],
    });
    sinEscrituras(r);
    expect(r.codigoNoAplica).toBe('ya_cumplido');
  });

  test('todas las entregas suspendidas', () => {
    const r = cerrar({
      pedido: pedidoBase({ entregas_total: 0, entregas_cubiertas: 0, entregas_cumplidas: 0 }),
      entregas: [entrega('e1', 1, ENTREGA.SUSPENDIDA), entrega('e2', 2, ENTREGA.SUSPENDIDA)], despachos: [],
    });
    sinEscrituras(r);
    expect(r.codigoNoAplica).toBe('sin_entregas_activas');
  });

  test('exige motivo y un Date válido', () => {
    expect(() => armarCierreAdministrativo({ pedido: pedidoBase(), entregas, despachos: [], viajes: [], motivo: '', ahora: AHORA, usuario: USUARIO })).toThrow();
    expect(() => armarCierreAdministrativo({ pedido: pedidoBase(), entregas, despachos: [], viajes: [], motivo: MOTIVO, ahora: '2026-10-21', usuario: USUARIO })).toThrow();
  });
});

describe('armarCierreAdministrativo — aplicado sobre el árbol da cumplido', () => {
  test('el resultado aplicado sobre las entregas es coherente con los contadores', () => {
    const entregas = [entrega('e1', 1, ENTREGA.PENDIENTE), entrega('e2', 2, ENTREGA.PROGRAMADA)];
    const pedido = pedidoBase({ entregas_total: 2, entregas_cubiertas: 1, entregas_cumplidas: 0 });
    const r = cerrar({ pedido, entregas, despachos: [despacho('d2', 'e2', DESPACHO.ACEPTADO)] });
    const finales = aplicar(entregas, r.entregas);
    expect(finales.every(e => e.estado === 'cumplida')).toBe(true);
    expect(cierre.recontarContadores(finales)).toEqual({
      entregas_total: r.pedido.entregas_total,
      entregas_cubiertas: r.pedido.entregas_cubiertas,
      entregas_cumplidas: r.pedido.entregas_cumplidas,
    });
  });
});

describe('evaluarCorte', () => {
  const entregas = [entrega('e1', 1, ENTREGA.PROGRAMADA, { fecha_solicitada: '2026-10-14' })];

  test('todo anterior al corte: cumple', () => {
    const r = evaluarCorte({
      entregas, despachos: [despacho('d1', 'e1', DESPACHO.ASIGNADO, { fecha_carga: '2026-10-14' })], corte: '2026-10-15',
    });
    expect(r).toEqual({ cumple: true, bloqueos: [] });
  });

  test('la fecha igual al corte NO cumple', () => {
    const r = evaluarCorte({
      entregas: [entrega('e1', 1, ENTREGA.PENDIENTE, { fecha_solicitada: '2026-10-15' })], despachos: [], corte: '2026-10-15',
    });
    expect(r.cumple).toBe(false);
    expect(r.bloqueos[0]).toMatchObject({ tipo: 'entrega', numero: 1, fecha: '2026-10-15' });
  });

  test('un despacho vivo posterior bloquea; uno muerto no', () => {
    const r = evaluarCorte({
      entregas,
      despachos: [
        despacho('d1', 'e1', DESPACHO.CANCELADO, { fecha_carga: '2026-12-01' }),
        despacho('d2', 'e1', DESPACHO.ACEPTADO, { fecha_carga: '2026-10-20' }),
      ],
      corte: '2026-10-15',
    });
    expect(r.cumple).toBe(false);
    expect(r.bloqueos).toHaveLength(1);
    expect(r.bloqueos[0]).toMatchObject({ tipo: 'despacho', id: 'd2' });
  });

  test('las entregas suspendidas no cuentan, y una fecha faltante bloquea', () => {
    expect(evaluarCorte({
      entregas: [entrega('e1', 1, ENTREGA.SUSPENDIDA, { fecha_solicitada: '2027-01-01' }), ...entregas],
      despachos: [], corte: '2026-10-15',
    }).cumple).toBe(true);

    expect(evaluarCorte({
      entregas, despachos: [despacho('d1', 'e1', DESPACHO.ASIGNADO, { fecha_carga: '' })], corte: '2026-10-15',
    }).cumple).toBe(false);
  });
});

describe('el cierre deja cada entrega con despacho en `cumplida` según estadoEntrega()', () => {
  test('con el estadoEntrega() ORIGINAL de estados.js', () => {
    const entregas = [
      entrega('e1', 1, ENTREGA.PROGRAMADA), entrega('e2', 2, ENTREGA.PROGRAMADA),
      entrega('e3', 3, ENTREGA.PROGRAMADA), entrega('e4', 4, ENTREGA.PENDIENTE),
      entrega('e5', 5, ENTREGA.PENDIENTE),                                  // sin ningún despacho
    ];
    const despachos = [
      despacho('d1', 'e1', DESPACHO.ASIGNADO),
      despacho('d2', 'e2', DESPACHO.ACEPTADO),
      despacho('d3', 'e3', DESPACHO.NOMINADO, { viaje_id: 'v3' }),
      despacho('d4', 'e4', DESPACHO.PENDIENTE_ASIGNACION),
      despacho('d0', 'e4', DESPACHO.RECHAZADO),                             // un muerto de la misma entrega
    ];
    const pedido = pedidoBase({ entregas_total: 5, entregas_cubiertas: 3, entregas_cumplidas: 0 });
    const r = cerrar({ pedido, entregas, despachos, viajes: [viaje('v3', 'd3', VIAJE.EN_VIAJE)] });

    const despachosFinales = aplicar(despachos, r.despachos);
    const entregasFinales = aplicar(entregas, r.entregas);

    entregasFinales.filter(e => e.id !== 'e5').forEach(e => {
      const susDespachos = despachosFinales.filter(d => d.entrega_id === e.id);
      expect(estados.estadoEntrega({ ...e, estado: 'pendiente' }, susDespachos)).toBe('cumplida');
    });
    // Sin ningún despacho: igual pasa a cumplida, con la marca.
    expect(entregasFinales.find(e => e.id === 'e5')).toMatchObject({ estado: 'cumplida', cierre_administrativo: true });
    // El despacho muerto no se toca.
    expect(despachosFinales.find(d => d.id === 'd0').estado).toBe('RECHAZADO');
    expect(estadoPedido({ ...pedido, ...r.pedido })).toBe('cumplido');
  });
});

describe('paridad con shared/estados.js', () => {
  test('mismas constantes', () => {
    expect(cierre.DESPACHO).toEqual(estados.DESPACHO);
    expect(cierre.VIAJE).toEqual(estados.VIAJE);
    expect(cierre.ENTREGA).toEqual(estados.ENTREGA);
    expect(cierre.PEDIDO).toEqual(estados.PEDIDO);
  });

  test('mismo estadoPedido() sobre varios casos', () => {
    const casos = [
      null, undefined, {},
      { suspendido: true, entregas_total: 2, entregas_cubiertas: 2, entregas_cumplidas: 2 },
      { entregas_total: 0, entregas_cubiertas: 0, entregas_cumplidas: 0 },
      { entregas_total: 3, entregas_cubiertas: 0, entregas_cumplidas: 0 },
      { entregas_total: 3, entregas_cubiertas: 1, entregas_cumplidas: 0 },
      { entregas_total: 3, entregas_cubiertas: 3, entregas_cumplidas: 1 },
      { entregas_total: 3, entregas_cubiertas: 3, entregas_cumplidas: 3 },
    ];
    casos.forEach(c => expect(estadoPedido(c)).toBe(estados.estadoPedido(c)));
  });

  test('mismos despachoVivo() y viajeAbierto()', () => {
    Object.values(estados.DESPACHO).forEach(estado => {
      expect(cierre.despachoVivo({ estado })).toBe(estados.despachoVivo({ estado }));
    });
    Object.values(estados.VIAJE).forEach(estado => {
      expect(cierre.viajeAbierto({ estado })).toBe(estados.viajeAbierto({ estado }));
    });
    expect(cierre.viajeAbierto(null)).toBe(estados.viajeAbierto(null));
  });
});
