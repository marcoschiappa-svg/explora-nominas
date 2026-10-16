#!/usr/bin/env node
/* =============================================================================
 * migrar-emails-organizacion.js — v1.2.2 (correos por organización)
 * =============================================================================
 *
 * QUE RESUELVE
 *   `organizaciones.email` (un solo texto) pasa a la colección
 *   `organizacion_emails` (un documento por correo). Este script copia los
 *   correos que ya existen.
 *
 * QUE HACE
 *   Para cada organización con `email`:
 *     1. Parte el texto por coma, punto y coma o espacios.
 *     2. Normaliza (trim + minúsculas), valida el formato (algo@algo.algo) y
 *        deduplica por `clave_normalizada` (`<organizacion_id>|<email>`).
 *     3. Crea un documento por correo en `organizacion_emails`; el primero
 *        queda como principal. Si la organización ya tiene correos en la
 *        colección, ninguno nuevo nace principal.
 *   IDEMPOTENTE: si ya existe un documento con esa `clave_normalizada` en esa
 *   organización, lo saltea. Se puede correr las veces que haga falta.
 *
 * QUE NO HACE
 *   NO borra ni modifica `organizaciones.email`. NO escribe historial (es una
 *   migración de datos, no una acción de una persona). NO toca `telefono`.
 *
 * -----------------------------------------------------------------------------
 * COMO CORRERLO
 * -----------------------------------------------------------------------------
 *   cd portal
 *   npm install firebase-admin --no-save
 *
 * Por defecto SIMULA (no escribe nada):
 *
 *   node scripts\migrar-emails-organizacion.js ^
 *     --proyecto entorno-prueba-explora ^
 *     --credencial C:\Proyectos\credenciales\clave-staging.json
 *
 * Para escribir de verdad, agregar --ejecutar:
 *
 *   node scripts\migrar-emails-organizacion.js --ejecutar ^
 *     --proyecto explora-portal ^
 *     --credencial C:\Proyectos\credenciales\clave-produccion.json
 *
 * `--proyecto` es obligatorio y tiene que ser `entorno-prueba-explora` o
 * `explora-portal`; además se verifica contra el `project_id` de la
 * credencial. Si no coinciden, el script para.
 * ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const path = require('path');

const PROYECTOS_VALIDOS = ['entorno-prueba-explora', 'explora-portal'];
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    console.error('  node migrar-emails-organizacion.js [--simular | --ejecutar] \\');
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

  const app = initializeApp({ credential: cert(cred) }, 'migrar-emails-organizacion');
  return getFirestore(app);
}

/** Parte "a@x.com; b@y.com c@z.com" en trozos no vacíos. */
function partirCorreos(texto) {
  return String(texto || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
}

async function main() {
  const o = leerArgumentos();
  const db = conectar(o.credencial, o.proyecto);

  console.log(`\nProyecto: ${o.proyecto}`);
  console.log(`Modo:     ${o.ejecutar ? 'EJECUTAR (escribe)' : 'SIMULAR (no escribe)'}\n`);

  const orgsSnap = await db.collection('organizaciones').get();
  const emailsSnap = await db.collection('organizacion_emails').get();

  // Claves ya existentes y organizaciones que ya tienen algún correo.
  const clavesExistentes = new Set();
  const orgsConCorreos = new Set();
  emailsSnap.docs.forEach(d => {
    const e = d.data();
    clavesExistentes.add(e.clave_normalizada);
    orgsConCorreos.add(e.organizacion_id);
  });

  const sinCorreo = [];
  const descartados = [];
  const yaExistian = [];
  const aCrear = [];

  for (const d of orgsSnap.docs) {
    const org = d.data();
    const original = org.email;

    if (!original || !String(original).trim()) { sinCorreo.push(org.razon_social || d.id); continue; }

    const vistosEnOrg = new Set();
    let primeroDeLaOrg = !orgsConCorreos.has(d.id);

    for (const trozo of partirCorreos(original)) {
      const email = trozo.toLowerCase();

      if (!FORMATO_EMAIL.test(email)) {
        descartados.push({ organizacion: org.razon_social || d.id, original: trozo });
        continue;
      }

      const clave = `${d.id}|${email}`;
      if (vistosEnOrg.has(clave)) continue;
      vistosEnOrg.add(clave);

      if (clavesExistentes.has(clave)) { yaExistian.push({ organizacion: org.razon_social || d.id, email }); continue; }

      aCrear.push({
        organizacion: org.razon_social || d.id,
        datos: {
          organizacion_id: d.id,
          email,
          alias: null,
          principal: primeroDeLaOrg,
          clave_normalizada: clave,
          creado_por_uid: 'migracion-v1.2.2',
          creado_en: FieldValue.serverTimestamp(),
          actualizado_en: FieldValue.serverTimestamp(),
        },
      });
      primeroDeLaOrg = false;
    }
  }

  console.log(`Organizaciones sin correo (${sinCorreo.length}):`);
  sinCorreo.forEach(n => console.log(`  - ${n}`));

  console.log(`\nCorreos descartados por formato (${descartados.length}):`);
  descartados.forEach(x => console.log(`  - ${x.organizacion}: "${x.original}"`));

  console.log(`\nYa existían, se saltean (${yaExistian.length}):`);
  yaExistian.forEach(x => console.log(`  - ${x.organizacion}: ${x.email}`));

  console.log(`\nDocumentos a crear (${aCrear.length}):`);
  aCrear.forEach(x => console.log(`  - ${x.organizacion}: ${x.datos.email}${x.datos.principal ? ' (principal)' : ''}`));

  if (!o.ejecutar) {
    console.log('\nSIMULACIÓN: no se escribió nada. Agregá --ejecutar para crear los documentos.\n');
    return;
  }

  // Lotes de 400 (el máximo de Firestore es 500 operaciones por lote).
  let creados = 0;
  for (let i = 0; i < aCrear.length; i += 400) {
    const lote = db.batch();
    aCrear.slice(i, i + 400).forEach(x => {
      lote.set(db.collection('organizacion_emails').doc(), x.datos);
    });
    await lote.commit();
    creados += Math.min(400, aCrear.length - i);
  }

  console.log(`\nListo. Creados: ${creados} · ya existían: ${yaExistian.length} · descartados: ${descartados.length}.\n`);
}

main().catch(err => { console.error(err); process.exit(1); });
