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

      {/* Modal cambiar contraseña */}
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