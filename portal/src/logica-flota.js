/* =============================================================================
 * logica-flota.js — Validación y alta de tractores y acoplados (Portal Explora)
 * =============================================================================
 *
 * v1.2.0 (RF-04) — SE EXTRAE DE Camiones.js PARA REUSARLA EN EL IMPORTADOR
 *
 * SÍNTOMA
 *   `normalizarPatente`/`patenteValida`/`mostrarPatente` y la validación de
 *   `validar()` en `Camiones.js` vivían ENTERAS adentro de esa pantalla.
 *   RF-04 necesita validar exactamente las mismas unidades (tractor,
 *   acoplado) desde el importador de Excel -- copiarlas ahí sería la segunda
 *   implementación de la misma regla de negocio, que el prompt de esta tarea
 *   prohíbe explícitamente (punto 9).
 *
 * CAUSA RAÍZ
 *   No había, hasta ahora, una segunda forma de cargar tractores/acoplados
 *   -- así que nunca hizo falta sacar esta lógica de `Camiones.js`.
 *
 * ALCANCE
 *   Todo lo que tenía que ver con patentes y con la validación/armado del
 *   documento de una unidad, movido acá tal cual -- mismo comportamiento,
 *   mismos mensajes. `Camiones.js` pasa a importar de acá en vez de tener
 *   sus propias copias (ver el encabezado propio de ese archivo).
 *
 *   `validarUnidad({ tipo, patente, organizacion_id }, { camiones, editando })`
 *   -- generalización de `validar()`: antes leía `seccion`/`form`/`camiones`/
 *   `editando` de `useState`, ahora los recibe por parámetro. Mismas tres
 *   reglas: patente obligatoria y con formato válido, organización
 *   obligatoria, patente única por organización y tipo (con mensaje
 *   distinto si la que ya existe está inactiva).
 *
 *   `datosDeAltaUnidad({ tipo, patente, organizacion_id, obs })` arma el
 *   documento con `clave_normalizada = organizacion_id|tipo|patente`, igual
 *   que hoy escribe `guardar()` en `Camiones.js`.
 *
 * LIMITACIONES CONOCIDAS
 *   Ninguna: es un recorte 1:1 de lo que ya había, sin cambios de
 *   comportamiento.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- importar-flota` (ahí se testea `validarUnidad`,
 *   ver el encabezado de ese archivo) y `CI=true npm run build` sin
 *   warnings. Manual: `Camiones.js` sigue rechazando/aceptando exactamente
 *   los mismos casos que antes de esta tarea.
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * Patentes
 * -------------------------------------------------------------------------- */

/**
 * Normaliza una patente: mayúsculas, sin espacios ni guiones.
 *
 * "aa 123 aa" y "AA-123-AA" son la misma unidad. Sin esto, la misma patente
 * escrita de dos formas serían dos unidades distintas, que es exactamente el
 * problema que tienen hoy los domicilios.
 */
export function normalizarPatente(p) {
  return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Los dos formatos argentinos vigentes:
 *
 *   ABC123    hasta 2016
 *   AB123CD   Mercosur, desde 2016
 *
 * Se acepta cualquiera de los dos. No se valida contra un padrón —no hay forma
 * desde el navegador— así que esto solo atrapa errores de tipeo groseros.
 */
export function patenteValida(p) {
  const limpia = normalizarPatente(p);
  return /^[A-Z]{3}\d{3}$/.test(limpia) || /^[A-Z]{2}\d{3}[A-Z]{2}$/.test(limpia);
}

/** Con guiones, para mostrar: "AB123CD" → "AB 123 CD". */
export function mostrarPatente(p) {
  const limpia = normalizarPatente(p);
  if (/^[A-Z]{3}\d{3}$/.test(limpia)) return `${limpia.slice(0, 3)} ${limpia.slice(3)}`;
  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(limpia)) {
    return `${limpia.slice(0, 2)} ${limpia.slice(2, 5)} ${limpia.slice(5)}`;
  }
  return limpia;
}

/* -----------------------------------------------------------------------------
 * Nombres de tipo -- mismos textos que `SECCIONES` en Camiones.js, para los
 * mensajes de validación.
 * -------------------------------------------------------------------------- */

const NOMBRE_ENTIDAD = { tractor: 'tractor', acoplado: 'acoplado' };

function nombreEntidad(tipo) {
  return NOMBRE_ENTIDAD[tipo] || 'unidad';
}

/* -----------------------------------------------------------------------------
 * Validación y alta
 * -------------------------------------------------------------------------- */

/**
 * Busca si ya hay una unidad con esa patente, en esa empresa y ese tipo.
 * Devuelve el documento encontrado (activo o inactivo), o `null`.
 *
 * Se extrae de `validarUnidad()` (más abajo) porque `importar-flota.js`
 * necesita la MISMA búsqueda pero para una decisión distinta: el formulario
 * de `Camiones.js` la usa para RECHAZAR el alta; el importador la usa para
 * marcar la fila como "existente" (se saltea, no es un error) -- ver el
 * encabezado v1.2.0 (RF-04) de `importar-flota.js`. La búsqueda en sí -- qué
 * cuenta como "la misma unidad" -- es una sola, acá.
 *
 * @param {Object} unidad `{ tipo, patente, organizacion_id }`
 * @param {Object[]} camiones
 * @param {string|null} [idPropio] excluir este ID (edición)
 * @returns {Object|null}
 */
export function buscarUnidadRepetida(unidad, camiones, idPropio = null) {
  const patente = normalizarPatente(unidad.patente);
  if (!patente) return null;
  return camiones.find(c =>
    c.id !== idPropio
    && c.tipo === unidad.tipo
    && c.organizacion_id === unidad.organizacion_id
    && normalizarPatente(c.patente) === patente
  ) || null;
}

/**
 * Valida una unidad (tractor o acoplado). Devuelve un array de mensajes;
 * vacío si está todo bien.
 *
 * Es la MISMA lógica que tenía `validar()` en `Camiones.js` -- ver el
 * encabezado de este archivo. Pura: sin Firestore, sin `useState`.
 *
 * @param {Object} unidad `{ tipo: 'tractor'|'acoplado', patente,
 *   organizacion_id }`
 * @param {Object} [contexto]
 * @param {Object[]} [contexto.camiones] documentos ya cargados de la
 *   colección `camiones`, para chequear patente repetida.
 * @param {Object|null} [contexto.editando] la unidad en edición, o `null`.
 * @param {boolean} [contexto.omitirDuplicado] si `true`, NO agrega el
 *   mensaje de patente repetida -- lo usa `importar-flota.js`, que trata
 *   una patente ya cargada como fila "existente" (se saltea), no como
 *   error. El formulario de `Camiones.js` nunca lo pasa: ahí sí es un
 *   rechazo.
 * @returns {string[]}
 */
export function validarUnidad(unidad, contexto = {}) {
  const { camiones = [], editando = null, omitirDuplicado = false } = contexto;
  const problemas = [];
  const tipo = unidad.tipo;
  const entidad = nombreEntidad(tipo);
  const patente = normalizarPatente(unidad.patente);

  if (!patente) {
    problemas.push(`La patente del ${entidad} es obligatoria.`);
  } else if (!patenteValida(patente)) {
    problemas.push('La patente no tiene un formato válido. Se espera ABC123 o AB123CD.');
  }

  if (!unidad.organizacion_id) {
    problemas.push('Elegí la empresa de transporte.');
  }

  // La patente identifica a la unidad dentro de una empresa y un tipo. Dos
  // iguales harían que al nominar no se sepa cuál se está eligiendo.
  if (patente && !omitirDuplicado) {
    const repetido = buscarUnidadRepetida(unidad, camiones, editando && editando.id);
    if (repetido) {
      problemas.push(
        repetido.estado === 'activo'
          ? `Esa empresa ya tiene un ${entidad} con esa patente.`
          : `Esa empresa tiene un ${entidad} inactivo con esa patente. Reactivalo en vez de crear otro.`
      );
    }
  }

  return problemas;
}

/**
 * Arma el documento de alta de una unidad -- mismo shape que escribe
 * `guardar()` en `Camiones.js` al crear.
 *
 * NO valida: quien llama corre `validarUnidad()` antes.
 *
 * @param {Object} params `{ tipo, patente, organizacion_id, obs }`
 * @returns {Object} listo para `crear({ coleccion: 'camiones', datos, ... })`
 */
export function datosDeAltaUnidad({ tipo, patente, organizacion_id, obs = '' }) {
  const patenteNormalizada = normalizarPatente(patente);
  return {
    patente: patenteNormalizada,
    obs: String(obs || '').trim(),
    tipo,
    organizacion_id,
    estado: 'activo',
    clave_normalizada: `${organizacion_id}|${tipo}|${patenteNormalizada}`,
  };
}
