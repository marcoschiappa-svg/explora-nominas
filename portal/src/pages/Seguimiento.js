/**
 * =============================================================================
 * Seguimiento.js — Mapa de seguimiento de viajes (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Muestra sobre un mapa de Google dónde están los camiones y por dónde pasaron.
 * Tiene dos modos:
 *   - EN VIVO: posición actual de cada chofer con viaje en curso, con flecha
 *     orientada según el rumbo, y alertas por demora o falta de señal.
 *   - HISTORIAL: recorrido completo de viajes ya finalizados, dibujado como
 *     polilínea con marcadores A (inicio) y B (fin).
 *
 * -----------------------------------------------------------------------------
 * DE DÓNDE SALEN LOS DATOS
 * -----------------------------------------------------------------------------
 * De la colección `pedidos_portal`. Cada documento es un PEDIDO con un array
 * `despachos`; cada despacho es un viaje. Los campos que consume esta pantalla,
 * todos escritos por la app TrackEx:
 *
 *   despachos[i].estado_chofer      'recibido' | 'iniciado' | 'demorado' | 'finalizado'
 *   despachos[i].gps_lat / gps_lng  última posición conocida (modo en vivo)
 *   despachos[i].gps_ts             ISO 8601 de esa última posición
 *   despachos[i].gps_lat_prev       posición anterior, para calcular el rumbo
 *   despachos[i].gps_lng_prev       de la flecha del marcador
 *   despachos[i].chofer_inicio_ts   ISO 8601 — inicio del viaje
 *   despachos[i].chofer_fin_ts      ISO 8601 — fin del viaje
 *   pedido.gps_track_{i}            array [{lat, lng, ts}] con la traza completa
 *
 * OJO con la correspondencia: la traza vive a nivel del DOCUMENTO del pedido,
 * en un campo cuyo nombre incluye el índice del despacho (`gps_track_0`,
 * `gps_track_1`...). O sea que la identidad del despacho es su POSICIÓN en el
 * array. Si alguna vez se borra o reordena un despacho, las trazas quedan
 * apuntando al viaje equivocado. Está identificado como parte del rediseño
 * pendiente del ciclo de vida del pedido.
 *
 * -----------------------------------------------------------------------------
 * FILTROS (agosto 2026)
 * -----------------------------------------------------------------------------
 * Se agregaron tres filtros que aplican a LAS DOS pestañas. Antes solo existía
 * un buscador de texto y únicamente en historial, así que con varios camiones en
 * ruta la pestaña "en vivo" no tenía forma de acotarse.
 *
 *   1. TRANSPORTISTA — multi-selección. Agrupa por `transporte_id`, no por el
 *      nombre de la empresa: si alguien cargó "Transprueba" y "TRANSPRUEBA S.A."
 *      como dos textos distintos, agrupar por nombre generaría dos entradas para
 *      el mismo transportista. Cuando un despacho viejo no tiene `transporte_id`
 *      se cae a una clave derivada del nombre, para no perderlo del listado.
 *
 *   2. CHOFER — multi-selección EN CASCADA: solo lista los choferes que
 *      pertenecen a los transportistas seleccionados. Si se cambia la selección
 *      de transportistas y algún chofer elegido deja de corresponder, se
 *      descarta solo, para que no queden filtros invisibles activos.
 *
 *   3. FECHA — rango sobre `fecha_carga`, con atajos: todo / hoy / 7 días / mes.
 *      La comparación es entre strings porque el formato es 'AAAA-MM-DD', que
 *      ordena alfabéticamente igual que cronológicamente.
 *
 * Los filtros se aplican al PANEL y AL MAPA a la vez: los marcadores se derivan
 * de la lista filtrada, así que lo que se ve en la lista es exactamente lo que
 * se ve en el mapa.
 *
 * -----------------------------------------------------------------------------
 * CORRECCIONES INCLUIDAS
 * -----------------------------------------------------------------------------
 *   - El historial no copiaba `transporte` al armar sus registros (los activos
 *     sí). Sin ese campo no se podía filtrar por transportista en esa pestaña.
 *   - Los marcadores A y B del historial se creaban sueltos, sin guardar
 *     referencia: cada viaje consultado dejaba su par de marcadores en el mapa
 *     para siempre. Ahora se registran y se limpian.
 *   - `formatTs` y el orden del historial asumían ISO 8601. El "finalizar
 *     manualmente" de Admin escribe `chofer_fin_ts` con `toLocaleString('es-AR')`
 *     en formato 12h sin AM/PM, que `new Date()` no puede parsear: el resultado
 *     era "Invalid Date" en pantalla y un orden impredecible. Ahora se detecta y
 *     se degrada con elegancia. El arreglo de fondo es que Admin escriba ISO.
 * =============================================================================
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';

const MAPS_KEY = 'AIzaSyClpZ7qlzK2bqO2DcuY2Ta_jcNSAGffbrw';

/** Color y etiqueta de cada estado de viaje en curso. */
const ESTADO_CONFIG = {
  recibido: { color: '#378ADD', label: 'Viaje recibido' },
  iniciado: { color: '#1D9E75', label: 'En ruta' },
  demorado: { color: '#BA7517', label: 'Demorado' },
};

/** Opciones del filtro de fecha, en el orden en que se muestran. */
const RANGOS_FECHA = [
  { id: 'todo', label: 'Todo' },
  { id: 'hoy', label: 'Hoy' },
  { id: '7dias', label: '7 días' },
  { id: 'mes', label: 'Este mes' },
];

/* =============================================================================
 * UTILIDADES DE FECHA
 *
 * Todas devuelven strings 'AAAA-MM-DD' para poder comparar directamente contra
 * `fecha_carga`, que se guarda en ese formato. Comparar strings evita construir
 * objetos Date y esquiva los problemas de zona horaria.
 * ========================================================================== */

/**
 * Convierte un Date a 'AAAA-MM-DD' usando la fecha LOCAL.
 * No se usa `toISOString()` a propósito: esa función convierte a UTC, y en
 * Argentina (UTC-3) haría que después de las 21:00 "hoy" ya sea mañana.
 *
 * @param {Date} d
 * @returns {string} Fecha en formato 'AAAA-MM-DD'.
 */
function aFechaLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** @returns {string} La fecha de hoy en 'AAAA-MM-DD'. */
function fechaHoy() {
  return aFechaLocal(new Date());
}

/**
 * @param {number} dias Cantidad de días hacia atrás.
 * @returns {string} La fecha de hace `dias` días, en 'AAAA-MM-DD'.
 */
function fechaHaceDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return aFechaLocal(d);
}

/** @returns {string} El primer día del mes corriente, en 'AAAA-MM-DD'. */
function fechaInicioMes() {
  const d = new Date();
  return aFechaLocal(new Date(d.getFullYear(), d.getMonth(), 1));
}

/**
 * Parsea un timestamp de forma tolerante.
 *
 * Existe porque en la base conviven dos formatos: ISO 8601 (lo que escribe la
 * app) y `toLocaleString('es-AR')` en 12h sin AM/PM (lo que escribe el
 * "finalizar manualmente" de Admin). El segundo es ambiguo y `new Date()` no lo
 * puede interpretar.
 *
 * @param {string} valor Timestamp en cualquiera de los dos formatos.
 * @returns {number|null} Milisegundos desde época, o null si no es parseable.
 */
function msSeguro(valor) {
  if (!valor) return null;
  const ms = new Date(valor).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/* =============================================================================
 * UTILIDADES DE MAPA
 * ========================================================================== */

/**
 * Rumbo en grados entre dos coordenadas, para orientar la flecha del marcador.
 * 0 es norte, 90 este, 180 sur, 270 oeste.
 *
 * @returns {number} Ángulo en grados (0-360). Devuelve 0 si falta algún dato.
 */
function calcularAngulo(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 0;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1r = lat1 * Math.PI / 180;
  const lat2r = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/**
 * Caché de iconos ya rasterizados, indexado por color y ángulo redondeado.
 * Sin esto se regeneraría un PNG por cada actualización de cada marcador.
 */
const pngCache = {};

/**
 * Genera la URL de un icono de flecha rotada, como PNG.
 *
 * Se pasa el SVG por un canvas porque Google Maps no rota iconos SVG en línea de
 * forma confiable en todos los navegadores. Si el canvas falla, cae al SVG
 * directo como respaldo.
 *
 * @param {string} color Color de relleno en hexadecimal.
 * @param {number} angulo Rotación en grados.
 * @param {Function} callback Recibe la URL del icono.
 */
function getFlechaIconUrl(color, angulo, callback) {
  const key = `${color}_${Math.round(angulo)}`;
  if (pngCache[key]) { callback(pngCache[key]); return; }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <g transform="rotate(${angulo} 16 16)">
      <polygon points="16,2 28,30 16,23 4,30" fill="${color}" stroke="white" stroke-width="2" stroke-linejoin="round"/>
    </g>
  </svg>`;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const url = canvas.toDataURL('image/png');
    pngCache[key] = url;
    callback(url);
  };
  img.onerror = () => callback('data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg));
  img.src = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

/* =============================================================================
 * COMPONENTE DE FILTRO MULTI-SELECCIÓN
 * ========================================================================== */

/**
 * Desplegable de selección múltiple con casillas.
 *
 * No se usa un `<select multiple>` nativo porque obliga a mantener Ctrl
 * apretado para elegir varias opciones, algo que la mayoría de los usuarios no
 * conoce y que en la práctica hace que se pierda la selección anterior de un
 * clic. Con casillas, cada opción se activa y desactiva de forma independiente.
 *
 * El panel se cierra al hacer clic afuera, mediante un listener en `document`
 * que se da de baja al desmontar.
 *
 * @param {Object} props
 * @param {string} props.etiqueta Nombre del filtro ("Transportista", "Chofer").
 * @param {Array<{id: string, label: string}>} props.opciones Opciones disponibles.
 * @param {string[]} props.seleccion IDs actualmente seleccionados.
 * @param {Function} props.onChange Recibe el nuevo array de IDs.
 * @param {string} [props.vacio] Texto a mostrar cuando no hay opciones.
 */
function FiltroMulti({ etiqueta, opciones, seleccion, onChange, vacio = 'Sin opciones' }) {
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef(null);

  useEffect(() => {
    if (!abierto) return;
    function alClickAfuera(e) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target)) {
        setAbierto(false);
      }
    }
    document.addEventListener('mousedown', alClickAfuera);
    return () => document.removeEventListener('mousedown', alClickAfuera);
  }, [abierto]);

  function alternar(id) {
    if (seleccion.includes(id)) onChange(seleccion.filter(x => x !== id));
    else onChange([...seleccion, id]);
  }

  const hayFiltro = seleccion.length > 0;

  // El botón muestra el nombre cuando hay una sola opción elegida, y la cantidad
  // cuando hay varias: con el panel de 320px no entra una lista de nombres.
  const textoBoton = !hayFiltro
    ? etiqueta
    : seleccion.length === 1
      ? (opciones.find(o => o.id === seleccion[0])?.label || etiqueta)
      : `${etiqueta} (${seleccion.length})`;

  return (
    <div ref={contenedorRef} style={s.filtroWrap}>
      <button
        style={{ ...s.filtroBtn, ...(hayFiltro ? s.filtroBtnActivo : {}) }}
        onClick={() => setAbierto(a => !a)}
        title={hayFiltro ? seleccion.map(id => opciones.find(o => o.id === id)?.label).filter(Boolean).join(', ') : etiqueta}>
        <span style={s.filtroBtnTxt}>{textoBoton}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div style={s.filtroPanel}>
          {opciones.length === 0 && <div style={s.filtroVacio}>{vacio}</div>}

          {opciones.length > 0 && (
            <>
              <div style={s.filtroAcciones}>
                <button style={s.filtroAccionBtn} onClick={() => onChange(opciones.map(o => o.id))}>Todos</button>
                <button style={s.filtroAccionBtn} onClick={() => onChange([])}>Ninguno</button>
              </div>
              {opciones.map(o => (
                <label key={o.id} style={s.filtroOpcion}>
                  <input
                    type="checkbox"
                    checked={seleccion.includes(o.id)}
                    onChange={() => alternar(o.id)}
                    style={{ margin: 0, cursor: 'pointer' }}
                  />
                  <span style={s.filtroOpcionTxt}>{o.label}</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* =============================================================================
 * COMPONENTE PRINCIPAL
 * ========================================================================== */

/**
 * Pantalla de seguimiento.
 *
 * @param {Object} props
 * @param {Function} props.onVolver Callback para volver al inicio del portal.
 */
function Seguimiento({ onVolver }) {
  const [tab, setTab] = useState('vivo'); // 'vivo' | 'historial'
  const [choferes, setChoferes] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [seleccionadoHist, setSeleccionadoHist] = useState(null);
  const [cargando, setCargando] = useState(true);

  // --- Estado de los filtros ---
  /** IDs de transportista seleccionados. Vacío = sin filtrar. */
  const [filtroTransportistas, setFiltroTransportistas] = useState([]);
  /** Claves de chofer seleccionadas (DNI, o nombre si no tiene DNI). */
  const [filtroChoferes, setFiltroChoferes] = useState([]);
  /** Rango de fecha activo: 'todo' | 'hoy' | '7dias' | 'mes'. */
  const [filtroRango, setFiltroRango] = useState('todo');

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const infoWindowRef = useRef(null);
  const polylineRef = useRef(null);
  const tracksRef = useRef({});
  /** Marcadores A y B del historial, para poder limpiarlos entre consultas. */
  const marcadoresHistRef = useRef([]);

  /* ---------------------------------------------------------------------------
   * Suscripción a los pedidos
   *
   * Se escucha la colección entera y se arman en memoria las dos listas. Es una
   * lectura completa: aceptable con el volumen actual, pero es el primer lugar a
   * mirar si el sistema crece.
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      const activos = [];
      const hist = [];
      const newTracks = {};

      snap.docs.forEach(d => {
        const pedido = d.data();
        (pedido.despachos || []).forEach((despacho, i) => {
          const trackKey = pedido.id + '-D' + (i + 1);
          const track = pedido[`gps_track_${i}`] || [];
          if (track.length > 0) newTracks[trackKey] = track;

          const estado = despacho.estado_chofer || '';

          // Claves de agrupación para los filtros. Se prefiere siempre el ID
          // estable; el nombre es solo un respaldo para registros viejos que no
          // lo tienen, y se prefija para que nunca colisione con un ID real.
          const transporteKey = despacho.transporte_id || ('nom:' + (despacho.transporte || 'Sin transportista'));
          const choferKey = despacho.dni_chofer || ('nom:' + (despacho.chofer || 'Sin chofer'));

          // --- En vivo ---
          if (['recibido', 'iniciado', 'demorado'].includes(estado)) {
            activos.push({
              uid: trackKey,
              docId: d.id,
              despachoIdx: i,
              chofer: despacho.chofer || 'Sin nombre',
              dni_chofer: despacho.dni_chofer || '',
              chofer_key: choferKey,
              transporte: despacho.transporte || '',
              transporte_id: despacho.transporte_id || '',
              transporte_key: transporteKey,
              producto: pedido.producto,
              volumen: despacho.volumen,
              cliente: pedido.cliente,
              ov: pedido.ov,
              lugar: pedido.lugar,
              patente_tractor: despacho.patente_tractor || '',
              patente_semi: despacho.patente_semi || '',
              tel_unidad: despacho.tel_unidad || '',
              estado_chofer: estado,
              estado_chofer_ts: despacho.estado_chofer_ts || '',
              gps_lat: despacho.gps_lat || null,
              gps_lng: despacho.gps_lng || null,
              gps_lat_prev: despacho.gps_lat_prev || null,
              gps_lng_prev: despacho.gps_lng_prev || null,
              gps_ts: despacho.gps_ts || null,
              fecha_carga: despacho.fecha_carga || '',
            });
          }

          // --- Historial: finalizados con traza ---
          if (estado === 'finalizado' && track.length >= 2) {
            hist.push({
              uid: trackKey,
              docId: d.id,
              despachoIdx: i,
              chofer: despacho.chofer || 'Sin nombre',
              dni_chofer: despacho.dni_chofer || '',
              chofer_key: choferKey,
              // `transporte` no se copiaba acá: sin él era imposible filtrar el
              // historial por transportista.
              transporte: despacho.transporte || '',
              transporte_id: despacho.transporte_id || '',
              transporte_key: transporteKey,
              producto: pedido.producto,
              volumen: despacho.volumen,
              cliente: pedido.cliente,
              ov: pedido.ov,
              lugar: pedido.lugar,
              fecha_carga: despacho.fecha_carga || '',
              chofer_inicio_ts: despacho.chofer_inicio_ts || '',
              chofer_fin_ts: despacho.chofer_fin_ts || '',
              patente_tractor: despacho.patente_tractor || '',
              puntos: track.length,
              track,
            });
          }
        });
      });

      tracksRef.current = newTracks;

      // Orden: más reciente primero. Si el timestamp de fin no es parseable
      // (formato local de Admin), se cae a la fecha de carga.
      hist.sort((a, b) => {
        const msA = msSeguro(a.chofer_fin_ts) ?? msSeguro(a.fecha_carga) ?? 0;
        const msB = msSeguro(b.chofer_fin_ts) ?? msSeguro(b.fecha_carga) ?? 0;
        return msB - msA;
      });

      setChoferes(activos);
      setHistorial(hist);
      setCargando(false);
    });
    return () => unsub();
  }, []);

  /* ---------------------------------------------------------------------------
   * Carga del script de Google Maps
   * ------------------------------------------------------------------------ */
  useEffect(() => {
    if (window.google) { initMap(); return; }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`;
    script.async = true;
    script.onload = initMap;
    document.head.appendChild(script);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function initMap() {
    if (!mapRef.current || mapInstanceRef.current) return;
    mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: -32.7, lng: -60.5 },
      zoom: 6,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
    });
    infoWindowRef.current = new window.google.maps.InfoWindow();
  }

  /* ===========================================================================
   * FILTRADO
   * ======================================================================== */

  /**
   * Opciones del desplegable de transportistas.
   *
   * Se arma con los transportistas que efectivamente tienen viajes — activos o
   * en historial — y no con la lista completa de la empresa: un desplegable con
   * transportistas sin viajes es ruido.
   */
  const opcionesTransportistas = useMemo(() => {
    const mapa = new Map();
    [...choferes, ...historial].forEach(r => {
      if (!mapa.has(r.transporte_key)) {
        mapa.set(r.transporte_key, r.transporte || 'Sin transportista');
      }
    });
    return [...mapa.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [choferes, historial]);

  /**
   * Opciones del desplegable de choferes, EN CASCADA.
   *
   * Solo incluye choferes que pertenecen a alguno de los transportistas
   * seleccionados. Sin transportistas seleccionados, los lista a todos.
   */
  const opcionesChoferes = useMemo(() => {
    const mapa = new Map();
    [...choferes, ...historial].forEach(r => {
      if (filtroTransportistas.length > 0 && !filtroTransportistas.includes(r.transporte_key)) return;
      if (!mapa.has(r.chofer_key)) {
        mapa.set(r.chofer_key, r.chofer || 'Sin chofer');
      }
    });
    return [...mapa.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [choferes, historial, filtroTransportistas]);

  /**
   * Poda de la selección de choferes al cambiar los transportistas.
   *
   * Sin esto, un chofer elegido que deja de pertenecer a los transportistas
   * seleccionados seguiría filtrando desde las sombras: el usuario no lo ve en
   * la lista pero sigue restringiendo los resultados, y el efecto es una
   * pantalla vacía sin explicación aparente.
   */
  useEffect(() => {
    if (filtroChoferes.length === 0) return;
    const validos = new Set(opcionesChoferes.map(o => o.id));
    const podados = filtroChoferes.filter(id => validos.has(id));
    if (podados.length !== filtroChoferes.length) setFiltroChoferes(podados);
  }, [opcionesChoferes]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Límite inferior de fecha según el rango elegido, o null si es 'todo'.
   *
   * Solo se aplica límite INFERIOR, sin tope superior: un viaje con fecha de
   * carga futura debe seguir apareciendo en "en vivo". Acotar por arriba lo
   * escondería justo cuando más importa verlo.
   */
  const desdeFecha = useMemo(() => {
    if (filtroRango === 'hoy') return fechaHoy();
    if (filtroRango === '7dias') return fechaHaceDias(6); // hoy incluido
    if (filtroRango === 'mes') return fechaInicioMes();
    return null;
  }, [filtroRango]);

  /**
   * Evalúa si un registro pasa los tres filtros.
   *
   * @param {Object} r Registro de viaje (activo o de historial).
   * @returns {boolean}
   */
  function pasaFiltros(r) {
    if (filtroTransportistas.length > 0 && !filtroTransportistas.includes(r.transporte_key)) return false;
    if (filtroChoferes.length > 0 && !filtroChoferes.includes(r.chofer_key)) return false;
    if (desdeFecha) {
      if (!r.fecha_carga) return false;
      // 'hoy' es igualdad exacta; los otros rangos son "de esta fecha en adelante".
      if (filtroRango === 'hoy') { if (r.fecha_carga !== desdeFecha) return false; }
      else if (r.fecha_carga < desdeFecha) return false;
    }
    return true;
  }

  const choferesFiltrados = useMemo(
    () => choferes.filter(pasaFiltros),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [choferes, filtroTransportistas, filtroChoferes, filtroRango, desdeFecha]
  );

  const histFiltrado = useMemo(
    () => historial.filter(pasaFiltros),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historial, filtroTransportistas, filtroChoferes, filtroRango, desdeFecha]
  );

  const hayFiltrosActivos =
    filtroTransportistas.length > 0 || filtroChoferes.length > 0 || filtroRango !== 'todo';

  /** Restablece los tres filtros a su estado inicial. */
  function limpiarFiltros() {
    setFiltroTransportistas([]);
    setFiltroChoferes([]);
    setFiltroRango('todo');
  }

  /* ===========================================================================
   * MARCADORES DEL MAPA
   * ======================================================================== */

  /**
   * Sincroniza los marcadores de "en vivo" con la lista FILTRADA.
   *
   * Depende de `choferesFiltrados` y no de `choferes` para que el mapa muestre
   * exactamente lo mismo que el panel: filtrar la lista sin filtrar el mapa
   * dejaría marcadores de camiones que el usuario acaba de excluir.
   *
   * Primero da de baja los marcadores que ya no corresponden, después crea o
   * reposiciona los vigentes.
   */
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google) return;

    const uidsActuales = new Set(choferesFiltrados.map(c => c.uid));
    Object.keys(markersRef.current).forEach(uid => {
      if (!uidsActuales.has(uid)) {
        markersRef.current[uid].setMap(null);
        delete markersRef.current[uid];
      }
    });

    choferesFiltrados.forEach(c => {
      if (!c.gps_lat || !c.gps_lng) return;
      const pos = { lat: c.gps_lat, lng: c.gps_lng };
      const cfg = ESTADO_CONFIG[c.estado_chofer] || ESTADO_CONFIG.iniciado;
      const angulo = calcularAngulo(c.gps_lat_prev, c.gps_lng_prev, c.gps_lat, c.gps_lng);

      getFlechaIconUrl(cfg.color, angulo, (iconUrl) => {
        const icon = {
          url: iconUrl,
          scaledSize: new window.google.maps.Size(32, 32),
          anchor: new window.google.maps.Point(16, 16),
        };
        if (markersRef.current[c.uid]) {
          markersRef.current[c.uid].setPosition(pos);
          markersRef.current[c.uid].setIcon(icon);
        } else {
          const marker = new window.google.maps.Marker({
            position: pos, map: mapInstanceRef.current, title: c.chofer, icon,
          });
          marker.addListener('click', () => {
            setSeleccionado(c.uid);
            mapInstanceRef.current.panTo(pos);
            const cfg2 = ESTADO_CONFIG[c.estado_chofer] || ESTADO_CONFIG.iniciado;
            infoWindowRef.current.setContent(`
              <div style="font-family:sans-serif;padding:6px 8px;min-width:200px">
                <div style="font-weight:600;font-size:13px;margin-bottom:4px">🚛 ${c.chofer}</div>
                <div style="font-size:12px;color:#6B7280">${c.producto} · ${c.cliente}</div>
                <div style="font-size:12px;color:#6B7280;margin-top:2px">${c.patente_tractor}${c.patente_semi ? ' / ' + c.patente_semi : ''}</div>
                <div style="font-size:11px;color:#9CA3AF;margin-top:4px">${cfg2.label}</div>
              </div>
            `);
            infoWindowRef.current.open(mapInstanceRef.current, marker);
          });
          markersRef.current[c.uid] = marker;
        }
      });
    });
  }, [choferesFiltrados]);

  /** Quita la polilínea del mapa, si hay alguna dibujada. */
  function limpiarPolyline() {
    if (polylineRef.current) { polylineRef.current.setMap(null); polylineRef.current = null; }
  }

  /**
   * Quita los marcadores A y B del historial.
   *
   * Antes no existía: cada viaje consultado creaba un par de marcadores nuevos
   * sin guardar referencia, así que se iban acumulando en el mapa sin forma de
   * sacarlos salvo recargando la página.
   */
  function limpiarMarcadoresHist() {
    marcadoresHistRef.current.forEach(m => m.setMap(null));
    marcadoresHistRef.current = [];
  }

  /**
   * Dibuja una traza como polilínea y ajusta el encuadre para que entre entera.
   *
   * @param {Array<{lat:number,lng:number}>} track Puntos del recorrido.
   */
  function dibujarTraza(track) {
    limpiarPolyline();
    if (!track || track.length < 2 || !mapInstanceRef.current || !window.google) return;
    const path = track.map(p => ({ lat: p.lat, lng: p.lng }));
    polylineRef.current = new window.google.maps.Polyline({
      path, geodesic: true,
      strokeColor: '#C8102E', strokeOpacity: 0.75, strokeWeight: 3,
      map: mapInstanceRef.current,
    });
    const bounds = new window.google.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    mapInstanceRef.current.fitBounds(bounds);
  }

  /**
   * Centra el mapa en un chofer, dibuja su traza parcial y abre su ficha.
   *
   * @param {Object} c Registro del chofer.
   */
  function centrarEnChofer(c) {
    if (!c.gps_lat || !c.gps_lng || !mapInstanceRef.current) return;
    mapInstanceRef.current.panTo({ lat: c.gps_lat, lng: c.gps_lng });
    mapInstanceRef.current.setZoom(13);
    setSeleccionado(c.uid);
    dibujarTraza(tracksRef.current[c.uid]);
    if (markersRef.current[c.uid]) window.google.maps.event.trigger(markersRef.current[c.uid], 'click');
  }

  /**
   * Muestra el recorrido completo de un viaje finalizado, con marcadores de
   * inicio (A, verde) y fin (B, rojo).
   *
   * @param {Object} h Registro de historial.
   */
  function seleccionarHistorial(h) {
    setSeleccionadoHist(h.uid);

    // Ocultar los marcadores de "en vivo" para no mezclar ambos modos.
    Object.keys(markersRef.current).forEach(uid => markersRef.current[uid].setMap(null));
    limpiarMarcadoresHist();
    dibujarTraza(h.track);

    if (window.google && mapInstanceRef.current && h.track.length >= 2) {
      const inicio = h.track[0];
      const fin = h.track[h.track.length - 1];
      marcadoresHistRef.current.push(new window.google.maps.Marker({
        position: { lat: inicio.lat, lng: inicio.lng },
        map: mapInstanceRef.current,
        title: 'Inicio',
        label: { text: 'A', color: '#fff', fontWeight: 'bold' },
        icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#0F6E56', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      }));
      marcadoresHistRef.current.push(new window.google.maps.Marker({
        position: { lat: fin.lat, lng: fin.lng },
        map: mapInstanceRef.current,
        title: 'Fin',
        label: { text: 'B', color: '#fff', fontWeight: 'bold' },
        icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#C8102E', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      }));
    }
  }

  /** Restaura la vista "en vivo": limpia el historial y repone los marcadores. */
  function volverAVivo() {
    limpiarPolyline();
    limpiarMarcadoresHist();
    setSeleccionadoHist(null);
    choferesFiltrados.forEach(c => {
      if (!c.gps_lat || !c.gps_lng) return;
      if (markersRef.current[c.uid]) markersRef.current[c.uid].setMap(mapInstanceRef.current);
    });
    mapInstanceRef.current?.setCenter({ lat: -32.7, lng: -60.5 });
    mapInstanceRef.current?.setZoom(6);
  }

  /* ===========================================================================
   * FORMATO Y ALERTAS
   * ======================================================================== */

  /**
   * Cuánto pasó desde un timestamp, en lenguaje natural.
   * @param {string} isoStr Timestamp ISO 8601.
   */
  function tiempoDesde(isoStr) {
    const ms = msSeguro(isoStr);
    if (ms === null) return '—';
    const diff = Date.now() - ms;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `hace ${h} h ${m} min`;
    return `hace ${m} min`;
  }

  /**
   * Convierte 'AAAA-MM-DD' a 'DD/MM/AAAA'.
   * @param {string} str
   */
  function formatFecha(str) {
    if (!str) return '—';
    const partes = str.split('-');
    return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : str;
  }

  /**
   * Formatea un timestamp para mostrar día, mes y hora.
   *
   * Si el valor no es parseable — caso de los timestamps en formato local que
   * escribe Admin — devuelve el texto original en vez de "Invalid Date". Es un
   * paliativo: el arreglo de fondo es que Admin escriba ISO 8601.
   *
   * @param {string} valor
   */
  function formatTs(valor) {
    if (!valor) return '—';
    const ms = msSeguro(valor);
    if (ms === null) return String(valor);
    return new Date(ms).toLocaleString('es-AR', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  }

  /**
   * Arma las alertas del panel "en vivo", sobre la lista FILTRADA: si el usuario
   * acotó a un transportista, no tiene sentido alertarlo por camiones de otro.
   *
   * @returns {Array<{uid:string, chofer:string, msg:string, tipo:string}>}
   */
  function getAlertas() {
    const alertas = [];
    choferesFiltrados.forEach(c => {
      if (c.estado_chofer === 'demorado') {
        alertas.push({ uid: c.uid, chofer: c.chofer, msg: 'Viaje demorado', tipo: 'red' });
      }
      const ms = msSeguro(c.gps_ts);
      if (ms !== null) {
        const min = Math.floor((Date.now() - ms) / 60000);
        if (c.estado_chofer === 'iniciado' && min > 30) {
          alertas.push({ uid: c.uid, chofer: c.chofer, msg: `Sin movimiento hace ${min} min`, tipo: 'amber' });
        }
        if (min > 60) {
          alertas.push({ uid: c.uid, chofer: c.chofer, msg: `Sin señal GPS hace ${min} min`, tipo: 'red' });
        }
      }
    });
    return alertas;
  }

  const alertas = getAlertas();

  /* ===========================================================================
   * RENDER
   * ======================================================================== */

  return (
    <div style={s.wrap}>

      {/* Barra superior: logo, contador y selector de pestaña */}
      <div style={s.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.png" alt="Explora" style={{ height: 28, objectFit: 'contain' }} />
          <span style={s.topbarTit}>Seguimiento</span>
          {tab === 'vivo' && (
            <span style={s.topbarSub}>
              {choferesFiltrados.length} activo{choferesFiltrados.length !== 1 ? 's' : ''}
              {hayFiltrosActivos && choferes.length !== choferesFiltrados.length ? ` de ${choferes.length}` : ''}
            </span>
          )}
          {tab === 'historial' && (
            <span style={s.topbarSub}>
              {histFiltrado.length} viaje{histFiltrado.length !== 1 ? 's' : ''}
              {hayFiltrosActivos && historial.length !== histFiltrado.length ? ` de ${historial.length}` : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={s.tabs}>
            <button style={{ ...s.tabBtn, ...(tab === 'vivo' ? s.tabBtnActive : {}) }}
              onClick={() => { setTab('vivo'); volverAVivo(); }}>🔴 En vivo</button>
            <button style={{ ...s.tabBtn, ...(tab === 'historial' ? s.tabBtnActive : {}) }}
              onClick={() => { setTab('historial'); limpiarPolyline(); limpiarMarcadoresHist(); setSeleccionadoHist(null); }}>📂 Historial</button>
          </div>
          <button style={s.btnVolver} onClick={onVolver}>← Inicio</button>
        </div>
      </div>

      <div style={s.layout}>
        <div style={s.panel}>

          {/* ── FILTROS ──
              Fuera de los bloques de cada pestaña a propósito: son los mismos
              para las dos, y mantenerlos afuera hace que la selección se
              conserve al cambiar de pestaña. */}
          <div style={s.filtrosBloque}>
            <div style={s.filtrosFila}>
              <FiltroMulti
                etiqueta="Transportista"
                opciones={opcionesTransportistas}
                seleccion={filtroTransportistas}
                onChange={setFiltroTransportistas}
                vacio="Sin transportistas con viajes"
              />
              <FiltroMulti
                etiqueta="Chofer"
                opciones={opcionesChoferes}
                seleccion={filtroChoferes}
                onChange={setFiltroChoferes}
                vacio="Sin choferes para esta selección"
              />
            </div>

            <div style={s.filtrosFila}>
              {RANGOS_FECHA.map(r => (
                <button key={r.id}
                  style={{ ...s.chipFecha, ...(filtroRango === r.id ? s.chipFechaActivo : {}) }}
                  onClick={() => setFiltroRango(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>

            {hayFiltrosActivos && (
              <button style={s.btnLimpiarFiltros} onClick={limpiarFiltros}>
                ✕ Limpiar filtros
              </button>
            )}
          </div>

          {/* ── TAB EN VIVO ── */}
          {tab === 'vivo' && (
            <>
              {alertas.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {alertas.map((a, i) => (
                    <div key={i}
                      style={{ ...s.alerta, background: a.tipo === 'red' ? '#FCEBEB' : '#FAEEDA', borderColor: a.tipo === 'red' ? '#F09595' : '#EF9F27' }}
                      onClick={() => { const c = choferesFiltrados.find(x => x.uid === a.uid); if (c) centrarEnChofer(c); }}>
                      <span>{a.tipo === 'red' ? '🔴' : '🟠'}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: a.tipo === 'red' ? '#A32D2D' : '#633806' }}>{a.chofer}</div>
                        <div style={{ fontSize: 11, color: a.tipo === 'red' ? '#A32D2D' : '#633806' }}>{a.msg}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {cargando && <div style={s.empty}>Cargando...</div>}
              {!cargando && choferesFiltrados.length === 0 && (
                <div style={s.empty}>
                  {hayFiltrosActivos && choferes.length > 0
                    ? 'Ningún chofer activo coincide con los filtros.'
                    : 'No hay choferes activos en este momento.'}
                </div>
              )}

              {choferesFiltrados.map(c => {
                const cfg = ESTADO_CONFIG[c.estado_chofer] || ESTADO_CONFIG.iniciado;
                const activo = seleccionado === c.uid;
                return (
                  <div key={c.uid}
                    style={{ ...s.choferCard, borderColor: activo ? cfg.color : '#E5E7EB', background: activo ? '#F9FAFB' : '#fff' }}
                    onClick={() => { if (seleccionado === c.uid) { limpiarPolyline(); setSeleccionado(null); } else { centrarEnChofer(c); } }}>
                    <div style={s.choferHeader}>
                      <span style={{ ...s.dot, background: cfg.color }} />
                      <span style={s.choferNombre}>{c.chofer}</span>
                      <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 20, background: cfg.color + '22', color: cfg.color }}>{cfg.label}</span>
                    </div>
                    {c.transporte && <div style={s.choferTransporte}>🚚 {c.transporte}</div>}
                    <div style={s.choferGrid}>
                      <div style={s.cf}><span style={s.cl}>Producto</span><span style={s.cv}>{c.producto}</span></div>
                      <div style={s.cf}><span style={s.cl}>Cliente</span><span style={s.cv}>{c.cliente}</span></div>
                      <div style={s.cf}><span style={s.cl}>Destino</span><span style={s.cv}>{c.lugar}</span></div>
                      <div style={s.cf}><span style={s.cl}>Unidad</span><span style={s.cv}>{c.patente_tractor}{c.patente_semi ? ' / ' + c.patente_semi : ''}</span></div>
                      <div style={s.cf}><span style={s.cl}>Carga</span><span style={s.cv}>{formatFecha(c.fecha_carga)}</span></div>
                      <div style={s.cf}>
                        <span style={s.cl}>GPS</span>
                        <span style={{ ...s.cv, color: c.gps_ts ? '#0F6E56' : '#9CA3AF' }}>{c.gps_ts ? tiempoDesde(c.gps_ts) : 'Sin señal'}</span>
                      </div>
                    </div>
                    {c.tel_unidad && <a href={`tel:${c.tel_unidad}`} style={s.btnLlamar}>📞 {c.tel_unidad}</a>}
                  </div>
                );
              })}
            </>
          )}

          {/* ── TAB HISTORIAL ── */}
          {tab === 'historial' && (
            <>
              {cargando && <div style={s.empty}>Cargando...</div>}
              {!cargando && histFiltrado.length === 0 && (
                <div style={s.empty}>
                  {hayFiltrosActivos && historial.length > 0
                    ? 'Ningún viaje coincide con los filtros.'
                    : 'No hay viajes finalizados con traza GPS.'}
                </div>
              )}

              {histFiltrado.map(h => {
                const activo = seleccionadoHist === h.uid;
                return (
                  <div key={h.uid}
                    style={{ ...s.choferCard, borderColor: activo ? '#C8102E' : '#E5E7EB', background: activo ? '#FFF5F5' : '#fff' }}
                    onClick={() => seleccionarHistorial(h)}>
                    <div style={s.choferHeader}>
                      <span style={{ ...s.dot, background: '#C8102E' }} />
                      <span style={s.choferNombre}>{h.chofer}</span>
                      <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 20, background: '#FEF2F2', color: '#C8102E' }}>Finalizado</span>
                    </div>
                    {h.transporte && <div style={s.choferTransporte}>🚚 {h.transporte}</div>}
                    <div style={s.choferGrid}>
                      <div style={s.cf}><span style={s.cl}>OV/OC</span><span style={s.cv}>{h.ov}</span></div>
                      <div style={s.cf}><span style={s.cl}>Cliente</span><span style={s.cv}>{h.cliente}</span></div>
                      <div style={s.cf}><span style={s.cl}>Producto</span><span style={s.cv}>{h.producto}</span></div>
                      <div style={s.cf}><span style={s.cl}>Fecha carga</span><span style={s.cv}>{formatFecha(h.fecha_carga)}</span></div>
                      <div style={s.cf}><span style={s.cl}>Inicio</span><span style={s.cv}>{formatTs(h.chofer_inicio_ts)}</span></div>
                      <div style={s.cf}><span style={s.cl}>Fin</span><span style={s.cv}>{formatTs(h.chofer_fin_ts)}</span></div>
                    </div>
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 6 }}>📍 {h.puntos} puntos GPS · {h.patente_tractor}</div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Mapa */}
        <div style={s.mapaWrap}>
          <div ref={mapRef} style={s.mapa} />
          {tab === 'vivo' && !cargando && choferesFiltrados.filter(c => c.gps_lat).length === 0 && (
            <div style={s.sinGps}>
              Sin posición GPS disponible todavía.<br />
              <span style={{ fontSize: 12, color: '#9CA3AF' }}>Los choferes aparecen en el mapa al iniciar el viaje.</span>
            </div>
          )}
          {tab === 'historial' && !seleccionadoHist && (
            <div style={s.sinGps}>
              Seleccioná un viaje del panel para ver el recorrido.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
 * ESTILOS
 *
 * Objeto plano de estilos en línea, siguiendo la convención del resto del
 * portal. Paleta institucional: #C8102E (rojo Explora), #0F6E56 (verde).
 * ========================================================================== */
const s = {
  // --- Estructura general ---
  wrap: { minHeight: '100vh', fontFamily: "'DM Sans', system-ui, sans-serif", background: '#F8F8F8', display: 'flex', flexDirection: 'column' },
  layout: { display: 'flex', flex: 1, overflow: 'hidden', height: 'calc(100vh - 49px)' },
  panel: { width: 320, flexShrink: 0, overflowY: 'auto', padding: '12px', borderRight: '0.5px solid #E5E7EB', background: '#fff' },

  // --- Barra superior ---
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#fff', borderBottom: '0.5px solid #E5E7EB', position: 'sticky', top: 0, zIndex: 100 },
  topbarTit: { fontSize: 15, fontWeight: 600, color: '#111827' },
  topbarSub: { fontSize: 12, color: '#9CA3AF', marginLeft: 4 },
  tabs: { display: 'flex', background: '#F3F4F6', borderRadius: 8, padding: 3, gap: 2 },
  tabBtn: { padding: '5px 12px', borderRadius: 6, border: 'none', background: 'transparent', color: '#6B7280', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  tabBtnActive: { background: '#fff', color: '#111827', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },

  // --- Bloque de filtros ---
  filtrosBloque: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, paddingBottom: 10, borderBottom: '0.5px solid #F3F4F6' },
  filtrosFila: { display: 'flex', gap: 6 },
  // `position: relative` es lo que ancla el panel desplegable a su botón.
  filtroWrap: { position: 'relative', flex: 1, minWidth: 0 },
  filtroBtn: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: '6px 9px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer', boxSizing: 'border-box' },
  filtroBtnActivo: { borderColor: '#C8102E', background: '#FFF5F5', color: '#C8102E', fontWeight: 500 },
  filtroBtnTxt: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // zIndex alto: el panel tiene que quedar por encima de las tarjetas de abajo.
  filtroPanel: { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 240, overflowY: 'auto', background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 200, padding: 4 },
  filtroAcciones: { display: 'flex', gap: 4, padding: '2px 4px 6px', borderBottom: '0.5px solid #F3F4F6', marginBottom: 4 },
  filtroAccionBtn: { flex: 1, padding: '3px 6px', borderRadius: 6, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 11, cursor: 'pointer' },
  filtroOpcion: { display: 'flex', alignItems: 'center', gap: 7, padding: '5px 6px', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#111827' },
  filtroOpcionTxt: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  filtroVacio: { padding: '10px 8px', fontSize: 11, color: '#9CA3AF', textAlign: 'center' },
  chipFecha: { flex: 1, padding: '5px 4px', borderRadius: 20, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 11, cursor: 'pointer' },
  chipFechaActivo: { borderColor: '#C8102E', background: '#FFF5F5', color: '#C8102E', fontWeight: 500 },
  btnLimpiarFiltros: { padding: '4px 8px', borderRadius: 6, border: 'none', background: 'none', color: '#9CA3AF', fontSize: 11, cursor: 'pointer', textAlign: 'left' },

  // --- Alertas ---
  alerta: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8, border: '0.5px solid', marginBottom: 6, cursor: 'pointer' },

  // --- Tarjetas de viaje ---
  empty: { textAlign: 'center', padding: '2rem 1rem', color: '#9CA3AF', fontSize: 13 },
  choferCard: { border: '0.5px solid', borderRadius: 12, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', transition: 'border-color 0.15s' },
  choferHeader: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 },
  choferTransporte: { fontSize: 11, color: '#6B7280', marginBottom: 8, marginTop: -4 },
  dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  choferNombre: { fontSize: 13, fontWeight: 600, color: '#111827', flex: 1 },
  choferGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 10px', marginBottom: 4 },
  cf: { display: 'flex', flexDirection: 'column', gap: 1 },
  cl: { fontSize: 10, color: '#9CA3AF' },
  cv: { fontSize: 12, color: '#111827', fontWeight: 500 },
  btnLlamar: { display: 'block', fontSize: 12, color: '#0C447C', textDecoration: 'none', padding: '5px 0', borderTop: '0.5px solid #F3F4F6', marginTop: 4 },

  // --- Mapa ---
  mapaWrap: { flex: 1, position: 'relative' },
  mapa: { width: '100%', height: '100%' },
  sinGps: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', fontSize: 14, color: '#6B7280', lineHeight: 1.7, background: 'rgba(255,255,255,0.9)', padding: '16px 20px', borderRadius: 12 },
};

export default Seguimiento;
