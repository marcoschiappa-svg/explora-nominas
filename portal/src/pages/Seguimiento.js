import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';

const MAPS_KEY = 'AIzaSyClpZ7qlzK2bqO2DcuY2Ta_jcNSAGffbrw';

const ESTADO_CONFIG = {
  recibido: { color: '#378ADD', label: 'Viaje recibido' },
  iniciado: { color: '#1D9E75', label: 'En ruta' },
  demorado: { color: '#BA7517', label: 'Demorado' },
};

function calcularAngulo(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 0;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1r = lat1 * Math.PI / 180;
  const lat2r = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

// Cache para no re-generar el mismo PNG dos veces
const pngCache = {};

function getFlechaIconUrl(color, angulo, callback) {
  const key = `${color}_${Math.round(angulo)}`;
  if (pngCache[key]) {
    callback(pngCache[key]);
    return;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <g transform="rotate(${angulo} 16 16)">
      <polygon points="16,2 28,30 16,23 4,30" fill="${color}" stroke="white" stroke-width="2" stroke-linejoin="round"/>
    </g>
  </svg>`;

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const url = canvas.toDataURL('image/png');
    pngCache[key] = url;
    callback(url);
  };
  img.onerror = () => {
    // Fallback: usar el SVG directo si canvas falla
    const url = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    callback(url);
  };
  img.src = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}

function Seguimiento({ onVolver }) {
  const [choferes, setChoferes] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [cargando, setCargando] = useState(true);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const infoWindowRef = useRef(null);
  const polylineRef = useRef(null);
  const tracksRef = useRef({});

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      const activos = [];
      snap.docs.forEach(d => {
        const pedido = d.data();
        (pedido.despachos || []).forEach((despacho, i) => {
          const estado = despacho.estado_chofer || '';
          if (!['recibido', 'iniciado', 'demorado'].includes(estado)) return;
          activos.push({
            uid: pedido.id + '-D' + (i + 1),
            docId: d.id,
            despachoIdx: i,
            chofer: despacho.chofer || 'Sin nombre',
            transporte: despacho.transporte || '',
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
        });
      });
      // Guardar tracks disponibles en ref
      const newTracks = {};
      snap.docs.forEach(d => {
        const pedido = d.data();
        (pedido.despachos || []).forEach((despacho, i) => {
          const trackKey = pedido.id + '-D' + (i + 1);
          const track = pedido[`gps_track_${i}`] || [];
          if (track.length > 0) newTracks[trackKey] = track;
        });
      });
      tracksRef.current = newTracks;
      setChoferes(activos);
      setCargando(false);
    });
    return () => unsub();
  }, []);

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
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    infoWindowRef.current = new window.google.maps.InfoWindow();
  }

  useEffect(() => {
    if (!mapInstanceRef.current || !window.google) return;

    const uidsActuales = new Set(choferes.map(c => c.uid));
    Object.keys(markersRef.current).forEach(uid => {
      if (!uidsActuales.has(uid)) {
        markersRef.current[uid].setMap(null);
        delete markersRef.current[uid];
      }
    });

    choferes.forEach(c => {
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
            position: pos,
            map: mapInstanceRef.current,
            title: c.chofer,
            icon,
          });
          marker.addListener('click', () => {
            setSeleccionado(c.uid);
            mapInstanceRef.current.panTo(pos);
            infoWindowRef.current.setContent(`
              <div style="font-family:sans-serif;padding:6px 8px;min-width:200px">
                <div style="font-weight:600;font-size:13px;margin-bottom:4px">🚛 ${c.chofer}</div>
                <div style="font-size:12px;color:#6B7280">${c.producto} · ${c.cliente}</div>
                <div style="font-size:12px;color:#6B7280;margin-top:2px">${c.patente_tractor}${c.patente_semi ? ' / ' + c.patente_semi : ''}</div>
                <div style="font-size:11px;color:#9CA3AF;margin-top:4px">${cfg.label}</div>
              </div>
            `);
            infoWindowRef.current.open(mapInstanceRef.current, marker);
          });
          markersRef.current[c.uid] = marker;
        }
      });
    });
  }, [choferes]);

  function tiempoDesde(isoStr) {
    if (!isoStr) return '—';
    const diff = Date.now() - new Date(isoStr).getTime();
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

  function limpiarPolyline() {
    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }
  }

  function dibujarTraza(uid) {
    limpiarPolyline();
    const track = tracksRef.current[uid] || [];
    if (track.length < 2 || !mapInstanceRef.current || !window.google) return;
    const path = track.map(p => ({ lat: p.lat, lng: p.lng }));
    polylineRef.current = new window.google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: '#C8102E',
      strokeOpacity: 0.7,
      strokeWeight: 3,
      map: mapInstanceRef.current,
    });
  }

  function centrarEnChofer(c) {
    if (!c.gps_lat || !c.gps_lng || !mapInstanceRef.current) return;
    mapInstanceRef.current.panTo({ lat: c.gps_lat, lng: c.gps_lng });
    mapInstanceRef.current.setZoom(13);
    setSeleccionado(c.uid);
    dibujarTraza(c.uid);
    if (markersRef.current[c.uid]) {
      window.google.maps.event.trigger(markersRef.current[c.uid], 'click');
    }
  }

  function getAlertas() {
    const alertas = [];
    choferes.forEach(c => {
      if (c.estado_chofer === 'demorado') {
        alertas.push({ uid: c.uid, chofer: c.chofer, msg: 'Viaje demorado', tipo: 'red' });
      }
      if (c.gps_ts) {
        const min = Math.floor((Date.now() - new Date(c.gps_ts).getTime()) / 60000);
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

  return (
    <div style={s.wrap}>
      <div style={s.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.png" alt="Explora" style={{ height: 28, objectFit: 'contain' }} />
          <span style={s.topbarTit}>Seguimiento</span>
          <span style={s.topbarSub}>{choferes.length} activo{choferes.length !== 1 ? 's' : ''}</span>
        </div>
        <button style={s.btnVolver} onClick={onVolver}>← Inicio</button>
      </div>

      <div style={s.layout}>
        <div style={s.panel}>
          {alertas.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {alertas.map((a, i) => (
                <div key={i}
                  style={{ ...s.alerta, background: a.tipo === 'red' ? '#FCEBEB' : '#FAEEDA', borderColor: a.tipo === 'red' ? '#F09595' : '#EF9F27' }}
                  onClick={() => { const c = choferes.find(x => x.uid === a.uid); if (c) centrarEnChofer(c); }}>
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
          {!cargando && choferes.length === 0 && (
            <div style={s.empty}>No hay choferes activos en este momento.</div>
          )}

          {choferes.map(c => {
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
                <div style={s.choferGrid}>
                  <div style={s.cf}><span style={s.cl}>Producto</span><span style={s.cv}>{c.producto}</span></div>
                  <div style={s.cf}><span style={s.cl}>Cliente</span><span style={s.cv}>{c.cliente}</span></div>
                  <div style={s.cf}><span style={s.cl}>Destino</span><span style={s.cv}>{c.lugar}</span></div>
                  <div style={s.cf}><span style={s.cl}>Unidad</span><span style={s.cv}>{c.patente_tractor}{c.patente_semi ? ' / ' + c.patente_semi : ''}</span></div>
                  <div style={s.cf}><span style={s.cl}>Carga</span><span style={s.cv}>{formatFecha(c.fecha_carga)}</span></div>
                  <div style={s.cf}>
                    <span style={s.cl}>GPS</span>
                    <span style={{ ...s.cv, color: c.gps_ts ? '#0F6E56' : '#9CA3AF' }}>
                      {c.gps_ts ? tiempoDesde(c.gps_ts) : 'Sin señal'}
                    </span>
                  </div>
                </div>
                {c.tel_unidad && (
                  <a href={`tel:${c.tel_unidad}`} style={s.btnLlamar}>📞 {c.tel_unidad}</a>
                )}
              </div>
            );
          })}
        </div>

        <div style={s.mapaWrap}>
          <div ref={mapRef} style={s.mapa} />
          {!cargando && choferes.filter(c => c.gps_lat).length === 0 && (
            <div style={s.sinGps}>
              Sin posición GPS disponible todavía.<br />
              <span style={{ fontSize: 12, color: '#9CA3AF' }}>Los choferes aparecen en el mapa al iniciar el viaje.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const s = {
  wrap: { minHeight: '100vh', fontFamily: "'DM Sans', system-ui, sans-serif", background: '#F8F8F8', display: 'flex', flexDirection: 'column' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#fff', borderBottom: '0.5px solid #E5E7EB', position: 'sticky', top: 0, zIndex: 100 },
  topbarTit: { fontSize: 15, fontWeight: 600, color: '#111827' },
  topbarSub: { fontSize: 12, color: '#9CA3AF', marginLeft: 4 },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  layout: { display: 'flex', flex: 1, overflow: 'hidden', height: 'calc(100vh - 49px)' },
  panel: { width: 320, flexShrink: 0, overflowY: 'auto', padding: '12px', borderRight: '0.5px solid #E5E7EB', background: '#fff' },
  alerta: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8, border: '0.5px solid', marginBottom: 6, cursor: 'pointer' },
  empty: { textAlign: 'center', padding: '2rem 1rem', color: '#9CA3AF', fontSize: 13 },
  choferCard: { border: '0.5px solid', borderRadius: 12, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', transition: 'border-color 0.15s' },
  choferHeader: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 },
  dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  choferNombre: { fontSize: 13, fontWeight: 600, color: '#111827', flex: 1 },
  choferGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 10px', marginBottom: 8 },
  cf: { display: 'flex', flexDirection: 'column', gap: 1 },
  cl: { fontSize: 10, color: '#9CA3AF' },
  cv: { fontSize: 12, color: '#111827', fontWeight: 500 },
  btnLlamar: { display: 'block', fontSize: 12, color: '#0C447C', textDecoration: 'none', padding: '5px 0', borderTop: '0.5px solid #F3F4F6', marginTop: 4 },
  mapaWrap: { flex: 1, position: 'relative' },
  mapa: { width: '100%', height: '100%' },
  sinGps: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', fontSize: 14, color: '#6B7280', lineHeight: 1.7, background: 'rgba(255,255,255,0.9)', padding: '16px 20px', borderRadius: 12 },
};

export default Seguimiento;
