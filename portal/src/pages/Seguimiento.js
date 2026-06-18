import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot } from 'firebase/firestore';

const MAPS_KEY = 'AIzaSyClpZ7qlzK2bqO2DcuY2Ta_jcNSAGffbrw';

function Seguimiento({ usuario, onVolver }) {
  const [choferes, setChoferes] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [cargando, setCargando] = useState(true);
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const infoWindowRef = useRef(null);

  const ESTADO_CONFIG = {
    recibido:  { color: '#378ADD', label: 'Viaje recibido', emoji: '🔵' },
    iniciado:  { color: '#1D9E75', label: 'En ruta',        emoji: '🟢' },
    demorado:  { color: '#BA7517', label: 'Demorado',       emoji: '🟠' },
  };

  // ── Cargar datos desde Firestore ─────────────────────────────────────────
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
            dni_chofer: despacho.dni_chofer || '',
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
            gps_ts: despacho.gps_ts || null,
            fecha_carga: despacho.fecha_carga || '',
          });
        });
      });
      setChoferes(activos);
      setCargando(false);
    });
    return () => unsub();
  }, []);

  // ── Cargar Google Maps script ─────────────────────────────────────────────
  useEffect(() => {
    if (window.google) { initMap(); return; }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`;
    script.async = true;
    script.onload = initMap;
    document.head.appendChild(script);
  }, []);

  function initMap() {
    if (!mapRef.current || mapInstanceRef.current) return;
    mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: -32.7, lng: -60.5 }, // Centro Argentina
      zoom: 6,
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ],
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    infoWindowRef.current = new window.google.maps.InfoWindow();
  }

  // ── Actualizar markers cuando cambian los choferes ───────────────────────
  useEffect(() => {
    if (!mapInstanceRef.current || !window.google) return;

    const uidsActuales = new Set(choferes.map(c => c.uid));

    // Eliminar markers de choferes que ya no están
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

      if (markersRef.current[c.uid]) {
        markersRef.current[c.uid].setPosition(pos);
      } else {
        const marker = new window.google.maps.Marker({
          position: pos,
          map: mapInstanceRef.current,
          title: c.chofer,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: cfg.color,
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
          },
        });
        marker.addListener('click', () => {
          setSeleccionado(c.uid);
          infoWindowRef.current.setContent(`
            <div style="font-family:sans-serif;padding:4px 6px;min-width:180px">
              <div style="font-weight:600;font-size:13px;margin-bottom:4px">${c.chofer}</div>
              <div style="font-size:12px;color:#6B7280">${c.producto} · ${c.cliente}</div>
              <div style="font-size:11px;color:#9CA3AF;margin-top:2px">${cfg.label}</div>
            </div>
          `);
          infoWindowRef.current.open(mapInstanceRef.current, marker);
        });
        markersRef.current[c.uid] = marker;
      }
    });
  }, [choferes]);

  // ── helpers ───────────────────────────────────────────────────────────────
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
    const [y, m, d] = str.split('-');
    return d ? `${d}/${m}/${y}` : str;
  }

  function centrarEnChofer(c) {
    if (!c.gps_lat || !c.gps_lng || !mapInstanceRef.current) return;
    mapInstanceRef.current.panTo({ lat: c.gps_lat, lng: c.gps_lng });
    mapInstanceRef.current.setZoom(12);
    setSeleccionado(c.uid);
    if (markersRef.current[c.uid]) {
      window.google.maps.event.trigger(markersRef.current[c.uid], 'click');
    }
  }

  const choferSeleccionado = choferes.find(c => c.uid === seleccionado);

  // ── alertas automáticas ───────────────────────────────────────────────────
  function getAlertas() {
    const alertas = [];
    choferes.forEach(c => {
      if (!c.gps_ts) return;
      const minSinSenal = Math.floor((Date.now() - new Date(c.gps_ts).getTime()) / 60000);
      if (c.estado_chofer === 'iniciado' && minSinSenal > 30) {
        alertas.push({ uid: c.uid, chofer: c.chofer, msg: `Sin movimiento hace ${minSinSenal} min`, tipo: 'amber' });
      }
      if (minSinSenal > 60) {
        alertas.push({ uid: c.uid, chofer: c.chofer, msg: `Sin señal GPS hace ${minSinSenal} min`, tipo: 'red' });
      }
    });
    choferes.filter(c => c.estado_chofer === 'demorado').forEach(c => {
      alertas.push({ uid: c.uid, chofer: c.chofer, msg: 'Viaje demorado', tipo: 'red' });
    });
    return alertas;
  }

  const alertas = getAlertas();

  return (
    <div style={s.wrap}>

      {/* Topbar */}
      <div style={s.topbar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.png" alt="Explora" style={{ height: 28, objectFit: 'contain' }} />
          <span style={s.topbarTit}>Seguimiento</span>
          <span style={s.topbarSub}>{choferes.length} activo{choferes.length !== 1 ? 's' : ''}</span>
        </div>
        <button style={s.btnVolver} onClick={onVolver}>← Inicio</button>
      </div>

      <div style={s.layout}>

        {/* Panel izquierdo */}
        <div style={s.panel}>

          {/* Alertas */}
          {alertas.length > 0 && (
            <div style={s.alertasWrap}>
              {alertas.map((a, i) => (
                <div key={i} style={{ ...s.alerta, background: a.tipo === 'red' ? '#FCEBEB' : '#FAEEDA', borderColor: a.tipo === 'red' ? '#F09595' : '#EF9F27' }}
                  onClick={() => { const c = choferes.find(x => x.uid === a.uid); if (c) centrarEnChofer(c); }}>
                  <span style={{ fontSize: 13 }}>{a.tipo === 'red' ? '🔴' : '🟠'}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: a.tipo === 'red' ? '#A32D2D' : '#633806' }}>{a.chofer}</div>
                    <div style={{ fontSize: 11, color: a.tipo === 'red' ? '#A32D2D' : '#633806' }}>{a.msg}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Lista choferes */}
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
                onClick={() => centrarEnChofer(c)}>
                <div style={s.choferHeader}>
                  <span style={{ ...s.dot, background: cfg.color }} />
                  <span style={s.choferNombre}>{c.chofer}</span>
                  <span style={{ ...s.estadoBadge, background: cfg.color + '22', color: cfg.color }}>{cfg.label}</span>
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

        {/* Mapa */}
        <div style={s.mapaWrap}>
          <div ref={mapRef} style={s.mapa} />
          {!cargando && choferes.filter(c => c.gps_lat).length === 0 && (
            <div style={s.sinGps}>
              Sin posición GPS disponible todavía.<br />
              <span style={{ fontSize: 12, color: '#9CA3AF' }}>Los choferes deben iniciar el viaje para aparecer en el mapa.</span>
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
  alertasWrap: { marginBottom: 10 },
  alerta: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 8, border: '0.5px solid', marginBottom: 6, cursor: 'pointer' },
  empty: { textAlign: 'center', padding: '2rem 1rem', color: '#9CA3AF', fontSize: 13 },
  choferCard: { border: '0.5px solid', borderRadius: 12, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', transition: 'border-color 0.15s' },
  choferHeader: { display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 },
  dot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  choferNombre: { fontSize: 13, fontWeight: 600, color: '#111827', flex: 1 },
  estadoBadge: { fontSize: 10, fontWeight: 500, padding: '2px 7px', borderRadius: 20 },
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
