import React, { useState, useEffect } from 'react';
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
  const [oscuro, setOscuro] = useState(() => {
    return localStorage.getItem('portal_tema') === 'oscuro';
  });

  useEffect(() => {
    localStorage.setItem('portal_tema', oscuro ? 'oscuro' : 'claro');
  }, [oscuro]);

  const modulos = [
    { id: 'pedidos',       emoji: '📋', titulo: 'Pedidos',        desc: 'Crear y gestionar pedidos de entrega y retiro',       roles: ['admin','comercial','coordinador'], acento: '#C8102E' },
    { id: 'coordinador',   emoji: '📅', titulo: 'Programación',   desc: 'Programar despachos y gestionar transportistas',      roles: ['admin','coordinador'],             acento: '#0F6E56' },
    { id: 'transportista', emoji: '🚛', titulo: 'Mis despachos',  desc: 'Ver y gestionar los despachos asignados',             roles: ['admin','transportista'],           acento: '#1D4ED8' },
    { id: 'admin',         emoji: '⚙️', titulo: 'Administración', desc: 'Gestión de usuarios, roles y configuración',          roles: ['admin'],                           acento: '#374151' },
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

  const t = oscuro ? dark : light;
  const rolLabel = { admin: 'Administrador', coordinador: 'Coordinador', comercial: 'Comercial', transportista: 'Transportista' };

  return (
    <div style={{ ...base.wrap, background: t.bg, color: t.texto }}>

      {/* Modal */}
      {modalPass && (
        <div style={base.modalOverlay}>
          <div style={{ ...base.modalBox, background: t.modalBg, border: `1px solid ${t.borde}` }}>
            <div style={{ ...base.modalTitulo, color: t.texto }}>Cambiar contraseña</div>
            {okPass
              ? <div style={{ ...base.successMsg }}> ✓ Contraseña actualizada correctamente.</div>
              : (
                <form onSubmit={cambiarPassword} style={base.modalForm}>
                  {errorPass && <div style={base.errorMsg}>{errorPass}</div>}
                  {[
                    { label: 'Contraseña actual', val: passActual, set: setPassActual, auto: 'current-password' },
                    { label: 'Contraseña nueva', val: passNueva, set: setPassNueva, auto: 'new-password' },
                    { label: 'Confirmar contraseña', val: passConfirm, set: setPassConfirm, auto: 'new-password' },
                  ].map((f, i) => (
                    <div key={i} style={base.field}>
                      <label style={{ ...base.fieldLabel, color: t.labelColor }}>{f.label}</label>
                      <div style={i === 0 ? base.passRow : {}}>
                        <input style={{ ...base.input, background: t.inputBg, border: `1px solid ${t.borde}`, color: t.texto, flex: i === 0 ? 1 : undefined }}
                          type={verPass ? 'text' : 'password'} value={f.val}
                          onChange={e => f.set(e.target.value)} placeholder="••••••••" autoComplete={f.auto} />
                        {i === 0 && (
                          <button type="button" style={{ ...base.btnVer, background: t.inputBg, border: `1px solid ${t.borde}`, color: t.texto }}
                            onClick={() => setVerPass(!verPass)}>{verPass ? '🙈' : '👁'}</button>
                        )}
                      </div>
                    </div>
                  ))}
                  <button type="submit" style={{ ...base.btnPrimary, opacity: guardando ? 0.7 : 1 }} disabled={guardando}>
                    {guardando ? 'Guardando...' : 'Cambiar contraseña'}
                  </button>
                  <button type="button" style={{ ...base.btnSecundario, border: `1px solid ${t.borde}`, color: t.textoSub }}
                    onClick={() => { setModalPass(false); setErrorPass(''); }}>Cancelar</button>
                </form>
              )}
          </div>
        </div>
      )}

      {/* Topbar */}
      <div style={{ ...base.topbar, background: t.topbarBg, borderBottom: `1px solid ${t.borde}` }}>
        <div style={base.logoWrap}>
          {oscuro
            ? <img src="/logo.png" alt="Explora" style={{ ...base.logo, filter: 'brightness(0) invert(1)', opacity: 0.9 }} />
            : <img src="/logo.png" alt="Explora" style={base.logo} />
          }
        </div>
        <div style={base.topbarRight}>
          <div style={base.userInfo}>
            <span style={{ fontSize: 13, fontWeight: 500, color: t.texto }}>{usuario?.nombre || usuario?.email}</span>
            <span style={{ fontSize: 11, color: t.textoSub, textTransform: 'capitalize' }}>{rolLabel[rol] || rol}</span>
          </div>
          <button
            style={{ ...base.btnIcono, background: t.btnBg, border: `1px solid ${t.borde}`, color: t.texto }}
            onClick={() => setOscuro(!oscuro)}
            title={oscuro ? 'Modo claro' : 'Modo oscuro'}
          >
            {oscuro ? '☀️' : '🌙'}
          </button>
          <button style={{ ...base.btnIcono, background: t.btnBg, border: `1px solid ${t.borde}`, color: t.texto }}
            onClick={() => setModalPass(true)} title="Cambiar contraseña">🔑</button>
          <button style={{ ...base.btnSalir, border: `1px solid ${t.borde}`, color: t.textoSub }}
            onClick={onLogout}>Salir</button>
        </div>
      </div>

      {/* Hero */}
      <div style={{ ...base.hero, borderBottom: `1px solid ${t.borde}` }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 700, color: t.texto, letterSpacing: '-0.5px', marginBottom: 6 }}>
            Bienvenido, <span style={{ color: '#C8102E' }}>{usuario?.nombre?.split(' ')[0] || 'usuario'}</span>
          </div>
          <div style={{ fontSize: 13, color: t.textoSub, letterSpacing: '0.02em' }}>
            Portal Operativo · Complejo Industrial PGSM
          </div>
        </div>
        {usuario?.empresa && (
          <div style={{ ...base.empresaTag, background: t.tagBg, border: `1px solid ${t.borde}`, color: t.textoSub }}>
            🏢 {usuario.empresa}
          </div>
        )}
      </div>

      {/* Grilla */}
      <div style={base.grid}>
        {modulos.map(m => (
          <button key={m.id}
            style={{ ...base.card, background: t.cardBg, border: `1px solid ${t.borde}` }}
            onClick={() => onModulo(m.id)}
            onMouseEnter={e => { e.currentTarget.style.borderColor = m.acento; e.currentTarget.style.background = t.cardHover; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = t.borde; e.currentTarget.style.background = t.cardBg; }}
          >
            <div style={{ ...base.cardBar, background: m.acento }} />
            <div style={base.cardIcono}>{m.emoji}</div>
            <div style={{ ...base.cardTitulo, color: t.texto }}>{m.titulo}</div>
            <div style={{ ...base.cardDesc, color: t.textoSub }}>{m.desc}</div>
            <div style={{ ...base.cardFlecha, color: m.acento }}>→</div>
          </button>
        ))}
      </div>
    </div>
  );
}

const light = {
  bg: '#F8F8F8',
  texto: '#111827',
  textoSub: '#6B7280',
  labelColor: '#6B7280',
  borde: '#E5E7EB',
  topbarBg: 'rgba(255,255,255,0.92)',
  modalBg: '#FFFFFF',
  inputBg: '#F9FAFB',
  cardBg: '#FFFFFF',
  cardHover: '#FFF5F5',
  btnBg: '#FFFFFF',
  tagBg: '#F3F4F6',
};

const dark = {
  bg: '#0D0D0F',
  texto: '#F9FAFB',
  textoSub: 'rgba(255,255,255,0.4)',
  labelColor: 'rgba(255,255,255,0.45)',
  borde: 'rgba(255,255,255,0.09)',
  topbarBg: 'rgba(13,13,15,0.92)',
  modalBg: '#18181B',
  inputBg: 'rgba(255,255,255,0.06)',
  cardBg: 'rgba(255,255,255,0.04)',
  cardHover: 'rgba(255,255,255,0.07)',
  btnBg: 'rgba(255,255,255,0.06)',
  tagBg: 'rgba(255,255,255,0.06)',
};

const base = {
  wrap: { minHeight: '100vh', fontFamily: "'DM Sans', system-ui, sans-serif", transition: 'background 0.2s, color 0.2s' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem', backdropFilter: 'blur(4px)' },
  modalBox: { borderRadius: 16, padding: '2rem 1.75rem', maxWidth: 380, width: '100%' },
  modalTitulo: { fontSize: 16, fontWeight: 600, marginBottom: 20, textAlign: 'center' },
  modalForm: { display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' },
  input: { fontSize: 14, padding: '10px 13px', borderRadius: 8, width: '100%', boxSizing: 'border-box', outline: 'none' },
  passRow: { display: 'flex', gap: 8, alignItems: 'center' },
  btnVer: { padding: '10px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 14, flexShrink: 0 },
  btnPrimary: { padding: '11px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnSecundario: { padding: '11px', borderRadius: 8, background: 'transparent', fontSize: 14, cursor: 'pointer' },
  errorMsg: { padding: '10px 13px', borderRadius: 8, background: 'rgba(200,16,46,0.1)', border: '1px solid rgba(200,16,46,0.3)', fontSize: 12, color: '#C8102E' },
  successMsg: { padding: '10px 13px', borderRadius: 8, background: '#E1F5EE', border: '1px solid #5DCAA5', fontSize: 12, color: '#085041', textAlign: 'center' },
  topbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1.5rem', position: 'sticky', top: 0, zIndex: 100, backdropFilter: 'blur(12px)' },
  logoWrap: { display: 'flex', alignItems: 'center' },
  logo: { height: 30, objectFit: 'contain' },
  topbarRight: { display: 'flex', alignItems: 'center', gap: 10 },
  userInfo: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginRight: 4 },
  btnIcono: { padding: '6px 10px', borderRadius: 8, fontSize: 14, cursor: 'pointer' },
  btnSalir: { padding: '6px 14px', borderRadius: 8, background: 'transparent', fontSize: 13, cursor: 'pointer' },
  hero: { padding: '3rem 1.5rem 2rem', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 },
  empresaTag: { padding: '6px 14px', borderRadius: 20, fontSize: 12 },
  grid: { padding: '2rem 1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14, maxWidth: 960, margin: '0 auto' },
  card: { position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, padding: '1.5rem', borderRadius: 14, cursor: 'pointer', textAlign: 'left', overflow: 'hidden', transition: 'border-color 0.15s, background 0.15s' },
  cardBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: '14px 14px 0 0' },
  cardIcono: { fontSize: 26, marginTop: 4 },
  cardTitulo: { fontSize: 15, fontWeight: 600, letterSpacing: '-0.2px' },
  cardDesc: { fontSize: 12, flex: 1, lineHeight: 1.5 },
  cardFlecha: { fontSize: 16, fontWeight: 600, alignSelf: 'flex-end' },
};

export default Home;
