/* =============================================================================
 * informe-viajes.js — Exporta todo lo de Firestore relacionado a uno o más viajes
 * =============================================================================
 *
 * PROPÓSITO
 *   Juntar en dos archivos todo lo necesario para diagnosticar un viaje, sin
 *   copiar y pegar desde la consola:
 *     - informe-viajes-<sello>.json  → los datos completos, tal cual están
 *     - informe-viajes-<sello>.md    → un resumen legible con huecos y demoras
 *
 * SOLO LEE. No escribe, no borra, no modifica nada. No tiene modo --ejecutar.
 *
 * QUÉ JUNTA, POR VIAJE
 *   - el documento del viaje
 *   - la subcolección gps_puntos completa, con la hora de captura (ID del
 *     documento) y la hora en que llegó al servidor (createTime de Firestore).
 *     La diferencia entre las dos muestra si los puntos se subieron en el
 *     momento o quedaron trabados en el teléfono.
 *   - la entrega, el despacho y el pedido
 *   - el historial de todo el árbol del pedido
 *   - el usuario chofer (sin push_token)
 *   - los app_logs en una ventana alrededor del viaje. Los logs actuales no
 *     llevan uid: se traen TODOS los de la ventana y se marcan los que se
 *     pueden atar al viaje (viaje_id o dni).
 *
 * TODAS LAS HORAS en hora local Argentina (-03), salvo los campos `_utc`.
 *
 * -----------------------------------------------------------------------------
 * CÓMO CORRERLO
 * -----------------------------------------------------------------------------
 *
 *   cd portal
 *   npm install firebase-admin --no-save      (si no está)
 *
 *   Por fecha (viajes iniciados ese día, hora local):
 *     node scripts/informe-viajes.js --proyecto explora-portal ^
 *       --credencial C:\Proyectos\credenciales\clave-produccion.json ^
 *       --fecha 2026-11-24
 *
 *   Por IDs:
 *     node scripts/informe-viajes.js --proyecto explora-portal ^
 *       --credencial C:\Proyectos\credenciales\clave-produccion.json ^
 *       --viajes KvUitSf56MLApHZMmvfs,OTROID,OTROID
 *
 *   Opcionales:
 *     --hueco-min 5     minutos sin puntos para marcar un hueco (default 5)
 *     --salida <dir>    carpeta donde dejar los archivos (default: actual)
 *
 * La credencial se verifica contra --proyecto antes de leer nada.
 * ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const path = require('path');
const fs = require('fs');

const PROYECTOS_VALIDOS = ['entorno-prueba-explora', 'explora-portal'];
const OFFSET_AR_MS = -3 * 60 * 60 * 1000;        // Argentina, sin horario de verano
const VENTANA_LOGS_MS = 60 * 60 * 1000;          // 1 h antes del inicio y después del fin
const DEMORA_SUBIDA_ALERTA_S = 300;              // punto que tardó > 5 min en llegar

/* -----------------------------------------------------------------------------
 * Argumentos y conexión — mismo patrón que los otros scripts de portal/scripts
 * -------------------------------------------------------------------------- */

function esFechaValida(texto) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto || '')) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

function leerArgumentos() {
  const args = process.argv.slice(2);
  const o = { credencial: null, proyecto: null, fecha: null, viajes: [], huecoMin: 5, salida: '.' };

  for (let i = 0; i < args.length; i++) {
    if      (args[i] === '--credencial') o.credencial = args[++i];
    else if (args[i] === '--proyecto')   o.proyecto = args[++i];
    else if (args[i] === '--fecha')      o.fecha = args[++i];
    else if (args[i] === '--viajes')     o.viajes = String(args[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (args[i] === '--hueco-min')  o.huecoMin = Number(args[++i]);
    else if (args[i] === '--salida')     o.salida = args[++i];
  }

  if (!o.credencial || !o.proyecto || (!o.fecha && o.viajes.length === 0)) {
    console.error('\nFaltan argumentos.\n');
    console.error('Uso:');
    console.error('  node informe-viajes.js --proyecto <entorno-prueba-explora|explora-portal> \\');
    console.error('    --credencial <ruta.json> \\');
    console.error('    (--fecha AAAA-MM-DD | --viajes id1,id2,...) [--hueco-min 5] [--salida <dir>]\n');
    process.exit(1);
  }
  if (!PROYECTOS_VALIDOS.includes(o.proyecto)) {
    console.error(`\nERROR: --proyecto "${o.proyecto}" no es válido. Usar uno de: ${PROYECTOS_VALIDOS.join(', ')}\n`);
    process.exit(1);
  }
  if (o.fecha && !esFechaValida(o.fecha)) {
    console.error(`\nERROR: --fecha "${o.fecha}" no es una fecha válida AAAA-MM-DD.\n`);
    process.exit(1);
  }
  if (!(o.huecoMin > 0)) {
    console.error('\nERROR: --hueco-min tiene que ser un número mayor a 0.\n');
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

  const app = initializeApp({ credential: cert(cred) }, 'informe-viajes');
  return getFirestore(app);
}

/* -----------------------------------------------------------------------------
 * Fechas y serialización
 * -------------------------------------------------------------------------- */

/** Date → "2026-11-24 12:38:54" en hora local Argentina. */
function horaLocal(d) {
  if (!d) return null;
  return new Date(d.getTime() + OFFSET_AR_MS).toISOString().replace('T', ' ').slice(0, 19);
}

/** Convierte cualquier valor de Firestore a algo que JSON pueda guardar. */
function serializar(valor) {
  if (valor === null || valor === undefined) return valor ?? null;
  if (valor instanceof Timestamp) return horaLocal(valor.toDate()) + ' -03';
  if (valor instanceof Date) return horaLocal(valor) + ' -03';
  if (typeof valor.latitude === 'number' && typeof valor.longitude === 'number') {
    return { lat: valor.latitude, lng: valor.longitude };      // GeoPoint
  }
  if (typeof valor.path === 'string' && typeof valor.id === 'string') return `ref:${valor.path}`;
  if (Array.isArray(valor)) return valor.map(serializar);
  if (typeof valor === 'object') {
    const salida = {};
    for (const [k, v] of Object.entries(valor)) salida[k] = serializar(v);
    return salida;
  }
  return valor;
}

function aDate(valor) {
  if (!valor) return null;
  if (valor instanceof Timestamp) return valor.toDate();
  if (valor instanceof Date) return valor;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function docPlano(snap) {
  if (!snap || !snap.exists) return null;
  return {
    _id: snap.id,
    _creado_servidor: snap.createTime ? horaLocal(snap.createTime.toDate()) + ' -03' : null,
    _actualizado_servidor: snap.updateTime ? horaLocal(snap.updateTime.toDate()) + ' -03' : null,
    ...serializar(snap.data()),
  };
}

/* -----------------------------------------------------------------------------
 * Lectura
 * -------------------------------------------------------------------------- */

async function viajesPorFecha(db, fecha) {
  // Día local: 00:00 -03 = 03:00 UTC
  const desde = new Date(`${fecha}T03:00:00Z`);
  const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000);
  const snap = await db.collection('viajes')
    .where('inicio_ts', '>=', Timestamp.fromDate(desde))
    .where('inicio_ts', '<', Timestamp.fromDate(hasta))
    .get();
  return snap.docs;
}

async function leerDoc(db, coleccion, id) {
  if (!id) return null;
  try {
    return docPlano(await db.collection(coleccion).doc(id).get());
  } catch (err) {
    return { _error: err.message };
  }
}

async function leerGps(viajeRef) {
  const snap = await viajeRef.collection('gps_puntos').get();
  const puntos = snap.docs.map((d) => {
    const datos = d.data();
    const msId = Number(d.id);
    const captura = Number.isFinite(msId) && msId > 1e12 ? new Date(msId) : aDate(datos.ts);
    const llegada = d.createTime ? d.createTime.toDate() : null;
    return {
      _id: d.id,
      captura: captura ? horaLocal(captura) : null,
      llegada_servidor: llegada ? horaLocal(llegada) : null,
      demora_subida_s: captura && llegada ? Math.round((llegada - captura) / 1000) : null,
      ...serializar(datos),
      _captura_ms: captura ? captura.getTime() : null,
    };
  });
  puntos.sort((a, b) => (a._captura_ms ?? 0) - (b._captura_ms ?? 0));
  return puntos;
}

async function leerHistorial(db, pedidoId) {
  if (!pedidoId) return [];
  try {
    const snap = await db.collection('historial').where('pedido_id', '==', pedidoId).get();
    const filas = snap.docs.map(docPlano);
    filas.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    return filas;
  } catch (err) {
    return [{ _error: err.message }];
  }
}

/**
 * app_logs guarda `ts` como string ISO (UTC) hoy; el modelo TO-BE lo pasa a
 * Timestamp. Se consultan las dos formas y se juntan.
 */
async function leerLogs(db, desde, hasta) {
  const resultados = new Map();

  try {
    const s1 = await db.collection('app_logs')
      .where('ts', '>=', desde.toISOString())
      .where('ts', '<=', hasta.toISOString())
      .get();
    s1.docs.forEach(d => resultados.set(d.id, d));
  } catch (err) {
    console.warn('  app_logs (ts string):', err.message);
  }

  try {
    const s2 = await db.collection('app_logs')
      .where('ts', '>=', Timestamp.fromDate(desde))
      .where('ts', '<=', Timestamp.fromDate(hasta))
      .get();
    s2.docs.forEach(d => resultados.set(d.id, d));
  } catch (err) {
    console.warn('  app_logs (ts Timestamp):', err.message);
  }

  return [...resultados.values()].map((d) => {
    const datos = d.data();
    const ts = aDate(datos.ts);
    return { _id: d.id, hora_local: ts ? horaLocal(ts) : null, ...serializar(datos), _ms: ts ? ts.getTime() : 0 };
  }).sort((a, b) => a._ms - b._ms);
}

/* -----------------------------------------------------------------------------
 * Análisis
 * -------------------------------------------------------------------------- */

function analizarGps(puntos, huecoMin) {
  const conHora = puntos.filter(p => p._captura_ms);
  const huecos = [];
  for (let i = 1; i < conHora.length; i++) {
    const min = (conHora[i]._captura_ms - conHora[i - 1]._captura_ms) / 60000;
    if (min >= huecoMin) {
      huecos.push({ desde: conHora[i - 1].captura, hasta: conHora[i].captura, minutos: Math.round(min) });
    }
  }
  const demorados = conHora.filter(p => (p.demora_subida_s ?? 0) > DEMORA_SUBIDA_ALERTA_S);
  return {
    cantidad: puntos.length,
    primero: conHora[0]?.captura ?? null,
    ultimo: conHora[conHora.length - 1]?.captura ?? null,
    huecos,
    subidas_demoradas: demorados.length,
    demora_subida_max_s: conHora.reduce((m, p) => Math.max(m, p.demora_subida_s ?? 0), 0),
  };
}

function marcarLogs(logs, viajeId, dni) {
  return logs.map(l => ({
    ...l,
    _relacionado: l.viaje_id === viajeId || (!!dni && (l.dni === dni || l.chofer_dni === dni)),
  }));
}

/* -----------------------------------------------------------------------------
 * Resumen en Markdown
 * -------------------------------------------------------------------------- */

function resumenMd(proyecto, generado, informes) {
  const l = [];
  l.push(`# Informe de viajes — ${proyecto}`);
  l.push(`Generado: ${generado} (hora local -03). Viajes: ${informes.length}.`);
  l.push('');

  for (const inf of informes) {
    const v = inf.viaje;
    const g = inf.gps_analisis;
    l.push(`## Viaje ${v._id}`);
    l.push(`- Cliente: ${v.cliente_razon_social ?? '-'} · Producto: ${v.producto_nombre ?? '-'} · Destino: ${v.destino_texto ?? '-'}`);
    l.push(`- Chofer DNI: ${v.chofer_dni ?? '-'} · Patente: ${v.patente_tractor ?? '-'} / ${v.patente_semi ?? '-'}`);
    l.push(`- Estado: **${v.estado}** (estado_ts ${v.estado_ts ?? '-'}) · demorado: ${v.demorado} · cerrado_por: ${v.cerrado_por ?? '-'} · cierre_motivo: ${v.cierre_motivo ?? '-'}`);
    l.push(`- Inicio: ${v.inicio_ts ?? '-'} (${v.inicio_origen ?? '-'}, ±${v.inicio_precision ?? '-'} m)`);
    l.push(`- Fin: ${v.fin_ts ?? '-'} (${v.fin_origen ?? '-'})`);
    l.push(`- Última posición: ${v.ultima_ts ?? '-'} · actualizado_en: ${v.actualizado_en ?? '-'} · última escritura en servidor: ${v._actualizado_servidor ?? '-'}`);
    l.push(`- puntos_registrados (contador): ${v.puntos_registrados ?? '-'} · documentos en gps_puntos: ${g.cantidad}`);
    l.push('');
    l.push(`### GPS`);
    l.push(`- Primer punto: ${g.primero ?? '-'} · Último punto: ${g.ultimo ?? '-'}`);
    l.push(`- Puntos que tardaron más de ${DEMORA_SUBIDA_ALERTA_S / 60} min en llegar al servidor: ${g.subidas_demoradas} (máx ${Math.round(g.demora_subida_max_s / 60)} min)`);
    if (g.huecos.length === 0) {
      l.push(`- Sin huecos de ${inf.hueco_min} min o más.`);
    } else {
      l.push(`- Huecos de ${inf.hueco_min} min o más:`);
      g.huecos.forEach(h => l.push(`  - ${h.desde} → ${h.hasta} (${h.minutos} min)`));
    }
    l.push('');
    l.push(`### Historial del pedido (${inf.historial.length})`);
    inf.historial.forEach(h => l.push(`- ${h.ts ?? '-'} · ${h.entidad_tipo ?? '-'} ${h.entidad_id ?? ''} · ${h.accion ?? '-'} · ${h.usuario_nombre ?? h.usuario_uid ?? '-'}`));
    l.push('');
    const rel = inf.app_logs.filter(x => x._relacionado);
    l.push(`### app_logs en la ventana: ${inf.app_logs.length} (atados al viaje: ${rel.length})`);
    inf.app_logs.forEach(x => l.push(`- ${x.hora_local ?? '-'}${x._relacionado ? ' **[viaje]**' : ''} · ${x.evento ?? '-'} · ${x.plataforma ?? ''} ${x.version_os ?? ''} · ${x.code ?? ''} ${x.mensaje ?? ''}`.trimEnd()));
    l.push('');
  }
  return l.join('\n');
}

/* -----------------------------------------------------------------------------
 * Programa principal
 * -------------------------------------------------------------------------- */

async function main() {
  const o = leerArgumentos();
  const db = conectar(o.credencial, o.proyecto);

  console.log(`\nProyecto: ${o.proyecto}  (SOLO LECTURA)`);

  let snaps = [];
  if (o.fecha) {
    snaps = await viajesPorFecha(db, o.fecha);
    console.log(`Viajes iniciados el ${o.fecha}: ${snaps.length}`);
  }
  for (const id of o.viajes) {
    if (snaps.some(s => s.id === id)) continue;
    const s = await db.collection('viajes').doc(id).get();
    if (s.exists) snaps.push(s);
    else console.warn(`  No existe el viaje ${id}`);
  }
  if (snaps.length === 0) {
    console.log('No hay viajes para informar.\n');
    return;
  }

  const informes = [];
  for (const snap of snaps) {
    console.log(`  Viaje ${snap.id}...`);
    const datos = snap.data();
    const viaje = docPlano(snap);

    const inicio = aDate(datos.inicio_ts) || aDate(datos.creado_en) || new Date();
    const fin = aDate(datos.fin_ts) || aDate(datos.ultima_ts) || aDate(datos.actualizado_en) || new Date();
    const desdeLogs = new Date(inicio.getTime() - VENTANA_LOGS_MS);
    const hastaLogs = new Date(Math.max(fin.getTime(), (aDate(datos.actualizado_en) || fin).getTime()) + VENTANA_LOGS_MS);

    const [gps, entrega, despacho, pedido, historial, logs, chofer] = await Promise.all([
      leerGps(snap.ref),
      leerDoc(db, 'entregas', datos.entrega_id),
      leerDoc(db, 'despachos', datos.despacho_id),
      leerDoc(db, 'pedidos', datos.pedido_id),
      leerHistorial(db, datos.pedido_id),
      leerLogs(db, desdeLogs, hastaLogs),
      leerDoc(db, 'usuarios', datos.chofer_uid),
    ]);
    if (chofer) delete chofer.push_token;

    informes.push({
      viaje,
      gps_analisis: analizarGps(gps, o.huecoMin),
      hueco_min: o.huecoMin,
      entrega,
      despacho,
      pedido,
      chofer,
      historial,
      ventana_logs: { desde: horaLocal(desdeLogs), hasta: horaLocal(hastaLogs) },
      app_logs: marcarLogs(logs, snap.id, datos.chofer_dni),
      gps_puntos: gps,
    });
  }

  const generado = horaLocal(new Date());
  const sello = generado.replace(/[: ]/g, '').replace(/-/g, '').slice(0, 13);
  fs.mkdirSync(o.salida, { recursive: true });
  const rutaJson = path.join(o.salida, `informe-viajes-${sello}.json`);
  const rutaMd = path.join(o.salida, `informe-viajes-${sello}.md`);

  fs.writeFileSync(rutaJson, JSON.stringify({ proyecto: o.proyecto, generado, informes }, null, 2), 'utf8');
  fs.writeFileSync(rutaMd, resumenMd(o.proyecto, generado, informes), 'utf8');

  console.log(`\nListo:\n  ${rutaJson}\n  ${rutaMd}\n`);
}

main().catch((err) => {
  console.error('\nERROR:', err.message);
  if (/index/i.test(err.message)) {
    console.error('Firestore pide un índice: abrí el link del mensaje, crealo y volvé a correr.\n');
  }
  process.exit(1);
});
