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

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  connectAuthEmulator,
} from 'firebase/auth';
import {
  getFirestore,
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
export const db       = getFirestore(app);         // módulo de base de datos
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