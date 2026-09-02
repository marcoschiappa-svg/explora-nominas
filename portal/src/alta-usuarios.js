/* =============================================================================
 * alta-usuarios.js — Crear cuentas de Firebase Auth desde el portal
 * =============================================================================
 *
 * QUE RESUELVE
 *   Dar de alta un usuario son dos cosas en dos sistemas distintos: una cuenta
 *   en Firebase Auth y un documento en Firestore. No hay transacción que abarque
 *   las dos, así que hay que manejar a mano lo que pasa si la segunda falla.
 *
 * -----------------------------------------------------------------------------
 * LA TRAMPA DEL SDK
 * -----------------------------------------------------------------------------
 *   `createUserWithEmailAndPassword` NO solo crea la cuenta: además **inicia
 *   sesión con ella**. Es el comportamiento pensado para un formulario de
 *   registro, donde el que se registra es el que va a usar la app.
 *
 *   Acá es al revés: el admin crea la cuenta de otro. Con la instancia normal,
 *   el admin apretaría "Crear chofer" y quedaría logueado COMO ese chofer, sin
 *   ningún aviso. Vería la pantalla de viajes en vez del panel de
 *   administración y no entendería por qué.
 *
 *   La solución es una segunda instancia de Firebase App —con la misma
 *   configuración pero un nombre distinto— que se usa solo para esto. La sesión
 *   que abre es la de esa instancia y no toca la principal. Se cierra y se
 *   descarta enseguida.
 *
 * -----------------------------------------------------------------------------
 * SI FALLA EL PERFIL, SE BORRA LA CUENTA
 * -----------------------------------------------------------------------------
 *   Firebase Auth tiene hoy 70 cuentas y `usuarios_portal` 65 documentos. Esos
 *   5 huecos son cuentas que existen y no pueden entrar a ningún lado, porque no
 *   tienen perfil.
 *
 *   Con el modelo nuevo es peor: las reglas resuelven TODO con
 *   `get(/usuarios/{uid})`. Una cuenta sin ese documento no puede leer ni
 *   escribir nada, ni siquiera averiguar por qué.
 *
 *   Por eso, si la escritura del perfil falla, se borra la cuenta recién creada.
 *   Mejor no crear nada que crear la mitad.
 * ========================================================================== */

import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

import { CONFIG_ACTIVA } from './firebase';

/* -----------------------------------------------------------------------------
 * Contraseñas
 * -------------------------------------------------------------------------- */

/**
 * Genera una contraseña legible para dictarla por teléfono.
 *
 * Sin caracteres ambiguos: nada de I, l, 1, O, 0. Un chofer que anota la clave
 * en un papel y la tipea en el celular no tiene que adivinar si es una ele o un
 * uno.
 *
 * Firebase exige 6 caracteres como mínimo; se usan 10.
 *
 * NO SE GUARDA EN NINGÚN LADO. Se muestra una sola vez en pantalla al crear el
 * usuario. Hoy `usuarios_portal` tiene un campo `password_visible` con la clave
 * en texto plano, en una colección que cualquier autenticado puede leer.
 */
export function generarClave() {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const mayusculas = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const numeros = '23456789';
  const todo = letras + mayusculas + numeros;

  const al = (conjunto) => conjunto[Math.floor(Math.random() * conjunto.length)];

  // Al menos una de cada tipo, el resto libre.
  const clave = [al(mayusculas), al(letras), al(numeros)];
  while (clave.length < 10) clave.push(al(todo));

  // Mezcla, para que la mayúscula no quede siempre primera.
  for (let i = clave.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clave[i], clave[j]] = [clave[j], clave[i]];
  }

  return clave.join('');
}

/**
 * El email de login de un chofer.
 *
 * Los choferes no tienen correo de la empresa, pero Firebase Auth necesita uno
 * para el método de email y contraseña. Se deriva del DNI, que es su
 * identificador real y es único.
 *
 * Es lo mismo que hace hoy el sistema: en la base hay cuentas como
 * `39254541@explora-portal.com`.
 */
export function emailDeChofer(dni) {
  return `${String(dni || '').replace(/\D/g, '')}@explora-portal.com`;
}

/* -----------------------------------------------------------------------------
 * Alta
 * -------------------------------------------------------------------------- */

/**
 * Crea una cuenta de Firebase Auth sin tocar la sesión del que la está creando.
 *
 * Devuelve el UID. Quien llama tiene que escribir el perfil en `usuarios/{uid}`
 * y, si eso falla, llamar a `deshacerCuenta`.
 *
 * @param {string} email
 * @param {string} clave
 * @returns {Promise<string>} el UID de la cuenta creada
 */
export async function crearCuenta(email, clave) {
  // Nombre único por si dos altas se solapan: `initializeApp` con un nombre que
  // ya existe devuelve la instancia anterior en vez de crear una nueva.
  const nombre = `alta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appSecundaria = initializeApp(CONFIG_ACTIVA, nombre);

  try {
    const authSecundario = getAuth(appSecundaria);
    const cred = await createUserWithEmailAndPassword(authSecundario, email, clave);

    // La sesión que abrió `createUser...` es la de ESTA instancia, no la del
    // admin. Se cierra igual: no hace falta y deja el estado limpio.
    await signOut(authSecundario);

    return cred.user.uid;
  } finally {
    // Siempre, aunque haya fallado: una instancia que queda viva mantiene
    // conexiones abiertas y se acumula con cada alta.
    await deleteApp(appSecundaria).catch(() => {});
  }
}

/**
 * Borra una cuenta recién creada, cuando falló la escritura del perfil.
 *
 * LIMITACIÓN CONOCIDA: el SDK del cliente solo permite borrar la cuenta del
 * usuario logueado, y acá la sesión ya se cerró. Así que esto vuelve a iniciar
 * sesión con esa cuenta en la instancia secundaria —cuya clave conocemos porque
 * la acabamos de generar— y la borra desde ahí.
 *
 * Es un rodeo, pero es la única forma sin un backend. La alternativa sería el
 * Admin SDK, que necesita un servidor, y hoy no hay ninguno: el portal es React
 * estático.
 *
 * Si esto también falla, no hay nada más que hacer desde el navegador: queda una
 * cuenta huérfana. Se avisa para que alguien la borre desde la consola de
 * Firebase.
 *
 * @returns {Promise<boolean>} true si se pudo borrar
 */
export async function deshacerCuenta(email, clave) {
  const nombre = `deshacer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const appSecundaria = initializeApp(CONFIG_ACTIVA, nombre);

  try {
    const { signInWithEmailAndPassword, deleteUser } = await import('firebase/auth');
    const authSecundario = getAuth(appSecundaria);
    const cred = await signInWithEmailAndPassword(authSecundario, email, clave);
    await deleteUser(cred.user);
    return true;
  } catch (err) {
    console.error('No se pudo borrar la cuenta huérfana:', email, err);
    return false;
  } finally {
    await deleteApp(appSecundaria).catch(() => {});
  }
}

/**
 * Traduce los errores de Auth a algo que se entienda.
 *
 * `auth/email-already-in-use` es el más frecuente y el que peor se explica
 * solo: en el caso de un chofer significa que ese DNI ya tiene cuenta, aunque
 * el usuario no aparezca en el padrón — puede ser uno de los huecos entre las
 * cuentas de Auth y los documentos de perfil.
 */
export function traducirErrorAuth(err) {
  const codigo = err && err.code;

  switch (codigo) {
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con ese correo o ese DNI. Puede ser un '
           + 'usuario dado de baja, o una cuenta sin perfil. Buscalo entre los '
           + 'inactivos, o pedile a un administrador que lo revise en Firebase.';
    case 'auth/invalid-email':
      return 'El correo no tiene un formato válido.';
    case 'auth/weak-password':
      return 'La contraseña es demasiado corta. Necesita al menos 6 caracteres.';
    case 'auth/operation-not-allowed':
      return 'El método de correo y contraseña no está habilitado en Firebase.';
    case 'auth/network-request-failed':
      return 'No se pudo conectar con Firebase. Revisá la conexión.';
    default:
      return (err && err.message) || 'Error desconocido al crear la cuenta.';
  }
}
