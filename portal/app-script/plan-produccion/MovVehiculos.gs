// ============================================================
// MovVehiculos.gs — "Mov Vehículos Carga y Desc"
// ============================================================
//
// QUÉ ES
//   La hoja de nominaciones de unidad. No tiene nada que ver con el Plan de
//   Producción: es un registro plano, una fila por nominación, sin la
//   lógica de celda-compartida-que-acumula que tiene `PlanDeProduccion.gs`.
//   Por eso vive aparte.
// ============================================================

var MOV_ID = '1BRKhbZ7wsJ8m8Xi_9mhl5CEl6dDVfJW_XKekjiL7dX0';

function escribirEnMovVehiculos(data) {
  var ss   = SpreadsheetApp.openById(MOV_ID);
  var hoja = ss.getSheetByName('Mov Vehículos Carga y Desc');
  if (!hoja) hoja = ss.getSheets()[0];

  var nextRow = Math.max(hoja.getLastRow() + 1, 3);
  var ts = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba' });

  var row = [
    '',                           // A — LL
    '',                           // B — E
    '',                           // C — S
    data.tipo            || '',   // D — Tipo Op.
    data.patente_tractor || '',   // E — Vehículo
    data.patente_semi    || '',   // F — Acoplado
    data.chofer          || '',   // G — Conductor
    data.dni_chofer      || '',   // H — DNI
    data.transporte      || '',   // I — Empresa
    data.cuit_transporte || '',   // J — CUIT Empresa
    data.cuit_chofer     || '',   // K — CUIT Chofer
    data.tel_unidad      || '',   // L — Tel. Unidad
    data.producto        || '',   // M — Producto
    '',                           // N — Cisternas
    '',                           // O — Aprobó formulario
    data.pedido_id       || '',   // P — N° Pedido
    data.cliente         || '',   // Q — Proveedor / Cliente
    data.lugar           || '',   // R — Destino
    data.ov              || '',   // S — N° Orden
    data.fecha_entrega   || '',   // T — Fecha Entrega
    data.banda_horaria   || '',   // U — Hs. Descarga
    data.horario_carga   || '',   // V — Horario Carga Sugerido
    '',                           // W — N° Pager
    data.pedido_id       || '',   // X — ID Nómina
    '',                           // Y — Email Remitente
    ts                            // Z — Timestamp
  ];

  hoja.getRange(nextRow, 1, 1, row.length).setValues([row]);
  Logger.log('Mov Vehículos escrito: fila=' + nextRow + ' pedido=' + data.pedido_id);
}
