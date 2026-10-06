/* =============================================================================
 * logica-ciclo-vida.test.js — v1.2.0 (RF-05)
 * Ver el encabezado de `logica-ciclo-vida.js` para SÍNTOMA/CAUSA
 * RAÍZ/ALCANCE/LIMITACIONES/CÓMO SE VERIFICA.
 * ========================================================================== */

import { armarCicloDeEntrega } from './logica-ciclo-vida';

/** Timestamp de Firestore, simulado -- todo lo que esta función necesita es
 * `.toDate()`. */
function ts(fechaHoraISO) {
  const d = new Date(fechaHoraISO);
  return { toDate: () => d };
}

const PEDIDO = { id: 'pedido-1', numero: 'PED-2026-000001' };

function entregaBase(overrides = {}) {
  return {
    id: 'entrega-1', pedido_id: 'pedido-1', numero: 1,
    volumen: 10, fecha_solicitada: '2026-09-20',
    estado: 'programada', creado_en: ts('2026-09-01T10:00:00'),
    ...overrides,
  };
}

describe('armarCicloDeEntrega — entrega sin ningún despacho', () => {
  test('arma la etapa 1 y deja el resto "Sin registro"', () => {
    const r = armarCicloDeEntrega({
      entrega: entregaBase(), pedido: PEDIDO, despachos: [], viajes: [], historial: [],
    });

    expect(r.etapas).toHaveLength(8);
    expect(r.etapas[0].id).toBe('entrega_solicitada');
    expect(r.etapas[0].ts).toEqual(new Date('2026-09-01T10:00:00'));
    r.etapas.slice(1).forEach(e => {
      expect(e.ts).toBeNull();
      expect(e.quien).toBeNull();
    });
    expect(r.ramasCerradas).toEqual([]);
    expect(r.etapaActual.id).toBe('entrega_solicitada');
    expect(r.marcas).toEqual({});
  });
});

describe('armarCicloDeEntrega — despacho sin campos denormalizados (pre-v2)', () => {
  test('no rompe: esta función nunca lee los denormalizados', () => {
    const despacho = {
      id: 'desp-1', pedido_id: 'pedido-1', entrega_id: 'entrega-1', numero: 'D1',
      estado: 'ASIGNADO', creado_en: ts('2026-09-02T09:00:00'),
      transportista_org_id: 'org-transp',
      // Sin cliente_razon_social / producto_nombre / etc -- despacho viejo.
    };

    const historial = [
      { entidad_tipo: 'despacho', entidad_id: 'desp-1', pedido_id: 'pedido-1', accion: 'aceptar_entrega', usuario_nombre: 'Coordi Uno', ts: ts('2026-09-02T09:00:00'), derivado: false },
    ];

    const r = armarCicloDeEntrega({
      entrega: entregaBase(), pedido: PEDIDO, despachos: [despacho], viajes: [], historial,
    });

    const etapaDespacho = r.etapas.find(e => e.id === 'despacho_creado');
    expect(etapaDespacho.ts).toEqual(new Date('2026-09-02T09:00:00'));
    expect(etapaDespacho.quien).toBe('Coordi Uno');

    // Se asignó transportista al crear -- misma fuente que "despacho creado".
    const etapaAsignado = r.etapas.find(e => e.id === 'transporte_asignado');
    expect(etapaAsignado.ts).toEqual(new Date('2026-09-02T09:00:00'));
  });
});

describe('armarCicloDeEntrega — viaje cerrado a mano desde RECIBIDO', () => {
  test('En viaje queda "Sin registro" y se marca sinInicio + cierreManual', () => {
    const despacho = {
      id: 'desp-1', entrega_id: 'entrega-1', numero: 'D1', estado: 'ENTREGADO',
      creado_en: ts('2026-09-02T09:00:00'), estado_ts: ts('2026-09-05T14:00:00'),
      transportista_org_id: 'org-transp',
    };
    const viaje = {
      id: 'viaje-1', despacho_id: 'desp-1', estado: 'FINALIZADO',
      creado_en: ts('2026-09-03T08:00:00'),
      inicio_ts: null,
      fin_ts: ts('2026-09-05T14:00:00'),
      cerrado_por: 'manual', cierre_motivo: 'El chofer no usa la app',
      demorado: false,
    };
    const historial = [
      { entidad_tipo: 'despacho', entidad_id: 'desp-1', accion: 'nominar', usuario_nombre: 'Transportista X', ts: ts('2026-09-03T08:00:00'), derivado: false },
      { entidad_tipo: 'viaje', entidad_id: 'viaje-1', accion: 'cerrar_viaje_manual', usuario_nombre: 'Coordi Dos', ts: ts('2026-09-05T14:00:00'), derivado: false },
      { entidad_tipo: 'viaje', entidad_id: 'viaje-1', accion: 'crear_viaje', usuario_nombre: 'Transportista X', ts: ts('2026-09-03T08:00:00'), derivado: true },
    ];

    const r = armarCicloDeEntrega({
      entrega: entregaBase(), pedido: PEDIDO, despachos: [despacho], viajes: [viaje], historial,
    });

    const etapaEnViaje = r.etapas.find(e => e.id === 'en_viaje');
    expect(etapaEnViaje.ts).toBeNull();
    expect(etapaEnViaje.fuente).toBe('sin_registro');

    const etapaRecibido = r.etapas.find(e => e.id === 'viaje_recibido');
    expect(etapaRecibido.ts).toEqual(new Date('2026-09-03T08:00:00'));
    // "Quién" del viaje recibido sale de "nominar", no del `crear_viaje`
    // derivado (que se excluye).
    expect(etapaRecibido.quien).toBe('Transportista X');

    const etapaEntregado = r.etapas.find(e => e.id === 'entregado');
    expect(etapaEntregado.ts).toEqual(new Date('2026-09-05T14:00:00'));
    expect(etapaEntregado.quien).toBe('Coordi Dos');

    expect(r.marcas.sinInicio).toBe(true);
    expect(r.marcas.cierreManual).toEqual({ motivo: 'El chofer no usa la app', quien: 'Coordi Dos' });
  });
});

describe('armarCicloDeEntrega — rechazo seguido de un despacho nuevo', () => {
  test('el rechazado queda en ramasCerradas, el tronco es el vivo', () => {
    const rechazado = {
      id: 'desp-1', entrega_id: 'entrega-1', numero: 'D1', estado: 'RECHAZADO',
      creado_en: ts('2026-09-02T09:00:00'), estado_ts: ts('2026-09-02T15:00:00'),
      transportista_org_id: 'org-transp-1', rechazo_motivo: 'No tengo unidad disponible',
    };
    const nuevo = {
      id: 'desp-2', entrega_id: 'entrega-1', numero: 'D2', estado: 'ASIGNADO',
      creado_en: ts('2026-09-03T10:00:00'), transportista_org_id: 'org-transp-2',
    };
    const historial = [
      { entidad_tipo: 'despacho', entidad_id: 'desp-1', accion: 'aceptar_entrega', usuario_nombre: 'Coordi', ts: ts('2026-09-02T09:00:00'), derivado: false },
      { entidad_tipo: 'despacho', entidad_id: 'desp-1', accion: 'rechazar_despacho', usuario_nombre: 'Transportista 1', ts: ts('2026-09-02T15:00:00'), derivado: false, razon: 'No tengo unidad disponible' },
      { entidad_tipo: 'despacho', entidad_id: 'desp-2', accion: 'aceptar_entrega', usuario_nombre: 'Coordi', ts: ts('2026-09-03T10:00:00'), derivado: false },
    ];

    const r = armarCicloDeEntrega({
      entrega: entregaBase(), pedido: PEDIDO, despachos: [rechazado, nuevo], viajes: [], historial,
    });

    expect(r.ramasCerradas).toHaveLength(1);
    expect(r.ramasCerradas[0].despachoId).toBe('desp-1');
    expect(r.ramasCerradas[0].estado).toBe('RECHAZADO');
    expect(r.ramasCerradas[0].motivo).toBe('No tengo unidad disponible');
    expect(r.ramasCerradas[0].quien).toBe('Transportista 1');

    // El tronco (etapas principales) usa el despacho VIVO (desp-2).
    const etapaDespacho = r.etapas.find(e => e.id === 'despacho_creado');
    expect(etapaDespacho.ts).toEqual(new Date('2026-09-03T10:00:00'));
  });
});

describe('armarCicloDeEntrega — suspensión seguida de reactivación', () => {
  test('las dos marcas quedan presentes', () => {
    const historial = [
      { entidad_tipo: 'entrega', entidad_id: 'entrega-1', accion: 'suspender_entrega', usuario_nombre: 'Comercial Uno', ts: ts('2026-09-05T11:00:00'), derivado: false, razon: 'Cliente pidió correr la fecha' },
      { entidad_tipo: 'entrega', entidad_id: 'entrega-1', accion: 'reactivar_entrega', usuario_nombre: 'Comercial Uno', ts: ts('2026-09-06T09:00:00'), derivado: false },
    ];

    const r = armarCicloDeEntrega({
      entrega: entregaBase(), pedido: PEDIDO, despachos: [], viajes: [], historial,
    });

    expect(r.marcas.suspendida).toEqual({
      ts: new Date('2026-09-05T11:00:00'), quien: 'Comercial Uno', motivo: 'Cliente pidió correr la fecha',
    });
    expect(r.marcas.reactivada).toEqual({ ts: new Date('2026-09-06T09:00:00'), quien: 'Comercial Uno' });
  });
});

describe('armarCicloDeEntrega — duraciones y etapa actual', () => {
  test('un ciclo completo sin problemas: cada etapa con fecha y duraciones coherentes', () => {
    const despacho = {
      id: 'desp-1', entrega_id: 'entrega-1', numero: 'D1', estado: 'ENTREGADO',
      creado_en: ts('2026-09-02T09:00:00'), transportista_org_id: 'org-transp',
    };
    const viaje = {
      id: 'viaje-1', despacho_id: 'desp-1', estado: 'FINALIZADO',
      creado_en: ts('2026-09-04T08:00:00'),
      inicio_ts: ts('2026-09-05T07:00:00'),
      fin_ts: ts('2026-09-05T18:00:00'),
      cerrado_por: 'chofer', cierre_motivo: null, demorado: false,
    };
    const historial = [
      { entidad_tipo: 'despacho', entidad_id: 'desp-1', accion: 'aceptar_entrega', usuario_nombre: 'Coordi', ts: ts('2026-09-02T09:00:00'), derivado: false },
      { entidad_tipo: 'despacho', entidad_id: 'desp-1', accion: 'asignar_transportista', usuario_nombre: 'Coordi', ts: ts('2026-09-02T09:30:00'), derivado: false },
      { entidad_tipo: 'despacho', entidad_id: 'desp-1', accion: 'aceptar_despacho', usuario_nombre: 'Transportista', ts: ts('2026-09-03T09:00:00'), derivado: false },
      { entidad_tipo: 'despacho', entidad_id: 'desp-1', accion: 'nominar', usuario_nombre: 'Transportista', ts: ts('2026-09-04T08:00:00'), derivado: false },
      { entidad_tipo: 'viaje', entidad_id: 'viaje-1', accion: 'iniciar_viaje', usuario_nombre: 'Chofer', ts: ts('2026-09-05T07:00:00'), derivado: false },
      { entidad_tipo: 'viaje', entidad_id: 'viaje-1', accion: 'finalizar_viaje', usuario_nombre: 'Chofer', ts: ts('2026-09-05T18:00:00'), derivado: false },
    ];

    const ahora = new Date('2026-09-10T00:00:00');
    const r = armarCicloDeEntrega({
      entrega: entregaBase(), pedido: PEDIDO, despachos: [despacho], viajes: [viaje], historial, ahora,
    });

    r.etapas.forEach(e => expect(e.ts).not.toBeNull());
    expect(r.etapaActual.id).toBe('entregado');
    expect(r.diasEnEtapaActual).toBe(4); // de las 18hs del 5/9 a las 00hs del 10/9 -> 4 días y pico

    const etapaEnViaje = r.etapas.find(e => e.id === 'en_viaje');
    expect(etapaEnViaje.duracionDesdeAnteriorMs).toBe(
      new Date('2026-09-05T07:00:00').getTime() - new Date('2026-09-04T08:00:00').getTime()
    );
  });
});
