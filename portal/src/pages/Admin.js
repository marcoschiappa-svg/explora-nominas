import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, onSnapshot, doc, setDoc, updateDoc } from 'firebase/firestore';
import { createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';

function Admin({ usuario, onVolver }) {
  const [usuarios, setUsuarios] = useState([]);
  const [vista, setVista] = useState('lista');
  const [editando, setEditando] = useState(null);
  const [enviando, setEnviando] = useState(false);

  const [form, setForm] = useState({
    nombre: '', email: '', rol: 'comercial',
    empresa: '', cuit_empresa: '', telefono: '', estado: 'activo',
  });

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'usuarios_portal'), (snap) => {
      const data = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
      data.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
      setUsuarios(data);
    });
    return () => unsub();
  }, []);

  function abrirNuevo() {
    setEditando(null);
    setForm({ nombre: '', email: '', rol: 'comercial', empresa: '', cuit_empresa: '', telefono: '', estado: 'activo' });
    setVista('form');
  }

  function abrirEditar(u) {
    setEditando(u);
    setForm({
      nombre: u.nombre || '', email: u.email || '', rol: u.rol || 'comercial',
      empresa: u.empresa || '', cuit_empresa: u.cuit_empresa || '',
      telefono: u.telefono || '', estado: u.estado || 'activo',
    });
    setVista('form');
  }

  async function guardar(e) {
    e.preventDefault();
    if (!form.nombre || !form.email || !form.rol) {
      alert('Completá nombre, email y rol.');
      return;
    }
    setEnviando(true);
    try {
      if (editando) {
        await updateDoc(doc(db, 'usuarios_portal', editando.docId), {
          nombre: form.nombre,
          rol: form.rol,
          empresa: form.empresa || '',
          cuit_empresa: form.cuit_empresa || '',
          telefono: form.telefono || '',
          estado: form.estado,
        });
        alert('✓ Usuario actualizado.');
      } else {
        const tempPassword = Math.random().toString(36).slice(-10) + 'X1!';
        const cred = await createUserWithEmailAndPassword(auth, form.email, tempPassword);
        await setDoc(doc(db, 'usuarios_portal', cred.user.uid), {
          uid: cred.user.uid,
          nombre: form.nombre,
          email: form.email,
          rol: form.rol,
          empresa: form.empresa || '',
          cuit_empresa: form.cuit_empresa || '',
          telefono: form.telefono || '',
          estado: 'activo',
          creado_por: usuario?.nombre || 'Admin',
          creado_en: new Date().toLocaleString('es-AR'),
        });
        await sendPasswordResetEmail(auth, form.email);
        alert(`✓ Usuario creado. Se envió email a ${form.email} para configurar su contraseña.`);
      }
      setVista('lista');
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') {
        alert('Ya existe un usuario con ese email.');
      } else {
        alert('Error: ' + err.message);
      }
      console.error(err);
    } finally {
      setEnviando(false);
    }
  }

  async function toggleEstado(u) {
    const nuevoEstado = u.estado === 'activo' ? 'inactivo' : 'activo';
    await updateDoc(doc(db, 'usuarios_portal', u.docId), { estado: nuevoEstado });
  }

  async function resetPassword(u) {
    if (!window.confirm(`¿Enviar email de recuperación a ${u.email}?`)) return;
    await sendPasswordResetEmail(auth, u.email);
    alert('✓ Email de recuperación enviado.');
  }

  const rolColors = {
    admin:         { bg: '#1D1D1D', color: '#fff' },
    coordinador:   { bg: '#E1F5EE', color: '#085041' },
    comercial:     { bg: '#EEEDFE', color: '#3C3489' },
    transportista: { bg: '#FAEEDA', color: '#633806' },
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.topbar}>
        <div style={styles.logoArea}>
          <img src="/logo.png" alt="Explora" style={{ height: 32, objectFit: 'contain' }} />
          <span style={styles.portalText}>Administración</span>
        </div>
        <button style={styles.btnVolver} onClick={onVolver}>← Inicio</button>
      </div>

      {vista === 'lista' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>Usuarios del portal</h2>
            <button style={styles.btnPrimary} onClick={abrirNuevo}>+ Nuevo usuario</button>
          </div>

          <div style={styles.metrics}>
            {['admin', 'coordinador', 'comercial', 'transportista'].map(rol => (
              <div key={rol} style={styles.metric}>
                <div style={styles.metricLabel}>{rol}</div>
                <div style={{ ...styles.metricValue, color: rol === 'admin' ? '#111827' : rol === 'coordinador' ? '#0F6E56' : rol === 'comercial' ? '#534AB7' : '#BA7517' }}>
                  {usuarios.filter(u => u.rol === rol).length}
                </div>
              </div>
            ))}
          </div>

          {usuarios.length === 0 && <div style={styles.empty}>No hay usuarios aún.</div>}

          {usuarios.map(u => (
            <div key={u.docId} style={{ ...styles.card, opacity: u.estado === 'inactivo' ? 0.6 : 1 }}>
              <div style={styles.cardHeader}>
                <span style={{ ...styles.pill, background: rolColors[u.rol]?.bg || '#F3F4F6', color: rolColors[u.rol]?.color || '#6B7280' }}>
                  {u.rol}
                </span>
                <span style={styles.cardNombre}>{u.nombre}</span>
                <span style={styles.cardEmail}>{u.email}</span>
                {u.estado === 'inactivo' && <span style={styles.badgeInactivo}>Inactivo</span>}
              </div>
              <div style={styles.cardBody}>
                <div style={styles.detailGrid}>
                  {u.empresa && <div style={styles.field}><span style={styles.label}>Empresa</span><span>{u.empresa}</span></div>}
                  {u.cuit_empresa && <div style={styles.field}><span style={styles.label}>CUIT</span><span>{u.cuit_empresa}</span></div>}
                  {u.telefono && <div style={styles.field}><span style={styles.label}>WhatsApp</span><span>{u.telefono}</span></div>}
                  <div style={styles.field}><span style={styles.label}>Creado por</span><span>{u.creado_por} · {u.creado_en}</span></div>
                </div>
                <div style={styles.cardActions}>
                  <button style={styles.btnEditar} onClick={() => abrirEditar(u)}>✏️ Editar</button>
                  <button style={styles.btnReset} onClick={() => resetPassword(u)}>🔑 Reset contraseña</button>
                  <button style={{ ...styles.btnToggle, color: u.estado === 'activo' ? '#A32D2D' : '#0F6E56' }}
                    onClick={() => toggleEstado(u)}>
                    {u.estado === 'activo' ? '⏸ Desactivar' : '▶ Activar'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {vista === 'form' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>{editando ? 'Editar usuario' : 'Nuevo usuario'}</h2>
            <button style={styles.btnVolver} onClick={() => setVista('lista')}>← Volver</button>
          </div>

          <form onSubmit={guardar} style={styles.form}>
            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Datos personales</div>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Nombre completo *</label>
                  <input style={styles.input} type="text" placeholder="Apellido, Nombre"
                    value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Email *{editando ? ' (no editable)' : ''}</label>
                  <input style={styles.input} type="email" placeholder="usuario@email.com"
                    value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                    disabled={!!editando} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Teléfono / WhatsApp</label>
                  <input style={styles.input} type="text" placeholder="Ej: 3476123456"
                    value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} />
                </div>
              </div>
            </div>

            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Rol y acceso</div>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Rol *</label>
                  <select style={styles.input} value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })}>
                    <option value="admin">Admin</option>
                    <option value="coordinador">Coordinador</option>
                    <option value="comercial">Comercial</option>
                    <option value="transportista">Transportista</option>
                  </select>
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Estado</label>
                  <select style={styles.input} value={form.estado} onChange={e => setForm({ ...form, estado: e.target.value })}>
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                  </select>
                </div>
              </div>
            </div>

            {(form.rol === 'transportista') && (
              <div style={styles.seccion}>
                <div style={styles.seccionTitulo}>Datos empresa transportista</div>
                <div style={styles.grid2}>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Nombre empresa</label>
                    <input style={styles.input} type="text" placeholder="Razón social"
                      value={form.empresa} onChange={e => setForm({ ...form, empresa: e.target.value })} />
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>CUIT empresa</label>
                    <input style={styles.input} type="text" placeholder="20-00000000-0"
                      value={form.cuit_empresa} onChange={e => setForm({ ...form, cuit_empresa: e.target.value })} />
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
              <button type="button" style={styles.btnCancelar} onClick={() => setVista('lista')}>Cancelar</button>
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
  form: { background: '#fff', border: '0.5px solid #E5E7EB', borderRadius: 12, padding: '1.5rem' },
  seccion: { marginBottom: '1.5rem' },
  seccionTitulo: { fontSize: 12, fontWeight: 500, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, paddingBottom: 6, borderBottom: '0.5px solid #F3F4F6' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 },
  formField: { display: 'flex', flexDirection: 'column', gap: 5 },
  formLabel: { fontSize: 13, color: '#6B7280', fontWeight: 500 },
  input: { fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%' },
  formActions: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: '1.5rem' },
  btnCancelar: { padding: '11px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#111827', fontSize: 14, cursor: 'pointer' },
};

export default Admin;