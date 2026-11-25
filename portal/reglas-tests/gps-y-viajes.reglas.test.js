/* =============================================================================
 * gps-y-viajes.reglas.test.js — TrackEx v1.1.2 — GPS
 * =============================================================================
 *
 * PROPÓSITO
 *   Prueba `firestore.rules.produccion` contra el emulador de Firestore:
 *   la reescritura idéntica de puntos GPS (nueva), los campos `seguimiento_*`
 *   del viaje (nuevos) y que lo que ya funcionaba siga funcionando
 *   (regresión). Ver el bloque "TrackEx v1.1.2 — GPS" del encabezado de
 *   VIAJES en el archivo de reglas.
 *
 * ARQUITECTURA / DECISIONES
 *   - `node:test` y no Jest: CRA solo corre tests dentro de `src/`, y estos
 *     necesitan el emulador (no corren en `npm test`).
 *   - projectId `demo-explora-reglas`: con el prefijo `demo-` el emulador
 *     nunca contacta un proyecto real.
 *   - Los datos se siembran con `withSecurityRulesDisabled`, con la forma real
 *     de `usuarios` (roles, `datos_chofer.dni`, `organizacion_id`) y de
 *     `viajes` (la que crea `nominar()` en `logica-transportista.js`).
 *   - Cada test parte de la base limpia y resembrada (`beforeEach`).
 *
 * CÓMO SE CORRE (desde `portal`, requiere Java):
 *   firebase emulators:exec --only firestore --project demo-explora-reglas "npm run test:reglas"
 *   Sin emulador, falla al conectar (es lo esperado).
 *
 * DEPENDENCIAS
 *   `@firebase/rules-unit-testing` 5.0.1 (peer `firebase ^12`, la del portal).
 * ========================================================================== */

const { test, before, beforeEach, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment, assertSucceeds, assertFails,
} = require('@firebase/rules-unit-testing');
const {
  doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, collection, writeBatch,
  increment, serverTimestamp, Timestamp,
} = require('firebase/firestore');

const PROYECTO = 'demo-explora-reglas';

/**
 * Host del emulador. `emulators:exec` define FIRESTORE_EMULATOR_HOST; si no
 * está, se usa el puerto por defecto (8080) para que, sin emulador, el error
 * sea de conexión y no de configuración.
 */
const [HOST, PUERTO] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

/** Hora fija de los puntos (24/11/2026 17:00 UTC), en ms: es la clave del documento. */
const TS = 1795539600000;

let entorno;

/* -----------------------------------------------------------------------------
 * Datos
 * -------------------------------------------------------------------------- */

const USUARIOS = {
  choferA: { estado: 'activo', roles: ['chofer'], organizacion_id: 'orgX', datos_chofer: { dni: '111' } },
  choferB: { estado: 'activo', roles: ['chofer'], organizacion_id: 'orgX', datos_chofer: { dni: '222' } },
  transpX: { estado: 'activo', roles: ['transportista'], organizacion_id: 'orgX' },
  transpY: { estado: 'activo', roles: ['transportista'], organizacion_id: 'orgY' },
  coord: { estado: 'activo', roles: ['coordinador'], organizacion_id: 'explora' },
};

/** Viaje con la forma que crea `nominar()`. */
function viaje(estado, extra = {}) {
  return {
    despacho_id: 'd1', entrega_id: 'e1', pedido_id: 'p1',
    chofer_uid: 'choferA', chofer_dni: '111', transportista_org_id: 'orgX',
    estado, estado_ts: Timestamp.fromMillis(TS - 3600000),
    demorado: false, demora_motivo: null, demora_ts: null,
    inicio_ts: null, fin_ts: null, cerrado_por: null, cierre_motivo: null,
    inicio_lat: null, inicio_lng: null, inicio_precision: null, inicio_origen: null,
    fin_lat: null, fin_lng: null, fin_precision: null, fin_origen: null,
    ultima_lat: null, ultima_lng: null, ultima_ts: null,
    puntos_registrados: 0,
    cliente_razon_social: 'Cliente', producto_nombre: 'Producto',
    origen_texto: 'Origen', destino_texto: 'Destino', volumen: 30,
    fecha_carga: '2026-11-24', patente_tractor: 'AA000AA', patente_semi: null,
    ...extra,
  };
}

/** Punto GPS con la forma de `armarCommitRest` / `registrarPuntos`. */
function punto(ms, extra = {}) {
  return { lat: -32.69, lng: -60.74, ts: Timestamp.fromMillis(ms), precision: 12, velocidad: null, ...extra };
}

/** Firestore de un usuario autenticado. */
const como = (uid) => entorno.authenticatedContext(uid).firestore();

/** Ref de un punto del viaje. */
const refPunto = (db, viajeId, ms) => doc(db, 'viajes', viajeId, 'gps_puntos', String(ms));

before(async () => {
  entorno = await initializeTestEnvironment({
    projectId: PROYECTO,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules.produccion'), 'utf8'),
      host: HOST,
      port: Number(PUERTO),
    },
  });
});

beforeEach(async () => {
  await entorno.clearFirestore();
  await entorno.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, datos] of Object.entries(USUARIOS)) await setDoc(doc(db, 'usuarios', uid), datos);
    await setDoc(doc(db, 'viajes', 'vEnViaje'), viaje('EN_VIAJE', { inicio_ts: Timestamp.fromMillis(TS - 3600000) }));
    await setDoc(doc(db, 'viajes', 'vFinalizado'), viaje('FINALIZADO'));
    await setDoc(doc(db, 'viajes', 'vRecibido'), viaje('RECIBIDO'));
    // Puntos ya escritos (los de la v1.1.1, o de un lote cuya respuesta se perdió).
    await setDoc(refPunto(db, 'vEnViaje', TS), punto(TS));
    await setDoc(refPunto(db, 'vEnViaje', TS + 30000), punto(TS + 30000));
  });
});

after(async () => {
  if (entorno) await entorno.cleanup();
});

/* -----------------------------------------------------------------------------
 * Puntos GPS
 * -------------------------------------------------------------------------- */

test('1. el chofer crea un punto en su viaje EN_VIAJE (sube su recorrido)', async () => {
  await assertSucceeds(setDoc(refPunto(como('choferA'), 'vEnViaje', TS + 60000), punto(TS + 60000)));
});

test('2. el chofer reescribe un punto IDÉNTICO: permitido (reenvío idempotente, nuevo en v1.1.2)', async () => {
  await assertSucceeds(setDoc(refPunto(como('choferA'), 'vEnViaje', TS), punto(TS)));
});

test('3. el chofer reescribe un punto con un dato distinto: denegado (no se falsifica el recorrido)', async () => {
  await assertFails(setDoc(refPunto(como('choferA'), 'vEnViaje', TS), punto(TS, { lat: -33 })));
});

test('4. el chofer borra un punto: denegado', async () => {
  await assertFails(deleteDoc(refPunto(como('choferA'), 'vEnViaje', TS)));
});

test('5. el chofer B no crea ni reescribe puntos en el viaje del chofer A', async () => {
  const db = como('choferB');
  await assertFails(setDoc(refPunto(db, 'vEnViaje', TS + 60000), punto(TS + 60000)));
  await assertFails(setDoc(refPunto(db, 'vEnViaje', TS), punto(TS)));
});

test('6. el chofer no crea puntos en su viaje FINALIZADO (los puntos tardíos rebotan)', async () => {
  await assertFails(setDoc(refPunto(como('choferA'), 'vFinalizado', TS), punto(TS)));
});

test('7. lote con 2 puntos existentes idénticos, 3 nuevos y el update del viaje: permitido (lote reenviado)', async () => {
  const db = como('choferA');
  const lote = writeBatch(db);
  for (const ms of [TS, TS + 30000, TS + 60000, TS + 90000, TS + 120000]) {
    lote.set(refPunto(db, 'vEnViaje', ms), punto(ms));
  }
  lote.update(doc(db, 'viajes', 'vEnViaje'), {
    ultima_lat: -32.69,
    ultima_lng: -60.74,
    ultima_ts: Timestamp.fromMillis(TS + 120000),
    puntos_registrados: increment(5),
    actualizado_en: serverTimestamp(),
  });
  await assertSucceeds(lote.commit());
});

/* -----------------------------------------------------------------------------
 * Viajes: seguimiento
 * -------------------------------------------------------------------------- */

const SEGUIMIENTO = {
  seguimiento_estado: 'limitado',
  seguimiento_permiso_ubicacion: true,
  seguimiento_permiso_segundo_plano: false,
  seguimiento_notificaciones: true,
  seguimiento_servicio: false,
  seguimiento_version_app: '1.1.2',
  seguimiento_ts: serverTimestamp(),
};

test('8. el chofer escribe los siete campos seguimiento_* válidos (reporta su configuración)', async () => {
  await assertSucceeds(updateDoc(doc(como('choferA'), 'viajes', 'vEnViaje'), {
    ...SEGUIMIENTO, actualizado_en: serverTimestamp(),
  }));
});

test('9. seguimiento_estado fuera de los tres valores: denegado', async () => {
  await assertFails(updateDoc(doc(como('choferA'), 'viajes', 'vEnViaje'), {
    ...SEGUIMIENTO, seguimiento_estado: 'otro',
  }));
});

test('10. un campo seguimiento_x no listado: denegado (no se cuela nada)', async () => {
  await assertFails(updateDoc(doc(como('choferA'), 'viajes', 'vEnViaje'), { seguimiento_x: true }));
});

/* -----------------------------------------------------------------------------
 * Regresión
 * -------------------------------------------------------------------------- */

test('11. el chofer no puede cambiar chofer_dni (la nominación es inmutable)', async () => {
  await assertFails(updateDoc(doc(como('choferA'), 'viajes', 'vEnViaje'), { chofer_dni: '222' }));
});

test('12. iniciar: RECIBIDO -> EN_VIAJE con los campos de iniciarViaje()', async () => {
  await assertSucceeds(updateDoc(doc(como('choferA'), 'viajes', 'vRecibido'), {
    estado: 'EN_VIAJE',
    estado_ts: serverTimestamp(),
    inicio_ts: serverTimestamp(),
    inicio_lat: -32.69,
    inicio_lng: -60.74,
    inicio_precision: 12,
    inicio_origen: 'actual',
    ultima_lat: -32.69,
    ultima_lng: -60.74,
    ultima_ts: serverTimestamp(),
    actualizado_en: serverTimestamp(),
  }));
});

test('13. reportar demora con los campos de reportarDemora()', async () => {
  await assertSucceeds(updateDoc(doc(como('choferA'), 'viajes', 'vEnViaje'), {
    demorado: true,
    demora_motivo: 'Corte de ruta',
    demora_ts: serverTimestamp(),
    actualizado_en: serverTimestamp(),
  }));
});

test('14. finalizar: estado FINALIZADO y campos de fin, como finalizarViaje() del chofer', async () => {
  await assertSucceeds(updateDoc(doc(como('choferA'), 'viajes', 'vEnViaje'), {
    estado: 'FINALIZADO',
    estado_ts: serverTimestamp(),
    fin_ts: serverTimestamp(),
    cerrado_por: 'chofer',
    cierre_motivo: null,
    actualizado_en: serverTimestamp(),
    fin_lat: -32.8,
    fin_lng: -60.8,
    fin_precision: 10,
    fin_origen: 'actual',
    ultima_lat: -32.8,
    ultima_lng: -60.8,
    ultima_ts: serverTimestamp(),
  }));
});

test('15. el transportista X lee los puntos de un viaje de su organización', async () => {
  const db = como('transpX');
  await assertSucceeds(getDocs(collection(db, 'viajes', 'vEnViaje', 'gps_puntos')));
  await assertSucceeds(getDoc(refPunto(db, 'vEnViaje', TS)));
});

test('16. el transportista Y no lee los puntos de un viaje de otra organización', async () => {
  const db = como('transpY');
  await assertFails(getDocs(collection(db, 'viajes', 'vEnViaje', 'gps_puntos')));
  await assertFails(getDoc(refPunto(db, 'vEnViaje', TS)));
});
