// ============================================================
// PlanDeProduccion.gs — La hoja "Plan de Producción"
// ============================================================
//
// QUÉ ES
//   Todo lo que toca la celda compartida (fecha × columna de producto+cliente):
//   escribirla, borrar el bloque de un despacho puntual, resolver a qué
//   columna corresponde cada uno, y el formato de la nota. Las cuatro viven
//   juntas a propósito: `escribirEnPlan()` y `borrarDespacho()` tienen que
//   estar de acuerdo sobre el formato exacto de la nota —el separador entre
//   bloques, el ancla para encontrar uno puntual—, y esa dependencia es más
//   fácil de mantener correcta estando las dos a la vista en el mismo
//   archivo que escondida en dos lugares distintos.
//
// D2 — NORMALIZAR Y AVISAR
//   La lista fija de columnas (MAPA_EMAG, MAPA_GLICERINA, etc.) sigue
//   exactamente igual — un Plan configurable por producto es trabajo para
//   más adelante. Lo que cambia es que comparar contra esa lista es menos
//   frágil (`normalizarClave` sacando acentos y espacios de más), y que un
//   producto o cliente sin columna avisa por mail en vez de desaparecer.
//
// EL FORMATO DE NOTA — MÁS CORTO, MISMO ANCLA CONCEPTUAL
//   Antes cada bloque eran 8-9 líneas con etiquetas escritas a mano
//   ("Pedido:  ", "OV/OC:   "...). Ahora los pares que casi siempre se leen
//   juntos van agrupados entre corchetes: `[ pedido | ov ]`,
//   `[ cliente | destino ]`, `[ fecha entrega | horario ]`. Una celda con 4
//   despachos compartidos pasa de ~35 líneas de nota a ~20.
//
//   El ancla para que `borrarDespacho()` encuentre el bloque de un despacho
//   puntual pasa de `"Pedido:  " + id` a `"[ " + id + " |"` — con el espacio
//   y la barra al final, para no matchear por error el prefijo de otro
//   pedido que empiece con los mismos caracteres.
//
// FIX — MOVER EL BLOQUE CUANDO CAMBIA LA FECHA DE CARGA (sept 2026)
//   SÍNTOMA: un despacho aparecía bien en el Plan al crearlo, pero si el
//   coordinador después le corregía la fecha de carga (editar_despacho /
//   reprogramar_despacho) el bloque quedaba clavado para siempre en la fila
//   de la fecha VIEJA. Invisible a simple vista porque `construirNota()`
//   nunca muestra `fecha_carga` en el texto -- solo `fecha_entrega` -- así
//   que la nota se veía perfecta aunque estuviera sumando en el día
//   equivocado.
//   CAUSA RAÍZ: `ACCIONES.editar_despacho` y `ACCIONES.reprogramar_despacho`
//   en Codigo.gs no tenían `escribir: escribirEnPlan` (ni ningún `escribir`).
//   Solo mandaban el mail; el Plan nunca se tocaba de nuevo.
//   ALCANCE: `editarDespacho()` y `reprogramarDespacho()` en el portal solo
//   tocan `fecha_carga` y `horario_carga` -- nunca producto/cliente/ov/
//   volumen -- así que la columna es siempre la misma entre la escritura
//   vieja y la nueva; lo único que puede cambiar es la fila.
//   VERIFICACIÓN: crear un despacho de prueba, editarle la fecha de carga a
//   un día distinto, y confirmar que el bloque desaparece de la fila vieja
//   y aparece en la fila nueva (no duplicado, no en las dos).
// ============================================================

var PLAN_ID          = '1TF7NPAYho68wAzQTp6bUGrAWEx6VVIcee2r34sCrwHU';
var HOJA_OP          = 'OP ACS-BD-GL  A';
var PLAN_COL_FECHA   = 3;
var PLAN_FILA_INICIO = 6;

var MAPA_EMAG = {
  'PRO CROP': 58, 'PROCROP': 58,
  'FENDER':   59, 'METHIL':  60,
  'ARANAMI':  61, 'PEYTE':   62,
  'LANTHER':  63, 'ALLTEC':  64,
  'DARUMA':   65,
};
var EMAG_OTROS = 66;

var MAPA_GLICERINA = {
  'ALIANZA': 85, 'SEEDS': 86, 'CDM': 87,
  'BIOGAS':  88, 'BIOEL': 89,
  'BIOLECTRICA DOS': 90, 'BIOEL DOS': 90,
};
var GL_OV_MAP  = { '2493': 87, '2274': 90 };
var GL_OTROS   = 91;

var MAPA_BD_GRANEL  = { 'EXOLGAN': 70, 'ANDREANI': 71 };
var BD_GRANEL_OTROS = 72;

var SEBO_REC_COLS = [34, 36, 37];
var SEBO_DESP_COL = 35;
var ACEITE_W      = 23;

// ============================================================
// NORMALIZACIÓN — D2
// ============================================================
//   Saca acentos, colapsa espacios dobles, mayúsculas, trim. NO borra
//   espacios internos: "PRO CROP" y "PROCROP" siguen siendo entradas
//   distintas en el mapa a propósito (son el mismo cliente escrito de dos
//   formas reales, no algo que la normalización deba fusionar sola).
function normalizarClave(texto) {
  return String(texto || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================
// RESOLVER COLUMNA
// ============================================================
function resolverColumna(data, wsOP) {
  var prod    = normalizarClave(data.producto);
  var cliente = normalizarClave(data.cliente);
  var ov      = String(data.ov || '').trim();
  var tipo    = normalizarClave(data.tipo).toLowerCase();

  if (prod === 'EMAG') {
    for (var k in MAPA_EMAG) { if (cliente.indexOf(k) !== -1) return MAPA_EMAG[k]; }
    return EMAG_OTROS;
  }

  if (prod === 'BIODIESEL') {
    for (var k in MAPA_BD_GRANEL) { if (cliente.indexOf(k) !== -1) return MAPA_BD_GRANEL[k]; }
    var ovNum = ov.replace(/\D/g, '');
    if (ovNum) {
      var lastCol = wsOP.getLastColumn();
      var fila1 = wsOP.getRange(1, 1, 1, lastCol).getValues()[0];
      for (var c = 0; c < fila1.length; c++) {
        if (String(fila1[c]).indexOf(ovNum) !== -1) return c + 1;
      }
    }
    return BD_GRANEL_OTROS;
  }

  if (prod === 'GLICERINA') {
    var ovNum = ov.replace(/\D/g, '');
    if (GL_OV_MAP[ovNum]) return GL_OV_MAP[ovNum];
    for (var k in MAPA_GLICERINA) { if (cliente.indexOf(k) !== -1) return MAPA_GLICERINA[k]; }
    return GL_OTROS;
  }

  if (prod.indexOf('SEBO') !== -1 || prod.indexOf('HFFA ANIMAL') !== -1) {
    if (tipo.indexOf('retiro') !== -1) {
      var ovNum2 = parseFloat(ov.replace(/\D/g, '')) || 0;
      if (ovNum2 > 0) {
        for (var ci = 0; ci < SEBO_REC_COLS.length; ci++) {
          var f1v = String(wsOP.getRange(1, SEBO_REC_COLS[ci]).getValue() || '');
          if (f1v.indexOf(String(ovNum2)) !== -1) return SEBO_REC_COLS[ci];
        }
      }
      return SEBO_REC_COLS[0];
    }
    return SEBO_DESP_COL;
  }

  if (prod.indexOf('HFFA VEGETAL') !== -1) return 98;

  if (prod.indexOf('ACEITE') !== -1) {
    var ocNum = parseFloat(ov.replace(/\D/g, '')) || 0;
    if (ocNum > 0) {
      for (var c = 9; c <= 22; c++) {
        var f1v2 = String(wsOP.getRange(1, c).getValue() || '');
        if (f1v2.indexOf(String(ocNum)) !== -1) return c;
      }
    }
    return ACEITE_W;
  }

  return null;
}

// ============================================================
// CONSTRUIR NOTA — formato nuevo, D2
// ============================================================
function construirNota(data) {
  var horario = '';
  if (data.horario_carga) {
    var h = String(data.horario_carga).trim();
    horario = /hs\s*$/i.test(h) ? h : h + 'hs';
  }

  return [
    '[ ' + data.pedido_id + ' | ' + data.ov + ' ]',
    '[ ' + (data.cliente || '—') + ' | ' + (data.lugar || '—') + ' ]',
    'Volumen: ' + data.volumen + ' tn',
    '[ ' + (data.fecha_entrega || '—') + ' | ' + horario + ' ]',
    data.obs ? 'Obs: ' + data.obs : null,
    'Prog.:   ' + (data.programado_por || '—') + ' · ' + new Date().toLocaleDateString('es-AR')
  ].filter(function (linea) { return linea !== null; }).join('\n');
}

// ============================================================
// ESCRIBIR EN EL PLAN
// ============================================================
function escribirEnPlan(data) {
  var ss   = SpreadsheetApp.openById(PLAN_ID);
  var wsOP = ss.getSheetByName(HOJA_OP);
  if (!wsOP) throw new Error('Hoja ' + HOJA_OP + ' no encontrada');

  var partes = data.fecha_carga.split('-');
  var fechaCarga = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
  fechaCarga.setHours(0, 0, 0, 0);
  var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  if (fechaCarga < hoy) throw new Error('No se puede escribir en fechas pasadas');

  var totalFilas = wsOP.getLastRow() - PLAN_FILA_INICIO + 1;
  var bloqFechas = wsOP.getRange(PLAN_FILA_INICIO, PLAN_COL_FECHA, totalFilas, 1).getValues();
  var filaIdx = -1;
  for (var r = 0; r < bloqFechas.length; r++) {
    var f = bloqFechas[r][0];
    if (f instanceof Date) {
      var fd = new Date(f); fd.setHours(0, 0, 0, 0);
      if (fd.getTime() === fechaCarga.getTime()) { filaIdx = r; break; }
    }
  }
  if (filaIdx === -1) throw new Error('Fecha ' + data.fecha_carga + ' no encontrada en el plan');
  var filaReal = PLAN_FILA_INICIO + filaIdx;

  var col = resolverColumna(data, wsOP);
  if (!col) {
    Logger.log('Sin columna para ' + data.producto + '/' + data.cliente);
    enviarEmailSinUbicar(data);
    return;
  }

  var cell = wsOP.getRange(filaReal, col);
  var valActual = parseFloat(cell.getValue()) || 0;
  var nuevoVal  = valActual + parseFloat(data.volumen);
  var notaNueva = construirNota(data);
  var notaActual = cell.getNote();
  var notaFinal = notaActual ? notaActual + '\n─────────────────\n' + notaNueva : notaNueva;
  cell.setValue(nuevoVal);
  cell.setFontColor('#000000');
  cell.setFontWeight('normal');
  cell.setNote(notaFinal);
  Logger.log('Plan escrito: fila=' + filaReal + ' col=' + col + ' val=' + nuevoVal);
}

// ============================================================
// BORRAR UN DESPACHO — resta el volumen, sacale solo su bloque de nota
// ============================================================
//   Busca el bloque por el ancla `"[ " + pedido_id + " |"`, saca el volumen
//   A RESTAR del propio texto de ese bloque (no del que venga en el
//   payload, por si cambió algo entre que se cargó y que se borra), y
//   reconstruye la celda sin ese bloque, dejando intactos los demás
//   despachos que puedan compartirla.
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
    // No es un error: puede haberse cancelado antes de que `escribirEnPlan`
    // llegara a escribir nada. Nada que borrar.
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

  var marcador = '[ ' + data.pedido_id + ' |';
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
// MOVER UN DESPACHO — usado por editar_despacho y reprogramar_despacho
// ============================================================
//   Saca el bloque de la fila de `data.fecha_carga_anterior` (la fecha
//   ANTES de la edición, que el portal manda junto con la fecha nueva) y lo
//   vuelve a escribir en la fila de `data.fecha_carga` (la fecha nueva).
//   Como la columna sale de producto/cliente/ov/tipo -- que no cambian en
//   una edición -- es siempre la misma en las dos pasadas; solo se mueve de
//   fila.
//
//   Si la fecha no cambió (el coordinador solo tocó el horario), esto de
//   paso sirve para refrescar la nota con el horario nuevo: sale y vuelve a
//   entrar en la misma celda, sin alterar el total (el volumen no cambia en
//   una edición).
//
//   Si `data.fecha_carga_anterior` no viene (llamador viejo, o algún caso
//   no contemplado), se degrada a un `escribirEnPlan()` normal -- agrega el
//   bloque nuevo sin tocar nada existente. Es el comportamiento de antes de
//   este fix, así que no rompe nada que ya funcionaba.
function moverEnPlan(data) {
  if (!data.fecha_carga_anterior) {
    Logger.log('moverEnPlan: sin fecha_carga_anterior, escribo sin mover (pedido=' + data.pedido_id + ')');
    escribirEnPlan(data);
    return;
  }

  var dataVieja = Object.assign({}, data, { fecha_carga: data.fecha_carga_anterior });
  borrarDespacho(dataVieja);
  escribirEnPlan(data);
}
