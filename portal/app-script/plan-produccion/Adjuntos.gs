// ============================================================
// Adjuntos.gs — Google Drive
// ============================================================
//
// QUÉ ES
//   Subir y borrar los adjuntos de un pedido. `eliminarAdjunto()` es la
//   función que `PENDIENTES.md` daba por no existente bajo el nombre
//   `borrar_adjunto` — existía, con este nombre, ya andando.
//
//   OJO: `subirAdjunto()` comparte cada archivo como "cualquiera con el
//   link" (`DriveApp.Access.ANYONE_WITH_LINK`). Eso significa que
//   `visible_transportista` en Firestore es solo una bandera de UI —oculta
//   el adjunto de la lista—, no una protección real: el link funciona igual
//   para cualquiera que lo tenga. A5 (adjuntos en la ficha del pedido) está
//   pateado para más adelante en el portal por esto mismo.
// ============================================================

var CARPETA_ADJUNTOS_NOMBRE = 'Portal Explora — Adjuntos';
var DIAS_RETENCION = 30;

function obtenerCarpetaAdjuntos() {
  var carpetas = DriveApp.getFoldersByName(CARPETA_ADJUNTOS_NOMBRE);
  if (carpetas.hasNext()) return carpetas.next();
  return DriveApp.createFolder(CARPETA_ADJUNTOS_NOMBRE);
}

function subirAdjunto(data) {
  var carpeta = obtenerCarpetaAdjuntos();
  var bytes = Utilities.base64Decode(data.base64);
  var blob = Utilities.newBlob(bytes, data.tipo_mime || 'application/octet-stream', data.nombre);
  var archivo = carpeta.createFile(blob);
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var fileId = archivo.getId();
  var link = 'https://drive.google.com/file/d/' + fileId + '/view';
  Logger.log('Adjunto subido: ' + data.nombre + ' id=' + fileId);
  return {
    file_id: fileId, nombre: data.nombre, link: link,
    subido_por: data.subido_por || '',
    subido_en: new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba' }),
    visible_transportista: true,
  };
}

function eliminarAdjunto(fileId) {
  try {
    DriveApp.getFileById(fileId).setTrashed(true);
    Logger.log('Adjunto eliminado: ' + fileId);
  } catch (e) {
    Logger.log('Error eliminando adjunto: ' + e.message);
  }
}

function limpiarAdjuntosVencidos() {
  var carpeta = obtenerCarpetaAdjuntos();
  var archivos = carpeta.getFiles();
  var limite = new Date();
  limite.setDate(limite.getDate() - DIAS_RETENCION);
  while (archivos.hasNext()) {
    var archivo = archivos.next();
    if (archivo.getDateCreated() < limite) {
      archivo.setTrashed(true);
      Logger.log('Adjunto vencido eliminado: ' + archivo.getName());
    }
  }
}
