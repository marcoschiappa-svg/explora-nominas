/* =============================================================================
 * logica-despachos.js — Las acciones sobre un despacho
 * =============================================================================
 *
 * QUE ES
 *   Aceptar una entrega, asignar transportista, editar y cancelar. Separadas de
 *   la pantalla, como la creación de pedidos, para que haya una sola
 *   implementación de cada regla.
 *
 * -----------------------------------------------------------------------------
 * TODO EN TRANSACCION, Y TODO RELEIDO
 * -----------------------------------------------------------------------------
 *   Cada acción toca varios documentos: el despacho, su entrega y el pedido. Si
 *   se escribieran sueltos y fallara el segundo, quedarían diciendo cosas
 *   distintas y nada lo detectaría.
 *
 *   Y el estado de partida se relee DENTRO de la transacción. Hoy
 *   `Coordinador.js` arma el array de despachos desde el estado de React sin
 *   releer: dos coordinadores sobre el mismo pedido y el segundo pisa al
 *   primero en silencio.
 *
 * -----------------------------------------------------------------------------
 * LOS ESTADOS SE RECALCULAN, NO SE ESCRIBEN A MANO
 * -----------------------------------------------------------------------------
 *   Toda acción que toca un despacho recalcula su entrega, y toda acción que
 *   toca una entrega recalcula el pedido. Siempre con las funciones de
 *   `estados.js`.
 * ========================================================================== */

import {
  doc, collection, getDocs, query, where, serverTimestamp, increment,
} from 'firebase/firestore';

import { db } from './firebase';
import { enTransaccion, calcularDiferencias } from './datos';
import {
  DESPACHO, despachoVivo, estadoEntrega, estadoPedido, deltaContadores,
  puedeAsignar, puedeReasignar, puedeEditar, puedeCancelar,
} from './estados';

/* -----------------------------------------------------------------------------
 * Lectura de contexto
 * -------------------------------------------------------------------------- */

/**
 * Trae las entregas y los despachos de un pedido.
 *
 * Se hace ANTES de la transacción, a propósito: Firestore no permite consultas
 * dentro de una transacción, solo lecturas por ID. Así que el contexto se lee
 * afuera y los documentos que se van a modificar se releen adentro.
 *
 * La ventana entre las dos lecturas es el riesgo conocido: entre que se lee el
 * contexto y se ejecuta la transacción, alguien podría crear otro despacho para
 * la misma entrega. Por eso las validaciones que importan —que la entrega no
 * tenga despacho vivo, que el estado sea el esperado— se repiten adentro sobre
 * los documentos releídos.
 */
export async function leerContextoPedido(pedidoId) {
  const [entregasSnap, despachosSnap] = await Promise.all([
    getDocs(query(collection(db, 'entregas'), where('pedido_id', '==', pedidoId))),
    getDocs(query(collection(db, 'despachos'), where('pedido_id', '==', pedidoId))),
  ]);

  return {
    entregas: entregasSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    despachos: despachosSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  };
}

/**
 * El número visible del despacho siguiente: `"D" + (mayor + 1)`.
 *
 * Se calcula releyendo, no como `length + 1`. Hoy es `'D' + (length + 1)` sobre
 * el array, y eso repite números si alguna vez se borró uno del medio — está
 * documentado en el propio código.
 *
 * El número ya no es la clave del documento, así que un repetido no rompería
 * nada. Pero es lo que la gente lee y lo que va en los mails del Apps Script.
 */
function siguienteNumero(despachos) {
  const numeros = (despachos || [])
    .map(d => parseInt(String(d.numero || '').replace(/\D/g, ''), 10))
    .filter(n => !isNaN(n));

  const mayor = numeros.length ? Math.max(...numeros) : 0;
  return `D${mayor + 1}`;
}

/* -----------------------------------------------------------------------------
 * Recálculo en cascada
 * -------------------------------------------------------------------------- */

/**
 * Recalcula el estado de una entrega y actualiza los CONTADORES del pedido —
 * `estados.js` explica por qué contadores y no derivar leyendo.
 *
 * NO lee las demás entregas del pedido: usa `deltaContadores` para saber
 * cuánto sumar o restar según cómo cambió ESTA entrega, y se lo pasa a
 * `increment()`. Eso es lo que permite que el transportista y el chofer —que
 * no pueden leer `entregas`— también puedan disparar este recálculo.
 *
 * @param {Object} tx la transacción
 * @param {function} anotar
 * @param {Object} params
 * @param {Object} params.pedido con sus contadores actuales
 * @param {string} params.pedidoId
 * @param {Object|null} params.entregaAntes la entrega antes del cambio, o null
 *   si se está creando
 * @param {Object} params.entregaDespues la entrega con su estado nuevo
 * @param {Object} params.usuario
 */
/**
 * Escribe el estado nuevo en el documento de la entrega, si cambió.
 *
 * Separado de `recalcular` a propósito: `recalcular` solo toca los CONTADORES
 * del pedido (con `increment`, sin leer nada). Escribir el documento de la
 * entrega sí requiere su referencia y es un `update` directo, no un delta — así
 * que va aparte para que cada responsabilidad quede clara.
 */
function escribirCambioDeEntrega(tx, anotar, refEntrega, pedidoId, antes, despues, usuario) {
  if (antes.estado === despues.estado) return;

  tx.update(refEntrega, { estado: despues.estado, actualizado_en: serverTimestamp() });

  anotar({
    entidadTipo: 'entrega',
    entidadId: refEntrega.id,
    pedidoId,
    accion: 'recalcular_estado',
    diferencias: {
      campos: ['estado'],
      antes: { estado: antes.estado },
      despues: { estado: despues.estado },
    },
    usuario,
    derivado: true,
  });
}

function recalcular(tx, anotar, {
  pedido, pedidoId, entregaAntes, entregaDespues, usuario,
}) {
  const refPedido = doc(db, 'pedidos', pedidoId);

  // Si la entrega es nueva, `entregaAntes` es null: no hay estado previo.
  const delta = deltaContadores(
    entregaAntes ? entregaAntes.estado : null,
    entregaDespues.estado
  );

  const cambiosPedido = { actualizado_en: serverTimestamp() };
  let huboIncremento = false;

  if (delta.cubiertas !== 0) {
    cambiosPedido.entregas_cubiertas = increment(delta.cubiertas);
    huboIncremento = true;
  }
  if (delta.cumplidas !== 0) {
    cambiosPedido.entregas_cumplidas = increment(delta.cumplidas);
    huboIncremento = true;
  }

  if (huboIncremento) {
    tx.update(refPedido, cambiosPedido);

    // El historial no puede mostrar el valor exacto que va a quedar —
    // `increment()` se resuelve en el servidor, no acá—, así que se anota el
    // delta: es lo que efectivamente se pidió, y es reconstruible.
    anotar({
      entidadTipo: 'pedido',
      entidadId: pedidoId,
      pedidoId,
      accion: 'recalcular_contadores',
      diferencias: {
        campos: Object.keys(delta).filter(k => delta[k] !== 0)
          .map(k => `entregas_${k === 'cubiertas' ? 'cubiertas' : 'cumplidas'}`),
        antes: {},
        despues: { delta_cubiertas: delta.cubiertas, delta_cumplidas: delta.cumplidas },
      },
      usuario,
      derivado: true,
    });
  }

  // El estado en sí (la etiqueta "programado_parcial", etc.) NO se guarda: se
  // deriva de los contadores en el momento de mostrarlo con `estadoPedido()`.
  // Guardarlo aparte volvería a exponer al problema que esto resuelve: alguien
  // tendría que leer los tres números para saber si cambió la etiqueta.
}

/* -----------------------------------------------------------------------------
 * Aceptar una entrega
 * -------------------------------------------------------------------------- */

/**
 * Crea el despacho que va a cubrir una entrega.
 *
 * Es la primera acción que escribe en el Plan de Producción — la creación del
 * pedido solo notifica al coordinador.
 *
 * El VOLUMEN no se ingresa: se copia de la entrega. Un despacho cubre una
 * entrega entera; partirla en dos camiones no está contemplado.
 *
 * @param {Object} params
 * @param {Object} params.pedido
 * @param {Object} params.entrega
 * @param {Array} params.entregas todas las del pedido
 * @param {Array} params.despachos todos los del pedido
 * @param {string} params.fechaCarga
 * @param {string} params.horarioCarga
 * @param {Object|null} params.transportista organización, o null
 * @param {Object} params.denormalizados { cliente_razon_social, producto_nombre,
 *   ov, destino_texto }
 * @param {Object} params.usuario
 * @returns {Promise<{id: string, numero: string}>}
 */
export async function aceptarEntrega({
  pedido, entrega, entregas, despachos,
  fechaCarga, horarioCarga, transportista, denormalizados, usuario,
}) {
  return enTransaccion(async (tx, anotar) => {
    /* ── Lecturas ────────────────────────────────────────────────────────── */

    const refPedido = doc(db, 'pedidos', pedido.id);
    const refEntrega = doc(db, 'entregas', entrega.id);

    const [snapPedido, snapEntrega] = await Promise.all([
      tx.get(refPedido),
      tx.get(refEntrega),
    ]);

    if (!snapPedido.exists()) throw new Error('El pedido ya no existe. Actualizá la página.');
    if (!snapEntrega.exists()) throw new Error('La entrega ya no existe. Actualizá la página.');

    const pedidoActual = { id: pedido.id, ...snapPedido.data() };
    const entregaActual = { id: entrega.id, ...snapEntrega.data() };

    if (pedidoActual.suspendido) {
      throw new Error('El pedido está suspendido.');
    }

    // Releído: dos coordinadores podrían aceptar la misma entrega al mismo
    // tiempo. El contexto se leyó afuera, así que esta comprobación usa lo que
    // hay ahora.
    const suyos = despachos.filter(d => d.entrega_id === entrega.id);
    if (suyos.some(despachoVivo)) {
      throw new Error('Esa entrega ya tiene un despacho. Actualizá la página.');
    }

    /* ── Escrituras ──────────────────────────────────────────────────────── */

    const refDespacho = doc(collection(db, 'despachos'));

    const datos = {
      pedido_id: pedido.id,
      entrega_id: entrega.id,
      numero: siguienteNumero(despachos),

      estado: transportista ? DESPACHO.ASIGNADO : DESPACHO.PENDIENTE_ASIGNACION,
      estado_ts: serverTimestamp(),

      volumen: Number(entregaActual.volumen),
      fecha_carga: fechaCarga,
      horario_carga: horarioCarga || '',

      transportista_org_id: transportista ? transportista.id : null,
      // Se resuelve DESDE la organización, nunca se copia de un formulario. Hoy
      // `transporte` y `transporte_id` son campos independientes que pueden
      // apuntar a empresas distintas — y eso es lo que rompe la nominación.
      transporte_nombre: transportista ? transportista.razon_social : null,
      // Reservado: hay 19 despachos con `transporte: "—"` porque el cliente
      // pone el camión. Ese flujo queda fuera de alcance, pero el campo va
      // desde ahora para no migrar 200 despachos después.
      requiere_transporte: true,
      rechazo_motivo: null,
      cancelacion_motivo: null,

      baja_solicitada: false,
      baja_motivo: null,
      baja_ts: null,

      chofer_uid: null,
      chofer_dni: null,
      // Antes un solo "camion_id" combinaba tractor+semi. Ahora son dos
      // entidades separadas (ver Camiones.js) que se nominan por separado --
      // el acoplado es opcional, el tractor no.
      tractor_id: null,
      acoplado_id: null,
      patente_tractor: null,
      patente_semi: null,

      // Denormalizados: el transportista NO lee `pedidos`, y el Apps Script
      // rutea al Plan de Producción comparando nombres.
      ...denormalizados,

      creado_por_uid: usuario.uid,
      creado_en: serverTimestamp(),
      actualizado_en: serverTimestamp(),
    };

    tx.set(refDespacho, datos);

    anotar({
      entidadTipo: 'despacho',
      entidadId: refDespacho.id,
      pedidoId: pedido.id,
      accion: 'aceptar_entrega',
      diferencias: calcularDiferencias({}, datos),
      usuario,
    });

    // La entrega no tenía despacho vivo (se validó arriba), así que su estado
    // anterior es 'pendiente'. El nuevo despacho recién creado la cubre.
    const entregaAntesAceptar = { ...entregaActual, estado: 'pendiente' };
    const entregaDespuesAceptar = {
      ...entregaActual,
      estado: estadoEntrega(entregaActual, [{ id: refDespacho.id, ...datos }]),
    };

    escribirCambioDeEntrega(tx, anotar, refEntrega, pedido.id, entregaAntesAceptar, entregaDespuesAceptar, usuario);

    recalcular(tx, anotar, {
      pedido: pedidoActual,
      pedidoId: pedido.id,
      entregaAntes: entregaAntesAceptar,
      entregaDespues: entregaDespuesAceptar,
      usuario,
    });

    return { id: refDespacho.id, numero: datos.numero };
  }, 3);
}

/* -----------------------------------------------------------------------------
 * Asignar y reasignar transportista
 * -------------------------------------------------------------------------- */

/**
 * Le pone transportista a un despacho, o se lo cambia.
 *
 * ASIGNAR va desde `PENDIENTE_ASIGNACION`. REASIGNAR desde `ASIGNADO`, y solo
 * hasta que el transportista responde: una vez que aceptó se comprometió a
 * poner un chofer, y el camino es que rechace o pida la baja.
 *
 * NO se copian emails ni teléfonos al despacho. Hoy sí, y quedan congelados: si
 * el transportista cambia su mail, los despachos ya creados siguen mandando al
 * viejo. Se resuelven desde `usuarios` en el momento de notificar.
 */
export async function asignarTransportista({
  pedido, despacho, entregas, despachos, transportista, usuario,
}) {
  const esReasignacion = despacho.estado === DESPACHO.ASIGNADO;

  return enTransaccion(async (tx, anotar) => {
    const refDespacho = doc(db, 'despachos', despacho.id);
    const refPedido = doc(db, 'pedidos', pedido.id);

    const [snapDespacho, snapPedido] = await Promise.all([
      tx.get(refDespacho),
      tx.get(refPedido),
    ]);

    if (!snapDespacho.exists()) throw new Error('El despacho ya no existe. Actualizá la página.');
    const actual = { id: despacho.id, ...snapDespacho.data() };
    const pedidoActual = { id: pedido.id, ...snapPedido.data() };

    if (pedidoActual.suspendido) throw new Error('El pedido está suspendido.');

    if (!puedeAsignar(actual) && !puedeReasignar(actual)) {
      throw new Error(
        `El despacho ${actual.numero} ya no se puede reasignar: está en ${actual.estado}. `
        + 'Si hay que cambiarlo, cancelalo y creá otro.'
      );
    }

    const cambios = {
      estado: DESPACHO.ASIGNADO,
      estado_ts: serverTimestamp(),
      transportista_org_id: transportista.id,
      transporte_nombre: transportista.razon_social,
      actualizado_en: serverTimestamp(),
    };

    tx.update(refDespacho, cambios);

    anotar({
      entidadTipo: 'despacho',
      entidadId: despacho.id,
      pedidoId: pedido.id,
      accion: esReasignacion ? 'reasignar_transportista' : 'asignar_transportista',
      diferencias: calcularDiferencias(actual, cambios),
      usuario,
    });

    // Asignar o reasignar no cambia el estado DERIVADO de la entrega: tanto
    // PENDIENTE_ASIGNACION como ASIGNADO cuentan como "vivo" en
    // `estadoEntrega`, así que ya estaba `programada` y sigue estándolo. El
    // delta da cero — se calcula igual, para no tener un camino especial.
    const entregaBase = entregas.find(e => e.id === actual.entrega_id) || { estado: 'programada' };
    const despachosAntes = despachos;
    const despachosDespues = despachos.map(d => d.id === despacho.id ? { ...d, ...cambios } : d);

    recalcular(tx, anotar, {
      pedido: pedidoActual,
      pedidoId: pedido.id,
      entregaAntes: { ...entregaBase, estado: estadoEntrega(entregaBase, despachosAntes.filter(d => d.entrega_id === actual.entrega_id)) },
      entregaDespues: { ...entregaBase, estado: estadoEntrega(entregaBase, despachosDespues.filter(d => d.entrega_id === actual.entrega_id)) },
      usuario,
    });

    return { reasignacion: esReasignacion };
  }, 3);
}

/* -----------------------------------------------------------------------------
 * Editar
 * -------------------------------------------------------------------------- */

/**
 * Cambia la fecha y el horario de carga.
 *
 * NO cambia el transportista: para eso está reasignar, con sus propias reglas.
 * Hoy están en la misma función y se puede cambiar el transportista de un
 * despacho nominado sin ninguna validación de estado — probablemente sea el
 * origen de los despachos con `transporte` y `transporte_id` apuntando a
 * empresas distintas.
 *
 * NO toca el estado: un despacho `ACEPTADO` sigue `ACEPTADO`. El transportista
 * aceptó el viaje, no la fecha exacta.
 *
 * NO toca la entrega ni el pedido: su estado no depende de qué día carga.
 */
export async function editarDespacho({
  despacho, fechaCarga, horarioCarga, usuario,
}) {
  return enTransaccion(async (tx, anotar) => {
    const ref = doc(db, 'despachos', despacho.id);
    const snap = await tx.get(ref);

    if (!snap.exists()) throw new Error('El despacho ya no existe. Actualizá la página.');
    const actual = { id: despacho.id, ...snap.data() };

    if (!puedeEditar(actual)) {
      throw new Error(
        `El despacho ${actual.numero} ya no se puede editar: está en ${actual.estado}. `
        + 'Una vez nominado hay un chofer con el viaje asignado; si hay que cambiarlo, cancelalo.'
      );
    }

    const cambios = {
      fecha_carga: fechaCarga,
      horario_carga: horarioCarga || '',
      actualizado_en: serverTimestamp(),
    };

    const dif = calcularDiferencias(actual, cambios);
    if (dif.campos.length === 0) return { cambio: false };

    tx.update(ref, cambios);

    anotar({
      entidadTipo: 'despacho',
      entidadId: despacho.id,
      pedidoId: actual.pedido_id,
      accion: 'editar_despacho',
      diferencias: dif,
      usuario,
    });

    return { cambio: true };
  }, 1);
}

/* -----------------------------------------------------------------------------
 * Cancelar
 * -------------------------------------------------------------------------- */

/**
 * Da de baja un despacho que ya no va a suceder.
 *
 * Es la acción que hoy no existe, y por eso el coordinador no puede deshacer
 * nada: si asignó mal, tiene que pedirle al transportista que rechace.
 *
 * Distinta de RECHAZADO, que lo decide el transportista. Las dos dejan la
 * entrega descubierta, pero el motivo importa.
 *
 * El VIAJE se cancela, no se borra: conserva su ID, su historial y sus puntos
 * de GPS si llegó a tener alguno.
 *
 * @param {Object|null} params.viaje el viaje del despacho, si tiene
 */
export async function cancelarDespacho({
  pedido, despacho, viaje, entregas, despachos, motivo, usuario, appsScriptUrl = null,
}) {
  const resultado = await enTransaccion(async (tx, anotar) => {
    const refDespacho = doc(db, 'despachos', despacho.id);
    const refPedido = doc(db, 'pedidos', pedido.id);
    const refViaje = viaje ? doc(db, 'viajes', viaje.id) : null;

    const lecturas = [tx.get(refDespacho), tx.get(refPedido)];
    if (refViaje) lecturas.push(tx.get(refViaje));
    const snaps = await Promise.all(lecturas);

    const [snapDespacho, snapPedido, snapViaje] = snaps;

    if (!snapDespacho.exists()) throw new Error('El despacho ya no existe. Actualizá la página.');
    const actual = { id: despacho.id, ...snapDespacho.data() };
    const pedidoActual = { id: pedido.id, ...snapPedido.data() };
    const viajeActual = snapViaje && snapViaje.exists()
      ? { id: viaje.id, ...snapViaje.data() } : null;

    if (!puedeCancelar(actual, viajeActual)) {
      throw new Error(
        viajeActual && viajeActual.estado === 'EN_VIAJE'
          ? 'El chofer ya arrancó el viaje. Cancelarlo no lo detiene y le sacaría el viaje de la app mientras maneja.'
          : `El despacho ${actual.numero} ya no se puede cancelar: está en ${actual.estado}.`
      );
    }

    const cambios = {
      estado: DESPACHO.CANCELADO,
      estado_ts: serverTimestamp(),
      cancelacion_motivo: motivo,
      actualizado_en: serverTimestamp(),
    };

    tx.update(refDespacho, cambios);

    anotar({
      entidadTipo: 'despacho',
      entidadId: despacho.id,
      pedidoId: pedido.id,
      accion: 'cancelar_despacho',
      diferencias: calcularDiferencias(actual, cambios),
      usuario,
      razon: motivo,
    });

    // El aviso al transportista, en la MISMA transacción: si esto se hiciera
    // como una llamada aparte después de `tx.commit()`, un fallo justo ahí
    // dejaría el despacho cancelado sin que nadie se entere — exactamente el
    // problema que tenía depender de una llamada a ciegas al Apps Script
    // (`mode: 'no-cors'`, nunca se ve si falló). Achica el problema en vez de
    // trasladarlo: ahora "se canceló" y "se avisó" son la misma escritura.
    if (actual.transportista_org_id) {
      tx.set(doc(collection(db, 'avisos')), {
        destinatario_org_id: actual.transportista_org_id,
        destinatario_chofer_dni: null,
        tipo: 'despacho_cancelado',
        titulo: `Despacho ${actual.numero} cancelado`,
        mensaje: `El despacho ${actual.numero} del pedido ${pedidoActual.numero || ''} se canceló. Motivo: ${motivo}`,
        pedido_id: pedido.id,
        despacho_id: despacho.id,
        leido: false,
        creado_en: serverTimestamp(),
      });
    }

    if (viajeActual) {
      const cambiosViaje = {
        estado: 'CANCELADO',
        estado_ts: serverTimestamp(),
        actualizado_en: serverTimestamp(),
      };
      tx.update(refViaje, cambiosViaje);
      anotar({
        entidadTipo: 'viaje',
        entidadId: viaje.id,
        pedidoId: pedido.id,
        accion: 'cancelar_viaje',
        diferencias: calcularDiferencias(viajeActual, cambiosViaje),
        usuario,
        razon: motivo,
        derivado: true,
      });
    }

    // Cancelar SÍ puede cambiar el estado de la entrega: si este despacho era
    // el único vivo, la entrega vuelve a `pendiente`.
    const entregaBase3 = entregas.find(e => e.id === actual.entrega_id) || { estado: 'programada' };
    const despachosAntes3 = despachos;
    const despachosDespues3 = despachos.map(d => d.id === despacho.id ? { ...d, ...cambios } : d);

    const entregaAntesCancelar = { ...entregaBase3, estado: estadoEntrega(entregaBase3, despachosAntes3.filter(d => d.entrega_id === actual.entrega_id)) };
    const entregaDespuesCancelar = { ...entregaBase3, estado: estadoEntrega(entregaBase3, despachosDespues3.filter(d => d.entrega_id === actual.entrega_id)) };

    escribirCambioDeEntrega(tx, anotar, doc(db, 'entregas', entregaBase3.id), pedido.id, entregaAntesCancelar, entregaDespuesCancelar, usuario);

    recalcular(tx, anotar, {
      pedido: pedidoActual,
      pedidoId: pedido.id,
      entregaAntes: entregaAntesCancelar,
      entregaDespues: entregaDespuesCancelar,
      usuario,
    });

    return {
      numero: actual.numero,
      // Para `borrar_despacho`, afuera de la transacción — ver el comentario
      // sobre por qué el fetch no puede ir acá adentro.
      paraAppsScript: {
        pedido_id: pedidoActual.numero,
        producto: actual.producto_nombre,
        cliente: actual.cliente_razon_social,
        ov: actual.ov,
        tipo: pedidoActual.tipo,
        fecha_carga: actual.fecha_carga,
        volumen: actual.volumen,
      },
    };
  }, 5);

  // Sacarle a la celda del Plan de Producción el volumen y la nota que le
  // puso `escribirEnPlan()` cuando se creó este despacho. AFUERA de la
  // transacción, después de que el commit ya se confirmó: es un `fetch`, y
  // Firestore puede reintentar la función de la transacción entera ante una
  // colisión — adentro, un reintento dispararía esta llamada más de una vez
  // por una sola cancelación real.
  //
  // Si esto falla, el despacho igual quedó bien cancelado en Firestore — el
  // Plan quedaría con un volumen de más hasta que alguien lo note. Es el
  // mismo riesgo que ya existía con `mode: 'no-cors'` en el resto de las
  // llamadas al script, no uno nuevo.
  let avisoApps = null;
  if (appsScriptUrl) {
    const r = await llamarAppsScript(appsScriptUrl, 'borrar_despacho', resultado.paraAppsScript);
    if (!r.ok) {
      avisoApps = 'El despacho se canceló bien, pero no se pudo actualizar el Plan de '
        + 'Producción automáticamente. Revisalo a mano: ' + r.mensaje;
    }
  }

  return { numero: resultado.numero, avisoApps };
}

/* -----------------------------------------------------------------------------
 * Notificaciones
 * -------------------------------------------------------------------------- */

/**
 * Resuelve a quién notificarle un despacho de una organización.
 *
 * Se hace AL NOTIFICAR, no al asignar. Hoy los emails se copian al despacho y
 * quedan congelados. Además, en `transportistas_portal` hay un caso con
 * `email_2` y `email_3` iguales entre sí y con una errata de tipeo: cada
 * notificación manda a los tres y dos rebotan.
 *
 * @param {Array} usuarios todos los usuarios cargados
 * @param {string} organizacionId
 * @returns {string[]} sin repetidos
 */
export function correosDeOrganizacion(usuarios, organizacionId) {
  const vistos = new Set();

  (usuarios || [])
    .filter(u => u.organizacion_id === organizacionId
              && u.estado === 'activo'
              && (u.roles || []).includes('transportista'))
    .forEach(u => {
      if (u.email) vistos.add(u.email.trim().toLowerCase());
      (u.emails_extra || []).forEach(e => e && vistos.add(e.trim().toLowerCase()));
    });

  return [...vistos];
}

/**
 * Llama al Apps Script.
 *
 * Le llegan los NOMBRES resueltos, nunca los IDs: el script rutea al Plan de
 * Producción comparando strings contra una lista fija. Con un ID caería en la
 * columna "Otros", y en silencio.
 *
 * `mode: 'no-cors'` significa que nunca vemos la respuesta: si el script falla,
 * el portal muestra que notificó igual. Es un problema conocido y sigue sin
 * resolverse.
 */
/**
 * Llama al Apps Script, y esta vez SÍ dice si funcionó.
 *
 * -----------------------------------------------------------------------------
 * D3 — POR QUÉ SACAR `mode: 'no-cors'`
 * -----------------------------------------------------------------------------
 *   Con `no-cors`, la respuesta queda opaca: ni el status, ni el cuerpo, ni
 *   si el script tiró una excepción. Un fallo ahí siempre se mostraba como
 *   éxito — el problema conocido que quedaba anotado en cada acción desde el
 *   principio de esta migración.
 *
 *   Sacarlo alcanza. El Web App está publicado con acceso "Cualquier
 *   usuario", y esto es un GET simple —sin headers custom, sin body JSON—,
 *   así que el navegador no dispara preflight y no hay nada que bloquee leer
 *   la respuesta. No hizo falta tocar una línea del lado del script para
 *   esto: nunca fue una limitación de Apps Script, era una precaución del
 *   lado del portal que ya no hacía falta.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ DEVUELVE `{ok, mensaje}` EN VEZ DE TIRAR EXCEPCIÓN
 * -----------------------------------------------------------------------------
 *   En todos los lugares donde se llama, la escritura en Firestore YA se
 *   confirmó antes de esto — el despacho ya está aceptado, cancelado,
 *   nominado, lo que sea. Un fallo acá es "no se pudo avisar/anotar en el
 *   Plan", no "la acción falló entera". Si tirara excepción, quien llama
 *   tendría que separar ese try/catch del de la escritura real para no
 *   mostrarle al usuario "no se pudo aceptar el despacho" cuando en
 *   realidad sí se aceptó y solo falló el aviso.
 *
 * @returns {Promise<{ok: boolean, mensaje: string, data?: any}>}
 */
export async function llamarAppsScript(url, accion, payload) {
  const params = new URLSearchParams({
    payload: JSON.stringify({ accion, ...payload }),
  });

  try {
    const respuesta = await fetch(`${url}?${params.toString()}`);
    const resultado = await respuesta.json();
    if (resultado.status !== 'ok') {
      console.warn(`Apps Script (${accion}) devolvió error:`, resultado.mensaje);
      return { ok: false, mensaje: resultado.mensaje || 'El Apps Script devolvió un error.' };
    }
    return { ok: true, mensaje: resultado.mensaje, data: resultado.data };
  } catch (err) {
    console.warn(`Apps Script (${accion}) no respondió:`, err);
    return { ok: false, mensaje: 'No se pudo conectar con el Apps Script.' };
  }
}
