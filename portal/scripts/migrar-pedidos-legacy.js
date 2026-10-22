#!/usr/bin/env node
/* =============================================================================
 * migrar-pedidos-legacy.js — v1.2.3 (migración de `pedidos_portal`)
 * =============================================================================
 *
 * SÍNTOMA
 *   Los pedidos de `pedidos_portal` (modelo viejo) no existen en el modelo
 *   nuevo. Al darse de baja las pantallas que los muestran (v1.2.3, prompt 2),
 *   ese histórico quedaría inaccesible.
 *
 * CAUSA RAÍZ
 *   Hasta ahora el criterio era no migrar pedidos (ver el encabezado de
 *   `cargar-entidades.js`: "No hay puente"). Ese criterio cambia en esta
 *   versión. La traducción documento a documento vive en
 *   `src/logica-migracion-legacy.js`; este script solo lee, llama a la lógica y
 *   escribe.
 *
 * ALCANCE
 *   Para cada documento de `pedidos_portal`:
 *     1. Si ya tiene `migrado_a`, se saltea. Si existe un `pedidos` con ese
 *        `legacy_doc_id` pero el viejo no tiene `migrado_a`, quedó a medio
 *        camino (la transacción se confirmó pero faltaron los puntos GPS o la
 *        marca): se completa SOLO lo que falta —los puntos GPS, con ID por
 *        milisegundo, son idempotentes— y después se marca. Nunca se crea un
 *        segundo pedido para el mismo documento viejo.
 *     2. Se traduce con `traducirPedidoLegacy()`.
 *     3. Si no está suspendido, se aplica `armarCierreAdministrativo()` sobre
 *        el árbol traducido (motivo: "Migración del modelo anterior (v1.2.3)"):
 *        todos los migrados quedan cerrados, sin importar la fecha. Si está
 *        suspendido, se aplica `aplicarSuspensionAlArbol()`: el mismo efecto en
 *        datos que `suspenderPedido()` (despachos vivos y viajes abiertos
 *        cancelados, entregas suspendidas), sin avisos, mails ni Apps Script.
 *     4. Se escribe en UNA transacción el pedido, las entregas, los despachos,
 *        los viajes y el historial (el de migración y el del cierre). Usuario de
 *        historial: `script:migrar-pedidos-legacy` / "Migración v1.2.3".
 *     5. Después se escriben los puntos GPS, en lotes de hasta 400.
 *     6. Por último se marca el documento viejo con `migrado_a` y
 *        `migrado_en`. NO se borra ni se modifica ningún otro campo.
 *
 *   FRENA ANTES DE ESCRIBIR NADA si queda cualquier elemento en `sinResolver`
 *   (en cualquier pedido), si un pedido a medio migrar no coincide con lo ya
 *   escrito, o si un pedido no entra en una transacción. Con --ejecutar el
 *   script hace primero la pasada completa de traducción y, si hay pendientes,
 *   para sin escribir.
 *
 *   Lee: `pedidos_portal`, `usuarios_portal`, `organizaciones`, `domicilios`,
 *   `organizacion_domicilios`, `productos`, `usuarios` y `pedidos` (solo los
 *   migrados). Escribe: `pedidos`, `entregas`, `despachos`, `viajes`,
 *   `viajes/{id}/gps_puntos`, `historial` y la marca en `pedidos_portal`.
 *
 * REPORTE (simulación y ejecución)
 *   1. Totales: documentos viejos, ya migrados, a migrar, omitidos (con la
 *      razón), suspendidos y cerrados.
 *   2. Los `sinResolver` AGRUPADOS: cada cliente, transporte, producto y estado
 *      desconocido una sola vez, con cuántos pedidos afecta; cada dirección sin
 *      coincidencia una sola vez, con su organización. Se resuelve todo en una
 *      pasada: agregar entradas a los mapas de `mapa-normalizacion.js` o crear
 *      los domicilios desde el portal.
 *   3. Choferes sin usuario nuevo y pedidos sin `creado_por_uid` (informativos,
 *      no frenan).
 *   4. Aparte, de solo lectura: usuarios activos de `usuarios_portal` sin
 *      documento en `usuarios` (por UID y, si no, por email, como
 *      `buscarViejoPorEmail()` de `sesion.js`). Son los que pierden su pantalla
 *      cuando se den de baja las del modelo viejo.
 *
 * LIMITACIONES CONOCIDAS
 *   - No llama al Apps Script: no manda mails ni toca el Plan de Producción.
 *   - Si se cae el script entre la transacción y la marca, la siguiente
 *     corrida completa lo que falta (caso "a medio camino"). Si entre una
 *     corrida y otra alguien edita a mano los documentos nuevos de ese pedido,
 *     el cruce puede no coincidir y el script frena en vez de adivinar.
 *   - El recorrido GPS de un pedido a medio migrar se reescribe completo
 *     (idempotente, mismo ID por milisegundo).
 *   - Un pedido con más de unas 480 operaciones (≈150 entregas) no entra en una
 *     transacción: el script lo informa y frena.
 *   - Si dos documentos viejos tienen el mismo `id` visible (el número salía de
 *     `Math.random()`), los dos se migran con el mismo `numero`; el reporte los
 *     lista como informativos.
 *
 * CÓMO SE VERIFICA
 *   Simular contra staging y revisar el reporte. Ejecutar en staging y comprobar
 *   que `pedidos` tiene un documento por cada `pedidos_portal` migrado (campo
 *   `legacy_doc_id`), que cada uno tiene `entregas_total == entregas_cumplidas`
 *   (salvo los suspendidos), que `scripts/verificar-contadores.js` no informa
 *   diferencias, y que correr el script una segunda vez no crea nada (todo sale
 *   como "ya migrado").
 *
 * -----------------------------------------------------------------------------
 * v1.2.3 (prompt 3) — EL REPORTE MUESTRA LOS CANDIDATOS DE CADA DOMICILIO
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     La simulación contra producción frenó con 27 direcciones sin resolver, y el
 *     reporte solo decía "no coincide": para decidir a qué domicilio existente
 *     corresponde cada una había que abrir el portal organización por
 *     organización.
 *
 *   CAUSA RAÍZ
 *     El reporte no mostraba contra qué se estaba comparando.
 *
 *   ALCANCE
 *     En la sección 2, debajo de cada dirección sin resolver, se listan los
 *     domicilios que la organización YA tiene vinculados (texto y
 *     `clave_normalizada`, uno por línea; la lista sale de
 *     `domiciliosCandidatos()` de `logica-migracion-legacy.js`). Si no tiene
 *     ninguno, lo dice y manda a crearlo desde Organizaciones → Domicilios. La
 *     clave correcta se copia a `DOMICILIOS_LEGACY` (o, para los "(sin
 *     dirección)", a `DOMICILIOS_LEGACY_POR_PEDIDO`) en
 *     `src/mapa-normalizacion.js`. Para los "(sin dirección)" se listan TODOS
 *     los números de pedido. La sección 3 suma los avisos
 *     `entrega_por_numero_de_despacho` y `volumen_entrega1_calculado`.
 *
 *   LIMITACIONES CONOCIDAS
 *     Los candidatos son los domicilios VINCULADOS: uno que existe pero no está
 *     vinculado a la organización no aparece (y el mapa lo rechazaría igual);
 *     hay que vincularlo desde Organizaciones → Domicilios.
 *
 *   CÓMO SE VERIFICA
 *     Simular contra staging: cada dirección sin resolver trae su lista de
 *     candidatos; al completar el mapa, esa dirección desaparece del reporte.
 *
 * -----------------------------------------------------------------------------
 * v1.2.3 (prompt 4) — USA EL RELEVAMIENTO DE DOMICILIOS
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     La simulación contra producción quedó con 89 pendientes, casi todos
 *     domicilios cuya equivalencia ya estaba relevada y confirmada en el repo.
 *
 *   CAUSA RAÍZ
 *     El script no le pasaba a la lógica el relevamiento (`datos-domicilios.js`,
 *     con las `variantes` exactas de `lugar` del modelo viejo): había que
 *     copiarlo a mano a `DOMICILIOS_LEGACY`.
 *
 *   ALCANCE
 *     El script carga `DOMICILIOS` de `./datos-domicilios` y se lo pasa a
 *     `traducirPedidoLegacy()` dentro de `catalogos.domiciliosRelevados`, así el
 *     módulo de lógica no depende de un archivo de `scripts/`. La sección 3 del
 *     reporte suma los avisos `origen_es_la_planta` (pedidos cuya dirección vieja
 *     era la planta de Explora: `origen_domicilio_id` queda en `null`) y
 *     `cronograma_cubre_el_pedido` (entregas armadas solo del cronograma).
 *
 *   LIMITACIONES CONOCIDAS
 *     Lo que queda sin resolver después del relevamiento se completa a mano en
 *     `src/mapa-normalizacion.js` (`DOMICILIOS_LEGACY`, `DOMICILIOS_LEGACY_POR_PEDIDO`,
 *     `CLIENTES`).
 *
 *   CÓMO SE VERIFICA
 *     Simular contra producción: las direcciones con variante relevada ya no
 *     aparecen en la sección 2.
 *
 * -----------------------------------------------------------------------------
 * COMO CORRERLO
 * -----------------------------------------------------------------------------
 *   cd portal
 *   npm install firebase-admin --no-save
 *
 * Por defecto SIMULA (no escribe nada):
 *
 *   node scripts\migrar-pedidos-legacy.js ^
 *     --proyecto entorno-prueba-explora ^
 *     --credencial C:\Proyectos\credenciales\clave-staging.json
 *
 * Para escribir de verdad, agregar --ejecutar:
 *
 *   node scripts\migrar-pedidos-legacy.js --ejecutar ^
 *     --proyecto explora-portal ^
 *     --credencial C:\Proyectos\credenciales\clave-produccion.json
 *
 * `--proyecto` es obligatorio y tiene que ser `entorno-prueba-explora` o
 * `explora-portal`; además se verifica contra el `project_id` de la
 * credencial. Si no coinciden, el script para.
 * ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const path = require('path');

const {
  traducirPedidoLegacy,
  domiciliosCandidatos,
  arbolParaCierre,
  aplicarCierreAlArbol,
  aplicarSuspensionAlArbol,
} = require('../src/logica-migracion-legacy');
const { armarCierreAdministrativo } = require('../src/logica-cierre-administrativo');
// v1.2.3 (prompt 4): el relevamiento de domicilios (con sus `variantes`).
const { DOMICILIOS: domiciliosRelevados } = require('./datos-domicilios');

const PROYECTOS_VALIDOS = ['entorno-prueba-explora', 'explora-portal'];
const MOTIVO_CIERRE = 'Migración del modelo anterior (v1.2.3)';
const USUARIO = { uid: 'script:migrar-pedidos-legacy', nombre: 'Migración v1.2.3' };
const LOTE_GPS = 400;
const MAX_OPERACIONES_TX = 480;

// 1. Colección de cada clave local de `traducirPedidoLegacy()`.
const COLECCION_DE_CLAVE = {
  pedido: 'pedidos', entrega: 'entregas', despacho: 'despachos', viaje: 'viajes',
};

/* -----------------------------------------------------------------------------
 * Argumentos y conexión
 * -------------------------------------------------------------------------- */

function leerArgumentos() {
  const args = process.argv.slice(2);
  const o = { credencial: null, proyecto: null, ejecutar: false };

  for (let i = 0; i < args.length; i++) {
    if      (args[i] === '--credencial') o.credencial = args[++i];
    else if (args[i] === '--proyecto')   o.proyecto = args[++i];
    else if (args[i] === '--ejecutar')   o.ejecutar = true;
    else if (args[i] === '--simular')    o.ejecutar = false;
  }

  if (!o.credencial || !o.proyecto) {
    console.error('\nFaltan argumentos.\n');
    console.error('Uso:');
    console.error('  node migrar-pedidos-legacy.js [--simular | --ejecutar] \\');
    console.error('    --proyecto <entorno-prueba-explora|explora-portal> \\');
    console.error('    --credencial <ruta.json>\n');
    process.exit(1);
  }
  if (!PROYECTOS_VALIDOS.includes(o.proyecto)) {
    console.error(`\nERROR: --proyecto "${o.proyecto}" no es válido. Usar uno de: ${PROYECTOS_VALIDOS.join(', ')}\n`);
    process.exit(1);
  }
  return o;
}

function conectar(rutaCredencial, proyectoEsperado) {
  const cred = require(path.resolve(rutaCredencial));

  if (cred.project_id !== proyectoEsperado) {
    console.error(`\nERROR: la credencial es del proyecto "${cred.project_id}"`);
    console.error(`       y se esperaba "${proyectoEsperado}".\n`);
    console.error('       PARAR ACA. Revisá las rutas antes de volver a correrlo.\n');
    process.exit(1);
  }

  const app = initializeApp({ credential: cert(cred) }, 'migrar-pedidos-legacy');
  return getFirestore(app);
}

/* -----------------------------------------------------------------------------
 * Lectura
 * -------------------------------------------------------------------------- */

// 1b. El ID del documento va DESPUÉS de los datos: así gana si el documento
//     tiene un campo propio llamado `id` (es el caso de `pedidos_portal`, donde
//     `id` es el número visible "PED-260819-165", no el ID del documento).
async function leerColeccion(db, nombre) {
  const snap = await db.collection(nombre).get();
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

async function leerPorPedido(db, coleccion, pedidoId) {
  const snap = await db.collection(coleccion).where('pedido_id', '==', pedidoId).get();
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

/** `pedidos_portal` aparte: se conserva el ID del documento Y el `id` visible. */
async function leerPedidosViejos(db) {
  const snap = await db.collection('pedidos_portal').get();
  return snap.docs.map(d => ({ docId: d.id, legacy: d.data() }))
    .sort((a, b) => a.docId.localeCompare(b.docId));
}

/* -----------------------------------------------------------------------------
 * IDs
 * -------------------------------------------------------------------------- */

/**
 * 2. `generarId` para un pedido NUEVO: un ID autogenerado por cada clave local,
 *    el mismo cada vez que se pide la misma clave.
 */
function generadorDeIds(db) {
  const usados = new Map();
  return (clave) => {
    if (!usados.has(clave)) {
      const coleccion = COLECCION_DE_CLAVE[clave.split(':')[0]];
      usados.set(clave, db.collection(coleccion).doc().id);
    }
    return usados.get(clave);
  };
}

/**
 * 3. `generarId` para un pedido A MEDIO MIGRAR: devuelve los IDs que ya existen
 *    en Firestore. Cruza el árbol traducido (con claves) contra lo ya escrito:
 *    pedido por `legacy_doc_id`, entregas por `numero`, despachos por
 *    (entrega, `numero`) y viajes por `despacho_id`. Si algo no coincide
 *    devuelve `{ error }` en vez de adivinar.
 */
async function sembrarIdsExistentes(db, arbolConClaves, pedidoExistenteId) {
  const [entregas, despachos, viajes] = await Promise.all([
    leerPorPedido(db, 'entregas', pedidoExistenteId),
    leerPorPedido(db, 'despachos', pedidoExistenteId),
    leerPorPedido(db, 'viajes', pedidoExistenteId),
  ]);

  const ids = new Map([['pedido', pedidoExistenteId]]);

  for (const e of arbolConClaves.entregas) {
    const hallada = entregas.find(x => x.numero === e.datos.numero);
    if (!hallada) return { error: `falta en Firestore la entrega ${e.datos.numero}` };
    ids.set(e.clave, hallada.id);
  }
  for (const d of arbolConClaves.despachos) {
    const entregaId = ids.get(d.datos.entrega_id);
    const hallado = despachos.find(x => x.entrega_id === entregaId && x.numero === d.datos.numero);
    if (!hallado) return { error: `falta en Firestore el despacho ${d.datos.numero}` };
    ids.set(d.clave, hallado.id);
  }
  for (const v of arbolConClaves.viajes) {
    const despachoId = ids.get(v.datos.despacho_id);
    const hallado = viajes.find(x => x.despacho_id === despachoId);
    if (!hallado) return { error: `falta en Firestore el viaje del despacho ${v.despachoClave}` };
    ids.set(v.clave, hallado.id);
  }

  return { generarId: (clave) => ids.get(clave) };
}

/* -----------------------------------------------------------------------------
 * Traducción de un documento (con cierre)
 * -------------------------------------------------------------------------- */

/**
 * 4. Traduce y, si no está suspendido, aplica el cierre administrativo. El
 *    cierre lleva `ahora + 1 ms` para que en la línea de tiempo del pedido
 *    "migrado" vaya antes que "cierre administrativo".
 */
function traducirYCerrar({ legacy, legacyDocId, catalogos, ahora, generarId }) {
  const traducido = traducirPedidoLegacy({
    legacy, legacyDocId, catalogos, ahora, usuario: USUARIO, generarId,
  });
  if (!traducido.ok) return { traducido, arbol: null, cierre: null };

  // Un suspendido NO se cierra: se le aplica el efecto de `suspenderPedido()`
  // (despachos vivos y viajes abiertos cancelados, entregas suspendidas).
  if (traducido.pedido.datos.suspendido) {
    return { traducido, arbol: aplicarSuspensionAlArbol(traducido, { ahora }), cierre: null };
  }

  const cierre = armarCierreAdministrativo({
    ...arbolParaCierre(traducido),
    motivo: MOTIVO_CIERRE,
    ahora: new Date(ahora.getTime() + 1),
    usuario: USUARIO,
  });

  return { traducido, arbol: aplicarCierreAlArbol(traducido, cierre), cierre };
}

function contarOperaciones(arbol) {
  return 1 + arbol.entregas.length + arbol.despachos.length + arbol.viajes.length + arbol.historial.length;
}

/* -----------------------------------------------------------------------------
 * Escritura
 * -------------------------------------------------------------------------- */

class YaMigrado extends Error {}

/** 5. Transacción única: pedido, entregas, despachos, viajes e historial. */
async function escribirArbol(db, arbol, legacyDocId) {
  await db.runTransaction(async (tx) => {
    // Lecturas primero. Última defensa contra un segundo pedido para el mismo
    // documento viejo (por ejemplo, dos corridas simultáneas).
    const previo = await tx.get(db.collection('pedidos').where('legacy_doc_id', '==', legacyDocId).limit(1));
    if (!previo.empty) throw new YaMigrado();

    tx.set(db.collection('pedidos').doc(arbol.pedido.id), arbol.pedido.datos);
    arbol.entregas.forEach(e => tx.set(db.collection('entregas').doc(e.id), e.datos));
    arbol.despachos.forEach(d => tx.set(db.collection('despachos').doc(d.id), d.datos));
    arbol.viajes.forEach(v => tx.set(db.collection('viajes').doc(v.id), v.datos));
    arbol.historial.forEach(h => tx.set(db.collection('historial').doc(), h));
  });
}

/** 6. Puntos GPS, en lotes de hasta 400. `set` con ID = ms: idempotente. */
async function escribirPuntos(db, puntosGps) {
  const operaciones = [];
  for (const grupo of puntosGps) {
    const coleccion = db.collection('viajes').doc(grupo.viajeId).collection('gps_puntos');
    grupo.puntos.forEach(p => operaciones.push({ ref: coleccion.doc(p.id), datos: p.datos }));
  }

  for (let i = 0; i < operaciones.length; i += LOTE_GPS) {
    const lote = db.batch();
    operaciones.slice(i, i + LOTE_GPS).forEach(o => lote.set(o.ref, o.datos));
    await lote.commit();
  }
  return operaciones.length;
}

/** 7. La marca en el documento viejo. NO toca ningún otro campo. */
async function marcarMigrado(db, legacyDocId, pedidoId) {
  await db.collection('pedidos_portal').doc(legacyDocId).update({
    migrado_a: pedidoId,
    migrado_en: new Date(),
  });
}

/* -----------------------------------------------------------------------------
 * Reporte
 * -------------------------------------------------------------------------- */

const ORDEN_TIPOS = ['cliente', 'transporte', 'producto', 'estado_despacho', 'estado_viaje', 'domicilio'];

function agrupar(items, claveDe) {
  const grupos = new Map();
  for (const it of items) {
    const k = claveDe(it);
    if (!grupos.has(k)) grupos.set(k, { ...it, pedidos: new Set() });
    grupos.get(k).pedidos.add(it.pedido);
  }
  return [...grupos.values()];
}

function resumenPedidos(set, todos = false) {
  const lista = [...set];
  if (todos || lista.length <= 4) return lista.join(', ');
  return `${lista.slice(0, 4).join(', ')} y ${lista.length - 4} más`;
}

/** 9. Los domicilios que la organización ya tiene, con su clave, para copiar al mapa. */
function imprimirCandidatos(g, catalogos) {
  const candidatos = g.organizacion_id ? domiciliosCandidatos(g.organizacion_id, catalogos) : [];
  if (candidatos.length === 0) {
    console.log('        La organización no tiene domicilios cargados: crealo desde Organizaciones → Domicilios');
    return;
  }
  console.log('        Domicilios que la organización ya tiene (texto  [clave_normalizada]):');
  candidatos.forEach(c => console.log(`          - ${c.texto}  [${c.clave}]`));
}

function titulo(texto) {
  console.log('');
  console.log('-'.repeat(70));
  console.log(texto);
  console.log('-'.repeat(70));
}

function imprimirReporte(r) {
  titulo('1. TOTALES');
  console.log(`  Documentos en pedidos_portal:   ${r.total}`);
  console.log(`  Ya migrados (migrado_a):        ${r.yaMigrados}`);
  console.log(`  A medio migrar (se completan):  ${r.aMedioCamino.length}`);
  console.log(`  A migrar:                       ${r.aMigrar}`);
  console.log(`  Omitidos:                       ${r.omitidos.length}`);
  agrupar(r.omitidos, o => o.razon).forEach(g => {
    console.log(`      - ${g.razon}: ${g.pedidos.size} pedido(s) (${resumenPedidos(g.pedidos)})`);
  });
  console.log(`  Suspendidos (entre los a migrar): ${r.suspendidos}`);
  console.log(`  Cerrados (entre los a migrar):    ${r.cerrados}`);
  if (r.yaCumplidos) console.log(`  Ya cumplidos de origen (sin cierre): ${r.yaCumplidos}`);

  titulo(`2. SIN RESOLVER (${r.sinResolver.length} ocurrencia(s))`);
  if (r.sinResolver.length === 0) {
    console.log('  Nada. Todo se resuelve contra los catálogos actuales.');
  } else {
    const grupos = agrupar(r.sinResolver, x => `${x.tipo}\u0000${x.valor}\u0000${x.detalle}`);
    const tipos = [...new Set([...ORDEN_TIPOS, ...grupos.map(g => g.tipo)])];
    for (const tipo of tipos) {
      const delTipo = grupos.filter(g => g.tipo === tipo);
      if (delTipo.length === 0) continue;
      console.log(`\n  [${tipo}]`);
      delTipo.forEach(g => {
        // Los "(sin dirección)" se resuelven por pedido: hacen falta TODOS los números.
        const sinDireccion = g.tipo === 'domicilio' && g.valor === '(sin dirección)';
        console.log(`    "${g.valor}"  — afecta a ${g.pedidos.size} pedido(s): ${resumenPedidos(g.pedidos, sinDireccion)}`);
        console.log(`        ${g.detalle}`);
        if (g.tipo === 'domicilio') {
          imprimirCandidatos(g, r.catalogos);
          if (sinDireccion) console.log('        (se resuelve por pedido, en DOMICILIOS_LEGACY_POR_PEDIDO)');
        }
      });
    }
    console.log('\n  Cómo resolverlo: agregar la entrada a CLIENTES/TRANSPORTES, o la clave de');
    console.log('  cada domicilio a DOMICILIOS_LEGACY / DOMICILIOS_LEGACY_POR_PEDIDO, en');
    console.log('  src/mapa-normalizacion.js; o crear el domicilio/organización desde el portal.');
  }

  if (r.inconsistentes.length) {
    titulo('2b. PEDIDOS A MEDIO MIGRAR QUE NO COINCIDEN CON LO YA ESCRITO');
    r.inconsistentes.forEach(x => console.log(`  - ${x.pedido}: ${x.problema}`));
  }
  if (r.demasiadoGrandes.length) {
    titulo('2c. PEDIDOS QUE NO ENTRAN EN UNA TRANSACCIÓN');
    r.demasiadoGrandes.forEach(x => console.log(`  - ${x.pedido}: ${x.operaciones} operaciones (máximo ${MAX_OPERACIONES_TX})`));
  }

  titulo('3. INFORMATIVO (no frena)');
  const choferes = agrupar(r.avisos.filter(a => a.tipo === 'chofer_sin_usuario'), a => a.valor);
  console.log(`  Choferes sin usuario nuevo (${choferes.length}):`);
  choferes.forEach(g => console.log(`    - ${g.valor}  — ${g.pedidos.size} pedido(s)`));
  const sinCreador = agrupar(r.avisos.filter(a => a.tipo === 'creado_por_uid'), a => a.valor);
  console.log(`  Pedidos sin creado_por_uid (${sinCreador.reduce((s, g) => s + g.pedidos.size, 0)}), por email de origen:`);
  sinCreador.forEach(g => console.log(`    - ${g.valor}  — ${g.pedidos.size} pedido(s)`));
  const origenPlanta = r.avisos.filter(a => a.tipo === 'origen_es_la_planta');
  if (origenPlanta.length) {
    console.log(`  Pedidos cuya dirección vieja era la planta de Explora, origen en null (${origenPlanta.length}):`);
    origenPlanta.forEach(a => console.log(`    - ${a.valor}: ${a.detalle}`));
  }
  const cronogramaCompleto = r.avisos.filter(a => a.tipo === 'cronograma_cubre_el_pedido');
  if (cronogramaCompleto.length) {
    console.log(`  Pedidos con el cronograma que ya cubre todo el volumen (${cronogramaCompleto.length}):`);
    cronogramaCompleto.forEach(a => console.log(`    - ${a.valor}: ${a.detalle}`));
  }
  const porNumero = r.avisos.filter(a => a.tipo === 'entrega_por_numero_de_despacho');
  if (porNumero.length) {
    console.log(`  Despachos sin entrega_nro asignados por su número (${porNumero.length}):`);
    porNumero.forEach(a => console.log(`    - ${a.valor}: ${a.detalle}`));
  }
  const volumenCalculado = r.avisos.filter(a => a.tipo === 'volumen_entrega1_calculado');
  if (volumenCalculado.length) {
    console.log(`  Entrega 1 con volumen calculado (${volumenCalculado.length}):`);
    volumenCalculado.forEach(a => console.log(`    - ${a.valor}: ${a.detalle}`));
  }
  const gpsHuerfano = r.avisos.filter(a => a.tipo === 'gps_sin_viaje');
  if (gpsHuerfano.length) {
    console.log(`  Recorridos GPS sin viaje, no migrados (${gpsHuerfano.length}):`);
    gpsHuerfano.forEach(a => console.log(`    - ${a.valor}: ${a.detalle}`));
  }
  if (r.numerosRepetidos.length) {
    console.log(`  Números visibles repetidos entre documentos viejos (${r.numerosRepetidos.length}):`);
    r.numerosRepetidos.forEach(x => console.log(`    - ${x.numero}: ${x.cantidad} documentos`));
  }

  titulo('4. USUARIOS ACTIVOS DE usuarios_portal SIN DOCUMENTO EN usuarios (solo lectura)');
  if (r.usuariosSinNuevo.length === 0) {
    console.log('  Ninguno.');
  } else {
    console.log('  Pierden su pantalla cuando se den de baja las del modelo viejo:\n');
    r.usuariosSinNuevo.forEach(u => console.log(`    - ${u.nombre || '(sin nombre)'}  <${u.email || 'sin email'}>  rol: ${u.rol || '(sin rol)'}`));
  }
}

/** 8. Usuarios activos del modelo viejo sin documento nuevo: por UID y, si no, por email. */
function usuariosSinPerfilNuevo(usuariosViejos, usuariosNuevos) {
  const ids = new Set(usuariosNuevos.map(u => u.id));
  const emails = new Set(usuariosNuevos.map(u => String(u.email || '').trim().toLowerCase()).filter(Boolean));

  return usuariosViejos
    .filter(u => u.estado === 'activo')
    .filter(u => !ids.has(u.id) && !emails.has(String(u.email || '').trim().toLowerCase()))
    .map(u => ({ nombre: u.nombre, email: u.email, rol: u.rol }));
}

/* -----------------------------------------------------------------------------
 * Programa principal
 * -------------------------------------------------------------------------- */

async function main() {
  const o = leerArgumentos();
  const db = conectar(o.credencial, o.proyecto);

  console.log(`\nProyecto: ${o.proyecto}`);
  console.log(`Modo:     ${o.ejecutar ? 'EJECUTAR (escribe)' : 'SIMULAR (no escribe)'}`);
  console.log('\nLeyendo catálogos y pedidos...');

  const [
    viejos, usuariosViejos, organizaciones, domicilios, vinculos, productos, usuarios, migrados,
  ] = await Promise.all([
    leerPedidosViejos(db),
    leerColeccion(db, 'usuarios_portal'),
    leerColeccion(db, 'organizaciones'),
    leerColeccion(db, 'domicilios'),
    leerColeccion(db, 'organizacion_domicilios'),
    leerColeccion(db, 'productos'),
    leerColeccion(db, 'usuarios'),
    db.collection('pedidos').where('origen_carga', '==', 'migracion_legacy').get()
      .then(s => s.docs.map(d => ({ ...d.data(), id: d.id }))),
  ]);

  const catalogos = { organizaciones, domicilios, vinculos, productos, usuarios, domiciliosRelevados };
  const pedidoPorLegacy = new Map(migrados.map(p => [p.legacy_doc_id, p.id]));

  const ahora = new Date();

  const r = {
    total: viejos.length, yaMigrados: 0, aMigrar: 0, aMedioCamino: [], omitidos: [],
    suspendidos: 0, cerrados: 0, yaCumplidos: 0,
    sinResolver: [], avisos: [], inconsistentes: [], demasiadoGrandes: [],
    numerosRepetidos: [], usuariosSinNuevo: usuariosSinPerfilNuevo(usuariosViejos, usuarios),
    catalogos,
  };

  const cuentaNumeros = new Map();
  viejos.forEach(v => cuentaNumeros.set(v.legacy.id, (cuentaNumeros.get(v.legacy.id) || 0) + 1));

  /* ── Pasada 1: traducir todo, sin escribir ──────────────────────────────── */

  const pendientesDeEscribir = [];   // { doc, legacy, existente, sembrado }

  for (const { docId, legacy } of viejos) {
    const doc = { id: docId };
    const etiqueta = `${legacy.id || '(sin id)'} [${docId}]`;

    if (legacy.migrado_a) { r.yaMigrados++; continue; }

    const { traducido, arbol, cierre } = traducirYCerrar({
      legacy, legacyDocId: docId, catalogos, ahora, generarId: (c) => c,
    });

    traducido.sinResolver.forEach(s => r.sinResolver.push({ ...s, pedido: etiqueta }));
    traducido.avisos.forEach(a => r.avisos.push({ ...a, pedido: etiqueta }));

    if (traducido.omitir) { r.omitidos.push({ razon: traducido.omitir.razon, pedido: etiqueta }); continue; }
    if (!traducido.ok) continue;

    const existente = pedidoPorLegacy.get(docId) || null;

    if (existente) {
      const sembrado = await sembrarIdsExistentes(db, traducido, existente);
      if (sembrado.error) r.inconsistentes.push({ pedido: etiqueta, problema: sembrado.error });
      r.aMedioCamino.push(etiqueta);
      pendientesDeEscribir.push({ doc, legacy, existente, sembrado });
      continue;
    }

    r.aMigrar++;
    if (traducido.pedido.datos.suspendido) r.suspendidos++;
    else if (cierre.aplica) r.cerrados++;
    else r.yaCumplidos++;

    const operaciones = contarOperaciones(arbol);
    if (operaciones > MAX_OPERACIONES_TX) r.demasiadoGrandes.push({ pedido: etiqueta, operaciones });

    pendientesDeEscribir.push({ doc, legacy, existente: null, sembrado: null });
  }

  r.numerosRepetidos = [...cuentaNumeros.entries()]
    .filter(([, n]) => n > 1).map(([numero, cantidad]) => ({ numero, cantidad }));

  imprimirReporte(r);

  const hayBloqueos = r.sinResolver.length > 0 || r.inconsistentes.length > 0 || r.demasiadoGrandes.length > 0;

  if (!o.ejecutar) {
    console.log('\nSIMULACIÓN: no se escribió nada. Agregá --ejecutar para migrar.');
    if (hayBloqueos) console.log('OJO: hay pendientes (secciones 2/2b/2c). Con --ejecutar el script frenaría.');
    console.log('');
    return;
  }

  if (hayBloqueos) {
    console.error('\nPARAR: hay elementos sin resolver (secciones 2/2b/2c). No se escribió nada.');
    console.error('Resolvelos y volvé a correr el script.\n');
    process.exit(1);
  }

  /* ── Pasada 2: escribir ─────────────────────────────────────────────────── */

  titulo('ESCRITURA');
  let migradosAhora = 0, completados = 0, puntos = 0, yaEstaban = 0;
  const fallos = [];

  for (const { doc, legacy, existente, sembrado } of pendientesDeEscribir) {
    const etiqueta = `${legacy.id} [${doc.id}]`;
    try {
      if (existente) {
        // A medio camino: solo lo que falta (los puntos GPS) y la marca.
        const { traducido } = traducirYCerrar({
          legacy, legacyDocId: doc.id, catalogos, ahora, generarId: sembrado.generarId,
        });
        puntos += await escribirPuntos(db, traducido.puntosGps);
        await marcarMigrado(db, doc.id, existente);
        completados++;
        console.log(`  completado  ${etiqueta}`);
        continue;
      }

      const { arbol } = traducirYCerrar({
        legacy, legacyDocId: doc.id, catalogos, ahora, generarId: generadorDeIds(db),
      });

      try {
        await escribirArbol(db, arbol, doc.id);
      } catch (err) {
        if (!(err instanceof YaMigrado)) throw err;
        // Otra corrida lo creó entre la lectura y ahora: la próxima pasada lo completa.
        yaEstaban++;
        console.log(`  ya existía  ${etiqueta} (se completa en la próxima corrida)`);
        continue;
      }

      puntos += await escribirPuntos(db, arbol.puntosGps);
      await marcarMigrado(db, doc.id, arbol.pedido.id);
      migradosAhora++;
      console.log(`  migrado     ${etiqueta} -> ${arbol.pedido.id}`);
    } catch (err) {
      fallos.push({ pedido: etiqueta, error: err.message });
      console.error(`  FALLÓ       ${etiqueta}: ${err.message}`);
    }
  }

  console.log('');
  console.log(`Listo. Migrados: ${migradosAhora} · completados: ${completados} · puntos GPS escritos: ${puntos}`
    + ` · ya existían: ${yaEstaban} · fallos: ${fallos.length}.`);
  if (fallos.length) {
    console.log('Los que fallaron quedan sin marcar: volver a correr el script los reintenta.');
    process.exit(1);
  }
  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });
