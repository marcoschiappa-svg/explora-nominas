// ============================================================
// PORTAL EXPLORA — Acciones nuevas (borrar_despacho)
// ============================================================
//
// QUÉ ES
//   `borrar_despacho`: la única pieza que le faltaba a la Fase D real. Los
//   otros dos puntos que PENDIENTES.md daba por faltantes ya no aplican:
//
//     - `cancelar_despacho` (avisar al transportista por mail) quedó
//       reemplazado por los `avisos` de Firestore, escritos por el portal
//       en la misma transacción que cancela el despacho. No hace falta
//       tocar el Apps Script para eso.
//     - `borrar_adjunto` YA EXISTE en el archivo principal, como
//       `eliminar_adjunto` (`DriveApp...setTrashed(true)`), wireado en
//       `doPost`. El pendiente estaba mal anotado.
//
// POR QUÉ VA EN UN ARCHIVO APARTE
//   Los proyectos de Apps Script comparten un solo scope global entre todos
//   los archivos .gs — así que `PLAN_ID`, `HOJA_OP`, `resolverColumna()`, etc.
//   del archivo principal están disponibles acá sin importar nada. Eso
//   permite agregar esta función sin tocar ni una línea de lo que ya
//   funciona: la única modificación al archivo principal son las dos ramas
//   nuevas de `accion` en `doPost`/`doGet` (ver el comentario al final).
//
// EL PROBLEMA QUE RESUELVE
//   `escribirEnPlan()` no guarda una fila por despacho: acumula todo en UNA
//   SOLA CELDA por fecha+columna, sumando el volumen y concatenando la nota
//   de cada despacho con un separador de guiones. No hay ningún "ID de fila"
//   que borrar — hay que restarle el volumen y sacarle su bloque de nota a
//   una celda que puede tener mezclados los de varios despachos.
//
// CÓMO IDENTIFICA EL BLOQUE A BORRAR
//   Busca dentro del texto de la nota el bloque que empieza con
//   "Pedido:  " + pedido_id — es el primer campo que escribe
//   `construirNota()`, así que identifica el despacho sin ambigüedad.
//
//   El volumen a restar se lee DEL PROPIO TEXTO de ese bloque (con una
//   expresión regular sobre la línea "Volumen: X tn"), no del que venga en
//   el payload — por si cambió algo entre que se cargó el despacho y que se
//   borra. La nota es la fuente de verdad de lo que efectivamente se sumó.
//
//   El separador entre bloques se busca con una expresión regular
//   (`/\n─+\n/`), no con un string de guiones fijo: así no importa si el
//   conteo exacto de caracteres cambia en algún momento.
// ============================================================

function borrarDespacho(data) {
  var ss = SpreadsheetApp.openById(PLAN_ID);
  var wsOP = ss.getSheetByName(HOJA_OP);
  if (!wsOP) { Logger.log('borrarDespacho: hoja ' + HOJA_OP + ' no encontrada'); return; }

  var partes = String(data.fecha_carga || '').split('-');
  if (partes.length < 3) { Logger.log('borrarDespacho: fecha_carga inválida: ' + data.fecha_carga); return; }
  var fechaCarga = new Date(parseInt(partes[0], 10), parseInt(partes[1], 10) - 1, parseInt(partes[2], 10));
  fechaCarga.setHours(0, 0, 0, 0);

  var totalFilas = wsOP.getLastRow() - PLAN_FILA_INICIO + 1;
  if (totalFilas <= 0) { Logger.log('borrarDespacho: hoja sin filas de fecha'); return; }

  var bloqFechas = wsOP.getRange(PLAN_FILA_INICIO, PLAN_COL_FECHA, totalFilas, 1).getValues();
  var filaIdx = -1;
  for (var r = 0; r < bloqFechas.length; r++) {
    var f = bloqFechas[r][0];
    if (f instanceof Date) {
      var fd = new Date(f); fd.setHours(0, 0, 0, 0);
      if (fd.getTime() === fechaCarga.getTime()) { filaIdx = r; break; }
    }
  }
  if (filaIdx === -1) {
    // No es un error: el despacho puede haberse cancelado ANTES de que
    // `escribirEnPlan` llegara a escribir nada (por ejemplo, si el
    // transportista lo rechazó antes de nominar). Nada que borrar.
    Logger.log('borrarDespacho: fecha ' + data.fecha_carga + ' no encontrada en el plan, nada que borrar');
    return;
  }
  var filaReal = PLAN_FILA_INICIO + filaIdx;

  var col = resolverColumna(data, wsOP);
  if (!col) { Logger.log('borrarDespacho: sin columna para ' + data.producto + '/' + data.cliente); return; }

  var cell = wsOP.getRange(filaReal, col);
  var notaActual = cell.getNote();
  if (!notaActual) {
    Logger.log('borrarDespacho: la celda no tiene nota, nada que borrar (pedido=' + data.pedido_id + ')');
    return;
  }

  var marcador = 'Pedido:  ' + data.pedido_id;
  var bloques = notaActual.split(/\n─+\n/);

  var bloqueDelPedido = null;
  var restantes = [];
  for (var i = 0; i < bloques.length; i++) {
    if (bloqueDelPedido === null && bloques[i].indexOf(marcador) !== -1) {
      bloqueDelPedido = bloques[i];
    } else {
      restantes.push(bloques[i]);
    }
  }

  if (bloqueDelPedido === null) {
    Logger.log('borrarDespacho: no se encontró el bloque de ' + data.pedido_id + ' en la nota de fila=' + filaReal + ' col=' + col);
    return;
  }

  var matchVolumen = bloqueDelPedido.match(/Volumen:\s*([\d.,]+)\s*tn/);
  var volumenABajar = matchVolumen
    ? parseFloat(matchVolumen[1].replace(',', '.'))
    : (parseFloat(data.volumen) || 0);

  var valActual = parseFloat(cell.getValue()) || 0;
  var nuevoVal = Math.max(0, valActual - volumenABajar);

  cell.setValue(nuevoVal);
  cell.setNote(restantes.join('\n─────────────────\n'));

  Logger.log(
    'borrarDespacho: fila=' + filaReal + ' col=' + col +
    ' pedido=' + data.pedido_id + ' -' + volumenABajar + ' -> ' + nuevoVal
  );
}

// ============================================================
// INTEGRACIÓN CON doPost / doGet — DOS LÍNEAS EN EL ARCHIVO PRINCIPAL
// ============================================================
//
// Apps Script no permite dos funciones `doPost`/`doGet` en el mismo
// proyecto — solo una gana, en silencio, sin avisar cuál. Por eso el
// dispatch tiene que agregarse DENTRO de las que ya existen en el archivo
// principal, no acá. `borrarDespacho()` en sí queda en este archivo; lo
// único que se toca del otro es esto:
//
// En `doPost`, junto a los demás `if (accion === ...)`:
//
//     if (accion === 'borrar_despacho') {
//       borrarDespacho(data);
//       return ok('Despacho borrado del plan');
//     }
//
// En `doGet`, en el bloque que arma `payloadStr` (el portal llama con
// `mode: 'no-cors'`, que siempre es GET, así que esta es la rama que
// `cancelarDespacho()` del portal realmente va a disparar):
//
//     if (accionPayload === 'borrar_despacho') {
//       borrarDespacho(data);
//       return ok('Despacho borrado del plan');
//     }
//
// Nada más cambia en el archivo principal.
