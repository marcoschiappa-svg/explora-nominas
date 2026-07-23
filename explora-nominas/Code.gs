// Google Apps Script — Explora Nóminas
// Maneja: escritura en sheet + envío de email
// Implementar como: Aplicación web → Ejecutar como: Yo → Acceso: Cualquiera

const SHEET_ID   = '18kB0_VISvV7jymEN-jzTlsLSGDj82H1k7ebndLKWxJ8';
const SHEET_NAME = 'Mov Vehículos Carga y Desc';
const EMAIL_DEST = 'marcos.chiappa@explora.com.ar';

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    let data;
    if (e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else {
      data = e.parameter;
    }
    escribirEnSheet(data);
    enviarEmail(data);
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function escribirEnSheet(data) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);
  const ts    = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba' });
  const lastRow = sheet.getLastRow();
  const nextRow = lastRow < 2 ? 3 : lastRow + 1;
  const row = [
    '',
    '',
    '',
    data.patente      || '',
    data.chofer       || '',
    data.dni          || '',
    'Pendiente aprobacion — ' + ts,
    data.cliente      || '',
    data.destino      || '',
    data.orden        || '',
    'Nomina recibida ' + ts,
    (data.producto || '') + ' — ' + (data.fecha_carga || ''),
    '',
  ];
  sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);
}

function enviarEmail(data) {
  const exportInfo = data.exp_activo === 'Si'
    ? '<tr><td colspan="2" style="padding:10px 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;color:#9ca3af;">Exportacion Glicerina</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;width:40%;">Pais destino</td><td>' + (data.exp_nac||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">Contenedor</td><td>' + (data.exp_cont||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">Permiso</td><td>' + (data.exp_permiso||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">N contenedor</td><td>' + (data.exp_nro_cont||'—') + '</td></tr>'
    : '';

  const html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;max-width:600px;padding:20px;">'
    + '<h2 style="color:#D85A30;margin-bottom:4px;">Nueva nomina de carga</h2>'
    + '<p style="color:#6b7280;font-size:12px;margin-top:0;">Recibida: ' + new Date().toLocaleString('es-AR',{timeZone:'America/Argentina/Cordoba'}) + '</p>'
    + '<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />'
    + '<table style="width:100%;border-collapse:collapse;">'
    + '<tr><td colspan="2" style="padding:0 0 6px;font-size:11px;font-weight:600;text-transform:uppercase;color:#9ca3af;">Operacion</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;width:40%;">Cliente</td><td style="font-weight:600;font-size:15px;">' + (data.cliente||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">Tipo</td><td>' + (data.tipo_op||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">N Orden</td><td>' + (data.orden||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">Producto</td><td>' + (data.producto||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">Fecha carga</td><td style="font-weight:600;">' + (data.fecha_carga||'—') + '</td></tr>'
    + '<tr><td colspan="2" style="padding:10px 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;color:#9ca3af;">Transporte</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">Patente camion</td><td style="font-weight:600;font-size:16px;letter-spacing:0.08em;color:#D85A30;">' + (data.patente||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">Patente acoplado</td><td>' + (data.acoplado||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">Empresa</td><td>' + (data.empresa||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">CUIT</td><td>' + (data.cuit||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">DNI chofer</td><td>' + (data.dni||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">Chofer</td><td>' + (data.chofer||'—') + '</td></tr>'
    + exportInfo
    + '<tr><td colspan="2" style="padding:10px 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;color:#9ca3af;">Destino</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">Terminal</td><td style="font-weight:600;">' + (data.destino||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">Direccion</td><td>' + (data.direccion||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">Localidad</td><td>' + (data.localidad||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">Provincia</td><td>' + (data.provincia||'—') + '</td></tr>'
    + '<tr><td style="color:#6b7280;padding:4px 0;">CP</td><td>' + (data.cp||'—') + '</td></tr>'
    + '</table></div>';

  GmailApp.sendEmail(
    EMAIL_DEST,
    'Nueva nomina — ' + (data.cliente||'') + ' · ' + (data.fecha_carga||''),
    '',
    { htmlBody: html }
  );
}
