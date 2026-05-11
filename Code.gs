const SHEET_ID   = '1BRKhbZ7wsJ8m8Xi_9mhl5CEl6dDVfJW_XKekjiL7dX0';
const SHEET_NAME = 'Mov Vehículos Carga y Desc';
const EMAIL_OPS  = 'marcos.chiappa@explora.com.ar';

function doGet(e) {
  if (!e || !e.parameter) return ContentService.createTextOutput(JSON.stringify({status:'error',message:'No params'})).setMimeType(ContentService.MimeType.JSON);
  return handleRequest(e.parameter);
}
function doPost(e) {
  if (!e) return ContentService.createTextOutput(JSON.stringify({status:'error',message:'No data'})).setMimeType(ContentService.MimeType.JSON);
  const data = (e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : e.parameter;
  return handleRequest(data);
}

function handleRequest(data) {
  try {
    const id = generarID();
    escribirEnSheet(data, id);
    enviarEmailOps(data, id);
    if (data.email_remitente) enviarEmailCliente(data, id);
    return ContentService.createTextOutput(JSON.stringify({status:'ok', id:id})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({status:'error',message:err.message})).setMimeType(ContentService.MimeType.JSON);
  }
}

function generarID() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const num = Math.max(lastRow - 1, 0) + 1;
  return 'NOM-' + String(num).padStart(4, '0');
}

function escribirEnSheet(data, id) {
  const ss      = SpreadsheetApp.openById(SHEET_ID);
  const sheet   = ss.getSheetByName(SHEET_NAME);
  const nextRow = Math.max(sheet.getLastRow() + 1, 3);
  const ts      = new Date().toLocaleString('es-AR', {timeZone:'America/Argentina/Cordoba'});
  const row = [
    '',                    // A — LL
    '',                    // B — E
    '',                    // C — S
    data.tipo_op      || '', // D
    data.patente      || '', // E
    data.acoplado     || '', // F
    data.chofer       || '', // G
    data.dni          || '', // H
    data.empresa      || '', // I
    data.cuit         || '', // J
    data.producto     || '', // K
    data.cisternas    || '', // L
    'Pendiente',             // M
    data.cliente      || '', // N
    data.proveedor    || '', // O
    data.origen       || '', // P
    data.destino      || '', // Q
    data.orden        || '', // R
    (data.producto||'') + (data.fecha_carga ? ' — ' + data.fecha_carga : ''), // S
    '',                      // T — Pager
    id,                      // U — ID Nómina
    data.email_remitente || '', // V — Email remitente
    ts,                      // W — Timestamp
  ];
  sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);
}

function buildEmailBody(data, id, esCliente) {
  const titulo = esCliente ? 'Nómina recibida — ' + id : 'Nueva nómina — ' + id;
  const intro  = esCliente
    ? 'Tu nómina fue recibida correctamente. Queda pendiente de aprobación por parte de Explora.'
    : 'Se recibió una nueva nómina de operación. Revisá y aprobá o rechazá desde el sheet.';

  const exportInfo = data.exp_activo === 'Si'
    ? '<tr><td colspan="2" style="padding:10px 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;color:#9ca3af;">Exportación Glicerina</td></tr>'
      + fila('País destino', data.exp_nac) + fila('Contenedor', data.exp_cont)
      + fila('Permiso', data.exp_permiso)  + fila('N° contenedor', data.exp_nro_cont)
    : '';

  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;max-width:600px;padding:20px;">'
    + '<h2 style="color:#D85A30;margin-bottom:4px;">' + titulo + '</h2>'
    + '<p style="color:#6b7280;font-size:12px;margin-top:0;">' + intro + '</p>'
    + '<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />'
    + '<table style="width:100%;border-collapse:collapse;">'
    + seccion('Operación')
    + filaDestacada('ID Nómina', id)
    + fila('Tipo', data.tipo_op)
    + fila('Cliente / Proveedor', data.cliente)
    + fila('N° Orden', data.orden)
    + fila('Producto', data.producto)
    + fila('Fecha', data.fecha_carga)
    + (data.proveedor ? fila('Proveedor', data.proveedor) : '')
    + (data.origen    ? fila('Origen', data.origen)       : '')
    + (data.cisternas ? fila('Cisternas', data.cisternas) : '')
    + seccion('Transporte')
    + filaPatente(data.patente)
    + fila('Acoplado', data.acoplado)
    + fila('Empresa', data.empresa)
    + fila('CUIT', data.cuit)
    + fila('DNI chofer', data.dni)
    + fila('Chofer', data.chofer)
    + exportInfo
    + seccion('Destino')
    + fila('Terminal', data.destino)
    + fila('Dirección', data.direccion)
    + fila('Localidad', data.localidad)
    + fila('Provincia', data.provincia)
    + '</table></div>';
}

function seccion(t) { return '<tr><td colspan="2" style="padding:10px 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;color:#9ca3af;">' + t + '</td></tr>'; }
function fila(k,v)  { return '<tr><td style="color:#6b7280;padding:4px 0;width:40%;">' + k + '</td><td>' + (v||'—') + '</td></tr>'; }
function filaDestacada(k,v) { return '<tr><td style="color:#6b7280;padding:4px 0;width:40%;">' + k + '</td><td style="font-weight:700;color:#D85A30;font-size:15px;">' + (v||'—') + '</td></tr>'; }
function filaPatente(v) { return '<tr><td style="color:#6b7280;padding:4px 0;width:40%;">Patente camión</td><td style="font-weight:600;font-size:16px;letter-spacing:0.08em;color:#D85A30;">' + (v||'—') + '</td></tr>'; }

function enviarEmailOps(data, id) {
  GmailApp.sendEmail(EMAIL_OPS, 'Nueva nómina — ' + id + ' · ' + (data.cliente||'') + ' · ' + (data.tipo_op||''), '', {htmlBody: buildEmailBody(data, id, false)});
}

function enviarEmailCliente(data, id) {
  GmailApp.sendEmail(data.email_remitente, 'Nómina recibida — ' + id + ' · Explora S.A.', '', {htmlBody: buildEmailBody(data, id, true)});
}
