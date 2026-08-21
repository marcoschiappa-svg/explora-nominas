#!/usr/bin/env node
/* =============================================================================
 * copiar-a-staging.js — Copia los datos de produccion al entorno de prueba
 * =============================================================================
 *
 * QUE HACE
 *   Lee las colecciones de `explora-portal` (la base REAL) y las escribe en
 *   `entorno-prueba-explora` (la base de prueba), conservando los IDs de cada
 *   documento. Conservar los IDs es imprescindible: el ID de un documento de
 *   `usuarios_portal` ES el UID de Firebase Auth, y las cuentas de Auth ya se
 *   importaron con sus UIDs originales. Si los IDs no coincidieran, nadie
 *   podria loguearse en el entorno de prueba.
 *
 * QUE NO HACE
 *   - No escribe NADA en produccion. Abre esa conexion en modo lectura y solo
 *     la usa para leer. Es la unica garantia que importa de este script.
 *   - No copia `app_logs`: son registros de diagnostico de la app en
 *     produccion, no sirven para probar nada y pueden ser miles.
 *   - No copia las cuentas de Firebase Auth. Eso ya se hizo aparte con
 *     `firebase auth:export` / `auth:import`.
 *
 * SE PUEDE VOLVER A CORRER
 *   Cada documento se escribe con `set()`, que pisa el anterior si ya existe.
 *   Correrlo dos veces deja el mismo resultado que correrlo una.
 *   OJO: no borra de staging lo que ya no existe en produccion. Si un pedido
 *   se elimino en produccion, en staging va a seguir estando.
 *
 * -----------------------------------------------------------------------------
 * ANTES DE CORRERLO — hay que conseguir dos archivos de credenciales
 * -----------------------------------------------------------------------------
 *
 * Para cada uno de los dos proyectos, en la consola de Firebase:
 *   Configuracion del proyecto (engranaje) -> Cuentas de servicio
 *   -> "Generar nueva clave privada" -> se descarga un archivo .json
 *
 * Guardalos FUERA de la carpeta del repositorio. Por ejemplo:
 *   C:\Proyectos\credenciales\clave-produccion.json
 *   C:\Proyectos\credenciales\clave-staging.json
 *
 * ESTOS ARCHIVOS SON SECRETOS DE VERDAD. A diferencia de la configuracion
 * publica que esta en src/firebase.js, estas claves dan acceso total a la base
 * de datos ignorando todas las reglas de seguridad. No van al repositorio, no
 * se comparten por mail ni por chat.
 *
 * -----------------------------------------------------------------------------
 * COMO CORRERLO
 * -----------------------------------------------------------------------------
 *
 *   cd portal
 *   npm install firebase-admin --no-save
 *
 * Primero en modo simulacion, que solo cuenta lo que habria copiado:
 *
 *   node scripts/copiar-a-staging.js --simular ^
 *     --produccion C:\Proyectos\credenciales\clave-produccion.json ^
 *     --staging    C:\Proyectos\credenciales\clave-staging.json
 *
 * Si el resultado tiene sentido, la copia de verdad (misma linea, sin
 * --simular):
 *
 *   node scripts/copiar-a-staging.js ^
 *     --produccion C:\Proyectos\credenciales\clave-produccion.json ^
 *     --staging    C:\Proyectos\credenciales\clave-staging.json
 *
 * (El simbolo ^ al final de cada linea es la forma de partir un comando largo
 * en varias lineas en PowerShell. Si preferis, escribilo todo en una sola.)
 * ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore }        = require('firebase-admin/firestore');
const path                    = require('path');

/* -----------------------------------------------------------------------------
 * Configuracion
 * -------------------------------------------------------------------------- */

/** Colecciones a copiar. `app_logs` queda deliberadamente afuera. */
const COLECCIONES = [
  'usuarios_portal',
  'pedidos_portal',
  'transportistas_portal',
  'portal',
  'catac_versiones',
  'tarifario_versiones',
];

/** IDs de proyecto esperados. Se verifican antes de escribir nada. */
const PROYECTO_PRODUCCION = 'explora-portal';
const PROYECTO_STAGING    = 'entorno-prueba-explora';

/** Firestore acepta como maximo 500 operaciones por lote. */
const TAM_LOTE = 400;

/* -----------------------------------------------------------------------------
 * Lectura de argumentos
 * -------------------------------------------------------------------------- */

function leerArgumentos() {
  const args = process.argv.slice(2);
  const opciones = { simular: false, produccion: null, staging: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--simular') {
      opciones.simular = true;
    } else if (args[i] === '--produccion') {
      opciones.produccion = args[++i];
    } else if (args[i] === '--staging') {
      opciones.staging = args[++i];
    }
  }

  if (!opciones.produccion || !opciones.staging) {
    console.error('\nFaltan argumentos.\n');
    console.error('Uso:');
    console.error('  node scripts/copiar-a-staging.js [--simular] \\');
    console.error('    --produccion <ruta-clave-produccion.json> \\');
    console.error('    --staging    <ruta-clave-staging.json>\n');
    process.exit(1);
  }

  return opciones;
}

/* -----------------------------------------------------------------------------
 * Conexiones
 * -------------------------------------------------------------------------- */

/**
 * Abre las dos conexiones y verifica que cada clave corresponda al proyecto
 * que decimos que es.
 *
 * Esta verificacion es el resguardo principal del script: si alguien pasa las
 * dos claves al reves, la copia iria de la base de prueba hacia la REAL y
 * pisaria datos de produccion. Antes que confiar en el nombre del archivo, se
 * comprueba el `project_id` que viene adentro de cada credencial.
 */
function conectar(rutaProduccion, rutaStaging) {
  const credProduccion = require(path.resolve(rutaProduccion));
  const credStaging    = require(path.resolve(rutaStaging));

  if (credProduccion.project_id !== PROYECTO_PRODUCCION) {
    console.error(`\nERROR: la clave de produccion es del proyecto "${credProduccion.project_id}",`);
    console.error(`       y se esperaba "${PROYECTO_PRODUCCION}". Revisá las rutas.\n`);
    process.exit(1);
  }

  if (credStaging.project_id !== PROYECTO_STAGING) {
    console.error(`\nERROR: la clave de staging es del proyecto "${credStaging.project_id}",`);
    console.error(`       y se esperaba "${PROYECTO_STAGING}". Revisá las rutas.\n`);
    console.error('       PARAR ACA. Si esa clave fuera la de produccion, la copia');
    console.error('       escribiria sobre la base REAL.\n');
    process.exit(1);
  }

  const appProduccion = initializeApp(
    { credential: cert(credProduccion) },
    'produccion'
  );
  const appStaging = initializeApp(
    { credential: cert(credStaging) },
    'staging'
  );

  return {
    dbProduccion: getFirestore(appProduccion),
    dbStaging:    getFirestore(appStaging),
  };
}

/* -----------------------------------------------------------------------------
 * Copia
 * -------------------------------------------------------------------------- */

/**
 * Copia una coleccion entera, con sus subcolecciones.
 *
 * Se hace recursivo porque Firestore permite colgar subcolecciones de
 * cualquier documento, y no se ven al listar la coleccion padre. Si no se
 * recorrieran, la copia quedaria incompleta sin ningun aviso.
 *
 * @param {FirebaseFirestore.Firestore} dbOrigen
 * @param {FirebaseFirestore.Firestore} dbDestino
 * @param {string} ruta Ruta de la coleccion, ej. 'pedidos_portal' o
 *   'portal/config/historial'.
 * @param {boolean} simular Si es true, cuenta pero no escribe.
 * @param {number} nivel Profundidad, solo para indentar la salida.
 * @returns {Promise<number>} Cantidad de documentos copiados, incluyendo los
 *   de las subcolecciones.
 */
async function copiarColeccion(dbOrigen, dbDestino, ruta, simular, nivel = 0) {
  const sangria = '  '.repeat(nivel + 1);
  const snapshot = await dbOrigen.collection(ruta).get();

  if (snapshot.empty) {
    console.log(`${sangria}${ruta}: vacia`);
    return 0;
  }

  let copiados = 0;
  let lote = dbDestino.batch();
  let enLote = 0;

  for (const documento of snapshot.docs) {
    if (!simular) {
      lote.set(dbDestino.collection(ruta).doc(documento.id), documento.data());
      enLote++;

      if (enLote >= TAM_LOTE) {
        await lote.commit();
        lote = dbDestino.batch();
        enLote = 0;
      }
    }
    copiados++;
  }

  if (!simular && enLote > 0) {
    await lote.commit();
  }

  console.log(`${sangria}${ruta}: ${copiados} documento(s)`);

  // Subcolecciones, documento por documento.
  let copiadosSub = 0;
  for (const documento of snapshot.docs) {
    const subcolecciones = await documento.ref.listCollections();
    for (const sub of subcolecciones) {
      copiadosSub += await copiarColeccion(
        dbOrigen, dbDestino,
        `${ruta}/${documento.id}/${sub.id}`,
        simular, nivel + 1
      );
    }
  }

  return copiados + copiadosSub;
}

/* -----------------------------------------------------------------------------
 * Programa principal
 * -------------------------------------------------------------------------- */

async function principal() {
  const opciones = leerArgumentos();

  console.log('');
  console.log('='.repeat(70));
  console.log(opciones.simular
    ? 'SIMULACION — no se va a escribir nada'
    : 'COPIA REAL — se va a escribir en el entorno de prueba');
  console.log('='.repeat(70));
  console.log(`Origen:  ${PROYECTO_PRODUCCION}  (solo lectura)`);
  console.log(`Destino: ${PROYECTO_STAGING}`);
  console.log('');

  const { dbProduccion, dbStaging } = conectar(opciones.produccion, opciones.staging);

  let total = 0;
  const inicio = Date.now();

  for (const coleccion of COLECCIONES) {
    total += await copiarColeccion(dbProduccion, dbStaging, coleccion, opciones.simular);
  }

  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

  console.log('');
  console.log('-'.repeat(70));
  console.log(opciones.simular
    ? `Se habrian copiado ${total} documento(s). No se escribio nada.`
    : `Listo: ${total} documento(s) copiados en ${segundos}s.`);
  console.log('-'.repeat(70));
  console.log('');

  process.exit(0);
}

principal().catch(err => {
  console.error('\nLa copia fallo:');
  console.error(err);
  process.exit(1);
});
