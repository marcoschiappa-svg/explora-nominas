/* =============================================================================
 * logica-viajes-cierre.test.js — v1.2.3
 * Ver el encabezado v1.2.3 de `shared/logica-viajes.js` para SÍNTOMA/CAUSA
 * RAÍZ/ALCANCE/LIMITACIONES/CÓMO SE VERIFICA.
 *
 * `finalizarViaje()` corre contra una transacción falsa: guarda los documentos
 * en un mapa, registra cada escritura y exige (como Firestore) que todas las
 * lecturas vayan antes de la primera escritura.
 * ========================================================================== */

import { finalizarViaje } from './logica-viajes';

jest.mock('firebase/firestore', () => ({
  doc: (db, col, id) => ({ path: `${col}/${id}`, id }),
  collection: (db, ...partes) => ({ path: partes.join('/') }),
  serverTimestamp: () => ({ __ts: 'servidor' }),
  writeBatch: jest.fn(),
  increment: (n) => ({ __increment: n }),
}));

// `enTransaccion` falsa: ejecuta el callback con la transacción de `global.__tx`.
jest.mock('./datos', () => ({
  enTransaccion: async (db, fn, max) => {
    const anotaciones = [];
    const anotar = (p) => {
      if (anotaciones.length >= max) throw new Error('demasiadas anotaciones');
      anotaciones.push(p);
    };
    const r = await fn(global.__tx, anotar);
    global.__anotaciones = anotaciones;
    return r;
  },
  calcularDiferencias: (antes, despues) => ({
    campos: Object.keys(despues), antes: {}, despues,
  }),
}));

const FIN = '2026-10-10T12:00:00Z';

/** Transacción falsa sobre `docs` ({ 'col/id': datos }). */
function crearTx(docs) {
  const escrituras = [];
  let huboEscritura = false;
  return {
    escrituras,
    get: async (ref) => {
      if (huboEscritura) throw new Error('lectura después de una escritura');
      const d = docs[ref.path];
      return { id: ref.id, exists: () => !!d, data: () => d };
    },
    update: (ref, cambios) => { huboEscritura = true; escrituras.push({ path: ref.path, cambios }); },
    set: () => { huboEscritura = true; },
  };
}

function escenario({ estadoEntrega = 'programada', entregaId = 'e1', viajeEntregaId = 'e1', estadoViaje = 'EN_VIAJE' } = {}) {
  const docs = {
    'viajes/v1': {
      estado: estadoViaje, pedido_id: 'p1', fecha_carga: '2026-10-09',
      ...(viajeEntregaId ? { entrega_id: viajeEntregaId } : {}),
    },
    'despachos/d1': { estado: 'NOMINADO', pedido_id: 'p1', entrega_id: entregaId },
    'entregas/e1': { estado: estadoEntrega, pedido_id: 'p1' },
  };
  global.__tx = crearTx(docs);
  return global.__tx;
}

const USUARIO = { uid: 'u1', nombre: 'Test' };
const cerrar = (extra) => finalizarViaje({
  db: {}, viaje: { id: 'v1' }, despacho: { id: 'd1' }, usuario: USUARIO, ...extra,
});
const manual = () => cerrar({ cerradoPor: 'manual', motivo: 'Se entregó', finTsManual: FIN });
const delPath = (tx, path) => tx.escrituras.find(e => e.path === path);
const acciones = () => global.__anotaciones.map(a => `${a.entidadTipo}:${a.accion}`);

describe('finalizarViaje — cierre manual', () => {
  test('entrega programada pasa a cumplida, con historial derivado y despacho_cumplido_id', async () => {
    const tx = escenario();
    await manual();

    const e = delPath(tx, 'entregas/e1');
    expect(e.cambios).toMatchObject({ estado: 'cumplida', despacho_cumplido_id: 'd1' });
    expect(e.cambios.estado_ts).toBeDefined();
    expect(e.cambios.actualizado_en).toBeDefined();

    const h = global.__anotaciones.find(a => a.entidadTipo === 'entrega');
    expect(h).toMatchObject({ accion: 'recalcular_estado', entidadId: 'e1', derivado: true });
  });

  test('programada -> cumplida suma 1 a cumplidas y no toca cubiertas', async () => {
    const tx = escenario({ estadoEntrega: 'programada' });
    await manual();

    const p = delPath(tx, 'pedidos/p1').cambios;
    expect(p.entregas_cumplidas).toEqual({ __increment: 1 });
    expect(p.entregas_cubiertas).toBeUndefined();
  });

  test('entrega pendiente: el delta sale del estado real (suma cubiertas y cumplidas)', async () => {
    const tx = escenario({ estadoEntrega: 'pendiente' });
    await manual();

    const p = delPath(tx, 'pedidos/p1').cambios;
    expect(p.entregas_cumplidas).toEqual({ __increment: 1 });
    expect(p.entregas_cubiertas).toEqual({ __increment: 1 });
    expect(delPath(tx, 'entregas/e1').cambios.estado).toBe('cumplida');
  });

  test('entrega ya cumplida: no se escribe la entrega ni se suma al contador', async () => {
    const tx = escenario({ estadoEntrega: 'cumplida' });
    await manual();

    expect(delPath(tx, 'entregas/e1')).toBeUndefined();
    expect(delPath(tx, 'pedidos/p1')).toBeUndefined();
    expect(acciones()).toEqual(['viaje:cerrar_viaje_manual', 'despacho:entregar']);
    expect(delPath(tx, 'despachos/d1').cambios.estado).toBe('ENTREGADO');
  });

  test('entrega suspendida: no se toca ni mueve contadores', async () => {
    const tx = escenario({ estadoEntrega: 'suspendida' });
    await manual();

    expect(delPath(tx, 'entregas/e1')).toBeUndefined();
    expect(delPath(tx, 'pedidos/p1')).toBeUndefined();
  });

  test('despacho sin entrega_id: cierra como antes (+1 cumplidas)', async () => {
    const tx = escenario({ entregaId: null });
    await manual();

    expect(delPath(tx, 'entregas/e1')).toBeUndefined();
    expect(delPath(tx, 'pedidos/p1').cambios.entregas_cumplidas).toEqual({ __increment: 1 });
  });

  test('las lecturas van antes de las escrituras (la transacción falsa lo exige)', async () => {
    escenario();
    await expect(manual()).resolves.toEqual({ ok: true });
  });
});

describe('finalizarViaje — cierre del chofer', () => {
  test('con entrega_id: actualiza la entrega SIN leerla, con los campos que permite la regla', async () => {
    const tx = escenario({ viajeEntregaId: 'e1' });
    const leidos = [];
    const getOriginal = tx.get;
    tx.get = async (ref) => { leidos.push(ref.path); return getOriginal(ref); };

    await cerrar({ cerradoPor: 'chofer' });

    expect(leidos).toEqual(['viajes/v1']);

    const e = delPath(tx, 'entregas/e1');
    expect(Object.keys(e.cambios).sort()).toEqual(
      ['actualizado_en', 'despacho_cumplido_id', 'estado', 'estado_ts']
    );
    expect(e.cambios).toMatchObject({ estado: 'cumplida', despacho_cumplido_id: 'd1' });

    const h = global.__anotaciones.find(a => a.entidadTipo === 'entrega');
    expect(h).toMatchObject({ accion: 'recalcular_estado', entidadId: 'e1', derivado: true });
    expect(h.diferencias).toEqual({ campos: ['estado'], antes: {}, despues: { estado: 'cumplida' } });

    expect(delPath(tx, 'pedidos/p1').cambios.entregas_cumplidas).toEqual({ __increment: 1 });
  });

  test('sin entrega_id (viaje anterior a v1.2.3): cierra como hoy, sin tocar la entrega', async () => {
    const tx = escenario({ viajeEntregaId: null });
    await cerrar({ cerradoPor: 'chofer' });

    expect(delPath(tx, 'entregas/e1')).toBeUndefined();
    expect(delPath(tx, 'viajes/v1').cambios.estado).toBe('FINALIZADO');
    expect(delPath(tx, 'despachos/d1').cambios.estado).toBe('ENTREGADO');
    expect(delPath(tx, 'pedidos/p1').cambios.entregas_cumplidas).toEqual({ __increment: 1 });
    expect(acciones()).toEqual([
      'viaje:finalizar_viaje', 'despacho:entregar', 'pedido:recalcular_contadores',
    ]);
  });
});
