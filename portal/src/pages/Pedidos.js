import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, addDoc, doc, updateDoc, onSnapshot } from 'firebase/firestore';

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
        if (data.status === 'ok') {
          resolve(data.data);
        } else {
          reject(new Error(data.mensaje || 'Error subiendo archivo'));
        }
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Error leyendo archivo'));
    reader.readAsDataURL(file);
  });
}

function Pedidos({ usuario, onVolver }) {
  const [vista, setVista] = useState('panel');
  const [pedidos, setPedidos] = useState([]);
  const [pedidoEditando, setPedidoEditando] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [subiendoArchivos, setSubiendoArchivos] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [verTodos, setVerTodos] = useState(false);

  const [form, setForm] = useState({
    tipo: 'Entrega al cliente',
    producto: '',
    volumen: '',
    recipiente: 'Granel',
    cliente: '',
    telefono_prefijo: '',
    telefono_numero: '',
    ov_tipo: 'OV',
    ov_numero: '',
    fecha_entrega: '',
    banda_horaria: '',
    calle: '',
    numero: '',
    ciudad: '',
    provincia: '',
    cp: '',
    mapsLink: '',
    obs: '',
    adjuntos: [],
    archivosNuevos: [],
  });

  const fileRef = useRef();

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      const data = snap.docs
        .map(d => ({ docId: d.id, ...d.data() }))
        .filter(p => p.creado_por_email === usuario?.email)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setPedidos(data);
    });
    return () => unsub();
  }, [usuario]);

  function genNro() {
    const now = new Date();
    const y = String(now.getFullYear()).slice(-2);
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const r = String(Math.floor(Math.random() * 900) + 100);
    return `PED-${y}${m}${d}-${r}`;
  }

  function handleAdjuntos(e) {
    const files = Array.from(e.target.files);
    setForm(prev => ({ ...prev, archivosNuevos: [...prev.archivosNuevos, ...files] }));
  }

  function quitarArchivoNuevo(nombre) {
    setForm(prev => ({ ...prev, archivosNuevos: prev.archivosNuevos.filter(f => f.name !== nombre) }));
  }

  function quitarAdjuntoExistente(fileId) {
    setForm(prev => ({
      ...prev,
      adjuntos: prev.adjuntos.map(a => a.file_id === fileId ? { ...a, _eliminado: true } : a)
    }));
  }

  function checkMapsLink(val) {
    return val.includes('maps.google') || val.includes('goo.gl') || val.includes('maps.app');
  }

  function abrirMaps() {
    const query = [form.calle, form.numero, form.ciudad, form.provincia].filter(Boolean).join(', ') || 'Puerto General San Martín, Santa Fe';
    window.open('https://maps.google.com?q=' + encodeURIComponent(query), '_blank');
  }

  function getOV() {
    return `${form.ov_tipo}-${form.ov_numero}`;
  }

  function validarOV() {
    if (form.ov_tipo === 'OV') return /^\d{4}$/.test(form.ov_numero.trim());
    if (form.ov_tipo === 'OC') return /^\d{5}$/.test(form.ov_numero.trim());
    return false;
  }

  function maxDigitosOV() {
    return form.ov_tipo === 'OV' ? 4 : 5;
  }

  function validarTelefono() {
    const pre = form.telefono_prefijo.replace(/\D/g, '');
    const num = form.telefono_numero.replace(/\D/g, '');
    if (!pre && !num) return true;
    if (pre.length === 3 && num.length === 7) return true;
    if (pre.length === 4 && num.length === 6) return true;
    return false;
  }

  function validarFecha(fecha) {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const sel = new Date(fecha + 'T00:00:00');
    return sel > hoy;
  }

  function puedeEditar(p) {
    if (p.estado === 'Suspendido' || p.estado === 'Cumplido') return false;
    const nominados = (p.despachos || []).filter(d => d.estado === 'Nominado');
    if (nominados.length > 0) {
      const fechaCarga = nominados[0].fecha_carga;
      if (fechaCarga) {
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        const fc = new Date(fechaCarga + 'T00:00:00');
        if (fc < hoy) return false;
      }
    }
    return true;
  }

  function abrirEditar(p) {
    setPedidoEditando(p);
    const ovParts = (p.ov || 'OV-').split('-');
    setForm({
      tipo: p.tipo || 'Entrega al cliente',
      producto: p.producto || '',
      volumen: String(p.volumen || ''),
      recipiente: p.recipiente || 'Granel',
      cliente: p.cliente || '',
      telefono_prefijo: p.telefono_prefijo || '',
      telefono_numero: p.telefono_numero || '',
      ov_tipo: ovParts[0] || 'OV',
      ov_numero: ovParts[1] || '',
      fecha_entrega: p.fecha_entrega || '',
      banda_horaria: p.banda_horaria || '',
      calle: p.calle || '',
      numero: p.numero || '',
      ciudad: p.ciudad || '',
      provincia: p.provincia || '',
      cp: p.cp || '',
      mapsLink: p.mapsLink || '',
      obs: p.obs || '',
      adjuntos: p.adjuntos || [],
      archivosNuevos: [],
    });
    setVista('nuevo');
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!form.producto || !form.volumen || !form.cliente || !form.ov_numero || !form.fecha_entrega || !form.calle || !form.ciudad || !form.provincia) {
      alert('Completá todos los campos obligatorios');
      return;
    }
    if (!validarOV()) {
      alert(form.ov_tipo === 'OV'
        ? 'El número de OV debe tener exactamente 4 dígitos.'
        : 'El número de OC debe tener exactamente 5 dígitos.');
      return;
    }
    if (!validarFecha(form.fecha_entrega)) {
      alert('La fecha de entrega no puede ser el mismo día ni una fecha pasada.');
      return;
    }
    if (form.telefono_prefijo && !validarTelefono()) {
      alert('Teléfono: prefijo 3 dígitos → número 7. Prefijo 4 dígitos → número 6.');
      return;
    }

    const ahora = new Date().toLocaleString('es-AR');
    const ov = getOV();
    const lugar = [form.calle, form.numero, form.ciudad, form.provincia, form.cp].filter(Boolean).join(', ');
    const telefono = form.telefono_prefijo && form.telefono_numero
      ? `(${form.telefono_prefijo}) ${form.telefono_numero}` : '';

    setEnviando(true);
    try {
      const id = pedidoEditando ? pedidoEditando.id : genNro();

      let adjuntosFinales = (form.adjuntos || []).filter(a => !a._eliminado);
      if (form.archivosNuevos.length > 0) {
        setSubiendoArchivos(true);
        for (const file of form.archivosNuevos) {
          try {
            const resultado = await subirArchivo(file, id, usuario?.nombre || '');
            adjuntosFinales.push(resultado);
          } catch (err) {
            console.error('Error subiendo ' + file.name + ':', err);
            alert('Error subiendo ' + file.name + '. El resto del pedido se guardará igual.');
          }
        }
        setSubiendoArchivos(false);
      }

      if (pedidoEditando) {
        const despachosAnteriores = pedidoEditando.despachos || [];
        const teniaProgramacion = despachosAnteriores.length > 0;
        const despachosActualizados = despachosAnteriores.map(d => ({ ...d, estado: 'En espera' }));

        await updateDoc(doc(db, 'pedidos_portal', pedidoEditando.docId), {
          tipo: form.tipo, producto: form.producto,
          volumen: parseFloat(form.volumen), recipiente: form.recipiente,
          cliente: form.cliente, ov, telefono,
          telefono_prefijo: form.telefono_prefijo,
          telefono_numero: form.telefono_numero,
          fecha_entrega: form.fecha_entrega,
          banda_horaria: form.banda_horaria,
          lugar, calle: form.calle, numero: form.numero,
          ciudad: form.ciudad, provincia: form.provincia, cp: form.cp,
          mapsLink: form.mapsLink || '', obs: form.obs || '',
          adjuntos: adjuntosFinales,
          estado: 'Pendiente', editado: true,
          editado_en: ahora, editado_por: usuario?.nombre || '',
          creado_por_email: pedidoEditando.creado_por_email || usuario?.email || '',
          despachos: despachosActualizados,
        });

        const payload = {
          accion: 'editar_pedido',
          id: pedidoEditando.id,
          editado_por: usuario?.nombre || '',
          editado_en: ahora,
          estado_anterior: pedidoEditando.estado,
          tenia_programacion: teniaProgramacion,
          tipo: form.tipo, producto: form.producto,
          volumen: parseFloat(form.volumen),
          cliente: form.cliente, ov,
          fecha_entrega: form.fecha_entrega,
          banda_horaria: form.banda_horaria,
          lugar, obs: form.obs || '',
          email_transportista: despachosAnteriores[0]?.email_transportista || '',
          transporte: despachosAnteriores[0]?.transporte || '',
        };
        const params = new URLSearchParams({ payload: JSON.stringify(payload) });
        await fetch(APPS_SCRIPT_URL + '?' + params.toString(), { mode: 'no-cors' });
        alert(`✓ Pedido ${pedidoEditando.id} actualizado.`);
        setPedidoEditando(null);

      } else {
        const pedido = {
          id, estado: 'Pendiente', editado: false,
          creado_por: usuario?.nombre || 'Usuario',
          creado_por_email: usuario?.email || '',
          creado_en: ahora, editado_en: null, editado_por: null,
          tipo: form.tipo, producto: form.producto,
          volumen: parseFloat(form.volumen), recipiente: form.recipiente,
          cliente: form.cliente, ov, telefono,
          telefono_prefijo: form.telefono_prefijo,
          telefono_numero: form.telefono_numero,
          fecha_entrega: form.fecha_entrega,
          banda_horaria: form.banda_horaria,
          lugar, calle: form.calle, numero: form.numero,
          ciudad: form.ciudad, provincia: form.provincia, cp: form.cp,
          mapsLink: form.mapsLink || '', obs: form.obs || '',
          adjuntos: adjuntosFinales,
          despachos: [],
          timestamp: new Date().toISOString(),
        };

        await addDoc(collection(db, 'pedidos_portal'), pedido);

        const payload = { accion: 'nuevo_pedido', ...pedido };
        const params = new URLSearchParams({ payload: JSON.stringify(payload) });
        await fetch(APPS_SCRIPT_URL + '?' + params.toString(), { mode: 'no-cors' });
        alert(`✓ Pedido ${id} registrado. Se notificó al coordinador.`);
      }

      setVista('panel');
      setBusqueda('');
      setVerTodos(false);
      setForm({
        tipo: 'Entrega al cliente', producto: '', volumen: '', recipiente: 'Granel',
        cliente: '', telefono_prefijo: '', telefono_numero: '', ov_tipo: 'OV', ov_numero: '',
        fecha_entrega: '', banda_horaria: '', calle: '', numero: '', ciudad: '', provincia: '',
        cp: '', mapsLink: '', obs: '', adjuntos: [], archivosNuevos: [],
      });

    } catch (err) {
      console.error(err);
      alert('Error: ' + err.message);
    } finally {
      setEnviando(false);
      setSubiendoArchivos(false);
    }
  }

  async function suspender(p) {
    const motivo = prompt('Motivo de la suspensión (requerido):');
    if (!motivo) return;
    const despachosAnteriores = p.despachos || [];
    await updateDoc(doc(db, 'pedidos_portal', p.docId), {
      estado: 'Suspendido',
      suspendido_por: usuario?.nombre || '',
      suspendido_en: new Date().toLocaleString('es-AR'),
      motivo_suspension: motivo,
    });
    const payload = {
      accion: 'suspender_pedido', id: p.id, motivo,
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

  const pillColors = {
    Pendiente: { bg: '#EEEDFE', color: '#3C3489' },
    'prog-parcial': { bg: '#FAEEDA', color: '#633806' },
    Programado: { bg: '#E1F5EE', color: '#085041' },
    Nominado: { bg: '#E1F5EE', color: '#085041' },
    Suspendido: { bg: '#FCEBEB', color: '#791F1F' },
    Cumplido: { bg: '#E1F5EE', color: '#085041' },
  };

  const pillLabel = {
    Pendiente: 'Pendiente', 'prog-parcial': 'Prog. parcial',
    Programado: 'Programado', Nominado: 'Nominado',
    Suspendido: 'Suspendido', Cumplido: 'Cumplido',
  };

  const pedidosFiltrados = pedidos.filter(p => {
    if (!busqueda) return true;
    const q = busqueda.toLowerCase();
    return (
      p.id?.toLowerCase().includes(q) ||
      p.cliente?.toLowerCase().includes(q) ||
      p.producto?.toLowerCase().includes(q)
    );
  });

  const pedidosMostrados = busqueda ? pedidosFiltrados : (verTodos ? pedidosFiltrados : pedidosFiltrados.slice(0, 10));

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <div style={styles.logoArea}>
          <img src="/logo.png" alt="Explora" style={styles.logoImg} />
        </div>
        <button style={styles.btnVolver} onClick={onVolver}>← Inicio</button>
      </div>

      {vista === 'panel' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>Mis pedidos</h2>
            <button style={styles.btnPrimary} onClick={() => { setPedidoEditando(null); setVista('nuevo'); }}>
              + Nuevo pedido
            </button>
          </div>

          <input
            style={styles.buscador}
            type="text"
            placeholder="Buscar por N° pedido, cliente o producto..."
            value={busqueda}
            onChange={e => { setBusqueda(e.target.value); setVerTodos(false); }}
          />

          {pedidosMostrados.length === 0 && (
            <div style={styles.empty}>
              {busqueda ? 'Sin resultados para esa búsqueda.' : 'No tenés pedidos aún. Creá el primero.'}
            </div>
          )}

          {pedidosMostrados.map(p => (
            <div key={p.id} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={{ ...styles.pill, background: pillColors[p.estado]?.bg, color: pillColors[p.estado]?.color }}>
                  {pillLabel[p.estado] || p.estado}
                </span>
                {p.editado && <span style={styles.badgeEditado}>Editado</span>}
                <span style={styles.cardNro}>{p.id}</span>
                <span style={styles.cardResumen}>{p.cliente} · {p.producto} {p.volumen} tn</span>
                <span style={styles.cardFecha}>
                  {p.editado_en ? `Editado ${p.editado_en}` : `Creado ${p.creado_en}`}
                </span>
              </div>
              <div style={styles.cardBody}>
                <div style={styles.detailGrid}>
                  <div style={styles.field}><span style={styles.label}>Tipo</span><span>{p.tipo}</span></div>
                  <div style={styles.field}><span style={styles.label}>Producto</span><span>{p.producto}</span></div>
                  <div style={styles.field}><span style={styles.label}>Volumen</span><span>{p.volumen} tn</span></div>
                  <div style={styles.field}><span style={styles.label}>Recipiente</span><span>{p.recipiente}</span></div>
                  <div style={styles.field}><span style={styles.label}>Cliente / Proveedor</span><span>{p.cliente}</span></div>
                  <div style={styles.field}><span style={styles.label}>OV / OC</span><span>{p.ov}</span></div>
                  <div style={styles.field}><span style={styles.label}>Teléfono</span><span>{p.telefono || '—'}</span></div>
                  <div style={styles.field}><span style={styles.label}>Entrega comprometida</span><span>{p.fecha_entrega}</span></div>
                  {p.banda_horaria && <div style={styles.field}><span style={styles.label}>Banda horaria</span><span>{p.banda_horaria}</span></div>}
                  <div style={{ ...styles.field, gridColumn: '1/-1' }}>
                    <span style={styles.label}>Lugar</span>
                    <span>{p.lugar}{p.mapsLink && <a href={p.mapsLink} target="_blank" rel="noreferrer" style={styles.mapsLink}> 📍 Ver en Maps</a>}</span>
                  </div>
                  {p.obs && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Observaciones</span><span>{p.obs}</span></div>}
                  {p.motivo_suspension && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Motivo suspensión</span><span style={{ color: '#A32D2D' }}>{p.motivo_suspension}</span></div>}
                </div>
                {p.adjuntos?.filter(a => !a._eliminado).length > 0 && (
                  <div style={styles.adjuntosRow}>
                    {p.adjuntos.filter(a => !a._eliminado).map(a => (
                      <a key={a.file_id} href={a.link} target="_blank" rel="noreferrer" style={styles.adjuntoChip}>
                        📎 {a.nombre}
                      </a>
                    ))}
                  </div>
                )}
                <div style={styles.origen}>
                  Creado por <strong>{p.creado_por}</strong> · {p.creado_en}
                  {p.editado && <span> · Editado por <strong>{p.editado_por}</strong> · {p.editado_en}</span>}
                </div>
                {p.estado !== 'Cumplido' && p.estado !== 'Suspendido' && (
                  <div style={styles.cardActions}>
                    {puedeEditar(p) && <button style={styles.btnEditar} onClick={() => abrirEditar(p)}>✏️ Editar</button>}
                    <button style={styles.btnSuspender} onClick={() => suspender(p)}>Suspender</button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {!busqueda && !verTodos && pedidosFiltrados.length > 10 && (
            <button style={styles.btnVerTodos} onClick={() => setVerTodos(true)}>
              Ver todos los pedidos ({pedidosFiltrados.length})
            </button>
          )}
        </div>
      )}

      {vista === 'nuevo' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>{pedidoEditando ? 'Editar pedido' : 'Nuevo pedido'}</h2>
            <button style={styles.btnVolver} onClick={() => { setVista('panel'); setPedidoEditando(null); }}>← Volver</button>
          </div>
          {pedidoEditando && (
            <div style={styles.editandoBanner}>
              ✏️ Editando <strong>{pedidoEditando.id}</strong> — Estado: <strong>{pedidoEditando.estado}</strong>
            </div>
          )}
          <form onSubmit={handleSubmit} style={styles.form}>

            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Tipo de operación</div>
              <div style={styles.tipoGrid}>
                <button type="button" style={{ ...styles.tipoBtn, ...(form.tipo === 'Entrega al cliente' ? styles.tipoBtnActive : {}) }}
                  onClick={() => setForm({ ...form, tipo: 'Entrega al cliente' })}>Entrega al cliente</button>
                <button type="button" style={{ ...styles.tipoBtn, ...(form.tipo === 'Retiro de proveedor' ? styles.tipoBtnActive : {}) }}
                  onClick={() => setForm({ ...form, tipo: 'Retiro de proveedor' })}>Retiro de proveedor</button>
              </div>
            </div>

            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Producto y volumen</div>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Producto *</label>
                  <select style={styles.input} value={form.producto} onChange={e => setForm({ ...form, producto: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    <option>Biodiesel</option><option>EMAG</option><option>Glicerina</option>
                    <option>Sebo</option><option>HFFA Vegetal</option><option>Aceite</option><option>Otro</option>
                  </select>
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Volumen (tn) *</label>
                  <input style={styles.input} type="number" placeholder="Ej: 60"
                    value={form.volumen} onChange={e => setForm({ ...form, volumen: e.target.value })} />
                </div>
              </div>
              <div style={styles.formField}>
                <label style={styles.formLabel}>Tipo de recipiente</label>
                <div style={styles.tipoGrid}>
                  <button type="button" style={{ ...styles.tipoBtn, ...(form.recipiente === 'Granel' ? styles.tipoBtnActive : {}) }}
                    onClick={() => setForm({ ...form, recipiente: 'Granel' })}>🚛 Granel</button>
                  <button type="button" style={{ ...styles.tipoBtn, ...(form.recipiente === 'IBC' ? styles.tipoBtnActive : {}) }}
                    onClick={() => setForm({ ...form, recipiente: 'IBC' })}>📦 IBC</button>
                </div>
              </div>
            </div>

            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Datos comerciales</div>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Cliente / Proveedor *</label>
                  <input style={styles.input} type="text" placeholder="Ej: SINER"
                    value={form.cliente} onChange={e => setForm({ ...form, cliente: e.target.value })} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>OV / OC *</label>
                  <div style={styles.ovRow}>
                    <select style={{ ...styles.input, width: 80, flexShrink: 0 }}
                      value={form.ov_tipo}
                      onChange={e => setForm({ ...form, ov_tipo: e.target.value, ov_numero: '' })}>
                      <option>OV</option><option>OC</option>
                    </select>
                    <span style={styles.ovSep}>-</span>
                    <input style={{ ...styles.input, flex: 1 }}
                      type="text"
                      placeholder={form.ov_tipo === 'OV' ? '1234' : '12345'}
                      maxLength={maxDigitosOV()}
                      value={form.ov_numero}
                      onChange={e => setForm({ ...form, ov_numero: e.target.value.replace(/\D/g, '') })} />
                  </div>
                  {form.ov_numero && !validarOV() && (
                    <span style={styles.fieldError}>
                      {form.ov_tipo === 'OV' ? 'OV: exactamente 4 dígitos' : 'OC: exactamente 5 dígitos'}
                    </span>
                  )}
                </div>
              </div>
              <div style={styles.formField}>
                <label style={styles.formLabel}>Teléfono de contacto</label>
                <div style={styles.telRow}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 0 110px' }}>
                    <input style={styles.input} type="text" placeholder="Prefijo" maxLength={4}
                      value={form.telefono_prefijo}
                      onChange={e => setForm({ ...form, telefono_prefijo: e.target.value.replace(/\D/g, '') })} />
                    <span style={styles.telHint}>Sin 0 · 3 o 4 dígitos</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <input style={styles.input} type="text" placeholder="Número" maxLength={7}
                      value={form.telefono_numero}
                      onChange={e => setForm({ ...form, telefono_numero: e.target.value.replace(/\D/g, '') })} />
                    <span style={styles.telHint}>Sin 15 · 6 o 7 dígitos</span>
                  </div>
                </div>
                {form.telefono_prefijo && !validarTelefono() && (
                  <span style={styles.fieldError}>Prefijo 3 dígitos → número 7 · Prefijo 4 dígitos → número 6</span>
                )}
              </div>
            </div>

            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Logística</div>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Fecha de entrega comprometida *</label>
                  <input style={styles.input} type="date"
                    value={form.fecha_entrega}
                    min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                    onChange={e => setForm({ ...form, fecha_entrega: e.target.value })} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Banda horaria de entrega</label>
                  <select style={styles.input} value={form.banda_horaria}
                    onChange={e => setForm({ ...form, banda_horaria: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    <option>Mañana (6-12hs)</option>
                    <option>Tarde (12-18hs)</option>
                    <option>Noche (18-24hs)</option>
                    <option>A confirmar</option>
                  </select>
                </div>
              </div>
              <div style={{ ...styles.formField, marginTop: 4 }}>
                <label style={styles.formLabel}>Lugar de entrega / origen *</label>
                <div style={styles.grid2}>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Calle *</label>
                    <input style={styles.input} type="text" placeholder="Nombre de la calle"
                      value={form.calle} onChange={e => setForm({ ...form, calle: e.target.value })} />
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Nº</label>
                    <input style={styles.input} type="text" placeholder="Número"
                      value={form.numero} onChange={e => setForm({ ...form, numero: e.target.value })} />
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Ciudad *</label>
                    <input style={styles.input} type="text" placeholder="Ciudad"
                      value={form.ciudad} onChange={e => setForm({ ...form, ciudad: e.target.value })} />
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Provincia *</label>
                    <input style={styles.input} type="text" placeholder="Provincia"
                      value={form.provincia} onChange={e => setForm({ ...form, provincia: e.target.value })} />
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>CP</label>
                    <input style={styles.input} type="text" placeholder="Código postal" maxLength={8}
                      value={form.cp} onChange={e => setForm({ ...form, cp: e.target.value })} />
                  </div>
                </div>
                <div style={styles.mapsRow}>
                  <input style={{ ...styles.input, flex: 1 }} type="text"
                    placeholder="O pegar enlace de Google Maps..."
                    value={form.mapsLink} onChange={e => setForm({ ...form, mapsLink: e.target.value })} />
                  <button type="button" style={styles.btnMaps} onClick={abrirMaps}>📍 Buscar en Maps</button>
                </div>
                {checkMapsLink(form.mapsLink) && <div style={styles.mapsPreview}>✓ Enlace de Google Maps vinculado</div>}
              </div>
            </div>

            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Observaciones y adjuntos</div>
              <textarea style={{ ...styles.textarea, width: '100%', marginBottom: 10 }}
                placeholder="Información adicional, requerimientos especiales..."
                value={form.obs} onChange={e => setForm({ ...form, obs: e.target.value })} />

              {form.adjuntos?.filter(a => !a._eliminado).length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={styles.adjuntosLabel}>Adjuntos existentes:</div>
                  <div style={styles.adjuntosRow}>
                    {form.adjuntos.filter(a => !a._eliminado).map(a => (
                      <div key={a.file_id} style={styles.adjuntoChipEditable}>
                        <a href={a.link} target="_blank" rel="noreferrer" style={{ color: '#3C3489', textDecoration: 'none', fontSize: 11 }}>📎 {a.nombre}</a>
                        <button type="button" onClick={() => quitarAdjuntoExistente(a.file_id)} style={styles.adjuntoQuitar}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {form.archivosNuevos.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={styles.adjuntosLabel}>Archivos a subir:</div>
                  <div style={styles.adjuntosRow}>
                    {form.archivosNuevos.map(f => (
                      <div key={f.name} style={styles.adjuntoChipEditable}>
                        <span style={{ fontSize: 11 }}>📎 {f.name}</span>
                        <button type="button" onClick={() => quitarArchivoNuevo(f.name)} style={styles.adjuntoQuitar}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button type="button" style={styles.btnAdjuntar} onClick={() => fileRef.current.click()}>
                📎 Adjuntar archivo
              </button>
              <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                style={{ display: 'none' }} onChange={handleAdjuntos} />
            </div>

            <div style={styles.formActions}>
              <button type="submit"
                style={{ ...styles.btnPrimary, padding: '11px', fontSize: 14, opacity: (enviando || subiendoArchivos) ? 0.7 : 1 }}
                disabled={enviando || subiendoArchivos}>
                {subiendoArchivos ? 'Subiendo archivos...' : enviando ? 'Enviando...' : pedidoEditando ? 'Guardar cambios' : 'Confirmar pedido'}
              </button>
              <button type="button" style={styles.btnCancelar}
                onClick={() => { setVista('panel'); setPedidoEditando(null); }}>
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem' },
  logoArea: { display: 'flex', alignItems: 'center' },
  logoImg: { height: 36, objectFit: 'contain' },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
  titulo: { fontSize: 18, fontWeight: 500, color: '#111827' },
  btnPrimary: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  buscador: { width: '100%', fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', marginBottom: '1rem', boxSizing: 'border-box' },
  empty: { textAlign: 'center', padding: '2rem', color: '#9CA3AF', fontSize: 13 },
  btnVerTodos: { width: '100%', padding: '10px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#F9FAFB', color: '#6B7280', fontSize: 13, cursor: 'pointer', marginTop: 8 },
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: '#F9FAFB', flexWrap: 'wrap' },
  pill: { fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, flexShrink: 0 },
  badgeEditado: { fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#FEF3C7', color: '#92400E', border: '0.5px solid #F59E0B', flexShrink: 0 },
  cardNro: { fontSize: 13, fontWeight: 500, color: '#111827', flexShrink: 0 },
  cardResumen: { fontSize: 12, color: '#6B7280', flex: 1 },
  cardFecha: { fontSize: 11, color: '#9CA3AF', flexShrink: 0 },
  cardBody: { padding: '12px 14px' },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 3 },
  label: { fontSize: 11, color: '#9CA3AF' },
  mapsLink: { color: '#C8102E', textDecoration: 'none', marginLeft: 6, fontSize: 12 },
  adjuntosRow: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  adjuntosLabel: { fontSize: 11, color: '#9CA3AF', marginBottom: 4 },
  adjuntoChip: { display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, background: '#F3F4F6', border: '0.5px solid #E5E7EB', fontSize: 11, color: '#3C3489', textDecoration: 'none' },
  adjuntoChipEditable: { display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 8, background: '#F3F4F6', border: '0.5px solid #E5E7EB' },
  adjuntoQuitar: { border: 'none', background: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 11, padding: 0 },
  origen: { fontSize: 12, color: '#6B7280', padding: '8px 10px', background: '#F9FAFB', borderRadius: 8, marginBottom: 10 },
  cardActions: { display: 'flex', gap: 8 },
  btnEditar: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #C8102E', background: '#fff', color: '#C8102E', fontSize: 12, cursor: 'pointer' },
  btnSuspender: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #A32D2D', background: '#fff', color: '#A32D2D', fontSize: 12, cursor: 'pointer' },
  form: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, padding: '1.5rem' },
  editandoBanner: { padding: '10px 14px', borderRadius: 8, background: '#FEF3C7', border: '0.5px solid #F59E0B', fontSize: 13, color: '#92400E', marginBottom: 16 },
  seccion: { marginBottom: '1.5rem' },
  seccionTitulo: { fontSize: 12, fontWeight: 500, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: '0.5px solid #F3F4F6' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 },
  formField: { display: 'flex', flexDirection: 'column', gap: 5 },
  formLabel: { fontSize: 13, color: '#6B7280', fontWeight: 500 },
  input: { fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%', boxSizing: 'border-box' },
  textarea: { fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', minHeight: 80, resize: 'vertical' },
  tipoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  tipoBtn: { padding: '10px 8px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  tipoBtnActive: { border: '1.5px solid #C8102E', background: '#FDECEA', color: '#C8102E' },
  ovRow: { display: 'flex', alignItems: 'center', gap: 6 },
  ovSep: { fontSize: 16, color: '#6B7280', fontWeight: 500, flexShrink: 0 },
  telRow: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  telHint: { fontSize: 10, color: '#9CA3AF', marginTop: 2 },
  fieldError: { fontSize: 11, color: '#C8102E', marginTop: 2 },
  mapsRow: { display: 'flex', gap: 8, marginTop: 8 },
  btnMaps: { display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 },
  mapsPreview: { fontSize: 12, color: '#085041', background: '#E1F5EE', border: '0.5px solid #5DCAA5', padding: '6px 10px', borderRadius: 8, marginTop: 6 },
  btnAdjuntar: { padding: '8px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  formActions: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: '1.5rem' },
  btnCancelar: { padding: '11px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#111827', fontSize: 14, cursor: 'pointer' },
};

export default Pedidos;
