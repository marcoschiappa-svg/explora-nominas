// ============================================================
// PushAvisos.gs — El emisor de notificaciones push al chofer
// ============================================================
//
// QUÉ HACE
//   Cada minuto, un trigger de tiempo corre `procesarAvisosPush()`: lee de
//   Firestore los documentos nuevos de `avisos` que tienen un chofer como
//   destinatario (`destinatario_chofer_dni`), busca su `push_token` en
//   `usuarios` y manda la notificación a través del servicio de push de Expo.
//   Es el ÚNICO emisor para todos los avisos con destinatario chofer:
//   nominación, cancelación y cambio de destino. Los avisos para la
//   organización transportista (sin DNI) se ignoran acá.
//
// POR QUÉ SALE DE ACÁ Y NO DEL NAVEGADOR NI DE UNA CLOUD FUNCTION
//   El endpoint de Expo (https://exp.host/--/api/v2/push/send) rechaza las
//   llamadas desde un navegador por CORS (probado), y la decisión fue no usar
//   Cloud Functions, ni un endpoint público, ni servidores nuevos. Un trigger
//   de Apps Script puede hacer la llamada de servidor a servidor y ya
//   tiene acceso a Firestore con la cuenta de servicio del recordatorio.
//
// -----------------------------------------------------------------------------
// CÓMO SE AUTENTICA
// -----------------------------------------------------------------------------
//   Con la MISMA cuenta de servicio de `RecordatorioFirestore.gs`: este archivo
//   reutiliza `obtenerTokenFirestore()` y la variable global
//   `FIRESTORE_PROYECTO` de ese archivo, sin modificarlo. Las propiedades del
//   script necesarias ya están puestas por el recordatorio:
//
//     FIRESTORE_CLIENT_EMAIL   el "client_email" de la cuenta de servicio
//     FIRESTORE_PRIVATE_KEY    el "private_key" completo
//
//   Este archivo agrega dos propiedades propias, que crea solo (no hay que
//   cargarlas a mano):
//
//     PUSH_CHECKPOINT_TS    marca de agua: el `creado_en` del último aviso
//                           procesado, TAL CUAL lo devuelve Firestore
//     PUSH_CHECKPOINT_IDS   JSON con los IDs ya procesados cuyo `creado_en` es
//                           IGUAL a esa marca
//
//   ATENCIÓN: `FIRESTORE_PROYECTO` (en RecordatorioFirestore.gs) hoy apunta a
//   'entorno-prueba-explora'. Para producción tiene que ser 'explora-portal'.
//   Si apunta a otro proyecto que el de los choferes, no encuentra ni avisos
//   ni tokens y no manda nada (no falla: simplemente no hay actividad).
//
// -----------------------------------------------------------------------------
// LA MARCA DE AGUA, Y POR QUÉ ES UN PAR (TIMESTAMP + IDS)
// -----------------------------------------------------------------------------
//   Se consultan los avisos con `creado_en >= marca`, de más viejo a más nuevo.
//   Es `>=` y no `>` porque dos avisos escritos en la MISMA transacción
//   comparten `creado_en` (es `serverTimestamp()`): con `>` el segundo se
//   perdería si el primero ya había movido la marca. Para no reenviar el que ya
//   salió, se guardan los IDs ya procesados que tienen exactamente ese
//   `creado_en`. Cuando aparece uno más nuevo, la marca avanza y la lista
//   se reinicia.
//
//   El timestamp se guarda como STRING, sin pasarlo por `Date`: Firestore tiene
//   precisión de microsegundos y `Date` solo de milisegundos; redondearlo
//   haría que dos avisos distintos parecieran iguales (o al revés). Para
//   COMPARARLOS se normaliza la parte decimal a 9 dígitos (Firestore recorta
//   los ceros finales: "…56Z" y "…56.100Z" son el mismo instante).
//
//   Si la marca no existe, se crea con el instante actual y se sale: nunca se
//   mandan avisos viejos al instalar.
//
// -----------------------------------------------------------------------------
// FALLAS Y REINTENTOS
// -----------------------------------------------------------------------------
//   - Sin destinatario chofer: se avanza sin enviar.
//   - Aviso con más de 60 minutos: se descarta (`push_descartado_vencido`). Una
//     notificación de "tenés un viaje nuevo" una hora tarde ya no sirve, y el
//     descarte acota el reintento.
//   - Chofer sin token: se avanza (`push_sin_token`). Igual ve el aviso en la
//     bandeja de la app.
//   - Si el envío falla por red o Expo responde distinto de 200, se DETIENE el
//     procesamiento ahí sin avanzar la marca: se reintenta en la próxima
//     ejecución, hasta que el aviso venza.
//   - Un ticket con `DeviceNotRegistered` borra ese `push_token` del usuario.
//   - Las excepciones se registran con console.error y se avisa por mail, como
//     máximo UNO por hora (la cuota de mails es de 100 por día).
//
// -----------------------------------------------------------------------------
// CUOTAS (cuentas Gmail comunes) Y ESTIMACIÓN DE CONSUMO
// -----------------------------------------------------------------------------
//   - Tiempo total de triggers: 90 minutos por día.
//   - UrlFetch: 20.000 llamadas por día.
//   - Mails: 100 por día.
//
//   Estimación (a medir con los logs de duración): una ejecución sin avisos
//   hace UNA consulta (el token de acceso se cachea 50 minutos) y tarda del
//   orden de 1 a 2 segundos. Cada minuto = 1.440 ejecuciones por día = unos 24 a
//   48 minutos de trigger (27% al 53% de la cuota) y unos 1.450 UrlFetch (7%).
//   Cada aviso con token suma 2 llamadas (buscar al chofer y enviar). Si el
//   tiempo se acerca al límite, bajar la frecuencia en `instalarTriggerPushAvisos`
//   (cada 5 minutos baja el consumo a un quinto).
//
// -----------------------------------------------------------------------------
// FUNCIONES PARA EJECUTAR A MANO
// -----------------------------------------------------------------------------
//   instalarTriggerPushAvisos()     crea el trigger de 1 minuto e inicializa la marca
//   desinstalarTriggerPushAvisos()  lo borra: el interruptor de emergencia
//
// NOMBRES: Apps Script comparte el ámbito global entre todos los .gs del
// proyecto, así que TODO lo de este archivo lleva el prefijo `push` o `PUSH_`.
// ============================================================

var PUSH_URL_EXPO = 'https://exp.host/--/api/v2/push/send';

/** Cantidad máxima de avisos por ejecución. Con 1 ejecución por minuto sobra. */
var PUSH_LIMITE_AVISOS = 50;

/** Un aviso con más minutos que esto ya no se envía (ver "FALLAS Y REINTENTOS"). */
var PUSH_VENCIMIENTO_MIN = 60;

/** Una ejecución que tarda más que esto se registra aunque no haya actividad. */
var PUSH_LOG_LENTO_MS = 3000;

/** Tiempo máximo que se espera el lock antes de salir (evita ejecuciones superpuestas). */
var PUSH_ESPERA_LOCK_MS = 5000;

/** Mínimo entre mails de error: 1 hora, en segundos (para CacheService). */
var PUSH_MAIL_COOLDOWN_S = 3600;

/* -----------------------------------------------------------------------------
 * LÓGICA PURA — sin servicios de Apps Script, para poder probarla en Node
 * -------------------------------------------------------------------------- */

/**
 * Normaliza un timestamp RFC 3339 de Firestore a 9 dígitos decimales, para
 * poder compararlo como texto. Firestore recorta los ceros finales de la parte
 * decimal ("…56Z", "…56.1Z", "…56.123456Z"), y comparar esos strings tal cual da
 * resultados incorrectos (la "Z" pesa más que el ".").
 *
 * @param {string} ts p. ej. '2026-10-06T12:34:56.1Z'
 * @returns {string} p. ej. '2026-10-06T12:34:56.100000000Z', o '' si no se entiende
 */
function pushNormalizarTs(ts) {
  var m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(String(ts || ''));
  if (!m) return '';
  var decimales = (m[2] || '').substring(0, 9);
  while (decimales.length < 9) decimales += '0';
  return m[1] + '.' + decimales + 'Z';
}

/**
 * Compara dos timestamps de Firestore.
 *
 * @returns {number} negativo si a < b, 0 si son el mismo instante, positivo si a > b
 */
function pushCompararTs(a, b) {
  var na = pushNormalizarTs(a);
  var nb = pushNormalizarTs(b);
  if (na === nb) return 0;
  return na < nb ? -1 : 1;
}

/**
 * ¿Este aviso ya se procesó? Sí, si tiene el MISMO `creado_en` que la marca y su
 * ID figura en la lista de procesados con ese instante.
 *
 * @param {{ts: string, ids: string[]}} marca
 * @param {{id: string, creado_en: string}} aviso
 */
function pushYaProcesado(marca, aviso) {
  return pushCompararTs(aviso.creado_en, marca.ts) === 0
    && marca.ids.indexOf(aviso.id) !== -1;
}

/**
 * Devuelve la marca nueva tras procesar un aviso (no modifica la recibida).
 *   - Mismo `creado_en` que la marca: se agrega su ID a la lista.
 *   - Más nuevo: la marca pasa a ser ese `creado_en` (el string tal cual) y la
 *     lista se reinicia con su ID.
 *   - Más viejo (no debería pasar con la consulta `>=`): sin cambios.
 *
 * @param {{ts: string, ids: string[]}} marca
 * @param {{id: string, creado_en: string}} aviso
 * @returns {{ts: string, ids: string[]}}
 */
function pushAvanzarMarca(marca, aviso) {
  var cmp = pushCompararTs(aviso.creado_en, marca.ts);
  if (cmp === 0) {
    var ids = marca.ids.slice();
    if (ids.indexOf(aviso.id) === -1) ids.push(aviso.id);
    return { ts: marca.ts, ids: ids };
  }
  if (cmp > 0) return { ts: aviso.creado_en, ids: [aviso.id] };
  return { ts: marca.ts, ids: marca.ids.slice() };
}

/**
 * Minutos transcurridos desde un timestamp de Firestore. Acá SÍ se usa `Date`:
 * para medir una antigüedad en minutos sobra la precisión de milisegundos.
 *
 * @returns {number} minutos, o Infinity si el timestamp no se entiende
 */
function pushMinutosDesde(ts, ahoraMs) {
  var ms = Date.parse(String(ts || ''));
  if (isNaN(ms)) return Infinity;
  return (ahoraMs - ms) / 60000;
}

/**
 * Qué hacer con un aviso, en orden:
 *   'sin_destinatario'  no tiene `destinatario_chofer_dni`: no es para un chofer
 *   'vencido'           tiene más de PUSH_VENCIMIENTO_MIN minutos
 *   'enviar'            hay que buscarle el token y mandarlo
 *
 * @param {Object} aviso
 * @param {number} ahoraMs
 * @returns {'sin_destinatario'|'vencido'|'enviar'}
 */
function pushDecidir(aviso, ahoraMs) {
  if (!aviso.destinatario_chofer_dni) return 'sin_destinatario';
  if (pushMinutosDesde(aviso.creado_en, ahoraMs) > PUSH_VENCIMIENTO_MIN) return 'vencido';
  return 'enviar';
}

/**
 * Arma el mensaje para la API de push de Expo (uno por token).
 *
 * `channelId: 'default'` es el canal de Android que crea la app ("Avisos de
 * viaje", importancia alta); `priority: 'high'` hace que llegue con el teléfono
 * en reposo. `data` es lo que la app recibe al tocar la notificación.
 *
 * @param {Object} aviso documento de `avisos` ya decodificado, con `id`
 * @param {string} token 'ExponentPushToken[...]'
 * @returns {Object}
 */
function pushArmarMensaje(aviso, token) {
  return {
    to: token,
    title: aviso.titulo || '',
    body: aviso.mensaje || '',
    sound: 'default',
    channelId: 'default',
    priority: 'high',
    data: {
      aviso_id: aviso.id,
      tipo: aviso.tipo || '',
      pedido_id: aviso.pedido_id || '',
      despacho_id: aviso.despacho_id || '',
      viaje_id: aviso.viaje_id || '',
    },
  };
}

/**
 * Convierte un valor del formato verboso de Firestore a uno plano.
 * A diferencia de `valorPlano()` de RecordatorioFirestore.gs, devuelve los
 * `timestampValue` como STRING tal cual (aquél devuelve null).
 */
function pushDecodificarValor(v) {
  if (v === undefined || v === null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(pushDecodificarValor);
  if ('mapValue' in v) {
    var m = {};
    var f = v.mapValue.fields || {};
    for (var k in f) m[k] = pushDecodificarValor(f[k]);
    return m;
  }
  return null;
}

/** Documento de la API REST -> objeto plano `{ id, ...campos }`. */
function pushDocumentoAObjeto(doc) {
  var obj = { id: doc.name.split('/').pop() };
  var campos = doc.fields || {};
  for (var k in campos) obj[k] = pushDecodificarValor(campos[k]);
  return obj;
}

/* -----------------------------------------------------------------------------
 * ACCESO A FIRESTORE — helpers propios (los de RecordatorioFirestore.gs no
 * soportan orderBy, limit ni filtros de fecha)
 * -------------------------------------------------------------------------- */

/**
 * Corre una structured query con filtros, orden y límite.
 *
 * @param {string} coleccion
 * @param {Array} filtros [{campo, operador, valor}] con `valor` ya en formato
 *   Firestore (p. ej. {stringValue: 'x'} o {timestampValue: '...'}); se combinan con AND
 * @param {Object} [opciones] { orderBy: 'campo', limit: n }
 * @returns {Array} documentos planos `{ id, ...campos }`
 */
function pushQuery(coleccion, filtros, opciones) {
  opciones = opciones || {};
  var campos = filtros.map(function (f) {
    return { fieldFilter: { field: { fieldPath: f.campo }, op: f.operador, value: f.valor } };
  });

  var sq = {
    from: [{ collectionId: coleccion }],
    where: campos.length === 1 ? campos[0] : { compositeFilter: { op: 'AND', filters: campos } },
  };
  if (opciones.orderBy) sq.orderBy = [{ field: { fieldPath: opciones.orderBy }, direction: 'ASCENDING' }];
  if (opciones.limit) sq.limit = opciones.limit;

  var resp = UrlFetchApp.fetch(
    'https://firestore.googleapis.com/v1/projects/' + FIRESTORE_PROYECTO
      + '/databases/(default)/documents:runQuery',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + obtenerTokenFirestore() },
      payload: JSON.stringify({ structuredQuery: sq }),
      muteHttpExceptions: true,
    }
  );
  if (resp.getResponseCode() !== 200) {
    throw new Error('Firestore runQuery (' + coleccion + ') respondió '
      + resp.getResponseCode() + ': ' + resp.getContentText());
  }

  var filas = JSON.parse(resp.getContentText());
  var salida = [];
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].document) salida.push(pushDocumentoAObjeto(filas[i].document));
  }
  return salida;
}

/**
 * Borra el `push_token` de un usuario (PATCH con updateMask y SIN valor para ese
 * campo: Firestore interpreta el campo ausente de la máscara como borrado).
 *
 * @param {string} usuarioId id del documento en `usuarios`
 */
function pushBorrarToken(usuarioId) {
  var resp = UrlFetchApp.fetch(
    'https://firestore.googleapis.com/v1/projects/' + FIRESTORE_PROYECTO
      + '/databases/(default)/documents/usuarios/' + encodeURIComponent(usuarioId)
      + '?updateMask.fieldPaths=push_token',
    {
      method: 'patch',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + obtenerTokenFirestore() },
      payload: JSON.stringify({ fields: {} }),
      muteHttpExceptions: true,
    }
  );
  if (resp.getResponseCode() !== 200) {
    console.error('push: no se pudo borrar el token de ' + usuarioId + ': '
      + resp.getResponseCode() + ' ' + resp.getContentText());
  }
}

/* -----------------------------------------------------------------------------
 * MARCA DE AGUA — propiedades del script
 * -------------------------------------------------------------------------- */

/** @returns {{ts: string, ids: string[]}|null} null si todavía no existe */
function pushLeerMarca() {
  var props = PropertiesService.getScriptProperties();
  var ts = props.getProperty('PUSH_CHECKPOINT_TS');
  if (!ts) return null;
  var ids = [];
  try { ids = JSON.parse(props.getProperty('PUSH_CHECKPOINT_IDS') || '[]'); } catch (e) { ids = []; }
  return { ts: ts, ids: ids };
}

/** @param {{ts: string, ids: string[]}} marca */
function pushGuardarMarca(marca) {
  PropertiesService.getScriptProperties().setProperties({
    PUSH_CHECKPOINT_TS: marca.ts,
    PUSH_CHECKPOINT_IDS: JSON.stringify(marca.ids),
  });
}

/** Marca inicial: el instante actual, sin IDs. */
function pushMarcaInicial() {
  return { ts: new Date().toISOString(), ids: [] };
}

/* -----------------------------------------------------------------------------
 * ENVÍO
 * -------------------------------------------------------------------------- */

/**
 * Busca al chofer y le manda el aviso a cada uno de sus tokens.
 *
 * Se busca en `usuarios` por `datos_chofer.dni` y `estado == 'activo'`; pueden
 * ser varios documentos (misma persona con dos cuentas) y se les manda a todos
 * los que tengan token.
 *
 * @param {Object} aviso
 * @returns {{ok: boolean, enviados: number, sinToken: boolean}} `ok` es false si
 *   el envío falló por red o Expo no respondió 200: el llamador debe frenar.
 */
function pushEnviarAviso(aviso) {
  var choferes = pushQuery('usuarios', [
    { campo: 'datos_chofer.dni', operador: 'EQUAL', valor: { stringValue: String(aviso.destinatario_chofer_dni) } },
    { campo: 'estado', operador: 'EQUAL', valor: { stringValue: 'activo' } },
  ]).filter(function (u) { return u.push_token; });

  if (choferes.length === 0) {
    console.log('push_sin_token: aviso ' + aviso.id + ' (DNI ' + aviso.destinatario_chofer_dni + ')');
    return { ok: true, enviados: 0, sinToken: true };
  }

  var mensajes = choferes.map(function (u) { return pushArmarMensaje(aviso, u.push_token); });

  var resp;
  try {
    resp = UrlFetchApp.fetch(PUSH_URL_EXPO, {
      method: 'post',
      contentType: 'application/json',
      headers: { Accept: 'application/json' },
      payload: JSON.stringify(mensajes),
      muteHttpExceptions: true,
    });
  } catch (e) {
    console.error('push: falló la red al enviar el aviso ' + aviso.id + ': ' + e);
    return { ok: false, enviados: 0, sinToken: false };
  }

  if (resp.getResponseCode() !== 200) {
    console.error('push: Expo respondió ' + resp.getResponseCode() + ' para el aviso '
      + aviso.id + ': ' + resp.getContentText());
    return { ok: false, enviados: 0, sinToken: false };
  }

  // Un ticket por mensaje, en el mismo orden en que se mandaron.
  var tickets = [];
  try { tickets = JSON.parse(resp.getContentText()).data || []; } catch (e2) { tickets = []; }

  var enviados = 0;
  for (var i = 0; i < mensajes.length; i++) {
    var t = tickets[i];
    if (t && t.status === 'ok') { enviados++; continue; }
    var codigo = t && t.details && t.details.error;
    if (codigo === 'DeviceNotRegistered') {
      pushBorrarToken(choferes[i].id);
      console.log('push: token borrado (DeviceNotRegistered) de ' + choferes[i].id);
    } else {
      console.error('push: ticket con error para el aviso ' + aviso.id + ': '
        + JSON.stringify(t || 'sin ticket'));
    }
  }
  return { ok: true, enviados: enviados, sinToken: false };
}

/* -----------------------------------------------------------------------------
 * ERRORES — un mail por hora como máximo
 * -------------------------------------------------------------------------- */

/**
 * Registra el error y avisa por mail al dueño del script, pero no más de uno por
 * hora: la cuota es de 100 mails por día y el trigger corre 1.440 veces.
 */
function pushReportarError(e) {
  console.error('procesarAvisosPush: ' + (e && e.stack ? e.stack : e));
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('PUSH_MAIL_ERROR')) return;
    cache.put('PUSH_MAIL_ERROR', '1', PUSH_MAIL_COOLDOWN_S);
    MailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      'Falló el envío de notificaciones push (procesarAvisosPush)',
      'El trigger de push tuvo un error:\n\n' + (e && e.stack ? e.stack : e)
        + '\n\nSe avisa como máximo una vez por hora. Ver los registros de ejecución en Apps Script.'
    );
  } catch (errMail) {
    console.error('push: no se pudo mandar el mail de error: ' + errMail);
  }
}

/* -----------------------------------------------------------------------------
 * EL TRIGGER
 * -------------------------------------------------------------------------- */

/**
 * Procesa los avisos nuevos. Corre cada minuto (ver `instalarTriggerPushAvisos`).
 * Ver el encabezado del archivo para el criterio completo.
 */
function procesarAvisosPush() {
  var inicio = Date.now();
  var lock = LockService.getScriptLock();
  // Si otra ejecución sigue corriendo, no se superponen: esta sale.
  if (!lock.tryLock(PUSH_ESPERA_LOCK_MS)) return;

  var actividad = 0;
  try {
    var marca = pushLeerMarca();
    if (!marca) {
      // Primera vez: se fija la marca en "ahora" y se sale. Nunca se mandan avisos viejos.
      pushGuardarMarca(pushMarcaInicial());
      console.log('push: marca inicial creada');
      return;
    }

    var avisos = pushQuery(
      'avisos',
      [{ campo: 'creado_en', operador: 'GREATER_THAN_OR_EQUAL', valor: { timestampValue: marca.ts } }],
      { orderBy: 'creado_en', limit: PUSH_LIMITE_AVISOS }
    );

    for (var i = 0; i < avisos.length; i++) {
      var aviso = avisos[i];
      if (pushYaProcesado(marca, aviso)) continue;

      var decision = pushDecidir(aviso, Date.now());
      if (decision === 'vencido') {
        console.log('push_descartado_vencido: aviso ' + aviso.id);
        actividad++;
      } else if (decision === 'enviar') {
        var r = pushEnviarAviso(aviso);
        actividad++;
        // Falla de red o de Expo: se frena SIN avanzar la marca, así este aviso
        // y los siguientes se reintentan en la próxima ejecución.
        if (!r.ok) break;
      }

      marca = pushAvanzarMarca(marca, aviso);
      pushGuardarMarca(marca);
    }
  } catch (e) {
    pushReportarError(e);
  } finally {
    lock.releaseLock();
    var duracion = Date.now() - inicio;
    if (actividad > 0 || duracion > PUSH_LOG_LENTO_MS) {
      console.log('procesarAvisosPush: ' + actividad + ' aviso(s), ' + duracion + ' ms');
    }
  }
}

/**
 * Crea el trigger de 1 minuto (borrando los anteriores de esta función) e
 * inicializa la marca de agua si no existe. Se ejecuta UNA vez, a mano.
 */
function instalarTriggerPushAvisos() {
  pushBorrarTriggers();
  ScriptApp.newTrigger('procesarAvisosPush').timeBased().everyMinutes(1).create();
  if (!pushLeerMarca()) pushGuardarMarca(pushMarcaInicial());
  console.log('push: trigger instalado (cada 1 minuto)');
}

/** Borra el trigger: el interruptor de emergencia. */
function desinstalarTriggerPushAvisos() {
  pushBorrarTriggers();
  console.log('push: trigger desinstalado');
}

/** Borra todos los triggers de `procesarAvisosPush`. */
function pushBorrarTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'procesarAvisosPush') ScriptApp.deleteTrigger(triggers[i]);
  }
}
