/* =============================================================================
 * logica-pedidos.test.js — v1.2.5 — Banda horaria editable
 * Ver el encabezado "v1.2.5 — Banda horaria editable" de `logica-pedidos.js`
 * para SÍNTOMA/CAUSA RAÍZ/ALCANCE/LIMITACIONES CONOCIDAS/CÓMO SE VERIFICA.
 *
 * `editarBandaHorariaPedido()` corre contra una transacción falsa, con el mismo
 * patrón que `shared/logica-viajes-cierre.test.js`: guarda los documentos en un
 * mapa, registra cada escritura y exige (como Firestore) que todas las
 * lecturas vayan antes de la primera escritura.
 * ========================================================================== */

import {
  validarCambioBandaHoraria, editarBandaHorariaPedido, BANDAS_HORARIAS,
} from './logica-pedidos';
import { DESPACHO } from './shared/estados';
import { leerContextoPedido } from './logica-despachos';

jest.mock('firebase/firestore', () => {
  let autoId = 0;
  return {
    // `doc(db, col, id)` o `doc(collectionRef)` con id automático.
    doc: (a, col, id) => (col === undefined
      ? { path: `${a.path}/auto${++autoId}`, id: `auto${autoId}` }
      : { path: `${col}/${id}`, id }),
    collection: (db, ...partes) => ({ path: partes.join('/') }),
    getDoc: jest.fn(),
    getDocs: jest.fn(),
    query: jest.fn(),
    where: jest.fn(),
    serverTimestamp: () => ({ __ts: 'servidor' }),
    increment: (n) => ({ __increment: n }),
  };
});

jest.mock('./firebase', () => ({ db: {} }));

jest.mock('./logica-despachos', () => ({
  leerContextoPedido: jest.fn(),
  cancelarDespacho: jest.fn(),
}));

// `enTransaccion` falsa: ejecuta el callback con la transacción de `global.__tx`.
jest.mock('./shared/datos', () => ({
  enTransaccion: async (db, fn, max) => {
    const anotaciones = [];
    const anotar = (p) => {
      if (anotaciones.length >= max) throw new Error('demasiadas anotaciones');
      anotaciones.push(p);
    };
    global.__maxAnotaciones = max;
    const r = await fn(global.__tx, anotar);
    global.__anotaciones = anotaciones;
    return r;
  },
  calcularDiferencias: (antes, despues) => ({
    campos: Object.keys(despues), antes: {}, despues,
  }),
}));

/** Transacción falsa sobre `docs` ({ 'col/id': datos }). */
function crearTx(docs) {
  const updates = [];
  const sets = [];
  let huboEscritura = false;
  return {
    updates,
    sets,
    get: async (ref) => {
      if (huboEscritura) throw new Error('lectura después de una escritura');
      const d = docs[ref.path];
      return { id: ref.id, exists: () => !!d, data: () => d };
    },
    update: (ref, cambios) => { huboEscritura = true; updates.push({ path: ref.path, cambios }); },
    set: (ref, datos) => { huboEscritura = true; sets.push({ path: ref.path, datos }); },
  };
}

const PEDIDO_VIVO = {
  numero: 'PED-2026-000123',
  banda_horaria: 'Mañana (6-12hs)',
  suspendido: false,
  entregas_total: 3,
  entregas_cubiertas: 2,
  entregas_cumplidas: 1,
};

/**
 * Arma el escenario: el pedido y sus despachos, tanto en el contexto que se
 * lee afuera como en los documentos que se releen adentro.
 */
function escenario({ pedido = PEDIDO_VIVO, despachos = [] } = {}) {
  const docs = { 'pedidos/p1': pedido };
  despachos.forEach(d => { docs[`despachos/${d.id}`] = d; });
  leerContextoPedido.mockResolvedValue({ entregas: [], despachos });
  global.__tx = crearTx(docs);
  return global.__tx;
}

const USUARIO = { uid: 'u1', nombre: 'Comercial', email: 'c@x' };

/* ── validarCambioBandaHoraria ───────────────────────────────────────────── */

describe('validarCambioBandaHoraria', () => {
  test('banda fuera de la lista', () => {
    const problemas = validarCambioBandaHoraria({ pedido: PEDIDO_VIVO, nuevaBanda: 'Madrugada' });
    expect(problemas).toEqual(['Elegí una banda horaria válida.']);
  });

  test('pedido suspendido', () => {
    const problemas = validarCambioBandaHoraria({
      pedido: { ...PEDIDO_VIVO, suspendido: true }, nuevaBanda: BANDAS_HORARIAS[1],
    });
    expect(problemas).toEqual(['El pedido está suspendido.']);
  });

  test('pedido cerrado por cierre administrativo', () => {
    const problemas = validarCambioBandaHoraria({
      pedido: { ...PEDIDO_VIVO, cierre_administrativo: true }, nuevaBanda: BANDAS_HORARIAS[1],
    });
    expect(problemas).toEqual(['El pedido está cerrado.']);
  });

  test('pedido cerrado porque todas sus entregas están cumplidas', () => {
    const problemas = validarCambioBandaHoraria({
      pedido: { ...PEDIDO_VIVO, entregas_cubiertas: 3, entregas_cumplidas: 3 },
      nuevaBanda: BANDAS_HORARIAS[1],
    });
    expect(problemas).toEqual(['El pedido está cerrado.']);
  });

  test('pedido con estado derivado cumplido (pantalla)', () => {
    const problemas = validarCambioBandaHoraria({
      pedido: { ...PEDIDO_VIVO, estado: 'cumplido' }, nuevaBanda: BANDAS_HORARIAS[1],
    });
    expect(problemas).toEqual(['El pedido está cerrado.']);
  });

  test('caso válido', () => {
    const problemas = validarCambioBandaHoraria({ pedido: PEDIDO_VIVO, nuevaBanda: 'Tarde (12-18hs)' });
    expect(problemas).toEqual([]);
  });

  test('pedido sin entregas no cuenta como cerrado', () => {
    const problemas = validarCambioBandaHoraria({
      pedido: { ...PEDIDO_VIVO, entregas_total: 0, entregas_cumplidas: 0 },
      nuevaBanda: 'Tarde (12-18hs)',
    });
    expect(problemas).toEqual([]);
  });
});

/* ── editarBandaHorariaPedido ────────────────────────────────────────────── */

describe('editarBandaHorariaPedido', () => {
  test('no escribe nada si la banda no cambió', async () => {
    const tx = escenario({
      despachos: [{ id: 'd1', estado: DESPACHO.ACEPTADO, transportista_org_id: 'orgA' }],
    });
    const r = await editarBandaHorariaPedido({
      pedidoId: 'p1', nuevaBanda: PEDIDO_VIVO.banda_horaria, usuario: USUARIO,
    });
    expect(r).toEqual({ cambio: false, avisados: 0 });
    expect(tx.updates).toEqual([]);
    expect(tx.sets).toEqual([]);
    expect(global.__anotaciones).toEqual([]);
  });

  test('escribe solo banda_horaria y actualizado_en en el pedido, con un registro de historial', async () => {
    const tx = escenario();
    const r = await editarBandaHorariaPedido({
      pedidoId: 'p1', nuevaBanda: 'Tarde (12-18hs)', usuario: USUARIO,
    });
    expect(r).toEqual({ cambio: true, avisados: 0 });
    expect(tx.updates).toHaveLength(1);
    expect(tx.updates[0].path).toBe('pedidos/p1');
    expect(Object.keys(tx.updates[0].cambios).sort()).toEqual(['actualizado_en', 'banda_horaria']);
    expect(tx.updates[0].cambios.banda_horaria).toBe('Tarde (12-18hs)');
    expect(global.__maxAnotaciones).toBe(1);
    expect(global.__anotaciones).toHaveLength(1);
    expect(global.__anotaciones[0]).toMatchObject({
      entidadTipo: 'pedido', entidadId: 'p1', accion: 'editar_banda_horaria',
    });
  });

  test('una organización con dos despachos vivos recibe un solo aviso', async () => {
    const tx = escenario({
      despachos: [
        { id: 'd1', estado: DESPACHO.ACEPTADO, transportista_org_id: 'orgA' },
        { id: 'd2', estado: DESPACHO.NOMINADO, transportista_org_id: 'orgA' },
        { id: 'd3', estado: DESPACHO.ASIGNADO, transportista_org_id: 'orgB' },
      ],
    });
    const r = await editarBandaHorariaPedido({
      pedidoId: 'p1', nuevaBanda: 'Tarde (12-18hs)', usuario: USUARIO,
    });
    expect(r).toEqual({ cambio: true, avisados: 2 });

    const avisos = tx.sets.filter(s => s.path.startsWith('avisos/'));
    expect(avisos).toHaveLength(2);
    const aOrgA = avisos.find(a => a.datos.destinatario_org_id === 'orgA');
    expect(aOrgA.datos).toEqual({
      destinatario_org_id: 'orgA',
      destinatario_chofer_dni: null,
      tipo: 'banda_horaria_cambiada',
      titulo: 'Cambió la banda horaria del pedido PED-2026-000123',
      mensaje: 'La banda horaria del pedido PED-2026-000123 pasó de "Mañana (6-12hs)" a '
        + '"Tarde (12-18hs)". La fecha y el horario de carga de tu despacho no cambian.',
      pedido_id: 'p1',
      despacho_id: 'd1',
      leido: false,
      creado_en: { __ts: 'servidor' },
    });
    // No escribe en despachos, entregas ni viajes.
    expect(tx.updates.map(u => u.path)).toEqual(['pedidos/p1']);
  });

  test('despachos CANCELADO, RECHAZADO o ENTREGADO no generan aviso', async () => {
    const tx = escenario({
      despachos: [
        { id: 'd1', estado: DESPACHO.CANCELADO, transportista_org_id: 'orgA' },
        { id: 'd2', estado: DESPACHO.RECHAZADO, transportista_org_id: 'orgB' },
        { id: 'd3', estado: DESPACHO.ENTREGADO, transportista_org_id: 'orgC' },
      ],
    });
    const r = await editarBandaHorariaPedido({
      pedidoId: 'p1', nuevaBanda: 'Tarde (12-18hs)', usuario: USUARIO,
    });
    expect(r).toEqual({ cambio: true, avisados: 0 });
    expect(tx.sets).toEqual([]);
  });

  test('un despacho que se canceló entre la lectura de afuera y la relectura no genera aviso', async () => {
    const despachos = [{ id: 'd1', estado: DESPACHO.ACEPTADO, transportista_org_id: 'orgA' }];
    const tx = escenario({ despachos });
    // El contexto de afuera lo vio vivo; adentro se relee cancelado.
    tx.get = (orig => async (ref) => {
      const snap = await orig(ref);
      if (ref.path === 'despachos/d1') {
        return { ...snap, data: () => ({ ...despachos[0], estado: DESPACHO.CANCELADO }) };
      }
      return snap;
    })(tx.get);
    const r = await editarBandaHorariaPedido({
      pedidoId: 'p1', nuevaBanda: 'Tarde (12-18hs)', usuario: USUARIO,
    });
    expect(r).toEqual({ cambio: true, avisados: 0 });
    expect(tx.sets).toEqual([]);
  });

  test('pedido suspendido: tira error y no escribe', async () => {
    const tx = escenario({ pedido: { ...PEDIDO_VIVO, suspendido: true } });
    await expect(editarBandaHorariaPedido({
      pedidoId: 'p1', nuevaBanda: 'Tarde (12-18hs)', usuario: USUARIO,
    })).rejects.toThrow('El pedido está suspendido.');
    expect(tx.updates).toEqual([]);
    expect(tx.sets).toEqual([]);
  });
});
