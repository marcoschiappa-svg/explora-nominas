/* =============================================================================
 * logica-transportista.js — Aceptar, rechazar y nominar
 * =============================================================================
 *
 * QUE ES
 *   Las tres acciones del transportista sobre un despacho. Separadas de la
 *   pantalla, como el resto.
 *
 * -----------------------------------------------------------------------------
 * ACEPTAR ES UN COMPROMISO
 * -----------------------------------------------------------------------------
 *   Rechazar solo se puede desde `ASIGNADO`. Una vez que aceptó, el
 *   transportista se obligó a poner un chofer: si después no puede cumplir, el
 *   camino es avisarle al coordinador, no dar marcha atrás por su cuenta.
 *
 *   Esa solicitud de baja está reservada en el modelo (`baja_solicitada`) pero
 *   el flujo —quién decide, qué pasa con el despacho— queda fuera de alcance.
 *
 * -----------------------------------------------------------------------------
 * NOMINAR CREA EL VIAJE
 * -----------------------------------------------------------------------------
 *   El viaje nace al nominar, no al arrancar: el chofer tiene que verlo en la
 *   app antes de iniciarlo. Hoy eso lo hace `estado_chofer: 'recibido'`,
 *   escrito en la misma operación.
 *
 *   Y ES IRREVERSIBLE. Cambiar la nominación hasta que el chofer se presenta en
 *   la puerta requiere hardware que no existe, así que queda fuera de alcance:
 *   si hay que cambiarlo, el coordinador cancela el despacho.
 *
 * -----------------------------------------------------------------------------
 * EL BUG QUE ESTO ARREGLA
 * -----------------------------------------------------------------------------
 *   Hoy `nominar()` verifica que el chofer sea del transporte asignado
 *   comparando DOS STRINGS:
 *
 *       chofer.empresa      "Transporte RAD"
 *       despacho.transporte "RAD"
 *
 *   Con `!==`. Como no coinciden, rechaza nominaciones válidas con un mensaje
 *   que no tiene sentido para quien la está haciendo.
 *
 *   Acá la comparación es entre IDs de organización. El problema desaparece de
 *   raíz porque ya no hay dos textos que puedan diferir.
 *
 * -----------------------------------------------------------------------------
 * TRACTOR Y ACOPLADO, POR SEPARADO
 * -----------------------------------------------------------------------------
 *   Antes se nominaba un "camión" único que ya traía tractor+semi combinados
 *   (ver Camiones.js). Ahora son dos entidades independientes -- el
 *   transportista puede combinar cualquier tractor con cualquier acoplado de
 *   su flota, o nominar solo el tractor si el viaje no lleva semi.
 *
 *   `nominar()` recibe `tractor` (obligatorio) y `acoplado` (opcional, puede
 *   ser `null`) en vez de un solo `camion`. Las patentes se siguen
 *   congelando en el despacho y el viaje como `patente_tractor`/
 *   `patente_semi` -- eso no cambia, porque el Apps Script, el Plan de
 *   Producción y la app del chofer ya leen esos dos nombres de campo. Lo
 *   único que cambia es DE DÓNDE salen: antes de un solo objeto `camion`,
 *   ahora de dos objetos separados.
 * ========================================================================== */

import { doc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { enTransaccion, calcularDiferencias } from './datos';
import {
  DESPACHO, VIAJE, deltaContadores, despachoVivo,
  puedeAceptar, puedeRechazar, puedeNominar,
} from './estados';
import { increment } from 'firebase/firestore';

/* -----------------------------------------------------------------------------
 * Recálculo — SOLO CONTADORES, sin leer entregas ni los demás despachos
 * -----------------------------------------------------------------------------
 *
 *   El transportista NO PUEDE LEER `entregas`: las reglas lo dejan afuera,
 *   porque "los pedidos donde tengo un despacho" es un join que las reglas de
 *   Firestore no pueden expresar. Ver `estados.js` para la explicación
 *   completa de por qué el pedido se lleva por contadores en vez de
 *   derivarse leyendo.
 *
 *   Esto funciona SIN leer la entrega porque una entrega solo puede tener UN
 *   despacho vivo a la vez —lo garantiza la validación de `aceptarEntrega` en
 *   `logica-despachos.js`, que rechaza crear un despacho si ya hay uno vivo—.
 *   Así que el estado "antes" y "después" de la entrega se puede inferir
 *   directamente del estado del PROPIO despacho, sin mirar nada más:
 *
 *       despacho vivo (ASIGNADO, ACEPTADO, NOMINADO...)  → entrega cubierta
 *       despacho muerto (RECHAZADO, CANCELADO)            → entrega sin cubrir
 *
 *   Aceptar y nominar no cambian esa cobertura (el despacho sigue vivo antes y
 *   después), así que su delta es cero. Rechazar sí: el despacho pasa de vivo a
 *   muerto, la entrega se descubre, y el contador baja uno.
 * -------------------------------------------------------------------------- */

function recalcularPorTransicionDeDespacho(tx, anotar, {
  pedidoId, estadoAntes, estadoDespues, usuario,
}) {
  const cubiertaAntes = despachoVivo({ estado: estadoAntes });
  const cubiertaDespues = despachoVivo({ estado: estadoDespues });

  const delta = deltaContadores(
    cubiertaAntes ? 'programada' : 'pendiente',
    cubiertaDespues ? 'programada' : 'pendiente'
  );

  if (delta.cubiertas === 0 && delta.cumplidas === 0) return;

  const cambios = { actualizado_en: serverTimestamp() };
  if (delta.cubiertas !== 0) cambios.entregas_cubiertas = increment(delta.cubiertas);
  if (delta.cumplidas !== 0) cambios.entregas_cumplidas = increment(delta.cumplidas);

  tx.update(doc(db, 'pedidos', pedidoId), cambios);

  anotar({
    entidadTipo: 'pedido',
    entidadId: pedidoId,
    pedidoId,
    accion: 'recalcular_contadores',
    diferencias: {
      campos: Object.keys(delta).filter(k => delta[k] !== 0).map(k => `entregas_${k}`),
      antes: {},
      despues: { delta_cubiertas: delta.cubiertas, delta_cumplidas: delta.cumplidas },
    },
    usuario,
    derivado: true,
  });
}

/* -----------------------------------------------------------------------------
 * Aceptar
 * -------------------------------------------------------------------------- */

/**
 * El transportista confirma que toma el despacho.
 *
 * El PEDIDO no pasa a "Aceptado". Hoy `aceptar()` lo escribe directo sin mirar
 * los otros despachos: un pedido con tres despachos donde uno se acepta queda
 * marcado como aceptado entero. Acá el estado sale de la derivación, que mira
 * todas las entregas.
 *
 * `nominacion_pendiente` no se escribe: era un booleano redundante. Que el
 * despacho esté en ACEPTADO ya significa que falta nominar.
 */
export async function aceptarDespacho({
  pedido, despacho, miOrganizacionId, usuario,
}) {
  return enTransaccion(async (tx, anotar) => {
    const refDespacho = doc(db, 'despachos', despacho.id);

    const snapD = await tx.get(refDespacho);

    if (!snapD.exists()) throw new Error('El despacho ya no existe. Actualizá la página.');
    const actual = { id: despacho.id, ...snapD.data() };

    // Las reglas ya lo impiden, pero se valida igual: las reglas protegen la
    // base, no reemplazan la lógica.
    if (actual.transportista_org_id !== miOrganizacionId) {
      throw new Error('Ese despacho no es de tu empresa.');
    }
    // NO se lee `pedidos` para chequear `suspendido` -- las reglas no dejan
    // al transportista leer esa colección en absoluto (solo puede escribirle
    // los contadores con `soloContadores()`), así que un `tx.get()` acá
    // revienta con `permission-denied` sin importar que el resto de la
    // función esté bien. Y no hace falta: `suspenderPedido()` cancela TODO
    // despacho vivo del pedido en su propia cascada, así que si el pedido
    // está suspendido, este despacho ya está `CANCELADO` -- y `puedeAceptar()`
    // lo frena solo, mirando el propio despacho.
    if (!puedeAceptar(actual)) {
      throw new Error(`El despacho ${actual.numero} ya no se puede aceptar: está en ${actual.estado}.`);
    }

    const cambios = {
      estado: DESPACHO.ACEPTADO,
      estado_ts: serverTimestamp(),
      actualizado_en: serverTimestamp(),
    };

    tx.update(refDespacho, cambios);

    anotar({
      entidadTipo: 'despacho',
      entidadId: despacho.id,
      pedidoId: pedido.id,
      accion: 'aceptar_despacho',
      diferencias: calcularDiferencias(actual, cambios),
      usuario,
    });

    recalcularPorTransicionDeDespacho(tx, anotar, {
      pedidoId: pedido.id,
      estadoAntes: actual.estado,
      estadoDespues: cambios.estado,
      usuario,
    });

    return { numero: actual.numero };
  }, 2);
}

/* -----------------------------------------------------------------------------
 * Rechazar
 * -------------------------------------------------------------------------- */

/**
 * El transportista devuelve el despacho.
 *
 * Solo desde `ASIGNADO`. El despacho queda como registro —el transportista lo
 * sigue viendo, es su constancia de que lo rechazó y por qué— y la entrega
 * vuelve a `pendiente` sin que nadie lo decida: la derivación mira si hay
 * despacho vivo, y este dejó de serlo.
 *
 * El PEDIDO no vuelve a `pendiente` salvo que fuera su única entrega. Hoy
 * `rechazar()` lo manda directo, y si el pedido tenía otros tres despachos
 * asignados, el coordinador lo ve como si no hubiera hecho nada.
 */
export async function rechazarDespacho({
  pedido, despacho, motivo, miOrganizacionId, usuario,
}) {
  if (!motivo || !motivo.trim()) {
    throw new Error('El motivo del rechazo es obligatorio.');
  }

  return enTransaccion(async (tx, anotar) => {
    const refDespacho = doc(db, 'despachos', despacho.id);

    const snapD = await tx.get(refDespacho);

    if (!snapD.exists()) throw new Error('El despacho ya no existe. Actualizá la página.');
    const actual = { id: despacho.id, ...snapD.data() };

    if (actual.transportista_org_id !== miOrganizacionId) {
      throw new Error('Ese despacho no es de tu empresa.');
    }
    if (!puedeRechazar(actual)) {
      throw new Error(
        `El despacho ${actual.numero} ya no se puede rechazar: está en ${actual.estado}. `
        + 'Una vez aceptado, si no podés cumplir tenés que avisarle al coordinador.'
      );
    }

    const cambios = {
      estado: DESPACHO.RECHAZADO,
      estado_ts: serverTimestamp(),
      rechazo_motivo: motivo.trim(),
      actualizado_en: serverTimestamp(),
    };

    tx.update(refDespacho, cambios);

    anotar({
      entidadTipo: 'despacho',
      entidadId: despacho.id,
      pedidoId: pedido.id,
      accion: 'rechazar_despacho',
      diferencias: calcularDiferencias(actual, cambios),
      usuario,
      razon: motivo.trim(),
    });

    recalcularPorTransicionDeDespacho(tx, anotar, {
      pedidoId: pedido.id,
      estadoAntes: actual.estado,
      estadoDespues: cambios.estado,
      usuario,
    });

    return { numero: actual.numero };
  }, 2);
}

/* -----------------------------------------------------------------------------
 * Nominar
 * -------------------------------------------------------------------------- */

/**
 * Carga el chofer, el tractor y el acoplado (opcional), y crea el viaje.
 *
 * @param {Object} params
 * @param {Object} params.chofer usuario con rol chofer
 * @param {Object} params.tractor entidad de Camiones.js con tipo 'tractor'
 * @param {Object|null} params.acoplado entidad de Camiones.js con tipo
 *   'acoplado', o `null` si el viaje no lleva semi
 * @param {Object} params.entrega la entrega del despacho, para denormalizar
 * @param {Object} params.pedidoDenormalizado { producto_nombre, origen_texto,
 *   destino_texto, cliente_razon_social }
 */
export async function nominar({
  pedido, despacho, entrega,
  chofer, tractor, acoplado, pedidoDenormalizado, miOrganizacionId, usuario,
}) {
  /* ── Validaciones que no necesitan la transacción ─────────────────────── */

  // Comparación de IDs, no de strings. Es lo que arregla el bug de hoy.
  if (chofer.organizacion_id !== miOrganizacionId) {
    throw new Error(`${chofer.nombre} no es chofer de tu empresa.`);
  }
  if (tractor.organizacion_id !== miOrganizacionId) {
    throw new Error('Ese tractor no es de tu empresa.');
  }
  if (acoplado && acoplado.organizacion_id !== miOrganizacionId) {
    throw new Error('Ese acoplado no es de tu empresa.');
  }
  if (chofer.estado !== 'activo') {
    throw new Error(`${chofer.nombre} está dado de baja.`);
  }
  if (tractor.estado !== 'activo') {
    throw new Error('Ese tractor está dado de baja.');
  }
  if (acoplado && acoplado.estado !== 'activo') {
    throw new Error('Ese acoplado está dado de baja.');
  }
  if (!chofer.datos_chofer || !chofer.datos_chofer.dni) {
    throw new Error(
      `${chofer.nombre} no tiene DNI cargado. Sin DNI no puede entrar a la app: `
      + 'el viaje no le aparecería nunca.'
    );
  }

  return enTransaccion(async (tx, anotar) => {
    const refDespacho = doc(db, 'despachos', despacho.id);

    const snapD = await tx.get(refDespacho);

    if (!snapD.exists()) throw new Error('El despacho ya no existe. Actualizá la página.');
    const actual = { id: despacho.id, ...snapD.data() };

    if (actual.transportista_org_id !== miOrganizacionId) {
      throw new Error('Ese despacho no es de tu empresa.');
    }
    // Ver el comentario de `aceptarDespacho`: no se lee `pedidos` porque el
    // transportista no tiene permiso, y no hace falta -- `suspenderPedido()`
    // ya cancela este despacho si el pedido se suspende.
    if (!puedeNominar(actual)) {
      throw new Error(
        `El despacho ${actual.numero} está en ${actual.estado}. `
        + (actual.estado === DESPACHO.NOMINADO
            ? 'Ya está nominado, y la nominación no se puede cambiar: si hay que corregirla, pedile al coordinador que cancele el despacho.'
            : 'Solo se puede nominar un despacho aceptado.')
      );
    }

    /* ── El despacho ─────────────────────────────────────────────────────── */

    const refViaje = doc(collection(db, 'viajes'));

    const cambiosDespacho = {
      estado: DESPACHO.NOMINADO,
      estado_ts: serverTimestamp(),
      chofer_uid: chofer.id,
      chofer_dni: chofer.datos_chofer.dni,
      tractor_id: tractor.id,
      acoplado_id: acoplado ? acoplado.id : null,
      // Las patentes se CONGELAN acá. Si el tractor o el acoplado se
      // rematriculan después, los despachos viejos conservan la que
      // llevaban ese día. Los NOMBRES de campo (patente_tractor/
      // patente_semi) no cambiaron a propósito: el Apps Script, el Plan de
      // Producción y la app del chofer ya los leen así.
      patente_tractor: tractor.patente,
      patente_semi: acoplado ? acoplado.patente : null,
      viaje_id: refViaje.id,
      actualizado_en: serverTimestamp(),
    };

    tx.update(refDespacho, cambiosDespacho);

    /* ── El viaje ────────────────────────────────────────────────────────── */

    const datosViaje = {
      despacho_id: despacho.id,
      pedido_id: pedido.id,
      chofer_uid: chofer.id,
      chofer_dni: chofer.datos_chofer.dni,
      transportista_org_id: miOrganizacionId,

      estado: VIAJE.RECIBIDO,
      estado_ts: serverTimestamp(),

      // La demora es un ATRIBUTO, no un estado: el camión sigue andando, va
      // tarde. Hoy está metida como estado y por eso hay que filtrar con
      // `['iniciado','demorado'].includes(...)`.
      demorado: false,
      demora_motivo: null,
      demora_ts: null,

      inicio_ts: null,
      fin_ts: null,
      cerrado_por: null,
      cierre_motivo: null,

      inicio_lat: null, inicio_lng: null, inicio_precision: null, inicio_origen: null,
      fin_lat: null, fin_lng: null, fin_precision: null, fin_origen: null,
      ultima_lat: null, ultima_lng: null, ultima_ts: null,

      puntos_registrados: 0,

      // Denormalizados para la pantalla del chofer: NO lee `pedidos` ni
      // `despachos`. Todo lo que muestra está acá, así que consulta una sola
      // colección.
      cliente_razon_social: pedidoDenormalizado.cliente_razon_social || '',
      producto_nombre: pedidoDenormalizado.producto_nombre || '',
      origen_texto: pedidoDenormalizado.origen_texto || '',
      destino_texto: pedidoDenormalizado.destino_texto || '',
      volumen: Number(entrega ? entrega.volumen : actual.volumen) || 0,
      fecha_carga: actual.fecha_carga || '',
      patente_tractor: tractor.patente,
      patente_semi: acoplado ? acoplado.patente : null,

      creado_por_uid: usuario.uid,
      creado_en: serverTimestamp(),
      actualizado_en: serverTimestamp(),
    };

    tx.set(refViaje, datosViaje);

    /* ── Historial ───────────────────────────────────────────────────────── */

    anotar({
      entidadTipo: 'despacho',
      entidadId: despacho.id,
      pedidoId: pedido.id,
      accion: 'nominar',
      diferencias: calcularDiferencias(actual, cambiosDespacho),
      usuario,
    });

    anotar({
      entidadTipo: 'viaje',
      entidadId: refViaje.id,
      pedidoId: pedido.id,
      accion: 'crear_viaje',
      diferencias: calcularDiferencias({}, datosViaje),
      usuario,
      derivado: true,
    });

    // Nominar no cambia la cobertura de la entrega: ACEPTADO y NOMINADO son
    // los dos "vivo", así que el delta da cero. Se llama igual, por
    // consistencia y por si el criterio de `despachoVivo` cambia el día de
    // mañana.
    recalcularPorTransicionDeDespacho(tx, anotar, {
      pedidoId: pedido.id,
      estadoAntes: actual.estado,
      estadoDespues: cambiosDespacho.estado,
      usuario,
    });

    return { numero: actual.numero, viajeId: refViaje.id };
  }, 3);
}
