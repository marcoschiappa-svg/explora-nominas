/* =============================================================================
 * importar-flota.js — Interpretar la planilla de choferes, tractores y
 * acoplados (Portal Explora)
 * =============================================================================
 *
 * v1.2.0 (RF-04) — IMPORTACIÓN DE FLOTA DESDE EXCEL
 *
 * SÍNTOMA
 *   Un transportista (o un admin en su nombre) cargaba sus choferes, sus
 *   tractores y sus acoplados uno por uno, a mano, desde `Usuarios.js` y
 *   `Camiones.js`. Para una empresa que recién entra al portal con 15
 *   choferes y 20 unidades, son 35 altas manuales.
 *
 * CAUSA RAÍZ
 *   No existía un camino de carga masiva para la flota -- solo para
 *   pedidos (`carga-masiva.js`).
 *
 * ALCANCE
 *   Mismo mecanismo que `carga-masiva.js`: lógica de interpretación PURA
 *   (sin React, sin Firestore) que `ImportarFlota.js` llama después de leer
 *   el archivo con SheetJS. Tres hojas independientes -- Choferes,
 *   Tractores, Acoplados -- cada una interpretada por separado, con el
 *   mismo formato de planilla que la de pedidos: filas 1-2 título e
 *   instrucciones, fila 3 encabezados, fila 4 ejemplo, datos desde la fila
 *   5, columnas leídas POR POSICIÓN (`COLUMNAS`, más abajo) -- así un
 *   encabezado editado a mano no rompe la lectura.
 *
 *   La VALIDACIÓN de cada fila es la MISMA que usa el formulario:
 *   `validarAltaUsuario()` (`alta-usuarios.js`) para choferes,
 *   `validarUnidad()` (`logica-flota.js`) para tractores y acoplados -- ver
 *   la regla 9 del prompt de esta tarea ("una sola implementación de cada
 *   regla de negocio"). Lo único que agrega este archivo son las DOS cosas
 *   que no tienen sentido en un alta de a una:
 *     - duplicado DENTRO del archivo (mismo DNI o misma patente en dos
 *       filas de la MISMA planilla) -- error, la segunda fila en adelante;
 *     - fila "existente" (DNI o patente que YA está cargado, activo o
 *       inactivo) -- no es error, se informa y se saltea al confirmar. Por
 *       eso `validarAltaUsuario`/`validarUnidad` se llaman con
 *       `omitirDniRepetido`/`omitirDuplicado`: la detección de "ya existe"
 *       para RECHAZAR (el formulario) y para "existente, se saltea" (acá)
 *       es la misma búsqueda (`buscarUsuarioPorDni`/`buscarUnidadRepetida`),
 *       pero lo que cada uno hace con el resultado es distinto a propósito.
 *
 *   Tope de 100 filas por hoja, mismo que `carga-masiva.js`
 *   (`MAXIMO_FILAS`). Una hoja que lo supera se rechaza ENTERA (con un
 *   mensaje, `error`) -- las otras dos hojas de la misma planilla se siguen
 *   interpretando igual. Una hoja vacía o ausente no es error: da un
 *   array de filas vacío.
 *
 * LIMITACIONES CONOCIDAS
 *   No resuelve nombres por parecido (a diferencia de `carga-masiva.js`
 *   con cliente/producto/domicilio): acá no hay nada que "resolver" contra
 *   un catálogo -- el DNI y la patente son el dato en sí, no un texto que
 *   deba coincidir con otra cosa ya cargada.
 *
 * CÓMO SE VERIFICA
 *   `CI=true npm test -- importar-flota` (ver `importar-flota.test.js`,
 *   que también cubre `validarUnidad` -- formatos de patente, repetida
 *   activa e inactiva) y `CI=true npm run build` sin warnings.
 * ========================================================================== */

import { validarAltaUsuario, emailDeChofer, buscarUsuarioPorDni } from './alta-usuarios';
import { validarUnidad, datosDeAltaUnidad, normalizarPatente, mostrarPatente, buscarUnidadRepetida } from './logica-flota';
import { normalizarCuit } from './mapa-normalizacion';

/* -----------------------------------------------------------------------------
 * La planilla
 * -------------------------------------------------------------------------- */

/** Las columnas de cada hoja, en orden. Se leen por POSICIÓN -- ver el
 * encabezado del archivo. Solo los campos que hoy piden los formularios de
 * `Usuarios.js` (chofer) y `Camiones.js` (tractor/acoplado). */
export const COLUMNAS = {
  choferes: ['nombre', 'dni', 'cuit', 'telefono'],
  tractores: ['patente', 'obs'],
  acoplados: ['patente', 'obs'],
};

/** Igual que `carga-masiva.js`: 1-2 título, 3 encabezados, 4 ejemplo. */
export const PRIMERA_FILA_DATOS = 5;

/** Mismo tope que la carga masiva de pedidos. */
export const MAXIMO_FILAS = 100;

/* -----------------------------------------------------------------------------
 * Lectura por posición
 * -------------------------------------------------------------------------- */

/**
 * Convierte la matriz cruda de una hoja (como devuelve
 * `XLSX.utils.sheet_to_json(hoja, { header: 1 })`) en filas de datos, leídas
 * por posición según `columnas`. Filas totalmente vacías se descartan.
 *
 * @param {Array<Array>} matriz
 * @param {string[]} columnas
 * @returns {Object[]}
 */
function extraerFilas(matriz, columnas) {
  return (matriz || [])
    .slice(PRIMERA_FILA_DATOS - 1)
    .map(fila => {
      const obj = {};
      columnas.forEach((col, i) => {
        const bruto = (fila || [])[i];
        obj[col] = String(bruto == null ? '' : bruto).trim();
      });
      return obj;
    })
    .filter(f => Object.values(f).some(v => v !== ''));
}

/**
 * Extrae las filas de una hoja y aplica el tope de `MAXIMO_FILAS`. Si lo
 * supera, la hoja se rechaza entera.
 *
 * @returns {{crudas: Object[], error: string|null}}
 */
function leerHoja(matriz, columnas) {
  const crudas = extraerFilas(matriz, columnas);
  if (crudas.length > MAXIMO_FILAS) {
    return {
      crudas: [],
      error: `La hoja tiene ${crudas.length} filas y el máximo es ${MAXIMO_FILAS}. Partila en varias.`,
    };
  }
  return { crudas, error: null };
}

/* -----------------------------------------------------------------------------
 * Choferes
 * -------------------------------------------------------------------------- */

/**
 * Interpreta la hoja "Choferes".
 *
 * @param {Array<Array>} matriz La matriz cruda de la hoja (o `undefined`
 *   si la hoja no existe -- no es error, ver el encabezado del archivo).
 * @param {Object} catalogos `{ organizacion_id, usuarios }`
 * @returns {{filas: Array, error: string|null}}
 */
export function interpretarHojaChoferes(matriz, { organizacion_id, usuarios = [] } = {}) {
  const { crudas, error } = leerHoja(matriz, COLUMNAS.choferes);
  if (error) return { filas: [], error };

  const dnisVistos = new Set();

  const filas = crudas.map((cruda, i) => {
    const numeroFila = PRIMERA_FILA_DATOS + i;
    const dni = cruda.dni.replace(/\D/g, '');
    const cuit = cruda.cuit || '';

    const datos = {
      nombre: cruda.nombre,
      dni,
      cuit: normalizarCuit(cuit) || cuit,
      telefono: cruda.telefono || '',
      roles: ['chofer'],
      organizacion_id,
      email: dni ? emailDeChofer(dni) : '',
      datos_chofer: { dni, cuit: normalizarCuit(cuit) || '', licencia_venc: null },
    };

    // La validación de negocio es la MISMA que el formulario -- se omite
    // solo el mensaje de "DNI repetido" (`omitirDniRepetido`): acá un DNI
    // ya cargado es "existente", no un error. Ver el encabezado del archivo.
    const errores = validarAltaUsuario(
      { nombre: datos.nombre, roles: datos.roles, organizacion_id, dni, cuit: datos.cuit },
      { usuarios, omitirDniRepetido: true }
    );

    // Duplicado DENTRO del archivo: la segunda aparición en adelante es
    // error -- dos filas con el mismo DNI no se pueden distinguir al
    // escribir (misma fila import a import, dos choferes).
    if (dni) {
      if (dnisVistos.has(dni)) {
        errores.push(`El DNI ${dni} está repetido en esta planilla.`);
      } else {
        dnisVistos.add(dni);
      }
    }

    const existente = !!buscarUsuarioPorDni(dni, usuarios);

    let estado = 'nueva';
    if (errores.length > 0) estado = 'error';
    else if (existente) estado = 'existente';

    return { numeroFila, datos, estado, errores };
  });

  return { filas, error: null };
}

/* -----------------------------------------------------------------------------
 * Tractores y acoplados
 * -------------------------------------------------------------------------- */

/**
 * Interpreta la hoja "Tractores" o "Acoplados".
 *
 * @param {Array<Array>} matriz
 * @param {'tractor'|'acoplado'} tipo
 * @param {Object} catalogos `{ organizacion_id, camiones }`
 * @returns {{filas: Array, error: string|null}}
 */
export function interpretarHojaUnidad(matriz, tipo, { organizacion_id, camiones = [] } = {}) {
  const columnas = tipo === 'tractor' ? COLUMNAS.tractores : COLUMNAS.acoplados;
  const { crudas, error } = leerHoja(matriz, columnas);
  if (error) return { filas: [], error };

  const patentesVistas = new Set();

  const filas = crudas.map((cruda, i) => {
    const numeroFila = PRIMERA_FILA_DATOS + i;
    const patente = normalizarPatente(cruda.patente);
    const datos = datosDeAltaUnidad({ tipo, patente: cruda.patente, organizacion_id, obs: cruda.obs });

    // Mismo criterio que en choferes: se omite el mensaje de duplicado
    // (`omitirDuplicado`) -- acá una patente ya cargada es "existente".
    const errores = validarUnidad(
      { tipo, patente: cruda.patente, organizacion_id },
      { camiones, omitirDuplicado: true }
    );

    if (patente) {
      if (patentesVistas.has(patente)) {
        errores.push(`La patente ${mostrarPatente(patente)} está repetida en esta planilla.`);
      } else {
        patentesVistas.add(patente);
      }
    }

    const existente = !!buscarUnidadRepetida({ tipo, patente, organizacion_id }, camiones);

    let estado = 'nueva';
    if (errores.length > 0) estado = 'error';
    else if (existente) estado = 'existente';

    return { numeroFila, datos, estado, errores };
  });

  return { filas, error: null };
}

/* -----------------------------------------------------------------------------
 * La planilla entera
 * -------------------------------------------------------------------------- */

/**
 * Interpreta las tres hojas.
 *
 * @param {Object} hojas `{ choferes, tractores, acoplados }`, cada una la
 *   matriz cruda de esa hoja (o `undefined`/`null` si no está en el libro).
 * @param {Object} catalogos `{ organizacion_id, usuarios, camiones }`
 * @returns {{
 *   choferes: {filas: Array, error: string|null},
 *   tractores: {filas: Array, error: string|null},
 *   acoplados: {filas: Array, error: string|null},
 * }}
 */
export function interpretarPlanilla(hojas = {}, catalogos = {}) {
  const { organizacion_id, usuarios = [], camiones = [] } = catalogos;

  return {
    choferes: interpretarHojaChoferes(hojas.choferes, { organizacion_id, usuarios }),
    tractores: interpretarHojaUnidad(hojas.tractores, 'tractor', { organizacion_id, camiones }),
    acoplados: interpretarHojaUnidad(hojas.acoplados, 'acoplado', { organizacion_id, camiones }),
  };
}
