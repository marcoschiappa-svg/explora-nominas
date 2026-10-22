#!/usr/bin/env node
/* =============================================================================
 * reparar-entregas-cumplidas.js — v1.2.3 (entregas trabadas en `programada`)
 * =============================================================================
 *
 * SÍNTOMA
 *   Pedidos con `entregas_cumplidas = 1` y su única entrega en `programada`, con
 *   el despacho `ENTREGADO` y el viaje `FINALIZADO` (`verificar-contadores.js`).
 *   La pantalla de Pedidos muestra "Programada" en entregas ya entregadas.
 *
 * CAUSA RAÍZ
 *   `finalizarViaje()` nunca escribía la entrega: todo cierre de viaje la dejaba
 *   trabada. Arreglado hacia adelante en v1.2.3; los cierres desde TrackEx
 *   siguen sin escribirla hasta la próxima build de la app. La lógica de este
 *   script está en `src/logica-reparar-entregas.js`; acá solo se lee, se decide
 *   y se escribe.
 *
 * ALCANCE
 *   a) ENTREGAS TRABADAS. Se repara una entrega que no está `cumplida` ni
 *      `suspendida`, tiene al menos un despacho vivo y todos sus despachos vivos
 *      están `ENTREGADO`. Pasa a `cumplida` (`estado_ts`, `actualizado_en`) con
 *      un historial `recalcular_estado` ("Reparación v1.2.3: el viaje se cerró
 *      sin actualizar la entrega", `derivado: false`). Los contadores del pedido
 *      se RECUENTAN desde las entregas (mismo criterio que
 *      `verificar-contadores.js`), no con increment. Una transacción por pedido.
 *   b) VIAJES ABIERTOS SIN `entrega_id`. Se completa desde su despacho, para
 *      que el chofer, al cerrarlo con la versión nueva, deje la entrega
 *      `cumplida`.
 *   El reporte lista cada pedido y cada entrega reparada, y los viajes
 *   completados o que no se pudieron resolver.
 *
 * LIMITACIONES CONOCIDAS
 *   - Lee todo antes de escribir. Cada transacción vuelve a leer el pedido y las
 *     entregas a reparar, y saltea ese pedido si el pedido cambió
 *     (`actualizado_en`) o alguna entrega ya no está en el estado leído. No
 *     relee los despachos: conviene correrlo con el portal sin uso.
 *   - Un pedido con más de unas 480 operaciones no entra en una transacción: se
 *     informa y se saltea.
 *   - No se deshace desde el script: el estado anterior queda en el historial.
 *   - Es idempotente: correrlo otra vez no encuentra candidatos.
 *
 * CÓMO SE VERIFICA
 *   Simular y comparar con `verificar-contadores.js`. Ejecutar en staging,
 *   volver a correr `verificar-contadores.js` (sin diferencias) y este script
 *   (sin candidatos).
 *
 * -----------------------------------------------------------------------------
 * COMO CORRERLO (Windows)
 * -----------------------------------------------------------------------------
 *   cd portal
 *   npm install firebase-admin --no-save
 *
 * Por defecto SIMULA (no escribe nada):
 *
 *   node scripts\reparar-entregas-cumplidas.js ^
 *     --proyecto entorno-prueba-explora ^
 *     --credencial C:\Proyectos\credenciales\clave-staging.json
 *
 * Para escribir de verdad, agregar --ejecutar:
 *
 *   node scripts\reparar-entregas-cumplidas.js --ejecutar ^
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
  armarReparacionEntregas,
  armarCompletarEntregaId,
} = require('../src/logica-reparar-entregas');

const PROYECTOS_VALIDOS = ['entorno-prueba-explora', 'explora-portal'];
const USUARIO = { uid: 'script:reparar-entregas-cumplidas', nombre: 'Reparación v1.2.3' };
const MAX_OPERACIONES_TX = 480;

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
    console.error('  node reparar-entregas-cumplidas.js [--simular | --ejecutar] \\');
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

  const app = initializeApp({ credential: cert(cred) }, 'reparar-entregas-cumplidas');
  return getFirestore(app);
}

/* -----------------------------------------------------------------------------
 * Lectura
 * -------------------------------------------------------------------------- */

// El ID del documento va DESPUÉS de los datos: gana sobre cualquier campo `id`.
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
 * Una transacción por pedido. Relee el pedido y las entregas a reparar, y
 * saltea si algo cambió desde la lectura.
 * @returns {Promise<{escrito: boolean, motivo?: string}>}
 */
async function escribirReparacion(db, pedido, entregasLeidas, reparacion) {
  const refPedido = db.collection('pedidos').doc(pedido.id);
  const refsEntregas = reparacion.entregas.map(e => db.collection('entregas').doc(e.id));

  return db.runTransaction(async (tx) => {
    const [snapPedido, ...snapsEntregas] = await Promise.all([
      tx.get(refPedido),
      ...refsEntregas.map(r => tx.get(r)),
    ]);

    if (!snapPedido.exists) return { escrito: false, motivo: 'el pedido ya no existe' };
    if (snapPedido.data().suspendido) return { escrito: false, motivo: 'quedó suspendido desde la lectura' };
    if (millis(snapPedido.data().actualizado_en) !== millis(pedido.actualizado_en)) {
      return { escrito: false, motivo: 'cambió desde la lectura (actualizado_en distinto)' };
    }
    for (let i = 0; i < snapsEntregas.length; i++) {
      const leida = entregasLeidas.find(e => e.id === reparacion.entregas[i].id);
      if (!snapsEntregas[i].exists || snapsEntregas[i].data().estado !== leida.estado) {
        return { escrito: false, motivo: `la entrega ${reparacion.entregas[i].id} cambió desde la lectura` };
      }
    }

    tx.update(refPedido, reparacion.pedido);
    reparacion.entregas.forEach((e, i) => tx.update(refsEntregas[i], e.campos));
    reparacion.historial.forEach(h => tx.set(db.collection('historial').doc(), h));

    return { escrito: true };
  });
}

/** Completa `entrega_id` en un viaje, solo si sigue abierto y sin `entrega_id`. */
async function escribirEntregaIdEnViaje(db, item) {
  const ref = db.collection('viajes').doc(item.id);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { escrito: false, motivo: 'el viaje ya no existe' };

    const v = snap.data();
    if (v.entrega_id) return { escrito: false, motivo: 'ya tiene entrega_id' };
    if (v.estado !== 'RECIBIDO' && v.estado !== 'EN_VIAJE') return { escrito: false, motivo: `ya está ${v.estado}` };

    tx.update(ref, { entrega_id: item.entregaId });
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

async function main() {
  const o = leerArgumentos();
  const db = conectar(o.credencial, o.proyecto);

  console.log(`\nProyecto: ${o.proyecto}`);
  console.log(`Modo:     ${o.ejecutar ? 'EJECUTAR (escribe)' : 'SIMULAR (no escribe)'}`);
  console.log('\nLeyendo...');

  const [pedidos, entregas, despachos, viajes] = await Promise.all([
    leerColeccion(db, 'pedidos'),
    leerColeccion(db, 'entregas'),
    leerColeccion(db, 'despachos'),
    leerColeccion(db, 'viajes'),
  ]);

  const entregasDe = agruparPor(entregas, 'pedido_id');
  const despachosDe = agruparPor(despachos, 'pedido_id');
  const ahora = new Date();
  const numeroDe = (p) => p.numero || p.id;

  /* ── a) Entregas trabadas ───────────────────────────────────────────────── */

  const aReparar = [];
  for (const pedido of pedidos) {
    const delPedido = entregasDe.get(pedido.id) || [];
    const reparacion = armarReparacionEntregas({
      pedido,
      entregas: delPedido,
      despachos: despachosDe.get(pedido.id) || [],
      ahora,
      usuario: USUARIO,
    });
    if (reparacion.aplica) aReparar.push({ pedido, entregas: delPedido, reparacion });
  }

  titulo(`ENTREGAS TRABADAS: ${aReparar.length} pedido(s)`);
  if (aReparar.length === 0) console.log('  Ninguno.');
  aReparar.forEach(({ pedido, reparacion }) => {
    console.log(`  ${numeroDe(pedido)}`);
    reparacion.entregas.forEach(e => {
      console.log(`      entrega ${e.numero != null ? e.numero : e.id}: ${e.estadoAnterior} -> cumplida`);
    });
    console.log(`      cumplidas del pedido: ${pedido.entregas_cumplidas || 0} -> ${reparacion.pedido.entregas_cumplidas}`
      + ` · cubiertas: ${pedido.entregas_cubiertas || 0} -> ${reparacion.pedido.entregas_cubiertas}`
      + ` · total: ${pedido.entregas_total || 0} -> ${reparacion.pedido.entregas_total}`);
  });

  /* ── b) Viajes abiertos sin entrega_id ──────────────────────────────────── */

  const { completar, sinResolver } = armarCompletarEntregaId({ viajes, despachos });

  titulo(`VIAJES ABIERTOS SIN entrega_id: ${completar.length} a completar · ${sinResolver.length} sin resolver`);
  if (completar.length === 0 && sinResolver.length === 0) console.log('  Ninguno.');
  completar.forEach(c => console.log(`  viaje ${c.id} (pedido ${c.pedidoId}) -> entrega_id ${c.entregaId}`));
  sinResolver.forEach(s => console.log(`  SIN RESOLVER viaje ${s.id} (pedido ${s.pedidoId}): ${s.motivo}`));

  if (!o.ejecutar) {
    console.log('\nSIMULACIÓN: no se escribió nada. Agregá --ejecutar para reparar.\n');
    return;
  }

  /* ── Escritura ──────────────────────────────────────────────────────────── */

  titulo('ESCRITURA');
  let reparados = 0;
  let viajesCompletados = 0;
  const salteados = [];

  for (const { pedido, entregas: delPedido, reparacion } of aReparar) {
    const operaciones = 1 + reparacion.entregas.length + reparacion.historial.length;
    if (operaciones > MAX_OPERACIONES_TX) {
      salteados.push({ que: numeroDe(pedido), motivo: `${operaciones} operaciones: no entra en una transacción` });
      continue;
    }
    try {
      const r = await escribirReparacion(db, pedido, delPedido, reparacion);
      if (r.escrito) { reparados++; console.log(`  reparado  ${numeroDe(pedido)} (${reparacion.entregas.length} entrega/s)`); }
      else { salteados.push({ que: numeroDe(pedido), motivo: r.motivo }); }
    } catch (err) {
      salteados.push({ que: numeroDe(pedido), motivo: `error: ${err.message}` });
    }
  }

  for (const item of completar) {
    try {
      const r = await escribirEntregaIdEnViaje(db, item);
      if (r.escrito) { viajesCompletados++; console.log(`  viaje     ${item.id} -> ${item.entregaId}`); }
      else { salteados.push({ que: `viaje ${item.id}`, motivo: r.motivo }); }
    } catch (err) {
      salteados.push({ que: `viaje ${item.id}`, motivo: `error: ${err.message}` });
    }
  }

  salteados.forEach(s => console.log(`  SALTEADO  ${s.que}: ${s.motivo}`));
  console.log(`\nListo. Pedidos reparados: ${reparados} · viajes completados: ${viajesCompletados}`
    + ` · salteados: ${salteados.length} · viajes sin resolver: ${sinResolver.length}.`);
  if (salteados.length) {
    console.log('Los salteados siguen igual: volver a correr el script los reintenta.');
    process.exit(1);
  }
  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });
