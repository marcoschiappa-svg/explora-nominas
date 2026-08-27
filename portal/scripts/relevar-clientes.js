#!/usr/bin/env node
/* =============================================================================
 * relevar-clientes.js — Inventario de nombres de cliente y transporte
 * =============================================================================
 *
 * QUE HACE
 *   Recorre `pedidos_portal` y lista todos los valores distintos que aparecen
 *   en el campo `cliente` de los pedidos y en el campo `transporte` de los
 *   despachos, con cuantas veces aparece cada uno.
 *
 *   Ademas los agrupa por similitud, para que salten a la vista los que son la
 *   misma empresa escrita de formas distintas ("Molinos", "MOLINOS",
 *   "Molinos Agro S.A.").
 *
 *   La salida es el insumo para armar a mano el mapa de equivalencias. Esa
 *   parte NO se automatiza: decidir si "Bunge" y "Bunge Cereales" son la misma
 *   empresa o dos distintas es una decision de negocio, no de codigo.
 *
 * QUE NO HACE
 *   No escribe absolutamente nada. Abre la conexion, lee, imprime y sale.
 *
 * -----------------------------------------------------------------------------
 * COMO CORRERLO
 * -----------------------------------------------------------------------------
 *
 *   cd portal
 *   node scripts/relevar-clientes.js --credencial C:\Proyectos\credenciales\clave-staging.json
 *
 * Por defecto corre contra el entorno de PRUEBA. Para correrlo contra
 * produccion hay que pasar --produccion ademas de la credencial correcta.
 * Es solo lectura en los dos casos, pero conviene usar el de prueba: los datos
 * son los mismos y evita cualquier duda.
 *
 * Para guardar la salida en un archivo:
 *
 *   node scripts/relevar-clientes.js --credencial <ruta> > relevamiento.txt
 * ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore }        = require('firebase-admin/firestore');
const path                    = require('path');

const PROYECTO_STAGING    = 'entorno-prueba-explora';
const PROYECTO_PRODUCCION = 'explora-portal';

/* -----------------------------------------------------------------------------
 * Argumentos
 * -------------------------------------------------------------------------- */

function leerArgumentos() {
  const args = process.argv.slice(2);
  const opciones = { credencial: null, produccion: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--credencial')      opciones.credencial = args[++i];
    else if (args[i] === '--produccion') opciones.produccion = true;
  }

  if (!opciones.credencial) {
    console.error('\nFalta la credencial.\n');
    console.error('Uso:');
    console.error('  node scripts/relevar-clientes.js --credencial <ruta.json> [--produccion]\n');
    process.exit(1);
  }

  return opciones;
}

/* -----------------------------------------------------------------------------
 * Normalizacion para comparar
 * -------------------------------------------------------------------------- */

/**
 * Reduce un nombre a su forma comparable: sin mayusculas, sin acentos, sin
 * puntuacion, sin sufijos societarios y sin espacios de mas.
 *
 * "Molinos Agro S.A."  ->  "molinos agro"
 * "MOLINOS  AGRO SA"   ->  "molinos agro"
 *
 * Dos nombres con la misma clave son casi con seguridad la misma empresa. Que
 * la clave difiera NO significa que sean distintas — por eso despues hay una
 * segunda pasada por similitud.
 */
function claveNormalizada(nombre) {
  return String(nombre || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // saca acentos
    .replace(/[.,;:()"']/g, ' ')                        // saca puntuacion
    .replace(/\b(s\s*a\s*c\s*i\s*f?|s\s*a|s\s*r\s*l|sa|srl|saci|sacif|ltda|cia|y\s+cia)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Distancia de Levenshtein: cuantas ediciones de un caracter hacen falta para
 * convertir una cadena en la otra. Se usa para detectar erratas ("Cargil" vs
 * "Cargill") que la clave normalizada no agrupa.
 */
function distancia(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let fila = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = fila[j];
      fila[j] = Math.min(
        fila[j] + 1,                                    // borrar
        fila[j - 1] + 1,                                // insertar
        anterior + (a[i - 1] === b[j - 1] ? 0 : 1)      // sustituir
      );
      anterior = temp;
    }
  }
  return fila[b.length];
}

/**
 * Similitud de 0 a 1, relativa a la longitud del nombre mas largo.
 * 1 = identicos. 0.85 en adelante suele ser una errata o una abreviatura.
 */
function similitud(a, b) {
  const largo = Math.max(a.length, b.length);
  if (largo === 0) return 1;
  return 1 - distancia(a, b) / largo;
}

/* -----------------------------------------------------------------------------
 * Agrupacion
 * -------------------------------------------------------------------------- */

/**
 * Agrupa las variantes en dos pasadas:
 *   1. Por clave normalizada — junta diferencias de mayusculas, acentos,
 *      puntuacion y sufijos societarios. Es exacta, no da falsos positivos.
 *   2. Por similitud entre claves — junta erratas y abreviaturas. Es heuristica:
 *      puede juntar cosas que no van juntas, por eso la salida marca estos
 *      grupos para que se revisen a mano.
 *
 * @param {Map<string, number>} conteo  nombre original -> cantidad de apariciones
 * @param {number} umbral               similitud minima para agrupar (0 a 1)
 */
function agrupar(conteo, umbral = 0.85) {
  // Pasada 1: clave exacta
  const porClave = new Map();
  for (const [nombre, veces] of conteo) {
    const clave = claveNormalizada(nombre);
    if (!porClave.has(clave)) porClave.set(clave, { clave, variantes: [], total: 0 });
    const g = porClave.get(clave);
    g.variantes.push({ nombre, veces });
    g.total += veces;
  }

  // Pasada 2: fusionar claves parecidas
  const grupos = [];
  const usadas = new Set();

  for (const [clave, grupo] of porClave) {
    if (usadas.has(clave)) continue;
    usadas.add(clave);

    const fusionado = { ...grupo, variantes: [...grupo.variantes], dudoso: false };

    for (const [otraClave, otroGrupo] of porClave) {
      if (usadas.has(otraClave)) continue;
      if (similitud(clave, otraClave) >= umbral) {
        usadas.add(otraClave);
        fusionado.variantes.push(...otroGrupo.variantes);
        fusionado.total += otroGrupo.total;
        fusionado.dudoso = true;   // se fusiono por parecido, hay que revisarlo
      }
    }

    fusionado.variantes.sort((a, b) => b.veces - a.veces);
    grupos.push(fusionado);
  }

  grupos.sort((a, b) => b.total - a.total);
  return grupos;
}

/* -----------------------------------------------------------------------------
 * Salida
 * -------------------------------------------------------------------------- */

function imprimirGrupos(titulo, grupos) {
  const conVarias = grupos.filter(g => g.variantes.length > 1);
  const unicas    = grupos.filter(g => g.variantes.length === 1);

  console.log('');
  console.log('='.repeat(78));
  console.log(titulo);
  console.log('='.repeat(78));
  console.log(`${grupos.length} empresa(s) distinta(s) detectada(s)`);
  console.log(`${conVarias.length} con mas de una forma de escritura`);
  console.log('');

  if (conVarias.length > 0) {
    console.log('-'.repeat(78));
    console.log('CON VARIANTES — hay que elegir el nombre canonico');
    console.log('-'.repeat(78));
    for (const g of conVarias) {
      const marca = g.dudoso ? '  [REVISAR: agrupado por parecido]' : '';
      console.log('');
      console.log(`  ${g.total} uso(s)${marca}`);
      for (const v of g.variantes) {
        console.log(`      ${String(v.veces).padStart(4)} x  "${v.nombre}"`);
      }
    }
    console.log('');
  }

  if (unicas.length > 0) {
    console.log('-'.repeat(78));
    console.log('SIN VARIANTES — una sola forma de escritura');
    console.log('-'.repeat(78));
    for (const g of unicas) {
      const v = g.variantes[0];
      console.log(`  ${String(v.veces).padStart(4)} x  "${v.nombre}"`);
    }
    console.log('');
  }
}

/**
 * Imprime un esqueleto del mapa de equivalencias, listo para completar a mano.
 * El valor arranca con la variante mas usada de cada grupo; hay que revisarlo
 * y reemplazarlo por la razon social correcta.
 */
function imprimirEsqueleto(titulo, grupos) {
  console.log('');
  console.log('='.repeat(78));
  console.log(`ESQUELETO DEL MAPA — ${titulo}`);
  console.log('='.repeat(78));
  console.log('// Revisar cada valor: hoy tiene la variante mas usada, no la');
  console.log('// razon social correcta. Reemplazar por el nombre definitivo.');
  console.log('');
  console.log('const MAPA = {');
  for (const g of grupos) {
    const canonico = g.variantes[0].nombre;
    for (const v of g.variantes) {
      console.log(`  ${JSON.stringify(v.nombre)}: ${JSON.stringify(canonico)},`);
    }
  }
  console.log('};');
  console.log('');
}

/* -----------------------------------------------------------------------------
 * Programa principal
 * -------------------------------------------------------------------------- */

async function principal() {
  const opciones = leerArgumentos();
  const esperado = opciones.produccion ? PROYECTO_PRODUCCION : PROYECTO_STAGING;

  const cred = require(path.resolve(opciones.credencial));
  if (cred.project_id !== esperado) {
    console.error(`\nERROR: la credencial es del proyecto "${cred.project_id}"`);
    console.error(`       y se esperaba "${esperado}".\n`);
    process.exit(1);
  }

  const app = initializeApp({ credential: cert(cred) }, 'relevamiento');
  const db  = getFirestore(app);

  console.log('');
  console.log('='.repeat(78));
  console.log('RELEVAMIENTO DE NOMBRES — solo lectura, no se escribe nada');
  console.log('='.repeat(78));
  console.log(`Proyecto: ${esperado}`);

  const snap = await db.collection('pedidos_portal').get();
  console.log(`Pedidos leidos: ${snap.size}`);

  const clientes     = new Map();
  const transportes  = new Map();
  const lugares      = new Map();
  let   totalDesp    = 0;
  let   sinCliente   = 0;
  let   sinTransporte = 0;

  for (const doc of snap.docs) {
    const p = doc.data();

    const cliente = (p.cliente || '').trim();
    if (cliente) clientes.set(cliente, (clientes.get(cliente) || 0) + 1);
    else sinCliente++;

    const lugar = (p.lugar || '').trim();
    if (lugar) lugares.set(lugar, (lugares.get(lugar) || 0) + 1);

    for (const d of (p.despachos || [])) {
      totalDesp++;
      const t = (d.transporte || '').trim();
      if (t) transportes.set(t, (transportes.get(t) || 0) + 1);
      else sinTransporte++;
    }
  }

  console.log(`Despachos leidos: ${totalDesp}`);
  if (sinCliente)    console.log(`Pedidos sin cliente: ${sinCliente}`);
  if (sinTransporte) console.log(`Despachos sin transporte: ${sinTransporte}`);

  const gClientes    = agrupar(clientes);
  const gTransportes = agrupar(transportes);
  const gLugares     = agrupar(lugares);

  imprimirGrupos('CLIENTES  (campo `cliente` de los pedidos)', gClientes);
  imprimirGrupos('TRANSPORTES  (campo `transporte` de los despachos)', gTransportes);
  imprimirGrupos('LUGARES DE ENTREGA  (campo `lugar` de los pedidos)', gLugares);

  imprimirEsqueleto('CLIENTES', gClientes);
  imprimirEsqueleto('TRANSPORTES', gTransportes);

  console.log('='.repeat(78));
  console.log('FIN. No se escribio nada.');
  console.log('='.repeat(78));
  console.log('');

  process.exit(0);
}

principal().catch(err => {
  console.error('\nEl relevamiento fallo:');
  console.error(err);
  process.exit(1);
});
