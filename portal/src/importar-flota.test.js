/* =============================================================================
 * importar-flota.test.js — Tests de importar-flota.js y de validarUnidad
 * (Portal Explora)
 * =============================================================================
 *
 * v1.2.0 (RF-04) — Ver el encabezado v1.2.0 (RF-04) de `importar-flota.js`.
 * Corre con `CI=true npm test -- importar-flota`.
 *
 * Cubre, como mínimo exigido por el prompt de la tarea:
 *   - interpretarPlanilla: fila nueva, existente, con error, DNI y patente
 *     repetidos dentro del archivo, hoja vacía, hoja con más de 100 filas,
 *     columnas leídas por posición aunque cambien los encabezados.
 *   - validarUnidad: formatos de patente, repetida activa e inactiva.
 * ========================================================================== */

import { interpretarPlanilla, interpretarHojaChoferes, interpretarHojaUnidad, PRIMERA_FILA_DATOS } from './importar-flota';
import { validarUnidad } from './logica-flota';

/* -----------------------------------------------------------------------------
 * Helpers para armar una matriz cruda como la devuelve
 * XLSX.utils.sheet_to_json(hoja, { header: 1 }): filas 1-2 título/
 * instrucciones, fila 3 encabezados, fila 4 ejemplo, datos desde la 5.
 * -------------------------------------------------------------------------- */

function matrizChoferes(filas, encabezados = ['Nombre y apellido', 'DNI', 'CUIT', 'Teléfono']) {
  return [
    ['Planilla de choferes'],
    ['Completar desde la fila 5'],
    encabezados,
    ['Ejemplo, Perez Juan', '30111222', '20301112223', '3476123456'],
    ...filas,
  ];
}

function matrizUnidad(filas, encabezados = ['Patente', 'Observaciones']) {
  return [
    ['Planilla de unidades'],
    ['Completar desde la fila 5'],
    encabezados,
    ['AB123CD', 'Ejemplo'],
    ...filas,
  ];
}

const ORG = 'org1';

describe('interpretarHojaChoferes', () => {
  test('fila nueva', () => {
    const { filas, error } = interpretarHojaChoferes(
      matrizChoferes([['Gómez, Ana', '30222333', '', '3476111222']]),
      { organizacion_id: ORG, usuarios: [] }
    );
    expect(error).toBeNull();
    expect(filas).toHaveLength(1);
    expect(filas[0].estado).toBe('nueva');
    expect(filas[0].datos.dni).toBe('30222333');
    expect(filas[0].numeroFila).toBe(PRIMERA_FILA_DATOS);
  });

  test('fila existente -- DNI ya cargado, no es error', () => {
    const usuarios = [{ id: 'u1', datos_chofer: { dni: '30222333' } }];
    const { filas } = interpretarHojaChoferes(
      matrizChoferes([['Gómez, Ana', '30222333', '', '']]),
      { organizacion_id: ORG, usuarios }
    );
    expect(filas[0].estado).toBe('existente');
    expect(filas[0].errores).toEqual([]);
  });

  test('fila existente -- también si el usuario está inactivo (no distingue)', () => {
    const usuarios = [{ id: 'u1', estado: 'inactivo', datos_chofer: { dni: '30222333' } }];
    const { filas } = interpretarHojaChoferes(
      matrizChoferes([['Gómez, Ana', '30222333', '', '']]),
      { organizacion_id: ORG, usuarios }
    );
    expect(filas[0].estado).toBe('existente');
  });

  test('fila con error -- sin nombre', () => {
    const { filas } = interpretarHojaChoferes(
      matrizChoferes([['', '30222333', '', '']]),
      { organizacion_id: ORG, usuarios: [] }
    );
    expect(filas[0].estado).toBe('error');
    expect(filas[0].errores).toContain('El nombre es obligatorio.');
  });

  test('fila con error -- DNI corto', () => {
    const { filas } = interpretarHojaChoferes(
      matrizChoferes([['Gómez, Ana', '123', '', '']]),
      { organizacion_id: ORG, usuarios: [] }
    );
    expect(filas[0].estado).toBe('error');
    expect(filas[0].errores).toContain('El DNI tiene que tener 7 u 8 dígitos.');
  });

  test('DNI repetido DENTRO del archivo -- la primera queda bien, la segunda es error', () => {
    const { filas } = interpretarHojaChoferes(
      matrizChoferes([
        ['Gómez, Ana', '30222333', '', ''],
        ['Otro Chofer', '30222333', '', ''],
      ]),
      { organizacion_id: ORG, usuarios: [] }
    );
    expect(filas[0].estado).toBe('nueva');
    expect(filas[1].estado).toBe('error');
    expect(filas[1].errores.some(e => e.includes('repetido'))).toBe(true);
  });

  test('hoja vacía (sin filas de datos) -- no es error', () => {
    const { filas, error } = interpretarHojaChoferes(matrizChoferes([]), { organizacion_id: ORG });
    expect(error).toBeNull();
    expect(filas).toEqual([]);
  });

  test('hoja ausente (undefined) -- no es error', () => {
    const { filas, error } = interpretarHojaChoferes(undefined, { organizacion_id: ORG });
    expect(error).toBeNull();
    expect(filas).toEqual([]);
  });

  test('hoja con más de 100 filas -- se rechaza entera', () => {
    const filasDeMas = Array.from({ length: 101 }, (_, i) => [`Chofer ${i}`, `3000000${String(i).padStart(2, '0')}`, '', '']);
    const { filas, error } = interpretarHojaChoferes(matrizChoferes(filasDeMas), { organizacion_id: ORG });
    expect(filas).toEqual([]);
    expect(error).toMatch(/101 filas/);
  });

  test('exactamente 100 filas -- no se rechaza', () => {
    const cien = Array.from({ length: 100 }, (_, i) => [`Chofer ${i}`, `3000000${String(i).padStart(2, '0')}`, '', '']);
    const { filas, error } = interpretarHojaChoferes(matrizChoferes(cien), { organizacion_id: ORG });
    expect(error).toBeNull();
    expect(filas).toHaveLength(100);
  });

  test('columnas se leen por POSICIÓN, aunque cambien los encabezados de la fila 3', () => {
    const { filas } = interpretarHojaChoferes(
      matrizChoferes(
        [['Pérez, Juan', '30333444', '', '']],
        ['Apellido y nombre (cambiado)', 'Documento', 'CUIT/CUIL', 'Cel']  // encabezados distintos
      ),
      { organizacion_id: ORG }
    );
    // Sigue leyendo columna 0 = nombre, columna 1 = DNI -- por posición, no
    // por el texto del encabezado.
    expect(filas[0].datos.nombre).toBe('Pérez, Juan');
    expect(filas[0].datos.dni).toBe('30333444');
  });
});

describe('interpretarHojaUnidad', () => {
  test('fila nueva -- tractor', () => {
    const { filas } = interpretarHojaUnidad(
      matrizUnidad([['AC456DE', 'Obs']]), 'tractor', { organizacion_id: ORG, camiones: [] }
    );
    expect(filas[0].estado).toBe('nueva');
    expect(filas[0].datos.tipo).toBe('tractor');
    expect(filas[0].datos.patente).toBe('AC456DE');
  });

  test('fila existente -- patente ya cargada, activa', () => {
    const camiones = [{ id: 'c1', tipo: 'tractor', organizacion_id: ORG, patente: 'AC456DE', estado: 'activo' }];
    const { filas } = interpretarHojaUnidad(
      matrizUnidad([['AC456DE', '']]), 'tractor', { organizacion_id: ORG, camiones }
    );
    expect(filas[0].estado).toBe('existente');
    expect(filas[0].errores).toEqual([]);
  });

  test('fila existente -- patente ya cargada, inactiva (también existente, no error)', () => {
    const camiones = [{ id: 'c1', tipo: 'tractor', organizacion_id: ORG, patente: 'AC456DE', estado: 'inactivo' }];
    const { filas } = interpretarHojaUnidad(
      matrizUnidad([['AC456DE', '']]), 'tractor', { organizacion_id: ORG, camiones }
    );
    expect(filas[0].estado).toBe('existente');
  });

  test('fila con error -- patente sin formato válido', () => {
    const { filas } = interpretarHojaUnidad(
      matrizUnidad([['12345', '']]), 'tractor', { organizacion_id: ORG, camiones: [] }
    );
    expect(filas[0].estado).toBe('error');
  });

  test('fila con error -- patente vacía', () => {
    const { filas } = interpretarHojaUnidad(
      matrizUnidad([['', 'sin patente']]), 'tractor', { organizacion_id: ORG, camiones: [] }
    );
    expect(filas[0].estado).toBe('error');
  });

  test('patente repetida DENTRO del archivo -- segunda fila es error', () => {
    const { filas } = interpretarHojaUnidad(
      matrizUnidad([['AC456DE', ''], ['AC456DE', '']]), 'tractor', { organizacion_id: ORG, camiones: [] }
    );
    expect(filas[0].estado).toBe('nueva');
    expect(filas[1].estado).toBe('error');
    expect(filas[1].errores.some(e => e.includes('repetida'))).toBe(true);
  });

  test('la misma patente en tractor y acoplado no es conflicto (tipos distintos)', () => {
    const camiones = [{ id: 'c1', tipo: 'tractor', organizacion_id: ORG, patente: 'AC456DE', estado: 'activo' }];
    const { filas } = interpretarHojaUnidad(
      matrizUnidad([['AC456DE', '']]), 'acoplado', { organizacion_id: ORG, camiones }
    );
    expect(filas[0].estado).toBe('nueva');
  });

  test('hoja vacía -- no es error', () => {
    const { filas, error } = interpretarHojaUnidad(matrizUnidad([]), 'tractor', { organizacion_id: ORG });
    expect(error).toBeNull();
    expect(filas).toEqual([]);
  });

  test('hoja con más de 100 filas -- se rechaza entera', () => {
    const demas = Array.from({ length: 105 }, (_, i) => [`AA${String(i).padStart(3, '0')}AA`, '']);
    const { filas, error } = interpretarHojaUnidad(matrizUnidad(demas), 'acoplado', { organizacion_id: ORG });
    expect(filas).toEqual([]);
    expect(error).toMatch(/105 filas/);
  });

  test('columnas por posición -- encabezados distintos no cambian qué se lee', () => {
    const { filas } = interpretarHojaUnidad(
      matrizUnidad([['AC456DE', 'una obs']], ['Dominio', 'Notas']), 'tractor', { organizacion_id: ORG }
    );
    expect(filas[0].datos.patente).toBe('AC456DE');
    expect(filas[0].datos.obs).toBe('una obs');
  });
});

describe('interpretarPlanilla -- las tres hojas juntas', () => {
  test('combina choferes, tractores y acoplados en un solo resultado', () => {
    const resultado = interpretarPlanilla({
      choferes: matrizChoferes([['Gómez, Ana', '30222333', '', '']]),
      tractores: matrizUnidad([['AC456DE', '']]),
      acoplados: matrizUnidad([['AD789FG', '']]),
    }, { organizacion_id: ORG, usuarios: [], camiones: [] });

    expect(resultado.choferes.filas).toHaveLength(1);
    expect(resultado.tractores.filas).toHaveLength(1);
    expect(resultado.acoplados.filas).toHaveLength(1);
    expect(resultado.tractores.filas[0].datos.tipo).toBe('tractor');
    expect(resultado.acoplados.filas[0].datos.tipo).toBe('acoplado');
  });

  test('hojas ausentes en el objeto -- no rompe, cada una queda vacía', () => {
    const resultado = interpretarPlanilla({}, { organizacion_id: ORG });
    expect(resultado.choferes.filas).toEqual([]);
    expect(resultado.tractores.filas).toEqual([]);
    expect(resultado.acoplados.filas).toEqual([]);
  });

  test('una hoja rechazada por exceder el máximo no afecta a las otras', () => {
    const demas = Array.from({ length: 101 }, (_, i) => [`Chofer ${i}`, `3000000${String(i).padStart(2, '0')}`, '', '']);
    const resultado = interpretarPlanilla({
      choferes: matrizChoferes(demas),
      tractores: matrizUnidad([['AC456DE', '']]),
    }, { organizacion_id: ORG });

    expect(resultado.choferes.error).not.toBeNull();
    expect(resultado.tractores.error).toBeNull();
    expect(resultado.tractores.filas).toHaveLength(1);
  });
});

/* -----------------------------------------------------------------------------
 * validarUnidad -- formatos de patente, repetida activa e inactiva. Vive en
 * logica-flota.js, pero se testea acá porque importar-flota.js es lo que la
 * ejercita para el importador (ver el prompt de la tarea, que no pide un
 * archivo logica-flota.test.js aparte).
 * -------------------------------------------------------------------------- */

describe('validarUnidad', () => {
  test('formato viejo (ABC123) -- válido', () => {
    expect(validarUnidad({ tipo: 'tractor', patente: 'ABC123', organizacion_id: ORG })).toEqual([]);
  });

  test('formato Mercosur (AB123CD) -- válido', () => {
    expect(validarUnidad({ tipo: 'tractor', patente: 'AB123CD', organizacion_id: ORG })).toEqual([]);
  });

  test('formato inválido', () => {
    const problemas = validarUnidad({ tipo: 'tractor', patente: '12AB34', organizacion_id: ORG });
    expect(problemas).toContain('La patente no tiene un formato válido. Se espera ABC123 o AB123CD.');
  });

  test('patente con espacios y guiones se normaliza antes de validar', () => {
    expect(validarUnidad({ tipo: 'tractor', patente: 'ab-123 cd', organizacion_id: ORG })).toEqual([]);
  });

  test('sin patente', () => {
    expect(validarUnidad({ tipo: 'tractor', patente: '', organizacion_id: ORG }))
      .toContain('La patente del tractor es obligatoria.');
  });

  test('sin organización', () => {
    expect(validarUnidad({ tipo: 'acoplado', patente: 'AB123CD', organizacion_id: '' }))
      .toContain('Elegí la empresa de transporte.');
  });

  test('patente repetida y ACTIVA -- mensaje específico', () => {
    const camiones = [{ id: 'c1', tipo: 'tractor', organizacion_id: ORG, patente: 'AB123CD', estado: 'activo' }];
    const problemas = validarUnidad({ tipo: 'tractor', patente: 'AB123CD', organizacion_id: ORG }, { camiones });
    expect(problemas).toContain('Esa empresa ya tiene un tractor con esa patente.');
  });

  test('patente repetida e INACTIVA -- mensaje distinto, sugiere reactivar', () => {
    const camiones = [{ id: 'c1', tipo: 'tractor', organizacion_id: ORG, patente: 'AB123CD', estado: 'inactivo' }];
    const problemas = validarUnidad({ tipo: 'tractor', patente: 'AB123CD', organizacion_id: ORG }, { camiones });
    expect(problemas).toContain('Esa empresa tiene un tractor inactivo con esa patente. Reactivalo en vez de crear otro.');
  });

  test('editando la propia unidad -- no se cuenta a sí misma como repetida', () => {
    const camiones = [{ id: 'c1', tipo: 'tractor', organizacion_id: ORG, patente: 'AB123CD', estado: 'activo' }];
    const problemas = validarUnidad(
      { tipo: 'tractor', patente: 'AB123CD', organizacion_id: ORG },
      { camiones, editando: { id: 'c1' } }
    );
    expect(problemas).toEqual([]);
  });

  test('omitirDuplicado -- no agrega el mensaje aunque haya una repetida', () => {
    const camiones = [{ id: 'c1', tipo: 'tractor', organizacion_id: ORG, patente: 'AB123CD', estado: 'activo' }];
    const problemas = validarUnidad(
      { tipo: 'tractor', patente: 'AB123CD', organizacion_id: ORG },
      { camiones, omitirDuplicado: true }
    );
    expect(problemas).toEqual([]);
  });
});
