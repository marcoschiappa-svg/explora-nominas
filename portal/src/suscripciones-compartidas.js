/* =============================================================================
 * suscripciones-compartidas.js — Portal Explora
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * v1.2.7 — LECTURAS COMPARTIDAS
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     `explora-portal` superó la cuota diaria gratuita de Firestore (114k
 *     lecturas contra 1k escrituras en un día).
 *
 *   CAUSA RAÍZ
 *     La navegación del portal es por estado (`modulo` en `App.js`): cada
 *     pantalla abre `onSnapshot` sobre colecciones COMPLETAS al montarse y las
 *     cierra al salir. Volver a entrar relee todo (Programación sola son 10
 *     colecciones enteras, Pedidos 9). Y sin caché persistente, cada F5 o
 *     pestaña nueva también relee todo.
 *
 *   ALCANCE
 *     1. Catálogo FIJO de consultas (`CATALOGO`): las mismas colecciones,
 *        `where` y `orderBy` que ya usaban las pantallas. Una clave fuera del
 *        catálogo tira Error.
 *     2. `crearAlmacen(...)`: núcleo sin Firestore (testeable). Una sola
 *        suscripción viva por clave, con contador de usuarios (refcount).
 *        Cuando el último la suelta, la baja se programa a `graciaMs` (10
 *        minutos en producción); si alguien la vuelve a pedir antes, se
 *        cancela la baja y se reutiliza la misma suscripción.
 *     3. `docs` es `{ id, ...data() }` (igual que antes en cada pantalla) y
 *        cambia de identidad SOLO cuando llega un snapshot con cambios, para
 *        no romper los `useMemo` de las pantallas. Un snapshot sin cambios de
 *        documentos (p. ej. el paso de caché a servidor) conserva el array.
 *     4. Error: el estado queda con `error`, `cargando: false`, se avisa a los
 *        oyentes y se cierra la suscripción; el próximo `adquirir` la reabre.
 *        Se registra con `console.error` acá (antes, los listeners sin
 *        callback de error los registraba Firestore) y cada pantalla conserva
 *        su propio `console.error` vía `error` (`useAvisarError`).
 *     5. `cerrarTodas()` / `cerrarTodasLasSuscripciones()`: baja inmediata de
 *        todo y almacén vacío (logout, cambio de usuario).
 *     6. Contador aproximado de lecturas por clave, con
 *        `window.exploraLecturas()` y `window.exploraLecturasReiniciar()`.
 *     7. `useColeccionCompartida(clave | null)`: hook sobre
 *        `useSyncExternalStore`. Con `null` no se suscribe y devuelve
 *        `{ docs: [], cargando: false, error: null }`.
 *
 *   LIMITACIONES CONOCIDAS
 *     - El contador (6) es una APROXIMACIÓN, no la facturación real: suma
 *       `snap.docChanges().length` de los snapshots que no vienen de caché.
 *       No ve las lecturas de `getDoc`/`getDocs`, ni de los listeners que no
 *       pasan por este módulo, ni el mínimo de 1 lectura por consulta vacía,
 *       ni las relecturas completas que Firestore cobra al reanudar una
 *       consulta después de 30 minutos desconectada.
 *     - Durante la gracia (10 min) la suscripción sigue viva aunque ninguna
 *       pantalla la use: los cambios que lleguen en ese lapso se leen (y se
 *       cobran) igual. Es el precio de no releer la colección entera al volver.
 *     - Los arrays `docs` (y sus objetos) son COMPARTIDOS entre pantallas: no
 *       se deben mutar en el lugar (`sort`, `push`, asignar campos). Al
 *       introducir este módulo se revisaron las pantallas migradas y ninguna
 *       lo hace (todas ordenan sobre copias de `filter`/`map`/`slice`).
 *     - Si una pantalla sigue montada cuando se llama a `cerrarTodas()`, se le
 *       avisa (pasa a "cargando" sin datos) pero no se vuelve a suscribir
 *       sola. En la práctica no pasa: el logout/cambio de usuario desmonta
 *       las pantallas (y `cerrarSesionCompleta` recarga la página).
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- suscripciones-compartidas --watchAll=false`.
 *     Manual: en la consola del navegador, `exploraLecturasReiniciar()`,
 *     entrar a Programación, volver a Home, entrar a Pedidos y a Programación
 *     otra vez; `exploraLecturas()` debe mostrar cada colección leída una
 *     sola vez (más los cambios reales que hayan llegado).
 * ========================================================================== */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from './firebase';

/* ── v1.2.7 (1) Catálogo fijo ─────────────────────────────────────────────── */

const completa = (nombre) => (base) => collection(base, nombre);

/**
 * clave → función `(db) => consulta`. Copia EXACTA de las consultas que
 * usaban las pantallas: no agregar `where`/`orderBy` sin revisar índices y
 * reglas.
 */
export const CATALOGO = Object.freeze({
  pedidos: (base) => query(collection(base, 'pedidos'), orderBy('creado_en', 'desc')),
  entregas: completa('entregas'),
  despachos: completa('despachos'),
  viajes: completa('viajes'),
  organizaciones: completa('organizaciones'),
  productos: completa('productos'),
  domicilios: completa('domicilios'),
  organizacion_domicilios: completa('organizacion_domicilios'),
  organizacion_emails: completa('organizacion_emails'),
  usuarios: completa('usuarios'),
  calendario_reglas: completa('calendario_reglas'),
  calendario_operativo: completa('calendario_operativo'),
  calendario_operativo_activo: (base) =>
    query(collection(base, 'calendario_operativo'), where('estado', '==', 'activo')),
});

function validarClave(clave) {
  if (!Object.prototype.hasOwnProperty.call(CATALOGO, clave)) {
    throw new Error(`suscripciones-compartidas: clave fuera del catálogo: "${clave}"`);
  }
}

/** La consulta de Firestore de una clave del catálogo. */
export function consultaDe(clave) {
  validarClave(clave);
  return CATALOGO[clave](db);
}

/* ── v1.2.7 (2) Núcleo sin Firestore ──────────────────────────────────────── */

/** Estado de una clave que todavía no recibió nada. Constante: identidad estable. */
export const ESTADO_CARGANDO = Object.freeze({ docs: Object.freeze([]), cargando: true, error: null });
/** Lo que devuelve el hook con `clave === null`. */
export const ESTADO_NULO = Object.freeze({ docs: Object.freeze([]), cargando: false, error: null });

export const GRACIA_MS = 10 * 60 * 1000;

/**
 * @param {object} opciones
 * @param {(clave: string, onDatos: (snap) => void, onError: (err) => void) => () => void} opciones.suscribir
 *   Abre la suscripción real y devuelve la función de baja.
 * @param {number} [opciones.graciaMs]
 * @param {Function} [opciones.setTimeout]
 * @param {Function} [opciones.clearTimeout]
 */
export function crearAlmacen({
  suscribir,
  graciaMs = GRACIA_MS,
  setTimeout: programar = (fn, ms) => setTimeout(fn, ms),
  clearTimeout: cancelar = (id) => clearTimeout(id),
}) {
  // clave → { estado: {docs, cargando, error}, usuarios, baja, temporizador, oyentes }
  // (`estado` agrupa docs/cargando/error para que `useSyncExternalStore`
  // reciba siempre el mismo objeto mientras no cambie nada.)
  const entradas = new Map();
  // v1.2.7 (6): clave → documentos leídos del servidor (aproximado).
  let lecturas = {};

  function avisar(entrada) {
    // Copia: un oyente puede soltar (y modificar el Set) mientras se recorre.
    [...entrada.oyentes].forEach(o => o.fn());
  }

  function abrir(clave, entrada) {
    entrada.estado = entrada.estado === ESTADO_CARGANDO
      ? ESTADO_CARGANDO
      : { docs: entrada.estado.docs, cargando: true, error: null };

    // Sin esta marca, un callback que llega después de la baja (o de un
    // error) podría pisar el estado de una suscripción nueva.
    const vigencia = {};
    entrada.vigencia = vigencia;

    const onDatos = (snap) => {
      if (entrada.vigencia !== vigencia || entradas.get(clave) !== entrada) return;
      const cambios = snap.docChanges();
      if (!snap.metadata.fromCache) {
        lecturas[clave] = (lecturas[clave] || 0) + cambios.length;
      }
      const yaTeniaDatos = !entrada.estado.cargando && !entrada.estado.error;
      // v1.2.7 (3): sin cambios de documentos, mismo array.
      const docs = yaTeniaDatos && cambios.length === 0
        ? entrada.estado.docs
        : snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (docs === entrada.estado.docs && !entrada.estado.cargando && !entrada.estado.error) return;
      entrada.estado = { docs, cargando: false, error: null };
      avisar(entrada);
    };

    const onError = (err) => {
      if (entrada.vigencia !== vigencia || entradas.get(clave) !== entrada) return;
      // v1.2.7 (4)
      console.error(`[suscripciones-compartidas] ${clave}:`, err);
      entrada.estado = { docs: entrada.estado.docs, cargando: false, error: err };
      const baja = entrada.baja;
      entrada.baja = null;
      entrada.vigencia = null;
      if (baja) baja();
      avisar(entrada);
    };

    // `suscribir` puede llamar a `onError` de forma sincrónica; por eso la
    // baja se guarda solo si la suscripción sigue vigente al volver.
    const baja = suscribir(clave, onDatos, onError);
    if (entrada.vigencia === vigencia) entrada.baja = baja;
    else if (baja) baja();
  }

  function darDeBaja(clave, entrada) {
    if (entrada.temporizador !== null) cancelar(entrada.temporizador);
    entrada.temporizador = null;
    entrada.vigencia = null;
    const baja = entrada.baja;
    entrada.baja = null;
    if (baja) baja();
    if (entradas.get(clave) === entrada) entradas.delete(clave);
  }

  /**
   * Suma un usuario a la clave (abre la suscripción si no hay una viva) y
   * devuelve la función `soltar`. `oyente` se llama cada vez que cambia el
   * estado de la clave.
   */
  function adquirir(clave, oyente) {
    validarClave(clave);
    let entrada = entradas.get(clave);
    if (!entrada) {
      entrada = {
        estado: ESTADO_CARGANDO, usuarios: 0, baja: null,
        temporizador: null, oyentes: new Set(), vigencia: null,
      };
      entradas.set(clave, entrada);
    }
    if (entrada.temporizador !== null) {
      // Re-adquirida dentro de la gracia: la suscripción sigue viva.
      cancelar(entrada.temporizador);
      entrada.temporizador = null;
    }
    if (!entrada.baja) abrir(clave, entrada);

    entrada.usuarios += 1;
    const registro = { fn: typeof oyente === 'function' ? oyente : () => {} };
    entrada.oyentes.add(registro);

    let suelto = false;
    return function soltar() {
      if (suelto) return;
      suelto = true;
      // Después de `cerrarTodas()` la entrada ya no existe (o es otra).
      if (entradas.get(clave) !== entrada) return;
      entrada.oyentes.delete(registro);
      entrada.usuarios -= 1;
      if (entrada.usuarios > 0) return;
      if (!entrada.baja) {
        // Murió por error y nadie la usa: no hay nada que mantener.
        darDeBaja(clave, entrada);
        return;
      }
      entrada.temporizador = programar(() => {
        entrada.temporizador = null;
        if (entrada.usuarios === 0) darDeBaja(clave, entrada);
      }, graciaMs);
    };
  }

  /** Estado actual de la clave; mismo objeto mientras no cambie nada. */
  function estado(clave) {
    validarClave(clave);
    const entrada = entradas.get(clave);
    return entrada ? entrada.estado : ESTADO_CARGANDO;
  }

  /** v1.2.7 (5): baja inmediata de todo, incluso con temporizadores pendientes. */
  function cerrarTodas() {
    const todas = [...entradas.entries()];
    todas.forEach(([clave, entrada]) => darDeBaja(clave, entrada));
    // Las pantallas que sigan montadas releen el estado (vacío): nunca quedan
    // a la vista datos de la sesión anterior.
    todas.forEach(([, entrada]) => avisar(entrada));
  }

  return {
    adquirir,
    estado,
    cerrarTodas,
    lecturas: () => ({ ...lecturas }),
    reiniciarLecturas: () => { lecturas = {}; },
    // Para tests y diagnóstico.
    _entrada: (clave) => entradas.get(clave),
  };
}

/* ── Instancia real ───────────────────────────────────────────────────────── */

const almacen = crearAlmacen({
  suscribir: (clave, onDatos, onError) => onSnapshot(consultaDe(clave), onDatos, onError),
});

/** v1.2.7 (5) */
export function cerrarTodasLasSuscripciones() {
  almacen.cerrarTodas();
}

// v1.2.7 (6): diagnóstico desde la consola del navegador.
if (typeof window !== 'undefined') {
  window.exploraLecturas = () => {
    const porClave = almacen.lecturas();
    const filas = Object.keys(porClave).sort().map(clave => ({ clave, lecturas: porClave[clave] }));
    const total = filas.reduce((s, f) => s + f.lecturas, 0);
    filas.push({ clave: 'TOTAL', lecturas: total });
    console.table(filas);
    return total;
  };
  window.exploraLecturasReiniciar = () => { almacen.reiniciarLecturas(); };
}

/**
 * v1.2.7 (7): `{ docs, cargando, error }` de una clave del catálogo,
 * compartido entre pantallas. Con `null` no se suscribe.
 */
export function useColeccionCompartida(clave) {
  const suscribirse = useCallback(
    (avisar) => (clave === null ? () => {} : almacen.adquirir(clave, avisar)),
    [clave]
  );
  const leer = useCallback(
    () => (clave === null ? ESTADO_NULO : almacen.estado(clave)),
    [clave]
  );
  return useSyncExternalStore(suscribirse, leer, leer);
}

/**
 * v1.2.7 (4): conserva el `console.error` que tenía el callback de error de
 * cada pantalla. Se registra una vez por error recibido.
 */
export function useAvisarError(error, ...prefijo) {
  useEffect(() => {
    if (error) console.error(...prefijo, error);
    // `prefijo` es fijo por pantalla.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);
}
