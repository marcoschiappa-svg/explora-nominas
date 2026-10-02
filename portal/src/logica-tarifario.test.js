/* =============================================================================
 * logica-tarifario.test.js — v1.2.0 (RF-09b)
 * =============================================================================
 *
 * Cubre SOLO las partes puras de `logica-tarifario.js`: la clave de una ruta,
 * la validación (incluida la unicidad sobre una lista dada), el armado de los
 * documentos y el mapeo de versiones viejas por `legacy.idx`.
 *
 * Lo que toca Firestore (`crearRutaParametro`, `aprobarPendientes`,
 * `restaurarVersion`…) NO se testea acá: necesitaría el emulador. Se verifica
 * a mano en staging con la lista de pruebas del CHANGELOG v1.2.0.
 *
 * Ver el encabezado de `logica-tarifario.js` para SÍNTOMA/CAUSA
 * RAÍZ/ALCANCE/LIMITACIONES/CÓMO SE VERIFICA.
 *
 * v1.2.0 (RF-09, NuevoTarifario) — se ajusta a los renombres de
 * `logica-tarifario.js` (`rutasReferencia`→`rutasDerivadas`,
 * `puedeEditarReferencia`→`puedeEditarDerivada`) y a los campos nuevos de
 * `armarRuta` (maestra: `tarifa_actualizada_en`/`_por`; derivada:
 * `ruta_maestra_id`/`tarifa_al_crear`/`fecha_calculo`, sin `calculo`).
 *
 * v1.2.0 (RF-09b) — Las rutas dejan de vincularse a domicilios/productos del
 * portal: `origen`/`destino`/`producto` pasan a ser TEXTO. Se reescriben
 * todos los datos de muestra y los tests de `claveRuta`/`validarRuta` que
 * asumían `origen_domicilio_id`/`destino_domicilio_id`/`producto_id`, y se
 * agregan los casos nuevos que pide el ajuste: unicidad que ignora
 * mayúsculas/tildes/signos, origen igual a destino, y textos vacíos o solo
 * espacios. Ver el bloque de encabezado "RF-09b" de `logica-tarifario.js`.
 * ========================================================================== */

import {
  TIPO_PARAMETRO,
  TIPO_REFERENCIA,
  ORIGENES_TARIFA,
  claveRuta,
  buscarPorClave,
  validarRuta,
  armarRuta,
  armarCambioTarifa,
  calcularVariacion,
  rutasParametro,
  rutasDerivadas,
  puedeEditarDerivada,
  mapearVersion,
  armarFotoVersion,
} from './logica-tarifario';

/* -----------------------------------------------------------------------------
 * Datos de muestra
 * -------------------------------------------------------------------------- */

const DATOS_OK = {
  origen: 'Bioils Argentina S.A.',
  destino: 'COFCO Pto.Gral.San Martin (SF)',
  producto: 'Aceite',
  km: 29,
  tarifa_vigente: 9187,
  catac_ref: 13721.38,
  categoria: 'General',
};

/** Una ruta parámetro migrada, con su rastro legacy. */
const RUTA_PARAMETRO = {
  id: 'ruta-1',
  tipo: TIPO_PARAMETRO,
  estado: 'activo',
  origen: 'Bioils Argentina S.A.',
  destino: 'COFCO Pto.Gral.San Martin (SF)',
  producto: 'Aceite',
  clave_normalizada: claveRuta(DATOS_OK),
  km: 29,
  tarifa_vigente: 9187,
  catac_ref: 13721.38,
  categoria: 'General',
  legacy: { idx: 0, proveedor: 'Bioils Argentina S.A.', destino: 'COFCO Pto.Gral.San Martin (SF)', producto: 'Aceite' },
};

const RUTA_REFERENCIA = {
  id: 'ruta-2',
  tipo: TIPO_REFERENCIA,
  estado: 'activo',
  origen: 'Planta A',
  destino: 'Planta B',
  producto: 'Emag',
  clave_normalizada: claveRuta({ origen: 'Planta A', destino: 'Planta B', producto: 'Emag' }),
  km: 100,
  tarifa_vigente: 25000,
  creado_por_uid: 'uid-coord',
  legacy: null,
};

/** Sesión mínima con el perfil del modelo nuevo, como la arma `sesion.js`. */
function sesion(uid, roles) {
  return { uid, email: `${uid}@explora.com.ar`, nombre: uid, perfil: { roles, estado: 'activo' } };
}

const ADMIN = sesion('uid-admin', ['admin']);
const COORD = sesion('uid-coord', ['coordinador']);
const OTRO_COORD = sesion('uid-otro', ['coordinador']);
const COMERCIAL = sesion('uid-com', ['comercial']);

/* =============================================================================
 * claveRuta
 * ========================================================================== */

describe('claveRuta — origen|destino|producto normalizados, sin cliente', () => {
  test('arma la clave normalizando los tres campos', () => {
    expect(claveRuta(DATOS_OK)).toBe('bioils argentina s a|cofco pto gral san martin sf|aceite');
  });

  test('ignora mayúsculas, tildes y puntuación: la misma ruta escrita distinto da la misma clave', () => {
    const a = claveRuta({ origen: 'Bioils Argentina S.A.', destino: 'COFCO Pto.Gral.San Martin (SF)', producto: 'Aceite' });
    const b = claveRuta({ origen: 'BIOILS ARGENTINA S.A.', destino: 'cofco pto.gral.san martin (sf)', producto: 'ACEITE' });
    expect(a).toBe(b);
  });

  test('no incluye el cliente: dos rutas con distinto cliente son la misma ruta', () => {
    expect(claveRuta({ ...DATOS_OK, cliente_org_id: 'a' }))
      .toBe(claveRuta({ ...DATOS_OK, cliente_org_id: 'b' }));
  });

  test('los faltantes quedan vacíos, no "undefined"', () => {
    expect(claveRuta({ origen: 'x' })).toBe('x||');
    expect(claveRuta({})).toBe('||');
  });

  test('el orden importa: A→B no es lo mismo que B→A', () => {
    const ida = claveRuta({ origen: 'a', destino: 'b', producto: 'p' });
    const vuelta = claveRuta({ origen: 'b', destino: 'a', producto: 'p' });
    expect(ida).not.toBe(vuelta);
  });
});

/* =============================================================================
 * buscarPorClave — la unicidad considera LAS DOS clases
 * ========================================================================== */

describe('buscarPorClave', () => {
  test('encuentra una parámetro activa con esa clave', () => {
    const r = buscarPorClave([RUTA_PARAMETRO], RUTA_PARAMETRO.clave_normalizada);
    expect(r.id).toBe('ruta-1');
  });

  test('encuentra también una REFERENCIA: la unicidad cruza las dos clases', () => {
    const r = buscarPorClave([RUTA_REFERENCIA], RUTA_REFERENCIA.clave_normalizada);
    expect(r.tipo).toBe(TIPO_REFERENCIA);
  });

  test('una ruta inactiva no ocupa la clave', () => {
    const inactiva = { ...RUTA_PARAMETRO, estado: 'inactivo' };
    expect(buscarPorClave([inactiva], RUTA_PARAMETRO.clave_normalizada)).toBeNull();
  });

  test('la propia ruta se ignora al editar', () => {
    expect(buscarPorClave([RUTA_PARAMETRO], RUTA_PARAMETRO.clave_normalizada, 'ruta-1')).toBeNull();
  });

  test('sin rutas devuelve null', () => {
    expect(buscarPorClave([], 'x')).toBeNull();
    expect(buscarPorClave(null, 'x')).toBeNull();
  });
});

/* =============================================================================
 * validarRuta
 * ========================================================================== */

describe('validarRuta — campos obligatorios', () => {
  test('una ruta completa y con clave libre no tiene problemas', () => {
    expect(validarRuta(DATOS_OK, { rutas: [] })).toEqual([]);
  });

  test('exige origen, destino y producto', () => {
    const p = validarRuta({}, { rutas: [] });
    expect(p).toEqual(expect.arrayContaining([
      'Escribí el origen.',
      'Escribí el destino.',
      'Escribí el producto.',
    ]));
  });

  test('un texto de solo espacios se trata como vacío', () => {
    const p = validarRuta({ ...DATOS_OK, origen: '   ', destino: '\t', producto: '  ' }, { rutas: [] });
    expect(p).toEqual(expect.arrayContaining([
      'Escribí el origen.',
      'Escribí el destino.',
      'Escribí el producto.',
    ]));
  });

  test('un texto de más de 120 caracteres se rechaza', () => {
    const largo = 'x'.repeat(121);
    const p = validarRuta({ ...DATOS_OK, origen: largo }, { rutas: [] });
    expect(p).toContain('El origen no puede superar los 120 caracteres.');
  });

  test('exactamente 120 caracteres es válido', () => {
    const justo = 'x'.repeat(120);
    const p = validarRuta({ ...DATOS_OK, origen: justo }, { rutas: [] });
    expect(p.some(m => m.includes('caracteres'))).toBe(false);
  });

  test('el origen no puede ser el destino', () => {
    const p = validarRuta({ ...DATOS_OK, destino: DATOS_OK.origen }, { rutas: [] });
    expect(p).toContain('El origen y el destino no pueden ser el mismo lugar.');
  });

  test('origen y destino iguales solo por la clave normalizada (mayúsculas/tildes) también se rechaza', () => {
    const p = validarRuta({ ...DATOS_OK, destino: DATOS_OK.origen.toUpperCase() }, { rutas: [] });
    expect(p).toContain('El origen y el destino no pueden ser el mismo lugar.');
  });

  test('no repite el mensaje de origen igual a destino cuando los dos están vacíos', () => {
    const p = validarRuta({ producto: 'x', km: 1, tarifa_vigente: 1 }, { rutas: [] });
    expect(p).not.toContain('El origen y el destino no pueden ser el mismo lugar.');
  });
});

describe('validarRuta — km y tarifa', () => {
  test('km 0, negativo o vacío', () => {
    for (const km of [0, -5, '', null, undefined, 'abc']) {
      expect(validarRuta({ ...DATOS_OK, km }, { rutas: [] }))
        .toContain('Los km tienen que ser mayores que 0.');
    }
  });

  test('tarifa 0, negativa o vacía', () => {
    for (const tarifa_vigente of [0, -100, '', null, 'abc']) {
      expect(validarRuta({ ...DATOS_OK, tarifa_vigente }, { rutas: [] }))
        .toContain('La tarifa tiene que ser mayor que 0.');
    }
  });

  test('un km decimal mayor que 0 es válido', () => {
    expect(validarRuta({ ...DATOS_OK, km: 0.5 }, { rutas: [] })).toEqual([]);
  });

  test('una categoría desconocida se rechaza', () => {
    const p = validarRuta({ ...DATOS_OK, categoria: 'Inventada' }, { rutas: [] });
    expect(p).toContain('Categoría desconocida: "Inventada".');
  });

  test('sin categoría no se valida: el armado pone "General" por defecto', () => {
    expect(validarRuta({ ...DATOS_OK, categoria: undefined }, { rutas: [] })).toEqual([]);
  });
});

describe('validarRuta — unicidad sobre la lista dada', () => {
  test('rechaza una clave ya ocupada por una parámetro', () => {
    const p = validarRuta(DATOS_OK, { rutas: [RUTA_PARAMETRO] });
    expect(p).toContain('Ya existe una ruta parámetro activa con ese origen, destino y producto.');
  });

  test('la unicidad ignora mayúsculas, tildes y signos', () => {
    const datos = { ...DATOS_OK, origen: 'BIOILS ARGENTINA S A', destino: 'Cofco Pto Gral San Martin SF', producto: 'aceite' };
    const p = validarRuta(datos, { rutas: [RUTA_PARAMETRO] });
    expect(p).toContain('Ya existe una ruta parámetro activa con ese origen, destino y producto.');
  });

  test('rechaza una clave ya ocupada por una referencia, con su propio mensaje', () => {
    const datos = { ...DATOS_OK, origen: 'Planta A', destino: 'Planta B', producto: 'Emag' };
    const p = validarRuta(datos, { rutas: [RUTA_REFERENCIA] });
    expect(p).toContain('Ya existe una ruta de referencia activa con ese origen, destino y producto.');
  });

  test('una ruta inactiva libera la clave', () => {
    const p = validarRuta(DATOS_OK, { rutas: [{ ...RUTA_PARAMETRO, estado: 'inactivo' }] });
    expect(p).toEqual([]);
  });

  test('al editar, la propia ruta no cuenta como duplicada', () => {
    const p = validarRuta(DATOS_OK, { rutas: [RUTA_PARAMETRO], idIgnorar: 'ruta-1' });
    expect(p).toEqual([]);
  });

  test('con campos incompletos no se evalúa la unicidad sobre una clave a medias', () => {
    const p = validarRuta({ km: 10, tarifa_vigente: 10 }, { rutas: [RUTA_PARAMETRO] });
    expect(p.some(m => m.startsWith('Ya existe'))).toBe(false);
  });
});

/* =============================================================================
 * armarRuta
 * ========================================================================== */

describe('armarRuta', () => {
  test('una parámetro nace activa, sin pendiente y con su clave calculada', () => {
    const d = armarRuta(DATOS_OK, TIPO_PARAMETRO, { creado_por_uid: 'uid-admin' });
    expect(d.tipo).toBe(TIPO_PARAMETRO);
    expect(d.estado).toBe('activo');
    expect(d.pendiente).toBeNull();
    expect(d.clave_normalizada).toBe(claveRuta(DATOS_OK));
    expect(d.creado_por_uid).toBe('uid-admin');
  });

  test('los números llegan como números, aunque vengan del formulario como texto', () => {
    const d = armarRuta({ ...DATOS_OK, km: '29', tarifa_vigente: '9187' }, TIPO_PARAMETRO);
    expect(d.km).toBe(29);
    expect(d.tarifa_vigente).toBe(9187);
  });

  test('sin categoría queda "General"', () => {
    const d = armarRuta({ ...DATOS_OK, categoria: undefined }, TIPO_PARAMETRO);
    expect(d.categoria).toBe('General');
  });

  test('`origen`/`destino`/`producto` se guardan recortados, sin espacios en los extremos', () => {
    const d = armarRuta({ ...DATOS_OK, origen: '  Bioils Argentina S.A.  ', destino: '  COFCO  ', producto: ' Aceite ' }, TIPO_PARAMETRO);
    expect(d.origen).toBe('Bioils Argentina S.A.');
    expect(d.destino).toBe('COFCO');
    expect(d.producto).toBe('Aceite');
  });

  test('no queda ningún campo de vínculo a domicilios ni productos', () => {
    const d = armarRuta(DATOS_OK, TIPO_PARAMETRO);
    expect(d).not.toHaveProperty('origen_domicilio_id');
    expect(d).not.toHaveProperty('destino_domicilio_id');
    expect(d).not.toHaveProperty('producto_id');
  });

  test('`tarifa_base` y `legacy` son null si no se pasan', () => {
    const d = armarRuta(DATOS_OK, TIPO_REFERENCIA);
    expect(d.tarifa_base).toBeNull();
    expect(d.legacy).toBeNull();
  });

  test('una migrada guarda el texto original en `legacy`', () => {
    const legacy = { idx: 7, proveedor: 'Viterra', destino: 'Renova', producto: 'Aceite' };
    const d = armarRuta(DATOS_OK, TIPO_PARAMETRO, { legacy });
    expect(d.legacy).toEqual(legacy);
  });

  test('no escribe campos de auditoría: los agrega crear() de datos.js', () => {
    const d = armarRuta(DATOS_OK, TIPO_PARAMETRO);
    expect(d).not.toHaveProperty('creado_en');
    expect(d).not.toHaveProperty('actualizado_en');
  });

  // (RF-09) Una maestra (parámetro) lleva `tarifa_actualizada_en`/`_por`; una
  // derivada (referencia) lleva `ruta_maestra_id`/`tarifa_al_crear`/
  // `fecha_calculo` en vez del viejo `calculo: {ratio, ...}`.
  test('una maestra sin extra no tiene fecha ni autor de actualización, y no tiene campos de derivada', () => {
    const d = armarRuta(DATOS_OK, TIPO_PARAMETRO);
    expect(d.tarifa_actualizada_en).toBeNull();
    expect(d.tarifa_actualizada_por).toBeNull();
    expect(d).not.toHaveProperty('ruta_maestra_id');
    expect(d).not.toHaveProperty('tarifa_al_crear');
    expect(d).not.toHaveProperty('fecha_calculo');
  });

  test('una maestra guarda quién y cuándo actualizó la tarifa', () => {
    const d = armarRuta(DATOS_OK, TIPO_PARAMETRO, {
      tarifa_actualizada_en: 'TS',
      tarifa_actualizada_por: { uid: 'uid-admin', nombre: 'Admin' },
    });
    expect(d.tarifa_actualizada_en).toBe('TS');
    expect(d.tarifa_actualizada_por).toEqual({ uid: 'uid-admin', nombre: 'Admin' });
  });

  test('una derivada guarda de qué maestra depende, y su tarifa al crear como foto', () => {
    const d = armarRuta(DATOS_OK, TIPO_REFERENCIA, {
      creado_por_uid: 'uid-coord',
      ruta_maestra_id: 'ruta-1',
      tarifa_al_crear: 9500,
      fecha_calculo: 'TS',
    });
    expect(d.tipo).toBe(TIPO_REFERENCIA);
    expect(d.ruta_maestra_id).toBe('ruta-1');
    expect(d.tarifa_al_crear).toBe(9500);
    expect(d.fecha_calculo).toBe('TS');
    expect(d).not.toHaveProperty('calculo');
    expect(d).not.toHaveProperty('tarifa_actualizada_en');
  });

  test('una derivada sin extra tiene `ruta_maestra_id`/`tarifa_al_crear`/`fecha_calculo` en null', () => {
    const d = armarRuta(DATOS_OK, TIPO_REFERENCIA);
    expect(d.ruta_maestra_id).toBeNull();
    expect(d.tarifa_al_crear).toBeNull();
    expect(d.fecha_calculo).toBeNull();
  });
});

/* =============================================================================
 * Cambios de tarifa
 * ========================================================================== */

describe('calcularVariacion', () => {
  test('sube un 10 %', () => {
    expect(calcularVariacion(10000, 11000)).toBe(10);
  });

  test('baja un 5 %', () => {
    expect(calcularVariacion(10000, 9500)).toBe(-5);
  });

  test('redondea a 2 decimales', () => {
    expect(calcularVariacion(9187, 9797)).toBe(6.64);
  });

  test('sin tarifa anterior devuelve null en vez de infinito', () => {
    expect(calcularVariacion(0, 1000)).toBeNull();
    expect(calcularVariacion(null, 1000)).toBeNull();
  });
});

describe('armarCambioTarifa', () => {
  test('arma el documento con el origen y el usuario', () => {
    const d = armarCambioTarifa({
      anterior: 9187, nueva: 9797, variacion: 6.64,
      just: 'CATAMP abril', ref: 'CATAMP', adjunto: null,
      origen: 'catamp', usuario: ADMIN,
    });
    expect(d.tarifa_anterior).toBe(9187);
    expect(d.tarifa_nueva).toBe(9797);
    expect(d.variacion).toBe(6.64);
    expect(d.origen).toBe('catamp');
    expect(d.usuario_uid).toBe('uid-admin');
  });

  test('si no se pasa la variación, se calcula', () => {
    const d = armarCambioTarifa({ anterior: 10000, nueva: 11000, origen: 'editor', usuario: ADMIN });
    expect(d.variacion).toBe(10);
  });

  test('un origen desconocido no se escribe: rompe en el acto', () => {
    expect(() => armarCambioTarifa({ anterior: 1, nueva: 2, origen: 'inventado', usuario: ADMIN }))
      .toThrow(/Origen de cambio de tarifa desconocido/);
  });

  test('todos los orígenes previstos son válidos, incluidos `catac` y `alta`', () => {
    expect(ORIGENES_TARIFA).toEqual(expect.arrayContaining(['catac', 'alta']));
    for (const origen of ORIGENES_TARIFA) {
      expect(() => armarCambioTarifa({ anterior: 1, nueva: 2, origen, usuario: ADMIN })).not.toThrow();
    }
  });
});

/* =============================================================================
 * Filtros por clase y permisos sobre una referencia
 * ========================================================================== */

describe('rutasParametro / rutasDerivadas', () => {
  const todas = [RUTA_PARAMETRO, RUTA_REFERENCIA, { ...RUTA_PARAMETRO, id: 'x', estado: 'inactivo' }];

  test('separa las dos clases y descarta las inactivas', () => {
    expect(rutasParametro(todas).map(r => r.id)).toEqual(['ruta-1']);
    expect(rutasDerivadas(todas).map(r => r.id)).toEqual(['ruta-2']);
  });

  test('sin rutas devuelven listas vacías', () => {
    expect(rutasParametro(null)).toEqual([]);
    expect(rutasDerivadas(undefined)).toEqual([]);
  });
});

describe('puedeEditarDerivada', () => {
  test('su creador puede', () => {
    expect(puedeEditarDerivada(RUTA_REFERENCIA, COORD)).toBe(true);
  });

  test('otro coordinador no puede', () => {
    expect(puedeEditarDerivada(RUTA_REFERENCIA, OTRO_COORD)).toBe(false);
  });

  test('el admin puede cualquiera', () => {
    expect(puedeEditarDerivada(RUTA_REFERENCIA, ADMIN)).toBe(true);
  });

  test('el comercial no puede ninguna', () => {
    expect(puedeEditarDerivada(RUTA_REFERENCIA, COMERCIAL)).toBe(false);
  });

  test('una ruta maestra nunca se edita por esta vía, ni siquiera el admin', () => {
    expect(puedeEditarDerivada(RUTA_PARAMETRO, ADMIN)).toBe(false);
  });
});

/* =============================================================================
 * Versiones — formato nuevo y formato viejo por legacy.idx
 * ========================================================================== */

describe('armarFotoVersion', () => {
  test('guarda solo las rutas parámetro activas, con id y tarifa', () => {
    const foto = armarFotoVersion([RUTA_PARAMETRO, RUTA_REFERENCIA]);
    expect(foto).toEqual([{ ruta_id: 'ruta-1', tarifa_vigente: 9187 }]);
  });
});

describe('mapearVersion — formato NUEVO, por ruta_id', () => {
  test('mapea lo que existe', () => {
    const version = { rutas: [{ ruta_id: 'ruta-1', tarifa_vigente: 8000 }] };
    const { cambios, sinMapear, formato } = mapearVersion(version, [RUTA_PARAMETRO]);
    expect(formato).toBe('nuevo');
    expect(cambios).toHaveLength(1);
    expect(cambios[0].ruta.id).toBe('ruta-1');
    expect(cambios[0].tarifaNueva).toBe(8000);
    expect(sinMapear).toEqual([]);
  });

  test('informa lo que ya no existe en vez de descartarlo en silencio', () => {
    const version = { rutas: [{ ruta_id: 'borrada', tarifa_vigente: 123 }] };
    const { cambios, sinMapear } = mapearVersion(version, [RUTA_PARAMETRO]);
    expect(cambios).toEqual([]);
    expect(sinMapear).toEqual([{ clave: 'borrada', tarifa: 123 }]);
  });
});

describe('mapearVersion — formato VIEJO, por legacy.idx', () => {
  test('un valor numérico suelto se mapea con el idx de la ruta migrada', () => {
    const version = { mods: { 0: 9500 } };
    const { cambios, formato } = mapearVersion(version, [RUTA_PARAMETRO]);
    expect(formato).toBe('viejo');
    expect(cambios).toHaveLength(1);
    expect(cambios[0].ruta.id).toBe('ruta-1');
    expect(cambios[0].tarifaNueva).toBe(9500);
  });

  test('un valor objeto (la otra forma que admitía getTarifaVigente) también', () => {
    const version = { mods: { 0: { tarifa_vigente: 9600 } } };
    const { cambios } = mapearVersion(version, [RUTA_PARAMETRO]);
    expect(cambios[0].tarifaNueva).toBe(9600);
  });

  test('un idx que ninguna ruta reclama se informa', () => {
    const version = { mods: { 41: 1000 } };
    const { cambios, sinMapear } = mapearVersion(version, [RUTA_PARAMETRO]);
    expect(cambios).toEqual([]);
    expect(sinMapear).toEqual([{ clave: 'idx 41', tarifa: 1000 }]);
  });

  test('una ruta creada después de migrar (sin legacy) nunca aparece en una versión vieja', () => {
    const nueva = { id: 'nueva', tipo: TIPO_PARAMETRO, estado: 'activo', tarifa_vigente: 1, legacy: null };
    const { cambios, sinMapear } = mapearVersion({ mods: { 0: 500 } }, [nueva]);
    expect(cambios).toEqual([]);
    expect(sinMapear).toHaveLength(1);
  });

  test('una versión vieja vacía no rompe', () => {
    expect(mapearVersion({ mods: {} }, [RUTA_PARAMETRO]).cambios).toEqual([]);
    expect(mapearVersion({}, [RUTA_PARAMETRO]).cambios).toEqual([]);
    expect(mapearVersion(null, [RUTA_PARAMETRO]).cambios).toEqual([]);
  });

  test('mapea unas y deja otras sin mapear, en la misma versión', () => {
    const otra = { ...RUTA_PARAMETRO, id: 'ruta-3', legacy: { idx: 3 } };
    const { cambios, sinMapear } = mapearVersion({ mods: { 0: 100, 3: 300, 99: 999 } }, [RUTA_PARAMETRO, otra]);
    expect(cambios.map(c => c.ruta.id).sort()).toEqual(['ruta-1', 'ruta-3']);
    expect(sinMapear).toEqual([{ clave: 'idx 99', tarifa: 999 }]);
  });
});
