/* =============================================================================
 * suscripciones-compartidas.test.js — Portal Explora
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * v1.2.7 — LECTURAS COMPARTIDAS
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Cuota diaria de lecturas de Firestore superada (ver el encabezado de
 *     `suscripciones-compartidas.js`).
 *
 *   CAUSA RAÍZ
 *     Cada pantalla releía colecciones completas en cada visita.
 *
 *   ALCANCE
 *     Tests del núcleo `crearAlmacen` con un `suscribir` falso y los timers
 *     falsos de Jest — sin Firestore (`./firebase` se reemplaza por un mock):
 *     1. una suscripción por clave; 2. baja a los `graciaMs`; 3. re-adquirir
 *     en la gracia; 4. error y reapertura; 5. `cerrarTodas`; 6. contador;
 *     7. identidad de `docs`; 8. clave fuera del catálogo. Más casos de
 *     borde: snapshot sin cambios, callbacks tardíos, `soltar` repetido.
 *
 *   LIMITACIONES CONOCIDAS
 *     No prueba el hook ni `onSnapshot` real (necesitaría Firestore o el
 *     emulador); el hook es una capa fina sobre `useSyncExternalStore`.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- suscripciones-compartidas --watchAll=false`.
 * ========================================================================== */

import { crearAlmacen, consultaDe, CATALOGO, ESTADO_CARGANDO } from './suscripciones-compartidas';

jest.mock('./firebase', () => ({ db: {} }));

const GRACIA = 1000;

/** Snapshot falso con la forma que usa el almacén. */
function snap(docs, { fromCache = false, cambios } = {}) {
  return {
    docs: docs.map(d => ({ id: d.id, data: () => { const { id, ...resto } = d; return resto; } })),
    docChanges: () => new Array(cambios === undefined ? docs.length : cambios).fill({}),
    metadata: { fromCache },
  };
}

/** `suscribir` falso: registra cada apertura y deja disparar sus callbacks. */
function crearSuscribirFalso() {
  const aperturas = [];
  const suscribir = jest.fn((clave, onDatos, onError) => {
    const sub = { clave, onDatos, onError, baja: jest.fn() };
    aperturas.push(sub);
    return sub.baja;
  });
  return { suscribir, aperturas };
}

let consolaError;
beforeEach(() => {
  jest.useFakeTimers();
  consolaError = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consolaError.mockRestore();
  jest.useRealTimers();
});

function nuevoAlmacen() {
  const falso = crearSuscribirFalso();
  const almacen = crearAlmacen({
    suscribir: falso.suscribir,
    graciaMs: GRACIA,
    setTimeout,
    clearTimeout,
  });
  return { almacen, ...falso };
}

test('1. dos adquirir de la misma clave abren una sola suscripción', () => {
  const { almacen, suscribir } = nuevoAlmacen();
  almacen.adquirir('pedidos', () => {});
  almacen.adquirir('pedidos', () => {});
  expect(suscribir).toHaveBeenCalledTimes(1);
  expect(almacen._entrada('pedidos').usuarios).toBe(2);
  // Otra clave sí abre la suya.
  almacen.adquirir('entregas', () => {});
  expect(suscribir).toHaveBeenCalledTimes(2);
});

test('2. soltando todo, la baja ocurre a los graciaMs y no antes', () => {
  const { almacen, aperturas } = nuevoAlmacen();
  const soltarA = almacen.adquirir('viajes', () => {});
  const soltarB = almacen.adquirir('viajes', () => {});
  soltarA();
  soltarB();
  expect(aperturas[0].baja).not.toHaveBeenCalled();
  jest.advanceTimersByTime(GRACIA - 1);
  expect(aperturas[0].baja).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  expect(aperturas[0].baja).toHaveBeenCalledTimes(1);
  expect(almacen._entrada('viajes')).toBeUndefined();
});

test('2b. mientras quede un usuario no se programa la baja', () => {
  const { almacen, aperturas } = nuevoAlmacen();
  const soltarA = almacen.adquirir('viajes', () => {});
  almacen.adquirir('viajes', () => {});
  soltarA();
  jest.advanceTimersByTime(GRACIA * 5);
  expect(aperturas[0].baja).not.toHaveBeenCalled();
});

test('3. re-adquirir dentro de la gracia cancela la baja y no abre otra suscripción', () => {
  const { almacen, suscribir, aperturas } = nuevoAlmacen();
  const soltar = almacen.adquirir('organizaciones', () => {});
  aperturas[0].onDatos(snap([{ id: 'o1', razon_social: 'A' }]));
  const docsAntes = almacen.estado('organizaciones').docs;
  soltar();
  jest.advanceTimersByTime(GRACIA - 10);
  almacen.adquirir('organizaciones', () => {});
  jest.advanceTimersByTime(GRACIA * 5);
  expect(suscribir).toHaveBeenCalledTimes(1);
  expect(aperturas[0].baja).not.toHaveBeenCalled();
  // Los datos siguen ahí, sin volver a "cargando".
  expect(almacen.estado('organizaciones').cargando).toBe(false);
  expect(almacen.estado('organizaciones').docs).toBe(docsAntes);
});

test('3b. después de la baja, adquirir abre una suscripción nueva', () => {
  const { almacen, suscribir } = nuevoAlmacen();
  almacen.adquirir('productos', () => {})();
  jest.advanceTimersByTime(GRACIA);
  almacen.adquirir('productos', () => {});
  expect(suscribir).toHaveBeenCalledTimes(2);
  expect(almacen.estado('productos')).toBe(ESTADO_CARGANDO);
});

test('4. un error deja el estado con error, cierra y el siguiente adquirir reabre', () => {
  const { almacen, suscribir, aperturas } = nuevoAlmacen();
  const oyente = jest.fn();
  almacen.adquirir('usuarios', oyente);
  const err = Object.assign(new Error('sin permiso'), { code: 'permission-denied' });
  aperturas[0].onError(err);

  const estado = almacen.estado('usuarios');
  expect(estado.error).toBe(err);
  expect(estado.cargando).toBe(false);
  expect(oyente).toHaveBeenCalledTimes(1);
  expect(aperturas[0].baja).toHaveBeenCalledTimes(1);
  expect(consolaError).toHaveBeenCalled();

  almacen.adquirir('usuarios', () => {});
  expect(suscribir).toHaveBeenCalledTimes(2);
  expect(almacen.estado('usuarios').error).toBeNull();
  expect(almacen.estado('usuarios').cargando).toBe(true);
  aperturas[1].onDatos(snap([{ id: 'u1' }]));
  expect(almacen.estado('usuarios')).toMatchObject({ cargando: false, error: null });
  // La pantalla que seguía montada también se entera.
  expect(oyente).toHaveBeenCalledTimes(2);
});

test('4b. con error y sin usuarios, la entrada se descarta sin esperar la gracia', () => {
  const { almacen, suscribir, aperturas } = nuevoAlmacen();
  const soltar = almacen.adquirir('despachos', () => {});
  aperturas[0].onError(new Error('x'));
  soltar();
  expect(almacen._entrada('despachos')).toBeUndefined();
  almacen.adquirir('despachos', () => {});
  expect(suscribir).toHaveBeenCalledTimes(2);
});

test('4c. un error sincrónico dentro de suscribir no deja la suscripción por vigente', () => {
  const baja = jest.fn();
  const suscribir = jest.fn((clave, onDatos, onError) => { onError(new Error('ya')); return baja; });
  const almacen = crearAlmacen({ suscribir, graciaMs: GRACIA, setTimeout, clearTimeout });
  almacen.adquirir('entregas', () => {});
  expect(baja).toHaveBeenCalledTimes(1);
  expect(almacen.estado('entregas').error).toBeInstanceOf(Error);
  almacen.adquirir('entregas', () => {});
  expect(suscribir).toHaveBeenCalledTimes(2);
});

test('5. cerrarTodas da de baja todo al instante, incluso con temporizadores pendientes', () => {
  const { almacen, aperturas } = nuevoAlmacen();
  const oyenteVivo = jest.fn();
  almacen.adquirir('pedidos', oyenteVivo);
  const soltarEnGracia = almacen.adquirir('entregas', () => {});
  aperturas[0].onDatos(snap([{ id: 'p1' }]));
  soltarEnGracia(); // queda un temporizador pendiente

  almacen.cerrarTodas();
  expect(aperturas[0].baja).toHaveBeenCalledTimes(1);
  expect(aperturas[1].baja).toHaveBeenCalledTimes(1);
  expect(almacen._entrada('pedidos')).toBeUndefined();
  expect(almacen._entrada('entregas')).toBeUndefined();
  // Sin datos de la sesión anterior a la vista.
  expect(almacen.estado('pedidos')).toBe(ESTADO_CARGANDO);
  expect(oyenteVivo).toHaveBeenCalled();

  // El temporizador viejo no dispara una segunda baja.
  jest.advanceTimersByTime(GRACIA * 2);
  expect(aperturas[1].baja).toHaveBeenCalledTimes(1);
  // Un callback tardío de la suscripción cerrada no revive nada.
  aperturas[0].onDatos(snap([{ id: 'p2' }]));
  expect(almacen._entrada('pedidos')).toBeUndefined();
});

test('5b. el soltar de antes de cerrarTodas no toca la suscripción nueva', () => {
  const { almacen, aperturas } = nuevoAlmacen();
  const soltarViejo = almacen.adquirir('viajes', () => {});
  almacen.cerrarTodas();
  almacen.adquirir('viajes', () => {});
  soltarViejo();
  expect(almacen._entrada('viajes').usuarios).toBe(1);
  jest.advanceTimersByTime(GRACIA * 2);
  expect(aperturas[1].baja).not.toHaveBeenCalled();
});

test('6. el contador solo suma snapshots que no vienen de caché', () => {
  const { almacen, aperturas } = nuevoAlmacen();
  almacen.adquirir('domicilios', () => {});
  const tres = [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }];
  aperturas[0].onDatos(snap(tres, { fromCache: true }));
  expect(almacen.lecturas()).toEqual({});
  aperturas[0].onDatos(snap(tres, { fromCache: false, cambios: 1 }));
  expect(almacen.lecturas()).toEqual({ domicilios: 1 });
  aperturas[0].onDatos(snap(tres, { fromCache: false, cambios: 3 }));
  expect(almacen.lecturas()).toEqual({ domicilios: 4 });
  almacen.reiniciarLecturas();
  expect(almacen.lecturas()).toEqual({});
});

test('7. docs mantiene la identidad entre lecturas sin snapshot nuevo', () => {
  const { almacen, aperturas } = nuevoAlmacen();
  almacen.adquirir('productos', () => {});
  aperturas[0].onDatos(snap([{ id: 'p1', nombre: 'Glicerina' }]));
  const primero = almacen.estado('productos');
  expect(primero.docs).toEqual([{ id: 'p1', nombre: 'Glicerina' }]);
  expect(almacen.estado('productos')).toBe(primero);
  expect(almacen.estado('productos').docs).toBe(primero.docs);

  // Snapshot con cambios: array nuevo.
  aperturas[0].onDatos(snap([{ id: 'p1', nombre: 'Glicerina refinada' }], { cambios: 1 }));
  expect(almacen.estado('productos').docs).not.toBe(primero.docs);
  expect(almacen.estado('productos').docs[0].nombre).toBe('Glicerina refinada');
});

test('7b. un snapshot sin cambios de documentos (caché → servidor) conserva el array y no avisa', () => {
  const { almacen, aperturas } = nuevoAlmacen();
  const oyente = jest.fn();
  almacen.adquirir('calendario_reglas', oyente);
  aperturas[0].onDatos(snap([{ id: 'semanal', sabado: 'no_operativo' }], { fromCache: true }));
  const docs = almacen.estado('calendario_reglas').docs;
  expect(oyente).toHaveBeenCalledTimes(1);
  aperturas[0].onDatos(snap([{ id: 'semanal', sabado: 'no_operativo' }], { fromCache: false, cambios: 0 }));
  expect(almacen.estado('calendario_reglas').docs).toBe(docs);
  expect(oyente).toHaveBeenCalledTimes(1);
});

test('7c. una colección vacía también termina de cargar', () => {
  const { almacen, aperturas } = nuevoAlmacen();
  almacen.adquirir('organizacion_emails', () => {});
  aperturas[0].onDatos(snap([], { cambios: 0 }));
  expect(almacen.estado('organizacion_emails')).toMatchObject({ docs: [], cargando: false, error: null });
});

test('8. una clave fuera del catálogo tira Error', () => {
  const { almacen, suscribir } = nuevoAlmacen();
  expect(() => almacen.adquirir('invitaciones', () => {})).toThrow(/fuera del catálogo/);
  expect(() => almacen.estado('pedidos_portal')).toThrow(/fuera del catálogo/);
  expect(() => consultaDe('gps_puntos')).toThrow(/fuera del catálogo/);
  expect(() => almacen.adquirir('toString', () => {})).toThrow(/fuera del catálogo/);
  expect(suscribir).not.toHaveBeenCalled();
});

test('el catálogo tiene exactamente las 13 claves acordadas', () => {
  expect(Object.keys(CATALOGO).sort()).toEqual([
    'calendario_operativo', 'calendario_operativo_activo', 'calendario_reglas',
    'despachos', 'domicilios', 'entregas', 'organizacion_domicilios',
    'organizacion_emails', 'organizaciones', 'pedidos', 'productos',
    'usuarios', 'viajes',
  ]);
});

test('soltar dos veces no descuenta dos usuarios', () => {
  const { almacen } = nuevoAlmacen();
  const soltar = almacen.adquirir('entregas', () => {});
  almacen.adquirir('entregas', () => {});
  soltar();
  soltar();
  expect(almacen._entrada('entregas').usuarios).toBe(1);
});
