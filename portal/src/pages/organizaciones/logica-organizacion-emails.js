/**
 * =============================================================================
 * organizaciones/logica-organizacion-emails.js — v1.2.2 (correos por organización)
 * =============================================================================
 *
 * SÍNTOMA
 *   Una organización tenía un único campo `email` (texto libre, sin
 *   validación de unicidad ni historial), y los avisos por mail al
 *   transportista salían solo a los correos de sus USUARIOS. Si el
 *   transportista tiene una casilla de la empresa que no es de ningún usuario,
 *   no se enteraba de nada.
 *
 * CAUSA RAÍZ
 *   El modelo no tenía dónde guardar "los correos de la organización": solo el
 *   campo `organizaciones.email` (uno, sin alias, sin principal) y los
 *   `email`/`emails_extra` de cada usuario.
 *
 * ALCANCE
 *   1. Colección `organizacion_emails`, un documento por correo, igual que
 *      `organizacion_domicilios` (relación, sin arrays en la organización).
 *      Campos: `organizacion_id`, `email`, `alias`, `principal`,
 *      `clave_normalizada` (`<organizacion_id>|<email en minúsculas>`),
 *      `creado_por_uid`, `creado_en`, `actualizado_en`.
 *   2. Alta, baja y cambio de principal van en `enTransaccion()` y anotan en
 *      el historial (`agregar_email`, `quitar_email`, `marcar_email_principal`,
 *      `entidadTipo: 'organizacion_email'`). El correo SE BORRA al quitarlo:
 *      es una relación y nada lo referencia; queda en el historial.
 *   3. `crearOrganizacionConEmail()`: el alta de una organización con correo
 *      escribe organización + correo + 2 registros de historial en UNA
 *      transacción (las reglas lo exigen: validan el correo con `getAfter()`
 *      sobre la organización).
 *   4. `emailsDeOrganizacion()` / `correosDeTransportista()`: lectura para los
 *      avisos. Los avisos al transportista salen a los correos de sus
 *      usuarios MÁS los de la organización, sin repetidos.
 *
 * LIMITACIONES CONOCIDAS
 *   a. La búsqueda de duplicados y de los principales vigentes es una consulta
 *      previa a la transacción (Firestore no permite consultas dentro de una
 *      transacción del cliente), y el ID del documento es automático: dos
 *      altas simultáneas del mismo correo podrían crear dos documentos. Es el
 *      mismo límite que ya tiene `organizacion_domicilios`.
 *   b. Si la organización es solo cliente, los avisos de hoy no le mandan
 *      nada: sus correos se guardan pero todavía no se usan.
 *   c. `agregarEmail()` reserva 1 anotación de historial + una por cada
 *      principal que haya que bajar (normalmente 1), no solo 1.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm run build` sin warnings. En el modal "Correos": agregar,
 *   repetir el mismo correo en otra grafía de mayúsculas (se rechaza), marcar
 *   principal (queda uno solo), quitar el principal (se promueve el más
 *   antiguo). Cada acción deja su registro en `historial`.
 * ========================================================================== */

import { collection, doc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { enTransaccion, calcularDiferencias } from '../../shared/datos';
import { correosDeOrganizacion } from '../../logica-despachos';

const COLECCION = 'organizacion_emails';
const ENTIDAD = 'organizacion_email';
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 1. trim + minúsculas. */
export function normalizarEmail(texto) {
  return String(texto || '').trim().toLowerCase();
}

/** 2. Lista de problemas; vacía si el correo sirve. */
export function validarEmail(texto) {
  const email = normalizarEmail(texto);
  if (!email) return ['El correo es obligatorio.'];
  if (!FORMATO_EMAIL.test(email)) return ['El correo no parece válido.'];
  return [];
}

/** 3. Clave de deduplicación dentro de una organización. */
export function claveEmail(organizacionId, email) {
  return `${organizacionId}|${normalizarEmail(email)}`;
}

/**
 * 4. Arma el documento a escribir. `esPrimero`: si es el primer correo de la
 * organización, nace principal aunque no se haya pedido.
 */
export function armarVinculoEmail({ organizacion, email, alias, principal, usuario, esPrimero }) {
  const normalizado = normalizarEmail(email);
  return {
    organizacion_id: organizacion.id,
    email: normalizado,
    alias: (alias && String(alias).trim()) || null,
    principal: !!esPrimero || !!principal,
    clave_normalizada: claveEmail(organizacion.id, normalizado),
    creado_por_uid: usuario.uid,
    creado_en: serverTimestamp(),
    actualizado_en: serverTimestamp(),
  };
}

/* -----------------------------------------------------------------------------
 * Lectura
 * -------------------------------------------------------------------------- */

function milis(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (t instanceof Date) return t.getTime();
  return 0;
}

async function leerDocsDeOrganizacion(db, organizacionId) {
  const snap = await getDocs(query(collection(db, COLECCION), where('organizacion_id', '==', organizacionId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Más antiguo primero; un `creado_en` todavía sin resolver (0) va primero. */
function porAntiguedad(a, b) {
  return milis(a.creado_en) - milis(b.creado_en);
}

/**
 * 8. Los correos de la organización, el principal primero.
 * @returns {Promise<string[]>}
 */
export async function emailsDeOrganizacion(db, organizacionId) {
  if (!db) throw new Error('emailsDeOrganizacion: falta db');
  const docs = await leerDocsDeOrganizacion(db, organizacionId);
  docs.sort((a, b) => {
    if (!!a.principal !== !!b.principal) return a.principal ? -1 : 1;
    return porAntiguedad(a, b);
  });
  return docs.map(d => d.email).filter(Boolean);
}

/**
 * Los destinatarios de un aviso al transportista: correos de sus usuarios
 * (`correosDeOrganizacion`) + correos de la organización, sin repetidos y sin
 * distinguir mayúsculas.
 *
 * El mail es secundario: si la consulta de la organización falla, se loguea y
 * se devuelve solo lo de los usuarios -- nunca bloquea crear o editar un
 * despacho.
 *
 * @returns {Promise<string[]>}
 */
export async function correosDeTransportista(db, usuarios, organizacionId) {
  const deUsuarios = correosDeOrganizacion(usuarios, organizacionId);
  let deOrganizacion = [];
  try {
    deOrganizacion = await emailsDeOrganizacion(db, organizacionId);
  } catch (err) {
    console.error('correosDeTransportista: no se pudieron leer los correos de la organización', err);
  }

  const vistos = new Set();
  const salida = [];
  for (const e of [...deUsuarios, ...deOrganizacion]) {
    const n = normalizarEmail(e);
    if (n && !vistos.has(n)) { vistos.add(n); salida.push(n); }
  }
  return salida;
}

/* -----------------------------------------------------------------------------
 * Escritura
 * -------------------------------------------------------------------------- */

/**
 * 5. Agrega un correo. Rechaza duplicados de `clave_normalizada` dentro de la
 * organización. Si se pide principal, baja el principal vigente en la misma
 * transacción.
 *
 * @returns {Promise<string>} id del documento creado
 */
export async function agregarEmail({ db, organizacion, email, alias, principal, usuario }) {
  if (!db) throw new Error('agregarEmail: falta db');
  const problemas = validarEmail(email);
  if (problemas.length > 0) throw new Error(problemas.join(' '));

  const existentes = await leerDocsDeOrganizacion(db, organizacion.id);
  const clave = claveEmail(organizacion.id, email);
  if (existentes.some(e => e.clave_normalizada === clave)) {
    throw new Error(`${normalizarEmail(email)} ya está cargado en ${organizacion.razon_social}.`);
  }

  const esPrimero = existentes.length === 0;
  const aBajar = (principal && !esPrimero) ? existentes.filter(e => e.principal) : [];
  const datos = armarVinculoEmail({ organizacion, email, alias, principal, usuario, esPrimero });
  const ref = doc(collection(db, COLECCION));

  await enTransaccion(db, async (tx, anotar) => {
    // Firestore exige todas las lecturas antes de escribir.
    const actuales = [];
    for (const e of aBajar) {
      const refE = doc(db, COLECCION, e.id);
      const snap = await tx.get(refE);
      if (snap.exists() && snap.data().principal) actuales.push({ ref: refE, id: e.id, datos: snap.data() });
    }

    tx.set(ref, datos);
    anotar({
      entidadTipo: ENTIDAD,
      entidadId: ref.id,
      accion: 'agregar_email',
      diferencias: calcularDiferencias({}, datos),
      usuario,
    });

    for (const a of actuales) {
      tx.update(a.ref, { principal: false, actualizado_en: serverTimestamp() });
      anotar({
        entidadTipo: ENTIDAD,
        entidadId: a.id,
        accion: 'marcar_email_principal',
        diferencias: calcularDiferencias(a.datos, { principal: false }),
        usuario,
      });
    }
  }, 1 + aBajar.length);

  return ref.id;
}

/**
 * 6. Quita un correo (se BORRA el documento). Si era el principal y quedan
 * otros, promueve a principal el más antiguo en la MISMA transacción.
 */
export async function quitarEmail({ db, organizacion, emailDoc, usuario }) {
  if (!db) throw new Error('quitarEmail: falta db');

  const otros = (await leerDocsDeOrganizacion(db, organizacion.id))
    .filter(e => e.id !== emailDoc.id)
    .sort(porAntiguedad);
  const candidato = otros.length > 0 ? otros[0] : null;
  const refQuitado = doc(db, COLECCION, emailDoc.id);

  await enTransaccion(db, async (tx, anotar) => {
    const snapQuitado = await tx.get(refQuitado);
    if (!snapQuitado.exists()) throw new Error('Ese correo ya no existe. Actualizá la página.');
    const actual = snapQuitado.data();

    let refPromovido = null;
    let datosPromovido = null;
    if (actual.principal && candidato) {
      refPromovido = doc(db, COLECCION, candidato.id);
      const snapPromovido = await tx.get(refPromovido);
      if (snapPromovido.exists() && !snapPromovido.data().principal) datosPromovido = snapPromovido.data();
      else refPromovido = null;
    }

    tx.delete(refQuitado);
    anotar({
      entidadTipo: ENTIDAD,
      entidadId: emailDoc.id,
      accion: 'quitar_email',
      diferencias: calcularDiferencias(actual, {}),
      usuario,
    });

    if (refPromovido) {
      tx.update(refPromovido, { principal: true, actualizado_en: serverTimestamp() });
      anotar({
        entidadTipo: ENTIDAD,
        entidadId: candidato.id,
        accion: 'marcar_email_principal',
        diferencias: calcularDiferencias(datosPromovido, { principal: true }),
        usuario,
      });
    }
  }, 2);
}

/**
 * 7. Marca un correo como principal y baja el principal vigente, en una
 * transacción. Anota los dos cambios.
 */
export async function marcarEmailPrincipal({ db, organizacion, emailDoc, usuario }) {
  if (!db) throw new Error('marcarEmailPrincipal: falta db');

  const existentes = await leerDocsDeOrganizacion(db, organizacion.id);
  const aBajar = existentes.filter(e => e.principal && e.id !== emailDoc.id);
  const refElegido = doc(db, COLECCION, emailDoc.id);

  await enTransaccion(db, async (tx, anotar) => {
    const snapElegido = await tx.get(refElegido);
    if (!snapElegido.exists()) throw new Error('Ese correo ya no existe. Actualizá la página.');

    const bajas = [];
    for (const e of aBajar) {
      const refE = doc(db, COLECCION, e.id);
      const snap = await tx.get(refE);
      if (snap.exists() && snap.data().principal) bajas.push({ ref: refE, id: e.id, datos: snap.data() });
    }

    for (const b of bajas) {
      tx.update(b.ref, { principal: false, actualizado_en: serverTimestamp() });
      anotar({
        entidadTipo: ENTIDAD,
        entidadId: b.id,
        accion: 'marcar_email_principal',
        diferencias: calcularDiferencias(b.datos, { principal: false }),
        usuario,
      });
    }

    if (!snapElegido.data().principal) {
      tx.update(refElegido, { principal: true, actualizado_en: serverTimestamp() });
      anotar({
        entidadTipo: ENTIDAD,
        entidadId: emailDoc.id,
        accion: 'marcar_email_principal',
        diferencias: calcularDiferencias(snapElegido.data(), { principal: true }),
        usuario,
      });
    }
  }, 1 + aBajar.length);
}

/**
 * 3. Alta de una organización CON su primer correo (principal), todo en una
 * transacción: organización + correo + 2 registros de historial. Misma forma
 * de documento que escribe `crear()` de `shared/datos.js`.
 *
 * @param {Object} p
 * @param {Object} p.datosOrganizacion lo que hoy se le pasa a `crear()`
 * @returns {Promise<string>} id de la organización creada
 */
export async function crearOrganizacionConEmail({ db, datosOrganizacion, email, usuario }) {
  if (!db) throw new Error('crearOrganizacionConEmail: falta db');
  const problemas = validarEmail(email);
  if (problemas.length > 0) throw new Error(problemas.join(' '));

  const refOrg = doc(collection(db, 'organizaciones'));
  const refEmail = doc(collection(db, COLECCION));

  await enTransaccion(db, async (tx, anotar) => {
    const completa = {
      ...datosOrganizacion,
      creado_por_uid: usuario.uid,
      creado_en: serverTimestamp(),
      actualizado_en: serverTimestamp(),
    };
    const datosEmail = armarVinculoEmail({
      organizacion: { id: refOrg.id },
      email, alias: null, principal: true, usuario, esPrimero: true,
    });

    tx.set(refOrg, completa);
    tx.set(refEmail, datosEmail);

    anotar({
      entidadTipo: 'organizacion',
      entidadId: refOrg.id,
      accion: 'crear_organizacion',
      diferencias: calcularDiferencias({}, completa),
      usuario,
    });
    anotar({
      entidadTipo: ENTIDAD,
      entidadId: refEmail.id,
      accion: 'agregar_email',
      diferencias: calcularDiferencias({}, datosEmail),
      usuario,
    });
  }, 2);

  return refOrg.id;
}
