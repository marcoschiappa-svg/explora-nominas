/* =============================================================================
 * filtros-listado.js — Filtros y orden de listados (Portal Explora)
 * =============================================================================
 *
 * v1.2.0 (RF-01) — UNA SOLA BARRA DE FILTROS Y ORDEN
 *
 * SÍNTOMA
 *   `Pedidos.js` y `Programacion.js` tenían cada uno su propio buscador de
 *   texto, sus propias pastillas de estado y (solo Pedidos) su propio
 *   `comparadorDe()` -- construidos dos veces, con matices distintos. El
 *   encabezado v1.1.3 de `Pedidos.js` lo dejaba dicho: "construirlo acá y
 *   otra vez allá es la duplicación que este repo evita".
 *
 * CAUSA RAÍZ
 *   No había un lugar único que supiera aplicar un filtro combinado (texto +
 *   selección múltiple + rango de fecha) ni ordenar con la regla de "sin
 *   dato al final". Cada pantalla iba a tener que reinventarlo.
 *
 * ALCANCE
 *   Este archivo es esa lógica, pura -- sin React, sin Firestore. Las
 *   pantallas (`Pedidos.js`, `Programacion.js`) le pasan sus datos y unos
 *   "extractores" (funciones chicas que saben leer, de UN ítem de esa
 *   pantalla, el cliente/producto/tipo/creador/fechas que hace falta) y
 *   reciben de vuelta la función de filtro y el comparador. `ui/BarraFiltros.js`
 *   es la parte visual que llama a esto.
 *
 *   `aplicarFiltros()` combina TODOS los filtros con Y, y dentro de una
 *   selección múltiple con O. `comparador()` implementa "sin dato al final"
 *   en los dos sentidos, con desempate estable por número de pedido.
 *
 *   Los extractores son opcionales por filtro: una pantalla que no tiene
 *   noción de "transportista" (Pedidos) simplemente no pasa
 *   `transportistaIdsVivos`, y ese filtro queda inerte para ella sin que
 *   haga falta ningún `if` especial acá adentro.
 *
 * LIMITACIONES CONOCIDAS
 *   - Los cuatro criterios de orden que ya existían en `Pedidos.js`
 *     (`comparadorDe()`, hoy retirado de ese archivo) se reimplementan acá
 *     con la MISMA comparación en sentido ascendente -- ver el detalle de
 *     cada `case` en `valorDeOrden()`. La única diferencia deliberada es la
 *     regla nueva "sin dato al final en los dos sentidos", que antes no
 *     existía como tal (ver el comentario largo más abajo, en
 *     `valorDeOrden()`, para el caso puntual de "cliente" con una
 *     organización borrada -- es la única situación real donde el resultado
 *     puede diferir del de antes, y es intencional).
 *   - `leerPreferencias()`/`guardarPreferencias()` no migran entre
 *     versiones: un valor guardado con otra `v` se descarta entero, no se
 *     intenta adaptar.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- filtros-listado` (Jest de CRA, sin dependencias
 *   nuevas) -- ver `filtros-listado.test.js`. `CI=true npm run build` sin
 *   warnings.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (Paso 0.2 de RF-02) -- "VIAJES ABIERTOS VENCIDOS" SE SUMA ACÁ
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El conmutador "Viajes abiertos vencidos" de `Programacion.js` se
 *     persistía en una clave de `localStorage` propia
 *     (`explora:programacion:vencidos:v1:<uid>`), distinta de este archivo
 *     -- una limitación que el propio encabezado v1.2.0 (RF-02) de
 *     `Programacion.js` dejaba anotada.
 *
 *   CAUSA RAÍZ
 *     Cuando se hizo RF-02, este archivo estaba fuera de su alcance ("leer
 *     para contexto, no modificar").
 *
 *   ALCANCE
 *     Campo booleano nuevo `soloVencidos`, podado en `podarPreferencias()`
 *     (comentario 10, más abajo) igual que `grupoActivo`/`ordenPor` -- no
 *     entra en `filtrosVacios()` ni en `aplicarFiltros()` porque no es un
 *     filtro que este archivo sepa aplicar (depende de los viajes, que
 *     `Programacion.js` no le pasa como extractor); se aplica aparte, en
 *     esa misma pantalla, después de `aplicarFiltros()`. La migración de la
 *     clave vieja vive en `Programacion.js` (`migrarSoloVencidosLegacy`),
 *     no acá.
 *
 *   LIMITACIONES CONOCIDAS
 *     Ninguna nueva -- mismo criterio de "nunca rompe" que el resto del
 *     archivo.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- filtros-listado` (ida y vuelta de
 *     `soloVencidos` en `leerPreferencias`/`guardarPreferencias`) y
 *     `CI=true npm test -- Programacion` (la migración de la clave vieja).
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-05) — `pantalla` NO ES UNA LISTA CERRADA EN TIEMPO DE EJECUCIÓN
 * -----------------------------------------------------------------------------
 *   V5 de las verificaciones previas de la tarea: `claveStorage()` arma la
 *   clave con un template string sobre el `pantalla` que le llega, sin
 *   validarlo contra ninguna lista — el JSDoc de `leerPreferencias()`/
 *   `guardarPreferencias()` decía `'pedidos'|'programacion'`, pero es un tipo
 *   documental, no una validación en código. El cambio mínimo para
 *   `ciclo_vida` (RF-05) es, entonces, actualizar ese JSDoc — no hizo falta
 *   tocar ninguna función.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (rediseño Organizaciones) — `verInactivas`
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El rediseño de `Organizaciones.js` (ver `pages/organizaciones/`) pide
 *     que la pastilla "Mostrar inactivas" persista entre sesiones, igual que
 *     el resto de sus filtros.
 *
 *   CAUSA RAÍZ
 *     No había un campo para un conmutador booleano suelto fuera de
 *     `filtros` -- mismo caso ya resuelto antes para `soloVencidos`
 *     (Programación) y `soloMaestraInactiva` (nuevo_tarifario).
 *
 *   ALCANCE
 *     Campo booleano nuevo `verInactivas`, mismo tratamiento que esos dos:
 *     podado en `podarPreferencias()` con `!!valor`, sin validación extra.
 *     `pantalla` suma `'organizaciones'` al JSDoc (documental, no es una
 *     lista cerrada en código -- ver el encabezado RF-05 de más arriba).
 *
 *   LIMITACIONES CONOCIDAS
 *     Ninguna nueva.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- filtros-listado` (ida y vuelta de `verInactivas`
 *     en `leerPreferencias`/`guardarPreferencias`).
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * 1. Fechas -- mismo criterio que `hoyISO()` de `logica-pedidos.js`: strings
 *    `YYYY-MM-DD` en hora LOCAL, comparados como string. Se duplica acá (en
 *    vez de importarla) a propósito: `logica-pedidos.js` importa
 *    `firebase/firestore`, y este archivo tiene que poder correr en Jest sin
 *    Firestore ni un DOM real -- es la condición para que sea "lógica pura".
 * -------------------------------------------------------------------------- */

export function hoyISO() {
  return aFechaISO(new Date());
}

function aFechaISO(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Parsea `YYYY-MM-DD` como fecha LOCAL (no UTC) -- evita el corrimiento de
 * un día que da `new Date('YYYY-MM-DD')` en algunos husos horarios. */
function aFechaLocal(fechaISO) {
  return new Date(`${fechaISO}T00:00:00`);
}

function sumarDias(fechaISO, dias) {
  const d = aFechaLocal(fechaISO);
  d.setDate(d.getDate() + dias);
  return aFechaISO(d);
}

function primerDiaDelMes(fechaISO) {
  const d = aFechaLocal(fechaISO);
  return aFechaISO(new Date(d.getFullYear(), d.getMonth(), 1));
}

function ultimoDiaDelMes(fechaISO) {
  const d = aFechaLocal(fechaISO);
  return aFechaISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/** Un `Timestamp` de Firestore (duck-typing sobre `.toDate`, sin importar el
 * SDK) a fecha local `YYYY-MM-DD`, o `null`. Lo usa el filtro de "fecha de
 * creación" de `Pedidos.js`. */
export function timestampAFechaISO(ts) {
  if (!ts || typeof ts.toDate !== 'function') return null;
  return aFechaISO(ts.toDate());
}

/**
 * 2. Los cuatro atajos de rango. `personalizado` no calcula nada -- el rango
 *    sale de `desde`/`hasta` tal cual los cargó el usuario, ver
 *    `resolverRango()`.
 *
 * @param {string} atajo 'hoy' | '7dias' | 'mes' | 'personalizado' | null
 * @param {string} [hoy] `YYYY-MM-DD`, por defecto `hoyISO()` -- parámetro
 *   explícito para que los tests no dependan del reloj de la máquina.
 * @returns {{desde: string|null, hasta: string|null}}
 */
export function rangoDeAtajo(atajo, hoy = hoyISO()) {
  if (atajo === 'hoy') return { desde: hoy, hasta: hoy };
  if (atajo === '7dias') return { desde: hoy, hasta: sumarDias(hoy, 6) };
  if (atajo === 'mes') return { desde: primerDiaDelMes(hoy), hasta: ultimoDiaDelMes(hoy) };
  return { desde: null, hasta: null };
}

/**
 * El rango efectivo de un filtro de fecha: si tiene un atajo fijo (no
 * "personalizado"), se RECALCULA cada vez a partir de `hoy` -- así "Próximos
 * 7 días" sigue siendo los próximos 7 días al día siguiente de guardarlo, no
 * los mismos siete días congelados. Si es "personalizado" o no tiene atajo,
 * se usan `desde`/`hasta` tal cual están guardados.
 *
 * @param {{atajo: string|null, desde: string|null, hasta: string|null}|null} filtroFecha
 * @param {string} [hoy]
 * @returns {{desde: string|null, hasta: string|null}}
 */
export function resolverRango(filtroFecha, hoy = hoyISO()) {
  if (!filtroFecha) return { desde: null, hasta: null };
  if (filtroFecha.atajo && filtroFecha.atajo !== 'personalizado') {
    return rangoDeAtajo(filtroFecha.atajo, hoy);
  }
  return { desde: filtroFecha.desde || null, hasta: filtroFecha.hasta || null };
}

/**
 * 3. ¿Una fecha cae dentro de un rango? Bordes INCLUSIVOS, los dos
 *    extremos opcionales. Sin fecha, no está en ningún rango -- una entrega
 *    sin `fecha_solicitada` no puede "caer" en un filtro de fecha.
 *
 * @param {string|null} fechaISO
 * @param {{desde: string|null, hasta: string|null}|null} rango
 * @returns {boolean}
 */
export function enRango(fechaISO, rango) {
  if (!fechaISO) return false;
  const { desde, hasta } = rango || {};
  if (desde && fechaISO < desde) return false;
  if (hasta && fechaISO > hasta) return false;
  return true;
}

/** ¿Este filtro de fecha tiene algo activo -- un atajo fijo, o fechas
 * cargadas a mano? */
function rangoActivo(filtroFecha) {
  if (!filtroFecha) return false;
  if (filtroFecha.atajo && filtroFecha.atajo !== 'personalizado') return true;
  return !!(filtroFecha.desde || filtroFecha.hasta);
}

/* -----------------------------------------------------------------------------
 * 4. Sentinela para "Sin asignar" en el filtro de transportista -- ver la
 *    tabla del prompt: "alguna entrega sin despacho vivo o con despacho vivo
 *    sin transportista". No es un ID de organización real, así que no puede
 *    colisionar con ninguno.
 * -------------------------------------------------------------------------- */
export const SIN_ASIGNAR = '__sin_asignar__';

/* -----------------------------------------------------------------------------
 * 5. Filtro vacío -- el estado inicial que arma cada pantalla.
 * -------------------------------------------------------------------------- */
export function filtrosVacios() {
  return {
    clientes: [],
    productos: [],
    tipos: [],
    creadoPor: [],
    transportistas: [],
    entrega: { atajo: null, desde: null, hasta: null },
    creacion: { atajo: null, desde: null, hasta: null },
    carga: { atajo: null, desde: null, hasta: null },
    soloSinCubrir: false,
    // v1.2.0 (nuevo_tarifario) -- campos nuevos, ADITIVOS: las pantallas que
    // ya existen (Pedidos.js, Programacion.js, CicloVida.js) no pasan
    // extractor para ellos, así que quedan inertes -- ver el criterio de
    // "extractor opcional" del comentario 7 más abajo.
    km: { desde: null, hasta: null },
    brecha: [],
    actualizacion: { atajo: null, desde: null, hasta: null },
    soloMaestraInactiva: false,
  };
}

/**
 * 6. ¿Hay algún filtro activo? Determina si se muestra "Limpiar filtros" --
 *    NO incluye el texto libre ni la pastilla de estado, eso lo suma la
 *    pantalla (son controles que viven fuera de este objeto).
 *
 * @param {Object} filtros
 * @returns {boolean}
 */
export function filtrosActivos(filtros) {
  if (!filtros) return false;
  const listas = ['clientes', 'productos', 'tipos', 'creadoPor', 'transportistas', 'brecha'];
  if (listas.some(k => (filtros[k] || []).length > 0)) return true;
  if (rangoActivo(filtros.entrega)) return true;
  if (rangoActivo(filtros.creacion)) return true;
  if (rangoActivo(filtros.carga)) return true;
  if (rangoActivo(filtros.actualizacion)) return true;
  if (rangoNumericoActivo(filtros.km)) return true;
  if (filtros.soloSinCubrir) return true;
  if (filtros.soloMaestraInactiva) return true;
  return false;
}

/* -----------------------------------------------------------------------------
 * 7. aplicarFiltros() -- genérica: cada pantalla pasa sus propios
 *    extractores. Un extractor que la pantalla no pasa deja ese filtro
 *    inerte (siempre pasa), en vez de romper -- así Pedidos.js no necesita
 *    saber nada de `transportistaIdsVivos` y Programacion.js no necesita
 *    `fechaCreacion`.
 * -------------------------------------------------------------------------- */

function pasaSeleccionMultiple(seleccion, extractor, item) {
  if (!seleccion || seleccion.length === 0) return true;
  if (!extractor) return true;
  return seleccion.includes(extractor(item));
}

function pasaTransportistas(seleccion, extractores, item) {
  if (!seleccion || seleccion.length === 0) return true;
  if (!extractores.transportistaIdsVivos) return true;
  const idsVivos = extractores.transportistaIdsVivos(item) || [];
  const sinAsignar = extractores.tieneEntregaSinAsignar ? !!extractores.tieneEntregaSinAsignar(item) : false;
  return seleccion.some(sel => (sel === SIN_ASIGNAR ? sinAsignar : idsVivos.includes(sel)));
}

/** Filtro de rango sobre una LISTA de fechas del ítem (entrega/carga): pasa
 * si ALGUNA cae en el rango. */
function pasaRangoLista(filtroFecha, extractor, item) {
  if (!rangoActivo(filtroFecha)) return true;
  if (!extractor) return true;
  const rango = resolverRango(filtroFecha);
  const fechas = extractor(item) || [];
  return fechas.some(f => enRango(f, rango));
}

/** Filtro de rango sobre UNA sola fecha del ítem (creación). */
function pasaRangoUnico(filtroFecha, extractor, item) {
  if (!rangoActivo(filtroFecha)) return true;
  if (!extractor) return true;
  const rango = resolverRango(filtroFecha);
  return enRango(extractor(item), rango);
}

/** v1.2.0 (nuevo_tarifario) -- ¿Este filtro de rango NUMÉRICO (km) tiene algo
 * activo? Mismo criterio que `rangoActivo()`, sin atajos: solo `desde`/
 * `hasta` cargados. */
function rangoNumericoActivo(rango) {
  if (!rango) return false;
  return (rango.desde !== null && rango.desde !== undefined)
    || (rango.hasta !== null && rango.hasta !== undefined);
}

/** v1.2.0 (nuevo_tarifario) -- Filtro de rango NUMÉRICO (p.ej. "km"), análogo
 * a `pasaRangoUnico()` pero sin atajos ni fechas: `extractor(item)` tiene que
 * caer en `[desde, hasta]`, bordes inclusivos, los dos extremos opcionales.
 * Sin extractor o sin rango activo, no filtra -- mismo criterio de
 * "extractor opcional" que el resto de los filtros. */
function pasaRangoNumerico(rango, extractor, item) {
  if (!rangoNumericoActivo(rango)) return true;
  if (!extractor) return true;
  const valor = extractor(item);
  if (valor === null || valor === undefined || Number.isNaN(valor)) return false;
  const { desde, hasta } = rango || {};
  if (desde !== null && desde !== undefined && valor < desde) return false;
  if (hasta !== null && hasta !== undefined && valor > hasta) return false;
  return true;
}

/**
 * @param {Array} items
 * @param {Object} filtros Con la forma de `filtrosVacios()`
 * @param {Object} extractores Funciones `(item) => valor`, todas opcionales:
 *   `clienteId`, `productoId`, `tipo`, `creadoPorUid` (selección múltiple),
 *   `transportistaIdsVivos` + `tieneEntregaSinAsignar` (transportista),
 *   `fechasEntrega` (lista, filtro "entrega"), `fechaCreacion` (única,
 *   filtro "creación"), `fechasCarga` (lista, filtro "carga"),
 *   `tieneSinCubrir` (booleano, filtro "Solo sin cubrir"), `km` (numérico,
 *   filtro "km"), `brecha` (selección múltiple), `fechaActualizacion`
 *   (única, filtro "actualización"), `tieneMaestraInactiva` (booleano,
 *   filtro "Solo maestra inactiva") -- estos cuatro últimos son de
 *   `nuevo_tarifario` (v1.2.0), inertes para las pantallas que no pasan su
 *   extractor.
 * @returns {Array}
 */
export function aplicarFiltros(items, filtros, extractores = {}) {
  const f = filtros || filtrosVacios();
  return (items || []).filter(item => {
    if (!pasaSeleccionMultiple(f.clientes, extractores.clienteId, item)) return false;
    if (!pasaSeleccionMultiple(f.productos, extractores.productoId, item)) return false;
    if (!pasaSeleccionMultiple(f.tipos, extractores.tipo, item)) return false;
    if (!pasaSeleccionMultiple(f.creadoPor, extractores.creadoPorUid, item)) return false;
    if (!pasaTransportistas(f.transportistas, extractores, item)) return false;
    if (!pasaRangoLista(f.entrega, extractores.fechasEntrega, item)) return false;
    if (!pasaRangoUnico(f.creacion, extractores.fechaCreacion, item)) return false;
    if (!pasaRangoLista(f.carga, extractores.fechasCarga, item)) return false;
    if (f.soloSinCubrir && extractores.tieneSinCubrir && !extractores.tieneSinCubrir(item)) return false;
    if (!pasaRangoNumerico(f.km, extractores.km, item)) return false;
    if (!pasaSeleccionMultiple(f.brecha, extractores.brecha, item)) return false;
    if (!pasaRangoUnico(f.actualizacion, extractores.fechaActualizacion, item)) return false;
    if (f.soloMaestraInactiva && extractores.tieneMaestraInactiva && !extractores.tieneMaestraInactiva(item)) return false;
    return true;
  });
}

/* -----------------------------------------------------------------------------
 * 8. comparador() -- "sin dato al final" en los dos sentidos, desempate
 *    estable por número de pedido.
 * -------------------------------------------------------------------------- */

function esVacio(v) {
  return v === null || v === undefined || v === '';
}

/**
 * El valor a comparar para cada criterio. Los cuatro primeros ya existían en
 * `comparadorDe()` de `Pedidos.js` (retirado de ahí, ver el encabezado de
 * este archivo) -- ESTE es el único lugar que decide, ahora, cómo se
 * ordena cada uno.
 *
 * "cliente" -- ÚNICA diferencia real con el comportamiento anterior: antes,
 * un pedido con `cliente_org_id` apuntando a una organización borrada
 * ordenaba con `''` (string vacío), que en ascendente queda ANTES que
 * cualquier nombre real -- un efecto colateral de `localeCompare`, no una
 * decisión. Acá, sin cliente resuelto, el pedido directamente no tiene
 * "dato" para este criterio y se manda al final -- la regla explícita del
 * prompt ("sin dato al final, en los dos sentidos") que se le aplica a los
 * seis criterios por igual. Es una organización borrada con pedidos vivos;
 * no se probó en producción porque no ocurre hoy.
 */
function valorDeOrden(criterio, item, extractores) {
  switch (criterio) {
    case 'entrega':   return extractores.fechaEntregaProxima ? extractores.fechaEntregaProxima(item) : null;
    case 'creacion':  return extractores.fechaCreacionMillis ? extractores.fechaCreacionMillis(item) : null;
    case 'cliente':   return extractores.clienteNombre ? extractores.clienteNombre(item) : null;
    case 'ov':        return extractores.ov ? extractores.ov(item) : null;
    case 'producto':  return extractores.productoNombre ? extractores.productoNombre(item) : null;
    case 'creadoPor': return extractores.creadoPorNombre ? extractores.creadoPorNombre(item) : null;
    case 'carga':     return extractores.fechaCargaProxima ? extractores.fechaCargaProxima(item) : null;
    // v1.2.0 (nuevo_tarifario) -- mismo patrón que los casos de arriba, sin
    // lógica de comparación nueva.
    case 'origen':       return extractores.origen ? extractores.origen(item) : null;
    case 'destino':      return extractores.destino ? extractores.destino(item) : null;
    case 'km':           return extractores.km ? extractores.km(item) : null;
    case 'tarifa':       return extractores.tarifa ? extractores.tarifa(item) : null;
    case 'brecha':       return extractores.brecha ? extractores.brecha(item) : null;
    case 'actualizacion': return extractores.actualizacion ? extractores.actualizacion(item) : null;
    default:          return null;
  }
}

function comparacionNatural(criterio, va, vb) {
  if (typeof va === 'number' && typeof vb === 'number') return va - vb;
  const opciones = criterio === 'ov' ? { numeric: true } : undefined;
  return String(va).localeCompare(String(vb), 'es', opciones);
}

/**
 * @param {string} criterio 'entrega'|'creacion'|'cliente'|'ov'|'producto'|'creadoPor'|'carga'
 * @param {'asc'|'desc'} sentido
 * @param {Object} extractores Ver `valorDeOrden()`. Además necesita
 *   `numero(item)` para el desempate -- sin ella, el desempate no hace nada
 *   (siempre 0, orden tal cual venía).
 * @returns {(a: any, b: any) => number}
 */
export function comparador(criterio, sentido, extractores = {}) {
  const factor = sentido === 'desc' ? -1 : 1;
  const numeroDe = extractores.numero || (() => '');

  return (a, b) => {
    const va = valorDeOrden(criterio, a, extractores);
    const vb = valorDeOrden(criterio, b, extractores);
    const aVacio = esVacio(va);
    const bVacio = esVacio(vb);

    let cmp;
    if (aVacio && bVacio) {
      cmp = 0;
    } else if (aVacio) {
      cmp = 1;   // "a" sin dato: siempre al final, sin importar el sentido
    } else if (bVacio) {
      cmp = -1;
    } else {
      cmp = comparacionNatural(criterio, va, vb) * factor;
    }

    if (cmp !== 0) return cmp;
    return String(numeroDe(a)).localeCompare(String(numeroDe(b)), 'es', { numeric: true });
  };
}

/* -----------------------------------------------------------------------------
 * 9. Persistencia -- `localStorage`, por usuario y por pantalla.
 * -------------------------------------------------------------------------- */

const VERSION_PREFERENCIAS = 1;
const ATAJOS_VALIDOS = ['hoy', '7dias', 'mes', 'personalizado'];

function claveStorage(pantalla, uid) {
  return `explora:listado:v1:${pantalla}:${uid}`;
}

function esFechaISO(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function podarRango(f) {
  if (!f || typeof f !== 'object') return { atajo: null, desde: null, hasta: null };
  return {
    atajo: ATAJOS_VALIDOS.includes(f.atajo) ? f.atajo : null,
    desde: esFechaISO(f.desde) ? f.desde : null,
    hasta: esFechaISO(f.hasta) ? f.hasta : null,
  };
}

/** v1.2.0 (nuevo_tarifario) -- poda del rango NUMÉRICO (km): sin atajos,
 * `desde`/`hasta` solo se conservan si son `number` (no `NaN`), si no,
 * `null` -- mismo criterio de "descartar en silencio" que `podarRango()`. */
function esNumeroValido(v) {
  return typeof v === 'number' && !Number.isNaN(v);
}

function podarRangoNumerico(f) {
  if (!f || typeof f !== 'object') return { desde: null, hasta: null };
  return {
    desde: esNumeroValido(f.desde) ? f.desde : null,
    hasta: esNumeroValido(f.hasta) ? f.hasta : null,
  };
}

/** Selección múltiple guardada, podada contra los IDs vigentes. Sin lista de
 * válidos para ese campo (la pantalla no la pasó), se conserva tal cual --
 * solo se exige que sean strings. `SIN_ASIGNAR` siempre se conserva: no es
 * un ID que pueda "dejar de existir". */
function podarSeleccion(seleccion, validos) {
  if (!Array.isArray(seleccion)) return [];
  const limpia = seleccion.filter(x => typeof x === 'string');
  if (!validos) return limpia;
  return limpia.filter(id => id === SIN_ASIGNAR || validos.has(id));
}

/**
 * Poda un objeto leído de `localStorage` contra lo que hoy es válido.
 * Cualquier campo con forma equivocada se descarta en silencio, sin tirar
 * abajo el resto -- un `localStorage` corrupto o de otra versión no puede
 * dejar la pantalla sin poder renderizar.
 *
 * @param {Object} datos Lo que salió de `JSON.parse`
 * @param {Object} validos `{ clientes?: Set, productos?: Set, tipos?: Set,
 *   creadoPor?: Set, transportistas?: Set }` -- los IDs que existen HOY en
 *   la pantalla que llama. Un campo sin `Set` correspondiente no se filtra.
 * @returns {Object} Con las claves que `leerPreferencias()` devuelve
 */
function podarPreferencias(datos, validos) {
  const out = {};

  if (datos.filtros && typeof datos.filtros === 'object') {
    const f = datos.filtros;
    out.filtros = {
      clientes: podarSeleccion(f.clientes, validos.clientes),
      productos: podarSeleccion(f.productos, validos.productos),
      tipos: podarSeleccion(f.tipos, validos.tipos),
      creadoPor: podarSeleccion(f.creadoPor, validos.creadoPor),
      transportistas: podarSeleccion(f.transportistas, validos.transportistas),
      entrega: podarRango(f.entrega),
      creacion: podarRango(f.creacion),
      carga: podarRango(f.carga),
      soloSinCubrir: !!f.soloSinCubrir,
      // v1.2.0 (nuevo_tarifario) -- mismo tratamiento que `creacion` (rango
      // de fecha única) para `actualizacion`, y el equivalente numérico para
      // `km`. `brecha` no tiene un Set de válidos que podar (es texto libre
      // fijo, mismo caso que `tipos` cuando no se pasa `validos.tipos`) y
      // `soloMaestraInactiva` es un booleano simple, mismo trato que
      // `soloSinCubrir`.
      km: podarRangoNumerico(f.km),
      brecha: podarSeleccion(f.brecha, validos.brecha),
      actualizacion: podarRango(f.actualizacion),
      soloMaestraInactiva: !!f.soloMaestraInactiva,
    };
  }

  if (typeof datos.grupoActivo === 'string') out.grupoActivo = datos.grupoActivo;
  if (typeof datos.ordenPor === 'string') out.ordenPor = datos.ordenPor;
  if (datos.ordenSentido === 'asc' || datos.ordenSentido === 'desc') out.ordenSentido = datos.ordenSentido;
  if (typeof datos.alcance === 'string') out.alcance = datos.alcance;
  // 10. v1.2.0 (Paso 0.2 de RF-02) -- "Viajes abiertos vencidos", de
  //     Programación, pasa a vivir en el MISMO objeto de preferencias que el
  //     resto de los filtros, en vez de su propia clave de `localStorage`
  //     (limitación que dejaba el encabezado v1.2.0 (RF-02) de
  //     `Programacion.js`). No es parte de `filtros` -- es un campo suelto,
  //     mismo nivel que `grupoActivo`/`ordenPor`, porque no participa de
  //     `aplicarFiltros()` (se aplica aparte, sobre el resultado). La
  //     migración de la clave vieja de `localStorage` corre en
  //     `Programacion.js` (`migrarSoloVencidosLegacy`), no acá: este archivo
  //     solo sabe leer/podar el campo nuevo.
  if (typeof datos.soloVencidos === 'boolean') out.soloVencidos = datos.soloVencidos;
  // v1.2.0 (rediseño Organizaciones) -- mismo trato que `soloVencidos`.
  if (typeof datos.verInactivas === 'boolean') out.verInactivas = datos.verInactivas;

  return out;
}

/**
 * Lee las preferencias guardadas de una pantalla para un usuario. `null` si
 * no hay nada, si está corrupto, o si es de otra versión -- en todos los
 * casos la pantalla arranca con sus valores por defecto de siempre, nunca
 * rompe.
 *
 * @param {'pedidos'|'programacion'|'ciclo_vida'|'nuevo_tarifario'|'organizaciones'} pantalla
 * @param {string} uid
 * @param {Object} [validos] Ver `podarPreferencias()`
 * @returns {Object|null}
 */
export function leerPreferencias(pantalla, uid, validos = {}) {
  if (!uid) return null;
  try {
    const crudo = window.localStorage.getItem(claveStorage(pantalla, uid));
    if (!crudo) return null;
    const datos = JSON.parse(crudo);
    if (!datos || typeof datos !== 'object' || datos.v !== VERSION_PREFERENCIAS) return null;
    return podarPreferencias(datos, validos);
  } catch (err) {
    return null;
  }
}

/**
 * Guarda las preferencias de una pantalla para un usuario. Nunca tira: un
 * `localStorage` lleno o deshabilitado (modo privado) no puede romper el
 * filtrado, que ya funcionó en memoria antes de intentar persistir.
 *
 * NO incluye el texto del buscador -- a propósito, ver el prompt.
 *
 * @param {'pedidos'|'programacion'|'ciclo_vida'|'nuevo_tarifario'|'organizaciones'} pantalla
 * @param {string} uid
 * @param {Object} preferencias `{ filtros, grupoActivo, ordenPor,
 *   ordenSentido, alcance? }`
 */
export function guardarPreferencias(pantalla, uid, preferencias) {
  if (!uid) return;
  try {
    window.localStorage.setItem(
      claveStorage(pantalla, uid),
      JSON.stringify({ v: VERSION_PREFERENCIAS, ...preferencias })
    );
  } catch (err) {
    // Silencio a propósito -- ver el encabezado del archivo.
  }
}
