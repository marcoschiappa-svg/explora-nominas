/* =============================================================================
 * calculo-tarifario.js — v1.2.0 (RF-09)
 * =============================================================================
 *
 * SÍNTOMA
 *   Todo el cálculo del tarifario vivía dentro de `Tarifario.js`, mezclado
 *   con el estado de React y con las escrituras a Firestore: la
 *   interpolación de la tabla CATAC (`getCatacTabla`), la elección de la
 *   ruta vecina del Generador, el factor compuesto de CATAMP y el redondeo.
 *   Nada de eso se podía probar sin montar la pantalla entera, así que no
 *   había un solo test sobre la regla que decide cuánto sale un flete.
 *
 * CAUSA RAÍZ
 *   La pantalla nació antes que el resto del modelo nuevo (v1.0, junio 2026)
 *   y creció como un archivo único. No existía la separación
 *   "lógica pura / lógica con Firestore / pantalla" que el portal usa hoy
 *   (`logica-*.js`, `filtros-listado.js`, `logica-ciclo-vida.js`).
 *
 * ALCANCE
 *   Lógica PURA, sin React y sin Firestore. Se muda acá, SIN cambiar ningún
 *   resultado:
 *
 *     · `getCatacTabla(tabla, km)` — el valor CATAC de un km, interpolando
 *       linealmente entre los dos km más cercanos que la tabla sí tiene.
 *     · `calcularGenerador(...)` — ruta vecina más cercana en km,
 *       `ratio = tarifa_vigente / catac_ref`, `tarifaSugerida = catacBase ×
 *       ratio`, brecha contra CATAC, rutas similares a ±100 km y aviso de
 *       producto distinto.
 *     · `factorCompuesto(indices)` — el factor de CATAMP, multiplicativo y
 *       NO aditivo.
 *     · `aplicarFactor` / `aplicarPorcentaje` — el redondeo a 2 decimales
 *       que ya usaban el ajuste global y CATAMP.
 *
 *   CAMBIO DE COMPORTAMIENTO DELIBERADO, EL ÚNICO: el Generador solo usa
 *   RUTAS PARÁMETRO ACTIVAS como vecinas. Antes usaba el array entero de
 *   `portal/rutas`, donde no existía la distinción. Filtrar es
 *   responsabilidad de quien llama (`logica-tarifario.js#rutasParametro()`),
 *   para que este módulo siga siendo puro y no sepa qué es una "ruta
 *   parámetro".
 *
 * LIMITACIONES CONOCIDAS
 *   · `getCatacTabla` ordena las claves de la tabla en cada llamada. Con
 *     1500 km eso es O(n log n) por consulta; la pantalla la llama una vez
 *     por fila, así que en la práctica no se nota. No se cachea porque la
 *     tabla puede cambiar (el importador de CATAC la reemplaza entera) y una
 *     caché mal invalidada sería peor que el costo.
 *   · La "ruta vecina" es la más cercana en KM, sin mirar el producto ni la
 *     categoría. Cuando el producto difiere, se avisa (`productoDifiere`)
 *     pero NO se descarta la vecina: es el comportamiento que ya tenía la
 *     pantalla y cambiarlo sería una decisión de negocio, no de refactor.
 *   · `aplicarFactor` redondea a 2 decimales con `Math.round(x * 100) / 100`,
 *     que arrastra el error de punto flotante del binario (el mismo que ya
 *     tenía la pantalla). Para pesos por tonelada es irrelevante, pero no es
 *     aritmética decimal exacta.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- calculo-tarifario` — ver `calculo-tarifario.test.js`:
 *   interpolación y bordes de la tabla CATAC, elección de la vecina, ratio y
 *   tarifa sugerida con los números de las rutas reales, CATAMP compuesto
 *   (el ejemplo de la pantalla: +2,26 % × +6,85 % = ×1,0926) y redondeo.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-09) — NuevoTarifario: `calcularTarifaDerivada`
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Una ruta derivada (antes "referencia") congelaba un ratio contra la
 *     vecina más cercana al momento de crearla (`calculo: {ratio, ...}`, en
 *     `logica-tarifario.js`). Si la maestra de la que dependía cambiaba de
 *     tarifa, o cambiaba la tabla CATAC, la derivada quedaba desactualizada
 *     en silencio.
 *
 *   CAUSA RAÍZ
 *     El ratio se calculaba UNA vez, al crear la ruta, y se guardaba como
 *     dato — no como fórmula.
 *
 *   ALCANCE
 *     `calcularTarifaDerivada(derivada, maestra, tablaCatac)` (nueva): la
 *     misma fórmula del Generador (`catac(km) × ratio`), pero con la maestra
 *     ELEGIDA y FIJA (`ruta_maestra_id`) en vez de la vecina más cercana
 *     recalculada — `ratio = tarifa_vigente_maestra / catac(km_maestra)`,
 *     `tarifa = catac(km_derivada) × ratio`. Se llama en cada render de la
 *     pantalla, nunca se guarda: así la derivada se mueve sola cuando cambia
 *     la maestra o la tabla CATAC. Si la maestra no existe o
 *     `maestra.estado !== 'activo'`, devuelve `{ tarifa: null,
 *     maestraInactiva: true }` — la pantalla lo muestra como "Maestra
 *     inactiva", sin inventar un número.
 *
 *   LIMITACIONES CONOCIDAS
 *     Si la tabla CATAC no tiene valor para el km de la maestra o de la
 *     derivada (tabla vacía), devuelve `tarifa: null` sin marcar
 *     `maestraInactiva` — es un caso distinto (falta la tabla, no la
 *     maestra) que la pantalla puede distinguir por separado si hace falta.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm test -- calculo-tarifario`: la fórmula con los números de
 *     una ruta real, que la tarifa cambia sola al cambiar `tarifa_vigente`
 *     de la maestra y al cambiar la tabla CATAC, y el caso de maestra
 *     inactiva.
 * ========================================================================== */

/* -----------------------------------------------------------------------------
 * Tabla CATAC
 * -------------------------------------------------------------------------- */

/**
 * 1. El valor CATAC para un km. Copiado tal cual de `Tarifario.js` — misma
 *    implementación, mismos resultados.
 *
 *    Si el km está en la tabla, se devuelve directo. Si no, se interpola
 *    linealmente entre el km inmediatamente anterior y el inmediatamente
 *    posterior que sí estén. Fuera de los extremos NO se extrapola: se
 *    devuelve el valor del borde más cercano, porque extrapolar un convenio
 *    de flete inventaría un número que nadie firmó.
 *
 * @param {Object<number|string, number>} tabla `{ km: valor }`
 * @param {number} km
 * @returns {number|undefined} `undefined` solo si la tabla está vacía
 */
export function getCatacTabla(tabla, km) {
  const k = Math.round(km);
  if (!tabla) return undefined;
  if (tabla[k]) return tabla[k];

  const ks = Object.keys(tabla).map(Number).sort((a, b) => a - b);
  const lo = ks.filter(x => x <= k).pop();
  const hi = ks.filter(x => x >= k).shift();

  if (!lo) return tabla[hi];
  if (!hi) return tabla[lo];
  return tabla[lo] + (tabla[hi] - tabla[lo]) * (k - lo) / (hi - lo);
}

/* -----------------------------------------------------------------------------
 * Redondeo y porcentajes
 * -------------------------------------------------------------------------- */

/**
 * 2. El redondeo a 2 decimales que ya usaban el ajuste global, CATAMP y la
 *    aprobación desde el Generador. Estaba escrito tres veces con la misma
 *    expresión (`Math.round(x * 100) / 100`); acá queda una sola.
 */
export function redondear2(valor) {
  return Math.round(Number(valor) * 100) / 100;
}

/** Aplica un factor multiplicativo y redondea a 2 decimales. */
export function aplicarFactor(valor, factor) {
  return redondear2(Number(valor) * Number(factor));
}

/** Aplica un porcentaje (+6.85 → ×1.0685) y redondea a 2 decimales. */
export function aplicarPorcentaje(valor, porcentaje) {
  return aplicarFactor(valor, 1 + Number(porcentaje) / 100);
}

/**
 * 3. El factor compuesto de CATAMP: los índices mensuales se MULTIPLICAN, no
 *    se suman. Es la regla que la pantalla explica en su propio texto
 *    ("+2.26% × +6.85% = ×1.0926, no +9.11%") y que ahora vive acá, testeada.
 *
 *    Las filas sin índice numérico se descartan en silencio: la grilla de la
 *    pantalla nace con dos filas vacías y no tiene sentido tratarlas como un
 *    error.
 *
 * @param {Array<{mes?: string, indice: number|string}>} filas
 * @returns {{filas: Array, factor: number, porcentaje: number}}
 */
export function factorCompuesto(filas) {
  const validas = (filas || []).filter(
    f => f && f.indice !== '' && f.indice !== null && f.indice !== undefined
         && !isNaN(parseFloat(f.indice))
  );
  const factor = validas.reduce((f, m) => f * (1 + parseFloat(m.indice) / 100), 1);
  return { filas: validas, factor, porcentaje: (factor - 1) * 100 };
}

/**
 * Lo mismo, más el chequeo del techo de alerta. El techo AVISA, no bloquea —
 * decisión de diseño que ya tenía la pantalla y que no cambia.
 */
export function evaluarCatamp(filas, techo) {
  const base = factorCompuesto(filas);
  const t = parseFloat(techo) || 0;
  return { ...base, techo: t, superaTecho: t > 0 && base.porcentaje > t };
}

/* -----------------------------------------------------------------------------
 * Generador
 * -------------------------------------------------------------------------- */

/** Reduce un texto a su forma comparable, para el aviso de producto distinto. */
function comparable(texto) {
  return String(texto || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 4. El cálculo del Generador. Mismo algoritmo que tenía `Tarifario.js`
 *    dentro de su `useEffect`, con dos diferencias de FORMA (ninguna de
 *    resultado):
 *
 *      a. Recibe las rutas vecinas como parámetro en vez de leerlas del
 *         estado de React. Quien llama pasa SOLO rutas parámetro activas
 *         (ver el ALCANCE del encabezado).
 *      b. Cada ruta vecina se describe con `{ km, tarifa_vigente, catac_ref,
 *         producto_nombre }` — los campos del modelo nuevo — en vez de
 *         `{ km, vigente, catac, producto }` del array legacy.
 *
 *    Devuelve `null` cuando no hay con qué calcular (sin km válido, sin
 *    tabla CATAC o sin ninguna ruta vecina), en vez de romper: es lo que
 *    hacía la pantalla con `setGenResult(null)`.
 *
 * @param {Object} params
 * @param {number|string} params.km
 * @param {string} [params.productoNombre] Para el aviso de producto distinto
 * @param {Array} params.rutas Rutas parámetro activas
 * @param {Object} params.tablaCatac
 * @param {number} [params.kmMaximo] Tope de la pantalla (1500 por convenio)
 * @returns {Object|null}
 */
export function calcularGenerador({ km, productoNombre = '', rutas = [], tablaCatac, kmMaximo = 1500 }) {
  const kmNum = parseFloat(km);
  if (!kmNum || kmNum < 1 || kmNum > kmMaximo) return null;
  if (!tablaCatac) return null;

  // Una vecina sin CATAC de referencia no sirve: el ratio sería una división
  // por cero o por `undefined`. Se descarta en vez de contaminar el cálculo.
  const candidatas = (rutas || []).filter(
    r => r && Number(r.km) > 0 && Number(r.catac_ref) > 0 && Number(r.tarifa_vigente) > 0
  );
  if (candidatas.length === 0) return null;

  const catacBase = getCatacTabla(tablaCatac, kmNum);
  if (!catacBase) return null;

  // 5. La vecina es la más cercana en km. `reduce` con "estrictamente menor"
  //    conserva el criterio de desempate que ya tenía la pantalla: ante dos
  //    rutas a la misma distancia, gana la PRIMERA de la lista.
  const vecina = candidatas.reduce(
    (a, b) => (Math.abs(b.km - kmNum) < Math.abs(a.km - kmNum) ? b : a)
  );

  const ratio = Number(vecina.tarifa_vigente) / Number(vecina.catac_ref);
  const tarifaSugerida = catacBase * ratio;
  const brechaVsCatac = (tarifaSugerida - catacBase) / catacBase * 100;

  const similares = candidatas
    .filter(r => Math.abs(r.km - kmNum) <= 100)
    .sort((a, b) => Math.abs(a.km - kmNum) - Math.abs(b.km - kmNum))
    .slice(0, 6);

  // 6. El aviso de producto distinto compara los nombres normalizados. "Otro"
  //    no avisa nunca: es el producto genérico, cualquier referencia le sirve.
  const productoDifiere =
    !!productoNombre
    && productoNombre !== 'Otro'
    && comparable(vecina.producto_nombre) !== comparable(productoNombre);

  return {
    km: Math.round(kmNum),
    productoNombre,
    catacBase,
    vecina,
    ratio,
    tarifaSugerida,
    brechaVsCatac,
    similares,
    productoDifiere,
  };
}

/** La brecha de una tarifa contra el CATAC de su km, en porcentaje. */
export function brechaContraCatac(tarifaVigente, catacRef) {
  if (!catacRef) return null;
  return (Number(tarifaVigente) - Number(catacRef)) / Number(catacRef) * 100;
}

/* -----------------------------------------------------------------------------
 * NuevoTarifario — rutas derivadas
 * -------------------------------------------------------------------------- */

/**
 * 7. La tarifa de una ruta DERIVADA, SIEMPRE calculada — nunca se lee de un
 *    campo guardado (ver el bloque de encabezado "NuevoTarifario" más
 *    arriba). Mismo ratio que usa el Generador, pero contra una maestra
 *    ELEGIDA y FIJA, no la vecina más cercana recalculada en cada llamada.
 *
 * @param {Object} derivada `{ km }`
 * @param {Object|null} maestra `{ km, tarifa_vigente, estado }`
 * @param {Object} tablaCatac
 * @returns {{tarifa: number|null, ratio: number|null, maestraInactiva: boolean}}
 */
export function calcularTarifaDerivada(derivada, maestra, tablaCatac) {
  if (!maestra || maestra.estado !== 'activo') {
    return { tarifa: null, ratio: null, maestraInactiva: true };
  }

  const catacMaestra = getCatacTabla(tablaCatac, maestra.km);
  const catacDerivada = getCatacTabla(tablaCatac, (derivada || {}).km);
  if (!catacMaestra || !catacDerivada) {
    return { tarifa: null, ratio: null, maestraInactiva: false };
  }

  const ratio = Number(maestra.tarifa_vigente) / catacMaestra;
  return { tarifa: redondear2(catacDerivada * ratio), ratio, maestraInactiva: false };
}
