import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';

const MAPS_KEY = 'AIzaSyClpZ7qlzK2bqO2DcuY2Ta_jcNSAGffbrw';

const ESTADO_GPS = {
  recibido: { color: '#378ADD', label: 'Viaje recibido' },
  iniciado: { color: '#1D9E75', label: 'En ruta' },
  demorado: { color: '#BA7517', label: 'Demorado' },
};

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXOlu0PUTAVubDJCXh7WxjZp1ruCH5SMu9YmWbFCNF2ff7l5mn447nV8BIWbQ5-Mz-uQ/exec';

async function subirArchivo(file, pedidoId, subidoPor) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const base64 = e.target.result.split(',')[1];
        const payload = { accion: 'subir_adjunto', nombre: file.name, tipo_mime: file.type || 'application/octet-stream', base64, pedido_id: pedidoId, subido_por: subidoPor };
        const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) });
        const data = await response.json();
        if (data.status === 'ok') resolve(data.data);
        else reject(new Error(data.mensaje || 'Error subiendo archivo'));
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Error leyendo archivo'));
    reader.readAsDataURL(file);
  });
}

function sinTransportista(tipo) {
  return tipo === 'Retiro del cliente';
}

function Coordinador({ usuario, onVolver }) {
  const [pedidos, setPedidos] = useState([]);
  const [transportistas, setTransportistas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState('todos');
  const [expandido, setExpandido] = useState(null);
  const [aceptando, setAceptando] = useState({});
  const [asignando, setAsignando] = useState({});
  const [reprogramando, setReprogramando] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [subiendoArchivos, setSubiendoArchivos] = useState(false);
  const [archivosNuevos, setArchivosNuevos] = useState({});
  const [tabActivo, setTabActivo] = useState('despachos');
  const [choferes, setChoferes] = useState([]);
  const [choferSel, setChoferSel] = useState(null);
  const fileRefs = useRef({});
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const infoWindowRef = useRef(null);

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

  // Choferes activos para el mapa
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
            chofer: despacho.chofer || 'Sin nombre',
            transporte: despacho.transporte || '',
            producto: pedido.producto,
            cliente: pedido.cliente,
            lugar: pedido.lugar,
            patente_tractor: despacho.patente_tractor || '',
            tel_unidad: despacho.tel_unidad || '',
            estado_chofer: estado,
            gps_lat: despacho.gps_lat || null,
            gps_lng: despacho.gps_lng || null,
            gps_ts: despacho.gps_ts || null,
          });
        });
      });
      setChoferes(activos);
    });
    return () => unsub();
  }, []);

  // Inicializar Google Maps cuando se activa el tab
  useEffect(() => {
    if (tabActivo !== 'seguimiento') return;
    const initMap = () => {
      if (!mapRef.current || mapInstanceRef.current) return;
      mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
        center: { lat: -32.7, lng: -60.5 },
        zoom: 6,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      infoWindowRef.current = new window.google.maps.InfoWindow();
    };
    if (window.google) { setTimeout(initMap, 100); return; }
    if (document.querySelector(`script[src*="maps.googleapis.com"]`)) {
      const interval = setInterval(() => { if (window.google) { clearInterval(interval); setTimeout(initMap, 100); } }, 200);
      return () => clearInterval(interval);
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`;
    script.async = true;
    script.onload = () => setTimeout(initMap, 100);
    document.head.appendChild(script);
  }, [tabActivo]);

  // Actualizar markers
  useEffect(() => {
    if (tabActivo !== 'seguimiento' || !mapInstanceRef.current || !window.google) return;
    const uidsActuales = new Set(choferes.map(c => c.uid));
    Object.keys(markersRef.current).forEach(uid => {
      if (!uidsActuales.has(uid)) { markersRef.current[uid].setMap(null); delete markersRef.current[uid]; }
    });
    choferes.forEach(c => {
      if (!c.gps_lat || !c.gps_lng) return;
      const pos = { lat: c.gps_lat, lng: c.gps_lng };
      const cfg = ESTADO_GPS[c.estado_chofer] || ESTADO_GPS.iniciado;
      if (markersRef.current[c.uid]) {
        markersRef.current[c.uid].setPosition(pos);
      } else {
        const marker = new window.google.maps.Marker({
          position: pos, map: mapInstanceRef.current, title: c.chofer,
          icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: cfg.color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
        });
        marker.addListener('click', () => {
          setChoferSel(c.uid);
          infoWindowRef.current.setContent(`<div style="font-family:sans-serif;padding:4px 6px;min-width:160px"><div style="font-weight:600;font-size:13px;margin-bottom:3px">${c.chofer}</div><div style="font-size:12px;color:#6B7280">${c.producto} · ${c.cliente}</div><div style="font-size:11px;color:#9CA3AF;margin-top:2px">${cfg.label}</div></div>`);
          infoWindowRef.current.open(mapInstanceRef.current, marker);
        });
        markersRef.current[c.uid] = marker;
      }
    });
  }, [choferes, tabActivo]);

  function volAsignado(p) { return (p.despachos || []).reduce((s, d) => s + Number(d.volumen), 0); }
  function saldo(p) { return Number(p.volumen) - volAsignado(p); }
  function pct(p) { return Math.min(100, Math.round(volAsignado(p) / Number(p.volumen) * 100)); }
  function tieneNominacionPendiente(p) { return (p.despachos || []).some(d => d.estado === 'Aceptado-pendiente' || (d.estado === 'Aceptado' && d.nominacion_pendiente)); }
  function tieneDespachoEnEspera(p) { return (p.despachos || []).some(d => d.estado === 'En espera'); }
  function proximaCarga(p) { const fechas = (p.despachos || []).filter(d => d.fecha_carga && d.estado !== 'En espera').map(d => d.fecha_carga).sort(); return fechas[0] || null; }

  function seleccionarTransportista(key, pedidoId, docId) {
    const t = transportistas.find(x => x.docId === docId);
    if (!t) { setAsignando(prev => ({ ...prev, [key]: { ...prev[key], transporte_id: '', transporte: '', email_transportista: '', emails_extra: [], telefonos: [] } })); return; }
    const emails = [t.email_1, t.email_2, t.email_3].filter(Boolean);
    const telefonos = [
      t.prefijo_1 && t.numero_1 ? `(${t.prefijo_1}) ${t.numero_1}` : null,
      t.prefijo_2 && t.numero_2 ? `(${t.prefijo_2}) ${t.numero_2}` : null,
      t.prefijo_3 && t.numero_3 ? `(${t.prefijo_3}) ${t.numero_3}` : null,
    ].filter(Boolean);
    setAsignando(prev => ({ ...prev, [key]: { ...prev[key], transporte_id: t.docId, transporte: t.empresa || t.nombre, email_transportista: emails[0] || '', emails_extra: emails.slice(1), telefonos, cuit_transporte: t.cuit_empresa || '' } }));
  }

  function handleArchivosNuevos(pedidoId, files) {
    setArchivosNuevos(prev => ({ ...prev, [pedidoId]: [...(prev[pedidoId] || []), ...Array.from(files)] }));
  }
  function quitarArchivoNuevo(pedidoId, nombre) {
    setArchivosNuevos(prev => ({ ...prev, [pedidoId]: (prev[pedidoId] || []).filter(f => f.name !== nombre) }));
  }

  async function toggleVisibleTransportista(p, fileId, valorActual) {
    const adjuntosActualizados = (p.adjuntos || []).map(a => a.file_id === fileId ? { ...a, visible_transportista: !valorActual } : a);
    await updateDoc(doc(db, 'pedidos_portal', p.docId), { adjuntos: adjuntosActualizados });
  }

  async function aceptarDespacho(pedidoId) {
    const ac = aceptando[pedidoId] || {};
    if (!ac.volumen || !ac.fecha_carga) { alert('Completá volumen y fecha de carga.'); return; }
    const p = pedidos.find(x => x.id === pedidoId);
    if (Number(ac.volumen) > saldo(p)) { alert(`El volumen (${ac.volumen} tn) supera el saldo disponible (${saldo(p)} tn).`); return; }
    const fechaCarga = new Date(ac.fecha_carga + 'T00:00:00');
    const fechaEntrega = new Date(p.fecha_entrega + 'T00:00:00');
    if (fechaCarga > fechaEntrega) { alert('La fecha de carga no puede ser posterior a la fecha de entrega (' + p.fecha_entrega + ').'); return; }

    const esSinTransportista = sinTransportista(p.tipo);
    setEnviando(true);
    try {
      let adjuntosActualizados = [...(p.adjuntos || [])];
      const archivosCoord = archivosNuevos[pedidoId] || [];
      if (archivosCoord.length > 0) {
        setSubiendoArchivos(true);
        for (const file of archivosCoord) {
          try { adjuntosActualizados.push(await subirArchivo(file, p.id, usuario?.nombre || 'Coordinador')); }
          catch (err) { console.error('Error subiendo ' + file.name + ':', err); }
        }
        setSubiendoArchivos(false);
        setArchivosNuevos(prev => ({ ...prev, [pedidoId]: [] }));
      }

      const now = new Date().toLocaleString('es-AR');
      const estadoDespacho = esSinTransportista ? 'Programado' : 'Aceptado-pendiente';

      const despacho = {
        id: 'D' + ((p.despachos || []).length + 1),
        volumen: Number(ac.volumen),
        fecha_carga: ac.fecha_carga,
        horario_carga: ac.horario_carga || '',
        estado: estadoDespacho,
        aceptado_por: usuario?.nombre || 'Coordinador',
        aceptado_en: now,
        transporte: esSinTransportista ? '—' : '',
        transporte_id: '', email_transportista: '',
        emails_extra: [], telefonos: [], cuit_transporte: '',
      };

      const nuevosDespachos = [...(p.despachos || []), despacho];
      const volDespachado = nuevosDespachos.reduce((s, d) => s + Number(d.volumen), 0);
      const hayPendiente = nuevosDespachos.some(d => d.estado === 'Aceptado-pendiente');
      const nuevoEstado = hayPendiente ? 'prog-parcial' : volDespachado >= Number(p.volumen) ? 'Programado' : 'prog-parcial';

      await updateDoc(doc(db, 'pedidos_portal', p.docId), {
        despachos: nuevosDespachos,
        estado: nuevoEstado,
        adjuntos: adjuntosActualizados,
        volumen_despachado: volDespachado,
      });

      const payload = {
        accion: 'programar_despacho',
        pedido_id: p.id,
        programado_por: usuario?.nombre || 'Coordinador',
        fecha_carga: ac.fecha_carga,
        horario_carga: ac.horario_carga || '',
        transporte: esSinTransportista ? '—' : 'Pendiente de asignación',
        email_transportista: '',
        tipo: p.tipo, producto: p.producto,
        volumen: Number(ac.volumen),
        cliente: p.cliente, ov: p.ov,
        lugar: p.lugar, banda_horaria: p.banda_horaria || '',
        fecha_entrega: p.fecha_entrega, obs: p.obs || '',
      };
      await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString(), { mode: 'no-cors' });
      setAceptando(prev => { const n = {...prev}; delete n[pedidoId]; return n; });
      alert(esSinTransportista ? '✓ Despacho aceptado y escrito en el plan.' : '✓ Despacho aceptado y escrito en el plan. Asigná el transportista cuando esté disponible.');
    } catch (err) {
      console.error(err);
      alert('Error: ' + err.message);
    } finally { setEnviando(false); setSubiendoArchivos(false); }
  }

  async function asignarTransportista(p, despachoIdx) {
    const key = p.id + '-' + despachoIdx;
    const as = asignando[key] || {};
    if (!as.transporte) { alert('Seleccioná un transportista.'); return; }
    setEnviando(true);
    try {
      const now = new Date().toLocaleString('es-AR');
      const nuevosDespachos = [...p.despachos];
      const d = nuevosDespachos[despachoIdx];
      nuevosDespachos[despachoIdx] = {
        ...d,
        estado: 'Programado',
        transporte: as.transporte,
        transporte_id: as.transporte_id || '',
        email_transportista: as.email_transportista || '',
        emails_extra: as.emails_extra || [],
        telefonos: as.telefonos || [],
        cuit_transporte: as.cuit_transporte || '',
        asignado_por: usuario?.nombre || 'Coordinador',
        asignado_en: now,
      };
      const hayPendiente = nuevosDespachos.some(dd => dd.estado === 'Aceptado-pendiente');
      const nuevoEstadoPedido = hayPendiente ? 'prog-parcial' : 'Programado';
      await updateDoc(doc(db, 'pedidos_portal', p.docId), { despachos: nuevosDespachos, estado: nuevoEstadoPedido });
      const todosEmails = [as.email_transportista, ...(as.emails_extra || [])].filter(Boolean).join(',');
      const payload = {
        accion: 'asignar_transportista',
        pedido_id: p.id,
        asignado_por: usuario?.nombre || 'Coordinador',
        fecha_carga: d.fecha_carga,
        horario_carga: d.horario_carga || '',
        transporte: as.transporte,
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

  async function reprogramarDespacho(p, despachoIdx) {
    const key = p.id + '-' + despachoIdx;
    const rd = reprogramando[key] || {};
    if (!rd.fecha_carga) { alert('Ingresá la nueva fecha de carga.'); return; }
    if (new Date(rd.fecha_carga + 'T00:00:00') > new Date(p.fecha_entrega + 'T00:00:00')) { alert('La fecha de carga no puede ser posterior a la fecha de entrega (' + p.fecha_entrega + ').'); return; }
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

  async function suspender(p) {
    const motivo = prompt('Motivo de la suspensión (requerido):');
    if (!motivo) return;
    const despachosAnteriores = p.despachos || [];
    await updateDoc(doc(db, 'pedidos_portal', p.docId), { estado: 'Suspendido' });
    const payload = { accion: 'suspender_pedido', id: p.id, motivo, suspendido_por: usuario?.nombre || '', estado_anterior: p.estado, tenia_programacion: despachosAnteriores.length > 0, producto: p.producto, volumen: p.volumen, cliente: p.cliente, ov: p.ov, fecha_entrega: p.fecha_entrega, lugar: p.lugar, email_transportista: despachosAnteriores[0]?.email_transportista || '', transporte: despachosAnteriores[0]?.transporte || '' };
    await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString(), { mode: 'no-cors' });
    alert('Pedido suspendido. Se notificó a los involucrados.');
  }

  const pillColors = { 'Pendiente': { bg: '#EEEDFE', color: '#3C3489' }, 'prog-parcial': { bg: '#FAEEDA', color: '#633806' }, 'Programado': { bg: '#E1F5EE', color: '#085041' }, 'Aceptado': { bg: '#D1FAE5', color: '#065F46' }, 'Nominado': { bg: '#EEEDFE', color: '#3C3489' }, 'Suspendido': { bg: '#FCEBEB', color: '#791F1F' } };
  const pillLabel = { 'Pendiente': 'Pendiente', 'prog-parcial': 'Prog. parcial', 'Programado': 'Programado', 'Aceptado': 'Aceptado', 'Nominado': 'Nominado', 'Suspendido': 'Suspendido' };
  const despachoColors = { 'Programado': { bg: '#FAEEDA', color: '#633806' }, 'Aceptado-pendiente': { bg: '#FEF3C7', color: '#92400E' }, 'Aceptado': { bg: '#E1F5EE', color: '#085041' }, 'Nominado': { bg: '#EEEDFE', color: '#3C3489' }, 'En espera': { bg: '#F3F4F6', color: '#6B7280' }, 'Rechazado': { bg: '#FCEBEB', color: '#791F1F' } };
  const despachoLabel = { 'Programado': 'Programado', 'Aceptado-pendiente': '⏳ Pendiente transporte', 'Aceptado': 'Aceptado', 'Nominado': 'Nominado', 'En espera': 'En espera', 'Rechazado': 'Rechazado' };
  const filtrados = pedidos.filter(p => {
    if (filtro === 'todos') return ['Pendiente', 'prog-parcial', 'Programado'].includes(p.estado) || tieneNominacionPendiente(p);
    return p.estado === filtro;
  });

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <div style={styles.logoArea}>
          <img src="/logo.png" alt="Explora" style={{ height: 32, objectFit: 'contain' }} />
          <span style={styles.portalText}>Programación</span>
        </div>
        <button style={styles.btnVolver} onClick={onVolver}>← Inicio</button>
      </div>

      {/* Tabs */}
      <div style={stylesTab.tabRow}>
        <button style={{ ...stylesTab.tab, ...(tabActivo === 'despachos' ? stylesTab.tabActive : {}) }} onClick={() => setTabActivo('despachos')}>
          📋 Despachos
        </button>
        <button style={{ ...stylesTab.tab, ...(tabActivo === 'seguimiento' ? stylesTab.tabActive : {}) }} onClick={() => setTabActivo('seguimiento')}>
          📡 Seguimiento {choferes.length > 0 && <span style={stylesTab.badge}>{choferes.length}</span>}
        </button>
      </div>

      {/* Tab Seguimiento */}
      {tabActivo === 'seguimiento' && (
        <div style={stylesTab.seguimientoWrap}>
          <div style={stylesTab.panel}>
            {choferes.length === 0 && <div style={styles.empty}>No hay choferes activos en este momento.</div>}
            {choferes.map(c => {
              const cfg = ESTADO_GPS[c.estado_chofer] || ESTADO_GPS.iniciado;
              return (
                <div key={c.uid}
                  style={{ ...stylesTab.choferCard, borderColor: choferSel === c.uid ? cfg.color : '#E5E7EB' }}
                  onClick={() => {
                    setChoferSel(c.uid);
                    if (c.gps_lat && c.gps_lng && mapInstanceRef.current) {
                      mapInstanceRef.current.panTo({ lat: c.gps_lat, lng: c.gps_lng });
                      mapInstanceRef.current.setZoom(12);
                    }
                  }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, flexShrink: 0, display: 'inline-block' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', flex: 1 }}>{c.chofer}</span>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: cfg.color + '22', color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px' }}>
                    <div><div style={{ fontSize: 10, color: '#9CA3AF' }}>Producto</div><div style={{ fontSize: 12, fontWeight: 500 }}>{c.producto}</div></div>
                    <div><div style={{ fontSize: 10, color: '#9CA3AF' }}>Cliente</div><div style={{ fontSize: 12, fontWeight: 500 }}>{c.cliente}</div></div>
                    <div><div style={{ fontSize: 10, color: '#9CA3AF' }}>Destino</div><div style={{ fontSize: 12, fontWeight: 500 }}>{c.lugar}</div></div>
                    <div><div style={{ fontSize: 10, color: '#9CA3AF' }}>GPS</div><div style={{ fontSize: 12, fontWeight: 500, color: c.gps_ts ? '#0F6E56' : '#9CA3AF' }}>{c.gps_ts ? 'Activo' : 'Sin señal'}</div></div>
                  </div>
                  {c.tel_unidad && <a href={`tel:${c.tel_unidad}`} style={{ display: 'block', fontSize: 12, color: '#0C447C', marginTop: 6, textDecoration: 'none' }}>📞 {c.tel_unidad}</a>}
                </div>
              );
            })}
          </div>
          <div style={stylesTab.mapaWrap}>
            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
            {choferes.filter(c => c.gps_lat).length === 0 && (
              <div style={stylesTab.sinGps}>Sin posición GPS disponible.<br /><span style={{ fontSize: 12, color: '#9CA3AF' }}>Los choferes aparecen al iniciar el viaje.</span></div>
            )}
          </div>
        </div>
      )}

      {/* Tab Despachos */}
      {tabActivo === 'despachos' && (<>

      <div style={styles.metrics}>
        {[['Pendientes','#534AB7','Pendiente'],['Prog. parcial','#BA7517','prog-parcial'],['Programados','#0F6E56','Programado'],['Aceptados','#065F46','Aceptado'],['Nominados','#3C3489','Nominado'],['Suspendidos','#A32D2D','Suspendido']].map(([label, color, estado]) => (
          <div key={estado} style={styles.metric}>
            <div style={styles.metricLabel}>{label}</div>
            <div style={{ ...styles.metricValue, color }}>{pedidos.filter(p => p.estado === estado).length}</div>
          </div>
        ))}
      </div>

      <div style={styles.filtros}>
        {['todos','Pendiente','prog-parcial','Programado','Aceptado','Nominado','Suspendido'].map(f => (
          <button key={f} style={{ ...styles.filtroBtnBase, ...(filtro === f ? styles.filtroBtnActive : {}) }} onClick={() => setFiltro(f)}>
            {f === 'todos' ? 'Todos' : pillLabel[f] || f}
          </button>
        ))}
      </div>

      {cargando && <div style={styles.empty}>Cargando pedidos...</div>}
      {!cargando && filtrados.length === 0 && <div style={styles.empty}>Sin pedidos para mostrar.</div>}

      {!cargando && filtrados.map(p => (
        <div key={p.id} style={styles.card}>
          <div style={styles.cardHeader} onClick={() => setExpandido(expandido === p.id ? null : p.id)}>
            <span style={{ ...styles.pill, background: pillColors[p.estado]?.bg, color: pillColors[p.estado]?.color }}>{pillLabel[p.estado] || p.estado}</span>
            {p.editado && <span style={styles.badgeEditado}>Editado</span>}
            {tieneNominacionPendiente(p) && <span style={styles.badgeNomPendiente}>⏳ Pend. transporte</span>}
            {tieneDespachoEnEspera(p) && <span style={styles.badgeEspera}>⏸ En espera</span>}
            <span style={styles.cardNro}>{p.ov || p.id}</span>
            <span style={styles.cardResumen}>{p.cliente} · {p.producto} {p.volumen} tn</span>
            {proximaCarga(p) && <span style={styles.cardFechaCarga}>📦 {proximaCarga(p)}</span>}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9CA3AF', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {p.editado_en ? new Date(p.editado_en).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : p.creado_en || ''}
            </span>
            <span style={styles.cardFecha}>Creado {p.creado_en}</span>
            <span style={styles.chevron}>{expandido === p.id ? '▲' : '▼'}</span>
          </div>

          {expandido === p.id && (
            <div style={styles.cardBody}>
              <div style={styles.origen}>
                Pedido creado por <strong>{p.creado_por}</strong> · {p.creado_en}
                {p.editado && <span> · Editado por <strong>{p.editado_por}</strong> · {p.editado_en}</span>}
              </div>
              <div style={styles.detailGrid}>
                <div style={styles.field}><span style={styles.label}>Tipo</span><span>{p.tipo}</span></div>
                <div style={styles.field}><span style={styles.label}>Producto</span><span>{p.producto}</span></div>
                <div style={styles.field}><span style={styles.label}>Volumen total</span><span>{p.volumen} tn</span></div>
                <div style={styles.field}><span style={styles.label}>Recipiente</span><span>{p.recipiente}</span></div>
                <div style={styles.field}><span style={styles.label}>Cliente / Proveedor</span><span>{p.cliente}</span></div>
                <div style={styles.field}><span style={styles.label}>OV / OC</span><span>{p.ov}</span></div>
                <div style={styles.field}><span style={styles.label}>Teléfono</span><span>{p.telefono || '—'}</span></div>
                <div style={styles.field}><span style={styles.label}>Entrega comprometida</span><span>{p.fecha_entrega}</span></div>
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

              <div style={styles.volBar}>
                <div style={styles.volBarLabels}>
                  <span>Asignado: <strong>{volAsignado(p)} tn</strong> de {p.volumen} tn</span>
                  <span>{pct(p)}%</span>
                </div>
                <div style={styles.barTrack}>
                  <div style={{ ...styles.barFill, width: `${pct(p)}%`, background: pct(p) < 100 ? '#EF9F27' : '#0F6E56' }} />
                </div>
                <div style={{ fontSize: 11, color: saldo(p) === 0 ? '#0F6E56' : '#BA7517', marginTop: 4 }}>
                  {saldo(p) === 0 ? '✓ Volumen completo' : `Saldo pendiente: ${saldo(p)} tn`}
                </div>
              </div>

              <div style={styles.despachosSection}>
                <div style={styles.despachosTitle}>Despachos</div>
                {(p.despachos || []).map((d, i) => {
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
                        <span style={styles.despachoPor}>por {d.aceptado_por || d.programado_por} · {d.aceptado_en || d.programado_en}</span>
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

                      {d.estado === 'Aceptado-pendiente' && !sinTransportista(p.tipo) && (
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

                {saldo(p) > 0 && p.estado !== 'Suspendido' && (
                  <div style={styles.nuevoDespacho}>
                    <div style={styles.despachosTitle}>✓ Aceptar pedido — escribir en plan</div>
                    <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>
                      {sinTransportista(p.tipo)
                        ? 'Al aceptar se escribe en el Plan de Producción. El flujo queda completo.'
                        : 'Al aceptar se escribe en el Plan de Producción. Asignás el transportista después.'}
                    </p>
                    <div style={styles.despachoGrid}>
                      <div style={styles.formField}>
                        <label style={styles.formLabel}>Volumen (tn) — saldo: {saldo(p)} tn</label>
                        <input style={styles.input} type="number" placeholder={saldo(p)}
                          value={aceptando[p.id]?.volumen || ''}
                          onChange={e => setAceptando(prev => ({ ...prev, [p.id]: { ...prev[p.id], volumen: e.target.value } }))} />
                      </div>
                      <div style={styles.formField}>
                        <label style={styles.formLabel}>Fecha de carga</label>
                        <input style={styles.input} type="date" max={p.fecha_entrega}
                          value={aceptando[p.id]?.fecha_carga || ''}
                          onChange={e => setAceptando(prev => ({ ...prev, [p.id]: { ...prev[p.id], fecha_carga: e.target.value } }))} />
                        <span style={{ fontSize: 10, color: '#9CA3AF' }}>máx. {p.fecha_entrega}</span>
                      </div>
                      <div style={styles.formField}>
                        <label style={styles.formLabel}>Horario de carga sugerido</label>
                        <input style={styles.input} type="text" placeholder="Ej: 08:00hs"
                          value={aceptando[p.id]?.horario_carga || ''}
                          onChange={e => setAceptando(prev => ({ ...prev, [p.id]: { ...prev[p.id], horario_carga: e.target.value } }))} />
                      </div>
                      <div style={{ ...styles.formField, gridColumn: '1/-1' }}>
                        <label style={styles.formLabel}>Adjuntos para el despacho</label>
                        {(archivosNuevos[p.id] || []).length > 0 && (
                          <div style={styles.adjuntosRow}>
                            {(archivosNuevos[p.id] || []).map(f => (
                              <div key={f.name} style={styles.adjuntoChipEditable}>
                                <span style={{ fontSize: 11 }}>📎 {f.name}</span>
                                <button type="button" onClick={() => quitarArchivoNuevo(p.id, f.name)} style={styles.adjuntoQuitar}>✕</button>
                              </div>
                            ))}
                          </div>
                        )}
                        <button type="button" style={styles.btnAdjuntar} onClick={() => {
                          if (!fileRefs.current[p.id]) fileRefs.current[p.id] = document.createElement('input');
                          const input = fileRefs.current[p.id];
                          input.type = 'file'; input.multiple = true;
                          input.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
                          input.onchange = (e) => handleArchivosNuevos(p.id, e.target.files);
                          input.click();
                        }}>📎 Adjuntar archivo</button>
                      </div>
                    </div>
                    <button style={{ ...styles.btnAceptar, opacity: (enviando || subiendoArchivos) ? 0.7 : 1 }}
                      disabled={enviando || subiendoArchivos}
                      onClick={() => aceptarDespacho(p.id)}>
                      {subiendoArchivos ? 'Subiendo archivos...' : enviando ? 'Guardando...' : '✓ Aceptar y escribir en plan'}
                    </button>
                  </div>
                )}
              </div>

              <div style={styles.cardActions}>
                <button style={styles.btnSuspender} onClick={() => suspender(p)}>Suspender</button>
              </div>
            </div>
          )}
        </div>
      ))}
      </>)}
    </div>
  );
}

const stylesTab = {
  tabRow: { display: 'flex', gap: 4, padding: '0 1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem', background: '#fff' },
  tab: { padding: '10px 18px', fontSize: 13, fontWeight: 500, background: 'none', border: 'none', borderBottom: '2px solid transparent', color: '#6B7280', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 },
  tabActive: { color: '#C8102E', borderBottomColor: '#C8102E' },
  badge: { fontSize: 10, background: '#C8102E', color: '#fff', borderRadius: 20, padding: '1px 6px', fontWeight: 600 },
  seguimientoWrap: { display: 'flex', height: 'calc(100vh - 120px)', overflow: 'hidden' },
  panel: { width: 300, flexShrink: 0, overflowY: 'auto', padding: '10px', borderRight: '0.5px solid #E5E7EB' },
  choferCard: { border: '0.5px solid', borderRadius: 10, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', transition: 'border-color 0.15s', background: '#fff' },
  mapaWrap: { flex: 1, position: 'relative' },
  sinGps: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', fontSize: 14, color: '#6B7280', lineHeight: 1.7, background: 'rgba(255,255,255,0.9)', padding: '16px 20px', borderRadius: 12 },
};

const styles = {
  wrap: { maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem' },
  logoArea: { display: 'flex', alignItems: 'center', gap: 8 },
  portalText: { fontSize: 13, color: '#9CA3AF', marginLeft: 4 },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: '1.5rem' },
  metric: { background: '#F9FAFB', borderRadius: 8, padding: '12px 14px' },
  metricLabel: { fontSize: 11, color: '#9CA3AF', marginBottom: 4 },
  metricValue: { fontSize: 20, fontWeight: 500 },
  filtros: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' },
  filtroBtnBase: { padding: '6px 14px', borderRadius: 20, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer' },
  filtroBtnActive: { background: '#FDECEA', borderColor: '#C8102E', color: '#C8102E', fontWeight: 500 },
  empty: { textAlign: 'center', padding: '2rem', color: '#9CA3AF', fontSize: 13 },
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer', flexWrap: 'wrap', background: '#F9FAFB' },
  pill: { fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, flexShrink: 0 },
  badgeEditado: { fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#FEF3C7', color: '#92400E', border: '0.5px solid #F59E0B', flexShrink: 0 },
  badgeNomPendiente: { fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 20, background: '#FEF3C7', color: '#92400E', border: '0.5px solid #F59E0B', flexShrink: 0 },
  badgeEspera: { fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280', border: '0.5px solid #D1D5DB', flexShrink: 0 },
  cardNro: { fontSize: 13, fontWeight: 500, color: '#111827', flexShrink: 0 },
  cardResumen: { fontSize: 12, color: '#6B7280', flex: 1 },
  cardFechaCarga: { fontSize: 11, color: '#085041', background: '#E1F5EE', padding: '2px 8px', borderRadius: 20, flexShrink: 0 },
  cardFecha: { fontSize: 11, color: '#9CA3AF' },
  chevron: { fontSize: 10, color: '#9CA3AF', flexShrink: 0 },
  cardBody: { padding: '12px 14px' },
  origen: { fontSize: 12, color: '#6B7280', padding: '8px 10px', background: '#F9FAFB', borderRadius: 8, marginBottom: 12 },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 3 },
  label: { fontSize: 11, color: '#9CA3AF' },
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
  volBar: { padding: '10px 12px', borderRadius: 8, background: '#F9FAFB', border: '0.5px solid #E5E7EB', marginBottom: 12 },
  volBarLabels: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#6B7280', marginBottom: 6 },
  barTrack: { height: 8, borderRadius: 4, background: '#E5E7EB', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, transition: 'width 0.3s' },
  despachosSection: { marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #E5E7EB' },
  despachosTitle: { fontSize: 11, fontWeight: 500, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 },
  despachoItem: { border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '10px 12px', marginBottom: 8, background: '#F9FAFB' },
  despachoHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  despachoNro: { fontSize: 11, fontWeight: 500, color: '#6B7280' },
  despachoPor: { fontSize: 11, color: '#9CA3AF' },
  despachoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, alignItems: 'end' },
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
};

export default Coordinador;
