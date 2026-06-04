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
    { id: 'pedidos',      emoji: '📋', titulo: 'Pedidos',        desc: 'Crear y gestionar pedidos de entrega y retiro',         roles: ['admin','comercial','coordinador'], acento: '#C8102E' },
    { id: 'coordinador',  emoji: '📅', titulo: 'Programación',   desc: 'Programar despachos y gestionar transportistas',        roles: ['admin','coordinador'],             acento: '#0F6E56' },
    { id: 'transportista',emoji: '🚛', titulo: 'Mis despachos',  desc: 'Ver y gestionar los despachos asignados',               roles: ['admin','transportista'],           acento: '#1D4ED8' },
    { id: 'admin',        emoji: '⚙️', titulo: 'Administración', desc: 'Gestión de usuarios, roles y configuración',            roles: ['admin'],                           acento: '#374151' },
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
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') setErrorPass('La contraseña actual es incorrecta.');
      else if (err.code === 'auth/requires-recent-login') setErrorPass('Por seguridad, cerrá sesión y volvé a ingresar antes de cambiar la contraseña.');
      else setErrorPass('Error al cambiar la contraseña. Intentá de nuevo.');
    } finally { setGuardando(false); }
  }

  const rolLabel = { admin: 'Administrador', coordinador: 'Coordinador', comercial: 'Comercial', transportista: 'Transportista' };

  return (
    <div style={s.wrap}>

      {/* Modal cambio de contraseña */}
      {modalPass && (
        <div style={s.modalOverlay}>
          <div style={s.modalBox}>
            <div style={s.modalTitulo}>Cambiar contraseña</div>
            {okPass
              ? <div style={s.successMsg}>✓ Contraseña actualizada correctamente.</div>
              : (
                <form onSubmit={cambiarPassword} style={s.modalForm}>
                  {errorPass && <div style={s.errorMsg}>{errorPass}</div>}
                  <div style={s.field}>
                    <label style={s.fieldLabel}>Contraseña actual</label>
                    <div style={s.passRow}>
                      <input style={{ ...s.input, flex: 1 }} type={verPass ? 'text' : 'password'}
                        value={passActual} onChange={e => setPassActual(e.target.value)} placeholder="••••••••" />
                      <button type="button" style={s.btnVer} onClick={() => setVerPass(!verPass)}>{verPass ? '🙈' : '👁'}</button>
                    </div>
                  </div>
                  <div style={s.field}>
                    <label style={s.fieldLabel}>Contraseña nueva</label>
                    <input style={s.input} type={verPass ? 'text' : 'password'}
                      value={passNueva} onChange={e => setPassNueva(e.target.value)} placeholder="Mínimo 8 caracteres" />
                  </div>
                  <div style={s.field}>
                    <label style={s.fieldLabel}>Confirmar contraseña</label>
                    <input style={s.input} type={verPass ? 'text' : 'password'}
                      value={passConfirm} onChange={e => setPassConfirm(e.target.value)} placeholder="Repetí la contraseña" />
                  </div>
                  <button type="submit" style={{ ...s.btnPrimary, opacity: guardando ? 0.7 : 1 }} disabled={guardando}>
                    {guardando ? 'Guardando...' : 'Cambiar contraseña'}
                  </button>
                  <button type="button" style={s.btnSecundario} onClick={() => { setModalPass(false); setErrorPass(''); }}>Cancelar</button>
                </form>
              )}
          </div>
        </div>
      )}

      {/* Topbar */}
      <div style={s.topbar}>
        <img src="/logo.png" alt="Explora" style={s.logo} />
        <div style={s.topbarRight}>
          <div style={s.userInfo}>
            <span style={s.userName}>{usuario?.nombre || usuario?.email}</span>
            <span style={s.userRol}>{rolLabel[rol] || rol}</span>
          </div>
          <button style={s.btnIcono} onClick={() => setModalPass(true)} title="Cambiar contraseña">🔑</button>
          <button style={s.btnSalir} onClick={onLogout}>Salir</button>
        </div>
      </div>

      {/* Hero */}
      <div style={s.hero}>
        <div style={s.heroTexto}>
          <div style={s.heroSaludo}>Bienvenido, <strong>{usuario?.nombre?.split(' ')[0] || 'usuario'}</strong></div>
          <div style={s.heroSub}>Portal Operativo · Complejo Industrial PGSM</div>
        </div>
        {usuario?.empresa && (
          <div style={s.empresaTag}>🏢 {usuario.empresa}</div>
        )}
      </div>

      {/* Grilla de módulos */}
      <div style={s.grid}>
        {modulos.map(m => (
          <button key={m.id} style={s.card} onClick={() => onModulo(m.id)}>
            <div style={{ ...s.cardBar, background: m.acento }} />
            <div style={s.cardIcono}>{m.emoji}</div>
            <div style={s.cardTitulo}>{m.titulo}</div>
            <div style={s.cardDesc}>{m.desc}</div>
            <div style={{ ...s.cardFlecha, color: m.acento }}>→</div>
          </button>
        ))}
      </div>
    </div>
  );
}

const s = {
  wrap: { minHeight: '100vh', background: '#0D0D0F', fontFamily: "'DM Sans', system-ui, sans-serif", color: '#fff' },

  // Modal
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem', backdropFilter: 'blur(4px)' },
  modalBox: { background: '#18181B', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '2rem 1.75rem', maxWidth: 380, width: '100%' },
  modalTitulo: { fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 20, textAlign: 'center' },
  modalForm: { display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' },
  input: { fontSize: 14, padding: '10px 13px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff', width: '100%', boxSizing: 'border-box' },
  passRow: { display: 'flex', gap: 8, alignItems: 'center' },
  btnVer: { padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', cursor: 'pointer', fontSize: 14, color: '#fff', flexShrink: 0 },
  btnPrimary: { padding: '11px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnSecundario: { padding: '11px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 14, cursor: 'pointer' },
  errorMsg: { padding: '10px 13px', borderRadius: 8, background: 'rgba(200,16,46,0.15)', border: '1px solid rgba(200,16,46,0.3)', fontSize: 12, color: '#FCA5A5' },
  successMsg: { padding: '10px 13px', borderRadius: 8, background: 'rgba(15,110,86,0.2)', border: '1px solid rgba(93,202,165,0.3)', fontSize: 12, color: '#6EE7B7', textAlign: 'center' },

  // Topbar
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 100 },
  logo: { height: 28, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.85 },
  topbarRight: { display: 'flex', alignItems: 'center', gap: 12 },
  userInfo: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' },
  userName: { fontSize: 13, fontWeight: 500, color: '#fff' },
  userRol: { fontSize: 11, color: 'rgba(255,255,255,0.35)', textTransform: 'capitalize' },
  btnIcono: { padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', fontSize: 14, cursor: 'pointer', color: '#fff' },
  btnSalir: { padding: '6px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'rgba(255,255,255,0.6)', fontSize: 13, cursor: 'pointer' },

  // Hero
  hero: { padding: '3rem 1.5rem 2rem', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid rgba(255,255,255,0.05)' },
  heroTexto: {},
  heroSaludo: { fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: '-0.5px', marginBottom: 6 },
  heroSub: { fontSize: 13, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.03em' },
  empresaTag: { padding: '6px 14px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', fontSize: 12, color: 'rgba(255,255,255,0.5)' },

  // Grilla
  grid: { padding: '2rem 1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, maxWidth: 960, margin: '0 auto' },
  card: { position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, padding: '1.5rem', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', cursor: 'pointer', textAlign: 'left', overflow: 'hidden', transition: 'border-color 0.15s, background 0.15s' },
  cardBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '14px 14px 0 0' },
  cardIcono: { fontSize: 26, marginTop: 4 },
  cardTitulo: { fontSize: 15, fontWeight: 600, color: '#fff', letterSpacing: '-0.2px' },
  cardDesc: { fontSize: 12, color: 'rgba(255,255,255,0.4)', flex: 1, lineHeight: 1.5 },
  cardFlecha: { fontSize: 16, fontWeight: 600, alignSelf: 'flex-end' },
};

export default Home;
