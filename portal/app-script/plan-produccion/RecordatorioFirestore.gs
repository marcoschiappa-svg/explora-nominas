// ============================================================
// RecordatorioFirestore.gs — El recordatorio, leyendo Firestore de verdad
// ============================================================
//
// QUÉ REEMPLAZA
//   La función vieja del mismo nombre, que leía "Pedidos Portal" —una hoja
//   que nunca se creó— y por eso nunca mandó un solo recordatorio en la
//   práctica. Esta lee Firestore directo.
//
// -----------------------------------------------------------------------------
// CÓMO SE AUTENTICA — LA MISMA CUENTA DE SERVICIO QUE `verificar-contadores.js`
// -----------------------------------------------------------------------------
//   Apps Script no puede usar el SDK de Firebase como el portal —eso
//   depende de que alguien esté logueado en un navegador—, así que le habla
//   a Firestore por su API REST, autenticado con una cuenta de servicio: la
//   misma credencial que ya usa `verificar-contadores.js` desde Node,
//   reutilizada acá firmando el JWT a mano con
//   `Utilities.computeRsaSha256Signature` (Apps Script no tiene una
//   librería de Google Auth incorporada como Node, así que este paso se
//   arma directo).
//
//   Nada de esto toca IAM ni la cuenta que despliega el script
//   (`explora.portal.ops@gmail.com`): es una cuenta de servicio aparte, ya
//   creada, que ya tiene el permiso puesto — si no lo tuviera,
//   `verificar-contadores.js` no te hubiera andado.
//
// -----------------------------------------------------------------------------
// CONFIGURACIÓN NECESARIA — Propiedades del script
// -----------------------------------------------------------------------------
//   Editor de Apps Script → ⚙️ Configuración del proyecto → Propiedades del
//   script → Agregar propiedad del script, dos veces:
//
//     FIRESTORE_CLIENT_EMAIL   el "client_email" de clave-staging.json
//     FIRESTORE_PRIVATE_KEY    el "private_key" completo, con los \n tal
//                              cual están en el JSON (no hace falta
//                              reemplazarlos por saltos de línea reales,
//                              el código los interpreta)
//
//   Solo esos dos campos — no hace falta subir el archivo entero a ningún
//   lado, y estas dos propiedades no las ve nadie que no tenga acceso de
//   edición al proyecto de Apps Script.
//
// -----------------------------------------------------------------------------
// EL CRITERIO DE "12 HORAS" — SIMPLIFICADO, Y POR QUÉ
// -----------------------------------------------------------------------------
//   `fecha_carga` es un string `YYYY-MM-DD` — un día de calendario, no un
//   instante. `horario_carga` es texto libre ("08:00hs", "14", a veces
//   vacío) que no se puede parsear con confianza. Calcular "faltan menos de
//   12 horas" de verdad requeriría un campo de fecha+hora que hoy no existe.
//
//   Esta versión revisa, una vez por día, los despachos cuya `fecha_carga`
//   es MAÑANA y que todavía no tienen unidad nominada (`ASIGNADO` o
//   `ACEPTADO`, nunca llegó a `NOMINADO`). Es "menos de un día", no
//   "menos de 12 horas" exacto — más flojo que el original, pero es lo que
//   el dato disponible permite sin inventar una precisión que no existe.
//   Si hace falta más exactitud, el paso siguiente sería agregar un campo
//   de hora estructurado a `despachos` y ajustar el filtro acá.
// ============================================================

var FIRESTORE_PROYECTO = 'entorno-prueba-explora';  // cambiar a 'explora-portal' para producción

/* -----------------------------------------------------------------------------
 * Autenticación — JWT firmado a mano, token cacheado
 * -------------------------------------------------------------------------- */

function base64UrlEncode(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

/**
 * Devuelve un access_token válido para llamar a la API de Firestore.
 * Cacheado con `CacheService` por 50 minutos (el token dura 60): evita firmar
 * un JWT nuevo y pedirle uno a Google en cada llamada dentro de la misma
 * corrida.
 */
function obtenerTokenFirestore() {
  var cache = CacheService.getScriptCache();
  var cacheado = cache.get('firestore_token');
  if (cacheado) return cacheado;

  var props = PropertiesService.getScriptProperties();
  var clientEmail = props.getProperty('FIRESTORE_CLIENT_EMAIL');
  var privateKey  = props.getProperty('FIRESTORE_PRIVATE_KEY');

  if (!clientEmail || !privateKey) {
    throw new Error(
      'Faltan las propiedades del script FIRESTORE_CLIENT_EMAIL / '
      + 'FIRESTORE_PRIVATE_KEY. Ver el comentario al principio de este archivo.'
    );
  }

  var ahora = Math.floor(Date.now() / 1000);
  var header = { alg: 'RS256', typ: 'JWT' };
  var claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: ahora + 3600,
    iat: ahora,
  };

  var base = base64UrlEncode(Utilities.newBlob(JSON.stringify(header)).getBytes())
    + '.' + base64UrlEncode(Utilities.newBlob(JSON.stringify(claimSet)).getBytes());

  var firma = Utilities.computeRsaSha256Signature(base, privateKey);
  var jwt = base + '.' + base64UrlEncode(firma);

  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    },
    muteHttpExceptions: true,
  });

  var datos = JSON.parse(resp.getContentText());
  if (!datos.access_token) {
    throw new Error('No se pudo obtener token de Firestore: ' + resp.getContentText());
  }

  cache.put('firestore_token', datos.access_token, 50 * 60);
  return datos.access_token;
}

/* -----------------------------------------------------------------------------
 * Consulta genérica — runQuery de la API REST de Firestore
 * -------------------------------------------------------------------------- */

/**
 * Corre una structured query contra una colección y devuelve los documentos
 * como objetos planos {id, ...campos}.
 *
 * @param {string} coleccion
 * @param {Array} filtros [{campo, operador, valor}] — se combinan con AND.
 *   `operador` es el nombre del operador de Firestore ('EQUAL', 'LESS_THAN',
 *   etc. — ver la documentación de StructuredQuery.FieldFilter.Operator).
 */
function firestoreQuery(coleccion, filtros) {
  var token = obtenerTokenFirestore();
  var url = 'https://firestore.googleapis.com/v1/projects/' + FIRESTORE_PROYECTO
    + '/databases/(default)/documents:runQuery';

  var where;
  if (filtros.length === 1) {
    where = campoFiltro(filtros[0]);
  } else {
    where = {
      compositeFilter: {
        op: 'AND',
        filters: filtros.map(campoFiltro),
      },
    };
  }

  var body = {
    structuredQuery: {
      from: [{ collectionId: coleccion }],
      where: where,
    },
  };

  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  var filas = JSON.parse(resp.getContentText());
  var salida = [];
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].document) salida.push(documentoAObjeto(filas[i].document));
  }
  return salida;
}

function campoFiltro(f) {
  return {
    fieldFilter: {
      field: { fieldPath: f.campo },
      op: f.operador,
      value: valorFirestore(f.valor),
    },
  };
}

function valorFirestore(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return { integerValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  throw new Error('Tipo de valor no soportado para filtro: ' + typeof v);
}

/** Convierte el formato verboso de Firestore ({stringValue:...}) a un objeto plano. */
function documentoAObjeto(doc) {
  var obj = { id: doc.name.split('/').pop() };
  var campos = doc.fields || {};
  for (var k in campos) obj[k] = valorPlano(campos[k]);
  return obj;
}

function valorPlano(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valorPlano);
  if ('mapValue' in v) {
    var m = {};
    var f = v.mapValue.fields || {};
    for (var k in f) m[k] = valorPlano(f[k]);
    return m;
  }
  return null;
}

/* -----------------------------------------------------------------------------
 * El recordatorio en sí
 * -------------------------------------------------------------------------- */

function formatFISO(fecha) {
  var y = fecha.getFullYear();
  var m = String(fecha.getMonth() + 1).padStart(2, '0');
  var d = String(fecha.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

/**
 * Reemplaza a la vieja `verificarNominacionesPendientes()` de `Código.gs`.
 * Pensada para correr una vez por día vía trigger de tiempo (`instalarTrigger`
 * de este mismo archivo) — no hace falta que la llame el portal para nada.
 */
function verificarNominacionesPendientesFirestore() {
  var mañana = new Date();
  mañana.setDate(mañana.getDate() + 1);
  var fechaObjetivo = formatFISO(mañana);

  var despachos;
  try {
    despachos = firestoreQuery('despachos', [
      { campo: 'fecha_carga', operador: 'EQUAL', valor: fechaObjetivo },
    ]);
  } catch (e) {
    Logger.log('ERROR verificarNominacionesPendientesFirestore: ' + e.message);
    return;
  }

  // El filtro por `estado in [...]` con otro campo de igualdad pide un
  // índice compuesto en Firestore -- se filtra acá en vez de en la consulta,
  // ya que el volumen de despachos por día es chico y no vale la pena pedir
  // ese índice para esto.
  var sinNominar = despachos.filter(function (d) {
    return d.estado === 'ASIGNADO' || d.estado === 'ACEPTADO';
  });

  Logger.log('Recordatorio: ' + sinNominar.length + ' despacho(s) para ' + fechaObjetivo + ' sin nominar.');

  for (var i = 0; i < sinNominar.length; i++) {
    var d = sinNominar[i];
    var emailTransportista = '';

    if (d.transportista_org_id) {
      try {
        var usuarios = firestoreQuery('usuarios', [
          { campo: 'organizacion_id', operador: 'EQUAL', valor: d.transportista_org_id },
        ]);
        var transportistas = usuarios.filter(function (u) {
          return u.estado === 'activo' && (u.roles || []).indexOf('transportista') !== -1 && u.email;
        });
        emailTransportista = transportistas.map(function (u) { return u.email; }).join(',');
      } catch (e) {
        Logger.log('WARN: no se pudo resolver email del transportista de ' + d.id + ': ' + e.message);
      }
    }

    enviarEmailRecordatorio12hs({
      pedido_id: d.pedido_id || '',
      producto: d.producto_nombre || '',
      volumen: d.volumen || '',
      cliente: d.cliente_razon_social || '',
      ov: d.ov || '',
      fecha_carga: d.fecha_carga || '',
      lugar: d.destino_texto || '',
      email_transportista: emailTransportista,
      transporte: d.transporte_nombre || '',
    });
  }
}

function instalarTriggerRecordatorio() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'verificarNominacionesPendientesFirestore') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // Una vez por día a la mañana -- alcanza para avisar "carga mañana y
  // todavía no hay unidad", que es la precisión real que da el dato.
  ScriptApp.newTrigger('verificarNominacionesPendientesFirestore')
    .timeBased()
    .atHour(8)
    .everyDays(1)
    .create();
  Logger.log('Trigger instalado: verificarNominacionesPendientesFirestore, todos los días a las 8hs.');
}
