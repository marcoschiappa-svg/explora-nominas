/* =============================================================================
 * logica-tarifario.js — v1.2.0 (RF-09)
 * =============================================================================
 *
 * SÍNTOMA
 *   Las rutas del tarifario eran un ARRAY DE TEXTO LIBRE dentro de un solo
 *   documento (`portal/rutas.lista[]`), indexado por POSICIÓN. Todo lo demás
 *   colgaba de ese índice: las tarifas modificadas (`portal/mods.data`, un
 *   mapa `{ idx: valor }`), los cambios pendientes de aprobación
 *   (`portal/pendientes.data[]`, cada entrada con su `idx`) y el historial
 *   (`portal/historial.data[]`). Consecuencias reales:
 *
 *     · `proveedor`, `destino` y `producto` eran strings escritos a mano,
 *       sin relación con `organizaciones`, `domicilios` ni `productos` — el
 *       mismo lugar podía estar escrito de varias formas, igual que pasaba
 *       con las direcciones de los pedidos antes de `buscar-domicilios.js`.
 *     · Insertar o reordenar una ruta desplazaba TODOS los índices
 *       posteriores, y con ellos las tarifas, los pendientes y el historial:
 *       cada ruta quedaba con la tarifa de otra, sin que nada lo detectara.
 *     · No había forma de que un coordinador guardara una tarifa calculada
 *       sin tocar los datos maestros: o escribía en el array de todos, o no
 *       guardaba nada.
 *     · Todo el tarifario cabía en cuatro documentos, con el tope de 1 MiB
 *       por documento de Firestore como techo del historial.
 *
 * CAUSA RAÍZ
 *   La pantalla nació en v1.0 (junio 2026) como un módulo autónomo, antes de
 *   que existieran `organizaciones`, `domicilios` y `productos`, y guardó lo
 *   único que tenía a mano: el texto que alguien tipeó. Nunca se migró.
 *
 * ALCANCE
 *   Este archivo es el ÚNICO lugar por donde se leen y escriben las rutas del
 *   tarifario. `Tarifario.js` solo lo llama: ninguna regla de negocio
 *   —quién puede escribir qué clase de ruta, la unicidad, qué pasa al
 *   aprobar un pendiente— vive en la pantalla.
 *
 *   DOS CLASES DE RUTA, en la misma colección `rutas`:
 *
 *     PARÁMETRO (`tipo: 'parametro'`)  Son datos maestros: las 42 de hoy y
 *       las que agregue el admin. Solo el admin las crea y las edita.
 *       Las leen admin, coordinador y comercial. Son las únicas que el
 *       Generador usa como vecinas.
 *
 *     REFERENCIA (`tipo: 'referencia'`)  Las que el coordinador arma con el
 *       Generador a partir de una parámetro y guarda para consultarlas. No
 *       modifican nada de las parámetro. Las escribe su creador (o el
 *       admin); las leen admin y coordinador, nunca el comercial.
 *
 *   La ruta NO lleva cliente: se identifica por origen, destino y producto
 *   (`clave_normalizada = origen|destino|producto`).
 *
 *   SUBCOLECCIÓN `rutas/{id}/tarifas`: un documento por cada cambio de
 *   tarifa de una ruta PARÁMETRO, con `origen` en
 *   `editor | ajuste_global | catamp | generador | restauracion | migracion`.
 *   Reemplaza a `portal/mods` y `portal/historial`, que quedan en Firestore
 *   como respaldo de SOLO LECTURA (las reglas ya no dejan escribirlos).
 *
 * LIMITACIONES CONOCIDAS
 *   · LA UNICIDAD NO ES ATÓMICA. Se chequea con una consulta previa
 *     (`buscarClaveEnFirestore`) y después se escribe: entre las dos cosas
 *     hay una ventana en la que otro podría crear la misma clave. Dos altas
 *     SIMULTÁNEAS de la misma `clave_normalizada` podrían duplicarse. El
 *     riesgo es bajo porque hay un solo escritor por clase (el admin para
 *     las parámetro; cada coordinador para sus referencias) y porque la
 *     ventana es de milisegundos. Hacerlo atómico exigiría un documento
 *     centinela por clave —`rutas_claves/{clave}` creado en la misma
 *     transacción—, que es el patrón correcto pero agrega una colección y
 *     una regla más; queda fuera del alcance de RF-09.
 *   · La unicidad considera LAS DOS CLASES juntas: si el coordinador genera
 *     una ruta que ya existe como parámetro, se le muestra la parámetro y no
 *     se guarda una referencia duplicada.
 *   · `desactivarRuta()` libera la clave: se puede volver a crear una ruta
 *     con la misma clave después de desactivar la anterior. Es deliberado
 *     (una ruta desactivada es una ruta que ya no existe operativamente),
 *     pero significa que la clave no es única sobre el histórico, solo sobre
 *     lo activo.
 *   · `cargarPendientes`, `aprobarPendientes` y `descartarPendientes` usan
 *     `writeBatch`, que es atómico pero NO transaccional: no relee el estado
 *     antes de escribir. Si un admin aprueba mientras otro carga un ajuste
 *     global, gana el último en llegar. Con un solo admin no pasa.
 *     El tope de 500 operaciones por batch se respeta cortando en 400 (mismo
 *     margen que `migrar-camiones-a-flota.js`).
 *   · Estas escrituras NO pasan por `datos.js` y por lo tanto NO dejan
 *     registro en `historial`: su bitácora propia es la subcolección
 *     `tarifas`, que guarda más contexto (tarifa anterior, variación,
 *     justificación, referencia, adjunto) del que el historial genérico
 *     podría. El ALTA y la BAJA de una ruta sí pasan por `datos.js`, así que
 *     esas dos sí quedan en `historial`.
 *   · Las versiones VIEJAS de `tarifario_versiones` (las que guardan `mods`
 *     por `idx`) se restauran mapeando contra `rutas.legacy.idx`. Una ruta
 *     creada después de la migración no tiene `legacy`, así que nunca va a
 *     aparecer en una versión vieja: eso no es un error, se informa.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- logica-tarifario` — ver `logica-tarifario.test.js`,
 *   que cubre SOLO las partes puras (validación, armado de documentos,
 *   unicidad sobre una lista dada, mapeo de versiones viejas por
 *   `legacy.idx`). Lo que toca Firestore se verifica a mano en staging, con
 *   la lista de pruebas del CHANGELOG v1.2.0.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-09b) — LAS RUTAS SON TEXTO, NO VÍNCULOS A MAESTROS DEL PORTAL
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     `claveRuta`, `validarRuta` y `armarRuta` ataban una ruta a
 *     `origen_domicilio_id`/`destino_domicilio_id`/`producto_id`: tres
 *     referencias a `domicilios` y `productos` del portal. El tarifario usa
 *     rutas ESTANDARIZADAS (un texto convenido para "Bioils Argentina S.A."
 *     o "COFCO Pto.Gral.San Martin (SF)"), no domicilios operativos con
 *     calle y número ni productos con los que se arma un pedido: son datos
 *     propios del tarifario, no vínculos a otras colecciones.
 *
 *   CAUSA RAÍZ
 *     RF-09 copió el patrón de `pedido.destino_domicilio_id` sin notar que
 *     el tarifario resuelve por CONVENIO de tarifas (ruta estandarizada),
 *     no por domicilio operativo: dos plantas del mismo cliente en la misma
 *     ciudad pueden pagar la misma tarifa si el convenio las trata como una
 *     sola ruta, y el tarifario no tiene por qué mapear 1 a 1 contra
 *     `domicilios`.
 *
 *   ALCANCE
 *     `origen`, `destino` y `producto` pasan a ser TEXTO LIBRE
 *     ESTANDARIZADO (hasta 120 caracteres, sin espacios en los extremos).
 *     `clave_normalizada` se arma con `claveNormalizada()` de
 *     `mapa-normalizacion.js` —el mismo normalizador que usa el resto del
 *     portal para no duplicar organizaciones por una tilde o una mayúscula
 *     de más— sobre cada uno de los tres campos, no sobre un id opaco.
 *     `claveRuta`, `validarRuta` y `armarRuta` se ajustan a estos tres
 *     campos; el resto de `logica-tarifario.js` (unicidad, altas,
 *     pendientes, indicador, versiones) no cambia: ya trabajaba sobre
 *     `clave_normalizada`, no sobre los ids que se retiran.
 *
 *   LIMITACIONES CONOCIDAS
 *     `claveNormalizada()` no distingue variantes que un humano sí
 *     distinguiría si difieren solo en palabras genéricas ("Planta Norte"
 *     vs "Planta Sur" normalizan distinto, pero "Depósito A" y "Deposito A"
 *     normalizan igual a propósito) — es el mismo comportamiento que ya
 *     tiene el resto del portal con organizaciones y domicilios, no una
 *     limitación nueva de esta tarea.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- logica-tarifario`: unicidad que ignora
 *     mayúsculas/tildes/signos, origen igual a destino por clave
 *     normalizada, textos vacíos o solo espacios, 120 caracteres.
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-09) — NuevoTarifario: MAESTRA/DERIVADA, TARIFA SIEMPRE CALCULADA
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El Tarifario existente se reemplazaba por completo por la pantalla que
 *     arma este módulo. Esa decisión se revierte: el Tarifario existente
 *     queda como LEGACY, sin tocarse, y esta lógica pasa a ser la base de
 *     una pantalla nueva en paralelo, `NuevoTarifario.js`, con dos ajustes al
 *     modelo de RF-09.
 *
 *   CAUSA RAÍZ
 *     1. Una ruta PARÁMETRO ("maestra" en la pantalla nueva) no dejaba
 *        rastro de CUÁNDO se actualizó su tarifa ni QUIÉN lo hizo, más allá
 *        de la subcolección `tarifas` — no había un campo directo para
 *        mostrar "Fecha de actualización" en un listado sin leer la
 *        subcolección de cada fila.
 *     2. Una ruta REFERENCIA ("derivada") guardaba `calculo: {ruta_vecina_id,
 *        ratio, catac_base}`: un ratio CONGELADO contra la vecina más
 *        cercana al momento de crearla. Si esa vecina cambiaba de tarifa, la
 *        derivada NO se enteraba — quedaba desactualizada en silencio.
 *
 *   ALCANCE
 *     1. `tarifa_actualizada_en`/`tarifa_actualizada_por` se agregan a toda
 *        ruta PARÁMETRO, en el alta (`crearRutaParametro`) y en cada
 *        aprobación (`aprobarPendientes`).
 *     2. Las funciones de alta/edición de REFERENCIA pasan a exigir
 *        `ruta_maestra_id` (una maestra elegida y FIJA, no una vecina
 *        recalculada) y a guardar `tarifa_al_crear`/`fecha_calculo` como foto
 *        informativa — nunca como fuente de verdad. `armarRuta()` ya no
 *        escribe `calculo` para las referencias nuevas; la tarifa de una
 *        derivada se calcula siempre en el momento (`calcularTarifaDerivada`,
 *        en `calculo-tarifario.js`), nunca se lee de un campo guardado.
 *     3. `guardarVersion`/`leerVersiones`/`restaurarVersion` pasan de la
 *        colección `tarifario_versiones` (la que usa el Tarifario legacy,
 *        con su propio formato por `idx`, código separado dentro de
 *        `Tarifario.js`) a una colección nueva, `rutas_versiones` — nada más
 *        importaba esas tres funciones hasta ahora. `restaurarVersion` deja
 *        de PISAR `tarifa_vigente` directo: ahora arma `pendiente` en cada
 *        ruta (vía `cargarPendientes`), con motivo "Restauración de versión
 *        <fecha>", para que pase por la misma aprobación que cualquier otro
 *        cambio de tarifa maestra.
 *     4. `aplicarIndicador()` (nueva) es la ÚNICA vía para cambiar una
 *        tarifa maestra: CATAMP (factor compuesto) o CATAC (porcentaje
 *        simple), con alcance "todas" o una categoría. Guarda la foto en
 *        `rutas_versiones` y deja cada maestra afectada con `pendiente`,
 *        reusando `cargarPendientes()`. `editarTarifa()` (edición manual
 *        tarifa por tarifa) y `promoverReferencia()` ("Promover a ruta
 *        parámetro") se eliminan: no tienen otro uso, y la pantalla nueva no
 *        los expone.
 *     5. `ORIGENES_TARIFA` suma `'catac'` para el indicador CATAC.
 *
 *   LIMITACIONES CONOCIDAS
 *     Las derivadas de una maestra que se desactiva quedan sin tarifa
 *     calculada ("Maestra inactiva" en la pantalla) hasta que se les asigna
 *     otra — no hay ninguna limpieza automática. `calculo`/`ratio` de las
 *     referencias que ya existan en staging (creadas antes de este cambio)
 *     quedan en el documento sin usarse: no se borran, pero nada las vuelve
 *     a leer.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- logica-tarifario` y `CI=true npm test --
 *     calculo-tarifario`. Manual: ver la lista de pruebas del CHANGELOG
 *     v1.2.0, sección NuevoTarifario.
 * ========================================================================== */

import {
  doc,
  collection,
  addDoc,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';

import { db } from './firebase';
import { crear, actualizar, desactivar } from './shared/datos';
import { esAdmin, tieneRol } from './sesion';
import { claveNormalizada } from './mapa-normalizacion';

/** (RF-09b, comentario 1) Tope de caracteres de `origen`/`destino`/`producto`. */
const TOPE_TEXTO = 120;

/* -----------------------------------------------------------------------------
 * Constantes
 * -------------------------------------------------------------------------- */

export const TIPO_PARAMETRO = 'parametro';
export const TIPO_REFERENCIA = 'referencia';

/**
 * Los valores válidos de `origen` en un documento de `rutas/{id}/tarifas`.
 * (RF-09, comentario 5) `catac` se agrega para el indicador CATAC de
 * `aplicarIndicador()`, y `alta` para el primer documento que deja
 * `crearRutaParametro()` (B.4: el alta de una maestra SÍ arranca su
 * historial). `editor` y `ajuste_global` ya no los genera la pantalla nueva
 * (no hay edición manual ni ajuste libre), pero quedan acá por si algún
 * documento ya escrito en staging los usa.
 */
export const ORIGENES_TARIFA = [
  'editor',
  'ajuste_global',
  'catamp',
  'catac',
  'generador',
  'restauracion',
  'migracion',
  'alta',
];

/** Las categorías que ya usaba el tarifario. Mismo criterio que hoy. */
export const CATEGORIAS = ['General', 'Peligroso'];

/** Margen contra el tope de 500 operaciones por `writeBatch` de Firestore. */
const TOPE_BATCH = 400;

/* =============================================================================
 * PARTE 1 — LÓGICA PURA (lo que cubren los tests)
 * ========================================================================== */

/**
 * 1. La clave que identifica una ruta. NO es el ID del documento: los IDs
 *    siguen siendo opacos y autogenerados, mismo criterio que el resto del
 *    modelo nuevo (ver el docstring de `claveNormalizada` en
 *    `mapa-normalizacion.js`). Es un CAMPO que sirve para una sola cosa:
 *    decidir si esta ruta ya existe.
 *
 *    No lleva cliente a propósito: una ruta es origen + destino + producto.
 *
 *    (RF-09b, comentario 1) `origen`, `destino` y `producto` son TEXTO
 *    libre estandarizado, no ids de `domicilios`/`productos`: la clave se
 *    arma normalizando cada uno por separado con `claveNormalizada()`, para
 *    que "Bioils Argentina S.A." y "bioils argentina s.a." sean la misma
 *    ruta sin serlo también "Bioils" a secas (no se concatena el texto
 *    crudo antes de normalizar: eso podría fusionar o separar rutas según
 *    dónde caiga un espacio de más).
 */
export function claveRuta({ origen, destino, producto }) {
  return `${claveNormalizada(origen)}|${claveNormalizada(destino)}|${claveNormalizada(producto)}`;
}

/**
 * 2. La ruta ACTIVA que ya ocupa esa clave, o `null`. Considera las DOS
 *    clases: una referencia no puede pisar una parámetro ni al revés.
 *
 * @param {Array} rutas Las rutas ya cargadas (activas)
 * @param {string} clave
 * @param {string} [idIgnorar] Al editar, la propia ruta
 */
export function buscarPorClave(rutas, clave, idIgnorar = null) {
  return (rutas || []).find(
    r => r && r.id !== idIgnorar && r.estado !== 'inactivo' && r.clave_normalizada === clave
  ) || null;
}

/**
 * 3. Validación de una ruta, antes de crearla o editarla. Es la MISMA
 *    función para las dos clases: lo que cambia entre parámetro y referencia
 *    es quién puede escribirla, no qué es una ruta válida.
 *
 *    Devuelve un array de mensajes; vacío significa que está bien. Mismo
 *    contrato que `validarPedido()` y `validarUnidad()`.
 *
 * (RF-09b, comentario 2) `origen`, `destino` y `producto` son TEXTO libre
 * estandarizado: no hay nada que "elegir" de otra colección, se tipean. Se
 * exige que no estén vacíos (ni solo espacios) y hasta `TOPE_TEXTO`
 * caracteres — el mismo criterio de longitud que ya usa el resto del
 * portal para texto libre.
 *
 * @param {Object} datos `{ origen, destino, producto, km, tarifa_vigente,
 *   categoria }`
 * @param {Object} contexto `{ rutas, idIgnorar }`
 * @returns {string[]}
 */
export function validarRuta(datos = {}, contexto = {}) {
  const problemas = [];
  const { rutas = [], idIgnorar = null } = contexto;

  const origen = String(datos.origen || '').trim();
  const destino = String(datos.destino || '').trim();
  const producto = String(datos.producto || '').trim();

  if (!origen)  problemas.push('Escribí el origen.');
  else if (origen.length > TOPE_TEXTO) problemas.push(`El origen no puede superar los ${TOPE_TEXTO} caracteres.`);

  if (!destino) problemas.push('Escribí el destino.');
  else if (destino.length > TOPE_TEXTO) problemas.push(`El destino no puede superar los ${TOPE_TEXTO} caracteres.`);

  if (!producto) problemas.push('Escribí el producto.');
  else if (producto.length > TOPE_TEXTO) problemas.push(`El producto no puede superar los ${TOPE_TEXTO} caracteres.`);

  // El origen distinto del destino: una ruta de un lugar a sí mismo no es un
  // flete. Se compara por CLAVE NORMALIZADA, no por texto crudo: "Explora
  // S.A." y "EXPLORA S.A." son el mismo lugar aunque estén escritos
  // distinto. Se chequea solo si los dos están cargados, para no apilar dos
  // mensajes sobre el mismo campo vacío.
  if (origen && destino && claveNormalizada(origen) === claveNormalizada(destino)) {
    problemas.push('El origen y el destino no pueden ser el mismo lugar.');
  }

  const km = Number(datos.km);
  if (!(km > 0)) problemas.push('Los km tienen que ser mayores que 0.');

  const tarifa = Number(datos.tarifa_vigente);
  if (!(tarifa > 0)) problemas.push('La tarifa tiene que ser mayor que 0.');

  if (datos.categoria && !CATEGORIAS.includes(datos.categoria)) {
    problemas.push(`Categoría desconocida: "${datos.categoria}".`);
  }

  // 4. Unicidad. Va al final para que, si faltan campos, el mensaje sea el
  //    del campo que falta y no un "ya existe" calculado sobre una clave
  //    incompleta.
  if (origen && destino && producto) {
    const existente = buscarPorClave(rutas, claveRuta({ origen, destino, producto }), idIgnorar);
    if (existente) {
      problemas.push(
        existente.tipo === TIPO_PARAMETRO
          ? 'Ya existe una ruta parámetro activa con ese origen, destino y producto.'
          : 'Ya existe una ruta de referencia activa con ese origen, destino y producto.'
      );
    }
  }

  return problemas;
}

/**
 * 5. Arma el documento de una ruta, sin escribirlo. Los campos de auditoría
 *    (`creado_por_uid`, `creado_en`, `actualizado_en`) los agrega `crear()`
 *    de `datos.js` — no se duplican acá.
 *
 *    `creado_por_uid` se incluye IGUAL en las referencias aunque `crear()` lo
 *    vuelva a escribir: las reglas exigen que venga en `request.resource.data`
 *    para un coordinador, y quien lo llama tiene que poder verlo antes de
 *    escribir.
 *
 *    (RF-09, comentario 2) Los campos que siguen a `legacy` dependen de la
 *    clase: una PARÁMETRO ("maestra") lleva `tarifa_actualizada_en`/
 *    `tarifa_actualizada_por`; una REFERENCIA ("derivada") lleva
 *    `ruta_maestra_id`/`tarifa_al_crear`/`fecha_calculo` en vez del viejo
 *    `calculo: {ratio, ...}` — su tarifa nunca sale de acá, se calcula
 *    siempre en el momento con `calcularTarifaDerivada()`.
 *
 * (RF-09b, comentario 3) `origen`/`destino`/`producto` se guardan RECORTADOS
 * (`.trim()`): "sin espacios al principio ni al final" es parte del
 * contrato del campo, no solo de la validación.
 *
 * @param {Object} datos `{ origen, destino, producto, km, tarifa_vigente,
 *   categoria, catac_ref }`
 * @param {'parametro'|'referencia'} tipo
 * @param {Object} [extra] `{ legacy, tarifa_base, tarifa_actualizada_en,
 *   tarifa_actualizada_por, ruta_maestra_id, tarifa_al_crear, fecha_calculo }`
 */
export function armarRuta(datos, tipo, extra = {}) {
  const origen = String(datos.origen || '').trim();
  const destino = String(datos.destino || '').trim();
  const producto = String(datos.producto || '').trim();
  const base = {
    tipo,
    origen,
    destino,
    producto,
    clave_normalizada: claveRuta({ origen, destino, producto }),
    km: Number(datos.km),
    tarifa_base: extra.tarifa_base != null ? Number(extra.tarifa_base) : null,
    tarifa_vigente: Number(datos.tarifa_vigente),
    catac_ref: datos.catac_ref != null ? Number(datos.catac_ref) : null,
    categoria: datos.categoria || 'General',
    // `pendiente` solo tiene sentido en una maestra: una derivada no pasa por
    // el circuito de aprobación, se calcula siempre en el momento.
    pendiente: null,
    estado: 'activo',
    creado_por_uid: extra.creado_por_uid || null,
    legacy: extra.legacy || null,
  };

  if (tipo === TIPO_PARAMETRO) {
    return {
      ...base,
      tarifa_actualizada_en: extra.tarifa_actualizada_en || null,
      tarifa_actualizada_por: extra.tarifa_actualizada_por || null,
    };
  }

  return {
    ...base,
    ruta_maestra_id: extra.ruta_maestra_id || null,
    tarifa_al_crear: extra.tarifa_al_crear != null ? Number(extra.tarifa_al_crear) : null,
    fecha_calculo: extra.fecha_calculo || null,
  };
}

/**
 * 6. Arma el documento de un cambio de tarifa (`rutas/{id}/tarifas`). El `ts`
 *    lo pone el servidor: la fecha de un registro de auditoría no la puede
 *    decidir el cliente.
 */
export function armarCambioTarifa({ anterior, nueva, variacion, just, ref, adjunto, origen, usuario }) {
  if (!ORIGENES_TARIFA.includes(origen)) {
    throw new Error(`Origen de cambio de tarifa desconocido: "${origen}".`);
  }
  return {
    tarifa_anterior: anterior != null ? Number(anterior) : null,
    tarifa_nueva: Number(nueva),
    variacion: variacion != null ? Number(variacion) : calcularVariacion(anterior, nueva),
    just: just || '',
    ref: ref || 'Otro',
    adjunto: adjunto || null,
    origen,
    usuario_uid: usuario.uid,
    usuario_nombre: usuario.nombre || usuario.email || 'Sin identificar',
    ts: serverTimestamp(),
  };
}

/** La variación porcentual entre dos tarifas, redondeada a 2 decimales. */
export function calcularVariacion(anterior, nueva) {
  const a = Number(anterior);
  const n = Number(nueva);
  if (!a) return null;   // sin tarifa anterior no hay variación que calcular
  return Math.round((n / a - 1) * 10000) / 100;
}

/** Las rutas parámetro activas — las únicas que el Generador usa de vecinas. */
export function rutasParametro(rutas) {
  return (rutas || []).filter(r => r.tipo === TIPO_PARAMETRO && r.estado !== 'inactivo');
}

/** Las rutas derivadas activas. */
export function rutasDerivadas(rutas) {
  return (rutas || []).filter(r => r.tipo === TIPO_REFERENCIA && r.estado !== 'inactivo');
}

/**
 * 7. ¿Quién puede editar esta ruta derivada? Su creador, o un admin.
 *    Es la misma regla que aplican las reglas de Firestore; acá está para
 *    que la pantalla pueda esconder el botón en vez de dejar que la
 *    escritura rebote con un `permission-denied` que no explica nada.
 */
export function puedeEditarDerivada(ruta, usuario) {
  if (!ruta || ruta.tipo !== TIPO_REFERENCIA) return false;
  if (esAdmin(usuario)) return true;
  return !!usuario && ruta.creado_por_uid === usuario.uid;
}

/**
 * 8. Mapea una versión guardada de `tarifario_versiones` a los cambios
 *    concretos que hay que aplicar sobre las rutas de hoy.
 *
 *    Hay DOS formatos, y esta función los resuelve los dos:
 *
 *      NUEVO   `version.rutas = [{ ruta_id, tarifa_vigente }]` — se mapea por
 *              ID de documento, que no se mueve nunca.
 *
 *      VIEJO   `version.mods = { "<idx>": valor | { tarifa_vigente } }` — las
 *              versiones guardadas antes de RF-09, por POSICIÓN en el array
 *              de `portal/rutas`. Se mapean contra `ruta.legacy.idx`, que la
 *              migración dejó justamente para esto.
 *
 *    Lo que no mapea se informa (`sinMapear`), nunca se adivina ni se
 *    descarta en silencio.
 *
 * @param {Object} version
 * @param {Array} rutas Las rutas activas de hoy
 * @returns {{cambios: Array<{ruta: Object, tarifaNueva: number}>,
 *   sinMapear: Array<{clave: string, tarifa: number}>, formato: 'nuevo'|'viejo'}}
 */
export function mapearVersion(version, rutas) {
  const cambios = [];
  const sinMapear = [];

  if (version && Array.isArray(version.rutas)) {
    const porId = new Map((rutas || []).map(r => [r.id, r]));
    for (const entrada of version.rutas) {
      const ruta = porId.get(entrada.ruta_id);
      if (ruta) cambios.push({ ruta, tarifaNueva: Number(entrada.tarifa_vigente) });
      else sinMapear.push({ clave: entrada.ruta_id, tarifa: Number(entrada.tarifa_vigente) });
    }
    return { cambios, sinMapear, formato: 'nuevo' };
  }

  const mods = (version && version.mods) || {};
  const porIdx = new Map(
    (rutas || [])
      .filter(r => r.legacy && r.legacy.idx != null)
      .map(r => [Number(r.legacy.idx), r])
  );

  for (const idx of Object.keys(mods)) {
    const valor = mods[idx];
    const tarifa = Number(typeof valor === 'object' && valor !== null ? valor.tarifa_vigente : valor);
    const ruta = porIdx.get(Number(idx));
    if (ruta) cambios.push({ ruta, tarifaNueva: tarifa });
    else sinMapear.push({ clave: `idx ${idx}`, tarifa });
  }

  return { cambios, sinMapear, formato: 'viejo' };
}

/** La foto de las tarifas vigentes de hoy, en el formato NUEVO de versión. */
export function armarFotoVersion(rutas) {
  return rutasParametro(rutas).map(r => ({
    ruta_id: r.id,
    tarifa_vigente: Number(r.tarifa_vigente),
  }));
}

/* =============================================================================
 * PARTE 2 — CHEQUEOS DE ROL
 *
 * Cada función de escritura empieza por acá. Las reglas de Firestore son la
 * defensa real —nadie puede saltearlas desde la consola del navegador—, pero
 * un `permission-denied` no explica nada: estos chequeos son los que dan el
 * mensaje entendible.
 * ========================================================================== */

function exigirAdmin(usuario, accion) {
  if (!esAdmin(usuario)) {
    throw new Error(`Solo un administrador puede ${accion}.`);
  }
}

function exigirCoordinadorOAdmin(usuario, accion) {
  if (!esAdmin(usuario) && !tieneRol(usuario, 'coordinador')) {
    throw new Error(`Solo un administrador o un coordinador puede ${accion}.`);
  }
}

/* =============================================================================
 * PARTE 3 — LECTURA
 * ========================================================================== */

/**
 * 9. Las rutas activas que este usuario puede leer.
 *
 *    (RF-09, NuevoTarifario) El comercial SÍ lee derivadas, en modo lectura
 *    —B.5 pide que las vea en "Rutas derivadas"—, a diferencia de la primera
 *    versión de RF-09, que se las escondía. La regla de `rutas` ya es
 *    `esInterno()` liso (ver `firestore.rules.produccion`), así que no hace
 *    falta ningún filtro por `tipo` para que la consulta pase.
 */
export function consultaRutas(usuario) {
  void usuario;   // se acepta por consistencia con el resto de las lecturas, no se usa para filtrar
  return query(collection(db, 'rutas'), where('estado', '==', 'activo'));
}

/** Lo mismo, resuelto de una sola vez. La pantalla usa `onSnapshot`. */
export async function leerRutas(usuario) {
  const snap = await getDocs(consultaRutas(usuario));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** El historial de tarifas de una ruta, de la más nueva a la más vieja. */
export async function leerTarifasDeRuta(rutaId) {
  const snap = await getDocs(collection(db, 'rutas', rutaId, 'tarifas'));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const ta = a.ts && a.ts.toMillis ? a.ts.toMillis() : 0;
      const tb = b.ts && b.ts.toMillis ? b.ts.toMillis() : 0;
      return tb - ta;
    });
}

/**
 * 10. La ruta ACTIVA que ocupa una clave, consultada contra Firestore en vez
 *     de contra lo que la pantalla tenga cargado. Es el chequeo de unicidad
 *     real, el que corre justo antes de escribir.
 *
 *     Se consulta SOLO por `clave_normalizada` y se filtra `estado` en
 *     memoria: así la consulta es de un campo único y funciona igual para
 *     cualquier rol, sin que el filtro de `tipo` del comercial la complique.
 */
export async function buscarClaveEnFirestore(clave, idIgnorar = null) {
  const snap = await getDocs(query(collection(db, 'rutas'), where('clave_normalizada', '==', clave)));
  const encontrada = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .find(r => r.estado !== 'inactivo' && r.id !== idIgnorar);
  return encontrada || null;
}

/* =============================================================================
 * PARTE 4 — ALTA Y BAJA DE RUTAS
 * ========================================================================== */

/**
 * 11. Alta de una ruta PARÁMETRO ("maestra"). Solo admin — es un dato
 *     maestro.
 *
 *     El alta pasa por `crear()` de `datos.js`, así que queda en `historial`
 *     como cualquier otra entidad del modelo nuevo, y hereda su auditoría.
 *     (RF-09, comentario 1) `tarifa_actualizada_en`/`tarifa_actualizada_por`
 *     se estampan en el alta: es la "Fecha de actualización" que muestra el
 *     registro. El primer valor de la tarifa SÍ deja un documento en
 *     `tarifas`, con `origen: 'alta'` (B.4) — la justificación va en
 *     `extra.just`; el historial de la ruta arranca completo, en vez de
 *     empezar vacío hasta el primer cambio real.
 *
 * @returns {Promise<string>} el ID de la ruta creada
 */
export async function crearRutaParametro({ datos, usuario, rutas = [], extra = {} }) {
  exigirAdmin(usuario, 'crear una ruta parámetro');

  const problemas = validarRuta(datos, { rutas });
  if (problemas.length > 0) throw new Error(problemas.join(' '));

  const clave = claveRuta(datos);
  const yaExiste = await buscarClaveEnFirestore(clave);
  if (yaExiste) {
    throw new Error('Ya existe una ruta activa con ese origen, destino y producto.');
  }

  const idNueva = await crear({
    db,
    coleccion: 'rutas',
    datos: armarRuta(datos, TIPO_PARAMETRO, {
      ...extra,
      creado_por_uid: usuario.uid,
      tarifa_base: extra.tarifa_base != null ? extra.tarifa_base : datos.tarifa_vigente,
      tarifa_actualizada_en: serverTimestamp(),
      tarifa_actualizada_por: { uid: usuario.uid, nombre: usuario.nombre || usuario.email || 'Sin identificar' },
    }),
    accion: 'crear_ruta_parametro',
    entidadTipo: 'ruta',
    usuario,
  });

  await addDoc(collection(db, 'rutas', idNueva, 'tarifas'), armarCambioTarifa({
    anterior: null,
    nueva: datos.tarifa_vigente,
    variacion: null,
    just: extra.just || 'Alta de ruta maestra.',
    ref: 'Otro',
    adjunto: null,
    origen: 'alta',
    usuario,
  }));

  return idNueva;
}

/**
 * 12. Alta de una ruta DERIVADA. Coordinador o admin.
 *
 *     (RF-09, comentario 2) `rutaMaestra` es la maestra ELEGIDA y FIJA de la
 *     que depende — no una vecina que se recalcula sola. Se guardan
 *     `ruta_maestra_id`, y `tarifa_al_crear`/`fecha_calculo` como foto
 *     informativa: la tarifa real de la derivada nunca sale de acá, se
 *     calcula siempre en el momento con `calcularTarifaDerivada()`.
 */
export async function crearRutaDerivada({ datos, usuario, rutas = [], rutaMaestra }) {
  exigirCoordinadorOAdmin(usuario, 'guardar una ruta derivada');

  if (!rutaMaestra || rutaMaestra.tipo !== TIPO_PARAMETRO) {
    throw new Error('Elegí de qué ruta maestra depende esta derivada.');
  }

  const problemas = validarRuta(datos, { rutas });
  if (problemas.length > 0) throw new Error(problemas.join(' '));

  const clave = claveRuta(datos);
  const yaExiste = await buscarClaveEnFirestore(clave);
  if (yaExiste) {
    // 13. El caso que pide RF-09 explícitamente: si la clave ya existe como
    //     maestra o como otra derivada, se le muestra la existente y NO se
    //     guarda una duplicada. El error lleva la ruta encontrada adentro
    //     para que la pantalla pueda mostrarla.
    const err = new Error('Esa ruta ya existe. Se muestra la que hay en vez de duplicarla.');
    err.rutaExistente = yaExiste;
    throw err;
  }

  return crear({
    db,
    coleccion: 'rutas',
    datos: armarRuta(datos, TIPO_REFERENCIA, {
      creado_por_uid: usuario.uid,
      ruta_maestra_id: rutaMaestra.id,
      tarifa_al_crear: datos.tarifa_vigente,
      fecha_calculo: serverTimestamp(),
      // Una derivada no tiene "tarifa original": nace con la calculada.
      tarifa_base: null,
    }),
    accion: 'crear_ruta_derivada',
    entidadTipo: 'ruta',
    usuario,
  });
}

/**
 * 14. Edición de una ruta DERIVADA. Su creador, o un admin.
 *
 *     Lo que NO se puede cambiar (y las reglas lo vuelven a exigir): `tipo`,
 *     `creado_por_uid` y `clave_normalizada`. Cambiar la clave sería crear
 *     otra ruta, y para eso está el alta. `ruta_maestra_id` SÍ se puede
 *     cambiar: es como se reasigna una derivada con "Maestra inactiva" a
 *     otra maestra. Ya no se edita `tarifa_vigente` a mano: se calcula sola.
 */
export async function editarRutaDerivada({ ruta, cambios, usuario, razon = null }) {
  if (!puedeEditarDerivada(ruta, usuario)) {
    throw new Error('Solo podés editar las rutas derivadas que creaste vos.');
  }

  const permitidos = {};
  if (cambios.km != null)             permitidos.km = Number(cambios.km);
  if (cambios.categoria)              permitidos.categoria = cambios.categoria;
  if (cambios.ruta_maestra_id)        permitidos.ruta_maestra_id = cambios.ruta_maestra_id;

  if (permitidos.km != null && !(permitidos.km > 0)) {
    throw new Error('Los km tienen que ser mayores que 0.');
  }
  if (Object.keys(permitidos).length === 0) {
    throw new Error('No hay nada para cambiar.');
  }

  return actualizar({
    db,
    coleccion: 'rutas',
    id: ruta.id,
    cambios: permitidos,
    accion: 'editar_ruta_derivada',
    entidadTipo: 'ruta',
    usuario,
    razon,
  });
}

/**
 * 15. Baja de una ruta. Nada se borra: se desactiva, igual que el resto del
 *     modelo nuevo (`delete: false` en las reglas). Una maestra la baja el
 *     admin; una derivada, su creador o el admin.
 */
export async function desactivarRuta({ ruta, usuario, razon = null }) {
  if (ruta.tipo === TIPO_PARAMETRO) {
    exigirAdmin(usuario, 'desactivar una ruta maestra');
  } else if (!puedeEditarDerivada(ruta, usuario)) {
    throw new Error('Solo podés desactivar las rutas derivadas que creaste vos.');
  }

  return desactivar({
    db,
    coleccion: 'rutas',
    id: ruta.id,
    usuario,
    razon,
    accion: ruta.tipo === TIPO_PARAMETRO ? 'desactivar_ruta_parametro' : 'desactivar_ruta_derivada',
  });
}

/* =============================================================================
 * PARTE 5 — TARIFAS MAESTRAS: INDICADOR, PENDIENTES Y APROBACIÓN
 * ========================================================================== */

/** Corre un batch en tandas de `TOPE_BATCH` operaciones. */
async function enTandas(operaciones) {
  let batch = writeBatch(db);
  let n = 0;
  for (const op of operaciones) {
    op(batch);
    n++;
    if (n >= TOPE_BATCH) {
      await batch.commit();
      batch = writeBatch(db);
      n = 0;
    }
  }
  if (n > 0) await batch.commit();
}

/**
 * 17. Deja un cambio PENDIENTE en cada ruta maestra afectada. Solo admin.
 *     Es lo que hace `aplicarIndicador()`: calcula la tarifa nueva de cada
 *     maestra pero no la aplica — se aprueba después, desde la tabla de
 *     pendientes.
 *
 *     Reemplaza a `portal/pendientes.data[]`: el pendiente vive DENTRO de su
 *     ruta (`pendiente: { ... }`), así que no puede quedar apuntando a la
 *     ruta equivocada si algo se reordena.
 *
 * @param {Array<{ruta: Object, tarifaNueva: number}>} cambios
 * @param {Object} meta `{ just, ref, adjunto, variacion }`
 */
export async function cargarPendientes(cambios, meta, usuario) {
  exigirAdmin(usuario, 'cargar cambios pendientes de tarifa');
  if (!meta || !meta.just) throw new Error('Poné una justificación para el ajuste.');
  if (!cambios || cambios.length === 0) throw new Error('No hay ninguna ruta afectada.');

  const fecha = new Date().toISOString();

  await enTandas(cambios.map(({ ruta, tarifaNueva }) => (batch) => {
    batch.update(doc(db, 'rutas', ruta.id), {
      pendiente: {
        tarifa_nueva: Number(tarifaNueva),
        variacion: meta.variacion != null
          ? Number(meta.variacion)
          : calcularVariacion(ruta.tarifa_vigente, tarifaNueva),
        just: meta.just,
        ref: meta.ref || 'Otro',
        adjunto: meta.adjunto || null,
        fecha,
        creado_por_uid: usuario.uid,
        // De dónde salió el pendiente, para que el documento de `tarifas` que
        // se escriba al aprobarlo diga la verdad y no un valor por defecto.
        origen: ORIGENES_TARIFA.includes(meta.origen) ? meta.origen : 'ajuste_global',
      },
      actualizado_en: serverTimestamp(),
    });
  }));

  return cambios.length;
}

/**
 * 18. Aprueba los pendientes: `pendiente.tarifa_nueva` pasa a
 *     `tarifa_vigente`, se estampan `tarifa_actualizada_en`/
 *     `tarifa_actualizada_por` (RF-09, comentario 1), se agrega el documento
 *     en `rutas/{id}/tarifas` y se limpia `pendiente`. Todo en el mismo
 *     batch, así que o pasan todas las cosas o no pasa ninguna.
 *
 *     Cada ruta consume DOS operaciones del batch (el update y el documento
 *     de historial), por eso `enTandas` corta en 400 y no en 500.
 */
export async function aprobarPendientes(rutas, usuario) {
  exigirAdmin(usuario, 'aprobar cambios de tarifa');

  const conPendiente = (rutas || []).filter(r => r.pendiente && r.pendiente.tarifa_nueva != null);
  if (conPendiente.length === 0) throw new Error('No hay cambios pendientes.');

  const actualizadaPor = { uid: usuario.uid, nombre: usuario.nombre || usuario.email || 'Sin identificar' };

  const operaciones = [];
  for (const ruta of conPendiente) {
    const p = ruta.pendiente;
    // Los pendientes cargados antes de que `cargarPendientes()` escribiera
    // `origen` (o desde la consola) caen a `ajuste_global`, o a `catamp` si su
    // referencia lo dice: es lo más honesto que se puede deducir.
    const origen = p.origen || (p.ref === 'CATAMP' ? 'catamp' : 'ajuste_global');

    operaciones.push((batch) => {
      batch.update(doc(db, 'rutas', ruta.id), {
        tarifa_vigente: Number(p.tarifa_nueva),
        tarifa_actualizada_en: serverTimestamp(),
        tarifa_actualizada_por: actualizadaPor,
        pendiente: null,
        actualizado_en: serverTimestamp(),
      });
    });
    operaciones.push((batch) => {
      batch.set(doc(collection(db, 'rutas', ruta.id, 'tarifas')), armarCambioTarifa({
        anterior: ruta.tarifa_vigente,
        nueva: p.tarifa_nueva,
        variacion: p.variacion,
        just: p.just,
        ref: p.ref,
        adjunto: p.adjunto,
        origen: ORIGENES_TARIFA.includes(origen) ? origen : 'ajuste_global',
        usuario,
      }));
    });
  }

  await enTandas(operaciones);
  return conPendiente.length;
}

/** Descarta los pendientes sin aplicarlos. Solo admin. */
export async function descartarPendientes(rutas, usuario) {
  exigirAdmin(usuario, 'descartar cambios de tarifa');

  const conPendiente = (rutas || []).filter(r => r.pendiente);
  if (conPendiente.length === 0) throw new Error('No hay cambios pendientes.');

  await enTandas(conPendiente.map(ruta => (batch) => {
    batch.update(doc(db, 'rutas', ruta.id), { pendiente: null, actualizado_en: serverTimestamp() });
  }));

  return conPendiente.length;
}

/**
 * 19. La ÚNICA vía para cambiar una tarifa maestra: aplicar un indicador.
 *     Solo admin. CATAMP (factor compuesto de una grilla de meses, calculado
 *     con `evaluarCatamp()`/`factorCompuesto()` de `calculo-tarifario.js`) o
 *     CATAC (un porcentaje simple, con `aplicarPorcentaje()`) — la pantalla
 *     calcula el `factor` y se lo pasa a esta función ya resuelto, junto con
 *     el `tipo` para armar la justificación y el `ref` de la subcolección
 *     `tarifas`.
 *
 *     Alcance "todas" (`alcanceCategoria` vacío o `'all'`) o una categoría.
 *     Guarda la foto en `rutas_versiones` ANTES de tocar nada (mismo criterio
 *     que tenía CATAMP antes de RF-09) y deja cada maestra afectada con
 *     `pendiente`, reusando `cargarPendientes()` — no hay ninguna escritura
 *     directa de `tarifa_vigente` acá.
 *
 * @param {Object} datos `{ tipo: 'CATAMP'|'CATAC', factor, alcanceCategoria,
 *   just, adjunto }`
 * @param {Array} rutas Las rutas cargadas (para tomar las maestras activas)
 */
export async function aplicarIndicador({ tipo, factor, alcanceCategoria, just, adjunto }, rutas, usuario) {
  exigirAdmin(usuario, 'aplicar un indicador de actualización de tarifas');

  const f = Number(factor);
  if (!(f > 0)) throw new Error('El indicador no calculó un factor válido.');
  if (!just) throw new Error('Ingresá la justificación del indicador.');

  const alcance = alcanceCategoria && alcanceCategoria !== 'all' ? alcanceCategoria : null;
  const afectadas = rutasParametro(rutas).filter(r => !alcance || r.categoria === alcance);
  if (afectadas.length === 0) throw new Error('No hay rutas maestras afectadas por ese alcance.');

  const ref = tipo === 'CATAC' ? 'CATAC' : 'CATAMP';
  const origen = tipo === 'CATAC' ? 'catac' : 'catamp';

  await guardarVersion({
    rutas,
    desc: `Foto previa a ${ref} (${new Date().toLocaleDateString('es-AR')})`,
    origen,
    meta: { tipo: ref, alcanceCategoria: alcance || 'all', factor: f },
    usuario,
  });

  const cambios = afectadas.map(ruta => ({
    ruta,
    tarifaNueva: Math.round(ruta.tarifa_vigente * f * 100) / 100,
  }));

  return cargarPendientes(cambios, {
    just,
    ref,
    adjunto: adjunto || null,
    origen,
    variacion: Math.round((f - 1) * 10000) / 100,
  }, usuario);
}

/* =============================================================================
 * PARTE 6 — VERSIONES RECUPERABLES
 * ========================================================================== */

/**
 * 20. Guarda una foto de las tarifas vigentes. Solo admin.
 *
 *     Las versiones NUEVAS guardan `rutas: [{ ruta_id, tarifa_vigente }]`.
 *     El campo `mods` NO se escribe más: existe solo en las versiones viejas,
 *     y `mapearVersion()` lo sabe leer.
 */
export async function guardarVersion({ rutas, desc, origen = 'manual', meta = null, usuario }) {
  exigirAdmin(usuario, 'guardar una versión del tarifario');

  const descripcion = String(desc || '').trim();
  if (origen === 'manual' && !descripcion) {
    throw new Error('Poné una descripción para la versión.');
  }

  const foto = armarFotoVersion(rutas);

  // (RF-09, comentario 3) `rutas_versiones`, no `tarifario_versiones` — esa
  // es del Tarifario legacy, con su propio formato y su propio código.
  const ref = await addDoc(collection(db, 'rutas_versiones'), {
    desc: descripcion || (origen === 'catamp' ? 'Foto CATAMP' : origen === 'catac' ? 'Foto CATAC' : 'Foto de rutas'),
    origen,
    meta: meta || null,
    rutas: foto,
    nRutas: foto.length,
    fecha: new Date().toISOString(),
    fechaTxt: new Date().toLocaleString('es-AR'),
  });

  return ref.id;
}

/** Las versiones guardadas, de la más nueva a la más vieja. */
export async function leerVersiones() {
  const snap = await getDocs(collection(db, 'rutas_versiones'));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
}

/**
 * 21. Restaura una versión. Solo admin.
 *
 *     (RF-09, comentario 3) SEMÁNTICA NUEVA: ya no pisa `tarifa_vigente`
 *     directo. Arma un `pendiente` en cada ruta afectada, con motivo
 *     "Restauración de versión <fecha>", reusando `cargarPendientes()` — pasa
 *     por la misma aprobación que cualquier otro cambio de tarifa maestra.
 *
 * @returns {{aplicadas: number, sinMapear: Array}}
 */
export async function restaurarVersion({ version, rutas, usuario }) {
  exigirAdmin(usuario, 'restaurar una versión de rutas');

  const { cambios, sinMapear, formato } = mapearVersion(version, rutas);
  if (cambios.length === 0) {
    const err = new Error('Ninguna ruta de esa versión se pudo mapear a las rutas de hoy.');
    err.sinMapear = sinMapear;
    throw err;
  }

  const fecha = new Date().toLocaleDateString('es-AR');
  const just = `Restauración de versión ${fecha}`
             + (formato === 'viejo' ? ' (mapeada por legacy.idx)' : '');

  const aprobadas = await cargarPendientes(cambios, {
    just,
    ref: 'Versión',
    origen: 'restauracion',
  }, usuario);

  return { aplicadas: aprobadas, sinMapear };
}

/* =============================================================================
 * PARTE 7 — TABLA CATAC
 *
 * No cambia de comportamiento con RF-09: sigue en `portal/catac` y
 * `catac_versiones`. Se expone la lectura desde acá solo para que la pantalla
 * no tenga que saber la ruta del documento.
 * ========================================================================== */

/** La tabla CATAC vigente, o `{ datos: null }` si nunca se importó ninguna. */
export async function leerCatac() {
  const snap = await getDoc(doc(db, 'portal', 'catac'));
  if (!snap.exists()) return { datos: null, ver: null, estadia: null };
  const d = snap.data();
  return { datos: d.datos || null, ver: d.ver || null, estadia: d.estadia || null };
}
