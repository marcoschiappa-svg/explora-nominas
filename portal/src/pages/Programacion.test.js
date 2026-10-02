/* =============================================================================
 * Programacion.test.js — Tests de agruparTransportistasPorProducto (RF-08)
 * =============================================================================
 *
 * v1.2.0 (RF-08) — Ver el encabezado v1.2.0 (RF-08) de `Programacion.js` y
 * el de `Organizaciones.js` para el porqué de `productos_ids`. Corre con el
 * Jest que ya trae Create React App (`CI=true npm test -- Programacion`).
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (rediseño Programación) -- Paso 4 del prompt: tests para la lógica
 * pura nueva de `programacion/logica-vista.js` (conteo de sin cubrir por
 * pedido, orden de entregas por número, mapeo de estado de despacho a
 * estilo). `agruparTransportistasPorProducto` se mudó a
 * `programacion/SelectorTransportista.js` -- sigue importándose de
 * `./Programacion` (re-exportada ahí, ver su encabezado) para no romper
 * estos tests existentes.
 * ========================================================================== */

import { agruparTransportistasPorProducto, migrarSoloVencidosLegacy } from './Programacion';
import {
  contarEntregasSinCubrir, ordenarEntregasPorNumero, estiloEstadoDespacho,
} from './programacion/logica-vista';
import { DESPACHO } from '../estados';

const GLICERINA = { id: 'p1', nombre: 'Glicerina', es_generico: false };
const OTRO = { id: 'p9', nombre: 'Otro', es_generico: true };

const T_DECLARA = { id: 't1', razon_social: 'Transportes ABC', productos_ids: ['p1', 'p2'] };
const T_NO_DECLARA_CON_OTROS = { id: 't2', razon_social: 'Logística Sur', productos_ids: ['p2'] };
const T_SIN_DECLARAR = { id: 't3', razon_social: 'Camiones del Litoral', productos_ids: [] };
const T_SIN_CAMPO = { id: 't4', razon_social: 'Acme Fletes' };

const TRANSPORTISTAS = [T_SIN_DECLARAR, T_DECLARA, T_NO_DECLARA_CON_OTROS, T_SIN_CAMPO];

describe('agruparTransportistasPorProducto', () => {
  test('sin producto -- no agrupa', () => {
    expect(agruparTransportistasPorProducto(TRANSPORTISTAS, null)).toBeNull();
  });

  test('producto genérico ("Otro") -- no agrupa ni advierte', () => {
    expect(agruparTransportistasPorProducto(TRANSPORTISTAS, OTRO)).toBeNull();
  });

  test('producto no genérico -- separa declaran / no declaran', () => {
    const grupos = agruparTransportistasPorProducto(TRANSPORTISTAS, GLICERINA);
    expect(grupos.declaran.map(t => t.id)).toEqual(['t1']);
    expect(grupos.noDeclaran.map(t => t.id).sort()).toEqual(['t2', 't3', 't4'].sort());
  });

  test('cada grupo queda ordenado alfabéticamente', () => {
    const grupos = agruparTransportistasPorProducto(TRANSPORTISTAS, GLICERINA);
    const nombresNoDeclaran = grupos.noDeclaran.map(t => t.razon_social);
    const ordenados = [...nombresNoDeclaran].sort((a, b) => a.localeCompare(b, 'es'));
    expect(nombresNoDeclaran).toEqual(ordenados);
  });

  test('sin productos_ids en el documento -- cae en "no declaran", no rompe', () => {
    const grupos = agruparTransportistasPorProducto(TRANSPORTISTAS, GLICERINA);
    expect(grupos.noDeclaran.some(t => t.id === 't4')).toBe(true);
  });
});

/* -----------------------------------------------------------------------------
 * migrarSoloVencidosLegacy -- v1.2.0 (Paso 0.2 de RF-02). Ver el encabezado
 * de ese mismo nombre en Programacion.js.
 * -------------------------------------------------------------------------- */

describe('migrarSoloVencidosLegacy', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('con la clave vieja en "1" -- devuelve true y borra la clave', () => {
    window.localStorage.setItem('explora:programacion:vencidos:v1:uidM1', '1');
    expect(migrarSoloVencidosLegacy('uidM1')).toBe(true);
    expect(window.localStorage.getItem('explora:programacion:vencidos:v1:uidM1')).toBeNull();
  });

  test('con la clave vieja en "0" -- devuelve false y borra la clave', () => {
    window.localStorage.setItem('explora:programacion:vencidos:v1:uidM2', '0');
    expect(migrarSoloVencidosLegacy('uidM2')).toBe(false);
    expect(window.localStorage.getItem('explora:programacion:vencidos:v1:uidM2')).toBeNull();
  });

  test('sin clave vieja -- null, no rompe', () => {
    expect(migrarSoloVencidosLegacy('uid-sin-nada')).toBeNull();
  });

  test('corre una sola vez -- la segunda llamada ya no encuentra nada', () => {
    window.localStorage.setItem('explora:programacion:vencidos:v1:uidM3', '1');
    expect(migrarSoloVencidosLegacy('uidM3')).toBe(true);
    expect(migrarSoloVencidosLegacy('uidM3')).toBeNull();
  });
});

/* -----------------------------------------------------------------------------
 * contarEntregasSinCubrir / ordenarEntregasPorNumero / estiloEstadoDespacho
 * -- v1.2.0 (rediseño Programación), Paso 4 del prompt.
 * -------------------------------------------------------------------------- */

function itemEntrega(numero, estado, despachos = []) {
  return { entrega: { numero, estado }, despachos };
}

const DESPACHO_VIVO_ASIGNADO = { id: 'd1', estado: DESPACHO.ASIGNADO };
const DESPACHO_VIVO_ACEPTADO = { id: 'd2', estado: DESPACHO.ACEPTADO };
const DESPACHO_MUERTO = { id: 'd3', estado: DESPACHO.RECHAZADO };

describe('contarEntregasSinCubrir', () => {
  test('sin entregas -- 0', () => {
    expect(contarEntregasSinCubrir([])).toBe(0);
  });

  test('cuenta solo las entregas SIN despacho vivo', () => {
    const items = [
      itemEntrega(1, 'pendiente', []),                          // sin cubrir
      itemEntrega(2, 'pendiente', [DESPACHO_MUERTO]),            // solo muertos -- sin cubrir
      itemEntrega(3, 'programada', [DESPACHO_VIVO_ASIGNADO]),    // cubierta
      itemEntrega(4, 'programada', [DESPACHO_VIVO_ACEPTADO]),    // cubierta
    ];
    expect(contarEntregasSinCubrir(items)).toBe(2);
  });

  test('una entrega suspendida nunca cuenta como sin cubrir, aunque no tenga despacho', () => {
    const items = [itemEntrega(1, 'suspendida', [])];
    expect(contarEntregasSinCubrir(items)).toBe(0);
  });
});

describe('ordenarEntregasPorNumero', () => {
  test('ordena ascendente por número', () => {
    const items = [itemEntrega(3, 'pendiente'), itemEntrega(1, 'pendiente'), itemEntrega(2, 'pendiente')];
    expect(ordenarEntregasPorNumero(items).map(it => it.entrega.numero)).toEqual([1, 2, 3]);
  });

  test('no muta el array de entrada', () => {
    const items = [itemEntrega(2, 'pendiente'), itemEntrega(1, 'pendiente')];
    const original = [...items];
    ordenarEntregasPorNumero(items);
    expect(items).toEqual(original);
  });

  test('sin entregas -- array vacío, no rompe', () => {
    expect(ordenarEntregasPorNumero(null)).toEqual([]);
    expect(ordenarEntregasPorNumero([])).toEqual([]);
  });
});

describe('estiloEstadoDespacho', () => {
  test('ASIGNADO -- esperando (ámbar, "Esperando respuesta")', () => {
    expect(estiloEstadoDespacho(DESPACHO.ASIGNADO)).toBe('esperando');
  });

  test('ACEPTADO, NOMINADO, ENTREGADO -- confirmada (verde)', () => {
    expect(estiloEstadoDespacho(DESPACHO.ACEPTADO)).toBe('confirmada');
    expect(estiloEstadoDespacho(DESPACHO.NOMINADO)).toBe('confirmada');
    expect(estiloEstadoDespacho(DESPACHO.ENTREGADO)).toBe('confirmada');
  });

  test('PENDIENTE_ASIGNACION -- sinCubrir (despacho vivo, sin transportista)', () => {
    expect(estiloEstadoDespacho(DESPACHO.PENDIENTE_ASIGNACION)).toBe('sinCubrir');
  });

  test('RECHAZADO / CANCELADO -- sinCubrir, por completitud', () => {
    expect(estiloEstadoDespacho(DESPACHO.RECHAZADO)).toBe('sinCubrir');
    expect(estiloEstadoDespacho(DESPACHO.CANCELADO)).toBe('sinCubrir');
  });
});
