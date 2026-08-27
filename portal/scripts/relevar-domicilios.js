#!/usr/bin/env node
/* =============================================================================
 * relevar-domicilios.js — Cruce de organizaciones con lugares de entrega
 * =============================================================================
 *
 * QUE HACE
 *   Recorre `pedidos_portal` y, para cada pedido, cruza el CLIENTE con el
 *   LUGAR de entrega. Sin ese cruce no se puede armar `domicilios/`, porque
 *   cada domicilio tiene que colgar de una organización.
 *
 *   Ademas parsea cada dirección al formato estructurado
 *   (calle / numero / ciudad / provincia / cp) y agrupa las que son la misma
 *   escrita de formas distintas.
 *
 *   Marca tres situaciones que hay que revisar a mano:
 *     - Direcciones que no se pueden parsear
 *     - Una misma dirección usada por clientes distintos
 *     - Un cliente con muchas direcciones (puede ser real, o errores de carga)
 *
 * QUE NO HACE
 *   No escribe nada. Solo lee e imprime.
 *
 * -----------------------------------------------------------------------------
 * COMO CORRERLO
 * -----------------------------------------------------------------------------
 *
 *   cd portal
 *   node scripts/relevar-domicilios.js --credencial C:\Proyectos\credenciales\clave-staging.json
 *
 * Para guardar la salida:
 *   node scripts/relevar-domicilios.js --credencial <ruta> > domicilios.txt
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
    console.error('Uso: node scripts/relevar-domicilios.js --credencial <ruta.json> [--produccion]\n');
    process.exit(1);
  }
  return opciones;
}

/* -----------------------------------------------------------------------------
 * Provincias — normalización
 * -------------------------------------------------------------------------- */

const PROVINCIAS = {
  'buenos aires': 'Buenos Aires',
  'bs as':        'Buenos Aires',
  'bs. as.':      'Buenos Aires',
  'bueno aires':  'Buenos Aires',
  'santa fe':     'Santa Fe',
  'cordoba':      'Córdoba',
  'chaco':        'Chaco',
  'entre rios':   'Entre Ríos',
  'entrerios':    'Entre Ríos',
};

function normalizarProvincia(txt) {
  const clave = String(txt || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return PROVINCIAS[clave] || null;
}

/* -----------------------------------------------------------------------------
 * Parseo de direcciones
 * -------------------------------------------------------------------------- */

/**
 * Intenta descomponer una dirección de texto libre en campos.
 *
 * El formato mayoritario es `calle, numero, ciudad, provincia, cp`, pero hay
 * variantes: sin coma entre calle y número, con comas dobles, sin CP, con el
 * número repetido dentro de la calle.
 *
 * Devuelve `{ ok: false, motivo }` cuando no puede interpretarla, en vez de
 * inventar campos. Esas quedan para revisión manual.
 */
function parsearDireccion(texto) {
  const original = String(texto || '').trim();
  if (!original) return { ok: false, motivo: 'vacía', original };

  // Partir por comas, descartando las vacías que dejan las comas dobles
  const partes = original.split(',').map(p => p.trim()).filter(p => p !== '');
  if (partes.length < 2) return { ok: false, motivo: 'muy pocos campos', original };

  const resultado = { ok: true, original, calle: null, numero: null, ciudad: null, provincia: null, cp: null };

  // El CP suele ser el último campo: 4 dígitos, o letra + 4 dígitos + hasta 3 letras
  const ultimo = partes[partes.length - 1];
  if (/^[A-Za-z]?\d{4}[A-Za-z]{0,3}$/.test(ultimo)) {
    resultado.cp = ultimo.toUpperCase();
    partes.pop();
  }

  // La provincia suele ser el último campo que queda
  if (partes.length > 0) {
    const prov = normalizarProvincia(partes[partes.length - 1]);
    if (prov) {
      resultado.provincia = prov;
      partes.pop();
    }
  }

  // La ciudad es el siguiente hacia atrás
  if (partes.length > 0) {
    resultado.ciudad = partes.pop();
  }

  // Lo que queda es calle y número
  if (partes.length >= 2) {
    resultado.calle  = partes[0];
    resultado.numero = partes.slice(1).join(' ');
  } else if (partes.length === 1) {
    // Sin coma entre calle y número: "RIO PRIMERO 155"
    const m = partes[0].match(/^(.+?)\s+(\d+[A-Za-z]?)$/);
    if (m) { resultado.calle = m[1].trim(); resultado.numero = m[2]; }
    else   { resultado.calle = partes[0]; }
  }

  if (!resultado.calle)  return { ok: false, motivo: 'sin calle',  original };
  if (!resultado.ciudad) return { ok: false, motivo: 'sin ciudad', original };

  // El número repetido dentro de la calle: "Manuel Alberti 1780, 1780, ..."
  if (resultado.numero) {
    const reNum = new RegExp('\\s+' + resultado.numero.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
    resultado.calle = resultado.calle.replace(reNum, '').trim();
  }

  return resultado;
}

/**
 * Clave para agrupar direcciones equivalentes: ciudad + calle sin acentos,
 * sin abreviaturas de vía, sin puntuación. El número queda afuera a propósito
 * — así se ven juntas las que difieren solo en el número, que suelen ser
 * erratas (el caso 514 vs 574).
 */
function claveDireccion(d) {
  const limpiar = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,;:()"'&]/g, ' ')
    .replace(/\b(av|avda|avenida| av da|ing|ingeniero|calle|ruta|rp|rn|km)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const ciudad = limpiar(d.ciudad)
    .replace(/\b(gral|general)\b/g, 'gral')
    .replace(/\bpuerto\s+gral\s+san\s+martin\b/, 'pgsm')
    .replace(/\bpuerto\s+san\s+martin\b/, 'pgsm');

  return `${ciudad}|${limpiar(d.calle)}`;
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

  const db = getFirestore(initializeApp({ credential: cert(cred) }, 'relevamiento-dom'));

  console.log('');
  console.log('='.repeat(78));
  console.log('RELEVAMIENTO DE DOMICILIOS — solo lectura');
  console.log('='.repeat(78));
  console.log(`Proyecto: ${esperado}`);

  const snap = await db.collection('pedidos_portal').get();
  console.log(`Pedidos leidos: ${snap.size}`);
  console.log('');

  // clave de dirección -> { variantes, clientes, parseos }
  const grupos    = new Map();
  const noParsean = [];
  let   sinLugar  = 0;

  for (const doc of snap.docs) {
    const p       = doc.data();
    const cliente = (p.cliente || '(sin cliente)').trim();
    const lugar   = (p.lugar   || '').trim();

    if (!lugar) { sinLugar++; continue; }

    const parsed = parsearDireccion(lugar);
    if (!parsed.ok) {
      noParsean.push({ pedido: p.id || doc.id, cliente, lugar, motivo: parsed.motivo });
      continue;
    }

    const clave = claveDireccion(parsed);
    if (!grupos.has(clave)) {
      grupos.set(clave, { clave, variantes: new Map(), clientes: new Map(), parseos: [] });
    }
    const g = grupos.get(clave);
    g.variantes.set(lugar, (g.variantes.get(lugar) || 0) + 1);
    g.clientes.set(cliente, (g.clientes.get(cliente) || 0) + 1);
    g.parseos.push(parsed);
  }

  const lista = [...grupos.values()].sort((a, b) => {
    const ta = [...a.variantes.values()].reduce((s, n) => s + n, 0);
    const tb = [...b.variantes.values()].reduce((s, n) => s + n, 0);
    return tb - ta;
  });

  /* ── Domicilios agrupados ─────────────────────────────────────────────── */

  console.log('='.repeat(78));
  console.log('DOMICILIOS AGRUPADOS');
  console.log('='.repeat(78));
  console.log(`${lista.length} domicilio(s) distinto(s)`);
  console.log('');

  for (const g of lista) {
    const total    = [...g.variantes.values()].reduce((s, n) => s + n, 0);
    const numeros  = new Set(g.parseos.map(p => p.numero).filter(Boolean));
    const cps      = new Set(g.parseos.map(p => p.cp).filter(Boolean));
    const clientes = [...g.clientes.entries()].sort((a, b) => b[1] - a[1]);

    console.log('-'.repeat(78));
    console.log(`${total} uso(s)`);

    const ref = g.parseos[0];
    console.log(`  Calle:     ${ref.calle}`);
    console.log(`  Número:    ${numeros.size > 1 ? [...numeros].join('  ⚠ DISTINTOS: ') : (ref.numero || '—')}`);
    console.log(`  Ciudad:    ${ref.ciudad}`);
    console.log(`  Provincia: ${ref.provincia || '⚠ sin identificar'}`);
    console.log(`  CP:        ${cps.size > 1 ? [...cps].join(' / ') + '  ⚠ DISTINTOS' : (ref.cp || '—')}`);

    console.log(`  Cliente(s):`);
    for (const [c, n] of clientes) console.log(`      ${String(n).padStart(3)} x  ${c}`);
    if (clientes.length > 1) console.log(`      ⚠ REVISAR: la misma dirección la usan ${clientes.length} clientes distintos`);

    if (g.variantes.size > 1) {
      console.log(`  Escrita de ${g.variantes.size} formas:`);
      for (const [v, n] of [...g.variantes.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`      ${String(n).padStart(3)} x  "${v}"`);
      }
    }
    console.log('');
  }

  /* ── No parseables ────────────────────────────────────────────────────── */

  if (noParsean.length > 0) {
    console.log('='.repeat(78));
    console.log('NO SE PUDIERON PARSEAR — revisar a mano');
    console.log('='.repeat(78));
    for (const n of noParsean) {
      console.log(`  [${n.motivo}]  pedido ${n.pedido}  ·  ${n.cliente}`);
      console.log(`      "${n.lugar}"`);
    }
    console.log('');
  }

  /* ── Por organización ─────────────────────────────────────────────────── */

  console.log('='.repeat(78));
  console.log('DOMICILIOS POR CLIENTE');
  console.log('='.repeat(78));

  const porCliente = new Map();
  for (const g of lista) {
    const ref = g.parseos[0];
    const dir = `${ref.calle} ${ref.numero || ''}, ${ref.ciudad}`.replace(/\s+/g, ' ');
    for (const cliente of g.clientes.keys()) {
      if (!porCliente.has(cliente)) porCliente.set(cliente, []);
      porCliente.get(cliente).push(dir);
    }
  }

  const ordenado = [...porCliente.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [cliente, dirs] of ordenado) {
    const marca = dirs.length > 3 ? '  ⚠ REVISAR: muchos domicilios' : '';
    console.log('');
    console.log(`  ${cliente}  (${dirs.length})${marca}`);
    for (const d of dirs) console.log(`      · ${d}`);
  }

  console.log('');
  console.log('='.repeat(78));
  console.log(`Pedidos sin lugar: ${sinLugar}`);
  console.log('FIN. No se escribió nada.');
  console.log('='.repeat(78));
  console.log('');

  process.exit(0);
}

principal().catch(err => {
  console.error('\nEl relevamiento falló:');
  console.error(err);
  process.exit(1);
});
