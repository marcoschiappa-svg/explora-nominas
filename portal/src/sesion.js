/* =============================================================================
 * sesion.js — Quién es el usuario logueado
 * =============================================================================
 *
 * EL PROBLEMA QUE RESUELVE
 *   Durante la transición conviven dos modelos. Las pantallas viejas leen
 *   `usuarios_portal` y usan `usuario.rol` (singular) y `usuario.empresa` (un
 *   string). Las nuevas leen `usuarios` y usan `roles` (array) y
 *   `organizacion_id` (una referencia).
 *
 *   En vez de tocar todas las pantallas viejas, la sesión carga LOS DOS y los
 *   entrega en un solo objeto:
 *
 *     usuario.rol              como siempre — las pantallas viejas no cambian
 *     usuario.perfil           el documento nuevo, o null
 *
 * POR QUE `perfil` PUEDE SER NULL
 *   No todos los usuarios de `usuarios_portal` están en `usuarios`. Los
 *   choferes, por ejemplo, no se cargaron: se recrean desde el ABM. Y cualquier
 *   usuario que se dé de alta desde el `Admin.js` viejo va a nacer sin perfil
 *   nuevo hasta que esa pantalla se migre.
 *
 *   Esos usuarios siguen entrando y usando el portal viejo. Lo que no pueden es
 *   escribir nada del modelo nuevo — y eso no es una decisión de este archivo,
 *   lo imponen las reglas de Firestore: todas resuelven el acceso con
 *   `get(/usuarios/{uid})`, y si el documento no existe, deniegan todo.
 *
 *   Por eso `perfil: null` no es un error: es información. Las pantallas nuevas
 *   la usan para avisar con un mensaje entendible en vez de dejar que la
 *   escritura rebote con un `permission-denied` que no explica nada.
 *
 * -----------------------------------------------------------------------------
 * QUIÉN PUEDE ENTRAR — CUALQUIERA DE LOS DOS, YA NO LOS DOS
 * -----------------------------------------------------------------------------
 *   Hasta agosto de 2026 esto exigía el documento viejo siempre, sin excepción.
 *   Tenía sentido cuando todo el mundo venía de `usuarios_portal`. Pero desde
 *   que `Usuarios.js` da de alta gente directo en el modelo nuevo — y a
 *   propósito NO escribe nada en `usuarios_portal`, para no duplicar datos que
 *   después hay que mantener sincronizados — exigir el viejo bloqueaba a
 *   cualquier alta genuinamente nueva. Transprueba (transportista, creada solo
 *   en `usuarios`) es el caso que lo mostró.
 *
 *   La regla ahora es: entra si CUALQUIERA de los dos documentos existe y está
 *   activo. Pero si un documento EXISTE y está inactivo, bloquea igual — eso no
 *   cambió: desactivar a alguien en un solo modelo no puede dejarlo entrar por
 *   el otro mientras conviven los dos.
 *
 * SE SIMPLIFICA EN LA FASE FINAL
 *   Cuando no quede ningún pedido vivo en `pedidos_portal`, se retira la
 *   lectura del documento viejo por completo y queda solo `perfil`.
 * ========================================================================== */

import { doc, getDoc, getDocs, deleteDoc, collection, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { crear } from './datos';

/* -----------------------------------------------------------------------------
 * Auxiliares de carga
 * -------------------------------------------------------------------------- */

/**
 * Busca el documento viejo por email, cuando la búsqueda directa por UID no
 * encuentra nada.
 *
 * Es un resabio de `usuarios_portal`: a diferencia de `usuarios`, donde el ID
 * ES el UID de Auth por diseño, varias fichas viejas se crearon con un ID
 * propio que no coincide con el UID. Antes esta búsqueda vivía duplicada
 * dentro de `Login.js`; queda acá para que haya un solo lugar que sepa cómo
 * resolver el documento viejo.
 */
async function buscarViejoPorEmail(email) {
  if (!email) return null;
  const q = query(collection(db, 'usuarios_portal'), where('email', '==', email));
  const resultado = await getDocs(q);
  return resultado.empty ? null : resultado.docs[0].data();
}

/**
 * El perfil nuevo es OPCIONAL durante la transición, así que su lectura no
 * puede tumbar el login. Si falla —no existe, las reglas la deniegan, hay un
 * problema de red— se devuelve `null` y quien llama sigue con lo que tenga del
 * lado viejo.
 */
async function cargarPerfilNuevo(uid) {
  try {
    const snap = await getDoc(doc(db, 'usuarios', uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (err) {
    console.warn('No se pudo leer el perfil del modelo nuevo:', err.code || err.message);
    return null;
  }
}

/**
 * Si hay una invitación esperando a este email, la consume: crea
 * `usuarios/{uid}` con lo que la invitación decía y la borra. Devuelve el
 * perfil recién creado, o `null` si no había ninguna.
 *
 * Es la pieza que le faltaba al alta con cuenta de Google. `Usuarios.js` no
 * puede crear esa cuenta de Auth —Firebase la crea sola la primera vez que esa
 * persona hace `signInWithPopup`, no antes—, así que en vez de un perfil deja
 * una invitación esperando por email. Acá, en el primer login real, es donde
 * se materializa.
 *
 * Las reglas exigen que lo que se escriba coincida EXACTO con lo que la
 * invitación dice (`aceptaInvitacionValida()`, en `firestore.rules`): nadie
 * puede auto-asignarse roles que la invitación no diga.
 */
async function consumirInvitacion(firebaseUser) {
  if (!firebaseUser.email) return null;

  const emailId = firebaseUser.email.toLowerCase();
  const refInvitacion = doc(db, 'invitaciones', emailId);

  let snap;
  try {
    snap = await getDoc(refInvitacion);
  } catch (err) {
    // Sin invitación, las reglas deniegan la lectura — no es un error real,
    // solo dice que no había nada esperándolo.
    return null;
  }
  if (!snap.exists()) return null;

  const invitacion = snap.data();

  const datosPerfil = {
    nombre: invitacion.nombre || firebaseUser.displayName || '',
    email: firebaseUser.email,
    roles: invitacion.roles,
    organizacion_id: invitacion.organizacion_id || null,
    telefonos: invitacion.telefonos || [],
    emails_extra: [],
    datos_chofer: null,
    estado: 'activo',
  };

  try {
    await crear({
      coleccion: 'usuarios',
      id: firebaseUser.uid,
      datos: datosPerfil,
      accion: 'crear_usuario_por_invitacion',
      entidadTipo: 'usuario',
      // Quien "crea" el documento, a los efectos del historial, es la propia
      // persona aceptando su invitación — es quien de verdad ejecuta la
      // escritura, aunque el rol lo haya decidido un admin antes.
      usuario: { uid: firebaseUser.uid, nombre: datosPerfil.nombre, email: firebaseUser.email },
    });
  } catch (err) {
    console.error('No se pudo consumir la invitación:', err.code || err.message);
    return null;
  }

  // Se borra recién si el alta salió bien: si algo falla antes, la invitación
  // sigue ahí para el próximo intento de login.
  await deleteDoc(refInvitacion).catch(() => {});

  return { id: firebaseUser.uid, ...datosPerfil };
}

/* -----------------------------------------------------------------------------
 * Carga
 * -------------------------------------------------------------------------- */

/**
 * Arma el objeto de sesión leyendo los dos modelos.
 *
 * Devuelve `null` si el usuario no puede entrar. Quien llama tiene que cerrar
 * la sesión de Auth en ese caso.
 *
 * Entra con CUALQUIERA de los dos documentos activo — ver el docstring del
 * archivo para el porqué del cambio. Si un documento existe pero está
 * inactivo, bloquea igual, sin importar el otro lado.
 *
 * Las lecturas van en paralelo: son independientes y así el login no tarda
 * el doble.
 *
 * @param {import('firebase/auth').User} firebaseUser
 * @returns {Promise<Object|null>}
 */
export async function cargarSesion(firebaseUser) {
  if (!firebaseUser) return null;

  const [snapViejo, perfilExistente] = await Promise.all([
    getDoc(doc(db, 'usuarios_portal', firebaseUser.uid)),
    cargarPerfilNuevo(firebaseUser.uid),
  ]);

  // Si no se encontró por UID, se intenta por email — ver `buscarViejoPorEmail`
  // para el porqué: en `usuarios_portal` el ID no siempre es el UID de Auth.
  const datosViejo = snapViejo.exists()
    ? snapViejo.data()
    : await buscarViejoPorEmail(firebaseUser.email);

  // Sin perfil nuevo todavía, puede ser alguien entrando por primera vez con
  // una invitación esperándolo. Si no hay ninguna, `perfil` sigue `null` y
  // nada de lo que sigue cambia respecto de antes.
  const perfil = perfilExistente || await consumirInvitacion(firebaseUser);

  const viejoActivo = !!datosViejo && datosViejo.estado === 'activo';
  const nuevoActivo = !!perfil && perfil.estado === 'activo';

  // Un documento que EXISTE pero está inactivo bloquea, sin importar el otro
  // lado: desactivar a alguien en un solo modelo no puede dejarlo entrar por
  // el otro mientras conviven los dos.
  if (datosViejo && !viejoActivo) return null;
  if (perfil && !nuevoActivo) return null;

  // Y con ninguno de los dos activo, tampoco.
  if (!viejoActivo && !nuevoActivo) return null;

  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    ...(datosViejo || {}),           // rol, nombre, empresa, dni... si existe
    perfil: nuevoActivo ? perfil : null,
  };
}

/* -----------------------------------------------------------------------------
 * Consultas sobre la sesión
 *
 * Todas leen del perfil NUEVO. Si no existe, devuelven falso o null: un usuario
 * sin perfil no tiene roles ni organización en el modelo nuevo, aunque el
 * documento viejo diga otra cosa.
 *
 * Están acá y no repartidas por las pantallas para que la pregunta "¿este
 * usuario puede hacer esto?" se conteste en un solo lugar. Hoy el criterio está
 * repetido en cada `if (rol === 'admin' || rol === 'coordinador')` del portal,
 * y no siempre igual.
 * -------------------------------------------------------------------------- */

/** ¿El usuario tiene perfil en el modelo nuevo? */
export function tienePerfil(usuario) {
  return !!(usuario && usuario.perfil);
}

/**
 * ¿Tiene alguno de estos roles?
 * @param {Object} usuario @param {string[]} roles
 */
export function tieneAlgunRol(usuario, roles) {
  if (!tienePerfil(usuario)) return false;
  const mios = usuario.perfil.roles || [];
  return roles.some(r => mios.includes(r));
}

/** ¿Tiene este rol? */
export function tieneRol(usuario, rol) {
  return tieneAlgunRol(usuario, [rol]);
}

/** Admin, coordinador o comercial: el personal de Explora. */
export function esInterno(usuario) {
  return tieneAlgunRol(usuario, ['admin', 'coordinador', 'comercial']);
}

/** Quienes dan de alta organizaciones, domicilios y clientes. */
export function esComercial(usuario) {
  return tieneAlgunRol(usuario, ['admin', 'comercial']);
}

export function esAdmin(usuario) {
  return tieneRol(usuario, 'admin');
}

/** La organización del usuario, o null. */
export function miOrganizacion(usuario) {
  return tienePerfil(usuario) ? (usuario.perfil.organizacion_id || null) : null;
}

/** El DNI del chofer, o null. Es por lo que la app filtra los viajes. */
export function miDni(usuario) {
  if (!tienePerfil(usuario)) return null;
  return (usuario.perfil.datos_chofer && usuario.perfil.datos_chofer.dni) || null;
}

/**
 * Mensaje para mostrar cuando una pantalla nueva no puede operar.
 *
 * Distingue las dos causas, que se ven igual desde afuera pero se arreglan
 * distinto: sin perfil, hay que darlo de alta; con perfil pero sin el rol, hay
 * que pedirle a un admin que lo agregue.
 *
 * @param {Object} usuario
 * @param {string[]} rolesNecesarios
 * @returns {string|null} null si puede operar
 */
export function motivoSinAcceso(usuario, rolesNecesarios) {
  if (!tienePerfil(usuario)) {
    return 'Tu usuario todavía no está dado de alta en el modelo nuevo. '
         + 'Pedile a un administrador que lo cargue desde el módulo de usuarios.';
  }
  if (!tieneAlgunRol(usuario, rolesNecesarios)) {
    return 'Tu usuario no tiene permiso para esta pantalla.';
  }
  return null;
}
