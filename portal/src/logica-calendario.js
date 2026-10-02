/* =============================================================================
 * logica-calendario.js — v1.2.0 (RF-10)
 * =============================================================================
 *
 * SÍNTOMA
 *   No había un único lugar donde marcar "hoy no se carga" o "hoy no se
 *   opera": cada pedido y cada despacho se programaba a mano, y un feriado o
 *   una parada de planta se manejaba de palabra entre el coordinador y el
 *   transportista.
 *
 * CAUSA RAÍZ
 *   No existía el concepto de "calendario operativo" en el modelo: ni un
 *   lugar para marcar un día puntual, ni una regla que cubra algo repetitivo
 *   (los domingos) sin cargar 52 documentos.
 *
 * ALCANCE
 *   Lógica PURA (sin React) sobre dos fuentes: los días marcados
 *   explícitamente (`calendario_operativo`, un documento por fecha
 *   `YYYY-MM-DD`) y la regla semanal (`calendario_reglas/semanal`, un tipo
 *   por día de semana 0=domingo..6=sábado). `tipoDelDia()` resuelve la
 *   precedencia: un día marcado explícitamente y ACTIVO gana sobre la regla
 *   semanal; un día desactivado (`estado: 'inactivo'`) NO anula la regla
 *   semanal — simplemente no aporta nada, y la regla semanal decide sola.
 *
 *   `evaluarFechaCarga()` es la que usa la función de lógica que crea o
 *   reprograma un despacho (`aceptarEntrega()`/`editarDespacho()` en
 *   `logica-despachos.js`, ver ese archivo para el bloqueo real) y la
 *   pantalla de Programación para el mismo chequeo en el cliente, antes de
 *   viajar a Firestore. `evaluarFechaEntrega()` es la que usan `Pedidos.js` y
 *   `carga-masiva.js`: nunca bloquea, solo advierte.
 *
 *   `leerCalendario()` es el puente hacia Firestore para el lado de la
 *   lógica de escritura (`logica-despachos.js`): lee el documento del día
 *   puntual (si existe) y la regla semanal, y devuelve la MISMA forma
 *   (`{ dias: Map, reglas }`) que arman las pantallas al suscribirse — así
 *   `tipoDelDia()`/`evaluarFechaCarga()` funcionan igual desde los dos
 *   lugares, sin un segundo camino de cálculo.
 *
 * LIMITACIONES CONOCIDAS
 *   No hay un tipo "abierto" que anule la regla semanal para un día puntual:
 *   si "domingos sin operación" está activo como regla semanal, desmarcar un
 *   domingo puntual (o no tener nunca un documento para él) no lo abre — la
 *   regla semanal sigue rigiendo. Para abrir un domingo puntual hace falta
 *   una función que hoy no existe. Documentado también en
 *   `COMPORTAMIENTO.md`.
 *
 *   El motivo que se muestra para un día cubierto solo por la regla semanal
 *   es genérico ("Regla semanal: domingo"), porque `calendario_reglas` no
 *   guarda un motivo por día — solo el tipo.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- logica-calendario` — ver `logica-calendario.test.js`:
 *   precedencia día/regla, día inactivo con regla activa, los dos tipos
 *   contra cada tipo de pedido, bordes de mes y de año. `CI=true npm run
 *   build` sin warnings.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-09, Paso 0) — DE DÓNDE SE IMPORTA `TIPOS`
 * -----------------------------------------------------------------------------
 *
 *   SÍNTOMA
 *     Este archivo cerraba el ciclo `logica-despachos.js` → este →
 *     `logica-pedidos.js` → `logica-despachos.js`. Funcionaba solo porque
 *     nada se evalúa al cargar el módulo.
 *
 *   CAUSA RAÍZ
 *     De `logica-pedidos.js` acá se necesita UNA constante (`TIPOS`), pero el
 *     import arrastraba el módulo entero con su propio import de
 *     `logica-despachos.js`.
 *
 *   ALCANCE
 *     `TIPOS` se importa ahora de `tipos-pedido.js`, un módulo sin imports
 *     del proyecto. Es el único cambio de este archivo: mismo objeto, mismos
 *     valores, ninguna función tocada.
 *
 *   LIMITACIONES CONOCIDAS
 *     Ninguna nueva. `logica-pedidos.js` re-exporta `TIPOS`, así que quien la
 *     importe de allá sigue funcionando igual.
 *
 *   CÓMO SE VERIFICA
 *     `logica-calendario.test.js` sigue en verde sin cambios, y en este
 *     archivo no queda ninguna referencia a `logica-pedidos`.
 * ========================================================================== */

import { doc, getDoc } from 'firebase/firestore';
// 0. v1.2.0 (RF-09, Paso 0) — antes `from './logica-pedidos'`, que cerraba el
//    ciclo de imports. Ver el encabezado.
import { TIPOS } from './tipos-pedido';

/* -----------------------------------------------------------------------------
 * 1. Nombres de días — duplicado a propósito, mismo criterio que
 *    `unDiaAntes()` en `logica-viajes.js`: este archivo es lógica pura y no
 *    depende de las constantes de una pantalla.
 * -------------------------------------------------------------------------- */
const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export const TIPO_SIN_DESPACHO = 'sin_despacho';
export const TIPO_SIN_OPERACION = 'sin_operacion';

export const ETIQUETA_TIPO_DIA = {
  [TIPO_SIN_DESPACHO]: 'Sin despacho',
  [TIPO_SIN_OPERACION]: 'Sin operación',
};

/** `dias` puede ser un Map o un objeto plano — `leerCalendario()` entrega un
 * Map de 0 o 1 entradas; las pantallas arman uno con todos los días activos
 * suscriptos. Se acepta cualquiera de los dos para no obligar a envolver un
 * objeto en un Map en cada test. */
function entradaDelDia(dias, fechaISO) {
  if (!dias) return null;
  if (typeof dias.get === 'function') return dias.get(fechaISO) || null;
  return dias[fechaISO] || null;
}

function diaDeLaSemana(fechaISO) {
  return new Date(`${fechaISO}T00:00:00`).getDay();
}

/**
 * 2. El tipo que rige para una fecha, con la precedencia del encabezado:
 *    día explícito ACTIVO > regla semanal. Un día explícito INACTIVO no
 *    cuenta para nada acá — se lo trata como si no existiera.
 *
 * @param {string} fechaISO `YYYY-MM-DD`
 * @param {Map|Object} dias
 * @param {{dias: Object}|null} reglas
 * @returns {null|'sin_despacho'|'sin_operacion'}
 */
export function tipoDelDia(fechaISO, dias, reglas) {
  if (!fechaISO) return null;

  const explicito = entradaDelDia(dias, fechaISO);
  if (explicito && explicito.estado === 'activo' && explicito.tipo) {
    return explicito.tipo;
  }

  if (reglas && reglas.dias) {
    const tipoRegla = reglas.dias[String(diaDeLaSemana(fechaISO))];
    if (tipoRegla) return tipoRegla;
  }

  return null;
}

/** El motivo a mostrar: el del día explícito si lo hay, o uno genérico con
 * el nombre del día de la semana si viene de la regla. */
function motivoDelDia(fechaISO, dias, reglas) {
  const explicito = entradaDelDia(dias, fechaISO);
  if (explicito && explicito.estado === 'activo' && explicito.tipo) {
    return explicito.motivo || null;
  }
  if (reglas && reglas.dias) {
    const dow = diaDeLaSemana(fechaISO);
    if (reglas.dias[String(dow)]) {
      return `Regla semanal: ${DIAS_SEMANA[dow]}`;
    }
  }
  return null;
}

function armarMotivoCompleto(tipo, fechaISO, dias, reglas) {
  const detalle = motivoDelDia(fechaISO, dias, reglas);
  const etiqueta = ETIQUETA_TIPO_DIA[tipo] || tipo;
  return detalle ? `${etiqueta}: ${detalle}.` : `${etiqueta}.`;
}

/**
 * 3. La fecha de CARGA de un despacho. `sin_operacion` bloquea cualquier
 *    tipo de pedido. `sin_despacho` bloquea solo cuando el destino es el
 *    cliente — ESE es "Entrega al cliente" en `TIPOS` de `logica-pedidos.js`
 *    (el único de los tres con `destino: 'cliente'`), así que se compara
 *    contra `config.destino`, no contra el string del tipo: no hace falta
 *    repetir el texto "Entrega al cliente" acá.
 *
 * @param {string} fechaISO
 * @param {string} tipoPedido uno de las claves de `TIPOS`
 * @param {Map|Object} dias
 * @param {{dias: Object}|null} reglas
 * @returns {{bloquea: boolean, motivo: string|null}}
 */
export function evaluarFechaCarga(fechaISO, tipoPedido, dias, reglas) {
  const tipo = tipoDelDia(fechaISO, dias, reglas);
  if (!tipo) return { bloquea: false, motivo: null };

  const config = TIPOS[tipoPedido];
  const esEntregaAlCliente = !!config && config.destino === 'cliente';

  const bloquea = tipo === TIPO_SIN_OPERACION || (tipo === TIPO_SIN_DESPACHO && esEntregaAlCliente);
  if (!bloquea) return { bloquea: false, motivo: null };

  return { bloquea: true, motivo: armarMotivoCompleto(tipo, fechaISO, dias, reglas) };
}

/**
 * 4. La fecha de ENTREGA (solicitada) de un pedido. Cualquier día marcado
 *    —de cualquiera de los dos tipos— advierte. Nunca bloquea: se deja
 *    guardar igual, es una decisión comercial, no operativa.
 *
 * @returns {{advierte: boolean, motivo: string|null}}
 */
export function evaluarFechaEntrega(fechaISO, dias, reglas) {
  const tipo = tipoDelDia(fechaISO, dias, reglas);
  if (!tipo) return { advierte: false, motivo: null };
  return { advierte: true, motivo: armarMotivoCompleto(tipo, fechaISO, dias, reglas) };
}

/**
 * 5. Puente hacia Firestore para el lado de la lógica de escritura: lee el
 *    documento del día puntual (si existe, sea cual sea su `estado`) y la
 *    regla semanal, y devuelve la misma forma que arman las pantallas al
 *    suscribirse — un Map de 0 o 1 entradas, clave la propia `fechaISO`.
 *
 * @param {import('firebase/firestore').Firestore} db
 * @param {string} fechaISO
 * @returns {Promise<{dias: Map, reglas: {dias: Object}|null}>}
 */
export async function leerCalendario(db, fechaISO) {
  const [snapDia, snapReglas] = await Promise.all([
    getDoc(doc(db, 'calendario_operativo', fechaISO)),
    getDoc(doc(db, 'calendario_reglas', 'semanal')),
  ]);

  const dias = new Map();
  if (snapDia.exists()) dias.set(fechaISO, snapDia.data());

  return {
    dias,
    reglas: snapReglas.exists() ? snapReglas.data() : null,
  };
}
