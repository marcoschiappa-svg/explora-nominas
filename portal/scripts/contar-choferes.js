#!/usr/bin/env node
/* =============================================================================
 * contar-choferes.js — Diagnóstico de solo lectura
 * =============================================================================
 * NO ESCRIBE NADA. Cuenta:
 *   - Documentos en usuarios_portal con rol === 'chofer'
 *   - Cuántos de esos tienen (o no) equivalente en usuarios (modelo nuevo)
 *   - Cuántos de esos tienen (o no) cuenta de Firebase Auth con ese UID
 *   - Choferes que YA están bien migrados en `usuarios`
 *
 * USO (mismo patrón que cargar-entidades.js / copiar-a-staging.js):
 *   cd portal
 *   npm install firebase-admin --no-save
 *   node ../diag/contar-choferes.js --credencial C:\Proyectos\credenciales\clave-produccion.json
 * ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

function arg(nombre) {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const credencialPath = arg('--credencial');
  if (!credencialPath) {
    console.error('Falta --credencial <ruta al json de la cuenta de servicio>');
    process.exit(1);
  }

  const credencial = require(require('path').resolve(credencialPath));
  const app = initializeApp({ credential: cert(credencial) });
  const db = getFirestore(app);
  const auth = getAuth(app);

  console.log(`Proyecto: ${credencial.project_id}`);
  console.log('Leyendo usuarios_portal...');

  const snapViejo = await db.collection('usuarios_portal').get();
  const choferesViejo = snapViejo.docs.filter(d => (d.data().rol || '') === 'chofer');

  console.log(`Total documentos en usuarios_portal: ${snapViejo.size}`);
  console.log(`De esos, con rol === 'chofer': ${choferesViejo.length}`);
  console.log('');

  console.log('Leyendo usuarios (modelo nuevo)...');
  const snapNuevo = await db.collection('usuarios').get();
  const choferesNuevo = snapNuevo.docs.filter(d => (d.data().roles || []).includes('chofer'));
  console.log(`Total documentos en usuarios: ${snapNuevo.size}`);
  console.log(`De esos, con rol chofer: ${choferesNuevo.length}`);
  console.log('');

  const idsNuevo = new Set(snapNuevo.docs.map(d => d.id));

  let migrados = 0, sinMigrarConAuth = 0, sinMigrarSinAuth = 0, sinDni = 0;
  const detalle = [];

  for (const d of choferesViejo) {
    const u = d.data();
    const dni = String(u.dni || '').replace(/\D/g, '');
    if (!dni) { sinDni++; detalle.push(`SIN DNI     | id=${d.id} nombre=${u.nombre || '?'}`); continue; }

    if (idsNuevo.has(d.id)) {
      migrados++;
      continue;
    }

    // ¿Existe cuenta de Auth con este UID (el ID del doc viejo)?
    let tieneAuth = false;
    try {
      await auth.getUser(d.id);
      tieneAuth = true;
    } catch (e) {
      tieneAuth = false;
    }

    if (tieneAuth) {
      sinMigrarConAuth++;
      detalle.push(`FALTA MIGRAR (con Auth) | id=${d.id} dni=${dni} nombre=${u.nombre || '?'} empresa=${u.empresa || '?'}`);
    } else {
      sinMigrarSinAuth++;
      detalle.push(`FALTA MIGRAR (sin Auth) | id=${d.id} dni=${dni} nombre=${u.nombre || '?'} empresa=${u.empresa || '?'}`);
    }
  }

  console.log('--- RESUMEN ---');
  console.log(`Ya migrados a 'usuarios' (mismo id):        ${migrados}`);
  console.log(`Faltan migrar, CON cuenta Auth existente:   ${sinMigrarConAuth}`);
  console.log(`Faltan migrar, SIN cuenta Auth (id no es UID real): ${sinMigrarSinAuth}`);
  console.log(`Sin DNI (no se pueden migrar tal cual):      ${sinDni}`);
  console.log('');
  console.log('--- DETALLE ---');
  detalle.forEach(l => console.log(l));
}

main().catch(err => { console.error(err); process.exit(1); });
