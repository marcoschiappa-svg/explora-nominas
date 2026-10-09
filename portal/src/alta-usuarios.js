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
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-03) -- LA VALIDACIÓN Y EL ALTA COMPLETA SE MUDAN ACÁ
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     `validar()` (nombre, roles, DNI, CUIT, email, organización, invitación
 *     duplicada) y el armado de `crearUsuarioNuevo()` (cuenta de Auth +
 *     perfil, con el `deshacerCuenta` si falla el segundo paso) vivían
 *     ENTERAS adentro de `Usuarios.js`. RF-03 necesita dar de alta un
 *     usuario transportista desde `Organizaciones.js`, con las mismas
 *     reglas -- copiarlas ahí hubiera sido la segunda implementación de la
 *     misma regla de negocio, que el prompt de esta tarea prohíbe
 *     explícitamente (punto 9).
 *
 *   CAUSA RAÍZ
 *     No había, hasta ahora, una segunda pantalla que diera de alta un
 *     usuario con cuenta de Auth -- así que nunca hizo falta sacar esa
 *     lógica de `Usuarios.js`.
 *
 *   ALCANCE
 *     Dos funciones nuevas, puras hasta donde se puede:
 *       - `validarAltaUsuario(datos, contexto)` -- SIN Firestore, SIN Auth.
 *         Es exactamente la lógica que tenía `validar()` en `Usuarios.js`
 *         (mismos mensajes, mismo orden), generalizada para recibir los
 *         datos y lo que necesita consultar (`usuarios`, `invitaciones`,
 *         `editando`, `soloInternos`) como parámetros en vez de leerlos de
 *         `useState` -- así sigue siendo testeable sin React ni Firebase.
 *       - `darDeAltaUsuario({ datos, usuario })` -- SÍ toca Auth y
 *         Firestore: es el `crearCuenta` + `crear()` + `deshacerCuenta` (si
 *         falla el perfil) que tenía `crearUsuarioNuevo()` en `Usuarios.js`,
 *         ahora reusable. Devuelve `{ uid, clave }`; la clave sale de
 *         `generarClave()` y no se guarda en ningún lado (ver más arriba).
 *         El error que tira distingue en qué fase pasó
 *         (`err.fase === 'auth'` o `'perfil'`, y `err.cuentaBorrada` en el
 *         segundo caso) para que quien llama pueda mostrar el mensaje
 *         correcto -- `Usuarios.js` y `Organizaciones.js` (RF-03) lo usan
 *         igual.
 *
 *     `Usuarios.js` pasa a llamar a las dos -- su comportamiento visible NO
 *     cambia, ver el encabezado propio de ese archivo.
 *
 *   LIMITACIONES CONOCIDAS
 *     `validarAltaUsuario` sigue recibiendo `soloInternos` ya calculado por
 *     quien llama (depende de `ROLES_INTERNOS`, que es una constante de
 *     `Usuarios.js` -- no se duplica acá). `Organizaciones.js` nunca crea un
 *     rol interno desde su flujo, así que siempre le pasa `false`.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- alta-usuarios` (ver `alta-usuarios.test.js`) y
 *     `CI=true npm run build` sin warnings. Manual: los mismos casos que
 *     antes rechazaba el alta de `Usuarios.js` (DNI corto, DNI repetido,
 *     CUIT inválido, sin organización, email duplicado con invitación
 *     interna) se siguen rechazando igual, con el mismo texto.
 * ========================================================================== */

import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

import { CONFIG_ACTIVA, db } from './firebase';
import { crear } from './shared/datos';
import { normalizarCuit } from './mapa-normalizacion';

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

/* -----------------------------------------------------------------------------
 * v1.2.0 (RF-03) — Validación y alta completa
 * -------------------------------------------------------------------------- */

/**
 * Busca si ya hay un chofer con ese DNI. Devuelve el documento encontrado
 * (activo o inactivo), o `null`. Ver el comentario de `omitirDniRepetido` en
 * `validarAltaUsuario()`, más abajo, para por qué está separada.
 *
 * @param {string} dni Ya limpio (solo dígitos)
 * @param {Object[]} usuarios
 * @param {string|null} [idPropio] excluir este ID (edición)
 * @returns {Object|null}
 */
export function buscarUsuarioPorDni(dni, usuarios, idPropio = null) {
  if (!dni) return null;
  return usuarios.find(u =>
    u.id !== idPropio && u.datos_chofer && u.datos_chofer.dni === dni
  ) || null;
}

/**
 * Valida los datos de un alta de usuario. Devuelve un array de mensajes;
 * vacío si está todo bien.
 *
 * 1. Es la MISMA lógica que tenía `validar()` en `Usuarios.js` -- ver el
 *    encabezado v1.2.0 (RF-03) más arriba. Pura: sin Firestore, sin Auth,
 *    sin `useState` -- todo lo que necesita lo recibe por parámetro.
 *
 * @param {Object} datos `{ nombre, email, roles, organizacion_id, dni, cuit }`
 *   -- mismos nombres de campo que el `form` de `Usuarios.js`.
 * @param {Object} [contexto]
 * @param {Object[]} [contexto.usuarios] para chequear DNI repetido y email
 *   duplicado -- documentos de la colección `usuarios` ya cargados.
 * @param {Object[]} [contexto.invitaciones] para chequear invitación
 *   pendiente duplicada -- `{ id: email, ... }`.
 * @param {Object|null} [contexto.editando] el usuario en edición, o `null`
 *   si es un alta nueva -- cambia el mensaje del DNI y excluye al propio
 *   usuario de la búsqueda de duplicados.
 * @param {boolean} [contexto.soloInternos] si el alta es de un rol interno
 *   por invitación de Google -- solo ahí se chequea invitación/email
 *   duplicados (ver LIMITACIONES CONOCIDAS del encabezado del archivo).
 * @returns {string[]}
 */
export function validarAltaUsuario(datos, contexto = {}) {
  const { usuarios = [], invitaciones = [], editando = null, soloInternos = false, omitirDniRepetido = false } = contexto;
  const problemas = [];

  const nombre = String(datos.nombre || '');
  const roles = datos.roles || [];
  const esChofer = roles.includes('chofer');

  if (!nombre.trim()) problemas.push('El nombre es obligatorio.');
  if (roles.length === 0) problemas.push('Elegí al menos un rol.');

  if (esChofer) {
    const dni = String(datos.dni || '').replace(/\D/g, '');
    if (!dni) {
      problemas.push(editando
        ? 'Para agregarle el rol chofer hay que cargarle el DNI.'
        : 'El DNI es obligatorio para un chofer.');
    }
    else if (dni.length < 7 || dni.length > 8) problemas.push('El DNI tiene que tener 7 u 8 dígitos.');
    if (String(datos.cuit || '').trim() && !normalizarCuit(datos.cuit)) {
      problemas.push('El CUIT tiene que tener 11 dígitos.');
    }
  } else if (!editando && !String(datos.email || '').trim()) {
    problemas.push('El correo es obligatorio.');
  }

  if (!datos.organizacion_id) {
    problemas.push('Elegí la organización.');
  }

  // Un DNI repetido rompe la app: los viajes se filtran por DNI, así que dos
  // choferes con el mismo se verían los viajes del otro.
  //
  // `omitirDniRepetido`: RF-04, `importar-flota.js` necesita la MISMA
  // búsqueda pero para una decisión distinta -- un DNI ya cargado en el
  // padrón es una fila "existente" (se saltea, no es un error), no un
  // rechazo como acá. La búsqueda es una sola (`buscarUsuarioPorDni`, más
  // abajo); lo que cambia es qué hace cada caller con el resultado.
  if (esChofer && !omitirDniRepetido) {
    const dni = String(datos.dni || '').replace(/\D/g, '');
    const repetido = buscarUsuarioPorDni(dni, usuarios, editando && editando.id);
    if (repetido) problemas.push(`Ya hay un usuario con ese DNI: ${repetido.nombre}.`);
  }

  // Una invitación por Google no crea cuenta de Auth en el momento, así que
  // no hay ningún `auth/email-already-in-use` que la frene sola si el email
  // ya está usado. Se chequea acá, a mano, contra lo que sí se puede ver.
  if (soloInternos && !editando) {
    const emailNorm = String(datos.email || '').trim().toLowerCase();
    if (invitaciones.some(i => i.id === emailNorm)) {
      problemas.push(`Ya hay una invitación pendiente para ${emailNorm}.`);
    }
    const yaExiste = usuarios.some(u => (u.email || '').toLowerCase() === emailNorm);
    if (yaExiste) problemas.push(`Ya existe un usuario con ese email: ${emailNorm}.`);
  }

  return problemas;
}

/**
 * Da de alta un usuario completo: cuenta de Auth + perfil en `usuarios/{uid}`.
 *
 * 2. Es el mismo `crearUsuarioNuevo()` que tenía `Usuarios.js` -- ver el
 *    encabezado v1.2.0 (RF-03). El orden importa: primero Auth, porque el ID
 *    del documento de `usuarios` TIENE que ser el UID de la cuenta.
 *
 * Si falla la escritura del perfil, se deshace la cuenta (ver
 * `deshacerCuenta` más arriba) y se relanza el error con
 * `err.fase = 'perfil'` y `err.cuentaBorrada` (boolean). Si falla la propia
 * creación de la cuenta, se relanza con `err.fase = 'auth'` -- quien llama
 * usa esto para elegir entre `traducirErrorAuth()` (fase auth) o
 * `traducirError()` propio de cada pantalla (fase perfil).
 *
 * @param {Object} params
 * @param {Object} params.datos El perfil completo a escribir en `usuarios`
 *   (`nombre`, `email`, `roles`, `organizacion_id`, `telefonos`,
 *   `emails_extra`, `datos_chofer`) -- mismo shape que ya escribía
 *   `Usuarios.js`. NO necesita `estado`: se fuerza `'activo'` acá.
 * @param {Object} params.usuario La sesión de quien está dando de alta.
 * @returns {Promise<{uid: string, clave: string}>}
 */
export async function darDeAltaUsuario({ datos, usuario }) {
  const clave = generarClave();
  let uid;

  try {
    uid = await crearCuenta(datos.email, clave);
  } catch (err) {
    err.fase = 'auth';
    throw err;
  }

  try {
    await crear({
      db,
      coleccion: 'usuarios',
      id: uid,                       // el ID ES el UID de Auth
      datos: { ...datos, estado: 'activo' },
      accion: 'crear_usuario',
      entidadTipo: 'usuario',
      usuario,
    });
  } catch (err) {
    console.error('Falló el perfil, se borra la cuenta:', err);
    const borrada = await deshacerCuenta(datos.email, clave);
    err.fase = 'perfil';
    err.cuentaBorrada = borrada;
    throw err;
  }

  // La clave se muestra UNA sola vez. No se guarda.
  return { uid, clave };
}
