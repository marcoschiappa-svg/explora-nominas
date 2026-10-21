/* =============================================================================
 * logica-migracion-legacy.js — v1.2.3 (migración de `pedidos_portal`)
 * =============================================================================
 *
 * SÍNTOMA
 *   Conviven dos modelos de datos. Los pedidos de `pedidos_portal` (un documento
 *   por pedido, con `cronograma[]`, `despachos[]` y `gps_track_{n}` adentro) no
 *   existen en el modelo nuevo, y hasta ahora el criterio era no migrarlos
 *   (ver el encabezado de `scripts/cargar-entidades.js`: "No hay puente"). Al
 *   darse de baja las pantallas del modelo viejo, ese histórico dejaría de
 *   poder verse.
 *
 * CAUSA RAÍZ
 *   La estructura vieja mezcla tres entidades en el mapa del despacho (despacho,
 *   nominación y viaje), modela la primera entrega aparte del cronograma con
 *   numeraciones desfasadas en uno, guarda el recorrido GPS como campos del
 *   pedido indexados por POSICIÓN en el array, y referencia clientes,
 *   transportes y direcciones como texto libre. No hay una traducción directa:
 *   hay que resolver cada texto contra las organizaciones, domicilios,
 *   productos y usuarios del modelo nuevo. Está documentada campo por campo en
 *   `RELEVAMIENTO_PEDIDOS_PORTAL.md`.
 *
 * ALCANCE
 *   `traducirPedidoLegacy()` es una función PURA: traduce UN documento de
 *   `pedidos_portal` al árbol del modelo nuevo (pedido, entregas, despachos,
 *   viajes, puntos GPS, historial). No lee ni escribe Firestore; el script
 *   `migrar-pedidos-legacy.js` lee los catálogos, la llama y escribe.
 *
 *   Qué se traduce, en resumen (las formas salen del código que crea cada
 *   documento hoy: `crearPedido()`, `aceptarEntrega()`, `denormalizadosDe()`,
 *   `nominar()`, `registrarPuntos()`; no de `MODELO_DATOS_TOBE.md`):
 *     - Pedido: `numero` = el `id` visible viejo, `origen_carga:
 *       'migracion_legacy'`, `legacy_doc_id`, `legacy_numero`. Cliente por el
 *       mapa `CLIENTES` + `clave_normalizada`; producto por nombre; origen y
 *       destino por la tabla de `tipo` (la planta de Explora es el domicilio
 *       principal de la organización `es_propia`).
 *     - Entregas: la 1 sale de `fecha_entrega` + `volumen_entrega1`; las demás
 *       del `cronograma[]` con `numero = nro + 1`.
 *     - Despachos: estado por tabla, transporte por el mapa `TRANSPORTES`,
 *       chofer por DNI contra `usuarios.datos_chofer.dni`.
 *     - Viajes: solo para los despachos con `estado_chofer`.
 *     - Puntos GPS: de `gps_track_{i}` con `i` = posición en `despachos[]`,
 *       sin los duplicados (misma lat/lng a menos de 1000 ms del punto
 *       anterior que quedó).
 *
 *   Lo que no se puede resolver NO se adivina: va a `sinResolver` (con tipo,
 *   valor y detalle) y el script frena antes de escribir. Lo informativo (un
 *   chofer sin usuario nuevo, un `creado_por_email` sin usuario) va a `avisos`
 *   y no frena. Un cliente que el mapa da como `null` (dato de prueba) no se
 *   migra: devuelve `omitir`.
 *
 *   IDs: la función recibe `generarId(clave)` (opcional). Las claves locales son
 *   `'pedido'`, `'entrega:<numero>'`, `'despacho:<posición>'`, `'viaje:<posición>'`
 *   e `'historial:migracion'`. Por defecto devuelve la propia clave, así que el
 *   resultado es determinístico y testeable; el script pasa una función que
 *   devuelve el ID real (autogenerado, o el ya existente si el pedido quedó a
 *   medio migrar).
 *
 *   También exporta `arbolParaCierre()` y `aplicarCierreAlArbol()`: el puente
 *   entre este árbol y `armarCierreAdministrativo()`, para que el script no
 *   tenga lógica propia.
 *
 *   v1.2.3 (ajuste) — SUSPENDIDOS: `aplicarSuspensionAlArbol()` aplica sobre el
 *   árbol de un pedido viejo `Suspendido` el mismo efecto en datos que
 *   `suspenderPedido()` (`logica-pedidos.js`) + `cancelarDespacho()`
 *   (`logica-despachos.js`):
 *     - despachos vivos que no están `ENTREGADO` -> `CANCELADO`, con
 *       `cancelacion_motivo` y `estado_ts`;
 *     - el viaje de cada despacho cancelado -> `CANCELADO` (conserva su ID y
 *       sus puntos GPS);
 *     - entregas no `cumplida` -> `suspendida` (las cumplidas no se tocan, ni
 *       sus despachos `ENTREGADO` ni sus viajes finalizados);
 *     - contadores como los dejan esas acciones: `entregas_total` NO cambia
 *       (suspender no lo toca; por eso `verificar-contadores.js` ignora los
 *       suspendidos), `entregas_cumplidas` igual, y `entregas_cubiertas` baja
 *       a las entregas que siguen cumplidas;
 *     - `estadoPedido()` da `suspendido`; no queda despacho vivo ni viaje
 *       abierto.
 *   No hay un registro de historial aparte: el efecto se suma al registro
 *   `migrar_pedido_legacy` (`despachos_cancelados`, `viajes_cancelados`,
 *   `entregas_suspendidas`). Un suspendido NO pasa por el cierre administrativo.
 *
 * UBICACIÓN Y COPIAS LOCALES
 *   Vive en `src/` y en CommonJS por el mismo motivo que `mapa-normalizacion.js`
 *   (lo usan los scripts de Node y jest). No puede importar `shared/estados.js`
 *   ni `buscar-domicilios.js` (ES modules), así que lleva COPIAS locales de
 *   `DESPACHO`, `VIAJE`, `ENTREGA`, `estadoEntrega()`, `textoDomicilio()` y
 *   `TIPOS`, cada una con su origen. `logica-migracion-legacy.test.js` tiene
 *   pruebas de paridad contra los originales.
 *
 * LIMITACIONES CONOCIDAS
 *   - `creado_en` del despacho y del viaje es una APROXIMACIÓN: el documento
 *     viejo no tiene una fecha de creación del despacho que se pueda parsear
 *     (`aceptado_en` es `toLocaleString`, de 12 horas sin AM/PM). Se usa el
 *     `creado_en` del pedido (o `estado_chofer_ts` para el viaje).
 *   - `aceptado_por`, `editado_por` y demás casilleros únicos del modelo viejo
 *     no se migran: el historial de esas acciones nunca existió.
 *   - La suspensión (`aplicarSuspensionAlArbol()`) replica el efecto en DATOS de
 *     `suspenderPedido()`, no sus avisos: no escribe `avisos/{id}` al
 *     transportista ni al chofer, ni llama al Apps Script, ni manda mails.
 *   - Un viaje `EN_VIAJE` de un pedido suspendido SÍ se cancela, aunque
 *     `suspenderPedido()` se negaría a suspender con un chofer en ruta: son
 *     datos históricos, y dejar el viaje abierto lo mostraría en TrackEx.
 *   - `suspenderPedido()` intenta cancelar también los despachos `ENTREGADO`
 *     (son "vivos" para `despachoVivo()`), pero `cancelarDespacho()` los
 *     rechaza; su propio comentario dice que NO se tocan. Acá no se tocan.
 *   - `volumen_despachado` (acumulado guardado) y los datos de contacto
 *     copiados al despacho (`email_transportista`, `emails_extra`,
 *     `telefonos`, `cuit_transporte`, `tel_*`) no se migran: el modelo nuevo
 *     los resuelve desde `usuarios`/`organizaciones`.
 *   - Se descarta el campo `lugar` del pedido: en "Entrega en planta" está
 *     pisado con la dirección de Explora; la dirección sale de los cinco campos
 *     sueltos.
 *   - `rechazo_motivo` queda en `null`: el modelo viejo no guarda el motivo.
 *   - El recorrido de un despacho sin `estado_chofer` (sin viaje) no se migra
 *     (queda como aviso `gps_sin_viaje`).
 *   - Si dos puntos distintos caen en el mismo milisegundo, queda el primero
 *     (el ID del punto es el milisegundo).
 *   - Un pedido con más de unas 150 entregas no entra en una sola transacción
 *     de Firestore (límite de 500 operaciones); el script lo avisa.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- logica-migracion-legacy`: un documento armado a partir
 *   de `PED-260819-165` del relevamiento (volumen 20, cronograma de 19, D1 en la
 *   entrega 1, D2 con viaje finalizado y su recorrido en `gps_track_1` con
 *   puntos duplicados), suspendido, cliente con mapa `null`, desconocidos en
 *   cliente/producto/domicilio/estado/transporte, transporte `'—'`, chofer sin
 *   usuario, y paridad con los originales.
 *
 * -----------------------------------------------------------------------------
 * v1.2.3 (prompt 3) — LO QUE FRENÓ LA SIMULACIÓN CONTRA PRODUCCIÓN
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Sobre 233 documentos de `pedidos_portal`, 14 se omiten (datos de prueba) y
 *     57 migran sin problemas; el resto frenaba por cinco causas: tipos de
 *     pedido con nombre viejo, despachos sin `entrega_nro`, entrega 1 sin
 *     `volumen_entrega1` con cronograma, direcciones que no coinciden con
 *     ningún domicilio del cliente, y un cliente fuera del mapa.
 *
 *   CAUSA RAÍZ
 *     El modelo viejo cambió con el tiempo y los datos de cada época son
 *     distintos: los tipos se renombraron, `entrega_nro` nació el 10/07/2026
 *     (`b18807e`) y el modelo "una entrega = un camión" llegó el 30/07/2026
 *     (`82a5f18`), y las direcciones eran texto libre.
 *
 *   ALCANCE
 *     1. `TIPOS_LEGACY`: equivalencias de tipo, aplicadas antes de validarlo. El
 *        pedido guarda el tipo nuevo y el original en `legacy_tipo`.
 *     2. Despacho sin `entrega_nro`, en este orden: (1) si lo trae, se usa;
 *        (2) si el pedido tiene UNA sola entrega, todos van a la entrega 1;
 *        (3) con varias, `Dn` va a la entrega `n` si existe (aviso
 *        `entrega_por_numero_de_despacho`, no frena); (4) si nada alcanza,
 *        `sinResolver`.
 *     3. Entrega 1 sin `volumen_entrega1` con cronograma: `volumen − suma del
 *        cronograma`, solo si da mayor que 0 (aviso `volumen_entrega1_calculado`
 *        con la cuenta); si da 0 o negativo, `sinResolver`.
 *     4. Domicilio del cliente, en este orden: (1) `DOMICILIOS_LEGACY_POR_PEDIDO`
 *        (`mapa-normalizacion.js`); (2) coincidencia por `claveDomicilio()`,
 *        como antes; (3) `DOMICILIOS_LEGACY` con la dirección tal cual la
 *        imprime el reporte; (4) `sinResolver`. En (1) y (3) el domicilio
 *        destino tiene que estar VINCULADO a la organización: si existe pero
 *        no lo está, `sinResolver` con ese motivo. `domiciliosCandidatos()`
 *        devuelve los domicilios que la organización ya tiene, para que el
 *        reporte los muestre debajo de cada dirección sin resolver.
 *     5. Un cliente fuera de `CLIENTES` sigue yendo a `sinResolver`: al agregar
 *        la entrada al mapa, el flujo existente la resuelve sin cambios.
 *
 *   LIMITACIONES CONOCIDAS
 *     - Despacho sin `entrega_nro` en un pedido de una sola entrega: la entrega
 *       migrada puede tener VARIOS despachos `ENTREGADO`. `estadoEntrega()` lo
 *       tolera (todos los vivos entregados -> cumplida) y el ciclo de vida
 *       toma uno como "tronco", con el criterio que ya tiene
 *       `armarCicloDeEntrega()`; los otros no aparecen como rama.
 *     - `Dn -> entrega n` es una deducción por el número del despacho, no un
 *       dato: por eso va a `avisos`.
 *     - La resta del volumen de la entrega 1 asume que el cronograma guardaba de
 *       la entrega 2 en adelante (el modelo del período 10/07–30/07).
 *     - `legacy_tipo` solo se guarda si hubo equivalencia.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- logica-migracion-legacy`: los dos tipos viejos y uno
 *     sin equivalencia; un despacho y una entrega, dos despachos y una entrega,
 *     varias entregas; entrega 1 con resto positivo, cero y negativo; los dos
 *     mapas de domicilios (resuelve, clave inexistente, sin vínculo, prioridad
 *     por pedido); candidatos; y una entrada nueva de `CLIENTES`.
 *
 * -----------------------------------------------------------------------------
 * v1.2.3 (prompt 4) — DOMICILIOS DESDE EL RELEVAMIENTO, LA PLANTA Y EL VOLUMEN 0
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     La simulación contra producción quedó con 89 pendientes, casi todos
 *     domicilios. Pero esas equivalencias YA están relevadas y confirmadas en el
 *     repo (`scripts/datos-domicilios.js`, con las `variantes` exactas de
 *     `lugar`, y `MAPA_DOMICILIOS.md`): 29 de las 30 direcciones pendientes
 *     coinciden con una variante. Además, los pedidos de "Retiro del cliente" y
 *     "Retiro de proveedor" traen la dirección de la PLANTA, no la del cliente.
 *     Y dos pedidos con cronograma que ya cubre todo el volumen frenaban.
 *
 *   CAUSA RAÍZ
 *     1. La migración no usaba el relevamiento: obligaba a copiarlo a mano a
 *        `DOMICILIOS_LEGACY`.
 *     2. En esos tipos el comercial escribía la planta (Yrigoyen 2933, Puerto
 *        General San Martín) en los campos de dirección (MAPA_DOMICILIOS.md
 *        §1.1): no es un domicilio del cliente y no está vinculado a él.
 *     3. Entre el cronograma (10/07/2026) y el rediseño (30/07/2026), a veces
 *        el cronograma ya incluía la primera entrega.
 *
 *   ALCANCE
 *     1. Orden de resolución del domicilio: (1) `DOMICILIOS_LEGACY_POR_PEDIDO`;
 *        (2) `claveDomicilio()` contra los vinculados al cliente (como antes);
 *        (3) NUEVO: `claveNormalizada()` del texto de la dirección vieja contra
 *        las `variantes` de `catalogos.domiciliosRelevados` (el script pasa
 *        `DOMICILIOS` de `datos-domicilios.js`; este módulo no depende de
 *        `scripts/`) -> el domicilio con `clave_normalizada ===
 *        claveDomicilio(canónico)`; si no existe, `sinResolver`; (4)
 *        `DOMICILIOS_LEGACY`; (5) `sinResolver`. Los pasos 2, 3 y 4 exigen el
 *        domicilio VINCULADO a la organización, salvo el caso 2 de abajo.
 *     2. Si la dirección resuelta es la PLANTA (principal de la organización
 *        `es_propia`, como el `domicilioPlanta` de `Pedidos.js`) y el tipo (ya
 *        traducido) tiene `destino: 'propia'`: la dirección vieja es el destino,
 *        que ya sale como planta; `origen_domicilio_id` queda en `null`, con el
 *        aviso `origen_es_la_planta`. No frena y no exige vínculo. NO se usa el
 *        domicilio principal del cliente (sería inventar). Esta regla va ANTES
 *        de exigir vínculo: aplica también a un cliente que tiene la planta
 *        vinculada (METHIL GROUP). Con "Entrega al cliente" va a `sinResolver`
 *        ("la dirección del cliente es la de la planta"). El `origen_texto` del
 *        viaje queda `''` cuando el origen es `null`.
 *     3. Con `volumen − suma(cronograma) === 0` (y sin `volumen_entrega1`) las
 *        entregas salen SOLO del cronograma, con `numero = nro` (sin +1);
 *        `fecha_entrega` se ignora (aviso `cronograma_cubre_el_pedido`). Los
 *        despachos con `entrega_nro` van a esa entrega; si no existe, frena. Si
 *        el resto es negativo, sigue frenando.
 *
 *   LIMITACIONES CONOCIDAS
 *     - Un pedido migrado puede tener `origen_domicilio_id: null`. Lo leen
 *       `Programacion.js` (`payloadDe()`, con guarda: `lugar_carga` queda
 *       vacío) y nada más; ver el reporte de la tarea.
 *     - La comparación con las variantes usa solo `claveNormalizada()` del texto:
 *       una variante nueva, escrita distinto, no coincide y va a
 *       `DOMICILIOS_LEGACY`.
 *     - Si dos canónicos compartieran una misma variante normalizada, gana el
 *       primero de `datos-domicilios.js`.
 *     - Con `volumen_entrega1` presente y resto 0, el cronograma NO se
 *       reinterpreta (se mantiene `numero = nro + 1`).
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- logica-migracion-legacy`: resolución por variantes;
 *     "Entrega en planta" con Yrigoyen y cliente sin domicilios, "Retiro de
 *     Proveedores" con Yrigoyen, "Entrega al cliente" con Yrigoyen (frena) y un
 *     cliente con la planta vinculada (METHIL); el cronograma que cubre todo,
 *     con y sin `entrega_nro`, y con uno inexistente.
 * ========================================================================== */

const {
  claveNormalizada,
  claveDomicilio,
  resolverOrganizacionSuave,
  DOMICILIOS_LEGACY,
  DOMICILIOS_LEGACY_POR_PEDIDO,
} = require('./mapa-normalizacion');

/* -----------------------------------------------------------------------------
 * Copias locales
 * -------------------------------------------------------------------------- */

// 1. Copia de `DESPACHO`, `VIAJE` y `ENTREGA` de `shared/estados.js`.
const DESPACHO = {
  PENDIENTE_ASIGNACION: 'PENDIENTE_ASIGNACION',
  ASIGNADO: 'ASIGNADO',
  ACEPTADO: 'ACEPTADO',
  NOMINADO: 'NOMINADO',
  ENTREGADO: 'ENTREGADO',
  RECHAZADO: 'RECHAZADO',
  CANCELADO: 'CANCELADO',
};

const VIAJE = {
  RECIBIDO: 'RECIBIDO',
  EN_VIAJE: 'EN_VIAJE',
  FINALIZADO: 'FINALIZADO',
  CANCELADO: 'CANCELADO',
};

const ENTREGA = {
  PENDIENTE: 'pendiente',
  PROGRAMADA: 'programada',
  CUMPLIDA: 'cumplida',
  SUSPENDIDA: 'suspendida',
};

// 2. Copia de `despachoVivo()` y `estadoEntrega()` de `shared/estados.js`.
function despachoVivo(d) {
  return !!d && d.estado !== DESPACHO.RECHAZADO && d.estado !== DESPACHO.CANCELADO;
}

function estadoEntrega(entrega, despachos) {
  if (entrega && entrega.estado === ENTREGA.SUSPENDIDA) return ENTREGA.SUSPENDIDA;

  const vivos = (despachos || []).filter(despachoVivo);

  if (vivos.length === 0) return ENTREGA.PENDIENTE;
  if (vivos.every(d => d.estado === DESPACHO.ENTREGADO)) return ENTREGA.CUMPLIDA;
  return ENTREGA.PROGRAMADA;
}

// 3. Copia de `textoDomicilio()` de `buscar-domicilios.js`.
function textoDomicilio(d) {
  if (!d) return '';
  return [
    [d.calle, d.numero].filter(Boolean).join(' '),
    d.ciudad,
    d.provincia,
    d.cp,
  ].filter(Boolean).join(', ');
}

// 4. Copia de `TIPOS` de `tipos-pedido.js`: de dónde sale cada punta.
const TIPOS = {
  'Entrega al cliente':    { origen: 'propia',  destino: 'cliente' },
  'Entrega en planta':     { origen: 'cliente', destino: 'propia' },
  'Retiro de Proveedores': { origen: 'cliente', destino: 'propia' },
};

// 4b. v1.2.3 (prompt 3): nombres ANTERIORES de tipos que hoy existen. Se
//     aplica antes de validar el tipo; el pedido guarda el tipo nuevo y el
//     original en `legacy_tipo`. Salen del historial de git:
//       - "Retiro del cliente" se renombró a "Entrega en planta" en el commit
//         `5eef0ea` (22/07/2026). Fue el mismo botón: `sinTransportista()`
//         siguió aceptando los dos valores.
//       - "Retiro de proveedor" es el nombre original de "Retiro de
//         Proveedores": estaba en `TIPOS_VALIDOS` de las primeras versiones
//         de `Coordinador.js`.
const TIPOS_LEGACY = {
  'Retiro del cliente': 'Entrega en planta',
  'Retiro de proveedor': 'Retiro de Proveedores',
};

/* -----------------------------------------------------------------------------
 * Tablas de traducción
 * -------------------------------------------------------------------------- */

// 5. Estado del despacho viejo -> nuevo. `Nominado` y `En espera` tienen
//    tratamiento especial (ver `estadoDespachoNuevo()`).
const ESTADO_DESPACHO = {
  'Aceptado-pendiente': DESPACHO.PENDIENTE_ASIGNACION,
  'Programado': DESPACHO.ASIGNADO,
  'Aceptado': DESPACHO.ACEPTADO,
  'Nominado': DESPACHO.NOMINADO,
  'Rechazado': DESPACHO.RECHAZADO,
  'En espera': DESPACHO.CANCELADO,
};

// 6. `estado_chofer` viejo -> estado del viaje nuevo. `demorado` es un estado
//    en el modelo viejo y un atributo en el nuevo.
const ESTADO_VIAJE = {
  recibido: VIAJE.RECIBIDO,
  iniciado: VIAJE.EN_VIAJE,
  demorado: VIAJE.EN_VIAJE,
  finalizado: VIAJE.FINALIZADO,
};

const MOTIVO_SUSPENSION_DEFECTO = 'Pedido suspendido en el modelo anterior';
const MOTIVO_EN_ESPERA = 'En espera en el modelo anterior';
const UID_SCRIPT = 'script:migrar-pedidos-legacy';
const USUARIO_DEFECTO = { uid: UID_SCRIPT, nombre: 'Migración v1.2.3' };
const MARCADORES_SIN_TRANSPORTE = ['', '-', '—'];
const VENTANA_DUPLICADO_MS = 1000;

/* -----------------------------------------------------------------------------
 * Utilidades
 * -------------------------------------------------------------------------- */

/**
 * 7. Un string ISO (`2026-08-19T14:49:04.776Z`) a `Date`, o `null`.
 *    SOLO acepta ISO: los `toLocaleString('es-AR')` del modelo viejo
 *    ("19/8/2026, 11:49:04") no se pueden parsear sin ambigüedad (día/mes), y
 *    `new Date()` los leería al revés en silencio.
 */
function parsearISO(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 8. Firestore rechaza `undefined`: un campo ausente se guarda como `null`. */
function nulo(v) {
  return v === undefined ? null : v;
}

function soloDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

function texto(v) {
  return String(v == null ? '' : v).trim();
}

/** 8b. Redondea a 3 decimales: restar volúmenes decimales no da `0.30000000000000004`. */
function redondear(n) {
  return Math.round(n * 1000) / 1000;
}

/** 9. Un valor numérico finito, o `null`. */
function numero(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* -----------------------------------------------------------------------------
 * Puntos GPS
 * -------------------------------------------------------------------------- */

/**
 * 10. Pasa un `gps_track_{n}` a los puntos que se escriben en
 *     `viajes/{id}/gps_puntos/{ms}`, con la forma de `registrarPuntos()`
 *     (`lat`, `lng`, `ts` Date, `precision` y `velocidad` en `null`).
 *
 *     DUPLICADOS (relevamiento §4): dos suscripciones de ubicación llamaban a
 *     `registrarPunto` con la misma lectura. Se descarta un punto si tiene la
 *     misma lat/lng que el último punto QUE QUEDÓ y está a menos de 1000 ms.
 *     (Contra el último que quedó y no contra el anterior crudo: una cadena de
 *     tres lecturas iguales separadas por 900 ms dejaría solo la primera, pero
 *     un camión detenido que reporta cada 30 segundos conserva todos sus
 *     puntos.)
 *
 * @returns {{puntos: Array<{id: string, datos: Object}>, descartados: number}}
 */
function traducirTrack(track) {
  const crudos = [];
  (Array.isArray(track) ? track : []).forEach(p => {
    const fecha = p ? parsearISO(p.ts) : null;
    const lat = p ? numero(p.lat) : null;
    const lng = p ? numero(p.lng) : null;
    if (!fecha || lat === null || lng === null) return;
    crudos.push({ ms: fecha.getTime(), lat, lng });
  });
  crudos.sort((a, b) => a.ms - b.ms);

  const puntos = [];
  const ids = new Set();
  let descartados = 0;
  let ultimo = null;

  for (const p of crudos) {
    const repetido = ultimo
      && p.lat === ultimo.lat && p.lng === ultimo.lng
      && (p.ms - ultimo.ms) < VENTANA_DUPLICADO_MS;
    // El ID es el milisegundo: dos puntos en el mismo ms se pisarían.
    if (repetido || ids.has(String(p.ms))) { descartados++; continue; }

    ids.add(String(p.ms));
    puntos.push({
      id: String(p.ms),
      datos: { lat: p.lat, lng: p.lng, ts: new Date(p.ms), precision: null, velocidad: null },
    });
    ultimo = p;
  }

  return { puntos, descartados };
}

/* -----------------------------------------------------------------------------
 * Traducción de un pedido
 * -------------------------------------------------------------------------- */

/**
 * @param {Object} params
 * @param {Object} params.legacy el documento de `pedidos_portal`
 * @param {string} params.legacyDocId su ID de documento (no el `id` visible)
 * @param {Object} params.catalogos `{ organizaciones, domicilios, vinculos,
 *   productos, usuarios }`, cada uno `[{ id, ...campos }]`; `vinculos` son los
 *   `organizacion_domicilios`
 * @param {Date} params.ahora instante de la migración (va al historial)
 * @param {{uid: string, nombre: string}} [params.usuario] usuario del historial
 * @param {function} [params.generarId] `(clave) => id`; por defecto, la clave
 * @returns {{ok: boolean, sinResolver: Array, avisos: Array, omitir: Object|null,
 *   pedido: Object|null, entregas: Array, despachos: Array, viajes: Array,
 *   puntosGps: Array, historial: Array, resumen: Object}}
 */
function traducirPedidoLegacy({
  legacy, legacyDocId, catalogos, ahora, usuario = USUARIO_DEFECTO, generarId = (c) => c,
}) {
  if (!(ahora instanceof Date) || Number.isNaN(ahora.getTime())) {
    throw new Error('traducirPedidoLegacy: `ahora` tiene que ser un Date válido.');
  }
  const {
    organizaciones = [], domicilios = [], vinculos = [], productos = [], usuarios = [],
    domiciliosRelevados = [],
  } = catalogos || {};

  const sinResolver = [];
  const avisos = [];
  const pendiente = (tipo, valor, detalle, extra = {}) => sinResolver.push({ tipo, valor, detalle, ...extra });

  const vacio = (extra = {}) => ({
    ok: false, sinResolver, avisos, omitir: null, pedido: null,
    entregas: [], despachos: [], viajes: [], puntosGps: [], historial: [], resumen: {},
    ...extra,
  });

  const numeroVisible = texto(legacy.id);
  const despachosLegacy = Array.isArray(legacy.despachos) ? legacy.despachos : [];
  const cronograma = Array.isArray(legacy.cronograma) ? legacy.cronograma : [];

  /* ── 1. Cliente ──────────────────────────────────────────────────────────── */

  // 11. Mapa `CLIENTES` -> nombre canónico -> `organizaciones` por
  //     `clave_normalizada`, igual que `cargar-entidades.js`. Un `null` del
  //     mapa es un dato de prueba: el pedido NO se migra.
  const nombreCliente = texto(legacy.cliente);
  const rCliente = resolverOrganizacionSuave(nombreCliente, 'cliente');
  let orgCliente = null;

  if (nombreCliente === '') {
    pendiente('cliente', '', 'El pedido no tiene cliente');
  } else if (!rCliente.conocido) {
    pendiente('cliente', nombreCliente, 'No está en el mapa CLIENTES de mapa-normalizacion.js');
  } else if (rCliente.canonico === null) {
    return vacio({
      omitir: { razon: `Cliente "${nombreCliente}" marcado como "no migrar" (dato de prueba) en el mapa CLIENTES` },
    });
  } else {
    const clave = claveNormalizada(rCliente.canonico);
    orgCliente = organizaciones.find(o => o.clave_normalizada === clave) || null;
    if (!orgCliente) {
      pendiente('cliente', nombreCliente, `La organización "${rCliente.canonico}" no existe en organizaciones`);
    }
  }

  /* ── 2. Producto ─────────────────────────────────────────────────────────── */

  // 12. Nombre exacto, sin mayúsculas ni espacios de los extremos.
  const nombreProducto = texto(legacy.producto);
  const producto = productos.find(p => texto(p.nombre).toLowerCase() === nombreProducto.toLowerCase()) || null;
  if (!producto) pendiente('producto', nombreProducto, 'No existe en productos (se busca por nombre exacto)');

  /* ── 3. Origen y destino ─────────────────────────────────────────────────── */

  // 12b. v1.2.3 (prompt 3): primero la tabla de nombres viejos (`TIPOS_LEGACY`),
  //      después se valida. Sin equivalencia sigue yendo a `sinResolver`.
  const tipoOriginal = texto(legacy.tipo);
  const tipoPorEquivalencia = !TIPOS[tipoOriginal] && Object.prototype.hasOwnProperty.call(TIPOS_LEGACY, tipoOriginal);
  const tipo = tipoPorEquivalencia ? TIPOS_LEGACY[tipoOriginal] : tipoOriginal;
  const config = TIPOS[tipo] || null;
  if (!config) pendiente('tipo', tipoOriginal, 'Tipo de pedido desconocido');

  // 13. Misma regla que `domicilioPlanta` de `Pedidos.js`: el vínculo
  //     `principal` de la organización `es_propia`, o el primero.
  const domPorId = new Map(domicilios.map(d => [d.id, d]));
  let planta = null;
  const orgPropia = organizaciones.find(o => o.es_propia) || null;
  if (orgPropia) {
    const delaPropia = vinculos.filter(v => v.organizacion_id === orgPropia.id);
    const principal = delaPropia.find(v => v.principal) || delaPropia[0];
    planta = principal ? domPorId.get(principal.domicilio_id) || null : null;
  }

  // 14. El domicilio del cliente se busca con `claveDomicilio()` sobre los
  //     CINCO campos sueltos del documento viejo, entre los vinculados a la
  //     organización. Nunca `lugar`: en "Entrega en planta" está pisado con la
  //     dirección de Explora (relevamiento §1.4).
  let domCliente = null;
  const direccionLegacy = {
    calle: texto(legacy.calle), numero: texto(legacy.numero), ciudad: texto(legacy.ciudad),
    provincia: texto(legacy.provincia), cp: texto(legacy.cp),
  };

  if (config && !planta) {
    pendiente('domicilio', 'planta de Explora', 'No hay organización propia con domicilio vinculado');
  }
  if (config && orgCliente) {
    const direccionTexto = textoDomicilio(direccionLegacy);
    const claveDe = (d) => d.clave_normalizada || claveDomicilio(d);
    const delCliente = vinculos
      .filter(v => v.organizacion_id === orgCliente.id)
      .map(v => domPorId.get(v.domicilio_id))
      .filter(Boolean);

    // 14b. v1.2.3 (prompt 3): una clave de los mapas explícitos de
    //      `mapa-normalizacion.js` resuelve a un domicilio que EXISTE y está
    //      VINCULADO a esta organización. Si no, no se ignora: `sinResolver`
    //      con el motivo.
    const porClave = (clave, origen, exigeVinculo = true) => {
      const dom = domicilios.find(d => claveDe(d) === clave);
      if (!dom) return { error: `${origen}: la clave "${clave}" no existe en domicilios` };
      if (exigeVinculo && !delCliente.some(d => d.id === dom.id)) {
        return { error: `${origen}: el domicilio "${textoDomicilio(dom)}" existe pero no está vinculado a la organización` };
      }
      return { dom };
    };

    // 14c. v1.2.3 (prompt 4): las `variantes` RELEVADAS de `datos-domicilios.js`
    //      (los textos exactos de `lugar` del modelo viejo, ya revisados a mano:
    //      ver MAPA_DOMICILIOS.md). El script las pasa en
    //      `catalogos.domiciliosRelevados`; este módulo no depende de `scripts/`.
    //      Se compara `claveNormalizada()` del texto de la dirección vieja (el
    //      mismo que imprime el reporte) contra la de cada variante.
    const claveTexto = claveNormalizada(direccionTexto);
    const relevado = direccionTexto
      ? domiciliosRelevados.find(c => (c.variantes || []).some(v => claveNormalizada(v) === claveTexto))
      : null;

    // 14d. Orden: 1) por pedido, 2) `claveDomicilio()` (los vinculados al
    //      cliente, y la planta), 3) variantes relevadas, 4) `DOMICILIOS_LEGACY`,
    //      5) sinResolver. Devuelve la clave a la que apunta, o el domicilio ya
    //      hallado; la existencia y el vínculo se validan después.
    const claveLegacy = claveDomicilio(direccionLegacy);
    const clavePlanta = planta ? claveDe(planta) : null;
    let hallazgo = null;
    if (Object.prototype.hasOwnProperty.call(DOMICILIOS_LEGACY_POR_PEDIDO, numeroVisible)) {
      hallazgo = { clave: DOMICILIOS_LEGACY_POR_PEDIDO[numeroVisible], origen: 'DOMICILIOS_LEGACY_POR_PEDIDO' };
    } else if (delCliente.some(d => claveDomicilio(d) === claveLegacy)) {
      hallazgo = { dom: delCliente.find(d => claveDomicilio(d) === claveLegacy) };
    } else if (clavePlanta && claveLegacy === clavePlanta) {
      hallazgo = { dom: planta };
    } else if (relevado) {
      hallazgo = { clave: claveDomicilio(relevado), origen: 'datos-domicilios.js (variantes relevadas)' };
    } else if (direccionTexto && Object.prototype.hasOwnProperty.call(DOMICILIOS_LEGACY, direccionTexto)) {
      hallazgo = { clave: DOMICILIOS_LEGACY[direccionTexto], origen: 'DOMICILIOS_LEGACY' };
    }

    // 14e. v1.2.3 (prompt 4): ¿la dirección vieja es la PLANTA de Explora? En
    //      los pedidos de "Retiro del cliente"/"Retiro de proveedor" (hoy
    //      "Entrega en planta"/"Retiro de Proveedores") el comercial escribía
    //      la planta en los campos de dirección: no es la dirección del cliente
    //      (MAPA_DOMICILIOS.md §1.1). Esta regla va ANTES de exigir vínculo con
    //      la organización, y también aplica a un cliente que sí tiene la
    //      planta vinculada (METHIL GROUP).
    const esPlanta = !!hallazgo && !!planta && (
      (hallazgo.dom && hallazgo.dom.id === planta.id)
      || (hallazgo.clave && hallazgo.clave === clavePlanta)
    );

    if (esPlanta && config.destino === 'propia') {
      // El destino ya es la planta. NO se usa el domicilio principal del
      // cliente como origen: sería inventar. El origen queda en `null`.
      domCliente = null;
      avisos.push({
        tipo: 'origen_es_la_planta',
        valor: numeroVisible,
        detalle: `Organización: ${orgCliente.razon_social} — el pedido viejo traía la dirección de la planta; la dirección del cliente no está registrada (origen_domicilio_id queda en null)`,
      });
    } else if (esPlanta) {
      // "Entrega al cliente" a la planta: no hay dirección del cliente.
      pendiente(
        'domicilio', direccionTexto || '(sin dirección)',
        `Organización: ${orgCliente.razon_social} — la dirección del cliente es la de la planta`,
        { organizacion_id: orgCliente.id }
      );
    } else {
      let r = {};
      if (hallazgo && hallazgo.dom) {
        r = { dom: hallazgo.dom };
      } else if (hallazgo) {
        r = porClave(hallazgo.clave, hallazgo.origen);
      }
      domCliente = r.dom || null;
      if (!domCliente) {
        pendiente(
          'domicilio',
          direccionTexto || '(sin dirección)',
          `Organización: ${orgCliente.razon_social}` + (r.error ? ` — ${r.error}` : ''),
          { organizacion_id: orgCliente.id }
        );
      }
    }
  }

  const origenDom = config ? (config.origen === 'propia' ? planta : domCliente) : null;
  const destinoDom = config ? (config.destino === 'propia' ? planta : domCliente) : null;

  /* ── 4. Fechas, volumen y usuario ────────────────────────────────────────── */

  // 15. `creado_en` es OBLIGATORIO: `Pedidos.js` consulta con
  //     `orderBy('creado_en')` y Firestore excluye los documentos sin el campo.
  const creadoEn = parsearISO(legacy.timestamp);
  if (!creadoEn) {
    pendiente('fecha', texto(legacy.timestamp), 'El campo `timestamp` falta o no es una fecha ISO');
  }

  const volumenTotal = numero(legacy.volumen);
  if (volumenTotal === null) pendiente('volumen', texto(legacy.volumen), 'El volumen del pedido no es un número');

  const emailCreador = texto(legacy.creado_por_email).toLowerCase();
  const creador = emailCreador
    ? usuarios.find(u => texto(u.email).toLowerCase() === emailCreador) || null
    : null;
  if (!creador) {
    avisos.push({
      tipo: 'creado_por_uid',
      valor: emailCreador || '(vacío)',
      detalle: 'No hay un usuario nuevo con ese email: creado_por_uid queda en null',
    });
  }

  /* ── 5. Entregas ─────────────────────────────────────────────────────────── */

  // 16. La entrega 1 vive en el pedido; las demás en `cronograma[]` con
  //     `numero = nro + 1` (relevamiento §2).
  const entregasBase = [];
  const fecha1 = texto(legacy.fecha_entrega);

  let volumen1 = numero(legacy.volumen_entrega1);
  // 16c. v1.2.3 (prompt 4): con `volumen − suma(cronograma) === 0` el cronograma
  //      de ese período ya incluía la primera entrega: las entregas salen SOLO
  //      del cronograma, con `numero = nro` (sin el +1), y `fecha_entrega` se
  //      ignora, con aviso.
  let cronogramaCubreTodo = false;
  if (volumen1 === null && cronograma.length === 0) volumen1 = volumenTotal;
  if (volumen1 === null && volumenTotal !== null) {
    // 16b. v1.2.3 (prompt 3): entre el cronograma (10/07/2026) y el rediseño
    //      (30/07/2026) el cronograma guardaba de la entrega 2 en adelante y la
    //      1 era el resto. Solo si da mayor que 0; si da 0, ver 16c; si da
    //      negativo, no se adivina.
    const volumenes = cronograma.map(c => numero(c && c.volumen));
    const suma = volumenes.every(v => v !== null) ? redondear(volumenes.reduce((a, b) => a + b, 0)) : null;
    const resto = suma === null ? null : redondear(volumenTotal - suma);
    if (resto !== null && resto > 0) {
      volumen1 = resto;
      avisos.push({
        tipo: 'volumen_entrega1_calculado',
        valor: numeroVisible,
        detalle: `Sin volumen_entrega1: volumen ${volumenTotal} − cronograma ${suma} = ${resto}`,
      });
    } else if (resto === 0) {
      cronogramaCubreTodo = true;
      avisos.push({
        tipo: 'cronograma_cubre_el_pedido',
        valor: numeroVisible,
        detalle: `El cronograma (${suma}) ya cubre el volumen del pedido (${volumenTotal}): las entregas salen solo del cronograma (numero = nro) y fecha_entrega (${fecha1 || 'vacía'}) se ignora`,
      });
    } else {
      pendiente(
        'volumen', `${numeroVisible}: volumen_entrega1 ausente`,
        resto === null
          ? 'La entrega 1 no tiene volumen y el cronograma tiene volúmenes inválidos'
          : `La entrega 1 no tiene volumen y volumen ${volumenTotal} − cronograma ${suma} = ${resto} (es negativo)`
      );
    }
  }

  if (!cronogramaCubreTodo) {
    if (!fecha1) pendiente('fecha', '(fecha_entrega vacía)', 'La entrega 1 no tiene fecha');
    entregasBase.push({ numero: 1, volumen: volumen1, fecha_solicitada: fecha1 });
  }

  cronograma.forEach(c => {
    const nro = numero(c && c.nro);
    if (nro === null) { pendiente('cronograma', JSON.stringify(c), 'Entrada del cronograma sin `nro`'); return; }
    entregasBase.push({
      numero: cronogramaCubreTodo ? nro : nro + 1,
      volumen: numero(c.volumen),
      fecha_solicitada: texto(c.fecha_solicitada),
    });
  });
  entregasBase.sort((a, b) => a.numero - b.numero);

  const numerosEntrega = new Set(entregasBase.map(e => e.numero));

  /* ── 6. Despachos y viajes ───────────────────────────────────────────────── */

  const despachosBase = [];   // { pos, d, entregaNro, datos, viaje, track }
  despachosLegacy.forEach((d, pos) => {
    const etiqueta = `${numeroVisible} ${texto(d && d.id) || `#${pos}`}`;
    if (!d || typeof d !== 'object') { pendiente('despacho', etiqueta, 'Entrada de despachos[] inválida'); return; }

    // 17. Estado. `Nominado` + `estado_chofer: 'finalizado'` ya entregó.
    //     `En espera` no tiene equivalente: se cancela con motivo.
    let estado = ESTADO_DESPACHO[texto(d.estado)];
    if (!estado) {
      pendiente('estado_despacho', texto(d.estado), `Estado de despacho desconocido (${etiqueta})`);
      return;
    }
    if (estado === DESPACHO.NOMINADO && d.estado_chofer === 'finalizado') estado = DESPACHO.ENTREGADO;

    // 17b. v1.2.3 (prompt 3): `entrega_nro` nació el 10/07/2026 (`b18807e`) y
    //      "una entrega = un camión" llegó el 30/07/2026 (`82a5f18`). Antes,
    //      un pedido tenía UNA entrega y varios despachos. Orden: (1) si lo
    //      trae, se usa; (2) con una sola entrega, todos a la 1; (3) con
    //      varias, `Dn` va a la entrega `n` si existe (aviso); (4) si no,
    //      `sinResolver`.
    const nroDeclarado = numero(d.entrega_nro);
    let entregaNro = null;
    if (nroDeclarado !== null) {
      if (!numerosEntrega.has(nroDeclarado)) {
        pendiente('entrega', `${etiqueta} -> entrega_nro ${nroDeclarado}`, 'El despacho apunta a una entrega que no existe');
        return;
      }
      entregaNro = nroDeclarado;
    } else if (entregasBase.length === 1) {
      entregaNro = entregasBase[0].numero;
    } else {
      const n = parseInt(soloDigitos(d.id), 10);
      if (Number.isFinite(n) && numerosEntrega.has(n)) {
        entregaNro = n;
        avisos.push({
          tipo: 'entrega_por_numero_de_despacho',
          valor: etiqueta,
          detalle: `Sin entrega_nro y con ${entregasBase.length} entregas: ${texto(d.id)} va a la entrega ${n}`,
        });
      } else {
        pendiente(
          'entrega', `${etiqueta} -> sin entrega_nro`,
          `El despacho no trae entrega_nro y el pedido tiene ${entregasBase.length} entregas: no se puede deducir`
        );
        return;
      }
    }

    // 18. Transporte: `'—'`, `'-'` o vacío = el cliente pone el camión. Si no,
    //     mapa `TRANSPORTES` + `clave_normalizada`; un `null` del mapa queda
    //     como transportista null.
    const nombreTransporte = texto(d.transporte);
    let transportista = null;
    let requiereTransporte = true;
    if (MARCADORES_SIN_TRANSPORTE.includes(nombreTransporte)) {
      requiereTransporte = false;
    } else {
      const r = resolverOrganizacionSuave(nombreTransporte, 'transporte');
      if (!r.conocido) {
        pendiente('transporte', nombreTransporte, 'No está en el mapa TRANSPORTES de mapa-normalizacion.js');
      } else if (r.canonico !== null) {
        const clave = claveNormalizada(r.canonico);
        transportista = organizaciones.find(o => o.clave_normalizada === clave) || null;
        if (!transportista) {
          pendiente('transporte', nombreTransporte, `La organización "${r.canonico}" no existe en organizaciones`);
        }
      }
    }

    // 19. Chofer: por DNI (solo dígitos) contra `usuarios.datos_chofer.dni`.
    //     Sin usuario no frena: se conserva el DNI y se avisa.
    const dniChofer = soloDigitos(d.dni_chofer);
    let choferUid = null;
    if (dniChofer) {
      const u = usuarios.find(x => x.datos_chofer && soloDigitos(x.datos_chofer.dni) === dniChofer);
      if (u) choferUid = u.id;
      else {
        avisos.push({
          tipo: 'chofer_sin_usuario',
          valor: `${texto(d.chofer) || '(sin nombre)'} — DNI ${dniChofer}`,
          detalle: `Despacho ${etiqueta}: no hay un usuario nuevo con ese DNI; chofer_uid queda en null`,
        });
      }
    }

    // 20. El estado del viaje, si hay `estado_chofer`.
    let estadoViaje = null;
    if (d.estado_chofer !== undefined && d.estado_chofer !== null && d.estado_chofer !== '') {
      estadoViaje = ESTADO_VIAJE[texto(d.estado_chofer)];
      if (!estadoViaje) {
        pendiente('estado_viaje', texto(d.estado_chofer), `estado_chofer desconocido (${etiqueta})`);
        return;
      }
    }

    despachosBase.push({
      pos, d, estado, entregaNro, transportista, requiereTransporte,
      choferUid, dniChofer: texto(d.dni_chofer) || null, estadoViaje,
    });
  });

  /* ── 7. Armado del árbol ─────────────────────────────────────────────────── */

  // Si algo no se pudo resolver, no se arma el árbol: el script no va a
  // escribir nada de todos modos y sería ruido en el reporte.
  if (sinResolver.length > 0) return vacio();

  const idPedido = generarId('pedido');
  const idEntrega = (n) => generarId(`entrega:${n}`);
  const idDespacho = (pos) => generarId(`despacho:${pos}`);
  const idViaje = (pos) => generarId(`viaje:${pos}`);

  const cantidadEntregas = entregasBase.length;

  // 21. Despachos, sin `estado_ts` de entrega todavía: primero se arman para
  //     derivar el estado de cada entrega de ellos.
  const despachos = [];
  const viajes = [];
  const puntosGps = [];
  let totalPuntos = 0;

  const entregaPorNumero = new Map(entregasBase.map(e => [e.numero, e]));
  const destinoEntrega = destinoDom;   // "Entrega al cliente": el de la entrega es el del pedido
  const textoOrigen = origenDom ? textoDomicilio(origenDom) : '';

  for (const b of despachosBase) {
    const { d, pos } = b;
    const entregaBase = entregaPorNumero.get(b.entregaNro);
    const idD = idDespacho(pos);
    const idV = b.estadoViaje ? idViaje(pos) : null;

    const terminoEntregado = b.estado === DESPACHO.ENTREGADO;
    const estadoTs = (terminoEntregado && parsearISO(d.chofer_fin_ts)) || creadoEn;

    const datosDespacho = {
      pedido_id: idPedido,
      entrega_id: idEntrega(b.entregaNro),
      numero: texto(d.id) || `D${pos + 1}`,

      estado: b.estado,
      estado_ts: estadoTs,

      volumen: numero(d.volumen),
      fecha_carga: texto(d.fecha_carga),
      horario_carga: texto(d.horario_carga),

      transportista_org_id: b.transportista ? b.transportista.id : null,
      transporte_nombre: b.transportista ? b.transportista.razon_social : null,
      requiere_transporte: b.requiereTransporte,
      rechazo_motivo: null,
      cancelacion_motivo: texto(d.estado) === 'En espera' ? MOTIVO_EN_ESPERA : null,

      baja_solicitada: false,
      baja_motivo: null,
      baja_ts: null,

      chofer_uid: b.choferUid,
      chofer_dni: b.dniChofer,
      tractor_id: null,
      acoplado_id: null,
      patente_tractor: nulo(d.patente_tractor) || null,
      patente_semi: nulo(d.patente_semi) || null,

      // 22. Los mismos campos que `denormalizadosDe()` de `Programacion.js`.
      //     Son despachos cerrados: nadie les manda mails.
      cliente_org_id: orgCliente.id,
      cliente_razon_social: orgCliente.razon_social,
      producto_nombre: producto.nombre,
      ov: texto(legacy.ov),
      destino_texto: destinoEntrega ? textoDomicilio(destinoEntrega) : '',
      entrega_numero: entregaBase.numero,
      entregas_total: cantidadEntregas,
      coordinadores_email: [],
      comercial_email: '',

      creado_por_uid: UID_SCRIPT,
      creado_en: creadoEn,
      actualizado_en: creadoEn,
    };
    if (idV) datosDespacho.viaje_id = idV;

    despachos.push({ id: idD, clave: `despacho:${pos}`, posicion: pos, datos: datosDespacho });

    /* ── Viaje ─────────────────────────────────────────────────────────────── */

    if (!b.estadoViaje) {
      if (Array.isArray(legacy[`gps_track_${pos}`]) && legacy[`gps_track_${pos}`].length > 0) {
        avisos.push({
          tipo: 'gps_sin_viaje',
          valor: `${numeroVisible} ${datosDespacho.numero}`,
          detalle: `gps_track_${pos} tiene puntos pero el despacho no tiene estado_chofer: no se migran`,
        });
      }
      continue;
    }

    const { puntos } = traducirTrack(legacy[`gps_track_${pos}`]);
    totalPuntos += puntos.length;

    const estadoChoferTs = parsearISO(d.estado_chofer_ts);
    const finalizado = b.estadoViaje === VIAJE.FINALIZADO;

    const datosViaje = {
      despacho_id: idD,
      pedido_id: idPedido,
      chofer_uid: b.choferUid,
      chofer_dni: b.dniChofer,
      transportista_org_id: b.transportista ? b.transportista.id : null,

      estado: b.estadoViaje,
      estado_ts: estadoChoferTs || estadoTs,

      demorado: d.estado_chofer === 'demorado',
      demora_motivo: null,
      demora_ts: null,

      inicio_ts: parsearISO(d.chofer_inicio_ts),
      fin_ts: parsearISO(d.chofer_fin_ts),
      // 23. `cerrado_por` solo tiene sentido si el viaje terminó.
      cerrado_por: finalizado ? (d.finalizado_manual ? 'manual' : 'chofer') : null,
      cierre_motivo: null,

      // 24. `gps_inicio_*`/`gps_fin_*` pasan a `inicio_*`/`fin_*`; `gps_lat`,
      //     `gps_lng`, `gps_ts` a `ultima_*`.
      inicio_lat: nulo(d.gps_inicio_lat), inicio_lng: nulo(d.gps_inicio_lng),
      inicio_precision: nulo(d.gps_inicio_precision), inicio_origen: nulo(d.gps_inicio_origen),
      fin_lat: nulo(d.gps_fin_lat), fin_lng: nulo(d.gps_fin_lng),
      fin_precision: nulo(d.gps_fin_precision), fin_origen: nulo(d.gps_fin_origen),
      ultima_lat: nulo(d.gps_lat), ultima_lng: nulo(d.gps_lng), ultima_ts: parsearISO(d.gps_ts),

      puntos_registrados: puntos.length,

      // Denormalizados del chofer, igual que `nominar()`.
      cliente_razon_social: orgCliente.razon_social,
      producto_nombre: producto.nombre,
      origen_texto: textoOrigen,
      destino_texto: datosDespacho.destino_texto,
      volumen: numero(entregaBase.volumen) || 0,
      fecha_carga: datosDespacho.fecha_carga,
      patente_tractor: datosDespacho.patente_tractor,
      patente_semi: datosDespacho.patente_semi,

      creado_por_uid: UID_SCRIPT,
      creado_en: estadoChoferTs || creadoEn,
      actualizado_en: estadoChoferTs || creadoEn,
    };

    viajes.push({ id: idV, clave: `viaje:${pos}`, posicion: pos, despachoClave: `despacho:${pos}`, datos: datosViaje });
    puntosGps.push({ viajeId: idV, viajeClave: `viaje:${pos}`, puntos });
  }

  // 25. Entregas, con el estado derivado de SUS despachos (`estadoEntrega()`).
  const entregas = entregasBase.map(e => {
    const susDespachos = despachos
      .filter(x => x.datos.entrega_id === idEntrega(e.numero))
      .map(x => ({ estado: x.datos.estado }));

    const datos = {
      pedido_id: idPedido,
      numero: e.numero,
      volumen: e.volumen,
      fecha_solicitada: e.fecha_solicitada,
      estado: estadoEntrega({ estado: ENTREGA.PENDIENTE }, susDespachos),
      creado_en: creadoEn,
      actualizado_en: creadoEn,
    };
    // Como `crearPedido()`: la dirección por entrega solo en "Entrega al cliente".
    if (tipo === 'Entrega al cliente') datos.destino_domicilio_id = destinoDom.id;

    return { id: idEntrega(e.numero), clave: `entrega:${e.numero}`, datos };
  });

  // 26. Contadores: mismo criterio que `verificar-contadores.js`.
  const vivas = entregas.filter(e => e.datos.estado !== ENTREGA.SUSPENDIDA);
  const contadores = {
    entregas_total: vivas.length,
    entregas_cubiertas: vivas.filter(e => e.datos.estado === ENTREGA.PROGRAMADA || e.datos.estado === ENTREGA.CUMPLIDA).length,
    entregas_cumplidas: vivas.filter(e => e.datos.estado === ENTREGA.CUMPLIDA).length,
  };

  /* ── 8. Pedido ───────────────────────────────────────────────────────────── */

  const suspendido = texto(legacy.estado) === 'Suspendido';

  const datosPedido = {
    numero: numeroVisible,
    origen_carga: 'migracion_legacy',
    legacy_doc_id: legacyDocId,
    legacy_numero: numeroVisible,
    clase: 'venta',

    cliente_org_id: orgCliente.id,
    ov: texto(legacy.ov),
    tipo,
    // v1.2.3 (prompt 3): solo si hubo equivalencia (`TIPOS_LEGACY`).
    ...(tipoPorEquivalencia ? { legacy_tipo: tipoOriginal } : {}),
    producto_id: producto.id,
    recipiente: texto(legacy.recipiente) || 'Granel',
    obs: texto(legacy.obs),

    volumen: volumenTotal,
    volumen_original: numero(legacy.volumen_original) !== null ? numero(legacy.volumen_original) : volumenTotal,

    // v1.2.3 (prompt 4): `null` si el pedido viejo traía la dirección de la
    // planta: la dirección del cliente no está registrada (aviso `origen_es_la_planta`).
    origen_domicilio_id: origenDom ? origenDom.id : null,
    destino_domicilio_id: destinoDom.id,
    banda_horaria: texto(legacy.banda_horaria),

    ...contadores,

    suspendido,
    suspension_motivo: suspendido ? (texto(legacy.motivo_suspension) || MOTIVO_SUSPENSION_DEFECTO) : null,
    suspension_ts: suspendido ? (parsearISO(legacy.suspendido_en) || creadoEn) : null,

    creado_por_uid: creador ? creador.id : null,
    creado_en: creadoEn,
    actualizado_en: creadoEn,
  };

  /* ── 9. Historial ────────────────────────────────────────────────────────── */

  const resumen = {
    entregas: entregas.length,
    despachos: despachos.length,
    viajes: viajes.length,
    puntos_gps: totalPuntos,
  };

  // 27. Mismo formato que `armarHistorial()` (`shared/datos.js`), con `ts` =
  //     `ahora` en vez de `serverTimestamp()`.
  const historial = [{
    entidad_tipo: 'pedido',
    entidad_id: idPedido,
    pedido_id: idPedido,
    accion: 'migrar_pedido_legacy',
    campos_modificados: Object.keys(resumen),
    antes: {},
    despues: resumen,
    usuario_uid: usuario.uid,
    usuario_nombre: usuario.nombre || usuario.email || 'Sin identificar',
    razon: `Migración de ${numeroVisible} (documento viejo ${legacyDocId})`,
    derivado: false,
    ts: ahora,
  }];

  return {
    ok: true,
    sinResolver,
    avisos,
    omitir: null,
    pedido: { id: idPedido, clave: 'pedido', datos: datosPedido },
    entregas,
    despachos,
    viajes,
    puntosGps,
    historial,
    resumen,
  };
}

/* -----------------------------------------------------------------------------
 * Puente con el cierre administrativo
 * -------------------------------------------------------------------------- */

/**
 * 28. Aplana el árbol traducido a la forma que recibe
 *     `armarCierreAdministrativo()`: `{ id, ...campos }`.
 */
function arbolParaCierre(arbol) {
  const plano = (x) => ({ id: x.id, ...x.datos });
  return {
    pedido: plano(arbol.pedido),
    entregas: arbol.entregas.map(plano),
    despachos: arbol.despachos.map(plano),
    viajes: arbol.viajes.map(plano),
  };
}

/**
 * 29. Aplica el resultado de `armarCierreAdministrativo()` sobre el árbol
 *     traducido, SIN mutarlo: mezcla los campos del cierre en cada documento y
 *     agrega el historial del cierre. Si el cierre no aplica, devuelve el árbol
 *     tal cual.
 */
function aplicarCierreAlArbol(arbol, cierre) {
  if (!cierre || !cierre.aplica) return arbol;

  const mezclar = (lista, cambios) => lista.map(x => {
    const c = cambios.find(y => y.id === x.id);
    return c ? { ...x, datos: { ...x.datos, ...c.campos } } : x;
  });

  return {
    ...arbol,
    pedido: { ...arbol.pedido, datos: { ...arbol.pedido.datos, ...cierre.pedido } },
    entregas: mezclar(arbol.entregas, cierre.entregas),
    despachos: mezclar(arbol.despachos, cierre.despachos),
    viajes: mezclar(arbol.viajes, cierre.viajes),
    historial: [...arbol.historial, ...cierre.historial],
  };
}

/* -----------------------------------------------------------------------------
 * Puente con la suspensión
 * -------------------------------------------------------------------------- */

const MOTIVO_CANCELACION_SUSPENSION = 'Pedido suspendido en el modelo anterior (migración v1.2.3)';

/**
 * 30. Efecto en datos de `suspenderPedido()` sobre el árbol traducido de un
 *     pedido `suspendido`. Función pura: no muta el árbol. Si el pedido no está
 *     suspendido, lo devuelve tal cual. Ver el encabezado del archivo.
 *
 * @param {Object} arbol lo que devuelve `traducirPedidoLegacy()` (ok)
 * @param {{ahora: Date}} params instante de `estado_ts`/`actualizado_en`
 */
function aplicarSuspensionAlArbol(arbol, { ahora }) {
  if (!arbol || !arbol.pedido || !arbol.pedido.datos.suspendido) return arbol;
  if (!(ahora instanceof Date) || Number.isNaN(ahora.getTime())) {
    throw new Error('aplicarSuspensionAlArbol: `ahora` tiene que ser un Date válido.');
  }

  // 31. Despachos vivos que no están ENTREGADO -> CANCELADO. Los entregados ya
  //     fueron: no se tocan.
  const cancelados = new Set();
  const despachos = arbol.despachos.map(d => {
    if (!despachoVivo(d.datos) || d.datos.estado === DESPACHO.ENTREGADO) return d;
    cancelados.add(d.id);
    return {
      ...d,
      datos: {
        ...d.datos,
        estado: DESPACHO.CANCELADO,
        estado_ts: ahora,
        cancelacion_motivo: MOTIVO_CANCELACION_SUSPENSION,
        actualizado_en: ahora,
      },
    };
  });

  // 32. El viaje de cada despacho cancelado se cancela (no se borra). También
  //     el EN_VIAJE: ver LIMITACIONES.
  let viajesCancelados = 0;
  const viajes = arbol.viajes.map(v => {
    if (!cancelados.has(v.datos.despacho_id)) return v;
    viajesCancelados++;
    return { ...v, datos: { ...v.datos, estado: VIAJE.CANCELADO, estado_ts: ahora, actualizado_en: ahora } };
  });

  // 33. Entregas: se recalcula el estado con los despachos que quedaron
  //     (`estadoEntrega()`); lo que no es `cumplida` pasa a `suspendida`.
  let entregasSuspendidas = 0;
  const entregas = arbol.entregas.map(e => {
    const susDespachos = despachos
      .filter(d => d.datos.entrega_id === e.id)
      .map(d => ({ estado: d.datos.estado }));
    const recalculado = estadoEntrega({ estado: e.datos.estado === ENTREGA.SUSPENDIDA ? ENTREGA.SUSPENDIDA : ENTREGA.PENDIENTE }, susDespachos);
    if (recalculado === ENTREGA.CUMPLIDA) return { ...e, datos: { ...e.datos, estado: ENTREGA.CUMPLIDA } };
    if (e.datos.estado !== ENTREGA.SUSPENDIDA) entregasSuspendidas++;
    return { ...e, datos: { ...e.datos, estado: ENTREGA.SUSPENDIDA, actualizado_en: ahora } };
  });

  // 34. Contadores como los dejan `cancelarDespacho()` y `suspenderPedido()`:
  //     el total no se toca; `cubiertas` queda en las entregas cumplidas.
  const cumplidas = entregas.filter(e => e.datos.estado === ENTREGA.CUMPLIDA).length;
  const pedido = {
    ...arbol.pedido,
    datos: { ...arbol.pedido.datos, entregas_cubiertas: cumplidas, actualizado_en: ahora },
  };

  // 35. Se refleja en el registro de migración, no en uno aparte.
  const extra = {
    despachos_cancelados: cancelados.size,
    viajes_cancelados: viajesCancelados,
    entregas_suspendidas: entregasSuspendidas,
  };
  const [registroMigracion, ...otros] = arbol.historial;
  const historial = [{
    ...registroMigracion,
    campos_modificados: [...registroMigracion.campos_modificados, ...Object.keys(extra)],
    despues: { ...registroMigracion.despues, ...extra },
  }, ...otros];

  return { ...arbol, pedido, entregas, despachos, viajes, historial, resumen: { ...arbol.resumen, ...extra } };
}

/* -----------------------------------------------------------------------------
 * Candidatos de domicilio
 * -------------------------------------------------------------------------- */

/**
 * 36. v1.2.3 (prompt 3): los domicilios que una organización YA tiene vinculados,
 *     con su `clave_normalizada`, para que el reporte de la migración los
 *     muestre debajo de cada dirección sin resolver: la clave correcta se copia
 *     de ahí a `DOMICILIOS_LEGACY`. Ordenados por texto.
 *
 * @returns {Array<{id: string, texto: string, clave: string}>}
 */
function domiciliosCandidatos(organizacionId, catalogos) {
  const { domicilios = [], vinculos = [] } = catalogos || {};
  const porId = new Map(domicilios.map(d => [d.id, d]));
  return vinculos
    .filter(v => v.organizacion_id === organizacionId)
    .map(v => porId.get(v.domicilio_id))
    .filter(Boolean)
    .map(d => ({ id: d.id, texto: textoDomicilio(d), clave: d.clave_normalizada || claveDomicilio(d) }))
    .sort((a, b) => a.texto.localeCompare(b.texto, 'es'));
}

module.exports = {
  traducirPedidoLegacy,
  domiciliosCandidatos,
  traducirTrack,
  arbolParaCierre,
  aplicarCierreAlArbol,
  aplicarSuspensionAlArbol,
  MOTIVO_CANCELACION_SUSPENSION,
  parsearISO,
  estadoEntrega,
  textoDomicilio,
  DESPACHO,
  VIAJE,
  ENTREGA,
  TIPOS,
  TIPOS_LEGACY,
};
