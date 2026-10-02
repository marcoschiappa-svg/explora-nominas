/* =============================================================================
 * alta-usuarios.test.js — Tests de validarAltaUsuario (Portal Explora)
 * =============================================================================
 *
 * v1.2.0 (RF-03) — Ver el encabezado v1.2.0 (RF-03) de `alta-usuarios.js`.
 * Cubre `validarAltaUsuario()`, que es pura -- no se testea `darDeAltaUsuario`
 * acá porque toca Firebase Auth/Firestore de verdad (`crearCuenta`/`crear`),
 * fuera de lo que Jest de CRA puede correr sin mockear el SDK entero.
 *
 * Corre con `CI=true npm test -- alta-usuarios`.
 * ========================================================================== */

import { validarAltaUsuario } from './alta-usuarios';

function datosChofer(extra = {}) {
  return {
    nombre: 'CABALLERO, WALTER ROMAN',
    roles: ['chofer'],
    organizacion_id: 'org1',
    dni: '25505747',
    cuit: '',
    ...extra,
  };
}

describe('validarAltaUsuario — chofer', () => {
  test('datos válidos -- sin problemas', () => {
    expect(validarAltaUsuario(datosChofer())).toEqual([]);
  });

  test('sin nombre', () => {
    expect(validarAltaUsuario(datosChofer({ nombre: '  ' })))
      .toContain('El nombre es obligatorio.');
  });

  test('sin roles', () => {
    expect(validarAltaUsuario(datosChofer({ roles: [] })))
      .toContain('Elegí al menos un rol.');
  });

  test('sin DNI -- alta nueva', () => {
    expect(validarAltaUsuario(datosChofer({ dni: '' })))
      .toContain('El DNI es obligatorio para un chofer.');
  });

  test('sin DNI -- editando (se le agrega el rol chofer)', () => {
    const problemas = validarAltaUsuario(datosChofer({ dni: '' }), { editando: { id: 'u1' } });
    expect(problemas).toContain('Para agregarle el rol chofer hay que cargarle el DNI.');
  });

  test('DNI de menos de 7 dígitos', () => {
    expect(validarAltaUsuario(datosChofer({ dni: '12345' })))
      .toContain('El DNI tiene que tener 7 u 8 dígitos.');
  });

  test('DNI de más de 8 dígitos', () => {
    expect(validarAltaUsuario(datosChofer({ dni: '123456789' })))
      .toContain('El DNI tiene que tener 7 u 8 dígitos.');
  });

  test('DNI con puntos/espacios -- se limpia antes de validar longitud', () => {
    expect(validarAltaUsuario(datosChofer({ dni: '25.505.747' }))).toEqual([]);
  });

  test('CUIT inválido', () => {
    expect(validarAltaUsuario(datosChofer({ cuit: '123' })))
      .toContain('El CUIT tiene que tener 11 dígitos.');
  });

  test('CUIT válido, con guiones', () => {
    expect(validarAltaUsuario(datosChofer({ cuit: '20-25505747-3' }))).toEqual([]);
  });

  test('CUIT vacío -- no es obligatorio', () => {
    expect(validarAltaUsuario(datosChofer({ cuit: '' }))).toEqual([]);
  });

  test('sin organización', () => {
    expect(validarAltaUsuario(datosChofer({ organizacion_id: '' })))
      .toContain('Elegí la organización.');
  });

  test('DNI repetido con otro usuario -- rechaza con el nombre del que ya lo tiene', () => {
    const contexto = {
      usuarios: [{ id: 'u9', nombre: 'Otro Chofer', datos_chofer: { dni: '25505747' } }],
    };
    const problemas = validarAltaUsuario(datosChofer(), contexto);
    expect(problemas).toContain('Ya hay un usuario con ese DNI: Otro Chofer.');
  });

  test('DNI repetido, pero es el mismo usuario en edición -- no rechaza', () => {
    const contexto = {
      usuarios: [{ id: 'u1', nombre: 'Yo Mismo', datos_chofer: { dni: '25505747' } }],
      editando: { id: 'u1' },
    };
    expect(validarAltaUsuario(datosChofer(), contexto)).toEqual([]);
  });
});

describe('validarAltaUsuario — no chofer (interno o transportista)', () => {
  function datosNoChofer(extra = {}) {
    return {
      nombre: 'Nueva Persona',
      roles: ['transportista'],
      organizacion_id: 'org1',
      email: 'persona@ejemplo.com',
      ...extra,
    };
  }

  test('sin correo -- alta nueva', () => {
    expect(validarAltaUsuario(datosNoChofer({ email: '' })))
      .toContain('El correo es obligatorio.');
  });

  test('sin correo -- editando, no lo exige (no se cambia el email al editar)', () => {
    const problemas = validarAltaUsuario(datosNoChofer({ email: '' }), { editando: { id: 'u1' } });
    expect(problemas).not.toContain('El correo es obligatorio.');
  });

  test('datos válidos -- sin problemas', () => {
    expect(validarAltaUsuario(datosNoChofer())).toEqual([]);
  });

  test('soloInternos -- invitación pendiente duplicada', () => {
    const contexto = {
      soloInternos: true,
      invitaciones: [{ id: 'persona@ejemplo.com' }],
    };
    const problemas = validarAltaUsuario(datosNoChofer(), contexto);
    expect(problemas).toContain('Ya hay una invitación pendiente para persona@ejemplo.com.');
  });

  test('soloInternos -- email ya usado por otro usuario', () => {
    const contexto = {
      soloInternos: true,
      usuarios: [{ id: 'u9', email: 'persona@ejemplo.com' }],
    };
    const problemas = validarAltaUsuario(datosNoChofer(), contexto);
    expect(problemas).toContain('Ya existe un usuario con ese email: persona@ejemplo.com.');
  });

  test('sin soloInternos -- no chequea invitaciones/usuarios aunque coincidan', () => {
    const contexto = {
      soloInternos: false,
      invitaciones: [{ id: 'persona@ejemplo.com' }],
      usuarios: [{ id: 'u9', email: 'persona@ejemplo.com' }],
    };
    expect(validarAltaUsuario(datosNoChofer(), contexto)).toEqual([]);
  });
});
