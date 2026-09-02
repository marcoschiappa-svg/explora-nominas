#!/usr/bin/env node
/* =============================================================================
 * migrar-camiones-a-flota.js — Partir los camiones viejos en tractor/acoplado
 * =============================================================================
 *
 * QUE HACE
 *   Cada documento VIEJO de `camiones` (con `patente_tractor` obligatoria y
 *   `patente_semi` opcional, combinadas en una sola unidad) se convierte en:
 *
 *     1. El mismo documento, reescrito como tipo "tractor":
 *        - `patente_tractor` -> `patente`
 *        - se agrega `tipo: 'tractor'`
 *        - se borra el campo `patente_semi` (ya no aplica a un tractor)
 *
 *     2. Si tenía `patente_semi` cargada, un documento NUEVO, tipo
 *        "acoplado", con esa patente, la misma `organizacion_id` y el mismo
 *        `estado` que tenía el original.
 *
 *   Los documentos que YA tienen `tipo` (tractor o acoplado) se saltean --
 *   ya están migrados, correr esto de nuevo no les hace nada.
 *
 * A DIFERENCIA DE relevar-domicilios.js, ESTO SI ESCRIBE
 *   Pero por defecto NO -- sin `--ejecutar` es dry-run: imprime exactamente
 *   qué hoja/crearía, sin tocar Firestore. Correr primero así, revisar la
 *   lista, y recién después agregar `--ejecutar`.
 *
 * -----------------------------------------------------------------------------
 * NO TOCA `despachos` NI `viajes` A PROPOSITO
 * -----------------------------------------------------------------------------
 *   Los despachos ya nominados con el modelo viejo (`camion_id`) quedan tal
 *   cual -- mismo criterio que ya usa el resto del portal: "las patentes se
 *   congelan en el despacho", un registro histórico no se reescribe. Los
 *   despachos NUEVOS (con logica-transportista.js actualizado) usan
 *   `tractor_id`/`acoplado_id`.
 *
 *   OJO: mientras haya despachos viejos todavía NOMINADOS (no entregados)
 *   que referencian un `camion_id`, `Camiones.js` -> `darDeBaja()` no los va
 *   a encontrar (busca por `tractor_id`/`acoplado_id`), así que podría
 *   dejar desactivar una unidad que en realidad sigue en un viaje abierto
 *   con el modelo viejo. Es una ventana chica y transitoria -- conviene no
 *   desactivar unidades justo después de migrar sin revisar a mano si
 *   tienen despachos viejos todavía abiertos.
 *
 * -----------------------------------------------------------------------------
 * COMO CORRERLO
 * -----------------------------------------------------------------------------
 *
 *   cd portal
 *   node scripts/migrar-camiones-a-flota.js --credencial C:\Proyectos\credenciales\clave-staging.json
 *
 *   Eso es dry-run. Revisada la lista, para escribir de verdad:
 *
 *   node scripts/migrar-camiones-a-flota.js --credencial C:\Proyectos\credenciales\clave-staging.json --ejecutar
 *
 *   Contra producción, agregar --produccion (y usar la credencial de
 *   producción, no la de staging):
 *
 *   node scripts/migrar-camiones-a-flota.js --credencial C:\Proyectos\credenciales\clave-produccion.json --produccion --ejecutar
 * ========================================================================== */

const { initializeApp, cert }          = require('firebase-admin/app');
const { getFirestore, FieldValue }     = require('firebase-admin/firestore');
const path                             = require('path');

const PROYECTO_STAGING    = 'entorno-prueba-explora';
const PROYECTO_PRODUCCION = 'explora-portal';

/* -----------------------------------------------------------------------------
 * Argumentos
 * -------------------------------------------------------------------------- */

function leerArgumentos() {
  const args = process.argv.slice(2);
  const opciones = { credencial: null, produccion: false, ejecutar: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--credencial')      opciones.credencial = args[++i];
    else if (args[i] === '--produccion') opciones.produccion = true;
    else if (args[i] === '--ejecutar')   opciones.ejecutar = true;
  }
  if (!opciones.credencial) {
    console.error('\nFalta la credencial.\n');
    console.error('Uso: node scripts/migrar-camiones-a-flota.js --credencial <ruta.json> [--produccion] [--ejecutar]\n');
    process.exit(1);
  }
  return opciones;
}

function normalizarPatente(p) {
  return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
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

  const db = getFirestore(initializeApp({ credential: cert(cred) }, 'migracion-camiones'));

  console.log('');
  console.log('='.repeat(78));
  console.log(opciones.ejecutar ? 'MIGRACION DE CAMIONES — MODO EJECUCION (escribe de verdad)' : 'MIGRACION DE CAMIONES — DRY RUN (no escribe nada)');
  console.log('='.repeat(78));
  console.log(`Proyecto: ${esperado}`);

  const snap = await db.collection('camiones').get();
  console.log(`Documentos leidos en "camiones": ${snap.size}`);
  console.log('');

  const yaMigrados = [];
  const aMigrar = [];

  snap.forEach(doc => {
    const c = { id: doc.id, ...doc.data() };
    if (c.tipo === 'tractor' || c.tipo === 'acoplado') yaMigrados.push(c);
    else aMigrar.push(c);
  });

  console.log(`${yaMigrados.length} ya migrado(s) -- se saltean.`);
  console.log(`${aMigrar.length} para migrar.`);
  console.log('');

  if (aMigrar.length === 0) {
    console.log('Nada para hacer.');
    console.log('');
    console.log('='.repeat(78));
    console.log('FIN.' + (opciones.ejecutar ? '' : ' No se escribió nada.'));
    console.log('='.repeat(78));
    console.log('');
    process.exit(0);
  }

  console.log('='.repeat(78));
  console.log('UNIDADES A MIGRAR');
  console.log('='.repeat(78));

  let batch = db.batch();
  let operacionesEnBatch = 0;
  let acopladosCreados = 0;
  let saltadosSinPatente = 0;

  async function flushSiHaceFalta() {
    // Firestore permite hasta 500 operaciones por batch -- se corta antes,
    // con margen.
    if (operacionesEnBatch >= 400) {
      if (opciones.ejecutar) await batch.commit();
      batch = db.batch();
      operacionesEnBatch = 0;
    }
  }

  for (const c of aMigrar) {
    const tractorPatente = normalizarPatente(c.patente_tractor);
    const semiPatente = normalizarPatente(c.patente_semi);
    const idCorto = c.id.length > 8 ? c.id.slice(0, 8) + '…' : c.id;

    if (!tractorPatente) {
      console.log(`  [${idCorto}]  ⚠ SIN patente_tractor -- se saltea, revisar a mano. (org ${c.organizacion_id})`);
      saltadosSinPatente++;
      continue;
    }

    console.log(`  [${idCorto}]  tractor ${tractorPatente}${semiPatente ? `  +  acoplado ${semiPatente}` : ''}  (org ${c.organizacion_id}, estado ${c.estado || '?'})`);

    // 1. Reescribir el documento existente como tractor.
    const refTractor = db.collection('camiones').doc(c.id);
    const cambiosTractor = {
      tipo: 'tractor',
      patente: tractorPatente,
      patente_tractor: FieldValue.delete(),
      patente_semi: FieldValue.delete(),
      clave_normalizada: `${c.organizacion_id}|tractor|${tractorPatente}`,
    };
    if (opciones.ejecutar) batch.update(refTractor, cambiosTractor);
    operacionesEnBatch++;
    await flushSiHaceFalta();

    // 2. Si tenía semi, crear el acoplado como documento nuevo.
    if (semiPatente) {
      const refAcoplado = db.collection('camiones').doc();
      const datosAcoplado = {
        tipo: 'acoplado',
        patente: semiPatente,
        organizacion_id: c.organizacion_id,
        estado: c.estado || 'activo',
        obs: '',
        clave_normalizada: `${c.organizacion_id}|acoplado|${semiPatente}`,
        creado_por_uid: 'migracion-camiones-a-flota',
        creado_en: FieldValue.serverTimestamp(),
        actualizado_en: FieldValue.serverTimestamp(),
      };
      if (opciones.ejecutar) batch.set(refAcoplado, datosAcoplado);
      operacionesEnBatch++;
      acopladosCreados++;
      await flushSiHaceFalta();
    }
  }

  if (opciones.ejecutar && operacionesEnBatch > 0) {
    await batch.commit();
  }

  console.log('');
  console.log('='.repeat(78));
  console.log(`${aMigrar.length - saltadosSinPatente} tractor(es) migrado(s), ${acopladosCreados} acoplado(s) creado(s).`);
  if (saltadosSinPatente > 0) console.log(`${saltadosSinPatente} documento(s) sin patente_tractor, salteado(s) -- revisar a mano.`);
  console.log(opciones.ejecutar ? 'Se escribió en Firestore.' : 'FIN. No se escribió nada. Correr de nuevo con --ejecutar para aplicar.');
  console.log('='.repeat(78));
  console.log('');

  process.exit(0);
}

principal().catch(err => {
  console.error('\nLa migración falló:');
  console.error(err);
  process.exit(1);
});
