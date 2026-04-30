// Google Apps Script — Explora Nóminas
// Pegar este código en script.google.com vinculado al spreadsheet
// Luego: Implementar → Nueva implementación → Aplicación web → Ejecutar como: Yo → Acceso: Cualquiera

const SHEET_ID   = '18kB0_VISvV7jymEN-jzTlsLSGDj82H1k7ebndLKWxJ8';
const SHEET_NAME = 'Mov Vehículos Carga y Desc';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);

    // Buscar primera fila vacía desde la fila 3 (fila 1 = título, fila 2 = encabezados)
    const lastRow  = sheet.getLastRow();
    const nextRow  = lastRow < 2 ? 3 : lastRow + 1;

    sheet.getRange(nextRow, 1, 1, body.row.length).setValues([body.row]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', row: nextRow }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Para verificar que el script está activo
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'activo' }))
    .setMimeType(ContentService.MimeType.JSON);
}
