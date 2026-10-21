#!/usr/bin/env node
/* =============================================================================
 * cerrar-pedidos-anteriores.js — v1.2.3 (cierre administrativo por fecha de corte)
 * =============================================================================
 *
 * SÍNTOMA
 *   Hay pedidos del modelo nuevo que en la realidad ya se cumplieron (todas sus
 *   entregas son anteriores al 15/10/2026) pero en el portal quedaron abiertos:
 *   entregas sin cubrir o programadas, despachos sin cerrar, viajes
 *   `RECIBIDO`/`EN_VIAJE` que nadie finalizó.
 *
 * CAUSA RAÍZ
 *   No existe una acción que cierre un pedido entero, y las que cierran de a un
 *   despacho exigen datos que en estos casos no se tienen (hora de llegada,
 *   confirmación del chofer). La lógica del cierre está en
 *   `src/logica-cierre-administrativo.js`; este script solo lee, decide con
 *   `evaluarCorte()`, llama a `armarCierreAdministrativo()` y escribe.
 *
 * ALCANCE
 *   Candidatos: pedidos con `origen_carga !== 'migracion_legacy'` para los que
 *   `armarCierreAdministrativo()` aplica (no suspendidos, no cumplidos, con al
 *   menos una entrega no suspendida). Los migrados del modelo viejo ya quedaron
 *   cerrados por `migrar-pedidos-legacy.js`.
 *
 *   SE CIERRA un pedido si se cumplen las dos condiciones:
 *     - todas sus entregas no suspendidas tienen `fecha_solicitada < corte`
 *     - todos sus despachos vivos tienen `fecha_carga < corte`
 *   Las fechas son strings `YYYY-MM-DD` y se comparan como string. Una fecha
 *   faltante NO cumple.
 *
 *   Motivo: "Cierre administrativo de pedidos anteriores al <corte> (v1.2.3)".
 *   Usuario de historial: `script:cerrar-pedidos-anteriores` / "Cierre
 *   administrativo v1.2.3". Una transacción por pedido.
 *
 *   SE LISTA APARTE, SIN CERRAR:
 *     - pedidos con alguna entrega o despacho vivo con fecha igual o posterior
 *       al corte (o sin fecha), mostrando qué los deja afuera
 *     - pedidos con todas las entregas suspendidas
 *
 *   NO LLAMA AL APPS SCRIPT. No se mandan mails ni se toca el Plan de
 *   Producción.
 *
 *   Reporte: cuántos se cierran y, por cada uno, el número, el cliente y
 *   cuántos viajes, despachos y entregas cambian; después las dos listas aparte.
 *
 * LIMITACIONES CONOCIDAS
 *   - El script lee todo antes de escribir. Para no pisar un cambio hecho entre
 *     la lectura y la escritura, cada transacción vuelve a leer el pedido y se
 *     saltea ese pedido si cambió `actualizado_en` o quedó suspendido. No relee
 *     las entregas, los despachos ni los viajes: un cambio en solo uno de ellos
 *     que no toque el pedido pasaría desapercibido. Conviene correrlo con el
 *     portal sin uso.
 *   - Los viajes `EN_VIAJE` también se cierran (con `fin_ts: null`): con la
 *     fecha de corte en el pasado se asume que el camión ya llegó.
 *   - Un pedido con más de unas 480 operaciones no entra en una transacción: se
 *     informa y se saltea.
 *   - No hay forma de deshacerlo desde el script: la información previa queda
 *     en el historial (`antes`/`despues` del registro `cierre_administrativo`).
 *
 * CÓMO SE VERIFICA
 *   Simular y revisar las dos listas. Ejecutar en staging y comprobar que cada
 *   pedido cerrado da `entregas_total == entregas_cumplidas`, que
 *   `scripts/verificar-contadores.js` no informa diferencias y que correr el
 *   script otra vez no encuentra candidatos (ya están cumplidos).
 *
 * -----------------------------------------------------------------------------
 * COMO CORRERLO
 * -----------------------------------------------------------------------------
 *   cd portal
 *   npm install firebase-admin --no-save
 *
 * `--corte AAAA-MM-DD` es OBLIGATORIO y no tiene valor por defecto. Se corre
 * con `--corte 2026-10-15`. Por defecto SIMULA (no escribe nada):
 *
 *   node scripts\cerrar-pedidos-anteriores.js ^
 *     --proyecto entorno-prueba-explora ^
 *     --corte 2026-10-15 ^
 *     --credencial C:\Proyectos\credenciales\clave-staging.json
 *
 * Para escribir de verdad, agregar --ejecutar:
 *
 *   node scripts\cerrar-pedidos-anteriores.js --ejecutar ^
 *     --proyecto explora-portal ^
 *     --corte 2026-10-15 ^
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
  armarCierreAdministrativo,
  evaluarCorte,
  NO_APLICA,
} = require('../src/logica-cierre-administrativo');

const PROYECTOS_VALIDOS = ['entorno-prueba-explora', 'explora-portal'];
const USUARIO = { uid: 'script:cerrar-pedidos-anteriores', nombre: 'Cierre administrativo v1.2.3' };
const MAX_OPERACIONES_TX = 480;

/* -----------------------------------------------------------------------------
 * Argumentos y conexión
 * -------------------------------------------------------------------------- */

function esFechaValida(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto || '')) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

function leerArgumentos() {
  const args = process.argv.slice(2);
  const o = { credencial: null, proyecto: null, corte: null, ejecutar: false };

  for (let i = 0; i < args.length; i++) {
    if      (args[i] === '--credencial') o.credencial = args[++i];
    else if (args[i] === '--proyecto')   o.proyecto = args[++i];
    else if (args[i] === '--corte')      o.corte = args[++i];
    else if (args[i] === '--ejecutar')   o.ejecutar = true;
    else if (args[i] === '--simular')    o.ejecutar = false;
  }

  if (!o.credencial || !o.proyecto || !o.corte) {
    console.error('\nFaltan argumentos.\n');
    console.error('Uso:');
    console.error('  node cerrar-pedidos-anteriores.js [--simular | --ejecutar] \\');
    console.error('    --proyecto <entorno-prueba-explora|explora-portal> \\');
    console.error('    --corte <AAAA-MM-DD> \\');
    console.error('    --credencial <ruta.json>\n');
    console.error('  --corte es obligatorio y no tiene valor por defecto (ej.: --corte 2026-10-15).\n');
    process.exit(1);
  }
  if (!PROYECTOS_VALIDOS.includes(o.proyecto)) {
    console.error(`\nERROR: --proyecto "${o.proyecto}" no es válido. Usar uno de: ${PROYECTOS_VALIDOS.join(', ')}\n`);
    process.exit(1);
  }
  if (!esFechaValida(o.corte)) {
    console.error(`\nERROR: --corte "${o.corte}" no es una fecha válida AAAA-MM-DD.\n`);
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

  const app = initializeApp({ credential: cert(cred) }, 'cerrar-pedidos-anteriores');
  return getFirestore(app);
}

/* -----------------------------------------------------------------------------
 * Lectura
 * -------------------------------------------------------------------------- */

// 1. El ID del documento va DESPUÉS de los datos: gana sobre cualquier campo
//    propio llamado `id`.
async function leerColeccion(db, nombre) {
  const snap = await db.collection(nombre).get();
  return snap.docs.map(d => ({ ...d.data(), id: d.id }));
}

function agruparPor(lista, campo) {
  const m = new Map();
  for (const x of lista) {
    if (!m.has(x[campo])) m.set(x[campo], []);
    m.get(x[campo]).push(x);
  }
  return m;
}

function millis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  return null;
}

/* -----------------------------------------------------------------------------
 * Escritura
 * -------------------------------------------------------------------------- */

/**
 * 2. Una transacción por pedido. Relee el pedido y se saltea si cambió o quedó
 *    suspendido desde la lectura.
 * @returns {Promise<{escrito: boolean, motivo?: string}>}
 */
async function escribirCierre(db, pedido, cierre) {
  const refPedido = db.collection('pedidos').doc(pedido.id);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(refPedido);
    if (!snap.exists) return { escrito: false, motivo: 'el pedido ya no existe' };

    const actual = snap.data();
    if (actual.suspendido) return { escrito: false, motivo: 'quedó suspendido desde la lectura' };
    if (millis(actual.actualizado_en) !== millis(pedido.actualizado_en)) {
      return { escrito: false, motivo: 'cambió desde la lectura (actualizado_en distinto)' };
    }

    tx.update(refPedido, cierre.pedido);
    cierre.entregas.forEach(e => tx.update(db.collection('entregas').doc(e.id), e.campos));
    cierre.despachos.forEach(d => tx.update(db.collection('despachos').doc(d.id), d.campos));
    cierre.viajes.forEach(v => tx.update(db.collection('viajes').doc(v.id), v.campos));
    cierre.historial.forEach(h => tx.set(db.collection('historial').doc(), h));

    return { escrito: true };
  });
}

/* -----------------------------------------------------------------------------
 * Reporte
 * -------------------------------------------------------------------------- */

function titulo(texto) {
  console.log('');
  console.log('-'.repeat(70));
  console.log(texto);
  console.log('-'.repeat(70));
}

function fechaDe(b) {
  return b.fecha || '(sin fecha)';
}

async function main() {
  const o = leerArgumentos();
  const db = conectar(o.credencial, o.proyecto);
  const motivo = `Cierre administrativo de pedidos anteriores al ${o.corte} (v1.2.3)`;

  console.log(`\nProyecto: ${o.proyecto}`);
  console.log(`Modo:     ${o.ejecutar ? 'EJECUTAR (escribe)' : 'SIMULAR (no escribe)'}`);
  console.log(`Corte:    ${o.corte} (se cierran los pedidos con TODO anterior a esta fecha)`);
  console.log('\nLeyendo pedidos...');

  const [pedidos, entregas, despachos, viajes, organizaciones] = await Promise.all([
    leerColeccion(db, 'pedidos'),
    leerColeccion(db, 'entregas'),
    leerColeccion(db, 'despachos'),
    leerColeccion(db, 'viajes'),
    leerColeccion(db, 'organizaciones'),
  ]);

  const entregasDe = agruparPor(entregas, 'pedido_id');
  const despachosDe = agruparPor(despachos, 'pedido_id');
  const viajesDe = agruparPor(viajes, 'pedido_id');
  const razonDe = new Map(organizaciones.map(x => [x.id, x.razon_social]));

  const ahora = new Date();
  const aCerrar = [];
  const conFechasPosteriores = [];
  const todasSuspendidas = [];
  const descartados = { migrados: 0, [NO_APLICA.SUSPENDIDO]: 0, [NO_APLICA.YA_CUMPLIDO]: 0 };

  for (const pedido of pedidos) {
    if (pedido.origen_carga === 'migracion_legacy') { descartados.migrados++; continue; }

    const delPedido = {
      entregas: entregasDe.get(pedido.id) || [],
      despachos: despachosDe.get(pedido.id) || [],
      viajes: viajesDe.get(pedido.id) || [],
    };

    const cierre = armarCierreAdministrativo({ pedido, ...delPedido, motivo, ahora, usuario: USUARIO });

    if (!cierre.aplica) {
      if (cierre.codigoNoAplica === NO_APLICA.SIN_ENTREGAS_ACTIVAS) todasSuspendidas.push(pedido);
      else descartados[cierre.codigoNoAplica]++;
      continue;
    }

    const corte = evaluarCorte({ entregas: delPedido.entregas, despachos: delPedido.despachos, corte: o.corte });
    if (corte.cumple) aCerrar.push({ pedido, cierre });
    else conFechasPosteriores.push({ pedido, bloqueos: corte.bloqueos });
  }

  const nombreCliente = (p) => razonDe.get(p.cliente_org_id) || '(cliente sin resolver)';
  const numeroDe = (p) => p.numero || p.id;

  titulo(`SE CIERRAN: ${aCerrar.length} pedido(s)`);
  if (aCerrar.length === 0) console.log('  Ninguno.');
  aCerrar.forEach(({ pedido, cierre }) => {
    console.log(`  ${numeroDe(pedido)} · ${nombreCliente(pedido)}`);
    console.log(`      viajes: ${cierre.viajes.length} · despachos: ${cierre.despachos.length} · entregas: ${cierre.entregas.length}`);
  });

  titulo(`NO SE CIERRAN — con entregas o despachos vivos desde el corte: ${conFechasPosteriores.length}`);
  if (conFechasPosteriores.length === 0) console.log('  Ninguno.');
  conFechasPosteriores.forEach(({ pedido, bloqueos }) => {
    console.log(`  ${numeroDe(pedido)} · ${nombreCliente(pedido)}`);
    bloqueos.forEach(b => {
      console.log(`      ${b.tipo} ${b.numero != null ? b.numero : b.id}: ${fechaDe(b)} — ${b.motivo}`);
    });
  });

  titulo(`NO SE CIERRAN — con todas las entregas suspendidas: ${todasSuspendidas.length}`);
  if (todasSuspendidas.length === 0) console.log('  Ninguno.');
  todasSuspendidas.forEach(p => console.log(`  ${numeroDe(p)} · ${nombreCliente(p)}`));

  console.log('');
  console.log(`Ignorados: ${descartados.migrados} migrados del modelo viejo (ya cerrados) · `
    + `${descartados[NO_APLICA.SUSPENDIDO]} suspendidos · ${descartados[NO_APLICA.YA_CUMPLIDO]} ya cumplidos.`);

  if (!o.ejecutar) {
    console.log('\nSIMULACIÓN: no se escribió nada. Agregá --ejecutar para cerrar.\n');
    return;
  }

  /* ── Escritura ──────────────────────────────────────────────────────────── */

  titulo('ESCRITURA');
  let cerrados = 0;
  const salteados = [];

  for (const { pedido, cierre } of aCerrar) {
    const operaciones = 1 + cierre.entregas.length + cierre.despachos.length + cierre.viajes.length + cierre.historial.length + 1;
    if (operaciones > MAX_OPERACIONES_TX) {
      salteados.push({ pedido: numeroDe(pedido), motivo: `${operaciones} operaciones: no entra en una transacción` });
      continue;
    }
    try {
      const r = await escribirCierre(db, pedido, cierre);
      if (r.escrito) { cerrados++; console.log(`  cerrado   ${numeroDe(pedido)}`); }
      else { salteados.push({ pedido: numeroDe(pedido), motivo: r.motivo }); }
    } catch (err) {
      salteados.push({ pedido: numeroDe(pedido), motivo: `error: ${err.message}` });
    }
  }

  salteados.forEach(s => console.log(`  SALTEADO  ${s.pedido}: ${s.motivo}`));
  console.log(`\nListo. Cerrados: ${cerrados} · salteados: ${salteados.length}.`);
  if (salteados.length) {
    console.log('Los salteados siguen abiertos: volver a correr el script los reintenta.');
    process.exit(1);
  }
  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });
