import {
  iniciales, verificarCuit, calcularFicha, formatearUltimaModificacion, detectarDuplicados,
} from './logica-ficha-organizacion';

describe('iniciales', () => {
  test('dos palabras', () => expect(iniciales('TRANSPORTE G&G')).toBe('TG'));
  test('vacío', () => expect(iniciales('')).toBe('?'));
});

describe('verificarCuit', () => {
  test('vacío', () => expect(verificarCuit('').estado).toBe('vacio'));
  test('incompleto', () => expect(verificarCuit('123').estado).toBe('incompleto'));
  test('válido', () => expect(verificarCuit('20-25505747-3').estado).toBe('ok'));
  test('dígito verificador malo: advierte', () => expect(verificarCuit('20-25505747-4').estado).toBe('advertencia'));
});

describe('calcularFicha', () => {
  const base = { razon_social: 'ACME', cuit: '20-25505747-3', es_exterior: false, telefono: '' };
  test('solo cuentan Usuarios y Productos si aplican', () => {
    const cant = { domicilios: 1, correos: 1, usuarios: 0, productos: 0 };
    const cliente = calcularFicha({ form: base, cantidades: cant, aplican: { usuarios: false, productos: false } });
    expect(cliente.items).toHaveLength(4);
    expect(cliente.porcentaje).toBe(75);
    const transporte = calcularFicha({ form: base, cantidades: cant, aplican: { usuarios: true, productos: true } });
    expect(transporte.items).toHaveLength(6);
    expect(transporte.porcentaje).toBe(50);
  });
});

describe('formatearUltimaModificacion', () => {
  test('Timestamp de Firestore (con toDate)', () => {
    const ts = { toDate: () => new Date(2026, 9, 2, 15, 8) };
    const txt = formatearUltimaModificacion(ts, new Date(2026, 9, 16, 12, 0));
    expect(txt).toContain('hace 13 días');
    expect(txt).toContain('02/10/2026');
    expect(txt).toContain('15:08');
  });
  test('valor inválido nunca imprime el objeto', () => {
    expect(formatearUltimaModificacion({ foo: 1 })).toBe('Última modificación: —');
    expect(formatearUltimaModificacion(null)).toBe('Última modificación: —');
  });
});

describe('detectarDuplicados', () => {
  test('mismo nombre normalizado', () => {
    const ids = detectarDuplicados([
      { id: 'a', nombre: 'Vargas German' }, { id: 'b', nombre: 'vargas  german' }, { id: 'c', nombre: 'Otro' },
    ]);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });
  test('mismo DNI', () => {
    const ids = detectarDuplicados([
      { id: 'a', nombre: 'X', datos_chofer: { dni: '1' } }, { id: 'b', nombre: 'Y', datos_chofer: { dni: '1' } },
    ]);
    expect(ids.size).toBe(2);
  });
});
