// ============================================================
// Notificaciones.gs — Todos los emails, en un solo lugar
// ============================================================
//
// QUÉ ES
//   Cada `enviarEmail*` que antes vivía mezclado dentro de cada bloque de
//   `doPost`/`doGet`. Notificar es una preocupación aparte de escribir en una
//   planilla —la usan todas las acciones por igual—, así que vive en su
//   propio archivo, igual que `PlanDeProduccion.gs` y `MovVehiculos.gs`.
//
// ------------------------------------------------------------
// v2 — 18/09/2026 — REESCRITURA COMPLETA DE LOS NUEVE MAILS
// ------------------------------------------------------------
//
// SÍNTOMA
//   El mail de pedido nuevo salía con "undefined" en cinco lugares: el
//   asunto, N° Pedido, Fecha, Recipiente y Entrega. Ejemplo real del
//   18/09/2026: asunto "[undefined] Glicerina 28 tn · MAPEI".
//
// CAUSA RAÍZ
//   Desfase de nombres entre el payload que arma el portal y los nombres que
//   lee este archivo, introducido por el modelo de datos nuevo (v1.1.0 del
//   portal):
//
//     este archivo leía      el portal mandaba      resultado
//     --------------------   --------------------   -----------------------
//     data.id                pedido_id              undefined
//     data.creado_en         (nada)                 undefined
//     data.recipiente        (nada)                 undefined
//     data.fecha_entrega     (nada)                 undefined
//     data.creado_por        creado_por             OK  ← el único que coincidía
//
//   Que `creado_por` fuera el único campo correcto en el mail real es la
//   prueba: es el único cuyo nombre no cambió.
//
//   Agravante: el portal llama con `mode: 'no-cors'` en varias rutas y nunca
//   ve la respuesta, así que muestra "✓ Se notificó por email" aunque el mail
//   salga mal. El problema estuvo a la vista sin que nadie lo detectara.
//
// QUÉ CAMBIA EN ESTA VERSIÓN
//   1. ASUNTO NUEVO, igual para los nueve:
//        [OV-2860] - Pedido nuevo - Glicerina - 28 tn - MAPEI
//      Arranca con la OV/OC, no con el número de pedido. Lo que varía entre
//      mails es el segundo campo, el estado.
//   2. DESTINATARIOS POR ROL. Ya no hay direcciones escritas acá: el portal
//      resuelve la lista contra la colección `usuarios` y la manda en el
//      payload, en `data.destinatarios`. Ver `destinatarios()`.
//   3. COPIA FIJA a ivan.bianchi@explora.com.ar en los nueve, siempre.
//   4. CRONOGRAMA DE ENTREGAS en vez de una sola `fecha_entrega`. El pedido
//      del modelo nuevo no tiene fecha propia: la fecha vive en cada entrega,
//      y un pedido puede tener varias.
//   5. FORMATO DE BLOQUES uniforme: separador de 59 guiones doble entre
//      secciones, datos comerciales primero, etiquetas sin abreviar.
//   6. CAMPOS AGREGADOS que antes no se mandaban: recipiente y lugar de carga
//      al transportista, posición de la entrega ("2 de 3"), fecha de
//      suspensión, conteo de despachos cancelados, teléfono del chofer al
//      comercial.
//
// LIMITACIONES CONOCIDAS, SIN RESOLVER ACÁ
//   - `enviarEmailRecordatorio12hs()` sigue sin dispararse nunca. Lo llama
//     `verificarNominacionesPendientes()`, que lee una hoja "Pedidos Portal"
//     que no existe. El texto queda definido; el disparador es tarea aparte.
//   - `mode: 'no-cors'` en el portal: si este archivo falla, el portal no se
//     entera. Sin cambios en esta versión.
//   - Todos los campos opcionales caen a "—" si no vienen. Un campo que el
//     portal deje de mandar NO va a mostrar "undefined", pero tampoco va a
//     avisar: va a aparecer un guión donde debería haber un dato. Al probar,
//     hay que mirar los guiones, no solo la ausencia de errores.
//
// CÓMO SE VERIFICA
//   Disparar un mail de cada tipo en el entorno de prueba y revisar que no
//   quede ningún "undefined" ni ningún "—" donde debería haber un dato.
//   El destinatario de copia fijo garantiza que los nueve lleguen para
//   revisarlos.
// ============================================================


/* ============================================================
 * 1. CONSTANTES
 * ========================================================= */

var URL_PORTAL = 'https://portal-ivory-zeta.vercel.app';

// Copia fija en los NUEVE mails. Existe para que haya una persona que vea
// todo lo que el sistema manda: de los nueve, hasta septiembre de 2026 el
// único que alguien había mirado era el de pedido nuevo, y estaba roto.
var COPIA_FIJA = 'ivan.bianchi@explora.com.ar';

// Se usa solo si el portal no manda `data.destinatarios`. Es la lista que
// estaba escrita a mano en la versión anterior, y queda como red de
// seguridad: un mail que no llega es peor que uno que llega a alguien de más.
var DESTINATARIOS_RESPALDO = [
  'ezequiel.marangoni@explora.com.ar',
  'luis.hernandez@explora.com.ar',
  'julian.deparis@explora.com.ar'
];

// 59 guiones. El doble marca el corte entre secciones; el simple, una
// subdivisión dentro de una misma sección.
var SEP = '-----------------------------------------------------------';
var SEP2 = SEP + '\n' + SEP;

var PIE_CORREO = '\n\n─────────────────────────────\n' +
  'No responder este correo, es un mensaje automático.\n' +
  'En caso de dudas consulte a su referente de operaciones.';


/* ============================================================
 * 2. UTILIDADES
 * ========================================================= */

/**
 * Valor o guión. Todos los campos de los cuerpos pasan por acá.
 *
 * Reemplaza la concatenación directa (`'Producto: ' + data.producto`), que es
 * lo que producía los "undefined" del bug: en JavaScript, concatenar un campo
 * inexistente no falla, escribe la palabra "undefined" en el texto.
 */
function v(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  return String(valor);
}

/**
 * Quién recibe este mail.
 *
 * El portal manda `data.destinatarios` como un objeto con una lista por rol:
 *
 *   data.destinatarios = {
 *     coordinadores: ['a@explora.com.ar', 'b@explora.com.ar'],
 *     transportista: ['despacho@transporterad.com'],
 *     comercial:     ['benjamin@explora.com.ar']
 *   }
 *
 * La resolución contra `usuarios` la hace el portal, no este archivo: acá no
 * hay acceso a Firestore, y tener la lista escrita en dos lugares es lo que
 * hacía que cada alta o baja de coordinador fuera un cambio de código.
 *
 * @param {Object} data el payload completo
 * @param {string} rol 'coordinadores' | 'transportista' | 'comercial'
 * @returns {string} lista separada por comas, con la copia fija incluida,
 *                   o cadena vacía si no hay a quién mandarle
 */
function destinatarios(data, rol) {
  var lista = [];

  if (data.destinatarios && data.destinatarios[rol]) {
    lista = [].concat(data.destinatarios[rol]);
  } else if (rol === 'coordinadores') {
    // Solo los coordinadores tienen respaldo: son un grupo estable y conocido.
    // El transportista y el comercial dependen del pedido, así que si el
    // portal no los manda, no hay nada razonable que suponer.
    lista = DESTINATARIOS_RESPALDO.slice();
  }

  // La copia fija va SIEMPRE, incluso si la lista del rol vino vacía: si un
  // mail no le llega a nadie, que al menos quede la constancia de que se
  // intentó mandar.
  lista.push(COPIA_FIJA);

  // Sin repetidos y sin vacíos. Si el mismo mail va a coordinadores y la
  // copia fija es uno de ellos, se manda una sola vez.
  var vistos = {};
  var limpia = [];
  for (var i = 0; i < lista.length; i++) {
    var e = String(lista[i] || '').trim().toLowerCase();
    if (e && !vistos[e]) { vistos[e] = true; limpia.push(e); }
  }

  return limpia.join(',');
}

function enviarMail(destino, asunto, cuerpo) {
  if (!destino) return;
  MailApp.sendEmail(destino, asunto, cuerpo + PIE_CORREO);
}

/**
 * El asunto, igual para los nueve:
 *
 *   [OV-2860] - Pedido nuevo - Glicerina - 28 tn - MAPEI
 *
 * La OV/OC es obligatoria en el portal (`validarPedido()` corta si falta), así
 * que no hay caso de excepción para un pedido sin ella. Si igual llegara vacía
 * —un pedido viejo, anterior a esa validación—, `v()` pone un guión y el
 * asunto sigue siendo legible.
 *
 * El volumen es el de la unidad de la que habla el mail: el del pedido en los
 * mails 1 a 3, el del despacho en los mails 4 a 9.
 */
function asuntoMail(data, estado) {
  return '[' + v(data.ov) + '] - ' + estado + ' - ' + v(data.producto) +
         ' - ' + v(data.volumen) + ' tn - ' + v(data.cliente);
}

/**
 * El cronograma de entregas del pedido.
 *
 * Reemplaza la línea `Entrega: <fecha>` de la versión anterior. El pedido del
 * modelo nuevo no tiene una fecha propia: cada entrega tiene la suya, y el
 * coordinador necesita verlas todas para poder programar.
 *
 * `entregas` llega como [{fecha, volumen}], en orden de creación — el mismo
 * orden en que `crearPedido()` les asigna `numero: 1..N` en Firestore.
 *
 * @param {Array} entregas
 * @param {number} propia número de entrega a marcar (1..N), o 0 para ninguna.
 *   Se usa en los mails al transportista: le importa la suya, pero ver el
 *   pedido entero le da contexto.
 */
function bloqueCronograma(entregas, propia) {
  if (!entregas || !entregas.length) {
    return 'CRONOGRAMA DE ENTREGAS\n  Sin entregas cargadas.';
  }

  var lineas = ['CRONOGRAMA DE ENTREGAS (' + entregas.length + ')'];

  for (var i = 0; i < entregas.length; i++) {
    var e = entregas[i] || {};
    var nro = i + 1;
    var esPropia = (propia && nro === propia);

    var linea = (esPropia ? '  →  ' : '     ') +
                nro + '.  ' +
                v(e.fecha) + '     ' +
                v(e.volumen) + ' tn' +
                (esPropia ? '   ← la tuya' : '');

    lineas.push(linea);
  }

  return lineas.join('\n');
}

/**
 * "2 de 3". La posición de la entrega dentro del pedido.
 *
 * Va en los cuatro mails de despacho: sin esto, un transportista que recibe
 * tres asignaciones del mismo pedido no tiene cómo distinguirlas.
 */
function posicionEntrega(data) {
  if (!data.entrega_numero || !data.entregas_total) return '—';
  return data.entrega_numero + ' de ' + data.entregas_total;
}

/**
 * Une bloques con el separador doble, descartando los vacíos.
 *
 * Que un bloque pueda venir vacío es normal: el de observaciones no existe si
 * el pedido no tiene, y no corresponde dejar dos separadores pegados con nada
 * en el medio.
 */
function armarCuerpo(bloques) {
  var llenos = [];
  for (var i = 0; i < bloques.length; i++) {
    if (bloques[i]) llenos.push(bloques[i]);
  }
  return llenos.join('\n' + SEP2 + '\n');
}

/**
 * El bloque de observaciones, o nada si el pedido no tiene.
 *
 * El valor va en su propio renglón, debajo de la etiqueta: es texto libre de
 * largo variable y no alinea con el resto de los campos.
 */
function bloqueObservaciones(obs) {
  if (!obs) return '';
  return 'Observaciones:\n' + obs;
}


/* ============================================================
 * 3. MAILS DEL PEDIDO (1 a 3)
 * ========================================================= */

/**
 * 1. PEDIDO NUEVO — al crear un pedido. Va a coordinadores.
 *
 * Es el mail que salía roto. Los cinco campos que llegaban en "undefined" son
 * N° Pedido, Fecha, Recipiente, el asunto y la fecha de entrega — esta última
 * reemplazada por el cronograma completo.
 */
function enviarEmailCoordinador(data) {
  var asunto = asuntoMail(data, 'Pedido nuevo');

  var cuerpo = armarCuerpo([
    'Nuevo pedido registrado en el portal, pendiente de programación.',

    'DATOS COMERCIALES\n' +
    'N° Pedido:     ' + v(data.id) + '\n' +
    'Cliente:       ' + v(data.cliente) + '\n' +
    'OV / OC:       ' + v(data.ov) + '\n' +
    'Teléfono:      ' + v(data.telefono) + '\n' +
    'Creado por:    ' + v(data.creado_por) + '\n' +
    'Fecha:         ' + v(data.creado_en),

    'OPERACIÓN\n' +
    'Tipo:          ' + v(data.tipo) + '\n' +
    'Producto:      ' + v(data.producto) + '\n' +
    'Volumen:       ' + v(data.volumen) + ' tn\n' +
    'Recipiente:    ' + v(data.recipiente),

    'LOGÍSTICA\n' +
    'Banda horaria: ' + v(data.banda_horaria) + '\n' +
    'Lugar:         ' + v(data.lugar) + '\n\n' +
    bloqueCronograma(data.entregas, 0),

    bloqueObservaciones(data.obs),

    'Ingresá al portal para programar el despacho:\n' + URL_PORTAL
  ]);

  enviarMail(destinatarios(data, 'coordinadores'), asunto, cuerpo);
}

/**
 * 2. PEDIDO EDITADO — al editar un pedido ya creado.
 *
 * Va a coordinadores, y al transportista si el pedido ya tenía despachos
 * programados: sus despachos quedaron en espera y tiene que saberlo.
 */
function enviarEmailEditarPedido(data) {
  var asunto = asuntoMail(data, 'Pedido editado');

  var intro = data.tenia_programacion
    ? 'El pedido fue editado y requiere reprogramación.\n' +
      'Los despachos anteriores quedaron en espera.'
    : 'El pedido fue editado y está pendiente de programación.';

  var cuerpoCoord = armarCuerpo([
    intro,

    'DATOS COMERCIALES\n' +
    'N° Pedido:     ' + v(data.id) + '\n' +
    'Cliente:       ' + v(data.cliente) + '\n' +
    'OV / OC:       ' + v(data.ov) + '\n' +
    'Editado por:   ' + v(data.editado_por) + '\n' +
    'Fecha:         ' + v(data.editado_en),

    'DATOS ACTUALIZADOS\n' +
    'Tipo:          ' + v(data.tipo) + '\n' +
    'Producto:      ' + v(data.producto) + '\n' +
    'Volumen:       ' + v(data.volumen) + ' tn\n' +
    'Banda horaria: ' + v(data.banda_horaria) + '\n' +
    'Lugar:         ' + v(data.lugar),

    bloqueCronograma(data.entregas, 0),

    bloqueObservaciones(data.obs),

    URL_PORTAL
  ]);

  enviarMail(destinatarios(data, 'coordinadores'), asunto, cuerpoCoord);

  if (data.tenia_programacion) {
    var destTransp = destinatarios(data, 'transportista');

    // `destinatarios()` siempre devuelve al menos la copia fija, así que no
    // alcanza con preguntar si la cadena está vacía para saber si hay
    // transportista: hay que mirar la lista original.
    var hayTransportista = !!(data.destinatarios && data.destinatarios.transportista &&
                              data.destinatarios.transportista.length);

    if (hayTransportista) {
      var cuerpoTransp = armarCuerpo([
        'El pedido asociado a tu despacho fue modificado.\n' +
        'Tu despacho quedó en espera.',

        'N° Pedido:     ' + v(data.id) + '\n' +
        'Cliente:       ' + v(data.cliente) + '\n' +
        'OV / OC:       ' + v(data.ov) + '\n' +
        'Producto:      ' + v(data.producto) + '\n' +
        'Volumen:       ' + v(data.volumen) + ' tn',

        bloqueCronograma(data.entregas, data.entrega_numero || 0),

        bloqueObservaciones(data.obs),

        'Recibirás una notificación cuando el despacho sea reprogramado.\n' +
        URL_PORTAL
      ]);

      enviarMail(destTransp, asunto, cuerpoTransp);
    }
  }
}

/**
 * 3. PEDIDO SUSPENDIDO — es terminal, no hay reactivación.
 *
 * Va a coordinadores, y al transportista si tenía despachos.
 *
 * `despachos_cancelados` es un agregado de esta versión: al suspender, el
 * portal cancela en cascada todos los despachos vivos, y hasta ahora el
 * coordinador no sabía a cuántos transportistas se les había avisado.
 */
function enviarEmailSuspenderPedido(data) {
  var asunto = asuntoMail(data, 'Pedido suspendido');

  var cuerpoCoord = armarCuerpo([
    'El pedido fue suspendido.',

    'DATOS COMERCIALES\n' +
    'N° Pedido:      ' + v(data.id) + '\n' +
    'Cliente:        ' + v(data.cliente) + '\n' +
    'OV / OC:        ' + v(data.ov) + '\n' +
    'Suspendido por: ' + v(data.suspendido_por) + '\n' +
    'Fecha:          ' + v(data.suspendido_en) + '\n' +
    'Motivo:         ' + v(data.motivo),

    'OPERACIÓN\n' +
    'Producto:       ' + v(data.producto) + '\n' +
    'Volumen:        ' + v(data.volumen) + ' tn',

    'Despachos cancelados: ' + v(data.despachos_cancelados)
  ]);

  enviarMail(destinatarios(data, 'coordinadores'), asunto, cuerpoCoord);

  var hayTransportista = !!(data.destinatarios && data.destinatarios.transportista &&
                            data.destinatarios.transportista.length);

  if (data.tenia_programacion && hayTransportista) {
    var cuerpoTransp = armarCuerpo([
      'El pedido asociado a tu despacho fue suspendido.',

      'N° Pedido:  ' + v(data.id) + '\n' +
      'Cliente:    ' + v(data.cliente) + '\n' +
      'OV / OC:    ' + v(data.ov) + '\n' +
      'Producto:   ' + v(data.producto) + '\n' +
      'Motivo:     ' + v(data.motivo) + '\n' +
      'Fecha de carga que tenías asignada: ' + v(data.fecha_carga),

      'Contactá al coordinador para más información.'
    ]);

    enviarMail(destinatarios(data, 'transportista'), asunto, cuerpoTransp);
  }
}


/* ============================================================
 * 4. MAILS DEL DESPACHO (4 a 6)
 *
 * De acá en adelante el mail ya no es por pedido sino POR DESPACHO: una
 * entrega concreta, un camión, una fecha de carga. Por eso no llevan
 * cronograma completo —llevan la fecha que le toca a ese despacho— y el
 * volumen del asunto es el del despacho, no el del pedido.
 * ========================================================= */

/**
 * 4. DESPACHO ASIGNADO — el coordinador se lo asigna a un transportista.
 *
 * Tres agregados sobre la versión anterior: el recipiente, el LUGAR DE CARGA
 * —antes solo se mandaba el de entrega, y el transportista tenía que saber de
 * dónde sale el camión por otro lado— y la posición de la entrega.
 */
function enviarEmailTransportista(data) {
  var asunto = asuntoMail(data, 'Despacho asignado');

  var cuerpo = armarCuerpo([
    'Tiene un despacho asignado en el portal Explora.',

    'DATOS COMERCIALES\n' +
    'OV / OC:          ' + v(data.ov) + '\n' +
    'Cliente:          ' + v(data.cliente) + '\n' +
    'N° Pedido:        ' + v(data.pedido_id) + '\n' +
    'Entrega:          ' + posicionEntrega(data) + '\n' +
    'Lugar de entrega: ' + v(data.lugar) + '\n' +
    'Banda descarga:   ' + v(data.banda_horaria),

    'CARGA\n' +
    'Fecha de carga:   ' + v(data.fecha_carga) + '\n' +
    'Horario sugerido: ' + v(data.horario_carga) + '\n' +
    'Lugar de carga:   ' + v(data.lugar_carga),

    'OPERACIÓN\n' +
    'Producto:         ' + v(data.producto) + '\n' +
    'Volumen:          ' + v(data.volumen) + ' tn\n' +
    'Recipiente:       ' + v(data.recipiente),

    bloqueObservaciones(data.obs),

    'Aceptá o rechazá el despacho, y nominá la unidad:\n' + URL_PORTAL
  ]);

  enviarMail(destinatarios(data, 'transportista'), asunto, cuerpo);
}

/**
 * 5. DESPACHO ACEPTADO — el transportista acepta. Va a coordinadores.
 *
 * La versión anterior incluía una línea que decía si la nominación estaba
 * completa o pendiente. Como este mail se dispara JUSTO al aceptar, siempre
 * estaba pendiente: la línea no informaba nada y se reemplazó por la frase de
 * apertura.
 */
function enviarEmailConfirmacion(data) {
  var asunto = asuntoMail(data, 'Despacho aceptado');

  var cuerpo = armarCuerpo([
    'El transportista aceptó el despacho. Falta nominar la unidad.',

    'DATOS COMERCIALES\n' +
    'Cliente:          ' + v(data.cliente) + '\n' +
    'OV / OC:          ' + v(data.ov) + '\n' +
    'N° Pedido:        ' + v(data.pedido_id) + '\n' +
    'Entrega:          ' + posicionEntrega(data) + '\n' +
    'Transportista:    ' + v(data.transporte) + '\n' +
    'Aceptado:         ' + v(data.confirmado_en),

    'OPERACIÓN\n' +
    'Producto:         ' + v(data.producto) + '\n' +
    'Volumen:          ' + v(data.volumen) + ' tn\n' +
    'Fecha de carga:   ' + v(data.fecha_carga) + '\n' +
    'Horario sugerido: ' + v(data.horario_carga),

    'Lugar de entrega: ' + v(data.lugar),

    URL_PORTAL
  ]);

  enviarMail(destinatarios(data, 'coordinadores'), asunto, cuerpo);
}

/**
 * 6. DESPACHO RECHAZADO — el transportista rechaza. Motivo obligatorio.
 *
 * El agregado importante es la segunda línea de la apertura: el rechazo deja
 * la entrega otra vez en Pendiente, y el coordinador tiene que saber que le
 * quedó trabajo por hacer. La versión anterior no lo decía.
 */
function enviarEmailRechazoDespacho(data) {
  var asunto = asuntoMail(data, 'Despacho rechazado');

  var cuerpo = armarCuerpo([
    'El transportista rechazó el despacho asignado.\n' +
    'La entrega volvió a estado Pendiente y hay que reasignarla.',

    'DATOS COMERCIALES\n' +
    'Cliente:        ' + v(data.cliente) + '\n' +
    'OV / OC:        ' + v(data.ov) + '\n' +
    'N° Pedido:      ' + v(data.pedido_id) + '\n' +
    'Entrega:        ' + posicionEntrega(data) + '\n' +
    'Transportista:  ' + v(data.transporte) + '\n' +
    'Rechazado:      ' + v(data.rechazado_en),

    'OPERACIÓN\n' +
    'Producto:       ' + v(data.producto) + '\n' +
    'Volumen:        ' + v(data.volumen) + ' tn\n' +
    'Fecha de carga: ' + v(data.fecha_carga),

    'MOTIVO\n' + v(data.motivo),

    'Reasigná el despacho:\n' + URL_PORTAL
  ]);

  enviarMail(destinatarios(data, 'coordinadores'), asunto, cuerpo);
}


/* ============================================================
 * 5. MAILS DE LA UNIDAD (7 y 8)
 * ========================================================= */

/**
 * 7. UNIDAD NOMINADA — el transportista nomina chofer y camión.
 *
 * Es el momento en que se crea el viaje. Va a coordinadores y al comercial que
 * creó el pedido, con cuerpos distintos: el comercial no recibe los CUITs, que
 * son dato administrativo, pero SÍ el teléfono de la unidad, que antes no le
 * llegaba — y es lo que necesita para avisar el horario de arribo.
 */
function enviarEmailNominacion(data) {
  var asunto = asuntoMail(data, 'Unidad nominada');

  var cuerpoCoord = armarCuerpo([
    'El transportista nominó la unidad.',

    'DATOS COMERCIALES\n' +
    'Cliente:         ' + v(data.cliente) + '\n' +
    'OV / OC:         ' + v(data.ov) + '\n' +
    'N° Pedido:       ' + v(data.pedido_id) + '\n' +
    'Entrega:         ' + posicionEntrega(data) + '\n' +
    'Fecha de carga:  ' + v(data.fecha_carga) + '\n' +
    'Nominado:        ' + v(data.nominado_en),

    'OPERACIÓN\n' +
    'Producto:        ' + v(data.producto) + '\n' +
    'Volumen:         ' + v(data.volumen) + ' tn',

    'TRANSPORTISTA\n' +
    'Empresa:         ' + v(data.transporte) + '\n' +
    'CUIT empresa:    ' + v(data.cuit_transporte) + '\n' +
    SEP + '\n' +
    'UNIDAD\n' +
    'Patente tractor: ' + v(data.patente_tractor) + '\n' +
    'Patente semi:    ' + v(data.patente_semi) + '\n' +
    SEP + '\n' +
    'CHOFER\n' +
    'Nombre:          ' + v(data.chofer) + '\n' +
    'DNI:             ' + v(data.dni_chofer) + '\n' +
    'CUIT:            ' + v(data.cuit_chofer) + '\n' +
    'Teléfono:        ' + v(data.tel_unidad),

    URL_PORTAL
  ]);

  enviarMail(destinatarios(data, 'coordinadores'), asunto, cuerpoCoord);

  var hayComercial = !!(data.destinatarios && data.destinatarios.comercial &&
                        data.destinatarios.comercial.length);

  if (hayComercial) {
    var cuerpoComercial = armarCuerpo([
      'Tu pedido está en camino. El transportista nominó la unidad.',

      'DATOS COMERCIALES\n' +
      'Cliente:         ' + v(data.cliente) + '\n' +
      'OV / OC:         ' + v(data.ov) + '\n' +
      'N° Pedido:       ' + v(data.pedido_id) + '\n' +
      'Entrega:         ' + posicionEntrega(data) + '\n' +
      'Fecha de carga:  ' + v(data.fecha_carga),

      'OPERACIÓN\n' +
      'Producto:        ' + v(data.producto) + '\n' +
      'Volumen:         ' + v(data.volumen) + ' tn',

      'TRANSPORTISTA\n' +
      'Empresa:         ' + v(data.transporte) + '\n' +
      'Chofer:          ' + v(data.chofer) + '\n' +
      'DNI:             ' + v(data.dni_chofer) + '\n' +
      'Patente tractor: ' + v(data.patente_tractor) + '\n' +
      'Patente semi:    ' + v(data.patente_semi) + '\n' +
      'Teléfono:        ' + v(data.tel_unidad)
    ]);

    enviarMail(destinatarios(data, 'comercial'), asunto, cuerpoComercial);
  }
}

/**
 * 8. NOMINACIÓN PENDIENTE — faltan menos de 12hs para la carga.
 *
 * ESTE MAIL NUNCA SE MANDÓ. Lo dispara `verificarNominacionesPendientes()`,
 * que lee una hoja "Pedidos Portal" que no se creó nunca. La versión que lea
 * los despachos desde Firestore es tarea aparte, todavía pendiente.
 *
 * El texto queda definido igual: cuando se resuelva el disparador, esta
 * función no va a necesitar cambios, solo quién la invoca.
 */
function enviarEmailRecordatorio12hs(data) {
  var asunto = asuntoMail(data, 'Nominación pendiente');

  var hayTransportista = !!(data.destinatarios && data.destinatarios.transportista &&
                            data.destinatarios.transportista.length);

  if (hayTransportista) {
    var cuerpoT = armarCuerpo([
      'Faltan menos de 12 horas para su turno de carga\n' +
      'y aún no registró la unidad.',

      'DATOS COMERCIALES\n' +
      'Cliente:          ' + v(data.cliente) + '\n' +
      'OV / OC:          ' + v(data.ov) + '\n' +
      'N° Pedido:        ' + v(data.pedido_id) + '\n' +
      'Fecha de carga:   ' + v(data.fecha_carga) + '\n' +
      'Horario sugerido: ' + v(data.horario_carga),

      'OPERACIÓN\n' +
      'Producto:         ' + v(data.producto) + '\n' +
      'Volumen:          ' + v(data.volumen) + ' tn\n' +
      'Lugar de entrega: ' + v(data.lugar),

      'Complete la nominación:\n' + URL_PORTAL
    ]);

    enviarMail(destinatarios(data, 'transportista'), asunto, cuerpoT);
  }

  var cuerpoC = armarCuerpo([
    'El siguiente despacho tiene nominación pendiente\n' +
    'con menos de 12 horas para la carga.',

    'DATOS COMERCIALES\n' +
    'Cliente:         ' + v(data.cliente) + '\n' +
    'OV / OC:         ' + v(data.ov) + '\n' +
    'N° Pedido:       ' + v(data.pedido_id) + '\n' +
    'Transportista:   ' + v(data.transporte) + '\n' +
    'Fecha de carga:  ' + v(data.fecha_carga),

    'OPERACIÓN\n' +
    'Producto:        ' + v(data.producto) + '\n' +
    'Volumen:         ' + v(data.volumen) + ' tn',

    URL_PORTAL
  ]);

  enviarMail(destinatarios(data, 'coordinadores'), asunto, cuerpoC);
}


/* ============================================================
 * 6. EXCEPCIÓN (9)
 * ========================================================= */

/**
 * 9. DESPACHO SIN UBICAR EN EL PLAN.
 *
 * Es el único de los nueve que no es una notificación operativa sino una
 * alerta técnica: avisa que algo no se automatizó y hay que cargarlo a mano.
 *
 * Antes de que existiera, `escribirEnPlan()` cortaba con un `Logger.log` que
 * nadie mira: el despacho desaparecía del Plan en silencio.
 */
function enviarEmailSinUbicar(data) {
  var asunto = asuntoMail(data, 'Sin ubicar en el Plan');

  var cuerpo = armarCuerpo([
    'Un despacho no se pudo ubicar en el Plan de Producción:\n' +
    'el producto o el cliente no coinciden con ninguna columna conocida.',

    'DATOS COMERCIALES\n' +
    'Cliente:        ' + v(data.cliente) + '\n' +
    'OV / OC:        ' + v(data.ov) + '\n' +
    'N° Pedido:      ' + v(data.pedido_id) + '\n' +
    'Producto:       ' + v(data.producto) + '\n' +
    'Volumen:        ' + v(data.volumen) + ' tn\n' +
    'Fecha de carga: ' + v(data.fecha_carga),

    'Hay que cargarlo a mano en el Plan.',

    'Si es un producto o cliente nuevo que va a repetirse, conviene\n' +
    'sumarlo a la lista fija de resolverColumna() en PlanDeProduccion.gs,\n' +
    'para que la próxima vez se ubique solo.'
  ]);

  enviarMail(destinatarios(data, 'coordinadores'), asunto, cuerpo);
}
