import React, { useState } from 'react';
import { auth } from '../firebase';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';

function Home({ usuario, onModulo, onLogout }) {
  const rol = usuario?.rol || '';
  const [modalPass, setModalPass] = useState(false);
  const [passActual, setPassActual] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [passConfirm, setPassConfirm] = useState('');
  const [verPass, setVerPass] = useState(false);
  const [errorPass, setErrorPass] = useState('');
  const [okPass, setOkPass] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const modulos = [
    { id: 'pedidos', emoji: '📋', titulo: 'Pedidos', desc: 'Crear y gestionar pedidos de entrega y retiro', roles: ['admin', 'comercial', 'coordinador'], color: '#C8102E' },
    { id: 'coordinador', emoji: '📅', titulo: 'Programación', desc: 'Programar despachos y gestionar transportistas', roles: ['admin', 'coordinador'], color: '#0F6E56' },
    { id: 'transportista', emoji: '🚛', titulo: 'Mis despachos', desc: 'Ver y gestionar los despachos asignados', roles: ['admin', 'transportista'], color: '#534AB7' },
    { id: 'admin', emoji: '⚙️', titulo: 'Administración', desc: 'Gestión de usuarios, roles y configuración', roles: ['admin'], color: '#374151' },
  ].filter(m => m.roles.includes(rol));

  async function cambiarPassword(e) {
    e.preventDefault();
    setErrorPass('');
    if (!passActual || !passNueva || !passConfirm) { setErrorPass('Completá todos los campos.'); return; }
    if (passNueva !== passConfirm) { setErrorPass('Las contraseñas nuevas no coinciden.'); return; }
    if (passNueva.length < 8) { setErrorPass('La contraseña debe tener al menos 8 caracteres.'); return; }
    setGuardando(true);
    try {
      const user = auth.currentUser;
      const credential = EmailAuthProvider.credential(user.email, passActual);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, passNueva);
      setOkPass(true);
      setPassActual(''); setPassNueva(''); setPassConfirm('');
      setTimeout(() => { setModalPass(false); setOkPass(false); }, 2000);
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setErrorPass('La contraseña actual es incorrecta.');
      } else if (err.code === 'auth/requires-recent-login') {
        setErrorPass('Por seguridad, cerrá sesión y volvé a ingresar antes de cambiar la contraseña.');
      } else {
        setErrorPass('Error al cambiar la contraseña. Intentá de nuevo.');
      }
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div style={styles.wrap}>
      {modalPass && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalBox}>
            <div style={styles.modalTitulo}>🔑 Cambiar contraseña</div>
            {okPass
              ? <div style={styles.success}>✓ Contraseña actualizada correctamente.</div>
              : (
                <form onSubmit={cambiarPassword} style={styles.form}>
                  {errorPass && <div style={styles.error}>{errorPass}</div>}
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Contraseña actual</label>
                    <div style={styles.passwordRow}>
                      <input style={{ ...styles.input, flex: 1 }} type={verPass ? 'text' : 'password'}
                        value={passActual} onChange={e => setPassActual(e.target.value)} placeholder="••••••••" />
                      <button type="button" style={styles.btnVerPass} onClick={() => setVerPass(!verPass)}>
                        {verPass ? '🙈' : '👁'}
                      </button>
                    </div>
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Contraseña nueva</label>
                    <input style={styles.input} type={verPass ? 'text' : 'password'}
                      value={passNueva} onChange={e => setPassNueva(e.target.value)} placeholder="Mínimo 8 caracteres" />
                  </div>
                  <div style={styles.formField}>
                    <label style={styles.formLabel}>Confirmar contraseña nueva</label>
                    <input style={styles.input} type={verPass ? 'text' : 'password'}
                      value={passConfirm} onChange={e => setPassConfirm(e.target.value)} placeholder="Repetí la contraseña" />
                  </div>
                  <button type="submit"
                    style={{ ...styles.btnPrimary, opacity: guardando ? 0.7 : 1 }}
                    disabled={guardando}>
                    {guardando ? 'Guardando...' : 'Cambiar contraseña'}
                  </button>
                  <button type="button" style={styles.btnCancelar} onClick={() => { setModalPass(false); setErrorPass(''); }}>
                    Cancelar
                  </button>
                </form>
              )}
          </div>
        </div>
      )}

      <div style={styles.topbar}>
        <img src="/logo.png" alt="Explora" style={styles.logo} />
        <div style={styles.userArea}>
          <div style={styles.userName}>{usuario?.nombre || usuario?.email}</div>
          <div style={styles.userRol}>{rol}</div>
        </div>
        <button style={styles.btnCambiarPass} onClick={() => setModalPass(true)}>🔑</button>
        <button style={styles.btnLogout} onClick={onLogout}>Salir</button>
      </div>

      <div style={styles.bienvenida}>
        Bienvenido, <strong>{usuario?.nombre?.split(' ')[0] || 'usuario'}</strong>
      </div>

      <div style={styles.grid}>
        {modulos.map(m => (
          <button key={m.id} style={styles.card} onClick={() => onModulo(m.id)}>
            <div style={{ ...styles.cardIcon, background: m.color + '15', color: m.color }}>{m.emoji}</div>
            <div style={styles.cardTitulo}>{m.titulo}</div>
            <div style={styles.cardDesc}>{m.desc}</div>
            <div style={{ ...styles.cardArrow, color: m.color }}>→</div>
          </button>
        ))}
      </div>

      {usuario?.empresa && (
        <div style={styles.empresaTag}>🏢 {usuario.empresa}</div>
      )}
    </div>
  );
}

const styles = {
  wrap: { maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' },
  modalBox: { background: '#fff', borderRadius: 16, padding: '2rem 1.5rem', maxWidth: 380, width: '100%' },
  modalTitulo: { fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 16, textAlign: 'center' },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  formField: { display: 'flex', flexDirection: 'column', gap: 5 },
  formLabel: { fontSize: 13, color: '#6B7280', fontWeight: 500 },
  input: { fontSize: 14, padding: '9px 11px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%' },
  passwordRow: { display: 'flex', gap: 8, alignItems: 'center' },
  btnVerPass: { padding: '9px 11px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', cursor: 'pointer', fontSize: 14, flexShrink: 0 },
  btnPrimary: { padding: '11px', borderRadius: 10, border: 'none', background: '#C8102E', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  btnCancelar: { padding: '11px', borderRadius: 10, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 14, cursor: 'pointer' },
  error: { padding: '8px 12px', borderRadius: 8, background: '#FCEBEB', border: '0.5px solid #F87171', fontSize: 12, color: '#791F1F' },
  success: { padding: '8px 12px', borderRadius: 8, background: '#E1F5EE', border: '0.5px solid #5DCAA5', fontSize: 12, color: '#085041', textAlign: 'center' },
  topbar: { display: 'flex', alignItems: 'center', gap: 12, paddingBottom: '1rem', borderBottom: '0.5px solid #E5E7EB', marginBottom: '1.5rem' },
  logo: { height: 32, objectFit: 'contain' },
  userArea: { flex: 1 },
  userName: { fontSize: 13, fontWeight: 500, color: '#111827' },
  userRol: { fontSize: 11, color: '#9CA3AF', textTransform: 'capitalize' },
  btnCambiarPass: { padding: '6px 10px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', fontSize: 14, cursor: 'pointer' },
  btnLogout: { padding: '6px 14px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer' },
  bienvenida: { fontSize: 20, color: '#111827', marginBottom: '1.5rem' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 },
  card: { display: 'flex', flexDirection: 'column', gap: 8, padding: '1.25rem', borderRadius: 12, border: '0.5px solid #E5E7EB', background: '#fff', cursor: 'pointer', textAlign: 'left' },
  cardIcon: { width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 },
  cardTitulo: { fontSize: 15, fontWeight: 500, color: '#111827' },
  cardDesc: { fontSize: 12, color: '#9CA3AF', flex: 1 },
  cardArrow: { fontSize: 16, fontWeight: 500 },
  empresaTag: { marginTop: '1.5rem', padding: '8px 14px', borderRadius: 8, background: '#F9FAFB', border: '0.5px solid #E5E7EB', fontSize: 13, color: '#6B7280', textAlign: 'center' },
};

export default Home;