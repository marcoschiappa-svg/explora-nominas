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
  const [busqueda, setBusqueda] = useState('');
  const [expandido, setExpandido] = useState(null);
  const [aceptando, setAceptando] = useState({});
  const [asignando, setAsignando] = useState({});
  const [reprogramando, setReprogramando] = useState({});
  const [editandoDespacho, setEditandoDespacho] = useState({});
  const [aceptandoEntrega, setAceptandoEntrega] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [subiendoArchivos, setSubiendoArchivos] = useState(false);
  const [archivosNuevos, setArchivosNuevos] = useState({});
  const fileRefs = useRef({});

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

  function volAsignado(p) { return (p.despachos || []).reduce((s, d) => s + Number(d.volumen), 0); }
  function saldo(p) { return Number(p.volumen) - volAsignado(p); }
  function pct(p) { return Math.min(100, Math.round(volAsignado(p) / Number(p.volumen) * 100)); }
  function tieneNominacionPendiente(p) { return (p.despachos || []).some(d => d.estado === 'Aceptado-pendiente' || (d.estado === 'Aceptado' && d.nominacion_pendiente)); }
  function tieneDespachoEnEspera(p) { return (p.despachos || []).some(d => d.estado === 'En espera'); }
  function proximaCarga(p) { const fechas = (p.despachos || []).filter(d => d.fecha_carga && d.estado !== 'En espera').map(d => d.fecha_carga).sort(); return fechas[0] || null; }
  function despachoDeEntrega(p, entregaIdx) { return (p.despachos || []).find(d => d.entrega_nro === entregaIdx + 1); }
  function estadoEntrega(p, entregaIdx) {
    const d = despachoDeEntrega(p, entregaIdx);
    if (!d) return 'sin_aceptar';
    return d.estado;
  }

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

  function seleccionarTransportistaEdit(key, docId) {
    const t = transportistas.find(x => x.docId === docId);
    if (!t) { setEditandoDespacho(prev => ({ ...prev, [key]: { ...prev[key], transporte_id: '', transporte: '', email_transportista: '', emails_extra: [], telefonos: [] } })); return; }
    const emails = [t.email_1, t.email_2, t.email_3].filter(Boolean);
    const telefonos = [
      t.prefijo_1 && t.numero_1 ? `(${t.prefijo_1}) ${t.numero_1}` : null,
      t.prefijo_2 && t.numero_2 ? `(${t.prefijo_2}) ${t.numero_2}` : null,
      t.prefijo_3 && t.numero_3 ? `(${t.prefijo_3}) ${t.numero_3}` : null,
    ].filter(Boolean);
    setEditandoDespacho(prev => ({ ...prev, [key]: { ...prev[key], transporte_id: t.docId, transporte: t.empresa || t.nombre, email_transportista: emails[0] || '', emails_extra: emails.slice(1), telefonos, cuit_transporte: t.cuit_empresa || '' } }));
  }

  async function guardarEdicionDespacho(p, despachoIdx) {
    const key = p.id + '-' + despachoIdx;
    const ed = editandoDespacho[key] || {};
    if (!ed.fecha_carga) { alert('La fecha de carga es obligatoria.'); return; }
    if (new Date(ed.fecha_carga + 'T00:00:00') > new Date(p.fecha_entrega + 'T00:00:00')) { alert('La fecha de carga no puede ser posterior a la fecha de entrega.'); return; }
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

  function cancelarEdicionDespacho(key) {
    setEditandoDespacho(prev => { const n = {...prev}; delete n[key]; return n; });
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

  async function aceptarEntrega(p, entregaIdx) {
    const key = p.id + '-ent-' + entregaIdx;
    const ae = aceptandoEntrega[key] || {};
    if (!ae.fecha_carga) { alert('Ingresá la fecha de carga.'); return; }
    if (!ae.volumen || Number(ae.volumen) <= 0) { alert('Ingresá el volumen.'); return; }
    if (new Date(ae.fecha_carga + 'T00:00:00') > new Date(p.fecha_entrega + 'T00:00:00')) {
      alert('La fecha de carga no puede ser posterior a la fecha de entrega (' + p.fecha_entrega + ').'); return;
    }
    const esSinTransportista = sinTransportista(p.tipo);
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

  const busquedaLower = busqueda.toLowerCase();
  const filtrados = pedidos.filter(p => {
    const matchEstado = filtro === 'todos' || p.estado === filtro;
    const matchBusqueda = !busqueda ||
      (p.cliente || '').toLowerCase().includes(busquedaLower) ||
      (p.ov || '').toLowerCase().includes(busquedaLower);
    return matchEstado && matchBusqueda;
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

      {!cargando && filtrados.map(p => (
        <div key={p.id} style={styles.card}>
          <div style={styles.cardHeader} onClick={() => setExpandido(expandido === p.id ? null : p.id)}>
            <span style={{ ...styles.pill, background: pillColors[p.estado]?.bg, color: pillColors[p.estado]?.color }}>{pillLabel[p.estado] || p.estado}</span>
            {p.editado && <span style={styles.badgeEditado}>Editado</span>}
            {tieneNominacionPendiente(p) && <span style={styles.badgeNomPendiente}>⏳ Pend. transporte</span>}
            {tieneDespachoEnEspera(p) && <span style={styles.badgeEspera}>⏸ En espera</span>}
            <div style={styles.cardInfo}>
              <span style={styles.cardOV}>{p.ov}</span>
              <div style={styles.cardSecundario}>
                <span style={styles.cardCliente}>{p.cliente}</span>
                <span style={styles.cardDot}>·</span>
                <span style={styles.cardProducto}>{p.producto} {p.volumen} tn</span>
                <span style={styles.cardDot}>·</span>
                <span style={styles.cardEntrega}>Entrega: {p.fecha_entrega}</span>
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
                  <div style={{ ...styles.barFill, width: `${pct(p)}%`, background: pct(p) < 100 ? '#EF9F27' : '#0F6E56' }}></div>
                </div>
                <div style={{ fontSize: 11, color: saldo(p) === 0 ? '#0F6E56' : '#BA7517', marginTop: 4 }}>
                  {saldo(p) === 0 ? '✓ Volumen completo' : `Saldo pendiente: ${saldo(p)} tn`}
                </div>
              </div>

              {(p.cronograma || []).length > 0 && (
                <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '0.5px solid #E5E7EB' }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: '#0F6E56', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Cronograma de entregas</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {(p.cronograma || []).map((e, ei) => {
                      const keyEnt = p.id + '-ent-' + ei;
                      const ae = aceptandoEntrega[keyEnt] || {};
                      const desp = despachoDeEntrega(p, ei);
                      const estEnt = estadoEntrega(p, ei);
                      const colorBorder = estEnt === 'Programado' || estEnt === 'Nominado' ? '#5DCAA5' : estEnt === 'Aceptado-pendiente' ? '#F59E0B' : '#E5E7EB';
                      const colorBg = estEnt === 'Programado' || estEnt === 'Nominado' ? '#F0FDF4' : estEnt === 'Aceptado-pendiente' ? '#FFFBF2' : '#F9FAFB';
                      return (
                        <div key={ei} style={{ border: '0.5px solid ' + colorBorder, borderRadius: 8, padding: '10px 12px', background: colorBg }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: desp || aceptandoEntrega[keyEnt] !== undefined ? 8 : 0 }}>
                            <span style={{ fontSize: 11, fontWeight: 500, color: '#6B7280' }}>Entrega N°{e.nro}</span>
                            {estEnt === 'sin_aceptar' && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280', border: '0.5px solid #E5E7EB' }}>Sin aceptar</span>}
                            {estEnt !== 'sin_aceptar' && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: despachoColors[estEnt]?.bg || '#F3F4F6', color: despachoColors[estEnt]?.color || '#6B7280', border: '0.5px solid #E5E7EB' }}>{despachoLabel[estEnt] || estEnt}</span>}
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
                          </div>
                          {desp && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, fontSize: 12 }}>
                              <div><span style={{ fontSize: 10, color: '#9CA3AF', display: 'block' }}>Fecha carga</span><span style={{ fontWeight: 500, color: estEnt === 'Programado' || estEnt === 'Nominado' ? '#0F6E56' : '#BA7517' }}>{desp.fecha_carga}</span></div>
                              {desp.transporte && desp.transporte !== '—' && <div><span style={{ fontSize: 10, color: '#9CA3AF', display: 'block' }}>Transportista</span><span style={{ fontWeight: 500, color: '#111827' }}>{desp.transporte}</span></div>}
                              {desp.chofer && <div><span style={{ fontSize: 10, color: '#9CA3AF', display: 'block' }}>Chofer</span><span style={{ fontWeight: 500, color: '#111827' }}>{desp.chofer}</span></div>}
                            </div>
                          )}
                          {aceptandoEntrega[keyEnt] !== undefined && estEnt === 'sin_aceptar' && (
                            <div style={{ marginTop: 10, padding: '10px 12px', background: '#EFF6FF', border: '0.5px solid #93C5FD', borderRadius: 8 }}>
                              <div style={{ fontSize: 10, fontWeight: 500, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Aceptar entrega</div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 8 }}>
                                <div style={styles.formField}>
                                  <label style={styles.formLabel}>Volumen (tn) *</label>
                                  <input style={styles.input} type="number" placeholder={e.volumen}
                                    value={ae.volumen || ''} onChange={ev => setAceptandoEntrega(prev => ({ ...prev, [keyEnt]: { ...prev[keyEnt], volumen: ev.target.value } }))} />
                                </div>
                                <div style={styles.formField}>
                                  <label style={styles.formLabel}>Fecha de carga *</label>
                                  <input style={styles.input} type="date" max={p.fecha_entrega}
                                    value={ae.fecha_carga || ''} onChange={ev => setAceptandoEntrega(prev => ({ ...prev, [keyEnt]: { ...prev[keyEnt], fecha_carga: ev.target.value } }))} />
                                  <span style={{ fontSize: 10, color: '#9CA3AF' }}>máx. {p.fecha_entrega}</span>
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
                                {enviando ? 'Guardando...' : '✓ Confirmar entrega'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 8, padding: '8px 10px', background: '#F9FAFB', borderRadius: 8, border: '0.5px solid #E5E7EB', fontSize: 12, display: 'flex', gap: 16 }}>
                    <span style={{ color: '#6B7280' }}>Aceptado: <strong style={{ color: '#111827' }}>{volAsignado(p)} tn</strong></span>
                    <span style={{ color: '#6B7280' }}>Saldo: <strong style={{ color: saldo(p) > 0 ? '#BA7517' : '#0F6E56' }}>{saldo(p)} tn</strong></span>
                  </div>
                </div>
              )}

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

                {saldo(p) > 0 && p.estado !== 'Suspendido' && !tieneNominacionPendiente(p) && (
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
  filtros: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: '0.75rem' },
  filtroBtnBase: { padding: '6px 14px', borderRadius: 20, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer' },
  filtroBtnActive: { background: '#FDECEA', borderColor: '#C8102E', color: '#C8102E', fontWeight: 500 },
  buscadorWrap: { position: 'relative', marginBottom: '1rem' },
  buscador: { width: '100%', fontSize: 13, padding: '8px 32px 8px 12px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', background: '#fff', boxSizing: 'border-box' },
  btnLimpiar: { position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 13, padding: '0 4px' },
  empty: { textAlign: 'center', padding: '2rem', color: '#9CA3AF', fontSize: 13 },
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer', flexWrap: 'wrap', background: '#F9FAFB' },
  pill: { fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, flexShrink: 0 },
  badgeEditado: { fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#FEF3C7', color: '#92400E', border: '0.5px solid #F59E0B', flexShrink: 0 },
  badgeNomPendiente: { fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 20, background: '#FEF3C7', color: '#92400E', border: '0.5px solid #F59E0B', flexShrink: 0 },
  badgeEspera: { fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280', border: '0.5px solid #D1D5DB', flexShrink: 0 },
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
  btnEditarDespacho: { fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', cursor: 'pointer', marginLeft: 'auto' },
  editarDespachoBox: { marginTop: 12, paddingTop: 12, borderTop: '0.5px solid #93C5FD', background: '#EFF6FF', borderRadius: 8, padding: '10px 12px' },
  editarDespachoTitulo: { fontSize: 11, fontWeight: 500, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10 },
  btnCancelarEdicion: { padding: '8px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
};

export default Coordinador;

