/* =============================================================================
 * filtros-listado.test.js — Tests de filtros-listado.js (Portal Explora)
 * =============================================================================
 *
 * v1.2.0 (RF-01) — Ver el encabezado de `filtros-listado.js` para el porqué
 * de este módulo. Corre con el Jest que ya trae Create React App
 * (`CI=true npm test -- filtros-listado`), sin ninguna dependencia nueva.
 *
 * Cubre, como mínimo exigido por el prompt de la tarea:
 *   - los cuatro atajos de rango, incluido fin de mes y cambio de mes,
 *   - inclusividad de los bordes de un rango,
 *   - Y entre filtros distintos, O dentro de un mismo filtro múltiple,
 *   - "sin dato al final" en los dos sentidos de orden,
 *   - desempate estable por número,
 *   - lectura de preferencias corruptas, de otra versión, y con IDs que ya
 *     no existen.
 * ========================================================================== */

import {
  rangoDeAtajo, resolverRango, enRango, aplicarFiltros, comparador,
  filtrosActivos, filtrosVacios, leerPreferencias, guardarPreferencias,
  timestampAFechaISO, SIN_ASIGNAR,
} from './filtros-listado';

/* -----------------------------------------------------------------------------
 * rangoDeAtajo / resolverRango
 * -------------------------------------------------------------------------- */

describe('rangoDeAtajo', () => {
  test('hoy -- desde y hasta son el mismo día', () => {
    expect(rangoDeAtajo('hoy', '2026-09-24')).toEqual({ desde: '2026-09-24', hasta: '2026-09-24' });
  });

  test('7dias -- de hoy a hoy+6 (siete días en total)', () => {
    expect(rangoDeAtajo('7dias', '2026-09-24')).toEqual({ desde: '2026-09-24', hasta: '2026-09-30' });
  });

  test('7dias cruzando fin de mes', () => {
    expect(rangoDeAtajo('7dias', '2026-09-28')).toEqual({ desde: '2026-09-28', hasta: '2026-10-04' });
  });

  test('mes -- del 1 al último día del mes en curso', () => {
    expect(rangoDeAtajo('mes', '2026-09-15')).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' });
  });

  test('mes -- respeta un febrero de 28 días', () => {
    expect(rangoDeAtajo('mes', '2026-02-10')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
  });

  test('mes -- respeta un febrero bisiesto (29 días)', () => {
    expect(rangoDeAtajo('mes', '2028-02-10')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
  });

  test('mes -- un diciembre no se desborda al año siguiente', () => {
    expect(rangoDeAtajo('mes', '2026-12-15')).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' });
  });

  test('personalizado -- no calcula nada, devuelve null/null', () => {
    expect(rangoDeAtajo('personalizado', '2026-09-24')).toEqual({ desde: null, hasta: null });
  });

  test('atajo desconocido -- null/null', () => {
    expect(rangoDeAtajo('lo-que-sea', '2026-09-24')).toEqual({ desde: null, hasta: null });
  });
});

describe('resolverRango', () => {
  test('con atajo fijo, se RECALCULA contra el "hoy" que se le pasa -- no queda pegado a cuando se guardó', () => {
    const filtro = { atajo: '7dias', desde: null, hasta: null };
    expect(resolverRango(filtro, '2026-09-24')).toEqual({ desde: '2026-09-24', hasta: '2026-09-30' });
    expect(resolverRango(filtro, '2026-09-25')).toEqual({ desde: '2026-09-25', hasta: '2026-10-01' });
  });

  test('personalizado -- usa desde/hasta guardados tal cual', () => {
    const filtro = { atajo: 'personalizado', desde: '2026-01-01', hasta: '2026-01-15' };
    expect(resolverRango(filtro, '2026-09-24')).toEqual({ desde: '2026-01-01', hasta: '2026-01-15' });
  });

  test('sin filtro -- null/null', () => {
    expect(resolverRango(null)).toEqual({ desde: null, hasta: null });
  });
});

/* -----------------------------------------------------------------------------
 * enRango -- inclusividad de los bordes
 * -------------------------------------------------------------------------- */

describe('enRango', () => {
  const rango = { desde: '2026-09-10', hasta: '2026-09-20' };

  test('el borde "desde" es inclusivo', () => {
    expect(enRango('2026-09-10', rango)).toBe(true);
  });

  test('el borde "hasta" es inclusivo', () => {
    expect(enRango('2026-09-20', rango)).toBe(true);
  });

  test('un día antes del borde "desde" queda afuera', () => {
    expect(enRango('2026-09-09', rango)).toBe(false);
  });

  test('un día después del borde "hasta" queda afuera', () => {
    expect(enRango('2026-09-21', rango)).toBe(false);
  });

  test('adentro del rango', () => {
    expect(enRango('2026-09-15', rango)).toBe(true);
  });

  test('sin fecha, no está en ningún rango', () => {
    expect(enRango(null, rango)).toBe(false);
    expect(enRango('', rango)).toBe(false);
  });

  test('solo "desde" -- sin techo', () => {
    expect(enRango('2099-01-01', { desde: '2026-01-01', hasta: null })).toBe(true);
  });

  test('solo "hasta" -- sin piso', () => {
    expect(enRango('1999-01-01', { desde: null, hasta: '2026-01-01' })).toBe(true);
  });
});

/* -----------------------------------------------------------------------------
 * timestampAFechaISO
 * -------------------------------------------------------------------------- */

describe('timestampAFechaISO', () => {
  test('un Timestamp con toDate() se convierte a fecha local', () => {
    const ts = { toDate: () => new Date(2026, 8, 24) }; // 24-sep-2026, mes 0-indexado
    expect(timestampAFechaISO(ts)).toBe('2026-09-24');
  });

  test('sin Timestamp, null', () => {
    expect(timestampAFechaISO(null)).toBeNull();
    expect(timestampAFechaISO(undefined)).toBeNull();
    expect(timestampAFechaISO({})).toBeNull();
  });
});

/* -----------------------------------------------------------------------------
 * aplicarFiltros -- Y entre filtros, O dentro de un filtro múltiple
 * -------------------------------------------------------------------------- */

function itemsDePrueba() {
  return [
    { id: 'p1', numero: 'PED-001', cliente: 'A', producto: 'Glicerina', tipo: 'Entrega al cliente', creador: 'u1', entregas: ['2026-09-25'] },
    { id: 'p2', numero: 'PED-002', cliente: 'B', producto: 'Glicerina', tipo: 'Entrega en planta', creador: 'u2', entregas: ['2026-09-26'] },
    { id: 'p3', numero: 'PED-003', cliente: 'A', producto: 'Metanol', tipo: 'Entrega al cliente', creador: 'u1', entregas: ['2026-10-05'] },
    { id: 'p4', numero: 'PED-004', cliente: 'C', producto: 'Metanol', tipo: 'Retiro de Proveedores', creador: 'u3', entregas: [] },
  ];
}

const extractoresPrueba = {
  clienteId: x => x.cliente,
  productoId: x => x.producto,
  tipo: x => x.tipo,
  creadoPorUid: x => x.creador,
  fechasEntrega: x => x.entregas,
  numero: x => x.numero,
};

describe('aplicarFiltros', () => {
  test('sin filtros, devuelve todo', () => {
    expect(aplicarFiltros(itemsDePrueba(), filtrosVacios(), extractoresPrueba)).toHaveLength(4);
  });

  test('selección múltiple -- O dentro del mismo filtro (dos clientes)', () => {
    const filtros = { ...filtrosVacios(), clientes: ['A', 'C'] };
    const res = aplicarFiltros(itemsDePrueba(), filtros, extractoresPrueba);
    expect(res.map(x => x.id).sort()).toEqual(['p1', 'p3', 'p4']);
  });

  test('dos filtros distintos -- Y entre ellos', () => {
    const filtros = { ...filtrosVacios(), clientes: ['A'], productos: ['Metanol'] };
    const res = aplicarFiltros(itemsDePrueba(), filtros, extractoresPrueba);
    expect(res.map(x => x.id)).toEqual(['p3']);
  });

  test('filtro de tipo + creador combinados (Y), cada uno con su propia selección (O)', () => {
    const filtros = { ...filtrosVacios(), tipos: ['Entrega al cliente', 'Entrega en planta'], creadoPor: ['u1'] };
    const res = aplicarFiltros(itemsDePrueba(), filtros, extractoresPrueba);
    // p1 y p3: tipo "Entrega al cliente" (de la selección de tipos) Y
    // creador u1 (de la selección de creadores). p2 tiene el tipo pero no
    // el creador -- descartado; p4 no tiene ninguno de los dos.
    expect(res.map(x => x.id).sort()).toEqual(['p1', 'p3']);
  });

  test('filtro de rango sobre una lista de fechas -- pasa si ALGUNA entrega cae en el rango', () => {
    const filtros = { ...filtrosVacios(), entrega: { atajo: 'personalizado', desde: '2026-09-20', hasta: '2026-09-30' } };
    const res = aplicarFiltros(itemsDePrueba(), filtros, extractoresPrueba);
    expect(res.map(x => x.id).sort()).toEqual(['p1', 'p2']);
  });

  test('un ítem sin ninguna fecha no cae en ningún rango', () => {
    const filtros = { ...filtrosVacios(), entrega: { atajo: 'personalizado', desde: '2000-01-01', hasta: '2099-01-01' } };
    const res = aplicarFiltros(itemsDePrueba(), filtros, extractoresPrueba);
    expect(res.find(x => x.id === 'p4')).toBeUndefined();
  });

  test('un extractor que la pantalla no pasa deja ese filtro inerte, no rompe', () => {
    const filtros = { ...filtrosVacios(), transportistas: ['algo'] };
    const res = aplicarFiltros(itemsDePrueba(), filtros, extractoresPrueba); // sin transportistaIdsVivos
    expect(res).toHaveLength(4);
  });

  test('transportista -- "Sin asignar" usa tieneEntregaSinAsignar, no la lista de vivos', () => {
    const items = [
      { id: 'a', vivos: ['orgX'], sinAsignar: false },
      { id: 'b', vivos: [], sinAsignar: true },
    ];
    const extractores = {
      transportistaIdsVivos: x => x.vivos,
      tieneEntregaSinAsignar: x => x.sinAsignar,
      numero: x => x.id,
    };
    const conSinAsignar = aplicarFiltros(items, { ...filtrosVacios(), transportistas: [SIN_ASIGNAR] }, extractores);
    expect(conSinAsignar.map(x => x.id)).toEqual(['b']);

    const conOrgReal = aplicarFiltros(items, { ...filtrosVacios(), transportistas: ['orgX'] }, extractores);
    expect(conOrgReal.map(x => x.id)).toEqual(['a']);
  });

  test('"Solo sin cubrir" usa tieneSinCubrir', () => {
    const items = [{ id: 'a', cubierta: true }, { id: 'b', cubierta: false }];
    const extractores = { tieneSinCubrir: x => !x.cubierta, numero: x => x.id };
    const res = aplicarFiltros(items, { ...filtrosVacios(), soloSinCubrir: true }, extractores);
    expect(res.map(x => x.id)).toEqual(['b']);
  });
});

/* -----------------------------------------------------------------------------
 * filtrosActivos
 * -------------------------------------------------------------------------- */

describe('filtrosActivos', () => {
  test('vacío -- false', () => {
    expect(filtrosActivos(filtrosVacios())).toBe(false);
  });

  test('con una selección múltiple -- true', () => {
    expect(filtrosActivos({ ...filtrosVacios(), clientes: ['A'] })).toBe(true);
  });

  test('con un atajo de fecha -- true', () => {
    expect(filtrosActivos({ ...filtrosVacios(), entrega: { atajo: 'hoy', desde: null, hasta: null } })).toBe(true);
  });

  test('con fechas personalizadas cargadas -- true', () => {
    expect(filtrosActivos({ ...filtrosVacios(), carga: { atajo: 'personalizado', desde: '2026-01-01', hasta: null } })).toBe(true);
  });

  test('con "Solo sin cubrir" -- true', () => {
    expect(filtrosActivos({ ...filtrosVacios(), soloSinCubrir: true })).toBe(true);
  });

  test('null -- false, no revienta', () => {
    expect(filtrosActivos(null)).toBe(false);
  });
});

/* -----------------------------------------------------------------------------
 * comparador -- "sin dato al final" en los dos sentidos, desempate estable
 * -------------------------------------------------------------------------- */

describe('comparador', () => {
  function itemsOrden() {
    return [
      { numero: 'PED-003', cliente: 'Beta' },
      { numero: 'PED-001', cliente: null },       // sin dato
      { numero: 'PED-002', cliente: 'Alfa' },
      { numero: 'PED-004', cliente: null },       // sin dato, para el desempate
    ];
  }
  const extractores = { clienteNombre: x => x.cliente, numero: x => x.numero };

  test('ascendente -- ordena por el dato, sin dato al final', () => {
    const res = [...itemsOrden()].sort(comparador('cliente', 'asc', extractores));
    expect(res.map(x => x.numero)).toEqual(['PED-002', 'PED-003', 'PED-001', 'PED-004']);
  });

  test('descendente -- invierte el orden de los que tienen dato, pero sin dato SIGUE al final', () => {
    const res = [...itemsOrden()].sort(comparador('cliente', 'desc', extractores));
    expect(res.map(x => x.numero)).toEqual(['PED-003', 'PED-002', 'PED-001', 'PED-004']);
  });

  test('desempate estable por número cuando dos sin dato empatan', () => {
    // PED-001 y PED-004 no tienen cliente en los dos casos de arriba; el
    // desempate por número los deja siempre en el mismo orden entre sí
    // (PED-001 antes que PED-004), sin importar el sentido del criterio principal.
    const asc = [...itemsOrden()].sort(comparador('cliente', 'asc', extractores));
    const desc = [...itemsOrden()].sort(comparador('cliente', 'desc', extractores));
    expect(asc.slice(2).map(x => x.numero)).toEqual(['PED-001', 'PED-004']);
    expect(desc.slice(2).map(x => x.numero)).toEqual(['PED-001', 'PED-004']);
  });

  test('criterio de fecha ("entrega") -- ascendente es la fecha más próxima primero', () => {
    const items = [
      { numero: 'PED-002', fecha: '2026-10-01' },
      { numero: 'PED-001', fecha: '2026-09-25' },
      { numero: 'PED-003', fecha: null },
    ];
    const ext = { fechaEntregaProxima: x => x.fecha, numero: x => x.numero };
    const res = items.sort(comparador('entrega', 'asc', ext));
    expect(res.map(x => x.numero)).toEqual(['PED-001', 'PED-002', 'PED-003']);
  });

  test('sin extractor para el criterio -- todos "sin dato", cae al desempate por número', () => {
    const items = [{ numero: 'PED-002' }, { numero: 'PED-001' }];
    const res = items.sort(comparador('carga', 'asc', { numero: x => x.numero }));
    expect(res.map(x => x.numero)).toEqual(['PED-001', 'PED-002']);
  });
});

/* -----------------------------------------------------------------------------
 * leerPreferencias / guardarPreferencias
 * -------------------------------------------------------------------------- */

describe('leerPreferencias / guardarPreferencias', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('guarda y relee -- ida y vuelta', () => {
    const prefs = {
      filtros: {
        ...filtrosVacios(),
        clientes: ['org1', 'org2'],
        entrega: { atajo: '7dias', desde: null, hasta: null },
      },
      grupoActivo: 'pendiente',
      ordenPor: 'cliente',
      ordenSentido: 'desc',
      alcance: 'mios',
    };
    guardarPreferencias('pedidos', 'uid1', prefs);
    const leidas = leerPreferencias('pedidos', 'uid1', { clientes: new Set(['org1', 'org2']) });
    expect(leidas.filtros.clientes).toEqual(['org1', 'org2']);
    expect(leidas.filtros.entrega).toEqual({ atajo: '7dias', desde: null, hasta: null });
    expect(leidas.grupoActivo).toBe('pendiente');
    expect(leidas.ordenPor).toBe('cliente');
    expect(leidas.ordenSentido).toBe('desc');
    expect(leidas.alcance).toBe('mios');
  });

  test('sin nada guardado -- null', () => {
    expect(leerPreferencias('pedidos', 'uid-sin-datos')).toBeNull();
  });

  test('sin uid -- null, no revienta', () => {
    expect(leerPreferencias('pedidos', null)).toBeNull();
    expect(leerPreferencias('pedidos', '')).toBeNull();
  });

  test('JSON corrupto -- se descarta en silencio, null', () => {
    window.localStorage.setItem('explora:listado:v1:pedidos:uid2', '{esto no es JSON válido');
    expect(leerPreferencias('pedidos', 'uid2')).toBeNull();
  });

  test('de otra versión -- se descarta entero, null', () => {
    window.localStorage.setItem('explora:listado:v1:pedidos:uid3', JSON.stringify({ v: 99, grupoActivo: 'pendiente' }));
    expect(leerPreferencias('pedidos', 'uid3')).toBeNull();
  });

  test('con IDs que ya no existen -- se filtran de la selección, el resto se conserva', () => {
    window.localStorage.setItem('explora:listado:v1:pedidos:uid4', JSON.stringify({
      v: 1,
      filtros: { ...filtrosVacios(), clientes: ['org-viva', 'org-borrada'], productos: ['prod-vivo'] },
      ordenPor: 'entrega',
    }));
    const leidas = leerPreferencias('pedidos', 'uid4', {
      clientes: new Set(['org-viva']),
      productos: new Set(['prod-vivo']),
    });
    expect(leidas.filtros.clientes).toEqual(['org-viva']);
    expect(leidas.filtros.productos).toEqual(['prod-vivo']);
    expect(leidas.ordenPor).toBe('entrega');
  });

  test('SIN_ASIGNAR nunca se poda, aunque no esté en la lista de válidos', () => {
    window.localStorage.setItem('explora:listado:v1:programacion:uid5', JSON.stringify({
      v: 1,
      filtros: { ...filtrosVacios(), transportistas: [SIN_ASIGNAR, 'org-borrada'] },
    }));
    const leidas = leerPreferencias('programacion', 'uid5', { transportistas: new Set() });
    expect(leidas.filtros.transportistas).toEqual([SIN_ASIGNAR]);
  });

  test('un rango con atajo inválido cae a null, no rompe', () => {
    window.localStorage.setItem('explora:listado:v1:pedidos:uid6', JSON.stringify({
      v: 1,
      filtros: { ...filtrosVacios(), entrega: { atajo: 'la-luna', desde: 'no-es-fecha', hasta: '2026-09-01' } },
    }));
    const leidas = leerPreferencias('pedidos', 'uid6');
    expect(leidas.filtros.entrega).toEqual({ atajo: null, desde: null, hasta: '2026-09-01' });
  });

  test('sin campo "filtros" -- esa clave no se incluye, no revienta', () => {
    window.localStorage.setItem('explora:listado:v1:pedidos:uid7', JSON.stringify({ v: 1, ordenPor: 'ov' }));
    const leidas = leerPreferencias('pedidos', 'uid7');
    expect(leidas.filtros).toBeUndefined();
    expect(leidas.ordenPor).toBe('ov');
  });

  test('dos pantallas del mismo usuario no se pisan', () => {
    guardarPreferencias('pedidos', 'uidX', { ordenPor: 'cliente' });
    guardarPreferencias('programacion', 'uidX', { ordenPor: 'carga' });
    expect(leerPreferencias('pedidos', 'uidX').ordenPor).toBe('cliente');
    expect(leerPreferencias('programacion', 'uidX').ordenPor).toBe('carga');
  });

  // v1.2.0 (Paso 0.2 de RF-02) -- ver el bloque de encabezado de ese mismo
  // nombre en filtros-listado.js.
  test('soloVencidos hace la ida y vuelta como grupoActivo/ordenPor', () => {
    guardarPreferencias('programacion', 'uidVenc', { ordenPor: 'entrega', soloVencidos: true });
    expect(leerPreferencias('programacion', 'uidVenc').soloVencidos).toBe(true);
  });

  test('soloVencidos con un valor que no es booleano se descarta, no rompe', () => {
    window.localStorage.setItem('explora:listado:v1:programacion:uidVenc2', JSON.stringify({
      v: 1, soloVencidos: 'si',
    }));
    expect(leerPreferencias('programacion', 'uidVenc2').soloVencidos).toBeUndefined();
  });

  // v1.2.0 (rediseño Organizaciones) -- mismo trato que soloVencidos.
  test('verInactivas hace la ida y vuelta como soloVencidos', () => {
    guardarPreferencias('organizaciones', 'uidOrg', { grupoActivo: 'transportes', verInactivas: true });
    expect(leerPreferencias('organizaciones', 'uidOrg').verInactivas).toBe(true);
  });

  test('verInactivas con un valor que no es booleano se descarta, no rompe', () => {
    window.localStorage.setItem('explora:listado:v1:organizaciones:uidOrg2', JSON.stringify({
      v: 1, verInactivas: 'si',
    }));
    expect(leerPreferencias('organizaciones', 'uidOrg2').verInactivas).toBeUndefined();
  });

  test('dos usuarios distintos no comparten preferencias', () => {
    guardarPreferencias('pedidos', 'uidA', { ordenPor: 'cliente' });
    guardarPreferencias('pedidos', 'uidB', { ordenPor: 'ov' });
    expect(leerPreferencias('pedidos', 'uidA').ordenPor).toBe('cliente');
    expect(leerPreferencias('pedidos', 'uidB').ordenPor).toBe('ov');
  });

  test('guardarPreferencias nunca tira, aunque localStorage falle', () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => guardarPreferencias('pedidos', 'uidZ', { ordenPor: 'cliente' })).not.toThrow();
    window.localStorage.setItem = original;
  });
});
