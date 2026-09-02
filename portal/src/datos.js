/* =============================================================================
 * datos.js — Escritura del modelo nuevo
 * =============================================================================
 *
 * QUE ES
 *   El único lugar por donde se escribe el modelo nuevo. Todo cambio pasa por
 *   acá, va en transacción, y deja un registro en `historial`.
 *
 * POR QUE UN SOLO LUGAR
 *   Hoy el estado del pedido se escribe desde cinco funciones con criterios
 *   distintos: el coordinador mira todos los despachos, el transportista solo
 *   el suyo. El resultado es que `pedido.estado` no describe al pedido sino la
 *   última acción que pasó por ahí.
 *
 *   Con una sola capa, cambiar el criterio es cambiar una función.
 *
 * POR QUE TRANSACCION
 *   Casi ningún cambio toca un solo documento. Cerrar un viaje escribe el
 *   viaje, el despacho, la entrega, el pedido y el historial. Si se escribieran
 *   sueltos y fallara el tercero, quedarían diciendo cosas distintas y nada lo
 *   detectaría.
 *
 * POR QUE HISTORIAL Y NO CAMPOS DE AUDITORIA
 *   Hoy hay `aceptado_por`, `asignado_por`, `reprogramado_por`, `editado_por`.
 *   Son casilleros únicos: reasignar dos veces borra el registro de la primera.
 *   El historial es append-only y guarda las dos.
 *
 * -----------------------------------------------------------------------------
 * OJO CON LAS REGLAS
 * -----------------------------------------------------------------------------
 *   Las reglas del transportista y del chofer usan `hasOnly` sobre los campos
 *   que EFECTIVAMENTE cambian. Por eso `actualizar()` escribe diferencias y no
 *   el documento entero: un `set()` completo haría que Firestore vea todos los
 *   campos como afectados y rechace la escritura.
 *
 *   Si aparece un `permission-denied` incomprensible en una acción del
 *   transportista, esto es lo primero que hay que mirar.
 * ========================================================================== */

import {
  doc,
  collection,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from './firebase';

/* -----------------------------------------------------------------------------
 * Comparación de valores
 *
 * El historial guarda solo lo que cambió. Detectar qué cambió no es trivial:
 * con `!==` cualquier objeto o array da siempre distinto —compara referencias,
 * no contenido— y el historial se llenaría de cambios fantasma en cada guardado.
 * -------------------------------------------------------------------------- */

/**
 * Firestore rechaza `undefined`. Un campo que no existía se guarda como `null`.
 *
 * Se pierde la distinción entre "no existía" y "era null", que en estos datos
 * no significan cosas distintas: un despacho sin `horario_carga` y uno con
 * `horario_carga: null` son el mismo despacho.
 */
function normalizar(valor) {
  if (valor === undefined) return null;
  if (Array.isArray(valor)) return valor.map(normalizar);
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    // Los Timestamp de Firestore y los sentinelas (serverTimestamp) no se
    // pueden inspeccionar: se dejan pasar tal cual.
    if (typeof valor.toDate === 'function' || valor._methodName) return valor;
    const salida = {};
    for (const clave of Object.keys(valor)) salida[clave] = normalizar(valor[clave]);
    return salida;
  }
  return valor;
}

/** Igualdad por contenido, no por referencia. */
function sonIguales(a, b) {
  const na = normalizar(a);
  const nb = normalizar(b);

  if (na === nb) return true;
  if (na === null || nb === null) return false;
  if (typeof na !== typeof nb) return false;
  if (na instanceof Date && nb instanceof Date) return na.getTime() === nb.getTime();

  if (Array.isArray(na) !== Array.isArray(nb)) return false;
  if (Array.isArray(na)) {
    if (na.length !== nb.length) return false;
    return na.every((v, i) => sonIguales(v, nb[i]));
  }

  if (typeof na === 'object') {
    const clavesA = Object.keys(na);
    const clavesB = Object.keys(nb);
    if (clavesA.length !== clavesB.length) return false;
    return clavesA.every(k =>
      Object.prototype.hasOwnProperty.call(nb, k) && sonIguales(na[k], nb[k]));
  }

  return false;
}

function esSentinel(v) {
  return v && typeof v === 'object' && v._methodName;
}

function esMapaPlano(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
         && !esSentinel(v) && typeof v.toDate !== 'function';
}

/**
 * Compara dos versiones de un documento y devuelve solo lo que cambió.
 *
 * Los campos anidados se reportan con ruta de puntos
 * ("datos_chofer.dni"), no como el objeto entero. Es lo que hace útil la
 * consulta que justifica que `campos_modificados` sea un array de strings:
 *
 *     where('campos_modificados', 'array-contains', 'transportista_org_id')
 *
 * Si se guardara el objeto padre, esa consulta devolvería cualquier cambio
 * dentro de él y no serviría para nada.
 *
 * Los arrays NO se descomponen: cambian enteros o no cambian. Descomponerlos
 * supondría que la posición tiene significado, y en `telefonos` o `roles` no lo
 * tiene.
 *
 * @param {Object} antes Estado anterior. `{}` si el documento no existía.
 * @param {Object} despues Campos que se quieren escribir.
 * @param {string} prefijo Uso interno para la recursión.
 * @returns {{campos: string[], antes: Object, despues: Object}}
 */
export function calcularDiferencias(antes = {}, despues = {}, prefijo = '') {
  const campos = [];
  const valoresAntes = {};
  const valoresDespues = {};

  for (const clave of Object.keys(despues)) {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    const vAntes = normalizar(antes ? antes[clave] : undefined);
    const vDespues = normalizar(despues[clave]);

    // Un sentinel de servidor siempre cuenta como cambio: su valor no se conoce
    // hasta que Firestore lo resuelve, así que no hay con qué compararlo.
    if (!esSentinel(vDespues) && sonIguales(vAntes, vDespues)) continue;

    if (esMapaPlano(vDespues) && esMapaPlano(vAntes)) {
      const anidado = calcularDiferencias(vAntes, vDespues, ruta);
      campos.push(...anidado.campos);
      Object.assign(valoresAntes, anidado.antes);
      Object.assign(valoresDespues, anidado.despues);
      continue;
    }

    campos.push(ruta);
    valoresAntes[ruta] = vAntes;
    valoresDespues[ruta] = esSentinel(vDespues) ? '(timestamp del servidor)' : vDespues;
  }

  return { campos, antes: valoresAntes, despues: valoresDespues };
}

/* -----------------------------------------------------------------------------
 * Historial
 * -------------------------------------------------------------------------- */

/**
 * Genera el ID de un evento de historial.
 *
 * Se llama SIEMPRE fuera del callback de la transacción. Firestore puede
 * reintentar ese callback ante contención, y si el ID se generara adentro cada
 * reintento produciría un registro distinto: el mismo cambio quedaría anotado
 * dos o tres veces.
 */
function nuevoIdHistorial() {
  return doc(collection(db, 'historial')).id;
}

/**
 * Arma el documento de historial. No escribe: devuelve el objeto.
 *
 * `usuario_uid` tiene que ser el del que está escribiendo — las reglas lo
 * exigen. No se puede anotar un cambio a nombre de otro.
 */
function armarHistorial({
  entidadTipo, entidadId, pedidoId, accion,
  diferencias, usuario, razon = null, derivado = false,
}) {
  return {
    entidad_tipo: entidadTipo,
    entidad_id: entidadId,
    pedido_id: pedidoId || null,
    accion,
    campos_modificados: diferencias.campos,
    antes: diferencias.antes,
    despues: diferencias.despues,
    usuario_uid: usuario.uid,
    usuario_nombre: usuario.nombre || usuario.email || 'Sin identificar',
    razon: razon || null,
    // `derivado` marca los cambios que nadie pidió y se desprenden de otro: el
    // estado del pedido que se recalcula porque cambió un despacho. Sin esto,
    // la línea de tiempo del pedido tendría huecos donde el estado cambió solo.
    derivado,
    ts: serverTimestamp(),
  };
}

/* -----------------------------------------------------------------------------
 * Escritura
 * -------------------------------------------------------------------------- */

/**
 * Crea un documento con su registro de historial, en una transacción.
 *
 * @param {Object} params
 * @param {string} params.coleccion
 * @param {Object} params.datos
 * @param {string} params.accion       para el historial: "crear_organizacion"...
 * @param {Object} params.usuario      la sesión
 * @param {string} [params.entidadTipo] por defecto, el nombre de la colección
 *   en singular
 * @param {string} [params.pedidoId]   denormalizado, si aplica
 * @param {string} [params.id]         forzar el ID. Solo para `usuarios`, donde
 *   el ID tiene que ser el UID de Auth. En el resto es autogenerado.
 * @returns {Promise<string>} el ID del documento creado
 */
export async function crear({
  coleccion, datos, accion, usuario,
  entidadTipo = null, pedidoId = null, id = null,
}) {
  const idHistorial = nuevoIdHistorial();

  return runTransaction(db, async (tx) => {
    const ref = id ? doc(db, coleccion, id) : doc(collection(db, coleccion));

    if (id) {
      const previo = await tx.get(ref);
      if (previo.exists()) {
        throw new Error(`Ya existe ${coleccion}/${id}.`);
      }
    }

    const completo = {
      ...datos,
      creado_por_uid: usuario.uid,
      creado_en: serverTimestamp(),
      actualizado_en: serverTimestamp(),
    };

    tx.set(ref, completo);

    tx.set(doc(db, 'historial', idHistorial), armarHistorial({
      entidadTipo: entidadTipo || coleccion.replace(/es$/, '').replace(/s$/, ''),
      entidadId: ref.id,
      pedidoId,
      accion,
      diferencias: calcularDiferencias({}, completo),
      usuario,
    }));

    return ref.id;
  });
}

/**
 * Actualiza un documento con su registro de historial, en una transacción.
 *
 * Escribe SOLO los campos que cambiaron. Si no cambió nada, no escribe: evita
 * llenar el historial de ruido cuando alguien abre un formulario y lo guarda
 * sin tocar nada.
 *
 * @param {Object} params
 * @param {string} params.coleccion
 * @param {string} params.id
 * @param {Object} params.cambios
 * @param {string} params.accion
 * @param {Object} params.usuario
 * @param {string} [params.razon]
 * @param {string} [params.entidadTipo]
 * @param {string} [params.pedidoId]
 * @param {function} [params.validar] Recibe el documento actual y devuelve un
 *   mensaje de error, o null. Se ejecuta DENTRO de la transacción, sobre el
 *   estado releído: es la única forma de validar sin condición de carrera.
 * @returns {Promise<{cambio: boolean, campos: string[]}>}
 */
export async function actualizar({
  coleccion, id, cambios, accion, usuario,
  razon = null, entidadTipo = null, pedidoId = null, validar = null,
}) {
  const idHistorial = nuevoIdHistorial();

  return runTransaction(db, async (tx) => {
    const ref = doc(db, coleccion, id);
    const snap = await tx.get(ref);

    if (!snap.exists()) {
      throw new Error(`No existe ${coleccion}/${id}. Actualizá la página.`);
    }

    const actual = snap.data();

    if (validar) {
      const error = validar(actual);
      if (error) throw new Error(error);
    }

    const dif = calcularDiferencias(actual, cambios);
    if (dif.campos.length === 0) return { cambio: false, campos: [] };

    tx.update(ref, { ...cambios, actualizado_en: serverTimestamp() });

    tx.set(doc(db, 'historial', idHistorial), armarHistorial({
      entidadTipo: entidadTipo || coleccion.replace(/es$/, '').replace(/s$/, ''),
      entidadId: id,
      pedidoId,
      accion,
      diferencias: dif,
      usuario,
      razon,
    }));

    return { cambio: true, campos: dif.campos };
  });
}

/**
 * Desactiva un documento.
 *
 * Nada se borra en el modelo nuevo, salvo los adjuntos y los vínculos
 * organización↔domicilio: borrar dejaría despachos, viajes e historial
 * apuntando a documentos inexistentes, y Firestore no valida referencias —no
 * fallaría, simplemente quedarían huecos—.
 *
 * @param {function} [params.validar] Para las reglas de negocio que impiden la
 *   baja: un chofer con viaje en curso, un producto con pedidos vivos.
 */
export async function desactivar({
  coleccion, id, usuario, razon = null, accion = null, validar = null,
}) {
  return actualizar({
    coleccion, id,
    cambios: { estado: 'inactivo' },
    accion: accion || `desactivar_${coleccion.replace(/es$/, '').replace(/s$/, '')}`,
    usuario, razon, validar,
  });
}

/**
 * Reactiva un documento desactivado.
 */
export async function reactivar({ coleccion, id, usuario, razon = null, validar = null }) {
  return actualizar({
    coleccion, id,
    cambios: { estado: 'activo' },
    accion: `reactivar_${coleccion.replace(/es$/, '').replace(/s$/, '')}`,
    usuario, razon, validar,
  });
}

/* -----------------------------------------------------------------------------
 * Transacción abierta
 * -------------------------------------------------------------------------- */

/**
 * Para los cambios que tocan varios documentos a la vez: cerrar un viaje
 * escribe el viaje, el despacho, la entrega y el pedido.
 *
 * El callback recibe la transacción y una función `anotar()` que agrega un
 * registro de historial. Los IDs de esos registros se generan ANTES de entrar,
 * para que un reintento de la transacción no los duplique.
 *
 * ```javascript
 * await enTransaccion(async (tx, anotar) => {
 *   const viaje = await tx.get(refViaje);
 *   tx.update(refViaje, { estado: 'FINALIZADO' });
 *   anotar({ entidadTipo: 'viaje', entidadId: id, accion: 'finalizar_viaje',
 *            diferencias: calcularDiferencias(viaje.data(), cambios), usuario });
 * });
 * ```
 *
 * Firestore exige TODAS las lecturas antes de cualquier escritura dentro de una
 * transacción. Si se lee después de escribir, falla.
 *
 * @param {function} fn (tx, anotar) => Promise
 * @param {number} [maxAnotaciones] cuántos registros de historial se van a
 *   escribir como máximo. Se reservan los IDs por adelantado.
 */
export async function enTransaccion(fn, maxAnotaciones = 4) {
  const ids = Array.from({ length: maxAnotaciones }, () => nuevoIdHistorial());

  return runTransaction(db, async (tx) => {
    let usados = 0;

    const anotar = (params) => {
      if (usados >= ids.length) {
        throw new Error(
          `Se intentaron escribir más de ${ids.length} registros de historial. ` +
          `Subí maxAnotaciones en la llamada a enTransaccion().`
        );
      }
      tx.set(doc(db, 'historial', ids[usados++]), armarHistorial(params));
    };

    return fn(tx, anotar);
  });
}
