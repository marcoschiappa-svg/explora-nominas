/**
 * =============================================================================
 * Seguimiento.js — Mapa de seguimiento de viajes (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Muestra sobre un mapa de Google dónde están los camiones y por dónde
 * pasaron. Tiene dos modos:
 *   - EN VIVO: posición actual de cada viaje en curso (`viajes.ultima_lat/lng`),
 *     con alertas por demora o falta de señal.
 *   - HISTORIAL: recorrido completo de viajes finalizados, leyendo la
 *     subcolección `viajes/{id}/gps_puntos` al seleccionar uno.
 *
 * -----------------------------------------------------------------------------
 * REDISENO -- MODELO NUEVO, ACCESO, LAYOUT
 * -----------------------------------------------------------------------------
 *   ANTES leia `pedidos_portal` (modelo legacy) con `despachos[]` y
 *   `gps_track_{i}` embebidos. AHORA lee la coleccion `viajes` (modelo
 *   nuevo) y su subcoleccion `gps_puntos` -- los pedidos viejos no tienen
 *   seguimiento, decision explicita: se dejan de mostrar.
 *
 *   Lo que el modelo nuevo NO trae, a diferencia del viejo (y las
 *   simplificaciones que eso obligo, ver el archivo entero para el detalle
 *   de cada una): sin flecha de rumbo (necesitaria el punto anterior), sin
 *   traza parcial al centrar un viaje en vivo, sin OV/OC en la busqueda (no
 *   esta denormalizado en `viajes`, vive en `despachos`).
 *
 *   La demora pasa a mostrarse como badge aparte, no como estado exclusivo
 *   -- `logica-viajes.js` ya lo dice: "la demora es un atributo, no un
 *   estado". Los nombres de chofer/transportista se resuelven con dos
 *   lookups chicos (`usuarios` filtrado por rol chofer, `organizaciones`
 *   filtrado por es_transportista) porque `viajes` solo denormaliza IDs
 *   (`chofer_uid`, `chofer_dni`, `transportista_org_id`), no nombres.
 *
 *   ACCESO: `motivoSinAcceso` adentro del componente (admin/coordinador/
 *   transportista), en vez de solo en la linea de ruteo de App.js.
 *
 *   FILTRO POR ORGANIZACION: un transportista solo consulta SUS PROPIOS
 *   viajes -- el `where('transportista_org_id','==',miOrg)` va en la
 *   consulta misma, no como filtro de UI despues. Las reglas de Firestore
 *   (`firestore.rules.produccion`, revisado) ya restringen tanto `viajes`
 *   como su subcoleccion `gps_puntos` por `transportista_org_id` -- el
 *   agujero que existia en una revision anterior (`gps_puntos` como
 *   coleccion suelta sin filtro) esta cerrado: ahora es subcoleccion con su
 *   propia regla que llama a `viajePadre()`.
 *
 *   LAYOUT: `wrap`/`layout` pasan a `flex: 1, minHeight: 0` en vez de
 *   `minHeight: 100vh` / `calc(100vh - Npx)` a mano -- ver el comentario en
 *   App.js (`Pagina`) para el por que completo. Antes la pagina entera
 *   scrolleaba (dificultando usar el mapa) y el mapa ni se dibujaba (un
 *   contenedor de Google Maps con alto 0 no renderiza nada).
 *
 *   BUSQUEDA: sigue el campo de texto libre agregado en la vuelta anterior
 *   (chofer, cliente, patente), sin OV por lo dicho arriba.
 *
 *   B1: `crearEstilos(colores, oscuro)` + `useEstilos()`, paleta rojo/azul,
 *   sin topbar propio (BarraSuperior ya cubre logo/volver).
 * ========================================================================== */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, where, doc, getDocs, orderBy } from 'firebase/firestore';
import { esAdmin, tieneRol, miOrganizacion, motivoSinAcceso } from '../sesion';
import { claveNormalizada } from '../mapa-normalizacion';
import { VIAJE, ETIQUETA_VIAJE } from '../estados';
import { saludGPS, ETIQUETA_GPS, COLOR_GPS } from '../logica-viajes';
import { marca, colorEstado, espacio, radio, tipografia, paletaTexto } from '../ui/tokens';
import { useTema } from '../ui/TemaContext';
import Tarjeta from '../ui/Tarjeta';
import Pastilla from '../ui/Pastilla';
import Vacio from '../ui/Vacio';

const MAPS_KEY = 'AIzaSyClpZ7qlzK2bqO2DcuY2Ta_jcNSAGffbrw';

const PLANTA_EXPLORA = { lat: -32.7, lng: -60.5 };
const ZOOM_ARGENTINA = 4;

const RANGOS_FECHA = [
  { id: 'todo', label: 'Todo' },
  { id: 'hoy', label: 'Hoy' },
  { id: '7dias', label: '7 días' },
  { id: 'mes', label: 'Este mes' },
];

function aFechaLocal(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function fechaHoy() {
  return aFechaLocal(new Date());
}

function fechaHaceDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return aFechaLocal(d);
}

function fechaInicioMes() {
  const d = new Date();
  return aFechaLocal(new Date(d.getFullYear(), d.getMonth(), 1));
}

/**
 * A diferencia del modelo viejo, ACA todos los timestamps son Firestore
 * Timestamp de verdad (`serverTimestamp()`) -- no hace falta el parseo
 * tolerante que existia para el `toLocaleString('es-AR')` sin AM/PM que
 * escribia el cierre manual del modelo legacy. Un solo camino.
 */
function aFecha(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

function FiltroMulti({ etiqueta, opciones, seleccion, onChange, vacio = 'Sin opciones', styles }) {
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

  const textoBoton = !hayFiltro
    ? etiqueta
    : seleccion.length === 1
      ? (opciones.find(o => o.id === seleccion[0])?.label || etiqueta)
      : `${etiqueta} (${seleccion.length})`;

  return (
    <div ref={contenedorRef} style={styles.filtroWrap}>
      <button
        style={{ ...styles.filtroBtn, ...(hayFiltro ? styles.filtroBtnActivo : {}) }}
        onClick={() => setAbierto(a => !a)}
        title={hayFiltro ? seleccion.map(id => opciones.find(o => o.id === id)?.label).filter(Boolean).join(', ') : etiqueta}>
        <span style={styles.filtroBtnTxt}>{textoBoton}</span>
        <span style={{ fontSize: 9, opacity: 0.7 }}>{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div style={styles.filtroPanel}>
          {opciones.length === 0 && <div style={styles.filtroVacio}>{vacio}</div>}

          {opciones.length > 0 && (
            <>
              <div style={styles.filtroAcciones}>
                <button style={styles.filtroAccionBtn} onClick={() => onChange(opciones.map(o => o.id))}>Todos</button>
                <button style={styles.filtroAccionBtn} onClick={() => onChange([])}>Ninguno</button>
              </div>
              {opciones.map(o => (
                <label key={o.id} style={styles.filtroOpcion}>
                  <input
                    type="checkbox"
                    checked={seleccion.includes(o.id)}
                    onChange={() => alternar(o.id)}
                    style={{ margin: 0, cursor: 'pointer' }}
                  />
                  <span style={styles.filtroOpcionTxt}>{o.label}</span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Seguimiento({ usuario, onVolver }) {
  const styles = useEstilos();
  const [tab, setTab] = useState('vivo');
  const [viajesVivos, setViajesVivos] = useState([]);
  const [viajesHistorial, setViajesHistorial] = useState([]);
  const [organizaciones, setOrganizaciones] = useState([]);
  const [choferesInfo, setChoferesInfo] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [seleccionadoHist, setSeleccionadoHist] = useState(null);
  const [cargando, setCargando] = useState(true);

  const soyAdmin = esAdmin(usuario);
  const soyCoordinador = tieneRol(usuario, 'coordinador');
  const soyTransportista = tieneRol(usuario, 'transportista');
  const miOrg = miOrganizacion(usuario);
  const sinAcceso = motivoSinAcceso(usuario, ['admin', 'coordinador', 'transportista']);

  const soloVeSuEmpresa = soyTransportista && !soyAdmin && !soyCoordinador;

  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroTransportistas, setFiltroTransportistas] = useState([]);
  const [filtroChoferes, setFiltroChoferes] = useState([]);
  const [filtroRango, setFiltroRango] = useState('todo');

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const infoWindowRef = useRef(null);
  const polylineRef = useRef(null);
  const marcadoresHistRef = useRef([]);

  useEffect(() => {
    if (sinAcceso) { setCargando(false); return; }

    const base = collection(db, 'viajes');
    const filtroOrg = soloVeSuEmpresa ? [where('transportista_org_id', '==', miOrg)] : [];

    const consultaVivos = query(base, ...filtroOrg, where('estado', 'in', [VIAJE.RECIBIDO, VIAJE.EN_VIAJE]));
    const consultaHist = query(base, ...filtroOrg, where('estado', '==', VIAJE.FINALIZADO));

    const unsubVivos = onSnapshot(consultaVivos, (snap) => {
      setViajesVivos(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setCargando(false);
    }, (err) => { console.error('Viajes en vivo:', err); setCargando(false); });

    const unsubHist = onSnapshot(consultaHist, (snap) => {
      setViajesHistorial(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (err) => console.error('Historial:', err));

    return () => { unsubVivos(); unsubHist(); };
  }, [sinAcceso, soloVeSuEmpresa, miOrg]);

  useEffect(() => {
    if (sinAcceso) return;

    const unsubOrgs = soloVeSuEmpresa
      ? onSnapshot(doc(db, 'organizaciones', miOrg), (snap) => {
          setOrganizaciones(snap.exists() ? [{ id: snap.id, ...snap.data() }] : []);
        })
      : onSnapshot(
          query(collection(db, 'organizaciones'), where('es_transportista', '==', true)),
          (snap) => setOrganizaciones(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        );

    const consultaChoferes = soloVeSuEmpresa
      ? query(collection(db, 'usuarios'), where('organizacion_id', '==', miOrg))
      : collection(db, 'usuarios');
    const unsubChoferes = onSnapshot(consultaChoferes, (snap) => {
      setChoferesInfo(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => (u.roles || []).includes('chofer')));
    });

    return () => { unsubOrgs(); unsubChoferes(); };
  }, [sinAcceso, soloVeSuEmpresa, miOrg]);

  const orgsPorId = useMemo(() => new Map(organizaciones.map(o => [o.id, o])), [organizaciones]);
  const choferesPorUid = useMemo(() => new Map(choferesInfo.map(c => [c.id, c])), [choferesInfo]);

  function enriquecer(v) {
    return {
      ...v,
      chofer: (choferesPorUid.get(v.chofer_uid) || {}).nombre || v.chofer_dni || 'Sin nombre',
      transporte: (orgsPorId.get(v.transportista_org_id) || {}).razon_social || 'Sin transportista',
      transporte_key: v.transportista_org_id || 'sin_transportista',
      chofer_key: v.chofer_dni || v.chofer_uid || 'sin_chofer',
    };
  }

  const vivosEnriquecidos = useMemo(() => viajesVivos.map(enriquecer), [viajesVivos, choferesPorUid, orgsPorId]);
  const historialEnriquecido = useMemo(() => viajesHistorial.map(enriquecer), [viajesHistorial, choferesPorUid, orgsPorId]);

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
      center: PLANTA_EXPLORA,
      zoom: ZOOM_ARGENTINA,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
    });
    infoWindowRef.current = new window.google.maps.InfoWindow();
  }

  const opcionesTransportistas = useMemo(() => {
    const mapa = new Map();
    [...vivosEnriquecidos, ...historialEnriquecido].forEach(r => {
      if (!mapa.has(r.transporte_key)) mapa.set(r.transporte_key, r.transporte);
    });
    return [...mapa.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [vivosEnriquecidos, historialEnriquecido]);

  const opcionesChoferes = useMemo(() => {
    const mapa = new Map();
    [...vivosEnriquecidos, ...historialEnriquecido].forEach(r => {
      if (filtroTransportistas.length > 0 && !filtroTransportistas.includes(r.transporte_key)) return;
      if (!mapa.has(r.chofer_key)) mapa.set(r.chofer_key, r.chofer);
    });
    return [...mapa.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [vivosEnriquecidos, historialEnriquecido, filtroTransportistas]);

  useEffect(() => {
    if (filtroChoferes.length === 0) return;
    const validos = new Set(opcionesChoferes.map(o => o.id));
    const podados = filtroChoferes.filter(id => validos.has(id));
    if (podados.length !== filtroChoferes.length) setFiltroChoferes(podados);
  }, [opcionesChoferes]); // eslint-disable-line react-hooks/exhaustive-deps

  const desdeFecha = useMemo(() => {
    if (filtroRango === 'hoy') return fechaHoy();
    if (filtroRango === '7dias') return fechaHaceDias(6);
    if (filtroRango === 'mes') return fechaInicioMes();
    return null;
  }, [filtroRango]);

  const textoFiltro = claveNormalizada(filtroTexto);

  function pasaFiltros(r) {
    if (textoFiltro) {
      const campo = claveNormalizada(`${r.chofer} ${r.cliente_razon_social} ${r.patente_tractor || ''} ${r.patente_semi || ''}`);
      if (!campo.includes(textoFiltro)) return false;
    }
    if (filtroTransportistas.length > 0 && !filtroTransportistas.includes(r.transporte_key)) return false;
    if (filtroChoferes.length > 0 && !filtroChoferes.includes(r.chofer_key)) return false;
    if (desdeFecha) {
      if (!r.fecha_carga) return false;
      if (filtroRango === 'hoy') { if (r.fecha_carga !== desdeFecha) return false; }
      else if (r.fecha_carga < desdeFecha) return false;
    }
    return true;
  }

  const choferesFiltrados = useMemo(
    () => vivosEnriquecidos.filter(pasaFiltros),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vivosEnriquecidos, textoFiltro, filtroTransportistas, filtroChoferes, filtroRango, desdeFecha]
  );

  const histFiltrado = useMemo(
    () => historialEnriquecido.filter(pasaFiltros),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historialEnriquecido, textoFiltro, filtroTransportistas, filtroChoferes, filtroRango, desdeFecha]
  );

  const hayFiltrosActivos =
    !!filtroTexto || filtroTransportistas.length > 0 || filtroChoferes.length > 0 || filtroRango !== 'todo';

  function limpiarFiltros() {
    setFiltroTexto('');
    setFiltroTransportistas([]);
    setFiltroChoferes([]);
    setFiltroRango('todo');
  }

  useEffect(() => {
    if (!mapInstanceRef.current || !window.google) return;

    const idsActuales = new Set(choferesFiltrados.map(c => c.id));
    Object.keys(markersRef.current).forEach(uid => {
      if (!idsActuales.has(uid)) {
        markersRef.current[uid].setMap(null);
        delete markersRef.current[uid];
      }
    });

    choferesFiltrados.forEach(c => {
      if (!c.ultima_lat || !c.ultima_lng) return;
      const pos = { lat: c.ultima_lat, lng: c.ultima_lng };
      const salud = saludGPS(c);
      const color = c.demorado ? colorEstado.advertenciaBorde : (COLOR_GPS[salud] || COLOR_GPS.sin_datos);

      const icon = {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#fff',
        strokeWeight: 2,
      };

      if (markersRef.current[c.id]) {
        markersRef.current[c.id].setPosition(pos);
        markersRef.current[c.id].setIcon(icon);
      } else {
        const marker = new window.google.maps.Marker({ position: pos, map: mapInstanceRef.current, title: c.chofer, icon });
        marker.addListener('click', () => {
          setSeleccionado(c.id);
          mapInstanceRef.current.panTo(pos);
          infoWindowRef.current.setContent(`
            <div style="font-family:sans-serif;padding:6px 8px;min-width:200px">
              <div style="font-weight:600;font-size:13px;margin-bottom:4px">🚛 ${c.chofer}</div>
              <div style="font-size:12px;color:#6B7280">${c.producto_nombre || ''} · ${c.cliente_razon_social || ''}</div>
              <div style="font-size:12px;color:#6B7280;margin-top:2px">${c.patente_tractor || ''}${c.patente_semi ? ' / ' + c.patente_semi : ''}</div>
              <div style="font-size:11px;color:#9CA3AF;margin-top:4px">${ETIQUETA_VIAJE[c.estado] || c.estado}${c.demorado ? ' · demorado' : ''}</div>
            </div>
          `);
          infoWindowRef.current.open(mapInstanceRef.current, marker);
        });
        markersRef.current[c.id] = marker;
      }
    });
  }, [choferesFiltrados]);

  function limpiarPolyline() {
    if (polylineRef.current) { polylineRef.current.setMap(null); polylineRef.current = null; }
  }

  function limpiarMarcadoresHist() {
    marcadoresHistRef.current.forEach(m => m.setMap(null));
    marcadoresHistRef.current = [];
  }

  function dibujarTraza(track) {
    limpiarPolyline();
    if (!track || track.length < 2 || !mapInstanceRef.current || !window.google) return;
    const path = track.map(p => ({ lat: p.lat, lng: p.lng }));
    polylineRef.current = new window.google.maps.Polyline({
      path, geodesic: true,
      strokeColor: marca, strokeOpacity: 0.75, strokeWeight: 3,
      map: mapInstanceRef.current,
    });
    const bounds = new window.google.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    mapInstanceRef.current.fitBounds(bounds);
  }

  function centrarEnChofer(c) {
    if (!c.ultima_lat || !c.ultima_lng || !mapInstanceRef.current) return;
    mapInstanceRef.current.panTo({ lat: c.ultima_lat, lng: c.ultima_lng });
    mapInstanceRef.current.setZoom(13);
    setSeleccionado(c.id);
    if (markersRef.current[c.id]) window.google.maps.event.trigger(markersRef.current[c.id], 'click');
  }

  async function seleccionarHistorial(h) {
    setSeleccionadoHist(h.id);

    Object.keys(markersRef.current).forEach(uid => markersRef.current[uid].setMap(null));
    limpiarMarcadoresHist();

    const snap = await getDocs(query(collection(db, 'viajes', h.id, 'gps_puntos'), orderBy('ts')));
    const track = snap.docs.map(d => d.data());

    dibujarTraza(track);

    if (window.google && mapInstanceRef.current && track.length >= 2) {
      const inicio = track[0];
      const fin = track[track.length - 1];
      marcadoresHistRef.current.push(new window.google.maps.Marker({
        position: { lat: inicio.lat, lng: inicio.lng },
        map: mapInstanceRef.current,
        title: 'Inicio',
        label: { text: 'A', color: '#fff', fontWeight: 'bold' },
        icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: colorEstado.exitoBorde, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      }));
      marcadoresHistRef.current.push(new window.google.maps.Marker({
        position: { lat: fin.lat, lng: fin.lng },
        map: mapInstanceRef.current,
        title: 'Fin',
        label: { text: 'B', color: '#fff', fontWeight: 'bold' },
        icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: marca, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      }));
    }
  }

  function volverAVivo() {
    limpiarPolyline();
    limpiarMarcadoresHist();
    setSeleccionadoHist(null);
    choferesFiltrados.forEach(c => {
      if (!c.ultima_lat || !c.ultima_lng) return;
      if (markersRef.current[c.id]) markersRef.current[c.id].setMap(mapInstanceRef.current);
    });
    mapInstanceRef.current?.setCenter(PLANTA_EXPLORA);
    mapInstanceRef.current?.setZoom(ZOOM_ARGENTINA);
  }

  function tiempoDesde(ts) {
    const d = aFecha(ts);
    if (!d) return '—';
    const diff = Date.now() - d.getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `hace ${h} h ${m} min`;
    return `hace ${m} min`;
  }

  function formatFecha(str) {
    if (!str) return '—';
    const partes = str.split('-');
    return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : str;
  }

  function formatTs(ts) {
    const d = aFecha(ts);
    if (!d) return '—';
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function getAlertas() {
    const alertas = [];
    choferesFiltrados.forEach(c => {
      if (c.demorado) {
        alertas.push({ id: c.id, chofer: c.chofer, msg: 'Viaje demorado', tipo: 'amber' });
      }
      const salud = saludGPS(c);
      if (salud === 'intermitente') {
        alertas.push({ id: c.id, chofer: c.chofer, msg: ETIQUETA_GPS.intermitente, tipo: 'amber' });
      }
      if (salud === 'sin_senal') {
        alertas.push({ id: c.id, chofer: c.chofer, msg: ETIQUETA_GPS.sin_senal, tipo: 'red' });
      }
    });
    return alertas;
  }

  const alertas = getAlertas();

  if (sinAcceso) {
    return <div style={styles.wrap}><div style={styles.bannerError}>{sinAcceso}</div></div>;
  }

  return (
    <div style={styles.wrap}>

      <div style={styles.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={styles.topbarTit}>Seguimiento</span>
          {tab === 'vivo' && (
            <span style={styles.topbarSub}>
              {choferesFiltrados.length} activo{choferesFiltrados.length !== 1 ? 's' : ''}
              {hayFiltrosActivos && vivosEnriquecidos.length !== choferesFiltrados.length ? ` de ${vivosEnriquecidos.length}` : ''}
            </span>
          )}
          {tab === 'historial' && (
            <span style={styles.topbarSub}>
              {histFiltrado.length} viaje{histFiltrado.length !== 1 ? 's' : ''}
              {hayFiltrosActivos && historialEnriquecido.length !== histFiltrado.length ? ` de ${historialEnriquecido.length}` : ''}
            </span>
          )}
        </div>
        <div style={styles.tabs}>
          <button style={{ ...styles.tabBtn, ...(tab === 'vivo' ? styles.tabBtnActive : {}) }}
            onClick={() => { setTab('vivo'); volverAVivo(); }}>🔴 En vivo</button>
          <button style={{ ...styles.tabBtn, ...(tab === 'historial' ? styles.tabBtnActive : {}) }}
            onClick={() => { setTab('historial'); limpiarPolyline(); limpiarMarcadoresHist(); setSeleccionadoHist(null); }}>📂 Historial</button>
        </div>
      </div>

      <div style={styles.layout}>
        <div style={styles.panel}>

          <div style={styles.filtrosBloque}>
            <input
              style={styles.buscador}
              value={filtroTexto}
              onChange={e => setFiltroTexto(e.target.value)}
              placeholder="Buscar chofer, cliente o patente..."
            />

            <div style={styles.filtrosFila}>
              <FiltroMulti
                etiqueta="Transportista"
                opciones={opcionesTransportistas}
                seleccion={filtroTransportistas}
                onChange={setFiltroTransportistas}
                vacio="Sin transportistas con viajes"
                styles={styles}
              />
              <FiltroMulti
                etiqueta="Chofer"
                opciones={opcionesChoferes}
                seleccion={filtroChoferes}
                onChange={setFiltroChoferes}
                vacio="Sin choferes para esta selección"
                styles={styles}
              />
            </div>

            <div style={styles.filtrosFila}>
              {RANGOS_FECHA.map(r => (
                <button key={r.id}
                  style={{ ...styles.chipFecha, ...(filtroRango === r.id ? styles.chipFechaActivo : {}) }}
                  onClick={() => setFiltroRango(r.id)}>
                  {r.label}
                </button>
              ))}
            </div>

            {hayFiltrosActivos && (
              <button style={styles.btnLimpiarFiltros} onClick={limpiarFiltros}>
                ✕ Limpiar filtros
              </button>
            )}
          </div>

          {tab === 'vivo' && (
            <>
              {alertas.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {alertas.map((a, i) => (
                    <div key={i}
                      style={{
                        ...styles.alerta,
                        background: a.tipo === 'red' ? colorEstado.peligroFondoAlterno : colorEstado.advertenciaFondoAlterno,
                        borderColor: a.tipo === 'red' ? colorEstado.peligroBordeAlterno : colorEstado.advertenciaBordeAlterno,
                      }}
                      onClick={() => { const c = choferesFiltrados.find(x => x.id === a.id); if (c) centrarEnChofer(c); }}>
                      <span>{a.tipo === 'red' ? '🔴' : '🟠'}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: tipografia.peso.medio, color: a.tipo === 'red' ? colorEstado.peligroTextoFuerte : colorEstado.advertenciaTextoFuerte }}>{a.chofer}</div>
                        <div style={{ fontSize: 11, color: a.tipo === 'red' ? colorEstado.peligroTextoFuerte : colorEstado.advertenciaTextoFuerte }}>{a.msg}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {cargando && <Vacio titulo="Cargando..." />}
              {!cargando && choferesFiltrados.length === 0 && (
                <Vacio titulo={
                  hayFiltrosActivos && vivosEnriquecidos.length > 0
                    ? 'Ningún viaje activo coincide con los filtros.'
                    : 'No hay viajes activos en este momento.'
                } />
              )}

              {choferesFiltrados.map(c => {
                const salud = saludGPS(c);
                const activo = seleccionado === c.id;
                const colorEstadoViaje = c.demorado ? colorEstado.advertenciaBorde : (COLOR_GPS[salud] || COLOR_GPS.sin_datos);
                return (
                  <Tarjeta
                    key={c.id}
                    onClick={() => { if (seleccionado === c.id) { limpiarPolyline(); setSeleccionado(null); } else { centrarEnChofer(c); } }}
                    style={{ marginBottom: espacio.sm, padding: '10px 12px', borderColor: activo ? colorEstadoViaje : undefined }}
                  >
                    <div style={styles.choferHeader}>
                      <span style={{ ...styles.dot, background: colorEstadoViaje }} />
                      <span style={styles.choferNombre}>{c.chofer}</span>
                      <Pastilla chico colores={{ bg: colorEstadoViaje + '22', color: colorEstadoViaje }}>{ETIQUETA_VIAJE[c.estado] || c.estado}</Pastilla>
                      {c.demorado && <Pastilla chico colores={{ bg: colorEstado.advertenciaFondo, color: colorEstado.advertenciaTexto }}>Demorado</Pastilla>}
                    </div>
                    {c.transporte && <div style={styles.choferTransporte}>🚚 {c.transporte}</div>}
                    <div style={styles.choferGrid}>
                      <div style={styles.cf}><span style={styles.cl}>Cliente</span><span style={styles.cv}>{c.cliente_razon_social}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Destino</span><span style={styles.cv}>{c.destino_texto}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Producto</span><span style={styles.cv}>{c.producto_nombre}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Unidad</span><span style={styles.cv}>{c.patente_tractor}{c.patente_semi ? ' / ' + c.patente_semi : ''}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Carga</span><span style={styles.cv}>{formatFecha(c.fecha_carga)}</span></div>
                      <div style={styles.cf}>
                        <span style={styles.cl}>GPS</span>
                        <span style={{ ...styles.cv, color: colorEstadoViaje }}>{c.ultima_ts ? tiempoDesde(c.ultima_ts) : ETIQUETA_GPS.sin_datos}</span>
                      </div>
                    </div>
                  </Tarjeta>
                );
              })}
            </>
          )}

          {tab === 'historial' && (
            <>
              {cargando && <Vacio titulo="Cargando..." />}
              {!cargando && histFiltrado.length === 0 && (
                <Vacio titulo={
                  hayFiltrosActivos && historialEnriquecido.length > 0
                    ? 'Ningún viaje coincide con los filtros.'
                    : 'Todavía no hay viajes finalizados.'
                } />
              )}

              {histFiltrado.map(h => {
                const activo = seleccionadoHist === h.id;
                return (
                  <Tarjeta
                    key={h.id}
                    onClick={() => seleccionarHistorial(h)}
                    style={{ marginBottom: espacio.sm, padding: '10px 12px', borderColor: activo ? marca : undefined }}
                  >
                    <div style={styles.choferHeader}>
                      <span style={{ ...styles.dot, background: marca }} />
                      <span style={styles.choferNombre}>{h.chofer}</span>
                      <Pastilla chico colores={{ bg: colorEstado.peligroFondo, color: marca }}>Finalizado</Pastilla>
                    </div>
                    {h.transporte && <div style={styles.choferTransporte}>🚚 {h.transporte}</div>}
                    <div style={styles.choferGrid}>
                      <div style={styles.cf}><span style={styles.cl}>Cliente</span><span style={styles.cv}>{h.cliente_razon_social}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Producto</span><span style={styles.cv}>{h.producto_nombre}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Fecha carga</span><span style={styles.cv}>{formatFecha(h.fecha_carga)}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Inicio</span><span style={styles.cv}>{formatTs(h.inicio_ts)}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Fin</span><span style={styles.cv}>{formatTs(h.fin_ts)}</span></div>
                      <div style={styles.cf}><span style={styles.cl}>Unidad</span><span style={styles.cv}>{h.patente_tractor}{h.patente_semi ? ' / ' + h.patente_semi : ''}</span></div>
                    </div>
                    <div style={styles.puntosGps}>📍 {h.puntos_registrados || 0} puntos GPS</div>
                  </Tarjeta>
                );
              })}
            </>
          )}
        </div>

        <div style={styles.mapaWrap}>
          <div ref={mapRef} style={styles.mapa} />
          {tab === 'vivo' && !cargando && choferesFiltrados.filter(c => c.ultima_lat).length === 0 && (
            <div style={styles.sinGps}>
              Sin posición GPS disponible todavía.<br />
              <span style={{ fontSize: 12, color: styles.cl.color }}>Los viajes aparecen en el mapa al iniciar.</span>
            </div>
          )}
          {tab === 'historial' && !seleccionadoHist && (
            <div style={styles.sinGps}>
              Seleccioná un viaje del panel para ver el recorrido.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);

  return {
    wrap: { flex: 1, minHeight: 0, fontFamily: tipografia.familia, background: colores.fondo, color: colores.texto, display: 'flex', flexDirection: 'column' },
    layout: { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' },
    panel: { width: 320, flexShrink: 0, overflowY: 'auto', padding: 12, borderRight: `0.5px solid ${colores.borde}`, background: colores.superficie },

    topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: colores.superficie, borderBottom: `0.5px solid ${colores.borde}`, position: 'sticky', top: 0, zIndex: 100 },
    topbarTit: { fontSize: 15, fontWeight: tipografia.peso.negrita, color: colores.texto },
    topbarSub: { fontSize: 12, color: pal.azul, marginLeft: 4 },
    tabs: { display: 'flex', background: colores.fondoAlterno, borderRadius: radio.md, padding: 3, gap: 2 },
    tabBtn: { padding: '5px 12px', borderRadius: radio.sm, border: 'none', background: 'transparent', color: pal.azul, fontSize: 12, fontWeight: tipografia.peso.medio, cursor: 'pointer' },
    tabBtnActive: { background: colores.superficie, color: colores.texto, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },

    filtrosBloque: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, paddingBottom: 10, borderBottom: `0.5px solid ${colores.borde}` },
    buscador: { fontSize: 13, padding: '8px 10px', borderRadius: radio.md, border: `0.5px solid ${colores.borde}`, color: colores.texto, background: colores.superficie, width: '100%', boxSizing: 'border-box', fontFamily: tipografia.familia },
    filtrosFila: { display: 'flex', gap: 6 },
    filtroWrap: { position: 'relative', flex: 1, minWidth: 0 },
    filtroBtn: { width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: '6px 9px', borderRadius: radio.md, border: `0.5px solid ${colores.borde}`, background: colores.superficie, color: pal.azul, fontSize: 12, cursor: 'pointer', boxSizing: 'border-box' },
    filtroBtnActivo: { borderColor: marca, background: colores.fondoAlterno, color: marca, fontWeight: tipografia.peso.medio },
    filtroBtnTxt: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    filtroPanel: { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 240, overflowY: 'auto', background: colores.superficieModal, border: `0.5px solid ${colores.borde}`, borderRadius: radio.md, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 200, padding: 4 },
    filtroAcciones: { display: 'flex', gap: 4, padding: '2px 4px 6px', borderBottom: `0.5px solid ${colores.borde}`, marginBottom: 4 },
    filtroAccionBtn: { flex: 1, padding: '3px 6px', borderRadius: radio.sm, border: `0.5px solid ${colores.borde}`, background: colores.superficie, color: pal.azul, fontSize: 11, cursor: 'pointer' },
    filtroOpcion: { display: 'flex', alignItems: 'center', gap: 7, padding: '5px 6px', borderRadius: radio.sm, cursor: 'pointer', fontSize: 12, color: colores.texto },
    filtroOpcionTxt: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    filtroVacio: { padding: '10px 8px', fontSize: 11, color: pal.azul, textAlign: 'center' },
    chipFecha: { flex: 1, padding: '5px 4px', borderRadius: radio.pastilla, border: `0.5px solid ${colores.borde}`, background: colores.superficie, color: pal.azul, fontSize: 11, cursor: 'pointer' },
    chipFechaActivo: { borderColor: marca, background: colores.fondoAlterno, color: marca, fontWeight: tipografia.peso.medio },
    btnLimpiarFiltros: { padding: '4px 8px', borderRadius: radio.sm, border: 'none', background: 'none', color: pal.rojo, fontSize: 11, cursor: 'pointer', textAlign: 'left' },

    alerta: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: radio.md, border: '0.5px solid', marginBottom: 6, cursor: 'pointer' },

    choferHeader: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, flexWrap: 'wrap' },
    choferTransporte: { fontSize: 11, color: pal.rojo, marginBottom: 8, marginTop: -4 },
    dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
    choferNombre: { fontSize: 13, fontWeight: tipografia.peso.negrita, color: colores.texto, flex: 1 },
    choferGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 10px', marginBottom: 4 },
    cf: { display: 'flex', flexDirection: 'column', gap: 1 },
    cl: { fontSize: 10, color: pal.azul },
    cv: { fontSize: 12, color: colores.texto, fontWeight: tipografia.peso.medio },
    puntosGps: { fontSize: 10, color: pal.azul, marginTop: 6 },

    mapaWrap: { flex: 1, position: 'relative' },
    mapa: { width: '100%', height: '100%' },
    sinGps: {
      position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center',
      fontSize: 14, color: colores.texto, lineHeight: 1.7, background: colores.superficieModal, padding: '16px 20px', borderRadius: radio.lg,
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    },

    bannerError: { padding: '10px 14px', borderRadius: 8, background: colorEstado.peligroFondo, border: `0.5px solid ${colorEstado.peligroBordeAlterno}`, fontSize: 13, color: colorEstado.peligroTexto, margin: espacio.lg, whiteSpace: 'pre-line' },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}

export default Seguimiento;
