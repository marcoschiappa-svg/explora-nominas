/* =============================================================================
 * carga-masiva.js — Interpretar la planilla de pedidos
 * =============================================================================
 *
 * QUE HACE
 *   Convierte las filas de la planilla en pedidos del modelo nuevo, resolviendo
 *   contra lo que está cargado: el cliente, el producto y el domicilio.
 *
 * -----------------------------------------------------------------------------
 * LA PLANILLA NO CAMBIA
 * -----------------------------------------------------------------------------
 *   Las 18 columnas quedan como están, y se leen POR POSICIÓN — es lo que dice
 *   la hoja de instrucciones y lo que la gente ya sabe.
 *
 *   Lo que cambia es qué se hace con lo que trae. Antes, "SINER S.A." se
 *   guardaba como texto y listo; ahora tiene que corresponder a una
 *   organización cargada. Es más estricto, y es el punto: hoy en la base
 *   conviven "PAE", "Pan American Energy" y "Pan Amerucan Eneergí" como si
 *   fueran tres clientes.
 *
 * -----------------------------------------------------------------------------
 * SE AGRUPA POR NUMERO DE ORDEN
 * -----------------------------------------------------------------------------
 *   Varias filas con el mismo OV/OC son un solo pedido con varias entregas. No
 *   hace falta que estén juntas: la hoja de instrucciones dice "repetí el mismo
 *   número en todas", no "ponelas seguidas".
 *
 *   La primera fila de cada grupo aporta los datos del pedido; todas aportan
 *   una entrega.
 *
 * -----------------------------------------------------------------------------
 * TOLERANCIA, PERO A LA VISTA
 * -----------------------------------------------------------------------------
 *   "Yrigoyen 2933, PGSM" tiene que encontrar el domicilio aunque la ciudad
 *   esté abreviada, y "pro crop" tiene que encontrar "PRO CROP". Sin eso, media
 *   planilla daría error por diferencias de escritura.
 *
 *   Pero la tolerancia que decide sola es peligrosa: puede resolver a lo que no
 *   era y nadie se entera. Por eso cada resolución queda registrada en
 *   `resuelto`, y la pantalla la muestra fila por fila ANTES de escribir nada.
 * ========================================================================== */

import { claveNormalizada } from './mapa-normalizacion';
import { buscarParecidos, textoDomicilio } from './buscar-domicilios';
import { TIPOS, validarPedido } from './logica-pedidos';

/* -----------------------------------------------------------------------------
 * La planilla
 * -------------------------------------------------------------------------- */

/**
 * Las columnas, en orden. Se leen por POSICIÓN, no por nombre: los encabezados
 * de la fila 3 traen emojis y texto largo, y cualquiera que los edite rompería
 * la lectura si dependiera de ellos.
 */
export const COLUMNAS = [
  'tipo', 'producto', 'volumen', 'volumen_entrega', 'fecha_solicitada_entrega',
  'recipiente', 'cliente', 'ov_tipo', 'ov_numero', 'fecha_entrega',
  'banda_horaria', 'calle', 'numero_calle', 'ciudad', 'provincia', 'cp',
  'maps_link', 'obs',
];

/** Los datos arrancan en la fila 5: 1-2 título, 3 encabezados, 4 ejemplo. */
export const PRIMERA_FILA_DATOS = 5;

export const MAXIMO_FILAS = 100;

/* -----------------------------------------------------------------------------
 * Fechas
 * -------------------------------------------------------------------------- */

/**
 * Normaliza una fecha venga como venga a `AAAA-MM-DD`.
 *
 * Excel entrega las fechas de tres formas según cómo estén cargadas: como
 * objeto Date, como número serial contando días desde 1900, o como texto. Y la
 * gente escribe `dd/mm/aaaa` aunque la instrucción diga otra cosa.
 *
 * Es la misma función que usa la pantalla vieja, y funciona: se conserva tal
 * cual para no introducir diferencias donde no las había.
 */
export function normalizarFecha(v) {
  if (v === undefined || v === null || v === '') return '';

  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Serial de Excel. El rango descarta números que son otra cosa: 30000 es
  // 1982 y 90000 es 2146.
  const n = Number(s);
  if (!isNaN(n) && n > 30000 && n < 90000) {
    const dd = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    const y = dd.getUTCFullYear();
    const m = String(dd.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dd.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const mm = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (mm) return `${mm[3]}-${mm[2].padStart(2, '0')}-${mm[1].padStart(2, '0')}`;

  return s;
}

/* -----------------------------------------------------------------------------
 * Resolución con tolerancia
 * -------------------------------------------------------------------------- */

function distancia(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1,
                         anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = temp;
    }
  }
  return fila[b.length];
}

function similitud(a, b) {
  const largo = Math.max(a.length, b.length);
  return largo === 0 ? 1 : 1 - distancia(a, b) / largo;
}

/**
 * Umbral para aceptar una coincidencia que no es exacta.
 *
 * Alto a propósito: acá nadie está mirando una lista y eligiendo, el sistema
 * decide solo. Un umbral bajo resolvería "SINER" a "SENASA" y el pedido saldría
 * para el cliente equivocado.
 */
const UMBRAL = 0.85;

/**
 * Busca una organización por nombre, tolerando diferencias de escritura.
 *
 * Prueba en este orden: coincidencia exacta normalizada, nombre corto exacto,
 * y recién después similitud. Lo exacto siempre gana — si existe "PRO CROP" y
 * "PROCROP S.A.", escribir "PRO CROP" tiene que dar el primero.
 *
 * @returns {{org: Object|null, exacto: boolean, similitud: number}}
 */
export function resolverOrganizacion(texto, organizaciones) {
  const clave = claveNormalizada(texto);
  if (!clave) return { org: null, exacto: false, similitud: 0 };

  const exacta = organizaciones.find(o => claveNormalizada(o.razon_social) === clave);
  if (exacta) return { org: exacta, exacto: true, similitud: 1 };

  const porCorto = organizaciones.find(o =>
    o.nombre_corto && claveNormalizada(o.nombre_corto) === clave);
  if (porCorto) return { org: porCorto, exacto: true, similitud: 1 };

  let mejor = null;
  let mejorS = 0;
  for (const o of organizaciones) {
    const s = Math.max(
      similitud(clave, claveNormalizada(o.razon_social)),
      o.nombre_corto ? similitud(clave, claveNormalizada(o.nombre_corto)) : 0
    );
    if (s > mejorS) { mejor = o; mejorS = s; }
  }

  return mejorS >= UMBRAL
    ? { org: mejor, exacto: false, similitud: mejorS }
    : { org: null, exacto: false, similitud: mejorS };
}

/** Igual, para productos. */
export function resolverProducto(texto, productos) {
  const clave = claveNormalizada(texto);
  if (!clave) return { producto: null, exacto: false, similitud: 0 };

  const exacto = productos.find(p => claveNormalizada(p.nombre) === clave);
  if (exacto) return { producto: exacto, exacto: true, similitud: 1 };

  let mejor = null;
  let mejorS = 0;
  for (const p of productos) {
    const s = similitud(clave, claveNormalizada(p.nombre));
    if (s > mejorS) { mejor = p; mejorS = s; }
  }

  return mejorS >= UMBRAL
    ? { producto: mejor, exacto: false, similitud: mejorS }
    : { producto: null, exacto: false, similitud: mejorS };
}

/**
 * Busca el domicilio entre los del cliente, tolerando diferencias.
 *
 * Solo entre los del cliente: si buscara entre todos, una fila podría resolver
 * a la dirección de otra empresa. `buscarParecidos` ya compara calle y ciudad
 * por separado, que es lo que permite que "PGSM" encuentre "Puerto General San
 * Martín".
 *
 * @returns {{domicilio: Object|null, exacto: boolean, similitud: number}}
 */
export function resolverDomicilio(fila, domiciliosDelCliente) {
  const buscado = {
    calle: fila.calle,
    numero: fila.numero_calle,
    ciudad: fila.ciudad,
  };

  const parecidos = buscarParecidos(domiciliosDelCliente, buscado, 1);
  if (parecidos.length === 0) {
    return { domicilio: null, exacto: false, similitud: 0 };
  }

  const mejor = parecidos[0];
  // Se exige que el número coincida: es lo que separa "Ruta 188 KM 188" de
  // "Ruta 188 KM 80,5", dos lugares a 108 km.
  if (!mejor.mismoNumero) {
    return { domicilio: null, exacto: false, similitud: mejor.similitud };
  }

  return {
    domicilio: mejor.domicilio,
    exacto: mejor.similitud >= 0.999,
    similitud: mejor.similitud,
  };
}

/* -----------------------------------------------------------------------------
 * Agrupación
 * -------------------------------------------------------------------------- */

/** La clave que agrupa las filas de un mismo pedido. */
export function claveOrden(fila) {
  return `${String(fila.ov_tipo || '').trim()}-${String(fila.ov_numero || '').trim()}`;
}

/**
 * Agrupa las filas por número de orden.
 *
 * NO exige que estén consecutivas: la hoja de instrucciones dice "repetí el
 * mismo número en todas", no "ponelas seguidas". Se conserva el orden de
 * aparición para que la numeración de entregas siga el de la planilla.
 *
 * @returns {Array<{clave: string, filas: Array, numerosFila: number[]}>}
 */
export function agrupar(filas) {
  const mapa = new Map();

  filas.forEach((fila, i) => {
    const clave = claveOrden(fila);
    if (!mapa.has(clave)) mapa.set(clave, { clave, filas: [], numerosFila: [] });
    const g = mapa.get(clave);
    g.filas.push(fila);
    g.numerosFila.push(PRIMERA_FILA_DATOS + i);
  });

  return [...mapa.values()];
}

/* -----------------------------------------------------------------------------
 * Interpretación
 * -------------------------------------------------------------------------- */

/**
 * Convierte un grupo de filas en un pedido listo para validar y escribir.
 *
 * Devuelve también `resuelto`: qué encontró para cada texto de la planilla, y
 * si fue exacto o por parecido. La pantalla lo muestra fila por fila antes de
 * escribir nada — la tolerancia que decide sola y en silencio es peor que no
 * tener tolerancia.
 *
 * @param {Object} grupo Salida de `agrupar`
 * @param {Object} catalogos { organizaciones, productos, vinculos, domicilios,
 *   domicilioPlanta }
 * @returns {{pedido: Object, entregas: Array, resuelto: Object, errores: string[]}}
 */
export function interpretarGrupo(grupo, catalogos) {
  const { organizaciones, productos, vinculos, domicilios, domicilioPlanta } = catalogos;
  const primera = grupo.filas[0];
  const errores = [];
  const resuelto = {};

  /* ── Cliente ────────────────────────────────────────────────────────────── */

  const clientes = organizaciones.filter(o => o.es_cliente && o.estado === 'activo');
  const rCliente = resolverOrganizacion(primera.cliente, clientes);

  resuelto.cliente = {
    texto: primera.cliente,
    encontrado: rCliente.org ? rCliente.org.razon_social : null,
    exacto: rCliente.exacto,
  };

  if (!rCliente.org) {
    errores.push(`No hay ningún cliente que se parezca a "${primera.cliente}". Crealo desde Organizaciones.`);
  }

  /* ── Producto ───────────────────────────────────────────────────────────── */

  const activos = productos.filter(p => p.activo !== false);
  const rProducto = resolverProducto(primera.producto, activos);

  resuelto.producto = {
    texto: primera.producto,
    encontrado: rProducto.producto ? rProducto.producto.nombre : null,
    exacto: rProducto.exacto,
  };

  if (!rProducto.producto) {
    errores.push(`No hay ningún producto que se parezca a "${primera.producto}". Crealo desde Productos.`);
  }

  /* ── Tipo y domicilios ──────────────────────────────────────────────────── */

  const tipo = String(primera.tipo || '').trim();
  const config = TIPOS[tipo];
  if (!config) errores.push(`Tipo de operación inválido: "${tipo}".`);

  let domicilioCliente = null;

  if (rCliente.org && config) {
    // Solo entre los del cliente: si buscara entre todos, una fila podría
    // resolver a la dirección de otra empresa.
    const porId = new Map(domicilios.map(d => [d.id, d]));
    const suyos = vinculos
      .filter(v => v.organizacion_id === rCliente.org.id)
      .map(v => porId.get(v.domicilio_id))
      .filter(d => d && d.estado !== 'inactivo');

    // "Entrega en planta" puede venir sin dirección: se usa la planta, que es
    // lo que dice la hoja de instrucciones y lo que hace hoy el código.
    const sinDireccion = !String(primera.calle || '').trim();
    const destinoEsPlanta = config.destino === 'propia';

    if (sinDireccion && destinoEsPlanta) {
      resuelto.domicilio = { texto: '(la planta)', encontrado: null, exacto: true, omitido: true };
    } else {
      const rDom = resolverDomicilio(primera, suyos);
      domicilioCliente = rDom.domicilio;

      const textoBuscado = [primera.calle, primera.numero_calle, primera.ciudad]
        .filter(Boolean).join(' ');

      resuelto.domicilio = {
        texto: textoBuscado,
        encontrado: rDom.domicilio ? textoDomicilio(rDom.domicilio) : null,
        exacto: rDom.exacto,
      };

      if (!rDom.domicilio) {
        errores.push(
          suyos.length === 0
            ? `${rCliente.org.razon_social} no tiene direcciones cargadas. Agregale una desde Organizaciones.`
            : `Ninguna dirección de ${rCliente.org.razon_social} coincide con "${textoBuscado}".`
        );
      }
    }
  }

  /* ── Entregas ───────────────────────────────────────────────────────────── */

  // Cada fila del grupo es una entrega. Si la planilla no trae volumen ni fecha
  // de entrega —el caso de un pedido de una sola— se toman del volumen total y
  // la fecha de entrega, que es lo que dice la hoja de instrucciones.
  const volumenTotal = Number(primera.volumen) || 0;

  const entregas = grupo.filas.map(f => ({
    volumen: Number(f.volumen_entrega) || (grupo.filas.length === 1 ? volumenTotal : 0),
    fecha_solicitada: normalizarFecha(f.fecha_solicitada_entrega) || normalizarFecha(f.fecha_entrega),
  }));

  /* ── El pedido ──────────────────────────────────────────────────────────── */

  const idPlanta = domicilioPlanta ? domicilioPlanta.id : '';
  const idCliente = domicilioCliente ? domicilioCliente.id : '';

  const pedido = {
    cliente_org_id: rCliente.org ? rCliente.org.id : '',
    producto_id: rProducto.producto ? rProducto.producto.id : '',
    tipo,
    recipiente: String(primera.recipiente || 'Granel').trim(),
    ov_tipo: String(primera.ov_tipo || '').trim(),
    ov_numero: String(primera.ov_numero || '').trim(),
    ov: grupo.clave,
    volumen: volumenTotal,
    origen_domicilio_id: config && config.origen === 'propia' ? idPlanta : idCliente,
    destino_domicilio_id: config && config.destino === 'propia' ? idPlanta : idCliente,
    banda_horaria: String(primera.banda_horaria || '').trim(),
    obs: String(primera.obs || '').trim(),
    entregas,
  };

  /* ── Validación ─────────────────────────────────────────────────────────── */

  // La MISMA que usa el formulario. Es lo que garantiza que las dos formas de
  // cargar un pedido apliquen exactamente las mismas reglas.
  const domiciliosDelCliente = domicilioCliente ? [domicilioCliente] : [];
  errores.push(...validarPedido(pedido, {
    organizaciones,
    productos,
    domiciliosDelCliente,
  }));

  return { pedido, entregas, resuelto, errores: [...new Set(errores)] };
}

/**
 * Interpreta la planilla entera.
 *
 * @returns {Array} un elemento por pedido, con sus filas de origen
 */
export function interpretarPlanilla(filas, catalogos) {
  return agrupar(filas).map(grupo => ({
    ...interpretarGrupo(grupo, catalogos),
    clave: grupo.clave,
    numerosFila: grupo.numerosFila,
    filas: grupo.filas,
  }));
}
