/* =============================================================================
 * mapa-normalizacion.js — Equivalencias de nombres e IDs canónicos
 * =============================================================================
 *
 * UBICACION
 *   Vive en `portal/src/` y NO en `portal/scripts/`, aunque lo usen los dos
 *   lados. Create React App no permite importar nada que esté fuera de `src/`,
 *   así que si el archivo estuviera en `scripts/` el portal no podría leerlo y
 *   habría que mantener una copia. Desde Node, en cambio, se puede subir un
 *   nivel sin problema:
 *
 *     portal/src/escritura.js        ->  import { ... } from './mapa-normalizacion'
 *     portal/scripts/migrar-*.js     ->  require('../src/mapa-normalizacion')
 *
 *   Se mantiene en CommonJS (`module.exports`) porque los scripts de Node lo
 *   necesitan así. Webpack resuelve la interoperabilidad al importarlo desde el
 *   portal: los `import { CLIENTES }` funcionan igual.
 *
 * QUE CONTIENE
 *   1. Los mapas de equivalencias de nombres de cliente y de transporte.
 *   2. `claveNormalizada`, que reduce una razón social a su forma comparable.
 *
 *   Los dos tienen que estar en el mismo lugar: la clave normalizada es lo que
 *   decide si dos nombres son la misma organización, y esa decisión la toman
 *   por separado el portal y los scripts de carga. Si difirieran aunque sea en
 *   el tratamiento de un acento, se crearían organizaciones duplicadas.
 *
 * LOS MAPAS
 *   Convierten los nombres escritos a mano en `pedido.cliente` y
 *   `despacho.transporte` a la organización que les corresponde.
 *
 *   Armados a partir del relevamiento de los 215 pedidos (21/08/2026) y
 *   revisados a mano: el agrupador automático no detecta acrónimos ("PAE" =
 *   "Pan American Energy"), palabras invertidas ("Transporte G&G" = "G&G
 *   Transporte") ni nombres cortos contenidos en otros más largos ("RAD" =
 *   "Transporte RAD").
 *
 *   Un valor `null` significa: NO migrar. Son datos de prueba o marcadores que
 *   no corresponden a ninguna empresa real.
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * CLIENTES
 *
 * 38 organizaciones reales. El resto son datos de prueba.
 * -------------------------------------------------------------------------- */

const CLIENTES = {
  // ── Con variantes ────────────────────────────────────────────────────────

  // Pro Crop es una subdivisión de Fender. Se tratan como dos clientes
  // separados, pero "PRO CROP - FENDER" es Pro Crop: son los pedidos de la
  // subdivisión. Fender no aparece nunca sola en estos 215 pedidos.
  // Coincide con el ruteo actual del Apps Script, que manda ese valor a la
  // columna de Pro Crop (58) y no a la de Fender (59).
  'PRO CROP - FENDER':              'PRO CROP',
  'PRO CROP':                       'PRO CROP',
  'Pro Crop':                       'PRO CROP',

  // "PAE" es el acrónimo. El agrupador no puede deducirlo.
  'Pan American Energy':            'PAN AMERICAN ENERGY',
  'PAE':                            'PAN AMERICAN ENERGY',
  'Pan Amerucan Eneergí':           'PAN AMERICAN ENERGY',   // errata, 2 usos

  'PEYTE':                          'PEYTE',
  'Peyte':                          'PEYTE',

  'ALLTEC S.A.':                    'ALLTEC S.A.',
  'Alltec':                         'ALLTEC S.A.',

  'Lanther':                        'LANTHER',
  'LANTHER':                        'LANTHER',

  // Nombre corto contenido en el largo. El agrupador no los junta.
  'TECNICA QUIMICA ARGENTINA S.A.': 'TECNICA QUIMICA ARGENTINA S.A.',
  'Tecnica Quimica':                'TECNICA QUIMICA ARGENTINA S.A.',

  // ── Sin variantes ────────────────────────────────────────────────────────

  'CHEMOTECNICA S.A.':              'CHEMOTECNICA S.A.',
  'Exolgan':                        'EXOLGAN',
  'RAINBOW Agroscienses S.A.':      'RAINBOW AGROSCIENCES S.A.',   // ver nota 1
  'METHIL GROUP':                   'METHIL GROUP',
  'CDM':                            'CDM',
  'laruso':                         'LARUSO',                      // ver nota 2
  'FORMULAGRO':                     'FORMULAGRO',
  'Andreani':                       'ANDREANI',
  'BARCAN QUIMICA S.R.L.':          'BARCAN QUIMICA S.R.L.',
  'BAYA CASAL S.A.':                'BAYA CASAL S.A.',
  'SINER':                          'SINER',
  'DARUMA AGRO SRL':                'DARUMA AGRO S.R.L.',
  'REOPEN':                         'REOPEN',
  'CAGSA':                          'CAGSA',
  'AKTIV':                          'AKTIV',
  'RIZOBACTER':                     'RIZOBACTER',
  'AGROVA':                         'AGROVA',
  'Laboratorio Degser':             'LABORATORIO DEGSER',
  'PALAVERSICH Y CIA SAC.':         'PALAVERSICH Y CIA S.A.C.',
  'SeNAsa':                         'SENASA',
  'MOLISOLES S.R.L.':               'MOLISOLES S.R.L.',
  'Mapei':                          'MAPEI',
  'PB Leiner':                      'PB LEINER',
  'FERTILIZANTES FULLTEC S.R.L.':   'FERTILIZANTES FULLTEC S.R.L.',
  'Bioelectrica':                   'BIOELECTRICA',
  'Alianza Nutriente':              'ALIANZA NUTRIENTE',
  'Octa Renewables SL':             'OCTA RENEWABLES S.L.',
  'SETI':                           'SETI',
  'ARANAMI INDUSTRIAL':             'ARANAMI INDUSTRIAL',
  'ECOFERTIL':                      'ECOFERTIL',
  'SERV QUIM':                      'SERV QUIM',
  'EL TOBIANO':                     'EL TOBIANO',

  // ── NO migrar: datos de prueba ───────────────────────────────────────────

  'IvanPruebaApp':                  null,
  'JuanPruebaApp':                  null,
  'SofiaPruebaApp':                 null,
  'JoelPruebaApp':                  null,
  'EzequielPruebaApp':              null,
  'AgustinPruebaApp':               null,
  'MagaliPruebaApp':                null,
  'HernanPruebaApp':                null,
  'Prueba':                         null,
  'Prueba Ivan':                    null,

  // ── Sin resolver ─────────────────────────────────────────────────────────

  'Otro':                           null,   // ver nota 3
};

/* -----------------------------------------------------------------------------
 * TRANSPORTES
 *
 * 3 organizaciones reales. De los 8 valores distintos, el agrupador no detectó
 * ninguna variante porque las diferencias son estructurales, no ortográficas.
 * -------------------------------------------------------------------------- */

const TRANSPORTES = {
  // Palabras invertidas — Levenshtein compara carácter por carácter y no lo ve.
  'Transporte G&G':                 'TRANSPORTE G&G',      // 101 usos
  'G&G Transporte':                 'TRANSPORTE G&G',      //   8 usos

  // Nombre corto contenido en el largo.
  'Transporte RAD':                 'TRANSPORTE RAD',      //  34 usos
  'RAD':                            'TRANSPORTE RAD',      //   4 usos

  // "Hugo Pou" es el nombre completo; "POU" la forma corta.
  'Transporte POU':                 'TRANSPORTE HUGO POU', //  12 usos
  'Transporte Hugo Pou':            'TRANSPORTE HUGO POU', //   8 usos

  // ── NO migrar ────────────────────────────────────────────────────────────

  'Transprueba':                    null,   // dato de prueba, 105 usos
  '—':                              null,   // ver nota 4
};

/* -----------------------------------------------------------------------------
 * NOTAS
 * -------------------------------------------------------------------------- */

/*
 * NOTA 1 — "RAINBOW Agroscienses S.A."
 *   El nombre guardado tiene una errata: "Agroscienses" por "Agrosciences".
 *   Se corrige al normalizar. Confirmar la razón social exacta.
 *
 * NOTA 2 — "laruso"
 *   Cliente real, no dato de prueba. Compra aceite reesterificado, un producto
 *   que hoy no está en la lista y por eso se carga como "Otro" en el campo
 *   producto. Modelar la lista de productos es un tema aparte, posterior a
 *   esta migración.
 *
 * NOTA 3 — "Otro" en el campo cliente (1 uso)
 *   Aparece una sola vez como CLIENTE, no como producto. Puede ser un error de
 *   carga o un cliente real sin identificar. Queda sin migrar hasta revisar ese
 *   pedido puntual.
 *
 * NOTA 4 — "—" (19 usos)
 *   No es una empresa: es el marcador que usa el portal para los pedidos de
 *   tipo "sin transportista" (Retiro del cliente / Entrega al cliente). Esos
 *   despachos quedan con `transportista_org_id: null`.
 *
 * NOTA 5 — Fender
 *   Existe en el mapa del Apps Script (columna 59 del plan) pero no aparece
 *   como cliente en ninguno de los 215 pedidos. Se crea la organización igual,
 *   para que el ruteo del plan siga funcionando si algún día carga un pedido
 *   propio.
 *
 * NOTA 6 — Direcciones
 *   Confirmado: "Emilio Mitre, 514, Campana" está mal. PAE está en
 *   Av. Emilio Mitre 574, Campana, Buenos Aires. Los 7 registros con 514 se
 *   corrigen a 574 al migrar. También se unifica "AV .ING MITRE, 574, CAMPANA,
 *   BS AS, B2804" con ese mismo domicilio.
 *
 * NOTA 7 — Doble rol
 *   Ninguna organización aparece hoy como cliente y transportista a la vez.
 *   Igual el modelo lo soporta: la organización tendría `es_cliente` y
 *   `es_transportista` los dos en true. Es el caso del cliente que pone su
 *   propio transporte para el traslado del producto.
 */

/* -----------------------------------------------------------------------------
 * CLAVE NORMALIZADA
 *
 * NO es el ID del documento. Los IDs del modelo nuevo son autogenerados y
 * opacos: una clave primaria derivada de un dato obliga a migrar todas las
 * referencias cuando ese dato cambia, y una razón social cambia.
 *
 * Esto es un CAMPO del documento (`clave_normalizada`) que sirve para una sola
 * cosa: decidir si una organización ya existe.
 *
 *     const clave = claveNormalizada('PAN AMERICAN ENERGY');
 *     const q = await db.collection('organizaciones')
 *                       .where('clave_normalizada', '==', clave).get();
 *     if (q.empty) crear(); else actualizar(q.docs[0].ref);
 *
 * Eso da la misma idempotencia que un ID derivado —correr el script dos veces
 * no duplica nada— sin atar la clave primaria al nombre.
 * -------------------------------------------------------------------------- */

/**
 * Reduce un texto a su forma comparable: minúsculas, sin acentos, sin
 * puntuación, con un solo espacio entre palabras.
 *
 *   "PAN AMERICAN ENERGY"   ->  "pan american energy"
 *   "Pan American Energy "  ->  "pan american energy"
 *   "DARUMA AGRO S.R.L."    ->  "daruma agro s r l"
 *
 * Se aplica sobre el nombre CANONICO (el que devuelve `resolverOrganizacion`),
 * no sobre el que está escrito en el pedido: "PAE" y "Pan American Energy" son
 * la misma organización y el mapa ya las unificó antes de llegar acá.
 *
 * Los sufijos societarios NO se sacan, a diferencia de `relevar-clientes.js`.
 * Ahí se sacan para agrupar candidatos y que un humano decida; acá la decisión
 * ya está tomada y sacarlos podría fusionar dos empresas realmente distintas.
 *
 * @param {string} texto Razón social canónica
 * @returns {string}
 */
function claveNormalizada(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Clave normalizada de un domicilio: ciudad + calle + número.
 *
 * Mismo propósito. La usa el alta de domicilios para avisar si ya existe uno
 * parecido antes de crear otro — que es lo único que evita que se repita lo de
 * hoy: 50 direcciones distintas para 34 lugares reales, con la planta de
 * Explora escrita de siete formas.
 *
 * @param {{calle: string, numero: string|null, ciudad: string}} d
 * @returns {string}
 */
function claveDomicilio(d) {
  return claveNormalizada(`${d.ciudad} ${d.calle} ${d.numero || ''}`);
}

/**
 * Normaliza un CUIT a solo dígitos. Devuelve null si no tiene 11.
 *
 * Hoy conviven "20-25505747-3" y "20438430122", y uno de los de
 * `transportistas_portal` arranca con un espacio: " 30-60561644-1".
 *
 * @param {string} cuit
 * @returns {string|null}
 */
function normalizarCuit(cuit) {
  const soloDigitos = String(cuit || '').replace(/\D/g, '');
  return soloDigitos.length === 11 ? soloDigitos : null;
}

/* -----------------------------------------------------------------------------
 * RESOLUCION
 *
 * Hay dos funciones porque los dos lados necesitan comportamientos opuestos
 * frente a un nombre desconocido, y es una diferencia deliberada:
 *
 *   Los SCRIPTS de migración deben FRENAR. Un nombre que no está en el mapa
 *   significa que aparecieron datos después del relevamiento, y migrarlos mal
 *   en lote es peor que no migrarlos.
 *
 *   El PORTAL no puede frenar. Si un coordinador carga un cliente nuevo y
 *   después toca ese pedido, una excepción lo dejaría sin poder guardar — y el
 *   dual-write es una función interna que no debería poder bloquear la
 *   operación diaria. Degrada a `null`, lo marca, y sigue.
 * -------------------------------------------------------------------------- */

/**
 * Devuelve el nombre canónico, o `null` si no debe migrarse.
 * LANZA EXCEPCION si el nombre no está en el mapa. Para los scripts.
 *
 * @param {string} nombre Valor tal como está guardado
 * @param {'cliente'|'transporte'} tipo
 * @returns {string|null}
 */
function resolverOrganizacion(nombre, tipo) {
  const mapa  = tipo === 'cliente' ? CLIENTES : TRANSPORTES;
  const clave = String(nombre || '').trim();

  if (clave === '') return null;
  if (!(clave in mapa)) {
    throw new Error(
      `Nombre de ${tipo} no reconocido: "${clave}". ` +
      `Volver a correr relevar-clientes.js y actualizar el mapa antes de migrar.`
    );
  }
  return mapa[clave];
}

/**
 * Igual que la anterior, pero NUNCA lanza. Para el portal.
 *
 * Distingue tres situaciones que la otra colapsa en dos:
 *
 *   { canonico: 'PRO CROP', conocido: true  }  está en el mapa y migra
 *   { canonico: null,       conocido: true  }  está en el mapa y NO migra
 *                                              (dato de prueba, o el "—" de
 *                                              los pedidos sin transportista)
 *   { canonico: null,       conocido: false }  NO está en el mapa: nombre nuevo
 *
 * El tercero es el que el portal marca con `requiere_revision`. Los dos
 * primeros son situaciones normales y no requieren nada.
 *
 * @param {string} nombre
 * @param {'cliente'|'transporte'} tipo
 * @returns {{canonico: string|null, conocido: boolean, original: string}}
 */
function resolverOrganizacionSuave(nombre, tipo) {
  const mapa  = tipo === 'cliente' ? CLIENTES : TRANSPORTES;
  const clave = String(nombre || '').trim();

  if (clave === '') return { canonico: null, conocido: true, original: '' };
  if (!(clave in mapa)) return { canonico: null, conocido: false, original: clave };
  return { canonico: mapa[clave], conocido: true, original: clave };
}

/**
 * Lista de organizaciones a crear, sin repetir.
 * Incluye Fender aunque no tenga pedidos propios (ver nota 5).
 */
function organizacionesACrear() {
  const clientes = new Set(Object.values(CLIENTES).filter(Boolean));
  clientes.add('FENDER');

  const transportistas = new Set(Object.values(TRANSPORTES).filter(Boolean));

  return { clientes, transportistas };
}

module.exports = {
  CLIENTES,
  TRANSPORTES,
  claveNormalizada,
  claveDomicilio,
  normalizarCuit,
  resolverOrganizacion,
  resolverOrganizacionSuave,
  organizacionesACrear,
};
