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
//   Nada de la REDACCIÓN de los mails cambió: es el mismo texto de siempre,
//   función por función. Lo único que cambió es dónde viven.
// ============================================================

var PIE_CORREO = '\n\n─────────────────────────────\n' +
  'No responder este correo, es un mensaje automático.\n' +
  'En caso de dudas consulte a su referente de operaciones.';

function enviarMail(destino, asunto, cuerpo) {
  if (!destino) return;
  MailApp.sendEmail(destino, asunto, cuerpo + PIE_CORREO);
}

function asuntoPedido(pedidoId, producto, volumen, cliente) {
  return '[' + pedidoId + '] ' + producto + ' ' + volumen + ' tn · ' + cliente;
}

function getEmailsCoordinadores() {
  return 'ezequiel.marangoni@explora.com.ar,luis.hernandez@explora.com.ar,julian.deparis@explora.com.ar';
}

function enviarEmailCoordinador(data) {
  var asunto = asuntoPedido(data.id, data.producto, data.volumen, data.cliente);
  var cuerpo = [
    'Nuevo pedido registrado en el portal.',
    '', 'N° Pedido:    ' + data.id,
    'Creado por:   ' + data.creado_por,
    'Fecha:        ' + data.creado_en,
    '', 'OPERACIÓN',
    'Tipo:         ' + data.tipo,
    'Producto:     ' + data.producto,
    'Volumen:      ' + data.volumen + ' tn',
    'Recipiente:   ' + data.recipiente,
    '', 'DATOS COMERCIALES',
    'Cliente:      ' + data.cliente,
    'OV / OC:      ' + data.ov,
    'Teléfono:     ' + (data.telefono || '—'),
    '', 'LOGÍSTICA',
    'Entrega:      ' + data.fecha_entrega,
    'Banda horaria:' + (data.banda_horaria || '—'),
    'Lugar:        ' + data.lugar,
    '', 'Observaciones: ' + (data.obs || '—'),
    '', 'Ingresá al portal para programar el despacho:',
    'https://portal-ivory-zeta.vercel.app'
  ].join('\n');
  enviarMail(getEmailsCoordinadores(), asunto, cuerpo);
}

function enviarEmailTransportista(data) {
  if (!data.email_transportista) return;
  var asunto = asuntoPedido(data.pedido_id, data.producto, data.volumen, data.cliente);
  var cuerpo = [
    'Tiene un despacho asignado en el portal Explora.',
    '', 'N° Pedido:        ' + data.pedido_id,
    'Producto:         ' + data.producto,
    'Volumen:          ' + data.volumen + ' tn',
    'Fecha de carga:   ' + data.fecha_carga,
    data.horario_carga ? 'Horario sugerido: ' + data.horario_carga : null,
    'Cliente:          ' + data.cliente,
    'OV / OC:          ' + data.ov,
    'Lugar de entrega: ' + data.lugar,
    data.banda_horaria ? 'Banda descarga:   ' + data.banda_horaria : null,
    data.obs ? 'Observaciones:    ' + data.obs : null,
    '', 'Ingrese al portal para aceptar y nominar la unidad:',
    'https://portal-ivory-zeta.vercel.app'
  ].filter(Boolean).join('\n');
  enviarMail(data.email_transportista, asunto, cuerpo);
}

function enviarEmailConfirmacionCoordinador(data) {
  var estadoNom = data.estado_nominacion === 'completa'
    ? '✓ Nominación completa'
    : '⏳ Nominación pendiente — el transportista la completará antes de la carga';
  var asunto = asuntoPedido(data.pedido_id, data.producto, data.volumen, data.cliente);
  var cuerpo = [
    'El transportista confirmó el despacho desde el portal.',
    '', 'N° Pedido:        ' + data.pedido_id,
    'Transportista:    ' + data.transporte,
    'Producto:         ' + data.producto,
    'Volumen:          ' + data.volumen + ' tn',
    'Fecha de carga:   ' + data.fecha_carga,
    data.horario_carga ? 'Horario sugerido: ' + data.horario_carga : null,
    'Cliente:          ' + data.cliente,
    'OV / OC:          ' + data.ov,
    'Lugar de entrega: ' + data.lugar,
    '', 'NOMINACIÓN', estadoNom,
    '', 'Confirmado: ' + (data.confirmado_en || '—'),
    '', 'Ver en el portal:', 'https://portal-ivory-zeta.vercel.app'
  ].filter(Boolean).join('\n');
  enviarMail(getEmailsCoordinadores(), asunto, cuerpo);
}

function enviarEmailNominacion(data) {
  var asunto = asuntoPedido(data.pedido_id, data.producto, data.volumen, data.cliente);

  var cuerpoCoord = [
    'Unidad nominada para ingresar a planta.',
    '', 'N° Pedido:       ' + data.pedido_id,
    'Fecha carga:     ' + data.fecha_carga,
    'Producto:        ' + data.producto,
    'Volumen:         ' + data.volumen + ' tn',
    'OV / OC:         ' + data.ov,
    'Cliente:         ' + data.cliente,
    '', 'UNIDAD',
    'Patente tractor: ' + (data.patente_tractor || '—'),
    'Patente semi:    ' + (data.patente_semi || '—'),
    'Chofer:          ' + (data.chofer || '—'),
    'DNI:             ' + (data.dni_chofer || '—'),
    'CUIT chofer:     ' + (data.cuit_chofer || '—'),
    'Transportista:   ' + (data.transporte || '—'),
    'CUIT empresa:    ' + (data.cuit_transporte || '—'),
    'Tel. unidad:     ' + (data.tel_unidad || '—')
  ].join('\n');
  enviarMail(getEmailsCoordinadores(), asunto, cuerpoCoord);

  if (data.email_comercial) {
    var cuerpoComercial = [
      'Tu pedido está en camino. El transportista nominó la unidad.',
      '', 'N° Pedido:       ' + data.pedido_id,
      'Producto:        ' + data.producto,
      'Volumen:         ' + data.volumen + ' tn',
      'Fecha de carga:  ' + data.fecha_carga,
      'Cliente:         ' + data.cliente,
      'OV / OC:         ' + data.ov,
      '', 'TRANSPORTISTA',
      'Empresa:         ' + (data.transporte || '—'),
      'Chofer:          ' + (data.chofer || '—'),
      'DNI:             ' + (data.dni_chofer || '—'),
      'Patente tractor: ' + (data.patente_tractor || '—'),
      'Patente semi:    ' + (data.patente_semi || '—'),
    ].join('\n');
    enviarMail(data.email_comercial, asunto, cuerpoComercial);
  }
}

// Sigue tal cual estaba escrita. Lo que va a cambiar es QUIÉN la llama: hoy la
// dispara `verificarNominacionesPendientes()` leyendo la hoja "Pedidos Portal"
// que nunca se creó (nunca mandó un solo mail). La versión que lea Firestore
// en vez de esa hoja es tarea aparte, todavía pendiente — esta función de acá
// no necesita cambiar cuando eso se resuelva, solo quién la invoca.
function enviarEmailRecordatorio12hs(data) {
  var asunto = asuntoPedido(data.pedido_id, data.producto, data.volumen, data.cliente);
  if (data.email_transportista) {
    var cuerpoT = [
      'Faltan menos de 12 horas para su turno de carga y aún no registró la unidad.',
      '', 'N° Pedido:        ' + data.pedido_id,
      'Producto:         ' + data.producto,
      'Volumen:          ' + data.volumen + ' tn',
      'Fecha de carga:   ' + data.fecha_carga,
      'Cliente:          ' + data.cliente,
      'Lugar de entrega: ' + data.lugar,
      '', 'Complete la nominación:', 'https://portal-ivory-zeta.vercel.app'
    ].join('\n');
    enviarMail(data.email_transportista, asunto, cuerpoT);
  }
  var cuerpoC = [
    'El siguiente despacho tiene nominación pendiente con menos de 12 horas para la carga.',
    '', 'N° Pedido:        ' + data.pedido_id,
    'Transportista:    ' + (data.transporte || '—'),
    'Producto:         ' + data.producto,
    'Volumen:          ' + data.volumen + ' tn',
    'Fecha de carga:   ' + data.fecha_carga,
    'Cliente:          ' + data.cliente,
    'OV / OC:          ' + data.ov,
    '', 'https://portal-ivory-zeta.vercel.app'
  ].join('\n');
  enviarMail(getEmailsCoordinadores(), asunto, cuerpoC);
}

function enviarEmailEditarPedido(data) {
  var asunto = asuntoPedido(data.id, data.producto, data.volumen, data.cliente);
  var intro = data.tenia_programacion
    ? 'El pedido fue editado y requiere reprogramación. Los despachos anteriores quedaron en espera.'
    : 'El pedido fue editado y está pendiente de programación.';

  var cuerpoCoord = [
    intro, '',
    'N° Pedido:    ' + data.id,
    'Editado por:  ' + data.editado_por,
    'Fecha:        ' + data.editado_en,
    '', 'DATOS ACTUALIZADOS',
    'Tipo:         ' + data.tipo,
    'Producto:     ' + data.producto,
    'Volumen:      ' + data.volumen + ' tn',
    'Cliente:      ' + data.cliente,
    'OV / OC:      ' + data.ov,
    'Entrega:      ' + data.fecha_entrega,
    'Banda horaria:' + (data.banda_horaria || '—'),
    'Lugar:        ' + data.lugar,
    '', 'Observaciones: ' + (data.obs || '—'),
    '', 'https://portal-ivory-zeta.vercel.app'
  ].join('\n');
  enviarMail(getEmailsCoordinadores(), asunto, cuerpoCoord);

  if (data.tenia_programacion && data.email_transportista) {
    var cuerpoTransp = [
      'El pedido asociado a tu despacho fue modificado. Tu despacho quedó en espera.',
      '', 'N° Pedido:     ' + data.id,
      'Producto:      ' + data.producto,
      'Volumen:       ' + data.volumen + ' tn',
      'Cliente:       ' + data.cliente,
      'Nueva entrega: ' + data.fecha_entrega,
      data.obs ? 'Obs:           ' + data.obs : null,
      '', 'Recibirás una notificación cuando el despacho sea reprogramado.',
      'https://portal-ivory-zeta.vercel.app'
    ].filter(Boolean).join('\n');
    enviarMail(data.email_transportista, asunto, cuerpoTransp);
  }
}

function enviarEmailSuspenderPedido(data) {
  var asunto = asuntoPedido(data.id, data.producto, data.volumen, data.cliente);

  var cuerpoCoord = [
    'El pedido fue suspendido.',
    '', 'N° Pedido:      ' + data.id,
    'Suspendido por: ' + data.suspendido_por,
    'Motivo:         ' + data.motivo,
    '', 'Producto:  ' + data.producto,
    'Volumen:   ' + data.volumen + ' tn',
    'Cliente:   ' + data.cliente,
    'OV / OC:   ' + data.ov,
    'Entrega:   ' + data.fecha_entrega,
  ].join('\n');
  enviarMail(getEmailsCoordinadores(), asunto, cuerpoCoord);

  if (data.tenia_programacion && data.email_transportista) {
    var cuerpoTransp = [
      'El pedido asociado a tu despacho fue suspendido.',
      '', 'N° Pedido: ' + data.id,
      'Motivo:    ' + data.motivo,
      'Producto:  ' + data.producto,
      'Cliente:   ' + data.cliente,
      '', 'Contactá al coordinador para más información.',
    ].join('\n');
    enviarMail(data.email_transportista, asunto, cuerpoTransp);
  }
}

function enviarEmailRechazoDespacho(data) {
  var asunto = asuntoPedido(data.pedido_id, data.producto, data.volumen, data.cliente);
  var cuerpo = [
    'El transportista rechazó el despacho asignado.',
    '', 'N° Pedido:      ' + data.pedido_id,
    'Transportista:  ' + data.transporte,
    'Producto:       ' + data.producto,
    'Volumen:        ' + data.volumen + ' tn',
    'Fecha de carga: ' + data.fecha_carga,
    'Cliente:        ' + data.cliente,
    'OV / OC:        ' + data.ov,
    '', 'MOTIVO', data.motivo,
    '', 'El despacho volvió a Pendiente. Asignar nuevo transportista:',
    'https://portal-ivory-zeta.vercel.app'
  ].join('\n');
  enviarMail(getEmailsCoordinadores(), asunto, cuerpo);
}

function enviarEmailReprogramacion(data) {
  var asunto = asuntoPedido(data.pedido_id, data.producto, data.volumen, data.cliente);

  if (data.email_transportista) {
    var cuerpoTransp = [
      'Tu despacho fue reprogramado. Ingresá al portal para aceptarlo.',
      '', 'N° Pedido:         ' + data.pedido_id,
      'Producto:          ' + data.producto,
      'Volumen:           ' + data.volumen + ' tn',
      'Nueva fecha carga: ' + data.fecha_carga,
      data.horario_carga ? 'Horario sugerido:  ' + data.horario_carga : null,
      'Cliente:           ' + data.cliente,
      'OV / OC:           ' + data.ov,
      'Lugar de entrega:  ' + data.lugar,
      '', 'https://portal-ivory-zeta.vercel.app'
    ].filter(Boolean).join('\n');
    enviarMail(data.email_transportista, asunto, cuerpoTransp);
  }

  var cuerpoCoord = [
    'Se reprogramó un despacho desde el portal.',
    '', 'N° Pedido:         ' + data.pedido_id,
    'Transportista:     ' + (data.transporte || '—'),
    'Producto:          ' + data.producto,
    'Volumen:           ' + data.volumen + ' tn',
    'Nueva fecha carga: ' + data.fecha_carga,
    data.horario_carga ? 'Horario sugerido:  ' + data.horario_carga : null,
    'Cliente:           ' + data.cliente,
    'OV / OC:           ' + data.ov,
    '', '⚠ Actualizá manualmente el Plan de Producción.',
    'https://portal-ivory-zeta.vercel.app'
  ].join('\n');
  enviarMail(getEmailsCoordinadores(), asunto, cuerpoCoord);
}

function enviarEmailEditarDespacho(data) {
  var asunto = asuntoPedido(data.pedido_id, data.producto, data.volumen, data.cliente);
  var cuerpo = [
    'Se editó un despacho desde el portal.',
    '', 'N° Pedido:         ' + data.pedido_id,
    'Editado por:       ' + (data.editado_por || '—'),
    'Transportista:     ' + (data.transporte || '—'),
    'Producto:          ' + data.producto,
    'Volumen:           ' + data.volumen + ' tn',
    'Nueva fecha carga: ' + data.fecha_carga,
    data.horario_carga ? 'Horario sugerido:  ' + data.horario_carga : null,
    'Cliente:           ' + data.cliente,
    'OV / OC:           ' + data.ov,
    '', '⚠ Verificá el Plan de Producción si la fecha cambió.',
    'https://portal-ivory-zeta.vercel.app'
  ].join('\n');
  enviarMail(getEmailsCoordinadores(), asunto, cuerpo);

  if (data.email_transportista) {
    var cuerpoTransp = [
      'Tu despacho fue actualizado por el coordinador.',
      '', 'N° Pedido:         ' + data.pedido_id,
      'Producto:          ' + data.producto,
      'Volumen:           ' + data.volumen + ' tn',
      'Nueva fecha carga: ' + data.fecha_carga,
      data.horario_carga ? 'Horario sugerido:  ' + data.horario_carga : null,
      'Cliente:           ' + data.cliente,
      'OV / OC:           ' + data.ov,
      'Lugar de entrega:  ' + data.lugar,
      '', 'https://portal-ivory-zeta.vercel.app'
    ].filter(Boolean).join('\n');
    enviarMail(data.email_transportista, asunto, cuerpoTransp);
  }
}

// Nueva (D2): avisa cuando un despacho no se pudo ubicar en el Plan porque el
// producto o cliente no coincide con ninguna columna conocida. Antes de esto,
// `escribirEnPlan()` cortaba con un `Logger.log` que nadie ve — el despacho
// desaparecía del Plan en silencio.
function enviarEmailSinUbicar(data) {
  var asunto = 'Despacho sin ubicar en el Plan — ' + (data.pedido_id || 'sin número');
  var cuerpo = [
    'Un despacho no se pudo ubicar en el Plan de Producción: el producto o',
    'el cliente no coinciden con ninguna columna conocida.',
    '',
    'N° Pedido:    ' + (data.pedido_id || '—'),
    'Producto:     ' + (data.producto || '—'),
    'Cliente:      ' + (data.cliente || '—'),
    'OV / OC:      ' + (data.ov || '—'),
    'Volumen:      ' + (data.volumen || '—') + ' tn',
    'Fecha carga:  ' + (data.fecha_carga || '—'),
    '',
    'Hay que cargarlo a mano en el Plan. Si es un producto o cliente nuevo que',
    'va a repetirse, conviene sumarlo a la lista fija de resolverColumna() en',
    'PlanDeProduccion.gs, para que la próxima vez se ubique solo.',
  ].join('\n');
  enviarMail(getEmailsCoordinadores(), asunto, cuerpo);
}
