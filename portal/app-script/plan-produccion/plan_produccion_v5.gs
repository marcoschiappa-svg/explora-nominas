// =============================================================================
//  plan_produccion_v5.gs — Script unificado
//  BASE: v4.6 (toda la logica de Sebo, Metanol, Biodiesel, Glicerina, ARE,
//  Insumos y Stocks queda IDENTICA a v4.6).
//
//  CAMBIOS v5 (SOLO bloque Aceite — migracion a "Layout B / mapeo por nombre"):
//    A. RUTEO POR NOMBRE DE PROVEEDOR (no mas OCs en fila 1).
//       El mapa ACEITE_MAPA_PROV vive en el CODIGO. La fila 1 con OCs queda
//       obsoleta. Nadie puede romper el ruteo borrando una celda.
//       Match: prov.toUpperCase().indexOf(match) !== -1 (igual que EMAG/GL/BDG).
//       Tokens largos para no atrapar gemelos futuros (Molinos Agro vs Cañuelas).
//       Proveedor sin token -> cae a Terceros + linea de log "A-TERCEROS".
//
//    B. LAYOUT B DE COLUMNAS:
//         I..U (9..21)  = 13 proveedores principales (top por volumen)
//         V, Y, Z (22,25,26) = reserva (libres, dentro de la suma de H)
//         W, X (23,24)  = ABANDONADAS (Terceros viejo). Ya NO se usan.
//         AA (27)       = Terceros Programado (manual, arranca vacio; NO migra W)
//         AB (28)       = Terceros Real (catch-all, lo escribe el script)
//       Formula H nueva: =SUM(I:V)+SUM(Y:Z)+IF(C<HOY(),AB,AA)
//       (excluye W y X a proposito).
//
//    C. REPROCESO HISTORICO one-shot: reprocesarAceiteHistorico()
//       Vacia el bloque Aceite (I..AB) desde ACEITE_REPROCESO_DESDE hasta AYER
//       y lo reconstruye SOLO con reales, ruteados por nombre. Antes de esa
//       fecha NO toca nada. NO reconstruye proyectado (historia = solo real).
//       Ejecucion MANUAL desde el menu. Checksum esperado ~38.117 Tn.
//
//  Actualizado: 21-ago-2026
//
// =============================================================================
//  CAMBIOS v5.1 — FIX: proyectado del portal se perdia sin recepcion real
//  Fecha: 09-sep-2026
//
//  SINTOMA REPORTADO
//    Transportista nomina un despacho de Biodiesel IBC desde Portal Explora
//    (Firestore -> Apps Script del portal -> escribirEnPlan() en
//    PlanDeProduccion.gs, proyecto de Apps Script SEPARADO de este). El valor
//    proyectado queda escrito en la celda correcta (fuente normal, sin bold),
//    pero horas mas tarde desaparece del plan sin que ninguna ejecucion
//    (ni de este script ni del otro) reporte error.
//
//  CASO REAL QUE CONFIRMO LA CAUSA (trazabilidad)
//    Despacho id aAhIBHb5dLa05trwf6tB, pedido_id r6NIpFYoEDBiSSYsxVW9
//    (numero PED-2026-000008, OV-2846), cliente "DF ENTERTAINMENT BA S.A.U."
//    (no matchea MAPA_BD_GRANEL: ni Exolgan ni Andreani), producto Biodiesel,
//    recipiente IBC, volumen 2 tn, fecha_carga 2026-09-09.
//    Ejecucion de Apps Script del portal (programar_despacho) a las
//    2026-09-08 10:19:28, duracion 6.677s, marcada "Completada" sin error.
//    La celda escrita por el portal (columna BD_GRANEL_COL_VARIOS = 72,
//    fallback de resolverColumna() para Biodiesel granel sin proveedor
//    mapeado) aparecio vacia al revisar el plan al dia siguiente.
//
//  CAUSA RAIZ (confirmada por lectura de codigo, no solo por el sintoma)
//    limpiarBloque() vacia INCONDICIONALMENTE toda celda que no sea "real"
//    (bold + negro) dentro del rango de fechas pasada-u-hoy, en cada bloque
//    que la llama (Metanol, Biodiesel AU/AW, Biodiesel Granel/Otros, EMAG,
//    Glicerina, ARE, HFFA Vegetal ISCC). El valor proyectado que el portal
//    escribe SIEMPRE es normal/no-bold (ver escribirEnPlan() en
//    PlanDeProduccion.gs: cell.setFontColor('#000000'); cell.setFontWeight
//    ('normal')), asi que limpiarBloque() lo trata igual que un proyectado
//    viejo y lo vacia.
//    Cada uno de esos bloques SI capturaba el valor proyectado en una
//    variable (proyOrigMeta, proyOrigBD, proyOrigBDG, proyOrigEMAG,
//    proyOrigGL, proyOrigARE) ANTES de llamar a limpiarBloque(), pero esa
//    variable solo se usaba para calcular la DIFERENCIA contra un real que
//    llego ese dia (para cascadear el sobrante al dia siguiente). Si NO
//    llego ningun real ese dia para esa fecha/columna, el bloque de
//    reescritura (que itera "for fs in agrupX", es decir solo sobre los
//    reales) nunca se ejecuta para esa fecha/columna, y el proyectado
//    capturado en memoria se descarta sin usarse. Resultado: la celda queda
//    vacia hasta que llegue una recepcion real (que puede tardar dias) o se
//    pierde el dato de la nominacion.
//    UN SOLO BLOQUE NO TENIA este problema por una razon incidental, no por
//    diseño: actualizarSebo() (columnas 34-37) reescribe el ARRAY COMPLETO
//    en memoria (bloqVals) al final de la funcion, y ese array nunca se
//    sincroniza con lo que limpiarBloque() hizo en la hoja fisica -- asi que
//    el proyectado "sobrevive" en memoria y se repone solo, sin que nadie lo
//    haya programado a proposito. HFFA Vegetal ISCC (columna 98), aunque
//    vive dentro de la misma funcion actualizarSebo(), NO se beneficia de
//    ese array completo (usa lectura/escritura de celda individual,
//    cellCTproy), asi que tenia el mismo bug que los demas bloques -- y
//    ademas un problema propio: la lectura de "proyectado" (cellCTproy.
//    getValue()) ocurria DESPUES de limpiarBloque(), asi que ni siquiera
//    llegaba a capturarse un valor no-cero para calcular la diferencia real
//    vs proyectado en los dias en que SI hubo recepcion.
//
//  LIMITACION CONOCIDA DEL FIX (documentada, no resuelta de fondo)
//    El unico criterio que existe hoy en todo el plan para distinguir
//    "proyectado vigente, esperando recepcion" de "proyectado obsoleto que
//    ya no corresponde" es bold-vs-no-bold. Con ese unico bit no hay forma
//    de saber si un valor no-bold que limpiarBloque() esta por vaciar
//    todavia representa un despacho vigente o uno que fue cancelado y que
//    borrarDespacho() (en el proyecto de Apps Script del portal,
//    BorrarDespacho.gs) todavia no alcanzo a limpiar. Este fix ASUME
//    siempre lo primero y repone el valor tal cual estaba, SIN pasar por
//    ningun calculo de cascada (es el mismo valor, no uno recalculado).
//    Riesgo aceptado a proposito: un despacho cancelado justo en la ventana
//    entre que se cancela y que corre la proxima ejecucion horaria de este
//    script puede quedar "fantasma" en el plan hasta que algo mas lo
//    sobrescriba. La solucion de fondo (una marca explicita de vigencia,
//    por ejemplo cruzando contra Firestore) queda pendiente para otra
//    sesion; este es un parche deliberado, no el arreglo definitivo.
//
//  ALCANCE DEL FIX (7 puntos, todos con el mismo patron salvo el ultimo).
//  La numeracion 1-7 es logica (orden de explicacion), NO el orden fisico
//  en que aparecen en el archivo: actualizarSebo() (punto 7) esta antes que
//  actualizarMetanol() (punto 1) en el codigo real. Cada comentario inline
//  se referencia por su propio numero de punto, buscar "FIX v5.1 -- punto".
//    1. actualizarMetanol()   -- columnas 76, 77, 78 (BX, BY, BZ)
//    2. actualizarBiodiesel() -- Biodiesel AU/AW, columnas 47, 49
//    3. actualizarBiodiesel() -- Biodiesel Granel/Otros, columnas 70, 71, 72
//       (bloque donde se confirmo el bug con el caso real de arriba)
//    4. actualizarBiodiesel() -- EMAG, columnas 58-66 (BF-BN)
//    5. actualizarGlicerina() -- columnas 85-92 (CG-CN)
//    6. actualizarARE()       -- columna 103 (CY)
//    7. actualizarSebo()      -- HFFA Vegetal ISCC, columna 98 (CT). Este
//       bloque necesito ademas invertir el orden de lectura (capturar antes
//       de limpiar, no despues) porque nunca capturaba nada, a diferencia
//       de los otros 6 que si capturaban pero no reponian.
//    NO se toco: actualizarAceite() (arquitectura de columnas fijas propia,
//    reescribe por columna completa, no tiene este problema),
//    actualizarInsumos() (no llama a limpiarBloque en absoluto), y el bloque
//    Sebo/HFFA de columnas 34-37 (no tiene el problema, ver arriba).
//    NO se toco BorrarDespacho.gs ni resolverColumna() del otro proyecto de
//    Apps Script (portal) -- ese es un problema distinto (recalculo de
//    columna al cancelar un despacho), reportado por el usuario como
//    "borra celdas que no deberia" y todavia pendiente de resolver en otra
//    sesion, con su propio caso real a confirmar antes de tocar codigo.
//
//  COMO SE VERIFICO ANTES DE APLICAR
//    Lectura de codigo linea por linea contra el caso real de arriba
//    (ejecucion de Apps Script confirmada "Completada" sin error a las
//    2026-09-08 10:19:28, coincidiendo con estado_ts del despacho). Se
//    verifico sintacticamente el archivo completo (parseo con node) despues
//    de aplicar los 8 cambios (7 puntos + la correccion de proyCT en Sebo).
//    PENDIENTE DE HACER EN PRODUCCION (no hecho por este cambio):
//      1. Pegar este archivo completo en el editor de Apps Script.
//      2. Ejecutar manualmente actualizarBiodiesel() una vez (no esperar
//         al trigger horario) y revisar el Logger.log de esa ejecucion.
//      3. Confirmar en la hoja que la celda de PED-2026-000008 (columna 72,
//         fecha 2026-09-09) conserva su valor de 2 tn tras la corrida.
//      4. Dejar correr el trigger horario normalmente y revisar que no
//         aparezcan celdas vacias inesperadas en Metanol, EMAG, Glicerina
//         o ARE para despachos recien nominados sin recepcion real todavia.
// =============================================================================

var ID_CARPETA          = "1sdlLtqWf492lkZTGDRBUkF4y5V7Snv0g";
var NOMBRE_REPEC        = "Recepclaude.xlsx";
var HOJA_OP             = "OP ACS-BD-GL  A";

var REPEC_COL_OC        = 1;
var REPEC_COL_TIPO      = 3;
var REPEC_COL_PRODUCTO  = 13;
var REPEC_COL_PROVEEDOR = 16;
var REPEC_COL_FECHA     = 7;
var REPEC_COL_PESO      = 25;
var REPEC_FILA_INICIO   = 2;

var PLAN_COL_FECHA      = 3;
var PLAN_FILA_INICIO    = 6;

var ACEITE_COLS_PROV = [9,10,11,12,13,14,15,16,17,18,19,20,21];
var ACEITE_COL_VARIOS       = 28;
var ACEITE_COL_PROG_VARIOS  = 27;
var PRODUCTO_ACEITE         = "Aceite de Soja";

var ACEITE_MAPA_PROV = [
  { match: "MOLINOS AGRO",             col: 9  },
  { match: "BLD AGRO",                 col: 10 },
  { match: "CARGILL",                  col: 11 },
  { match: "COMMODITIES",              col: 12 },
  { match: "COOPERATIVAS ARGENTINAS",  col: 13 },
  { match: "SOYCHU",                   col: 14 },
  { match: "BUNGE ARGENTINA",          col: 15 },
  { match: "AGRICULTORES FEDERADOS",   col: 16 },
  { match: "AGROPECUARIA SANTA MARIA", col: 17 },
  { match: "BIORDO",                   col: 18 },
  { match: "ENTRE RIOS CRUSHING",      col: 19 },
  { match: "TANONI",                   col: 20 },
  { match: "VICENTIN",                 col: 21 }
];

var ACEITE_REPROCESO_DESDE = "2026-01-02";

function matchProveedorAceite(prov) {
  var p = String(prov || "").toUpperCase();
  for (var i = 0; i < ACEITE_MAPA_PROV.length; i++) {
    if (p.indexOf(ACEITE_MAPA_PROV[i].match) !== -1) return ACEITE_MAPA_PROV[i].col;
  }
  return null;
}

var SEBO_COL_VARIOS         = 34;
var SEBO_COL_DESPACHOS      = 35;
var SEBO_RANGO              = [34, 37];
var SEBO_MAX_COL            = 37;
var HFFA_VEGETAL_COL_VARIOS = 98;

var META_COL_YPF    = 76;
var META_COL_DALGAR = 77;
var META_COL_ARAUCO = 78;

var META_PRODUCTOS = [
  "Metanol",
  "Metanol Dalgar"
];

var BD_COL_PAE          = 47;
var BD_COL_YPF          = 49;
var BD_RANGO            = [47, 49];
var BD_PRODUCTO         = "Biodiesel";

var BD_GRANEL_COL_VARIOS = 72;
var BD_GRANEL_RANGO      = [70, 72];
var BD_GRANEL_MAPA_PROV  = [
  { match: "EXOLGAN",  col: 70 },
  { match: "ANDREANI", col: 71 }
];

var EMAG_COL_VARIOS     = 66;
var EMAG_RANGO          = [58, 66];
var EMAG_PRODUCTO       = "Ésteres metílicos de ácidos grasos de aceite vegetal";
var EMAG_MAPA_PROV = [
  { match: "PRO CROP",           col: 58 },
  { match: "FENDER",             col: 59 },
  { match: "METHIL GROUP",       col: 60 },
  { match: "ARANAMI",            col: 61 },
  { match: "LABORATORIOS PEYTE", col: 62 },
  { match: "LANTHER",            col: 63 },
  { match: "ALLTEC",             col: 64 },
  { match: "DARUMA",             col: 65 }
];

var SEBO_PRODUCTOS_AH = [
  "HFFA Animal",
  "HFFA Vegetal"
];
var SEBO_PRODUCTOS_CT = [
  "HFFA Vegetal ISCC"
];

var COLS_PROTEGIDAS = [1,2,3,4,5,7,8,32,39,40,42,43,44,45,67,75,79,82,83,84,95,96,100];

var ID_CARPETA_STOCKS     = "1sdlLtqWf492lkZTGDRBUkF4y5V7Snv0g";
var NOMBRE_STOCKS         = "RE-LO02-002-G Resumen Mensual Stocks´.xlsx";
var HOJA_INSUMOS          = "Planificación de insumos";
var FILA_INICIO_INSUMOS   = 5;
var COL_FECHA_INSUMOS     = 2;
var FILA_INICIO_RESUMEN   = 2;
var COL_FECHA_RESUMEN     = 1;

var MAPEO_OP_STOCKS = [
  { colOrigen: 2,  colDestino: 6,   descripcion: "Aceite"            },
  { colOrigen: 3,  colDestino: 41,  descripcion: "Biodiesel"         },
  { colOrigen: 4,  colDestino: 74,  descripcion: "Metanol"           },
  { colOrigen: 5,  colDestino: 81,  descripcion: "GL 80%"            },
  { colOrigen: 6,  colDestino: 30,  descripcion: "Sebo"              },
  { colOrigen: 7,  colDestino: 105, descripcion: "Glicerina Tecnica" },
  { colOrigen: 13, colDestino: 97,  descripcion: "HFFA"              },
  { colOrigen: 14, colDestino: 102, descripcion: "ARE"               }
];

var MAPEO_INSUMOS_STOCKS = [
  { colOrigen: 8,  colDestino: 4,  descripcion: "Metilato"              },
  { colOrigen: 9,  colDestino: 7,  descripcion: "Ac. Sulfurico Conc."   },
  { colOrigen: 10, colDestino: 10, descripcion: "Ac. Sulfurico Diluido" },
  { colOrigen: 11, colDestino: 13, descripcion: "Antioxidante"          },
  { colOrigen: 12, colDestino: 16, descripcion: "Soda Caustica"         }
];

var ARE_COL          = 103;
var ARE_PRODUCTOS = ["ARE Vegetal", "ARE Vegetal ISCC",
                     "HFFA Vegetal", "HFFA Vegetal ISCC", "HFFA Sewage Sludge ISCC"];

var GL_COL_VARIOS  = 92;
var GL_RANGO       = [85, 92];
var GL_PRODUCTOS   = ["Glicerina 80%", "Glicerina GEX"];
var GL_MAPA_PROV = [
  { match: "ALIANZA",   col: 85 },
  { match: "SEEDS",     col: 86 },
  { match: "CDM",       col: 87 },
  { match: "BIOGAS",    col: 88 },
  { match: "BIOELÉCTRICA DOS", col: 90 },
  { match: "BIOEL",     col: 89 }
];

var INSUMOS_FILA_INICIO   = 5;
var INSUMOS_COL_FECHA     = 2;
var INSUMOS_MAPA = [
  { producto: "Metilato de Sodio",   col: 6  },
  { producto: "Ácido Sulfúrico 98%", col: 9  },
  { producto: "Ácido Sulfúrico 33%", col: 12 },
  { producto: "Antioxidante",        col: 15 },
  { producto: "Soda Cáustica 50%",   col: 18 }
];

function actualizarTodo() {
  actualizarTodo_1();
  actualizarTodo_2();
}

function _conCandado(nombre, fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log(nombre + ": ya hay una corrida en curso, se omite este ciclo.");
    return;
  }
  try {
    fn();
  } finally {
    lock.releaseLock();
  }
}

function actualizarTodo_1() {
  _conCandado("actualizarTodo_1", function() {
    actualizarStocks();
    actualizarAceite();
    actualizarSebo();
  });
}

function actualizarTodo_2() {
  _conCandado("actualizarTodo_2", function() {
    actualizarMetanol();
    actualizarBiodiesel();
    actualizarGlicerina();
    actualizarARE();
    actualizarInsumos();
  });
}

function actualizarRepec() { actualizarTodo(); }

function actualizarStocks() {
  var ahora = new Date();
  var horaAR = ahora.getHours(); if (horaAR < 6) { Logger.log("Fuera de horario AR (" + horaAR + "hs)."); return; }

  var ssPlan;
  var ssStocks;
  try {
    ssPlan   = SpreadsheetApp.getActiveSpreadsheet();
    ssStocks = abrirArchivoXlsx(NOMBRE_STOCKS, ID_CARPETA_STOCKS);
  } catch(e) { Logger.log("ERROR Stocks: " + e.message); return; }

  var hojaOP      = ssPlan.getSheetByName(HOJA_OP);
  var hojaInsumos = ssPlan.getSheetByName(HOJA_INSUMOS);
  var hojaResumen = ssStocks.getSheetByName("Resumen");

  if (!hojaOP)      { Logger.log("ERROR: hoja OP no encontrada"); return; }
  if (!hojaResumen) { Logger.log("ERROR: hoja Resumen no encontrada en Stocks"); return; }

  var total = 0;

  var datosPlan = hojaOP.getDataRange().getValues();
  var idxOp = {};
  for (var i = PLAN_FILA_INICIO - 1; i < datosPlan.length; i++) {
    var f = datosPlan[i][PLAN_COL_FECHA - 1];
    if (f instanceof Date) idxOp[formatF(f)] = i + 1;
  }

  var datosRes = hojaResumen.getDataRange().getValues();
  var ultimaFila = FILA_INICIO_RESUMEN - 1;
  for (var i = FILA_INICIO_RESUMEN - 1; i < datosRes.length; i++) {
    if (!(datosRes[i][COL_FECHA_RESUMEN - 1] instanceof Date)) continue;
    for (var m = 0; m < MAPEO_OP_STOCKS.length; m++) {
      var v = datosRes[i][MAPEO_OP_STOCKS[m].colOrigen - 1];
      if (v !== null && v !== undefined && v !== "" && v !== 0) { ultimaFila = i; break; }
    }
  }

  var hoyStocks = new Date(); hoyStocks.setHours(0,0,0,0);

  for (var i = FILA_INICIO_RESUMEN - 1; i <= ultimaFila; i++) {
    var fechaRaw = datosRes[i][COL_FECHA_RESUMEN - 1];
    if (!(fechaRaw instanceof Date)) continue;
    var fechaStk = new Date(fechaRaw); fechaStk.setHours(0,0,0,0);
    if (fechaStk > hoyStocks) continue;
    var fk = formatF(fechaRaw);
    if (!(fk in idxOp)) continue;

    for (var m = 0; m < MAPEO_OP_STOCKS.length; m++) {
      var map = MAPEO_OP_STOCKS[m];
      var val = datosRes[i][map.colOrigen - 1];
      if (!esValorValidoStock(val)) continue;
      var celda = hojaOP.getRange(idxOp[fk], map.colDestino);
      if (esProtegida(map.colDestino)) continue;
      var yaEsRealOP = (celda.getFontWeight() === "bold" && celda.getFontColor() === "#000000");
      if (celda.getValue() !== val || !yaEsRealOP) celda.setValue(val);
      celda.setFontWeight("bold").setFontColor("#000000");
      total++;
    }
  }
  Logger.log("Stocks OP ACS: OK");

  if (hojaInsumos) {
    var datosIns = hojaInsumos.getDataRange().getValues();
    var idxIns = {};
    for (var i = FILA_INICIO_INSUMOS - 1; i < datosIns.length; i++) {
      var f = datosIns[i][COL_FECHA_INSUMOS - 1];
      if (f instanceof Date) idxIns[f.getDate() + "-" + f.getMonth() + "-" + f.getFullYear()] = i + 1;
    }
    for (var i = FILA_INICIO_RESUMEN - 1; i < datosRes.length; i++) {
      var fechaRaw = datosRes[i][COL_FECHA_RESUMEN - 1];
      if (!(fechaRaw instanceof Date)) continue;
      var fechaStkIns = new Date(fechaRaw); fechaStkIns.setHours(0,0,0,0);
      if (fechaStkIns > hoyStocks) continue;
      var clave = fechaRaw.getDate() + "-" + fechaRaw.getMonth() + "-" + fechaRaw.getFullYear();
      if (!(clave in idxIns)) continue;
      for (var m = 0; m < MAPEO_INSUMOS_STOCKS.length; m++) {
        var map = MAPEO_INSUMOS_STOCKS[m];
        var val = datosRes[i][map.colOrigen - 1];
        if (!esValorValidoStock(val)) continue;
        var celda = hojaInsumos.getRange(idxIns[clave], map.colDestino);
        var yaEsRealIns = (celda.getFontWeight() === "bold" && celda.getFontColor() === "#000000");
        if (celda.getValue() !== val || !yaEsRealIns) celda.setValue(val);
        celda.setFontWeight("bold").setFontColor("#000000");
        total++;
      }
    }
    Logger.log("Stocks Insumos: OK");
  }

  Logger.log("STOCKS FINALIZADO: " + total + " celdas actualizadas.");
}

function actualizarAceite() {

  var ahora = new Date();
  var horaAR = ahora.getHours();
  if (horaAR < 6) { Logger.log("Fuera de horario AR (" + horaAR + "hs)."); return; }

  var log  = [];
  var cont = { escritos: 0, cascadas: 0, cierres: 0 };
  log.push("=== ACEITE v5 (mapeo por nombre / layout B) === " + ahora.toLocaleString());
  log.push("");

  var ssRepec;
  try { ssRepec = abrirArchivoXlsx(NOMBRE_REPEC); }
  catch(e) { log.push("ERROR RecepClaude: " + e.message); guardarLog(log); return; }

  var wsRepec    = ssRepec.getSheets()[0];
  var datosRepec = wsRepec.getRange(
    REPEC_FILA_INICIO, 1,
    wsRepec.getLastRow() - REPEC_FILA_INICIO + 1,
    Math.max(REPEC_COL_OC, REPEC_COL_TIPO, REPEC_COL_PRODUCTO, REPEC_COL_PROVEEDOR, REPEC_COL_FECHA, REPEC_COL_PESO)
  ).getValues();

  var ssPlan = SpreadsheetApp.getActiveSpreadsheet();
  var wsOP   = ssPlan.getSheetByName(HOJA_OP);
  if (!wsOP) { log.push("ERROR: hoja OP no encontrada"); guardarLog(log); return; }

  var totalFilas = wsOP.getLastRow() - PLAN_FILA_INICIO + 1;

  var colsConOC = ACEITE_COLS_PROV.slice();
  var TODAS_COLS_ACEITE = colsConOC.concat([ACEITE_COL_VARIOS]);

  var MAX_COL_BATCH = ACEITE_COL_VARIOS;
  var rangoPlan   = wsOP.getRange(PLAN_FILA_INICIO, 1, totalFilas, MAX_COL_BATCH);
  var bloqVals    = rangoPlan.getValues();
  var bloqPesos   = rangoPlan.getFontWeights();

  var bloqFechas  = wsOP.getRange(PLAN_FILA_INICIO, PLAN_COL_FECHA, totalFilas, 1).getValues();
  var idxFecha    = {};
  var fechasOrden = [];
  for (var r = 0; r < bloqFechas.length; r++) {
    var v = bloqFechas[r][0];
    if (!(v instanceof Date)) continue;
    var d = new Date(v); d.setHours(0,0,0,0);
    var fs = formatF(d);
    idxFecha[fs] = r;
    fechasOrden.push(fs);
  }
  fechasOrden.sort();

  var proyOrig = {};
  for (var r = 0; r < totalFilas; r++) {
    var fila = bloqVals[r];
    for (var ci = 0; ci < TODAS_COLS_ACEITE.length; ci++) {
      var col    = TODAS_COLS_ACEITE[ci];
      var colIdx = col - 1;
      var val    = fila[colIdx];
      var bold   = (bloqPesos[r][colIdx] === "bold");
      var num    = parseFloat(val);
      var esProy = (!isNaN(num) && num !== 0 && !bold);
      if (esProy) {
        if (!proyOrig[r]) proyOrig[r] = {};
        proyOrig[r][col] = num;
      }
    }
  }

  var recep        = {};
  var recepDetalle = {};
  var varios       = {};

  for (var i = 0; i < datosRepec.length; i++) {
    var fila     = datosRepec[i];
    var tipo     = String(fila[REPEC_COL_TIPO - 1]).trim().toUpperCase();
    var producto = String(fila[REPEC_COL_PRODUCTO - 1]).trim();
    var fechaRaw = fila[REPEC_COL_FECHA - 1];
    var pesoKg   = parseFloat(fila[REPEC_COL_PESO - 1]) || 0;
    var oc       = parseInt(fila[REPEC_COL_OC - 1]);
    var prov     = String(fila[REPEC_COL_PROVEEDOR - 1] || "").trim();

    if (tipo !== "REC") continue;
    if (producto !== PRODUCTO_ACEITE) continue;
    if (!fechaRaw || pesoKg < 0) continue;

    var fechaRec = new Date(fechaRaw); fechaRec.setHours(0,0,0,0);
    var fs = formatF(fechaRec);
    var tn = rd(pesoKg / 1000);

    var colDest = matchProveedorAceite(prov);

    if (colDest !== null) {
      if (!recep[fs]) recep[fs] = {};
      recep[fs][colDest] = rd((recep[fs][colDest] || 0) + tn);
      if (!recepDetalle[fs]) recepDetalle[fs] = {};
      if (!recepDetalle[fs][colDest]) recepDetalle[fs][colDest] = { total: 0, lineas: [] };
      recepDetalle[fs][colDest].total = rd(recepDetalle[fs][colDest].total + tn);
      recepDetalle[fs][colDest].lineas.push("OC " + oc + " | " + prov + " | " + tn.toFixed(3) + " Tn");
    } else {
      if (!varios[fs]) varios[fs] = { total: 0, detalle: [] };
      varios[fs].total = rd(varios[fs].total + tn);
      varios[fs].detalle.push("OC " + oc + " | " + prov + " | " + tn.toFixed(3) + " Tn");
      log.push("A-TERCEROS " + fs + " OC " + oc + " | " + prov + " | " + tn.toFixed(3) + " Tn (sin columna propia)");
    }
  }

  var colsEscritas = {};
  var ajuste = {};

  var HOY  = formatF(new Date());
  var ayerD = new Date(); ayerD.setHours(0,0,0,0); ayerD.setDate(ayerD.getDate() - 1);
  var AYER = formatF(ayerD);

  for (var fi = 0; fi < fechasOrden.length; fi++) {
    var fs     = fechasOrden[fi];
    var idx    = idxFecha[fs];
    var fsSig  = (fi < fechasOrden.length - 1) ? fechasOrden[fi + 1] : null;
    var idxSig = fsSig ? idxFecha[fsSig] : null;

    if (fs >= HOY) break;

    if (!colsEscritas[fs]) colsEscritas[fs] = {};

    var esAyer = (fs === AYER);

    for (var ci = 0; ci < colsConOC.length; ci++) {
      var col    = colsConOC[ci];
      var colIdx = col - 1;

      var real      = (recep[fs] && recep[fs][col] !== undefined) ? recep[fs][col] : 0;
      var proyOrgV  = (proyOrig[idx] && proyOrig[idx][col]) ? proyOrig[idx][col] : 0;
      var ajusteAcu = (ajuste[idx] && ajuste[idx][col] !== undefined) ? ajuste[idx][col] : 0;

      if (real === 0 && ajusteAcu !== 0) {
        var proyConAjuste = rd(proyOrgV + ajusteAcu);
        if (proyConAjuste < 0) proyConAjuste = 0;
        if (esAyer) {
          bloqVals[idx][colIdx] = 0;
          colsEscritas[fs][col] = 0;
          if (idxSig !== null && proyConAjuste > 0) {
            if (!ajuste[idxSig]) ajuste[idxSig] = {};
            ajuste[idxSig][col] = rd((ajuste[idxSig][col] || 0) + proyConAjuste);
            log.push("CASCADA-CIERRE " + fs + " " + colLetra(col) + " proy=" + proyConAjuste + " -> " + fsSig);
            cont.cascadas++;
          }
        } else {
          if (idxSig !== null && proyConAjuste > 0) {
            if (!ajuste[idxSig]) ajuste[idxSig] = {};
            ajuste[idxSig][col] = rd((ajuste[idxSig][col] || 0) + proyConAjuste);
          }
        }
      } else if (real > 0) {
        var proyBase   = proyOrgV;
        var diferencia = rd(proyBase - real);
        if (diferencia !== 0 && idxSig !== null) {
          if (!ajuste[idxSig]) ajuste[idxSig] = {};
          ajuste[idxSig][col] = rd((ajuste[idxSig][col] || 0) + diferencia);
          var signo = diferencia > 0 ? "falto" : "excedio";
          log.push("CASCADA " + fs + " " + colLetra(col) + " proy=" + proyBase + " real=" + real + " " + signo + " " + Math.abs(diferencia) + " -> " + fsSig);
          cont.cascadas++;
        }
        bloqVals[idx][colIdx] = real;
        colsEscritas[fs][col] = real;
        log.push("REAL " + fs + " " + colLetra(col) + " = " + real + " Tn");
        cont.escritos++;
      } else {
        if (esAyer && proyOrgV > 0) {
          bloqVals[idx][colIdx] = 0;
          colsEscritas[fs][col] = 0;
          if (idxSig !== null) {
            if (!ajuste[idxSig]) ajuste[idxSig] = {};
            ajuste[idxSig][col] = rd((ajuste[idxSig][col] || 0) + proyOrgV);
            log.push("CASCADA-CIERRE " + fs + " " + colLetra(col) + " proy=" + proyOrgV + " -> " + fsSig);
            cont.cascadas++;
          }
          log.push("CIERRE-AYER " + fs + " " + colLetra(col) + " proy=" + proyOrgV + " -> 0");
          cont.cierres++;
        }
      }
    }

    var colX    = ACEITE_COL_VARIOS;
    var colXIdx = colX - 1;
    var colWIdx = ACEITE_COL_PROG_VARIOS - 1;
    var varDia  = varios[fs] || null;
    var realX   = varDia ? varDia.total : 0;
    var progW   = parseFloat(bloqVals[idx][colWIdx]) || 0;

    if (realX > 0) {
      bloqVals[idx][colXIdx] = realX;
      colsEscritas[fs][colX] = realX;
      var difWX = rd(progW - realX);
      var estadoWX = difWX > 0 ? " (faltaron " + difWX + " Tn)" : difWX < 0 ? " (exceso " + Math.abs(difWX) + " Tn)" : " (OK)";
      log.push("TERCEROS AB " + fs + " = " + realX + " Tn | Prog AA=" + progW + estadoWX);
      cont.escritos++;
    } else if (esAyer) {
      bloqVals[idx][colXIdx] = 0;
      colsEscritas[fs][colX] = 0;
      if (progW > 0) {
        log.push("ALERTA AB " + fs + " prog=" + progW + " Tn NO LLEGO NINGUN CAMION DE TERCEROS");
      } else {
        log.push("CIERRE-AYER AB " + fs + " -> 0");
      }
      cont.cierres++;
    }
  }

  for (var ci = 0; ci < TODAS_COLS_ACEITE.length; ci++) {
    var col    = TODAS_COLS_ACEITE[ci];
    if (esProtegida(col)) continue;
    var colIdx = col - 1;
    var colData = [];
    for (var r = 0; r < totalFilas; r++) colData.push([bloqVals[r][colIdx]]);
    wsOP.getRange(PLAN_FILA_INICIO, col, totalFilas, 1).setValues(colData);
  }

  for (var fs in colsEscritas) {
    var idx = idxFecha[fs];
    if (idx === undefined) continue;
    for (var col in colsEscritas[fs]) {
      col = parseInt(col);
      if (esProtegida(col)) continue;
      wsOP.getRange(PLAN_FILA_INICIO + idx, col)
          .setFontWeight("bold").setFontColor("#000000");
    }
  }

  for (var fs in recepDetalle) {
    var idx = idxFecha[fs];
    if (idx === undefined) continue;
    if (fs > HOY) continue;
    for (var col in recepDetalle[fs]) {
      col = parseInt(col);
      if (esProtegida(col)) continue;
      var det   = recepDetalle[fs][col];
      var proyV = (proyOrig[idx] && proyOrig[idx][col]) ? proyOrig[idx][col] : 0;
      var cellNota = wsOP.getRange(PLAN_FILA_INICIO + idx, col);
      var proyNota = leerProyectadoNota(cellNota);
      var proyMostrar = (proyNota !== null) ? proyNota : proyV;
      var nota  = "Aceite " + colLetra(col) + " — " + fs + "\n"
                + det.lineas.join("\n")
                + "\nTotal: " + det.total.toFixed(3) + " Tn"
                + "\nProyectado: " + proyMostrar + " Tn"
                + "\nDiferencia: " + rd(proyMostrar - det.total) + " Tn";
      try {
        var cell = wsOP.getRange(PLAN_FILA_INICIO + idx, col);
        cell.clearNote();
        cell.setNote(nota);
      } catch(e) { log.push("WARN nota " + colLetra(col) + " " + fs + ": " + e.message); }
    }
  }

  for (var fs in varios) {
    var idx = idxFecha[fs];
    if (idx === undefined) continue;
    if (fs > HOY) continue;
    var varDia  = varios[fs];
    var progW   = parseFloat(bloqVals[idx][ACEITE_COL_PROG_VARIOS - 1]) || 0;
    var difWX   = rd(progW - varDia.total);
    var estadoNota = difWX > 0 ? "FALTARON " + difWX + " Tn" : difWX < 0 ? "EXCESO " + Math.abs(difWX) + " Tn" : "Completo";
    var nota    = "Aceite Terceros — " + fs + "\n"
                + varDia.detalle.join("\n")
                + "\nTotal recibido: " + varDia.total.toFixed(3) + " Tn"
                + "\nProgramado (AA): " + progW + " Tn"
                + "\nDiferencia: " + difWX + " Tn — " + estadoNota;
    try {
      var cell = wsOP.getRange(PLAN_FILA_INICIO + idx, ACEITE_COL_VARIOS);
      cell.clearNote();
      cell.setNote(nota);
    } catch(e) { log.push("WARN nota AB " + fs + ": " + e.message); }
  }

  log.push("");
  log.push("Reales: " + cont.escritos + " | Cascadas: " + cont.cascadas + " | Cierres: " + cont.cierres);
  log.push("=========================================");
  guardarLog(log);
  Logger.log(log.join("\n"));
}

function actualizarSebo() {

  var ahora = new Date();
  var horaAR = ahora.getHours(); if (horaAR < 6) { Logger.log("Fuera de horario AR (" + horaAR + "hs)."); return; }

  var log  = [];
  var cont = { escritos: 0, ajustes: 0 };
  log.push("=== SEBO/HFFA v4 === " + ahora.toLocaleString());
  log.push("");

  var ssRepec;
  try { ssRepec = abrirArchivoXlsx(NOMBRE_REPEC); }
  catch(e) { log.push("ERROR RecepClaude: " + e.message); guardarLog(log); return; }

  var wsRepec    = ssRepec.getSheets()[0];
  var maxColR    = Math.max(REPEC_COL_OC, REPEC_COL_TIPO, REPEC_COL_PRODUCTO,
                            REPEC_COL_PROVEEDOR, REPEC_COL_FECHA, REPEC_COL_PESO);
  var datosRepec = wsRepec.getRange(
    REPEC_FILA_INICIO, 1,
    wsRepec.getLastRow() - REPEC_FILA_INICIO + 1, maxColR
  ).getValues();

  var ssPlan = SpreadsheetApp.getActiveSpreadsheet();
  var wsOP   = ssPlan.getSheetByName(HOJA_OP);
  if (!wsOP) { log.push("ERROR: hoja no encontrada"); guardarLog(log); return; }

  var totalFilas = wsOP.getLastRow() - PLAN_FILA_INICIO + 1;
  var maxColP    = SEBO_MAX_COL;
  var rango      = wsOP.getRange(PLAN_FILA_INICIO, 1, totalFilas, maxColP);

  var fmtPesos   = rango.getFontWeights();
  var fmtColores = rango.getFontColors();
  var bloqVals   = rango.getValues();

  var proyOrig = [];
  for (var r = 0; r < totalFilas; r++) {
    var fila = [];
    for (var c = 0; c < maxColP; c++) {
      var val       = bloqVals[r][c];
      var num       = parseFloat(val);
      var tieneVal  = (!isNaN(num) && num !== 0);
      var esEntero  = (tieneVal && num === Math.floor(num));
      var esNegrita = (fmtPesos[r][c] === "bold");
      fila.push(esEntero && !esNegrita ? num : 0);
    }
    proyOrig.push(fila);
  }

  var bloqFechas  = wsOP.getRange(PLAN_FILA_INICIO, PLAN_COL_FECHA, totalFilas, 1).getValues();
  var idxFecha    = {};
  var fechasOrden = [];
  for (var r = 0; r < bloqFechas.length; r++) {
    var v = bloqFechas[r][0];
    if (v instanceof Date) {
      var d = new Date(v); d.setHours(0,0,0,0);
      var fs = formatF(d);
      idxFecha[fs] = r;
      fechasOrden.push(fs);
    }
  }
  fechasOrden.sort();

  var fila1    = wsOP.getRange(1, 1, 1, SEBO_MAX_COL).getValues()[0];
  var mapaOC   = {};
  var colsSebo = [];
  for (var c = SEBO_RANGO[0]; c <= SEBO_RANGO[1]; c++) {
    colsSebo.push(c);
    if (c === SEBO_COL_VARIOS) continue;
    var val = fila1[c - 1];
    if (val !== null && val !== undefined && val !== "") {
      var ocs = parsearOCs(val);
      for (var oi = 0; oi < ocs.length; oi++) {
        mapaOC[ocs[oi]] = c; log.push("OC " + ocs[oi] + " -> " + colLetra(c));
      }
    }
  }
  log.push("");

  var agrupMapeadas = {};
  var agrupVarios   = {};
  var agrupCT       = {};
  var agrupENT      = {};

  for (var i = 0; i < datosRepec.length; i++) {
    var fila     = datosRepec[i];
    var tipo     = String(fila[REPEC_COL_TIPO - 1]).trim().toUpperCase();
    var producto = String(fila[REPEC_COL_PRODUCTO - 1]).trim();
    var fechaRaw = fila[REPEC_COL_FECHA - 1];
    var pesoKg   = parseFloat(fila[REPEC_COL_PESO - 1]) || 0;
    var oc       = parseInt(fila[REPEC_COL_OC - 1]);
    var prov     = String(fila[REPEC_COL_PROVEEDOR - 1]).trim();

    var esREC = (tipo === "REC");
    var esENT = (tipo === "ENT");
    if (!esREC && !esENT) continue;

    var esAH = SEBO_PRODUCTOS_AH.indexOf(producto) !== -1;
    var esCT = SEBO_PRODUCTOS_CT.indexOf(producto) !== -1;
    if (!esAH && !esCT) continue;
    if (pesoKg < 0 || !fechaRaw) continue;

    var fechaRec = new Date(fechaRaw); fechaRec.setHours(0,0,0,0);
    var fs = formatF(fechaRec);
    var tn = rd(pesoKg / 1000);

    if (esENT) {
      if (producto === "HFFA Animal") {
        if (!agrupENT[fs]) agrupENT[fs] = { total: 0, detalle: [] };
        agrupENT[fs].total = rd(agrupENT[fs].total + tn);
        agrupENT[fs].detalle.push("ENT OV " + oc + " | " + prov + " | " + tn.toFixed(2) + " Tn");
      }
      continue;
    }

    if (esREC && esCT) {
      if (!agrupCT[fs]) agrupCT[fs] = { total: 0, detalle: [] };
      agrupCT[fs].total = rd(agrupCT[fs].total + tn);
      agrupCT[fs].detalle.push("OC " + oc + " | " + prov + " | " + tn.toFixed(2) + " Tn");
      continue;
    }

    if (!esREC) continue;
    var colDest = mapaOC[oc];
    if (colDest !== undefined) {
      if (!agrupMapeadas[fs]) agrupMapeadas[fs] = {};
      if (!agrupMapeadas[fs][colDest]) agrupMapeadas[fs][colDest] = { total: 0, prov: prov };
      agrupMapeadas[fs][colDest].total = rd(agrupMapeadas[fs][colDest].total + tn);
      log.push("MAPEADO " + fs + " OC " + oc + " -> " + colLetra(colDest) + " " + tn + " Tn (" + prov + ")");
    } else {
      if (!agrupVarios[fs]) agrupVarios[fs] = { total: 0, detalle: [] };
      agrupVarios[fs].total = rd(agrupVarios[fs].total + tn);
      agrupVarios[fs].detalle.push("OC " + oc + " | " + prov + " | " + tn.toFixed(2) + " Tn");
    }
  }
  log.push("");

  var colsEscritas = {};

  // --------------------------------------------------------------------------
  // FIX v5.1 -- punto 7/7 (ver encabezado del archivo, CAMBIOS v5.1)
  //   Bloque: HFFA Vegetal ISCC, columna unica HFFA_VEGETAL_COL_VARIOS=98
  //   (CT). Este bloque vive dentro de actualizarSebo() pero NO comparte el
  //   mecanismo que salva a Sebo/HFFA (columnas 34-37) del bug -- ese otro
  //   bloque reescribe el array completo bloqVals en memoria al final de la
  //   funcion (ver mas abajo, wsOP.getRange(...).setValues(colData)), asi que
  //   el proyectado sobrevive sin que nadie lo haya programado a proposito.
  //   HFFA Vegetal ISCC en cambio usa lectura/escritura de celda individual
  //   (cellCTproy mas abajo), asi que SI tenia el problema general (mismo
  //   que Metanol, punto 1/7) Y ADEMAS un problema propio mas grave: la
  //   unica lectura de "proyectado" que existia (cellCTproy.getValue(), mas
  //   abajo en el bloque "for fs in agrupCT") ocurria DESPUES de
  //   limpiarBloque(), asi que nunca llegaba a capturar un valor distinto de
  //   cero -- ni para reponer, ni para calcular la diferencia real-vs-
  //   proyectado en los dias que SI hubo recepcion. Por eso este punto no es
  //   solo "agregar reposicion" como los otros 6: hubo que INVERTIR EL ORDEN,
  //   capturando el proyectado (proyOrigCT) ANTES de limpiarBloque, y despues
  //   usar esa captura tanto para reponer (aca abajo) como para el calculo de
  //   proyCT mas abajo en el bloque de agrupCT (ver ese comentario tambien).
  // --------------------------------------------------------------------------
  var proyOrigCT = {};
  (function() {
    var _idxMin = -1, _idxMax = -1;
    for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
      var _fs = fechasOrden[_fi];
      if (!esPasadaOHoy(_fs)) break;
      var _idx = idxFecha[_fs];
      if (_idx === undefined) continue;
      if (_idxMin === -1) _idxMin = _idx;
      _idxMax = _idx;
    }
    if (_idxMin === -1) return;
    var _nFilas = _idxMax - _idxMin + 1;
    var _rng   = wsOP.getRange(PLAN_FILA_INICIO + _idxMin, HFFA_VEGETAL_COL_VARIOS, _nFilas, 1);
    var _vals  = _rng.getValues();
    var _pesos = _rng.getFontWeights();
    var _cols2 = _rng.getFontColors();
    for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
      var _fs = fechasOrden[_fi];
      if (!esPasadaOHoy(_fs)) break;
      var _idx = idxFecha[_fs];
      if (_idx === undefined) continue;
      var _r   = _idx - _idxMin;
      var _v   = parseFloat(_vals[_r][0]) || 0;
      var _esP = !(_pesos[_r][0] === "bold" && _cols2[_r][0] === "#000000");
      if (_esP && _v !== 0) proyOrigCT[_fs] = _v;
    }
  })();

  limpiarBloque(wsOP, colsSebo, fechasOrden, idxFecha, log);
  limpiarBloque(wsOP, [HFFA_VEGETAL_COL_VARIOS], fechasOrden, idxFecha, log);

  // Reposicion (misma logica que los otros 6 puntos): si no hay real CT hoy
  // para una fecha, reponer lo capturado en proyOrigCT arriba, sin cascada.
  if (!esProtegida(HFFA_VEGETAL_COL_VARIOS)) {
    for (var fs in proyOrigCT) {
      var idx = idxFecha[fs];
      if (idx === undefined) continue;
      var tieneReal = agrupCT[fs] !== undefined;
      if (tieneReal) continue;
      wsOP.getRange(PLAN_FILA_INICIO + idx, HFFA_VEGETAL_COL_VARIOS).setValue(proyOrigCT[fs]);
    }
  }

  for (var fs in agrupMapeadas) {
    var idx = idxFecha[fs];
    if (idx === undefined) { log.push("AVISO MAPEADAS: " + fs + " no en plan"); continue; }
    for (var col in agrupMapeadas[fs]) {
      col = parseInt(col);
      var total    = agrupMapeadas[fs][col].total;
      var colIdx   = col - 1;
      if (!esPasadaOHoy(fs)) continue;
      bloqVals[idx][colIdx] = total;
      if (!colsEscritas[fs]) colsEscritas[fs] = {};
      colsEscritas[fs][col] = total;
      log.push("ESCRITO " + fs + " " + colLetra(col) + " = " + total + " Tn");
      cont.escritos++;
    }
  }

  for (var fs in agrupENT) {
    var idx = idxFecha[fs];
    if (idx === undefined) { log.push("AVISO ENT: " + fs + " no en plan"); continue; }
    if (!esPasadaOHoy(fs)) continue;
    var totalENT   = agrupENT[fs].total;
    var detalleENT = agrupENT[fs].detalle;
    bloqVals[idx][SEBO_COL_DESPACHOS - 1] = totalENT;
    if (!colsEscritas[fs]) colsEscritas[fs] = {};
    colsEscritas[fs][SEBO_COL_DESPACHOS] = totalENT;
    log.push("DESPACHO AI " + fs + " = " + totalENT + " Tn (" + detalleENT.length + " mov)");
    cont.escritos++;
    try {
      var cellAI = wsOP.getRange(PLAN_FILA_INICIO + idx, SEBO_COL_DESPACHOS);
      cellAI.clearNote();
      cellAI.setNote("HFFA Animal Despacho — " + fs + "\n" + detalleENT.join("\n") + "\nTotal: " + totalENT.toFixed(2) + " Tn");
    } catch(e) { log.push("WARN nota AI " + fs + ": " + e.message); }
  }

  var ajustesPendAH = {};
  for (var fs in agrupVarios) {
    var idx    = idxFecha[fs];
    if (idx === undefined) { log.push("AVISO AH: " + fs + " no en plan"); continue; }
    var total    = agrupVarios[fs].total;
    var colIdx   = SEBO_COL_VARIOS - 1;
    if (!esPasadaOHoy(fs)) continue;
    var proyAH   = proyOrig[idx][colIdx];
    bloqVals[idx][colIdx] = total;
    if (!colsEscritas[fs]) colsEscritas[fs] = {};
    colsEscritas[fs][SEBO_COL_VARIOS] = total;
    if (proyAH !== 0) {
      var difAH = rd(proyAH - total);
      if (difAH !== 0) ajustesPendAH[fs] = difAH;
    }
    log.push("ESCRITO AH " + fs + " = " + total + " Tn proy=" + proyAH + " dif=" + rd(proyAH-total));
    cont.escritos++;
    try {
      var cellAH    = wsOP.getRange(PLAN_FILA_INICIO + idx, SEBO_COL_VARIOS);
      var difNotaAH = rd(proyAH - total);
      var proyNotaAH = leerProyectadoNota(cellAH);
      var proyMostrarAH = (proyNotaAH !== null) ? proyNotaAH : proyAH;
      var textoNota = "HFFA Varios — " + fs + "\n"
                    + agrupVarios[fs].detalle.join("\n")
                    + "\nTotal: " + total.toFixed(2) + " Tn"
                    + "\nProyectado: " + proyMostrarAH + " Tn"
                    + "\nDiferencia: " + rd(proyMostrarAH - total) + " Tn";
      cellAH.clearNote(); cellAH.setNote(textoNota);
    } catch(e) { log.push("WARN nota AH " + fs + ": " + e.message); }
  }

  for (var fi = 0; fi < fechasOrden.length; fi++) {
    var fs = fechasOrden[fi];
    if (!ajustesPendAH[fs]) continue;
    var dif    = ajustesPendAH[fs];
    var fsSig  = (fi < fechasOrden.length - 1) ? fechasOrden[fi + 1] : undefined;
    if (!fsSig) continue;
    var idxSig = idxFecha[fsSig];
    if (idxSig === undefined) continue;
    var colIdx  = SEBO_COL_VARIOS - 1;
    var proySig = proyOrig[idxSig][colIdx];
    if (proySig === 0) {
      log.push("CASCADA AH " + fs + " dif=" + dif + " absorbe en " + fsSig + " sin proyectado");
      continue;
    }
    var nuevoSig = rd(proySig + dif);
    if (nuevoSig < 0) nuevoSig = 0;
    bloqVals[idxSig][colIdx] = nuevoSig;
    log.push("CASCADA AH " + fs + " dif=" + dif + " -> " + fsSig + " proy=" + proySig + " nuevo=" + nuevoSig);
    cont.ajustes++;
  }

  var colsEscritasCT = {};
  var ajustesPendCT  = {};
  for (var fs in agrupCT) {
    var idx    = idxFecha[fs];
    if (idx === undefined) { log.push("AVISO CT: " + fs + " no en plan"); continue; }
    var total    = agrupCT[fs].total;
    var colIdx   = HFFA_VEGETAL_COL_VARIOS - 1;
    if (!esPasadaOHoy(fs)) continue;
    // --------------------------------------------------------------------
    // FIX v5.1 -- punto 7/7, segunda mitad (ver comentario completo mas
    // arriba, antes de limpiarBloque, y el encabezado del archivo).
    //   Antes de este fix, acá se releía cellCTproy.getValue() para calcular
    //   la diferencia proyectado-vs-real de este día (para armar la nota y
    //   para cascadear el sobrante mañana). El problema: para llegar a este
    //   punto del código, fs tiene que estar en agrupCT (hay recepción real
    //   hoy), y limpiarBloque() YA vació esta celda más arriba -- así que la
    //   relectura siempre daba 0, y toda diferencia/cascada calculada desde
    //   acá para HFFA Vegetal ISCC era incorrecta (comparaba el real contra
    //   cero en vez de contra el proyectado real). Se reemplaza por la
    //   captura hecha ANTES de limpiar (proyOrigCT), que sí tiene el valor.
    // --------------------------------------------------------------------
    var proyCT = proyOrigCT[fs] || 0;
    if (!colsEscritasCT[fs]) colsEscritasCT[fs] = {};
    colsEscritasCT[fs][HFFA_VEGETAL_COL_VARIOS] = true;
    if (!esProtegida(HFFA_VEGETAL_COL_VARIOS)) {
      wsOP.getRange(PLAN_FILA_INICIO + idx, HFFA_VEGETAL_COL_VARIOS).setValue(total).setFontWeight("bold").setFontColor("#000000");
    }
    if (proyCT !== 0) ajustesPendCT[fs] = rd(proyCT - total);
    log.push("ESCRITO CT " + fs + " = " + total + " Tn proy=" + proyCT + " dif=" + rd(proyCT-total));
    cont.escritos++;
    try {
      var cellCT    = wsOP.getRange(PLAN_FILA_INICIO + idx, HFFA_VEGETAL_COL_VARIOS);
      var proyNotaCT = leerProyectadoNota(cellCT);
      var proyMostrarCT = (proyNotaCT !== null) ? proyNotaCT : proyCT;
      var textoNota = "HFFA Vegetal ISCC — " + fs + "\n"
                    + agrupCT[fs].detalle.join("\n")
                    + "\nTotal: " + total.toFixed(2) + " Tn"
                    + "\nProyectado: " + proyMostrarCT + " Tn"
                    + "\nDiferencia: " + rd(proyMostrarCT - total) + " Tn";
      cellCT.clearNote(); cellCT.setNote(textoNota);
    } catch(e) { log.push("WARN nota CT " + fs + ": " + e.message); }
  }

  for (var fi = 0; fi < fechasOrden.length; fi++) {
    var fs = fechasOrden[fi];
    if (!ajustesPendCT[fs]) continue;
    var dif    = ajustesPendCT[fs];
    var fsSig  = (fi < fechasOrden.length - 1) ? fechasOrden[fi + 1] : undefined;
    if (!fsSig) continue;
    var idxSig = idxFecha[fsSig];
    if (idxSig === undefined) continue;
    var cellSig = wsOP.getRange(PLAN_FILA_INICIO + idxSig, HFFA_VEGETAL_COL_VARIOS);
    var valSig  = parseFloat(cellSig.getValue()) || 0;
    var esPSig  = !(cellSig.getFontWeight() === "bold" && cellSig.getFontColor() === "#000000");
    if (!esPSig || valSig === 0) {
      log.push("CASCADA CT " + fs + " dif=" + dif + " absorbe en " + fsSig);
      continue;
    }
    var nuevoSig = rd(valSig + dif);
    if (nuevoSig < 0) nuevoSig = 0;
    if (!esProtegida(HFFA_VEGETAL_COL_VARIOS)) cellSig.setValue(nuevoSig);
    log.push("CASCADA CT " + fs + " dif=" + dif + " -> " + fsSig + " proy=" + valSig + " nuevo=" + nuevoSig);
    cont.ajustes++;
  }

  log.push(""); log.push("-- Cascada columnas mapeadas --");
  var ajustesPend = {};
  var colsConCascada = [];
  for (var ci = 0; ci < colsSebo.length; ci++) {
    if (colsSebo[ci] !== SEBO_COL_VARIOS) colsConCascada.push(colsSebo[ci]);
  }

  for (var fi = 0; fi < fechasOrden.length; fi++) {
    var fs     = fechasOrden[fi];
    var idxArr = idxFecha[fs];
    if (idxArr === undefined) continue;
    var idxSig = (fi < fechasOrden.length - 1) ? idxFecha[fechasOrden[fi + 1]] : undefined;
    var fsSig  = (fi < fechasOrden.length - 1) ? fechasOrden[fi + 1] : undefined;
    if (idxSig === undefined) continue;

    for (var ci = 0; ci < colsConCascada.length; ci++) {
      var col    = colsConCascada[ci];
      var colIdx = col - 1;
      var tieneEsc        = colsEscritas[fs] !== undefined && colsEscritas[fs][col] !== undefined;
      var ajustePendiente = (ajustesPend[idxArr] && ajustesPend[idxArr][colIdx] !== undefined) ? ajustesPend[idxArr][colIdx] : 0;
      var proyectadoOrig  = proyOrig[idxArr][colIdx];
      if (ajustePendiente === 0 && !tieneEsc) continue;

      if (ajustePendiente !== 0 && !tieneEsc) {
        var proyFila = proyOrig[idxArr][colIdx];
        if (proyFila === 0) {
          if (ajustePendiente > 0) { bloqVals[idxArr][colIdx] = rd(ajustePendiente); log.push("ABSORBE " + fs + " " + colLetra(col) + " sin proy -> " + ajustePendiente + " Tn"); }
          else { log.push("ABSORBE " + fs + " " + colLetra(col) + " exceso absorbido"); }
          cont.ajustes++; continue;
        }
        var nuevoValFila = rd(proyFila + ajustePendiente);
        if (nuevoValFila < 0) nuevoValFila = 0;
        bloqVals[idxArr][colIdx] = nuevoValFila;
        var sobrante;
        if (ajustePendiente > 0) { sobrante = ajustePendiente > proyFila ? rd(ajustePendiente - proyFila) : 0; }
        else { sobrante = nuevoValFila === 0 ? rd(proyFila + ajustePendiente) : 0; }
        log.push("CASCADA " + fs + " " + colLetra(col) + " proy=" + proyFila + " dif=" + ajustePendiente + " -> " + nuevoValFila + " Tn");
        cont.ajustes++;
        if (sobrante !== 0) {
          if (!ajustesPend[idxSig]) ajustesPend[idxSig] = {};
          ajustesPend[idxSig][colIdx] = sobrante;
        }
        continue;
      }

      if (tieneEsc && proyectadoOrig !== 0) {
        var valReal    = parseFloat(bloqVals[idxArr][colIdx]) || 0;
        var diferencia = rd(proyectadoOrig - valReal);
        if (diferencia === 0) continue;
        var valSig   = parseFloat(bloqVals[idxSig][colIdx]) || 0;
        var nuevoSig = rd(valSig + diferencia);
        bloqVals[idxSig][colIdx] = nuevoSig < 0 ? 0 : nuevoSig;
        if (!ajustesPend[idxSig]) ajustesPend[idxSig] = {};
        ajustesPend[idxSig][colIdx] = diferencia;
        var signo = diferencia > 0 ? "falto" : "excedio";
        log.push("DIFERENCIA " + fs + " " + colLetra(col) + " proy=" + proyectadoOrig + " real=" + valReal + " " + signo + " " + Math.abs(diferencia) + " -> " + fsSig + " " + colLetra(col) + "=" + bloqVals[idxSig][colIdx] + " Tn");
        cont.ajustes++;
      }
    }
  }

  for (var ci = 0; ci < colsSebo.length; ci++) {
    var col    = colsSebo[ci];
    if (esProtegida(col)) { log.push("SKIP escritura col " + colLetra(col) + " (protegida)"); continue; }
    var colIdx = col - 1;
    var colData = [];
    for (var r = 0; r < totalFilas; r++) colData.push([bloqVals[r][colIdx]]);
    wsOP.getRange(PLAN_FILA_INICIO, col, totalFilas, 1).setValues(colData);
  }

  for (var fs in colsEscritas) {
    var idx = idxFecha[fs];
    if (idx === undefined) continue;
    for (var col in colsEscritas[fs]) {
      col = parseInt(col);
      if (esProtegida(col)) continue;
      wsOP.getRange(PLAN_FILA_INICIO + idx, parseInt(col)).setFontWeight("bold").setFontColor("#000000");
    }
  }

  cerrarDia(wsOP, fechasOrden, idxFecha, [HFFA_VEGETAL_COL_VARIOS], colsEscritasCT, log, cont);
  cerrarDia(wsOP, fechasOrden, idxFecha, colsSebo, colsEscritas, log, cont);

  log.push(""); log.push("Escritas: " + cont.escritos + " | Ajustes: " + cont.ajustes);
  log.push("=========================================");
  guardarLog(log);
  Logger.log(log.join("\n"));
}

function actualizarMetanol() {

  var ahora = new Date();
  var horaAR = ahora.getHours(); if (horaAR < 6) { Logger.log("Fuera de horario AR (" + horaAR + "hs)."); return; }

  var log  = [];
  var cont = { escritos: 0 };
  log.push("=== METANOL v4 === " + ahora.toLocaleString());
  log.push("");

  var ssRepec;
  try { ssRepec = abrirArchivoXlsx(NOMBRE_REPEC); }
  catch(e) { log.push("ERROR RecepClaude: " + e.message); guardarLog(log); return; }

  var wsRepec    = ssRepec.getSheets()[0];
  var maxColR    = Math.max(REPEC_COL_OC, REPEC_COL_TIPO, REPEC_COL_PRODUCTO,
                            REPEC_COL_PROVEEDOR, REPEC_COL_FECHA, REPEC_COL_PESO);
  var datosRepec = wsRepec.getRange(
    REPEC_FILA_INICIO, 1,
    wsRepec.getLastRow() - REPEC_FILA_INICIO + 1, maxColR
  ).getValues();

  var ssPlan = SpreadsheetApp.getActiveSpreadsheet();
  var wsOP   = ssPlan.getSheetByName(HOJA_OP);
  if (!wsOP) { log.push("ERROR: hoja no encontrada"); guardarLog(log); return; }

  var totalFilas  = wsOP.getLastRow() - PLAN_FILA_INICIO + 1;
  var bloqFechas  = wsOP.getRange(PLAN_FILA_INICIO, PLAN_COL_FECHA, totalFilas, 1).getValues();
  var idxFecha    = {};
  var fechasOrden = [];
  for (var r = 0; r < bloqFechas.length; r++) {
    var v = bloqFechas[r][0];
    if (v instanceof Date) {
      var d = new Date(v); d.setHours(0,0,0,0);
      var fs = formatF(d);
      idxFecha[fs] = r;
      fechasOrden.push(fs);
    }
  }
  fechasOrden.sort();

  var agrup = {};
  for (var i = 0; i < datosRepec.length; i++) {
    var fila     = datosRepec[i];
    var tipo     = String(fila[REPEC_COL_TIPO - 1]).trim().toUpperCase();
    var producto = String(fila[REPEC_COL_PRODUCTO - 1]).trim();
    var fechaRaw = fila[REPEC_COL_FECHA - 1];
    var pesoKg   = parseFloat(fila[REPEC_COL_PESO - 1]) || 0;
    var oc       = parseInt(fila[REPEC_COL_OC - 1]);
    var prov     = String(fila[REPEC_COL_PROVEEDOR - 1]).trim();
    if (tipo !== "REC") continue;
    if (META_PRODUCTOS.indexOf(producto) === -1) continue;
    if (pesoKg < 0 || !fechaRaw) continue;
    var fechaRec = new Date(fechaRaw); fechaRec.setHours(0,0,0,0);
    var fs = formatF(fechaRec);
    var tn = rd(pesoKg / 1000);
    var colDest;
    if (producto === "Metanol Dalgar" || prov.toUpperCase().indexOf("DALGAR") !== -1) {
      colDest = META_COL_DALGAR;
    } else if (prov.toUpperCase().indexOf("YPF") !== -1) {
      colDest = META_COL_YPF;
    } else {
      colDest = META_COL_ARAUCO;
    }
    if (!agrup[fs]) agrup[fs] = {};
    if (!agrup[fs][colDest]) agrup[fs][colDest] = { total: 0, detalle: [] };
    agrup[fs][colDest].total = rd(agrup[fs][colDest].total + tn);
    agrup[fs][colDest].detalle.push("OC " + oc + " | " + prov + " | " + tn.toFixed(2) + " Tn");
  }

  var colsEscritas  = {};
  var ajustesMeta   = {};
  var colsMeta = [META_COL_YPF, META_COL_DALGAR, META_COL_ARAUCO];

  var proyOrigMeta = {};
  (function() {
    var _cols = colsMeta;
    var _idxMin = -1, _idxMax = -1;
    for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
      var _fs = fechasOrden[_fi];
      if (!esPasadaOHoy(_fs)) break;
      var _idx = idxFecha[_fs];
      if (_idx === undefined) continue;
      if (_idxMin === -1) _idxMin = _idx;
      _idxMax = _idx;
    }
    if (_idxMin === -1) return;
    var _nFilas = _idxMax - _idxMin + 1;
    for (var _ci = 0; _ci < _cols.length; _ci++) {
      var _col = _cols[_ci];
      var _rng   = wsOP.getRange(PLAN_FILA_INICIO + _idxMin, _col, _nFilas, 1);
      var _vals  = _rng.getValues();
      var _pesos = _rng.getFontWeights();
      var _cols2 = _rng.getFontColors();
      for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
        var _fs = fechasOrden[_fi];
        if (!esPasadaOHoy(_fs)) break;
        var _idx = idxFecha[_fs];
        if (_idx === undefined) continue;
        var _r   = _idx - _idxMin;
        var _v   = parseFloat(_vals[_r][0]) || 0;
        var _esP = !(_pesos[_r][0] === "bold" && _cols2[_r][0] === "#000000");
        if (_esP && _v !== 0) {
          if (!proyOrigMeta[_fs]) proyOrigMeta[_fs] = {};
          proyOrigMeta[_fs][_col] = _v;
        }
      }
    }
  })();

  limpiarBloque(wsOP, colsMeta, fechasOrden, idxFecha, log);

  // --------------------------------------------------------------------------
  // FIX v5.1 -- punto 1/7 (ver encabezado del archivo, CAMBIOS v5.1)
  //   Bloque: Metanol, columnas META_COL_YPF(76), META_COL_DALGAR(77),
  //   META_COL_ARAUCO(78).
  //   Problema: limpiarBloque() de la linea anterior acaba de vaciar toda
  //   celda no-bold en este rango para fechas pasada-u-hoy, sin distinguir
  //   proyectado vigente de obsoleto (unico criterio disponible: bold/no-bold).
  //   Si no llego ningun real hoy para una fecha/columna, el bloque de mas
  //   abajo ("for fs in agrup") nunca escribe nada ahi, y el proyectado que
  //   el portal cargo (o cualquier proyectado manual) queda vacio.
  //   Fix: reponer tal cual (sin cascada, mismo valor ya capturado en
  //   proyOrigMeta mas arriba) donde no hay real hoy. Riesgo aceptado: un
  //   despacho cancelado justo entre corridas puede quedar "fantasma" -- ver
  //   limitacion documentada en el encabezado del archivo.
  // --------------------------------------------------------------------------
  for (var fs in proyOrigMeta) {
    var idx = idxFecha[fs];
    if (idx === undefined) continue;
    for (var col in proyOrigMeta[fs]) {
      col = parseInt(col);
      if (esProtegida(col)) continue;
      var tieneReal = agrup[fs] && agrup[fs][col] !== undefined;
      if (tieneReal) continue;
      wsOP.getRange(PLAN_FILA_INICIO + idx, col).setValue(proyOrigMeta[fs][col]);
    }
  }

  for (var fs in agrup) {
    var idx = idxFecha[fs];
    if (idx === undefined) { log.push("AVISO: " + fs + " no en plan"); continue; }
    for (var col in agrup[fs]) {
      col = parseInt(col);
      var total    = agrup[fs][col].total;
      var detalle  = agrup[fs][col].detalle;
      var cell     = wsOP.getRange(PLAN_FILA_INICIO + idx, col);
      if (!esPasadaOHoy(fs)) continue;
      var proyMeta = (proyOrigMeta[fs] && proyOrigMeta[fs][col]) ? proyOrigMeta[fs][col] : 0;
      if (!colsEscritas[fs]) colsEscritas[fs] = {};
      colsEscritas[fs][col] = true;
      if (!esProtegida(col)) cell.setValue(total).setFontWeight("bold").setFontColor("#000000");
      if (proyMeta !== 0) {
        var difMeta = rd(proyMeta - total);
        if (difMeta !== 0) {
          if (!ajustesMeta[fs]) ajustesMeta[fs] = {};
          ajustesMeta[fs][col] = difMeta;
        }
      }
      log.push("ESCRITO " + fs + " " + colLetra(col) + " = " + total + " Tn (" + detalle.length + " camiones)");
      cont.escritos++;
      try {
        var etiqueta  = col === META_COL_YPF ? "YPF" : col === META_COL_DALGAR ? "Dalgar" : "Arauco";
        var proyNotaMeta = leerProyectadoNota(cell);
        var proyMostrarMeta = (proyNotaMeta !== null) ? proyNotaMeta : proyMeta;
        var textoNota = "Metanol " + etiqueta + " — " + fs + "\n"
                      + detalle.join("\n")
                      + "\nTotal: " + total.toFixed(2) + " Tn"
                      + "\nProyectado: " + proyMostrarMeta + " Tn"
                      + "\nDiferencia: " + rd(proyMostrarMeta - total) + " Tn";
        cell.clearNote(); cell.setNote(textoNota);
      } catch(e) { log.push("WARN nota " + colLetra(col) + " " + fs + ": " + e.message); }
    }
  }

  for (var fi = 0; fi < fechasOrden.length; fi++) {
    var fs = fechasOrden[fi];
    if (!ajustesMeta[fs]) continue;
    var fsSig  = (fi < fechasOrden.length - 1) ? fechasOrden[fi + 1] : undefined;
    if (!fsSig) continue;
    var idxSig = idxFecha[fsSig];
    if (idxSig === undefined) continue;
    for (var col in ajustesMeta[fs]) {
      col = parseInt(col);
      var dif     = ajustesMeta[fs][col];
      var cellSig = wsOP.getRange(PLAN_FILA_INICIO + idxSig, col);
      var valSig  = parseFloat(cellSig.getValue()) || 0;
      var esPSig  = !(cellSig.getFontWeight() === "bold" && cellSig.getFontColor() === "#000000");
      if (!esPSig || valSig === 0) { log.push("CASCADA META " + fs + " " + colLetra(col) + " absorbe"); continue; }
      var nuevoSig = rd(valSig + dif);
      if (nuevoSig < 0) nuevoSig = 0;
      if (!esProtegida(col)) cellSig.setValue(nuevoSig);
      log.push("CASCADA META " + fs + " " + colLetra(col) + " dif=" + dif + " -> " + fsSig + " nuevo=" + nuevoSig);
    }
  }

  cerrarDia(wsOP, fechasOrden, idxFecha, colsMeta, colsEscritas, log, cont);

  log.push(""); log.push("Escritas: " + cont.escritos);
  log.push("=========================================");
  guardarLog(log);
  Logger.log(log.join("\n"));
}

function actualizarBiodiesel() {

  var ahora = new Date();
  var horaAR = ahora.getHours(); if (horaAR < 6) { Logger.log("Fuera de horario AR (" + horaAR + "hs)."); return; }

  var log  = [];
  var cont = { escritos: 0 };
  log.push("=== BIODIESEL v4 === " + ahora.toLocaleString());
  log.push("");

  var ssRepec;
  try { ssRepec = abrirArchivoXlsx(NOMBRE_REPEC); }
  catch(e) { log.push("ERROR RecepClaude: " + e.message); guardarLog(log); return; }

  var wsRepec    = ssRepec.getSheets()[0];
  var maxColR    = Math.max(REPEC_COL_OC, REPEC_COL_TIPO, REPEC_COL_PRODUCTO,
                            REPEC_COL_PROVEEDOR, REPEC_COL_FECHA, REPEC_COL_PESO);
  var datosRepec = wsRepec.getRange(
    REPEC_FILA_INICIO, 1,
    wsRepec.getLastRow() - REPEC_FILA_INICIO + 1, maxColR
  ).getValues();

  var ssPlan = SpreadsheetApp.getActiveSpreadsheet();
  var wsOP   = ssPlan.getSheetByName(HOJA_OP);
  if (!wsOP) { log.push("ERROR: hoja no encontrada"); guardarLog(log); return; }

  var totalFilas = wsOP.getLastRow() - PLAN_FILA_INICIO + 1;
  var bloqFechas  = wsOP.getRange(PLAN_FILA_INICIO, PLAN_COL_FECHA, totalFilas, 1).getValues();
  var idxFecha    = {};
  var fechasOrden = [];
  for (var r = 0; r < bloqFechas.length; r++) {
    var v = bloqFechas[r][0];
    if (v instanceof Date) {
      var d = new Date(v); d.setHours(0,0,0,0);
      var fs = formatF(d);
      idxFecha[fs] = r;
      fechasOrden.push(fs);
    }
  }
  fechasOrden.sort();

  var fila1BD  = wsOP.getRange(1, 1, 1, BD_COL_YPF).getValues()[0];
  var mapaOVbd = {};
  for (var c = BD_RANGO[0]; c <= BD_RANGO[1]; c++) {
    var val = fila1BD[c - 1];
    if (val !== null && val !== undefined && val !== "") {
      var ovs = parsearOCs(val);
      for (var oi = 0; oi < ovs.length; oi++) {
        mapaOVbd[ovs[oi]] = c; log.push("BD OV " + ovs[oi] + " -> " + colLetra(c));
      }
    }
  }
  log.push("");

  var agrupBD       = {};
  var agrupBDGranel = {};
  var agrupEMAG     = {};

  for (var i = 0; i < datosRepec.length; i++) {
    var fila     = datosRepec[i];
    var tipo     = String(fila[REPEC_COL_TIPO - 1]).trim().toUpperCase();
    var producto = String(fila[REPEC_COL_PRODUCTO - 1]).trim();
    var clasif   = String(fila[11] || "").trim();
    var fechaRaw = fila[REPEC_COL_FECHA - 1];
    var pesoKg   = parseFloat(fila[REPEC_COL_PESO - 1]) || 0;
    var ov       = parseInt(fila[REPEC_COL_OC - 1]);
    var prov     = String(fila[REPEC_COL_PROVEEDOR - 1]).trim();
    if (tipo !== "ENT" && tipo !== "DEV") continue;
    if (clasif !== "Biodiesel") continue;
    if (pesoKg === 0 || !fechaRaw) continue;
    var fechaRec = new Date(fechaRaw); fechaRec.setHours(0,0,0,0);
    var fs = formatF(fechaRec);
    var tn = rd(pesoKg / 1000);
    if (producto !== EMAG_PRODUCTO) {
      var colDest = mapaOVbd[ov];
      if (colDest !== undefined) {
        if (!agrupBD[fs]) agrupBD[fs] = {};
        if (!agrupBD[fs][colDest]) agrupBD[fs][colDest] = { total: 0, detalle: [] };
        agrupBD[fs][colDest].total = rd(agrupBD[fs][colDest].total + tn);
        agrupBD[fs][colDest].detalle.push(tipo + " OV " + ov + " | " + prov + " | " + tn.toFixed(2) + " Tn");
      } else {
        var provUp2  = prov.toUpperCase();
        var colGranel = BD_GRANEL_COL_VARIOS;
        for (var mg = 0; mg < BD_GRANEL_MAPA_PROV.length; mg++) {
          if (provUp2.indexOf(BD_GRANEL_MAPA_PROV[mg].match) !== -1) { colGranel = BD_GRANEL_MAPA_PROV[mg].col; break; }
        }
        if (!agrupBDGranel[fs]) agrupBDGranel[fs] = {};
        if (!agrupBDGranel[fs][colGranel]) agrupBDGranel[fs][colGranel] = { total: 0, detalle: [] };
        agrupBDGranel[fs][colGranel].total = rd(agrupBDGranel[fs][colGranel].total + tn);
        agrupBDGranel[fs][colGranel].detalle.push(tipo + " OV " + ov + " | " + prov + " | " + tn.toFixed(2) + " Tn");
      }
    } else if (producto === EMAG_PRODUCTO) {
      var provUp  = prov.toUpperCase();
      var colEMAG = EMAG_COL_VARIOS;
      for (var m = 0; m < EMAG_MAPA_PROV.length; m++) {
        if (provUp.indexOf(EMAG_MAPA_PROV[m].match) !== -1) { colEMAG = EMAG_MAPA_PROV[m].col; break; }
      }
      if (!agrupEMAG[fs]) agrupEMAG[fs] = {};
      if (!agrupEMAG[fs][colEMAG]) agrupEMAG[fs][colEMAG] = { total: 0, detalle: [] };
      agrupEMAG[fs][colEMAG].total = rd(agrupEMAG[fs][colEMAG].total + tn);
      agrupEMAG[fs][colEMAG].detalle.push("OV " + ov + " | " + prov + " | " + tn.toFixed(2) + " Tn");
    }
  }

  var colsEscritasBD = {};
  var colsBDlimpiar = [];
  for (var ovk in mapaOVbd) colsBDlimpiar.push(mapaOVbd[ovk]);

  var proyOrigBD = {};
  (function() {
    var _cols = colsBDlimpiar;
    var _idxMin = -1, _idxMax = -1;
    for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
      var _fs = fechasOrden[_fi];
      if (!esPasadaOHoy(_fs)) break;
      var _idx = idxFecha[_fs];
      if (_idx === undefined) continue;
      if (_idxMin === -1) _idxMin = _idx;
      _idxMax = _idx;
    }
    if (_idxMin === -1) return;
    var _nFilas = _idxMax - _idxMin + 1;
    for (var _ci = 0; _ci < _cols.length; _ci++) {
      var _col = _cols[_ci];
      var _rng   = wsOP.getRange(PLAN_FILA_INICIO + _idxMin, _col, _nFilas, 1);
      var _vals  = _rng.getValues();
      var _pesos = _rng.getFontWeights();
      var _cols2 = _rng.getFontColors();
      for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
        var _fs = fechasOrden[_fi];
        if (!esPasadaOHoy(_fs)) break;
        var _idx = idxFecha[_fs];
        if (_idx === undefined) continue;
        var _r   = _idx - _idxMin;
        var _v   = parseFloat(_vals[_r][0]) || 0;
        var _esP = !(_pesos[_r][0] === "bold" && _cols2[_r][0] === "#000000");
        if (_esP && _v !== 0) {
          if (!proyOrigBD[_fs]) proyOrigBD[_fs] = {};
          proyOrigBD[_fs][_col] = _v;
        }
      }
    }
  })();

  limpiarBloque(wsOP, colsBDlimpiar, fechasOrden, idxFecha, log);

  // --------------------------------------------------------------------------
  // FIX v5.1 -- punto 2/7 (ver encabezado del archivo, CAMBIOS v5.1)
  //   Bloque: Biodiesel AU/AW, columnas BD_COL_PAE(47), BD_COL_YPF(49).
  //   Mismo problema y mismo fix que el punto 1/7 (Metanol): limpiarBloque()
  //   acaba de vaciar toda celda no-bold en este rango; si no llego ningun
  //   real hoy, se repone lo capturado en proyOrigBD sin pasar por cascada.
  //   Riesgo aceptado documentado en el encabezado (despacho cancelado entre
  //   corridas puede quedar "fantasma").
  // --------------------------------------------------------------------------
  for (var fs in proyOrigBD) {
    var idx = idxFecha[fs];
    if (idx === undefined) continue;
    for (var col in proyOrigBD[fs]) {
      col = parseInt(col);
      if (esProtegida(col)) continue;
      var tieneReal = agrupBD[fs] && agrupBD[fs][col] !== undefined;
      if (tieneReal) continue;
      wsOP.getRange(PLAN_FILA_INICIO + idx, col).setValue(proyOrigBD[fs][col]);
    }
  }

  log.push("-- Biodiesel AU/AW --");
  for (var fs in agrupBD) {
    var idx = idxFecha[fs];
    if (idx === undefined) { log.push("AVISO BD: " + fs + " no en plan"); continue; }
    for (var col in agrupBD[fs]) {
      col = parseInt(col);
      var total    = agrupBD[fs][col].total;
      var detalle  = agrupBD[fs][col].detalle;
      var cell     = wsOP.getRange(PLAN_FILA_INICIO + idx, col);
      if (!esPasadaOHoy(fs)) continue;
      var proyBD = (proyOrigBD[fs] && proyOrigBD[fs][col]) ? proyOrigBD[fs][col] : 0;
      if (!colsEscritasBD[fs]) colsEscritasBD[fs] = {};
      colsEscritasBD[fs][col] = true;
      if (!esProtegida(col)) cell.setValue(total).setFontWeight("bold").setFontColor("#000000");
      log.push("ESCRITO BD " + fs + " " + colLetra(col) + " = " + total + " Tn");
      cont.escritos++;
      try {
        var etiq = col === BD_COL_PAE ? "PAE" : "YPF";
        var proyNotaBD = leerProyectadoNota(cell);
        var proyMostrarBD = (proyNotaBD !== null) ? proyNotaBD : proyBD;
        var nota = "Biodiesel " + etiq + " - " + fs + "\n" + detalle.join("\n")
                 + "\nTotal: " + total.toFixed(2) + " Tn"
                 + "\nProyectado: " + proyMostrarBD + " Tn"
                 + "\nDiferencia: " + rd(proyMostrarBD - total) + " Tn";
        cell.clearNote(); cell.setNote(nota);
      } catch(e) { log.push("WARN nota BD " + fs + ": " + e.message); }
    }
  }

  var colsEscritasBDG = {};
  var colsBDGlimpiar = [];
  for (var c = BD_GRANEL_RANGO[0]; c <= BD_GRANEL_RANGO[1]; c++) colsBDGlimpiar.push(c);

  var proyOrigBDG = {};
  (function() {
    var _cols = colsBDGlimpiar;
    var _idxMin = -1, _idxMax = -1;
    for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
      var _fs = fechasOrden[_fi];
      if (!esPasadaOHoy(_fs)) break;
      var _idx = idxFecha[_fs];
      if (_idx === undefined) continue;
      if (_idxMin === -1) _idxMin = _idx;
      _idxMax = _idx;
    }
    if (_idxMin === -1) return;
    var _nFilas = _idxMax - _idxMin + 1;
    for (var _ci = 0; _ci < _cols.length; _ci++) {
      var _col = _cols[_ci];
      var _rng   = wsOP.getRange(PLAN_FILA_INICIO + _idxMin, _col, _nFilas, 1);
      var _vals  = _rng.getValues();
      var _pesos = _rng.getFontWeights();
      var _cols2 = _rng.getFontColors();
      for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
        var _fs = fechasOrden[_fi];
        if (!esPasadaOHoy(_fs)) break;
        var _idx = idxFecha[_fs];
        if (_idx === undefined) continue;
        var _r   = _idx - _idxMin;
        var _v   = parseFloat(_vals[_r][0]) || 0;
        var _esP = !(_pesos[_r][0] === "bold" && _cols2[_r][0] === "#000000");
        if (_esP && _v !== 0) {
          if (!proyOrigBDG[_fs]) proyOrigBDG[_fs] = {};
          proyOrigBDG[_fs][_col] = _v;
        }
      }
    }
  })();

  limpiarBloque(wsOP, colsBDGlimpiar, fechasOrden, idxFecha, log);

  // --------------------------------------------------------------------------
  // FIX v5.1 -- punto 3/7 (ver encabezado del archivo, CAMBIOS v5.1)
  //   Bloque: Biodiesel Granel/Otros, columnas 70 (Exolgan), 71 (Andreani),
  //   BD_GRANEL_COL_VARIOS=72 (Terceros/Otros, fallback de resolverColumna()
  //   en el portal cuando el cliente no matchea ningun proveedor mapeado).
  //   ESTE ES EL BLOQUE DONDE SE CONFIRMO EL BUG CON UN CASO REAL:
  //   despacho id aAhIBHb5dLa05trwf6tB, pedido PED-2026-000008 (OV-2846),
  //   cliente "DF ENTERTAINMENT BA S.A.U." (no matchea Exolgan/Andreani),
  //   Biodiesel IBC, 2 tn, fecha_carga 2026-09-09. El portal nomino y escribio
  //   en columna 72 (fuente normal, sin bold); limpiarBloque() la vacio en la
  //   corrida horaria siguiente porque no habia llegado ningun camion real
  //   ese dia en Recepclaude.xlsx. Mismo mecanismo y mismo fix que el punto
  //   1/7 (Metanol): reponer lo capturado en proyOrigBDG sin pasar por
  //   cascada, solo donde no hay real hoy.
  // --------------------------------------------------------------------------
  for (var fs in proyOrigBDG) {
    var idx = idxFecha[fs];
    if (idx === undefined) continue;
    for (var col in proyOrigBDG[fs]) {
      col = parseInt(col);
      if (esProtegida(col)) continue;
      var tieneReal = agrupBDGranel[fs] && agrupBDGranel[fs][col] !== undefined;
      if (tieneReal) continue;
      wsOP.getRange(PLAN_FILA_INICIO + idx, col).setValue(proyOrigBDG[fs][col]);
    }
  }

  log.push(""); log.push("-- Biodiesel Granel BR:BT --");
  for (var fs in agrupBDGranel) {
    var idx = idxFecha[fs];
    if (idx === undefined) { log.push("AVISO BDG: " + fs + " no en plan"); continue; }
    for (var col in agrupBDGranel[fs]) {
      col = parseInt(col);
      var total   = agrupBDGranel[fs][col].total;
      var detalle = agrupBDGranel[fs][col].detalle;
      var cell    = wsOP.getRange(PLAN_FILA_INICIO + idx, col);
      if (!esPasadaOHoy(fs)) continue;
      var proyBDG = (proyOrigBDG[fs] && proyOrigBDG[fs][col]) ? proyOrigBDG[fs][col] : 0;
      if (!colsEscritasBDG[fs]) colsEscritasBDG[fs] = {};
      colsEscritasBDG[fs][col] = true;
      if (!esProtegida(col)) cell.setValue(total).setFontWeight("bold").setFontColor("#000000");
      log.push("ESCRITO BDG " + fs + " " + colLetra(col) + " = " + total + " Tn");
      cont.escritos++;
      try {
        var etiqBDG = wsOP.getRange(5, col).getValue() || colLetra(col);
        var proyNotaBDG = leerProyectadoNota(cell);
        var proyMostrarBDG = (proyNotaBDG !== null) ? proyNotaBDG : proyBDG;
        var notaBDG = "Biodiesel Granel " + etiqBDG + " - " + fs + "\n" + detalle.join("\n")
                    + "\nTotal: " + total.toFixed(2) + " Tn"
                    + "\nProyectado: " + proyMostrarBDG + " Tn"
                    + "\nDiferencia: " + rd(proyMostrarBDG - total) + " Tn";
        cell.clearNote(); cell.setNote(notaBDG);
      } catch(e) { log.push("WARN nota BDG " + fs + ": " + e.message); }
    }
  }

  cerrarDia(wsOP, fechasOrden, idxFecha, colsBDGlimpiar, colsEscritasBDG, log, cont);

  var colsEscritasEMAG = {};
  var colsEMAGlimpiar = [];
  for (var c = EMAG_RANGO[0]; c <= EMAG_RANGO[1]; c++) colsEMAGlimpiar.push(c);

  var proyOrigEMAG = {};
  (function() {
    var _cols = colsEMAGlimpiar;
    var _idxMin = -1, _idxMax = -1;
    for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
      var _fs = fechasOrden[_fi];
      if (!esPasadaOHoy(_fs)) break;
      var _idx = idxFecha[_fs];
      if (_idx === undefined) continue;
      if (_idxMin === -1) _idxMin = _idx;
      _idxMax = _idx;
    }
    if (_idxMin === -1) return;
    var _nFilas = _idxMax - _idxMin + 1;
    for (var _ci = 0; _ci < _cols.length; _ci++) {
      var _col = _cols[_ci];
      var _rng   = wsOP.getRange(PLAN_FILA_INICIO + _idxMin, _col, _nFilas, 1);
      var _vals  = _rng.getValues();
      var _pesos = _rng.getFontWeights();
      var _cols2 = _rng.getFontColors();
      for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
        var _fs = fechasOrden[_fi];
        if (!esPasadaOHoy(_fs)) break;
        var _idx = idxFecha[_fs];
        if (_idx === undefined) continue;
        var _r   = _idx - _idxMin;
        var _v   = parseFloat(_vals[_r][0]) || 0;
        var _esP = !(_pesos[_r][0] === "bold" && _cols2[_r][0] === "#000000");
        if (_esP && _v !== 0) {
          if (!proyOrigEMAG[_fs]) proyOrigEMAG[_fs] = {};
          proyOrigEMAG[_fs][_col] = _v;
        }
      }
    }
  })();

  limpiarBloque(wsOP, colsEMAGlimpiar, fechasOrden, idxFecha, log);

  // --------------------------------------------------------------------------
  // FIX v5.1 -- punto 4/7 (ver encabezado del archivo, CAMBIOS v5.1)
  //   Bloque: EMAG, columnas EMAG_RANGO 58-66 (BF-BN, incluye EMAG_COL_VARIOS
  //   =66 "Otros"). Mismo mecanismo y mismo fix que el punto 1/7 (Metanol):
  //   reponer lo capturado en proyOrigEMAG sin pasar por cascada, solo donde
  //   no hay real hoy.
  // --------------------------------------------------------------------------
  for (var fs in proyOrigEMAG) {
    var idx = idxFecha[fs];
    if (idx === undefined) continue;
    for (var col in proyOrigEMAG[fs]) {
      col = parseInt(col);
      if (esProtegida(col)) continue;
      var tieneReal = agrupEMAG[fs] && agrupEMAG[fs][col] !== undefined;
      if (tieneReal) continue;
      wsOP.getRange(PLAN_FILA_INICIO + idx, col).setValue(proyOrigEMAG[fs][col]);
    }
  }

  log.push(""); log.push("-- EMAG BF:BN --");
  for (var fs in agrupEMAG) {
    var idx = idxFecha[fs];
    if (idx === undefined) { log.push("AVISO EMAG: " + fs + " no en plan"); continue; }
    for (var col in agrupEMAG[fs]) {
      col = parseInt(col);
      var total    = agrupEMAG[fs][col].total;
      var detalle  = agrupEMAG[fs][col].detalle;
      var cell     = wsOP.getRange(PLAN_FILA_INICIO + idx, col);
      if (!esPasadaOHoy(fs)) continue;
      var proyEMAG = (proyOrigEMAG[fs] && proyOrigEMAG[fs][col]) ? proyOrigEMAG[fs][col] : 0;
      if (!colsEscritasEMAG[fs]) colsEscritasEMAG[fs] = {};
      colsEscritasEMAG[fs][col] = true;
      if (!esProtegida(col)) cell.setValue(total).setFontWeight("bold").setFontColor("#000000");
      log.push("ESCRITO EMAG " + fs + " " + colLetra(col) + " = " + total + " Tn");
      cont.escritos++;
      try {
        var esVarios = (col === EMAG_COL_VARIOS);
        var etiqEMAG = esVarios ? "Otros" : wsOP.getRange(5, col).getValue();
        var proyNotaEMAG = leerProyectadoNota(cell);
        var proyMostrarEMAG = (proyNotaEMAG !== null) ? proyNotaEMAG : proyEMAG;
        var nota = "EMAG " + etiqEMAG + " - " + fs + "\n" + detalle.join("\n")
                 + "\nTotal: " + total.toFixed(2) + " Tn"
                 + "\nProyectado: " + proyMostrarEMAG + " Tn"
                 + "\nDiferencia: " + rd(proyMostrarEMAG - total) + " Tn";
        cell.clearNote(); cell.setNote(nota);
      } catch(e) { log.push("WARN nota EMAG " + fs + ": " + e.message); }
    }
  }

  var colsEMAG = [];
  for (var c = EMAG_RANGO[0]; c <= EMAG_RANGO[1]; c++) colsEMAG.push(c);
  cerrarDia(wsOP, fechasOrden, idxFecha, colsEMAG, colsEscritasEMAG, log, cont);

  var colsBD = [];
  for (var ovk in mapaOVbd) colsBD.push(mapaOVbd[ovk]);
  cerrarDia(wsOP, fechasOrden, idxFecha, colsBD, colsEscritasBD, log, cont, true);

  log.push(""); log.push("Escritas: " + cont.escritos);
  log.push("=========================================");
  guardarLog(log);
  Logger.log(log.join("\n"));
}

function actualizarGlicerina() {
  var ahora = new Date();
  var horaAR = ahora.getHours(); if (horaAR < 6) { Logger.log("Fuera de horario AR (" + horaAR + "hs)."); return; }

  var log  = [];
  var cont = { escritos: 0 };
  log.push("=== GLICERINA v4 === " + ahora.toLocaleString());

  var ssRepec;
  try { ssRepec = abrirArchivoXlsx(NOMBRE_REPEC); }
  catch(e) { log.push("ERROR RecepClaude: " + e.message); guardarLog(log); return; }

  var wsRepec    = ssRepec.getSheets()[0];
  var maxColR    = Math.max(REPEC_COL_OC, REPEC_COL_TIPO, REPEC_COL_PRODUCTO,
                            REPEC_COL_PROVEEDOR, REPEC_COL_FECHA, REPEC_COL_PESO);
  var datosRepec = wsRepec.getRange(REPEC_FILA_INICIO, 1,
    wsRepec.getLastRow() - REPEC_FILA_INICIO + 1, maxColR).getValues();

  var ssPlan = SpreadsheetApp.getActiveSpreadsheet();
  var wsOP   = ssPlan.getSheetByName(HOJA_OP);
  if (!wsOP) { log.push("ERROR: hoja no encontrada"); guardarLog(log); return; }

  var totalFilas = wsOP.getLastRow() - PLAN_FILA_INICIO + 1;
  var bloqFechas  = wsOP.getRange(PLAN_FILA_INICIO, PLAN_COL_FECHA, totalFilas, 1).getValues();
  var idxFecha    = {};
  var fechasOrden = [];
  for (var r = 0; r < bloqFechas.length; r++) {
    var v = bloqFechas[r][0];
    if (v instanceof Date) {
      var d = new Date(v); d.setHours(0,0,0,0);
      var fs = formatF(d);
      idxFecha[fs] = r;
      fechasOrden.push(fs);
    }
  }
  fechasOrden.sort();

  var agrup = {};
  for (var i = 0; i < datosRepec.length; i++) {
    var fila     = datosRepec[i];
    var tipo     = String(fila[REPEC_COL_TIPO - 1]).trim().toUpperCase();
    var producto = String(fila[REPEC_COL_PRODUCTO - 1]).trim();
    var fechaRaw = fila[REPEC_COL_FECHA - 1];
    var pesoKg   = parseFloat(fila[REPEC_COL_PESO - 1]) || 0;
    var ov       = parseInt(fila[REPEC_COL_OC - 1]);
    var prov     = String(fila[REPEC_COL_PROVEEDOR - 1]).trim();
    if (tipo !== "ENT" && tipo !== "DEV") continue;
    if (GL_PRODUCTOS.indexOf(producto) === -1) continue;
    if (pesoKg === 0 || !fechaRaw) continue;
    var fechaRec = new Date(fechaRaw); fechaRec.setHours(0,0,0,0);
    var fs = formatF(fechaRec);
    var tn = rd(pesoKg / 1000);
    var provUp = prov.toUpperCase();
    var colDest = GL_COL_VARIOS;
    for (var m = 0; m < GL_MAPA_PROV.length; m++) {
      if (provUp.indexOf(GL_MAPA_PROV[m].match) !== -1) { colDest = GL_MAPA_PROV[m].col; break; }
    }
    if (!agrup[fs]) agrup[fs] = {};
    if (!agrup[fs][colDest]) agrup[fs][colDest] = { total: 0, detalle: [] };
    agrup[fs][colDest].total = rd(agrup[fs][colDest].total + tn);
    agrup[fs][colDest].detalle.push(tipo + " OV " + ov + " | " + prov + " | " + tn.toFixed(2) + " Tn");
  }

  var colsGL = [];
  for (var c = GL_RANGO[0]; c <= GL_RANGO[1]; c++) colsGL.push(c);

  var colsEscritas = {};
  var proyOrigGL = {};
  (function() {
    var _cols = colsGL;
    var _idxMin = -1, _idxMax = -1;
    for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
      var _fs = fechasOrden[_fi];
      if (!esPasadaOHoy(_fs)) break;
      var _idx = idxFecha[_fs];
      if (_idx === undefined) continue;
      if (_idxMin === -1) _idxMin = _idx;
      _idxMax = _idx;
    }
    if (_idxMin === -1) return;
    var _nFilas = _idxMax - _idxMin + 1;
    for (var _ci = 0; _ci < _cols.length; _ci++) {
      var _col = _cols[_ci];
      var _rng   = wsOP.getRange(PLAN_FILA_INICIO + _idxMin, _col, _nFilas, 1);
      var _vals  = _rng.getValues();
      var _pesos = _rng.getFontWeights();
      var _cols2 = _rng.getFontColors();
      for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
        var _fs = fechasOrden[_fi];
        if (!esPasadaOHoy(_fs)) break;
        var _idx = idxFecha[_fs];
        if (_idx === undefined) continue;
        var _r   = _idx - _idxMin;
        var _v   = parseFloat(_vals[_r][0]) || 0;
        var _esP = !(_pesos[_r][0] === "bold" && _cols2[_r][0] === "#000000");
        if (_esP && _v !== 0) {
          if (!proyOrigGL[_fs]) proyOrigGL[_fs] = {};
          proyOrigGL[_fs][_col] = _v;
        }
      }
    }
  })();

  limpiarBloque(wsOP, colsGL, fechasOrden, idxFecha, log);

  // --------------------------------------------------------------------------
  // FIX v5.1 -- punto 5/7 (ver encabezado del archivo, CAMBIOS v5.1)
  //   Bloque: Glicerina, columnas GL_RANGO 85-92 (CG-CN, incluye
  //   GL_COL_VARIOS=92 "Otros"). Mismo mecanismo y mismo fix que el punto
  //   1/7 (Metanol): reponer lo capturado en proyOrigGL sin pasar por
  //   cascada, solo donde no hay real hoy.
  // --------------------------------------------------------------------------
  for (var fs in proyOrigGL) {
    var idx = idxFecha[fs];
    if (idx === undefined) continue;
    for (var col in proyOrigGL[fs]) {
      col = parseInt(col);
      if (esProtegida(col)) continue;
      var tieneReal = agrup[fs] && agrup[fs][col] !== undefined;
      if (tieneReal) continue;
      wsOP.getRange(PLAN_FILA_INICIO + idx, col).setValue(proyOrigGL[fs][col]);
    }
  }

  for (var fs in agrup) {
    var idx = idxFecha[fs];
    if (idx === undefined) { log.push("AVISO GL: " + fs + " no en plan"); continue; }
    for (var col in agrup[fs]) {
      col = parseInt(col);
      var total   = agrup[fs][col].total;
      var detalle = agrup[fs][col].detalle;
      var cell    = wsOP.getRange(PLAN_FILA_INICIO + idx, col);
      if (!esPasadaOHoy(fs)) continue;
      var proyGL = (proyOrigGL[fs] && proyOrigGL[fs][col]) ? proyOrigGL[fs][col] : 0;
      if (!colsEscritas[fs]) colsEscritas[fs] = {};
      colsEscritas[fs][col] = true;
      if (!esProtegida(col)) cell.setValue(total).setFontWeight("bold").setFontColor("#000000");
      log.push("ESCRITO GL " + fs + " " + colLetra(col) + " = " + total + " Tn");
      cont.escritos++;
      try {
        var esVar = (col === GL_COL_VARIOS);
        var etiq  = esVar ? "Otros" : wsOP.getRange(5, col).getValue();
        var proyNotaGL = leerProyectadoNota(cell);
        var proyMostrarGL = (proyNotaGL !== null) ? proyNotaGL : proyGL;
        var nota = "Glicerina " + etiq + " - " + fs + "\n" + detalle.join("\n")
                 + "\nTotal: " + total.toFixed(2) + " Tn"
                 + "\nProyectado: " + proyMostrarGL + " Tn"
                 + "\nDiferencia: " + rd(proyMostrarGL - total) + " Tn";
        cell.clearNote(); cell.setNote(nota);
      } catch(e) { log.push("WARN nota GL " + fs + ": " + e.message); }
    }
  }

  cerrarDia(wsOP, fechasOrden, idxFecha, colsGL, colsEscritas, log, cont);

  log.push("Escritas: " + cont.escritos);
  guardarLog(log);
  Logger.log(log.join("\n"));
}

function actualizarARE() {
  var ahora = new Date();
  var horaAR = ahora.getHours(); if (horaAR < 6) { Logger.log("Fuera de horario AR (" + horaAR + "hs)."); return; }

  var log  = [];
  var cont = { escritos: 0 };
  log.push("=== ARE v4 === " + ahora.toLocaleString());

  var ssRepec;
  try { ssRepec = abrirArchivoXlsx(NOMBRE_REPEC); }
  catch(e) { log.push("ERROR RecepClaude: " + e.message); guardarLog(log); return; }

  var wsRepec    = ssRepec.getSheets()[0];
  var maxColR    = Math.max(REPEC_COL_OC, REPEC_COL_TIPO, REPEC_COL_PRODUCTO,
                            REPEC_COL_PROVEEDOR, REPEC_COL_FECHA, REPEC_COL_PESO);
  var datosRepec = wsRepec.getRange(REPEC_FILA_INICIO, 1,
    wsRepec.getLastRow() - REPEC_FILA_INICIO + 1, maxColR).getValues();

  var ssPlan = SpreadsheetApp.getActiveSpreadsheet();
  var wsOP   = ssPlan.getSheetByName(HOJA_OP);
  if (!wsOP) { log.push("ERROR: hoja no encontrada"); guardarLog(log); return; }

  var totalFilas = wsOP.getLastRow() - PLAN_FILA_INICIO + 1;
  var bloqFechas  = wsOP.getRange(PLAN_FILA_INICIO, PLAN_COL_FECHA, totalFilas, 1).getValues();
  var idxFecha    = {};
  var fechasOrden = [];
  for (var r = 0; r < bloqFechas.length; r++) {
    var v = bloqFechas[r][0];
    if (v instanceof Date) {
      var d = new Date(v); d.setHours(0,0,0,0);
      var fs = formatF(d);
      idxFecha[fs] = r;
      fechasOrden.push(fs);
    }
  }
  fechasOrden.sort();

  var agrup = {};
  for (var i = 0; i < datosRepec.length; i++) {
    var fila     = datosRepec[i];
    var tipo     = String(fila[REPEC_COL_TIPO - 1]).trim().toUpperCase();
    var producto = String(fila[REPEC_COL_PRODUCTO - 1]).trim();
    var fechaRaw = fila[REPEC_COL_FECHA - 1];
    var pesoKg   = parseFloat(fila[REPEC_COL_PESO - 1]) || 0;
    var ov       = parseInt(fila[REPEC_COL_OC - 1]);
    var prov     = String(fila[REPEC_COL_PROVEEDOR - 1]).trim();
    if (tipo !== "ENT" && tipo !== "DEV") continue;
    if (ARE_PRODUCTOS.indexOf(producto) === -1) continue;
    if (pesoKg === 0 || !fechaRaw) continue;
    var fechaRec = new Date(fechaRaw); fechaRec.setHours(0,0,0,0);
    var fs = formatF(fechaRec);
    var tn = rd(pesoKg / 1000);
    if (!agrup[fs]) agrup[fs] = { total: 0, detalle: [] };
    agrup[fs].total = rd(agrup[fs].total + tn);
    agrup[fs].detalle.push(tipo + " OV " + ov + " | " + producto + " | " + prov + " | " + tn.toFixed(2) + " Tn");
  }

  var colsEscritas = {};
  var proyOrigARE = {};
  (function() {
    var _idxMin = -1, _idxMax = -1;
    for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
      var _fs = fechasOrden[_fi];
      if (!esPasadaOHoy(_fs)) break;
      var _idx = idxFecha[_fs];
      if (_idx === undefined) continue;
      if (_idxMin === -1) _idxMin = _idx;
      _idxMax = _idx;
    }
    if (_idxMin === -1) return;
    var _nFilas = _idxMax - _idxMin + 1;
    var _rng   = wsOP.getRange(PLAN_FILA_INICIO + _idxMin, ARE_COL, _nFilas, 1);
    var _vals  = _rng.getValues();
    var _pesos = _rng.getFontWeights();
    var _cols2 = _rng.getFontColors();
    for (var _fi = 0; _fi < fechasOrden.length; _fi++) {
      var _fs = fechasOrden[_fi];
      if (!esPasadaOHoy(_fs)) break;
      var _idx = idxFecha[_fs];
      if (_idx === undefined) continue;
      var _r   = _idx - _idxMin;
      var _v   = parseFloat(_vals[_r][0]) || 0;
      var _esP = !(_pesos[_r][0] === "bold" && _cols2[_r][0] === "#000000");
      if (_esP && _v !== 0) proyOrigARE[_fs] = _v;
    }
  })();

  limpiarBloque(wsOP, [ARE_COL], fechasOrden, idxFecha, log);

  // --------------------------------------------------------------------------
  // FIX v5.1 -- punto 6/7 (ver encabezado del archivo, CAMBIOS v5.1)
  //   Bloque: ARE, columna unica ARE_COL=103 (CY). Mismo mecanismo que el
  //   punto 1/7 (Metanol), pero ARE es una sola columna: proyOrigARE es
  //   {fecha: valor}, no {fecha: {columna: valor}} como en los demas bloques.
  //   Reponer lo capturado sin pasar por cascada, solo donde no hay real hoy.
  // --------------------------------------------------------------------------
  if (!esProtegida(ARE_COL)) {
    for (var fs in proyOrigARE) {
      var idx = idxFecha[fs];
      if (idx === undefined) continue;
      var tieneReal = agrup[fs] !== undefined;
      if (tieneReal) continue;
      wsOP.getRange(PLAN_FILA_INICIO + idx, ARE_COL).setValue(proyOrigARE[fs]);
    }
  }

  for (var fs in agrup) {
    var idx = idxFecha[fs];
    if (idx === undefined) { log.push("AVISO ARE: " + fs + " no en plan"); continue; }
    if (!esPasadaOHoy(fs)) continue;
    var total   = agrup[fs].total;
    var detalle = agrup[fs].detalle;
    var cell    = wsOP.getRange(PLAN_FILA_INICIO + idx, ARE_COL);
    var proyARE = proyOrigARE[fs] || 0;
    if (!colsEscritas[fs]) colsEscritas[fs] = {};
    colsEscritas[fs][ARE_COL] = true;
    if (!esProtegida(ARE_COL)) cell.setValue(total).setFontWeight("bold").setFontColor("#000000");
    log.push("ESCRITO ARE " + fs + " = " + total + " Tn");
    cont.escritos++;
    try {
      var proyNotaARE = leerProyectadoNota(cell);
      var proyMostrarARE = (proyNotaARE !== null) ? proyNotaARE : proyARE;
      var nota = "ARE - " + fs + "\n" + detalle.join("\n")
               + "\nTotal: " + total.toFixed(2) + " Tn"
               + "\nProyectado: " + proyMostrarARE + " Tn"
               + "\nDiferencia: " + rd(proyMostrarARE - total) + " Tn";
      cell.clearNote(); cell.setNote(nota);
    } catch(e) { log.push("WARN nota ARE " + fs + ": " + e.message); }
  }

  cerrarDia(wsOP, fechasOrden, idxFecha, [ARE_COL], colsEscritas, log, cont);

  log.push("Escritas: " + cont.escritos);
  guardarLog(log);
  Logger.log(log.join("\n"));
}

function actualizarInsumos() {
  var ahora = new Date();
  var horaAR = ahora.getHours(); if (horaAR < 6) { Logger.log("Fuera de horario AR (" + horaAR + "hs)."); return; }

  var log  = [];
  var cont = { escritos: 0 };
  log.push("=== INSUMOS v4 === " + ahora.toLocaleString());

  var ssRepec;
  try { ssRepec = abrirArchivoXlsx(NOMBRE_REPEC); }
  catch(e) { log.push("ERROR RecepClaude: " + e.message); guardarLog(log); return; }

  var wsRepec    = ssRepec.getSheets()[0];
  var maxColR    = Math.max(REPEC_COL_OC, REPEC_COL_TIPO, REPEC_COL_PRODUCTO,
                            REPEC_COL_PROVEEDOR, REPEC_COL_FECHA, REPEC_COL_PESO);
  var datosRepec = wsRepec.getRange(REPEC_FILA_INICIO, 1,
    wsRepec.getLastRow() - REPEC_FILA_INICIO + 1, maxColR).getValues();

  var ssPlan = SpreadsheetApp.getActiveSpreadsheet();
  var wsIns  = ssPlan.getSheetByName(HOJA_INSUMOS);
  if (!wsIns) { log.push("ERROR: hoja Insumos no encontrada"); guardarLog(log); return; }

  var totalFilas = wsIns.getLastRow() - INSUMOS_FILA_INICIO + 1;
  var bloqFechas  = wsIns.getRange(INSUMOS_FILA_INICIO, INSUMOS_COL_FECHA, totalFilas, 1).getValues();
  var idxFecha    = {};
  for (var r = 0; r < bloqFechas.length; r++) {
    var v = bloqFechas[r][0];
    if (v instanceof Date) { var d = new Date(v); d.setHours(0,0,0,0); idxFecha[formatF(d)] = r; }
  }

  var agrup = {};
  for (var i = 0; i < datosRepec.length; i++) {
    var fila     = datosRepec[i];
    var tipo     = String(fila[REPEC_COL_TIPO - 1]).trim().toUpperCase();
    var producto = String(fila[REPEC_COL_PRODUCTO - 1]).trim();
    var fechaRaw = fila[REPEC_COL_FECHA - 1];
    var pesoKg   = parseFloat(fila[REPEC_COL_PESO - 1]) || 0;
    var oc       = parseInt(fila[REPEC_COL_OC - 1]);
    var prov     = String(fila[REPEC_COL_PROVEEDOR - 1]).trim();
    if (tipo !== "REC") continue;
    if (pesoKg < 0 || !fechaRaw) continue;
    var col = null;
    for (var m = 0; m < INSUMOS_MAPA.length; m++) {
      if (producto === INSUMOS_MAPA[m].producto) { col = INSUMOS_MAPA[m].col; break; }
    }
    if (col === null) continue;
    var fechaRec = new Date(fechaRaw); fechaRec.setHours(0,0,0,0);
    var fs = formatF(fechaRec);
    var tn = rd(pesoKg / 1000);
    if (!agrup[fs]) agrup[fs] = {};
    if (!agrup[fs][col]) agrup[fs][col] = { total: 0, detalle: [] };
    agrup[fs][col].total = rd(agrup[fs][col].total + tn);
    agrup[fs][col].detalle.push("OC " + oc + " | " + producto + " | " + prov + " | " + tn.toFixed(2) + " Tn");
  }

  for (var fs in agrup) {
    var idx = idxFecha[fs];
    if (idx === undefined) continue;
    if (!esPasadaOHoy(fs)) continue;
    for (var col in agrup[fs]) {
      col = parseInt(col);
      var total   = agrup[fs][col].total;
      var detalle = agrup[fs][col].detalle;
      var cell    = wsIns.getRange(INSUMOS_FILA_INICIO + idx, col);
      cell.setValue(total).setFontWeight("bold").setFontColor("#000000");
      log.push("ESCRITO INS " + fs + " " + colLetra(col) + " = " + total + " Tn");
      cont.escritos++;
      try {
        cell.clearNote();
        cell.setNote(detalle.join("\n") + "\nTotal: " + total.toFixed(2) + " Tn");
      } catch(e) {}
    }
  }

  log.push("Escritas: " + cont.escritos);
  guardarLog(log);
  Logger.log(log.join("\n"));
}

function cerrarDia(wsOP, fechasOrden, idxFecha, cols, colsEscritas, log, cont, sinCascada) {
  var ayer = new Date(); ayer.setHours(0,0,0,0); ayer.setDate(ayer.getDate() - 1);
  var fsAyer = formatF(ayer);
  var idxAyer = idxFecha[fsAyer];
  if (idxAyer === undefined) return;

  var fiAyer = fechasOrden.indexOf(fsAyer);
  var fsSig  = (fiAyer !== -1 && fiAyer < fechasOrden.length - 1) ? fechasOrden[fiAyer + 1] : null;
  var idxSig = fsSig ? idxFecha[fsSig] : null;

  for (var ci = 0; ci < cols.length; ci++) {
    var col = cols[ci];
    if (esProtegida(col)) continue;
    var yaEscrita = (colsEscritas[fsAyer] && colsEscritas[fsAyer][col]);
    if (yaEscrita) continue;
    var cell = wsOP.getRange(PLAN_FILA_INICIO + idxAyer, col);
    var valActual = parseFloat(cell.getValue()) || 0;
    var esReal = (cell.getFontWeight() === "bold" && cell.getFontColor() === "#000000");
    if (esReal) continue;
    if (valActual !== 0 && !sinCascada && idxSig !== null) {
      var cellSig = wsOP.getRange(PLAN_FILA_INICIO + idxSig, col);
      var valSig  = parseFloat(cellSig.getValue()) || 0;
      var esRealSig = (cellSig.getFontWeight() === "bold" && cellSig.getFontColor() === "#000000");
      if (!esRealSig) {
        var nuevoSig = rd(valSig + valActual);
        cellSig.setValue(nuevoSig);
        log.push("CIERRE-CASCADA " + fsAyer + " " + colLetra(col) + " proy=" + valActual + " -> " + fsSig);
      }
    }
    cell.setValue(0).setFontWeight("bold").setFontColor("#000000");
    log.push("CIERRE " + fsAyer + " " + colLetra(col) + " -> 0");
    if (cont) cont.cierres = (cont.cierres || 0) + 1;
  }
}

function esProtegida(col) { return COLS_PROTEGIDAS.indexOf(col) !== -1; }

function limpiarBloque(wsOP, cols, fechasOrden, idxFecha, log) {
  var idxMin = -1, idxMax = -1;
  for (var fi = 0; fi < fechasOrden.length; fi++) {
    var fs = fechasOrden[fi];
    if (!esPasadaOHoy(fs)) break;
    var idx = idxFecha[fs];
    if (idx === undefined) continue;
    if (idxMin === -1) idxMin = idx;
    idxMax = idx;
  }
  if (idxMin === -1) return;
  var nFilas = idxMax - idxMin + 1;
  for (var ci = 0; ci < cols.length; ci++) {
    var col = cols[ci];
    if (esProtegida(col)) continue;
    var rng    = wsOP.getRange(PLAN_FILA_INICIO + idxMin, col, nFilas, 1);
    var vals   = rng.getValues();
    var pesos  = rng.getFontWeights();
    var colores= rng.getFontColors();
    for (var r = 0; r < nFilas; r++) {
      var esReal = (pesos[r][0] === "bold" && colores[r][0] === "#000000");
      if (esReal) { vals[r][0] = ""; }
    }
    rng.setValues(vals);
  }
}

function leerProyectadoNota(cell) {
  try {
    var nota = cell.getNote();
    if (!nota) return null;
    var m = nota.match(/Proyectado:\s*([\d.]+)/);
    if (m && m[1]) return parseFloat(m[1]);
    return null;
  } catch(e) { return null; }
}

function parsearOCs(val) {
  var s = String(val);
  var partes = s.split(/[,;\s]+/);
  var res = [];
  for (var i = 0; i < partes.length; i++) {
    var n = parseInt(partes[i]);
    if (!isNaN(n)) res.push(n);
  }
  return res;
}

function esPasadaOHoy(fs) {
  var hoy = new Date(); hoy.setHours(0,0,0,0);
  var partes = fs.split("-");
  var d = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]));
  d.setHours(0,0,0,0);
  return d <= hoy;
}

function formatF(fecha) {
  var y = fecha.getFullYear();
  var m = String(fecha.getMonth() + 1);
  var d = String(fecha.getDate());
  if (m.length < 2) m = "0" + m;
  if (d.length < 2) d = "0" + d;
  return y + "-" + m + "-" + d;
}

function rd(n) { return Math.round(n * 1000) / 1000; }

function colLetra(col) {
  var letra = "";
  while (col > 0) { var mod = (col - 1) % 26; letra = String.fromCharCode(65 + mod) + letra; col = Math.floor((col - 1) / 26); }
  return letra;
}

function esValorValidoStock(val) {
  if (val === null || val === undefined || val === "") return false;
  var num = parseFloat(val);
  if (isNaN(num)) return false;
  return true;
}

function actualizarFormulaH() {
  var ssPlan = SpreadsheetApp.getActiveSpreadsheet();
  var wsOP   = ssPlan.getSheetByName(HOJA_OP);
  if (!wsOP) { Logger.log("ERROR: hoja OP no encontrada"); return; }

  var p = ACEITE_REPROCESO_DESDE.split("-");
  var desdeD = new Date(parseInt(p[0]), parseInt(p[1]) - 1, parseInt(p[2]));
  desdeD.setHours(0,0,0,0);

  var totalFilas = wsOP.getLastRow() - PLAN_FILA_INICIO + 1;
  var bloqFechas = wsOP.getRange(PLAN_FILA_INICIO, PLAN_COL_FECHA, totalFilas, 1).getValues();

  var formulas = [], filaInicio = -1;
  for (var r = 0; r < totalFilas; r++) {
    var f = bloqFechas[r][0];
    if (!(f instanceof Date)) continue;
    var d = new Date(f); d.setHours(0,0,0,0);
    if (d >= desdeD) {
      if (filaInicio === -1) filaInicio = r;
      var row = PLAN_FILA_INICIO + r;
      formulas.push([
        "=SUM(I" + row + ":V" + row + ")+SUM(Y" + row + ":Z" + row + ")+IF(C" + row + "<TODAY()," + "AB" + row + ",AA" + row + ")"
      ]);
    }
  }
  if (filaInicio === -1) { Logger.log("Formula H: sin filas desde " + ACEITE_REPROCESO_DESDE); return; }
  wsOP.getRange(PLAN_FILA_INICIO + filaInicio, 8, formulas.length, 1).setFormulas(formulas);
  Logger.log("Formula H (layout B) reescrita: " + formulas.length + " filas desde " + ACEITE_REPROCESO_DESDE);
}

// =============================================================================
// REPROCESO ACEITE HISTORICO — one-shot, ejecucion MANUAL (v5)
//   DESTRUCTIVO. Vacia el bloque Aceite (I..AB = 9..28) para las filas cuya
//   fecha este en [ACEITE_REPROCESO_DESDE, AYER] y lo reconstruye SOLO con
//   reales, ruteados por nombre. Antes de ACEITE_REPROCESO_DESDE NO toca nada.
//   NO reconstruye proyectado (historia = solo real). Batch para evitar timeout.
//   Checksum esperado (2026): ~38.117 Tn.
//   *** HACER BACKUP DEL PLAN ANTES DE EJECUTAR ESTO ***
// =============================================================================
function reprocesarAceiteHistorico() {
  var log = [];
  log.push("=== REPROCESO ACEITE HISTORICO === " + new Date().toLocaleString());

  var ssRepec;
  try { ssRepec = abrirArchivoXlsx(NOMBRE_REPEC); }
  catch(e) { log.push("ERROR RecepClaude: " + e.message); guardarLog(log); return "ERROR RecepClaude: " + e.message; }
  var wsRepec = ssRepec.getSheets()[0];
  var datosRepec = wsRepec.getRange(
    REPEC_FILA_INICIO, 1,
    wsRepec.getLastRow() - REPEC_FILA_INICIO + 1,
    Math.max(REPEC_COL_OC, REPEC_COL_TIPO, REPEC_COL_PRODUCTO, REPEC_COL_PROVEEDOR, REPEC_COL_FECHA, REPEC_COL_PESO)
  ).getValues();

  var ssPlan = SpreadsheetApp.getActiveSpreadsheet();
  var wsOP = ssPlan.getSheetByName(HOJA_OP);
  if (!wsOP) { log.push("ERROR hoja OP"); guardarLog(log); return "ERROR hoja OP"; }

  var desde = ACEITE_REPROCESO_DESDE;   // "2026-01-02"
  var ayer = new Date(); ayer.setHours(0,0,0,0); ayer.setDate(ayer.getDate() - 1);
  var ayerStr = formatF(ayer);

  var totalFilas = wsOP.getLastRow() - PLAN_FILA_INICIO + 1;
  var bloqFechas = wsOP.getRange(PLAN_FILA_INICIO, PLAN_COL_FECHA, totalFilas, 1).getValues();

  // Rango contiguo de filas dentro de [desde, ayer]
  var idxFecha = {};
  var rMin = -1, rMax = -1;
  for (var r = 0; r < totalFilas; r++) {
    var v = bloqFechas[r][0];
    if (!(v instanceof Date)) continue;
    var d = new Date(v); d.setHours(0,0,0,0);
    var fs = formatF(d);
    idxFecha[fs] = r;
    if (fs >= desde && fs <= ayerStr) {
      if (rMin === -1) rMin = r;
      rMax = r;
    }
  }
  if (rMin === -1) { log.push("Sin filas en el rango " + desde + ".." + ayerStr); guardarLog(log); return "Sin filas en rango"; }

  // Agrupar reales por fecha, ruteando por nombre
  var recep = {}, detalle = {};
  var totalTn = 0, aTerceros = 0;
  for (var i = 0; i < datosRepec.length; i++) {
    var fila = datosRepec[i];
    var tipo = String(fila[REPEC_COL_TIPO - 1]).trim().toUpperCase();
    var producto = String(fila[REPEC_COL_PRODUCTO - 1]).trim();
    var fechaRaw = fila[REPEC_COL_FECHA - 1];
    var pesoKg = parseFloat(fila[REPEC_COL_PESO - 1]) || 0;
    var oc = parseInt(fila[REPEC_COL_OC - 1]);
    var prov = String(fila[REPEC_COL_PROVEEDOR - 1] || "").trim();
    if (tipo !== "REC") continue;
    if (producto !== PRODUCTO_ACEITE) continue;
    if (!fechaRaw || pesoKg < 0) continue;
    var fd = new Date(fechaRaw); fd.setHours(0,0,0,0);
    var fs = formatF(fd);
    if (fs < desde || fs > ayerStr) continue;
    var tn = rd(pesoKg / 1000);
    totalTn = rd(totalTn + tn);
    var col = matchProveedorAceite(prov);
    if (col === null) { col = ACEITE_COL_VARIOS; aTerceros = rd(aTerceros + tn); }
    if (!recep[fs]) recep[fs] = {};
    recep[fs][col] = rd((recep[fs][col] || 0) + tn);
    if (!detalle[fs]) detalle[fs] = {};
    if (!detalle[fs][col]) detalle[fs][col] = [];
    detalle[fs][col].push("OC " + oc + " | " + prov + " | " + tn.toFixed(3) + " Tn");
  }

  // Matrices batch para I..AB (9..28)
  var colIni = 9, colFin = ACEITE_COL_VARIOS;   // 28
  var nCols = colFin - colIni + 1;
  var nRows = rMax - rMin + 1;
  var vals = [], notes = [], weights = [], colors = [];
  for (var rr = 0; rr < nRows; rr++) {
    var rowVals = [], rowNotes = [], rowW = [], rowC = [];
    for (var cc = 0; cc < nCols; cc++) { rowVals.push(""); rowNotes.push(""); rowW.push("normal"); rowC.push("#000000"); }
    vals.push(rowVals); notes.push(rowNotes); weights.push(rowW); colors.push(rowC);
  }

  // Volcar reales
  var escritas = 0;
  for (var fs in recep) {
    var r = idxFecha[fs];
    if (r === undefined || r < rMin || r > rMax) continue;
    var rr = r - rMin;
    for (var col in recep[fs]) {
      var c = parseInt(col);
      var cc = c - colIni;
      if (cc < 0 || cc >= nCols) continue;
      var total = recep[fs][col];
      vals[rr][cc] = total;
      weights[rr][cc] = "bold";
      colors[rr][cc] = "#000000";
      var nombre = (c === ACEITE_COL_VARIOS) ? "Terceros" : colLetra(c);
      var lin = detalle[fs][col] ? detalle[fs][col].join("\n") : "";
      notes[rr][cc] = "Aceite " + nombre + " — " + fs + "\n" + lin + "\nTotal: " + total.toFixed(3) + " Tn\n(reconstruido)";
      escritas++;
    }
  }

  // Escribir batch — SOLO el rango [rMin, rMax]. Fuera de ahi no se toca nada.
  var rng = wsOP.getRange(PLAN_FILA_INICIO + rMin, colIni, nRows, nCols);
  rng.setValues(vals);
  rng.setNotes(notes);
  rng.setFontWeights(weights);
  rng.setFontColors(colors);

  log.push("Rango plan: filas " + (PLAN_FILA_INICIO + rMin) + ".." + (PLAN_FILA_INICIO + rMax) + " (" + nRows + " filas)");
  log.push("Fechas: " + desde + " .. " + ayerStr);
  log.push("Celdas reales escritas: " + escritas);
  log.push("A Terceros (AB): " + aTerceros.toFixed(1) + " Tn");
  log.push("TOTAL Aceite reconstruido: " + totalTn.toFixed(1) + " Tn  <-- CHECKSUM (esperado ~38.117)");
  log.push("=========================================");
  guardarLog(log);
  Logger.log(log.join("\n"));
  return "Reproceso OK. Total=" + totalTn.toFixed(1) + " Tn | Terceros=" + aTerceros.toFixed(1) + " Tn | celdas=" + escritas + ".\nVerificar checksum ~38.117 Tn y luego correr 'Actualizar formula H'.";
}

// =============================================================================
// APERTURA DE ARCHIVO XLSX -> GOOGLE SHEETS TEMPORAL   (IDENTICO v4.6)
// =============================================================================
// =============================================================================
// ABRIR XLSX DESDE DRIVE  (restaurado del codigo real en produccion + fix duplicados)
//   Mantiene un convertido PERMANENTE "<nombre> (Convertido)" y solo reconvierte
//   cuando el xlsx es mas nuevo (getLastUpdated). No usa Drive.Files.insert (no
//   depende del servicio avanzado Drive API). No genera triggers ni TMP_ basura.
//   FIX v5: si hay varios xlsx con el mismo nombre (subida por arrastre crea
//   duplicados con distinto ID), toma SIEMPRE el mas reciente y manda los viejos
//   a la papelera. Eso resuelve "subo un archivo nuevo y no se convierte".
// =============================================================================
function abrirArchivoXlsx(nombre, carpetaId) {
  var carpeta    = DriveApp.getFolderById(carpetaId || ID_CARPETA);
  var nombreConv = nombre.replace(".xlsx", " (Convertido)");

  var xlsxFile = _archivoMasReciente(carpeta, nombre);
  if (!xlsxFile) throw new Error("No se encontro: " + nombre);

  var gsFiles = carpeta.getFilesByName(nombreConv);
  if (gsFiles.hasNext()) {
    var gsFile = gsFiles.next();
    if (xlsxFile.getLastUpdated() > gsFile.getLastUpdated()) {
      gsFile.setTrashed(true);
      return convertirXlsx(xlsxFile, carpeta, nombreConv);
    }
    return SpreadsheetApp.openById(gsFile.getId());
  }
  return convertirXlsx(xlsxFile, carpeta, nombreConv);
}

// Devuelve el archivo mas reciente con ese nombre; manda los duplicados viejos a papelera.
function _archivoMasReciente(carpeta, nombre) {
  var it = carpeta.getFilesByName(nombre);
  var lista = [];
  while (it.hasNext()) lista.push(it.next());
  if (lista.length === 0) return null;
  lista.sort(function(a, b) { return b.getLastUpdated().getTime() - a.getLastUpdated().getTime(); });
  if (lista.length > 1) {
    Logger.log("AVISO: " + lista.length + " archivos '" + nombre + "'. Uso el mas reciente (" +
               lista[0].getLastUpdated() + ") y mando " + (lista.length - 1) + " duplicado(s) a papelera.");
    for (var d = 1; d < lista.length; d++) {
      try { lista[d].setTrashed(true); } catch(e) { Logger.log("WARN papelera duplicado: " + e.message); }
    }
  }
  return lista[0];
}

function convertirXlsx(archivo, carpeta, nombreDest) {
  var token = ScriptApp.getOAuthToken();
  var resp  = UrlFetchApp.fetch(
    "https://www.googleapis.com/drive/v3/files/" + archivo.getId() + "/copy", {
      method: "POST", contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify({
        name: nombreDest,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [carpeta.getId()]
      })
    });
  var nuevoId = JSON.parse(resp.getContentText()).id;
  for (var intento = 1; intento <= 5; intento++) {
    try {
      var ss = SpreadsheetApp.openById(nuevoId);
      ss.getSheets();
      return ss;
    } catch(e) {
      if (intento === 5) throw new Error("No se pudo abrir convertido tras 5 intentos: " + e.message);
      Logger.log("Conversion pendiente, intento " + intento + "/5 esperando 3s...");
      Utilities.sleep(3000);
    }
  }
}

// Limpieza manual de triggers basura "_dummyBorrar" (por si quedaron de una version previa).
function limpiarDummyBorrar() {
  var triggers = ScriptApp.getProjectTriggers();
  var borrados = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "_dummyBorrar") {
      ScriptApp.deleteTrigger(triggers[i]);
      borrados++;
    }
  }
  Logger.log("_dummyBorrar borrados: " + borrados);
  return borrados;
}

// =============================================================================
// MENU   (MODIFICADO v5 — agrega Reprocesar Aceite y Formula H)
// =============================================================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("PLAN")
    .addItem("Actualizar todo", "actualizarTodo")
    .addSeparator()
    .addItem("Actualizar Stocks", "actualizarStocks")
    .addItem("Actualizar Aceite", "actualizarAceite")
    .addItem("Actualizar Sebo/HFFA", "actualizarSebo")
    .addItem("Actualizar Metanol", "actualizarMetanol")
    .addItem("Actualizar Biodiesel/EMAG", "actualizarBiodiesel")
    .addItem("Actualizar Glicerina", "actualizarGlicerina")
    .addItem("Actualizar ARE", "actualizarARE")
    .addItem("Actualizar Insumos", "actualizarInsumos")
    .addSeparator()
    .addItem("Actualizar formula H (layout B)", "actualizarFormulaH")
    .addSeparator()
    .addItem(">> REPROCESAR ACEITE historico (one-shot)", "reprocesarAceiteHistorico")
    .addSeparator()
    .addItem("Instalar triggers", "instalarTrigger")
    .addItem("Desinstalar triggers", "desinstalarTrigger")
    .addItem("Limpiar triggers _dummyBorrar", "limpiarDummyBorrar")
    .addItem("Limpiar Log_Repec", "limpiarLogRepec")
    .addToUi();
}

// =============================================================================
// TRIGGERS   (IDENTICO v4.6)
// =============================================================================
function instalarTrigger() {
  desinstalarTrigger();
  ScriptApp.newTrigger("actualizarTodo_1").timeBased().everyHours(1).create();
  ScriptApp.newTrigger("actualizarTodo_2").timeBased().everyHours(1).create();
  Logger.log("Triggers instalados (actualizarTodo_1 y _2 cada 1 hora).");
}

function desinstalarTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === "actualizarTodo_1" || fn === "actualizarTodo_2" || fn === "actualizarTodo" || fn === "actualizarRepec") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  Logger.log("Triggers desinstalados.");
}

// =============================================================================
// LOG con rotacion   (IDENTICO v4.6)
// =============================================================================
var MAX_LOG = 300;

function guardarLog(lineas) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var hoja = ss.getSheetByName("Log_Repec");
    if (!hoja) hoja = ss.insertSheet("Log_Repec");
    var stamp = new Date().toLocaleString();
    var filas = [];
    for (var i = 0; i < lineas.length; i++) filas.push([stamp, lineas[i]]);
    if (filas.length > 0) hoja.getRange(hoja.getLastRow() + 1, 1, filas.length, 2).setValues(filas);
    var lastRow = hoja.getLastRow();
    if (lastRow > MAX_LOG) {
      var borrar = lastRow - MAX_LOG;
      hoja.deleteRows(1, borrar);
    }
  } catch(e) { Logger.log("WARN guardarLog: " + e.message); }
}

function limpiarLogRepec() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName("Log_Repec");
  if (hoja) ss.deleteSheet(hoja);
  ss.insertSheet("Log_Repec");
  Logger.log("Log_Repec limpiado y recreado.");
}
