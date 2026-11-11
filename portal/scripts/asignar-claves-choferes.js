#!/usr/bin/env node
/* =============================================================================
 * asignar-claves-choferes.js — herramienta nueva (acceso de choferes a TrackEx)
 * =============================================================================
 *
 * PROPÓSITO
 *   Asigna a TODOS los choferes activos la contraseña `<primer nombre>2026`
 *   (por ejemplo "Iván Pérez" -> `ivan2026`), para darles acceso a TrackEx
 *   v1.1.1. Las cuentas se crearon con contraseñas al azar que nadie conoce.
 *   El chofer puede cambiarla desde la app (TrackEx v1.1.1, Frente F).
 *
 * DECISIÓN (del responsable, mientras el sistema está en MODO DE PRUEBA)
 *   Una versión anterior de este script generaba una contraseña aleatoria por
 *   chofer. Se reemplazó por una contraseña derivada del nombre porque en modo
 *   de prueba lo que importa es que cada chofer pueda entrar sin que nadie le
 *   tenga que repartir un CSV. Ver LIMITACIONES CONOCIDAS: hay que revisarla al
 *   salir del modo de prueba.
 *
 * REGLA DE LA CONTRASEÑA (`derivarClave`)
 *   1. Primera palabra de `usuarios.nombre` (después de `trim`).
 *   2. A minúsculas y sin acentos (NFD y se quitan las marcas, así la ñ queda
 *      n).
 *   3. Solo a-z.
 *   4. Más `SUFIJO_CLAVE` ('2026').
 *   Si la palabra queda con menos de 2 letras o el nombre falta, el chofer se
 *   excluye como "nombre no utilizable" (así la contraseña tiene siempre 6
 *   caracteres o más, el mínimo de Firebase Auth).
 *
 * MODELO DE DATOS (ver MODELO_DATOS_TOBE.md)
 *   usuarios/{uid}            (el ID del documento ES el UID de Firebase Auth)
 *     nombre            string
 *     roles             string[]   admin | coordinador | comercial |
 *                                  transportista | chofer | (cliente, futuro)
 *     estado            string     activo | inactivo
 *     organizacion_id   string|null  -> organizaciones (el transportista)
 *     datos_chofer      map|null   { dni: string (INMUTABLE), cuit, ... }
 *   organizaciones/{id}
 *     razon_social      string     (es el campo de nombre que usa el portal en
 *                                  `transporte_nombre`; `nombre_corto` es opcional)
 *   Firebase Auth: email `<dni>@explora-portal.com`, `disabled`,
 *     `metadata.lastSignInTime` (null si nunca inició sesión).
 *   Valores usados: rol `chofer`, estado `activo`, nombre de organización
 *   `razon_social`.
 *
 * ARQUITECTURA / DECISIONES DE DISEÑO
 *   - SOLO ESCRIBE en Auth (`updateUser` con la contraseña). No escribe en
 *     Firestore.
 *   - Se incluye a todos los choferes activos, hayan iniciado sesión o no. A los
 *     que ya habían iniciado sesión se los informa aparte: cambiarles la
 *     contraseña puede cerrarles la sesión en el teléfono, y si ya habían
 *     cambiado la contraseña desde la app, se les vuelve a la inicial.
 *   - Se excluye a quien tenga el email de Auth distinto de
 *     `<dni>@explora-portal.com`: la app ingresa por DNI y armaría ese email,
 *     así que a esa cuenta la contraseña nueva no le serviría.
 *   - `--dni` limita a choferes puntuales (por ejemplo, uno que olvidó la
 *     contraseña que se había puesto).
 *   - `--salida` es opcional. Si se da, se escribe un CSV con las contraseñas,
 *     que se rechaza si cae dentro del repo o si el archivo ya existe. El CSV se
 *     crea ANTES de tocar Auth y se le agrega una fila apenas cada `updateUser`
 *     sale bien; los choferes se procesan ordenados por transportista y nombre.
 *   - Es CommonJS y no puede importar `portal/src/alta-usuarios.js` (módulo
 *     ES del portal), por eso `emailDeChofer` está reimplementada acá.
 *   - Las filas con orden nombre/apellido dudoso se marcan con ⚠ en la tabla
 *     (nombre de una sola palabra, o todo en mayúsculas): ahí la primera
 *     palabra puede ser el apellido.
 *
 * LIMITACIONES CONOCIDAS
 *   - LA CONTRASEÑA ES PREDECIBLE: a quien conozca el nombre y el DNI de un
 *     chofer le alcanza para entrar con su cuenta (el DNI arma el email y el
 *     nombre arma la contraseña). Es aceptable solo en modo de prueba. HAY QUE
 *     REVISARLA AL SALIR DEL MODO DE PRUEBA (volver a contraseñas individuales
 *     al azar, o forzar el cambio en el primer ingreso).
 *   - Volver a correr el script pisa la contraseña que un chofer haya elegido
 *     desde la app. Para un chofer puntual, usar `--dni`.
 *   - Cuando el nombre está cargado con el apellido primero, la contraseña sale
 *     con el apellido ("PEREZ JUAN" -> `perez2026`): revisar las filas con ⚠
 *     en la simulación.
 *   - Dos choferes con el mismo primer nombre tienen la misma contraseña (no
 *     es un problema técnico: el email, por DNI, los distingue).
 *   - Si el CSV no se puede escribir a mitad de la ejecución, el script se
 *     detiene (las contraseñas ya cambiadas son derivables del nombre).
 *
 * HISTORIAL DE CORRECCIONES
 *   Ninguno todavía: herramienta nueva.
 *
 * DEPENDENCIAS Y ENTORNO
 *   `firebase-admin` (no es dependencia del portal: se instala con --no-save).
 *   Necesita una credencial de cuenta de servicio del proyecto indicado; no se
 *   corre desde el asistente sino a mano.
 *
 * -----------------------------------------------------------------------------
 * COMO CORRERLO (Windows)
 * -----------------------------------------------------------------------------
 *   cd portal
 *   npm install firebase-admin --no-save
 *
 * Por defecto SIMULA (no escribe nada; muestra la contraseña de cada chofer):
 *
 *   node scripts\asignar-claves-choferes.js ^
 *     --proyecto entorno-prueba-explora ^
 *     --credencial C:\Proyectos\credenciales\clave-staging.json
 *
 * Para asignar de verdad (el CSV es opcional, va FUERA del repo y no tiene que
 * existir):
 *
 *   node scripts\asignar-claves-choferes.js --ejecutar ^
 *     --proyecto explora-portal ^
 *     --credencial C:\Proyectos\credenciales\clave-produccion.json ^
 *     --salida C:\Users\ivan.bianchi\Documents\claves-choferes-2026-11-04.csv
 *
 * Para uno o varios choferes puntuales:
 *
 *   ... --dni 30123456,28111222
 *
 * `--proyecto` es obligatorio y tiene que ser `entorno-prueba-explora` o
 * `explora-portal`; además se verifica contra el `project_id` de la
 * credencial. Si no coinciden, el script para.
 * ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const fs = require('fs');
const path = require('path');

const PROYECTOS_VALIDOS = ['entorno-prueba-explora', 'explora-portal'];

/** Rol de `usuarios.roles` que identifica a un chofer (MODELO_DATOS_TOBE.md). */
const ROL_CHOFER = 'chofer';

/** Valor de `usuarios.estado` de una cuenta vigente (MODELO_DATOS_TOBE.md). */
const ESTADO_ACTIVO = 'activo';

/** Dominio de los emails de login de los choferes (ver `emailDeChofer`). */
const DOMINIO_CHOFER = 'explora-portal.com';

/** Sufijo de la contraseña inicial: el año del modo de prueba (decisión del responsable). */
const SUFIJO_CLAVE = '2026';

/**
 * Mínimo de letras del primer nombre. Con 2 letras más el sufijo de 4 dígitos
 * la contraseña tiene 6 caracteres, el mínimo que exige Firebase Auth; y una
 * sola letra ("J." de "J. Pérez") es una inicial, no un nombre.
 */
const MIN_LETRAS_NOMBRE = 2;

/** Columnas del CSV, en orden. Sin tilde en `contrasena` para evitar problemas de codificación en planillas. */
const COLUMNAS_CSV = ['transportista', 'nombre', 'dni', 'contrasena'];

/** Texto cuando un chofer no tiene organización o la organización ya no existe. */
const SIN_TRANSPORTISTA = '(sin transportista)';

/* -----------------------------------------------------------------------------
 * Funciones puras (se exportan para poder probarlas)
 * -------------------------------------------------------------------------- */

/**
 * Deriva la contraseña inicial de un chofer a partir de su nombre.
 *
 * Se quitan los acentos (y la ñ queda n) y todo lo que no sea a-z porque el
 * chofer la tipea en el teléfono y un acento o un signo es justo lo que se
 * equivoca. Se toma la primera palabra suponiendo la carga "Nombre Apellido";
 * si está cargado al revés la contraseña sale con el apellido, y por eso la
 * simulación marca esos casos (`nombreDudoso`).
 *
 * @param {*} nombre Valor de `usuarios.nombre`.
 * @returns {string|null} La contraseña, o null si el nombre no es utilizable
 *   (falta, o la primera palabra tiene menos de `MIN_LETRAS_NOMBRE` letras).
 */
function derivarClave(nombre) {
  const primera = String(nombre || '').trim().split(/\s+/)[0] || '';
  const letras = primera
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '');
  return letras.length < MIN_LETRAS_NOMBRE ? null : letras + SUFIJO_CLAVE;
}

/**
 * Indica si el orden nombre/apellido es dudoso: una sola palabra (no se sabe si
 * es el nombre o el apellido) o todo en mayúsculas (suele ser la carga
 * "APELLIDO NOMBRE" de las planillas viejas).
 *
 * @param {*} nombre Valor de `usuarios.nombre`.
 * @returns {boolean} True si conviene revisar el nombre a mano.
 */
function nombreDudoso(nombre) {
  const s = String(nombre || '').trim();
  if (!s) return false;
  const unaPalabra = s.split(/\s+/).length === 1;
  const todoMayusculas = s === s.toUpperCase() && s !== s.toLowerCase();
  return unaPalabra || todoMayusculas;
}

/**
 * Deja solo los dígitos del DNI. Reimplementa la normalización de
 * `emailDeChofer` (portal/src/alta-usuarios.js): este script es CommonJS y no
 * puede importar ese módulo ES. Si cambia allá, cambiarla acá, porque la
 * comparación de emails depende de que sean idénticas.
 *
 * @param {*} dni DNI tal cual está guardado (puede traer puntos o espacios).
 * @returns {string} Solo dígitos; vacío si no hay dato.
 */
function normalizarDni(dni) {
  return String(dni || '').replace(/\D/g, '');
}

/**
 * Email de login de un chofer. Misma regla que `emailDeChofer` del portal
 * (portal/src/alta-usuarios.js): `<dni sin puntos>@explora-portal.com`.
 *
 * @param {*} dni DNI del chofer.
 * @returns {string} Email esperado.
 */
function emailDeChofer(dni) {
  return `${normalizarDni(dni)}@${DOMINIO_CHOFER}`;
}

/**
 * Escapa un campo para el CSV con separador `;`. Además neutraliza las
 * fórmulas: Excel ejecuta un texto que empieza con `=`, `+`, `-` o `@`, y el
 * nombre de un chofer es texto cargado por terceros.
 *
 * @param {*} valor Valor de la celda.
 * @returns {string} Celda lista para concatenar con `;`.
 */
function celdaCsv(valor) {
  let s = String(valor == null ? '' : valor);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[;"\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Arma una línea del CSV (con fin de línea CRLF, el que esperan las planillas
 * de Windows).
 *
 * @param {string[]} celdas Valores en el orden de `COLUMNAS_CSV`.
 * @returns {string} Línea terminada en CRLF.
 */
function lineaCsv(celdas) {
  return celdas.map(celdaCsv).join(';') + '\r\n';
}

/**
 * Sube desde `desde` hasta la carpeta que contiene `Procedimiento.md`, que es
 * la raíz del repo. Se usa ese archivo y no `.git` porque es lo que el repo
 * documenta como su ancla y funciona también en una copia sin `.git`.
 *
 * @param {string} desde Carpeta donde empezar (en el script, `__dirname`).
 * @returns {string|null} Ruta absoluta de la raíz, o null si no se encontró.
 */
function buscarRaizRepo(desde) {
  let actual = path.resolve(desde);
  for (;;) {
    if (fs.existsSync(path.join(actual, 'Procedimiento.md'))) return actual;
    const padre = path.dirname(actual);
    if (padre === actual) return null;
    actual = padre;
  }
}

/**
 * Resuelve una ruta siguiendo los enlaces simbólicos de la parte que ya
 * existe, para que un enlace que apunte al repo no esquive la verificación.
 *
 * @param {string} ruta Ruta absoluta, existente o no.
 * @returns {string} Ruta real del ancestro existente más el resto.
 */
function rutaReal(ruta) {
  let existente = ruta;
  const resto = [];
  while (!fs.existsSync(existente)) {
    const padre = path.dirname(existente);
    if (padre === existente) return ruta;
    resto.unshift(path.basename(existente));
    existente = padre;
  }
  return path.join(fs.realpathSync(existente), ...resto);
}

/**
 * Valida la ruta del CSV de salida: fuera del repo y sin archivo previo.
 *
 * Las contraseñas en texto plano no pueden terminar en un commit, y un CSV
 * viejo no se pisa porque podría ser el único registro de lo que ya se entregó.
 *
 * @param {string} salida Ruta recibida en `--salida`.
 * @param {string} dirScript Carpeta del script (para ubicar la raíz del repo).
 * @returns {{ruta: string}|{error: string}} Ruta absoluta lista para usar, o el motivo del rechazo.
 */
function validarRutaSalida(salida, dirScript) {
  const ruta = path.resolve(salida);
  const raiz = buscarRaizRepo(dirScript);

  // Sin raíz no se puede asegurar que la ruta esté fuera del repo: se frena.
  if (!raiz) return { error: 'no se encontró la carpeta del repo (la que contiene Procedimiento.md), no se puede verificar --salida' };

  const relativa = path.relative(rutaReal(raiz), rutaReal(ruta));
  const dentro = relativa === '' || (!relativa.startsWith('..') && !path.isAbsolute(relativa));
  if (dentro) return { error: `--salida cae dentro del repo (${raiz}). Usá una carpeta fuera del repo.` };

  if (fs.existsSync(ruta)) return { error: `el archivo ya existe: ${ruta}. No se pisa; elegí otro nombre.` };
  if (!fs.existsSync(path.dirname(ruta))) return { error: `la carpeta no existe: ${path.dirname(ruta)}` };

  return { ruta };
}

/* -----------------------------------------------------------------------------
 * Argumentos y conexión
 * -------------------------------------------------------------------------- */

/**
 * Lee y valida los argumentos de línea de comandos. Termina el proceso con
 * código 1 y el modo de uso si falta algo o hay algo inválido.
 *
 * @returns {{credencial: string, proyecto: string, ejecutar: boolean, salida: string|null, dnis: string[]|null}}
 */
function leerArgumentos() {
  const args = process.argv.slice(2);
  const o = { credencial: null, proyecto: null, ejecutar: false, salida: null, dnis: null };

  for (let i = 0; i < args.length; i++) {
    if      (args[i] === '--credencial') o.credencial = args[++i];
    else if (args[i] === '--proyecto')   o.proyecto = args[++i];
    else if (args[i] === '--salida')     o.salida = args[++i];
    else if (args[i] === '--dni')        o.dnis = String(args[++i] || '').split(',').map(normalizarDni);
    else if (args[i] === '--ejecutar')   o.ejecutar = true;
    else if (args[i] === '--simular')    o.ejecutar = false;
  }

  const uso = () => {
    console.error('Uso:');
    console.error('  node asignar-claves-choferes.js [--simular | --ejecutar] \\');
    console.error('    --proyecto <entorno-prueba-explora|explora-portal> \\');
    console.error('    --credencial <ruta.json> \\');
    console.error('    [--salida <ruta.csv>]   (opcional: CSV con las contraseñas, fuera del repo)');
    console.error('    [--dni <dni1,dni2,...>] (limita a esos DNI)\n');
  };

  if (!o.credencial || !o.proyecto) {
    console.error('\nFaltan argumentos.\n');
    uso();
    process.exit(1);
  }
  if (!PROYECTOS_VALIDOS.includes(o.proyecto)) {
    console.error(`\nERROR: --proyecto "${o.proyecto}" no es válido. Usar uno de: ${PROYECTOS_VALIDOS.join(', ')}\n`);
    process.exit(1);
  }
  if (o.dnis) {
    if (o.dnis.length === 0 || o.dnis.some(d => !d)) {
      console.error('\nERROR: --dni tiene que ser una lista de DNI separados por comas, sin elementos vacíos.\n');
      process.exit(1);
    }
    o.dnis = [...new Set(o.dnis)];
  }
  if (o.salida) {
    const v = validarRutaSalida(o.salida, __dirname);
    if (v.error) {
      console.error(`\nERROR: ${v.error}\n`);
      process.exit(1);
    }
    o.salida = v.ruta;
  }
  return o;
}

/**
 * Abre la conexión a Firestore y Auth, y para si la credencial es de otro
 * proyecto que el pedido: cambiar contraseñas en el proyecto equivocado sería
 * irreversible.
 *
 * @param {string} rutaCredencial Ruta del JSON de la cuenta de servicio.
 * @param {string} proyectoEsperado Valor de `--proyecto`.
 * @returns {{db: object, auth: object}}
 */
function conectar(rutaCredencial, proyectoEsperado) {
  let cred;
  try {
    cred = require(path.resolve(rutaCredencial));
  } catch (err) {
    console.error(`\nERROR: no se pudo leer la credencial "${rutaCredencial}": ${err.code || err.message}\n`);
    process.exit(1);
  }

  if (cred.project_id !== proyectoEsperado) {
    console.error(`\nERROR: la credencial es del proyecto "${cred.project_id}"`);
    console.error(`       y se esperaba "${proyectoEsperado}".\n`);
    console.error('       PARAR ACA. Revisá las rutas antes de volver a correrlo.\n');
    process.exit(1);
  }

  const app = initializeApp({ credential: cert(cred) }, 'asignar-claves-choferes');
  return { db: getFirestore(app), auth: getAuth(app) };
}

/* -----------------------------------------------------------------------------
 * Selección
 * -------------------------------------------------------------------------- */

/**
 * Trae los choferes activos con el nombre de su organización.
 *
 * Se consulta solo por `roles array-contains` y el estado se filtra en memoria:
 * combinar los dos filtros en la consulta exigiría un índice compuesto.
 *
 * @param {object} db Firestore.
 * @returns {Promise<object[]>} Choferes activos: `{uid, nombre, dni, transportista}`.
 */
async function leerCandidatos(db) {
  const [snapUsuarios, snapOrgs] = await Promise.all([
    db.collection('usuarios').where('roles', 'array-contains', ROL_CHOFER).get(),
    db.collection('organizaciones').get(),
  ]);

  const organizaciones = new Map(snapOrgs.docs.map(d => [d.id, d.data().razon_social || d.data().nombre_corto || d.id]));

  return snapUsuarios.docs
    .filter(d => d.data().estado === ESTADO_ACTIVO)
    .map(d => {
      const u = d.data();
      return {
        uid: d.id,
        nombre: u.nombre || '',
        dni: normalizarDni(u.datos_chofer && u.datos_chofer.dni),
        transportista: (u.organizacion_id && organizaciones.get(u.organizacion_id)) || SIN_TRANSPORTISTA,
      };
    });
}

/**
 * Clasifica a cada candidato según su cuenta de Auth y su nombre.
 *
 * Los DNI pedidos que no coinciden con ningún chofer activo se reportan aparte
 * (`dniNoEncontrados`); los que existen pero no sirven caen en su categoría.
 * `yaIniciaron` es informativo: esos choferes también están en `aAsignar`.
 *
 * @param {object} auth Auth de Admin SDK.
 * @param {object[]} candidatos Salida de `leerCandidatos`.
 * @param {string[]|null} dnis Valor de `--dni`, o null.
 * @returns {Promise<object>} Listas `aAsignar` (con `clave` y `dudoso`),
 *   `yaIniciaron`, `sinCuenta`, `deshabilitados`, `emailNoCoincide`,
 *   `nombreNoUtilizable`, `errores` y `dniNoEncontrados`.
 */
async function clasificar(auth, candidatos, dnis) {
  const r = { aAsignar: [], yaIniciaron: [], sinCuenta: [], deshabilitados: [], emailNoCoincide: [], nombreNoUtilizable: [], errores: [], dniNoEncontrados: [] };

  const considerados = dnis ? candidatos.filter(c => dnis.includes(c.dni)) : candidatos;
  if (dnis) {
    const presentes = new Set(considerados.map(c => c.dni));
    r.dniNoEncontrados = dnis.filter(d => !presentes.has(d));
  }

  for (const c of considerados) {
    let cuenta;
    try {
      cuenta = await auth.getUser(c.uid);
    } catch (err) {
      if (err.code === 'auth/user-not-found') r.sinCuenta.push(c);
      else r.errores.push({ ...c, motivo: err.code || 'error' });
      continue;
    }

    if (cuenta.disabled) { r.deshabilitados.push(c); continue; }

    if (!c.dni || (cuenta.email || '').toLowerCase() !== emailDeChofer(c.dni)) {
      r.emailNoCoincide.push({ ...c, emailAuth: cuenta.email || '' });
      continue;
    }

    const clave = derivarClave(c.nombre);
    if (!clave) { r.nombreNoUtilizable.push(c); continue; }

    const yaInicio = Boolean(cuenta.metadata.lastSignInTime);
    const item = { ...c, clave, dudoso: nombreDudoso(c.nombre), yaInicio };
    r.aAsignar.push(item);
    if (yaInicio) r.yaIniciaron.push(item);
  }

  const orden = (a, b) => a.transportista.localeCompare(b.transportista, 'es') || a.nombre.localeCompare(b.nombre, 'es');
  r.aAsignar.sort(orden);
  r.yaIniciaron.sort(orden);
  return r;
}

/* -----------------------------------------------------------------------------
 * Reporte
 * -------------------------------------------------------------------------- */

/**
 * Imprime un título con regla, igual que los demás scripts de `scripts/`.
 *
 * @param {string} texto Título de la sección.
 */
function titulo(texto) {
  console.log('');
  console.log('-'.repeat(70));
  console.log(texto);
  console.log('-'.repeat(70));
}

/**
 * Imprime una lista de choferes con el título de la sección; no imprime nada si
 * la lista está vacía.
 *
 * @param {string} encabezado Título de la sección.
 * @param {object[]} lista Choferes.
 * @param {function(object): string} [extra] Texto adicional por chofer.
 */
function listar(encabezado, lista, extra) {
  if (lista.length === 0) return;
  titulo(`${encabezado}: ${lista.length}`);
  lista.forEach(c => console.log(`  ${c.nombre || '(sin nombre)'} · DNI ${c.dni || '(sin DNI)'} · ${c.transportista}${extra ? ' · ' + extra(c) : ''}`));
}

/**
 * Imprime los conteos finales de la clasificación.
 *
 * @param {object} r Salida de `clasificar`.
 * @param {number} totalCandidatos Choferes activos leídos (antes de `--dni`).
 */
function imprimirConteos(r, totalCandidatos) {
  titulo('CONTEOS');
  console.log(`  Candidatos (choferes activos): ${totalCandidatos}`);
  console.log(`  A asignar:                     ${r.aAsignar.length}`);
  console.log(`    de ellos, ya habían iniciado sesión: ${r.yaIniciaron.length}`);
  console.log(`  Sin cuenta:                    ${r.sinCuenta.length}`);
  console.log(`  Deshabilitados:                ${r.deshabilitados.length}`);
  console.log(`  Email no coincide:             ${r.emailNoCoincide.length}`);
  console.log(`  Nombre no utilizable:          ${r.nombreNoUtilizable.length}`);
  console.log(`  DNI no encontrados:            ${r.dniNoEncontrados.length}`);
  if (r.errores.length) console.log(`  Error al consultar la cuenta:  ${r.errores.length}`);
}

/* -----------------------------------------------------------------------------
 * Ejecución
 * -------------------------------------------------------------------------- */

/**
 * Cambia la contraseña de cada chofer a asignar y, si hay CSV, va agregando su
 * fila.
 *
 * El archivo se crea con `wx` (falla si apareció en el medio) y con el BOM
 * UTF-8 para que Excel respete las tildes. Cada fila se escribe apenas
 * `updateUser` sale bien, no al final, para no perder el registro si algo corta
 * el proceso. Una falla de Auth se registra (solo el motivo) y se sigue con el
 * resto. Una falla al escribir el CSV detiene todo.
 *
 * @param {object} auth Auth de Admin SDK.
 * @param {object[]} aAsignar Choferes ya ordenados por transportista y nombre.
 * @param {string|null} rutaCsv Ruta absoluta validada del CSV, o null si no se pidió.
 * @returns {Promise<{exitosos: number, fallidos: object[]}>}
 */
async function asignar(auth, aAsignar, rutaCsv) {
  const fd = rutaCsv ? fs.openSync(rutaCsv, 'wx') : null;
  const fallidos = [];
  let exitosos = 0;

  try {
    if (fd !== null) fs.writeSync(fd, '\uFEFF' + lineaCsv(COLUMNAS_CSV));

    for (const c of aAsignar) {
      try {
        await auth.updateUser(c.uid, { password: c.clave });
      } catch (err) {
        fallidos.push({ ...c, motivo: err.code || 'error' });
        continue;
      }

      if (fd !== null) fs.writeSync(fd, lineaCsv([c.transportista, c.nombre, c.dni, c.clave]));
      exitosos++;
    }
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
  return { exitosos, fallidos };
}

/**
 * Punto de entrada: lee, clasifica, informa y (con `--ejecutar`) asigna.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const o = leerArgumentos();
  const { db, auth } = conectar(o.credencial, o.proyecto);

  console.log(`\nProyecto: ${o.proyecto}`);
  console.log(`Modo:     ${o.ejecutar ? 'EJECUTAR (cambia contraseñas)' : 'SIMULAR (no escribe nada)'}`);
  if (o.dnis) console.log(`Limitado a ${o.dnis.length} DNI`);
  console.log('\nLeyendo...');

  const candidatos = await leerCandidatos(db);
  const r = await clasificar(auth, candidatos, o.dnis);

  titulo(`RECIBIRÍAN CONTRASEÑA: ${r.aAsignar.length}`);
  if (r.aAsignar.length === 0) console.log('  Ninguno.');
  r.aAsignar.forEach(c => {
    const marca = c.dudoso ? ' ⚠' : '';
    console.log(`  ${c.transportista} · ${c.nombre} · DNI ${c.dni}${o.ejecutar ? '' : ` · ${c.clave}`}${marca}`);
  });
  if (r.aAsignar.some(c => c.dudoso)) {
    console.log('\n  ⚠ = nombre de una sola palabra o todo en mayúsculas: el orden nombre/apellido es dudoso.');
  }

  if (r.yaIniciaron.length) {
    listar('YA HABÍAN INICIADO SESIÓN (también reciben contraseña)', r.yaIniciaron);
    console.log('\n  OJO: cambiarles la contraseña les puede cerrar la sesión en el teléfono, y si ya');
    console.log('  la habían cambiado desde la app, vuelve a la inicial.');
  }
  listar('SIN CUENTA DE AUTH', r.sinCuenta);
  listar('CUENTA DESHABILITADA', r.deshabilitados);
  listar('EMAIL DE AUTH NO COINCIDE CON EL DNI (el login por DNI no les funcionaría)', r.emailNoCoincide, c => `Auth: ${c.emailAuth || '(sin email)'}`);
  listar('NOMBRE NO UTILIZABLE (falta, o la primera palabra tiene menos de 2 letras)', r.nombreNoUtilizable);
  listar('ERROR AL CONSULTAR LA CUENTA', r.errores, c => c.motivo);
  if (r.dniNoEncontrados.length) {
    titulo(`DNI PEDIDOS QUE NO APARECEN COMO CHOFER ACTIVO: ${r.dniNoEncontrados.length}`);
    r.dniNoEncontrados.forEach(d => console.log(`  ${d}`));
  }

  imprimirConteos(r, candidatos.length);

  if (!o.ejecutar) {
    console.log('\nSIMULACIÓN: no se escribió nada. Agregá --ejecutar para asignar (y --salida para guardar un CSV).\n');
    return;
  }

  if (r.aAsignar.length === 0) {
    console.log('\nNada para asignar.\n');
    return;
  }

  titulo('ESCRITURA');
  const { exitosos, fallidos } = await asignar(auth, r.aAsignar, o.salida);
  fallidos.forEach(f => console.log(`  FALLÓ     ${f.nombre} · DNI ${f.dni} · ${f.motivo}`));

  console.log(`\nListo. Contraseñas asignadas: ${exitosos} · fallidas: ${fallidos.length}.`);
  if (o.salida) console.log(`CSV: ${o.salida}`);
  console.log('\nRECORDATORIO: la contraseña inicial es <primer nombre>2026. Avisarles a los choferes');
  console.log('que pueden cambiarla desde la app, y revisar esta regla al salir del modo de prueba.');
  if (fallidos.length) {
    console.log('Los fallidos conservan su contraseña anterior: se pueden reintentar con --dni.');
    process.exit(1);
  }
  console.log('');
}

module.exports = { derivarClave, nombreDudoso, normalizarDni, emailDeChofer, celdaCsv, validarRutaSalida, SUFIJO_CLAVE };

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}
