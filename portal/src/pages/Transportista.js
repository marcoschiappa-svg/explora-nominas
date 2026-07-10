import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, updateDoc, getDoc, getDocs, query, where } from 'firebase/firestore';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXOlu0PUTAVubDJCXh7WxjZp1ruCH5SMu9YmWbFCNF2ff7l5mn447nV8BIWbQ5-Mz-uQ/exec';
const MAPS_KEY = 'AIzaSyClpZ7qlzK2bqO2DcuY2Ta_jcNSAGffbrw';

const pngCache = {};
function getFlechaIconUrl(color, angulo, callback) {
  const key = `${color}_${Math.round(angulo)}`;
  if (pngCache[key]) { callback(pngCache[key]); return; }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g transform="rotate(${angulo} 16 16)"><polygon points="16,2 28,30 16,23 4,30" fill="${color}" stroke="white" stroke-width="2" stroke-linejoin="round"/></g></svg>`;
  const img = new Image();
  img.onload = () => { const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32; canvas.getContext('2d').drawImage(img, 0, 0); const url = canvas.toDataURL('image/png'); pngCache[key] = url; callback(url); };
  img.onerror = () => callback('data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg));
  img.src = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}
function calcularAngulo(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 0;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1r = lat1 * Math.PI / 180; const lat2r = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2r);
  const x = Math.cos(lat1r) * Math.sin(lat2r) - Math.sin(lat1r) * Math.cos(lat2r) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function Transportista({ usuario, onVolver }) {
  const [despachos, setDespachos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [expandido, setExpandido] = useState(null);
  const [nomData, setNomData] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [filtro, setFiltro] = useState('todos');
  const [modalNominacion, setModalNominacion] = useState(null);
  const [errorNominacion, setErrorNominacion] = useState({});
  const [vistaActiva, setVistaActiva] = useState('despachos'); // 'despachos' | 'mapa'
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef({});
  const infoWindowRef = useRef(null);

  const rol = usuario?.rol || '';
  const esAdmin = rol === 'admin';

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      const todos = [];
      snap.docs.forEach(d => {
        const pedido = d.data();
        (pedido.despachos || []).forEach((despacho, i) => {
          if (!['Programado', 'Aceptado', 'Nominado', 'En espera'].includes(despacho.estado)) return;
          // Admin ve todos — transportista solo los suyos
          if (!esAdmin && despacho.email_transportista !== usuario?.email) return;
          todos.push({
            docId: d.id,
            pedidoId: pedido.id,
            despachoIdx: i,
            uid: pedido.id + '-D' + (i + 1),
            despachoNro: i + 1,
            estado: despacho.estado,
            nominacion_pendiente: despacho.nominacion_pendiente || false,
            producto: pedido.producto,
            volumen: despacho.volumen,
            volumenTotal: pedido.volumen,
            cliente: pedido.cliente,
            ov: pedido.ov,
            fecha_carga: despacho.fecha_carga,
            horario_carga: despacho.horario_carga || '',
            fecha_entrega: pedido.fecha_entrega,
            banda_horaria: pedido.banda_horaria || '',
            lugar: pedido.lugar,
            recipiente: pedido.recipiente,
            obs: pedido.obs || '',
            tipo: pedido.tipo,
            transporte: despacho.transporte,
            email_transportista: despacho.email_transportista || '',
            email_comercial: pedido.creado_por_email || '',
            programado_por: despacho.programado_por || despacho.aceptado_por || '',
            programado_en: despacho.programado_en || despacho.aceptado_en || '',
            patente_tractor: despacho.patente_tractor || '',
            patente_semi: despacho.patente_semi || '',
            chofer: despacho.chofer || '',
            dni_chofer: despacho.dni_chofer || '',
            cuit_chofer: despacho.cuit_chofer || '',
            cuit_transporte: despacho.cuit_transporte || '',
            tel_prefijo: despacho.tel_prefijo || '',
            tel_numero: despacho.tel_numero || '',
            tel_unidad: despacho.tel_unidad || '',
            estado_chofer: despacho.estado_chofer || '',
            adjuntos: (pedido.adjuntos || []).filter(a => a.visible_transportista && !a._eliminado),
          });
        });
      });
      todos.sort((a, b) => new Date(a.fecha_carga) - new Date(b.fecha_carga));
      setDespachos(todos);
      setCargando(false);
    });
    return () => unsub();
  }, [esAdmin, usuario]);

  function handleExpandir(d) {
    const nuevoExpandido = expandido === d.uid ? null : d.uid;
    setExpandido(nuevoExpandido);
    if (nuevoExpandido && (!nomData[d.uid] || (d.estado === 'Nominado' && d.estado_chofer === 'recibido'))) {
      let cuit1 = '', cuit2 = '', cuit3 = '';
      if (d.cuit_chofer) {
        const partes = d.cuit_chofer.split('-');
        if (partes.length === 3) { cuit1 = partes[0]; cuit2 = partes[1]; cuit3 = partes[2]; }
        else { cuit2 = d.cuit_chofer; }
      }
      let tel_prefijo = d.tel_prefijo || '';
      let tel_numero = d.tel_numero || '';
      if (!tel_prefijo && d.tel_unidad) {
        const match = d.tel_unidad.match(/^\((\d+)\)\s*(.+)$/);
        if (match) { tel_prefijo = match[1]; tel_numero = match[2]; }
        else { tel_numero = d.tel_unidad; }
      }
      setNomData(prev => ({
        ...prev,
        [d.uid]: {
          transporte: d.transporte || '',
          cuit_transporte: d.cuit_transporte || '',
          chofer: d.chofer || '',
          dni_chofer: d.dni_chofer || '',
          cuit1, cuit2, cuit3,
          patente_tractor: d.patente_tractor || '',
          patente_semi: d.patente_semi || '',
          tel_prefijo, tel_numero,
        }
      }));
    }
  }

  function updateNom(uid, field, value) {
    setNomData(prev => {
      const updated = { ...prev, [uid]: { ...prev[uid], [field]: value } };
      if (field === 'dni_chofer') updated[uid].cuit2 = value;
      return updated;
    });
  }

  const pillColors = {
    'Programado': { bg: '#FAEEDA', color: '#633806' },
    'Aceptado':   { bg: '#E1F5EE', color: '#085041' },
    'Nominado':   { bg: '#EEEDFE', color: '#3C3489' },
    'En espera':  { bg: '#F3F4F6', color: '#6B7280' },
  };
  const pillLabel = {
    'Programado': 'Asignado', 'Aceptado': 'Aceptado',
    'Nominado': 'Nominado', 'En espera': 'En espera',
  };

  async function aceptar(d) {
    setEnviando(true);
    try {
      const pedidoSnap = await getDoc(doc(db, 'pedidos_portal', d.docId));
      const pedido = pedidoSnap.data();
      const nuevosDespachos = [...pedido.despachos];
      nuevosDespachos[d.despachoIdx] = {
        ...nuevosDespachos[d.despachoIdx],
        estado: 'Aceptado',
        aceptado_en: new Date().toLocaleString('es-AR'),
        nominacion_pendiente: true,
      };
      await updateDoc(doc(db, 'pedidos_portal', d.docId), { despachos: nuevosDespachos, estado: 'Aceptado' });
      const confirmadoEn = new Date().toLocaleString('es-AR');
      const payload = {
        accion: 'confirmar_despacho',
        pedido_id: d.pedidoId, despacho_id: 'D' + d.despachoNro,
        transporte: d.transporte, email_transportista: d.email_transportista,
        producto: d.producto, volumen: d.volumen,
        cliente: d.cliente, ov: d.ov,
        fecha_carga: d.fecha_carga, horario_carga: d.horario_carga,
        lugar: d.lugar, estado_nominacion: 'pendiente',
        confirmado_en: confirmadoEn,
      };
      await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString(), { mode: 'no-cors' });
      setModalNominacion(d);
    } catch (err) {
      console.error(err);
      alert('Error al aceptar el despacho: ' + err.message);
    } finally { setEnviando(false); }
  }

  async function responderModalNominacion(elegioAhora) {
    const d = modalNominacion;
    setModalNominacion(null);
    if (elegioAhora) setExpandido(d.uid);
  }

  async function rechazar(d) {
    const motivo = prompt('Motivo del rechazo (requerido):');
    if (!motivo) return;
    const pedidoSnap = await getDoc(doc(db, 'pedidos_portal', d.docId));
    const pedido = pedidoSnap.data();
    const nuevosDespachos = [...pedido.despachos];
    nuevosDespachos[d.despachoIdx] = { ...nuevosDespachos[d.despachoIdx], estado: 'Rechazado' };
    await updateDoc(doc(db, 'pedidos_portal', d.docId), { despachos: nuevosDespachos, estado: 'Pendiente' });
    const payload = {
      accion: 'rechazar_despacho',
      pedido_id: d.pedidoId, despacho_id: 'D' + d.despachoNro,
      transporte: d.transporte, producto: d.producto,
      volumen: d.volumen, cliente: d.cliente,
      ov: d.ov, fecha_carga: d.fecha_carga, motivo,
    };
    await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString(), { mode: 'no-cors' });
    alert('Despacho rechazado. Se notificó al coordinador.');
  }

  async function nominar(d) {
    const nd = nomData[d.uid] || {};
    if (!nd.patente_tractor || !nd.chofer || !nd.dni_chofer || !nd.cuit_transporte) {
      alert('Completá patente tractor, nombre del chofer, DNI y CUIT de la empresa antes de nominar.');
      return;
    }
    setErrorNominacion(prev => ({ ...prev, [d.uid]: null }));
    setEnviando(true);
    // Validar DNI contra usuarios_portal
    try {
      const qDni = query(collection(db, 'usuarios_portal'), where('dni', '==', nd.dni_chofer), where('rol', '==', 'chofer'));
      const snapDni = await getDocs(qDni);
      if (snapDni.empty) {
        setErrorNominacion(prev => ({ ...prev, [d.uid]: `El DNI ${nd.dni_chofer} no corresponde a ningún chofer habilitado en el sistema.` }));
        setEnviando(false);
        return;
      }
      const choferData = snapDni.docs[0].data();
      const empresaChofer = (choferData.empresa || '').trim().toLowerCase();
      const empresaTransporte = (d.transporte || '').trim().toLowerCase();
      if (empresaChofer && empresaTransporte && empresaChofer !== empresaTransporte) {
        setErrorNominacion(prev => ({ ...prev, [d.uid]: `El chofer con DNI ${nd.dni_chofer} pertenece a "${choferData.empresa}", no a "${d.transporte}".` }));
        setEnviando(false);
        return;
      }
    } catch (err) {
      console.error('Error validando chofer:', err);
    }
    const cuit_chofer = nd.cuit1 && nd.cuit2 && nd.cuit3 ? `${nd.cuit1}-${nd.cuit2}-${nd.cuit3}` : '';
    const tel_unidad = nd.tel_prefijo && nd.tel_numero ? `(${nd.tel_prefijo}) ${nd.tel_numero}` : nd.tel_numero || '';
    try {
      const pedidoSnap = await getDoc(doc(db, 'pedidos_portal', d.docId));
      const pedido = pedidoSnap.data();
      const nuevosDespachos = [...pedido.despachos];
      nuevosDespachos[d.despachoIdx] = {
        ...nuevosDespachos[d.despachoIdx],
        estado: 'Nominado', nominacion_pendiente: false,
        patente_tractor: nd.patente_tractor.toUpperCase(),
        patente_semi: (nd.patente_semi || '').toUpperCase(),
        chofer: nd.chofer, dni_chofer: nd.dni_chofer,
        cuit_chofer, cuit_transporte: nd.cuit_transporte,
        tel_unidad, tel_prefijo: nd.tel_prefijo || '', tel_numero: nd.tel_numero || '',
        estado_chofer: 'recibido',
        estado_chofer_ts: new Date().toISOString(),
      };
      await updateDoc(doc(db, 'pedidos_portal', d.docId), { despachos: nuevosDespachos, estado: 'Nominado' });
      const payload = {
        accion: 'nominar_unidad',
        pedido_id: d.pedidoId, fecha_carga: d.fecha_carga,
        tipo: d.tipo, producto: d.producto, volumen: d.volumen,
        cliente: d.cliente, ov: d.ov, lugar: d.lugar,
        patente_tractor: nd.patente_tractor.toUpperCase(),
        patente_semi: (nd.patente_semi || '').toUpperCase(),
        chofer: nd.chofer, dni_chofer: nd.dni_chofer,
        cuit_chofer, cuit_transporte: nd.cuit_transporte,
        tel_unidad, transporte: d.transporte,
        email_comercial: d.email_comercial || '',
      };
      await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString(), { mode: 'no-cors' });
      alert('✓ Nominación confirmada. Se notificó a Portería.');
    } catch (err) {
      console.error(err);
      alert('Error al nominar: ' + err.message);
    } finally { setEnviando(false); }
  }

  // Mapa
  useEffect(() => {
    if (vistaActiva !== 'mapa') return;
    if (window.google) { initMap(); return; }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`;
    script.async = true;
    script.onload = initMap;
    document.head.appendChild(script);
  }, [vistaActiva]); // eslint-disable-line react-hooks/exhaustive-deps

  function initMap() {
    setTimeout(() => {
      if (!mapRef.current || mapInstanceRef.current) return;
      mapInstanceRef.current = new window.google.maps.Map(mapRef.current, {
        center: { lat: -32.7, lng: -60.5 }, zoom: 6,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
      });
      infoWindowRef.current = new window.google.maps.InfoWindow();
      actualizarMarcadores();
    }, 100);
  }

  function actualizarMarcadores() {
    if (!mapInstanceRef.current || !window.google) return;
    const activos = despachos.filter(d => ['iniciado','demorado','recibido'].includes(d.estado_chofer) && d.gps_lat && d.gps_lng);
    const uidsActuales = new Set(activos.map(d => d.uid));
    Object.keys(markersRef.current).forEach(uid => {
      if (!uidsActuales.has(uid)) { markersRef.current[uid].setMap(null); delete markersRef.current[uid]; }
    });
    activos.forEach(d => {
      const pos = { lat: d.gps_lat, lng: d.gps_lng };
      const color = d.estado_chofer === 'demorado' ? '#BA7517' : d.estado_chofer === 'iniciado' ? '#1D9E75' : '#378ADD';
      const angulo = calcularAngulo(d.gps_lat_prev, d.gps_lng_prev, d.gps_lat, d.gps_lng);
      getFlechaIconUrl(color, angulo, (iconUrl) => {
        const icon = { url: iconUrl, scaledSize: new window.google.maps.Size(32, 32), anchor: new window.google.maps.Point(16, 16) };
        if (markersRef.current[d.uid]) {
          markersRef.current[d.uid].setPosition(pos);
          markersRef.current[d.uid].setIcon(icon);
        } else {
          const marker = new window.google.maps.Marker({ position: pos, map: mapInstanceRef.current, title: d.chofer, icon });
          marker.addListener('click', () => {
            infoWindowRef.current.setContent(`<div style="font-family:sans-serif;padding:6px 8px;min-width:180px"><div style="font-weight:600;font-size:13px;margin-bottom:4px">🚛 ${d.chofer}</div><div style="font-size:12px;color:#6B7280">${d.producto} · ${d.volumen} tn</div><div style="font-size:12px;color:#6B7280;margin-top:2px">${d.patente_tractor}${d.patente_semi ? ' / ' + d.patente_semi : ''}</div></div>`);
            infoWindowRef.current.open(mapInstanceRef.current, marker);
          });
          markersRef.current[d.uid] = marker;
        }
      });
    });
  }

  useEffect(() => {
    if (vistaActiva === 'mapa') actualizarMarcadores();
  }, [despachos, vistaActiva]); // eslint-disable-line react-hooks/exhaustive-deps

  function tiempoDesde(isoStr) {
    if (!isoStr) return '—';
    const diff = Date.now() - new Date(isoStr).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `hace ${h} h ${m} min`;
    return `hace ${m} min`;
  }

  const filtrados = despachos.filter(d => filtro === 'todos' || d.estado === filtro);

  return (
    <div style={styles.wrap}>

      {modalNominacion && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <div style={styles.modalIcon}>🚛</div>
            <div style={styles.modalTitulo}>Despacho aceptado</div>
            <div style={styles.modalSubtitulo}>
              {modalNominacion.producto} · {modalNominacion.volumen} tn · Carga: {modalNominacion.fecha_carga}
              {modalNominacion.horario_carga ? ' · ' + modalNominacion.horario_carga : ''}
            </div>
            <div style={styles.modalPregunta}>¿Querés nominar la unidad y el chofer ahora?</div>
            <div style={styles.modalHint}>
              Podés hacerlo más tarde, pero recordá completarlo antes de la hora de carga.
              Si no nominás con al menos 12 hs de anticipación recibirás un recordatorio automático.
            </div>
            <div style={styles.modalActions}>
              <button style={styles.btnModalSi} onClick={() => responderModalNominacion(true)}>Sí, nominar ahora</button>
              <button style={styles.btnModalNo} onClick={() => responderModalNominacion(false)}>Lo hago más tarde</button>
            </div>
          </div>
        </div>
      )}

      <div style={styles.topbar}>
        <div style={styles.logoArea}>
          <img src="/logo.png" alt="Explora" style={{ height: 32, objectFit: 'contain' }} />
          <span style={styles.portalText}>{esAdmin ? 'Despachos — Vista admin' : 'Mis despachos'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={styles.tabsWrap}>
            <button style={{ ...styles.tabBtn, ...(vistaActiva === 'despachos' ? styles.tabBtnActive : {}) }} onClick={() => setVistaActiva('despachos')}>📋 Despachos</button>
            <button style={{ ...styles.tabBtn, ...(vistaActiva === 'mapa' ? styles.tabBtnActive : {}) }} onClick={() => { setVistaActiva('mapa'); mapInstanceRef.current = null; }}>🗺 Mis unidades</button>
          </div>
          <button style={styles.btnVolver} onClick={onVolver}>← Inicio</button>
        </div>
      </div>

      {vistaActiva === 'mapa' && (
        <div style={styles.mapaWrap}>
          <div ref={mapRef} style={styles.mapaContainer} />
          {despachos.filter(d => ['iniciado','demorado','recibido'].includes(d.estado_chofer) && d.gps_lat).length === 0 && (
            <div style={styles.sinGps}>Sin unidades con GPS activo en este momento.</div>
          )}
        </div>
      )}

      {vistaActiva === 'despachos' && <>
      <div style={styles.intro}>
        {esAdmin
          ? 'ℹ️ Vista administrador — todos los despachos de todos los transportistas.'
          : 'ℹ️ Solo ves los despachos asignados a tu empresa. Aceptá cada despacho y completá los datos de la unidad.'}
      </div>

      <div style={styles.metrics}>
        {[['Asignados','#BA7517','Programado'],['Aceptados','#0F6E56','Aceptado'],['Nominados','#534AB7','Nominado'],['En espera','#6B7280','En espera']].map(([label, color, estado]) => (
          <div key={estado} style={styles.metric}>
            <div style={styles.metricLabel}>{label}</div>
            <div style={{ ...styles.metricValue, color }}>{despachos.filter(d => d.estado === estado).length}</div>
          </div>
        ))}
      </div>

      <div style={styles.filtros}>
        {['todos','Programado','Aceptado','Nominado','En espera'].map(f => (
          <button key={f} style={{ ...styles.filtroBtnBase, ...(filtro === f ? styles.filtroBtnActive : {}) }} onClick={() => setFiltro(f)}>
            {f === 'todos' ? 'Todos' : pillLabel[f] || f}
          </button>
        ))}
      </div>

      {cargando && <div style={styles.empty}>Cargando despachos...</div>}
      {!cargando && filtrados.length === 0 && <div style={styles.empty}>Sin despachos para mostrar.</div>}

      {!cargando && filtrados.map(d => (
        <div key={d.uid} style={styles.card}>
          <div style={styles.cardHeader} onClick={() => handleExpandir(d)}>
            <span style={{ ...styles.pill, background: pillColors[d.estado]?.bg, color: pillColors[d.estado]?.color }}>
              {pillLabel[d.estado] || d.estado}
            </span>
            {d.estado === 'Aceptado' && d.nominacion_pendiente && (
              <span style={styles.pillPendiente}>Nominación pendiente</span>
            )}
            <span style={styles.cardNro}>{d.pedidoId} · D{d.despachoNro}</span>
            <span style={styles.cardResumen}>
              {d.producto} {d.volumen} tn · {d.cliente}
              {esAdmin && d.transporte && <span style={{ color: '#9CA3AF' }}> · {d.transporte}</span>}
            </span>
            <div style={styles.cardMeta}>
              <span style={styles.cardFechaLabel}>Carga</span>
              <span style={styles.cardFechaVal}>{d.fecha_carga}</span>
            </div>
            <span style={styles.chevron}>{expandido === d.uid ? '▲' : '▼'}</span>
          </div>

          {expandido === d.uid && (
            <div style={styles.cardBody}>
              {d.estado === 'En espera' && (
                <div style={styles.esperaBanner}>
                  ⏸ Este despacho está en espera por cambios en el pedido. Aguardá la reprogramación del coordinador.
                </div>
              )}
              {d.estado === 'Aceptado' && d.nominacion_pendiente && (
                <div style={styles.nominacionPendienteBanner}>
                  ⏳ Tenés la nominación pendiente. Completá los datos de la unidad antes de la hora de carga.
                  {d.horario_carga ? ' Horario sugerido: ' + d.horario_carga + '.' : ''}
                </div>
              )}
              <div style={styles.origen}>
                Programado por <strong>{d.programado_por}</strong> · {d.programado_en}
              </div>
              {d.volumenTotal > d.volumen && (
                <div style={styles.contextBanner}>
                  Este despacho es parte de un pedido de <strong>{d.volumenTotal} tn</strong> — asignación: <strong>{d.volumen} tn</strong>.
                </div>
              )}
              <div style={styles.detailGrid}>
                <div style={styles.field}><span style={styles.label}>Producto</span><span style={styles.hiVal}>{d.producto}</span></div>
                <div style={styles.field}><span style={styles.label}>Volumen</span><span style={styles.hiVal}>{d.volumen} tn</span></div>
                <div style={styles.field}><span style={styles.label}>Recipiente</span><span>{d.recipiente}</span></div>
                <div style={styles.field}><span style={styles.label}>OV / OC</span><span>{d.ov}</span></div>
                <div style={styles.field}><span style={styles.label}>Fecha de carga</span><span style={styles.hiVal}>{d.fecha_carga}</span></div>
                {d.horario_carga && <div style={styles.field}><span style={styles.label}>Horario sugerido</span><span style={styles.hiVal}>{d.horario_carga}</span></div>}
                <div style={styles.field}><span style={styles.label}>Entrega comprometida</span><span>{d.fecha_entrega}</span></div>
                {d.banda_horaria && <div style={styles.field}><span style={styles.label}>Banda horaria descarga</span><span>{d.banda_horaria}</span></div>}
                {esAdmin && d.transporte && <div style={styles.field}><span style={styles.label}>Transportista</span><span>{d.transporte}</span></div>}
                {esAdmin && d.email_transportista && <div style={styles.field}><span style={styles.label}>Email transportista</span><span>{d.email_transportista}</span></div>}
                <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Lugar</span><span>{d.lugar}</span></div>
                {d.obs && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Observaciones</span><span>{d.obs}</span></div>}
              </div>

              {d.adjuntos?.length > 0 && (
                <div style={styles.adjuntosSection}>
                  <div style={styles.adjuntosTitle}>Documentación adjunta</div>
                  <div style={styles.adjuntosGrid}>
                    {d.adjuntos.map(a => (
                      <a key={a.file_id} href={a.link} target="_blank" rel="noreferrer" style={styles.adjuntoLink}>📎 {a.nombre}</a>
                    ))}
                  </div>
                </div>
              )}

              {d.estado !== 'Programado' && d.estado !== 'En espera' && (
                <div style={styles.nomSection}>
                  <div style={styles.nomTitle}>🚛 Datos de la unidad</div>

                  <div style={styles.nomSubtitle}>Empresa transportista</div>
                  <div style={styles.nomGrid}>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Nombre empresa</label>
                      <input style={styles.input} type="text" placeholder="Razón social"
                        value={nomData[d.uid]?.transporte || ''}
                        disabled={d.estado === 'Nominado' && d.estado_chofer !== 'recibido'}
                        onChange={e => updateNom(d.uid, 'transporte', e.target.value)} />
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>CUIT empresa * (sin guiones)</label>
                      <input style={styles.input} type="text" placeholder="20000000009"
                        value={nomData[d.uid]?.cuit_transporte || ''}
                        disabled={d.estado === 'Nominado' && d.estado_chofer !== 'recibido'}
                        onChange={e => updateNom(d.uid, 'cuit_transporte', e.target.value)} />
                    </div>
                  </div>

                  <div style={{ ...styles.nomSubtitle, marginTop: 12 }}>Chofer</div>
                  <div style={styles.nomGrid}>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Nombre completo *</label>
                      <input style={styles.input} type="text" placeholder="Apellido, Nombre"
                        value={nomData[d.uid]?.chofer || ''}
                        disabled={d.estado === 'Nominado' && d.estado_chofer !== 'recibido'}
                        onChange={e => updateNom(d.uid, 'chofer', e.target.value)} />
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>DNI *</label>
                      <input style={styles.input} type="text" placeholder="00000000" maxLength={8}
                        value={nomData[d.uid]?.dni_chofer || ''}
                        disabled={d.estado === 'Nominado' && d.estado_chofer !== 'recibido'}
                        onChange={e => updateNom(d.uid, 'dni_chofer', e.target.value.replace(/\D/g, ''))} />
                    </div>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <label style={styles.formLabel}>CUIT chofer</label>
                    <div style={styles.cuitRow}>
                      <input style={{ ...styles.input, width: 52, flexShrink: 0, textAlign: 'center' }}
                        type="text" placeholder="XX" maxLength={2}
                        value={nomData[d.uid]?.cuit1 || ''}
                        disabled={d.estado === 'Nominado' && d.estado_chofer !== 'recibido'}
                        onChange={e => updateNom(d.uid, 'cuit1', e.target.value.replace(/\D/g, ''))} />
                      <span style={styles.cuitSep}>-</span>
                      <input style={{ ...styles.input, flex: 1, textAlign: 'center', color: '#9CA3AF' }}
                        type="text" placeholder="DNI"
                        value={nomData[d.uid]?.cuit2 || ''}
                        disabled readOnly />
                      <span style={styles.cuitSep}>-</span>
                      <input style={{ ...styles.input, width: 44, flexShrink: 0, textAlign: 'center' }}
                        type="text" placeholder="X" maxLength={1}
                        value={nomData[d.uid]?.cuit3 || ''}
                        disabled={d.estado === 'Nominado' && d.estado_chofer !== 'recibido'}
                        onChange={e => updateNom(d.uid, 'cuit3', e.target.value.replace(/\D/g, ''))} />
                    </div>
                    <span style={styles.fieldHint}>El campo central se completa automáticamente con el DNI</span>
                  </div>

                  <div style={{ ...styles.nomSubtitle, marginTop: 12 }}>Vehículo</div>
                  <div style={styles.nomGrid}>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Patente tractor *</label>
                      <input style={styles.input} type="text" placeholder="ABC123"
                        value={nomData[d.uid]?.patente_tractor || ''}
                        disabled={d.estado === 'Nominado' && d.estado_chofer !== 'recibido'}
                        onChange={e => updateNom(d.uid, 'patente_tractor', e.target.value.toUpperCase())}
                        onInput={e => { e.target.value = e.target.value.toUpperCase(); }} />
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Patente semi</label>
                      <input style={styles.input} type="text" placeholder="ABC123"
                        value={nomData[d.uid]?.patente_semi || ''}
                        disabled={d.estado === 'Nominado' && d.estado_chofer !== 'recibido'}
                        onChange={e => updateNom(d.uid, 'patente_semi', e.target.value.toUpperCase())}
                        onInput={e => { e.target.value = e.target.value.toUpperCase(); }} />
                    </div>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <label style={styles.formLabel}>Teléfono de la unidad</label>
                    <div style={styles.telRow}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '0 0 110px' }}>
                        <input style={styles.input} type="text" placeholder="Prefijo" maxLength={4}
                          value={nomData[d.uid]?.tel_prefijo || ''}
                          disabled={d.estado === 'Nominado' && d.estado_chofer !== 'recibido'}
                          onChange={e => updateNom(d.uid, 'tel_prefijo', e.target.value.replace(/\D/g, ''))} />
                        <span style={styles.fieldHint}>Sin 0 · 3 o 4 díg.</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                        <input style={styles.input} type="text" placeholder="Número" maxLength={7}
                          value={nomData[d.uid]?.tel_numero || ''}
                          disabled={d.estado === 'Nominado' && d.estado_chofer !== 'recibido'}
                          onChange={e => updateNom(d.uid, 'tel_numero', e.target.value.replace(/\D/g, ''))} />
                        <span style={styles.fieldHint}>Sin 15 · 6 o 7 díg.</span>
                      </div>
                    </div>
                  </div>

                  {d.estado === 'Nominado' && d.estado_chofer !== 'recibido' && (
                    <div style={styles.nomOk}>✓ Nominación confirmada. Portería fue notificada.</div>
                  )}
                  {errorNominacion[d.uid] && (
                    <div style={styles.errorBanner}>⚠️ {errorNominacion[d.uid]}</div>
                  )}
                </div>
              )}

              <div style={styles.cardActions}>
                {d.estado === 'Programado' && !esAdmin && (
                  <>
                    <button style={{ ...styles.btnAceptar, opacity: enviando ? 0.7 : 1 }}
                      disabled={enviando} onClick={() => aceptar(d)}>
                      {enviando ? 'Procesando...' : '✓ Aceptar despacho'}
                    </button>
                    <button style={styles.btnRechazar} onClick={() => rechazar(d)}>✕ Rechazar</button>
                  </>
                )}
                {d.estado === 'Aceptado' && !esAdmin && (
                  <button style={{ ...styles.btnNominar, opacity: enviando ? 0.7 : 1 }}
                    disabled={enviando} onClick={() => nominar(d)}>
                    {enviando ? 'Enviando...' : '✓ Confirmar nominación'}
                  </button>
                )}
                {d.estado === 'Nominado' && d.estado_chofer === 'recibido' && !esAdmin && (
                  <button style={{ ...styles.btnNominar, opacity: enviando ? 0.7 : 1 }}
                    disabled={enviando} onClick={() => nominar(d)}>
                    {enviando ? 'Guardando...' : '✏️ Guardar cambios'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </>
      }
    </div>
  );
}

  wrap: { maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' },
  modalBox: { background: '#fff', borderRadius: 16, padding: '2rem 1.5rem', maxWidth: 400, width: '100%', textAlign: 'center' },
  modalIcon: { fontSize: 36, marginBottom: 12 },
  modalTitulo: { fontSize: 18, fontWeight: 500, color: '#111827', marginBottom: 6 },
  modalSubtitulo: { fontSize: 13, color: '#3C3489', fontWeight: 500, marginBottom: 16 },
  modalPregunta: { fontSize: 15, color: '#111827', fontWeight: 500, marginBottom: 8 },
  modalHint: { fontSize: 12, color: '#6B7280', marginBottom: 24, padding: '8px 12px', background: '#F9FAFB', borderRadius: 8, border: '0.5px solid #E5E7EB', textAlign: 'left', lineHeight: 1.5 },
  modalActions: { display: 'flex', flexDirection: 'column', gap: 10 },
  btnModalSi: { padding: '11px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  btnModalNo: { padding: '11px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 14, cursor: 'pointer' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem' },
  logoArea: { display: 'flex', alignItems: 'center', gap: 8 },
  portalText: { fontSize: 13, color: '#9CA3AF', marginLeft: 4 },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  intro: { padding: '10px 14px', borderRadius: 8, background: '#F9FAFB', border: '0.5px solid #E5E7EB', fontSize: 13, color: '#6B7280', marginBottom: '1.5rem' },
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
  pillPendiente: { fontSize: 10, fontWeight: 500, padding: '3px 10px', borderRadius: 20, background: '#FAEEDA', color: '#633806', flexShrink: 0 },
  cardNro: { fontSize: 13, fontWeight: 500, color: '#111827', flexShrink: 0 },
  cardResumen: { fontSize: 12, color: '#6B7280', flex: 1 },
  cardMeta: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', flexShrink: 0 },
  cardFechaLabel: { fontSize: 10, color: '#9CA3AF' },
  cardFechaVal: { fontSize: 11, color: '#6B7280' },
  chevron: { fontSize: 10, color: '#9CA3AF', flexShrink: 0 },
  cardBody: { padding: '12px 14px' },
  esperaBanner: { padding: '8px 12px', borderRadius: 8, background: '#F3F4F6', border: '0.5px solid #E5E7EB', fontSize: 12, color: '#6B7280', marginBottom: 10 },
  nominacionPendienteBanner: { padding: '8px 12px', borderRadius: 8, background: '#FAEEDA', border: '0.5px solid #EF9F27', fontSize: 12, color: '#633806', marginBottom: 10 },
  origen: { fontSize: 12, color: '#6B7280', padding: '8px 10px', background: '#F9FAFB', borderRadius: 8, marginBottom: 10 },
  contextBanner: { fontSize: 12, color: '#633806', padding: '8px 10px', background: '#FAEEDA', border: '0.5px solid #EF9F27', borderRadius: 8, marginBottom: 10 },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 3 },
  label: { fontSize: 11, color: '#9CA3AF' },
  hiVal: { fontSize: 14, fontWeight: 500, color: '#3C3489' },
  adjuntosSection: { marginBottom: 10, padding: '10px 12px', background: '#F9FAFB', borderRadius: 8, border: '0.5px solid #E5E7EB' },
  adjuntosTitle: { fontSize: 11, fontWeight: 500, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 },
  adjuntosGrid: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  adjuntoLink: { fontSize: 12, color: '#3C3489', textDecoration: 'none', padding: '4px 10px', background: '#EEEDFE', borderRadius: 8, border: '0.5px solid #C5C2F0' },
  nomSection: { marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #E5E7EB' },
  nomTitle: { fontSize: 11, fontWeight: 500, color: '#534AB7', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 },
  nomSubtitle: { fontSize: 11, fontWeight: 500, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8, paddingBottom: 4, borderBottom: '0.5px solid #F3F4F6' },
  nomGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 },
  formField: { display: 'flex', flexDirection: 'column', gap: 4 },
  formLabel: { fontSize: 12, color: '#6B7280' },
  input: { fontSize: 13, padding: '7px 9px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%', boxSizing: 'border-box' },
  cuitRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 },
  cuitSep: { fontSize: 16, color: '#6B7280', fontWeight: 500, flexShrink: 0 },
  telRow: { display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 4 },
  fieldHint: { fontSize: 10, color: '#9CA3AF', marginTop: 3 },
  nomOk: { marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#E1F5EE', border: '0.5px solid #5DCAA5', fontSize: 12, color: '#085041' },
  errorBanner: { marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FEF2F2', border: '0.5px solid #FCA5A5', fontSize: 12, color: '#B91C1C' },
  cardActions: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  btnAceptar: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnNominar: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#534AB7', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnRechazar: { padding: '8px 16px', borderRadius: 8, border: '0.5px solid #A32D2D', background: '#fff', color: '#A32D2D', fontSize: 13, cursor: 'pointer' },
  tabsWrap: { display: 'flex', background: '#F3F4F6', borderRadius: 8, padding: 3, gap: 2 },
  tabBtn: { padding: '5px 12px', borderRadius: 6, border: 'none', background: 'transparent', color: '#6B7280', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  tabBtnActive: { background: '#fff', color: '#111827', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' },
  mapaWrap: { position: 'relative', height: 'calc(100vh - 120px)', margin: '0 -1rem' },
  mapaContainer: { width: '100%', height: '100%' },
  sinGps: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', fontSize: 14, color: '#6B7280', background: 'rgba(255,255,255,0.9)', padding: '16px 20px', borderRadius: 12 },
};

export default Transportista;
