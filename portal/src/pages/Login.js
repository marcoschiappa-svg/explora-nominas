import React, { useState } from 'react';
import { auth, db } from '../firebase';
import {
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

const CHOFER_DOMAIN = '@explora-portal.com';

function Login({ onLogin }) {
  const [modo, setModo] = useState('selector');
  const [email, setEmail] = useState('');
  const [dni, setDni] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [resetEnviado, setResetEnviado] = useState(false);

  async function obtenerPerfil(uid, emailBusqueda) {
    const snap = await getDoc(doc(db, 'usuarios_portal', uid));
    if (snap.exists()) return snap.data();
    if (emailBusqueda) {
      const q = query(collection(db, 'usuarios_portal'), where('email', '==', emailBusqueda));
      const resultado = await getDocs(q);
      if (!resultado.empty) return resultado.docs[0].data();
    }
    return null;
  }

  async function loginGoogle() {
    setCargando(true); setError('');
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const perfil = await obtenerPerfil(result.user.uid, result.user.email);
      if (!perfil) { setError('Tu cuenta no está habilitada. Contactá al administrador.'); await auth.signOut(); return; }
      if (perfil.estado !== 'activo') { setError('Tu cuenta está inactiva. Contactá al administrador.'); await auth.signOut(); return; }
      onLogin({ uid: result.user.uid, email: result.user.email, ...perfil });
    } catch (err) {
      setError('Error al iniciar sesión con Google. Intentá de nuevo.');
    } finally { setCargando(false); }
  }

  async function loginEmail(e) {
    e.preventDefault();
    if (!email || !password) { setError('Completá email y contraseña.'); return; }
    setCargando(true); setError('');
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const perfil = await obtenerPerfil(result.user.uid, result.user.email);
      if (!perfil) { setError('Tu cuenta no está habilitada. Contactá al administrador.'); await auth.signOut(); return; }
      if (perfil.estado !== 'activo') { setError('Tu cuenta está inactiva. Contactá al administrador.'); await auth.signOut(); return; }
      onLogin({ uid: result.user.uid, email: result.user.email, ...perfil });
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') setError('Email o contraseña incorrectos.');
      else if (err.code === 'auth/user-not-found') setError('No existe una cuenta con ese email.');
      else if (err.code === 'auth/too-many-requests') setError('Demasiados intentos. Esperá unos minutos.');
      else setError('Error al iniciar sesión. Intentá de nuevo.');
    } finally { setCargando(false); }
  }

  async function loginChofer(e) {
    e.preventDefault();
    const dniLimpio = dni.trim().replace(/\D/g, '');
    if (!dniLimpio || !password) { setError('Ingresá tu DNI y contraseña.'); return; }
    if (dniLimpio.length < 7 || dniLimpio.length > 8) { setError('El DNI debe tener 7 u 8 dígitos.'); return; }
    setCargando(true); setError('');
    try {
      const emailInterno = dniLimpio + CHOFER_DOMAIN;
      const result = await signInWithEmailAndPassword(auth, emailInterno, password);
      const perfil = await obtenerPerfil(result.user.uid, emailInterno);
      if (!perfil) { setError('Tu DNI no está habilitado. Contactá al transportista.'); await auth.signOut(); return; }
      if (perfil.estado !== 'activo') { setError('Tu cuenta está inactiva. Contactá al transportista.'); await auth.signOut(); return; }
      onLogin({ uid: result.user.uid, email: emailInterno, ...perfil });
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') setError('DNI o contraseña incorrectos.');
      else if (err.code === 'auth/user-not-found') setError('No existe una cuenta con ese DNI.');
      else if (err.code === 'auth/too-many-requests') setError('Demasiados intentos. Esperá unos minutos.');
      else setError('Error al iniciar sesión. Intentá de nuevo.');
    } finally { setCargando(false); }
  }

  async function resetPassword() {
    if (!email) { setError('Ingresá tu email primero.'); return; }
    setCargando(true); setError('');
    try { await sendPasswordResetEmail(auth, email); setResetEnviado(true); }
    catch (err) { setError('No se pudo enviar el email de recuperación.'); }
    finally { setCargando(false); }
  }

  function volver() {
    setModo('selector');
    setError('');
    setResetEnviado(false);
    setDni('');
    setEmail('');
    setPassword('');
    setVerPassword(false);
  }

  return (
    <div style={s.wrap}>
      <div style={s.fotoWrap}>
        <img src="/planta_bg.jpg" alt="" style={s.foto} />
        <div style={s.fotoOverlay} />
        <div style={s.fotoBadge}>
          <div style={s.fotoBadgeTitulo}>Complejo Industrial PGSM</div>
          <div style={s.fotoBadgeSub}>Puerto General San Martín · Santa Fe</div>
        </div>
      </div>

      <div style={s.panel}>
        <div style={s.panelInner}>
          <div style={s.logoArea}>
            <img src="/logo.png" alt="Explora" style={s.logo} />
          </div>

          <div style={s.heading}>Portal Operativo</div>
          <div style={s.subheading}>Iniciá sesión para continuar</div>

          {/* Selector */}
          {modo === 'selector' && (
            <div style={s.formWrap}>
              <button style={s.btnGoogle} onClick={() => setModo('google')}>
                <GoogleIcon /> Ingresar con Google
              </button>
              <div style={s.divider}>
                <span style={s.dividerLine} />
                <span style={s.dividerText}>o</span>
                <span style={s.dividerLine} />
              </div>
              <button style={s.btnEmail} onClick={() => setModo('email')}>
                ✉ Ingresar con email y contraseña
              </button>
              <button style={s.btnChofer} onClick={() => setModo('chofer')}>
                🚛 Ingresar como chofer (DNI)
              </button>
            </div>
          )}

          {/* Google */}
          {modo === 'google' && (
            <div style={s.formWrap}>
              <p style={s.modoDesc}>Cuentas corporativas @explora.com.ar</p>
              {error && <div style={s.error}>{error}</div>}
              <button style={s.btnGoogle} onClick={loginGoogle} disabled={cargando}>
                <GoogleIcon /> {cargando ? 'Ingresando...' : 'Continuar con Google'}
              </button>
              <button style={s.btnVolver} onClick={volver}>← Volver</button>
            </div>
          )}

          {/* Email */}
          {modo === 'email' && (
            <div style={s.formWrap}>
              {error && <div style={s.error}>{error}</div>}
              {resetEnviado && <div style={s.success}>✓ Email enviado. Revisá tu bandeja.</div>}
              <form onSubmit={loginEmail} style={s.form}>
                <div style={s.field}>
                  <label style={s.label}>Email</label>
                  <input style={s.input} type="email" placeholder="tu@email.com"
                    value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
                </div>
                <div style={s.field}>
                  <label style={s.label}>Contraseña</label>
                  <div style={s.passRow}>
                    <input style={{ ...s.input, flex: 1 }}
                      type={verPassword ? 'text' : 'password'} placeholder="••••••••"
                      value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                    <button type="button" style={s.btnVer} onClick={() => setVerPassword(!verPassword)}>
                      {verPassword ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
                <button type="submit" style={{ ...s.btnPrimary, opacity: cargando ? 0.7 : 1 }} disabled={cargando}>
                  {cargando ? 'Ingresando...' : 'Ingresar'}
                </button>
              </form>
              <button style={s.btnReset} onClick={resetPassword} disabled={cargando}>Olvidé mi contraseña</button>
              <button style={s.btnVolver} onClick={volver}>← Volver</button>
            </div>
          )}

          {/* Chofer — DNI */}
          {modo === 'chofer' && (
            <div style={s.formWrap}>
              <div style={s.choferBanner}>
                🚛 Acceso para choferes
              </div>
              {error && <div style={s.error}>{error}</div>}
              <form onSubmit={loginChofer} style={s.form}>
                <div style={s.field}>
                  <label style={s.label}>Número de DNI</label>
                  <input style={s.input} type="text" placeholder="26401217"
                    value={dni}
                    onChange={e => setDni(e.target.value.replace(/\D/g, ''))}
                    maxLength={8}
                    inputMode="numeric"
                    autoComplete="username" />
                </div>
                <div style={s.field}>
                  <label style={s.label}>Contraseña</label>
                  <div style={s.passRow}>
                    <input style={{ ...s.input, flex: 1 }}
                      type={verPassword ? 'text' : 'password'} placeholder="••••••••"
                      value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                    <button type="button" style={s.btnVer} onClick={() => setVerPassword(!verPassword)}>
                      {verPassword ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
                <button type="submit" style={{ ...s.btnPrimary, background: '#0F6E56', opacity: cargando ? 0.7 : 1 }} disabled={cargando}>
                  {cargando ? 'Ingresando...' : 'Ingresar'}
                </button>
              </form>
              <button style={s.btnVolver} onClick={volver}>← Volver</button>
            </div>
          )}

          <div style={s.footer}>Explora S.A. · Uso interno · PGSM</div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
      <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
      <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
      <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.31z"/>
    </svg>
  );
}

const s = {
  wrap: { minHeight: '100vh', display: 'flex', fontFamily: "'DM Sans', system-ui, sans-serif" },
  fotoWrap: { flex: 1, position: 'relative', overflow: 'hidden' },
  foto: { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%', display: 'block' },
  fotoOverlay: { position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.1) 60%)' },
  fotoBadge: { position: 'absolute', bottom: 32, left: 32 },
  fotoBadgeTitulo: { fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4, letterSpacing: '-0.3px' },
  fotoBadgeSub: { fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  panel: { width: '100%', maxWidth: 440, minHeight: '100vh', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2.5rem 2rem', boxShadow: '-8px 0 32px rgba(0,0,0,0.08)', boxSizing: 'border-box' },
  panelInner: { width: '100%', display: 'flex', flexDirection: 'column', gap: 0 },
  logoArea: { marginBottom: 32 },
  logo: { height: 40, objectFit: 'contain' },
  heading: { fontSize: 24, fontWeight: 700, color: '#111827', letterSpacing: '-0.5px', marginBottom: 6 },
  subheading: { fontSize: 14, color: '#9CA3AF', marginBottom: 32 },
  formWrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  modoDesc: { fontSize: 12, color: '#9CA3AF', margin: '0 0 4px', textAlign: 'center' },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, color: '#374151', fontWeight: 600, letterSpacing: '0.02em' },
  input: { fontSize: 14, padding: '11px 13px', borderRadius: 8, border: '1.5px solid #E5E7EB', color: '#111827', width: '100%', boxSizing: 'border-box', outline: 'none', background: '#FAFAFA' },
  passRow: { display: 'flex', gap: 8, alignItems: 'center' },
  btnVer: { padding: '11px 12px', borderRadius: 8, border: '1.5px solid #E5E7EB', background: '#FAFAFA', cursor: 'pointer', fontSize: 14, color: '#6B7280', flexShrink: 0 },
  btnPrimary: { padding: '12px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.02em' },
  btnGoogle: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 16px', borderRadius: 8, border: '1.5px solid #E5E7EB', background: '#fff', color: '#111827', fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  btnEmail: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderRadius: 8, border: '1.5px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 14, cursor: 'pointer' },
  btnChofer: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderRadius: 8, border: '1.5px solid #0F6E56', background: '#F0FDF4', color: '#0F6E56', fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  choferBanner: { padding: '10px 14px', borderRadius: 8, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: 13, color: '#0F6E56', fontWeight: 500, textAlign: 'center' },
  divider: { display: 'flex', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, background: '#E5E7EB' },
  dividerText: { fontSize: 12, color: '#9CA3AF' },
  btnReset: { background: 'none', border: 'none', color: '#9CA3AF', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0, textAlign: 'center' },
  btnVolver: { background: 'none', border: 'none', color: '#9CA3AF', fontSize: 13, cursor: 'pointer', padding: 0, textAlign: 'center', marginTop: 4 },
  error: { padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 12, color: '#B91C1C' },
  success: { padding: '10px 14px', borderRadius: 8, background: '#F0FDF4', border: '1px solid #BBF7D0', fontSize: 12, color: '#166534' },
  footer: { marginTop: 48, fontSize: 11, color: '#D1D5DB', textAlign: 'center' },
};

if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = '@media (min-width: 768px) { .login-foto { display: block !important; } }';
  document.head.appendChild(style);
}

export default Login;
