import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXOlu0PUTAVubDJCXh7WxjZp1ruCH5SMu9YmWbFCNF2ff7l5mn447nV8BIWbQ5-Mz-uQ/exec';

async function subirArchivo(file, pedidoId, subidoPor) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const base64 = e.target.result.split(',')[1];
        const payload = {
          accion: 'subir_adjunto',
          nombre: file.name,
          tipo_mime: file.type || 'application/octet-stream',
          base64,
          pedido_id: pedidoId,
          subido_por: subidoPor,
        };
        const response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (data.status === 'ok') resolve(data.data);
        else reject(new Error(data.mensaje || 'Error subiendo archivo'));
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Error leyendo archivo'));
    reader.readAsDataURL(file);
  });
}

function Coordinador({ usuario, onVolver }) {
  const [pedidos, setPedidos] = useState([]);
  const [transportistas, setTransportistas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState('todos');
  const [expandido, setExpandido] = useState(null);
  const [nuevoDespacho, setNuevoDespacho] = useState({});
  const [reprogramando, setReprogramando] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [subiendoArchivos, setSubiendoArchivos] = useState(false);
  const [archivosNuevos, setArchivosNuevos] = useState({});
  const fileRefs = useRef({});

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      const data = snap.docs.map(d => ({
        docId: d.id, ...d.data(), despachos: d.data().despachos || [],
      }));
      data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setPedidos(data);
      setCargando(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'transportistas_portal'), (snap) => {
      const data = snap.docs
        .map(d => ({ docId: d.id, ...d.data() }))
        .filter(t => t.estado === 'activo')
        .sort((a, b) => a.empresa?.localeCompare(b.empresa));
      setTransportistas(data);
    });
    return () => unsub();
  }, []);

  function seleccionarTransportista(pedidoId, docId) {
    const t = transportistas.find(x => x.docId === docId);
    if (!t) {
      setNuevoDespacho(prev => ({
        ...prev,
        [pedidoId]: { ...prev[pedidoId], transporte_id: '', transporte: '', email_transportista: '', emails_extra: [], telefonos: [] },
      }));
      return;
    }
    const emails = [t.email_1, t.email_2, t.email_3].filter(Boolean);
    const telefonos = [t.telefono_1, t.telefono_2, t.telefono_3].filter(Boolean);
    setNuevoDespacho(prev => ({
      ...prev,
      [pedidoId]: {
        ...prev[pedidoId],
        transporte_id: t.docId,
        transporte: t.empresa,
        email_transportista: emails[0] || '',
        emails_extra: emails.slice(1),
        telefonos,
        cuit_transporte: t.cuit_empresa || '',
      },
    }));
  }

  function tieneNominacionPendiente(p) {
    return (p.despachos || []).some(d => d.estado === 'Aceptado' && d.nominacion_pendiente);
  }

  function tieneDespachoEnEspera(p) {
    return (p.despachos || []).some(d => d.estado === 'En espera');
  }

  function proximaCarga(p) {
    const fechas = (p.despachos || [])
      .filter(d => d.fecha_carga && d.estado !== 'En espera')
      .map(d => d.fecha_carga)
      .sort();
    return fechas[0] || null;
  }

  const pillColors = {
    'Pendiente':    { bg: '#EEEDFE', color: '#3C3489' },
    'prog-parcial': { bg: '#FAEEDA', color: '#633806' },
    'Programado':   { bg: '#E1F5EE', color: '#085041' },
    'Aceptado':     { bg: '#D1FAE5', color: '#065F46' },
    'Nominado':     { bg: '#EEEDFE', color: '#3C3489' },
    'Suspendido':   { bg: '#FCEBEB', color: '#791F1F' },
  };

  const pillLabel = {
    'Pendiente': 'Pendiente', 'prog-parcial': 'Prog. parcial',
    'Programado': 'Programado', 'Aceptado': 'Aceptado',
    'Nominado': 'Nominado', 'Suspendido': 'Suspendido',
  };

  const despachoColors = {
    'Programado': { bg: '#FAEEDA', color: '#633806' },
    'Aceptado':   { bg: '#E1F5EE', color: '#085041' },
    'Nominado':   { bg: '#EEEDFE', color: '#3C3489' },
    'En espera':  { bg: '#F3F4F6', color: '#6B7280' },
    'Rechazado':  { bg: '#FCEBEB', color: '#791F1F' },
  };

  function volAsignado(p) {
    return (p.despachos || []).reduce((s, d) => s + Number(d.volumen), 0);
  }
  function saldo(p) { return Number(p.volumen) - volAsignado(p); }
  function pct(p) { return Math.min(100, Math.round(volAsignado(p) / Number(p.volumen) * 100)); }

  function handleArchivosNuevos(pedidoId, files) {
    setArchivosNuevos(prev => ({
      ...prev,
      [pedidoId]: [...(prev[pedidoId] || []), ...Array.from(files)],
    }));
  }

  function quitarArchivoNuevo(pedidoId, nombre) {
    setArchivosNuevos(prev => ({
      ...prev,
      [pedidoId]: (prev[pedidoId] || []).filter(f => f.name !== nombre),
    }));
  }

  async function toggleVisibleTransportista(p, fileId, valorActual) {
    const adjuntosActualizados = (p.adjuntos || []).map(a =>
      a.file_id === fileId ? { ...a, visible_transportista: !valorActual } : a
    );
    await updateDoc(doc(db, 'pedidos_portal', p.docId), { adjuntos: adjuntosActualizados });
  }

  async function confirmarDespacho(pedidoId) {
    const nd = nuevoDespacho[pedidoId] || {};
    if (!nd.volumen || !nd.fecha_carga || !nd.transporte) {
      alert('Completá volumen, fecha de carga y transportista.');
      return;
    }
    const p = pedidos.find(x => x.id === pedidoId);
    const sal = saldo(p);
    if (Number(nd.volumen) > sal) {
      alert(`El volumen (${nd.volumen} tn) supera el saldo disponible (${sal} tn).`);
      return;
    }
    const fechaCarga = new Date(nd.fecha_carga + 'T00:00:00');
    const fechaEntrega = new Date(p.fecha_entrega + 'T00:00:00');
    if (fechaCarga > fechaEntrega) {
      alert('La fecha de carga no puede ser posterior a la fecha de entrega (' + p.fecha_entrega + ').');
      return;
    }
    setEnviando(true);
    try {
      let adjuntosActualizados = [...(p.adjuntos || [])];
      const archivosCoord = archivosNuevos[pedidoId] || [];
      if (archivosCoord.length > 0) {
        setSubiendoArchivos(true);
        for (const file of archivosCoord) {
          try {
            const resultado = await subirArchivo(file, p.id, usuario?.nombre || 'Coordinador');
            adjuntosActualizados.push(resultado);
          } catch (err) {
            console.error('Error subiendo ' + file.name + ':', err);
          }
        }
        setSubiendoArchivos(false);
        setArchivosNuevos(prev => ({ ...prev, [pedidoId]: [] }));
      }
      const now = new Date().toLocaleString('es-AR');
      const despacho = {
        id: 'D' + ((p.despachos || []).length + 1),
        volumen: Number(nd.volumen),
        fecha_carga: nd.fecha_carga,
        horario_carga: nd.horario_carga || '',
        transporte: nd.transporte,
        transporte_id: nd.transporte_id || '',
        email_transportista: nd.email_transportista || '',
        emails_extra: nd.emails_extra || [],
        telefonos: nd.telefonos || [],
        cuit_transporte: nd.cuit_transporte || '',
        estado: 'Programado',
        programado_por: usuario?.nombre || 'Coordinador',
        programado_en: now,
      };
      const nuevosDespachos = [...(p.despachos || []), despacho];
      const nuevoSaldo = Number(p.volumen) - nuevosDespachos.reduce((s, d) => s + Number(d.volumen), 0);
      const nuevoEstado = nuevoSaldo === 0 ? 'Programado' : 'prog-parcial';
      await updateDoc(doc(db, 'pedidos_portal', p.docId), {
        despachos: nuevosDespachos,
        estado: nuevoEstado,
        adjuntos: adjuntosActualizados,
      });
      const todosEmails = [nd.email_transportista, ...(nd.emails_extra || [])].filter(Boolean).join(',');
      const payload = {
        accion: 'programar_despacho',
        pedido_id: p.id,
        programado_por: usuario?.nombre || 'Coordinador',
        fecha_carga: nd.fecha_carga,
        horario_carga: nd.horario_carga || '',
        transporte: nd.transporte,
        email_transportista: todosEmails,
        tipo: p.tipo, producto: p.producto,
        volumen: Number(nd.volumen),
        cliente: p.cliente, ov: p.ov,
        lugar: p.lugar, banda_horaria: p.banda_horaria || '',
        fecha_entrega: p.fecha_entrega, obs: p.obs || '',
      };
      const params = new URLSearchParams({ payload: JSON.stringify(payload) });
      await fetch(APPS_SCRIPT_URL + '?' + params.toString(), { mode: 'no-cors' });
      setNuevoDespacho({ ...nuevoDespacho, [pedidoId]: {} });
      alert('✓ Despacho confirmado.');
    } catch (err) {
      console.error(err);
      alert('Error al confirmar el despacho: ' + err.message);
    } finally {
      setEnviando(false);
      setSubiendoArchivos(false);
    }
  }

  async function reprogramarDespacho(p, despachoIdx) {
    const key = p.id + '-' + despachoIdx;
    const rd = reprogramando[key] || {};
    if (!rd.fecha_carga) {
      alert('Ingresá la nueva fecha de carga.');
      return;
    }
    const fechaCarga = new Date(rd.fecha_carga + 'T00:00:00');
    const fechaEntrega = new Date(p.fecha_entrega + 'T00:00:00');
    if (fechaCarga > fechaEntrega) {
      alert('La fecha de carga no puede ser posterior a la fecha de entrega (' + p.fecha_entrega + ').');
      return;
    }
    setEnviando(true);
    try {
      const now = new Date().toLocaleString('es-AR');
      const nuevosDespachos = [...p.despachos];
      const despachoActual = nuevosDespachos[despachoIdx];
      nuevosDespachos[despachoIdx] = {
        ...despachoActual,
        estado: 'Programado',
        fecha_carga: rd.fecha_carga,
        horario_carga: rd.horario_carga || '',
        nominacion_pendiente: false,
        reprogramado_por: usuario?.nombre || 'Coordinador',
        reprogramado_en: now,
      };
      const hayEspera = nuevosDespachos.some(d => d.estado === 'En espera');
      const nuevoEstadoPedido = hayEspera ? 'prog-parcial' : 'Programado';
      await updateDoc(doc(db, 'pedidos_portal', p.docId), {
        despachos: nuevosDespachos,
        estado: nuevoEstadoPedido,
      });
      const todosEmails = [despachoActual.email_transportista, ...(despachoActual.emails_extra || [])].filter(Boolean).join(',');
      const payload = {
        accion: 'reprogramar_despacho',
        pedido_id: p.id,
        despacho_id: despachoActual.id || ('D' + (despachoIdx + 1)),
        email_transportista: todosEmails,
        transporte: despachoActual.transporte,
        producto: p.producto,
        volumen: despachoActual.volumen,
        cliente: p.cliente,
        ov: p.ov,
        lugar: p.lugar,
        fecha_carga: rd.fecha_carga,
        horario_carga: rd.horario_carga || '',
        reprogramado_por: usuario?.nombre || 'Coordinador',
      };
      const params = new URLSearchParams({ payload: JSON.stringify(payload) });
      await fetch(APPS_SCRIPT_URL + '?' + params.toString(), { mode: 'no-cors' });
      setReprogramando(prev => { const n = {...prev}; delete n[key]; return n; });
      alert('✓ Despacho reprogramado. Se notificó al transportista.');
    } catch (err) {
      console.error(err);
      alert('Error al reprogramar: ' + err.message);
    } finally {
      setEnviando(false);
    }
  }

  async function suspender(p) {
    const motivo = prompt('Motivo de la suspensión (requerido):');
    if (!motivo) return;
    const despachosAnteriores = p.despachos || [];
    await updateDoc(doc(db, 'pedidos_portal', p.docId), { estado: 'Suspendido' });
    const payload = {
      accion: 'suspender_pedido',
      id: p.id, motivo,
      suspendido_por: usuario?.nombre || '',
      estado_anterior: p.estado,
      tenia_programacion: despachosAnteriores.length > 0,
      producto: p.producto, volumen: p.volumen,
      cliente: p.cliente, ov: p.ov,
      fecha_entrega: p.fecha_entrega, lugar: p.lugar,
      email_transportista: despachosAnteriores[0]?.email_transportista || '',
      transporte: despachosAnteriores[0]?.transporte || '',
    };
    const params = new URLSearchParams({ payload: JSON.stringify(payload) });
    await fetch(APPS_SCRIPT_URL + '?' + params.toString(), { mode: 'no-cors' });
    alert('Pedido suspendido. Se notificó a los involucrados.');
  }

  const filtrados = pedidos.filter(p => filtro === 'todos' || p.estado === filtro);

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <div style={styles.logoArea}>
          <img src="/logo.png" alt="Explora" style={{ height: 32, objectFit: 'contain' }} />
          <span style={styles.portalText}>Programación</span>
        </div>
        <button style={styles.btnVolver} onClick={onVolver}>← Inicio</button>
      </div>

      <div style={styles.metrics}>
        {[
          ['Pendientes',    '#534AB7', 'Pendiente'],
          ['Prog. parcial', '#BA7517', 'prog-parcial'],
          ['Programados',   '#0F6E56', 'Programado'],
          ['Aceptados',     '#065F46', 'Aceptado'],
          ['Nominados',     '#3C3489', 'Nominado'],
          ['Suspendidos',   '#A32D2D', 'Suspendido'],
        ].map(([label, color, estado]) => (
          <div key={estado} style={styles.metric}>
            <div style={styles.metricLabel}>{label}</div>
            <div style={{ ...styles.metricValue, color }}>{pedidos.filter(p => p.estado === estado).length}</div>
          </div>
        ))}
      </div>

      <div style={styles.filtros}>
        {['todos', 'Pendiente', 'prog-parcial', 'Programado', 'Aceptado', 'Nominado', 'Suspendido'].map(f => (
          <button key={f}
            style={{ ...styles.filtroBtnBase, ...(filtro === f ? styles.filtroBtnActive : {}) }}
            onClick={() => setFiltro(f)}>
            {f === 'todos' ? 'Todos' : pillLabel[f] || f}
          </button>
        ))}
      </div>

      {cargando && <div style={styles.empty}>Cargando pedidos...</div>}
      {!cargando && filtrados.length === 0 && <div style={styles.empty}>Sin pedidos para mostrar.</div>}

      {!cargando && filtrados.map(p => (
        <div key={p.id} style={styles.card}>
          <div style={styles.cardHeader} onClick={() => setExpandido(expandido === p.id ? null : p.id)}>
            <span style={{ ...styles.pill, background: pillColors[p.estado]?.bg, color: pillColors[p.estado]?.color }}>
              {pillLabel[p.estado] || p.estado}
            </span>
            {p.editado && <span style={styles.badgeEditado}>Editado</span>}
            {tieneNominacionPendiente(p) && <span style={styles.badgeNomPendiente}>⏳ Nom. pendiente</span>}
            {tieneDespachoEnEspera(p) && <span style={styles.badgeEspera}>⏸ En espera</span>}
            <span style={styles.cardNro}>{p.id}</span>
            <span style={styles.cardResumen}>{p.cliente} · {p.producto} {p.volumen} tn</span>
            {proximaCarga(p) && <span style={styles.cardFechaCarga}>📦 {proximaCarga(p)}</span>}
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
                {p.banda_horaria && <div style={styles.field}><span style={styles.label}>Banda horaria entrega</span><span>{p.banda_horaria}</span></div>}
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
                        <button
                          style={{ ...styles.btnToggleVis, background: a.visible_transportista ? '#E1F5EE' : '#F3F4F6', color: a.visible_transportista ? '#085041' : '#6B7280' }}
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
                  return (
                    <div key={i} style={{
                      ...styles.despachoItem,
                      borderColor: d.estado === 'En espera' ? '#EF9F27' : d.estado === 'Aceptado' && d.nominacion_pendiente ? '#EF9F27' : '#E5E7EB',
                    }}>
                      <div style={styles.despachoHeader}>
                        <span style={styles.despachoNro}>Despacho {i + 1}</span>
                        <span style={{
                          ...styles.pill,
                          background: despachoColors[d.estado]?.bg || '#F3F4F6',
                          color: despachoColors[d.estado]?.color || '#6B7280',
                          fontSize: 10,
                        }}>
                          {d.estado}
                        </span>
                        {d.estado === 'Aceptado' && d.nominacion_pendiente && (
                          <span style={styles.badgeNomPendiente}>⏳ Nom. pendiente</span>
                        )}
                        <span style={styles.despachoPor}>por {d.programado_por} · {d.programado_en}</span>
                      </div>
                      <div style={styles.despachoGrid}>
                        <div style={styles.field}><span style={styles.label}>Volumen</span><span>{d.volumen} tn</span></div>
                        <div style={styles.field}><span style={styles.label}>Fecha de carga</span><span>{d.fecha_carga}</span></div>
                        {d.horario_carga && <div style={styles.field}><span style={styles.label}>Horario sugerido</span><span>{d.horario_carga}</span></div>}
                        <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Transportista</span><span>{d.transporte}</span></div>
                        {d.email_transportista && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Email</span><span>{d.email_transportista}</span></div>}
                        {(d.telefonos || []).length > 0 && (
                          <div style={{ ...styles.field, gridColumn: '1/-1' }}>
                            <span style={styles.label}>Teléfonos</span>
                            <span>{d.telefonos.join(' · ')}</span>
                          </div>
                        )}
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

                      {d.estado === 'En espera' && (
                        <div style={styles.reprogramarBox}>
                          <div style={styles.reprogramarTitulo}>🔄 Reprogramar despacho</div>
                          <div style={styles.reprogramarGrid}>
                            <div style={styles.formField}>
                              <label style={styles.formLabel}>Nueva fecha de carga * (≤ {p.fecha_entrega})</label>
                              <input style={styles.input} type="date"
                                max={p.fecha_entrega}
                                value={rd.fecha_carga || ''}
                                onChange={e => setReprogramando(prev => ({ ...prev, [key]: { ...prev[key], fecha_carga: e.target.value } }))} />
                            </div>
                            <div style={styles.formField}>
                              <label style={styles.formLabel}>Horario sugerido</label>
                              <input style={styles.input} type="text" placeholder="Ej: 08:00hs"
                                value={rd.horario_carga || ''}
                                onChange={e => setReprogramando(prev => ({ ...prev, [key]: { ...prev[key], horario_carga: e.target.value } }))} />
                            </div>
                          </div>
                          <button
                            style={{ ...styles.btnReprogramar, opacity: enviando ? 0.7 : 1 }}
                            disabled={enviando}
                            onClick={() => reprogramarDespacho(p, i)}>
                            {enviando ? 'Guardando...' : '✓ Confirmar reprogramación'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {saldo(p) > 0 && p.estado !== 'Suspendido' && (
                  <div style={styles.nuevoDespacho}>
                    <div style={styles.despachosTitle}>Nuevo despacho</div>
                    <div style={styles.despachoGrid}>
                      <div style={styles.formField}>
                        <label style={styles.formLabel}>Volumen (tn) — saldo: {saldo(p)} tn</label>
                        <input style={styles.input} type="number" placeholder={saldo(p)}
                          value={nuevoDespacho[p.id]?.volumen || ''}
                          onChange={e => setNuevoDespacho({ ...nuevoDespacho, [p.id]: { ...nuevoDespacho[p.id], volumen: e.target.value } })} />
                      </div>
                      <div style={styles.formField}>
                        <label style={styles.formLabel}>Fecha de carga (≤ {p.fecha_entrega})</label>
                        <input style={styles.input} type="date"
                          max={p.fecha_entrega}
                          value={nuevoDespacho[p.id]?.fecha_carga || ''}
                          onChange={e => setNuevoDespacho({ ...nuevoDespacho, [p.id]: { ...nuevoDespacho[p.id], fecha_carga: e.target.value } })} />
                      </div>
                      {p.tipo === 'Entrega al cliente' && (
                        <div style={styles.formField}>
                          <label style={styles.formLabel}>Horario de carga sugerido</label>
                          <input style={styles.input} type="text" placeholder="Ej: 08:00hs"
                            value={nuevoDespacho[p.id]?.horario_carga || ''}
                            onChange={e => setNuevoDespacho({ ...nuevoDespacho, [p.id]: { ...nuevoDespacho[p.id], horario_carga: e.target.value } })} />
                        </div>
                      )}
                      <div style={{ ...styles.formField, gridColumn: '1/-1' }}>
                        <label style={styles.formLabel}>Empresa transportista *</label>
                        <select style={styles.input}
                          value={nuevoDespacho[p.id]?.transporte_id || ''}
                          onChange={e => seleccionarTransportista(p.id, e.target.value)}>
                          <option value="">Seleccionar transportista...</option>
                          {transportistas.map(t => (
                            <option key={t.docId} value={t.docId}>{t.empresa}</option>
                          ))}
                        </select>
                      </div>
                      {nuevoDespacho[p.id]?.transporte && (
                        <div style={{ ...styles.transportistaPreview, gridColumn: '1/-1' }}>
                          <div style={styles.previewRow}><span style={styles.previewLabel}>Email 1</span><span>{nuevoDespacho[p.id]?.email_transportista || '—'}</span></div>
                          {(nuevoDespacho[p.id]?.emails_extra || []).map((em, i) => (
                            <div key={i} style={styles.previewRow}><span style={styles.previewLabel}>Email {i + 2}</span><span>{em}</span></div>
                          ))}
                          {(nuevoDespacho[p.id]?.telefonos || []).map((tel, i) => (
                            <div key={i} style={styles.previewRow}><span style={styles.previewLabel}>Teléfono {i + 1}</span><span>{tel}</span></div>
                          ))}
                          {nuevoDespacho[p.id]?.cuit_transporte && (
                            <div style={styles.previewRow}><span style={styles.previewLabel}>CUIT</span><span>{nuevoDespacho[p.id]?.cuit_transporte}</span></div>
                          )}
                        </div>
                      )}
                      <div style={{ ...styles.formField, gridColumn: '1/-1' }}>
                        <label style={styles.formLabel}>Adjuntos para el transportista</label>
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
                        <button type="button" style={styles.btnAdjuntar}
                          onClick={() => {
                            if (!fileRefs.current[p.id]) fileRefs.current[p.id] = document.createElement('input');
                            const input = fileRefs.current[p.id];
                            input.type = 'file'; input.multiple = true;
                            input.accept = '.pdf,.jpg,.jpeg,.png,.doc,.docx';
                            input.onchange = (e) => handleArchivosNuevos(p.id, e.target.files);
                            input.click();
                          }}>
                          📎 Adjuntar archivo
                        </button>
                      </div>
                    </div>
                    <button style={{ ...styles.btnConfirmar, opacity: (enviando || subiendoArchivos) ? 0.7 : 1 }}
                      disabled={enviando || subiendoArchivos}
                      onClick={() => confirmarDespacho(p.id)}>
                      {subiendoArchivos ? 'Subiendo archivos...' : enviando ? 'Enviando...' : '✓ Confirmar despacho'}
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
    </div>
  );
}

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
  badgeNomPendiente: { fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 20, background: '#FAEEDA', color: '#633806', border: '0.5px solid #EF9F27', flexShrink: 0 },
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
  despachoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 },
  reprogramarBox: { marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #EF9F27', background: '#FFFBF2', borderRadius: 8, padding: '10px 12px' },
  reprogramarTitulo: { fontSize: 11, fontWeight: 500, color: '#BA7517', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 },
  reprogramarGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, marginBottom: 10 },
  btnReprogramar: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#BA7517', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  nuevoDespacho: { border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '10px 12px', marginBottom: 8, background: '#fff' },
  formField: { display: 'flex', flexDirection: 'column', gap: 4 },
  formLabel: { fontSize: 11, color: '#6B7280' },
  input: { fontSize: 13, padding: '7px 9px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%' },
  transportistaPreview: { padding: '10px 12px', borderRadius: 8, background: '#F0FDF4', border: '0.5px solid #5DCAA5', display: 'flex', flexDirection: 'column', gap: 6 },
  previewRow: { display: 'flex', gap: 8, fontSize: 12, alignItems: 'center' },
  previewLabel: { fontSize: 11, color: '#6B7280', minWidth: 70 },
  btnConfirmar: { marginTop: 10, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  cardActions: { display: 'flex', gap: 8, marginTop: 12 },
  btnSuspender: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #A32D2D', background: '#fff', color: '#A32D2D', fontSize: 12, cursor: 'pointer' },
};

export default Coordinador;
