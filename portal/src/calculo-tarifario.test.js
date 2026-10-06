/* =============================================================================
 * calculo-tarifario.test.js — v1.2.0 (RF-09)
 * Ver el encabezado de `calculo-tarifario.js` para SÍNTOMA/CAUSA
 * RAÍZ/ALCANCE/LIMITACIONES/CÓMO SE VERIFICA.
 * ========================================================================== */

import {
  getCatacTabla,
  redondear2,
  aplicarFactor,
  aplicarPorcentaje,
  factorCompuesto,
  evaluarCatamp,
  calcularGenerador,
  brechaContraCatac,
  calcularTarifaDerivada,
} from './calculo-tarifario';

/* -----------------------------------------------------------------------------
 * Datos de muestra — valores reales de la tabla CATAC de abril 2026 y de las
 * rutas que hoy viven en `portal/rutas`.
 * -------------------------------------------------------------------------- */

const TABLA = {
  1: 9636.69,
  10: 9636.69,
  20: 12103.99,
  29: 14336.33,
  62: 20110.84,
  100: 27192.78,
  200: 41426.61,
  280: 53783.06,
  300: 57202.78,
};

/** Tres rutas parámetro con la forma del modelo nuevo. */
const RUTAS = [
  { id: 'r1', km: 29,  tarifa_vigente: 9187,  catac_ref: 13721.38, producto_nombre: 'Aceite',    categoria: 'General' },
  { id: 'r2', km: 62,  tarifa_vigente: 15739, catac_ref: 19248.19, producto_nombre: 'Aceite',    categoria: 'General' },
  { id: 'r3', km: 280, tarifa_vigente: 35139, catac_ref: 51549.09, producto_nombre: 'Biodiesel', categoria: 'Peligroso' },
];

/* =============================================================================
 * getCatacTabla
 * ========================================================================== */

describe('getCatacTabla — valores exactos e interpolación', () => {
  test('un km que está en la tabla se devuelve tal cual', () => {
    expect(getCatacTabla(TABLA, 29)).toBe(14336.33);
    expect(getCatacTabla(TABLA, 280)).toBe(53783.06);
  });

  test('el km se redondea antes de buscarlo', () => {
    expect(getCatacTabla(TABLA, 28.6)).toBe(14336.33);
    expect(getCatacTabla(TABLA, 29.4)).toBe(14336.33);
  });

  test('un km intermedio se interpola linealmente entre los dos vecinos', () => {
    // Entre 100 (27192.78) y 200 (41426.61): el punto medio es el promedio.
    const esperado = 27192.78 + (41426.61 - 27192.78) * 0.5;
    expect(getCatacTabla(TABLA, 150)).toBeCloseTo(esperado, 6);
  });

  test('la interpolación respeta la proporción, no solo el punto medio', () => {
    // 120 está al 20 % del tramo 100–200.
    const esperado = 27192.78 + (41426.61 - 27192.78) * 0.2;
    expect(getCatacTabla(TABLA, 120)).toBeCloseTo(esperado, 6);
  });
});

describe('getCatacTabla — bordes', () => {
  test('por debajo del primer km devuelve el primer valor, sin extrapolar', () => {
    // El 0 se redondea a 0: no hay `lo`, así que gana el `hi` (km 1).
    expect(getCatacTabla(TABLA, 0)).toBe(9636.69);
  });

  test('por encima del último km devuelve el último valor, sin extrapolar', () => {
    expect(getCatacTabla(TABLA, 950)).toBe(57202.78);
    expect(getCatacTabla(TABLA, 5000)).toBe(57202.78);
  });

  test('el primer y el último km exactos se devuelven directo', () => {
    expect(getCatacTabla(TABLA, 1)).toBe(9636.69);
    expect(getCatacTabla(TABLA, 300)).toBe(57202.78);
  });

  test('sin tabla devuelve undefined en vez de romper', () => {
    expect(getCatacTabla(null, 100)).toBeUndefined();
    expect(getCatacTabla({}, 100)).toBeUndefined();
  });
});

/* =============================================================================
 * Redondeo y porcentajes
 * ========================================================================== */

describe('redondeo a 2 decimales', () => {
  test('redondea hacia arriba desde el tercer decimal', () => {
    expect(redondear2(1234.5678)).toBe(1234.57);
    expect(redondear2(1234.565)).toBe(1234.57);
  });

  test('un entero queda igual', () => {
    expect(redondear2(9187)).toBe(9187);
  });

  test('aplicarFactor multiplica y redondea', () => {
    expect(aplicarFactor(9187, 1.0926)).toBe(10037.72); // 10037.7162 → 10037.72
  });

  test('aplicarPorcentaje convierte el porcentaje en factor', () => {
    expect(aplicarPorcentaje(9187, 6.85)).toBe(aplicarFactor(9187, 1.0685));
    expect(aplicarPorcentaje(10000, 6.85)).toBe(10685);
  });

  test('un porcentaje negativo baja la tarifa', () => {
    expect(aplicarPorcentaje(10000, -5)).toBe(9500);
  });
});

/* =============================================================================
 * CATAMP compuesto
 * ========================================================================== */

describe('factorCompuesto — CATAMP se multiplica, no se suma', () => {
  test('el ejemplo de la pantalla: +2,26 % × +6,85 % = ×1,0926', () => {
    const { factor, porcentaje } = factorCompuesto([
      { mes: 'Marzo 2026', indice: '2.26' },
      { mes: 'Abril 2026', indice: '6.85' },
    ]);
    expect(factor.toFixed(4)).toBe('1.0926');
    // La suma daría 9.11 %: el compuesto da más.
    expect(porcentaje).toBeGreaterThan(9.11);
    expect(porcentaje.toFixed(2)).toBe('9.26');
  });

  test('un solo mes da exactamente ese porcentaje', () => {
    const { factor, porcentaje } = factorCompuesto([{ mes: 'Abril', indice: 6.85 }]);
    expect(factor).toBeCloseTo(1.0685, 10);
    expect(porcentaje).toBeCloseTo(6.85, 10);
  });

  test('sin filas con índice el factor es 1 y no cambia nada', () => {
    const { filas, factor, porcentaje } = factorCompuesto([{ mes: '', indice: '' }, { mes: 'Abril', indice: '' }]);
    expect(filas).toHaveLength(0);
    expect(factor).toBe(1);
    expect(porcentaje).toBe(0);
  });

  test('las filas sin índice numérico se descartan en silencio', () => {
    const { filas, factor } = factorCompuesto([
      { mes: 'Marzo', indice: '2.26' },
      { mes: 'Abril', indice: 'no es un número' },
      { mes: 'Mayo', indice: null },
    ]);
    expect(filas).toHaveLength(1);
    expect(factor).toBeCloseTo(1.0226, 10);
  });

  test('un índice negativo baja el factor', () => {
    const { factor } = factorCompuesto([{ indice: 5 }, { indice: -5 }]);
    expect(factor).toBeCloseTo(1.05 * 0.95, 10);
    expect(factor).toBeLessThan(1);
  });

  test('sin argumento no rompe', () => {
    expect(factorCompuesto(undefined).factor).toBe(1);
  });
});

describe('evaluarCatamp — el techo avisa, no bloquea', () => {
  test('por debajo del techo no avisa', () => {
    const r = evaluarCatamp([{ indice: 2.26 }, { indice: 6.85 }], 15);
    expect(r.superaTecho).toBe(false);
    expect(r.techo).toBe(15);
  });

  test('por encima del techo avisa, pero el factor se calcula igual', () => {
    const r = evaluarCatamp([{ indice: 10 }, { indice: 10 }], 15);
    expect(r.superaTecho).toBe(true);
    expect(r.factor).toBeCloseTo(1.21, 10);
  });

  test('techo 0 o vacío significa "sin techo"', () => {
    expect(evaluarCatamp([{ indice: 50 }], 0).superaTecho).toBe(false);
    expect(evaluarCatamp([{ indice: 50 }], '').superaTecho).toBe(false);
  });
});

/* =============================================================================
 * Generador
 * ========================================================================== */

describe('calcularGenerador — elección de la vecina', () => {
  test('elige la ruta parámetro más cercana en km', () => {
    const r = calcularGenerador({ km: 70, rutas: RUTAS, tablaCatac: TABLA });
    expect(r.vecina.id).toBe('r2');   // 62 km está a 8; 29 km está a 41
  });

  test('ante dos vecinas a la misma distancia gana la primera de la lista', () => {
    const rutas = [
      { id: 'a', km: 90,  tarifa_vigente: 100, catac_ref: 100, producto_nombre: 'X' },
      { id: 'b', km: 110, tarifa_vigente: 100, catac_ref: 100, producto_nombre: 'X' },
    ];
    const r = calcularGenerador({ km: 100, rutas, tablaCatac: TABLA });
    expect(r.vecina.id).toBe('a');
  });

  test('descarta las rutas sin CATAC de referencia, que romperían el ratio', () => {
    const rutas = [
      { id: 'rota', km: 99, tarifa_vigente: 100, catac_ref: 0, producto_nombre: 'X' },
      ...RUTAS,
    ];
    const r = calcularGenerador({ km: 100, rutas, tablaCatac: TABLA });
    expect(r.vecina.id).not.toBe('rota');
  });
});

describe('calcularGenerador — ratio, tarifa sugerida y brecha', () => {
  test('tarifaSugerida = catacBase × (vigente / catac de la vecina)', () => {
    const r = calcularGenerador({ km: 29, rutas: RUTAS, tablaCatac: TABLA });
    const ratioEsperado = 9187 / 13721.38;
    expect(r.vecina.id).toBe('r1');
    expect(r.ratio).toBeCloseTo(ratioEsperado, 10);
    expect(r.catacBase).toBe(14336.33);
    expect(r.tarifaSugerida).toBeCloseTo(14336.33 * ratioEsperado, 6);
  });

  test('la brecha contra CATAC es la del ratio: no depende del km', () => {
    const r = calcularGenerador({ km: 29, rutas: RUTAS, tablaCatac: TABLA });
    expect(r.brechaVsCatac).toBeCloseTo((9187 / 13721.38 - 1) * 100, 6);
  });

  test('el km del resultado viene redondeado', () => {
    const r = calcularGenerador({ km: 28.7, rutas: RUTAS, tablaCatac: TABLA });
    expect(r.km).toBe(29);
  });
});

describe('calcularGenerador — similares a ±100 km', () => {
  test('incluye solo las rutas dentro de ±100 km, ordenadas por cercanía', () => {
    const r = calcularGenerador({ km: 100, rutas: RUTAS, tablaCatac: TABLA });
    expect(r.similares.map(x => x.id)).toEqual(['r2', 'r1']);  // 62 y 29; 280 queda fuera
  });

  test('como mucho seis', () => {
    const rutas = Array.from({ length: 12 }, (_, i) => ({
      id: `k${i}`, km: 100 + i, tarifa_vigente: 1000, catac_ref: 1000, producto_nombre: 'X',
    }));
    const r = calcularGenerador({ km: 100, rutas, tablaCatac: TABLA });
    expect(r.similares).toHaveLength(6);
  });

  test('el borde de 100 km entra', () => {
    const rutas = [{ id: 'borde', km: 200, tarifa_vigente: 1000, catac_ref: 1000, producto_nombre: 'X' }];
    const r = calcularGenerador({ km: 100, rutas, tablaCatac: TABLA });
    expect(r.similares.map(x => x.id)).toEqual(['borde']);
  });
});

describe('calcularGenerador — aviso de producto distinto', () => {
  test('avisa cuando la vecina es de otro producto', () => {
    const r = calcularGenerador({ km: 280, productoNombre: 'Aceite', rutas: RUTAS, tablaCatac: TABLA });
    expect(r.vecina.id).toBe('r3');           // Biodiesel
    expect(r.productoDifiere).toBe(true);
  });

  test('no avisa con el mismo producto, aunque cambien mayúsculas y puntuación', () => {
    const r = calcularGenerador({ km: 29, productoNombre: 'aceite', rutas: RUTAS, tablaCatac: TABLA });
    expect(r.productoDifiere).toBe(false);
  });

  test('"Otro" nunca avisa: es el producto genérico', () => {
    const r = calcularGenerador({ km: 280, productoNombre: 'Otro', rutas: RUTAS, tablaCatac: TABLA });
    expect(r.productoDifiere).toBe(false);
  });

  test('sin producto tampoco avisa', () => {
    const r = calcularGenerador({ km: 280, rutas: RUTAS, tablaCatac: TABLA });
    expect(r.productoDifiere).toBe(false);
  });
});

describe('calcularGenerador — cuándo devuelve null en vez de romper', () => {
  test('sin km, con km 0 o fuera del rango del convenio', () => {
    expect(calcularGenerador({ km: '', rutas: RUTAS, tablaCatac: TABLA })).toBeNull();
    expect(calcularGenerador({ km: 0, rutas: RUTAS, tablaCatac: TABLA })).toBeNull();
    expect(calcularGenerador({ km: 1501, rutas: RUTAS, tablaCatac: TABLA })).toBeNull();
    expect(calcularGenerador({ km: 'abc', rutas: RUTAS, tablaCatac: TABLA })).toBeNull();
  });

  test('sin tabla CATAC', () => {
    expect(calcularGenerador({ km: 100, rutas: RUTAS, tablaCatac: null })).toBeNull();
  });

  test('sin ninguna ruta parámetro activa — el tarifario recién migrado', () => {
    expect(calcularGenerador({ km: 100, rutas: [], tablaCatac: TABLA })).toBeNull();
  });
});

/* =============================================================================
 * brechaContraCatac
 * ========================================================================== */

describe('brechaContraCatac', () => {
  test('positiva cuando la tarifa está por encima del CATAC', () => {
    expect(brechaContraCatac(110, 100)).toBeCloseTo(10, 10);
  });

  test('negativa cuando está por debajo', () => {
    expect(brechaContraCatac(90, 100)).toBeCloseTo(-10, 10);
  });

  test('null sin CATAC de referencia', () => {
    expect(brechaContraCatac(100, null)).toBeNull();
    expect(brechaContraCatac(100, 0)).toBeNull();
  });
});

/* =============================================================================
 * calcularTarifaDerivada — NuevoTarifario
 * ========================================================================== */

describe('calcularTarifaDerivada — fórmula de B.2', () => {
  const MAESTRA = { id: 'm1', km: 29, tarifa_vigente: 9187, estado: 'activo' };

  test('tarifa = catac(km_derivada) × (tarifa_vigente_maestra / catac(km_maestra))', () => {
    const derivada = { km: 62 };
    const ratioEsperado = 9187 / 14336.33;          // catac(29) = 14336.33
    const r = calcularTarifaDerivada(derivada, MAESTRA, TABLA);
    expect(r.maestraInactiva).toBe(false);
    expect(r.ratio).toBeCloseTo(ratioEsperado, 10);
    expect(r.tarifa).toBeCloseTo(20110.84 * ratioEsperado, 2);  // catac(62) = 20110.84
  });

  test('la derivada se mueve sola al cambiar la tarifa vigente de la maestra', () => {
    const derivada = { km: 62 };
    const antes = calcularTarifaDerivada(derivada, MAESTRA, TABLA).tarifa;
    const despues = calcularTarifaDerivada(derivada, { ...MAESTRA, tarifa_vigente: 10000 }, TABLA).tarifa;
    expect(despues).not.toBe(antes);
    expect(despues).toBeCloseTo(20110.84 * (10000 / 14336.33), 2);
  });

  test('la derivada se mueve sola al cambiar la tabla CATAC', () => {
    const derivada = { km: 62 };
    const antes = calcularTarifaDerivada(derivada, MAESTRA, TABLA).tarifa;
    const otraTabla = { ...TABLA, 29: 15000, 62: 21000 };
    const despues = calcularTarifaDerivada(derivada, MAESTRA, otraTabla).tarifa;
    expect(despues).not.toBe(antes);
    expect(despues).toBeCloseTo(21000 * (9187 / 15000), 2);
  });

  test('maestra inactiva: sin tarifa calculada, se informa en vez de inventar', () => {
    const r = calcularTarifaDerivada({ km: 62 }, { ...MAESTRA, estado: 'inactivo' }, TABLA);
    expect(r.tarifa).toBeNull();
    expect(r.maestraInactiva).toBe(true);
  });

  test('sin maestra (ej. borrado el vínculo) se trata igual que inactiva', () => {
    const r = calcularTarifaDerivada({ km: 62 }, null, TABLA);
    expect(r.tarifa).toBeNull();
    expect(r.maestraInactiva).toBe(true);
  });

  test('sin tabla CATAC no rompe', () => {
    const r = calcularTarifaDerivada({ km: 62 }, MAESTRA, null);
    expect(r.tarifa).toBeNull();
    expect(r.maestraInactiva).toBe(false);
  });
});
