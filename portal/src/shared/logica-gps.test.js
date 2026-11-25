/* =============================================================================
 * logica-gps.test.js — TrackEx v1.1.2 — GPS
 * =============================================================================
 *
 * Ver la cabecera de `logica-gps.js` (y la entrada del CHANGELOG) para las
 * causas raíz. Corre con el Jest de CRA: `CI=true npm test -- --watchAll=false`.
 *
 * QUÉ ESCENARIO REAL REPRODUCE CADA BLOQUE
 *   - Unitarios de las funciones puras: los filtros, el buffer, la migración
 *     del buffer de la v1.1.1 y la codificación REST.
 *   - "Gestor — exactamente una vez": las descargas superpuestas del 24/11
 *     (defecto B). Varias descargas a la vez no pueden subir dos veces el
 *     mismo punto ni vaciar el buffer de más.
 *   - "Gestor — dos fuentes": primer y segundo plano grababan la misma
 *     lectura (defecto B).
 *   - "Gestor — red colgada": el SDK dejaba escrituras pendientes horas sin
 *     error (defecto A). Con el timeout la subida termina y se reintenta.
 *   - "Gestor — respuesta perdida": un lote que llegó al servidor sin que la
 *     respuesta llegue al teléfono. Sin la regla nueva de reescritura
 *     idéntica, el reintento queda rechazado para siempre (defecto B).
 *   - "Gestor — viaje cerrado / lote inválido": un viaje o un punto que no
 *     pueden subir no traban al resto (el patrón de `gps_flush_error` en
 *     ráfaga con `puntos_pendientes` creciendo de a uno).
 *   - "Gestor — reinicio de contexto": Android corre la tarea de segundo
 *     plano en un contexto JS nuevo; el buffer en disco sobrevive.
 *   - "Gestor — un día sin red": 3000 puntos suben en lotes de 200.
 *   - "Datos reales del 24/11": las lecturas reales de los tres viajes
 *     (`__fixtures__/gps-24-11-2026.json`), entregadas como llegarán con la
 *     1.1.2 (dos fuentes, mismo `ts`) y con los cortes de red reales.
 *
 * DOBLES
 *   - Almacén en memoria (hace de AsyncStorage).
 *   - Reloj controlado: `ahora()` devuelve lo que fija el test; `esperar()`
 *     resuelve en el próximo macrotask (`setTimeout(0)`). El servidor falso
 *     solo usa microtasks, así que cuando contesta, contesta antes que el
 *     reloj; cuando no contesta, el timeout gana enseguida.
 *   - Servidor falso: recibe el cuerpo REAL de `armarCommitRest`, aplica la
 *     semántica de las reglas de `gps_puntos` y responde con
 *     `clasificarRespuesta`, igual que hará el `fetch` de la app.
 * ========================================================================== */

import {
  PRECISION_MAXIMA_METROS, SEPARACION_MINIMA_MS, BUFFER_MAX_PUNTOS, BUFFER_MAX_EDAD_MS,
  BUFFER_TOPE_PUNTOS, LOTE_MAXIMO_PUNTOS, FUENTE, RESULTADO_SUBIDA,
  distanciaMetros, normalizarLectura, evaluarLectura, fuenteDebeGrabar, agregarAlBuffer,
  debeDescargar, armarLotes, quitarConfirmados, quitarViaje, migrarBufferViejo,
  codificarValorRest, urlCommitRest, armarCommitRest, clasificarRespuesta, crearGestorGPS,
} from './logica-gps';
import fixture from './__fixtures__/gps-24-11-2026.json';

const T0 = Date.UTC(2026, 10, 24, 17, 0, 0);
const PROYECTO = 'demo-explora';

/** Punto del modelo, a `segundos` de T0. */
function punto(segundos, { viajeId = 'v1', lat = -32.69, lng = -60.74, precision = 10, velocidad = null } = {}) {
  return { viajeId, ts: T0 + segundos * 1000, lat, lng, precision, velocidad };
}

/** Puntos cada 30 s, avanzando unos 300 m por paso (≈36 km/h). */
function serie(n, { viajeId = 'v1', desde = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => punto(desde + i * 30, {
    viajeId, lat: -32.69 - (desde / 30 + i) * 0.0027,
  }));
}

/* -----------------------------------------------------------------------------
 * Funciones puras
 * -------------------------------------------------------------------------- */

describe('distanciaMetros', () => {
  test('mismo punto da 0, y un grado de latitud ronda los 111 km', () => {
    expect(distanciaMetros(-32, -60, -32, -60)).toBe(0);
    expect(distanciaMetros(0, 0, 1, 0)).toBeCloseTo(111195, -2);
  });
});

describe('normalizarLectura', () => {
  const lectura = {
    timestamp: T0,
    coords: { latitude: -32.69, longitude: -60.74, accuracy: 12.5, speed: 10 },
  };

  test('ts es el timestamp de la lectura, no la hora actual', () => {
    const p = normalizarLectura(lectura, 'v1');
    expect(p.ts).toBe(T0);
    expect(p.ts).not.toBe(Date.now());
    expect(p).toEqual({ viajeId: 'v1', ts: T0, lat: -32.69, lng: -60.74, precision: 12.5, velocidad: 36 });
  });

  test('speed en m/s pasa a km/h; negativa o ausente da null', () => {
    expect(normalizarLectura({ ...lectura, coords: { ...lectura.coords, speed: 5 } }, 'v1').velocidad).toBe(18);
    expect(normalizarLectura({ ...lectura, coords: { ...lectura.coords, speed: -1 } }, 'v1').velocidad).toBeNull();
    expect(normalizarLectura({ ...lectura, coords: { ...lectura.coords, speed: null } }, 'v1').velocidad).toBeNull();
  });

  test('accuracy ausente da precision null', () => {
    expect(normalizarLectura({ ...lectura, coords: { latitude: 1, longitude: 2 } }, 'v1').precision).toBeNull();
  });

  test('sin timestamp o con coordenadas no finitas devuelve null', () => {
    expect(normalizarLectura({ coords: lectura.coords }, 'v1')).toBeNull();
    expect(normalizarLectura({ ...lectura, coords: { ...lectura.coords, latitude: NaN } }, 'v1')).toBeNull();
    expect(normalizarLectura({ ...lectura, coords: { ...lectura.coords, longitude: '1' } }, 'v1')).toBeNull();
    expect(normalizarLectura(null, 'v1')).toBeNull();
  });
});

describe('evaluarLectura', () => {
  const ultimo = { viajeId: 'v1', ts: T0, lat: -32.69, lng: -60.74 };

  test('sin último punto se acepta', () => {
    expect(evaluarLectura(punto(0), null)).toEqual({ aceptar: true, motivo: 'aceptada' });
  });

  test('invalida: coordenadas fuera de rango, no finitas o ts no finito', () => {
    expect(evaluarLectura(punto(30, { lat: 91 }), ultimo).motivo).toBe('invalida');
    expect(evaluarLectura(punto(30, { lng: -181 }), ultimo).motivo).toBe('invalida');
    expect(evaluarLectura(punto(30, { lat: NaN }), ultimo).motivo).toBe('invalida');
    expect(evaluarLectura({ ...punto(30), ts: Infinity }, ultimo).motivo).toBe('invalida');
    expect(evaluarLectura(null, ultimo).motivo).toBe('invalida');
  });

  test('duplicada: ts igual o anterior al último', () => {
    expect(evaluarLectura(punto(0), ultimo).motivo).toBe('duplicada');
    expect(evaluarLectura(punto(-10), ultimo).motivo).toBe('duplicada');
  });

  test('muy_cercana: menos de SEPARACION_MINIMA_MS del último', () => {
    expect(evaluarLectura({ ...punto(0), ts: T0 + SEPARACION_MINIMA_MS - 1 }, ultimo).motivo).toBe('muy_cercana');
    expect(evaluarLectura({ ...punto(0), ts: T0 + SEPARACION_MINIMA_MS }, ultimo).motivo).toBe('aceptada');
  });

  test('imprecisa: precision mayor al máximo (el máximo exacto pasa)', () => {
    expect(evaluarLectura(punto(30, { precision: PRECISION_MAXIMA_METROS + 1 }), ultimo).motivo).toBe('imprecisa');
    expect(evaluarLectura(punto(30, { precision: PRECISION_MAXIMA_METROS }), ultimo).motivo).toBe('aceptada');
    expect(evaluarLectura(punto(30, { precision: null }), ultimo).motivo).toBe('aceptada');
  });

  test('salto: velocidad implícita con la diferencia de los ts de lectura', () => {
    // 0,01° de latitud ≈ 1,1 km. En 30 s son ≈133 km/h: pasa. En 20 s, ≈200 km/h: salto.
    expect(evaluarLectura(punto(30, { lat: -32.70 }), ultimo).motivo).toBe('aceptada');
    expect(evaluarLectura(punto(20, { lat: -32.70 }), ultimo).motivo).toBe('salto');
  });

  test('el orden de evaluación: invalida > duplicada > muy_cercana > imprecisa > salto', () => {
    expect(evaluarLectura(punto(0, { lat: 99 }), ultimo).motivo).toBe('invalida');
    expect(evaluarLectura(punto(0, { precision: 500 }), ultimo).motivo).toBe('duplicada');
    expect(evaluarLectura(punto(2, { precision: 500, lat: 10 }), ultimo).motivo).toBe('muy_cercana');
    expect(evaluarLectura(punto(30, { precision: 500, lat: 10 }), ultimo).motivo).toBe('imprecisa');
  });

  test('un último de otro viaje se ignora', () => {
    const deOtro = { ...ultimo, viajeId: 'v0' };
    expect(evaluarLectura(punto(0), deOtro).motivo).toBe('aceptada');
    expect(evaluarLectura(punto(1, { lat: 10 }), deOtro).motivo).toBe('aceptada');
  });
});

describe('fuenteDebeGrabar', () => {
  test('las cuatro combinaciones', () => {
    expect(fuenteDebeGrabar(FUENTE.SEGUNDO_PLANO, { servicioActivo: true })).toBe(true);
    expect(fuenteDebeGrabar(FUENTE.SEGUNDO_PLANO, { servicioActivo: false })).toBe(true);
    expect(fuenteDebeGrabar(FUENTE.PRIMER_PLANO, { servicioActivo: true })).toBe(false);
    expect(fuenteDebeGrabar(FUENTE.PRIMER_PLANO, { servicioActivo: false })).toBe(true);
  });
});

describe('agregarAlBuffer', () => {
  test('deduplica por (viajeId, ts) sin mutar el original', () => {
    const b = [punto(0)];
    const r = agregarAlBuffer(b, punto(0));
    expect(r).toHaveLength(1);
    expect(agregarAlBuffer(b, punto(0, { viajeId: 'v2' }))).toHaveLength(2);
    expect(b).toHaveLength(1);
  });

  test('ordena por ts', () => {
    const r = agregarAlBuffer([punto(60), punto(0)], punto(30));
    expect(r.map((p) => p.ts)).toEqual([T0, T0 + 30000, T0 + 60000]);
  });

  test('recorta al tope conservando los más nuevos', () => {
    const lleno = Array.from({ length: BUFFER_TOPE_PUNTOS }, (_, i) => punto(i * 30));
    const r = agregarAlBuffer(lleno, punto(BUFFER_TOPE_PUNTOS * 30));
    expect(r).toHaveLength(BUFFER_TOPE_PUNTOS);
    expect(r[0].ts).toBe(T0 + 30000);
    expect(r[r.length - 1].ts).toBe(T0 + BUFFER_TOPE_PUNTOS * 30000);
  });
});

describe('debeDescargar', () => {
  test('por cantidad, por antigüedad, y vacío', () => {
    expect(debeDescargar([], T0)).toBe(false);
    expect(debeDescargar(serie(BUFFER_MAX_PUNTOS - 1), T0)).toBe(false);
    expect(debeDescargar(serie(BUFFER_MAX_PUNTOS), T0)).toBe(true);
    expect(debeDescargar([punto(0)], T0 + BUFFER_MAX_EDAD_MS - 1)).toBe(false);
    expect(debeDescargar([punto(0)], T0 + BUFFER_MAX_EDAD_MS)).toBe(true);
  });
});

describe('armarLotes', () => {
  test('agrupa por viaje, en el orden del punto más viejo, con lotes de a lo sumo 200', () => {
    const buffer = [...serie(450, { viajeId: 'v2', desde: 100 }), ...serie(3, { viajeId: 'v1', desde: 0 })].reverse();
    const lotes = armarLotes(buffer);
    expect(lotes.map((l) => [l.viajeId, l.puntos.length])).toEqual([
      ['v1', 3], ['v2', LOTE_MAXIMO_PUNTOS], ['v2', LOTE_MAXIMO_PUNTOS], ['v2', 50],
    ]);
    for (const l of lotes) {
      const ts = l.puntos.map((p) => p.ts);
      expect(ts).toEqual([...ts].sort((a, b) => a - b));
    }
    expect(armarLotes([])).toEqual([]);
  });
});

describe('quitarConfirmados y quitarViaje', () => {
  const buffer = [punto(0), punto(30), punto(30, { viajeId: 'v2' }), punto(60)];

  test('quitarConfirmados quita solo esos puntos de ese viaje', () => {
    const r = quitarConfirmados(buffer, 'v1', [T0 + 30000]);
    expect(r).toEqual([punto(0), punto(30, { viajeId: 'v2' }), punto(60)]);
    expect(buffer).toHaveLength(4);
  });

  test('quitarViaje quita todos los de un viaje', () => {
    expect(quitarViaje(buffer, 'v1')).toEqual([punto(30, { viajeId: 'v2' })]);
  });
});

describe('migrarBufferViejo', () => {
  const iso = '2026-11-24T17:42:14.870Z';

  test('ISO -> ms igual a new Date(iso).getTime() (el ID que usó la v1.1.1)', () => {
    const r = migrarBufferViejo([{ lat: -32.69, lng: -60.74, ts: iso }], 'v1');
    expect(r).toEqual({
      buffer: [{ viajeId: 'v1', ts: new Date(iso).getTime(), lat: -32.69, lng: -60.74, precision: null, velocidad: null }],
      descartados: 0,
    });
  });

  test('mezcla de formas: la nueva pasa tal cual, las inválidas se cuentan', () => {
    const nuevo = punto(0, { viajeId: 'v0' });
    const r = migrarBufferViejo([nuevo, { lat: 1, lng: 2, ts: iso }, { lat: 1, lng: 2, ts: 'basura' }, null, { lat: 'x', lng: 2, ts: iso }], 'v1');
    expect(r.buffer).toHaveLength(2);
    expect(r.buffer[0]).toBe(nuevo);
    expect(r.descartados).toBe(3);
  });

  test('sin viaje activo descarta todos los viejos', () => {
    expect(migrarBufferViejo([{ lat: 1, lng: 2, ts: iso }, { lat: 3, lng: 4, ts: iso }], null))
      .toEqual({ buffer: [], descartados: 2 });
    expect(migrarBufferViejo('no es un array', 'v1')).toEqual({ buffer: [], descartados: 0 });
  });
});

describe('codificarValorRest', () => {
  test('todos los tipos, con la misma codificación que el SDK web', () => {
    expect(codificarValorRest(null)).toEqual({ nullValue: null });
    expect(codificarValorRest(12)).toEqual({ integerValue: '12' });
    expect(codificarValorRest(-32)).toEqual({ integerValue: '-32' });
    expect(codificarValorRest(12.5)).toEqual({ doubleValue: 12.5 });
    expect(codificarValorRest(true)).toEqual({ booleanValue: true });
    expect(codificarValorRest('hola')).toEqual({ stringValue: 'hola' });
    expect(codificarValorRest(new Date(T0))).toEqual({ timestampValue: '2026-11-24T17:00:00.000Z' });
  });

  test('cualquier otro tipo lanza', () => {
    expect(() => codificarValorRest(undefined)).toThrow(Error);
    expect(() => codificarValorRest({})).toThrow(Error);
    expect(() => codificarValorRest([1])).toThrow(Error);
    expect(() => codificarValorRest(NaN)).toThrow(Error);
  });
});

describe('urlCommitRest y armarCommitRest', () => {
  test('URL del commit', () => {
    expect(urlCommitRest('explora-portal'))
      .toBe('https://firestore.googleapis.com/v1/projects/explora-portal/databases/(default)/documents:commit');
  });

  test('lote de 2 puntos: igualdad exacta con el cuerpo escrito a mano', () => {
    const puntos = [
      { viajeId: 'V1', ts: 1795534800000, lat: -32.69, lng: -60.74, precision: 8.5, velocidad: 43.2 },
      { viajeId: 'V1', ts: 1795534770000, lat: -32.6904712, lng: -60.7444531, precision: 12, velocidad: null },
    ];
    const base = 'projects/p1/databases/(default)/documents';
    expect(armarCommitRest({ projectId: 'p1', viajeId: 'V1', puntos })).toEqual({
      writes: [
        {
          update: {
            name: `${base}/viajes/V1/gps_puntos/1795534770000`,
            fields: {
              lat: { doubleValue: -32.6904712 },
              lng: { doubleValue: -60.7444531 },
              ts: { timestampValue: '2026-11-24T15:39:30.000Z' },
              precision: { integerValue: '12' },
              velocidad: { nullValue: null },
            },
          },
        },
        {
          update: {
            name: `${base}/viajes/V1/gps_puntos/1795534800000`,
            fields: {
              lat: { doubleValue: -32.69 },
              lng: { doubleValue: -60.74 },
              ts: { timestampValue: '2026-11-24T15:40:00.000Z' },
              precision: { doubleValue: 8.5 },
              velocidad: { doubleValue: 43.2 },
            },
          },
        },
        {
          update: {
            name: `${base}/viajes/V1`,
            fields: {
              ultima_lat: { doubleValue: -32.69 },
              ultima_lng: { doubleValue: -60.74 },
              ultima_ts: { timestampValue: '2026-11-24T15:40:00.000Z' },
            },
          },
          updateMask: { fieldPaths: ['ultima_lat', 'ultima_lng', 'ultima_ts'] },
          updateTransforms: [
            { fieldPath: 'puntos_registrados', increment: { integerValue: '2' } },
            { fieldPath: 'actualizado_en', setToServerValue: 'REQUEST_TIME' },
          ],
          currentDocument: { exists: true },
        },
      ],
    });
  });
});

describe('clasificarRespuesta', () => {
  const err = (status) => ({ error: { status } });
  test.each([
    [200, null, 'ok'],
    [401, null, 'sesion'],
    [400, err('UNAUTHENTICATED'), 'sesion'],
    [403, null, 'permiso'],
    [403, err('PERMISSION_DENIED'), 'permiso'],
    [404, err('NOT_FOUND'), 'viaje_inexistente'],
    [400, err('FAILED_PRECONDITION'), 'viaje_inexistente'],
    [400, err('INVALID_ARGUMENT'), 'invalido'],
    [429, null, 'reintentar'],
    [500, null, 'reintentar'],
    [503, null, 'reintentar'],
    [409, err('ABORTED'), 'reintentar'],
    [503, err('UNAVAILABLE'), 'reintentar'],
    [504, err('DEADLINE_EXCEEDED'), 'reintentar'],
    [429, err('RESOURCE_EXHAUSTED'), 'reintentar'],
    [418, null, 'reintentar'],
    [400, err('ALGO_NUEVO'), 'reintentar'],
  ])('HTTP %s con %j → %s', (status, cuerpo, esperado) => {
    expect(clasificarRespuesta(status, cuerpo)).toBe(esperado);
  });
});

/* -----------------------------------------------------------------------------
 * Dobles del gestor
 * -------------------------------------------------------------------------- */

/** Almacén en memoria con la interfaz de `crearGestorGPS`. */
function crearAlmacen(bufferInicial = []) {
  const estado = { buffer: bufferInicial, ultimo: null };
  return {
    estado,
    leerBuffer: async () => estado.buffer,
    escribirBuffer: async (b) => { estado.buffer = b; },
    leerUltimo: async () => estado.ultimo,
    escribirUltimo: async (p) => { estado.ultimo = p; },
  };
}

/** Reloj controlado: `ahora` lo fija el test; `esperar` es un macrotask. */
function crearReloj(t = T0) {
  return {
    t,
    ahora() { return this.t; },
    esperar: () => new Promise((r) => setTimeout(r, 0)),
  };
}

const NUNCA = () => new Promise(() => {});

/** Decodifica un Value REST a JS (solo lo que usa el commit de puntos). */
function decodificar(v) {
  if ('nullValue' in v) return null;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  throw new Error(`valor no esperado ${JSON.stringify(v)}`);
}

/**
 * Servidor falso con la semántica de las reglas de `gps_puntos`:
 *   - crea el punto si no existe;
 *   - lo reescribe solo si queda idéntico (con `permitirReescrituraIdentica`);
 *     si no, rechaza TODO el lote con PERMISO;
 *   - rechaza con PERMISO los puntos de un viaje que no esté EN_VIAJE;
 *   - `sinRed`: la promesa nunca resuelve;
 *   - `perderRespuestas`: aplica el commit y después no contesta.
 */
function crearServidor({ permitirReescrituraIdentica = true, viajes = { v1: 'EN_VIAJE' } } = {}) {
  const s = {
    sinRed: false,
    perderRespuestas: 0,
    tsInvalidos: new Set(),
    docs: new Map(),
    escrituras: new Map(),
    viajes: Object.fromEntries(Object.entries(viajes).map(([id, estado]) => [id, { estado, puntos_registrados: 0, ultima_ts: null }])),
    respuestas: [],
    commits: [],
  };

  const responder = (status, estado) => {
    const cuerpo = estado ? { error: { status: estado } } : {};
    const resultado = clasificarRespuesta(status, cuerpo);
    s.respuestas.push(resultado);
    return { resultado, detalle: estado || null };
  };

  s.commit = async (cuerpo) => {
    if (s.sinRed) return NUNCA();
    s.commits.push(cuerpo);
    const writes = cuerpo.writes;
    const wViaje = writes[writes.length - 1];
    const viajeId = wViaje.update.name.split('/').pop();
    const viaje = s.viajes[viajeId];
    const puntos = writes.slice(0, -1);

    if (!viaje) return responder(400, 'FAILED_PRECONDITION');
    if (viaje.estado !== 'EN_VIAJE') return responder(403, 'PERMISSION_DENIED');
    if (puntos.some((w) => s.tsInvalidos.has(decodificar(w.update.fields.ts)))) {
      return responder(400, 'INVALID_ARGUMENT');
    }
    for (const w of puntos) {
      const previo = s.docs.get(w.update.name);
      const nuevo = JSON.stringify(w.update.fields);
      if (previo !== undefined && (!permitirReescrituraIdentica || previo !== nuevo)) {
        return responder(403, 'PERMISSION_DENIED');
      }
    }

    // Commit atómico: se aplica todo.
    for (const w of puntos) {
      s.docs.set(w.update.name, JSON.stringify(w.update.fields));
      s.escrituras.set(w.update.name, (s.escrituras.get(w.update.name) || 0) + 1);
    }
    viaje.ultima_ts = decodificar(wViaje.update.fields.ultima_ts);
    viaje.puntos_registrados += Number(wViaje.updateTransforms[0].increment.integerValue);

    if (s.perderRespuestas > 0) {
      s.perderRespuestas -= 1;
      return NUNCA();
    }
    return responder(200, null);
  };

  /** ts de los puntos guardados de un viaje. */
  s.tsGuardados = (viajeId) => [...s.docs.keys()]
    .filter((k) => k.includes(`/viajes/${viajeId}/gps_puntos/`))
    .map((k) => Number(k.split('/').pop()))
    .sort((a, b) => a - b);

  return s;
}

/** Arma un gestor contra el servidor falso. */
function crearEscenario(opciones = {}) {
  const servidor = crearServidor(opciones);
  const almacen = crearAlmacen(opciones.bufferInicial || []);
  const reloj = crearReloj();
  const logs = [];
  const deps = {
    almacen,
    reloj,
    enviarLote: ({ viajeId, puntos }) => servidor.commit(armarCommitRest({ projectId: PROYECTO, viajeId, puntos })),
    consultarEstadoViaje: async (id) => (servidor.viajes[id] ? servidor.viajes[id].estado : null),
    registrarLog: async (evento, extra) => { logs.push({ evento, ...extra }); },
  };
  return { servidor, almacen, reloj, logs, deps, gestor: crearGestorGPS(deps) };
}

const registrar = (gestor, p, fuente = FUENTE.SEGUNDO_PLANO, servicioActivo = true) =>
  gestor.registrarLectura({ punto: p, fuente, servicioActivo });

/* -----------------------------------------------------------------------------
 * Gestor
 * -------------------------------------------------------------------------- */

describe('Gestor — exactamente una vez', () => {
  test('20 lecturas y 3 descargas concurrentes: cada punto una sola vez en el servidor, buffer vacío', async () => {
    const { gestor, servidor, almacen } = crearEscenario();
    const puntos = serie(20);
    const resultados = await Promise.all([
      ...puntos.map((p) => registrar(gestor, p)),
      gestor.descargar(), gestor.descargar(), gestor.descargar(),
    ]);

    expect(resultados.slice(0, 20).every((r) => r.motivo === 'aceptada')).toBe(true);
    expect(servidor.tsGuardados('v1')).toEqual(puntos.map((p) => p.ts));
    expect([...servidor.escrituras.values()].every((n) => n === 1)).toBe(true);
    expect(servidor.viajes.v1.puntos_registrados).toBe(20);
    expect(almacen.estado.buffer).toEqual([]);
    expect(await gestor.pendientes()).toBe(0);
  });

  test('una descarga en vuelo: la segunda llamada devuelve la misma promesa', () => {
    const { gestor } = crearEscenario();
    expect(gestor.descargar()).toBe(gestor.descargar());
  });
});

describe('Gestor — dos fuentes', () => {
  test('con servicio activo, la copia de primer plano es fuente_inactiva', async () => {
    const { gestor, almacen } = crearEscenario();
    const p = punto(0);
    const [a, b] = await Promise.all([
      registrar(gestor, p, FUENTE.SEGUNDO_PLANO, true),
      registrar(gestor, p, FUENTE.PRIMER_PLANO, true),
    ]);
    expect(a.motivo).toBe('aceptada');
    expect(b.motivo).toBe('fuente_inactiva');
    expect(almacen.estado.buffer).toHaveLength(1);
  });

  test('sin servicio, las dos graban y la segunda copia es duplicada', async () => {
    const { gestor, almacen } = crearEscenario();
    const p = punto(0);
    const [a, b] = await Promise.all([
      registrar(gestor, p, FUENTE.SEGUNDO_PLANO, false),
      registrar(gestor, p, FUENTE.PRIMER_PLANO, false),
    ]);
    expect([a.motivo, b.motivo]).toEqual(['aceptada', 'duplicada']);
    expect(almacen.estado.buffer).toHaveLength(1);
  });
});

describe('Gestor — red colgada', () => {
  test('enviarLote no resuelve: termina por timeout como SIN_RED, conserva el buffer y después sube todo', async () => {
    const { gestor, servidor, almacen, logs, reloj } = crearEscenario();
    servidor.sinRed = true;

    let ultima;
    for (const p of serie(BUFFER_MAX_PUNTOS)) ultima = await registrar(gestor, p);
    expect(ultima.descarga).toMatchObject({ resultado: RESULTADO_SUBIDA.SIN_RED, detalle: 'timeout', pendientes: BUFFER_MAX_PUNTOS });
    expect(almacen.estado.buffer).toHaveLength(BUFFER_MAX_PUNTOS);
    expect(logs.find((l) => l.evento === 'gps_subida_error')).toMatchObject({
      viaje_id: 'v1', resultado: 'sin_red', detalle: 'timeout', puntos_pendientes: BUFFER_MAX_PUNTOS, lote: BUFFER_MAX_PUNTOS,
    });

    servidor.sinRed = false;
    reloj.t += 30 * 60000;
    const r = await gestor.descargar();
    expect(r).toMatchObject({ resultado: 'ok', enviados: BUFFER_MAX_PUNTOS, pendientes: 0 });
    expect(servidor.tsGuardados('v1')).toHaveLength(BUFFER_MAX_PUNTOS);
    const recuperada = logs.find((l) => l.evento === 'gps_subida_recuperada');
    expect(recuperada).toBeDefined();
    expect(recuperada.minutos_corte).toBeGreaterThanOrEqual(30);
  });

  test('una excepción de enviarLote cuenta como SIN_RED con su mensaje', async () => {
    const { deps } = crearEscenario({ bufferInicial: serie(3) });
    const gestor = crearGestorGPS({ ...deps, enviarLote: async () => { throw new Error('Network request failed'); } });
    expect(await gestor.descargar()).toMatchObject({ resultado: 'sin_red', detalle: 'Network request failed', pendientes: 3 });
  });

  test('un log que falla no rompe la descarga', async () => {
    const { deps, servidor } = crearEscenario({ bufferInicial: serie(3) });
    servidor.sinRed = true;
    const gestor = crearGestorGPS({ ...deps, registrarLog: async () => { throw new Error('sin red para el log'); } });
    await expect(gestor.descargar()).resolves.toMatchObject({ resultado: 'sin_red', pendientes: 3 });
  });
});

describe('Gestor — respuesta perdida', () => {
  test('el servidor aplica y no contesta: el reintento reescribe idéntico y entra', async () => {
    const { gestor, servidor } = crearEscenario({ bufferInicial: serie(5) });
    servidor.perderRespuestas = 1;

    expect(await gestor.descargar()).toMatchObject({ resultado: 'sin_red', detalle: 'timeout', pendientes: 5 });
    expect(servidor.tsGuardados('v1')).toHaveLength(5);

    expect(await gestor.descargar()).toMatchObject({ resultado: 'ok', enviados: 5, pendientes: 0 });
    expect(servidor.tsGuardados('v1')).toHaveLength(5);
    expect(servidor.respuestas).not.toContain('permiso');
  });

  test('SIN la regla de reescritura idéntica (la de la v1.1.1) el buffer queda trabado para siempre: por eso la regla nueva es necesaria', async () => {
    const { gestor, servidor, logs } = crearEscenario({ bufferInicial: serie(5), permitirReescrituraIdentica: false });
    servidor.perderRespuestas = 1;
    await gestor.descargar();

    for (let i = 0; i < 3; i += 1) {
      expect(await gestor.descargar()).toMatchObject({ resultado: 'permiso', enviados: 0, pendientes: 5 });
    }
    expect(logs.filter((l) => l.evento === 'gps_subida_error' && l.resultado === 'permiso')).toHaveLength(3);
  });
});

describe('Gestor — viaje cerrado', () => {
  test('los puntos de un viaje FINALIZADO se descartan y no bloquean los del viaje activo', async () => {
    const viejos = serie(250, { viajeId: 'v0', desde: 0 });
    const { gestor, servidor, logs } = crearEscenario({
      viajes: { v0: 'FINALIZADO', v1: 'EN_VIAJE' },
      // Los dos viajes ya en el buffer (el del activo, detrás del cerrado).
      bufferInicial: [...viejos, ...serie(5, { desde: 250 * 30 })],
    });

    const r = await gestor.descargar();
    expect(r).toMatchObject({ resultado: 'ok', descartados: 250, pendientes: 0, viajesDescartados: ['v0'] });
    expect(servidor.tsGuardados('v1')).toHaveLength(5);
    expect(servidor.tsGuardados('v0')).toHaveLength(0);
    expect(logs.find((l) => l.evento === 'gps_descarte')).toMatchObject({
      viaje_id: 'v0', resultado: 'permiso', detalle: 'FINALIZADO', lote: 250,
    });
  });

  test('viaje inexistente: se descarta con gps_descarte', async () => {
    const { gestor, logs } = crearEscenario({ bufferInicial: serie(3, { viajeId: 'borrado' }) });
    expect(await gestor.descargar()).toMatchObject({ resultado: 'ok', descartados: 3, pendientes: 0 });
    expect(logs[0]).toMatchObject({ evento: 'gps_descarte', viaje_id: 'borrado', resultado: 'viaje_inexistente' });
  });

  test('PERMISO con el viaje EN_VIAJE, o si falla la consulta: conserva y corta', async () => {
    const base = crearEscenario({ bufferInicial: serie(3) });
    const conPermiso = { ...base.deps, enviarLote: async () => ({ resultado: RESULTADO_SUBIDA.PERMISO }) };
    expect(await crearGestorGPS(conPermiso).descargar()).toMatchObject({ resultado: 'permiso', pendientes: 3 });

    const consultaRota = { ...conPermiso, consultarEstadoViaje: async () => { throw new Error('offline'); } };
    expect(await crearGestorGPS(consultaRota).descargar()).toMatchObject({ resultado: 'permiso', pendientes: 3 });

    const consultaColgada = { ...conPermiso, consultarEstadoViaje: NUNCA };
    expect(await crearGestorGPS(consultaColgada).descargar())
      .toMatchObject({ resultado: 'permiso', detalle: 'consulta_viaje_timeout', pendientes: 3 });
  });

  test('SESION y REINTENTAR conservan el buffer', async () => {
    for (const resultado of [RESULTADO_SUBIDA.SESION, RESULTADO_SUBIDA.REINTENTAR]) {
      const { deps } = crearEscenario({ bufferInicial: serie(3) });
      const gestor = crearGestorGPS({ ...deps, enviarLote: async () => ({ resultado }) });
      expect(await gestor.descargar()).toMatchObject({ resultado, pendientes: 3 });
    }
  });
});

describe('Gestor — lote inválido', () => {
  test('un punto rechazado con INVALIDO se descarta solo y el resto sube', async () => {
    const puntos = serie(10);
    const { gestor, servidor, logs } = crearEscenario({ bufferInicial: puntos });
    servidor.tsInvalidos.add(puntos[3].ts);

    expect(await gestor.descargar()).toMatchObject({ resultado: 'ok', enviados: 9, descartados: 1, pendientes: 0 });
    expect(servidor.tsGuardados('v1')).toEqual(puntos.filter((_, i) => i !== 3).map((p) => p.ts));
    expect(logs.filter((l) => l.evento === 'gps_punto_descartado')).toEqual([
      expect.objectContaining({ viaje_id: 'v1', resultado: 'invalido', lote: 1, ts: puntos[3].ts }),
    ]);
  });
});

describe('Gestor — reinicio de contexto', () => {
  test('el gestor A registra sin red; un gestor B nuevo con el mismo almacén los sube', async () => {
    const { deps, servidor, almacen } = crearEscenario();
    servidor.sinRed = true;
    const a = crearGestorGPS(deps);
    for (const p of serie(12)) await registrar(a, p);
    expect(almacen.estado.buffer).toHaveLength(12);

    servidor.sinRed = false;
    const b = crearGestorGPS(deps);
    expect(await b.descargar()).toMatchObject({ resultado: 'ok', enviados: 12, pendientes: 0 });
    expect(servidor.tsGuardados('v1')).toHaveLength(12);
  });
});

describe('Gestor — un día sin red', () => {
  test('3000 puntos suben en lotes de 200', async () => {
    const { gestor, servidor } = crearEscenario({ bufferInicial: serie(3000) });
    expect(await gestor.descargar()).toMatchObject({ resultado: 'ok', enviados: 3000, pendientes: 0 });
    expect(servidor.commits).toHaveLength(15);
    expect(servidor.commits.every((c) => c.writes.length === LOTE_MAXIMO_PUNTOS + 1)).toBe(true);
    expect(servidor.viajes.v1.puntos_registrados).toBe(3000);
  });
});

/* -----------------------------------------------------------------------------
 * Datos reales del 24/11/2026
 * -------------------------------------------------------------------------- */

/**
 * Colapsa los pares de la v1.1.1 (misma lectura grabada por dos fuentes, con
 * las mismas coordenadas y menos de 1000 ms de diferencia): se toma la primera.
 */
function colapsarPares(lecturas) {
  const ordenadas = [...lecturas].sort((a, b) => a.ms - b.ms);
  const unicas = [];
  for (const l of ordenadas) {
    const previa = unicas[unicas.length - 1];
    const par = previa && previa.lat === l.lat && previa.lng === l.lng && l.ms - previa.ms < 1000;
    if (!par) unicas.push(l);
  }
  return unicas;
}

describe('Datos reales del 24/11/2026', () => {
  for (const viaje of fixture.viajes) {
    test(`${viaje.nombre}: cada lectura aceptada llega una vez, sin PERMISO, buffer vacío`, async () => {
      const { gestor, servidor, almacen, reloj } = crearEscenario({ viajes: { [viaje.nombre]: 'EN_VIAJE' } });
      const enCorte = (t) => viaje.cortes_de_red.some((c) => t >= c.desde_ms && t < c.hasta_ms);
      // El viaje sin segundo plano corre sin servicio: graban las dos fuentes.
      const servicioActivo = viaje.nombre !== 'viaje_sin_segundo_plano';

      // El viaje sin segundo plano tenía una sola fuente: no tiene pares.
      const unicas = colapsarPares(viaje.lecturas);
      expect(unicas.length).toBeLessThanOrEqual(viaje.lecturas.length);

      const aceptados = [];
      for (const l of unicas) {
        reloj.t = l.ms;
        servidor.sinRed = enCorte(l.ms);
        const p = { viajeId: viaje.nombre, ts: l.ms, lat: l.lat, lng: l.lng, precision: null, velocidad: null };
        const resultados = await Promise.all([
          registrar(gestor, p, FUENTE.SEGUNDO_PLANO, servicioActivo),
          registrar(gestor, p, FUENTE.PRIMER_PLANO, servicioActivo),
        ]);
        if (resultados.some((r) => r.motivo === 'aceptada')) aceptados.push(p.ts);
        expect(resultados.filter((r) => r.motivo === 'aceptada').length).toBeLessThanOrEqual(1);
      }

      // Al final, con red, se descarga hasta que no queden pendientes.
      servidor.sinRed = false;
      for (let i = 0; i < 20 && (await gestor.pendientes()) > 0; i += 1) await gestor.descargar();

      const guardados = servidor.tsGuardados(viaje.nombre);
      const setAceptados = new Set(aceptados);
      expect(guardados.every((ts) => setAceptados.has(ts))).toBe(true);       // (a)
      expect(guardados).toEqual([...aceptados].sort((a, b) => a - b));        // (b)
      expect(almacen.estado.buffer).toEqual([]);                              // (c)
      expect(servidor.respuestas).not.toContain(RESULTADO_SUBIDA.PERMISO);    // (d)
      expect(servidor.viajes[viaje.nombre].ultima_ts).toBe(Math.max(...aceptados)); // (e)
    });
  }
});
