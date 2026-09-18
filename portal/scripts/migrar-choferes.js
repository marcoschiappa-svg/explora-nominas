#!/usr/bin/env node
/* =============================================================================
 * migrar-choferes.js — Migra los choferes de usuarios_portal a usuarios
 * =============================================================================
 *
 * QUE RESUELVE
 *   `cargar-entidades.js` migró admin/coordinador/comercial/transportista pero
 *   dejó afuera a los choferes a propósito, cuando sus datos venían
 *   incompletos. Hoy (sep 2026) ya no es así: los 50 documentos de chofer en
 *   `usuarios_portal` tienen nombre, DNI y empresa completos, y las 50 cuentas
 *   de Firebase Auth correspondientes ya existen (verificado con
 *   contar-choferes.js). Esto es lo que faltaba para que un transportista
 *   pudiera nominarlos: `nominar()` y el desplegable de `MisDespachos.js` leen
 *   choferes SOLO de `usuarios`, nunca de `usuarios_portal`.
 *
 * QUE HACE
 *   Para cada documento de usuarios_portal con rol === 'chofer':
 *     1. Verifica que exista la cuenta de Auth con ese mismo UID (ID del doc).
 *        Si no existe, no se migra — quedaría sin acceso posible.
 *     2. Resuelve organizacion_id:
 *        - Con resolverOrganizacionSuave(empresa, 'transporte'), igual que
 *          cargar-entidades.js, para las empresas reales (RAD, G&G, Hugo Pou).
 *        - Caso especial: 'Transprueba' apunta al ID fijo de organizaciones
 *          que ya existe en producción (MB6elblkwSFCa2Mg297r) — a diferencia
 *          de cargar-entidades.js, acá SÍ se migra: son choferes de prueba
 *          real que hay que poder nominar para probar el sistema.
 *     3. Escribe usuarios/{uid} con roles: ['chofer'], datos_chofer con el
 *        DNI y CUIT normalizado, estado según usuarios_portal.
 *
 * QUE NO HACE
 *   - NO toca usuarios_portal. Solo lee de ahí.
 *   - NO borra ni modifica cuentas de Auth.
 *   - NO migra choferes sin DNI (ninguno hoy, según contar-choferes.js, pero
 *     el chequeo queda por las dudas).
 *
 * SE PUEDE VOLVER A CORRER
 *   set() con merge: true — correrlo dos veces deja el mismo resultado.
 *
 * -----------------------------------------------------------------------------
 * COMO CORRERLO
 * -----------------------------------------------------------------------------
 *
 *   cd portal
 *   npm install firebase-admin --no-save
 *
 * Primero en simulacion, que cuenta lo que haria sin escribir nada:
 *
 *   node ..\migrar-choferes.js --simular ^
 *     --produccion --credencial C:\Proyectos\credenciales\clave-produccion.json
 *
 * Si el resultado tiene sentido, la migracion de verdad (misma linea, sin
 * --simular):
 *
 *   node ..\migrar-choferes.js ^
 *     --produccion --credencial C:\Proyectos\credenciales\clave-produccion.json
 *
 * Contra staging, sacar --produccion y usar la credencial de staging.
 * ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore }        = require('firebase-admin/firestore');
const { getAuth }             = require('firebase-admin/auth');
const path                    = require('path');

const {
  resolverOrganizacionSuave,
  normalizarCuit,
  claveNormalizada,
} = require('../src/mapa-normalizacion');

const PROYECTO_STAGING    = 'entorno-prueba-explora';
const PROYECTO_PRODUCCION = 'explora-portal';

// Caso especial: Transprueba está marcada como `null` (no migrar) en el mapa
// compartido, porque para el resto del modelo es dato de prueba a descartar.
// Acá se migra igual, a pedido explícito: son choferes de prueba real que hay
// que poder nominar. Apunta al documento que YA existe en `organizaciones`.
const ORGANIZACION_ID_TRANSPRUEBA = 'MB6elblkwSFCa2Mg297r';

/* -----------------------------------------------------------------------------
 * Argumentos y conexion — mismo patron que cargar-entidades.js
 * -------------------------------------------------------------------------- */

function leerArgumentos() {
  const args = process.argv.slice(2);
  const o = { credencial: null, produccion: false, simular: false };

  for (let i = 0; i < args.length; i++) {
    if      (args[i] === '--credencial') o.credencial = args[++i];
    else if (args[i] === '--produccion') o.produccion = true;
    else if (args[i] === '--simular')    o.simular    = true;
  }

  if (!o.credencial) {
    console.error('\nFalta la credencial.\n');
    console.error('Uso:');
    console.error('  node migrar-choferes.js [--simular] [--produccion] \\');
    console.error('    --credencial <ruta.json>\n');
    process.exit(1);
  }

  return o;
}

function conectar(rutaCredencial, esProduccion) {
  const esperado = esProduccion ? PROYECTO_PRODUCCION : PROYECTO_STAGING;
  const cred = require(path.resolve(rutaCredencial));

  if (cred.project_id !== esperado) {
    console.error(`\nERROR: la credencial es del proyecto "${cred.project_id}"`);
    console.error(`       y se esperaba "${esperado}".\n`);
    console.error('       PARAR ACA. Revisá las rutas antes de volver a correrlo.\n');
    process.exit(1);
  }

  const app = initializeApp({ credential: cert(cred) }, 'migrar-choferes');
  return { db: getFirestore(app), auth: getAuth(app), proyecto: esperado };
}

/* -----------------------------------------------------------------------------
 * Auxiliares — copiados de cargar-entidades.js para mantener la misma forma
 * de documento en `usuarios`
 * -------------------------------------------------------------------------- */

function armarTelefonos(u) {
  const salida = [];
  for (let n = 1; n <= 3; n++) {
    const prefijo = String(u[`prefijo_${n}`] || '').trim();
    const numero  = String(u[`numero_${n}`]  || '').trim();
    if (numero) salida.push(prefijo ? `(${prefijo}) ${numero}` : numero);
  }
  return salida;
}

function armarEmails(fuente, emailLogin) {
  const vistos = new Set([String(emailLogin || '').trim().toLowerCase()]);
  const salida = [];

  for (let n = 1; n <= 3; n++) {
    const email = String(fuente[`email_${n}`] || '').trim();
    if (!email) continue;
    const clave = email.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(email);
  }

  return salida;
}

/* -----------------------------------------------------------------------------
 * Migracion
 * -------------------------------------------------------------------------- */

async function migrarChoferes(db, auth, simular) {
  console.log('-'.repeat(70));
  console.log('MIGRACION DE CHOFERES: usuarios_portal -> usuarios');
  console.log('-'.repeat(70));

  const snapViejo = await db.collection('usuarios_portal').get();
  const choferes = snapViejo.docs.filter(d => (d.data().rol || '') === 'chofer');

  console.log(`Choferes encontrados en usuarios_portal: ${choferes.length}`);
  console.log('');

  let migrados = 0, sinAuth = 0, sinDni = 0, sinOrganizacion = 0;
  const informe = [];

  for (const docViejo of choferes) {
    const u = docViejo.data();
    const uid = docViejo.id;
    const dni = String(u.dni || '').replace(/\D/g, '');

    if (!dni) {
      informe.push(`SIN DNI: ${u.nombre || uid} — no se migra`);
      sinDni++;
      continue;
    }

    // El ID del documento tiene que ser el UID de Auth real, o el chofer
    // migrado quedaría sin acceso posible (las reglas resuelven todo con
    // get(/usuarios/{request.auth.uid})).
    try {
      await auth.getUser(uid);
    } catch (err) {
      informe.push(`SIN CUENTA DE AUTH: ${u.nombre || uid} (dni ${dni}) — no se migra`);
      sinAuth++;
      continue;
    }

    // Organizacion: caso especial Transprueba, o resolucion normal contra el
    // mapa compartido con cargar-entidades.js.
    let organizacionId = null;
    const empresa = String(u.empresa || '').trim();

    if (empresa === 'Transprueba') {
      organizacionId = ORGANIZACION_ID_TRANSPRUEBA;
    } else {
      const r = resolverOrganizacionSuave(empresa, 'transporte');
      if (r.canonico) {
        // Busca la organizacion por su clave_normalizada, usando la MISMA
        // función que crearOActualizar() en cargar-entidades.js — no una
        // normalización propia. claveNormalizada() saca cualquier carácter
        // que no sea letra o número (el '&' de "G&G" incluido), por eso
        // "TRANSPORTE G&G" y "transporte g g" coinciden.
        const claveNorm = claveNormalizada(r.canonico);
        const snapOrg = await db.collection('organizaciones')
          .where('clave_normalizada', '==', claveNorm)
          .limit(1)
          .get();
        if (!snapOrg.empty) organizacionId = snapOrg.docs[0].id;
      }
    }

    if (!organizacionId) {
      informe.push(`SIN ORGANIZACION: ${u.nombre || uid} (dni ${dni}) empresa "${empresa}" — no se migra`);
      sinOrganizacion++;
      continue;
    }

    const emailLogin = String(u.email || u.email_1 || '').trim();
    const telefonos = armarTelefonos(u);
    const emailsExtra = armarEmails(u, emailLogin);

    const datos = {
      nombre: String(u.nombre || '').trim(),
      email: emailLogin,
      roles: ['chofer'],
      estado: u.estado === 'inactivo' ? 'inactivo' : 'activo',
      organizacion_id: organizacionId,
      telefonos,
      emails_extra: emailsExtra,
      datos_chofer: {
        dni,
        cuit: normalizarCuit(u.cuit_chofer) || '',
        licencia_venc: null,
      },
      creado_por_uid: 'script:migrar-choferes',
      actualizado_en: new Date(),
    };

    console.log(`${simular ? '[SIMULAR] ' : ''}${u.nombre} (dni ${dni}) -> organizacion ${organizacionId}`);

    if (!simular) {
      const ref = db.collection('usuarios').doc(uid);
      const previo = await ref.get();
      if (!previo.exists) datos.creado_en = new Date();
      await ref.set(datos, { merge: true });
    }

    migrados++;
  }

  console.log('');
  console.log('--- RESUMEN ---');
  console.log(`Migrados:                 ${migrados}`);
  console.log(`Sin cuenta de Auth:       ${sinAuth}`);
  console.log(`Sin DNI:                  ${sinDni}`);
  console.log(`Sin organizacion resuelta: ${sinOrganizacion}`);
  if (informe.length) {
    console.log('');
    console.log('--- DETALLE DE LOS NO MIGRADOS ---');
    informe.forEach(l => console.log(l));
  }
  if (simular) {
    console.log('');
    console.log('Esto fue una SIMULACION. No se escribió nada.');
    console.log('Si el resumen tiene sentido, correlo de nuevo sin --simular.');
  }
}

async function main() {
  const o = leerArgumentos();
  const { db, auth, proyecto } = conectar(o.credencial, o.produccion);
  console.log(`Proyecto: ${proyecto}${o.simular ? ' (SIMULACION)' : ''}`);
  console.log('');
  await migrarChoferes(db, auth, o.simular);
}

main().catch(err => { console.error(err); process.exit(1); });
