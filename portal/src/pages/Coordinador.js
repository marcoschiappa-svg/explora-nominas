/**
 * =============================================================================
 * Coordinador.js — Programación de pedidos (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Es la pantalla donde el coordinador convierte un pedido comercial en despachos
 * concretos: acepta cada entrega del cronograma, define fecha de carga y volumen,
 * asigna el transportista, reprograma cuando algo cambia y suspende si hace falta.
 *
 * -----------------------------------------------------------------------------
 * LOS DOS NIVELES: PEDIDO Y DESPACHO
 * -----------------------------------------------------------------------------
 * Un PEDIDO (`pedidos_portal/{id}`) es lo que pide el área comercial: un cliente,
 * un producto, un volumen total y un cronograma de entregas.
 *
 * Un DESPACHO es un camión concreto. Viven en el array `despachos` del pedido, y
 * cada uno se vincula con una entrega del cronograma mediante `entrega_nro`.
 *
 * Los estados del PEDIDO:
 *   Pendiente     → sin ningún despacho creado
 *   prog-parcial  → hay despachos pero falta volumen o falta asignar transporte
 *   Programado    → volumen completo y todos con transportista
 *   Aceptado      → el transportista aceptó
 *   Nominado      → el transportista cargó los datos de la unidad
 *   Suspendido    → se dio de baja con un motivo
 *
 * Los estados del DESPACHO:
 *   Aceptado-pendiente → aceptado por el coordinador, sin transportista asignado
 *   Programado         → con transportista, esperando que lo acepte
 *   Aceptado           → el transportista lo aceptó
 *   Nominado           → con unidad y chofer cargados
 *   En espera          → el pedido cambió y hay que reprogramarlo
 *   Rechazado          → el transportista lo rechazó
 *
 * -----------------------------------------------------------------------------
 * EL TERCER ESTADO, EL QUE ESTA PANTALLA NO VEÍA
 * -----------------------------------------------------------------------------
 * Existe un campo más, `estado_chofer`, que escribe la app TrackEx y que sigue el
 * ciclo OPERATIVO del viaje: recibido → iniciado → demorado → finalizado.
 *
 * Nadie lo sincroniza con `estado`. La consecuencia práctica: cuando el chofer
 * arranca, entrega y cierra el viaje, para esta pantalla **no pasó nada**. El
 * despacho sigue diciendo "Nominado" para siempre. El coordinador no tenía forma
 * de saber, desde acá, si un camión salió, si está demorado o si ya entregó.
 *
 * La unificación de `estado` y `estado_chofer` en un solo campo es parte del
 * rediseño pendiente del ciclo de vida del pedido, y no se hizo acá a propósito:
 * `estado` se compara por string exacto en los filtros y las métricas de esta
 * pantalla, en Transportista y en la app. Agregarle valores nuevos haría
 * desaparecer pedidos de varias vistas a la vez. La solución mientras tanto es
 * aditiva: mostrar `estado_chofer` al lado, sin tocar ningún dato ni ninguna
 * escritura.
 *
 * -----------------------------------------------------------------------------
 * CAMBIOS (agosto 2026)
 * -----------------------------------------------------------------------------
 *   1. INSIGNIA DE VIAJE EN LA TARJETA DEL PEDIDO. Si algún despacho tiene el
 *      viaje en curso, aparece "🚚 En ruta (N)" en el encabezado. Si todos los
 *      despachos ya entregaron, aparece "✓ Entregado". Así se ve de un vistazo,
 *      sin desplegar, qué se está moviendo.
 *
 *   2. ESTADO DEL VIAJE EN CADA DESPACHO, en los DOS caminos de render (los del
 *      cronograma y los "sin entrega asociada"), con los horarios reales de
 *      inicio y fin y el motivo de demora si el chofer lo reportó.
 *
 *   3. MÉTRICA "EN RUTA": cantidad de pedidos con al menos un camión viajando.
 *
 * Nada de esto modifica datos: son todas lecturas de campos que ya existían.
 * =============================================================================
 */

import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXOlu0PUTAVubDJCXh7WxjZp1ruCH5SMu9YmWbFCNF2ff7l5mn447nV8BIWbQ5-Mz-uQ/exec';

/**
 * Presentación de cada estado operativo del viaje (`estado_chofer`).
 *
 * Los colores se eligieron para no chocar con los de `estado`, que ya usa naranja
 * para Programado, verde para Aceptado y violeta para Nominado. El entregado va
 * en gris neutro justamente porque significa "cerrado, no requiere atención".
 */
const ESTADO_CHOFER_CONFIG = {
  recibido:   { label: 'Recibido por el chofer', bg: '#EFF6FF', color: '#0C447C' },
  iniciado:   { label: '🚚 En ruta',              bg: '#E1F5EE', color: '#085041' },
  demorado:   { label: '⚠️ Demorado',             bg: '#FAEEDA', color: '#633806' },
  finalizado: { label: '✓ Entregado',            bg: '#F3F4F6', color: '#374151' },
};

/**
 * Determina si un tipo de operación se resuelve sin transportista.
 *
 * En "Retiro del cliente" el cliente manda su propio camión, y en "Entrega en
 * planta" la mercadería no se mueve: en los dos casos no hay transporte que
 * asignar, así que el despacho nace directamente en 'Programado'.
 *
 * @param {string} tipo Tipo de operación del pedido.
 * @returns {boolean}
 */
function sinTransportista(tipo) {
  return tipo === 'Retiro del cliente' || tipo === 'Entrega en planta';
}

/**
 * Terminología según el tipo de operación.
 * En "Retiro de Proveedores" el movimiento es un retiro, no una entrega, y la
 * pantalla tiene que hablar el idioma de la operación.
 *
 * @param {string} tipo
 * @returns {string} 'Retiro' o 'Entrega'.
 */
function nEnt(tipo) { return tipo === 'Retiro de Proveedores' ? 'Retiro' : 'Entrega'; }

/**
 * Versión plural y en minúscula de `nEnt`.
 * @param {string} tipo
 * @returns {string} 'retiros' o 'entregas'.
 */
function nEntPlural(tipo) { return tipo === 'Retiro de Proveedores' ? 'retiros' : 'entregas'; }

/**
 * Parsea un timestamp de forma tolerante.
 *
 * Existe porque en la base conviven dos formatos: ISO 8601 (lo que escribe la app
 * TrackEx) y `toLocaleString('es-AR')` en 12h sin AM/PM (lo que escriben varias
 * pantallas del portal, incluida esta). El segundo es ambiguo y `new Date()` no
 * lo puede interpretar, así que sin este resguardo aparece "Invalid Date".
 *
 * @param {string} valor
 * @returns {number|null} Milisegundos desde época, o null si no es parseable.
 */
function msSeguroC(valor) {
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
function formatTsC(valor) {
  if (!valor) return '—';
  const ms = msSeguroC(valor);
  if (ms === null) return String(valor);
  return new Date(ms).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Insignia con el estado operativo del viaje.
 *
 * Devuelve null si el despacho todavía no fue nominado: antes de eso no existe
 * `estado_chofer` y no hay nada que informar.
 *
 * @param {Object} props
 * @param {string} props.estadoChofer Valor de `estado_chofer` del despacho.
 * @param {number} [props.fontSize] Tamaño de fuente, para adaptarse al contexto.
 */
function InsigniaViaje({ estadoChofer, fontSize = 10 }) {
  const cfg = ESTADO_CHOFER_CONFIG[estadoChofer];
  if (!cfg) return null;
  return (
    <span style={{
      fontSize, fontWeight: 500, padding: '2px 8px', borderRadius: 20,
      background: cfg.bg, color: cfg.color, border: '0.5px solid ' + cfg.color + '33',
      flexShrink: 0,
    }}>
      {cfg.label}
    </span>
  );
}

/**
 * Bloque con la trazabilidad del viaje de un despacho.
 *
 * Se extrajo a componente propio porque esta pantalla renderiza los despachos por
 * DOS caminos distintos —los asociados a una entrega del cronograma y los "sin
 * entrega asociada"— y duplicar el bloque en ambos garantizaba que tarde o
 * temprano quedaran desincronizados.
 *
 * No renderiza nada hasta que el chofer arrancó: antes de eso no hay viaje que
 * contar y el bloque sería ruido visual.
 *
 * @param {Object} props
 * @param {Object} props.despacho Despacho a describir.
 */
function BloqueViaje({ despacho }) {
  const ec = despacho.estado_chofer || '';
  if (!['iniciado', 'demorado', 'finalizado'].includes(ec)) return null;

  return (
    <div style={styles.viajeSection}>
      <div style={styles.viajeTitle}>Seguimiento del viaje</div>

      {/* El motivo lo escribe el chofer desde la app al reportar la demora. */}
      {ec === 'demorado' && despacho.demora_motivo && (
        <div style={styles.viajeDemora}>⚠️ {despacho.demora_motivo}</div>
      )}

      <div style={styles.viajeGrid}>
        <div>
          <span style={styles.viajeLbl}>Inicio</span>
          <span style={styles.viajeVal}>{formatTsC(despacho.chofer_inicio_ts)}</span>
        </div>
        <div>
          <span style={styles.viajeLbl}>Fin</span>
          <span style={styles.viajeVal}>{formatTsC(despacho.chofer_fin_ts)}</span>
        </div>
        {despacho.gps_ts && (
          <div>
            <span style={styles.viajeLbl}>Última posición</span>
            <span style={styles.viajeVal}>{formatTsC(despacho.gps_ts)}</span>
          </div>
        )}
        {/* `gps_estado` lo escribe la app y permite distinguir "no arrancó el
            GPS" de "el chofer no se movió". Solo se muestra cuando hay algo que
            informar: si el seguimiento funciona, no hace falta decirlo. */}
        {despacho.gps_estado && despacho.gps_estado !== 'activo' && (
          <div>
            <span style={styles.viajeLbl}>Seguimiento GPS</span>
            <span style={{ ...styles.viajeVal, color: '#9A3412' }}>
              {despacho.gps_estado === 'sin_permiso' ? 'Sin permiso de ubicación'
                : despacho.gps_estado === 'solo_primer_plano' ? 'Solo con la app abierta'
                : despacho.gps_estado === 'error' ? 'No disponible'
                : despacho.gps_estado}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* =============================================================================
 * COMPONENTE PRINCIPAL
 * ========================================================================== */

/**
 * Pantalla de programación de pedidos.
 *
 * @param {Object} props
 * @param {Object} props.usuario Perfil autenticado; se usa `nombre` para dejar
 *   registro de quién hizo cada acción.
 * @param {Function} props.onVolver Callback para volver al inicio del portal.
 */
function Coordinador({ usuario, onVolver }) {
  const [pedidos, setPedidos] = useState([]);
  const [transportistas, setTransportistas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState('todos');
  const [busqueda, setBusqueda] = useState('');
  const [expandido, setExpandido] = useState(null);

  /**
   * Estados de formularios en curso. Todos son diccionarios indexados por una
   * clave `pedidoId-indice` (o `pedidoId-ent-indice` para las entregas), porque
   * puede haber varios formularios abiertos a la vez en distintas tarjetas.
   */
  const [asignando, setAsignando] = useState({});
  const [reprogramando, setReprogramando] = useState({});
  const [editandoDespacho, setEditandoDespacho] = useState({});
  const [aceptandoEntrega, setAceptandoEntrega] = useState({});

  const [enviando, setEnviando] = useState(false);

  /* ---------------------------------------------------------------------------
   * Suscripción a los pedidos, ordenados del más reciente al más antiguo.
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      const data = snap.docs
        .map(d => ({ docId: d.id, ...d.data(), despachos: d.data().despachos || [] }))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setPedidos(data);
      setCargando(false);
    });
    return () => unsub();
  }, []);

  /* ---------------------------------------------------------------------------
   * Suscripción a los transportistas disponibles para asignar.
   * Se filtran los inactivos: no tiene sentido ofrecer una empresa dada de baja.
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'usuarios_portal'), (snap) => {
      const data = snap.docs
        .map(d => ({ docId: d.id, ...d.data() }))
        .filter(t => t.rol === 'transportista' && t.estado === 'activo')
        .sort((a, b) => (a.empresa || a.nombre)?.localeCompare(b.empresa || b.nombre));
      setTransportistas(data);
    });
    return () => unsub();
  }, []);

  /* ===========================================================================
   * CÁLCULOS SOBRE EL PEDIDO
   * ======================================================================== */

  /** Volumen total ya cubierto por despachos. @param {Object} p @returns {number} */
  function volAsignado(p) { return (p.despachos || []).reduce((s, d) => s + Number(d.volumen), 0); }

  /** Volumen que falta despachar. @param {Object} p @returns {number} */
  function saldo(p) { return Number(p.volumen) - volAsignado(p); }

  /** Porcentaje cubierto, tope 100. @param {Object} p @returns {number} */
  function pct(p) { return Math.min(100, Math.round(volAsignado(p) / Number(p.volumen) * 100)); }

  /** ¿Hay algún despacho esperando datos del transportista? @param {Object} p */
  function tieneNominacionPendiente(p) { return (p.despachos || []).some(d => d.estado === 'Aceptado-pendiente' || (d.estado === 'Aceptado' && d.nominacion_pendiente)); }

  /** ¿Hay algún despacho a la espera de reprogramación? @param {Object} p */
  function tieneDespachoEnEspera(p) { return (p.despachos || []).some(d => d.estado === 'En espera'); }

  /**
   * Fecha de carga más próxima, ignorando los despachos en espera porque su
   * fecha ya no es válida.
   * @param {Object} p @returns {string|null}
   */
  function proximaCarga(p) { const fechas = (p.despachos || []).filter(d => d.fecha_carga && d.estado !== 'En espera').map(d => d.fecha_carga).sort(); return fechas[0] || null; }

  /**
   * Cantidad de despachos con el viaje en curso (iniciado o demorado).
   * @param {Object} p @returns {number}
   */
  function viajesEnCurso(p) {
    return (p.despachos || []).filter(d => ['iniciado', 'demorado'].includes(d.estado_chofer)).length;
  }

  /**
   * ¿Están todos los despachos entregados?
   *
   * Exige que haya al menos un despacho: un pedido sin despachos no está
   * entregado, está sin programar.
   *
   * @param {Object} p @returns {boolean}
   */
  function todosEntregados(p) {
    const ds = p.despachos || [];
    return ds.length > 0 && ds.every(d => d.estado_chofer === 'finalizado');
  }

  /** Despacho asociado a una entrega del cronograma. @returns {Object|undefined} */
  function despachoDeEntrega(p, entregaIdx) { return (p.despachos || []).find(d => d.entrega_nro === entregaIdx + 1); }

  /**
   * Fecha comprometida de una entrega. La entrega N°1 sale de `fecha_entrega` del
   * pedido; el resto, del array `cronograma` (desplazado en uno).
   *
   * @param {Object} p @param {number} entregaIdx @returns {string}
   */
  function fechaSolicitadaDe(p, entregaIdx) {
    if (entregaIdx <= 0) return p.fecha_entrega;
    const c = (p.cronograma || [])[entregaIdx - 1];
    return (c && c.fecha_solicitada) || p.fecha_entrega;
  }

  /**
   * Arma el cronograma completo unificando dos orígenes distintos.
   *
   * La primera entrega no está en el array `cronograma`: vive suelta en los
   * campos `fecha_entrega` y `volumen_entrega1` del pedido. Esta función las
   * junta para poder recorrerlas de forma uniforme.
   *
   * @param {Object} p @returns {Array<Object>}
   */
  function cronogramaCompleto(p) {
    const entradas = [];
    // Entrega N°1 viene de fecha_entrega + volumen_entrega1
    if (p.fecha_entrega) {
      entradas.push({
        nro: 1,
        volumen: p.volumen_entrega1 || p.volumen || 0,
        fecha_solicitada: p.fecha_entrega,
        esEntrada1: true,
      });
    }
    // Entregas adicionales del array cronograma
    (p.cronograma || []).forEach((e, i) => {
      entradas.push({ ...e, nro: i + 2, esEntrada1: false });
    });
    return entradas;
  }

  /**
   * Estado de una entrega: el de su despacho, o 'sin_aceptar' si no tiene.
   * @param {Object} p @param {number} entregaIdx @returns {string}
   */
  function estadoEntrega(p, entregaIdx) {
    const d = despachoDeEntrega(p, entregaIdx);
    if (!d) return 'sin_aceptar';
    return d.estado;
  }

  /* ===========================================================================
   * SELECCIÓN DE TRANSPORTISTA
   * ======================================================================== */

  /**
   * Carga los datos del transportista elegido en el formulario de asignación.
   *
   * Copia los tres emails y teléfonos posibles del transportista al despacho.
   * Se desnormaliza a propósito: si mañana la empresa cambia de email, el
   * despacho conserva el que se usó para notificar, que es lo correcto para la
   * trazabilidad.
   *
   * @param {string} key Clave del formulario.
   * @param {string} pedidoId
   * @param {string} docId ID del transportista en `usuarios_portal`.
   */
  /**
   * Punto ÚNICO de verdad para los datos de contacto del transporte.
   * Resuelve mail, CUIT y teléfonos desde la ficha en `usuarios_portal`.
   * Cualquier camino de asignación debe pasar por acá, para que ningún
   * selector de la UI pueda guardar un transporte sin su correo.
   *
   * @param {string} docId ID del transportista en `usuarios_portal`.
   * @returns {object|null} Datos de contacto, o null si no se encuentra.
   */
  function resolverContactoTransportista(docId) {
    const t = transportistas.find(x => x.docId === docId);
    if (!t) return null;
    const emails = [t.email_1, t.email_2, t.email_3].filter(Boolean);
    const telefonos = [
      t.prefijo_1 && t.numero_1 ? `(${t.prefijo_1}) ${t.numero_1}` : null,
      t.prefijo_2 && t.numero_2 ? `(${t.prefijo_2}) ${t.numero_2}` : null,
      t.prefijo_3 && t.numero_3 ? `(${t.prefijo_3}) ${t.numero_3}` : null,
    ].filter(Boolean);
    return {
      transporte_id: t.docId,
      transporte: t.empresa || t.nombre,
      emails,
      email_transportista: emails[0] || '',
      emails_extra: emails.slice(1),
      telefonos,
      cuit_transporte: t.cuit_empresa || '',
    };
  }

  function seleccionarTransportista(key, pedidoId, docId) {
    const c = resolverContactoTransportista(docId);
    if (!c) { setAsignando(prev => ({ ...prev, [key]: { ...prev[key], transporte_id: '', transporte: '', email_transportista: '', emails_extra: [], telefonos: [] } })); return; }
    setAsignando(prev => ({ ...prev, [key]: { ...prev[key], transporte_id: c.transporte_id, transporte: c.transporte, email_transportista: c.email_transportista, emails_extra: c.emails_extra, telefonos: c.telefonos, cuit_transporte: c.cuit_transporte } }));
  }

  /**
   * Igual que `seleccionarTransportista` pero para el formulario de EDICIÓN de
   * un despacho ya creado. Son dos diccionarios de estado distintos, por eso la
   * función está duplicada.
   *
   * @param {string} key Clave del formulario de edición.
   * @param {string} docId ID del transportista.
   */
  function seleccionarTransportistaEdit(key, docId) {
    const c = resolverContactoTransportista(docId);
    if (!c) { setEditandoDespacho(prev => ({ ...prev, [key]: { ...prev[key], transporte_id: '', transporte: '', email_transportista: '', emails_extra: [], telefonos: [] } })); return; }
    setEditandoDespacho(prev => ({ ...prev, [key]: { ...prev[key], transporte_id: c.transporte_id, transporte: c.transporte, email_transportista: c.email_transportista, emails_extra: c.emails_extra, telefonos: c.telefonos, cuit_transporte: c.cuit_transporte } }));
  }

  /* ===========================================================================
   * ACCIONES SOBRE DESPACHOS
   * ======================================================================== */

  /**
   * Guarda los cambios de fecha, horario o transportista de un despacho.
   *
   * Solo notifica por email si cambió la fecha o el transportista: un ajuste de
   * horario sugerido no amerita molestar a nadie.
   *
   * @param {Object} p Pedido.
   * @param {number} despachoIdx Índice del despacho dentro del array.
   */
  async function guardarEdicionDespacho(p, despachoIdx) {
    const key = p.id + '-' + despachoIdx;
    const ed = editandoDespacho[key] || {};
    if (!ed.fecha_carga) { alert('La fecha de carga es obligatoria.'); return; }

    // La carga no puede ser posterior a la entrega comprometida: sería imposible
    // cumplir. Se comparan Date y no strings porque las fechas vienen de un
    // input date y hay que normalizar la hora.
    const fSolicEd = fechaSolicitadaDe(p, ((p.despachos[despachoIdx] || {}).entrega_nro || 1) - 1);
    if (new Date(ed.fecha_carga + 'T00:00:00') > new Date(fSolicEd + 'T00:00:00')) { alert('La fecha de carga no puede ser posterior a la fecha solicitada de la entrega (' + fSolicEd + ').'); return; }

    // Si se cambió el transportista en la edición, exigir que tenga correo cargado en su ficha.
    if (ed.transporte_id && ed.transporte && ed.transporte !== (p.despachos[despachoIdx] || {}).transporte) {
      const cEd = resolverContactoTransportista(ed.transporte_id);
      if (cEd && cEd.emails.length === 0) {
        alert('El transporte "' + cEd.transporte + '" no tiene ningún correo cargado en su perfil.\n\nCargá al menos un email en la ficha del transportista (módulo Usuarios) antes de reasignarlo. Sin correo, el chofer no puede ver el viaje ni recibir el aviso.');
        return;
      }
    }

    setEnviando(true);
    try {
      const now = new Date().toLocaleString('es-AR');
      const nuevosDespachos = [...p.despachos];
      const dActual = nuevosDespachos[despachoIdx];
      const cambioTransportista = ed.transporte && ed.transporte !== dActual.transporte;
      const cambioFecha = ed.fecha_carga !== dActual.fecha_carga;
      nuevosDespachos[despachoIdx] = {
        ...dActual,
        fecha_carga: ed.fecha_carga,
        horario_carga: ed.horario_carga || dActual.horario_carga || '',
        // Los datos del transportista solo se pisan si efectivamente se eligió
        // uno nuevo: el select vacío significa "mantener el actual".
        ...(ed.transporte ? {
          transporte: ed.transporte,
          transporte_id: ed.transporte_id || dActual.transporte_id || '',
          email_transportista: ed.email_transportista || dActual.email_transportista || '',
          emails_extra: ed.emails_extra || dActual.emails_extra || [],
          telefonos: ed.telefonos || dActual.telefonos || [],
          cuit_transporte: ed.cuit_transporte || dActual.cuit_transporte || '',
        } : {}),
        editado_por: usuario?.nombre || 'Coordinador',
        editado_en: now,
      };
      await updateDoc(doc(db, 'pedidos_portal', p.docId), { despachos: nuevosDespachos });

      // Notificar si cambió algo relevante
      if (cambioFecha || cambioTransportista) {
        const todosEmails = [
          ed.email_transportista || dActual.email_transportista,
          ...(ed.emails_extra || dActual.emails_extra || [])
        ].filter(Boolean).join(',');
        const payload = {
          accion: 'editar_despacho',
          pedido_id: p.id,
          editado_por: usuario?.nombre || 'Coordinador',
          transporte: ed.transporte || dActual.transporte,
          email_transportista: todosEmails,
          fecha_carga: ed.fecha_carga,
          horario_carga: ed.horario_carga || dActual.horario_carga || '',
          producto: p.producto, volumen: dActual.volumen,
          cliente: p.cliente, ov: p.ov, lugar: p.lugar,
        };
        await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString(), { mode: 'no-cors' });
      }
      setEditandoDespacho(prev => { const n = {...prev}; delete n[key]; return n; });
      alert('✓ Despacho actualizado.' + (cambioFecha || cambioTransportista ? ' Se notificó al transportista.' : ''));
    } catch (err) {
      console.error(err);
      alert('Error: ' + err.message);
    } finally { setEnviando(false); }
  }

  /**
   * Abre el formulario de edición precargado con los valores actuales.
   * @param {Object} p @param {number} despachoIdx
   */
  function abrirEdicionDespacho(p, despachoIdx) {
    const key = p.id + '-' + despachoIdx;
    const d = p.despachos[despachoIdx];
    setEditandoDespacho(prev => ({
      ...prev,
      [key]: {
        fecha_carga: d.fecha_carga || '',
        horario_carga: d.horario_carga || '',
        transporte: d.transporte || '',
        transporte_id: d.transporte_id || '',
        email_transportista: d.email_transportista || '',
        emails_extra: d.emails_extra || [],
        telefonos: d.telefonos || [],
        cuit_transporte: d.cuit_transporte || '',
      }
    }));
  }

  /**
   * Descarta el formulario de edición.
   * Elimina la clave en vez de vaciarla: la presencia de la clave es lo que
   * decide si el formulario se renderiza.
   *
   * @param {string} key
   */
  function cancelarEdicionDespacho(key) {
    setEditandoDespacho(prev => { const n = {...prev}; delete n[key]; return n; });
  }

  /**
   * Alterna si un adjunto del pedido es visible para el transportista.
   *
   * El coordinador decide qué documentación compartir: puede haber adjuntos
   * internos que no corresponde que vea una empresa externa.
   *
   * @param {Object} p @param {string} fileId @param {boolean} valorActual
   */
  async function toggleVisibleTransportista(p, fileId, valorActual) {
    const adjuntosActualizados = (p.adjuntos || []).map(a => a.file_id === fileId ? { ...a, visible_transportista: !valorActual } : a);
    await updateDoc(doc(db, 'pedidos_portal', p.docId), { adjuntos: adjuntosActualizados });
  }

  /**
   * Acepta una entrega del cronograma creando el despacho correspondiente.
   *
   * El estado inicial del despacho depende del contexto:
   *   - Si se eligió transportista en el momento → 'Programado'.
   *   - Si la operación no lleva transportista → 'Programado' también.
   *   - Si falta asignarlo → 'Aceptado-pendiente'.
   *
   * Y el estado del PEDIDO se recalcula: queda 'Programado' solo si el volumen
   * está completo y ningún despacho quedó esperando transportista.
   *
   * @param {Object} p Pedido.
   * @param {number} entregaIdx Índice de la entrega en el cronograma.
   */
  async function aceptarEntrega(p, entregaIdx) {
    const key = p.id + '-ent-' + entregaIdx;
    const ae = aceptandoEntrega[key] || {};
    if (!ae.fecha_carga) { alert('Ingresá la fecha de carga.'); return; }
    if (!ae.volumen || Number(ae.volumen) <= 0) { alert('Ingresá el volumen.'); return; }
    const fSolicAe = fechaSolicitadaDe(p, entregaIdx);
    if (new Date(ae.fecha_carga + 'T00:00:00') > new Date(fSolicAe + 'T00:00:00')) {
      alert('La fecha de carga no puede ser posterior a la fecha solicitada de la entrega (' + fSolicAe + ').'); return;
    }
    const esSinTransportista = sinTransportista(p.tipo);
    // Si se eligió transportista al aceptar, exigir que tenga correo cargado en su ficha.
    if (ae.transporte_id) {
      const cAe = resolverContactoTransportista(ae.transporte_id);
      if (!cAe) { alert('No se encontró el transportista seleccionado. Actualizá la página e intentá de nuevo.'); return; }
      if (cAe.emails.length === 0) {
        alert('El transporte "' + cAe.transporte + '" no tiene ningún correo cargado en su perfil.\n\nCargá al menos un email en la ficha del transportista (módulo Usuarios) antes de asignarlo. Sin correo, el chofer no puede ver el viaje en el portal ni recibir el aviso.');
        return;
      }
    }
    setEnviando(true);
    try {
      const now = new Date().toLocaleString('es-AR');
      const estadoDespacho = esSinTransportista ? 'Programado' : 'Aceptado-pendiente';
      // Seleccionar transportista si fue elegido
      const t = ae.transporte_id ? transportistas.find(x => x.docId === ae.transporte_id) : null;
      const emails = t ? [t.email_1, t.email_2, t.email_3].filter(Boolean) : [];
      const telefonos = t ? [
        t.prefijo_1 && t.numero_1 ? `(${t.prefijo_1}) ${t.numero_1}` : null,
        t.prefijo_2 && t.numero_2 ? `(${t.prefijo_2}) ${t.numero_2}` : null,
      ].filter(Boolean) : [];

      const despacho = {
        // El id es correlativo a la cantidad de despachos existentes. OJO: si
        // alguna vez se borrara un despacho del medio, este esquema generaría
        // ids repetidos. Es parte del rediseño pendiente del modelo de datos.
        id: 'D' + ((p.despachos || []).length + 1),
        entrega_nro: entregaIdx + 1,
        volumen: Number(ae.volumen),
        fecha_carga: ae.fecha_carga,
        horario_carga: ae.horario_carga || '',
        estado: t ? 'Programado' : estadoDespacho,
        aceptado_por: usuario?.nombre || 'Coordinador',
        aceptado_en: now,
        transporte: t ? (t.empresa || t.nombre) : (esSinTransportista ? '—' : ''),
        transporte_id: t ? t.docId : '',
        email_transportista: emails[0] || '',
        emails_extra: emails.slice(1),
        telefonos,
        cuit_transporte: t ? (t.cuit_empresa || '') : '',
      };
      const nuevosDespachos = [...(p.despachos || []), despacho];
      const volDespachado = nuevosDespachos.reduce((s, d) => s + Number(d.volumen), 0);
      const hayPendiente = nuevosDespachos.some(d => d.estado === 'Aceptado-pendiente');
      const nuevoEstado = hayPendiente ? 'prog-parcial' : volDespachado >= Number(p.volumen) ? 'Programado' : 'prog-parcial';
      await updateDoc(doc(db, 'pedidos_portal', p.docId), {
        despachos: nuevosDespachos,
        estado: nuevoEstado,
        volumen_despachado: volDespachado,
      });
      const payload = {
        accion: 'programar_despacho',
        pedido_id: p.id,
        programado_por: usuario?.nombre || 'Coordinador',
        fecha_carga: ae.fecha_carga,
        horario_carga: ae.horario_carga || '',
        transporte: t ? (t.empresa || t.nombre) : (esSinTransportista ? '—' : 'Pendiente de asignación'),
        email_transportista: emails.join(','),
        tipo: p.tipo, producto: p.producto,
        volumen: Number(ae.volumen),
        cliente: p.cliente, ov: p.ov,
        lugar: p.lugar, banda_horaria: p.banda_horaria || '',
        fecha_entrega: p.fecha_entrega, obs: p.obs || '',
      };
      await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString(), { mode: 'no-cors' });
      setAceptandoEntrega(prev => { const n = {...prev}; delete n[key]; return n; });
      alert(t ? '✓ Entrega aceptada y transportista asignado.' : esSinTransportista ? '✓ Entrega aceptada y escrita en plan.' : '✓ Entrega aceptada. Asigná el transportista.');
    } catch (err) { console.error(err); alert('Error: ' + err.message); }
    finally { setEnviando(false); }
  }

  /**
   * Asigna un transportista a un despacho que estaba en 'Aceptado-pendiente'.
   * El despacho pasa a 'Programado' y el transportista recibe la notificación.
   *
   * @param {Object} p @param {number} despachoIdx
   */
  async function asignarTransportista(p, despachoIdx) {
    const key = p.id + '-' + despachoIdx;
    const as = asignando[key] || {};
    if (!as.transporte_id) { alert('Seleccioná un transportista.'); return; }
    // Fondo del arreglo: resolver SIEMPRE los datos desde la ficha del usuario,
    // sin importar por cuál selector se eligió, y frenar si el transporte no
    // tiene ningún correo cargado. Así ningún despacho puede nacer sin mail.
    const c = resolverContactoTransportista(as.transporte_id);
    if (!c) { alert('No se encontró el transportista seleccionado. Actualizá la página e intentá de nuevo.'); return; }
    if (c.emails.length === 0) {
      alert('El transporte "' + c.transporte + '" no tiene ningún correo cargado en su perfil.\n\nCargá al menos un email en la ficha del transportista (módulo Usuarios) antes de asignarlo. Sin correo, el chofer no puede ver el viaje en el portal ni recibir el aviso.');
      return;
    }
    setEnviando(true);
    try {
      const now = new Date().toLocaleString('es-AR');
      const nuevosDespachos = [...p.despachos];
      const d = nuevosDespachos[despachoIdx];
      nuevosDespachos[despachoIdx] = {
        ...d,
        estado: 'Programado',
        transporte: c.transporte,
        transporte_id: c.transporte_id,
        email_transportista: c.email_transportista,
        emails_extra: c.emails_extra,
        telefonos: c.telefonos,
        cuit_transporte: c.cuit_transporte,
        asignado_por: usuario?.nombre || 'Coordinador',
        asignado_en: now,
      };
      // El pedido solo llega a 'Programado' si ningún otro despacho quedó
      // esperando transportista.
      const hayPendiente = nuevosDespachos.some(dd => dd.estado === 'Aceptado-pendiente');
      const nuevoEstadoPedido = hayPendiente ? 'prog-parcial' : 'Programado';
      await updateDoc(doc(db, 'pedidos_portal', p.docId), { despachos: nuevosDespachos, estado: nuevoEstadoPedido });
      const todosEmails = c.emails.join(',');
      const payload = {
        accion: 'asignar_transportista',
        pedido_id: p.id,
        asignado_por: usuario?.nombre || 'Coordinador',
        fecha_carga: d.fecha_carga,
        horario_carga: d.horario_carga || '',
        transporte: c.transporte,
        email_transportista: todosEmails,
        tipo: p.tipo, producto: p.producto,
        volumen: d.volumen,
        cliente: p.cliente, ov: p.ov,
        lugar: p.lugar, banda_horaria: p.banda_horaria || '',
        fecha_entrega: p.fecha_entrega, obs: p.obs || '',
      };
      await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString(), { mode: 'no-cors' });
      setAsignando(prev => { const n = {...prev}; delete n[key]; return n; });
      alert('✓ Transportista asignado. Se notificó por email.');
    } catch (err) {
      console.error(err);
      alert('Error: ' + err.message);
    } finally { setEnviando(false); }
  }

  /**
   * Reprograma un despacho que había quedado 'En espera'.
   *
   * Limpia `nominacion_pendiente` porque con la fecha nueva el transportista
   * tiene que volver a confirmar los datos de la unidad.
   *
   * @param {Object} p @param {number} despachoIdx
   */
  async function reprogramarDespacho(p, despachoIdx) {
    const key = p.id + '-' + despachoIdx;
    const rd = reprogramando[key] || {};
    if (!rd.fecha_carga) { alert('Ingresá la nueva fecha de carga.'); return; }
    const fSolicRd = fechaSolicitadaDe(p, ((p.despachos[despachoIdx] || {}).entrega_nro || 1) - 1);
    if (new Date(rd.fecha_carga + 'T00:00:00') > new Date(fSolicRd + 'T00:00:00')) { alert('La fecha de carga no puede ser posterior a la fecha solicitada de la entrega (' + fSolicRd + ').'); return; }
    setEnviando(true);
    try {
      const now = new Date().toLocaleString('es-AR');
      const nuevosDespachos = [...p.despachos];
      const despachoActual = nuevosDespachos[despachoIdx];
      nuevosDespachos[despachoIdx] = { ...despachoActual, estado: 'Programado', fecha_carga: rd.fecha_carga, horario_carga: rd.horario_carga || '', nominacion_pendiente: false, reprogramado_por: usuario?.nombre || 'Coordinador', reprogramado_en: now };
      const hayEspera = nuevosDespachos.some(d => d.estado === 'En espera');
      await updateDoc(doc(db, 'pedidos_portal', p.docId), { despachos: nuevosDespachos, estado: hayEspera ? 'prog-parcial' : 'Programado' });
      const todosEmails = [despachoActual.email_transportista, ...(despachoActual.emails_extra || [])].filter(Boolean).join(',');
      const payload = { accion: 'reprogramar_despacho', pedido_id: p.id, despacho_id: despachoActual.id || ('D' + (despachoIdx + 1)), email_transportista: todosEmails, transporte: despachoActual.transporte, producto: p.producto, volumen: despachoActual.volumen, cliente: p.cliente, ov: p.ov, lugar: p.lugar, fecha_carga: rd.fecha_carga, horario_carga: rd.horario_carga || '', reprogramado_por: usuario?.nombre || 'Coordinador' };
      await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString(), { mode: 'no-cors' });
      setReprogramando(prev => { const n = {...prev}; delete n[key]; return n; });
      alert('✓ Despacho reprogramado. Se notificó al transportista.');
    } catch (err) { console.error(err); alert('Error al reprogramar: ' + err.message); }
    finally { setEnviando(false); }
  }

  /**
   * Suspende un pedido con un motivo obligatorio.
   *
   * Solo cambia el estado del pedido: los despachos quedan como estaban, para no
   * perder la trazabilidad de lo que se había programado. Por eso el payload
   * incluye `tenia_programacion`, para que la notificación pueda advertirlo.
   *
   * @param {Object} p Pedido.
   */
  async function suspender(p) {
    if (p.estado === 'Suspendido') { alert('Este pedido ya está suspendido.'); return; }
    const motivo = prompt('Motivo de la suspensión (requerido):');
    if (!motivo) return;
    const despachosAnteriores = p.despachos || [];
    await updateDoc(doc(db, 'pedidos_portal', p.docId), { estado: 'Suspendido' });
    const payload = { accion: 'suspender_pedido', id: p.id, motivo, suspendido_por: usuario?.nombre || '', estado_anterior: p.estado, tenia_programacion: despachosAnteriores.length > 0, producto: p.producto, volumen: p.volumen, cliente: p.cliente, ov: p.ov, fecha_entrega: p.fecha_entrega, lugar: p.lugar, email_transportista: despachosAnteriores[0]?.email_transportista || '', transporte: despachosAnteriores[0]?.transporte || '' };
    await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString(), { mode: 'no-cors' });
    alert('Pedido suspendido. Se notificó a los involucrados.');
  }

  /* ===========================================================================
   * PRESENTACIÓN Y FILTRADO
   * ======================================================================== */

  /** Colores de la insignia de estado del PEDIDO. */
  const pillColors = { 'Pendiente': { bg: '#EEEDFE', color: '#3C3489' }, 'prog-parcial': { bg: '#FAEEDA', color: '#633806' }, 'Programado': { bg: '#E1F5EE', color: '#085041' }, 'Aceptado': { bg: '#D1FAE5', color: '#065F46' }, 'Nominado': { bg: '#EEEDFE', color: '#3C3489' }, 'Suspendido': { bg: '#FCEBEB', color: '#791F1F' } };

  /** Etiquetas de estado del PEDIDO. */
  const pillLabel = { 'Pendiente': 'Pendiente', 'prog-parcial': 'Prog. parcial', 'Programado': 'Programado', 'Aceptado': 'Aceptado', 'Nominado': 'Nominado', 'Suspendido': 'Suspendido' };

  /** Colores de la insignia de estado del DESPACHO. */
  const despachoColors = { 'Programado': { bg: '#FAEEDA', color: '#633806' }, 'Aceptado-pendiente': { bg: '#FEF3C7', color: '#92400E' }, 'Aceptado': { bg: '#E1F5EE', color: '#085041' }, 'Nominado': { bg: '#EEEDFE', color: '#3C3489' }, 'En espera': { bg: '#F3F4F6', color: '#6B7280' }, 'Rechazado': { bg: '#FCEBEB', color: '#791F1F' } };

  /** Etiquetas de estado del DESPACHO. */
  const despachoLabel = { 'Programado': 'Programado', 'Aceptado-pendiente': '⏳ Pendiente transporte', 'Aceptado': 'Aceptado', 'Nominado': 'Nominado', 'En espera': 'En espera', 'Rechazado': 'Rechazado' };

  const busquedaLower = busqueda.toLowerCase();
  const filtrados = pedidos.filter(p => {
    const matchEstado = filtro === 'todos' || p.estado === filtro;
    const matchBusqueda = !busqueda ||
      (p.cliente || '').toLowerCase().includes(busquedaLower) ||
      (p.ov || '').toLowerCase().includes(busquedaLower);
    return matchEstado && matchBusqueda;
  });

  /** Pedidos con al menos un camión viajando ahora mismo. */
  const cantEnRuta = pedidos.filter(p => viajesEnCurso(p) > 0).length;

  /* ===========================================================================
   * RENDER
   * ======================================================================== */

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <div style={styles.logoArea}>
          <img src="/logo.png" alt="Explora" style={{ height: 32, objectFit: 'contain' }} />
          <span style={styles.portalText}>Programación</span>
        </div>
        <button style={styles.btnVolver} onClick={onVolver}>← Inicio</button>
      </div>

      {/* Métricas por estado del pedido, más "En ruta", que se calcula sobre el
          estado del viaje y no sobre el del pedido. */}
      <div style={styles.metrics}>
        {[['Pendientes','#534AB7','Pendiente'],['Prog. parcial','#BA7517','prog-parcial'],['Programados','#0F6E56','Programado'],['Aceptados','#065F46','Aceptado'],['Nominados','#3C3489','Nominado'],['Suspendidos','#A32D2D','Suspendido']].map(([label, color, estado]) => (
          <div key={estado} style={styles.metric}>
            <div style={styles.metricLabel}>{label}</div>
            <div style={{ ...styles.metricValue, color }}>{pedidos.filter(p => p.estado === estado).length}</div>
          </div>
        ))}
        <div style={styles.metric}>
          <div style={styles.metricLabel}>En ruta</div>
          <div style={{ ...styles.metricValue, color: '#085041' }}>{cantEnRuta}</div>
        </div>
      </div>

      <div style={styles.filtros}>
        {['todos','Pendiente','prog-parcial','Programado','Aceptado','Nominado','Suspendido'].map(f => (
          <button key={f} style={{ ...styles.filtroBtnBase, ...(filtro === f ? styles.filtroBtnActive : {}) }} onClick={() => setFiltro(f)}>
            {f === 'todos' ? 'Todos' : pillLabel[f] || f}
          </button>
        ))}
      </div>

      <div style={styles.buscadorWrap}>
        <input
          style={styles.buscador}
          type="text"
          placeholder="Buscar por cliente o OV/OC..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
        />
        {busqueda && (
          <button style={styles.btnLimpiar} onClick={() => setBusqueda('')}>✕</button>
        )}
      </div>

      {cargando && <div style={styles.empty}>Cargando pedidos...</div>}
      {!cargando && filtrados.length === 0 && <div style={styles.empty}>Sin pedidos para mostrar.</div>}

      {!cargando && filtrados.map(p => {
        const enCurso = viajesEnCurso(p);
        const entregado = todosEntregados(p);
        return (
        <div key={p.id} style={styles.card}>
          <div style={styles.cardHeader} onClick={() => setExpandido(expandido === p.id ? null : p.id)}>
            <span style={{ ...styles.pill, background: pillColors[p.estado]?.bg, color: pillColors[p.estado]?.color }}>{pillLabel[p.estado] || p.estado}</span>
            {p.editado && <span style={styles.badgeEditado}>Editado</span>}
            {tieneNominacionPendiente(p) && <span style={styles.badgeNomPendiente}>⏳ Pend. transporte</span>}
            {tieneDespachoEnEspera(p) && <span style={styles.badgeEspera}>⏸ En espera</span>}

            {/* Estado del viaje a nivel pedido. Antes esta pantalla no reflejaba
                nada de lo que hacía el chofer: un pedido con el camión en ruta se
                veía igual que uno recién nominado. */}
            {enCurso > 0 && (
              <span style={styles.badgeEnRuta}>
                🚚 En ruta{enCurso > 1 ? ` (${enCurso})` : ''}
              </span>
            )}
            {entregado && <span style={styles.badgeEntregado}>✓ Entregado</span>}

            <div style={styles.cardInfo}>
              <span style={styles.cardOV}>{p.ov}</span>
              <div style={styles.cardSecundario}>
                <span style={styles.cardCliente}>{p.cliente}</span>
                <span style={styles.cardDot}>·</span>
                <span style={styles.cardProducto}>{p.producto} {p.volumen} tn</span>
                <span style={styles.cardDot}>·</span>
                <span style={styles.cardEntrega}>{nEnt(p.tipo)}: {p.fecha_entrega}</span>
              </div>
            </div>
            {proximaCarga(p) && <span style={styles.cardFechaCarga}>📦 {proximaCarga(p)}</span>}
            <span style={styles.chevron}>{expandido === p.id ? '▲' : '▼'}</span>
          </div>

          {expandido === p.id && (
            <div style={styles.cardBody}>
              <div style={styles.origen}>
                Pedido creado por <strong>{p.creado_por}</strong> · {p.creado_en}
                {p.editado && <span> · Editado por <strong>{p.editado_por}</strong> · {p.editado_en}</span>}
                {p.suspendido_por && <span style={{ color: '#A32D2D' }}> · Suspendido por <strong>{p.suspendido_por}</strong> · {p.suspendido_en}</span>}
              </div>
              <div style={styles.detailGrid}>
                <div style={styles.field}><span style={styles.label}>Tipo</span><span>{p.tipo}</span></div>
                <div style={styles.field}><span style={styles.label}>Producto</span><span>{p.producto}</span></div>
                <div style={styles.field}><span style={styles.label}>Volumen total</span><span>{p.volumen} tn</span></div>
                <div style={styles.field}><span style={styles.label}>Recipiente</span><span>{p.recipiente}</span></div>
                <div style={styles.field}><span style={styles.label}>Cliente / Proveedor</span><span>{p.cliente}</span></div>
                <div style={styles.field}><span style={styles.label}>OV / OC</span><span>{p.ov}</span></div>
                <div style={styles.field}><span style={styles.label}>Teléfono</span><span>{p.telefono || '—'}</span></div>
                <div style={styles.field}><span style={styles.label}>{p.tipo === 'Retiro de Proveedores' ? 'Retiro comprometido' : 'Entrega comprometida'}</span><span>{p.fecha_entrega}</span></div>
                {p.banda_horaria && <div style={styles.field}><span style={styles.label}>Banda horaria</span><span>{p.banda_horaria}</span></div>}
                <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Lugar</span><span>{p.lugar}</span></div>
                {p.obs && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Observaciones</span><span>{p.obs}</span></div>}
              </div>

              {(p.adjuntos || []).length > 0 && (
                <div style={styles.adjuntosSection}>
                  <div style={styles.adjuntosTitle}>Adjuntos del pedido</div>
                  <div style={styles.adjuntosGrid}>
                    {p.adjuntos.map(a => (
                      <div key={a.file_id} style={styles.adjuntoRow}>
                        <a href={a.link} target="_blank" rel="noreferrer" style={styles.adjuntoLink}>📎 {a.nombre}</a>
                        <span style={styles.adjuntoMeta}>Subido por {a.subido_por} · {a.subido_en}</span>
                        <button style={{ ...styles.btnToggleVis, background: a.visible_transportista ? '#E1F5EE' : '#F3F4F6', color: a.visible_transportista ? '#085041' : '#6B7280' }}
                          onClick={() => toggleVisibleTransportista(p, a.file_id, a.visible_transportista)}>
                          {a.visible_transportista ? '👁 Visible al transportista' : '🚫 Oculto al transportista'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Barra de avance del volumen despachado sobre el total pedido. */}
              <div style={styles.volBar}>
                <div style={styles.volBarLabels}>
                  <span>Asignado: <strong>{volAsignado(p)} tn</strong> de {p.volumen} tn</span>
                  <span>{pct(p)}%</span>
                </div>
                <div style={styles.barTrack}>
                  <div style={{ ...styles.barFill, width: `${pct(p)}%`, background: pct(p) < 100 ? '#EF9F27' : '#0F6E56' }}></div>
                </div>
                <div style={{ fontSize: 11, color: saldo(p) === 0 ? '#0F6E56' : '#BA7517', marginTop: 4 }}>
                  {saldo(p) === 0 ? '✓ Volumen completo' : `Saldo pendiente: ${saldo(p)} tn`}
                </div>
              </div>

              {/* ── CAMINO 1: despachos asociados a entregas del cronograma ── */}
              {(cronogramaCompleto(p).length > 0) && (
                <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '0.5px solid #E5E7EB' }}>
                  {cronogramaCompleto(p).length > 1 && <div style={{ fontSize: 11, fontWeight: 500, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Cronograma de {nEntPlural(p.tipo)}</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {cronogramaCompleto(p).map((e, ei) => {
                      const keyEnt = p.id + '-ent-' + ei;
                      const ae = aceptandoEntrega[keyEnt] || {};
                      const desp = despachoDeEntrega(p, ei);
                      const estEnt = estadoEntrega(p, ei);
                      const despIdx = desp ? (p.despachos || []).indexOf(desp) : -1;
                      const keyDesp = p.id + '-' + despIdx;
                      const rd = reprogramando[keyDesp] || {};
                      const colorBorder = estEnt === 'Programado' || estEnt === 'Nominado' ? '#5DCAA5' : estEnt === 'Aceptado-pendiente' ? '#F59E0B' : '#E5E7EB';
                      const colorBg = estEnt === 'Programado' || estEnt === 'Nominado' ? '#F0FDF4' : estEnt === 'Aceptado-pendiente' ? '#FFFBF2' : '#F9FAFB';
                      return (
                        <div key={ei} style={{ border: '0.5px solid ' + colorBorder, borderRadius: 8, padding: '10px 12px', background: colorBg }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: desp || aceptandoEntrega[keyEnt] !== undefined ? 8 : 0, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, fontWeight: 500, color: '#6B7280' }}>{nEnt(p.tipo)} N°{e.nro}</span>
                            {estEnt === 'sin_aceptar' && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280', border: '0.5px solid #E5E7EB' }}>Sin aceptar</span>}
                            {estEnt !== 'sin_aceptar' && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: despachoColors[estEnt]?.bg || '#F3F4F6', color: despachoColors[estEnt]?.color || '#6B7280', border: '0.5px solid #E5E7EB' }}>{despachoLabel[estEnt] || estEnt}</span>}

                            {/* Estado operativo del viaje, al lado del administrativo. */}
                            {desp && <InsigniaViaje estadoChofer={desp.estado_chofer} />}

                            <span style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 'auto' }}>Solicitada: {e.fecha_solicitada}</span>
                            <span style={{ fontSize: 12, fontWeight: 500, color: '#111827' }}>{e.volumen} tn</span>
                            {estEnt === 'sin_aceptar' && p.estado !== 'Suspendido' && (
                              <button style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', cursor: 'pointer' }}
                                onClick={() => setAceptandoEntrega(prev => ({
                                  ...prev,
                                  [keyEnt]: prev[keyEnt] === undefined ? { volumen: String(e.volumen), fecha_carga: e.fecha_solicitada, horario_carga: '', transporte_id: '' } : undefined
                                }))}>
                                {aceptandoEntrega[keyEnt] !== undefined ? 'Cancelar' : 'Aceptar'}
                              </button>
                            )}
                            {desp && ['Programado', 'Aceptado-pendiente'].includes(desp.estado) && !editandoDespacho[keyDesp] && p.estado !== 'Suspendido' && (
                              <button style={styles.btnEditarDespacho} onClick={() => abrirEdicionDespacho(p, despIdx)}>✏️ Editar</button>
                            )}
                          </div>
                          {desp && (
                            <div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, fontSize: 12, marginBottom: 8 }}>
                                <div><span style={{ fontSize: 10, color: '#9CA3AF', display: 'block' }}>Fecha carga</span><span style={{ fontWeight: 500, color: estEnt === 'Programado' || estEnt === 'Nominado' ? '#0F6E56' : '#BA7517' }}>{desp.fecha_carga}</span></div>
                                {desp.horario_carga && <div><span style={{ fontSize: 10, color: '#9CA3AF', display: 'block' }}>Horario</span><span style={{ fontWeight: 500, color: '#111827' }}>{desp.horario_carga}</span></div>}
                                {desp.transporte && desp.transporte !== '—' && <div><span style={{ fontSize: 10, color: '#9CA3AF', display: 'block' }}>Transportista</span><span style={{ fontWeight: 500, color: '#111827' }}>{desp.transporte}</span></div>}
                                {desp.chofer && <div><span style={{ fontSize: 10, color: '#9CA3AF', display: 'block' }}>Chofer</span><span style={{ fontWeight: 500, color: '#111827' }}>{desp.chofer}</span></div>}
                                {desp.email_transportista && <div><span style={{ fontSize: 10, color: '#9CA3AF', display: 'block' }}>Email</span><span style={{ fontWeight: 500, color: '#111827', wordBreak: 'break-all' }}>{desp.email_transportista}</span></div>}
                                {(desp.telefonos || []).length > 0 && <div><span style={{ fontSize: 10, color: '#9CA3AF', display: 'block' }}>Teléfonos</span><span style={{ fontWeight: 500, color: '#111827' }}>{desp.telefonos.join(' · ')}</span></div>}
                              </div>

                              {/* Trazabilidad del viaje del chofer. */}
                              <BloqueViaje despacho={desp} />

                              {desp.estado === 'Nominado' && (
                                <div style={{ marginTop: 4, marginBottom: 8, paddingTop: 8, borderTop: '0.5px solid #E5E7EB' }}>
                                  <div style={{ fontSize: 10, fontWeight: 500, color: '#3C3489', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Nominación</div>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, fontSize: 12 }}>
                                    {desp.dni_chofer && <div><span style={{ fontSize: 10, color: '#9CA3AF', display: 'block' }}>DNI</span><span style={{ fontWeight: 500, color: '#111827' }}>{desp.dni_chofer}</span></div>}
                                    {desp.patente_tractor && <div><span style={{ fontSize: 10, color: '#9CA3AF', display: 'block' }}>Patente tractor</span><span style={{ fontWeight: 500, color: '#111827' }}>{desp.patente_tractor}</span></div>}
                                    {desp.patente_semi && <div><span style={{ fontSize: 10, color: '#9CA3AF', display: 'block' }}>Patente semi</span><span style={{ fontWeight: 500, color: '#111827' }}>{desp.patente_semi}</span></div>}
                                    {desp.cuit_transporte && <div><span style={{ fontSize: 10, color: '#9CA3AF', display: 'block' }}>CUIT empresa</span><span style={{ fontWeight: 500, color: '#111827' }}>{desp.cuit_transporte}</span></div>}
                                  </div>
                                </div>
                              )}
                              {desp.estado === 'Aceptado-pendiente' && !sinTransportista(p.tipo) && (
                                <div>
                                  {!asignando[p.id + '-' + (p.despachos || []).indexOf(desp)] ? (
                                    <button style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, border: '0.5px solid #378ADD', background: '#EFF6FF', color: '#1D4ED8', cursor: 'pointer' }}
                                      onClick={() => setAsignando(prev => ({ ...prev, [p.id + '-' + (p.despachos || []).indexOf(desp)]: { transporte: '', transporte_id: '' } }))}>
                                      Asignar transporte
                                    </button>
                                  ) : (
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                                      <select style={{ ...styles.input, flex: 1, fontSize: 12 }}
                                        value={asignando[p.id + '-' + (p.despachos || []).indexOf(desp)]?.transporte_id || ''}
                                        onChange={ev => {
                                          const idx = (p.despachos || []).indexOf(desp);
                                          seleccionarTransportista(p.id + '-' + idx, p.id, ev.target.value);
                                        }}>
                                        <option value="">Seleccionar transportista...</option>
                                        {transportistas.map(t => <option key={t.docId} value={t.docId}>{t.empresa || t.nombre}</option>)}
                                      </select>
                                      <button style={{ ...styles.btnAceptar, fontSize: 11, padding: '5px 12px', opacity: enviando ? 0.7 : 1 }} disabled={enviando}
                                        onClick={() => asignarTransportista(p, (p.despachos || []).indexOf(desp))}>
                                        {enviando ? '...' : '✓ Confirmar'}
                                      </button>
                                      <button style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', cursor: 'pointer' }}
                                        onClick={() => setAsignando(prev => { const n={...prev}; delete n[p.id+'-'+(p.despachos||[]).indexOf(desp)]; return n; })}>✕</button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          {desp && editandoDespacho[keyDesp] && (
                            <div style={styles.editarDespachoBox}>
                              <div style={styles.editarDespachoTitulo}>✏️ Editar despacho</div>
                              <div style={styles.reprogramarGrid}>
                                <div style={styles.formField}>
                                  <label style={styles.formLabel}>Fecha de carga *</label>
                                  <input style={styles.input} type="date" max={e.fecha_solicitada}
                                    value={editandoDespacho[keyDesp]?.fecha_carga || ''}
                                    onChange={ev => setEditandoDespacho(prev => ({ ...prev, [keyDesp]: { ...prev[keyDesp], fecha_carga: ev.target.value } }))} />
                                  <span style={{ fontSize: 10, color: '#9CA3AF' }}>máx. {e.fecha_solicitada}</span>
                                </div>
                                <div style={styles.formField}>
                                  <label style={styles.formLabel}>Horario sugerido</label>
                                  <input style={styles.input} type="text" placeholder="Ej: 08:00hs"
                                    value={editandoDespacho[keyDesp]?.horario_carga || ''}
                                    onChange={ev => setEditandoDespacho(prev => ({ ...prev, [keyDesp]: { ...prev[keyDesp], horario_carga: ev.target.value } }))} />
                                </div>
                              </div>
                              {!sinTransportista(p.tipo) && (
                                <div style={{ ...styles.formField, marginTop: 8 }}>
                                  <label style={styles.formLabel}>Cambiar transportista (opcional)</label>
                                  <select style={styles.input}
                                    value={editandoDespacho[keyDesp]?.transporte_id || ''}
                                    onChange={ev => seleccionarTransportistaEdit(keyDesp, ev.target.value)}>
                                    <option value="">Mantener actual: {desp.transporte || '—'}</option>
                                    {transportistas.map(t => <option key={t.docId} value={t.docId}>{t.empresa || t.nombre}</option>)}
                                  </select>
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                <button style={{ ...styles.btnAsignar, opacity: enviando ? 0.7 : 1 }} disabled={enviando}
                                  onClick={() => guardarEdicionDespacho(p, despIdx)}>
                                  {enviando ? 'Guardando...' : '✓ Guardar cambios'}
                                </button>
                                <button style={styles.btnCancelarEdicion} onClick={() => cancelarEdicionDespacho(keyDesp)}>
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          )}
                          {desp && desp.estado === 'En espera' && (
                            <div style={styles.reprogramarBox}>
                              <div style={styles.reprogramarTitulo}>🔄 Reprogramar despacho</div>
                              <div style={styles.reprogramarGrid}>
                                <div style={styles.formField}>
                                  <label style={styles.formLabel}>Nueva fecha de carga *</label>
                                  <input style={styles.input} type="date" max={e.fecha_solicitada} value={rd.fecha_carga || ''} onChange={ev => setReprogramando(prev => ({ ...prev, [keyDesp]: { ...prev[keyDesp], fecha_carga: ev.target.value } }))} />
                                  <span style={{ fontSize: 10, color: '#9CA3AF' }}>máx. {e.fecha_solicitada}</span>
                                </div>
                                <div style={styles.formField}>
                                  <label style={styles.formLabel}>Horario sugerido</label>
                                  <input style={styles.input} type="text" placeholder="Ej: 08:00hs" value={rd.horario_carga || ''} onChange={ev => setReprogramando(prev => ({ ...prev, [keyDesp]: { ...prev[keyDesp], horario_carga: ev.target.value } }))} />
                                </div>
                              </div>
                              <button style={{ ...styles.btnReprogramar, opacity: enviando ? 0.7 : 1 }} disabled={enviando} onClick={() => reprogramarDespacho(p, despIdx)}>
                                {enviando ? 'Guardando...' : '✓ Confirmar reprogramación'}
                              </button>
                            </div>
                          )}
                          {aceptandoEntrega[keyEnt] !== undefined && estEnt === 'sin_aceptar' && (
                            <div style={{ marginTop: 10, padding: '10px 12px', background: '#EFF6FF', border: '0.5px solid #93C5FD', borderRadius: 8 }}>
                              <div style={{ fontSize: 10, fontWeight: 500, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Aceptar {nEnt(p.tipo).toLowerCase()}</div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 8 }}>
                                <div style={styles.formField}>
                                  <label style={styles.formLabel}>Volumen (tn) *</label>
                                  <input style={styles.input} type="number" placeholder={e.volumen}
                                    value={ae.volumen || ''} onChange={ev => setAceptandoEntrega(prev => ({ ...prev, [keyEnt]: { ...prev[keyEnt], volumen: ev.target.value } }))} />
                                </div>
                                <div style={styles.formField}>
                                  <label style={styles.formLabel}>Fecha de carga *</label>
                                  <input style={styles.input} type="date" max={e.fecha_solicitada}
                                    value={ae.fecha_carga || ''} onChange={ev => setAceptandoEntrega(prev => ({ ...prev, [keyEnt]: { ...prev[keyEnt], fecha_carga: ev.target.value } }))} />
                                  <span style={{ fontSize: 10, color: '#9CA3AF' }}>máx. {e.fecha_solicitada}</span>
                                </div>
                                <div style={styles.formField}>
                                  <label style={styles.formLabel}>Horario sugerido</label>
                                  <input style={styles.input} type="text" placeholder="Ej: 08:00hs"
                                    value={ae.horario_carga || ''} onChange={ev => setAceptandoEntrega(prev => ({ ...prev, [keyEnt]: { ...prev[keyEnt], horario_carga: ev.target.value } }))} />
                                </div>
                                {!sinTransportista(p.tipo) && (
                                  <div style={styles.formField}>
                                    <label style={styles.formLabel}>Transportista (opcional)</label>
                                    <select style={styles.input} value={ae.transporte_id || ''}
                                      onChange={ev => setAceptandoEntrega(prev => ({ ...prev, [keyEnt]: { ...prev[keyEnt], transporte_id: ev.target.value } }))}>
                                      <option value="">Asignar después</option>
                                      {transportistas.map(t => <option key={t.docId} value={t.docId}>{t.empresa || t.nombre}</option>)}
                                    </select>
                                  </div>
                                )}
                              </div>
                              <button style={{ ...styles.btnAceptar, opacity: enviando ? 0.7 : 1 }} disabled={enviando}
                                onClick={() => aceptarEntrega(p, ei)}>
                                {enviando ? 'Guardando...' : '✓ Confirmar ' + nEnt(p.tipo).toLowerCase()}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {cronogramaCompleto(p).length > 1 && (
                    <div style={{ marginTop: 8, padding: '8px 10px', background: '#F9FAFB', borderRadius: 8, border: '0.5px solid #E5E7EB', fontSize: 12, display: 'flex', gap: 16 }}>
                      <span style={{ color: '#6B7280' }}>Aceptado: <strong style={{ color: '#111827' }}>{volAsignado(p)} tn</strong></span>
                      <span style={{ color: '#6B7280' }}>Saldo: <strong style={{ color: saldo(p) > 0 ? '#BA7517' : '#0F6E56' }}>{saldo(p)} tn</strong></span>
                    </div>
                  )}
                </div>
              )}

              {/* ── CAMINO 2: despachos sin entrega asociada ──
                  Son despachos creados antes de que existiera el vínculo por
                  `entrega_nro`, o cargados por fuera del cronograma. Se renderizan
                  aparte porque no tienen una entrega de referencia. */}
              {(p.despachos || []).some(d => !d.entrega_nro) && (
              <div style={styles.despachosSection}>
                <div style={styles.despachosTitle}>Despachos sin entrega asociada</div>
                {(p.despachos || []).map((d, i) => {
                  if (d.entrega_nro) return null;
                  const key = p.id + '-' + i;
                  const rd = reprogramando[key] || {};
                  const as = asignando[key] || {};
                  return (
                    <div key={i} style={{ ...styles.despachoItem, borderColor: d.estado === 'En espera' ? '#EF9F27' : d.estado === 'Aceptado-pendiente' ? '#F59E0B' : '#E5E7EB' }}>
                      <div style={styles.despachoHeader}>
                        <span style={styles.despachoNro}>Despacho {i + 1}</span>
                        <span style={{ ...styles.pill, background: despachoColors[d.estado]?.bg || '#F3F4F6', color: despachoColors[d.estado]?.color || '#6B7280', fontSize: 10 }}>
                          {despachoLabel[d.estado] || d.estado}
                        </span>

                        {/* Mismo agregado que en el camino del cronograma. */}
                        <InsigniaViaje estadoChofer={d.estado_chofer} />

                        <span style={styles.despachoPor}>por {d.aceptado_por || d.programado_por} · {d.aceptado_en || d.programado_en}</span>
                        {['Programado', 'Aceptado-pendiente'].includes(d.estado) && !editandoDespacho[key] && (
                          <button style={styles.btnEditarDespacho} onClick={() => abrirEdicionDespacho(p, i)}>✏️ Editar</button>
                        )}
                      </div>
                      <div style={styles.despachoGrid}>
                        <div style={styles.field}><span style={styles.label}>Volumen</span><span>{d.volumen} tn</span></div>
                        <div style={styles.field}><span style={styles.label}>Fecha de carga</span><span>{d.fecha_carga}</span></div>
                        {d.horario_carga && <div style={styles.field}><span style={styles.label}>Horario sugerido</span><span>{d.horario_carga}</span></div>}
                        {d.transporte && d.transporte !== '—' && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Transportista</span><span>{d.transporte}</span></div>}
                        {d.email_transportista && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Email</span><span>{d.email_transportista}</span></div>}
                        {(d.telefonos || []).length > 0 && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Teléfonos</span><span>{d.telefonos.join(' · ')}</span></div>}
                        {d.estado === 'Nominado' && (
                          <>
                            <div style={{ ...styles.field, gridColumn: '1/-1', marginTop: 8, paddingTop: 8, borderTop: '0.5px solid #E5E7EB' }}>
                              <span style={{ ...styles.label, color: '#3C3489', fontWeight: 500 }}>NOMINACIÓN</span>
                            </div>
                            {d.chofer && <div style={styles.field}><span style={styles.label}>Chofer</span><span>{d.chofer}</span></div>}
                            {d.dni_chofer && <div style={styles.field}><span style={styles.label}>DNI</span><span>{d.dni_chofer}</span></div>}
                            {d.patente_tractor && <div style={styles.field}><span style={styles.label}>Patente tractor</span><span>{d.patente_tractor}</span></div>}
                            {d.patente_semi && <div style={styles.field}><span style={styles.label}>Patente semi</span><span>{d.patente_semi}</span></div>}
                            {d.cuit_transporte && <div style={styles.field}><span style={styles.label}>CUIT empresa</span><span>{d.cuit_transporte}</span></div>}
                          </>
                        )}
                      </div>

                      {/* Trazabilidad del viaje del chofer. */}
                      <BloqueViaje despacho={d} />

                      {editandoDespacho[key] && (
                        <div style={styles.editarDespachoBox}>
                          <div style={styles.editarDespachoTitulo}>✏️ Editar despacho</div>
                          <div style={styles.reprogramarGrid}>
                            <div style={styles.formField}>
                              <label style={styles.formLabel}>Fecha de carga *</label>
                              <input style={styles.input} type="date" max={p.fecha_entrega}
                                value={editandoDespacho[key]?.fecha_carga || ''}
                                onChange={e => setEditandoDespacho(prev => ({ ...prev, [key]: { ...prev[key], fecha_carga: e.target.value } }))} />
                              <span style={{ fontSize: 10, color: '#9CA3AF' }}>máx. {p.fecha_entrega}</span>
                            </div>
                            <div style={styles.formField}>
                              <label style={styles.formLabel}>Horario sugerido</label>
                              <input style={styles.input} type="text" placeholder="Ej: 08:00hs"
                                value={editandoDespacho[key]?.horario_carga || ''}
                                onChange={e => setEditandoDespacho(prev => ({ ...prev, [key]: { ...prev[key], horario_carga: e.target.value } }))} />
                            </div>
                          </div>
                          {!sinTransportista(p.tipo) && (
                            <div style={{ ...styles.formField, marginTop: 8 }}>
                              <label style={styles.formLabel}>Cambiar transportista (opcional)</label>
                              <select style={styles.input}
                                value={editandoDespacho[key]?.transporte_id || ''}
                                onChange={e => seleccionarTransportistaEdit(key, e.target.value)}>
                                <option value="">Mantener actual: {d.transporte || '—'}</option>
                                {transportistas.map(t => <option key={t.docId} value={t.docId}>{t.empresa || t.nombre}</option>)}
                              </select>
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                            <button style={{ ...styles.btnAsignar, opacity: enviando ? 0.7 : 1 }} disabled={enviando}
                              onClick={() => guardarEdicionDespacho(p, i)}>
                              {enviando ? 'Guardando...' : '✓ Guardar cambios'}
                            </button>
                            <button style={styles.btnCancelarEdicion} onClick={() => cancelarEdicionDespacho(key)}>
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}

                      {d.estado === 'Aceptado-pendiente' && !sinTransportista(p.tipo) && !d.entrega_nro && (
                        <div style={styles.asignarBox}>
                          <div style={styles.asignarTitulo}>🚛 Asignar transportista</div>
                          <div style={styles.despachoGrid}>
                            <div style={{ ...styles.formField, gridColumn: '1/-1' }}>
                              <label style={styles.formLabel}>Empresa transportista *</label>
                              <select style={styles.input} value={as.transporte_id || ''} onChange={e => seleccionarTransportista(key, p.id, e.target.value)}>
                                <option value="">Seleccionar transportista...</option>
                                {transportistas.map(t => <option key={t.docId} value={t.docId}>{t.empresa || t.nombre}</option>)}
                              </select>
                            </div>
                            {/* Vista previa de los contactos que van a recibir la
                                notificación, para evitar mandarla al lugar equivocado. */}
                            {as.transporte && (
                              <div style={{ ...styles.transportistaPreview, gridColumn: '1/-1' }}>
                                <div style={styles.previewRow}><span style={styles.previewLabel}>Email 1</span><span>{as.email_transportista || '—'}</span></div>
                                {(as.emails_extra || []).map((em, j) => <div key={j} style={styles.previewRow}><span style={styles.previewLabel}>Email {j+2}</span><span>{em}</span></div>)}
                                {(as.telefonos || []).map((tel, j) => <div key={j} style={styles.previewRow}><span style={styles.previewLabel}>Teléfono {j+1}</span><span>{tel}</span></div>)}
                                {as.cuit_transporte && <div style={styles.previewRow}><span style={styles.previewLabel}>CUIT</span><span>{as.cuit_transporte}</span></div>}
                              </div>
                            )}
                          </div>
                          <button style={{ ...styles.btnAsignar, opacity: enviando ? 0.7 : 1 }} disabled={enviando} onClick={() => asignarTransportista(p, i)}>
                            {enviando ? 'Guardando...' : '✓ Confirmar y notificar transportista'}
                          </button>
                        </div>
                      )}

                      {d.estado === 'En espera' && (
                        <div style={styles.reprogramarBox}>
                          <div style={styles.reprogramarTitulo}>🔄 Reprogramar despacho</div>
                          <div style={styles.reprogramarGrid}>
                            <div style={styles.formField}>
                              <label style={styles.formLabel}>Nueva fecha de carga *</label>
                              <input style={styles.input} type="date" max={p.fecha_entrega} value={rd.fecha_carga || ''} onChange={e => setReprogramando(prev => ({ ...prev, [key]: { ...prev[key], fecha_carga: e.target.value } }))} />
                              <span style={{ fontSize: 10, color: '#9CA3AF' }}>máx. {p.fecha_entrega}</span>
                            </div>
                            <div style={styles.formField}>
                              <label style={styles.formLabel}>Horario sugerido</label>
                              <input style={styles.input} type="text" placeholder="Ej: 08:00hs" value={rd.horario_carga || ''} onChange={e => setReprogramando(prev => ({ ...prev, [key]: { ...prev[key], horario_carga: e.target.value } }))} />
                            </div>
                          </div>
                          <button style={{ ...styles.btnReprogramar, opacity: enviando ? 0.7 : 1 }} disabled={enviando} onClick={() => reprogramarDespacho(p, i)}>
                            {enviando ? 'Guardando...' : '✓ Confirmar reprogramación'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

              </div>
              )}

              <div style={styles.cardActions}>
                {p.estado !== 'Suspendido' && (
                  <button style={styles.btnSuspender} onClick={() => suspender(p)}>Suspender</button>
                )}
              </div>
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

/* =============================================================================
 * ESTILOS
 *
 * Objeto plano de estilos en línea, siguiendo la convención del resto del portal.
 * Paleta institucional: #C8102E (rojo Explora), #0F6E56 (verde), #534AB7
 * (violeta, para todo lo relativo a nominación).
 * ========================================================================== */
const styles = {
  // --- Contenedor ---
  wrap: { maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' },

  // --- Barra superior ---
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem' },
  logoArea: { display: 'flex', alignItems: 'center', gap: 8 },
  portalText: { fontSize: 13, color: '#9CA3AF', marginLeft: 4 },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },

  // --- Métricas, filtros y buscador ---
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: '1.5rem' },
  metric: { background: '#F9FAFB', borderRadius: 8, padding: '12px 14px' },
  metricLabel: { fontSize: 11, color: '#9CA3AF', marginBottom: 4 },
  metricValue: { fontSize: 20, fontWeight: 500 },
  filtros: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '0.75rem' },
  filtroBtnBase: { padding: '6px 14px', borderRadius: 20, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer' },
  filtroBtnActive: { background: '#FDECEA', borderColor: '#C8102E', color: '#C8102E', fontWeight: 500 },
  buscadorWrap: { position: 'relative', marginBottom: '1rem' },
  buscador: { width: '100%', fontSize: 13, padding: '8px 32px 8px 12px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', background: '#fff', boxSizing: 'border-box' },
  btnLimpiar: { position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 13, padding: '0 4px' },

  // --- Tarjeta de pedido ---
  empty: { textAlign: 'center', padding: '2rem', color: '#9CA3AF', fontSize: 13 },
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer', flexWrap: 'wrap', background: '#F9FAFB' },
  pill: { fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, flexShrink: 0 },
  badgeEditado: { fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#FEF3C7', color: '#92400E', border: '0.5px solid #F59E0B', flexShrink: 0 },
  badgeNomPendiente: { fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 20, background: '#FEF3C7', color: '#92400E', border: '0.5px solid #F59E0B', flexShrink: 0 },
  badgeEspera: { fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280', border: '0.5px solid #D1D5DB', flexShrink: 0 },
  // Verde intenso: es la señal de que hay algo en movimiento ahora mismo.
  badgeEnRuta: { fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 20, background: '#E1F5EE', color: '#085041', border: '0.5px solid #5DCAA5', flexShrink: 0 },
  // Gris neutro: cerrado, no requiere atención.
  badgeEntregado: { fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 20, background: '#F3F4F6', color: '#374151', border: '0.5px solid #D1D5DB', flexShrink: 0 },
  cardInfo: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 },
  cardOV: { fontSize: 14, fontWeight: 500, color: '#185FA5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  cardSecundario: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  cardCliente: { fontSize: 12, color: '#111827' },
  cardProducto: { fontSize: 12, color: '#6B7280' },
  cardEntrega: { fontSize: 11, color: '#9CA3AF' },
  cardDot: { fontSize: 11, color: '#D1D5DB' },
  cardFechaCarga: { fontSize: 11, color: '#085041', background: '#E1F5EE', padding: '2px 8px', borderRadius: 20, flexShrink: 0 },
  chevron: { fontSize: 10, color: '#9CA3AF', flexShrink: 0 },
  cardBody: { padding: '12px 14px' },
  origen: { fontSize: 12, color: '#6B7280', padding: '8px 10px', background: '#F9FAFB', borderRadius: 8, marginBottom: 12 },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 3 },
  label: { fontSize: 11, color: '#9CA3AF' },

  // --- Adjuntos ---
  adjuntosSection: { marginBottom: 12, padding: '10px 12px', background: '#F9FAFB', borderRadius: 8, border: '0.5px solid #E5E7EB' },
  adjuntosTitle: { fontSize: 11, fontWeight: 500, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 },
  adjuntosGrid: { display: 'flex', flexDirection: 'column', gap: 6 },
  adjuntoRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  adjuntoLink: { fontSize: 12, color: '#3C3489', textDecoration: 'none', flex: 1 },
  adjuntoMeta: { fontSize: 10, color: '#9CA3AF' },
  btnToggleVis: { fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '0.5px solid #E5E7EB', cursor: 'pointer', flexShrink: 0 },
  adjuntosRow: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 },
  adjuntoChipEditable: { display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, background: '#F3F4F6', border: '0.5px solid #E5E7EB' },
  adjuntoQuitar: { border: 'none', background: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 11, padding: 0 },
  btnAdjuntar: { padding: '6px 12px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer' },

  // --- Barra de volumen ---
  volBar: { padding: '10px 12px', borderRadius: 8, background: '#F9FAFB', border: '0.5px solid #E5E7EB', marginBottom: 12 },
  volBarLabels: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B7280', marginBottom: 6 },
  barTrack: { height: 8, borderRadius: 4, background: '#E5E7EB', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, transition: 'width 0.3s' },

  // --- Bloque de seguimiento del viaje ---
  viajeSection: { marginTop: 4, marginBottom: 8, padding: '8px 10px', background: '#F0FDF4', border: '0.5px solid #5DCAA5', borderRadius: 8 },
  viajeTitle: { fontSize: 10, fontWeight: 500, color: '#085041', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  viajeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 },
  viajeLbl: { fontSize: 10, color: '#9CA3AF', display: 'block' },
  viajeVal: { fontSize: 12, fontWeight: 500, color: '#111827' },
  viajeDemora: { fontSize: 12, color: '#633806', background: '#FAEEDA', border: '0.5px solid #EF9F27', borderRadius: 6, padding: '6px 8px', marginBottom: 8 },

  // --- Despachos ---
  despachosSection: { marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #E5E7EB' },
  despachosTitle: { fontSize: 11, fontWeight: 500, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 },
  despachoItem: { border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '10px 12px', marginBottom: 8, background: '#F9FAFB' },
  despachoHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  despachoNro: { fontSize: 11, fontWeight: 500, color: '#6B7280' },
  despachoPor: { fontSize: 11, color: '#9CA3AF' },
  despachoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, alignItems: 'end' },

  // --- Formularios de asignación, reprogramación y edición ---
  asignarBox: { marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #F59E0B', background: '#FFFBF2', borderRadius: 8, padding: '10px 12px' },
  asignarTitulo: { fontSize: 11, fontWeight: 500, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 },
  btnAsignar: { marginTop: 10, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#0F6E56', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  reprogramarBox: { marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #EF9F27', background: '#FFFBF2', borderRadius: 8, padding: '10px 12px' },
  reprogramarTitulo: { fontSize: 11, fontWeight: 500, color: '#BA7517', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 },
  reprogramarGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 10 },
  btnReprogramar: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#BA7517', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  nuevoDespacho: { border: '0.5px solid #E1F5EE', borderRadius: 8, padding: '10px 12px', marginBottom: 8, background: '#F0FDF4' },
  formField: { display: 'flex', flexDirection: 'column', gap: 4 },
  formLabel: { fontSize: 11, color: '#6B7280' },
  input: { fontSize: 13, padding: '7px 9px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%' },
  transportistaPreview: { padding: '10px 12px', borderRadius: 8, background: '#F0FDF4', border: '0.5px solid #5DCAA5', display: 'flex', flexDirection: 'column', gap: 6 },
  previewRow: { display: 'flex', gap: 8, fontSize: 12, alignItems: 'center' },
  previewLabel: { fontSize: 11, color: '#6B7280', minWidth: 70 },
  btnAceptar: { marginTop: 10, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  cardActions: { display: 'flex', gap: 8, marginTop: 12 },
  btnSuspender: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #A32D2D', background: '#fff', color: '#A32D2D', fontSize: 12, cursor: 'pointer' },
  btnEditarDespacho: { fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', cursor: 'pointer', marginLeft: 'auto' },
  editarDespachoBox: { marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #93C5FD', background: '#EFF6FF', borderRadius: 8, padding: '10px 12px' },
  editarDespachoTitulo: { fontSize: 11, fontWeight: 500, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 },
  btnCancelarEdicion: { padding: '8px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
};

export default Coordinador;
