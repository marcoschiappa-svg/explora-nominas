#!/usr/bin/env node
/* =============================================================================
 * cargar-registro-maestro.js — v1.2.0 (RF-09b)
 * =============================================================================
 *
 * SÍNTOMA
 *   Las rutas del tarifario viven en `portal/rutas.lista[]`: un array de
 *   texto libre, indexado por POSICION, con `proveedor`, `destino` y
 *   `producto` escritos a mano. Las tarifas modificadas (`portal/mods`), los
 *   pendientes (`portal/pendientes`) y el historial (`portal/historial`)
 *   cuelgan de ese mismo indice.
 *
 * CAUSA RAIZ
 *   El tarifario nacio en v1.0 (junio 2026) como un modulo autonomo, antes de
 *   que existiera el registro maestro de `NuevoTarifario.js`.
 *
 * ALCANCE
 *   Carga inicial del registro maestro de `NuevoTarifario.js`: convierte cada
 *   entrada de `portal/rutas.lista[idx]` en un documento de la coleccion
 *   `rutas`, con `tipo: 'parametro'` (maestra), `estado: 'activo'`, la
 *   tarifa vigente que realmente rige hoy y `legacy: { idx, proveedor,
 *   destino, producto }` con el texto original.
 *
 *   NO TOCA `portal/*`: los cuatro documentos del Tarifario legacy quedan
 *   intactos — ese código los sigue leyendo y escribiendo tal cual siempre
 *   lo hizo.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-09b) — COPIA DIRECTA, SIN RESOLVER CONTRA OTRAS COLECCIONES
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     La versión anterior de este script (entonces con `--mapa`) intentaba
 *     resolver `proveedor`/`destino`/`producto` contra `organizaciones`,
 *     `domicilios` y `productos` — con similitud, candidatos y un archivo
 *     `mapa-rutas-pendientes.json` para completar a mano lo que no
 *     resolvía solo. Eso asumía que una ruta de tarifario es un vínculo a
 *     esas colecciones. No lo es: ver el bloque "RF-09b" del encabezado de
 *     `logica-tarifario.js`.
 *
 *   CAUSA RAÍZ
 *     El tarifario resuelve por ruta ESTANDARIZADA (texto convenido), no
 *     por domicilio operativo ni por producto del catálogo de pedidos.
 *
 *   ALCANCE
 *     El script pasa a ser una COPIA DIRECTA: `origen = proveedor.trim()`,
 *     `destino = destino.trim()`, `producto = producto.trim()`, tal como
 *     están en `portal/rutas.lista[idx]`. Se eliminan la resolución contra
 *     organizaciones/domicilios/productos, los candidatos, la similitud,
 *     `--mapa` y la generación de `mapa-rutas-pendientes.json`. Se agrega
 *     `--omitir <idx>[,<idx>…]` para que Ivan decida, ruta por ruta, cuál
 *     de dos rutas legacy en colisión de `clave_normalizada` se migra —
 *     NINGUNA de las dos se migra hasta que se omita alguna con esa opción.
 *     Se agrega el chequeo de datos previos: si `rutas` ya tiene documentos
 *     con la forma anterior (`origen_domicilio_id` presente, o sin
 *     `origen`), el script los LISTA y ABORTA sin tocar nada — ni siquiera
 *     las rutas que sí podría migrar sin problema —, porque decidir qué
 *     hacer con esos documentos es de Ivan, no del script.
 *
 *   LIMITACIONES CONOCIDAS
 *     · La copia es literal: si `proveedor`/`destino`/`producto` tienen una
 *       errata en el Tarifario legacy, esa errata se migra tal cual —ya no
 *       hay una resolución contra un maestro que la hubiera "corregido"
 *       por casualidad. Es un cambio de comportamiento deliberado: antes se
 *       podía enmascarar una errata resolviendo contra la organización
 *       correcta; ahora la estandarización es un problema del REGISTRO
 *       MAESTRO del tarifario (los `<datalist>` de `NuevoTarifario.js`), no
 *       de esta carga inicial.
 *     · Sigue asumiendo que `proveedor` es el ORIGEN del viaje y `destino`
 *       el DESTINO — se muestra en el reporte para confirmar antes de
 *       `--ejecutar`, igual que antes.
 *
 *   CÓMO SE VERIFICA
 *     `node scripts/cargar-registro-maestro.js` sin argumentos muestra el
 *     uso y sale sin conectarse a Firebase. El simulacro (sin `--ejecutar`)
 *     reporta todo sin escribir nada, incluidas las colisiones con sus
 *     tarifas. Con `rutas` ya poblada en la forma anterior, el script
 *     aborta y lista esos documentos sin tocarlos.
 *
 * -----------------------------------------------------------------------------
 * CAMPOS NUEVOS — `tarifa_actualizada_en` / `tarifa_actualizada_por`
 * -----------------------------------------------------------------------------
 *   Si la ruta tiene historial migrado, se toman del cambio MAS RECIENTE
 *   (`portal/historial.data[]` guarda las entradas nuevas primero —
 *   `unshift()`, en la pantalla vieja— así que es la primera que le
 *   corresponde).
 *
 *   El historial viejo NUNCA guardó quién hizo cada cambio — sus entradas no
 *   tienen `usuario_uid` ni `usuario_nombre`, ver `Tarifario.js`. No hay
 *   autor que "tomar". Se resuelve dejando `tarifa_actualizada_por: { uid:
 *   null, nombre: 'Autor no registrado (historial migrado)' }` en vez de
 *   inventar una identidad. La FECHA sí se toma: `h.fecha` es un texto
 *   `DD/M/AAAA` (`toLocaleDateString('es-AR')`), un formato fijo y
 *   determinístico —a diferencia de `proveedor`/`destino`, que son texto
 *   libre—, así que se parsea a una fecha real (medianoche local) en vez de
 *   copiarse como texto.
 *
 *   Sin historial: `tarifa_actualizada_en` es la fecha de esta carga
 *   (`serverTimestamp()`) y `tarifa_actualizada_por` es
 *   `{ uid: AUTOR, nombre: 'carga-inicial' }`.
 *
 * LIMITACIONES CONOCIDAS
 *   · Si dos rutas legacy dan la misma `clave_normalizada`, NINGUNA de las
 *     dos se migra hasta que `--omitir` decida cuál se descarta. Se
 *     reportan con sus tarifas para poder compararlas.
 *   · El historial se asigna por `proveedor` + `destino` (el mismo texto de
 *     la ruta legacy, normalizado). Las entradas que no matchean con
 *     ninguna ruta migrada —o que matchean con más de una— se listan y no
 *     se migran. Las entradas globales (la linea "Tarifario completo" que
 *     escribia una restauracion) nunca van a matchear: es lo esperado.
 *   · `portal/pendientes` NO se migra. Un pendiente es un cambio sin
 *     aprobar: si quedó alguno, se aprueba o se descarta desde el Tarifario
 *     legacy ANTES de correr esta carga. Migrarlo sería congelar una
 *     decisión que nadie tomó.
 *   · Ningún autor de `tarifa_actualizada_por` migrado desde historial es
 *     verificable (ver "CAMPOS NUEVOS" arriba) — es una limitación de los
 *     datos de origen, no de este script.
 *   · La escritura va en `writeBatch` de a 400 operaciones. No es una sola
 *     transaccion: si falla a mitad, lo escrito queda escrito. Por eso el
 *     script es IDEMPOTENTE (saltea las rutas que ya tienen su `legacy.idx`)
 *     y se puede volver a correr.
 *
 * CÓMO SE VERIFICA
 *   `node scripts/cargar-registro-maestro.js` sin argumentos muestra el uso
 *   y sale sin conectarse a Firebase. El simulacro (sin `--ejecutar`) reporta
 *   todo sin escribir nada; después de `--ejecutar`, el registro vigente de
 *   `NuevoTarifario.js` muestra las mismas tarifas que el Tarifario legacy,
 *   con su fecha de actualización y su historial.
 *
 * -----------------------------------------------------------------------------
 * COMO CORRERLO
 * -----------------------------------------------------------------------------
 *
 *   cd portal
 *
 *   1. Simulacro (NO escribe nada):
 *
 *      node scripts/cargar-registro-maestro.js --credencial C:\Proyectos\credenciales\clave-staging.json
 *
 *   2. Si el reporte muestra colisiones, decidir cuál idx se omite y volver
 *      a simular hasta que no queden colisiones sin resolver:
 *
 *      node scripts/cargar-registro-maestro.js --credencial ... --omitir 12,27
 *
 *   3. Recien ahi, escribir:
 *
 *      node scripts/cargar-registro-maestro.js --credencial ... --omitir 12,27 --ejecutar
 *
 *   Contra produccion, agregar --produccion (y usar la credencial de
 *   produccion, no la de staging).
 * ========================================================================== */

const { initializeApp, cert }      = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const path                         = require('path');

const { claveNormalizada } = require('../src/mapa-normalizacion');

const PROYECTO_STAGING    = 'entorno-prueba-explora';
const PROYECTO_PRODUCCION = 'explora-portal';

/** Quien figura como autor de lo que escribe este script. */
const AUTOR = 'migracion-rf09';

/** Margen contra el tope de 500 operaciones por batch de Firestore. */
const TOPE_BATCH = 400;

const USO = `
Uso:
  node scripts/cargar-registro-maestro.js --credencial <ruta.json> [opciones]

Opciones:
  --credencial <ruta.json>  Credencial de servicio de Firebase. OBLIGATORIA.
  --produccion              Apunta a "${PROYECTO_PRODUCCION}". Sin esto, a "${PROYECTO_STAGING}".
  --omitir <idx>[,<idx>…]   Idx (posicion en portal/rutas.lista) que NO se migran.
                            Usalo para resolver una colision de clave_normalizada.
  --ejecutar                Escribe de verdad. SIN esto es simulacro y no escribe nada.
  --help                    Muestra esta ayuda.

Que hace:
  Carga inicial del registro maestro de NuevoTarifario.js: convierte
  'portal/rutas.lista[]' en documentos de la coleccion 'rutas' (tipo:
  'parametro', maestra), copiando 'proveedor'/'destino'/'producto' TAL CUAL
  a 'origen'/'destino'/'producto' (texto, sin vinculo a otra coleccion), con
  la tarifa vigente que rige hoy segun 'portal/mods' y
  'tarifa_actualizada_en'/'tarifa_actualizada_por', y repartiendo
  'portal/historial.data[]' en 'rutas/{id}/tarifas'.

  NO toca 'portal/*': el Tarifario legacy sigue leyendo y escribiendo esos
  documentos tal cual siempre lo hizo.
  Es idempotente: una ruta que ya tiene su 'legacy.idx' se saltea.
  Si 'rutas' ya tiene documentos con la forma anterior (con
  'origen_domicilio_id', o sin 'origen'), el script los lista y ABORTA sin
  tocar nada.

Secuencia recomendada:
  1) --credencial ...                     (simulacro)
  2) revisar duplicados/colisiones en el reporte
  3) --credencial ... --omitir <idx,...>  (si hizo falta, simulacro de nuevo)
  4) --credencial ... [--omitir ...] --ejecutar
`;

/* -----------------------------------------------------------------------------
 * Argumentos
 *
 * `--help` y la falta de credencial se resuelven ANTES de tocar la red: el
 * script tiene que poder mostrar su uso sin conectarse a ningun proyecto.
 * -------------------------------------------------------------------------- */

function leerArgumentos() {
  const args = process.argv.slice(2);
  const opciones = { credencial: null, produccion: false, ejecutar: false, omitir: new Set() };

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(USO);
    process.exit(0);
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--credencial')      opciones.credencial = args[++i];
    else if (args[i] === '--produccion') opciones.produccion = true;
    else if (args[i] === '--ejecutar')   opciones.ejecutar = true;
    else if (args[i] === '--omitir') {
      const valor = args[++i] || '';
      for (const parte of valor.split(',')) {
        const n = Number(parte.trim());
        if (parte.trim() !== '' && !isNaN(n)) opciones.omitir.add(n);
      }
    } else {
      console.error(`\nOpcion desconocida: "${args[i]}".`);
      console.error(USO);
      process.exit(1);
    }
  }

  if (!opciones.credencial) {
    console.error('\nFalta la credencial.');
    console.error(USO);
    process.exit(1);
  }

  return opciones;
}

/* -----------------------------------------------------------------------------
 * Tarifa vigente
 * -------------------------------------------------------------------------- */

/**
 * La tarifa que RIGE HOY para la ruta `idx`. Replica exactamente
 * `getTarifaVigente()` de la pantalla vieja: `mods[idx]` puede ser un numero
 * suelto o un objeto con `tarifa_vigente`; si no hay nada, vale la de la
 * propia ruta.
 */
function tarifaVigenteDe(idx, ruta, mods) {
  const m = mods[idx];
  if (m !== undefined && m !== null) {
    if (typeof m === 'object') {
      if (m.tarifa_vigente != null) return Number(m.tarifa_vigente);
    } else {
      return Number(m);
    }
  }
  return Number(ruta.tarifa_vigente);
}

/**
 * `tarifa_actualizada_en`/`tarifa_actualizada_por` de una ruta migrada (ver
 * el bloque de encabezado "CAMPOS NUEVOS"). `ultimoCambio` es la entrada MAS
 * RECIENTE del historial ya asignado a esta ruta (o `undefined` si no tiene).
 *
 * La fecha vieja es texto `DD/M/AAAA` (`toLocaleDateString('es-AR')`): se
 * parsea a medianoche LOCAL. Si por algún motivo no matchea ese formato, se
 * cae al comportamiento "sin historial" en vez de escribir una fecha
 * inventada.
 */
function fechaEsArAMedianoche(texto) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(texto || '').trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const fecha = new Date(Number(y), Number(mo) - 1, Number(d));
  return isNaN(fecha.getTime()) ? null : fecha;
}

function datosActualizacion(ultimoCambio) {
  if (ultimoCambio) {
    const fecha = fechaEsArAMedianoche(ultimoCambio.fecha);
    if (fecha) {
      return {
        tarifa_actualizada_en: Timestamp.fromDate(fecha),
        tarifa_actualizada_por: { uid: null, nombre: 'Autor no registrado (historial migrado)' },
      };
    }
  }
  return {
    tarifa_actualizada_en: FieldValue.serverTimestamp(),
    tarifa_actualizada_por: { uid: AUTOR, nombre: 'carga-inicial' },
  };
}

/* -----------------------------------------------------------------------------
 * Clave normalizada de una ruta — misma fórmula que `claveRuta()` de
 * `logica-tarifario.js`, reescrita acá porque ese archivo es un módulo ES y
 * este script es CommonJS.
 * -------------------------------------------------------------------------- */

function claveDeRuta(origen, destino, producto) {
  return `${claveNormalizada(origen)}|${claveNormalizada(destino)}|${claveNormalizada(producto)}`;
}

/* -----------------------------------------------------------------------------
 * Programa principal
 * -------------------------------------------------------------------------- */

async function principal() {
  const opciones = leerArgumentos();
  const esperado = opciones.produccion ? PROYECTO_PRODUCCION : PROYECTO_STAGING;

  const cred = require(path.resolve(opciones.credencial));
  if (cred.project_id !== esperado) {
    console.error(`\nERROR: credencial de "${cred.project_id}", se esperaba "${esperado}".\n`);
    process.exit(1);
  }

  const db = getFirestore(initializeApp({ credential: cert(cred) }, 'cargar-registro-maestro'));

  console.log('');
  console.log('='.repeat(78));
  console.log(opciones.ejecutar
    ? 'CARGA INICIAL DEL REGISTRO MAESTRO (RF-09) — MODO EJECUCION (escribe de verdad)'
    : 'CARGA INICIAL DEL REGISTRO MAESTRO (RF-09) — SIMULACRO (no escribe nada)');
  console.log('='.repeat(78));
  console.log(`Proyecto: ${esperado}`);
  if (opciones.omitir.size > 0) console.log(`Omitidos por --omitir: ${Array.from(opciones.omitir).sort((a, b) => a - b).join(', ')}`);
  console.log('');

  /* ── 1. Lectura ───────────────────────────────────────────────────────── */

  const [rutasDoc, modsDoc, histDoc, rutasSnap] = await Promise.all([
    db.collection('portal').doc('rutas').get(),
    db.collection('portal').doc('mods').get(),
    db.collection('portal').doc('historial').get(),
    db.collection('rutas').get(),
  ]);

  const lista = (rutasDoc.exists && rutasDoc.data().lista) || [];
  if (lista.length === 0) {
    console.error('ABORTA: `portal/rutas` esta vacio o no existe. No hay nada que migrar.');
    console.error('Si el tarifario ya se migro, esto es lo esperado: no hace falta correr nada.');
    process.exit(1);
  }

  const mods = (modsDoc.exists && modsDoc.data().data) || {};
  const historialViejo = (histDoc.exists && histDoc.data().data) || [];
  const rutasExistentes = rutasSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  console.log(`portal/rutas.lista        ${lista.length} ruta(s)`);
  console.log(`portal/mods.data          ${Object.keys(mods).length} tarifa(s) modificada(s)`);
  console.log(`portal/historial.data     ${historialViejo.length} cambio(s)`);
  console.log(`rutas (ya existentes)     ${rutasExistentes.length}`);
  console.log('');

  /* ── 2. Datos previos en la forma anterior: ABORTA sin tocar nada ────── */

  // (RF-09b) Un documento "de la forma anterior" es uno que todavía tiene
  // `origen_domicilio_id` (el vínculo que se retira) o que no tiene `origen`
  // como string (ni siquiera llegó a tener el campo nuevo). Ivan decide qué
  // hacer con esos documentos — este script no los toca ni migra nada más
  // mientras existan, para no dejar la coleccion en un estado mixto.
  const formaVieja = rutasExistentes.filter(
    r => r.origen_domicilio_id != null || typeof r.origen !== 'string'
  );
  if (formaVieja.length > 0) {
    console.log('='.repeat(78));
    console.log(`ABORTA — HAY ${formaVieja.length} DOCUMENTO(S) EN 'rutas' CON LA FORMA ANTERIOR`);
    console.log('='.repeat(78));
    console.log('Tienen `origen_domicilio_id` o no tienen `origen` como texto. No se tocan.');
    console.log('Decidí qué hacer con ellos (migrarlos a mano o borrarlos) antes de correr');
    console.log('este script de nuevo.');
    console.log('');
    for (const r of formaVieja) {
      const detalleLegacy = r.legacy ? ` · legacy idx ${r.legacy.idx}` : '';
      console.log(`  rutas/${r.id}${detalleLegacy}`);
      if (r.origen_domicilio_id != null) console.log(`      origen_domicilio_id: ${r.origen_domicilio_id}`);
      if (typeof r.origen !== 'string') console.log(`      origen: ${JSON.stringify(r.origen)}`);
    }
    console.log('');
    process.exit(1);
  }

  /* ── 3. Idempotencia por legacy.idx ───────────────────────────────────── */

  const yaMigradasPorIdx = new Map(
    rutasExistentes
      .filter(r => r.legacy && r.legacy.idx != null)
      .map(r => [Number(r.legacy.idx), r])
  );

  /* ── 4. Una pasada por cada ruta: copia directa ───────────────────────── */

  const candidatas = [];    // listas para escribir, antes de chequear colisiones
  const salteadas = [];     // ya migradas (idempotencia)
  const omitidas = [];      // pedidas por --omitir

  for (let idx = 0; idx < lista.length; idx++) {
    const ruta = lista[idx];
    const legacy = {
      idx,
      proveedor: ruta.proveedor || '',
      destino: ruta.destino || '',
      producto: ruta.producto || '',
    };

    if (yaMigradasPorIdx.has(idx)) {
      salteadas.push({ idx, legacy, rutaId: yaMigradasPorIdx.get(idx).id });
      continue;
    }

    if (opciones.omitir.has(idx)) {
      omitidas.push({ idx, legacy });
      continue;
    }

    const origen = legacy.proveedor.trim();
    const destino = legacy.destino.trim();
    const producto = legacy.producto.trim();

    candidatas.push({
      idx,
      legacy,
      origen,
      destino,
      producto,
      clave_normalizada: claveDeRuta(origen, destino, producto),
      km: Number(ruta.km) || 0,
      tarifa_base: ruta.tarifa_base != null ? Number(ruta.tarifa_base) : null,
      tarifa_vigente: tarifaVigenteDe(idx, ruta, mods),
      catac_ref: ruta.catac != null ? Number(ruta.catac) : null,
      categoria: ruta.categoria || 'General',
    });
  }

  /* ── 5. Colisiones de clave_normalizada ───────────────────────────────── */

  // Una clave ya ocupada por una ruta migrada antes (bajo otro idx) tambien
  // es colision: no debería pasar en una carga normal, pero se cubre igual.
  const clavesOcupadas = new Map(
    rutasExistentes
      .filter(r => r.estado !== 'inactivo' && r.clave_normalizada)
      .map(r => [r.clave_normalizada, r])
  );

  const porClave = new Map();
  for (const r of candidatas) {
    if (!porClave.has(r.clave_normalizada)) porClave.set(r.clave_normalizada, []);
    porClave.get(r.clave_normalizada).push(r);
  }

  const colisiones = [];
  const aEscribir = [];
  for (const [clave, grupo] of porClave) {
    const yaOcupada = clavesOcupadas.get(clave);
    if (grupo.length > 1 || yaOcupada) {
      colisiones.push({ clave, grupo, yaOcupada: yaOcupada || null });
      continue;
    }
    aEscribir.push(grupo[0]);
  }

  /* ── 6. Historial ─────────────────────────────────────────────────────── */

  /** `proveedor|destino` normalizado -> la ruta a la que pertenece. */
  const rutaPorTextoLegacy = new Map();
  for (const r of aEscribir) {
    const k = `${claveNormalizada(r.legacy.proveedor)}|${claveNormalizada(r.legacy.destino)}`;
    // Si dos rutas comparten proveedor+destino (distinto producto), el
    // historial viejo no distingue cual es: se marca ambigua y no se asigna.
    if (rutaPorTextoLegacy.has(k)) rutaPorTextoLegacy.set(k, 'ambigua');
    else rutaPorTextoLegacy.set(k, r);
  }

  const historialAsignado = new Map();   // idx de la ruta -> [entradas]
  const historialSinAsignar = [];

  for (const h of historialViejo) {
    const k = `${claveNormalizada(h.proveedor)}|${claveNormalizada(h.destino)}`;
    const destinoRuta = rutaPorTextoLegacy.get(k);
    if (!destinoRuta || destinoRuta === 'ambigua') {
      historialSinAsignar.push({
        proveedor: h.proveedor, destino: h.destino, fecha: h.fecha,
        motivo: destinoRuta === 'ambigua' ? 'varias rutas con ese proveedor+destino' : 'ninguna ruta migrada con ese proveedor+destino',
      });
      continue;
    }
    if (!historialAsignado.has(destinoRuta.idx)) historialAsignado.set(destinoRuta.idx, []);
    historialAsignado.get(destinoRuta.idx).push(h);
  }

  /* ── 7. Reporte ──────────────────────────────────────────────────────── */

  console.log('='.repeat(78));
  console.log('SUPOSICION A CONFIRMAR');
  console.log('='.repeat(78));
  console.log('Se asume que `proveedor` es el ORIGEN del viaje y `destino` el DESTINO.');
  console.log('Revisá estas primeras filas: si estan invertidas, PARAR y avisar.');
  console.log('');
  for (const r of aEscribir.slice(0, 5)) {
    console.log(`  [idx ${String(r.idx).padStart(2)}]  ORIGEN: ${r.origen}`);
    console.log(`            DESTINO: ${r.destino}`);
    console.log(`            ${r.producto} · ${r.km} km · $${r.tarifa_vigente}`);
    console.log('');
  }

  if (aEscribir.length > 0) {
    console.log('='.repeat(78));
    console.log('RUTAS QUE SE MIGRAN');
    console.log('='.repeat(78));
    console.log('idx  origen                              destino                             producto        tarifa vigente');
    for (const r of aEscribir) {
      const nHist = (historialAsignado.get(r.idx) || []).length;
      console.log(
        `[${String(r.idx).padStart(2)}]  ${r.origen.padEnd(36).slice(0, 36)}  ${r.destino.padEnd(34).slice(0, 34)}  ${r.producto.padEnd(14).slice(0, 14)}  $${r.tarifa_vigente}` +
        `${r.tarifa_base != null ? ` (base $${r.tarifa_base})` : ''} · ${r.km} km · ${r.categoria}` +
        `${nHist > 0 ? ` · ${nHist} cambio(s) de historial` : ''}`
      );
    }
    console.log('');
  }

  if (salteadas.length > 0) {
    console.log('='.repeat(78));
    console.log(`YA MIGRADAS — SE SALTEAN (${salteadas.length})`);
    console.log('='.repeat(78));
    for (const s of salteadas) {
      console.log(`  [idx ${String(s.idx).padStart(2)}] ${s.legacy.proveedor} -> ${s.legacy.destino}  (rutas/${s.rutaId})`);
    }
    console.log('');
  }

  if (omitidas.length > 0) {
    console.log('='.repeat(78));
    console.log(`OMITIDAS POR --omitir (${omitidas.length})`);
    console.log('='.repeat(78));
    for (const o of omitidas) {
      console.log(`  [idx ${String(o.idx).padStart(2)}] ${o.legacy.proveedor} -> ${o.legacy.destino} · ${o.legacy.producto}`);
    }
    console.log('');
  }

  if (colisiones.length > 0) {
    console.log('='.repeat(78));
    console.log(`DUPLICADOS — NINGUNA DE ESTAS SE MIGRA (${colisiones.length} clave(s))`);
    console.log('='.repeat(78));
    console.log('Dos o mas rutas legacy dan la misma clave_normalizada (mismo origen+destino+');
    console.log('producto, normalizado). Decidí cuál se queda y omití las otras con --omitir');
    console.log('<idx>, o corregí el texto en el Tarifario legacy antes de volver a correr.');
    console.log('');
    for (const c of colisiones) {
      console.log(`  clave ${c.clave}`);
      if (c.yaOcupada) {
        console.log(`      YA EXISTE en rutas/${c.yaOcupada.id}` +
                    `${c.yaOcupada.legacy ? ` (legacy idx ${c.yaOcupada.legacy.idx})` : ''} · tarifa $${c.yaOcupada.tarifa_vigente}`);
      }
      for (const r of c.grupo) {
        console.log(`      [idx ${String(r.idx).padStart(2)}] ${r.origen} -> ${r.destino} · ${r.producto} · tarifa $${r.tarifa_vigente}`);
      }
      console.log('');
    }
  }

  console.log('='.repeat(78));
  console.log('HISTORIAL DE TARIFAS');
  console.log('='.repeat(78));
  let totalHist = 0;
  for (const entradas of historialAsignado.values()) totalHist += entradas.length;
  console.log(`  ${totalHist} entrada(s) asignada(s) a ${historialAsignado.size} ruta(s).`);
  console.log(`  ${historialSinAsignar.length} entrada(s) SIN asignar (no se migran).`);
  if (historialSinAsignar.length > 0) {
    const porMotivo = new Map();
    for (const h of historialSinAsignar) {
      const k = `${h.proveedor} -> ${h.destino} (${h.motivo})`;
      porMotivo.set(k, (porMotivo.get(k) || 0) + 1);
    }
    for (const [k, n] of porMotivo) console.log(`      ${n}x  ${k}`);
  }
  console.log('');

  /* ── 8. Escritura ───────────────────────────────────────────────────── */

  if (!opciones.ejecutar) {
    console.log('='.repeat(78));
    console.log('RESUMEN DEL SIMULACRO');
    console.log('='.repeat(78));
    console.log(`  Rutas a cargar            : ${aEscribir.length}`);
    console.log(`  Ya migradas (salteadas)   : ${salteadas.length}`);
    console.log(`  Omitidas por --omitir     : ${omitidas.length}`);
    console.log(`  En duplicado              : ${colisiones.reduce((n, c) => n + c.grupo.length, 0)}`);
    console.log(`  Historial migrado         : ${totalHist}`);
    console.log(`  Historial sin asignar     : ${historialSinAsignar.length}`);
    console.log('');
    console.log(`  TOTAL de portal/rutas.lista: ${lista.length}`);
    console.log('');
    console.log('FIN. No se escribio nada. Correr de nuevo con --ejecutar para aplicar.');
    console.log('='.repeat(78));
    console.log('');
    process.exit(0);
  }

  if (aEscribir.length === 0) {
    console.log('Nada nuevo para escribir.');
    console.log('='.repeat(78));
    console.log('');
    process.exit(0);
  }

  console.log('='.repeat(78));
  console.log('ESCRIBIENDO');
  console.log('='.repeat(78));

  let batch = db.batch();
  let enBatch = 0;
  let rutasEscritas = 0;
  let cambiosEscritos = 0;

  async function flushSiHaceFalta() {
    if (enBatch >= TOPE_BATCH) {
      await batch.commit();
      batch = db.batch();
      enBatch = 0;
    }
  }

  for (const r of aEscribir) {
    // ID opaco y autogenerado, mismo criterio que el resto del modelo nuevo:
    // una clave primaria derivada de un dato obliga a migrar las referencias
    // cuando ese dato cambia.
    const ref = db.collection('rutas').doc();
    const historialRuta = historialAsignado.get(r.idx) || [];
    // El historial viejo se recorre newest-first (ver `datosActualizacion`),
    // así que la primera entrada asignada es el cambio MAS RECIENTE.
    const { tarifa_actualizada_en, tarifa_actualizada_por } = datosActualizacion(historialRuta[0]);

    batch.set(ref, {
      tipo: 'parametro',
      origen: r.origen,
      destino: r.destino,
      producto: r.producto,
      clave_normalizada: r.clave_normalizada,
      km: r.km,
      tarifa_base: r.tarifa_base,
      tarifa_vigente: r.tarifa_vigente,
      catac_ref: r.catac_ref,
      categoria: r.categoria,
      pendiente: null,
      estado: 'activo',
      tarifa_actualizada_en,
      tarifa_actualizada_por,
      legacy: r.legacy,
      // Auditoria equivalente a la que agrega `crear()` de `datos.js`.
      creado_por_uid: AUTOR,
      creado_en: FieldValue.serverTimestamp(),
      actualizado_en: FieldValue.serverTimestamp(),
    });
    enBatch++;
    rutasEscritas++;
    await flushSiHaceFalta();

    for (const h of historialRuta) {
      batch.set(ref.collection('tarifas').doc(), {
        tarifa_anterior: h.tarifaAnterior != null ? Number(h.tarifaAnterior) : null,
        tarifa_nueva: h.tarifaNueva != null ? Number(h.tarifaNueva) : null,
        variacion: h.variacion != null ? Number(h.variacion) : null,
        just: h.just || '',
        ref: h.ref || 'Otro',
        adjunto: h.adjunto || null,
        origen: 'migracion',
        usuario_uid: AUTOR,
        usuario_nombre: 'Migracion RF-09',
        // La fecha del registro viejo era un texto local ("23/4/2026"), no un
        // instante: se conserva tal cual en `fecha_legacy` y `ts` marca cuando
        // se migro. Inventar un Timestamp a partir de ese texto seria fabricar
        // una precision que el dato nunca tuvo.
        fecha_legacy: h.fecha || null,
        ts: FieldValue.serverTimestamp(),
      });
      enBatch++;
      cambiosEscritos++;
      await flushSiHaceFalta();
    }

    console.log(`  rutas/${ref.id}  <-  [idx ${r.idx}] ${r.origen} -> ${r.destino}`);
  }

  if (enBatch > 0) await batch.commit();

  console.log('');
  console.log('='.repeat(78));
  console.log(`${rutasEscritas} ruta(s) creada(s), ${cambiosEscritos} cambio(s) de tarifa migrado(s).`);
  if (colisiones.length > 0) console.log(`${colisiones.reduce((n, c) => n + c.grupo.length, 0)} ruta(s) en duplicado: no se escribieron.`);
  if (historialSinAsignar.length > 0) console.log(`${historialSinAsignar.length} entrada(s) de historial sin asignar: no se migraron.`);
  console.log('Se escribio en Firestore. `portal/*` quedo intacto.');
  console.log('='.repeat(78));
  console.log('');

  process.exit(0);
}

principal().catch(err => {
  console.error('\nLa carga fallo:');
  console.error(err);
  process.exit(1);
});
