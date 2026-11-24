// ============================================================
// Registro.gs — Trazabilidad de la API (solicitudes y mails) + health
// ============================================================
//
// v1 — 13/11/2026
//
// SÍNTOMA
//   Cuando un mail no llega o una acción falla, no hay forma de saberlo: el
//   portal llama con `mode: 'no-cors'` y nunca ve la respuesta, y los
//   `Logger.log` solo quedan en el panel de Ejecuciones, sin poder buscar por
//   pedido, por OV ni por destinatario.
//
// CAUSA RAÍZ
//   La API no deja ningún registro propio de lo que recibe ni de lo que manda.
//
// ALCANCE
//   1. Una planilla APARTE ("Portal Explora API — Registro"), no una hoja
//      dentro del Plan de Producción: el Plan ya se llenó una vez por el
//      límite de celdas, y esto suma filas todos los días. Dos hojas:
//        - Solicitudes: una fila por llamada a la API (acción, pedido, OV,
//          resultado, error, duración, mails enviados y fallidos).
//        - Mails: una fila por cada envío (asunto, destinatarios, resultado,
//          error).
//      Las dos comparten `solicitud_id`, para cruzar una llamada con sus mails.
//   2. `?accion=health` en doGet: estado de la API, sin datos sensibles (sin
//      destinatarios ni textos de error; eso queda solo en la planilla).
//   3. Registrar NUNCA rompe una acción: si escribir en la planilla falla, se
//      sigue igual y queda en Logger.log.
//
// LIMITACIONES CONOCIDAS
//   1. Solo se registran los mails que pasan por `enviarMail()`
//      (Notificaciones.gs). Un `MailApp.sendEmail` directo en otro archivo no
//      queda registrado.
//   2. Los mails que no se mandan a propósito (por ejemplo,
//      `enviarEmailTransportista` sin transportista) no generan fila en Mails:
//      el `return` ocurre antes de `enviarMail()`. La solicitud sí queda, con
//      mails_enviados = 0.
//   3. Sin rotación: a ~100 mails por día, la planilla tarda años en acercarse
//      al límite de celdas de Sheets.
//   4. Cada fila suma unos cientos de milisegundos a la acción (abrir la
//      planilla y agregar la fila).
//
// CÓMO SE VERIFICA
//   1. Correr `instalarRegistro()` una vez desde el editor. En el registro de
//      ejecución aparece la URL de la planilla.
//   2. Abrir <URL /exec>?accion=health → JSON con "status": "ok".
//   3. Hacer una acción desde el portal → una fila en Solicitudes y una por
//      mail en Mails, con el mismo solicitud_id.
// ============================================================

var VERSION_API = '2026-11-13';

var PROP_REGISTRO = 'REGISTRO_SHEET_ID';
var HOJA_SOLICITUDES = 'Solicitudes';
var HOJA_MAILS = 'Mails';

var COLS_SOLICITUDES = [
  'fecha', 'solicitud_id', 'metodo', 'accion', 'pedido_id', 'ov',
  'resultado', 'error', 'duracion_ms', 'mails_enviados', 'mails_fallidos'
];
var COLS_MAILS = [
  'fecha', 'solicitud_id', 'accion', 'pedido_id', 'ov',
  'asunto', 'destinatarios', 'cantidad', 'resultado', 'error'
];

// Debajo de este número de mails restantes en el día, health avisa "degradado".
var CUOTA_MINIMA = 20;


/* ============================================================
 * 1. CONTEXTO DE LA SOLICITUD
 *
 * En Apps Script cada llamada a doGet/doPost corre en su propia ejecución,
 * con sus propias variables globales: dos solicitudes simultáneas no
 * comparten CONTEXTO.
 * ========================================================= */

var CONTEXTO = null;

function iniciarContexto(metodo) {
  CONTEXTO = {
    id: Utilities.getUuid().slice(0, 8),
    inicio: Date.now(),
    metodo: metodo,
    accion: '',
    pedido_id: '',
    ov: '',
    mailsOk: 0,
    mailsError: 0
  };
}

/** Se llama una vez que el payload se pudo leer. */
function completarContexto(data) {
  if (!CONTEXTO || !data) return;
  CONTEXTO.accion = data.accion || '';
  CONTEXTO.pedido_id = data.pedido_id || data.id || '';
  CONTEXTO.ov = data.ov || '';
}


/* ============================================================
 * 2. REGISTRO
 * ========================================================= */

/**
 * Una fila en Solicitudes. `respuesta` es el TextOutput que devuelve la API:
 * se lee su `status` para registrar también los errores que no son
 * excepciones (por ejemplo, "Acción no reconocida").
 */
function registrarSolicitud(respuesta, err) {
  if (!CONTEXTO) return;

  var resultado = 'ok';
  var detalle = '';

  if (err) {
    resultado = 'error';
    detalle = (err && err.message) ? err.message : String(err);
  } else if (respuesta) {
    try {
      var cuerpo = JSON.parse(respuesta.getContent());
      if (cuerpo.status !== 'ok') {
        resultado = 'error';
        detalle = cuerpo.mensaje || '';
      }
    } catch (e) {
      // Respuesta no JSON: se registra como ok, no hay nada más que leer.
    }
  }

  var c = CONTEXTO;
  anotarFila(HOJA_SOLICITUDES, [
    new Date(), c.id, c.metodo, c.accion, c.pedido_id, c.ov,
    resultado, recortar(detalle, 500),
    Date.now() - c.inicio, c.mailsOk, c.mailsError
  ]);

  if (resultado === 'error') {
    guardarMarca('ULTIMO_ERROR', new Date().toISOString() + ' | ' + (c.accion || 'sin acción'));
  }
}

/**
 * Una fila en Mails. La llama `enviarMail()` (Notificaciones.gs) después de
 * cada intento, salga bien o mal.
 */
function registrarMail(destino, asunto, err) {
  // Un mail mandado fuera de una solicitud (por ejemplo, desde un trigger de
  // tiempo) no tiene contexto: se registra igual, marcado como tal.
  var c = CONTEXTO || { id: '', accion: '(fuera de solicitud)', pedido_id: '', ov: '' };

  if (CONTEXTO) {
    if (err) CONTEXTO.mailsError++;
    else CONTEXTO.mailsOk++;
  }

  var lista = String(destino || '').split(',').filter(function (s) { return s.trim(); });

  anotarFila(HOJA_MAILS, [
    new Date(), c.id, c.accion, c.pedido_id, c.ov,
    asunto, lista.join(', '), lista.length,
    err ? 'error' : 'ok',
    err ? recortar((err && err.message) ? err.message : String(err), 500) : ''
  ]);

  if (err) guardarMarca('ULTIMO_ERROR', new Date().toISOString() + ' | mail ' + (c.accion || ''));
  else guardarMarca('ULTIMO_MAIL_OK', new Date().toISOString());
}

/** Agrega una fila sin romper nunca la acción que la llama. */
function anotarFila(nombreHoja, fila) {
  try {
    var hoja = libroRegistro().getSheetByName(nombreHoja);
    if (!hoja) throw new Error('No existe la hoja "' + nombreHoja + '". Correr instalarRegistro().');
    hoja.appendRow(fila);
  } catch (e) {
    Logger.log('Registro: no se pudo escribir en ' + nombreHoja + ': ' + e.message);
  }
}

// La planilla se abre una sola vez por ejecución, no una vez por fila.
var _libroRegistro = null;

function libroRegistro() {
  if (_libroRegistro) return _libroRegistro;
  var id = PropertiesService.getScriptProperties().getProperty(PROP_REGISTRO);
  if (!id) throw new Error('Falta ' + PROP_REGISTRO + ': correr instalarRegistro() una vez desde el editor.');
  _libroRegistro = SpreadsheetApp.openById(id);
  return _libroRegistro;
}

function guardarMarca(clave, valor) {
  try {
    PropertiesService.getScriptProperties().setProperty(clave, valor);
  } catch (e) {
    Logger.log('Registro: no se pudo guardar ' + clave + ': ' + e.message);
  }
}

function recortar(texto, max) {
  texto = String(texto || '');
  return texto.length > max ? texto.slice(0, max) + '…' : texto;
}


/* ============================================================
 * 3. INSTALACIÓN — correr UNA vez desde el editor
 *
 * Crea la planilla si no existe, guarda su ID en las propiedades del script
 * y arma las dos hojas con sus encabezados. Correrla de nuevo no duplica
 * nada: reusa la planilla y no toca hojas que ya tienen datos.
 * ========================================================= */

function instalarRegistro() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_REGISTRO);
  var libro;

  if (id) {
    libro = SpreadsheetApp.openById(id);
  } else {
    libro = SpreadsheetApp.create('Portal Explora API — Registro');
    props.setProperty(PROP_REGISTRO, libro.getId());
  }

  prepararHoja(libro, HOJA_SOLICITUDES, COLS_SOLICITUDES);
  prepararHoja(libro, HOJA_MAILS, COLS_MAILS);

  // La hoja vacía que trae toda planilla nueva ("Hoja 1" o "Sheet1", según el
  // idioma de la cuenta).
  ['Hoja 1', 'Sheet1'].forEach(function (nombre) {
    var h = libro.getSheetByName(nombre);
    if (h && h.getLastRow() === 0 && libro.getSheets().length > 1) libro.deleteSheet(h);
  });

  Logger.log('Registro listo: ' + libro.getUrl());
}

function prepararHoja(libro, nombre, columnas) {
  var hoja = libro.getSheetByName(nombre) || libro.insertSheet(nombre);
  if (hoja.getLastRow() === 0) {
    hoja.appendRow(columnas);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 1, 1, columnas.length).setFontWeight('bold');
  }
}


/* ============================================================
 * 4. HEALTH — <URL /exec>?accion=health
 *
 * Público, como el resto de la API, así que no devuelve destinatarios ni
 * textos de error: solo marcas de tiempo y estados. El detalle está en la
 * planilla. No se registra en Solicitudes, para que un monitor que lo llame
 * cada pocos minutos no llene la planilla.
 *
 * "degradado" si la cuota de mails del día está por agotarse o si la
 * planilla de registro no se puede abrir.
 * ========================================================= */

function health() {
  var props = PropertiesService.getScriptProperties();
  var estado = 'ok';
  var checks = {};

  try {
    checks.cuota_mails_restante = MailApp.getRemainingDailyQuota();
    if (checks.cuota_mails_restante < CUOTA_MINIMA) estado = 'degradado';
  } catch (e) {
    checks.cuota_mails_restante = 'error';
    estado = 'degradado';
  }

  try {
    libroRegistro().getId();
    checks.registro = 'ok';
  } catch (e) {
    checks.registro = 'error';
    estado = 'degradado';
  }

  try {
    checks.triggers = ScriptApp.getProjectTriggers().map(function (t) {
      return t.getHandlerFunction();
    });
  } catch (e) {
    checks.triggers = 'error';
  }

  checks.ultimo_mail_ok = props.getProperty('ULTIMO_MAIL_OK') || null;
  checks.ultimo_error = props.getProperty('ULTIMO_ERROR') || null;

  return ContentService
    .createTextOutput(JSON.stringify({
      status: estado,
      servicio: 'Portal Explora API',
      version: VERSION_API,
      ahora: new Date().toISOString(),
      checks: checks
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
