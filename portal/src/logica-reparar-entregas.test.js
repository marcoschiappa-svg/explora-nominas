/* =============================================================================
 * logica-reparar-entregas.test.js — v1.2.3
 * Ver el encabezado de `logica-reparar-entregas.js` para SÍNTOMA/CAUSA RAÍZ/
 * ALCANCE/LIMITACIONES/CÓMO SE VERIFICA.
 * ========================================================================== */

const {
  armarReparacionEntregas, armarCompletarEntregaId, entregaTrabada, RAZON,
} = require('./logica-reparar-entregas');
const { recontarContadores } = require('./logica-cierre-administrativo');

const AHORA = new Date('2026-10-22T15:00:00Z');
const USUARIO = { uid: 'script:test', nombre: 'Test' };

const pedido = (o = {}) => ({
  id: 'p1', numero: 'PED-2026-000007', suspendido: false,
  entregas_total: 1, entregas_cubiertas: 1, entregas_cumplidas: 1, ...o,
});
const entrega = (id, estado, o = {}) => ({ id, pedido_id: 'p1', numero: 1, estado, ...o });
const despacho = (id, entrega_id, estado) => ({ id, pedido_id: 'p1', entrega_id, estado });
const reparar = (args) => armarReparacionEntregas({ pedido: pedido(), ahora: AHORA, usuario: USUARIO, ...args });

describe('entregaTrabada', () => {
  test('programada con su único despacho ENTREGADO: trabada', () => {
    expect(entregaTrabada(entrega('e1', 'programada'), [despacho('d1', 'e1', 'ENTREGADO')])).toBe(true);
  });
  test('los despachos muertos no cuentan, los vivos tienen que estar todos ENTREGADO', () => {
    const ds = [despacho('d1', 'e1', 'CANCELADO'), despacho('d2', 'e1', 'ENTREGADO')];
    expect(entregaTrabada(entrega('e1', 'programada'), ds)).toBe(true);
    expect(entregaTrabada(entrega('e1', 'programada'), [...ds, despacho('d3', 'e1', 'NOMINADO')])).toBe(false);
  });
  test('sin despachos vivos: no se repara', () => {
    expect(entregaTrabada(entrega('e1', 'programada'), [])).toBe(false);
    expect(entregaTrabada(entrega('e1', 'programada'), [despacho('d1', 'e1', 'RECHAZADO')])).toBe(false);
  });
  test('cumplida y suspendida no se tocan', () => {
    const ds = [despacho('d1', 'e1', 'ENTREGADO')];
    expect(entregaTrabada(entrega('e1', 'cumplida'), ds)).toBe(false);
    expect(entregaTrabada(entrega('e1', 'suspendida'), ds)).toBe(false);
  });
  test('despachos de otra entrega no cuentan', () => {
    expect(entregaTrabada(entrega('e1', 'programada'), [despacho('d1', 'e2', 'ENTREGADO')])).toBe(false);
  });
});

describe('armarReparacionEntregas', () => {
  test('el caso real: una entrega programada con el despacho entregado', () => {
    const r = reparar({
      entregas: [entrega('e1', 'programada')],
      despachos: [despacho('d1', 'e1', 'ENTREGADO')],
    });

    expect(r.aplica).toBe(true);
    expect(r.entregas).toEqual([{
      id: 'e1', numero: 1, estadoAnterior: 'programada',
      campos: { estado: 'cumplida', estado_ts: AHORA, actualizado_en: AHORA },
    }]);
    // Contadores recontados: ya estaban bien (cumplidas 1), no hay cambio de pedido en el historial.
    expect(r.pedido).toMatchObject({ entregas_total: 1, entregas_cubiertas: 1, entregas_cumplidas: 1 });
    expect(r.historial).toHaveLength(1);
    expect(r.historial[0]).toMatchObject({
      entidad_tipo: 'entrega', entidad_id: 'e1', pedido_id: 'p1', accion: 'recalcular_estado',
      antes: { estado: 'programada' }, despues: { estado: 'cumplida' },
      razon: RAZON, derivado: false, usuario_uid: 'script:test',
    });
  });

  test('la razón es la del prompt', () => {
    expect(RAZON).toBe('Reparación v1.2.3: el viaje se cerró sin actualizar la entrega');
  });

  test('los contadores se recuentan desde las entregas, no con increment', () => {
    const entregas = [entrega('e1', 'programada'), entrega('e2', 'pendiente', { numero: 2 }), entrega('e3', 'suspendida', { numero: 3 })];
    const r = reparar({
      pedido: pedido({ entregas_total: 5, entregas_cubiertas: 9, entregas_cumplidas: 0 }),  // desfasados a propósito
      entregas,
      despachos: [despacho('d1', 'e1', 'ENTREGADO')],
    });

    expect(r.pedido).toMatchObject({ entregas_total: 2, entregas_cubiertas: 1, entregas_cumplidas: 1 });
    expect(typeof r.pedido.entregas_cumplidas).toBe('number');

    const hPedido = r.historial.find(h => h.entidad_tipo === 'pedido');
    expect(hPedido).toMatchObject({
      accion: 'recalcular_contadores', derivado: true,
      antes: { entregas_total: 5, entregas_cubiertas: 9, entregas_cumplidas: 0 },
      despues: { entregas_total: 2, entregas_cubiertas: 1, entregas_cumplidas: 1 },
    });
  });

  test('pedido con contador de cumplidas en 0: lo corrige al valor real', () => {
    const r = reparar({
      pedido: pedido({ entregas_cumplidas: 0 }),
      entregas: [entrega('e1', 'programada')],
      despachos: [despacho('d1', 'e1', 'ENTREGADO')],
    });
    expect(r.pedido.entregas_cumplidas).toBe(1);
  });

  test('el resultado cuadra con el criterio de verificar-contadores', () => {
    const entregas = [entrega('e1', 'programada'), entrega('e2', 'cumplida', { numero: 2 })];
    const r = reparar({ entregas, despachos: [despacho('d1', 'e1', 'ENTREGADO')] });
    const aplicadas = entregas.map(e => (e.id === 'e1' ? { ...e, estado: 'cumplida' } : e));
    expect(r.pedido).toMatchObject(recontarContadores(aplicadas));
  });

  test('sin candidatos: no aplica y no escribe nada', () => {
    const r = reparar({
      entregas: [entrega('e1', 'programada')],
      despachos: [despacho('d1', 'e1', 'NOMINADO')],
    });
    expect(r).toEqual({ aplica: false, entregas: [], pedido: null, historial: [] });
  });

  test('es idempotente: aplicar el resultado y volver a correr no encuentra nada', () => {
    const entregas = [entrega('e1', 'programada')];
    const despachos = [despacho('d1', 'e1', 'ENTREGADO')];
    const r = reparar({ entregas, despachos });
    const despues = entregas.map(e => ({ ...e, ...r.entregas.find(x => x.id === e.id).campos }));
    expect(reparar({ entregas: despues, despachos }).aplica).toBe(false);
  });

  test('pedido suspendido: no aplica', () => {
    const r = reparar({
      pedido: pedido({ suspendido: true }),
      entregas: [entrega('e1', 'programada')],
      despachos: [despacho('d1', 'e1', 'ENTREGADO')],
    });
    expect(r.aplica).toBe(false);
  });

  test('exige un `ahora` válido', () => {
    expect(() => armarReparacionEntregas({ pedido: pedido(), entregas: [], despachos: [], ahora: 'hoy', usuario: USUARIO }))
      .toThrow(/ahora/);
  });
});

describe('armarCompletarEntregaId', () => {
  const viaje = (id, despacho_id, estado, o = {}) => ({ id, despacho_id, pedido_id: 'p1', estado, ...o });
  const ds = [despacho('d1', 'e1', 'NOMINADO'), despacho('d2', undefined, 'NOMINADO')];

  test('completa los abiertos sin entrega_id desde su despacho', () => {
    const r = armarCompletarEntregaId({
      viajes: [viaje('v1', 'd1', 'RECIBIDO'), viaje('v2', 'd1', 'EN_VIAJE')],
      despachos: ds,
    });
    expect(r.completar).toEqual([
      { id: 'v1', pedidoId: 'p1', despachoId: 'd1', entregaId: 'e1' },
      { id: 'v2', pedidoId: 'p1', despachoId: 'd1', entregaId: 'e1' },
    ]);
    expect(r.sinResolver).toEqual([]);
  });

  test('ignora los cerrados y los que ya tienen entrega_id', () => {
    const r = armarCompletarEntregaId({
      viajes: [viaje('v1', 'd1', 'FINALIZADO'), viaje('v2', 'd1', 'CANCELADO'), viaje('v3', 'd1', 'EN_VIAJE', { entrega_id: 'e1' })],
      despachos: ds,
    });
    expect(r).toEqual({ completar: [], sinResolver: [] });
  });

  test('informa los que no se pueden resolver', () => {
    const r = armarCompletarEntregaId({
      viajes: [viaje('v1', 'dX', 'RECIBIDO'), viaje('v2', 'd2', 'RECIBIDO')],
      despachos: ds,
    });
    expect(r.completar).toEqual([]);
    expect(r.sinResolver.map(s => s.id)).toEqual(['v1', 'v2']);
  });
});
