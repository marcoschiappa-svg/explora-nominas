import React, { useState, useEffect } from 'react';
import { db, auth } from '../firebase';
import { collection, onSnapshot, doc, setDoc, updateDoc, addDoc } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { initializeApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';

// Segunda instancia de Firebase solo para crear usuarios sin romper la sesión del admin
const firebaseConfig = {
  apiKey: "AIzaSyA_cmSLuKPVYXjgQu75varhmEBkaY0uwss",
  authDomain: "explora-portal.firebaseapp.com",
  projectId: "explora-portal",
  storageBucket: "explora-portal.firebasestorage.app",
  messagingSenderId: "871895783017",
  appId: "1:871895783017:web:9503299046accde84774f8"
};
const secondaryApp  = initializeApp(firebaseConfig, 'secondary');
const secondaryAuth = getAuth(secondaryApp);

function Admin({ usuario, onVolver }) {
  const [seccion, setSeccion] = useState('usuarios');

  // ── USUARIOS ──
  const [usuarios, setUsuarios] = useState([]);
  const [vista, setVista] = useState('lista');
  const [editando, setEditando] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [verPassword, setVerPassword] = useState(false);
  const [credencialCreada, setCredencialCreada] = useState(null); // { email, password }
  const [form, setForm] = useState({
    nombre: '', email: '', password: '', rol: 'comercial',
    empresa: '', cuit_empresa: '', telefono: '', estado: 'activo',
  });

  // ── TRANSPORTISTAS ──
  const [transportistas, setTransportistas] = useState([]);
  const [vistaT, setVistaT] = useState('lista');
  const [editandoT, setEditandoT] = useState(null);
  const [enviandoT, setEnviandoT] = useState(false);
  const [formT, setFormT] = useState({
    empresa: '', cuit_empresa: '',
    nombre_contacto: '',
    email_1: '', email_2: '', email_3: '',
    telefono_1: '', telefono_2: '', telefono_3: '',
    obs: '', estado: 'activo',
  });

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'usuarios_portal'), (snap) => {
      const data = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
      data.sort((a, b) => a.nombre?.localeCompare(b.nombre));
      setUsuarios(data);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'transportistas_portal'), (snap) => {
      const data = snap.docs.map(d => ({ docId: d.id, ...d.data() }));
      data.sort((a, b) => a.empresa?.localeCompare(b.empresa));
      setTransportistas(data);
    });
    return () => unsub();
  }, []);

  // ── USUARIOS: funciones ──
  function abrirNuevo() {
    setEditando(null);
    setCredencialCreada(null);
    setVerPassword(false);
    setForm({ nombre: '', email: '', password: '', rol: 'comercial', empresa: '', cuit_empresa: '', telefono: '', estado: 'activo' });
    setVista('form');
  }

  function abrirEditar(u) {
    setEditando(u);
    setCredencialCreada(null);
    setVerPassword(false);
    setForm({
      nombre: u.nombre || '', email: u.email || '', password: '',
      rol: u.rol || 'comercial', empresa: u.empresa || '',
      cuit_empresa: u.cuit_empresa || '', telefono: u.telefono || '',
      estado: u.estado || 'activo',
    });
    setVista('form');
  }

  function copiarCredencial() {
    if (!credencialCreada) return;
    const texto = `Portal Explora\nUsuario: ${credencialCreada.email}\nContraseña: ${credencialCreada.password}\nAcceso: https://portal-ivory-zeta.vercel.app`;
    navigator.clipboard.writeText(texto);
    alert('✓ Credenciales copiadas al portapapeles.');
  }

  async function guardar(e) {
    e.preventDefault();
    if (!form.nombre || !form.email || !form.rol) {
      alert('Completá nombre, email y rol.');
      return;
    }
    if (!editando && !form.password) {
      alert('Ingresá una contraseña para el usuario.');
      return;
    }
    if (!editando && form.password.length < 6) {
      alert('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    setEnviando(true);
    try {
      if (editando) {
        await updateDoc(doc(db, 'usuarios_portal', editando.docId), {
          nombre: form.nombre, rol: form.rol,
          empresa: form.empresa || '', cuit_empresa: form.cuit_empresa || '',
          telefono: form.telefono || '', estado: form.estado,
        });
        alert('✓ Usuario actualizado.');
        setVista('lista');
      } else {
        // Usar segunda instancia para no romper sesión del admin
        const cred = await createUserWithEmailAndPassword(secondaryAuth, form.email, form.password);
        await secondaryAuth.signOut();

        await setDoc(doc(db, 'usuarios_portal', cred.user.uid), {
          uid: cred.user.uid, nombre: form.nombre, email: form.email,
          rol: form.rol, empresa: form.empresa || '',
          cuit_empresa: form.cuit_empresa || '', telefono: form.telefono || '',
          estado: 'activo', creado_por: usuario?.nombre || 'Admin',
          creado_en: new Date().toLocaleString('es-AR'),
        });

        setCredencialCreada({ email: form.email, password: form.password });
        setForm(prev => ({ ...prev, nombre: '', email: '', password: '', empresa: '', cuit_empresa: '', telefono: '' }));
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

  async function resetPassword(u) {
    if (!window.confirm(`¿Enviar email de recuperación a ${u.email}?`)) return;
    await sendPasswordResetEmail(auth, u.email);
    alert('✓ Email de recuperación enviado.');
  }

  // ── TRANSPORTISTAS: funciones ──
  function abrirNuevoT() {
    setEditandoT(null);
    setFormT({
      empresa: '', cuit_empresa: '', nombre_contacto: '',
      email_1: '', email_2: '', email_3: '',
      telefono_1: '', telefono_2: '', telefono_3: '',
      obs: '', estado: 'activo',
    });
    setVistaT('form');
  }

  function abrirEditarT(t) {
    setEditandoT(t);
    setFormT({
      empresa: t.empresa || '', cuit_empresa: t.cuit_empresa || '',
      nombre_contacto: t.nombre_contacto || '',
      email_1: t.email_1 || '', email_2: t.email_2 || '', email_3: t.email_3 || '',
      telefono_1: t.telefono_1 || '', telefono_2: t.telefono_2 || '', telefono_3: t.telefono_3 || '',
      obs: t.obs || '', estado: t.estado || 'activo',
    });
    setVistaT('form');
  }

  async function guardarT(e) {
    e.preventDefault();
    if (!formT.empresa || !formT.email_1 || !formT.telefono_1) {
      alert('Completá razón social, al menos un email y un teléfono.');
      return;
    }
    setEnviandoT(true);
    try {
      const datos = {
        empresa: formT.empresa, cuit_empresa: formT.cuit_empresa || '',
        nombre_contacto: formT.nombre_contacto || '',
        email_1: formT.email_1, email_2: formT.email_2 || '', email_3: formT.email_3 || '',
        telefono_1: formT.telefono_1, telefono_2: formT.telefono_2 || '', telefono_3: formT.telefono_3 || '',
        obs: formT.obs || '', estado: formT.estado,
      };
      if (editandoT) {
        await updateDoc(doc(db, 'transportistas_portal', editandoT.docId), datos);
        alert('✓ Transportista actualizado.');
      } else {
        await addDoc(collection(db, 'transportistas_portal'), {
          ...datos,
          creado_por: usuario?.nombre || 'Admin',
          creado_en: new Date().toLocaleString('es-AR'),
        });
        alert('✓ Transportista registrado.');
      }
      setVistaT('lista');
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setEnviandoT(false);
    }
  }

  async function toggleEstadoT(t) {
    const nuevoEstado = t.estado === 'activo' ? 'inactivo' : 'activo';
    await updateDoc(doc(db, 'transportistas_portal', t.docId), { estado: nuevoEstado });
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

      <div style={styles.tabs}>
        <button
          style={{ ...styles.tab, ...(seccion === 'usuarios' ? styles.tabActive : {}) }}
          onClick={() => { setSeccion('usuarios'); setVista('lista'); setCredencialCreada(null); }}>
          👤 Usuarios del portal
        </button>
        <button
          style={{ ...styles.tab, ...(seccion === 'transportistas' ? styles.tabActive : {}) }}
          onClick={() => { setSeccion('transportistas'); setVistaT('lista'); }}>
          🚛 Transportistas
        </button>
      </div>

      {/* ══ USUARIOS: LISTA ══ */}
      {seccion === 'usuarios' && vista === 'lista' && (
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
                <span style={{ ...styles.pill, background: rolColors[u.rol]?.bg, color: rolColors[u.rol]?.color }}>
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

      {/* ══ USUARIOS: FORM ══ */}
      {seccion === 'usuarios' && vista === 'form' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>{editando ? 'Editar usuario' : 'Nuevo usuario'}</h2>
            <button style={styles.btnVolver} onClick={() => { setVista('lista'); setCredencialCreada(null); }}>← Volver</button>
          </div>

          {/* Banner de credencial creada */}
          {credencialCreada && (
            <div style={styles.credencialBanner}>
              <div style={styles.credencialTitulo}>✓ Usuario creado correctamente</div>
              <div style={styles.credencialFila}>
                <span style={styles.credencialLabel}>Email</span>
                <span style={styles.credencialValor}>{credencialCreada.email}</span>
              </div>
              <div style={styles.credencialFila}>
                <span style={styles.credencialLabel}>Contraseña</span>
                <span style={styles.credencialValor}>{credencialCreada.password}</span>
              </div>
              <div style={styles.credencialAcciones}>
                <button style={styles.btnCopiar} onClick={copiarCredencial}>📋 Copiar para WhatsApp</button>
                <button style={styles.btnNuevoUsuario} onClick={abrirNuevo}>+ Crear otro usuario</button>
                <button style={styles.btnVolver2} onClick={() => { setVista('lista'); setCredencialCreada(null); }}>Volver a la lista</button>
              </div>
            </div>
          )}

          {!credencialCreada && (
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

              {!editando && (
                <div style={styles.seccion}>
                  <div style={styles.seccionTitulo}>Contraseña de acceso</div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Contraseña *</label>
                    <div style={styles.passwordRow}>
                      <input
                        style={{ ...styles.input, flex: 1 }}
                        type={verPassword ? 'text' : 'password'}
                        placeholder="Mínimo 6 caracteres"
                        value={form.password}
                        onChange={e => setForm({ ...form, password: e.target.value })}
                      />
                      <button type="button" style={styles.btnVerPass} onClick={() => setVerPassword(!verPassword)}>
                        {verPassword ? '🙈 Ocultar' : '👁 Ver'}
                      </button>
                    </div>
                    <span style={styles.passHint}>Esta contraseña la vas a ver una sola vez al confirmar. Guardala o copiala para enviársela al usuario.</span>
                  </div>
                </div>
              )}

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

              {(form.rol === 'transportista' || form.rol === 'admin') && (
                <div style={styles.seccion}>
                  <div style={styles.seccionTitulo}>Datos empresa</div>
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
                <button type="button" style={styles.btnCancelar} onClick={() => { setVista('lista'); setCredencialCreada(null); }}>Cancelar</button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ══ TRANSPORTISTAS: LISTA ══ */}
      {seccion === 'transportistas' && vistaT === 'lista' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>Transportistas habilitados</h2>
            <button style={styles.btnPrimary} onClick={abrirNuevoT}>+ Nuevo transportista</button>
          </div>
          <div style={styles.metrics}>
            <div style={styles.metric}>
              <div style={styles.metricLabel}>Total</div>
              <div style={{ ...styles.metricValue, color: '#111827' }}>{transportistas.length}</div>
            </div>
            <div style={styles.metric}>
              <div style={styles.metricLabel}>Activos</div>
              <div style={{ ...styles.metricValue, color: '#0F6E56' }}>{transportistas.filter(t => t.estado === 'activo').length}</div>
            </div>
            <div style={styles.metric}>
              <div style={styles.metricLabel}>Inactivos</div>
              <div style={{ ...styles.metricValue, color: '#A32D2D' }}>{transportistas.filter(t => t.estado === 'inactivo').length}</div>
            </div>
          </div>
          {transportistas.length === 0 && <div style={styles.empty}>No hay transportistas registrados aún.</div>}
          {transportistas.map(t => (
            <div key={t.docId} style={{ ...styles.card, opacity: t.estado === 'inactivo' ? 0.6 : 1 }}>
              <div style={styles.cardHeader}>
                <span style={{ ...styles.pill, background: t.estado === 'activo' ? '#E1F5EE' : '#F3F4F6', color: t.estado === 'activo' ? '#085041' : '#6B7280' }}>
                  {t.estado}
                </span>
                <span style={styles.cardNombre}>{t.empresa}</span>
                {t.cuit_empresa && <span style={styles.cardEmail}>CUIT: {t.cuit_empresa}</span>}
              </div>
              <div style={styles.cardBody}>
                <div style={styles.detailGrid}>
                  {t.nombre_contacto && <div style={styles.field}><span style={styles.label}>Contacto</span><span>{t.nombre_contacto}</span></div>}
                  {t.email_1 && <div style={styles.field}><span style={styles.label}>Email 1</span><span>{t.email_1}</span></div>}
                  {t.email_2 && <div style={styles.field}><span style={styles.label}>Email 2</span><span>{t.email_2}</span></div>}
                  {t.email_3 && <div style={styles.field}><span style={styles.label}>Email 3</span><span>{t.email_3}</span></div>}
                  {t.telefono_1 && <div style={styles.field}><span style={styles.label}>Teléfono 1</span><span>{t.telefono_1}</span></div>}
                  {t.telefono_2 && <div style={styles.field}><span style={styles.label}>Teléfono 2</span><span>{t.telefono_2}</span></div>}
                  {t.telefono_3 && <div style={styles.field}><span style={styles.label}>Teléfono 3</span><span>{t.telefono_3}</span></div>}
                  {t.obs && <div style={{ ...styles.field, gridColumn: '1/-1' }}><span style={styles.label}>Observaciones</span><span>{t.obs}</span></div>}
                  <div style={styles.field}><span style={styles.label}>Registrado por</span><span>{t.creado_por} · {t.creado_en}</span></div>
                </div>
                <div style={styles.cardActions}>
                  <button style={styles.btnEditar} onClick={() => abrirEditarT(t)}>✏️ Editar</button>
                  <button style={{ ...styles.btnToggle, color: t.estado === 'activo' ? '#A32D2D' : '#0F6E56' }}
                    onClick={() => toggleEstadoT(t)}>
                    {t.estado === 'activo' ? '⏸ Desactivar' : '▶ Activar'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══ TRANSPORTISTAS: FORM ══ */}
      {seccion === 'transportistas' && vistaT === 'form' && (
        <div>
          <div style={styles.panelHeader}>
            <h2 style={styles.titulo}>{editandoT ? 'Editar transportista' : 'Nuevo transportista'}</h2>
            <button style={styles.btnVolver} onClick={() => setVistaT('lista')}>← Volver</button>
          </div>
          <form onSubmit={guardarT} style={styles.form}>
            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Datos de la empresa</div>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Razón social *</label>
                  <input style={styles.input} type="text" placeholder="Nombre de la empresa"
                    value={formT.empresa} onChange={e => setFormT({ ...formT, empresa: e.target.value })} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>CUIT empresa</label>
                  <input style={styles.input} type="text" placeholder="20-00000000-0"
                    value={formT.cuit_empresa} onChange={e => setFormT({ ...formT, cuit_empresa: e.target.value })} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Nombre del contacto</label>
                  <input style={styles.input} type="text" placeholder="Apellido, Nombre"
                    value={formT.nombre_contacto} onChange={e => setFormT({ ...formT, nombre_contacto: e.target.value })} />
                </div>
              </div>
            </div>

            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Emails de contacto</div>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Email 1 *</label>
                  <input style={styles.input} type="email" placeholder="contacto@empresa.com"
                    value={formT.email_1} onChange={e => setFormT({ ...formT, email_1: e.target.value })} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Email 2</label>
                  <input style={styles.input} type="email" placeholder="contacto2@empresa.com"
                    value={formT.email_2} onChange={e => setFormT({ ...formT, email_2: e.target.value })} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Email 3</label>
                  <input style={styles.input} type="email" placeholder="contacto3@empresa.com"
                    value={formT.email_3} onChange={e => setFormT({ ...formT, email_3: e.target.value })} />
                </div>
              </div>
            </div>

            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Teléfonos / WhatsApp</div>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Teléfono 1 *</label>
                  <input style={styles.input} type="text" placeholder="Ej: 3476123456"
                    value={formT.telefono_1} onChange={e => setFormT({ ...formT, telefono_1: e.target.value })} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Teléfono 2</label>
                  <input style={styles.input} type="text" placeholder="Ej: 3476654321"
                    value={formT.telefono_2} onChange={e => setFormT({ ...formT, telefono_2: e.target.value })} />
                </div>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Teléfono 3</label>
                  <input style={styles.input} type="text" placeholder="Ej: 3476987654"
                    value={formT.telefono_3} onChange={e => setFormT({ ...formT, telefono_3: e.target.value })} />
                </div>
              </div>
            </div>

            <div style={styles.seccion}>
              <div style={styles.seccionTitulo}>Adicional</div>
              <div style={styles.grid2}>
                <div style={styles.formField}>
                  <label style={styles.formLabel}>Estado</label>
                  <select style={styles.input} value={formT.estado} onChange={e => setFormT({ ...formT, estado: e.target.value })}>
                    <option value="activo">Activo</option>
                    <option value="inactivo">Inactivo</option>
                  </select>
                </div>
              </div>
              <div style={{ ...styles.formField, marginTop: 12 }}>
                <label style={styles.formLabel}>Observaciones</label>
                <textarea style={{ ...styles.input, minHeight: 70, resize: 'vertical' }}
                  placeholder="Notas internas, condiciones especiales..."
                  value={formT.obs} onChange={e => setFormT({ ...formT, obs: e.target.value })} />
              </div>
            </div>

            <div style={styles.formActions}>
              <button type="submit"
                style={{ ...styles.btnPrimary, padding: '11px', fontSize: 14, opacity: enviandoT ? 0.7 : 1 }}
                disabled={enviandoT}>
                {enviandoT ? 'Guardando...' : editandoT ? 'Guardar cambios' : 'Registrar transportista'}
              </button>
              <button type="button" style={styles.btnCancelar} onClick={() => setVistaT('lista')}>Cancelar</button>
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
  tabs: { display: 'flex', gap: 8, marginBottom: '1.5rem', borderBottom: '0.5px solid #E5E7EB', paddingBottom: '1rem' },
  tab: { padding: '8px 16px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  tabActive: { background: '#FDECEA', borderColor: '#C8102E', color: '#C8102E', fontWeight: 500 },
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
  input: { fontSize: 14, padding: '8px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%', boxSizing: 'border-box' },
  formActions: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: '1.5rem' },
  btnCancelar: { padding: '11px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#111827', fontSize: 14, cursor: 'pointer' },
  // Contraseña
  passwordRow: { display: 'flex', gap: 8, alignItems: 'center' },
  btnVerPass: { padding: '8px 12px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 },
  passHint: { fontSize: 11, color: '#9CA3AF', marginTop: 2 },
  // Banner credencial creada
  credencialBanner: { background: '#E1F5EE', border: '0.5px solid #5DCAA5', borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem' },
  credencialTitulo: { fontSize: 14, fontWeight: 600, color: '#085041', marginBottom: 12 },
  credencialFila: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 },
  credencialLabel: { fontSize: 12, color: '#6B7280', width: 80, flexShrink: 0 },
  credencialValor: { fontSize: 14, fontWeight: 500, color: '#111827', fontFamily: 'monospace', background: '#fff', padding: '4px 10px', borderRadius: 6, border: '0.5px solid #E5E7EB' },
  credencialAcciones: { display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  btnCopiar: { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#085041', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnNuevoUsuario: { padding: '8px 14px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  btnVolver2: { padding: '8px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
};

export default Admin;
