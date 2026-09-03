/* =============================================================================
 * buscar-domicilios.js — Autorrellenado de direcciones con tolerancia a erratas
 * =============================================================================
 *
 * EL PROBLEMA QUE RESUELVE
 *   En los 215 pedidos relevados hay 50 direcciones distintas para 34 lugares
 *   reales. La planta de Explora está escrita de siete formas. Hay un "Manual
 *   Alberti" que debería decir "Manuel", un "Benabidez" que es "Benavídez", y
 *   un "$ de Enero" que es "4 de Enero".
 *
 *   Nadie eligió mal a propósito: escribieron la dirección y guardaron. Este
 *   archivo es lo que se pone en el medio para que eso deje de pasar.
 *
 * -----------------------------------------------------------------------------
 * CALLE Y CIUDAD SE COMPARAN POR SEPARADO
 * -----------------------------------------------------------------------------
 *   Concatenarlas no funciona. Este caso real lo demuestra:
 *
 *       escrito:  "irigoyen 2933, PGSM"
 *       existe:   "Yrigoyen 2933, Puerto General San Martín"
 *
 *   Como una sola cadena hay que insertar 21 caracteres para pasar de
 *   "irigoyen pgsm" a "yrigoyen puerto general san martin": la similitud cae a
 *   0,38 y la dirección no se sugiere. La errata de UNA letra en la calle queda
 *   ahogada por la abreviatura de la ciudad.
 *
 *   Por separado, la calle da 0,88 y con eso alcanza.
 *
 * -----------------------------------------------------------------------------
 * SUGERIR Y ADVERTIR SON DOS COSAS DISTINTAS
 * -----------------------------------------------------------------------------
 *   SUGERIR es generoso: alcanza con que se parezca la calle O la ciudad.
 *   Mostrar de más no cuesta nada, la lista se ignora sola. Y quien escribió
 *   solo la ciudad todavía tiene que ver qué hay cargado ahí.
 *
 *   ADVERTIR es exigente: exige que se parezca LA CALLE, y que el número
 *   coincida exacto. Interrumpir de más molesta, y una advertencia que aparece
 *   siempre se aprende a ignorar en dos días.
 *
 *   La diferencia importa: "Sarmiento 100, Rosario" y "Mitre 100, Rosario"
 *   comparten ciudad y número. Sugerirlas está bien; frenar el alta para
 *   preguntar si son la misma, no.
 *
 * -----------------------------------------------------------------------------
 * POR QUE EL NUMERO SE COMPARA EXACTO
 * -----------------------------------------------------------------------------
 *   Las direcciones rurales se distinguen justamente por ahí:
 *
 *       Ruta 188 KM 188    Rojas       — LABORATORIO DEGSER
 *       Ruta 188 KM 80,5   Pergamino   — PALAVERSICH Y CIA
 *
 *   Como texto son casi idénticas. Son dos lugares a 108 km. Si el número
 *   entrara en la comparación difusa, el sistema las ofrecería como la misma.
 *
 *   El costo: si alguien escribe 574 donde va 547, no se detecta. Es aceptable
 *   —es el mismo caso del 514 de PAE, que se descubrió mirando los datos, no
 *   automáticamente.
 * ========================================================================== */

import { claveNormalizada } from './mapa-normalizacion';

/* -----------------------------------------------------------------------------
 * Similitud
 * -------------------------------------------------------------------------- */

/**
 * Distancia de Levenshtein: cuántas ediciones de un carácter hacen falta para
 * convertir una cadena en la otra.
 *
 * Implementación por filas: usa memoria proporcional a la cadena más corta en
 * vez de una matriz completa. Con un recálculo por cada tecla, importa.
 */
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
      fila[j] = Math.min(
        fila[j] + 1,                                   // borrar
        fila[j - 1] + 1,                               // insertar
        anterior + (a[i - 1] === b[j - 1] ? 0 : 1)     // sustituir
      );
      anterior = temp;
    }
  }
  return fila[b.length];
}

/** Similitud de 0 a 1, relativa a la cadena más larga. 1 = idénticas. */
function similitud(a, b) {
  const largo = Math.max(a.length, b.length);
  if (largo === 0) return 1;
  return 1 - distancia(a, b) / largo;
}

/**
 * Compara dos textos con tolerancia, tratando el prefijo y la subcadena como
 * coincidencia plena.
 *
 * Quien escribió "yrigo" tiene que ver "Yrigoyen" primero de la lista.
 *
 * El mínimo de tres caracteres evita que "SA" matchee con cualquier cosa que
 * tenga esas dos letras seguidas.
 */
function comparar(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) return 1;
  return similitud(a, b);
}

/* -----------------------------------------------------------------------------
 * Umbrales
 * -------------------------------------------------------------------------- */

/** Para sugerir mientras se escribe. Generoso. */
const UMBRAL_SUGERENCIA = 0.60;

/** Para frenar el alta y preguntar. Exigente, y solo sobre la calle. */
const UMBRAL_ADVERTENCIA = 0.85;

/* -----------------------------------------------------------------------------
 * Normalización de las partes
 * -------------------------------------------------------------------------- */

function calleDe(d)  { return claveNormalizada(d && d.calle); }
function ciudadDe(d) { return claveNormalizada(d && d.ciudad); }

/** El número. `null`, `''` y `undefined` son lo mismo: sin número. */
function numeroDe(d) { return claveNormalizada(d && d.numero); }

/* -----------------------------------------------------------------------------
 * Búsqueda
 * -------------------------------------------------------------------------- */

/**
 * Busca domicilios parecidos a lo que se está escribiendo.
 *
 * Alcanza con que se parezca la calle O la ciudad: quien todavía no escribió la
 * ciudad tiene que ver los candidatos igual, y quien escribió solo la ciudad
 * tiene que ver qué hay cargado ahí.
 *
 * @param {Array} domicilios Los ya cargados
 * @param {{calle: string, numero: string, ciudad: string}} parcial Lo tipeado
 * @param {number} [maximo]
 * @returns {Array<{domicilio: Object, similitud: number, porCalle: number,
 *   mismoNumero: boolean}>}
 */
export function buscarParecidos(domicilios, parcial, maximo = 6) {
  const calle = calleDe(parcial);
  const ciudad = ciudadDe(parcial);

  // Con menos de tres letras en las dos, todo se parece a todo.
  if (calle.length < 3 && ciudad.length < 3) return [];

  const numero = numeroDe(parcial);

  return (domicilios || [])
    .filter(d => d.estado !== 'inactivo')
    .map(d => {
      const porCalle = comparar(calle, calleDe(d));
      const porCiudad = comparar(ciudad, ciudadDe(d));
      return {
        domicilio: d,
        similitud: Math.max(porCalle, porCiudad),
        // La calle aparte, para desempatar: entre dos con la misma puntuación,
        // primero la que coincide por calle y no solo por ciudad.
        porCalle,
        mismoNumero: numeroDe(d) === numero,
      };
    })
    .filter(r => r.similitud >= UMBRAL_SUGERENCIA)
    .sort((a, b) => {
      if (Math.abs(a.similitud - b.similitud) > 0.01) return b.similitud - a.similitud;
      if (Math.abs(a.porCalle - b.porCalle) > 0.01) return b.porCalle - a.porCalle;
      if (a.mismoNumero !== b.mismoNumero) return a.mismoNumero ? -1 : 1;
      return 0;
    })
    .slice(0, maximo);
}

/**
 * ¿Hay alguna dirección tan parecida que convenga preguntar antes de crear?
 *
 * Devuelve la candidata, o `null`. Exige LAS DOS cosas:
 *
 *   - la CALLE muy parecida (0,85 o más). La ciudad no entra: puede estar
 *     abreviada, y si la calle y el número coinciden es casi seguro el mismo
 *     lugar.
 *   - el NÚMERO exactamente igual.
 *
 * Así "Manual Alberti 1780" encuentra a "Manuel Alberti 1780" —una letra de
 * diferencia, mismo número— pero "Ruta 188 KM 188" no encuentra a "Ruta 188
 * KM 80,5", que son dos lugares a 108 km.
 *
 * Y "Sarmiento 100, Rosario" no encuentra a "Mitre 100, Rosario": comparten
 * ciudad y número, pero la calle no se parece.
 *
 * @param {Array} domicilios
 * @param {{calle: string, numero: string, ciudad: string}} nuevo
 * @param {string} [idIgnorar] Al editar, el propio documento.
 * @returns {Object|null}
 */
export function buscarCasiIgual(domicilios, nuevo, idIgnorar = null) {
  const calle = calleDe(nuevo);
  if (!calle) return null;

  const numero = numeroDe(nuevo);

  let mejor = null;
  let mejorSimilitud = 0;

  for (const d of (domicilios || [])) {
    if (d.id === idIgnorar) continue;
    if (d.estado === 'inactivo') continue;
    if (numeroDe(d) !== numero) continue;      // el número no se tolera

    const s = comparar(calle, calleDe(d));
    if (s >= UMBRAL_ADVERTENCIA && s > mejorSimilitud) {
      mejor = d;
      mejorSimilitud = s;
    }
  }

  return mejor;
}

/**
 * ¿Es exactamente la misma dirección? Sin tolerancia.
 *
 * Para el caso trivial: alguien escribe algo que ya existe idéntico. Ahí no hay
 * nada que preguntar, se reutiliza directamente.
 */
export function buscarIdentico(domicilios, nuevo, idIgnorar = null) {
  const calle = calleDe(nuevo);
  const ciudad = ciudadDe(nuevo);
  const numero = numeroDe(nuevo);

  return (domicilios || []).find(d =>
    d.id !== idIgnorar
    && calleDe(d) === calle
    && ciudadDe(d) === ciudad
    && numeroDe(d) === numero
  ) || null;
}

/** Una línea para mostrar en las sugerencias y en los listados. */
export function textoDomicilio(d) {
  if (!d) return '';
  return [
    [d.calle, d.numero].filter(Boolean).join(' '),
    d.ciudad,
    d.provincia,
    d.cp,
  ].filter(Boolean).join(', ');
}
