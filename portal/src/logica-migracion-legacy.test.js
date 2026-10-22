/* =============================================================================
 * logica-migracion-legacy.test.js — v1.2.3
 * Ver el encabezado de `logica-migracion-legacy.js` para SÍNTOMA/CAUSA
 * RAÍZ/ALCANCE/LIMITACIONES/CÓMO SE VERIFICA.
 * ========================================================================== */

import * as estados from './shared/estados';
import { textoDomicilio as textoDomicilioOriginal } from './buscar-domicilios';
import { TIPOS as TIPOS_ORIGINAL } from './tipos-pedido';

const migracion = require('./logica-migracion-legacy');
const { armarCierreAdministrativo, estadoPedido } = require('./logica-cierre-administrativo');
const {
  claveNormalizada, claveDomicilio, CLIENTES, DOMICILIOS_LEGACY, DOMICILIOS_LEGACY_POR_PEDIDO,
} = require('./mapa-normalizacion');
const { traducirPedidoLegacy, traducirTrack, arbolParaCierre, aplicarCierreAlArbol } = migracion;

const AHORA = new Date('2026-10-21T15:00:00Z');

/* ── Catálogos ─────────────────────────────────────────────────────────────── */

const org = (id, razon, extra = {}) => ({
  id, razon_social: razon, clave_normalizada: claveNormalizada(razon), estado: 'activo', ...extra,
});

const CATALOGOS = {
  organizaciones: [
    org('org-explora', 'EXPLORA S.A.', { es_propia: true }),
    org('org-pae', 'PAN AMERICAN ENERGY', { es_cliente: true }),
    org('org-gyg', 'TRANSPORTE G&G', { es_transportista: true }),
    org('org-rad', 'TRANSPORTE RAD', { es_transportista: true }),
  ],
  domicilios: [
    { id: 'dom-planta', calle: 'Ruta 11', numero: 'Km 3', ciudad: 'Timbues', provincia: 'Santa Fe', cp: '2200' },
    { id: 'dom-planta-2', calle: 'Otra', numero: '1', ciudad: 'Rosario', provincia: 'Santa Fe', cp: '2000' },
    { id: 'dom-pae', calle: 'Soberanía Nacional', numero: '2550', ciudad: 'Puerto General San Martin', provincia: 'Santa Fe', cp: '2231' },
  ],
  vinculos: [
    { organizacion_id: 'org-explora', domicilio_id: 'dom-planta-2', principal: false },
    { organizacion_id: 'org-explora', domicilio_id: 'dom-planta', principal: true },
    { organizacion_id: 'org-pae', domicilio_id: 'dom-pae', principal: true },
  ],
  productos: [
    { id: 'prod-bio', nombre: 'Biodiesel' },
    { id: 'prod-otro', nombre: 'Otro' },
  ],
  usuarios: [
    { id: 'uid-comercial', email: 'comercial@explora.com.ar' },
    { id: 'uid-chofer', email: 'chofer@x.com', datos_chofer: { dni: '20123456' } },
  ],
};

/* ── Documento viejo, a partir de PED-260819-165 del relevamiento ──────────── */

const TRACK_D2 = [
  { lat: -32.6898, lng: -60.7430, ts: '2026-08-20T20:04:10.100Z' },
  { lat: -32.6898193, lng: -60.7430931, ts: '2026-08-20T20:04:16.239Z' },
  { lat: -32.6898193, lng: -60.7430931, ts: '2026-08-20T20:04:16.266Z' },   // duplicado, 27 ms después
  { lat: -32.6900, lng: -60.7440, ts: '2026-08-20T20:04:46.300Z' },
  { lat: -32.6900, lng: -60.7440, ts: '2026-08-20T20:04:46.321Z' },          // duplicado, 21 ms después
  { lat: -32.6950, lng: -60.7500, ts: '2026-08-20T20:05:16.400Z' },
];

function legacyBase(extra = {}) {
  const cronograma = [];
  for (let n = 1; n <= 19; n++) {
    cronograma.push({ nro: n, volumen: 1, fecha_solicitada: `2026-08-${String(19 + n).padStart(2, '0')}` });
  }
  return {
    id: 'PED-260819-165',
    cliente: 'Pan American Energy',
    ov: 'OV-1126',
    tipo: 'Entrega al cliente',
    producto: 'Biodiesel',
    recipiente: 'Granel',
    obs: '',
    volumen: 20,
    volumen_original: 20,
    volumen_entrega1: 1,
    calle: 'Soberanía Nacional', numero: '2550', ciudad: 'Puerto General San Martin',
    provincia: 'Santa Fe', cp: '2231', mapsLink: '',
    lugar: 'Soberanía Nacional, 2550, Puerto General San Martin, Santa Fe, 2231',
    fecha_entrega: '2026-09-14',
    banda_horaria: 'Tarde (12-18hs)',
    creado_por: 'Comercial', creado_por_email: 'Comercial@explora.com.ar',
    creado_en: '19/8/2026, 11:49:04',
    timestamp: '2026-08-19T14:49:04.776Z',
    estado: 'Nominado',
    cronograma,
    despachos: [
      {
        id: 'D1', entrega_nro: 1, volumen: 1, estado: 'Aceptado-pendiente',
        fecha_carga: '2026-09-14', horario_carga: '', transporte: 'Transporte G&G',
        aceptado_en: '19/8/2026, 12:00:00',
      },
      {
        id: 'D2', entrega_nro: 2, volumen: 1, estado: 'Nominado',
        fecha_carga: '2026-08-20', horario_carga: '08:00', transporte: 'Transporte G&G',
        chofer: 'Juan Pérez', dni_chofer: '20.123.456', patente_tractor: 'AB123CD', patente_semi: 'EF456GH',
        estado_chofer: 'finalizado', estado_chofer_ts: '2026-08-20T21:30:00.000Z',
        chofer_inicio_ts: '2026-08-20T20:04:10.100Z', chofer_fin_ts: '2026-08-20T21:30:00.000Z',
        gps_estado: 'activo', gps_lat: -32.6950, gps_lng: -60.7500, gps_ts: '2026-08-20T21:29:00.000Z',
        gps_inicio_lat: -32.6898, gps_inicio_lng: -60.7430, gps_inicio_ts: '2026-08-20T20:04:10.100Z',
        gps_inicio_precision: 12, gps_inicio_origen: 'actual',
        gps_fin_lat: -32.6950, gps_fin_lng: -60.7500, gps_fin_ts: '2026-08-20T21:30:00.000Z',
        gps_fin_precision: 9, gps_fin_origen: 'actual',
      },
      {
        id: 'D3', entrega_nro: 5, volumen: 1, estado: 'Aceptado',
        fecha_carga: '2026-08-21', transporte: 'Transporte RAD',
      },
    ],
    gps_track_1: TRACK_D2,
    ...extra,
  };
}

function traducir(legacy, catalogos = CATALOGOS, extra = {}) {
  return traducirPedidoLegacy({ legacy, legacyDocId: 'doc-viejo-1', catalogos, ahora: AHORA, ...extra });
}

function tipos(r) { return r.sinResolver.map(x => x.tipo); }

/* ── El caso de PED-260819-165 ─────────────────────────────────────────────── */

describe('traducirPedidoLegacy — el caso de PED-260819-165', () => {
  const r = traducir(legacyBase());

  test('se traduce completo y sin pendientes', () => {
    expect(r.sinResolver).toEqual([]);
    expect(r.omitir).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.resumen).toEqual({ entregas: 20, despachos: 3, viajes: 1, puntos_gps: 4 });
  });

  test('el pedido conserva el número visible y el documento de origen', () => {
    expect(r.pedido.datos).toMatchObject({
      numero: 'PED-260819-165', legacy_numero: 'PED-260819-165', legacy_doc_id: 'doc-viejo-1',
      origen_carga: 'migracion_legacy', clase: 'venta',
      cliente_org_id: 'org-pae', producto_id: 'prod-bio', ov: 'OV-1126', tipo: 'Entrega al cliente',
      recipiente: 'Granel', volumen: 20, volumen_original: 20, banda_horaria: 'Tarde (12-18hs)',
      origen_domicilio_id: 'dom-planta', destino_domicilio_id: 'dom-pae',
      suspendido: false, suspension_motivo: null, suspension_ts: null,
      creado_por_uid: 'uid-comercial',
    });
    expect(r.pedido.datos.creado_en).toEqual(new Date('2026-08-19T14:49:04.776Z'));
  });

  test('hay 20 entregas numeradas 1..20 sin huecos, la 1 sale del pedido', () => {
    expect(r.entregas.map(e => e.datos.numero)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(r.entregas[0].datos).toMatchObject({ numero: 1, volumen: 1, fecha_solicitada: '2026-09-14' });
    // cronograma.nro = 1 -> entrega 2
    expect(r.entregas[1].datos).toMatchObject({ numero: 2, fecha_solicitada: '2026-08-20' });
    expect(r.entregas.reduce((s, e) => s + e.datos.volumen, 0)).toBe(20);
  });

  test('"Entrega al cliente": cada entrega lleva el destino del pedido', () => {
    r.entregas.forEach(e => expect(e.datos.destino_domicilio_id).toBe('dom-pae'));
  });

  test('D1 queda en la entrega 1, D2 en la 2 y D3 en la 5 (entrega_nro, no cronograma.nro)', () => {
    const entregaDe = (clave) => {
      const d = r.despachos.find(x => x.clave === clave);
      return r.entregas.find(e => e.id === d.datos.entrega_id).datos.numero;
    };
    expect(entregaDe('despacho:0')).toBe(1);
    expect(entregaDe('despacho:1')).toBe(2);
    expect(entregaDe('despacho:2')).toBe(5);
  });

  test('estados de los despachos y denormalizados', () => {
    const [d1, d2, d3] = r.despachos.map(d => d.datos);
    expect(d1.estado).toBe('PENDIENTE_ASIGNACION');
    expect(d2.estado).toBe('ENTREGADO');
    expect(d3.estado).toBe('ACEPTADO');
    expect(d1).toMatchObject({
      numero: 'D1', fecha_carga: '2026-09-14', transportista_org_id: 'org-gyg',
      transporte_nombre: 'TRANSPORTE G&G', requiere_transporte: true,
      cliente_razon_social: 'PAN AMERICAN ENERGY', producto_nombre: 'Biodiesel',
      destino_texto: 'Soberanía Nacional 2550, Puerto General San Martin, Santa Fe, 2231',
      entrega_numero: 1, entregas_total: 20, coordinadores_email: [], comercial_email: '',
      tractor_id: null, acoplado_id: null, creado_en: r.pedido.datos.creado_en,
    });
    expect(d1.viaje_id).toBeUndefined();
    expect(d3.transportista_org_id).toBe('org-rad');
  });

  test('D2: estado_ts sale de chofer_fin_ts, y chofer y patentes se conservan', () => {
    const d2 = r.despachos[1].datos;
    expect(d2.estado_ts).toEqual(new Date('2026-08-20T21:30:00.000Z'));
    expect(d2).toMatchObject({
      chofer_uid: 'uid-chofer', chofer_dni: '20.123.456',
      patente_tractor: 'AB123CD', patente_semi: 'EF456GH', viaje_id: 'viaje:1',
    });
  });

  test('estado de las entregas y contadores', () => {
    const estado = (n) => r.entregas.find(e => e.datos.numero === n).datos.estado;
    expect(estado(1)).toBe('programada');
    expect(estado(2)).toBe('cumplida');
    expect(estado(5)).toBe('programada');
    expect(estado(3)).toBe('pendiente');
    expect(r.pedido.datos).toMatchObject({ entregas_total: 20, entregas_cubiertas: 3, entregas_cumplidas: 1 });
    expect(estadoPedido(r.pedido.datos)).toBe('programado_parcial');
  });

  test('solo D2 tiene viaje, FINALIZADO, con los bloques gps renombrados', () => {
    expect(r.viajes).toHaveLength(1);
    const v = r.viajes[0].datos;
    expect(v).toMatchObject({
      despacho_id: 'despacho:1', pedido_id: 'pedido', estado: 'FINALIZADO', demorado: false,
      cerrado_por: 'chofer', chofer_uid: 'uid-chofer', transportista_org_id: 'org-gyg',
      inicio_lat: -32.6898, inicio_lng: -60.7430, inicio_precision: 12, inicio_origen: 'actual',
      fin_lat: -32.6950, fin_lng: -60.7500, fin_precision: 9, fin_origen: 'actual',
      ultima_lat: -32.6950, ultima_lng: -60.7500,
      puntos_registrados: 4, volumen: 1, fecha_carga: '2026-08-20',
      patente_tractor: 'AB123CD', patente_semi: 'EF456GH',
      cliente_razon_social: 'PAN AMERICAN ENERGY', producto_nombre: 'Biodiesel',
      origen_texto: 'Ruta 11 Km 3, Timbues, Santa Fe, 2200',
    });
    expect(v.inicio_ts).toEqual(new Date('2026-08-20T20:04:10.100Z'));
    expect(v.fin_ts).toEqual(new Date('2026-08-20T21:30:00.000Z'));
    expect(v.ultima_ts).toEqual(new Date('2026-08-20T21:29:00.000Z'));
    expect(v.creado_en).toEqual(new Date('2026-08-20T21:30:00.000Z'));
  });

  test('el recorrido de D2 se toma de gps_track_1 y se deduplica', () => {
    expect(r.puntosGps).toHaveLength(1);
    expect(r.puntosGps[0].viajeId).toBe('viaje:1');
    const ids = r.puntosGps[0].puntos.map(p => p.id);
    expect(ids).toEqual([
      String(Date.parse('2026-08-20T20:04:10.100Z')),
      String(Date.parse('2026-08-20T20:04:16.239Z')),
      String(Date.parse('2026-08-20T20:04:46.300Z')),
      String(Date.parse('2026-08-20T20:05:16.400Z')),
    ]);
    expect(r.puntosGps[0].puntos[1].datos).toEqual({
      lat: -32.6898193, lng: -60.7430931, ts: new Date('2026-08-20T20:04:16.239Z'), precision: null, velocidad: null,
    });
  });

  test('historial: un registro migrar_pedido_legacy con el formato de armarHistorial()', () => {
    expect(r.historial).toHaveLength(1);
    expect(r.historial[0]).toMatchObject({
      entidad_tipo: 'pedido', entidad_id: 'pedido', pedido_id: 'pedido',
      accion: 'migrar_pedido_legacy', antes: {}, derivado: false, ts: AHORA,
      despues: { entregas: 20, despachos: 3, viajes: 1, puntos_gps: 4 },
      usuario_uid: 'script:migrar-pedidos-legacy',
    });
    expect(r.historial[0].razon).toContain('PED-260819-165');
    expect(r.historial[0].razon).toContain('doc-viejo-1');
  });

  test('ningún valor del árbol es undefined (firebase-admin lo rechaza al escribir)', () => {
    const rutas = [];
    const recorrer = (v, ruta) => {
      if (v === undefined) { rutas.push(ruta); return; }
      if (v instanceof Date || v === null || typeof v !== 'object') return;
      Object.keys(v).forEach(k => recorrer(v[k], `${ruta}.${k}`));
    };
    // Un despacho sin casi nada: es el caso que más campos deja sin definir.
    const pelado = legacyBase({ cronograma: [], volumen: 1, despachos: [{ entrega_nro: 1, estado: 'Programado' }] });
    [r, traducir(pelado)].forEach(x => {
      expect(x.ok).toBe(true);
      recorrer({ p: x.pedido, e: x.entregas, d: x.despachos, v: x.viajes, g: x.puntosGps, h: x.historial }, 'arbol');
    });
    expect(rutas).toEqual([]);
  });

  test('generarId reemplaza las claves por IDs, también dentro de las referencias', () => {
    const r2 = traducir(legacyBase(), CATALOGOS, { generarId: (c) => `ID(${c})` });
    expect(r2.pedido.id).toBe('ID(pedido)');
    expect(r2.despachos[1].datos.pedido_id).toBe('ID(pedido)');
    expect(r2.despachos[1].datos.entrega_id).toBe('ID(entrega:2)');
    expect(r2.viajes[0].datos.despacho_id).toBe('ID(despacho:1)');
    expect(r2.puntosGps[0].viajeId).toBe('ID(viaje:1)');
  });
});

/* ── gps_track_{n}: n es la POSICIÓN, no el número ─────────────────────────── */

describe('gps_track_{n}', () => {
  test('el sufijo es la posición en despachos[], no el número del despacho', () => {
    const legacy = legacyBase({
      cronograma: [],
      volumen: 1,
      despachos: [{
        id: 'D7', entrega_nro: 1, volumen: 1, estado: 'Nominado', fecha_carga: '2026-09-14', transporte: '—',
        estado_chofer: 'iniciado', estado_chofer_ts: '2026-09-14T10:00:00.000Z',
      }],
      gps_track_0: [{ lat: 1, lng: 2, ts: '2026-09-14T10:00:00.000Z' }],
      gps_track_7: [{ lat: 9, lng: 9, ts: '2026-09-14T10:00:00.000Z' }],
      gps_track_1: undefined,
    });
    const r = traducir(legacy);
    expect(r.ok).toBe(true);
    expect(r.puntosGps[0].puntos).toHaveLength(1);
    expect(r.puntosGps[0].puntos[0].datos).toMatchObject({ lat: 1, lng: 2 });
  });

  test('un recorrido sin viaje no se migra y deja un aviso', () => {
    const legacy = legacyBase({ gps_track_0: [{ lat: 1, lng: 2, ts: '2026-09-14T10:00:00.000Z' }] });
    const r = traducir(legacy);
    expect(r.ok).toBe(true);
    expect(r.avisos.map(a => a.tipo)).toContain('gps_sin_viaje');
    expect(r.puntosGps).toHaveLength(1);        // solo el de D2
  });
});

describe('traducirTrack — duplicados', () => {
  const t = (lat, lng, ts) => ({ lat, lng, ts });

  test('misma lat/lng a menos de 1000 ms: se descarta', () => {
    const r = traducirTrack([
      t(1, 2, '2026-08-20T20:04:16.239Z'), t(1, 2, '2026-08-20T20:04:16.266Z'),
    ]);
    expect(r.puntos).toHaveLength(1);
    expect(r.descartados).toBe(1);
  });

  test('misma lat/lng pero 30 segundos después (camión detenido): se conserva', () => {
    const r = traducirTrack([t(1, 2, '2026-08-20T20:04:00.000Z'), t(1, 2, '2026-08-20T20:04:30.000Z')]);
    expect(r.puntos).toHaveLength(2);
  });

  test('distinta posición a pocos ms: se conserva', () => {
    const r = traducirTrack([t(1, 2, '2026-08-20T20:04:00.000Z'), t(1, 3, '2026-08-20T20:04:00.010Z')]);
    expect(r.puntos).toHaveLength(2);
  });

  test('se compara contra el último que quedó, no contra el anterior crudo', () => {
    const r = traducirTrack([
      t(1, 2, '2026-08-20T20:04:00.000Z'),
      t(1, 2, '2026-08-20T20:04:00.900Z'),    // se descarta (900 ms)
      t(1, 2, '2026-08-20T20:04:01.800Z'),    // 1800 ms del que quedó: se conserva
    ]);
    expect(r.puntos).toHaveLength(2);
  });

  test('ignora puntos sin fecha ISO o sin coordenadas, y entradas que no son array', () => {
    expect(traducirTrack([t('x', 2, '2026-08-20T20:04:00.000Z'), t(1, 2, '20/8/2026 20:04'), null]).puntos).toEqual([]);
    expect(traducirTrack(undefined).puntos).toEqual([]);
  });
});

/* ── Suspendido ────────────────────────────────────────────────────────────── */

describe('pedido suspendido', () => {
  test('queda suspendido con motivo y fecha de suspensión', () => {
    const r = traducir(legacyBase({
      estado: 'Suspendido', motivo_suspension: 'El cliente canceló', suspendido_en: '2026-08-25T10:00:00.000Z',
    }));
    expect(r.ok).toBe(true);
    expect(r.pedido.datos).toMatchObject({ suspendido: true, suspension_motivo: 'El cliente canceló' });
    expect(r.pedido.datos.suspension_ts).toEqual(new Date('2026-08-25T10:00:00.000Z'));
    expect(estadoPedido(r.pedido.datos)).toBe('suspendido');
  });

  test('sin motivo ni fecha parseable: texto fijo y creado_en', () => {
    const r = traducir(legacyBase({ estado: 'Suspendido', suspendido_en: '25/8/2026, 10:00:00' }));
    expect(r.pedido.datos.suspension_motivo).toBe('Pedido suspendido en el modelo anterior');
    expect(r.pedido.datos.suspension_ts).toEqual(r.pedido.datos.creado_en);
  });
});

/* ── Suspendidos: efecto de suspenderPedido() ──────────────────────────────── */

describe('aplicarSuspensionAlArbol', () => {
  const { aplicarSuspensionAlArbol, MOTIVO_CANCELACION_SUSPENSION } = migracion;
  const SUSP = { estado: 'Suspendido', motivo_suspension: 'Cliente canceló' };
  const AHORA_S = new Date('2026-10-21T16:00:00Z');

  function suspendido(cambiosLegacy, cambiarDespachos) {
    const legacy = legacyBase({ ...SUSP, ...cambiosLegacy });
    if (cambiarDespachos) cambiarDespachos(legacy.despachos);
    const arbol = traducir(legacy);
    expect(arbol.ok).toBe(true);
    return { arbol, res: aplicarSuspensionAlArbol(arbol, { ahora: AHORA_S }) };
  }

  const porClave = (lista, clave) => lista.find(x => x.clave === clave).datos;

  function sinVivosNiAbiertos(res) {
    res.despachos.forEach(d => expect(['ENTREGADO', 'CANCELADO', 'RECHAZADO']).toContain(d.datos.estado));
    res.viajes.forEach(v => expect(['FINALIZADO', 'CANCELADO']).toContain(v.datos.estado));
  }

  test('despacho Aceptado sin viaje: se cancela; el entregado y su viaje finalizado no se tocan', () => {
    const { arbol, res } = suspendido();
    // D1 Aceptado-pendiente (sin viaje), D2 ENTREGADO con viaje FINALIZADO, D3 Aceptado (sin viaje)
    expect(porClave(res.despachos, 'despacho:0')).toMatchObject({
      estado: 'CANCELADO', estado_ts: AHORA_S, cancelacion_motivo: MOTIVO_CANCELACION_SUSPENSION,
    });
    expect(porClave(res.despachos, 'despacho:2').estado).toBe('CANCELADO');
    expect(res.despachos[1]).toEqual(arbol.despachos[1]);           // ENTREGADO: idéntico
    expect(res.viajes[0]).toEqual(arbol.viajes[0]);                 // FINALIZADO: idéntico
    expect(MOTIVO_CANCELACION_SUSPENSION).toBe('Pedido suspendido en el modelo anterior (migración v1.2.3)');
    sinVivosNiAbiertos(res);
  });

  test('entregas: la cumplida no se toca, todas las demás quedan suspendidas', () => {
    const { res } = suspendido();
    const estados = res.entregas.map(e => e.datos.estado);
    expect(estados.filter(e => e === 'cumplida')).toHaveLength(1);
    expect(res.entregas.find(e => e.datos.numero === 2).datos.estado).toBe('cumplida');
    expect(estados.filter(e => e === 'suspendida')).toHaveLength(19);
    expect(res.entregas.find(e => e.datos.numero === 1).datos.actualizado_en).toEqual(AHORA_S);
  });

  test('contadores como los deja suspenderPedido(): total intacto, cubiertas = cumplidas', () => {
    const { res } = suspendido();
    expect(res.pedido.datos).toMatchObject({
      suspendido: true, suspension_motivo: 'Cliente canceló',
      entregas_total: 20, entregas_cubiertas: 1, entregas_cumplidas: 1, actualizado_en: AHORA_S,
    });
    expect(estadoPedido(res.pedido.datos)).toBe('suspendido');
  });

  test('Nominado con viaje recibido: despacho y viaje se cancelan', () => {
    const { res } = suspendido({}, ds => { Object.assign(ds[0], { estado: 'Nominado', estado_chofer: 'recibido', dni_chofer: '20123456' }); });
    expect(porClave(res.despachos, 'despacho:0').estado).toBe('CANCELADO');
    expect(porClave(res.viajes, 'viaje:0')).toMatchObject({ estado: 'CANCELADO', estado_ts: AHORA_S, actualizado_en: AHORA_S });
    sinVivosNiAbiertos(res);
    expect(estadoPedido(res.pedido.datos)).toBe('suspendido');
  });

  test('viaje EN_VIAJE (suspenderPedido() se negaría): en la migración también se cancela', () => {
    const { res } = suspendido({}, ds => { Object.assign(ds[0], { estado: 'Nominado', estado_chofer: 'iniciado' }); });
    expect(porClave(res.viajes, 'viaje:0').estado).toBe('CANCELADO');
    sinVivosNiAbiertos(res);
  });

  test('viaje finalizado + entrega cumplida: no se tocan', () => {
    const { arbol, res } = suspendido();
    expect(res.viajes.find(v => v.posicion === 1)).toEqual(arbol.viajes[0]);
    expect(res.entregas.find(e => e.datos.numero === 2)).toEqual(arbol.entregas.find(e => e.datos.numero === 2));
  });

  test('historial: el efecto va en el registro de migración, sin registro aparte', () => {
    const { arbol, res } = suspendido();
    expect(res.historial).toHaveLength(1);
    expect(res.historial[0].accion).toBe('migrar_pedido_legacy');
    expect(res.historial[0].despues).toMatchObject({
      entregas: 20, despachos: 3, viajes: 1, puntos_gps: 4,
      despachos_cancelados: 2, viajes_cancelados: 0, entregas_suspendidas: 19,
    });
    expect(res.historial[0].campos_modificados).toEqual(expect.arrayContaining(['despachos_cancelados', 'viajes_cancelados', 'entregas_suspendidas']));
    expect(res.resumen.despachos_cancelados).toBe(2);
    // No muta el árbol original.
    expect(arbol.historial[0].despues.despachos_cancelados).toBeUndefined();
    expect(arbol.pedido.datos.entregas_cubiertas).toBe(3);
  });

  test('un pedido no suspendido vuelve igual; ahora inválido lanza', () => {
    const arbol = traducir(legacyBase());
    expect(aplicarSuspensionAlArbol(arbol, { ahora: AHORA_S })).toBe(arbol);
    expect(() => aplicarSuspensionAlArbol(traducir(legacyBase(SUSP)), { ahora: 'x' })).toThrow();
  });

  test('sin undefined en el resultado (firebase-admin lo rechaza)', () => {
    const { res } = suspendido({}, ds => { Object.assign(ds[0], { estado: 'Nominado', estado_chofer: 'recibido' }); });
    const malos = [];
    const rec = (v, r) => {
      if (v === undefined) malos.push(r);
      else if (v && typeof v === 'object' && !(v instanceof Date)) Object.keys(v).forEach(k => rec(v[k], `${r}.${k}`));
    };
    rec(res, 'res');
    expect(malos).toEqual([]);
  });
});

/* ── Se omite / no se resuelve ─────────────────────────────────────────────── */

describe('cliente con mapa null', () => {
  test('se omite, con la razón', () => {
    const r = traducir(legacyBase({ cliente: 'IvanPruebaApp' }));
    expect(r.ok).toBe(false);
    expect(r.omitir.razon).toContain('IvanPruebaApp');
    expect(r.pedido).toBeNull();
    expect(r.sinResolver).toEqual([]);
  });
});

describe('desconocidos van a sinResolver', () => {
  test('cliente que no está en el mapa', () => {
    const r = traducir(legacyBase({ cliente: 'Cliente Nuevo SA' }));
    expect(r.ok).toBe(false);
    expect(r.sinResolver).toEqual([{ tipo: 'cliente', valor: 'Cliente Nuevo SA', detalle: expect.stringContaining('CLIENTES') }]);
  });

  test('cliente del mapa cuya organización no existe', () => {
    const r = traducir(legacyBase(), { ...CATALOGOS, organizaciones: CATALOGOS.organizaciones.filter(o => o.id !== 'org-pae') });
    expect(r.sinResolver[0]).toMatchObject({ tipo: 'cliente', valor: 'Pan American Energy' });
  });

  test('producto', () => {
    const r = traducir(legacyBase({ producto: 'Aceite Mágico' }));
    expect(r.sinResolver).toEqual([{ tipo: 'producto', valor: 'Aceite Mágico', detalle: expect.any(String) }]);
  });

  test('producto: ignora mayúsculas y espacios de los extremos', () => {
    const r = traducir(legacyBase({ producto: '  biodiesel ' }));
    expect(r.ok).toBe(true);
    expect(r.pedido.datos.producto_id).toBe('prod-bio');
  });

  test('domicilio: con la dirección completa y la organización', () => {
    const r = traducir(legacyBase({ calle: 'Calle Inventada', numero: '99' }));
    expect(r.sinResolver).toEqual([{
      tipo: 'domicilio',
      valor: 'Calle Inventada 99, Puerto General San Martin, Santa Fe, 2231',
      detalle: 'Organización: PAN AMERICAN ENERGY',
      organizacion_id: 'org-pae',
    }]);
  });

  test('estado de despacho', () => {
    const legacy = legacyBase();
    legacy.despachos[0].estado = 'Estado Raro';
    const r = traducir(legacy);
    expect(r.sinResolver).toEqual([{ tipo: 'estado_despacho', valor: 'Estado Raro', detalle: expect.any(String) }]);
  });

  test('estado del chofer', () => {
    const legacy = legacyBase();
    legacy.despachos[1].estado_chofer = 'volando';
    expect(tipos(traducir(legacy))).toEqual(['estado_viaje']);
  });

  test('transporte', () => {
    const legacy = legacyBase();
    legacy.despachos[0].transporte = 'Transportes del Sur';
    const r = traducir(legacy);
    expect(r.sinResolver).toEqual([{ tipo: 'transporte', valor: 'Transportes del Sur', detalle: expect.stringContaining('TRANSPORTES') }]);
  });

  test('despacho que apunta a una entrega inexistente', () => {
    const legacy = legacyBase();
    legacy.despachos[0].entrega_nro = 99;
    expect(tipos(traducir(legacy))).toEqual(['entrega']);
  });

  test('timestamp ausente o no ISO', () => {
    expect(tipos(traducir(legacyBase({ timestamp: undefined })))).toEqual(['fecha']);
    expect(tipos(traducir(legacyBase({ timestamp: '19/8/2026, 11:49:04' })))).toEqual(['fecha']);
  });

  test('tipo de pedido desconocido', () => {
    expect(tipos(traducir(legacyBase({ tipo: 'Teletransportación' })))).toContain('tipo');
  });

  test('varios a la vez: se informan todos juntos', () => {
    const legacy = legacyBase({ producto: 'Zzz', calle: 'Inventada' });
    legacy.despachos[2].estado = 'Raro';
    expect(tipos(traducir(legacy)).sort()).toEqual(['domicilio', 'estado_despacho', 'producto']);
  });

  test('sin entrega 1 con volumen y con cronograma que ya se pasa del total: no se adivina', () => {
    const r = traducir(legacyBase({ volumen_entrega1: undefined, volumen: 15 }));   // cronograma de 19 -> resto negativo
    expect(tipos(r)).toEqual(['volumen']);
  });
});

/* ── Entrega en planta ─────────────────────────────────────────────────────── */

describe('"Entrega en planta"', () => {
  test('usa los cinco campos sueltos, nunca `lugar` (pisado con la dirección de Explora)', () => {
    const r = traducir(legacyBase({
      tipo: 'Entrega en planta',
      lugar: 'Ruta 11, Km 3, Timbues, Santa Fe, 2200',    // la de Explora, pisada
    }));
    expect(r.ok).toBe(true);
    expect(r.pedido.datos).toMatchObject({ origen_domicilio_id: 'dom-pae', destino_domicilio_id: 'dom-planta' });
    // Solo "Entrega al cliente" lleva dirección por entrega.
    expect(r.entregas[0].datos.destino_domicilio_id).toBeUndefined();
    expect(r.despachos[0].datos.destino_texto).toBe('Ruta 11 Km 3, Timbues, Santa Fe, 2200');
  });

  test('la planta es el vínculo principal; si ninguno lo es, el primero', () => {
    const sinPrincipal = { ...CATALOGOS, vinculos: CATALOGOS.vinculos.map(v => ({ ...v, principal: false })) };
    const r = traducir(legacyBase(), sinPrincipal);
    expect(r.pedido.datos.origen_domicilio_id).toBe('dom-planta-2');
  });

  test('sin domicilio de planta: sinResolver', () => {
    const sinPlanta = { ...CATALOGOS, vinculos: CATALOGOS.vinculos.filter(v => v.organizacion_id !== 'org-explora') };
    expect(traducir(legacyBase(), sinPlanta).sinResolver[0]).toMatchObject({ tipo: 'domicilio', valor: 'planta de Explora' });
  });
});

/* ── Transporte, chofer y estados de despacho ──────────────────────────────── */

describe('transporte', () => {
  test.each(['—', '-', '', undefined])('%p: sin transportista y sin requerir transporte', (valor) => {
    const legacy = legacyBase();
    legacy.despachos[0].transporte = valor;
    const r = traducir(legacy);
    expect(r.ok).toBe(true);
    expect(r.despachos[0].datos).toMatchObject({
      transportista_org_id: null, transporte_nombre: null, requiere_transporte: false,
    });
  });

  test('un valor que el mapa da como null queda como transportista null', () => {
    const legacy = legacyBase();
    legacy.despachos[0].transporte = 'Transprueba';
    const r = traducir(legacy);
    expect(r.ok).toBe(true);
    expect(r.despachos[0].datos.transportista_org_id).toBeNull();
  });
});

describe('chofer', () => {
  test('sin usuario nuevo: chofer_uid null, se conserva el DNI y se avisa, sin frenar', () => {
    const r = traducir(legacyBase(), { ...CATALOGOS, usuarios: [] });
    expect(r.ok).toBe(true);
    expect(r.despachos[1].datos).toMatchObject({ chofer_uid: null, chofer_dni: '20.123.456' });
    expect(r.viajes[0].datos).toMatchObject({ chofer_uid: null, chofer_dni: '20.123.456' });
    const tiposAviso = r.avisos.map(a => a.tipo);
    expect(tiposAviso).toContain('chofer_sin_usuario');
    expect(tiposAviso).toContain('creado_por_uid');
    expect(r.pedido.datos.creado_por_uid).toBeNull();
  });

  test('el DNI se compara solo por dígitos', () => {
    const r = traducir(legacyBase());   // "20.123.456" contra "20123456"
    expect(r.despachos[1].datos.chofer_uid).toBe('uid-chofer');
    expect(r.avisos.map(a => a.tipo)).not.toContain('chofer_sin_usuario');
  });
});

describe('estados de despacho y de viaje', () => {
  const con = (cambios) => {
    const legacy = legacyBase();
    Object.assign(legacy.despachos[0], cambios);
    return traducir(legacy);
  };

  test.each([
    ['Aceptado-pendiente', 'PENDIENTE_ASIGNACION'],
    ['Programado', 'ASIGNADO'],
    ['Aceptado', 'ACEPTADO'],
    ['Nominado', 'NOMINADO'],
    ['Rechazado', 'RECHAZADO'],
    ['En espera', 'CANCELADO'],
  ])('%s -> %s', (viejo, nuevo) => {
    expect(con({ estado: viejo }).despachos[0].datos.estado).toBe(nuevo);
  });

  test('"En espera" lleva el motivo de cancelación', () => {
    expect(con({ estado: 'En espera' }).despachos[0].datos.cancelacion_motivo).toBe('En espera en el modelo anterior');
  });

  test('Nominado con estado_chofer finalizado es ENTREGADO; con iniciado sigue NOMINADO', () => {
    const fin = con({ estado: 'Nominado', estado_chofer: 'finalizado', chofer_fin_ts: '2026-09-14T12:00:00.000Z' });
    expect(fin.despachos[0].datos.estado).toBe('ENTREGADO');
    expect(fin.despachos[0].datos.estado_ts).toEqual(new Date('2026-09-14T12:00:00.000Z'));
    const ini = con({ estado: 'Nominado', estado_chofer: 'iniciado' });
    expect(ini.despachos[0].datos.estado).toBe('NOMINADO');
    expect(ini.viajes.find(v => v.posicion === 0).datos.estado).toBe('EN_VIAJE');
  });

  test.each([
    ['recibido', 'RECIBIDO', false],
    ['iniciado', 'EN_VIAJE', false],
    ['demorado', 'EN_VIAJE', true],
    ['finalizado', 'FINALIZADO', false],
  ])('estado_chofer %s -> viaje %s (demorado: %s)', (viejo, nuevo, demorado) => {
    const v = con({ estado: 'Nominado', estado_chofer: viejo }).viajes.find(x => x.posicion === 0).datos;
    expect(v.estado).toBe(nuevo);
    expect(v.demorado).toBe(demorado);
  });

  test('finalizado_manual: cerrado_por manual', () => {
    const v = con({ estado: 'Nominado', estado_chofer: 'finalizado', finalizado_manual: true })
      .viajes.find(x => x.posicion === 0).datos;
    expect(v.cerrado_por).toBe('manual');
  });
});

/* ── Puente con el cierre administrativo ───────────────────────────────────── */

describe('migrados y cerrados', () => {
  test('el cierre aplicado sobre el árbol traducido deja el pedido cumplido', () => {
    const legacy = legacyBase();
    legacy.despachos[1].estado = 'Nominado';
    legacy.despachos[1].estado_chofer = 'iniciado';           // viaje EN_VIAJE: queda abierto
    delete legacy.despachos[1].chofer_fin_ts;

    const arbol = traducir(legacy);
    const plano = arbolParaCierre(arbol);
    const cierre = armarCierreAdministrativo({
      ...plano, motivo: 'Migración del modelo anterior (v1.2.3)', ahora: AHORA, usuario: { uid: 'script:x', nombre: 'X' },
    });
    expect(cierre.aplica).toBe(true);

    const cerrado = aplicarCierreAlArbol(arbol, cierre);
    expect(estadoPedido(cerrado.pedido.datos)).toBe('cumplido');
    expect(cerrado.pedido.datos).toMatchObject({ cierre_administrativo: true, entregas_total: 20, entregas_cumplidas: 20 });
    expect(cerrado.entregas.every(e => e.datos.estado === 'cumplida')).toBe(true);
    expect(cerrado.viajes[0].datos).toMatchObject({ estado: 'FINALIZADO', fin_ts: null, cierre_administrativo: true });
    expect(cerrado.despachos.map(d => d.datos.estado)).toEqual(['ENTREGADO', 'ENTREGADO', 'ENTREGADO']);
    expect(cerrado.despachos.every(d => d.datos.cierre_administrativo === true || d.datos.estado === 'ENTREGADO')).toBe(true);
    expect(cerrado.historial.map(h => h.accion)).toEqual(['migrar_pedido_legacy', 'cierre_administrativo']);
    // No muta el árbol original.
    expect(arbol.pedido.datos.cierre_administrativo).toBeUndefined();
  });

  test('si el cierre no aplica, el árbol queda igual', () => {
    const arbol = traducir(legacyBase({ estado: 'Suspendido' }));
    const cierre = armarCierreAdministrativo({
      ...arbolParaCierre(arbol), motivo: 'm', ahora: AHORA, usuario: { uid: 'u', nombre: 'U' },
    });
    expect(cierre.aplica).toBe(false);
    expect(aplicarCierreAlArbol(arbol, cierre)).toBe(arbol);
  });
});

/* ── Paridad con los originales ────────────────────────────────────────────── */

describe('paridad con los originales', () => {
  test('mismas constantes de estado', () => {
    expect(migracion.DESPACHO).toEqual(estados.DESPACHO);
    expect(migracion.VIAJE).toEqual(estados.VIAJE);
    expect(migracion.ENTREGA).toEqual(estados.ENTREGA);
  });

  test('mismo textoDomicilio()', () => {
    const casos = [
      null, undefined, {},
      { calle: 'Ruta 11', numero: 'Km 3', ciudad: 'Timbues', provincia: 'Santa Fe', cp: '2200' },
      { calle: 'Mitre', numero: null, ciudad: 'Campana' },
      { calle: '', numero: '5', ciudad: 'Rosario', provincia: 'Santa Fe' },
      { ciudad: 'Rosario', cp: '2000' },
    ];
    casos.forEach(c => expect(migracion.textoDomicilio(c)).toBe(textoDomicilioOriginal(c)));
  });

  test('mismo estadoEntrega()', () => {
    const D = estados.DESPACHO;
    const casos = [
      [{ estado: 'suspendida' }, [{ estado: D.ASIGNADO }]],
      [{ estado: 'pendiente' }, []],
      [{ estado: 'pendiente' }, undefined],
      [{ estado: 'pendiente' }, [{ estado: D.RECHAZADO }, { estado: D.CANCELADO }]],
      [{ estado: 'pendiente' }, [{ estado: D.ASIGNADO }]],
      [{ estado: 'pendiente' }, [{ estado: D.NOMINADO }]],
      [{ estado: 'pendiente' }, [{ estado: D.ENTREGADO }]],
      [{ estado: 'pendiente' }, [{ estado: D.RECHAZADO }, { estado: D.ENTREGADO }]],
      [null, [{ estado: D.ACEPTADO }]],
    ];
    casos.forEach(([e, ds]) => expect(migracion.estadoEntrega(e, ds)).toBe(estados.estadoEntrega(e, ds)));
  });

  test('mismos TIPOS de pedido', () => {
    expect(migracion.TIPOS).toEqual(TIPOS_ORIGINAL);
  });
});

/* ── v1.2.3 (prompt 3): lo que frenó la simulación de producción ───────────── */

describe('tipos de pedido con nombre viejo', () => {
  const { TIPOS_LEGACY } = migracion;

  test.each([
    ['Retiro del cliente', 'Entrega en planta'],
    ['Retiro de proveedor', 'Retiro de Proveedores'],
  ])('%s -> %s, conservando el original en legacy_tipo', (viejo, nuevo) => {
    const r = traducir(legacyBase({ tipo: viejo }));
    expect(r.ok).toBe(true);
    expect(r.pedido.datos).toMatchObject({ tipo: nuevo, legacy_tipo: viejo });
    // origen/destino salen del tipo NUEVO: el cliente es el origen, la planta el destino.
    expect(r.pedido.datos).toMatchObject({ origen_domicilio_id: 'dom-pae', destino_domicilio_id: 'dom-planta' });
    expect(r.entregas[0].datos.destino_domicilio_id).toBeUndefined();
  });

  test('un tipo vigente no lleva legacy_tipo', () => {
    expect(traducir(legacyBase()).pedido.datos).not.toHaveProperty('legacy_tipo');
  });

  test('sin equivalencia sigue yendo a sinResolver', () => {
    const r = traducir(legacyBase({ tipo: 'Retiro del vecino' }));
    expect(r.sinResolver).toEqual([{ tipo: 'tipo', valor: 'Retiro del vecino', detalle: expect.any(String) }]);
  });

  test('toda equivalencia apunta a un tipo que existe', () => {
    Object.values(TIPOS_LEGACY).forEach(t => expect(Object.keys(TIPOS_ORIGINAL)).toContain(t));
  });
});

describe('despachos sin entrega_nro', () => {
  const sinNro = (id, extra = {}) => ({
    id, volumen: 1, estado: 'Nominado', fecha_carga: '2026-07-01', transporte: '—',
    estado_chofer: 'finalizado', chofer_fin_ts: '2026-07-01T15:00:00.000Z', ...extra,
  });
  const unaEntrega = (despachos) => legacyBase({ cronograma: [], volumen: 2, volumen_entrega1: 2, despachos, gps_track_1: undefined });

  test('un despacho y una entrega: va a la entrega 1', () => {
    const r = traducir(unaEntrega([sinNro('D1')]));
    expect(r.ok).toBe(true);
    expect(r.entregas).toHaveLength(1);
    expect(r.despachos[0].datos.entrega_id).toBe('entrega:1');
    expect(r.avisos.map(a => a.tipo)).not.toContain('entrega_por_numero_de_despacho');
  });

  test('dos despachos y una entrega: los dos van a la 1 y la entrega queda cumplida', () => {
    const r = traducir(unaEntrega([sinNro('D1'), sinNro('D2')]));
    expect(r.ok).toBe(true);
    expect(r.despachos.map(d => d.datos.entrega_id)).toEqual(['entrega:1', 'entrega:1']);
    expect(r.despachos.map(d => d.datos.estado)).toEqual(['ENTREGADO', 'ENTREGADO']);
    expect(r.entregas[0].datos.estado).toBe('cumplida');
    expect(r.pedido.datos).toMatchObject({ entregas_total: 1, entregas_cumplidas: 1 });
  });

  test('el entrega_nro declarado manda sobre el resto', () => {
    const legacy = legacyBase();                 // 20 entregas
    legacy.despachos[0].entrega_nro = 3;
    expect(traducir(legacy).despachos[0].datos.entrega_id).toBe('entrega:3');
  });

  test('varias entregas: Dn va a la entrega n, con aviso, sin frenar', () => {
    const legacy = legacyBase();                 // 20 entregas
    legacy.despachos = [sinNro('D2'), sinNro('D5')];
    legacy.gps_track_1 = undefined;
    const r = traducir(legacy);
    expect(r.ok).toBe(true);
    expect(r.despachos.map(d => d.datos.entrega_id)).toEqual(['entrega:2', 'entrega:5']);
    const avisos = r.avisos.filter(a => a.tipo === 'entrega_por_numero_de_despacho');
    expect(avisos).toHaveLength(2);
    expect(avisos[0].detalle).toContain('D2');
  });

  test('varias entregas y un Dn que no existe, o un id sin número: sinResolver', () => {
    const legacy = legacyBase();
    legacy.despachos = [sinNro('D99')];
    expect(tipos(traducir(legacy))).toEqual(['entrega']);
    const sinNumero = legacyBase();
    sinNumero.despachos = [sinNro('X')];
    expect(tipos(traducir(sinNumero))).toEqual(['entrega']);
  });
});

describe('entrega 1 sin volumen_entrega1 con cronograma', () => {
  const sinVolumen1 = (extra) => legacyBase({ volumen_entrega1: undefined, ...extra });

  test('resto positivo: volumen − cronograma, con aviso y la cuenta', () => {
    const r = traducir(sinVolumen1({}));         // 20 − 19 = 1
    expect(r.ok).toBe(true);
    expect(r.entregas[0].datos.volumen).toBe(1);
    expect(r.avisos.find(a => a.tipo === 'volumen_entrega1_calculado').detalle).toContain('20 − cronograma 19 = 1');
    expect(r.entregas.reduce((sum, e) => sum + e.datos.volumen, 0)).toBe(20);
  });

  test('resto con decimales: sin ruido de punto flotante', () => {
    const r = traducir(sinVolumen1({ volumen: 1, cronograma: [{ nro: 1, volumen: 0.7, fecha_solicitada: '2026-08-20' }], despachos: [] }));
    expect(r.entregas[0].datos.volumen).toBe(0.3);
  });

  test('resto cero: el cronograma ya cubre todo (v1.2.3 prompt 4: numero = nro, ver más abajo)', () => {
    const r = traducir(sinVolumen1({ volumen: 19 }));
    expect(r.ok).toBe(true);
    expect(r.entregas).toHaveLength(19);
    expect(r.avisos.map(a => a.tipo)).toContain('cronograma_cubre_el_pedido');
  });

  test('resto negativo: sinResolver', () => {
    const r = traducir(sinVolumen1({ volumen: 10 }));
    expect(tipos(r)).toEqual(['volumen']);
    expect(r.sinResolver[0].detalle).toContain('= -9');
  });
});

describe('domicilios: mapas explícitos de mapa-normalizacion.js', () => {
  const CAT = {
    ...CATALOGOS,
    domicilios: [
      ...CATALOGOS.domicilios,
      { id: 'dom-mitre', calle: 'Av Mitre', numero: '574', ciudad: 'Campana', provincia: 'Buenos Aires', cp: '2804' },
      { id: 'dom-suelto', calle: 'Suelta', numero: '1', ciudad: 'Rosario', provincia: 'Santa Fe', cp: '2000' },
    ],
    vinculos: [...CATALOGOS.vinculos, { organizacion_id: 'org-pae', domicilio_id: 'dom-mitre', principal: false }],
  };
  const CLAVE_MITRE = claveDomicilio({ calle: 'Av Mitre', numero: '574', ciudad: 'Campana' });
  const CLAVE_SUELTO = claveDomicilio({ calle: 'Suelta', numero: '1', ciudad: 'Rosario' });
  const VARIANTE = { calle: 'AV .ING MITRE', numero: '574', ciudad: 'CAMPANA BS AS', provincia: 'Buenos Aires', cp: 'B2804' };
  const TEXTO_VARIANTE = 'AV .ING MITRE 574, CAMPANA BS AS, Buenos Aires, B2804';
  const SIN_DIRECCION = { calle: '', numero: '', ciudad: '', provincia: '', cp: '' };

  // v1.2.3: los mapas llevan las entradas REALES que carga Ivan en
  // `mapa-normalizacion.js`. Cada test arranca con ellos vacíos (como cuando
  // eran un esqueleto) y al terminar se restauran desde la copia, así los datos
  // reales no se pierden entre tests.
  let copiaLegacy;
  let copiaPorPedido;

  const vaciar = (mapa) => Object.keys(mapa).forEach(k => delete mapa[k]);

  beforeEach(() => {
    copiaLegacy = { ...DOMICILIOS_LEGACY };
    copiaPorPedido = { ...DOMICILIOS_LEGACY_POR_PEDIDO };
    vaciar(DOMICILIOS_LEGACY);
    vaciar(DOMICILIOS_LEGACY_POR_PEDIDO);
  });

  afterEach(() => {
    vaciar(DOMICILIOS_LEGACY);
    vaciar(DOMICILIOS_LEGACY_POR_PEDIDO);
    Object.assign(DOMICILIOS_LEGACY, copiaLegacy);
    Object.assign(DOMICILIOS_LEGACY_POR_PEDIDO, copiaPorPedido);
  });

  test('los dos mapas se exportan como objetos y todos sus valores son strings no vacíos', () => {
    // Se mira la copia (los datos reales): durante el test los mapas están vacíos.
    [[DOMICILIOS_LEGACY, copiaLegacy], [DOMICILIOS_LEGACY_POR_PEDIDO, copiaPorPedido]].forEach(([mapa, real]) => {
      expect(typeof mapa).toBe('object');
      expect(mapa).not.toBeNull();
      expect(Array.isArray(mapa)).toBe(false);
      Object.entries(real).forEach(([clave, valor]) => {
        expect(typeof valor).toBe('string');
        expect(valor.trim()).not.toBe('');
        expect(clave.trim()).not.toBe('');
      });
    });
  });

  test('los datos reales se restauran entre tests', () => {
    DOMICILIOS_LEGACY['dirección de prueba'] = 'clave';
    expect(Object.keys(DOMICILIOS_LEGACY)).toEqual(['dirección de prueba']);
  });

  test('una variante de escritura sin mapa va a sinResolver, con la organización', () => {
    const r = traducir(legacyBase(VARIANTE), CAT);
    expect(r.sinResolver).toEqual([{
      tipo: 'domicilio', valor: TEXTO_VARIANTE, detalle: 'Organización: PAN AMERICAN ENERGY', organizacion_id: 'org-pae',
    }]);
  });

  test('DOMICILIOS_LEGACY resuelve la dirección tal cual la imprime el reporte', () => {
    DOMICILIOS_LEGACY[TEXTO_VARIANTE] = CLAVE_MITRE;
    const r = traducir(legacyBase(VARIANTE), CAT);
    expect(r.ok).toBe(true);
    expect(r.pedido.datos.destino_domicilio_id).toBe('dom-mitre');
    expect(r.entregas[0].datos.destino_domicilio_id).toBe('dom-mitre');
    expect(r.despachos[0].datos.destino_texto).toBe('Av Mitre 574, Campana, Buenos Aires, 2804');
  });

  test('DOMICILIOS_LEGACY_POR_PEDIDO resuelve un "(sin dirección)"', () => {
    expect(traducir(legacyBase(SIN_DIRECCION), CAT).sinResolver[0]).toMatchObject({ tipo: 'domicilio', valor: '(sin dirección)' });
    DOMICILIOS_LEGACY_POR_PEDIDO['PED-260819-165'] = CLAVE_MITRE;
    const r = traducir(legacyBase(SIN_DIRECCION), CAT);
    expect(r.ok).toBe(true);
    expect(r.pedido.datos.destino_domicilio_id).toBe('dom-mitre');
  });

  test('un "(sin dirección)" nunca se resuelve por DOMICILIOS_LEGACY', () => {
    DOMICILIOS_LEGACY['(sin dirección)'] = CLAVE_MITRE;
    expect(traducir(legacyBase(SIN_DIRECCION), CAT).ok).toBe(false);
  });

  test('el mapa por pedido tiene prioridad sobre la coincidencia por claveDomicilio', () => {
    expect(traducir(legacyBase(), CAT).pedido.datos.destino_domicilio_id).toBe('dom-pae');   // coincide solo
    DOMICILIOS_LEGACY_POR_PEDIDO['PED-260819-165'] = CLAVE_MITRE;
    expect(traducir(legacyBase(), CAT).pedido.datos.destino_domicilio_id).toBe('dom-mitre');
  });

  test('la coincidencia por claveDomicilio tiene prioridad sobre DOMICILIOS_LEGACY', () => {
    DOMICILIOS_LEGACY['Soberanía Nacional 2550, Puerto General San Martin, Santa Fe, 2231'] = CLAVE_MITRE;
    expect(traducir(legacyBase(), CAT).pedido.datos.destino_domicilio_id).toBe('dom-pae');
  });

  test('una clave que no existe en domicilios: sinResolver con el motivo', () => {
    DOMICILIOS_LEGACY[TEXTO_VARIANTE] = 'clave que no existe';
    const r = traducir(legacyBase(VARIANTE), CAT);
    expect(r.ok).toBe(false);
    expect(r.sinResolver[0].detalle).toContain('no existe en domicilios');
  });

  test('un domicilio que existe pero no está vinculado a la organización: sinResolver con ese motivo', () => {
    DOMICILIOS_LEGACY[TEXTO_VARIANTE] = CLAVE_SUELTO;
    const r = traducir(legacyBase(VARIANTE), CAT);
    expect(r.ok).toBe(false);
    expect(r.sinResolver[0].detalle).toContain('no está vinculado a la organización');
    DOMICILIOS_LEGACY_POR_PEDIDO['PED-260819-165'] = CLAVE_SUELTO;
    expect(traducir(legacyBase(), CAT).sinResolver[0].detalle).toContain('no está vinculado a la organización');
  });

  test('domiciliosCandidatos: los de la organización, con su clave, ordenados', () => {
    const { domiciliosCandidatos } = migracion;
    expect(domiciliosCandidatos('org-pae', CAT)).toEqual([
      { id: 'dom-mitre', texto: 'Av Mitre 574, Campana, Buenos Aires, 2804', clave: CLAVE_MITRE },
      {
        id: 'dom-pae', texto: 'Soberanía Nacional 2550, Puerto General San Martin, Santa Fe, 2231',
        clave: claveDomicilio({ calle: 'Soberanía Nacional', numero: '2550', ciudad: 'Puerto General San Martin' }),
      },
    ]);
    expect(domiciliosCandidatos('org-rad', CAT)).toEqual([]);
  });

  test('si el domicilio trae clave_normalizada se usa esa', () => {
    const conClave = { ...CAT, domicilios: CAT.domicilios.map(d => d.id === 'dom-mitre' ? { ...d, clave_normalizada: 'clave-propia' } : d) };
    expect(migracion.domiciliosCandidatos('org-pae', conClave).find(c => c.id === 'dom-mitre').clave).toBe('clave-propia');
    DOMICILIOS_LEGACY[TEXTO_VARIANTE] = 'clave-propia';
    expect(traducir(legacyBase(VARIANTE), conClave).pedido.datos.destino_domicilio_id).toBe('dom-mitre');
  });
});

describe('cliente que se agrega al mapa después', () => {
  // Un nombre inventado: INSUAGRO ya tiene su entrada real en `CLIENTES`.
  const NUEVO = 'CLIENTE NUEVO DE PRUEBA';
  afterEach(() => { delete CLIENTES[NUEVO]; });

  test('un cliente sin entrada va a sinResolver; con la entrada, el flujo existente lo resuelve', () => {
    expect(traducir(legacyBase({ cliente: NUEVO })).sinResolver).toEqual([
      { tipo: 'cliente', valor: NUEVO, detalle: expect.stringContaining('CLIENTES') },
    ]);

    CLIENTES[NUEVO] = 'INSUAGRO';
    const orgNueva = { id: 'org-insuagro', razon_social: 'INSUAGRO', clave_normalizada: claveNormalizada('INSUAGRO'), estado: 'activo' };
    const cat = {
      ...CATALOGOS,
      organizaciones: [...CATALOGOS.organizaciones, orgNueva],
      vinculos: [...CATALOGOS.vinculos, { organizacion_id: 'org-insuagro', domicilio_id: 'dom-pae', principal: true }],
    };
    const r = traducir(legacyBase({ cliente: NUEVO }), cat);
    expect(r.ok).toBe(true);
    expect(r.pedido.datos.cliente_org_id).toBe('org-insuagro');
  });
});

/* ── v1.2.3 (prompt 4): domicilios relevados, la planta y el cronograma completo ── */

describe('domicilios: variantes relevadas de datos-domicilios.js', () => {
  const { DOMICILIOS } = require('../scripts/datos-domicilios');
  const org = (id, razon, extra = {}) => ({
    id, razon_social: razon, clave_normalizada: claveNormalizada(razon), estado: 'activo', ...extra,
  });
  const YRIGOYEN = { id: 'dom-yrigoyen', calle: 'Yrigoyen', numero: '2933', ciudad: 'Puerto General San Martín', provincia: 'Santa Fe', cp: 'S2200HWA' };
  const RIO_PRIMERO = { id: 'dom-rio', calle: 'Río Primero', numero: '155', ciudad: 'General Rodríguez', provincia: 'Buenos Aires', cp: 'B1748' };
  const CAT = {
    organizaciones: [
      org('org-explora', 'EXPLORA S.A.', { es_propia: true }),
      org('org-methil', 'METHIL GROUP', { es_cliente: true }),
      org('org-cdm', 'CDM', { es_cliente: true }),
      org('org-procrop', 'PRO CROP', { es_cliente: true }),
    ],
    domicilios: [YRIGOYEN, RIO_PRIMERO],
    vinculos: [
      { organizacion_id: 'org-explora', domicilio_id: 'dom-yrigoyen', principal: true },
      { organizacion_id: 'org-methil', domicilio_id: 'dom-yrigoyen', principal: true },   // METHIL tiene la planta vinculada
      { organizacion_id: 'org-procrop', domicilio_id: 'dom-rio', principal: true },
    ],
    productos: CATALOGOS.productos,
    usuarios: CATALOGOS.usuarios,
    domiciliosRelevados: DOMICILIOS,
  };
  const DIRECCION_PLANTA = {
    calle: 'YRIGOYEN', numero: '2933', ciudad: 'PUERTO GRAL.SAN MARTIN', provincia: 'SANTA FE', cp: 'S2200HWA',
  };
  const DIRECCION_RIO = {
    calle: 'RIO PRIMERO', numero: '155', ciudad: 'GRAL.RODRIGUEZ', provincia: 'BUENOS AIRES', cp: 'B1748',
  };
  const pedidoP4 = (extra) => legacyBase({
    cronograma: [], volumen: 2, volumen_entrega1: 2, gps_track_1: undefined,
    despachos: [{ id: 'D1', entrega_nro: 1, volumen: 2, estado: 'Aceptado', fecha_carga: '2026-07-01', transporte: '—' }],
    ...extra,
  });

  test('una variante relevada (GRAL.RODRIGUEZ) resuelve al domicilio canónico vinculado', () => {
    const r = traducir(pedidoP4({ cliente: 'PRO CROP', ...DIRECCION_RIO }), CAT);
    expect(r.ok).toBe(true);
    expect(r.pedido.datos.destino_domicilio_id).toBe('dom-rio');
    expect(r.despachos[0].datos.destino_texto).toBe('Río Primero 155, General Rodríguez, Buenos Aires, B1748');
  });

  test('sin las variantes en el catálogo, la misma dirección sigue sin resolverse', () => {
    const r = traducir(pedidoP4({ cliente: 'PRO CROP', ...DIRECCION_RIO }), { ...CAT, domiciliosRelevados: undefined });
    expect(r.sinResolver[0]).toMatchObject({ tipo: 'domicilio', organizacion_id: 'org-procrop' });
  });

  test('la variante apunta a un canónico que no existe en domicilios: sinResolver con ese motivo', () => {
    const r = traducir(pedidoP4({ cliente: 'PRO CROP', ...DIRECCION_RIO }), { ...CAT, domicilios: [YRIGOYEN] });
    expect(r.ok).toBe(false);
    expect(r.sinResolver[0].detalle).toContain('no existe en domicilios');
    expect(r.sinResolver[0].detalle).toContain('datos-domicilios.js');
  });

  test('la variante apunta a un domicilio que existe pero no está vinculado: sinResolver', () => {
    const r = traducir(pedidoP4({ cliente: 'PRO CROP', ...DIRECCION_RIO }), { ...CAT, vinculos: CAT.vinculos.filter(v => v.domicilio_id !== 'dom-rio') });
    expect(r.ok).toBe(false);
    expect(r.sinResolver[0].detalle).toContain('no está vinculado a la organización');
  });

  test('DOMICILIOS_LEGACY_POR_PEDIDO sigue teniendo prioridad sobre las variantes', () => {
    DOMICILIOS_LEGACY_POR_PEDIDO['PED-260819-165'] = claveDomicilio(YRIGOYEN);
    try {
      const r = traducir(pedidoP4({ cliente: 'PRO CROP', ...DIRECCION_RIO, tipo: 'Entrega en planta' }), CAT);
      expect(r.pedido.datos.origen_domicilio_id).toBeNull();            // resolvió a la planta, no al Río Primero
    } finally { delete DOMICILIOS_LEGACY_POR_PEDIDO['PED-260819-165']; }
  });

  describe('la dirección vieja es la planta de Explora', () => {
    test('"Entrega en planta" con Yrigoyen y un cliente sin domicilios: origen null y aviso, sin frenar', () => {
      const r = traducir(pedidoP4({ cliente: 'CDM', tipo: 'Entrega en planta', ...DIRECCION_PLANTA }), CAT);
      expect(r.ok).toBe(true);
      expect(r.sinResolver).toEqual([]);
      expect(r.pedido.datos).toMatchObject({ origen_domicilio_id: null, destino_domicilio_id: 'dom-yrigoyen' });
      const aviso = r.avisos.find(a => a.tipo === 'origen_es_la_planta');
      expect(aviso.detalle).toContain('la dirección del cliente no está registrada');
      expect(aviso.detalle).toContain('CDM');
      // Sin dirección por entrega (solo "Entrega al cliente" la lleva) y sin origen_texto.
      expect(r.entregas[0].datos.destino_domicilio_id).toBeUndefined();
    });

    test('"Retiro de Proveedores" con Yrigoyen: origen null y aviso', () => {
      const r = traducir(pedidoP4({ cliente: 'CDM', tipo: 'Retiro de Proveedores', ...DIRECCION_PLANTA }), CAT);
      expect(r.ok).toBe(true);
      expect(r.pedido.datos).toMatchObject({ origen_domicilio_id: null, destino_domicilio_id: 'dom-yrigoyen' });
      expect(r.avisos.map(a => a.tipo)).toContain('origen_es_la_planta');
    });

    test('con los nombres viejos ("Retiro del cliente", "Retiro de proveedor") también', () => {
      ['Retiro del cliente', 'Retiro de proveedor'].forEach(tipo => {
        const r = traducir(pedidoP4({ cliente: 'CDM', tipo, ...DIRECCION_PLANTA }), CAT);
        expect(r.ok).toBe(true);
        expect(r.pedido.datos).toMatchObject({ legacy_tipo: tipo, origen_domicilio_id: null });
      });
    });

    test('"Entrega al cliente" con Yrigoyen: sinResolver ("la dirección del cliente es la de la planta")', () => {
      const r = traducir(pedidoP4({ cliente: 'CDM', tipo: 'Entrega al cliente', ...DIRECCION_PLANTA }), CAT);
      expect(r.ok).toBe(false);
      expect(r.sinResolver).toEqual([{
        tipo: 'domicilio',
        valor: 'YRIGOYEN 2933, PUERTO GRAL.SAN MARTIN, SANTA FE, S2200HWA',
        detalle: 'Organización: CDM — la dirección del cliente es la de la planta',
        organizacion_id: 'org-cdm',
      }]);
    });

    test('METHIL GROUP, que SÍ tiene Yrigoyen vinculado: igual origen null y aviso (la regla de la planta va primero)', () => {
      const r = traducir(pedidoP4({ cliente: 'METHIL GROUP', tipo: 'Entrega en planta', ...DIRECCION_PLANTA }), CAT);
      expect(r.ok).toBe(true);
      expect(r.pedido.datos.origen_domicilio_id).toBeNull();
      expect(r.avisos.map(a => a.tipo)).toContain('origen_es_la_planta');
    });

    test('el árbol queda completo y sin undefined, con el viaje sin origen_texto', () => {
      const legacy = pedidoP4({ cliente: 'CDM', tipo: 'Entrega en planta', ...DIRECCION_PLANTA });
      legacy.despachos[0] = { ...legacy.despachos[0], estado: 'Nominado', estado_chofer: 'recibido', estado_chofer_ts: '2026-07-01T10:00:00.000Z' };
      const r = traducir(legacy, CAT);
      expect(r.ok).toBe(true);
      expect(r.viajes[0].datos.origen_texto).toBe('');
      expect(r.viajes[0].datos.destino_texto).toBe('Yrigoyen 2933, Puerto General San Martín, Santa Fe, S2200HWA');
      const malos = [];
      const rec = (v, ruta) => {
        if (v === undefined) malos.push(ruta);
        else if (v && typeof v === 'object' && !(v instanceof Date)) Object.keys(v).forEach(k => rec(v[k], `${ruta}.${k}`));
      };
      rec(r, 'r');
      expect(malos).toEqual([]);
    });

    test('un pedido de "Entrega en planta" con la dirección REAL del cliente sigue usando su domicilio como origen', () => {
      const r = traducir(pedidoP4({ cliente: 'PRO CROP', tipo: 'Entrega en planta', ...DIRECCION_RIO }), CAT);
      expect(r.pedido.datos).toMatchObject({ origen_domicilio_id: 'dom-rio', destino_domicilio_id: 'dom-yrigoyen' });
      expect(r.avisos.map(a => a.tipo)).not.toContain('origen_es_la_planta');
    });
  });
});

describe('el cronograma ya cubre todo el pedido', () => {
  const crono = (n, vol = 1) => Array.from({ length: n }, (_, i) => ({
    nro: i + 1, volumen: vol, fecha_solicitada: `2026-07-${String(i + 1).padStart(2, '0')}`,
  }));
  // Como PED-260722-580 (30 = cronograma 30), en chico: 5 entregas de 2 tn.
  const cubreTodo = (extra) => legacyBase({
    volumen: 10, volumen_entrega1: undefined, fecha_entrega: '2026-09-14', cronograma: crono(5, 2),
    gps_track_1: undefined,
    despachos: [], ...extra,
  });

  test('las entregas salen solo del cronograma, con numero = nro, y fecha_entrega se ignora con aviso', () => {
    const r = traducir(cubreTodo());
    expect(r.ok).toBe(true);
    expect(r.entregas.map(e => e.datos.numero)).toEqual([1, 2, 3, 4, 5]);
    expect(r.entregas.map(e => e.datos.fecha_solicitada)).toEqual(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05']);
    expect(r.entregas.reduce((s, e) => s + e.datos.volumen, 0)).toBe(10);
    expect(r.entregas.map(e => e.datos.fecha_solicitada)).not.toContain('2026-09-14');
    expect(r.pedido.datos.entregas_total).toBe(5);
    const aviso = r.avisos.find(a => a.tipo === 'cronograma_cubre_el_pedido');
    expect(aviso.detalle).toContain('fecha_entrega (2026-09-14) se ignora');
  });

  test('los despachos con entrega_nro van a la entrega con ese número', () => {
    const r = traducir(cubreTodo({
      despachos: [
        { id: 'D1', entrega_nro: 1, volumen: 2, estado: 'Aceptado', fecha_carga: '2026-07-01', transporte: '—' },
        { id: 'D2', entrega_nro: 5, volumen: 2, estado: 'Aceptado', fecha_carga: '2026-07-05', transporte: '—' },
      ],
    }));
    expect(r.ok).toBe(true);
    expect(r.despachos.map(d => d.datos.entrega_id)).toEqual(['entrega:1', 'entrega:5']);
    expect(r.entregas.find(e => e.datos.numero === 5).datos.estado).toBe('programada');
  });

  test('los que no traen entrega_nro siguen las reglas del prompt 3 (Dn -> entrega n, con aviso)', () => {
    const r = traducir(cubreTodo({
      despachos: [{ id: 'D3', volumen: 2, estado: 'Aceptado', fecha_carga: '2026-07-03', transporte: '—' }],
    }));
    expect(r.ok).toBe(true);
    expect(r.despachos[0].datos.entrega_id).toBe('entrega:3');
    expect(r.avisos.map(a => a.tipo)).toContain('entrega_por_numero_de_despacho');
  });

  test('un entrega_nro que no existe va a sinResolver', () => {
    const r = traducir(cubreTodo({
      despachos: [{ id: 'D1', entrega_nro: 6, volumen: 2, estado: 'Aceptado', fecha_carga: '2026-07-01', transporte: '—' }],
    }));
    expect(tipos(r)).toEqual(['entrega']);
  });

  test('sin fecha_entrega tampoco frena: se ignora igual', () => {
    expect(traducir(cubreTodo({ fecha_entrega: '' })).ok).toBe(true);
  });

  test('si el resto da negativo sigue yendo a sinResolver', () => {
    const r = traducir(cubreTodo({ volumen: 8 }));         // cronograma 10 > 8
    expect(tipos(r)).toEqual(['volumen']);
    expect(r.sinResolver[0].detalle).toContain('negativo');
  });

  test('con volumen_entrega1 presente no se reinterpreta el cronograma (numero = nro + 1)', () => {
    const r = traducir(cubreTodo({ volumen_entrega1: 2, volumen: 12 }));
    expect(r.entregas.map(e => e.datos.numero)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.avisos.map(a => a.tipo)).not.toContain('cronograma_cubre_el_pedido');
  });
});
