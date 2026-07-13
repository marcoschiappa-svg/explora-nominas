import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { db, auth } from '../firebase';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';

// Segunda instancia de Firebase solo para crear/modificar usuarios sin romper la sesión del admin
const firebaseConfig = {
  apiKey: "AIzaSyA_cmSLuKPVYXjgQu75varhmEBkaY0uwss",
  authDomain: "explora-portal.firebaseapp.com",
  projectId: "explora-portal",
  storageBucket: "explora-portal.firebasestorage.app",
  messagingSenderId: "871895783017",
  appId: "1:871895783017:web:9503299046accde84774f8"
};
const secondaryApp  = getApps().find(a => a.name === 'secondary') || initializeApp(firebaseConfig, 'secondary');
const secondaryAuth = getAuth(secondaryApp);

const CHOFER_DOMAIN = '@explora-portal.com';

const FORM_VACIO = {
  nombre: '', email_1: '', email_2: '', email_3: '',
  prefijo_1: '', numero_1: '',
  prefijo_2: '', numero_2: '',
  prefijo_3: '', numero_3: '',
  password: '', nueva_password: '', rol: 'comercial',
  empresa: '', cuit_empresa: '', estado: 'activo',
  dni: '',
  cuit_chofer: '',
};

function Admin({ usuario, onVolver }) {
  const [usuarios, setUsuarios] = useState([]);
  const [filtroRol, setFiltroRol] = useState('todos');
  const [busquedaUsuario, setBusquedaUsuario] = useState('');
  const [pedidos, setPedidos] = useState([]);
  const [vista, setVista] = useState('lista');
  const [editando, setEditando] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [verPassword, setVerPassword] = useState(false);
  const [verNuevaPassword, setVerNuevaPassword] = useState(false);
  const [credencialCreada, setCredencialCreada] = useState(null);
  const [generandoLink, setGenerandoLink] = useState(false);
  const [finalizando, setFinalizando] = useState(null);
  const [importando, setImportando] = useState(false);
  const [resultadoImport, setResultadoImport] = useState(null);
  const [form, setForm] = useState(FORM_VACIO);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'usuarios_portal'), (snap) => {
      const data = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
      data.sort((a, b) => a.nombre?.localeCompare(b.nombre));
      setUsuarios(data);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'pedidos_portal'), (snap) => {
      setPedidos(snap.docs.map(d => ({ docId: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // Viajes activos: despachos con estado_chofer en recibido/iniciado/demorado
  const viajesActivos = [];
  pedidos.forEach(p => {
    (p.despachos || []).forEach((d, i) => {
      const ec = d.estado_chofer || '';
      if (!['recibido', 'iniciado', 'demorado'].includes(ec)) return;
      viajesActivos.push({
        docId: p.docId,
        pedidoId: p.id,
        despachoIdx: i,
        uid: p.id + '-D' + (i + 1),
        chofer: d.chofer || 'Sin nombre',
        dni_chofer: d.dni_chofer || '',
        transporte: d.transporte || '',
        producto: p.producto,
        cliente: p.cliente,
        fecha_carga: d.fecha_carga || '',
        estado_chofer: ec,
        patente_tractor: d.patente_tractor || '',
      });
    });
  });

  async function finalizarViaje(v) {
    if (!window.confirm(`¿Finalizar manualmente el viaje de ${v.chofer}?\nEsto limpiará el estado GPS y marcará el viaje como finalizado.`)) return;
    setFinalizando(v.uid);
    try {
      const pedido = pedidos.find(p => p.docId === v.docId);
      const nuevosDespachos = [...pedido.despachos];
      nuevosDespachos[v.despachoIdx] = {
        ...nuevosDespachos[v.despachoIdx],
        estado_chofer: 'finalizado',
        chofer_fin_ts: new Date().toLocaleString('es-AR'),
        gps_lat: null,
        gps_lng: null,
        gps_ts: null,
        gps_lat_prev: null,
        gps_lng_prev: null,
      };
      await updateDoc(doc(db, 'pedidos_portal', v.docId), { despachos: nuevosDespachos });
      alert(`✓ Viaje de ${v.chofer} finalizado.`);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setFinalizando(null);
    }
  }

  async function importarChoferes(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setImportando(true);
    setResultadoImport(null);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      // Buscar fila de datos (tiene número en col 0)
      const datoRows = rows.filter(r => r[0] && !isNaN(Number(r[0])));
      let creados = 0, duplicados = 0, errores = [];
      for (const row of datoRows) {
        const nombre = String(row[1] || '').trim();
        const dniRaw = String(row[3] || '').trim().replace(/\D/g, '');
        const cuit = String(row[4] || '').trim();
        const empresa = String(row[5] || '').trim();
        if (!nombre || !dniRaw) continue;
        // Verificar duplicado
        const existente = usuarios.find(u => u.dni === dniRaw && u.rol === 'chofer');
        if (existente) { duplicados++; continue; }
        try {
          const emailAuth = dniRaw + '@explora-portal.com';
          const password = dniRaw;
          const cred = await createUserWithEmailAndPassword(secondaryAuth, emailAuth, password);
          await setDoc(doc(db, 'usuarios_portal', cred.user.uid), {
            nombre, dni: dniRaw, cuit_chofer: cuit,
            empresa, rol: 'chofer', estado: 'activo',
            email_1: '', email_2: '', email_3: '',
            prefijo_1: '', numero_1: '', prefijo_2: '', numero_2: '', prefijo_3: '', numero_3: '',
            cuit_empresa: '', password_visible: password,
            creado_por: usuario?.nombre || 'Admin',
            creado_en: new Date().toLocaleString('es-AR'),
          });
          creados++;
        } catch (err) {
          errores.push(nombre + ': ' + err.message);
        }
      }
      setResultadoImport({ creados, duplicados, errores });
    } catch (err) {
      alert('Error al leer el archivo: ' + err.message);
    } finally {
      setImportando(false);
    }
  }

  function exportarChoferes() {
    const choferesFiltrados = usuarios.filter(u => {
      const matchRol = u.rol === 'chofer';
      const q = busquedaUsuario.toLowerCase();
      const matchBusq = !q || (u.nombre || '').toLowerCase().includes(q) || (u.empresa || '').toLowerCase().includes(q);
      const matchEmpresa = filtroRol === 'todos' || filtroRol === 'chofer' || u.empresa?.toLowerCase().includes(filtroRol.toLowerCase());
      return matchRol && matchBusq && matchEmpresa;
    });
    if (choferesFiltrados.length === 0) { alert('No hay choferes para exportar con el filtro actual.'); return; }
    const headers = ['Nombre y Apellido', 'DNI (login)', 'Contraseña inicial', 'CUIT Chofer', 'Empresa'];
    const filas = choferesFiltrados.map(u => [
      u.nombre || '', u.dni || '', u.password_visible || u.dni || '',
      u.cuit_chofer || '', u.empresa || '',
    ]);
    const csv = [headers, ...filas].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'choferes_explora.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function f(field) {
    return e => setForm(prev => ({ ...prev, [field]: e.target.value }));
  }

  function abrirNuevo() {
    setEditando(null);
    setCredencialCreada(null);
    setVerPassword(false);
    setVerNuevaPassword(false);
    setForm(FORM_VACIO);
    setVista('form');
  }

  function abrirEditar(u) {
    setEditando(u);
    setCredencialCreada(null);
    setVerPassword(false);
    setVerNuevaPassword(false);
    setForm({
      nombre:          u.nombre          || '',
      email_1:         u.email_1         || u.email || '',
      email_2:         u.email_2         || '',
      email_3:         u.email_3         || '',
      prefijo_1:       u.prefijo_1       || '',
      numero_1:        u.numero_1        || '',
      prefijo_2:       u.prefijo_2       || '',
      numero_2:        u.numero_2        || '',
      prefijo_3:       u.prefijo_3       || '',
      numero_3:        u.numero_3        || '',
      password:        '',
      nueva_password:  '',
      rol:             u.rol             || 'comercial',
      empresa:         u.empresa         || '',
      cuit_empresa:    u.cuit_empresa    || '',
      estado:          u.estado          || 'activo',
      dni:             u.dni             || '',
      cuit_chofer:     u.cuit_chofer     || '',
    });
    setVista('form');
  }

  function copiarCredencial() {
    if (!credencialCreada) return;
    let texto;
    if (credencialCreada.esChofer) {
      texto = `Portal Explora — Acceso Chofer\nDNI: ${credencialCreada.dni}\nContraseña: ${credencialCreada.password}\nAcceso: https://portal-ivory-zeta.vercel.app\n\nIngresá tocando "Ingresar como chofer (DNI)"`;
    } else {
      texto = `Portal Explora\nUsuario: ${credencialCreada.email}\nContraseña: ${credencialCreada.password}\nAcceso: https://portal-ivory-zeta.vercel.app`;
    }
    navigator.clipboard.writeText(texto);
    alert('✓ Credenciales copiadas al portapapeles.');
  }

  async function generarResetLink(u) {
    const email = u.email_1 || u.email;
    if (!email) { alert('El usuario no tiene email registrado.'); return; }
    setGenerandoLink(true);
    try {
      await sendPasswordResetEmail(auth, email);
      const texto = `Portal Explora — Recuperación de contraseña\nUsuario: ${email}\nAccedé al link que te llegó por mail para restablecer tu contraseña, o pedile al administrador que te lo reenvíe.\nAcceso: https://portal-ivory-zeta.vercel.app`;
      navigator.clipboard.writeText(texto);
      alert(`✓ Email de recuperación enviado a ${email}.\nEl texto fue copiado al portapapeles para enviarlo por WhatsApp.`);
    } catch (err) {
      alert('Error al generar el link: ' + err.message);
    } finally {
      setGenerandoLink(false);
    }
  }

  async function guardar(e) {
    e.preventDefault();
    const esChofer = form.rol === 'chofer';
    if (!form.nombre || !form.rol) { alert('Completá nombre y rol.'); return; }
    if (!esChofer && !form.email_1) { alert('Completá el email principal.'); return; }
    if (esChofer && !form.dni) { alert('Ingresá el DNI del chofer.'); return; }
    if (esChofer && !form.cuit_chofer) { alert('El CUIT del chofer es obligatorio.'); return; }
    if (!editando && !form.password) { alert('Ingresá una contraseña.'); return; }
    if (!editando && form.password.length < 6) { alert('La contraseña debe tener al menos 6 caracteres.'); return; }
    if (editando && form.nueva_password && form.nueva_password.length < 6) { alert('La nueva contraseña debe tener al menos 6 caracteres.'); return; }

    const emailAuth = esChofer
      ? form.dni.trim().replace(/\D/g, '') + CHOFER_DOMAIN
      : form.email_1;

    setEnviando(true);
    try {
      const datos = {
        nombre:       form.nombre,
        email_1:      esChofer ? '' : form.email_1,
        email_2:      form.email_2      || '',
        email_3:      form.email_3      || '',
        email:        emailAuth,
        prefijo_1:    form.prefijo_1    || '',
        numero_1:     form.numero_1     || '',
        prefijo_2:    form.prefijo_2    || '',
        numero_2:     form.numero_2     || '',
        prefijo_3:    form.prefijo_3    || '',
        numero_3:     form.numero_3     || '',
        rol:          form.rol,
        empresa:      form.empresa      || '',
        cuit_empresa: form.cuit_empresa || '',
        estado:       form.estado,
        dni:          form.dni          || '',
        cuit_chofer:  form.cuit_chofer  || '',
      };

      if (editando) {
        await updateDoc(doc(db, 'usuarios_portal', editando.docId), datos);
        if (form.nueva_password) {
          try {
            await sendPasswordResetEmail(auth, form.email_1);
            const textoWpp = `Portal Explora — Nueva contraseña\nUsuario: ${form.email_1}\nSe enviará un email de recuperación para que puedas establecer tu nueva contraseña.\nAcceso: https://portal-ivory-zeta.vercel.app`;
            navigator.clipboard.writeText(textoWpp);
            alert('✓ Usuario actualizado.\nSe envió un email de recuperación de contraseña al usuario.\nEl mensaje fue copiado al portapapeles para enviarlo por WhatsApp.');
          } catch (errReset) {
            alert('✓ Datos actualizados, pero hubo un error al enviar el reset de contraseña: ' + errReset.message);
          }
        } else {
          alert('✓ Usuario actualizado.');
        }
        setVista('lista');
      } else {
        const cred = await createUserWithEmailAndPassword(secondaryAuth, emailAuth, form.password);
        await secondaryAuth.signOut();
        await setDoc(doc(db, 'usuarios_portal', cred.user.uid), {
          uid: cred.user.uid,
          email: emailAuth,
          ...datos,
          creado_por: usuario?.nombre || 'Admin',
          creado_en: new Date().toLocaleString('es-AR'),
        });
        setCredencialCreada({
          esChofer: form.rol === 'chofer',
          dni: form.dni,
          email: emailAuth,
          password: form.password,
        });
        setForm(FORM_VACIO);
      }
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        alert('Ya existe un usuario con ese email.');
      } else {
        alert('Error: ' + err.message);
      }
    } finally {
      setEnviando(false);
    }
  }

  async function toggleEstado(u) {
    const nuevoEstado = u.estado === 'activo' ? 'inactivo' : 'activo';
    await updateDoc(doc(db, 'usuarios_portal', u.docId), { estado: nuevoEstado });
  }

  async function eliminarUsuario(u) {
    if (!window.confirm(`¿Eliminar a ${u.nombre}? Esta acción no se puede deshacer.\n\nNota: el usuario será eliminado del portal. Para eliminarlo completamente de Firebase Authentication, hacelo desde la consola de Firebase.`)) return;
    await deleteDoc(doc(db, 'usuarios_portal', u.docId));
    alert('✓ Usuario eliminado del portal.');
  }

  const rolColors = {
    admin:         { bg: '#1D1D1D', color: '#fff' },
    coordinador:   { bg: '#E1F5EE', color: '#085041' },
    comercial:     { bg: '#EEEDFE', color: '#3C3489' },
    transportista: { bg: '#FAEEDA', color: '#633806' },
    chofer:        { bg: '#EAF3DE', color: '#27500A' },
  };

  const estadoChoferColors = {
    recibido: { bg: '#EFF6FF', color: '#1D4ED8' },
    iniciado: { bg: '#E1F5EE', color: '#085041' },
    demorado: { bg: '#FAEEDA', color: '#633806' },
  };
  const estadoChoferLabel = {
    recibido: 'Viaje recibido',
    iniciado: 'En ruta',
    demorado: 'Demorado',
  };

  function telFormateado(pre, num) {
    if (!pre && !num) return null;
    if (pre && num) return `(${pre}) ${num}`;
    return pre || num;
  }

  function esEmailPassword(u) {
    const email = u.email_1 || u.email || '';
    return !email.endsWith('@explora.com.ar');
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <div style={styles.logoArea}>
          <img src="/logo.png" alt="Explora" style={{ height: 32, objectFit: 'contain' }} />
          <span style={styles.portalText}>Administración</span>
        </div>
        <button style={styles.btnVolver} onClick={onVolver}>← Inicio</button>
      </div>

      {/* ══ LISTA ══ */}
      {vista === 'lista' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>Usuarios del portal</h2>
            <button style={styles.btnPrimary} onClick={abrirNuevo}>+ Nuevo usuario</button>
            <label style={{ padding: '8px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {importando ? 'Importando...' : '📥 Importar choferes'}
              <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={importarChoferes} disabled={importando} />
            </label>
            <button style={{ padding: '8px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 13, cursor: 'pointer' }} onClick={exportarChoferes}>📤 Exportar choferes</button>
          </div>
          <div style={styles.metrics}>
            {['admin', 'coordinador', 'comercial', 'transportista', 'chofer'].map(rol => (
              <div key={rol} style={styles.metric}>
                <div style={styles.metricLabel}>{rol}</div>
                <div style={{ ...styles.metricValue, color: rol === 'admin' ? '#111827' : rol === 'coordinador' ? '#0F6E56' : rol === 'comercial' ? '#534AB7' : rol === 'chofer' ? '#27500A' : '#BA7517' }}>
                  {usuarios.filter(u => u.rol === rol).length}
                </div>
              </div>
            ))}
          </div>

          {/* ══ VIAJES ACTIVOS ══ */}
          {viajesActivos.length > 0 && (
            <div style={styles.viajesSection}>
              <div style={styles.viajesTitulo}>🚛 Viajes activos — {viajesActivos.length} en curso</div>
              <p style={styles.viajesDesc}>Choferes con viaje iniciado desde la app. Podés finalizar manualmente si el chofer no cerró el viaje.</p>
              {viajesActivos.map(v => (
                <div key={v.uid} style={styles.viajeCard}>
                  <div style={styles.viajeHeader}>
                    <span style={{ ...styles.pill, background: estadoChoferColors[v.estado_chofer]?.bg, color: estadoChoferColors[v.estado_chofer]?.color }}>
                      {estadoChoferLabel[v.estado_chofer] || v.estado_chofer}
                    </span>
                    <span style={styles.viajeChofer}>{v.chofer}</span>
                    {v.dni_chofer && <span style={styles.viajeDni}>DNI {v.dni_chofer}</span>}
                    <span style={styles.viajeId}>{v.pedidoId}</span>
                  </div>
                  <div style={styles.viajeGrid}>
                    <div style={styles.field}><span style={styles.label}>Producto</span><span>{v.producto}</span></div>
                    <div style={styles.field}><span style={styles.label}>Cliente</span><span>{v.cliente}</span></div>
                    <div style={styles.field}><span style={styles.label}>Transportista</span><span>{v.transporte || '—'}</span></div>
                    <div style={styles.field}><span style={styles.label}>Patente</span><span>{v.patente_tractor || '—'}</span></div>
                    <div style={styles.field}><span style={styles.label}>Fecha carga</span><span>{v.fecha_carga || '—'}</span></div>
                  </div>
                  <button
                    style={{ ...styles.btnFinalizarViaje, opacity: finalizando === v.uid ? 0.7 : 1 }}
                    disabled={finalizando === v.uid}
                    onClick={() => finalizarViaje(v)}>
                    {finalizando === v.uid ? 'Finalizando...' : '✓ Finalizar viaje manualmente'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {resultadoImport && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#F0FDF4', border: '0.5px solid #5DCAA5', marginBottom: 10, fontSize: 13 }}>
              <div style={{ fontWeight: 500, color: '#0F6E56', marginBottom: 4 }}>✓ Importación completada</div>
              <div style={{ color: '#374151' }}>Creados: <strong>{resultadoImport.creados}</strong> · Duplicados: <strong>{resultadoImport.duplicados}</strong>{resultadoImport.errores.length > 0 ? ` · Errores: ${resultadoImport.errores.length}` : ''}</div>
              {resultadoImport.errores.length > 0 && <div style={{ color: '#A32D2D', fontSize: 11, marginTop: 4 }}>{resultadoImport.errores.join(' | ')}</div>}
              <button style={{ fontSize: 11, marginTop: 6, padding: '3px 10px', borderRadius: 6, border: '0.5px solid #E5E7EB', background: '#fff', cursor: 'pointer' }} onClick={() => setResultadoImport(null)}>Cerrar</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
            {['todos', 'admin', 'coordinador', 'comercial', 'transportista', 'chofer'].map(r => (
              <button key={r} style={{ padding: '5px 14px', borderRadius: 20, border: '0.5px solid #E5E7EB', background: filtroRol === r ? '#FDECEA' : '#fff', color: filtroRol === r ? '#C8102E' : '#6B7280', fontSize: 12, fontWeight: filtroRol === r ? 500 : 400, cursor: 'pointer', borderColor: filtroRol === r ? '#C8102E' : '#E5E7EB' }}
                onClick={() => setFiltroRol(r)}>{r === 'todos' ? 'Todos' : r}</button>
            ))}
            <div style={{ position: 'relative', marginLeft: 'auto' }}>
              <input style={{ fontSize: 13, padding: '6px 30px 6px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: 200 }}
                type="text" placeholder="Buscar nombre o empresa..."
                value={busquedaUsuario} onChange={e => setBusquedaUsuario(e.target.value)} />
              {busquedaUsuario && <button style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 13 }} onClick={() => setBusquedaUsuario('')}>✕</button>}
            </div>
          </div>

          {usuarios.filter(u => {
            const matchRol = filtroRol === 'todos' || u.rol === filtroRol;
            const q = busquedaUsuario.toLowerCase();
            const matchBusq = !q || (u.nombre || '').toLowerCase().includes(q) || (u.empresa || '').toLowerCase().includes(q);
            return matchRol && matchBusq;
          }).length === 0 && <div style={styles.empty}>Sin resultados.</div>}
          {usuarios.filter(u => {
            const matchRol = filtroRol === 'todos' || u.rol === filtroRol;
            const q = busquedaUsuario.toLowerCase();
            const matchBusq = !q || (u.nombre || '').toLowerCase().includes(q) || (u.empresa || '').toLowerCase().includes(q);
            return matchRol && matchBusq;
          }).map(u => (
            <div key={u.docId} style={{ ...styles.card, opacity: u.estado === 'inactivo' ? 0.6 : 1 }}>
              <div style={styles.cardHeader}>
                <span style={{ ...styles.pill, background: rolColors[u.rol]?.bg, color: rolColors[u.rol]?.color }}>
                  {u.rol}
                </span>
                <span style={styles.cardNombre}>{u.nombre}</span>
                <span style={styles.cardEmail}>{u.email_1 || u.email}</span>
                {u.estado === 'inactivo' && <span style={styles.badgeInactivo}>Inactivo</span>}
              </div>
              <div style={styles.cardBody}>
                <div style={styles.detailGrid}>
                  {u.empresa      && <div style={styles.field}><span style={styles.label}>Empresa</span><span>{u.empresa}</span></div>}
                  {u.cuit_empresa && <div style={styles.field}><span style={styles.label}>CUIT</span><span>{u.cuit_empresa}</span></div>}
                  {u.email_2      && <div style={styles.field}><span style={styles.label}>Email 2</span><span>{u.email_2}</span></div>}
                  {u.email_3      && <div style={styles.field}><span style={styles.label}>Email 3</span><span>{u.email_3}</span></div>}
                  {telFormateado(u.prefijo_1, u.numero_1) && <div style={styles.field}><span style={styles.label}>Teléfono 1</span><span>{telFormateado(u.prefijo_1, u.numero_1)}</span></div>}
                  {telFormateado(u.prefijo_2, u.numero_2) && <div style={styles.field}><span style={styles.label}>Teléfono 2</span><span>{telFormateado(u.prefijo_2, u.numero_2)}</span></div>}
                  {telFormateado(u.prefijo_3, u.numero_3) && <div style={styles.field}><span style={styles.label}>Teléfono 3</span><span>{telFormateado(u.prefijo_3, u.numero_3)}</span></div>}
                  <div style={styles.field}><span style={styles.label}>Creado por</span><span>{u.creado_por} · {u.creado_en}</span></div>
                </div>
                <div style={styles.cardActions}>
                  <button style={styles.btnEditar} onClick={() => abrirEditar(u)}>✏️ Editar</button>
                  {esEmailPassword(u) && (
                    <button style={styles.btnReset} onClick={() => generarResetLink(u)} disabled={generandoLink}>
                      🔑 Reset contraseña
                    </button>
                  )}
                  <button style={{ ...styles.btnToggle, color: u.estado === 'activo' ? '#A32D2D' : '#0F6E56' }}
                    onClick={() => toggleEstado(u)}>
                    {u.estado === 'activo' ? '⏸ Desactivar' : '▶ Activar'}
                  </button>
                  <button style={styles.btnEliminar} onClick={() => eliminarUsuario(u)}>
                    🗑 Eliminar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══ FORM ══ */}
      {vista === 'form' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>{editando ? 'Editar usuario' : 'Nuevo usuario'}</h2>
            <button style={styles.btnVolver} onClick={() => { setVista('lista'); setCredencialCreada(null); }}>← Volver</button>
          </div>

          {credencialCreada && (
            <div style={styles.credencialBanner}>
              <div style={styles.credencialTitulo}>✓ Usuario creado correctamente</div>
              {credencialCreada.esChofer ? (
                <>
                  <div style={styles.credencialFila}>
                    <span style={styles.credencialLabel}>DNI (usuario)</span>
                    <span style={styles.credencialValor}>{credencialCreada.dni}</span>
                  </div>
                  <div style={styles.credencialFila}>
                    <span style={styles.credencialLabel}>Contraseña</span>
                    <span style={styles.credencialValor}>{credencialCreada.password}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#0F6E56', marginTop: 4 }}>El chofer ingresa con DNI desde "Ingresar como chofer"</div>
                </>
              ) : (
                <>
                  <div style={styles.credencialFila}>
                    <span style={styles.credencialLabel}>Email</span>
                    <span style={styles.credencialValor}>{credencialCreada.email}</span>
                  </div>
                  <div style={styles.credencialFila}>
                    <span style={styles.credencialLabel}>Contraseña</span>
                    <span style={styles.credencialValor}>{credencialCreada.password}</span>
                  </div>
                </>
              )}
              <div style={styles.credencialAcciones}>
                <button style={styles.btnCopiar} onClick={copiarCredencial}>📋 Copiar para WhatsApp</button>
                <button style={styles.btnNuevoUsuario} onClick={abrirNuevo}>+ Crear otro usuario</button>
                <button style={styles.btnVolver} onClick={() => { setVista('lista'); setCredencialCreada(null); }}>Volver a la lista</button>
              </div>
            </div>
          )}

          {!credencialCreada && (
            <form onSubmit={guardar} style={styles.form}>
              <div style={styles.seccion}>
                <div style={styles.seccionTitulo}>Datos personales</div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Nombre completo *</label>
                  <input style={styles.input} type="text" placeholder="Apellido, Nombre"
                    value={form.nombre} onChange={f('nombre')} />
                </div>
              </div>

              <div style={styles.seccion}>
                <div style={styles.seccionTitulo}>Emails</div>
                <div style={styles.grid2}>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Email 1 {form.rol !== 'chofer' ? '*' : ''}{editando ? ' (no editable)' : ''}</label>
                    <input style={styles.input} type="email" placeholder="usuario@email.com"
                      value={form.email_1} onChange={f('email_1')} disabled={!!editando || form.rol === 'chofer'} />
                    {form.rol === 'chofer' && <span style={styles.passHint}>Los choferes ingresan con DNI, no con email.</span>}
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Email 2</label>
                    <input style={styles.input} type="email" placeholder="alternativo@email.com"
                      value={form.email_2} onChange={f('email_2')} disabled={form.rol === 'chofer'} />
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Email 3</label>
                    <input style={styles.input} type="email" placeholder="otro@email.com"
                      value={form.email_3} onChange={f('email_3')} disabled={form.rol === 'chofer'} />
                  </div>
                </div>
              </div>

              <div style={styles.seccion}>
                <div style={styles.seccionTitulo}>Teléfonos / WhatsApp</div>
                {[1, 2, 3].map(n => (
                  <div key={n} style={{ marginBottom: n < 3 ? 12 : 0 }}>
                    <label style={styles.formLabel}>Teléfono {n}{n > 1 ? ' (opcional)' : ''}</label>
                    <div style={styles.telRow}>
                      <div style={styles.telPrefijoWrap}>
                        <input style={styles.input} type="text" placeholder="Prefijo" maxLength={4}
                          value={form[`prefijo_${n}`]} onChange={f(`prefijo_${n}`)} />
                        <span style={styles.telHint}>Sin 0 · 2-4 díg.</span>
                      </div>
                      <div style={styles.telNumeroWrap}>
                        <input style={styles.input} type="text" placeholder="Número" maxLength={8}
                          value={form[`numero_${n}`]} onChange={f(`numero_${n}`)} />
                        <span style={styles.telHint}>Sin 15 · 6-8 díg.</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {!editando && (
                <div style={styles.seccion}>
                  <div style={styles.seccionTitulo}>Contraseña de acceso</div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Contraseña *</label>
                    <div style={styles.passwordRow}>
                      <input style={{ ...styles.input, flex: 1 }}
                        type={verPassword ? 'text' : 'password'}
                        placeholder="Mínimo 6 caracteres"
                        value={form.password} onChange={f('password')} />
                      <button type="button" style={styles.btnVerPass} onClick={() => setVerPassword(!verPassword)}>
                        {verPassword ? '🙈 Ocultar' : '👁 Ver'}
                      </button>
                    </div>
                    <span style={styles.passHint}>La vas a ver una sola vez al confirmar. Guardala para enviársela al usuario.</span>
                  </div>
                </div>
              )}

              {editando && esEmailPassword(editando) && (
                <div style={styles.seccion}>
                  <div style={styles.seccionTitulo}>Cambiar contraseña</div>
                  <div style={styles.resetInfo}>
                    <span style={styles.resetInfoText}>
                      ⚠️ Por seguridad, el cambio de contraseña se realiza enviando un email de recuperación al usuario. Si completás este campo, al guardar se enviará el link automáticamente.
                    </span>
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>¿Querés resetear la contraseña? (opcional)</label>
                    <div style={styles.passwordRow}>
                      <input style={{ ...styles.input, flex: 1 }}
                        type={verNuevaPassword ? 'text' : 'password'}
                        placeholder="Dejá vacío para no cambiarla"
                        value={form.nueva_password} onChange={f('nueva_password')} />
                      <button type="button" style={styles.btnVerPass} onClick={() => setVerNuevaPassword(!verNuevaPassword)}>
                        {verNuevaPassword ? '🙈 Ocultar' : '👁 Ver'}
                      </button>
                    </div>
                    <span style={styles.passHint}>Si completás este campo, se enviará un email de recuperación al usuario y el texto se copiará al portapapeles para enviarlo por WhatsApp.</span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <button type="button" style={styles.btnResetDirecto}
                      onClick={() => generarResetLink(editando)} disabled={generandoLink}>
                      {generandoLink ? 'Enviando...' : '🔑 Enviar reset ahora y copiar para WhatsApp'}
                    </button>
                  </div>
                </div>
              )}

              <div style={styles.seccion}>
                <div style={styles.seccionTitulo}>Rol y acceso</div>
                <div style={styles.grid2}>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Rol *</label>
                    <select style={styles.input} value={form.rol} onChange={f('rol')}>
                      <option value="admin">Admin</option>
                      <option value="coordinador">Coordinador</option>
                      <option value="comercial">Comercial</option>
                      <option value="transportista">Transportista</option>
                      <option value="chofer">Chofer</option>
                    </select>
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Estado</label>
                    <select style={styles.input} value={form.estado} onChange={f('estado')}>
                      <option value="activo">Activo</option>
                      <option value="inactivo">Inactivo</option>
                    </select>
                  </div>
                </div>
              </div>

              {(form.rol === 'transportista' || form.rol === 'admin') && (
                <div style={styles.seccion}>
                  <div style={styles.seccionTitulo}>Datos empresa</div>
                  <div style={styles.grid2}>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Razón social</label>
                      <input style={styles.input} type="text" placeholder="Nombre de la empresa"
                        value={form.empresa} onChange={f('empresa')} />
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>CUIT empresa</label>
                      <input style={styles.input} type="text" placeholder="20-00000000-0"
                        value={form.cuit_empresa} onChange={f('cuit_empresa')} />
                    </div>
                  </div>
                </div>
              )}

              {form.rol === 'chofer' && (
                <div style={styles.seccion}>
                  <div style={styles.seccionTitulo}>Datos del chofer</div>
                  <div style={styles.grid2}>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>DNI *</label>
                      <input style={styles.input} type="text" placeholder="12345678"
                        value={form.dni} onChange={f('dni')} maxLength={8} />
                      <span style={styles.passHint}>Se usa para vincular al chofer con los despachos nominados.</span>
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>Empresa transportista</label>
                      <input style={styles.input} type="text" placeholder="Nombre de la empresa"
                        value={form.empresa} onChange={f('empresa')} />
                    </div>
                    <div style={styles.formField}>
                      <label style={styles.formLabel}>CUIT chofer * (sin guiones)</label>
                      <input style={styles.input} type="text" placeholder="20123456789" maxLength={11}
                        value={form.cuit_chofer} onChange={e => setForm(prev => ({ ...prev, cuit_chofer: e.target.value.replace(/\D/g, '') }))} />
                      <span style={styles.passHint}>Requerido para autocompletar en la nominación del transportista.</span>
                    </div>
                  </div>
                </div>
              )}

              <div style={styles.formActions}>
                <button type="submit"
                  style={{ ...styles.btnPrimary, padding: '11px', fontSize: 14, opacity: enviando ? 0.7 : 1 }}
                  disabled={enviando}>
                  {enviando ? 'Guardando...' : editando ? 'Guardar cambios' : 'Crear usuario'}
                </button>
                <button type="button" style={styles.btnCancelar}
                  onClick={() => { setVista('lista'); setCredencialCreada(null); }}>
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: { maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem' },
  logoArea: { display: 'flex', alignItems: 'center', gap: 8 },
  portalText: { fontSize: 13, color: '#9CA3AF', marginLeft: 4 },
  btnVolver: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' },
  titulo: { fontSize: 18, fontWeight: 500, color: '#111827' },
  btnPrimary: { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: '1.5rem' },
  metric: { background: '#F9FAFB', borderRadius: 8, padding: '12px 14px' },
  metricLabel: { fontSize: 11, color: '#9CA3AF', marginBottom: 4, textTransform: 'capitalize' },
  metricValue: { fontSize: 20, fontWeight: 500 },
  empty: { textAlign: 'center', padding: '2rem', color: '#9CA3AF', fontSize: 13 },
  viajesSection: { marginBottom: '1.5rem', padding: '14px', background: '#FFF7ED', border: '0.5px solid #FCD34D', borderRadius: 12 },
  viajesTitulo: { fontSize: 13, fontWeight: 600, color: '#92400E', marginBottom: 4 },
  viajesDesc: { fontSize: 12, color: '#B45309', marginBottom: 12 },
  viajeCard: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 10, padding: '10px 12px', marginBottom: 8 },
  viajeHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  viajeChofer: { fontSize: 13, fontWeight: 600, color: '#111827', flex: 1 },
  viajeDni: { fontSize: 11, color: '#6B7280' },
  viajeId: { fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace' },
  viajeGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 10 },
  btnFinalizarViaje: { padding: '7px 14px', borderRadius: 8, border: 'none', background: '#0F6E56', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  card: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', background: '#F9FAFB', flexWrap: 'wrap' },
  pill: { fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 20, flexShrink: 0, textTransform: 'capitalize' },
  cardNombre: { fontSize: 13, fontWeight: 500, color: '#111827', flex: 1 },
  cardEmail: { fontSize: 12, color: '#9CA3AF' },
  badgeInactivo: { fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#F3F4F6', color: '#6B7280', border: '0.5px solid #E5E7EB' },
  cardBody: { padding: '12px 14px' },
  detailGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginBottom: 10 },
  field: { display: 'flex', flexDirection: 'column', gap: 3 },
  label: { fontSize: 11, color: '#9CA3AF' },
  cardActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  btnEditar: { padding: '6px 12px', borderRadius: 8, border: '0.5px solid #C8102E', background: '#fff', color: '#C8102E', fontSize: 12, cursor: 'pointer' },
  btnReset: { padding: '6px 12px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer' },
  btnToggle: { padding: '6px 12px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', fontSize: 12, cursor: 'pointer' },
  btnEliminar: { padding: '6px 12px', borderRadius: 8, border: '0.5px solid #FECACA', background: '#FEF2F2', color: '#A32D2D', fontSize: 12, cursor: 'pointer' },
  form: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, padding: '1.5rem' },
  seccion: { marginBottom: '1.5rem' },
  seccionTitulo: { fontSize: 12, fontWeight: 500, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: '0.5px solid #F3F4F6' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 },
  formField: { display: 'flex', flexDirection: 'column', gap: 5 },
  formLabel: { fontSize: 13, color: '#6B7280', fontWeight: 500, marginBottom: 4 },
  input: { fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%', boxSizing: 'border-box' },
  telRow: { display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 4 },
  telPrefijoWrap: { display: 'flex', flexDirection: 'column', gap: 3, flex: '0 0 110px' },
  telNumeroWrap: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1 },
  telHint: { fontSize: 10, color: '#9CA3AF' },
  passwordRow: { display: 'flex', gap: 8, alignItems: 'center' },
  btnVerPass: { padding: '8px 12px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 },
  passHint: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  resetInfo: { background: '#FFFBEB', border: '0.5px solid #FCD34D', borderRadius: 8, padding: '10px 12px', marginBottom: 12 },
  resetInfoText: { fontSize: 12, color: '#92400E' },
  btnResetDirecto: { padding: '8px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#F9FAFB', color: '#374151', fontSize: 12, cursor: 'pointer' },
  credencialBanner: { background: '#E1F5EE', border: '0.5px solid #5DCAA5', borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem' },
  credencialTitulo: { fontSize: 14, fontWeight: 600, color: '#085041', marginBottom: 12 },
  credencialFila: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 },
  credencialLabel: { fontSize: 12, color: '#6B7280', width: 80, flexShrink: 0 },
  credencialValor: { fontSize: 14, fontWeight: 500, color: '#111827', fontFamily: 'monospace', background: '#fff', padding: '4px 10px', borderRadius: 6, border: '0.5px solid #E5E7EB' },
  credencialAcciones: { display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  btnCopiar: { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#085041', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnNuevoUsuario: { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  formActions: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: '1.5rem' },
  btnCancelar: { padding: '11px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#111827', fontSize: 14, cursor: 'pointer' },
};

export default Admin;
