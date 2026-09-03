/* =============================================================================
 * estados.js — Los estados y cómo se derivan
 * =============================================================================
 *
 * POR QUE UN SOLO ARCHIVO
 *   Hoy el estado del pedido se escribe desde CINCO funciones con criterios que
 *   no coinciden: el coordinador mira todos los despachos antes de decidir, el
 *   transportista escribe el suyo directo. El resultado es que
 *   `pedido.estado` no describe al pedido sino la última acción que pasó por
 *   ahí — hay un pedido en la base que dice "Nominado" con 19 de 20 despachos
 *   sin nominar.
 *
 *   Acá está una sola vez. Todas las acciones llaman a estas funciones; ninguna
 *   escribe un estado a mano.
 *
 * -----------------------------------------------------------------------------
 * TRES NIVELES
 * -----------------------------------------------------------------------------
 *       despacho  →  entrega  →  pedido
 *
 *   Cada nivel mira solo a sus hijos. El despacho determina el estado de su
 *   entrega, y las entregas el del pedido. Nadie saltea un nivel.
 *
 *   Eso hace que el rechazo sea obvio: el despacho pasa a RECHAZADO, su entrega
 *   vuelve a `pendiente` porque se quedó sin despacho vivo, y el pedido se
 *   recalcula desde ahí. Hoy `rechazar()` manda el pedido entero a "Pendiente"
 *   aunque los otros tres despachos sigan asignados.
 *
 * -----------------------------------------------------------------------------
 * LOS ESTADOS SE GUARDAN
 * -----------------------------------------------------------------------------
 *   Se recalculan con estas funciones y se escriben en el documento. No se
 *   derivan al leer, por dos motivos: un pedido recién creado está en
 *   "pendiente" y eso es un hecho, no un cálculo; y derivar al leer obligaría a
 *   traer todas las entregas y despachos de cada pedido solo para pintar una
 *   insignia en una lista.
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * Despacho
 * -------------------------------------------------------------------------- */

export const DESPACHO = {
  PENDIENTE_ASIGNACION: 'PENDIENTE_ASIGNACION',
  ASIGNADO: 'ASIGNADO',
  ACEPTADO: 'ACEPTADO',
  NOMINADO: 'NOMINADO',
  ENTREGADO: 'ENTREGADO',
  RECHAZADO: 'RECHAZADO',
  CANCELADO: 'CANCELADO',
};

/**
 * Los que dejaron de contar. `RECHAZADO` lo decide el transportista;
 * `CANCELADO`, Explora. Los dos dejan la entrega descubierta, pero el motivo
 * importa: el transportista tiene que poder ver por qué se le cayó un despacho.
 */
export const DESPACHOS_MUERTOS = [DESPACHO.RECHAZADO, DESPACHO.CANCELADO];

export function despachoVivo(d) {
  return d && !DESPACHOS_MUERTOS.includes(d.estado);
}

export const ETIQUETA_DESPACHO = {
  PENDIENTE_ASIGNACION: 'Sin transporte',
  ASIGNADO: 'Esperando respuesta',
  ACEPTADO: 'Aceptado',
  NOMINADO: 'Nominado',
  ENTREGADO: 'Entregado',
  RECHAZADO: 'Rechazado',
  CANCELADO: 'Cancelado',
};

export const COLOR_DESPACHO = {
  PENDIENTE_ASIGNACION: { bg: '#FEF3C7', color: '#92400E' },
  ASIGNADO:             { bg: '#FAEEDA', color: '#633806' },
  ACEPTADO:             { bg: '#E1F5EE', color: '#085041' },
  NOMINADO:             { bg: '#EEEDFE', color: '#3C3489' },
  ENTREGADO:            { bg: '#E1F5EE', color: '#085041' },
  RECHAZADO:            { bg: '#FCEBEB', color: '#791F1F' },
  CANCELADO:            { bg: '#F3F4F6', color: '#6B7280' },
};

/* -----------------------------------------------------------------------------
 * Viaje
 * -------------------------------------------------------------------------- */

export const VIAJE = {
  RECIBIDO: 'RECIBIDO',
  EN_VIAJE: 'EN_VIAJE',
  FINALIZADO: 'FINALIZADO',
  CANCELADO: 'CANCELADO',
};

// La demora NO es un estado: es un atributo del viaje. El camión sigue andando,
// va tarde. Hoy está metida como estado y por eso `Transportista.js` filtra con
// `['iniciado','demorado'].includes(...)`.

export const ETIQUETA_VIAJE = {
  RECIBIDO: 'Asignado',
  EN_VIAJE: 'En viaje',
  FINALIZADO: 'Finalizado',
  CANCELADO: 'Cancelado',
};

/* -----------------------------------------------------------------------------
 * Entrega
 * -------------------------------------------------------------------------- */

export const ENTREGA = {
  PENDIENTE: 'pendiente',
  PROGRAMADA: 'programada',
  CUMPLIDA: 'cumplida',
  SUSPENDIDA: 'suspendida',
};

export const ETIQUETA_ENTREGA = {
  pendiente:  'Sin cubrir',
  programada: 'Con camión',
  cumplida:   'Entregada',
  suspendida: 'Suspendida',
};

/**
 * El estado de una entrega, a partir de sus despachos.
 *
 * `suspendida` es la excepción: es una decisión explícita del comercial al bajar
 * el volumen del pedido, no algo que se derive. Por eso se respeta si ya está.
 *
 * @param {Object} entrega
 * @param {Array} despachos los de ESTA entrega
 * @returns {string}
 */
export function estadoEntrega(entrega, despachos) {
  if (entrega && entrega.estado === ENTREGA.SUSPENDIDA) return ENTREGA.SUSPENDIDA;

  const vivos = (despachos || []).filter(despachoVivo);

  if (vivos.length === 0) return ENTREGA.PENDIENTE;
  if (vivos.every(d => d.estado === DESPACHO.ENTREGADO)) return ENTREGA.CUMPLIDA;
  return ENTREGA.PROGRAMADA;
}

/* -----------------------------------------------------------------------------
 * Pedido
 * -------------------------------------------------------------------------- */

export const PEDIDO = {
  PENDIENTE: 'pendiente',
  PROGRAMADO_PARCIAL: 'programado_parcial',
  PROGRAMADO: 'programado',
  CUMPLIDO: 'cumplido',
  SUSPENDIDO: 'suspendido',
};

export const ETIQUETA_PEDIDO = {
  pendiente:          'Pendiente',
  programado_parcial: 'Prog. parcial',
  programado:         'Programado',
  cumplido:           'Cumplido',
  suspendido:         'Suspendido',
};

export const COLOR_PEDIDO = {
  pendiente:          { bg: '#FEF3C7', color: '#92400E' },
  programado_parcial: { bg: '#FAEEDA', color: '#633806' },
  programado:         { bg: '#E1F5EE', color: '#085041' },
  cumplido:           { bg: '#EEEDFE', color: '#3C3489' },
  suspendido:         { bg: '#FCEBEB', color: '#791F1F' },
};

/**
 * El estado de un pedido, a partir de TRES CONTADORES — no de leer sus
 * entregas.
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ CONTADORES Y NO DERIVAR LEYENDO
 * -----------------------------------------------------------------------------
 *   La versión anterior recibía las entregas y las recorría. Eso funciona
 *   perfecto para el coordinador y el admin, que pueden leer `entregas`. Pero el
 *   transportista y el chofer NO PUEDEN: las reglas los dejan afuera, porque
 *   "los pedidos donde tengo un despacho" es un join que las reglas de
 *   Firestore no pueden expresar.
 *
 *   Sin Cloud Functions no hay ningún proceso de confianza que pueda leer todo
 *   y escribir el resultado. Así que el cálculo tiene que poder hacerse SIN
 *   LEER: el chofer que cierra un viaje tiene que poder mover el contador del
 *   pedido sin que eso dependa de un permiso que no tiene.
 *
 *   Firestore tiene `increment()`: una operación atómica del servidor que suma
 *   sin que el cliente necesite leer el valor actual. Dos escrituras
 *   simultáneas no se pisan, porque ninguna de las dos lee-modifica-escribe: las
 *   dos le dicen al servidor "sumale uno a esto".
 *
 * -----------------------------------------------------------------------------
 * QUÉ CAMPOS LLEVA EL PEDIDO
 * -----------------------------------------------------------------------------
 *   entregas_total        number   se fija al crear el pedido, no cambia
 *   entregas_cubiertas    number   cuántas tienen un despacho vivo
 *   entregas_cumplidas    number   cuántas ya entregó el camión
 *
 * -----------------------------------------------------------------------------
 * LO QUE ESTO CUESTA
 * -----------------------------------------------------------------------------
 *   Los contadores pueden desincronizarse si una escritura falla a mitad de
 *   camino. Por eso SIEMPRE se tocan dentro de la misma transacción que el
 *   cambio que los motiva —nunca sueltos— y el número real siempre se puede
 *   recontar desde las entregas. Un script de verificación lo detectaría.
 *
 *   Y no se puede filtrar "todos los programados" en una sola consulta como si
 *   `estado` fuera un campo — pero sí se puede filtrar por
 *   `entregas_cubiertas == 0` para pendientes, que es la consulta que importa
 *   en la práctica.
 *
 * @param {Object} pedido con entregas_total, entregas_cubiertas,
 *   entregas_cumplidas ya actualizados
 * @returns {string}
 */
export function estadoPedido(pedido) {
  if (!pedido) return PEDIDO.PENDIENTE;
  if (pedido.suspendido) return PEDIDO.SUSPENDIDO;

  const total = pedido.entregas_total || 0;
  const cubiertas = pedido.entregas_cubiertas || 0;
  const cumplidas = pedido.entregas_cumplidas || 0;

  if (total === 0) return PEDIDO.PENDIENTE;
  if (cumplidas === total) return PEDIDO.CUMPLIDO;
  if (cubiertas === 0) return PEDIDO.PENDIENTE;
  if (cubiertas === total) return PEDIDO.PROGRAMADO;
  return PEDIDO.PROGRAMADO_PARCIAL;
}

/**
 * Cuánto tiene que cambiar cada contador cuando el estado de UNA entrega pasa
 * de `antes` a `despues`.
 *
 * Se usa dentro de las transacciones para armar el `increment()` correcto sin
 * tener que leer las demás entregas. Cada transición del estado de una entrega
 * mueve como máximo dos contadores.
 *
 * @param {string|null} antes estado anterior de la entrega, o null si es nueva
 * @param {string} despues estado nuevo
 * @returns {{cubiertas: number, cumplidas: number}} el delta a sumar
 */
export function deltaContadores(antes, despues) {
  const eraCubierta = antes === ENTREGA.PROGRAMADA || antes === ENTREGA.CUMPLIDA;
  const esCubierta = despues === ENTREGA.PROGRAMADA || despues === ENTREGA.CUMPLIDA;
  const eraCumplida = antes === ENTREGA.CUMPLIDA;
  const esCumplida = despues === ENTREGA.CUMPLIDA;

  return {
    cubiertas: (esCubierta ? 1 : 0) - (eraCubierta ? 1 : 0),
    cumplidas: (esCumplida ? 1 : 0) - (eraCumplida ? 1 : 0),
  };
}

/* -----------------------------------------------------------------------------
 * Transiciones permitidas
 *
 * Cada acción declara desde dónde se puede hacer. Están acá y no repartidas por
 * las pantallas para que la pregunta "¿se puede hacer esto ahora?" se conteste
 * en un solo lugar.
 * -------------------------------------------------------------------------- */

/** El transportista responde. Solo desde ASIGNADO: una vez que aceptó, se
 *  comprometió a poner un chofer y el camino es pedir la baja. */
export function puedeAceptar(despacho) {
  return despacho && despacho.estado === DESPACHO.ASIGNADO;
}

export function puedeRechazar(despacho) {
  return despacho && despacho.estado === DESPACHO.ASIGNADO;
}

/** Nominar: cargar chofer y camión. Crea el viaje. */
export function puedeNominar(despacho) {
  return despacho && despacho.estado === DESPACHO.ACEPTADO;
}

/** Asignar transportista a uno que quedó sin. */
export function puedeAsignar(despacho) {
  return despacho && despacho.estado === DESPACHO.PENDIENTE_ASIGNACION;
}

/** Reasignar: cambiar de transportista. Solo mientras no haya respondido. */
export function puedeReasignar(despacho) {
  return despacho && despacho.estado === DESPACHO.ASIGNADO;
}

/**
 * Editar fecha y horario de carga.
 *
 * Corta ANTES de nominar: una vez nominado hay un chofer con el viaje en la app
 * y un camión reservado para ese día. Cambiar la fecha por debajo es peor que
 * cancelar y volver a armar, porque nadie se entera salvo por una notificación
 * que se puede perder.
 */
export function puedeEditar(despacho) {
  return despacho && [
    DESPACHO.PENDIENTE_ASIGNACION,
    DESPACHO.ASIGNADO,
    DESPACHO.ACEPTADO,
  ].includes(despacho.estado);
}

/**
 * Cancelar. Llega más lejos que editar, hasta NOMINADO con el viaje sin
 * arrancar: dar de baja algo que no va a pasar tiene que poder hacerse mientras
 * el camión no salió.
 *
 * @param {Object} despacho
 * @param {Object|null} viaje el viaje del despacho, si tiene
 */
export function puedeCancelar(despacho, viaje) {
  if (!despacho || DESPACHOS_MUERTOS.includes(despacho.estado)) return false;
  if (despacho.estado === DESPACHO.ENTREGADO) return false;
  // El camión está en la ruta: cancelarlo no lo detiene, y le saca el viaje de
  // la app al chofer mientras maneja.
  if (viaje && viaje.estado === VIAJE.EN_VIAJE) return false;
  return true;
}

/** ¿Esta entrega necesita un despacho? */
export function entregaSinCubrir(entrega, despachosDeLaEntrega) {
  if (!entrega || entrega.estado === ENTREGA.SUSPENDIDA) return false;
  return (despachosDeLaEntrega || []).filter(despachoVivo).length === 0;
}
