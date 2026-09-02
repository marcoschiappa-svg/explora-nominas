/* =============================================================================
 * logica-pedidos.js — Validación y creación de pedidos
 * =============================================================================
 *
 * QUE ES
 *   La validación y la escritura de un pedido, separadas de la pantalla.
 *
 * POR QUE ESTE NOMBRE
 *   Se llamaba `pedidos.js`, y eso chocaba con `pages/Pedidos.js`: en Windows y
 *   macOS el sistema de archivos no distingue mayúsculas, así que un
 *   `import ... from '../pedidos'` puede resolver al archivo equivocado. Git sí
 *   distingue, con lo cual el repo y el disco pueden terminar diciendo cosas
 *   distintas.
 *
 * POR QUE APARTE
 *   Hay dos formas de crear un pedido —el formulario y la carga masiva por
 *   Excel— y tienen que aplicar exactamente las mismas reglas. Si la validación
 *   viviera dentro de la pantalla, la masiva terminaría con una copia levemente
 *   distinta, y las diferencias aparecerían meses después como datos raros.
 *
 *   Es el mismo problema que hoy tiene el estado del pedido, escrito desde
 *   cinco funciones con criterios que no coinciden.
 *
 * -----------------------------------------------------------------------------
 * LAS ENTREGAS SON DOCUMENTOS, TODAS
 * -----------------------------------------------------------------------------
 *   Hoy la primera entrega vive en el pedido (`fecha_entrega` +
 *   `volumen_entrega1`) y el resto en el array `cronograma`, numerado desde 1.
 *   El resultado son dos numeraciones desfasadas en uno: el despacho de la
 *   entrega 2 apunta a `cronograma.nro = 1`.
 *
 *   Acá todas son documentos de `entregas`, numeradas 1..N sin huecos.
 *
 * -----------------------------------------------------------------------------
 * SIEMPRE HAY AL MENOS UNA
 * -----------------------------------------------------------------------------
 *   Si el comercial no carga cronograma, se crea una sola con el volumen total
 *   y la fecha comprometida. Un pedido sin entregas no tendría a qué asociar el
 *   despacho, y el estado derivado no funcionaría.
 * ========================================================================== */

import { doc, collection, getDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { enTransaccion, calcularDiferencias } from './datos';
import { despachoVivo, ENTREGA, VIAJE } from './estados';
import { cancelarDespacho, leerContextoPedido } from './logica-despachos';

/* -----------------------------------------------------------------------------
 * Constantes del dominio
 * -------------------------------------------------------------------------- */

/**
 * Los tres tipos de operación, y de dónde sale cada punta.
 *
 * Hoy el pedido tiene un solo lugar, y cuando el tipo es "Entrega en planta" se
 * escribe la dirección de Explora hardcodeada en el código. Con las dos puntas
 * explícitas los tres casos quedan uniformes, y el modelo queda listo para las
 * órdenes de compra sin tocarlo.
 */
export const TIPOS = {
  'Entrega al cliente': {
    origen: 'propia',    // la planta de Explora
    destino: 'cliente',
  },
  'Entrega en planta': {
    origen: 'cliente',
    destino: 'propia',
  },
  'Retiro de Proveedores': {
    origen: 'cliente',   // el proveedor, que en el modelo es una organización
    destino: 'propia',
  },
};

export const RECIPIENTES = ['Granel', 'IBC', 'Tambor', 'Bidón'];

export const BANDAS_HORARIAS = [
  'Mañana (6-12hs)',
  'Tarde (12-18hs)',
  'Noche (18-24hs)',
  'A confirmar',
];

/* -----------------------------------------------------------------------------
 * Utilidades de fecha
 *
 * Las fechas de entrega son de CALENDARIO, no instantes: "el 20 de agosto", no
 * "el 20 de agosto a las 00:00 de tal zona horaria". Por eso se guardan como
 * string `YYYY-MM-DD`. Como Timestamp quedarían atadas a una zona y aparecerían
 * corridas un día según dónde se las mire.
 * -------------------------------------------------------------------------- */

/** Hoy, como `YYYY-MM-DD` en horario local. */
export function hoyISO() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** ¿Es anterior a hoy? Comparación de strings: `YYYY-MM-DD` ordena bien. */
export function esFechaPasada(iso) {
  return !!iso && iso < hoyISO();
}

/* -----------------------------------------------------------------------------
 * Validación
 * -------------------------------------------------------------------------- */

/**
 * Valida un pedido antes de crearlo. Devuelve un array de mensajes; vacío si
 * está bien.
 *
 * La usan el formulario y la carga masiva. Una sola implementación.
 *
 * @param {Object} p El pedido a crear
 * @param {Array} p.entregas [{volumen, fecha_solicitada}]
 * @param {Object} contexto
 * @param {Array} contexto.organizaciones para verificar que el cliente exista
 * @param {Array} contexto.productos
 * @param {Array} contexto.domiciliosDelCliente los vinculados al cliente
 * @returns {string[]}
 */
export function validarPedido(p, contexto = {}) {
  const problemas = [];
  const { organizaciones = [], productos = [], domiciliosDelCliente = [] } = contexto;

  /* ── Cliente ────────────────────────────────────────────────────────────── */

  if (!p.cliente_org_id) {
    problemas.push('Elegí el cliente.');
  } else {
    const org = organizaciones.find(o => o.id === p.cliente_org_id);
    if (!org) problemas.push('El cliente elegido no existe.');
    else if (org.estado !== 'activo') problemas.push(`${org.razon_social} está dado de baja.`);
    else if (!org.es_cliente) problemas.push(`${org.razon_social} no está marcada como cliente.`);
  }

  /* ── Producto ───────────────────────────────────────────────────────────── */

  if (!p.producto_id) {
    problemas.push('Elegí el producto.');
  } else {
    const prod = productos.find(x => x.id === p.producto_id);
    if (!prod) problemas.push('El producto elegido no existe.');
    else if (prod.activo === false) problemas.push(`El producto "${prod.nombre}" está desactivado.`);
  }

  /* ── Tipo y domicilios ──────────────────────────────────────────────────── */

  if (!p.tipo || !TIPOS[p.tipo]) {
    problemas.push('Elegí el tipo de operación.');
  }

  if (!p.origen_domicilio_id)  problemas.push('Falta el domicilio de origen.');
  if (!p.destino_domicilio_id) problemas.push('Falta el domicilio de destino.');

  // El domicilio del cliente tiene que ser uno de los suyos. No se crean al
  // vuelo: es la regla que evita que se repita lo de hoy, 50 direcciones
  // distintas para 34 lugares reales.
  const config = TIPOS[p.tipo];
  if (config && domiciliosDelCliente.length > 0) {
    const idCliente = config.destino === 'cliente' ? p.destino_domicilio_id : p.origen_domicilio_id;
    if (idCliente && !domiciliosDelCliente.some(d => d.id === idCliente)) {
      problemas.push('El domicilio elegido no es uno de los del cliente.');
    }
  }

  /* ── OV / OC ────────────────────────────────────────────────────────────── */

  const numeroOV = String(p.ov_numero || '').trim();
  if (!numeroOV) {
    problemas.push('Falta el número de orden.');
  } else if (p.ov_tipo === 'OV' && !/^\d{4}$/.test(numeroOV)) {
    problemas.push('El número de OV tiene que tener exactamente 4 dígitos.');
  } else if (p.ov_tipo === 'OC' && !/^\d{5}$/.test(numeroOV)) {
    problemas.push('El número de OC tiene que tener exactamente 5 dígitos.');
  }

  /* ── Volumen ────────────────────────────────────────────────────────────── */

  const volumen = Number(p.volumen);
  if (!volumen || volumen <= 0) {
    problemas.push('El volumen tiene que ser mayor que cero.');
  }

  /* ── Entregas ───────────────────────────────────────────────────────────── */

  const entregas = p.entregas || [];

  if (entregas.length === 0) {
    problemas.push('Cargá al menos una entrega.');
  }

  entregas.forEach((e, i) => {
    const n = i + 1;
    if (!Number(e.volumen) || Number(e.volumen) <= 0) {
      problemas.push(`Entrega ${n}: el volumen tiene que ser mayor que cero.`);
    }
    if (!e.fecha_solicitada) {
      problemas.push(`Entrega ${n}: falta la fecha.`);
    } else if (esFechaPasada(e.fecha_solicitada)) {
      problemas.push(`Entrega ${n}: la fecha no puede ser anterior a hoy.`);
    }

    // Dirección por entrega -- SOLO para "Entrega al cliente". Los otros dos
    // tipos ("Entrega en planta", "Retiro de Proveedores") no están
    // modelados con más de un punto todavía: siguen usando el domicilio del
    // pedido, sin que la entrega tenga ninguno propio.
    if (config && config.destino === 'cliente' && domiciliosDelCliente.length > 0) {
      const idEntrega = e.destino_domicilio_id || p.destino_domicilio_id;
      if (idEntrega && !domiciliosDelCliente.some(d => d.id === idEntrega)) {
        problemas.push(`Entrega ${n}: el domicilio elegido no es uno de los del cliente.`);
      }
    }
  });

  // Esto hoy NO se valida, y por eso hay pedidos donde el cronograma no suma el
  // volumen del pedido. Sin esta comprobación, el coordinador se queda sin
  // entregas que cubrir antes de completar el volumen, o le sobran.
  if (volumen > 0 && entregas.length > 0) {
    const suma = entregas.reduce((s, e) => s + Number(e.volumen || 0), 0);
    if (Math.abs(suma - volumen) > 0.001) {
      problemas.push(
        `Las entregas suman ${suma} y el pedido es de ${volumen}. Tienen que dar igual.`
      );
    }
  }

  return problemas;
}

/* -----------------------------------------------------------------------------
 * Creación
 * -------------------------------------------------------------------------- */

/**
 * El número siguiente de pedido, leído y escrito dentro de la transacción.
 *
 * Reemplaza al `Math.random()*900+100` de `genNro()`. Ese genera 900 valores
 * por día sin verificar que no existan: con 40 pedidos en un día la
 * probabilidad de repetir supera el 50%. Y el Apps Script identifica el pedido
 * por ese número en el Plan de Producción, así que dos iguales se pisan la
 * fila.
 */
async function siguienteNumero(tx) {
  const ref = doc(db, 'contadores', 'pedidos');
  const snap = await tx.get(ref);

  const ultimo = snap.exists() ? Number(snap.data().ultimo || 0) : 0;
  const nuevo = ultimo + 1;

  tx.set(ref, { ultimo: nuevo }, { merge: true });

  const anio = new Date().getFullYear();
  return { numero: `PED-${anio}-${String(nuevo).padStart(6, '0')}`, contador: nuevo };
}

/**
 * Crea un pedido con sus entregas, en una transacción.
 *
 * Todo junto o nada: un pedido sin entregas no tendría a qué asociar el
 * despacho, y el coordinador lo vería sin poder hacer nada.
 *
 * @param {Object} params
 * @param {Object} params.pedido Campos del pedido, ya validados
 * @param {Array} params.entregas [{volumen, fecha_solicitada}]
 * @param {Object} params.usuario La sesión
 * @param {string} [params.origenCarga] 'manual' | 'carga_masiva'
 * @returns {Promise<{id: string, numero: string}>}
 */
export async function crearPedido({ pedido, entregas, usuario, origenCarga = 'manual' }) {
  return enTransaccion(async (tx, anotar) => {
    /* ── Lecturas primero: Firestore lo exige ────────────────────────────── */

    const { numero } = await siguienteNumero(tx);

    /* ── Escrituras ──────────────────────────────────────────────────────── */

    const refPedido = doc(collection(db, 'pedidos'));

    const datosPedido = {
      numero,
      origen_carga: origenCarga,
      // `clase` distingue venta de compra. Las órdenes de compra son otro flujo
      // y quedan fuera de alcance, pero el campo va desde ahora: agregarlo
      // después obligaría a migrar todos los pedidos existentes.
      clase: 'venta',

      cliente_org_id: pedido.cliente_org_id,
      ov: pedido.ov,
      tipo: pedido.tipo,
      producto_id: pedido.producto_id,
      recipiente: pedido.recipiente || 'Granel',
      obs: pedido.obs || '',

      volumen: Number(pedido.volumen),
      // Se guarda el original para poder detectar después que el pedido se
      // editó, sin depender de un booleano que alguien tenga que mantener.
      volumen_original: Number(pedido.volumen),

      origen_domicilio_id: pedido.origen_domicilio_id,
      destino_domicilio_id: pedido.destino_domicilio_id,
      banda_horaria: pedido.banda_horaria || '',

      // NO hay campo `estado`. Se deriva de estos tres contadores —ver
      // `estados.js` para el porqué: el transportista y el chofer no pueden
      // leer `entregas`, así que el estado tiene que poder calcularse sin leer
      // nada, con `increment()` sobre estos números.
      entregas_total: entregas.length,
      entregas_cubiertas: 0,
      entregas_cumplidas: 0,

      suspendido: false,
      suspension_motivo: null,
      suspension_ts: null,

      creado_por_uid: usuario.uid,
      creado_en: serverTimestamp(),
      actualizado_en: serverTimestamp(),
    };

    tx.set(refPedido, datosPedido);

    const refsEntregas = entregas.map(() => doc(collection(db, 'entregas')));

    entregas.forEach((e, i) => {
      const datosEntrega = {
        pedido_id: refPedido.id,
        numero: i + 1,                    // 1..N, sin huecos ni desfasajes
        volumen: Number(e.volumen),
        fecha_solicitada: e.fecha_solicitada,
        estado: 'pendiente',
        creado_en: serverTimestamp(),
        actualizado_en: serverTimestamp(),
      };

      // Dirección por entrega -- SOLO "Entrega al cliente". Si la fila no
      // trae un domicilio propio, hereda el del pedido (que sigue siendo el
      // que se eligió en el form, ahora funcionando como valor por defecto).
      // Para los otros dos tipos, la entrega NO lleva este campo -- el
      // domicilio sigue siendo pura y exclusivamente del pedido, como hoy.
      if (pedido.tipo === 'Entrega al cliente') {
        datosEntrega.destino_domicilio_id = e.destino_domicilio_id || pedido.destino_domicilio_id;
      }

      tx.set(refsEntregas[i], datosEntrega);
    });

    /* ── Historial ───────────────────────────────────────────────────────── */

    // UN solo registro, no uno por entrega: es una sola acción del usuario. El
    // detalle de las entregas va en `despues`.
    anotar({
      entidadTipo: 'pedido',
      entidadId: refPedido.id,
      pedidoId: refPedido.id,
      accion: 'crear_pedido',
      diferencias: calcularDiferencias({}, {
        ...datosPedido,
        entregas: entregas.map((e, i) => ({
          numero: i + 1,
          volumen: Number(e.volumen),
          fecha_solicitada: e.fecha_solicitada,
        })),
      }),
      usuario,
    });

    return { id: refPedido.id, numero };
  }, 1);
}

/* -----------------------------------------------------------------------------
 * Notificación al coordinador
 * -------------------------------------------------------------------------- */

/**
 * Avisa al coordinador que hay un pedido nuevo.
 *
 * NO escribe en el Plan de Producción: eso pasa recién cuando el coordinador
 * acepta una entrega y se crea el despacho.
 *
 * Le llegan los NOMBRES resueltos, nunca los IDs: el script rutea comparando
 * strings contra una lista fija. Si le llegara un ID caería en la columna
 * "Otros", y en silencio, porque el portal llama con `mode: 'no-cors'` y nunca
 * ve la respuesta.
 *
 * Esa llamada a ciegas es un problema conocido y sigue sin resolverse: si el
 * script falla, el portal muestra que notificó igual.
 *
 * @param {string} appsScriptUrl
 * @param {Object} payload con los nombres ya resueltos
 */
// `notificarPedidoNuevo()` vivía acá, con su propio `fetch(..., {mode:
// 'no-cors'})` -- una segunda copia de exactamente lo que hace
// `llamarAppsScript()` en `logica-despachos.js`, sin el fix de D3. Dos
// funciones para la misma llamada de red es la clase de duplicación que ya
// nos mordió una vez con `nuevo_pedido` en el propio Apps Script (`doPost`
// y `doGet` con la misma acción escrita distinto). Se saca; `Pedidos.js`
// ahora llama directo a `llamarAppsScript(url, 'nuevo_pedido', payload)`.

/* -----------------------------------------------------------------------------
 * Suspender
 * -------------------------------------------------------------------------- */

/**
 * Trae los viajes de un pedido, a partir de los IDs de sus despachos.
 *
 * El viaje no referencia al pedido directamente, solo a su despacho —así que
 * no hay forma de hacer `where('pedido_id', '==', ...)` sobre `viajes`—. Con
 * pocos despachos por pedido, un solo `in` alcanza siempre: el límite de
 * Firestore es 30.
 */
async function leerViajesDePedido(despachoIds) {
  if (despachoIds.length === 0) return [];
  const snap = await getDocs(query(collection(db, 'viajes'), where('despacho_id', 'in', despachoIds)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Suspende un pedido. **Es terminal** — suspender y cancelar son lo mismo, no
 * hay "reactivar el pedido"; si algo se cargó mal, se crea uno nuevo.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ REUTILIZA `cancelarDespacho()` EN VEZ DE REIMPLEMENTAR LA CASCADA
 * -----------------------------------------------------------------------------
 *   Cancelar cada despacho vivo, recalcular su entrega y mover los contadores
 *   del pedido es exactamente lo que ya hace `cancelarDespacho()` para el
 *   coordinador que cancela uno a mano. Reescribir esa lógica acá sería la
 *   misma cascada mantenida en dos lugares — el problema que `estados.js`
 *   existe para evitar.
 *
 *   Por eso esto NO es una única transacción gigante: recorre los despachos
 *   vivos y cancela cada uno con su propia transacción (la de siempre), y
 *   recién al final hace una transacción propia para marcar las entregas
 *   `suspendida` y el pedido `suspendido: true` — las dos cosas que cancelar
 *   despachos uno por uno no sabe hacer, porque no sabe que el pedido entero
 *   se está por suspender.
 *
 *   Consecuencia: si se corta a mitad de camino (se fue la conexión después
 *   de cancelar 2 de 4 despachos), reintentar es seguro. Vuelve a leer el
 *   contexto, los 2 ya cancelados no aparecen como `despachoVivo`, y sigue
 *   con los otros 2.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NO HACE FALTA REFRESCAR `despachos` ENTRE UNA CANCELACIÓN Y LA SIGUIENTE
 * -----------------------------------------------------------------------------
 *   Se le pasa a `cancelarDespacho()` el mismo array `despachos` leído al
 *   principio, sin releerlo en cada vuelta del `for`. Eso es seguro porque una
 *   entrega tiene UN SOLO despacho vivo a la vez —es una regla del modelo, no
 *   un supuesto—, así que cancelar el despacho de una entrega no cambia lo que
 *   hace falta saber para calcular el estado de OTRA entrega distinta. Que un
 *   pedido tenga varias entregas con transportistas distintos cada una es
 *   normal y no afecta esto para nada: cada una se recalcula mirando solo sus
 *   propios despachos.
 *
 * -----------------------------------------------------------------------------
 * EL AVISO AL TRANSPORTISTA
 * -----------------------------------------------------------------------------
 *   No lo hace esta función directamente: lo hace `cancelarDespacho()`, que
 *   escribe un `avisos/{id}` dentro de su propia transacción por cada despacho
 *   que cancela. Esto reemplaza al plan original de notificar por Apps Script
 *   —`cancelar_despacho`, que iba a vivir del lado del script—: es una
 *   colección más de Firestore, sin Cloud Functions, coherente con cómo está
 *   armado todo lo demás. `MisDespachos.js` es quien la muestra.
 *
 * @param {Object} params
 * @param {string} params.pedidoId
 * @param {string} params.motivo Obligatorio: es lo único que le va a quedar
 *   al transportista para entender por qué se le cayó el despacho.
 * @param {Object} params.usuario
 * @returns {Promise<{yaEstaba: boolean, avisosApps?: string[]}>} `avisosApps`
 *   son los despachos cuyo aviso al Apps Script (D3) falló -- la cancelación
 *   en Firestore de todas formas se hizo bien.
 */
export async function suspenderPedido({ pedidoId, motivo, usuario, appsScriptUrl = null }) {
  if (!motivo || !motivo.trim()) {
    throw new Error('El motivo es obligatorio.');
  }
  const motivoLimpio = motivo.trim();

  const { entregas, despachos } = await leerContextoPedido(pedidoId);
  const viajes = await leerViajesDePedido(despachos.map(d => d.id));

  if (viajes.some(v => v.estado === VIAJE.EN_VIAJE)) {
    throw new Error(
      'Hay un chofer en viaje sobre este pedido. Hay que esperar a que cierre '
      + '—o cerrarlo a mano desde Programación— antes de poder suspender.'
    );
  }

  const refPedido = doc(db, 'pedidos', pedidoId);
  const snapPrevio = await getDoc(refPedido);
  if (!snapPrevio.exists()) throw new Error('El pedido ya no existe.');
  if (snapPrevio.data().suspendido) return { yaEstaba: true };

  const pedidoBase = { id: pedidoId, ...snapPrevio.data() };

  // Cancela cada despacho vivo con la función de siempre. Uno por uno, no en
  // paralelo: son transacciones independientes sobre el mismo pedido, y
  // dispararlas todas juntas multiplicaría los reintentos por choque.
  const vivos = despachos.filter(despachoVivo);
  const avisosApps = [];
  for (const d of vivos) {
    const viaje = viajes.find(v => v.despacho_id === d.id) || null;
    const r = await cancelarDespacho({
      pedido: pedidoBase,
      despacho: d,
      viaje,
      entregas,
      despachos,
      motivo: `Pedido suspendido: ${motivoLimpio}`,
      usuario,
      appsScriptUrl,
    });
    if (r.avisoApps) avisosApps.push(r.avisoApps);
  }

  // Ahora sí, la parte que cancelar despachos uno por uno no hace: marcar el
  // pedido y dejar `suspendida` a cada entrega que no llegó a cumplirse.
  return enTransaccion(async (tx, anotar) => {
    const refsEntregas = entregas.map(e => doc(db, 'entregas', e.id));

    // TODAS las lecturas antes que cualquier escritura — Firestore lo exige.
    const [snapPedido, ...snapsEntregas] = await Promise.all([
      tx.get(refPedido),
      ...refsEntregas.map(r => tx.get(r)),
    ]);

    if (!snapPedido.exists()) throw new Error('El pedido ya no existe.');
    const actual = { id: pedidoId, ...snapPedido.data() };
    if (actual.suspendido) return { yaEstaba: true };

    const cambiosPedido = {
      suspendido: true,
      suspension_motivo: motivoLimpio,
      suspension_ts: serverTimestamp(),
      actualizado_en: serverTimestamp(),
    };
    tx.update(refPedido, cambiosPedido);

    anotar({
      entidadTipo: 'pedido',
      entidadId: pedidoId,
      pedidoId,
      accion: 'suspender_pedido',
      diferencias: calcularDiferencias(actual, cambiosPedido),
      usuario,
      razon: motivoLimpio,
    });

    // Las entregas cumplidas y sus despachos entregados NO se tocan: esos
    // camiones ya fueron. Las que ya estaban `suspendida` —de una edición de
    // volumen anterior— tampoco: no hay nada que cambiarles.
    snapsEntregas.forEach((snapEntrega, i) => {
      if (!snapEntrega.exists()) return;
      const datosActuales = snapEntrega.data();
      if (datosActuales.estado === ENTREGA.CUMPLIDA) return;
      if (datosActuales.estado === ENTREGA.SUSPENDIDA) return;

      const entregaAntes = { id: entregas[i].id, ...datosActuales };
      const cambiosEntrega = { estado: ENTREGA.SUSPENDIDA, actualizado_en: serverTimestamp() };
      tx.update(refsEntregas[i], cambiosEntrega);

      anotar({
        entidadTipo: 'entrega',
        entidadId: entregaAntes.id,
        pedidoId,
        accion: 'suspender_entrega',
        diferencias: calcularDiferencias(entregaAntes, cambiosEntrega),
        usuario,
        razon: motivoLimpio,
        derivado: true,
      });
    });

    return { yaEstaba: false, avisosApps };
  }, 3);
}

/* -----------------------------------------------------------------------------
 * Editar el domicilio
 * -------------------------------------------------------------------------- */

/**
 * Cambia el domicilio de destino de un pedido.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ NO CANCELA LOS DESPACHOS
 * -----------------------------------------------------------------------------
 *   El camión, el chofer y el día siguen siendo los mismos: lo único que
 *   cambia es a dónde va. Cancelar y volver a armar todo por una dirección
 *   sería perder un despacho ya aceptado o nominado sin ninguna razón real.
 *
 *   Alcanza con actualizar el `destino_texto` denormalizado — en el despacho,
 *   para el transportista, y en el viaje, para el chofer. Esto YA estaba
 *   previsto en el diseño original de `viajes`: sus campos denormalizados
 *   "no cambian, salvo `destino_texto` si el comercial cambia el domicilio
 *   antes de que arranque". No es una excepción nueva, es completar algo que
 *   ya estaba pensado.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SE BLOQUEA UNA VEZ QUE ALGÚN CHOFER ARRANCÓ
 * -----------------------------------------------------------------------------
 *   Si el camión ya salió hacia la dirección vieja, cambiarla en el papel no
 *   lo hace ir a otro lado. Se bloquea el pedido ENTERO, no solo ese
 *   despacho: mezclar direcciones distintas en despachos del mismo pedido es
 *   más confuso que frenar y resolverlo a mano.
 *
 * -----------------------------------------------------------------------------
 * A QUIÉN SE AVISA, Y A QUIÉN NO
 * -----------------------------------------------------------------------------
 *   A cada transportista con un despacho vivo, y a cada chofer nominado que
 *   todavía no arrancó (`viaje.estado === RECIBIDO`) — son los dos que
 *   verían la dirección vieja en su pantalla si nadie les avisa.
 *
 *   A los coordinadores NO: ven el cambio en vivo apenas entran al pedido, y
 *   queda en el historial (A6, `PENDIENTES.md`). Un aviso para quien ya tiene
 *   visibilidad completa sería ruido, no información.
 *
 * @param {Object} params
 * @param {string} params.pedidoId
 * @param {string} params.nuevoDomicilioId
 * @param {string} params.nuevoDestinoTexto El texto ya resuelto — esta
 *   función no lee `domicilios`, igual que `crearPedido` no lo hacía.
 * @param {Object} params.usuario
 * @returns {Promise<{cambio: boolean}>}
 */
export async function editarDomicilioPedido({
  pedidoId, nuevoDomicilioId, nuevoDestinoTexto, usuario,
}) {
  const { despachos } = await leerContextoPedido(pedidoId);
  const viajes = await leerViajesDePedido(despachos.map(d => d.id));

  if (viajes.some(v => v.estado === VIAJE.EN_VIAJE || v.estado === VIAJE.FINALIZADO)) {
    throw new Error(
      'Hay un chofer que ya arrancó o cerró un viaje de este pedido. La '
      + 'dirección no se puede cambiar a esta altura: el camión ya salió '
      + 'hacia la de antes.'
    );
  }

  const vivos = despachos.filter(despachoVivo);
  const viajesRecibidos = viajes.filter(v => v.estado === VIAJE.RECIBIDO);

  return enTransaccion(async (tx, anotar) => {
    const refPedido = doc(db, 'pedidos', pedidoId);
    const refsDespachos = vivos.map(d => doc(db, 'despachos', d.id));
    const refsViajes = viajesRecibidos.map(v => doc(db, 'viajes', v.id));

    // TODAS las lecturas antes que cualquier escritura — Firestore lo exige.
    const [snapPedido, ...resto] = await Promise.all([
      tx.get(refPedido),
      ...refsDespachos.map(r => tx.get(r)),
      ...refsViajes.map(r => tx.get(r)),
    ]);
    const snapsDespachos = resto.slice(0, refsDespachos.length);
    const snapsViajes = resto.slice(refsDespachos.length);

    if (!snapPedido.exists()) throw new Error('El pedido ya no existe.');
    const pedidoActual = { id: pedidoId, ...snapPedido.data() };
    if (pedidoActual.suspendido) throw new Error('El pedido está suspendido.');
    if (pedidoActual.destino_domicilio_id === nuevoDomicilioId) return { cambio: false };

    const cambiosPedido = {
      destino_domicilio_id: nuevoDomicilioId,
      actualizado_en: serverTimestamp(),
    };
    tx.update(refPedido, cambiosPedido);
    anotar({
      entidadTipo: 'pedido',
      entidadId: pedidoId,
      pedidoId,
      accion: 'editar_domicilio_pedido',
      diferencias: calcularDiferencias(pedidoActual, cambiosPedido),
      usuario,
    });

    // Un aviso por transportista y uno por chofer, no uno por despacho: si
    // una empresa tiene dos despachos vivos en el mismo pedido, no hace falta
    // mandarle el mismo aviso dos veces.
    const orgsAvisadas = new Set();
    const dnisAvisados = new Set();

    snapsDespachos.forEach((snapD, i) => {
      if (!snapD.exists()) return;
      const dAntes = { id: vivos[i].id, ...snapD.data() };
      if (dAntes.destino_texto === nuevoDestinoTexto) return;

      const cambiosD = { destino_texto: nuevoDestinoTexto, actualizado_en: serverTimestamp() };
      tx.update(refsDespachos[i], cambiosD);
      anotar({
        entidadTipo: 'despacho',
        entidadId: dAntes.id,
        pedidoId,
        accion: 'actualizar_destino_denormalizado',
        diferencias: calcularDiferencias(dAntes, cambiosD),
        usuario,
        derivado: true,
      });

      if (dAntes.transportista_org_id && !orgsAvisadas.has(dAntes.transportista_org_id)) {
        orgsAvisadas.add(dAntes.transportista_org_id);
        tx.set(doc(collection(db, 'avisos')), {
          destinatario_org_id: dAntes.transportista_org_id,
          destinatario_chofer_dni: null,
          tipo: 'domicilio_cambiado',
          titulo: `Cambió el destino del pedido ${pedidoActual.numero}`,
          mensaje: `El destino del pedido ${pedidoActual.numero} cambió a: ${nuevoDestinoTexto}`,
          pedido_id: pedidoId,
          despacho_id: dAntes.id,
          leido: false,
          creado_en: serverTimestamp(),
        });
      }
    });

    snapsViajes.forEach((snapV, i) => {
      if (!snapV.exists()) return;
      const vAntes = { id: viajesRecibidos[i].id, ...snapV.data() };
      if (vAntes.destino_texto === nuevoDestinoTexto) return;

      const cambiosV = { destino_texto: nuevoDestinoTexto };
      tx.update(refsViajes[i], cambiosV);
      anotar({
        entidadTipo: 'viaje',
        entidadId: vAntes.id,
        pedidoId,
        accion: 'actualizar_destino_denormalizado',
        diferencias: calcularDiferencias(vAntes, cambiosV),
        usuario,
        derivado: true,
      });

      if (vAntes.chofer_dni && !dnisAvisados.has(vAntes.chofer_dni)) {
        dnisAvisados.add(vAntes.chofer_dni);
        tx.set(doc(collection(db, 'avisos')), {
          destinatario_org_id: null,
          destinatario_chofer_dni: vAntes.chofer_dni,
          tipo: 'domicilio_cambiado',
          titulo: 'Cambió el destino de tu próximo viaje',
          mensaje: `El destino de tu próximo viaje (pedido ${pedidoActual.numero}) cambió a: ${nuevoDestinoTexto}`,
          pedido_id: pedidoId,
          despacho_id: vAntes.despacho_id,
          leido: false,
          creado_en: serverTimestamp(),
        });
      }
    });

    return { cambio: true };
  }, 3);
}

/* -----------------------------------------------------------------------------
 * Editar el domicilio de UNA entrega — solo "Entrega al cliente"
 * -------------------------------------------------------------------------- */

/**
 * La hermana de `editarDomicilioPedido()`, a nivel entrega.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ EXISTE APARTE, EN VEZ DE GENERALIZAR LA DE ARRIBA
 * -----------------------------------------------------------------------------
 *   `editarDomicilioPedido()` cambia UN domicilio que es del PEDIDO entero, y
 *   por eso recorre TODOS sus despachos vivos — cualquiera de ellos podía
 *   estar yendo a esa dirección. Acá el domicilio es de UNA sola entrega, así
 *   que como mucho hay UN despacho para tocar (el de esa entrega puntual, si
 *   existe y sigue vivo) — no hace falta ningún bucle ni ningún `Set` para
 *   no avisar dos veces a la misma empresa.
 *
 *   Fusionar las dos en una sola función con un parámetro "a nivel de qué"
 *   hubiera dejado un branching más difícil de leer que tener dos
 *   funciones chicas y directas.
 *
 * -----------------------------------------------------------------------------
 * SOLO APLICA A "Entrega al cliente"
 * -----------------------------------------------------------------------------
 *   Es la única alcance que se modeló: un cliente que recibe en distintas
 *   sucursales dentro del mismo pedido. "Entrega en planta" y "Retiro de
 *   Proveedores" no tienen todavía un caso real de más de un punto por
 *   pedido, así que sus entregas no llevan `destino_domicilio_id` propio —
 *   siguen usando el del pedido, vía `editarDomicilioPedido()`.
 *
 * @param {Object} params
 * @param {string} params.pedidoId
 * @param {string} params.entregaId
 * @param {string} params.nuevoDomicilioId
 * @param {string} params.nuevoDestinoTexto El texto ya resuelto.
 * @param {Object} params.usuario
 * @returns {Promise<{cambio: boolean}>}
 */
export async function editarDestinoEntrega({
  pedidoId, entregaId, nuevoDomicilioId, nuevoDestinoTexto, usuario,
}) {
  const { despachos } = await leerContextoPedido(pedidoId);
  const despachoDeEntrega = despachos.find(d => d.entrega_id === entregaId && despachoVivo(d));
  const viajes = despachoDeEntrega ? await leerViajesDePedido([despachoDeEntrega.id]) : [];
  const viaje = viajes[0] || null;

  if (viaje && (viaje.estado === VIAJE.EN_VIAJE || viaje.estado === VIAJE.FINALIZADO)) {
    throw new Error(
      'El chofer ya arrancó o cerró el viaje de esta entrega. La dirección '
      + 'no se puede cambiar a esta altura: el camión ya salió hacia la de antes.'
    );
  }

  return enTransaccion(async (tx, anotar) => {
    const refEntrega = doc(db, 'entregas', entregaId);
    const refDespacho = despachoDeEntrega ? doc(db, 'despachos', despachoDeEntrega.id) : null;
    const refViaje = (viaje && viaje.estado === VIAJE.RECIBIDO) ? doc(db, 'viajes', viaje.id) : null;

    // TODAS las lecturas antes que cualquier escritura.
    const [snapEntrega, snapDespacho, snapViaje] = await Promise.all([
      tx.get(refEntrega),
      refDespacho ? tx.get(refDespacho) : Promise.resolve(null),
      refViaje ? tx.get(refViaje) : Promise.resolve(null),
    ]);

    if (!snapEntrega.exists()) throw new Error('La entrega ya no existe.');
    const entregaActual = { id: entregaId, ...snapEntrega.data() };
    if (entregaActual.destino_domicilio_id === nuevoDomicilioId) return { cambio: false };

    const cambiosEntrega = {
      destino_domicilio_id: nuevoDomicilioId,
      actualizado_en: serverTimestamp(),
    };
    tx.update(refEntrega, cambiosEntrega);
    anotar({
      entidadTipo: 'entrega',
      entidadId: entregaId,
      pedidoId,
      accion: 'editar_domicilio_entrega',
      diferencias: calcularDiferencias(entregaActual, cambiosEntrega),
      usuario,
    });

    if (refDespacho && snapDespacho && snapDespacho.exists()) {
      const dAntes = { id: despachoDeEntrega.id, ...snapDespacho.data() };
      if (dAntes.destino_texto !== nuevoDestinoTexto) {
        const cambiosD = { destino_texto: nuevoDestinoTexto, actualizado_en: serverTimestamp() };
        tx.update(refDespacho, cambiosD);
        anotar({
          entidadTipo: 'despacho',
          entidadId: dAntes.id,
          pedidoId,
          accion: 'actualizar_destino_denormalizado',
          diferencias: calcularDiferencias(dAntes, cambiosD),
          usuario,
          derivado: true,
        });

        if (dAntes.transportista_org_id) {
          tx.set(doc(collection(db, 'avisos')), {
            destinatario_org_id: dAntes.transportista_org_id,
            destinatario_chofer_dni: null,
            tipo: 'domicilio_cambiado',
            titulo: `Cambió el destino de una entrega del pedido ${pedidoId}`,
            mensaje: `El destino de la entrega cambió a: ${nuevoDestinoTexto}`,
            pedido_id: pedidoId,
            despacho_id: dAntes.id,
            leido: false,
            creado_en: serverTimestamp(),
          });
        }
      }
    }

    if (refViaje && snapViaje && snapViaje.exists()) {
      const vAntes = { id: viaje.id, ...snapViaje.data() };
      if (vAntes.destino_texto !== nuevoDestinoTexto) {
        const cambiosV = { destino_texto: nuevoDestinoTexto };
        tx.update(refViaje, cambiosV);
        anotar({
          entidadTipo: 'viaje',
          entidadId: vAntes.id,
          pedidoId,
          accion: 'actualizar_destino_denormalizado',
          diferencias: calcularDiferencias(vAntes, cambiosV),
          usuario,
          derivado: true,
        });

        if (vAntes.chofer_dni) {
          tx.set(doc(collection(db, 'avisos')), {
            destinatario_org_id: null,
            destinatario_chofer_dni: vAntes.chofer_dni,
            tipo: 'domicilio_cambiado',
            titulo: 'Cambió el destino de tu próximo viaje',
            mensaje: `El destino de tu próximo viaje cambió a: ${nuevoDestinoTexto}`,
            pedido_id: pedidoId,
            despacho_id: vAntes.despacho_id,
            leido: false,
            creado_en: serverTimestamp(),
          });
        }
      }
    }

    return { cambio: true };
  }, 3);
}

/**
 * Cambia la fecha solicitada de UNA entrega.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SÍ CANCELA EL DESPACHO (a diferencia del domicilio)
 * -----------------------------------------------------------------------------
 *   El camión estaba programado para cargar ESE día. Cambiar la fecha por
 *   debajo de un despacho ya aceptado o nominado dejaría a un transportista
 *   comprometido con un día que ya no es el que se le pidió, sin que nadie se
 *   lo haya dicho. Cancelar y que el coordinador vuelva a programar es más
 *   claro que arrastrar una fecha vieja en un despacho que sigue vivo.
 *
 * -----------------------------------------------------------------------------
 * DOS TRANSACCIONES, NO UNA
 * -----------------------------------------------------------------------------
 *   La cancelación (si hace falta) reutiliza `cancelarDespacho()` completa —
 *   con su propia transacción, su propio recálculo de contadores y su propio
 *   aviso al transportista, igual que en `suspenderPedido()` y
 *   `editarDomicilioPedido()`. El cambio de fecha en sí es una transacción
 *   chica aparte: son dos responsabilidades distintas — "este despacho ya no
 *   corre" y "la entrega pasa a tal día" — y ya existe una función completa
 *   para la primera.
 *
 * -----------------------------------------------------------------------------
 * LO QUE FALTA DEL LADO DEL APPS SCRIPT
 * -----------------------------------------------------------------------------
 *   `cancelarDespacho()` no le avisa al Apps Script que hay que sacarle el
 *   volumen y la nota a la celda del Plan de Producción — eso es
 *   `borrar_despacho`, que está escrito pero todavía no conectado (se está
 *   probando aparte, a pedido). Hasta que se conecte, cancelar acá deja la
 *   fila del Plan con un volumen que ya no corresponde. Ver `PENDIENTES.md`.
 *
 * @param {Object} params
 * @param {string} params.pedidoId
 * @param {string} params.entregaId
 * @param {string} params.nuevaFecha `YYYY-MM-DD`
 * @param {Object} params.usuario
 * @returns {Promise<{cambio: boolean, despachoCancelado: boolean, avisoApps: string|null}>}
 */
export async function editarFechaEntrega({
  pedidoId, entregaId, nuevaFecha, usuario, appsScriptUrl = null,
}) {
  if (!nuevaFecha) throw new Error('La fecha es obligatoria.');
  if (esFechaPasada(nuevaFecha)) throw new Error('La fecha no puede ser anterior a hoy.');

  const { entregas, despachos } = await leerContextoPedido(pedidoId);
  const entrega = entregas.find(e => e.id === entregaId);
  if (!entrega) throw new Error('La entrega ya no existe. Actualizá la página.');

  if (entrega.estado === ENTREGA.CUMPLIDA) {
    throw new Error('Esa entrega ya se cumplió. No se puede cambiar la fecha de algo que ya pasó.');
  }
  if (entrega.estado === ENTREGA.SUSPENDIDA) {
    throw new Error('Esa entrega está suspendida. Reactivala primero.');
  }
  if (entrega.fecha_solicitada === nuevaFecha) {
    return { cambio: false, despachoCancelado: false };
  }

  const despachoDeEntrega = despachos.find(d => d.entrega_id === entregaId && despachoVivo(d));

  let despachoCancelado = false;
  let avisoApps = null;
  if (despachoDeEntrega) {
    const viajes = await leerViajesDePedido([despachoDeEntrega.id]);
    const viaje = viajes[0] || null;

    // Misma restricción que cancelar solo: si el camión ya salió, cambiar la
    // fecha en el papel no lo hace volver.
    if (viaje && viaje.estado === VIAJE.EN_VIAJE) {
      throw new Error(
        'El chofer ya arrancó el viaje de esta entrega. La fecha no se puede '
        + 'cambiar a esta altura — hay que esperar a que cierre, o cerrarlo a mano.'
      );
    }

    const snapPedido = await getDoc(doc(db, 'pedidos', pedidoId));
    if (!snapPedido.exists()) throw new Error('El pedido ya no existe.');
    const pedidoBase = { id: pedidoId, ...snapPedido.data() };

    const rCancelar = await cancelarDespacho({
      pedido: pedidoBase,
      despacho: despachoDeEntrega,
      viaje,
      entregas,
      despachos,
      motivo: `Cambio de fecha de la entrega ${entrega.numero}: pasa del ${entrega.fecha_solicitada} al ${nuevaFecha}`,
      usuario,
      appsScriptUrl,
    });
    despachoCancelado = true;
    avisoApps = rCancelar.avisoApps || null;
  }

  // El cambio de fecha en sí, en su propia transacción chica.
  return enTransaccion(async (tx, anotar) => {
    const refEntrega = doc(db, 'entregas', entregaId);
    const snap = await tx.get(refEntrega);
    if (!snap.exists()) throw new Error('La entrega ya no existe.');
    const actual = { id: entregaId, ...snap.data() };

    const cambios = { fecha_solicitada: nuevaFecha, actualizado_en: serverTimestamp() };
    tx.update(refEntrega, cambios);

    anotar({
      entidadTipo: 'entrega',
      entidadId: entregaId,
      pedidoId,
      accion: 'editar_fecha_entrega',
      diferencias: calcularDiferencias(actual, cambios),
      usuario,
    });

    return { cambio: true, despachoCancelado, avisoApps };
  }, 1);
}

/* -----------------------------------------------------------------------------
 * Editar el volumen — subir (agregar entregas nuevas)
 * -------------------------------------------------------------------------- */

/**
 * Agrega entregas nuevas a un pedido ya creado.
 *
 * Es la mitad de "editar el volumen" que sube. NUNCA se aumenta el volumen de
 * una entrega existente — se agregan entregas nuevas. Es lo que mantiene
 * válida, siempre, la regla que ya exige `validarPedido()` al crear: que el
 * volumen del pedido sea exactamente la suma de sus entregas.
 *
 * @param {Object} params
 * @param {string} params.pedidoId
 * @param {Array} params.entregasNuevas [{volumen, fecha_solicitada}]
 * @param {Object} params.usuario
 * @returns {Promise<{agregadas: number, volumenAgregado: number}>}
 */
export async function agregarEntregas({ pedidoId, entregasNuevas, usuario }) {
  if (!entregasNuevas || entregasNuevas.length === 0) {
    throw new Error('Cargá al menos una entrega.');
  }

  const problemas = [];
  entregasNuevas.forEach((e, i) => {
    if (!Number(e.volumen) || Number(e.volumen) <= 0) {
      problemas.push(`Entrega nueva ${i + 1}: el volumen tiene que ser mayor que cero.`);
    }
    if (!e.fecha_solicitada) {
      problemas.push(`Entrega nueva ${i + 1}: falta la fecha.`);
    } else if (esFechaPasada(e.fecha_solicitada)) {
      problemas.push(`Entrega nueva ${i + 1}: la fecha no puede ser anterior a hoy.`);
    }
  });
  if (problemas.length > 0) throw new Error(problemas.join(' '));

  const volumenAgregado = entregasNuevas.reduce((s, e) => s + Number(e.volumen), 0);

  // El número de cada entrega sigue desde la mayor existente. Se lee AFUERA
  // de la transacción -- Firestore no permite consultas de colección
  // adentro, solo lecturas por ID -- igual que `siguienteNumero()` para los
  // despachos en `logica-despachos.js`.
  const entregasSnap = await getDocs(query(collection(db, 'entregas'), where('pedido_id', '==', pedidoId)));
  const numerosExistentes = entregasSnap.docs.map(d => Number(d.data().numero) || 0);
  const proximoNumero = (numerosExistentes.length ? Math.max(...numerosExistentes) : 0) + 1;

  return enTransaccion(async (tx, anotar) => {
    const refPedido = doc(db, 'pedidos', pedidoId);
    const snapPedido = await tx.get(refPedido);
    if (!snapPedido.exists()) throw new Error('El pedido ya no existe.');
    const pedidoActual = { id: pedidoId, ...snapPedido.data() };
    if (pedidoActual.suspendido) throw new Error('El pedido está suspendido.');

    const cambiosPedido = {
      volumen: pedidoActual.volumen + volumenAgregado,
      entregas_total: (pedidoActual.entregas_total || 0) + entregasNuevas.length,
      actualizado_en: serverTimestamp(),
    };
    tx.update(refPedido, cambiosPedido);
    anotar({
      entidadTipo: 'pedido',
      entidadId: pedidoId,
      pedidoId,
      accion: 'editar_volumen_subir',
      diferencias: calcularDiferencias(pedidoActual, cambiosPedido),
      usuario,
    });

    entregasNuevas.forEach((e, i) => {
      const refEntrega = doc(collection(db, 'entregas'));
      const datos = {
        pedido_id: pedidoId,
        numero: proximoNumero + i,
        volumen: Number(e.volumen),
        fecha_solicitada: e.fecha_solicitada,
        estado: ENTREGA.PENDIENTE,
        creado_en: serverTimestamp(),
        actualizado_en: serverTimestamp(),
      };
      tx.set(refEntrega, datos);
      anotar({
        entidadTipo: 'entrega',
        entidadId: refEntrega.id,
        pedidoId,
        accion: 'crear_entrega',
        diferencias: calcularDiferencias({}, datos),
        usuario,
        derivado: true,
      });
    });

    return { agregadas: entregasNuevas.length, volumenAgregado };
  }, 1);
}

/* -----------------------------------------------------------------------------
 * Editar el volumen — bajar (suspender entregas pendientes)
 * -------------------------------------------------------------------------- */

/**
 * Suspende una o más entregas PENDIENTES de un pedido.
 *
 * Es la mitad de "editar el volumen" que baja: el comercial elige cuáles, el
 * volumen del pedido baja exactamente lo que sumaban esas entregas, y las
 * que quedan no se tocan.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SOLO PENDIENTES
 * -----------------------------------------------------------------------------
 *   El piso del volumen es la suma de lo ya comprometido (`programada` o
 *   `cumplida`). Un despacho ya aceptado, o un camión que ya entregó, no se
 *   deshace bajando el volumen. Si hace falta bajar más allá de ese piso,
 *   primero hay que cancelar el despacho correspondiente — con "cambiar la
 *   fecha" de esa entrega, o cancelándolo directo desde Programación.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ TOCA `entregas_total`, Y NO SOLO EL VOLUMEN
 * -----------------------------------------------------------------------------
 *   `estadoPedido()` compara `entregas_cumplidas === entregas_total` para
 *   decidir si el pedido llegó a "cumplido". Si una entrega suspendida
 *   siguiera contando en `entregas_total`, el pedido NUNCA podría llegar a
 *   cumplido —esa entrega nunca va a cumplirse—, aunque todo lo demás sí. Por
 *   eso `entregas_total` baja junto con el volumen. `entregas_cubiertas` NO
 *   se toca: una entrega `pendiente` nunca contaba ahí.
 *
 * @param {Object} params
 * @param {string} params.pedidoId
 * @param {string[]} params.entregaIds
 * @param {string} params.motivo
 * @param {Object} params.usuario
 * @returns {Promise<{suspendidas: number, volumenQuitado: number}>}
 */
export async function suspenderEntregas({ pedidoId, entregaIds, motivo, usuario }) {
  if (!entregaIds || entregaIds.length === 0) {
    throw new Error('Elegí al menos una entrega.');
  }
  if (!motivo || !motivo.trim()) {
    throw new Error('El motivo es obligatorio.');
  }
  const motivoLimpio = motivo.trim();

  return enTransaccion(async (tx, anotar) => {
    const refPedido = doc(db, 'pedidos', pedidoId);
    const refsEntregas = entregaIds.map(id => doc(db, 'entregas', id));

    // TODAS las lecturas antes que cualquier escritura.
    const [snapPedido, ...snapsEntregas] = await Promise.all([
      tx.get(refPedido),
      ...refsEntregas.map(r => tx.get(r)),
    ]);

    if (!snapPedido.exists()) throw new Error('El pedido ya no existe.');
    const pedidoActual = { id: pedidoId, ...snapPedido.data() };
    if (pedidoActual.suspendido) throw new Error('El pedido está suspendido.');

    let volumenQuitado = 0;
    const entregasParaSuspender = [];

    snapsEntregas.forEach((snap, i) => {
      if (!snap.exists()) throw new Error('Una de las entregas ya no existe. Actualizá la página.');
      const e = { id: entregaIds[i], ...snap.data() };
      if (e.estado !== ENTREGA.PENDIENTE) {
        throw new Error(
          `La entrega ${e.numero} está en "${e.estado}", no en "pendiente" — `
          + 'solo se pueden suspender las que todavía no tienen despacho.'
        );
      }
      volumenQuitado += Number(e.volumen) || 0;
      entregasParaSuspender.push(e);
    });

    const cambiosPedido = {
      volumen: pedidoActual.volumen - volumenQuitado,
      entregas_total: (pedidoActual.entregas_total || 0) - entregasParaSuspender.length,
      actualizado_en: serverTimestamp(),
    };
    tx.update(refPedido, cambiosPedido);
    anotar({
      entidadTipo: 'pedido',
      entidadId: pedidoId,
      pedidoId,
      accion: 'editar_volumen_bajar',
      diferencias: calcularDiferencias(pedidoActual, cambiosPedido),
      usuario,
      razon: motivoLimpio,
    });

    entregasParaSuspender.forEach((e, i) => {
      const cambiosEntrega = { estado: ENTREGA.SUSPENDIDA, actualizado_en: serverTimestamp() };
      tx.update(refsEntregas[i], cambiosEntrega);
      anotar({
        entidadTipo: 'entrega',
        entidadId: e.id,
        pedidoId,
        accion: 'suspender_entrega',
        diferencias: calcularDiferencias(e, cambiosEntrega),
        usuario,
        razon: motivoLimpio,
      });
    });

    return { suspendidas: entregasParaSuspender.length, volumenQuitado };
  }, 3);
}

/* -----------------------------------------------------------------------------
 * A3 — Reactivar una entrega suspendida
 * -------------------------------------------------------------------------- */

/**
 * Vuelve una entrega `suspendida` a `pendiente`.
 *
 * Es la vuelta atrás de `suspenderEntregas()`: le devuelve al pedido el
 * volumen y el lugar en `entregas_total` que le había sacado, sin tener que
 * crear una entrega nueva ni perder su historial — la entrega sigue siendo
 * la misma, con el mismo número y el mismo `id`.
 *
 * @param {Object} params
 * @param {string} params.pedidoId
 * @param {string} params.entregaId
 * @param {Object} params.usuario
 * @returns {Promise<{cambio: boolean}>}
 */
export async function reactivarEntrega({ pedidoId, entregaId, usuario }) {
  return enTransaccion(async (tx, anotar) => {
    const refPedido = doc(db, 'pedidos', pedidoId);
    const refEntrega = doc(db, 'entregas', entregaId);

    const [snapPedido, snapEntrega] = await Promise.all([tx.get(refPedido), tx.get(refEntrega)]);

    if (!snapPedido.exists()) throw new Error('El pedido ya no existe.');
    if (!snapEntrega.exists()) throw new Error('La entrega ya no existe.');

    const pedidoActual = { id: pedidoId, ...snapPedido.data() };
    const entregaActual = { id: entregaId, ...snapEntrega.data() };

    if (pedidoActual.suspendido) {
      throw new Error(
        'El pedido está suspendido. Reactivar una entrega suelta no tiene '
        + 'efecto — hay que dar de alta un pedido nuevo.'
      );
    }
    if (entregaActual.estado !== ENTREGA.SUSPENDIDA) {
      return { cambio: false };
    }

    const cambiosPedido = {
      volumen: pedidoActual.volumen + (Number(entregaActual.volumen) || 0),
      entregas_total: (pedidoActual.entregas_total || 0) + 1,
      actualizado_en: serverTimestamp(),
    };
    tx.update(refPedido, cambiosPedido);
    anotar({
      entidadTipo: 'pedido',
      entidadId: pedidoId,
      pedidoId,
      accion: 'reactivar_entrega',
      diferencias: calcularDiferencias(pedidoActual, cambiosPedido),
      usuario,
    });

    const cambiosEntrega = { estado: ENTREGA.PENDIENTE, actualizado_en: serverTimestamp() };
    tx.update(refEntrega, cambiosEntrega);
    anotar({
      entidadTipo: 'entrega',
      entidadId: entregaId,
      pedidoId,
      accion: 'reactivar_entrega',
      diferencias: calcularDiferencias(entregaActual, cambiosEntrega),
      usuario,
      derivado: true,
    });

    return { cambio: true };
  }, 3);
}
