/* =============================================================================
 * logica-viajes-seguimiento.test.js — TrackEx v1.1.2 — GPS
 * Ver el bloque "TrackEx v1.1.2 — GPS" de `shared/logica-viajes.js` para
 * SÍNTOMA/CAUSA RAÍZ/ALCANCE/LIMITACIONES/CÓMO SE VERIFICA.
 *
 * Reproduce el caso C del 24/11/2026: un teléfono sin permiso de segundo
 * plano tiene que quedar `limitado`, no pasar por completo ni quedar sin dato.
 * Solo funciones puras (sin Firestore).
 * ========================================================================== */

import {
  cambiosEstadoSeguimiento, estadoSeguimiento, ETIQUETA_SEGUIMIENTO, COLOR_SEGUIMIENTO,
} from './logica-viajes';

const TODO = {
  permisoUbicacion: true, permisoSegundoPlano: true, notificaciones: true, servicioActivo: true, versionApp: '1.1.2',
};

describe('cambiosEstadoSeguimiento', () => {
  test('completo: las cuatro cosas, con todos los campos', () => {
    expect(cambiosEstadoSeguimiento(TODO)).toEqual({
      seguimiento_estado: 'completo',
      seguimiento_permiso_ubicacion: true,
      seguimiento_permiso_segundo_plano: true,
      seguimiento_notificaciones: true,
      seguimiento_servicio: true,
      seguimiento_version_app: '1.1.2',
    });
  });

  test.each([
    ['permisoSegundoPlano'],
    ['notificaciones'],
    ['servicioActivo'],
  ])('limitado: con ubicación pero sin %s', (falta) => {
    expect(cambiosEstadoSeguimiento({ ...TODO, [falta]: false }).seguimiento_estado).toBe('limitado');
  });

  test('limitado: cada combinación de faltantes con permiso de ubicación', () => {
    const claves = ['permisoSegundoPlano', 'notificaciones', 'servicioActivo'];
    for (let mascara = 0; mascara < 8; mascara += 1) {
      const estado = { ...TODO };
      claves.forEach((c, i) => { estado[c] = Boolean(mascara & (1 << i)); });
      const esperado = mascara === 7 ? 'completo' : 'limitado';
      expect(cambiosEstadoSeguimiento(estado).seguimiento_estado).toBe(esperado);
    }
  });

  test('sin_ubicacion: sin permiso de ubicación, aunque tenga lo demás', () => {
    expect(cambiosEstadoSeguimiento({ ...TODO, permisoUbicacion: false }).seguimiento_estado).toBe('sin_ubicacion');
    expect(cambiosEstadoSeguimiento({ versionApp: '1.1.2' })).toMatchObject({
      seguimiento_estado: 'sin_ubicacion',
      seguimiento_permiso_ubicacion: false,
      seguimiento_servicio: false,
    });
  });

  test('los booleanos son booleanos y la versión es string', () => {
    const r = cambiosEstadoSeguimiento({ permisoUbicacion: 'si', versionApp: undefined });
    expect(r.seguimiento_permiso_ubicacion).toBe(false);
    expect(r.seguimiento_version_app).toBe('');
  });
});

describe('estadoSeguimiento', () => {
  test('no_corresponde: viaje que no está EN_VIAJE, o sin viaje', () => {
    expect(estadoSeguimiento(null)).toBe('no_corresponde');
    expect(estadoSeguimiento({ estado: 'RECIBIDO', seguimiento_estado: 'completo' })).toBe('no_corresponde');
    expect(estadoSeguimiento({ estado: 'FINALIZADO', seguimiento_estado: 'limitado' })).toBe('no_corresponde');
  });

  test('desconocido: viaje iniciado por una app ≤ 1.1.1', () => {
    expect(estadoSeguimiento({ estado: 'EN_VIAJE' })).toBe('desconocido');
  });

  test.each(['completo', 'limitado', 'sin_ubicacion'])('guardado: %s', (valor) => {
    expect(estadoSeguimiento({ estado: 'EN_VIAJE', seguimiento_estado: valor })).toBe(valor);
  });

  test('etiquetas y colores para todos los estados', () => {
    expect(ETIQUETA_SEGUIMIENTO).toMatchObject({
      completo: 'seguimiento completo',
      limitado: 'seguimiento limitado',
      sin_ubicacion: 'sin permiso de ubicación',
      desconocido: 'versión anterior de la app',
    });
    for (const e of ['completo', 'limitado', 'sin_ubicacion', 'desconocido']) {
      expect(COLOR_SEGUIMIENTO[e]).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});
