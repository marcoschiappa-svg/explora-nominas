import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { db } from '../firebase';
import { collection, addDoc, doc, updateDoc, onSnapshot } from 'firebase/firestore';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzXOlu0PUTAVubDJCXh7WxjZp1ruCH5SMu9YmWbFCNF2ff7l5mn447nV8BIWbQ5-Mz-uQ/exec';

const PRODUCTOS_VALIDOS  = ['Biodiesel','EMAG','Glicerina','Sebo','HFFA Vegetal','Aceite','Otro'];
const TIPOS_VALIDOS      = ['Retiro del cliente','Entrega al cliente'];
const OV_TIPOS_VALIDOS   = ['OV','OC'];
const BANDAS_VALIDAS     = ['Mañana (6-12hs)','Tarde (12-18hs)','Noche (18-24hs)','A confirmar',''];
const COLS_ESPERADAS     = [
  'tipo','producto','volumen','recipiente','cliente',
  'ov_tipo','ov_numero','fecha_entrega','banda_horaria',
  'calle','numero_calle','ciudad','provincia','cp','maps_link','obs'
];
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

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

function genNro() {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const m = String(now.getMonth()+1).padStart(2,'0');
  const d = String(now.getDate()).padStart(2,'0');
  const r = String(Math.floor(Math.random()*900)+100);
  return `PED-${y}${m}${d}-${r}`;
}

function validarFila(fila) {
  const err = [];
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  if (!TIPOS_VALIDOS.includes(fila.tipo))             err.push('Tipo inválido');
  if (!PRODUCTOS_VALIDOS.includes(fila.producto))     err.push('Producto inválido');
  if (!fila.volumen || isNaN(Number(fila.volumen)) || Number(fila.volumen) <= 0) err.push('Volumen inválido');
  if (!fila.cliente?.trim())                          err.push('Cliente requerido');
  if (!OV_TIPOS_VALIDOS.includes(fila.ov_tipo))      err.push('Tipo OV/OC inválido');
  if (fila.ov_tipo==='OV' && !/^\d{4}$/.test(String(fila.ov_numero||'').trim())) err.push('OV: 4 dígitos');
  if (fila.ov_tipo==='OC' && !/^\d{5}$/.test(String(fila.ov_numero||'').trim())) err.push('OC: 5 dígitos');
  if (!fila.fecha_entrega?.trim())                    err.push('Fecha requerida');
  else {
    const f = new Date(fila.fecha_entrega+'T00:00:00');
    if (isNaN(f.getTime()))  err.push('Fecha inválida (usar AAAA-MM-DD)');
    else if (f <= hoy)       err.push('Fecha debe ser futura');
  }
  if (!fila.calle?.trim())    err.push('Calle requerida');
  if (!fila.ciudad?.trim())   err.push('Ciudad requerida');
  if (!fila.provincia?.trim()) err.push('Provincia requerida');
  if (fila.banda_horaria && !BANDAS_VALIDAS.includes(fila.banda_horaria)) err.push('Banda horaria inválida');
  return err;
}

function Pedidos({ usuario, onVolver }) {
  const [vista, setVista] = useState('panel');
  const [pedidos, setPedidos] = useState([]);
  const [expandido, setExpandido] = useState(null);
  const [pedidoEditando, setPedidoEditando] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [subiendoArchivos, setSubiendoArchivos] = useState(false);

  const [fCreador, setFCreador] = useState('');
  const [fProducto, setFProducto] = useState('');
  const [fCliente, setFCliente] = useState('');
  const [fRecipiente, setFRecipiente] = useState('');
  const [fMesEntrega, setFMesEntrega] = useState('');
  const [fAnioEntrega, setFAnioEntrega] = useState('');
  const [fMesCreacion, setFMesCreacion] = useState('');
  const [fAnioCreacion, setFAnioCreacion] = useState('');

  const [sugerenciaCliente, setSugerenciaCliente] = useState(null);
  const [clientesSugeridos, setClientesSugeridos] = useState([]);
  const [mostrarDropCliente, setMostrarDropCliente] = useState(false);
  const clienteRef = useRef();

  const [filasCarga, setFilasCarga] = useState([]);
  const [erroresCarga, setErroresCarga] = useState({});
  const [enviandoMasivo, setEnviandoMasivo] = useState(false);
  const [resultadoMasivo, setResultadoMasivo] = useState(null);
  const fileMasivoRef = useRef();

  const [form, setForm] = useState({
    tipo: 'Retiro del cliente', producto: '', volumen: '', recipiente: 'Granel',
    cliente: '', telefono_prefijo: '', telefono_numero: '',
    ov_tipo: 'OV', ov_numero: '', fecha_entrega: '', banda_horaria: '',
    calle: '', numero: '', ciudad: '', provincia: '', cp: '', mapsLink: '', obs: '',
    adjuntos: [], archivosNuevos: [],
  });
  const fileRef = useRef();
  const rol = usuario?.rol || '';

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      const data = snap.docs
        .map(d => ({ docId: d.id, ...d.data() }))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setPedidos(data);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = form.cliente.trim().toLowerCase();
    if (!q || q.length < 2) { setClientesSugeridos([]); setSugerenciaCliente(null); setMostrarDropCliente(false); return; }
    const misPedidos = pedidos.filter(p => p.creado_por_email === usuario?.email);
    const mapaClientes = {};
    misPedidos.forEach(p => {
      const nombre = (p.cliente||'').trim();
      if (!nombre) return;
      if (!mapaClientes[nombre] || new Date(p.timestamp) > new Date(mapaClientes[nombre].timestamp)) mapaClientes[nombre] = p;
    });
    const coincidencias = Object.values(mapaClientes).filter(p => p.cliente.toLowerCase().includes(q));
    setClientesSugeridos(coincidencias);
    setMostrarDropCliente(coincidencias.length > 0);
    const exacto = coincidencias.find(p => p.cliente.toLowerCase() === q);
    setSugerenciaCliente(exacto || null);
  }, [form.cliente, pedidos, usuario]);

  function aplicarMemoria(ref) {
    const ovParts = (ref.ov||'OV-').split('-');
    setForm(prev => ({
      ...prev, cliente: ref.cliente,
      producto: ref.producto||prev.producto, recipiente: ref.recipiente||prev.recipiente,
      telefono_prefijo: ref.telefono_prefijo||prev.telefono_prefijo,
      telefono_numero: ref.telefono_numero||prev.telefono_numero,
      banda_horaria: ref.banda_horaria||prev.banda_horaria,
      calle: ref.calle||prev.calle, numero: ref.numero||prev.numero,
      ciudad: ref.ciudad||prev.ciudad, provincia: ref.provincia||prev.provincia,
      cp: ref.cp||prev.cp, mapsLink: ref.mapsLink||prev.mapsLink,
      ov_tipo: ovParts[0]||prev.ov_tipo,
    }));
    setSugerenciaCliente(null); setClientesSugeridos([]); setMostrarDropCliente(false);
  }

  const creadores = [...new Set(pedidos.map(p => p.creado_por).filter(Boolean))].sort();
  const productos = [...new Set(pedidos.map(p => p.producto).filter(Boolean))].sort();
  const clientes  = [...new Set(pedidos.map(p => p.cliente).filter(Boolean))].sort();
  const aniosEntrega  = [...new Set(pedidos.map(p => p.fecha_entrega?.slice(0,4)).filter(Boolean))].sort().reverse();
  const aniosCreacion = [...new Set(pedidos.map(p => p.timestamp?.slice(0,4)).filter(Boolean))].sort().reverse();

  const pedidosFiltrados = pedidos.filter(p => {
    if (fCreador && p.creado_por !== fCreador) return false;
    if (fProducto && p.producto !== fProducto) return false;
    if (fCliente && p.cliente !== fCliente) return false;
    if (fRecipiente && p.recipiente !== fRecipiente) return false;
    if (fMesEntrega && p.fecha_entrega) {
      const mes = parseInt(p.fecha_entrega.slice(5,7), 10);
      if (mes !== parseInt(fMesEntrega, 10)) return false;
    }
    if (fAnioEntrega && p.fecha_entrega) {
      if (p.fecha_entrega.slice(0,4) !== fAnioEntrega) return false;
    }
    if (fMesCreacion && p.timestamp) {
      const mes = new Date(p.timestamp).getMonth() + 1;
      if (mes !== parseInt(fMesCreacion, 10)) return false;
    }
    if (fAnioCreacion && p.timestamp) {
      if (p.timestamp.slice(0,4) !== fAnioCreacion) return false;
    }
    return true;
  });

  const hayFiltros = fCreador || fProducto || fCliente || fRecipiente || fMesEntrega || fAnioEntrega || fMesCreacion || fAnioCreacion;

  function limpiarFiltros() {
    setFCreador(''); setFProducto(''); setFCliente(''); setFRecipiente('');
    setFMesEntrega(''); setFAnioEntrega(''); setFMesCreacion(''); setFAnioCreacion('');
  }

  function handleArchivoMasivo(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'binary' });
        const ws = wb.Sheets['Pedidos'];
        if (!ws) { alert('El archivo no tiene una hoja llamada "Pedidos".'); return; }
        const datos = XLSX.utils.sheet_to_json(ws, { header: 1, range: 3 });
        const filas = datos.slice(1).filter(row => row.some(c => c !== undefined && c !== ''));
        if (filas.length === 0) { alert('El archivo no tiene pedidos (fila 5 en adelante).'); return; }
        if (filas.length > 100) { alert('Máximo 100 pedidos por archivo.'); return; }
        const pedidosLeidos = filas.map(row => {
          const obj = {};
          COLS_ESPERADAS.forEach((col, i) => { obj[col] = row[i] !== undefined ? String(row[i]).trim() : ''; });
          return obj;
        });
        const errores = {};
        pedidosLeidos.forEach((p, i) => { const e = validarFila(p); if (e.length) errores[i] = e; });
        setFilasCarga(pedidosLeidos);
        setErroresCarga(errores);
        setResultadoMasivo(null);
      } catch (err) { alert('Error leyendo el archivo: ' + err.message); }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  }

  async function confirmarCargaMasiva() {
    const validas = filasCarga.filter((_, i) => !erroresCarga[i]);
    if (validas.length === 0) { alert('No hay filas válidas para cargar.'); return; }
    setEnviandoMasivo(true);
    const ok = [], fail = [];
    try {
      for (const fila of validas) {
        try {
          const id = genNro();
          const ahora = new Date().toLocaleString('es-AR');
          const ov = `${fila.ov_tipo}-${fila.ov_numero}`;
          const lugar = [fila.calle, fila.numero_calle, fila.ciudad, fila.provincia, fila.cp].filter(Boolean).join(', ');
          const esAbierto = (fila.recipiente === 'Granel' || !fila.recipiente) && parseFloat(fila.volumen) > 32;
          const pedido = {
            id, estado: 'Pendiente', editado: false,
            creado_por: usuario?.nombre||'Usuario',
            creado_por_email: usuario?.email||'',
            creado_en: ahora, editado_en: null, editado_por: null,
            tipo: fila.tipo, producto: fila.producto,
            volumen: parseFloat(fila.volumen), recipiente: fila.recipiente||'Granel',
            cliente: fila.cliente, ov, telefono: '',
            telefono_prefijo: '', telefono_numero: '',
            fecha_entrega: fila.fecha_entrega,
            banda_horaria: fila.banda_horaria||'',
            lugar, calle: fila.calle, numero: fila.numero_calle||'',
            ciudad: fila.ciudad, provincia: fila.provincia, cp: fila.cp||'',
            mapsLink: fila.maps_link||'', obs: fila.obs||'',
            adjuntos: [], despachos: [],
            timestamp: new Date().toISOString(),
            origen: 'carga_masiva',
            es_abierto: esAbierto,
            volumen_original: parseFloat(fila.volumen),
            volumen_despachado: 0,
          };
          await addDoc(collection(db, 'pedidos_portal'), pedido);
          const payload = { accion: 'nuevo_pedido', ...pedido };
          const params = new URLSearchParams({ payload: JSON.stringify(payload) });
          await fetch(APPS_SCRIPT_URL + '?' + params.toString(), { mode: 'no-cors' });
          ok.push(id);
        } catch (err) { fail.push(fila.cliente + ' — ' + err.message); }
      }
      setResultadoMasivo({ ok, fail });
      setFilasCarga([]); setErroresCarga({});
    } finally { setEnviandoMasivo(false); }
  }

  function descargarPlantilla() { window.open('/plantilla_pedidos_explora.xlsx', '_blank'); }

  function handleAdjuntos(e) { const files = Array.from(e.target.files); setForm(prev => ({ ...prev, archivosNuevos: [...prev.archivosNuevos, ...files] })); }
  function quitarArchivoNuevo(nombre) { setForm(prev => ({ ...prev, archivosNuevos: prev.archivosNuevos.filter(f => f.name !== nombre) })); }
  function quitarAdjuntoExistente(fileId) { setForm(prev => ({ ...prev, adjuntos: prev.adjuntos.map(a => a.file_id === fileId ? { ...a, _eliminado: true } : a) })); }
  function checkMapsLink(val) { return val.includes('maps.google') || val.includes('goo.gl') || val.includes('maps.app'); }
  function abrirMaps() { const q = [form.calle, form.numero, form.ciudad, form.provincia].filter(Boolean).join(', ') || 'Puerto General San Martín, Santa Fe'; window.open('https://maps.google.com?q='+encodeURIComponent(q), '_blank'); }
  function getOV() { return `${form.ov_tipo}-${form.ov_numero}`; }
  function validarOV() { if (form.ov_tipo==='OV') return /^\d{4}$/.test(form.ov_numero.trim()); if (form.ov_tipo==='OC') return /^\d{5}$/.test(form.ov_numero.trim()); return false; }
  function maxDigitosOV() { return form.ov_tipo==='OV' ? 4 : 5; }
  function validarTelefono() { const pre = form.telefono_prefijo.replace(/\D/g,''); const num = form.telefono_numero.replace(/\D/g,''); if (!pre && !num) return true; if (pre.length===3 && num.length===7) return true; if (pre.length===4 && num.length===6) return true; return false; }
  function validarFecha(fecha) { const hoy = new Date(); hoy.setHours(0,0,0,0); return new Date(fecha+'T00:00:00') > hoy; }
  function puedeEditar(p) {
    if (p.estado==='Suspendido'||p.estado==='Cumplido') return false;
    const nominados = (p.despachos||[]).filter(d => d.estado==='Nominado');
    if (nominados.length > 0) { const fc = new Date((nominados[0].fecha_carga||'')+'T00:00:00'); const hoy = new Date(); hoy.setHours(0,0,0,0); if (fc < hoy) return false; }
    return true;
  }
  function abrirEditar(p) {
    setPedidoEditando(p);
    const ovParts = (p.ov||'OV-').split('-');
    setForm({ tipo: p.tipo||'Retiro del cliente', producto: p.producto||'', volumen: String(p.volumen||''), recipiente: p.recipiente||'Granel', cliente: p.cliente||'', telefono_prefijo: p.telefono_prefijo||'', telefono_numero: p.telefono_numero||'', ov_tipo: ovParts[0]||'OV', ov_numero: ovParts[1]||'', fecha_entrega: p.fecha_entrega||'', banda_horaria: p.banda_horaria||'', calle: p.calle||'', numero: p.numero||'', ciudad: p.ciudad||'', provincia: p.provincia||'', cp: p.cp||'', mapsLink: p.mapsLink||'', obs: p.obs||'', adjuntos: p.adjuntos||[], archivosNuevos: [] });
    setVista('nuevo');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.producto||!form.volumen||!form.cliente||!form.ov_numero||!form.fecha_entrega||!form.calle||!form.ciudad||!form.provincia) { alert('Completá todos los campos obligatorios'); return; }
    if (!validarOV()) { alert(form.ov_tipo==='OV' ? 'El número de OV debe tener exactamente 4 dígitos.' : 'El número de OC debe tener exactamente 5 dígitos.'); return; }
    if (!validarFecha(form.fecha_entrega)) { alert('La fecha de entrega no puede ser el mismo día ni una fecha pasada.'); return; }
    if (form.telefono_prefijo && !validarTelefono()) { alert('Teléfono: prefijo 3 dígitos → número 7. Prefijo 4 dígitos → número 6.'); return; }
    const ahora = new Date().toLocaleString('es-AR');
    const ov = getOV();
    const lugar = [form.calle, form.numero, form.ciudad, form.provincia, form.cp].filter(Boolean).join(', ');
    const telefono = form.telefono_prefijo && form.telefono_numero ? `(${form.telefono_prefijo}) ${form.telefono_numero}` : '';
    setEnviando(true);
    try {
      const id = pedidoEditando ? pedidoEditando.id : genNro();
      let adjuntosFinales = (form.adjuntos||[]).filter(a => !a._eliminado);
      if (form.archivosNuevos.length > 0) {
        setSubiendoArchivos(true);
        for (const file of form.archivosNuevos) {
          try { adjuntosFinales.push(await subirArchivo(file, id, usuario?.nombre||'')); }
          catch (err) { alert('Error subiendo '+file.name+'. El resto del pedido se guardará igual.'); }
        }
        setSubiendoArchivos(false);
      }
      if (pedidoEditando) {
        const despachosAnteriores = pedidoEditando.despachos||[];
        await updateDoc(doc(db, 'pedidos_portal', pedidoEditando.docId), {
          tipo: form.tipo, producto: form.producto, volumen: parseFloat(form.volumen), recipiente: form.recipiente,
          cliente: form.cliente, ov, telefono, telefono_prefijo: form.telefono_prefijo, telefono_numero: form.telefono_numero,
          fecha_entrega: form.fecha_entrega, banda_horaria: form.banda_horaria,
          lugar, calle: form.calle, numero: form.numero, ciudad: form.ciudad, provincia: form.provincia, cp: form.cp,
          mapsLink: form.mapsLink||'', obs: form.obs||'', adjuntos: adjuntosFinales,
          estado: 'Pendiente', editado: true, editado_en: ahora, editado_por: usuario?.nombre||'',
          creado_por_email: pedidoEditando.creado_por_email||usuario?.email||'',
          despachos: despachosAnteriores.map(d => ({ ...d, estado: 'En espera' })),
        });
        const payload = { accion: 'editar_pedido', id: pedidoEditando.id, editado_por: usuario?.nombre||'', editado_en: ahora, estado_anterior: pedidoEditando.estado, tenia_programacion: despachosAnteriores.length > 0, tipo: form.tipo, producto: form.producto, volumen: parseFloat(form.volumen), cliente: form.cliente, ov, fecha_entrega: form.fecha_entrega, banda_horaria: form.banda_horaria, lugar, obs: form.obs||'', email_transportista: despachosAnteriores[0]?.email_transportista||'', transporte: despachosAnteriores[0]?.transporte||'' };
        await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString(), { mode: 'no-cors' });
        alert(`✓ Pedido ${pedidoEditando.id} actualizado.`);
        setPedidoEditando(null);
      } else {
        const esAbierto = form.recipiente === 'Granel' && parseFloat(form.volumen) > 32;
        const pedido = {
          id, estado: 'Pendiente', editado: false,
          creado_por: usuario?.nombre||'Usuario', creado_por_email: usuario?.email||'',
          creado_en: ahora, editado_en: null, editado_por: null,
          tipo: form.tipo, producto: form.producto, volumen: parseFloat(form.volumen),
          recipiente: form.recipiente, cliente: form.cliente, ov, telefono,
          telefono_prefijo: form.telefono_prefijo, telefono_numero: form.telefono_numero,
          fecha_entrega: form.fecha_entrega, banda_horaria: form.banda_horaria,
          lugar, calle: form.calle, numero: form.numero, ciudad: form.ciudad,
          provincia: form.provincia, cp: form.cp, mapsLink: form.mapsLink||'',
          obs: form.obs||'', adjuntos: adjuntosFinales, despachos: [],
          timestamp: new Date().toISOString(),
          es_abierto: esAbierto,
          volumen_original: parseFloat(form.volumen),
          volumen_despachado: 0,
        };
        await addDoc(collection(db, 'pedidos_portal'), pedido);
        await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify({ accion: 'nuevo_pedido', ...pedido }) }).toString(), { mode: 'no-cors' });
        alert(`✓ Pedido ${id} registrado. Se notificó al coordinador.`);
      }
      setVista('panel');
      setSugerenciaCliente(null); setClientesSugeridos([]); setMostrarDropCliente(false);
      setForm({ tipo: 'Retiro del cliente', producto: '', volumen: '', recipiente: 'Granel', cliente: '', telefono_prefijo: '', telefono_numero: '', ov_tipo: 'OV', ov_numero: '', fecha_entrega: '', banda_horaria: '', calle: '', numero: '', ciudad: '', provincia: '', cp: '', mapsLink: '', obs: '', adjuntos: [], archivosNuevos: [] });
    } catch (err) { console.error(err); alert('Error: ' + err.message); }
    finally { setEnviando(false); setSubiendoArchivos(false); }
  }

  async function suspender(p) {
    if (rol === 'comercial' && p.creado_por_email !== usuario?.email) { alert('Solo podés suspender pedidos propios.'); return; }
    const motivo = prompt('Motivo de la suspensión (requerido):');
    if (!motivo) return;
    const despachosAnteriores = p.despachos||[];
    await updateDoc(doc(db, 'pedidos_portal', p.docId), { estado: 'Suspendido', suspendido_por: usuario?.nombre||'', suspendido_en: new Date().toLocaleString('es-AR'), motivo_suspension: motivo });
    const payload = { accion: 'suspender_pedido', id: p.id, motivo, suspendido_por: usuario?.nombre||'', estado_anterior: p.estado, tenia_programacion: despachosAnteriores.length > 0, producto: p.producto, volumen: p.volumen, cliente: p.cliente, ov: p.ov, fecha_entrega: p.fecha_entrega, lugar: p.lugar, email_transportista: despachosAnteriores[0]?.email_transportista||'', transporte: despachosAnteriores[0]?.transporte||'' };
    await fetch(APPS_SCRIPT_URL + '?' + new URLSearchParams({ payload: JSON.stringify(payload) }).toString(), { mode: 'no-cors' });
    alert('Pedido suspendido. Se notificó a los involucrados.');
  }

  const pillColors = { Pendiente: { bg: '#EEEDFE', color: '#3C3489' }, 'prog-parcial': { bg: '#FAEEDA', color: '#633806' }, Programado: { bg: '#E1F5EE', color: '#085041' }, Nominado: { bg: '#E1F5EE', color: '#085041' }, Suspendido: { bg: '#FCEBEB', color: '#791F1F' }, Cumplido: { bg: '#E1F5EE', color: '#085041' } };
  const pillLabel = { Pendiente: 'Pendiente', 'prog-parcial': 'Prog. parcial', Programado: 'Programado', Nominado: 'Nominado', Suspendido: 'Suspendido', Cumplido: 'Cumplido' };
  const filasSinError = filasCarga.filter((_, i) => !erroresCarga[i]);
  const filasConError = filasCarga.filter((_, i) => !!erroresCarga[i]);

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <div style={styles.logoArea}><img src="/logo.png" alt="Explora" style={styles.logoImg} /></div>
        <button style={styles.btnVolver} onClick={onVolver}>← Inicio</button>
      </div>

      {vista === 'panel' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>Pedidos</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              {(rol === 'admin' || rol === 'comercial') && (
                <button style={styles.btnSecundario} onClick={() => { setVista('carga'); setFilasCarga([]); setErroresCarga({}); setResultadoMasivo(null); }}>📥 Carga masiva</button>
              )}
              {(rol === 'admin' || rol === 'comercial') && (
                <button style={styles.btnPrimary} onClick={() => { setPedidoEditando(null); setVista('nuevo'); }}>+ Nuevo pedido</button>
              )}
            </div>
          </div>

          <div style={styles.filtrosGrid}>
            <div style={styles.filtroField}><label style={styles.filtroLabel}>Creado por</label><select style={styles.filtroInput} value={fCreador} onChange={e => setFCreador(e.target.value)}><option value="">Todos</option>{creadores.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div style={styles.filtroField}><label style={styles.filtroLabel}>Producto</label><select style={styles.filtroInput} value={fProducto} onChange={e => setFProducto(e.target.value)}><option value="">Todos</option>{productos.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
            <div style={styles.filtroField}><label style={styles.filtroLabel}>Cliente</label><select style={styles.filtroInput} value={fCliente} onChange={e => setFCliente(e.target.value)}><option value="">Todos</option>{clientes.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div style={styles.filtroField}><label style={styles.filtroLabel}>Recipiente</label><select style={styles.filtroInput} value={fRecipiente} onChange={e => setFRecipiente(e.target.value)}><option value="">Todos</option><option value="Granel">Granel</option><option value="IBC">IBC</option></select></div>
            <div style={styles.filtroField}><label style={styles.filtroLabel}>Entrega — mes</label><select style={styles.filtroInput} value={fMesEntrega} onChange={e => setFMesEntrega(e.target.value)}><option value="">Todos</option>{MESES.map((m, i) => <option key={i+1} value={String(i+1)}>{m}</option>)}</select></div>
            <div style={styles.filtroField}><label style={styles.filtroLabel}>Entrega — año</label><select style={styles.filtroInput} value={fAnioEntrega} onChange={e => setFAnioEntrega(e.target.value)}><option value="">Todos</option>{aniosEntrega.map(a => <option key={a} value={a}>{a}</option>)}</select></div>
            <div style={styles.filtroField}><label style={styles.filtroLabel}>Creación — mes</label><select style={styles.filtroInput} value={fMesCreacion} onChange={e => setFMesCreacion(e.target.value)}><option value="">Todos</option>{MESES.map((m, i) => <option key={i+1} value={String(i+1)}>{m}</option>)}</select></div>
            <div style={styles.filtroField}><label style={styles.filtroLabel}>Creación — año</label><select style={styles.filtroInput} value={fAnioCreacion} onChange={e => setFAnioCreacion(e.target.value)}><option value="">Todos</option>{aniosCreacion.map(a => <option key={a} value={a}>{a}</option>)}</select></div>
          </div>

          <div style={styles.filtrosResumen}>
            <span>{pedidosFiltrados.length} pedido{pedidosFiltrados.length !== 1 ? 's' : ''}</span>
            {hayFiltros && <button style={styles.btnLimpiar} onClick={limpiarFiltros}>✕ Limpiar filtros</button>}
          </div>

          {pedidosFiltrados.length === 0 && <div style={styles.empty}>Sin resultados para los filtros aplicados.</div>}

          {pedidosFiltrados.map(p => (
            <div key={p.id} style={styles.card}>
              <div style={styles.cardRow} onClick={() => setExpandido(expandido === p.id ? null : p.id)}>
                <span style={{ ...styles.pill, background: pillColors[p.estado]?.bg, color: pillColors[p.estado]?.color }}>{pillLabel[p.estado]||p.estado}</span>
                {p.es_abierto && <span style={styles.badgeAbierto}>📂</span>}
                {p.editado && <span style={styles.badgeEditado}>✏</span>}
                {p.origen === 'carga_masiva' && <span style={styles.badgeMasivo}>📥</span>}
                <span style={styles.rowCliente}>{p.cliente}</span>
                <span style={styles.rowProducto}>{p.producto} · {p.volumen} tn</span>
                <span style={styles.rowFecha}>{p.fecha_entrega}</span>
                <span style={styles.rowCreador}>{p.creado_por}</span>
                <span style={styles.rowNro}>{p.id}</span>
                <span style={styles.rowChevron}>{expandido === p.id ? '▲' : '▼'}</span>
              </div>
              {expandido === p.id && (
                <div style={styles.cardBody}>
                  <div style={styles.detailGrid}>
                    <div style={styles.field}><span style={styles.label}>Tipo</span><span>{p.tipo}</span></div>
                    <div style={styles.field}><span style={styles.label}>Producto</span><span>{p.producto}</span></div>
                    <div style={styles.field}><span style={styles.label}>Volumen</span><span>{p.volumen} tn{p.es_abierto ? ` (despachado: ${p.volumen_despachado||0} tn)` : ''}</span></div>
                    <div style={styles.field}><span style={styles.label}>Recipiente</span><span>{p.recipiente}</span></div>
                    <div style={styles.field}><span style={styles.label}>Cliente / Proveedor</span><span>{p.cliente}</span></div>
                    <div style={styles.field}><span style={styles.label}>OV / OC</span><span>{p.ov}</span></div>
                    <div style={styles.field}><span style={styles.label}>Teléfono</span><span>{p.telefono||'—'}</span></div>
                    <div style={styles.field}><span style={styles.label}>Entrega comprometida</span><span>{p.fecha_entrega}</span></div>
                    {p.banda_horaria && <div style={styles.field}><span style={styles.label}>Banda horaria</span><span>{p.banda_horaria}</span></div>}
                    <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Lugar</span><span>{p.lugar}{p.mapsLink && <a href={p.mapsLink} target="_blank" rel="noreferrer" style={styles.mapsLink}> 📍 Ver en Maps</a>}</span></div>
                    {p.obs && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Observaciones</span><span>{p.obs}</span></div>}
                    {p.motivo_suspension && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Motivo suspensión</span><span style={{ color: '#A32D2D' }}>{p.motivo_suspension}</span></div>}
                  </div>
                  {p.adjuntos?.filter(a => !a._eliminado).length > 0 && (
                    <div style={styles.adjuntosRow}>{p.adjuntos.filter(a => !a._eliminado).map(a => (<a key={a.file_id} href={a.link} target="_blank" rel="noreferrer" style={styles.adjuntoChip}>📎 {a.nombre}</a>))}</div>
                  )}
                  <div style={styles.origen}>Creado por <strong>{p.creado_por}</strong> · {p.creado_en}{p.editado && <span> · Editado por <strong>{p.editado_por}</strong> · {p.editado_en}</span>}</div>
                  {p.estado !== 'Cumplido' && p.estado !== 'Suspendido' && (
                    <div style={styles.cardActions}>
                      {puedeEditar(p) && (rol === 'admin' || p.creado_por_email === usuario?.email) && (
                        <button style={styles.btnEditar} onClick={() => abrirEditar(p)}>✏️ Editar</button>
                      )}
                      {(rol === 'admin' || p.creado_por_email === usuario?.email) && (
                        <button style={styles.btnSuspender} onClick={() => suspender(p)}>Suspender</button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {vista === 'carga' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>Carga masiva de pedidos</h2>
            <button style={styles.btnVolver} onClick={() => setVista('panel')}>← Volver</button>
          </div>
          {resultadoMasivo && (
            <div style={{ marginBottom: 16 }}>
              {resultadoMasivo.ok.length > 0 && <div style={styles.bannerOk}>✓ {resultadoMasivo.ok.length} pedido{resultadoMasivo.ok.length > 1 ? 's' : ''} cargado{resultadoMasivo.ok.length > 1 ? 's' : ''} correctamente: {resultadoMasivo.ok.join(', ')}</div>}
              {resultadoMasivo.fail.length > 0 && <div style={styles.bannerError}>✗ {resultadoMasivo.fail.length} pedido{resultadoMasivo.fail.length > 1 ? 's' : ''} con error:<br/>{resultadoMasivo.fail.join('\n')}</div>}
              <button style={{ ...styles.btnPrimary, marginTop: 10 }} onClick={() => { setResultadoMasivo(null); setVista('panel'); }}>Ver pedidos</button>
            </div>
          )}
          {!resultadoMasivo && (
            <div style={styles.form}>
              <div style={styles.seccion}>
                <div style={styles.seccionTitulo}>Paso 1 — Descargar plantilla</div>
                <p style={styles.instruccion}>Descargá la plantilla Excel, completá los pedidos a partir de la fila 5 y guardala. No modifiques el orden de columnas ni los encabezados.</p>
                <button style={styles.btnDescarga} onClick={descargarPlantilla}>⬇️ Descargar plantilla Excel</button>
              </div>
              <div style={styles.seccion}>
                <div style={styles.seccionTitulo}>Paso 2 — Subir archivo completado</div>
                <input ref={fileMasivoRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleArchivoMasivo} />
                <button style={styles.btnAdjuntar} onClick={() => fileMasivoRef.current.click()}>📂 Seleccionar archivo Excel</button>
              </div>
              {filasCarga.length > 0 && (
                <div style={styles.seccion}>
                  <div style={styles.seccionTitulo}>Paso 3 — Revisión antes de confirmar</div>
                  <div style={styles.resumenCarga}>
                    <span style={{ color: '#085041' }}>✓ {filasSinError.length} válidos</span>
                    {filasConError.length > 0 && <span style={{ color: '#A32D2D' }}>  ✗ {filasConError.length} con errores (no se cargarán)</span>}
                  </div>
                  {filasCarga.map((fila, i) => {
                    const errs = erroresCarga[i];
                    return (
                      <div key={i} style={{ ...styles.filaPreview, borderColor: errs ? '#FCA5A5' : '#5DCAA5', background: errs ? '#FFF5F5' : '#F0FDF4' }}>
                        <div style={styles.filaPreviewHeader}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: errs ? '#B91C1C' : '#085041' }}>{errs ? `✗ Fila ${i+5}` : `✓ Fila ${i+5}`}</span>
                          <span style={{ fontSize: 12, color: '#374151' }}>{fila.cliente} · {fila.producto} {fila.volumen} tn · {fila.fecha_entrega}</span>
                        </div>
                        {errs && <ul style={styles.errorList}>{errs.map((e, j) => <li key={j} style={{ fontSize: 11, color: '#B91C1C' }}>{e}</li>)}</ul>}
                        {!errs && <div style={{ fontSize: 11, color: '#374151', marginTop: 4 }}>{fila.tipo} · {fila.ov_tipo}-{fila.ov_numero} · {fila.ciudad}, {fila.provincia}</div>}
                      </div>
                    );
                  })}
                  {filasSinError.length > 0 && (
                    <button style={{ ...styles.btnPrimary, marginTop: 12, opacity: enviandoMasivo ? 0.7 : 1 }} disabled={enviandoMasivo} onClick={confirmarCargaMasiva}>
                      {enviandoMasivo ? 'Cargando...' : `✓ Confirmar carga de ${filasSinError.length} pedido${filasSinError.length > 1 ? 's' : ''}`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {vista === 'nuevo' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>{pedidoEditando ? 'Editar pedido' : 'Nuevo pedido'}</h2>
            <button style={styles.btnVolver} onClick={() => { setVista('panel'); setPedidoEditando(null); }}>← Volver</button>
          </div>
          {pedidoEditando && <div style={styles.editandoBanner}>✏️ Editando <strong>{pedidoEditando.id}</strong> — Estado: <strong>{pedidoEditando.estado}</strong></div>}
          <form onSubmit={handleSubmit} style={styles.form}>
            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Tipo de operación</div>
              <div style={styles.tipoGrid}>
                <button type="button" style={{ ...styles.tipoBtn, ...(form.tipo==='Retiro del cliente' ? styles.tipoBtnActive : {}) }} onClick={() => setForm({ ...form, tipo: 'Retiro del cliente' })}>Retiro del cliente</button>
                <button type="button" style={{ ...styles.tipoBtn, ...(form.tipo==='Entrega al cliente' ? styles.tipoBtnActive : {}) }} onClick={() => setForm({ ...form, tipo: 'Entrega al cliente' })}>Entrega al cliente</button>
              </div>
            </div>
            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Producto y volumen</div>
              <div style={styles.grid2}>
                <div style={styles.formField}><label style={styles.formLabel}>Producto *</label><select style={styles.input} value={form.producto} onChange={e => setForm({ ...form, producto: e.target.value })}><option value="">Seleccionar...</option><option>Biodiesel</option><option>EMAG</option><option>Glicerina</option><option>Sebo</option><option>HFFA Vegetal</option><option>Aceite</option><option>Otro</option></select></div>
                <div style={styles.formField}><label style={styles.formLabel}>Volumen (tn) *</label><input style={styles.input} type="number" placeholder="Ej: 60" value={form.volumen} onChange={e => setForm({ ...form, volumen: e.target.value })} /></div>
              </div>
              <div style={styles.formField}>
                <label style={styles.formLabel}>Tipo de recipiente</label>
                <div style={styles.tipoGrid}>
                  <button type="button" style={{ ...styles.tipoBtn, ...(form.recipiente==='Granel' ? styles.tipoBtnActive : {}) }} onClick={() => setForm({ ...form, recipiente: 'Granel' })}>🚛 Granel</button>
                  <button type="button" style={{ ...styles.tipoBtn, ...(form.recipiente==='IBC' ? styles.tipoBtnActive : {}) }} onClick={() => setForm({ ...form, recipiente: 'IBC' })}>📦 IBC</button>
                </div>
              </div>
              {form.recipiente === 'Granel' && parseFloat(form.volumen) > 32 && (
                <div style={styles.bannerAbierto}>📂 Este pedido quedará <strong>abierto</strong> — se podrán registrar múltiples despachos parciales hasta completar las {form.volumen} tn.</div>
              )}
            </div>
            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Datos comerciales</div>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Cliente / Proveedor *</label>
                  <div style={{ position: 'relative' }} ref={clienteRef}>
                    <input style={styles.input} type="text" placeholder="Ej: SINER" value={form.cliente} onChange={e => setForm({ ...form, cliente: e.target.value })} onBlur={() => setTimeout(() => setMostrarDropCliente(false), 150)} onFocus={() => clientesSugeridos.length > 0 && setMostrarDropCliente(true)} autoComplete="off" />
                    {mostrarDropCliente && clientesSugeridos.length > 0 && (
                      <div style={styles.clienteDrop}>{clientesSugeridos.map(p => (<button key={p.docId} type="button" style={styles.clienteDropItem} onMouseDown={() => aplicarMemoria(p)}><span style={styles.clienteDropNombre}>{p.cliente}</span><span style={styles.clienteDropDetalle}>{p.producto} · {p.ciudad||p.lugar?.split(',')[2]?.trim()||''}</span></button>))}</div>
                    )}
                  </div>
                  {sugerenciaCliente && !mostrarDropCliente && (
                    <div style={styles.memoriaBanner}>
                      <span style={styles.memoriaTexto}>💡 Último pedido: <strong>{sugerenciaCliente.producto}</strong> a <strong>{sugerenciaCliente.ciudad||sugerenciaCliente.lugar}</strong></span>
                      <button type="button" style={styles.memoriaBtn} onClick={() => aplicarMemoria(sugerenciaCliente)}>Autocompletar</button>
                    </div>
                  )}
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>OV / OC *</label>
                  <div style={styles.ovRow}>
                    <select style={{ ...styles.input, width: 80, flexShrink: 0 }} value={form.ov_tipo} onChange={e => setForm({ ...form, ov_tipo: e.target.value, ov_numero: '' })}><option>OV</option><option>OC</option></select>
                    <span style={styles.ovSep}>-</span>
                    <input style={{ ...styles.input, flex: 1 }} type="text" placeholder={form.ov_tipo==='OV' ? '1234' : '12345'} maxLength={maxDigitosOV()} value={form.ov_numero} onChange={e => setForm({ ...form, ov_numero: e.target.value.replace(/\D/g,'') })} />
                  </div>
                  {form.ov_numero && !validarOV() && <span style={styles.fieldError}>{form.ov_tipo==='OV' ? 'OV: exactamente 4 dígitos' : 'OC: exactamente 5 dígitos'}</span>}
                </div>
              </div>
              <div style={styles.formField}>
                <label style={styles.formLabel}>Teléfono de contacto</label>
                <div style={styles.telRow}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 0 110px' }}>
                    <input style={styles.input} type="text" placeholder="Prefijo" maxLength={4} value={form.telefono_prefijo} onChange={e => setForm({ ...form, telefono_prefijo: e.target.value.replace(/\D/g,'') })} />
                    <span style={styles.telHint}>Sin 0 · 3 o 4 dígitos</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <input style={styles.input} type="text" placeholder="Número" maxLength={7} value={form.telefono_numero} onChange={e => setForm({ ...form, telefono_numero: e.target.value.replace(/\D/g,'') })} />
                    <span style={styles.telHint}>Sin 15 · 6 o 7 dígitos</span>
                  </div>
                </div>
                {form.telefono_prefijo && !validarTelefono() && <span style={styles.fieldError}>Prefijo 3 dígitos → número 7 · Prefijo 4 dígitos → número 6</span>}
              </div>
            </div>
            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Logística</div>
              <div style={styles.grid2}>
                <div style={styles.formField}><label style={styles.formLabel}>Fecha de entrega comprometida *</label><input style={styles.input} type="date" value={form.fecha_entrega} min={new Date(Date.now()+86400000).toISOString().split('T')[0]} onChange={e => setForm({ ...form, fecha_entrega: e.target.value })} /></div>
                <div style={styles.formField}><label style={styles.formLabel}>Banda horaria de entrega</label><select style={styles.input} value={form.banda_horaria} onChange={e => setForm({ ...form, banda_horaria: e.target.value })}><option value="">Seleccionar...</option><option>Mañana (6-12hs)</option><option>Tarde (12-18hs)</option><option>Noche (18-24hs)</option><option>A confirmar</option></select></div>
              </div>
              <div style={{ ...styles.formField, marginTop: 4 }}>
                <label style={styles.formLabel}>Lugar de entrega / origen *</label>
                <div style={styles.grid2}>
                  <div style={styles.formField}><label style={styles.formLabel}>Calle *</label><input style={styles.input} type="text" placeholder="Nombre de la calle" value={form.calle} onChange={e => setForm({ ...form, calle: e.target.value })} /></div>
                  <div style={styles.formField}><label style={styles.formLabel}>Nº</label><input style={styles.input} type="text" placeholder="Número" value={form.numero} onChange={e => setForm({ ...form, numero: e.target.value })} /></div>
                  <div style={styles.formField}><label style={styles.formLabel}>Ciudad *</label><input style={styles.input} type="text" placeholder="Ciudad" value={form.ciudad} onChange={e => setForm({ ...form, ciudad: e.target.value })} /></div>
                  <div style={styles.formField}><label style={styles.formLabel}>Provincia *</label><input style={styles.input} type="text" placeholder="Provincia" value={form.provincia} onChange={e => setForm({ ...form, provincia: e.target.value })} /></div>
                  <div style={styles.formField}><label style={styles.formLabel}>CP</label><input style={styles.input} type="text" placeholder="Código postal" maxLength={8} value={form.cp} onChange={e => setForm({ ...form, cp: e.target.value })} /></div>
                </div>
                <div style={styles.mapsRow}>
                  <input style={{ ...styles.input, flex: 1 }} type="text" placeholder="O pegar enlace de Google Maps..." value={form.mapsLink} onChange={e => setForm({ ...form, mapsLink: e.target.value })} />
                  <button type="button" style={styles.btnMaps} onClick={abrirMaps}>📍 Buscar en Maps</button>
                </div>
                {checkMapsLink(form.mapsLink) && <div style={styles.mapsPreview}>✓ Enlace de Google Maps vinculado</div>}
              </div>
            </div>
            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Observaciones y adjuntos</div>
              <textarea style={{ ...styles.textarea, width: '100%', marginBottom: 10 }} placeholder="Información adicional, requerimientos especiales..." value={form.obs} onChange={e => setForm({ ...form, obs: e.target.value })} />
              {form.adjuntos?.filter(a => !a._eliminado).length > 0 && (<div style={{ marginBottom: 8 }}><div style={styles.adjuntosLabel}>Adjuntos existentes:</div><div style={styles.adjuntosRow}>{form.adjuntos.filter(a => !a._eliminado).map(a => (<div key={a.file_id} style={styles.adjuntoChipEditable}><a href={a.link} target="_blank" rel="noreferrer" style={{ color: '#3C3489', textDecoration: 'none', fontSize: 11 }}>📎 {a.nombre}</a><button type="button" onClick={() => quitarAdjuntoExistente(a.file_id)} style={styles.adjuntoQuitar}>✕</button></div>))}</div></div>)}
              {form.archivosNuevos.length > 0 && (<div style={{ marginBottom: 8 }}><div style={styles.adjuntosLabel}>Archivos a subir:</div><div style={styles.adjuntosRow}>{form.archivosNuevos.map(f => (<div key={f.name} style={styles.adjuntoChipEditable}><span style={{ fontSize: 11 }}>📎 {f.name}</span><button type="button" onClick={() => quitarArchivoNuevo(f.name)} style={styles.adjuntoQuitar}>✕</button></div>))}</div></div>)}
              <button type="button" style={styles.btnAdjuntar} onClick={() => fileRef.current.click()}>📎 Adjuntar archivo</button>
              <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" style={{ display: 'none' }} onChange={handleAdjuntos} />
            </div>
            <div style={styles.formActions}>
              <button type="submit" style={{ ...styles.btnPrimary, padding: '11px', fontSize: 14, opacity: (enviando||subiendoArchivos) ? 0.7 : 1 }} disabled={enviando||subiendoArchivos}>
                {subiendoArchivos ? 'Subiendo archivos...' : enviando ? 'Enviando...' : pedidoEditando ? 'Guardar cambios' : 'Confirmar pedido'}
              </button>
              <button type="button" style={styles.btnCancelar} onClick={() => { setVista('panel'); setPedidoEditando(null); }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { maxWidth: 900, margin: '0 auto', padding: '1.5rem 1rem' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem' },
  logoArea: { display: 'flex', alignItems: 'center' },
  logoImg: { height: 36, objectFit: 'contain' },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' },
  titulo: { fontSize: 18, fontWeight: 500, color: '#111827' },
  btnPrimary: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnSecundario: { padding: '8px 16px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' },
  filtrosGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 10 },
  filtroField: { display: 'flex', flexDirection: 'column', gap: 3 },
  filtroLabel: { fontSize: 10, fontWeight: 500, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' },
  filtroInput: { fontSize: 12, padding: '6px 8px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%', boxSizing: 'border-box' },
  filtrosResumen: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#6B7280', marginBottom: 10 },
  btnLimpiar: { fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', cursor: 'pointer' },
  empty: { textAlign: 'center', padding: '2rem', color: '#9CA3AF', fontSize: 13 },
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 8 },
  cardRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#F9FAFB', cursor: 'pointer', flexWrap: 'wrap' },
  pill: { fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, flexShrink: 0 },
  badgeAbierto: { fontSize: 11, flexShrink: 0, color: '#1D4ED8' },
  badgeEditado: { fontSize: 11, flexShrink: 0, color: '#92400E' },
  badgeMasivo: { fontSize: 11, flexShrink: 0, color: '#6B7280' },
  rowCliente: { fontSize: 13, fontWeight: 500, color: '#111827', flex: 2, minWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowProducto: { fontSize: 12, color: '#6B7280', flex: 2, minWidth: 80, whiteSpace: 'nowrap' },
  rowFecha: { fontSize: 11, color: '#6B7280', flexShrink: 0, whiteSpace: 'nowrap' },
  rowCreador: { fontSize: 11, color: '#9CA3AF', flexShrink: 0, whiteSpace: 'nowrap' },
  rowNro: { fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace', flexShrink: 0, whiteSpace: 'nowrap' },
  rowChevron: { fontSize: 10, color: '#9CA3AF', flexShrink: 0, marginLeft: 'auto' },
  cardBody: { padding: '12px 14px', borderTop: '0.5px solid #E5E7EB' },
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
  bannerAbierto: { marginTop: 10, padding: '10px 14px', borderRadius: 8, background: '#EFF6FF', border: '0.5px solid #BFDBFE', fontSize: 13, color: '#1D4ED8' },
  seccion: { marginBottom: '1.5rem' },
  seccionTitulo: { fontSize: 12, fontWeight: 500, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: '0.5px solid #F3F4F6' },
  instruccion: { fontSize: 13, color: '#6B7280', marginBottom: 12, lineHeight: 1.5 },
  btnDescarga: { padding: '9px 16px', borderRadius: 8, border: '0.5px solid #0F6E56', background: '#E1F5EE', color: '#0F6E56', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  resumenCarga: { fontSize: 13, fontWeight: 500, marginBottom: 10 },
  filaPreview: { border: '0.5px solid', borderRadius: 8, padding: '8px 12px', marginBottom: 6 },
  filaPreviewHeader: { display: 'flex', gap: 10, alignItems: 'center' },
  errorList: { margin: '6px 0 0 16px', padding: 0 },
  bannerOk: { padding: '10px 14px', borderRadius: 8, background: '#E1F5EE', border: '0.5px solid #5DCAA5', fontSize: 13, color: '#085041', marginBottom: 8 },
  bannerError: { padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '0.5px solid #FCA5A5', fontSize: 13, color: '#B91C1C', whiteSpace: 'pre-line' },
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
  clienteDrop: { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', marginTop: 2, overflow: 'hidden' },
  clienteDropItem: { width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 12px', border: 'none', borderBottom: '0.5px solid #F3F4F6', background: '#fff', cursor: 'pointer', textAlign: 'left' },
  clienteDropNombre: { fontSize: 13, fontWeight: 500, color: '#111827' },
  clienteDropDetalle: { fontSize: 11, color: '#9CA3AF' },
  memoriaBanner: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6, padding: '7px 10px', borderRadius: 8, background: '#EFF6FF', border: '0.5px solid #BFDBFE' },
  memoriaTexto: { fontSize: 12, color: '#1D4ED8', flex: 1 },
  memoriaBtn: { padding: '4px 10px', borderRadius: 6, border: '0.5px solid #93C5FD', background: '#DBEAFE', color: '#1D4ED8', fontSize: 12, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' },
};

export default Pedidos;
