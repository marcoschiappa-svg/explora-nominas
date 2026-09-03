#!/usr/bin/env node
/* =============================================================================
 * cargar-entidades.js — Carga inicial del modelo nuevo
 * =============================================================================
 *
 * QUE HACE
 *   Crea las entidades base del modelo nuevo:
 *
 *     organizaciones            43   39 clientes + 3 transportes + Explora
 *     domicilios                34   desde datos-domicilios.js
 *     organizacion_domicilios   34   idem
 *     productos                  7   la lista que hoy esta hardcodeada
 *     usuarios                   ?   los internos y los transportistas
 *     contadores/pedidos         1   arranca en 0
 *
 * QUE NO HACE
 *   - NO migra pedidos. Los pedidos vivos terminan su ciclo en
 *     `pedidos_portal` y los nuevos nacen en el modelo nuevo. No hay puente.
 *   - NO carga choferes. Se recrean desde el ABM: ninguno usa el portal hoy y
 *     los datos que hay estan incompletos (hay documentos sin `uid` ni `email`,
 *     que son cuentas que no pueden entrar a ningun lado).
 *   - NO carga camiones. No existe fuente: las unicas patentes en la base son
 *     de los despachos de prueba. Se cargan desde el ABM del transportista.
 *   - NO toca ninguna coleccion del modelo viejo. Solo lee `usuarios_portal` y
 *     `transportistas_portal`.
 *
 * SE PUEDE VOLVER A CORRER
 *   Los IDs son AUTOGENERADOS, no derivados del nombre — una clave primaria
 *   derivada de un dato obliga a migrar todas las referencias cuando ese dato
 *   cambia, y una razon social cambia.
 *
 *   La idempotencia sale del campo `clave_normalizada`: antes de crear, busca
 *   si ya existe uno con esa clave. Si existe, actualiza; si no, crea.
 *
 *   Los usuarios no necesitan clave: su ID de documento ES el UID de Firebase
 *   Auth, asi que un `set()` con merge alcanza.
 *
 * -----------------------------------------------------------------------------
 * COMO CORRERLO
 * -----------------------------------------------------------------------------
 *
 *   cd portal
 *   npm install firebase-admin --no-save
 *
 * Primero en simulacion, que cuenta lo que haria sin escribir nada:
 *
 *   node scripts/cargar-entidades.js --simular ^
 *     --credencial C:\Proyectos\credenciales\clave-staging.json
 *
 * Si el resultado tiene sentido, la carga de verdad:
 *
 *   node scripts/cargar-entidades.js ^
 *     --credencial C:\Proyectos\credenciales\clave-staging.json
 *
 * Contra produccion hay que pasar --produccion ADEMAS de la credencial
 * correcta. El script verifica el `project_id` de la credencial antes de
 * escribir: si no coincide con lo que se le pidio, para.
 * ========================================================================== */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore }        = require('firebase-admin/firestore');
const { getAuth }             = require('firebase-admin/auth');
const path                    = require('path');

const {
  claveNormalizada,
  claveDomicilio,
  normalizarCuit,
  resolverOrganizacionSuave,
  organizacionesACrear,
} = require('../src/mapa-normalizacion');

const { DOMICILIOS } = require('./datos-domicilios');

/* -----------------------------------------------------------------------------
 * Configuracion
 * -------------------------------------------------------------------------- */

const PROYECTO_STAGING    = 'entorno-prueba-explora';
const PROYECTO_PRODUCCION = 'explora-portal';

/** La organizacion propia. No esta en el mapa de clientes: no es un cliente. */
const EXPLORA = {
  razon_social: 'EXPLORA S.A.',
  nombre_corto: 'EXPLORA',
  cuit: null,
  es_cliente: false,
  es_transportista: false,
  es_propia: true,
};

/**
 * Los productos que hoy estan hardcodeados en `Pedidos.js` como
 * PRODUCTOS_VALIDOS. Pasan a ser una coleccion con ABM: cambiarlos deja de
 * requerir un deploy.
 */
const PRODUCTOS = [
  { nombre: 'Biodiesel',     es_generico: false },
  { nombre: 'EMAG',          es_generico: false },
  { nombre: 'Glicerina',     es_generico: false },
  { nombre: 'Sebo',          es_generico: false },
  { nombre: 'HFFA Vegetal',  es_generico: false },
  { nombre: 'Aceite',        es_generico: false },
  // "Otro" es la valvula de escape. Los pedidos con producto generico NO se
  // escriben en el Plan de Produccion: el Apps Script rutea por nombre contra
  // una lista fija y este no esta.
  { nombre: 'Otro',          es_generico: true  },
];

/** Roles que se cargan. Los choferes se recrean desde el ABM. */
const ROLES_A_CARGAR = ['admin', 'coordinador', 'comercial', 'transportista'];

/** Roles internos: llevan el `organizacion_id` de Explora. */
const ROLES_INTERNOS = ['admin', 'coordinador', 'comercial'];

/* -----------------------------------------------------------------------------
 * Argumentos y conexion
 * -------------------------------------------------------------------------- */

function leerArgumentos() {
  const args = process.argv.slice(2);
  const o = { credencial: null, produccion: false, simular: false };

  for (let i = 0; i < args.length; i++) {
    if      (args[i] === '--credencial') o.credencial = args[++i];
    else if (args[i] === '--produccion') o.produccion = true;
    else if (args[i] === '--simular')    o.simular    = true;
  }

  if (!o.credencial) {
    console.error('\nFalta la credencial.\n');
    console.error('Uso:');
    console.error('  node scripts/cargar-entidades.js [--simular] [--produccion] \\');
    console.error('    --credencial <ruta.json>\n');
    process.exit(1);
  }

  return o;
}

function conectar(rutaCredencial, esProduccion) {
  const esperado = esProduccion ? PROYECTO_PRODUCCION : PROYECTO_STAGING;
  const cred = require(path.resolve(rutaCredencial));

  if (cred.project_id !== esperado) {
    console.error(`\nERROR: la credencial es del proyecto "${cred.project_id}"`);
    console.error(`       y se esperaba "${esperado}".\n`);
    console.error('       PARAR ACA. Revisá las rutas antes de volver a correrlo.\n');
    process.exit(1);
  }

  const app = initializeApp({ credential: cert(cred) }, 'carga');
  return { db: getFirestore(app), auth: getAuth(app), proyecto: esperado };
}

/* -----------------------------------------------------------------------------
 * Escritura idempotente por clave normalizada
 * -------------------------------------------------------------------------- */

/**
 * Crea o actualiza un documento buscandolo por `clave_normalizada`.
 *
 * El ID es autogenerado: nunca se deriva del contenido. Si mañana cambia la
 * razon social de una organizacion, el ID sigue siendo el mismo y las
 * referencias no se rompen.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} coleccion
 * @param {string} clave        valor de `clave_normalizada`
 * @param {Object} datos        campos del documento, sin la clave
 * @param {boolean} simular
 * @returns {Promise<{id: string|null, creado: boolean}>}
 */
async function crearOActualizar(db, coleccion, clave, datos, simular) {
  const existentes = await db.collection(coleccion)
    .where('clave_normalizada', '==', clave)
    .limit(1)
    .get();

  const ahora = new Date();

  if (!existentes.empty) {
    const ref = existentes.docs[0].ref;
    if (!simular) {
      await ref.set({ ...datos, clave_normalizada: clave, actualizado_en: ahora }, { merge: true });
    }
    return { id: ref.id, creado: false };
  }

  const ref = db.collection(coleccion).doc();   // ID autogenerado
  if (!simular) {
    await ref.set({
      ...datos,
      clave_normalizada: clave,
      creado_en: ahora,
      actualizado_en: ahora,
    });
  }
  return { id: simular ? null : ref.id, creado: true };
}

/* -----------------------------------------------------------------------------
 * Fase 1 — Organizaciones
 * -------------------------------------------------------------------------- */

/**
 * Crea las 43 organizaciones: los clientes y transportes del mapa, mas Explora.
 *
 * Una organizacion puede ser cliente Y transportista a la vez — es el caso del
 * cliente que pone su propio transporte. Hoy no pasa, pero el modelo lo
 * soporta con dos booleanos en vez de dos colecciones separadas.
 *
 * @returns {Promise<Map<string, string>>} razon social canonica -> ID del doc
 */
async function cargarOrganizaciones(db, simular, informe) {
  const { clientes, transportistas } = organizacionesACrear();
  const mapaIds = new Map();

  // Se arma primero el conjunto completo para detectar las que son las dos
  // cosas antes de escribir nada.
  const todas = new Map();
  for (const razon of clientes) {
    todas.set(razon, { es_cliente: true, es_transportista: false });
  }
  for (const razon of transportistas) {
    const previa = todas.get(razon);
    if (previa) previa.es_transportista = true;
    else todas.set(razon, { es_cliente: false, es_transportista: true });
  }

  console.log('');
  console.log('-'.repeat(70));
  console.log('ORGANIZACIONES');
  console.log('-'.repeat(70));

  let creadas = 0, actualizadas = 0;

  for (const [razon, banderas] of todas) {
    const clave = claveNormalizada(razon);
    const r = await crearOActualizar(db, 'organizaciones', clave, {
      razon_social: razon,
      nombre_corto: razon,      // se ajusta desde el ABM
      cuit: null,               // no hay CUIT de clientes en la base de hoy
      estado: 'activo',
      obs: '',
      es_cliente: banderas.es_cliente,
      es_transportista: banderas.es_transportista,
      es_propia: false,
      creado_por_uid: 'script:cargar-entidades',
    }, simular);

    mapaIds.set(razon, r.id);
    if (r.creado) creadas++; else actualizadas++;

    if (banderas.es_cliente && banderas.es_transportista) {
      informe.push(`Organizacion con doble rol: ${razon}`);
    }
  }

  // Explora, aparte: no es cliente ni transportista.
  const claveExplora = claveNormalizada(EXPLORA.razon_social);
  const rExplora = await crearOActualizar(db, 'organizaciones', claveExplora, {
    ...EXPLORA,
    estado: 'activo',
    obs: 'Organizacion propia. Origen o destino de todos los pedidos.',
    creado_por_uid: 'script:cargar-entidades',
  }, simular);

  mapaIds.set(EXPLORA.razon_social, rExplora.id);
  if (rExplora.creado) creadas++; else actualizadas++;

  console.log(`  ${creadas} creada(s), ${actualizadas} actualizada(s)`);
  console.log(`  Total: ${mapaIds.size}`);

  return mapaIds;
}

/* -----------------------------------------------------------------------------
 * Fase 2 — Domicilios y vinculos
 * -------------------------------------------------------------------------- */

/**
 * Crea los 34 domicilios y sus vinculos organizacion↔domicilio.
 *
 * El vinculo responde a "que domicilios ofrece esta organizacion", que es lo
 * que el formulario muestra al cargar un pedido. No es lo mismo que el destino:
 * la planta de Explora es destino de 18 pedidos de 8 clientes distintos y no
 * esta en la lista de ninguno de ellos.
 */
async function cargarDomicilios(db, orgIds, simular, informe) {
  console.log('');
  console.log('-'.repeat(70));
  console.log('DOMICILIOS Y VINCULOS');
  console.log('-'.repeat(70));

  let creados = 0, actualizados = 0, vinculos = 0, vinculosFallidos = 0;

  for (const d of DOMICILIOS) {
    const clave = claveDomicilio(d);
    const r = await crearOActualizar(db, 'domicilios', clave, {
      calle: d.calle,
      numero: d.numero || null,
      ciudad: d.ciudad,
      provincia: d.provincia,
      cp: d.cp || null,
      maps_link: null,
      // Los que entran por carga inicial quedan sin verificar: hay dos con
      // codigo Plus de Google en vez de calle, y una direccion de SENASA que
      // tenia un "$" donde deberia decir "4". Aparecen en la cola de revision
      // del ABM.
      verificado: false,
      estado: 'activo',
      obs: '',
      creado_por_uid: 'script:cargar-entidades',
    }, simular);

    if (r.creado) creados++; else actualizados++;

    for (const v of (d.organizaciones || [])) {
      const orgId = orgIds.get(v.org);
      if (!orgId && !simular) {
        informe.push(`Vinculo sin organizacion: "${v.org}" para ${d.calle} ${d.numero || ''}`);
        vinculosFallidos++;
        continue;
      }

      // El vinculo es una relacion, no una entidad: su clave es el par.
      const claveVinculo = `${orgId || v.org}|${r.id || clave}`;
      await crearOActualizar(db, 'organizacion_domicilios', claveVinculo, {
        organizacion_id: orgId,
        domicilio_id: r.id,
        alias: v.alias || null,
        principal: v.principal === true,
      }, simular);
      vinculos++;
    }
  }

  console.log(`  Domicilios: ${creados} creado(s), ${actualizados} actualizado(s)`);
  console.log(`  Vinculos:   ${vinculos}` + (vinculosFallidos ? `  (${vinculosFallidos} fallido(s))` : ''));
}

/* -----------------------------------------------------------------------------
 * Fase 3 — Productos
 * -------------------------------------------------------------------------- */

async function cargarProductos(db, simular) {
  console.log('');
  console.log('-'.repeat(70));
  console.log('PRODUCTOS');
  console.log('-'.repeat(70));

  let creados = 0, actualizados = 0;

  for (const p of PRODUCTOS) {
    const r = await crearOActualizar(db, 'productos', claveNormalizada(p.nombre), {
      nombre: p.nombre,
      codigo: null,
      activo: true,
      es_generico: p.es_generico,
      obs: '',
      creado_por_uid: 'script:cargar-entidades',
    }, simular);
    if (r.creado) creados++; else actualizados++;
  }

  console.log(`  ${creados} creado(s), ${actualizados} actualizado(s)`);
}

/* -----------------------------------------------------------------------------
 * Fase 4 — Usuarios
 * -------------------------------------------------------------------------- */

/**
 * Arma la lista de telefonos de un usuario desde los pares prefijo_N/numero_N.
 *
 * Reemplaza a seis campos sueltos por un array. Los que quedan vacios no se
 * cargan: hoy hay 56 usuarios y un solo telefono cargado, porque el formulario
 * pedia el dato en veinte lugares distintos.
 */
function armarTelefonos(u) {
  const salida = [];
  for (let n = 1; n <= 3; n++) {
    const prefijo = String(u[`prefijo_${n}`] || '').trim();
    const numero  = String(u[`numero_${n}`]  || '').trim();
    if (numero) salida.push(prefijo ? `(${prefijo}) ${numero}` : numero);
  }
  return salida;
}

/**
 * Arma la lista de emails de contacto, sin repetidos y sin el de login.
 *
 * En `transportistas_portal` hay un caso con `email_2` y `email_3` iguales
 * entre si y con una errata de tipeo ("@gmmail.com"). La repeticion se saca
 * aca; la errata no se puede detectar automaticamente y sale en el informe.
 */
function armarEmails(fuente, emailLogin) {
  const vistos = new Set([String(emailLogin || '').trim().toLowerCase()]);
  const salida = [];

  for (let n = 1; n <= 3; n++) {
    const email = String(fuente[`email_${n}`] || '').trim();
    if (!email) continue;
    const clave = email.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(email);
  }

  return salida;
}

/**
 * Carga los usuarios internos y los transportistas.
 *
 * NO carga choferes: se recrean desde el ABM. Ninguno usa el portal hoy, y los
 * documentos que hay estan incompletos.
 *
 * Para cada uno verifica que exista la cuenta de Firebase Auth con ese UID. Un
 * documento cuyo ID no sea un UID real es un usuario que figura en el padron y
 * no puede entrar a ningun lado — y en el modelo nuevo, ademas, las reglas le
 * niegan todo porque `usuarios/{authUid}` no existiria.
 */
async function cargarUsuarios(db, auth, orgIds, simular, informe) {
  console.log('');
  console.log('-'.repeat(70));
  console.log('USUARIOS');
  console.log('-'.repeat(70));

  const snapUsuarios = await db.collection('usuarios_portal').get();
  const snapTransportistas = await db.collection('transportistas_portal').get();

  // Ficha de empresa por organizacion canonica, para completar el contacto del
  // usuario transportista. Hoy los telefonos de la empresa viven en
  // `transportistas_portal` y los del usuario en `usuarios_portal`, en dos
  // formatos distintos. En el modelo nuevo los telefonos son de la persona.
  const fichasEmpresa = new Map();
  for (const doc of snapTransportistas.docs) {
    const t = doc.data();
    const r = resolverOrganizacionSuave(t.empresa, 'transporte');
    if (r.canonico) {
      fichasEmpresa.set(r.canonico, t);
    } else {
      informe.push(`transportistas_portal: empresa sin resolver "${t.empresa}"`);
    }
  }

  let creados = 0, salteadosPorRol = 0, sinAuth = 0, sinOrganizacion = 0;

  for (const doc of snapUsuarios.docs) {
    const u = doc.data();
    const rol = String(u.rol || '').trim();

    if (!ROLES_A_CARGAR.includes(rol)) { salteadosPorRol++; continue; }

    // El ID del documento tiene que ser el UID de Auth. Si no existe la cuenta,
    // no se carga: seria un usuario sin acceso posible.
    try {
      await auth.getUser(doc.id);
    } catch (err) {
      informe.push(`SIN CUENTA DE AUTH: ${u.nombre || doc.id} (${rol}) — no se carga`);
      sinAuth++;
      continue;
    }

    // La organizacion: Explora para los internos, la empresa resuelta para los
    // transportistas. Aca es donde se arregla el vinculo roto de hoy: la ficha
    // de empresa dice "RAD" y el usuario dice "Transporte RAD", y como se
    // comparaban como strings, `nominar()` rechazaba nominaciones validas.
    let organizacionId = null;
    let fichaEmpresa = null;

    if (ROLES_INTERNOS.includes(rol)) {
      organizacionId = orgIds.get(EXPLORA.razon_social);
    } else {
      const r = resolverOrganizacionSuave(u.empresa, 'transporte');
      if (r.canonico) {
        organizacionId = orgIds.get(r.canonico) || null;
        fichaEmpresa = fichasEmpresa.get(r.canonico) || null;
      }
      if (!organizacionId) {
        informe.push(`SIN ORGANIZACION: ${u.nombre || doc.id} (${rol}) empresa "${u.empresa}" — no se carga`);
        sinOrganizacion++;
        continue;
      }
    }

    const emailLogin = String(u.email || u.email_1 || '').trim();

    // El contacto del transportista sale de las dos fuentes: la ficha de
    // empresa y el propio usuario. Los telefonos de la empresa pasan a ser de
    // la persona que los atiende.
    const telefonos = armarTelefonos(u);
    if (fichaEmpresa) {
      for (let n = 1; n <= 3; n++) {
        const tel = String(fichaEmpresa[`telefono_${n}`] || '').trim();
        if (tel && !telefonos.includes(tel)) telefonos.push(tel);
      }
    }

    const emailsExtra = armarEmails(u, emailLogin);
    if (fichaEmpresa) {
      for (const e of armarEmails(fichaEmpresa, emailLogin)) {
        if (!emailsExtra.includes(e)) emailsExtra.push(e);
      }
    }

    const datos = {
      nombre: String(u.nombre || '').trim(),
      email: emailLogin,
      roles: [rol],
      estado: u.estado === 'inactivo' ? 'inactivo' : 'activo',
      organizacion_id: organizacionId,
      telefonos,
      emails_extra: emailsExtra,
      // Solo los choferes tienen datos_chofer, y los choferes no se cargan.
      datos_chofer: null,
      creado_por_uid: 'script:cargar-entidades',
      actualizado_en: new Date(),
    };

    if (!simular) {
      const ref = db.collection('usuarios').doc(doc.id);   // el ID ES el UID
      const previo = await ref.get();
      if (!previo.exists) datos.creado_en = new Date();
      await ref.set(datos, { merge: true });
    }

    creados++;

    // El CUIT de la empresa se guarda en la organizacion, no en el usuario.
    if (fichaEmpresa && fichaEmpresa.cuit_empresa && !simular) {
      const cuit = normalizarCuit(fichaEmpresa.cuit_empresa);
      if (cuit) {
        await db.collection('organizaciones').doc(organizacionId)
          .set({ cuit }, { merge: true });
      } else {
        informe.push(`CUIT invalido en ${u.empresa}: "${fichaEmpresa.cuit_empresa}"`);
      }
    }
  }

  console.log(`  ${creados} cargado(s)`);
  console.log(`  ${salteadosPorRol} salteado(s) por rol (choferes y otros)`);
  if (sinAuth)         console.log(`  ${sinAuth} SIN CUENTA DE AUTH`);
  if (sinOrganizacion) console.log(`  ${sinOrganizacion} SIN ORGANIZACION`);
}

/* -----------------------------------------------------------------------------
 * Fase 5 — Contadores
 * -------------------------------------------------------------------------- */

/**
 * Inicializa el contador de pedidos, si no existe.
 *
 * Reemplaza al numero aleatorio de `genNro()`: hoy el "165" de
 * "PED-260819-165" sale de Math.random() sobre 900 valores, sin verificar que
 * no exista. Con 40 pedidos en un dia, la probabilidad de repetir supera el
 * 50% — y el Apps Script identifica el pedido por ese numero.
 */
async function cargarContadores(db, simular) {
  console.log('');
  console.log('-'.repeat(70));
  console.log('CONTADORES');
  console.log('-'.repeat(70));

  const ref = db.collection('contadores').doc('pedidos');
  const previo = await ref.get();

  if (previo.exists) {
    console.log(`  contadores/pedidos ya existe (ultimo: ${previo.data().ultimo})`);
    return;
  }

  if (!simular) await ref.set({ ultimo: 0 });
  console.log('  contadores/pedidos inicializado en 0');
}

/* -----------------------------------------------------------------------------
 * Programa principal
 * -------------------------------------------------------------------------- */

async function principal() {
  const o = leerArgumentos();
  const { db, auth, proyecto } = conectar(o.credencial, o.produccion);
  const informe = [];

  console.log('');
  console.log('='.repeat(70));
  console.log(o.simular
    ? 'SIMULACION — no se va a escribir nada'
    : 'CARGA REAL');
  console.log('='.repeat(70));
  console.log(`Proyecto: ${proyecto}`);

  const inicio = Date.now();

  const orgIds = await cargarOrganizaciones(db, o.simular, informe);
  await cargarDomicilios(db, orgIds, o.simular, informe);
  await cargarProductos(db, o.simular);
  await cargarUsuarios(db, auth, orgIds, o.simular, informe);
  await cargarContadores(db, o.simular);

  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);

  if (informe.length > 0) {
    console.log('');
    console.log('='.repeat(70));
    console.log('PARA REVISAR');
    console.log('='.repeat(70));
    for (const linea of informe) console.log(`  - ${linea}`);
  }

  console.log('');
  console.log('-'.repeat(70));
  console.log(o.simular
    ? `Simulacion terminada en ${segundos}s. No se escribio nada.`
    : `Carga terminada en ${segundos}s.`);
  console.log('-'.repeat(70));
  console.log('');

  if (!o.simular) {
    console.log('ANTES DE SEGUIR, COMPROBAR QUE:');
    console.log('  - Existen 43 organizaciones, una con es_propia = true');
    console.log('  - Existen 34 domicilios y 34 vinculos');
    console.log('  - Existen 7 productos, uno con es_generico = true');
    console.log('  - Tu propio usuario existe en `usuarios` con rol admin y estado activo');
    console.log('  - Ningun usuario quedo sin organizacion_id');
    console.log('  - Correr el script una segunda vez no crea duplicados');
    console.log('');
  }

  process.exit(0);
}

principal().catch(err => {
  console.error('\nLa carga fallo:');
  console.error(err);
  process.exit(1);
});
