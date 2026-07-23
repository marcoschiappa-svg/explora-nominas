// ═══════════════════════════════════════════════════════════════
// firebase.js — Configuración y conexión a Firebase para el portal
// ═══════════════════════════════════════════════════════════════
//
// Este archivo se ejecuta una sola vez, cuando arranca la app, y expone
// 4 cosas que el resto del código importa para hablar con Firebase:
//   - auth      → para saber quién está logueado
//   - db        → para leer/escribir en Firestore
//   - provider  → configuración del botón "Iniciar sesión con Google"
//   - loginConGoogle() / logout() → funciones que hacen el login/logout

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  connectAuthEmulator,       // NUEVO: conecta Auth al emulador local
} from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,  // NUEVO: conecta Firestore al emulador local
} from 'firebase/firestore';

// ── Identificación del proyecto de Firebase ─────────────────────
// Estos valores NO son secretos: son identificadores públicos que
// cualquiera puede ver abriendo las herramientas de desarrollador del
// navegador en el portal real. La seguridad de verdad no depende de
// ocultar esto — depende de las reglas de Firestore (Security Rules)
const firebaseConfig = {
  apiKey: "AIzaSyA_cmSLuKPVYXjgQu75varhmEBkaY0uwss",
  authDomain: "explora-portal.firebaseapp.com",
  projectId: "explora-portal",
  storageBucket: "explora-portal.firebasestorage.app",
  messagingSenderId: "871895783017",
  appId: "1:871895783017:web:9503299046accde84774f8"
};

// ── Inicialización ──────────────────────────────────────────────
const app      = initializeApp(firebaseConfig);
export const auth     = getAuth(app);              // módulo de autenticación
export const db       = getFirestore(app);         // módulo de base de datos
export const provider = new GoogleAuthProvider();  // login con Google

// ── NUEVO: conexión a los emuladores locales ────────────────────
// Si la variable de entorno REACT_APP_USE_EMULATOR está en "true"
// (definida en portal/.env.local, que NO se sube a git), en vez de
// hablar con el Firebase real, "auth" y "db" se redirigen a los
// emuladores que corren en tu propia máquina
// (los que arrancan con "firebase emulators:start").
//
// Si esta variable no existe (como pasa en producción, donde no hay
// .env.local), este bloque entero no hace nada, y todo funciona
// exactamente igual que antes de este cambio.

if (process.env.REACT_APP_USE_EMULATOR === 'true') {
  connectFirestoreEmulator(db, 'localhost', 8080);     // mismo puerto que firebase.json
  connectAuthEmulator(auth, 'http://localhost:9099');  // mismo puerto que firebase.json
  console.log('🔧 Conectado a los emuladores locales de Firebase');
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
