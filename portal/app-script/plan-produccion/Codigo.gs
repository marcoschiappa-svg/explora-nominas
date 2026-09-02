// ============================================================
// Código.gs — Punto de entrada único
// ============================================================
//
// QUÉ CAMBIÓ
//   Antes, `doPost` y `doGet` tenían cada uno su propia copia de varias
//   acciones, escritas por separado — y no siempre iguales: `nuevo_pedido`
//   escribía la hoja "Pedidos Portal" en `doPost` pero no en `doGet`. Como
//   el portal llama SIEMPRE con `mode: 'no-cors'` (que es GET), esa mitad de
//   `doPost` nunca corría en la práctica — la hoja nunca se creó.
//
//   Ahora hay UNA tabla, `ACCIONES`, que dice para cada acción qué función
//   escribe y cuál notifica. `doPost` y `doGet` son finitos: parsean el
//   payload y llaman a `manejarAccion()`. No pueden volver a divergir,
//   porque ya no hay dos copias de nada — hay una sola definición por acción.
//
// LAS DOS ACCIONES QUE NO ENTRAN EN LA TABLA
//   `subir_adjunto` devuelve datos (`okData`, no `ok`), y `eliminar_adjunto`
//   recibe el ID del archivo directo, no un documento de despacho/pedido —
//   las dos tienen una forma distinta al resto, así que quedan como casos
//   aparte antes de consultar la tabla.
//
// `verificar_nominaciones`
//   Sigue como una acción de `doGet` aparte, fuera de la tabla — es la única
//   que no recibe un `payload`, solo `?accion=verificar_nominaciones` en la
//   URL. Dispara `verificarNominacionesPendientesFirestore()`, en
//   `RecordatorioFirestore.gs` — lee Firestore directo (con una cuenta de
//   servicio, la misma que usa `verificar-contadores.js`), reemplazando a la
//   versión vieja que leía "Pedidos Portal" y por eso nunca mandó nada. Esta
//   rama de acá es solo para poder dispararla a mano por URL si hace falta;
//   normalmente corre sola por su propio trigger de tiempo
//   (`instalarTriggerRecordatorio`, en el mismo archivo).
// ============================================================

var ACCIONES = {
  nuevo_pedido:          { notificar: enviarEmailCoordinador },
  programar_despacho:    { escribir: escribirEnPlan,        notificar: enviarEmailTransportista },
  confirmar_despacho:    { notificar: enviarEmailConfirmacionCoordinador },
  asignar_transportista: { notificar: enviarEmailTransportista },
  nominar_unidad:        { escribir: escribirEnMovVehiculos, notificar: enviarEmailNominacion },
  editar_pedido:         { notificar: enviarEmailEditarPedido },
  suspender_pedido:      { notificar: enviarEmailSuspenderPedido },
  rechazar_despacho:     { notificar: enviarEmailRechazoDespacho },
  reprogramar_despacho:  { notificar: enviarEmailReprogramacion },
  editar_despacho:       { notificar: enviarEmailEditarDespacho },
  borrar_despacho:       { escribir: borrarDespacho },
};

function manejarAccion(accion, data) {
  if (accion === 'subir_adjunto') {
    return okData(subirAdjunto(data));
  }
  if (accion === 'eliminar_adjunto') {
    eliminarAdjunto(data.file_id);
    return ok('Adjunto eliminado');
  }

  var def = ACCIONES[accion];
  if (!def) return error('Acción no reconocida: ' + accion);

  if (def.escribir) def.escribir(data);
  if (def.notificar) def.notificar(data);

  return ok(accion + ' procesada');
}

function doPost(e) {
  try {
    var data;
    try {
      data = JSON.parse(e.postData.contents || '{}');
    } catch (ex) {
      data = JSON.parse((e.parameter && e.parameter.payload) || '{}');
    }
    Logger.log('doPost accion=' + data.accion + ' id=' + (data.id || data.pedido_id || ''));
    return manejarAccion(data.accion, data);
  } catch (err) {
    Logger.log('ERROR doPost: ' + err.message);
    return error(err.toString());
  }
}

function doGet(e) {
  try {
    var accion = e.parameter.accion;

    if (accion === 'verificar_nominaciones') {
      verificarNominacionesPendientesFirestore();
      return ok('Verificación completada');
    }

    var payloadStr = e.parameter.payload || '';
    if (!payloadStr) return ok('API Portal Explora activa');

    var data = JSON.parse(payloadStr);
    Logger.log('doGet payload accion=' + data.accion);
    return manejarAccion(data.accion, data);
  } catch (err) {
    Logger.log('ERROR doGet: ' + err.message);
    return error(err.toString());
  }
}

// La implementación real vive en `RecordatorioFirestore.gs`
// (`verificarNominacionesPendientesFirestore`), disparada por su propio
// trigger de tiempo (`instalarTriggerRecordatorio`) — no hace falta que
// `doGet` la llame para que corra sola todos los días. La rama de arriba
// queda solo por si alguna vez conviene dispararla a mano por URL.

function ok(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', mensaje: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

function okData(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function error(msg) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', mensaje: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
