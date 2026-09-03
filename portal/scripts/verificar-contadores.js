/* =============================================================================
 * scripts/verificar-contadores.js — A8: la red de seguridad de los contadores
 * =============================================================================
 *
 * QUÉ HACE
 *   Recorre todos los `pedidos`, recuenta `entregas_total`, `entregas_cubiertas`
 *   y `entregas_cumplidas` desde las `entregas` reales de cada uno, y lista las
 *   diferencias contra lo que el documento dice hoy.
 *
 *   ES DE SOLO LECTURA. No corrige nada — ni tiene un modo `--corregir`. Ver
 *   "Por qué no corrige solo" más abajo.
 *
 * POR QUÉ HACE FALTA
 *   Los tres contadores se mueven con `increment()` dentro de la transacción
 *   que los motiva — nunca sueltos —, así que el riesgo de que se
 *   desincronicen es bajo. Pero "bajo" no es "cero": una escritura que falla a
 *   mitad de camino, o un bug en la lógica de alguna acción, puede dejar un
 *   número que no corresponde. Este script es la forma de confirmar que no
 *   pasó, o de encontrar dónde si pasó.
 *
 * -----------------------------------------------------------------------------
 * CÓMO SE RECUENTA CADA CONTADOR
 * -----------------------------------------------------------------------------
 *   entregas_total       cuántas entregas del pedido NO están `suspendida`.
 *                         Una entrega suspendida sale del total a propósito
 *                         (ver `suspenderEntregas()` en `logica-pedidos.js`):
 *                         si siguiera contando, el pedido nunca podría llegar
 *                         a "cumplido", porque esa entrega nunca se va a
 *                         cumplir.
 *
 *   entregas_cubiertas   cuántas están `programada` o `cumplida` — tienen un
 *                         despacho vivo cubriéndolas.
 *
 *   entregas_cumplidas   cuántas están `cumplida` — el camión ya entregó.
 *
 *   Es exactamente el mismo criterio que `estadoPedido()` y `deltaContadores()`
 *   en `estados.js`, solo que acá se aplica de una sola vez sobre el estado
 *   actual, en vez de ir sumando deltas incrementales.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NO CORRIGE SOLO
 * -----------------------------------------------------------------------------
 *   Una diferencia puede significar dos cosas muy distintas: un contador que
 *   se desincronizó de verdad (bug, escritura a medio camino), o una entrega
 *   que cambió de estado por una vía que este script no contempló todavía. Un
 *   `--corregir` automático arriesga tapar el segundo caso con un número que
 *   parece correcto pero no lo es. La corrección, si hace falta, se hace a
 *   mano en la consola — mirando primero POR QUÉ está mal, no solo que lo está.
 *
 * USO
 *   node scripts/verificar-contadores.js --credencial ./credencial-staging.json
 *   node scripts/verificar-contadores.js --produccion --credencial ./credencial-prod.json
 *
 *   Sin `--produccion`, apunta a `entorno-prueba-explora`. Con `--produccion`,
 *   a `explora-portal` — mismo criterio que `cargar-entidades.js`.
 * ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

/* -----------------------------------------------------------------------------
 * Argumentos
 * -------------------------------------------------------------------------- */

const args = process.argv.slice(2);
const esProduccion = args.includes('--produccion');
const idxCredencial = args.indexOf('--credencial');
const rutaCredencial = idxCredencial !== -1 ? args[idxCredencial + 1] : null;

if (!rutaCredencial) {
  console.error('Falta --credencial <ruta-al-json-de-la-cuenta-de-servicio>');
  process.exit(1);
}

const PROYECTO = esProduccion ? 'explora-portal' : 'entorno-prueba-explora';

/* -----------------------------------------------------------------------------
 * Inicialización
 * -------------------------------------------------------------------------- */

const app = initializeApp({
  credential: cert(require(require('path').resolve(rutaCredencial))),
  projectId: PROYECTO,
});

const db = getFirestore(app);

/* -----------------------------------------------------------------------------
 * El recuento
 * -------------------------------------------------------------------------- */

/**
 * Recuenta los tres contadores de UN pedido a partir de sus entregas reales.
 * @param {Array} entregas Las entregas de ese pedido.
 * @returns {{total: number, cubiertas: number, cumplidas: number}}
 */
function recontar(entregas) {
  const vivas = entregas.filter(e => e.estado !== 'suspendida');
  const cubiertas = vivas.filter(e => e.estado === 'programada' || e.estado === 'cumplida');
  const cumplidas = vivas.filter(e => e.estado === 'cumplida');

  return {
    total: vivas.length,
    cubiertas: cubiertas.length,
    cumplidas: cumplidas.length,
  };
}

async function main() {
  console.log(`Proyecto: ${PROYECTO}`);
  console.log('Leyendo pedidos y entregas...\n');

  const [pedidosSnap, entregasSnap] = await Promise.all([
    db.collection('pedidos').get(),
    db.collection('entregas').get(),
  ]);

  // Agrupadas por pedido de una sola pasada, para no hacer una consulta por
  // pedido — con cientos de pedidos eso sería cientos de round-trips.
  const entregasPorPedido = new Map();
  entregasSnap.forEach(doc => {
    const e = doc.data();
    const lista = entregasPorPedido.get(e.pedido_id) || [];
    lista.push(e);
    entregasPorPedido.set(e.pedido_id, lista);
  });

  const diferencias = [];
  let revisados = 0;

  pedidosSnap.forEach(doc => {
    revisados++;
    const p = doc.data();

    // Un pedido suspendido no necesita cuadrar: `estadoPedido()` nunca vuelve
    // a mirar sus contadores una vez que `suspendido` es true. No es un error
    // dejarlos como quedaron al momento de suspender.
    if (p.suspendido) return;

    const entregas = entregasPorPedido.get(doc.id) || [];
    const real = recontar(entregas);

    const guardado = {
      total: p.entregas_total || 0,
      cubiertas: p.entregas_cubiertas || 0,
      cumplidas: p.entregas_cumplidas || 0,
    };

    const distinto = real.total !== guardado.total
      || real.cubiertas !== guardado.cubiertas
      || real.cumplidas !== guardado.cumplidas;

    if (distinto) {
      diferencias.push({
        id: doc.id,
        numero: p.numero || '(sin número)',
        guardado,
        real,
      });
    }
  });

  console.log(`Pedidos revisados: ${revisados}`);
  console.log(`Con diferencias:   ${diferencias.length}\n`);

  if (diferencias.length === 0) {
    console.log('✓ Todos los contadores coinciden con las entregas reales.');
    return;
  }

  console.log('Diferencias encontradas:\n');
  diferencias.forEach(d => {
    console.log(`— ${d.numero}  (id: ${d.id})`);
    console.log(`    total:     guardado=${d.guardado.total}   real=${d.real.total}`);
    console.log(`    cubiertas: guardado=${d.guardado.cubiertas}   real=${d.real.cubiertas}`);
    console.log(`    cumplidas: guardado=${d.guardado.cumplidas}   real=${d.real.cumplidas}`);
    console.log('');
  });

  console.log(
    'Nada de esto se corrigió — es de solo lectura. Antes de tocar un\n'
    + 'documento a mano, conviene mirar su historial (`where("pedido_id","==",<id>)`\n'
    + 'en la colección `historial`) para entender POR QUÉ quedó así, no solo\n'
    + 'poner el número que "da bien".'
  );
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
