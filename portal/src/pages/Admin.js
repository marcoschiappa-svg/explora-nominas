/**
 * =============================================================================
 * Admin.js — Administración del portal (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Pantalla de administración, con dos responsabilidades:
 *
 *   1. GESTIÓN DE USUARIOS del portal: alta, edición, activación, reseteo de
 *      contraseña y baja, para los cinco roles (admin, coordinador, comercial,
 *      transportista, chofer). Incluye importación masiva de choferes desde
 *      Excel y exportación a CSV.
 *
 *   2. SUPERVISIÓN DE VIAJES: lista los viajes en curso y permite cerrarlos a
 *      mano cuando el chofer se olvidó de hacerlo desde la app, más el historial
 *      de los finalizados recientes.
 *
 * -----------------------------------------------------------------------------
 * LOS DOS LOGIN: EMAIL Y DNI
 * -----------------------------------------------------------------------------
 * Firebase Authentication exige un email para autenticar, pero los choferes
 * ingresan con su DNI. La solución es sintética: a cada chofer se le crea un
 * email ficticio `{dni}@explora-portal.com` (constante `CHOFER_DOMAIN`), que
 * nunca se usa para enviar correo. La app y el portal arman ese mismo string a
 * partir del DNI que tipea el chofer.
 *
 * Consecuencia práctica: un chofer NO puede recuperar su contraseña por email,
 * porque su email no existe. Por eso se guarda `password_visible` en su
 * documento y el admin puede reenviársela. Es una decisión consciente de
 * usabilidad sobre seguridad, para una población que en general no tiene email
 * corporativo.
 *
 * -----------------------------------------------------------------------------
 * LA SEGUNDA INSTANCIA DE FIREBASE
 * -----------------------------------------------------------------------------
 * `createUserWithEmailAndPassword` inicia sesión automáticamente con el usuario
 * recién creado. Si se usara la instancia principal, el admin quedaría logueado
 * como el usuario que acaba de dar de alta y perdería su propia sesión.
 *
 * Por eso se levanta una app secundaria (`secondary`) con la misma config, que
 * se usa solo para crear cuentas y de la que se cierra sesión enseguida.
 *
 * -----------------------------------------------------------------------------
 * CAMBIOS (agosto 2026)
 * -----------------------------------------------------------------------------
 *   1. CORRECCIÓN DEL TIMESTAMP DE CIERRE MANUAL. `finalizarViaje()` escribía
 *      `chofer_fin_ts` con `toLocaleString('es-AR')`, que produce un texto en
 *      formato 12 horas SIN AM/PM — ambiguo e imposible de parsear con
 *      `new Date()`. La app TrackEx escribe ese mismo campo en ISO 8601, así que
 *      convivían dos formatos incompatibles en el mismo campo.
 *
 *      La consecuencia era concreta: la pantalla de Seguimiento ordena el
 *      historial con `new Date(chofer_fin_ts)` y mostraba "Invalid Date" con un
 *      orden impredecible para todo viaje cerrado a mano. Ahora se escribe ISO.
 *
 *   2. TRAZABILIDAD DEL CIERRE MANUAL. Se agregan `finalizado_manual`,
 *      `finalizado_por` y `finalizado_en`. Antes un viaje cerrado por el admin
 *      era indistinguible de uno cerrado por el chofer, y eso importa: si un
 *      chofer nunca cierra sus viajes, es un problema de uso de la app que
 *      conviene poder detectar.
 *
 *   3. SECCIÓN DE VIAJES FINALIZADOS. El bloque "Viajes activos" filtra por
 *      `recibido/iniciado/demorado`, así que un viaje terminado desaparecía de
 *      la pantalla sin dejar rastro y no había ninguna vista que lo recuperara.
 *      Ahora hay un historial desplegable con duración y estado del GPS.
 * =============================================================================
 */

import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { db, auth } from '../firebase';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';

// Segunda instancia de Firebase solo para crear/modificar usuarios sin romper la sesión del admin
const firebaseConfig = {
  apiKey: "AIzaSyA_cmSLuKPVYXjgQu75varhmEBkaY0uwss",
  authDomain: "explora-portal.firebaseapp.com",
  projectId: "explora-portal",
  storageBucket: "explora-portal.firebasestorage.app",
  messagingSenderId: "871895783017",
  appId: "1:871895783017:web:9503299046accde84774f8"
};
// Se reutiliza la instancia si ya existe: `initializeApp` con un nombre repetido
// lanza excepción, y este módulo puede evaluarse más de una vez en desarrollo.
const secondaryApp  = getApps().find(a => a.name === 'secondary') || initializeApp(firebaseConfig, 'secondary');
const secondaryAuth = getAuth(secondaryApp);

/**
 * Dominio sintético para el login de choferes por DNI.
 * No es un dominio real y nunca recibe correo: existe solo porque Firebase Auth
 * necesita un email como identificador.
 */
const CHOFER_DOMAIN = '@explora-portal.com';

/** Estado inicial del formulario de usuario. */
const FORM_VACIO = {
  nombre: '', email_1: '', email_2: '', email_3: '',
  prefijo_1: '', numero_1: '',
  prefijo_2: '', numero_2: '',
  prefijo_3: '', numero_3: '',
  password: '', nueva_password: '', rol: 'comercial',
  empresa: '', cuit_empresa: '', estado: 'activo',
  dni: '',
  cuit_chofer: '',
};

/** Cantidad de viajes finalizados que se muestran antes de "ver todos". */
const LIMITE_FINALIZADOS = 15;

/**
 * Parsea un timestamp de forma tolerante.
 *
 * Conviven dos formatos en la base: ISO 8601 (lo que escribe la app TrackEx y,
 * desde este cambio, también el cierre manual) y `toLocaleString('es-AR')` en 12h
 * sin AM/PM, que quedó en registros históricos y que `new Date()` no puede
 * interpretar.
 *
 * @param {string} valor
 * @returns {number|null} Milisegundos desde época, o null si no es parseable.
 */
function msSeguroA(valor) {
  if (!valor) return null;
  const ms = new Date(valor).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Formatea un timestamp como 'DD/MM HH:MM'.
 * Si no es parseable devuelve el texto original en vez de "Invalid Date".
 *
 * @param {string} valor
 * @returns {string}
 */
function formatTsA(valor) {
  if (!valor) return '—';
  const ms = msSeguroA(valor);
  if (ms === null) return String(valor);
  return new Date(ms).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Duración entre dos timestamps, en lenguaje natural.
 *
 * Devuelve '—' si alguno de los dos no es parseable, en vez de un número
 * absurdo: es preferible no informar a informar mal.
 *
 * @param {string} inicio ISO 8601.
 * @param {string} fin ISO 8601.
 * @returns {string} 'Xh Ym', 'Ym', o '—'.
 */
function duracionViaje(inicio, fin) {
  const msIni = msSeguroA(inicio);
  const msFin = msSeguroA(fin);
  if (msIni === null || msFin === null || msFin < msIni) return '—';
  const min = Math.round((msFin - msIni) / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

/* =============================================================================
 * COMPONENTE
 * ========================================================================== */

/**
 * Pantalla de administración.
 *
 * @param {Object} props
 * @param {Object} props.usuario Perfil autenticado; se usa `nombre` para dejar
 *   registro de quién creó cada usuario y quién cerró cada viaje a mano.
 * @param {Function} props.onVolver Callback para volver al inicio del portal.
 */
function Admin({ usuario, onVolver }) {
  const [usuarios, setUsuarios] = useState([]);
  const [filtroRol, setFiltroRol] = useState('todos');
  const [busquedaUsuario, setBusquedaUsuario] = useState('');
  const [pedidos, setPedidos] = useState([]);
  const [vista, setVista] = useState('lista');
  const [editando, setEditando] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [verPassword, setVerPassword] = useState(false);
  const [verNuevaPassword, setVerNuevaPassword] = useState(false);
  const [credencialCreada, setCredencialCreada] = useState(null);
  const [generandoLink, setGenerandoLink] = useState(false);
  const [finalizando, setFinalizando] = useState(null);
  const [importando, setImportando] = useState(false);
  const [resultadoImport, setResultadoImport] = useState(null);
  const [modalExport, setModalExport] = useState(false);
  const [empresaExport, setEmpresaExport] = useState('');
  const [seleccionados, setSeleccionados] = useState([]);
  const [form, setForm] = useState(FORM_VACIO);
  const [eliminandoMasivo, setEliminandoMasivo] = useState(false);

  /** ¿Está desplegado el historial de viajes finalizados? */
  const [verFinalizados, setVerFinalizados] = useState(false);

  /** ¿Se muestran todos los finalizados o solo los primeros LIMITE_FINALIZADOS? */
  const [verTodosFinalizados, setVerTodosFinalizados] = useState(false);

  /* ---------------------------------------------------------------------------
   * Suscripciones
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'usuarios_portal'), (snap) => {
      const data = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
      data.sort((a, b) => a.nombre?.localeCompare(b.nombre));
      setUsuarios(data);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      setPedidos(snap.docs.map(d => ({ docId: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  /* ---------------------------------------------------------------------------
   * Derivación de viajes desde los pedidos
   *
   * Los viajes no son una colección propia: hay que recorrer todos los pedidos y
   * todos sus despachos. Se hace en el cuerpo del componente y no en un estado
   * aparte para que siempre refleje el último snapshot sin sincronización extra.
   * ------------------------------------------------------------------------ */

  // Viajes activos: despachos con estado_chofer en recibido/iniciado/demorado
  const viajesActivos = [];
  pedidos.forEach(p => {
    (p.despachos || []).forEach((d, i) => {
      const ec = d.estado_chofer || '';
      if (!['recibido', 'iniciado', 'demorado'].includes(ec)) return;
      viajesActivos.push({
        docId: p.docId,
        pedidoId: p.id,
        despachoIdx: i,
        uid: p.id + '-D' + (i + 1),
        chofer: d.chofer || 'Sin nombre',
        dni_chofer: d.dni_chofer || '',
        transporte: d.transporte || '',
        producto: p.producto,
        cliente: p.cliente,
        fecha_carga: d.fecha_carga || '',
        estado_chofer: ec,
        patente_tractor: d.patente_tractor || '',
      });
    });
  });

  /**
   * Viajes finalizados, del más reciente al más antiguo.
   *
   * Existe porque el bloque de arriba filtra los finalizados, y hasta ahora no
   * había NINGUNA vista del portal que los recuperara: un viaje terminado
   * desaparecía de la pantalla sin dejar rastro.
   */
  const viajesFinalizados = [];
  pedidos.forEach(p => {
    (p.despachos || []).forEach((d, i) => {
      if ((d.estado_chofer || '') !== 'finalizado') return;
      viajesFinalizados.push({
        docId: p.docId,
        pedidoId: p.id,
        despachoIdx: i,
        uid: p.id + '-D' + (i + 1),
        chofer: d.chofer || 'Sin nombre',
        dni_chofer: d.dni_chofer || '',
        transporte: d.transporte || '',
        producto: p.producto,
        cliente: p.cliente,
        ov: p.ov,
        fecha_carga: d.fecha_carga || '',
        patente_tractor: d.patente_tractor || '',
        chofer_inicio_ts: d.chofer_inicio_ts || '',
        chofer_fin_ts: d.chofer_fin_ts || '',
        gps_estado: d.gps_estado || '',
        // Cantidad de puntos de la traza. Sirve para detectar de un vistazo si el
        // seguimiento funcionó: un viaje largo con 0 puntos es una señal de que
        // el GPS del chofer no está registrando.
        puntosGps: (p[`gps_track_${i}`] || []).length,
        finalizado_manual: !!d.finalizado_manual,
        finalizado_por: d.finalizado_por || '',
      });
    });
  });
  // Orden descendente por fin de viaje. Si el timestamp no es parseable (formato
  // local de registros históricos), se cae a la fecha de carga.
  viajesFinalizados.sort((a, b) => {
    const msA = msSeguroA(a.chofer_fin_ts) ?? msSeguroA(a.fecha_carga) ?? 0;
    const msB = msSeguroA(b.chofer_fin_ts) ?? msSeguroA(b.fecha_carga) ?? 0;
    return msB - msA;
  });

  const finalizadosVisibles = verTodosFinalizados
    ? viajesFinalizados
    : viajesFinalizados.slice(0, LIMITE_FINALIZADOS);

  /* ---------------------------------------------------------------------------
   * Acciones sobre viajes
   * ------------------------------------------------------------------------ */

  /**
   * Cierra manualmente un viaje que el chofer no cerró desde la app.
   *
   * Limpia las coordenadas de "última posición" porque el camión ya no está en
   * viaje y no corresponde seguir mostrándolo en el mapa en vivo. NO toca la
   * traza `gps_track_{i}`, que es el historial del recorrido y debe conservarse.
   *
   * El timestamp se escribe en ISO 8601. Antes se usaba `toLocaleString('es-AR')`,
   * que genera un texto en 12 horas sin AM/PM: ambiguo, no ordenable, y que
   * `new Date()` no puede parsear. Como la app escribe este mismo campo en ISO,
   * convivían dos formatos incompatibles y la pantalla de Seguimiento mostraba
   * "Invalid Date" para todo viaje cerrado a mano.
   *
   * @param {Object} v Viaje activo a cerrar.
   */
  async function finalizarViaje(v) {
    if (!window.confirm(`¿Finalizar manualmente el viaje de ${v.chofer}?\nEsto limpiará el estado GPS y marcará el viaje como finalizado.`)) return;
    setFinalizando(v.uid);
    try {
      const pedido = pedidos.find(p => p.docId === v.docId);
      const nuevosDespachos = [...pedido.despachos];
      const ahoraISO = new Date().toISOString();
      nuevosDespachos[v.despachoIdx] = {
        ...nuevosDespachos[v.despachoIdx],
        estado_chofer: 'finalizado',
        estado_chofer_ts: ahoraISO,
        chofer_fin_ts: ahoraISO,
        // Trazabilidad: distingue un cierre administrativo de uno hecho por el
        // chofer. Si un chofer nunca cierra sus viajes, es un problema de uso de
        // la app que conviene poder detectar.
        finalizado_manual: true,
        finalizado_por: usuario?.nombre || 'Admin',
        finalizado_en: ahoraISO,
        // Última posición: se limpia porque el viaje terminó. La traza completa
        // vive en `gps_track_{i}` a nivel del documento y no se toca.
        gps_lat: null,
        gps_lng: null,
        gps_ts: null,
        gps_lat_prev: null,
        gps_lng_prev: null,
      };
      await updateDoc(doc(db, 'pedidos_portal', v.docId), { despachos: nuevosDespachos });
      alert(`✓ Viaje de ${v.chofer} finalizado.`);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setFinalizando(null);
    }
  }

  /* ---------------------------------------------------------------------------
   * Importación y exportación de choferes
   * ------------------------------------------------------------------------ */

  /**
   * Importa choferes desde un Excel, creando la cuenta de Auth y el documento.
   *
   * Formato esperado por columna: 0 número de orden, 1 nombre, 3 DNI, 4 CUIT,
   * 5 empresa, 6 contraseña (opcional). Las filas se detectan por tener un número
   * en la columna 0, lo que descarta encabezados y filas sueltas sin depender de
   * que el archivo tenga siempre la misma cantidad de líneas de título.
   *
   * Si el archivo no trae contraseña se genera una con el patrón
   * `Nombre` + `2026`, que es fácil de dictar por teléfono.
   *
   * Los errores se acumulan por fila en vez de abortar: que un chofer falle no
   * debe impedir que se creen los otros cuarenta.
   *
   * @param {Event} e Evento change del input file.
   */
  async function importarChoferes(e) {
    const file = e.target.files[0];
    if (!file) return;
    // Se limpia el input para que volver a elegir el mismo archivo dispare el
    // evento de nuevo.
    e.target.value = '';
    setImportando(true);
    setResultadoImport(null);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      // Buscar fila de datos (tiene número en col 0)
      const datoRows = rows.filter(r => r[0] && !isNaN(Number(r[0])));
      let creados = 0, duplicados = 0, errores = [];
      for (const row of datoRows) {
        const nombre = String(row[1] || '').trim();
        const dniRaw = String(row[3] || '').trim().replace(/\D/g, '');
        const cuit = String(row[4] || '').trim();
        const empresa = String(row[5] || '').trim();
        const passwordArchivo = String(row[6] || '').trim();
        if (!nombre || !dniRaw) continue;
        // Verificar duplicado
        const existente = usuarios.find(u => u.dni === dniRaw && u.rol === 'chofer');
        if (existente) { duplicados++; continue; }
        try {
          const emailAuth = dniRaw + '@explora-portal.com';
          const password = passwordArchivo || (nombre.split(/[,\s]+/)[0].charAt(0).toUpperCase() + nombre.split(/[,\s]+/)[0].slice(1).toLowerCase() + '2026');
          const cred = await createUserWithEmailAndPassword(secondaryAuth, emailAuth, password);
          await setDoc(doc(db, 'usuarios_portal', cred.user.uid), {
            nombre, dni: dniRaw, cuit_chofer: cuit,
            empresa, rol: 'chofer', estado: 'activo',
            email_1: '', email_2: '', email_3: '',
            prefijo_1: '', numero_1: '', prefijo_2: '', numero_2: '', prefijo_3: '', numero_3: '',
            cuit_empresa: '', password_visible: password,
            creado_por: usuario?.nombre || 'Admin',
            creado_en: new Date().toLocaleString('es-AR'),
          });
          creados++;
        } catch (err) {
          errores.push(nombre + ': ' + err.message);
        }
      }
      setResultadoImport({ creados, duplicados, errores });
    } catch (err) {
      alert('Error al leer el archivo: ' + err.message);
    } finally {
      setImportando(false);
    }
  }

  /** Empresas transportistas que tienen al menos un chofer cargado. */
  function empresasDisponibles() {
    return [...new Set(usuarios.filter(u => u.rol === 'chofer' && u.empresa).map(u => u.empresa))].sort();
  }

  /**
   * Descarga un CSV con los choferes, opcionalmente filtrados por empresa.
   *
   * Incluye `password_visible` porque es el mecanismo por el que se le entregan
   * las credenciales al chofer: no tiene email para recuperarlas.
   *
   * Las comillas se duplican según el estándar CSV, para que un nombre con comas
   * no rompa la estructura del archivo.
   *
   * @param {string} empresa Empresa a filtrar, o cadena vacía para todas.
   */
  function descargarChoferes(empresa) {
    const choferesFiltrados = usuarios.filter(u =>
      u.rol === 'chofer' && (!empresa || u.empresa === empresa)
    );
    if (choferesFiltrados.length === 0) { alert('No hay choferes para exportar.'); return; }
    const headers = ['Nombre y Apellido', 'DNI (login)', 'Contraseña', 'CUIT Chofer', 'Empresa'];
    const filas = choferesFiltrados.map(u => [
      u.nombre || '', u.dni || '', u.password_visible || '—',
      u.cuit_chofer || '', u.empresa || '',
    ]);
    const csv = [headers, ...filas].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const nombre = empresa ? empresa.replace(/\s+/g, '_') : 'todos';
    a.href = url; a.download = `choferes_${nombre}.csv`; a.click();
    // Liberar el object URL: si no, el blob queda en memoria hasta recargar.
    URL.revokeObjectURL(url);
    setModalExport(false);
  }

  /** Abre el modal de exportación con el filtro en blanco. */
  function exportarChoferes() {
    setEmpresaExport('');
    setModalExport(true);
  }

  /* ---------------------------------------------------------------------------
   * Formulario de usuario
   * ------------------------------------------------------------------------ */

  /**
   * Genera un handler de cambio para un campo del formulario.
   * @param {string} field Nombre del campo.
   * @returns {Function} Handler de onChange.
   */
  function f(field) {
    return e => setForm(prev => ({ ...prev, [field]: e.target.value }));
  }

  /** Abre el formulario en blanco para crear un usuario nuevo. */
  function abrirNuevo() {
    setEditando(null);
    setCredencialCreada(null);
    setVerPassword(false);
    setVerNuevaPassword(false);
    setForm(FORM_VACIO);
    setVista('form');
  }

  /**
   * Abre el formulario precargado para editar un usuario.
   *
   * `email_1` se completa con `u.email` como respaldo: los usuarios más viejos
   * guardaban un solo campo `email` antes de que existieran los tres.
   *
   * @param {Object} u Usuario a editar.
   */
  function abrirEditar(u) {
    setEditando(u);
    setCredencialCreada(null);
    setVerPassword(false);
    setVerNuevaPassword(false);
    setForm({
      nombre:          u.nombre          || '',
      email_1:         u.email_1         || u.email || '',
      email_2:         u.email_2         || '',
      email_3:         u.email_3         || '',
      prefijo_1:       u.prefijo_1       || '',
      numero_1:        u.numero_1        || '',
      prefijo_2:       u.prefijo_2       || '',
      numero_2:        u.numero_2        || '',
      prefijo_3:       u.prefijo_3       || '',
      numero_3:        u.numero_3        || '',
      password:        '',
      nueva_password:  '',
      rol:             u.rol             || 'comercial',
      empresa:         u.empresa         || '',
      cuit_empresa:    u.cuit_empresa    || '',
      estado:          u.estado          || 'activo',
      dni:             u.dni             || '',
      cuit_chofer:     u.cuit_chofer     || '',
    });
    setVista('form');
  }

  /**
   * Copia las credenciales al portapapeles con un texto listo para WhatsApp.
   * El mensaje difiere según el rol porque el chofer ingresa por otra pantalla.
   */
  function copiarCredencial() {
    if (!credencialCreada) return;
    let texto;
    if (credencialCreada.esChofer) {
      texto = `Portal Explora — Acceso Chofer\nDNI: ${credencialCreada.dni}\nContraseña: ${credencialCreada.password}\nAcceso: https://portal-ivory-zeta.vercel.app\n\nIngresá tocando "Ingresar como chofer (DNI)"`;
    } else {
      texto = `Portal Explora\nUsuario: ${credencialCreada.email}\nContraseña: ${credencialCreada.password}\nAcceso: https://portal-ivory-zeta.vercel.app`;
    }
    navigator.clipboard.writeText(texto);
    alert('✓ Credenciales copiadas al portapapeles.');
  }

  /**
   * Envía un email de recuperación de contraseña.
   *
   * No funciona para choferes: su email es sintético y no existe como buzón. Por
   * eso el botón que la invoca se muestra solo cuando `esEmailPassword` da true.
   *
   * @param {Object} u Usuario.
   */
  async function generarResetLink(u) {
    const email = u.email_1 || u.email;
    if (!email) { alert('El usuario no tiene email registrado.'); return; }
    setGenerandoLink(true);
    try {
      await sendPasswordResetEmail(auth, email);
      const texto = `Portal Explora — Recuperación de contraseña\nUsuario: ${email}\nAccedé al link que te llegó por mail para restablecer tu contraseña, o pedile al administrador que te lo reenvíe.\nAcceso: https://portal-ivory-zeta.vercel.app`;
      navigator.clipboard.writeText(texto);
      alert(`✓ Email de recuperación enviado a ${email}.\nEl texto fue copiado al portapapeles para enviarlo por WhatsApp.`);
    } catch (err) {
      alert('Error al generar el link: ' + err.message);
    } finally {
      setGenerandoLink(false);
    }
  }

  /**
   * Crea o actualiza un usuario.
   *
   * En ALTA: crea la cuenta en Auth con la instancia secundaria, cierra esa
   * sesión enseguida para no desplazar la del admin, y escribe el documento en
   * `usuarios_portal` usando el UID como ID. Esa correspondencia entre UID y ID
   * de documento es importante: la app resuelve el perfil del chofer con
   * `getDoc(usuarios_portal/{uid})`.
   *
   * En EDICIÓN: el email no se puede cambiar (está en `disabled`), porque
   * cambiarlo en Firestore no lo cambiaría en Auth y el usuario quedaría con dos
   * identidades distintas.
   *
   * @param {Event} e Evento submit.
   */
  async function guardar(e) {
    e.preventDefault();
    const esChofer = form.rol === 'chofer';
    if (!form.nombre || !form.rol) { alert('Completá nombre y rol.'); return; }
    if (!esChofer && !form.email_1) { alert('Completá el email principal.'); return; }
    if (esChofer && !form.dni) { alert('Ingresá el DNI del chofer.'); return; }
    if (esChofer && !form.cuit_chofer) { alert('El CUIT del chofer es obligatorio.'); return; }
    if (!editando && !form.password) { alert('Ingresá una contraseña.'); return; }
    if (!editando && form.password.length < 6) { alert('La contraseña debe tener al menos 6 caracteres.'); return; }
    if (editando && form.nueva_password && form.nueva_password.length < 6) { alert('La nueva contraseña debe tener al menos 6 caracteres.'); return; }

    // El chofer se autentica con un email sintético derivado de su DNI.
    const emailAuth = esChofer
      ? form.dni.trim().replace(/\D/g, '') + CHOFER_DOMAIN
      : form.email_1;

    setEnviando(true);
    try {
      const datos = {
        nombre:       form.nombre,
        email_1:      esChofer ? '' : form.email_1,
        email_2:      form.email_2      || '',
        email_3:      form.email_3      || '',
        email:        emailAuth,
        prefijo_1:    form.prefijo_1    || '',
        numero_1:     form.numero_1     || '',
        prefijo_2:    form.prefijo_2    || '',
        numero_2:     form.numero_2     || '',
        prefijo_3:    form.prefijo_3    || '',
        numero_3:     form.numero_3     || '',
        rol:          form.rol,
        empresa:      form.empresa      || '',
        cuit_empresa: form.cuit_empresa || '',
        estado:       form.estado,
        dni:          form.dni          || '',
        cuit_chofer:  form.cuit_chofer  || '',
      };

      if (editando) {
        await updateDoc(doc(db, 'usuarios_portal', editando.docId), datos);
        if (form.nueva_password) {
          // El cambio de contraseña no se hace directo: se dispara el flujo de
          // recuperación por email, que es el único camino seguro desde el
          // cliente sin privilegios de administrador de Auth.
          try {
            await sendPasswordResetEmail(auth, form.email_1);
            const textoWpp = `Portal Explora — Nueva contraseña\nUsuario: ${form.email_1}\nSe enviará un email de recuperación para que puedas establecer tu nueva contraseña.\nAcceso: https://portal-ivory-zeta.vercel.app`;
            navigator.clipboard.writeText(textoWpp);
            alert('✓ Usuario actualizado.\nSe envió un email de recuperación de contraseña al usuario.\nEl mensaje fue copiado al portapapeles para enviarlo por WhatsApp.');
          } catch (errReset) {
            // Los datos ya se guardaron: se informa el fallo del reset sin
            // hacerle creer al admin que se perdió la edición.
            alert('✓ Datos actualizados, pero hubo un error al enviar el reset de contraseña: ' + errReset.message);
          }
        } else {
          alert('✓ Usuario actualizado.');
        }
        setVista('lista');
      } else {
        const cred = await createUserWithEmailAndPassword(secondaryAuth, emailAuth, form.password);
        // Cerrar la sesión secundaria enseguida: la principal (la del admin) no
        // se ve afectada porque es otra instancia de Firebase.
        await secondaryAuth.signOut();
        // El ID del documento ES el UID de Auth. La app depende de esto.
        await setDoc(doc(db, 'usuarios_portal', cred.user.uid), {
          uid: cred.user.uid,
          email: emailAuth,
          ...datos,
          creado_por: usuario?.nombre || 'Admin',
          creado_en: new Date().toLocaleString('es-AR'),
        });
        setCredencialCreada({
          esChofer: form.rol === 'chofer',
          dni: form.dni,
          email: emailAuth,
          password: form.password,
        });
        setForm(FORM_VACIO);
      }
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        alert('Ya existe un usuario con ese email.');
      } else {
        alert('Error: ' + err.message);
      }
    } finally {
      setEnviando(false);
    }
  }

  /**
   * Activa o desactiva un usuario.
   *
   * Un usuario inactivo deja de aparecer como opción asignable, pero conserva su
   * cuenta de Auth y todo su historial: es una baja lógica, no física.
   *
   * @param {Object} u Usuario.
   */
  async function toggleEstado(u) {
    const nuevoEstado = u.estado === 'activo' ? 'inactivo' : 'activo';
    await updateDoc(doc(db, 'usuarios_portal', u.docId), { estado: nuevoEstado });
  }

  /**
   * Elimina los usuarios seleccionados de Firestore.
   *
   * IMPORTANTE: solo borra el documento, no la cuenta de Firebase Auth — eso
   * requiere privilegios de administrador que el cliente no tiene. El usuario
   * podría seguir autenticándose, aunque sin perfil quedaría fuera del portal.
   * Por eso la confirmación lo advierte explícitamente.
   */
  async function eliminarSeleccionados() {
    if (seleccionados.length === 0) return;
    if (!window.confirm(`¿Eliminar ${seleccionados.length} usuario(s) de Firestore?\n\nRecordá eliminarlos también de Firebase Authentication desde la consola.`)) return;
    setEliminandoMasivo(true);
    try {
      for (const docId of seleccionados) {
        await deleteDoc(doc(db, 'usuarios_portal', docId));
      }
      setSeleccionados([]);
      alert(`✓ ${seleccionados.length} usuario(s) eliminados de Firestore.`);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setEliminandoMasivo(false);
    }
  }

  /** Marca o desmarca un usuario en la selección múltiple. @param {string} docId */
  function toggleSeleccion(docId) {
    setSeleccionados(prev => prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId]);
  }

  /**
   * Elimina un usuario individual. Misma salvedad que `eliminarSeleccionados`:
   * la cuenta de Auth sobrevive.
   * @param {Object} u Usuario.
   */
  async function eliminarUsuario(u) {
    if (!window.confirm(`¿Eliminar a ${u.nombre}? Esta acción no se puede deshacer.\n\nNota: el usuario será eliminado del portal. Para eliminarlo completamente de Firebase Authentication, hacelo desde la consola de Firebase.`)) return;
    await deleteDoc(doc(db, 'usuarios_portal', u.docId));
    alert('✓ Usuario eliminado del portal.');
  }

  /* ---------------------------------------------------------------------------
   * Presentación
   * ------------------------------------------------------------------------ */

  /** Colores de la insignia de rol. */
  const rolColors = {
    admin:         { bg: '#1D1D1D', color: '#fff' },
    coordinador:   { bg: '#E1F5EE', color: '#085041' },
    comercial:     { bg: '#EEEDFE', color: '#3C3489' },
    transportista: { bg: '#FAEEDA', color: '#633806' },
    chofer:        { bg: '#EAF3DE', color: '#27500A' },
  };

  /** Colores de la insignia de estado del viaje. */
  const estadoChoferColors = {
    recibido:   { bg: '#EFF6FF', color: '#1D4ED8' },
    iniciado:   { bg: '#E1F5EE', color: '#085041' },
    demorado:   { bg: '#FAEEDA', color: '#633806' },
    finalizado: { bg: '#F3F4F6', color: '#374151' },
  };

  /** Etiquetas de estado del viaje. */
  const estadoChoferLabel = {
    recibido:   'Viaje recibido',
    iniciado:   'En ruta',
    demorado:   'Demorado',
    finalizado: 'Entregado',
  };

  /**
   * Arma un teléfono legible a partir del prefijo y el número.
   * @returns {string|null} null si no hay ningún dato, para poder omitir el campo.
   */
  function telFormateado(pre, num) {
    if (!pre && !num) return null;
    if (pre && num) return `(${pre}) ${num}`;
    return pre || num;
  }

  /**
   * ¿Este usuario puede recuperar su contraseña por email?
   *
   * Los `@explora.com.ar` entran con Google, así que el reset por email no
   * aplica: su contraseña la maneja Google. El resto —incluidos los choferes con
   * su email sintético— usa email y contraseña.
   *
   * @param {Object} u Usuario.
   * @returns {boolean}
   */
  function esEmailPassword(u) {
    const email = u.email_1 || u.email || '';
    return !email.endsWith('@explora.com.ar');
  }

  /* ===========================================================================
   * RENDER
   * ======================================================================== */

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <div style={styles.logoArea}>
          <img src="/logo.png" alt="Explora" style={{ height: 32, objectFit: 'contain' }} />
          <span style={styles.portalText}>Administración</span>
        </div>
        <button style={styles.btnVolver} onClick={onVolver}>← Inicio</button>
      </div>

      {/* Modal de exportación de choferes a CSV */}
      {modalExport && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '1.5rem', maxWidth: 380, width: '100%' }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 6 }}>📤 Exportar choferes</div>
            <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>Seleccioná la empresa transportista o exportá todos.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#6B7280' }}>Filtrar por transportista</label>
              <select style={{ fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%' }}
                value={empresaExport} onChange={e => setEmpresaExport(e.target.value)}>
                <option value="">Todos los choferes</option>
                {empresasDisponibles().map(emp => <option key={emp} value={emp}>{emp}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
                onClick={() => descargarChoferes(empresaExport)}>
                Descargar CSV
              </button>
              <button style={{ padding: '10px 16px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' }}
                onClick={() => setModalExport(false)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ LISTA ══ */}
      {vista === 'lista' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>Usuarios del portal</h2>
            <button style={styles.btnPrimary} onClick={abrirNuevo}>+ Nuevo usuario</button>
            {/* El input file va oculto dentro del label: los navegadores no
                permiten estilar el botón nativo de selección de archivo. */}
            <label style={{ padding: '8px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {importando ? 'Importando...' : '📥 Importar choferes'}
              <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={importarChoferes} disabled={importando} />
            </label>
            <button style={{ padding: '8px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }} onClick={exportarChoferes}>📤 Exportar choferes</button>
          </div>

          {/* Cantidad de usuarios por rol */}
          <div style={styles.metrics}>
            {['admin', 'coordinador', 'comercial', 'transportista', 'chofer'].map(rol => (
              <div key={rol} style={styles.metric}>
                <div style={styles.metricLabel}>{rol}</div>
                <div style={{ ...styles.metricValue, color: rol === 'admin' ? '#111827' : rol === 'coordinador' ? '#0F6E56' : rol === 'comercial' ? '#534AB7' : rol === 'chofer' ? '#27500A' : '#BA7517' }}>
                  {usuarios.filter(u => u.rol === rol).length}
                </div>
              </div>
            ))}
          </div>

          {/* ══ VIAJES ACTIVOS ══ */}
          {viajesActivos.length > 0 && (
            <div style={styles.viajesSection}>
              <div style={styles.viajesTitulo}>🚛 Viajes activos — {viajesActivos.length} en curso</div>
              <p style={styles.viajesDesc}>Choferes con viaje iniciado desde la app. Podés finalizar manualmente si el chofer no cerró el viaje.</p>
              {viajesActivos.map(v => (
                <div key={v.uid} style={styles.viajeCard}>
                  <div style={styles.viajeHeader}>
                    <span style={{ ...styles.pill, background: estadoChoferColors[v.estado_chofer]?.bg, color: estadoChoferColors[v.estado_chofer]?.color }}>
                      {estadoChoferLabel[v.estado_chofer] || v.estado_chofer}
                    </span>
                    <span style={styles.viajeChofer}>{v.chofer}</span>
                    {v.dni_chofer && <span style={styles.viajeDni}>DNI {v.dni_chofer}</span>}
                    <span style={styles.viajeId}>{v.pedidoId}</span>
                  </div>
                  <div style={styles.viajeGrid}>
                    <div style={styles.field}><span style={styles.label}>Producto</span><span>{v.producto}</span></div>
                    <div style={styles.field}><span style={styles.label}>Cliente</span><span>{v.cliente}</span></div>
                    <div style={styles.field}><span style={styles.label}>Transportista</span><span>{v.transporte || '—'}</span></div>
                    <div style={styles.field}><span style={styles.label}>Patente</span><span>{v.patente_tractor || '—'}</span></div>
                    <div style={styles.field}><span style={styles.label}>Fecha carga</span><span>{v.fecha_carga || '—'}</span></div>
                  </div>
                  <button
                    style={{ ...styles.btnFinalizarViaje, opacity: finalizando === v.uid ? 0.7 : 1 }}
                    disabled={finalizando === v.uid}
                    onClick={() => finalizarViaje(v)}>
                    {finalizando === v.uid ? 'Finalizando...' : '✓ Finalizar viaje manualmente'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* ══ VIAJES FINALIZADOS ══
              Va colapsado por defecto: es información de consulta, no de acción,
              y esta pantalla es principalmente de gestión de usuarios. */}
          {viajesFinalizados.length > 0 && (
            <div style={styles.finalizadosSection}>
              <button style={styles.finalizadosToggle} onClick={() => setVerFinalizados(v => !v)}>
                <span style={styles.finalizadosTitulo}>
                  ✓ Viajes finalizados — {viajesFinalizados.length}
                </span>
                <span style={{ fontSize: 11, color: '#6B7280' }}>{verFinalizados ? '▲ Ocultar' : '▼ Ver'}</span>
              </button>

              {verFinalizados && (
                <div style={{ marginTop: 10 }}>
                  <p style={styles.finalizadosDesc}>
                    Historial de viajes cerrados. El recorrido completo se ve en Seguimiento → Historial.
                  </p>

                  {finalizadosVisibles.map(v => (
                    <div key={v.uid} style={styles.viajeCard}>
                      <div style={styles.viajeHeader}>
                        <span style={{ ...styles.pill, background: estadoChoferColors.finalizado.bg, color: estadoChoferColors.finalizado.color }}>
                          Entregado
                        </span>
                        <span style={styles.viajeChofer}>{v.chofer}</span>
                        {/* Distinguir el cierre administrativo del cierre del chofer:
                            si un chofer nunca cierra sus viajes, conviene saberlo. */}
                        {v.finalizado_manual && (
                          <span style={styles.badgeManual} title={v.finalizado_por ? 'Cerrado por ' + v.finalizado_por : ''}>
                            Cierre manual
                          </span>
                        )}
                        <span style={styles.viajeId}>{v.pedidoId}</span>
                      </div>
                      <div style={styles.viajeGrid}>
                        <div style={styles.field}><span style={styles.label}>Cliente</span><span>{v.cliente}</span></div>
                        <div style={styles.field}><span style={styles.label}>Transportista</span><span>{v.transporte || '—'}</span></div>
                        <div style={styles.field}><span style={styles.label}>Inicio</span><span>{formatTsA(v.chofer_inicio_ts)}</span></div>
                        <div style={styles.field}><span style={styles.label}>Fin</span><span>{formatTsA(v.chofer_fin_ts)}</span></div>
                        <div style={styles.field}><span style={styles.label}>Duración</span><span>{duracionViaje(v.chofer_inicio_ts, v.chofer_fin_ts)}</span></div>
                        {/* Sin puntos de traza el viaje no aparece en el historial
                            de Seguimiento, que exige al menos dos. Marcarlo acá
                            permite detectar los choferes cuyo GPS no registra. */}
                        <div style={styles.field}>
                          <span style={styles.label}>Traza GPS</span>
                          <span style={{ color: v.puntosGps >= 2 ? '#085041' : '#9A3412' }}>
                            {v.puntosGps >= 2
                              ? `${v.puntosGps} puntos`
                              : v.gps_estado === 'sin_permiso' ? 'Sin permiso'
                              : v.gps_estado === 'solo_primer_plano' ? 'Solo app abierta'
                              : 'Sin registro'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {viajesFinalizados.length > LIMITE_FINALIZADOS && (
                    <button style={styles.btnVerMas} onClick={() => setVerTodosFinalizados(v => !v)}>
                      {verTodosFinalizados
                        ? '▲ Mostrar solo los últimos ' + LIMITE_FINALIZADOS
                        : `▼ Ver los ${viajesFinalizados.length} viajes`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Barra de acciones de la selección múltiple */}
          {seleccionados.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: '#FEF2F2', border: '0.5px solid #FECACA', borderRadius: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 13, color: '#A32D2D', flex: 1 }}>{seleccionados.length} usuario(s) seleccionado(s)</span>
              <button style={{ fontSize: 12, padding: '5px 14px', borderRadius: 8, border: 'none', background: '#A32D2D', color: '#fff', cursor: 'pointer', opacity: eliminandoMasivo ? 0.7 : 1 }}
                disabled={eliminandoMasivo} onClick={eliminarSeleccionados}>
                {eliminandoMasivo ? 'Eliminando...' : '🗑 Eliminar seleccionados'}
              </button>
              <button style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', cursor: 'pointer' }}
                onClick={() => setSeleccionados([])}>Cancelar</button>
            </div>
          )}

          {/* Resultado de la última importación */}
          {resultadoImport && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#F0FDF4', border: '0.5px solid #5DCAA5', marginBottom: 10, fontSize: 13 }}>
              <div style={{ fontWeight: 500, color: '#0F6E56', marginBottom: 4 }}>✓ Importación completada</div>
              <div style={{ color: '#374151' }}>Creados: <strong>{resultadoImport.creados}</strong> · Duplicados: <strong>{resultadoImport.duplicados}</strong>{resultadoImport.errores.length > 0 ? ` · Errores: ${resultadoImport.errores.length}` : ''}</div>
              {resultadoImport.errores.length > 0 && <div style={{ color: '#A32D2D', fontSize: 11, marginTop: 4 }}>{resultadoImport.errores.join(' | ')}</div>}
              <button style={{ fontSize: 11, marginTop: 6, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E5E7EB', background: '#fff', cursor: 'pointer' }} onClick={() => setResultadoImport(null)}>Cerrar</button>
            </div>
          )}

          {/* Filtro por rol y buscador */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }} id="filtros-bar">
            {['todos', 'admin', 'coordinador', 'comercial', 'transportista', 'chofer'].map(r => (
              <button key={r} style={{ padding: '5px 14px', borderRadius: 20, border: '0.5px solid #E5E7EB', background: filtroRol === r ? '#FDECEA' : '#fff', color: filtroRol === r ? '#C8102E' : '#6B7280', fontSize: 12, fontWeight: filtroRol === r ? 500 : 400, cursor: 'pointer', borderColor: filtroRol === r ? '#C8102E' : '#E5E7EB' }}
                onClick={() => { setFiltroRol(r); setSeleccionados([]); }}>{r === 'todos' ? 'Todos' : r}</button>
            ))}
            <div style={{ position: 'relative', marginLeft: 'auto' }}>
              <input style={{ fontSize: 13, padding: '6px 30px 6px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: 200 }}
                type="text" placeholder="Buscar nombre o empresa..."
                value={busquedaUsuario} onChange={e => setBusquedaUsuario(e.target.value)} />
              {busquedaUsuario && <button style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 13 }} onClick={() => setBusquedaUsuario('')}>✕</button>}
            </div>
          </div>

          {usuarios.filter(u => {
            const matchRol = filtroRol === 'todos' || u.rol === filtroRol;
            const q = busquedaUsuario.toLowerCase();
            const matchBusq = !q || (u.nombre || '').toLowerCase().includes(q) || (u.empresa || '').toLowerCase().includes(q);
            return matchRol && matchBusq;
          }).length === 0 && <div style={styles.empty}>Sin resultados.</div>}
          {usuarios.filter(u => {
            const matchRol = filtroRol === 'todos' || u.rol === filtroRol;
            const q = busquedaUsuario.toLowerCase();
            const matchBusq = !q || (u.nombre || '').toLowerCase().includes(q) || (u.empresa || '').toLowerCase().includes(q);
            return matchRol && matchBusq;
          }).map(u => (
            <div key={u.docId} style={{ ...styles.card, opacity: u.estado === 'inactivo' ? 0.6 : 1, outline: seleccionados.includes(u.docId) ? '2px solid #C8102E' : 'none' }}>
              <div style={styles.cardHeader}>
                <input type="checkbox" checked={seleccionados.includes(u.docId)} onChange={() => toggleSeleccion(u.docId)}
                  style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ ...styles.pill, background: rolColors[u.rol]?.bg, color: rolColors[u.rol]?.color }}>
                  {u.rol}
                </span>
                <span style={styles.cardNombre}>{u.nombre}</span>
                <span style={styles.cardEmail}>{u.email_1 || u.email}</span>
                {u.estado === 'inactivo' && <span style={styles.badgeInactivo}>Inactivo</span>}
              </div>
              <div style={styles.cardBody}>
                <div style={styles.detailGrid}>
                  {u.empresa      && <div style={styles.field}><span style={styles.label}>Empresa</span><span>{u.empresa}</span></div>}
                  {u.cuit_empresa && <div style={styles.field}><span style={styles.label}>CUIT</span><span>{u.cuit_empresa}</span></div>}
                  {u.email_2      && <div style={styles.field}><span style={styles.label}>Email 2</span><span>{u.email_2}</span></div>}
                  {u.email_3      && <div style={styles.field}><span style={styles.label}>Email 3</span><span>{u.email_3}</span></div>}
                  {telFormateado(u.prefijo_1, u.numero_1) && <div style={styles.field}><span style={styles.label}>Teléfono 1</span><span>{telFormateado(u.prefijo_1, u.numero_1)}</span></div>}
                  {telFormateado(u.prefijo_2, u.numero_2) && <div style={styles.field}><span style={styles.label}>Teléfono 2</span><span>{telFormateado(u.prefijo_2, u.numero_2)}</span></div>}
                  {telFormateado(u.prefijo_3, u.numero_3) && <div style={styles.field}><span style={styles.label}>Teléfono 3</span><span>{telFormateado(u.prefijo_3, u.numero_3)}</span></div>}
                  <div style={styles.field}><span style={styles.label}>Creado por</span><span>{u.creado_por} · {u.creado_en}</span></div>
                </div>
                <div style={styles.cardActions}>
                  <button style={styles.btnEditar} onClick={() => abrirEditar(u)}>✏️ Editar</button>
                  {/* El reset por email no se ofrece a los usuarios de Google:
                      su contraseña la maneja Google, no este portal. */}
                  {esEmailPassword(u) && (
                    <button style={styles.btnReset} onClick={() => generarResetLink(u)} disabled={generandoLink}>
                      🔑 Reset contraseña
                    </button>
                  )}
                  <button style={{ ...styles.btnToggle, color: u.estado === 'activo' ? '#A32D2D' : '#0F6E56' }}
                    onClick={() => toggleEstado(u)}>
                    {u.estado === 'activo' ? '⏸ Desactivar' : '▶ Activar'}
                  </button>
                  <button style={styles.btnEliminar} onClick={() => eliminarUsuario(u)}>
                    🗑 Eliminar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══ FORM ══ */}
      {vista === 'form' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>{editando ? 'Editar usuario' : 'Nuevo usuario'}</h2>
            <button style={styles.btnVolver} onClick={() => { setVista('lista'); setCredencialCreada(null); }}>← Volver</button>
          </div>

          {/* Credenciales recién creadas. Es la ÚNICA vez que se muestra la
              contraseña en claro para usuarios que no son chofer, por eso el
              banner reemplaza al formulario en lugar de aparecer al costado. */}
          {credencialCreada && (
            <div style={styles.credencialBanner}>
              <div style={styles.credencialTitulo}>✓ Usuario creado correctamente</div>
              {credencialCreada.esChofer ? (
                <>
                  <div style={styles.credencialFila}>
                    <span style={styles.credencialLabel}>DNI (usuario)</span>
                    <span style={styles.credencialValor}>{credencialCreada.dni}</span>
                  </div>
                  <div style={styles.credencialFila}>
                    <span style={styles.credencialLabel}>Contraseña</span>
                    <span style={styles.credencialValor}>{credencialCreada.password}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#0F6E56', marginTop: 4 }}>El chofer ingresa con DNI desde "Ingresar como chofer"</div>
                </>
              ) : (
                <>
                  <div style={styles.credencialFila}>
                    <span style={styles.credencialLabel}>Email</span>
                    <span style={styles.credencialValor}>{credencialCreada.email}</span>
                  </div>
                  <div style={styles.credencialFila}>
                    <span style={styles.credencialLabel}>Contraseña</span>
                    <span style={styles.credencialValor}>{credencialCreada.password}</span>
                  </div>
                </>
              )}
              <div style={styles.credencialAcciones}>
                <button style={styles.btnCopiar} onClick={copiarCredencial}>📋 Copiar para WhatsApp</button>
                <button style={styles.btnNuevoUsuario} onClick={abrirNuevo}>+ Crear otro usuario</button>
                <button style={styles.btnVolver} onClick={() => { setVista('lista'); setCredencialCreada(null); }}>Volver a la lista</button>
              </div>
            </div>
          )}

          {!credencialCreada && (
            <form onSubmit={guardar} style={styles.form}>
              <div style={styles.seccion}>
                <div style={styles.seccionTitulo}>Datos personales</div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Nombre completo *</label>
                  <input style={styles.input} type="text" placeholder="Apellido, Nombre"
                    value={form.nombre} onChange={f('nombre')} />
                </div>
              </div>

              {/* Emails. Deshabilitados para choferes: su email es sintético y se
                  deriva del DNI. Y no editables en modo edición, porque cambiar
                  el email en Firestore no lo cambiaría en Firebase Auth. */}
              <div style={styles.seccion}>
                <div style={styles.seccionTitulo}>Emails</div>
                <div style={styles.grid2}>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Email 1 {form.rol !== 'chofer' ? '*' : ''}{editando ? ' (no editable)' : ''}</label>
                    <input style={styles.input} type="email" placeholder="usuario@email.com"
                      value={form.email_1} onChange={f('email_1')} disabled={!!editando || form.rol === 'chofer'} />
                    {form.rol === 'chofer' && <span style={styles.passHint}>Los choferes ingresan con DNI, no con email.</span>}
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Email 2</label>
                    <input style={styles.input} type="email" placeholder="alternativo@email.com"
                      value={form.email_2} onChange={f('email_2')} disabled={form.rol === 'chofer'} />
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Email 3</label>
                    <input style={styles.input} type="email" placeholder="otro@email.com"
                      value={form.email_3} onChange={f('email_3')} disabled={form.rol === 'chofer'} />
                  </div>
                </div>
              </div>

              {/* Tres teléfonos, generados en bucle para no repetir el bloque. */}
              <div style={styles.seccion}>
                <div style={styles.seccionTitulo}>Teléfonos / WhatsApp</div>
                {[1, 2, 3].map(n => (
                  <div key={n} style={{ marginBottom: n < 3 ? 12 : 0 }}>
                    <label style={styles.formLabel}>Teléfono {n}{n > 1 ? ' (opcional)' : ''}</label>
                    <div style={styles.telRow}>
                      <div style={styles.telPrefijoWrap}>
                        <input style={styles.input} type="text" placeholder="Prefijo" maxLength={4}
                          value={form[`prefijo_${n}`]} onChange={f(`prefijo_${n}`)} />
                        <span style={styles.telHint}>Sin 0 · 2-4 díg.</span>
                      </div>
                      <div style={styles.telNumeroWrap}>
                        <input style={styles.input} type="text" placeholder="Número" maxLength={8}
                          value={form[`numero_${n}`]} onChange={f(`numero_${n}`)} />
                        <span style={styles.telHint}>Sin 15 · 6-8 díg.</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Contraseña inicial: solo en alta. */}
              {!editando && (
                <div style={styles.seccion}>
                  <div style={styles.seccionTitulo}>Contraseña de acceso</div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Contraseña *</label>
                    <div style={styles.passwordRow}>
                      <input style={{ ...styles.input, flex: 1 }}
                        type={verPassword ? 'text' : 'password'}
                        placeholder="Mínimo 6 caracteres"
                        value={form.password} onChange={f('password')} />
                      <button type="button" style={styles.btnVerPass} onClick={() => setVerPassword(!verPassword)}>
                        {verPassword ? '🙈 Ocultar' : '👁 Ver'}
                      </button>
                    </div>
                    <span style={styles.passHint}>La vas a ver una sola vez al confirmar. Guardala para enviársela al usuario.</span>
                  </div>
                </div>
              )}

              {/* Cambio de contraseña: solo en edición y solo para usuarios que
                  se autentican con email y contraseña. */}
              {editando && esEmailPassword(editando) && (
                <div style={styles.seccion}>
                  <div style={styles.seccionTitulo}>Cambiar contraseña</div>
                  <div style={styles.resetInfo}>
                    <span style={styles.resetInfoText}>
                      ⚠️ Por seguridad, el cambio de contraseña se realiza enviando un email de recuperación al usuario. Si completás este campo, al guardar se enviará el link automáticamente.
                    </span>
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>¿Querés resetear la contraseña? (opcional)</label>
                    <div style={styles.passwordRow}>
                      <input style={{ ...styles.input, flex: 1 }}
                        type={verNuevaPassword ? 'text' : 'password'}
                        placeholder="Dejá vacío para no cambiarla"
                        value={form.nueva_password} onChange={f('nueva_password')} />
                      <button type="button" style={styles.btnVerPass} onClick={() => setVerNuevaPassword(!verNuevaPassword)}>
                        {verNuevaPassword ? '🙈 Ocultar' : '👁 Ver'}
                      </button>
                    </div>
                    <span style={styles.passHint}>Si completás este campo, se enviará un email de recuperación al usuario y el texto se copiará al portapapeles para enviarlo por WhatsApp.</span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <button type="button" style={styles.btnResetDirecto}
                      onClick={() => generarResetLink(editando)} disabled={generandoLink}>
                      {generandoLink ? 'Enviando...' : '🔑 Enviar reset ahora y copiar para WhatsApp'}
                    </button>
                  </div>
                </div>
              )}

              <div style={styles.seccion}>
                <div style={styles.seccionTitulo}>Rol y acceso</div>
                <div style={styles.grid2}>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Rol *</label>
                    <select style={styles.input} value={form.rol} onChange={f('rol')}>
                      <option value="admin">Admin</option>
                      <option value="coordinador">Coordinador</option>
                      <option value="comercial">Comercial</option>
                      <option value="transportista">Transportista</option>
                      <option value="chofer">Chofer</option>
                    </select>
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Estado</label>
                    <select style={styles.input} value={form.estado} onChange={f('estado')}>
                      <option value="activo">Activo</option>
                      <option value="inactivo">Inactivo</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Campos específicos según el rol elegido. */}
              {(form.rol === 'transportista' || form.rol === 'admin') && (
                <div style={styles.seccion}>
                  <div style={styles.seccionTitulo}>Datos empresa</div>
                  <div style={styles.grid2}>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Razón social</label>
                      <input style={styles.input} type="text" placeholder="Nombre de la empresa"
                        value={form.empresa} onChange={f('empresa')} />
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>CUIT empresa</label>
                      <input style={styles.input} type="text" placeholder="20-00000000-0"
                        value={form.cuit_empresa} onChange={f('cuit_empresa')} />
                    </div>
                  </div>
                </div>
              )}

              {form.rol === 'chofer' && (
                <div style={styles.seccion}>
                  <div style={styles.seccionTitulo}>Datos del chofer</div>
                  <div style={styles.grid2}>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>DNI *</label>
                      <input style={styles.input} type="text" placeholder="12345678"
                        value={form.dni} onChange={f('dni')} maxLength={8} />
                      <span style={styles.passHint}>Se usa para vincular al chofer con los despachos nominados.</span>
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Empresa transportista</label>
                      <input style={styles.input} type="text" placeholder="Nombre de la empresa"
                        value={form.empresa} onChange={f('empresa')} />
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>CUIT chofer * (sin guiones)</label>
                      <input style={styles.input} type="text" placeholder="20123456789" maxLength={11}
                        value={form.cuit_chofer} onChange={e => setForm(prev => ({ ...prev, cuit_chofer: e.target.value.replace(/\D/g, '') }))} />
                      <span style={styles.passHint}>Requerido para autocompletar en la nominación del transportista.</span>
                    </div>
                  </div>
                </div>
              )}

              <div style={styles.formActions}>
                <button type="submit"
                  style={{ ...styles.btnPrimary, padding: '11px', fontSize: 14, opacity: enviando ? 0.7 : 1 }}
                  disabled={enviando}>
                  {enviando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear usuario'}
                </button>
                <button type="button" style={styles.btnCancelar}
                  onClick={() => { setVista('lista'); setCredencialCreada(null); }}>
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/* =============================================================================
 * ESTILOS
 *
 * Objeto plano de estilos en línea, siguiendo la convención del resto del portal.
 * Paleta institucional: #C8102E (rojo Explora), #0F6E56 (verde).
 *
 * Los viajes activos van en tonos ámbar (requieren atención) y los finalizados en
 * grises (información de consulta, ya cerrada).
 * ========================================================================== */
const styles = {
  // --- Contenedor y barra superior ---
  wrap: { maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem' },
  logoArea: { display: 'flex', alignItems: 'center', gap: 8 },
  portalText: { fontSize: 13, color: '#9CA3AF', marginLeft: 4 },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' },
  titulo: { fontSize: 18, fontWeight: 500, color: '#111827' },
  btnPrimary: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },

  // --- Métricas ---
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: '1.5rem' },
  metric: { background: '#F9FAFB', borderRadius: 8, padding: '12px 14px' },
  metricLabel: { fontSize: 11, color: '#9CA3AF', marginBottom: 4, textTransform: 'capitalize' },
  metricValue: { fontSize: 20, fontWeight: 500 },
  empty: { textAlign: 'center', padding: '2rem', color: '#9CA3AF', fontSize: 13 },

  // --- Viajes activos (ámbar: requieren atención) ---
  viajesSection: { marginBottom: '1.5rem', padding: '14px', background: '#FFF7ED', border: '0.5px solid #FCD34D', borderRadius: 12 },
  viajesTitulo: { fontSize: 13, fontWeight: 600, color: '#92400E', marginBottom: 4 },
  viajesDesc: { fontSize: 12, color: '#B45309', marginBottom: 12 },
  viajeCard: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 10, padding: '10px 12px', marginBottom: 8 },
  viajeHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  viajeChofer: { fontSize: 13, fontWeight: 600, color: '#111827', flex: 1 },
  viajeDni: { fontSize: 11, color: '#6B7280' },
  viajeId: { fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace' },
  viajeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 10 },
  btnFinalizarViaje: { padding: '7px 14px', borderRadius: 8, border: 'none', background: '#0F6E56', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' },

  // --- Viajes finalizados (gris: consulta, ya cerrado) ---
  finalizadosSection: { marginBottom: '1.5rem', padding: '12px 14px', background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: 12 },
  finalizadosToggle: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', border: 'none', background: 'none', cursor: 'pointer', padding: 0 },
  finalizadosTitulo: { fontSize: 13, fontWeight: 600, color: '#374151' },
  finalizadosDesc: { fontSize: 12, color: '#6B7280', marginBottom: 12, marginTop: 0 },
  badgeManual: { fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 20, background: '#FEF3C7', color: '#92400E', border: '0.5px solid #F59E0B', flexShrink: 0 },
  btnVerMas: { width: '100%', padding: '7px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer' },

  // --- Tarjeta de usuario ---
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: '#F9FAFB', flexWrap: 'wrap' },
  pill: { fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, flexShrink: 0, textTransform: 'capitalize' },
  cardNombre: { fontSize: 13, fontWeight: 500, color: '#111827', flex: 1 },
  cardEmail: { fontSize: 12, color: '#9CA3AF' },
  badgeInactivo: { fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280', border: '0.5px solid #E5E7EB' },
  cardBody: { padding: '12px 14px' },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 3 },
  label: { fontSize: 11, color: '#9CA3AF' },
  cardActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  btnEditar: { padding: '6px 12px', borderRadius: 8, border: '0.5px solid #C8102E', background: '#fff', color: '#C8102E', fontSize: 12, cursor: 'pointer' },
  btnReset: { padding: '6px 12px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer' },
  btnToggle: { padding: '6px 12px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', fontSize: 12, cursor: 'pointer' },
  btnEliminar: { padding: '6px 12px', borderRadius: 8, border: '0.5px solid #FECACA', background: '#FEF2F2', color: '#A32D2D', fontSize: 12, cursor: 'pointer' },

  // --- Formulario ---
  form: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, padding: '1.5rem' },
  seccion: { marginBottom: '1.5rem' },
  seccionTitulo: { fontSize: 12, fontWeight: 500, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: '0.5px solid #F3F4F6' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 },
  formField: { display: 'flex', flexDirection: 'column', gap: 5 },
  formLabel: { fontSize: 13, color: '#6B7280', fontWeight: 500, marginBottom: 4 },
  input: { fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%', boxSizing: 'border-box' },
  telRow: { display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 4 },
  telPrefijoWrap: { display: 'flex', flexDirection: 'column', gap: 3, flex: '0 0 110px' },
  telNumeroWrap: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1 },
  telHint: { fontSize: 10, color: '#9CA3AF' },
  passwordRow: { display: 'flex', gap: 8, alignItems: 'center' },
  btnVerPass: { padding: '8px 12px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 },
  passHint: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  resetInfo: { background: '#FFFBEB', border: '0.5px solid #FCD34D', borderRadius: 8, padding: '10px 12px', marginBottom: 12 },
  resetInfoText: { fontSize: 12, color: '#92400E' },
  btnResetDirecto: { padding: '8px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#F9FAFB', color: '#374151', fontSize: 12, cursor: 'pointer' },

  // --- Banner de credenciales creadas ---
  credencialBanner: { background: '#E1F5EE', border: '0.5px solid #5DCAA5', borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem' },
  credencialTitulo: { fontSize: 14, fontWeight: 600, color: '#085041', marginBottom: 12 },
  credencialFila: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 },
  credencialLabel: { fontSize: 12, color: '#6B7280', width: 80, flexShrink: 0 },
  credencialValor: { fontSize: 14, fontWeight: 500, color: '#111827', fontFamily: 'monospace', background: '#fff', padding: '4px 10px', borderRadius: 6, border: '0.5px solid #E5E7EB' },
  credencialAcciones: { display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  btnCopiar: { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#085041', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnNuevoUsuario: { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  formActions: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: '1.5rem' },
  btnCancelar: { padding: '11px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#111827', fontSize: 14, cursor: 'pointer' },
};

export default Admin;
