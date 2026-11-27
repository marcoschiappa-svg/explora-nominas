// ═══════════════════════════════════════════════════════════════
// firebase.js — Configuración y conexión a Firebase para el portal
// ═══════════════════════════════════════════════════════════════
//
// Este archivo se ejecuta una sola vez, cuando arranca la app, y expone
// 5 cosas que el resto del código importa para hablar con Firebase:
//   - auth      → para saber quién está logueado
//   - db        → para leer/escribir en Firestore
//   - provider  → configuración del botón "Iniciar sesión con Google"
//   - loginConGoogle() / logout() → funciones que hacen el login/logout
//   - ENTORNO   → contra qué base de datos estamos trabajando
//
// ── LOS TRES ENTORNOS ──────────────────────────────────────────
//
// El portal puede hablar con tres bases de datos distintas:
//
//   produccion → explora-portal          La base REAL. Datos de clientes,
//                                        choferes y pedidos de verdad.
//   staging    → entorno-prueba-explora  Copia de prueba. Mismos usuarios y
//                                        datos que producción, pero romper
//                                        algo acá no afecta a nadie.
//   emulador   → localhost               Base local, en tu propia máquina.
//                                        Se borra cuando cerrás el emulador.
//
// Cuál se usa lo decide el archivo portal/.env.local, que NO se sube a git
// (cada uno tiene el suyo). Las combinaciones son:
//
//   .env.local no existe, o está vacío   → PRODUCCION
//   REACT_APP_ENV=staging                → STAGING
//   REACT_APP_USE_EMULATOR=true          → EMULADOR
//
// REGLA IMPORTANTE: si no hay ninguna variable, el portal apunta a
// PRODUCCION. Es a propósito. En el servidor donde vive el portal real no
// hay ningún .env.local, así que funciona igual que siempre sin depender
// de que alguien configure algo. Apuntar a otro lado exige una acción
// explícita.
//
// Cuando el portal NO está en producción, muestra una franja de color
// arriba de todo avisándolo. Si no ves ninguna franja, estás tocando la
// base real.
//
// ───────────────────────────────────────────────────────────────
// v1.2.7 — LECTURAS COMPARTIDAS
// ───────────────────────────────────────────────────────────────
//   SÍNTOMA
//     `explora-portal` superó la cuota diaria gratuita de Firestore (114k
//     lecturas contra 1k escrituras en un día).
//
//   CAUSA RAÍZ
//     Además de releer colecciones al cambiar de pantalla (eso lo resuelve
//     `suscripciones-compartidas.js`), Firestore se inicializaba con
//     `getFirestore(app)`: caché solo en memoria. Cada F5 o pestaña nueva
//     arrancaba sin nada y leía todas las colecciones enteras del servidor.
//
//   ALCANCE
//     1. `initializeFirestore(app, { localCache: persistentLocalCache({
//        tabManager: persistentMultipleTabManager() }) })` en vez de
//        `getFirestore(app)`: caché en IndexedDB compartida entre pestañas.
//        Al reanudar una consulta, el servidor manda solo lo que cambió.
//        `connectFirestoreEmulator` queda igual.
//     2. `cerrarSesionCompleta()` NO vive acá: necesita
//        `cerrarTodasLasSuscripciones()`, y `suscripciones-compartidas.js`
//        importa `db` de este archivo (import circular). Está en
//        `cerrar-sesion.js`.
//
//   LIMITACIONES CONOCIDAS
//     - Sin IndexedDB (navegación privada de Firefox, IndexedDB bloqueado,
//       cuota llena): verificado en el SDK instalado (firebase 12.13.0,
//       @firebase/firestore 4.14.1, `__PRIVATE_ensureOfflineComponents`):
//       los errores `UNIMPLEMENTED` ("This platform is either missing
//       IndexedDB...") y `FAILED_PRECONDITION`, y los DOMException de cuota /
//       estado inválido, se registran como warning ("Error using user
//       provided cache. Falling back to memory cache") y el SDK sigue con
//       caché en memoria. El portal funciona igual que antes de v1.2.7.
//     - La caché queda en el disco del navegador entre sesiones. El logout
//       del portal la borra (`cerrar-sesion.js`), pero si alguien cierra el
//       navegador SIN cerrar sesión, los datos cacheados quedan en esa
//       máquina hasta el próximo logout. En una computadora compartida, el
//       usuario siguiente podría recibir un primer snapshot de caché (de
//       consultas que sus reglas le permiten hacer) antes de la respuesta
//       del servidor.
//     - Con caché persistente, los snapshots pueden llegar primero desde la
//       caché (`fromCache: true`) y después del servidor: la primera pintada
//       puede mostrar datos de la sesión anterior por un instante.
//
//   CÓMO SE VERIFICA
//     DevTools → Application → IndexedDB: aparece
//     `firestore/[DEFAULT]/<proyecto>/main`. Con F5 en Programación,
//     `exploraLecturas()` muestra solo los cambios, no las colecciones
//     enteras. En una ventana privada de Firefox el portal carga igual (con
//     el warning de fallback en consola).

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  connectAuthEmulator,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from 'firebase/firestore';

// ── Identificación de los proyectos de Firebase ─────────────────
// Estos valores NO son secretos: son identificadores públicos que
// cualquiera puede ver abriendo las herramientas de desarrollador del
// navegador en el portal real. La seguridad de verdad no depende de
// ocultar esto — depende de las reglas de Firestore (Security Rules).

// Proyecto REAL. Acá viven los datos de producción.
const CONFIG_PRODUCCION = {
  apiKey: "AIzaSyA_cmSLuKPVYXjgQu75varhmEBkaY0uwss",
  authDomain: "explora-portal.firebaseapp.com",
  projectId: "explora-portal",
  storageBucket: "explora-portal.firebasestorage.app",
  messagingSenderId: "871895783017",
  appId: "1:871895783017:web:9503299046accde84774f8"
};

// Proyecto de PRUEBA. Copia de producción, creado en agosto 2026 para
// poder probar la migración del modelo de datos sin riesgo.
const CONFIG_STAGING = {
  apiKey: "AIzaSyAL8Gzksx9cqkI-J4gljqvTRy8P-_6ZKZw",
  authDomain: "entorno-prueba-explora.firebaseapp.com",
  projectId: "entorno-prueba-explora",
  storageBucket: "entorno-prueba-explora.firebasestorage.app",
  messagingSenderId: "268922973064",
  appId: "1:268922973064:web:01552e85a4dbf25dbbe83d"
};

// ── Elegir el entorno ───────────────────────────────────────────
// El emulador tiene prioridad: si está prendido, no importa qué diga
// REACT_APP_ENV, se trabaja contra la base local.

const usaEmulador = process.env.REACT_APP_USE_EMULATOR === 'true';
const usaStaging  = process.env.REACT_APP_ENV === 'staging';

/**
 * Contra qué base de datos está trabajando el portal en este momento.
 * Valores posibles: 'produccion' | 'staging' | 'emulador'.
 * Lo usa la franja de aviso que se muestra arriba del portal.
 */
export const ENTORNO = usaEmulador ? 'emulador'
                     : usaStaging  ? 'staging'
                     : 'produccion';

// El emulador se queda con la configuración de producción a propósito:
// como todas las llamadas se redirigen a localhost, el proyecto solo
// define el "nombre" del espacio de datos local. Mantenerlo igual que
// antes evita que cambie el comportamiento de quien ya usaba el emulador.
const firebaseConfig = usaStaging ? CONFIG_STAGING : CONFIG_PRODUCCION;
/**
 * La configuración que quedó activa. La exporta para que Admin.js pueda crear
 * su instancia secundaria contra el mismo proyecto, en vez de tener una copia
 * hardcodeada que siempre apuntaba a producción.
 */
export const CONFIG_ACTIVA = firebaseConfig;

// ── Inicialización ──────────────────────────────────────────────
const app      = initializeApp(firebaseConfig);
export const auth     = getAuth(app);              // módulo de autenticación
// v1.2.7 (1): caché persistente en IndexedDB, compartida entre pestañas. Si
// IndexedDB no está disponible, el SDK cae solo a caché en memoria.
export const db       = initializeFirestore(app, { // módulo de base de datos
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const provider = new GoogleAuthProvider();  // login con Google

// ── Conexión a los emuladores locales ───────────────────────────
// Si REACT_APP_USE_EMULATOR está en "true", en vez de hablar con el
// Firebase real, "auth" y "db" se redirigen a los emuladores que corren
// en tu propia máquina (los que arrancan con "firebase emulators:start").

if (usaEmulador) {
  connectFirestoreEmulator(db, 'localhost', 8080);     // mismo puerto que firebase.json
  connectAuthEmulator(auth, 'http://localhost:9099');  // mismo puerto que firebase.json
  console.log('🔧 Conectado a los emuladores locales de Firebase');
}

// Aviso en la consola del navegador cuando NO estamos en producción.
// La franja visible del portal es la señal principal; esto es el respaldo
// para cuando alguien está mirando la consola.
if (ENTORNO === 'staging') {
  console.log('🧪 ENTORNO DE PRUEBA — proyecto entorno-prueba-explora. Nada de lo que hagas acá afecta a producción.');
}

// ── Restricción de dominio para el login ────────────────────────
// Le pide a Google que solo muestre/permita cuentas del dominio
// explora.com.ar en la pantalla de selección de cuenta.
provider.setCustomParameters({
  hd: 'explora.com.ar'
});

// ── Funciones que usa el resto del portal para loguear/desloguear ──
export async function loginConGoogle() {
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function logout() {
  await signOut(auth);
}