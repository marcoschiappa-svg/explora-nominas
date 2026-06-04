import React, { useState } from 'react';
import { auth, db } from '../firebase';
import {
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';

function Login({ onLogin }) {
  const [modo, setModo] = useState('selector');
  const [email, setEmail] = useState('');
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

  async function resetPassword() {
    if (!email) { setError('Ingresá tu email primero.'); return; }
    setCargando(true); setError('');
    try { await sendPasswordResetEmail(auth, email); setResetEnviado(true); }
    catch (err) { setError('No se pudo enviar el email de recuperación.'); }
    finally { setCargando(false); }
  }

  return (
    <div style={s.wrap}>
      {/* Fondo con foto */}
      <div style={s.bg} />
      <div style={s.overlay} />

      {/* Panel lateral derecho */}
      <div style={s.panel}>
        <div style={s.panelInner}>
          <div style={s.logoArea}>
            <img src="/logo.png" alt="Explora" style={s.logo} />
          </div>

          <div style={s.heading}>Portal Operativo</div>
          <div style={s.subheading}>Complejo Industrial PGSM</div>

          {modo === 'selector' && (
            <div style={s.formWrap}>
              <button style={s.btnGoogle} onClick={() => setModo('google')}>
                <GoogleIcon /> Ingresar con Google
              </button>
              <div style={s.divider}><span style={s.dividerLine}/><span style={s.dividerText}>o</span><span style={s.dividerLine}/></div>
              <button style={s.btnEmail} onClick={() => setModo('email')}>
                ✉ Ingresar con email y contraseña
              </button>
            </div>
          )}

          {modo === 'google' && (
            <div style={s.formWrap}>
              <p style={s.modoDesc}>Cuentas corporativas @explora.com.ar</p>
              {error && <div style={s.error}>{error}</div>}
              <button style={s.btnGoogle} onClick={loginGoogle} disabled={cargando}>
                <GoogleIcon /> {cargando ? 'Ingresando...' : 'Continuar con Google'}
              </button>
              <button style={s.btnVolver} onClick={() => { setModo('selector'); setError(''); }}>← Volver</button>
            </div>
          )}

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
              <button style={s.btnVolver} onClick={() => { setModo('selector'); setError(''); setResetEnviado(false); }}>← Volver</button>
            </div>
          )}

          <div style={s.footer}>Explora S.A. · Uso interno</div>
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
  wrap: { minHeight: '100vh', display: 'flex', position: 'relative', fontFamily: "'DM Sans', system-ui, sans-serif" },
  bg: {
    position: 'fixed', inset: 0, zIndex: 0,
    backgroundImage: 'url(/planta_bg.jpg)',
    backgroundSize: 'cover', backgroundPosition: 'center 30%',
    filter: 'brightness(0.55) saturate(0.8)',
  },
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1,
    background: 'linear-gradient(105deg, rgba(0,0,0,0.7) 0%, rgba(10,10,20,0.3) 60%, transparent 100%)',
  },
  panel: {
    position: 'relative', zIndex: 10,
    marginLeft: 'auto',
    width: '100%', maxWidth: 420,
    minHeight: '100vh',
    background: 'rgba(10,10,14,0.82)',
    backdropFilter: 'blur(20px)',
    borderLeft: '1px solid rgba(255,255,255,0.07)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '2rem',
  },
  panelInner: { width: '100%', display: 'flex', flexDirection: 'column', gap: 0 },
  logoArea: { marginBottom: 28, display: 'flex', alignItems: 'center' },
  logo: { height: 36, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.9 },
  heading: { fontSize: 26, fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.5px', lineHeight: 1.2, marginBottom: 6 },
  subheading: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginBottom: 36, letterSpacing: '0.04em', textTransform: 'uppercase' },
  formWrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  modoDesc: { fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '0 0 4px', textAlign: 'center' },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase' },
  input: {
    fontSize: 14, padding: '11px 14px', borderRadius: 8, width: '100%', boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff', outline: 'none',
  },
  passRow: { display: 'flex', gap: 8, alignItems: 'center' },
  btnVer: { padding: '11px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.07)', cursor: 'pointer', fontSize: 14, color: '#fff', flexShrink: 0 },
  btnPrimary: { padding: '12px', borderRadius: 8, border: 'none', background: '#C8102E', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.02em' },
  btnGoogle: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  btnEmail: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: 14, cursor: 'pointer' },
  divider: { display: 'flex', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, background: 'rgba(255,255,255,0.1)' },
  dividerText: { fontSize: 12, color: 'rgba(255,255,255,0.3)' },
  btnReset: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0, textAlign: 'center' },
  btnVolver: { background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 13, cursor: 'pointer', padding: 0, textAlign: 'center', marginTop: 4 },
  error: { padding: '10px 14px', borderRadius: 8, background: 'rgba(200,16,46,0.2)', border: '1px solid rgba(200,16,46,0.4)', fontSize: 12, color: '#FCA5A5' },
  success: { padding: '10px 14px', borderRadius: 8, background: 'rgba(15,110,86,0.25)', border: '1px solid rgba(93,202,165,0.3)', fontSize: 12, color: '#6EE7B7' },
  footer: { marginTop: 48, fontSize: 11, color: 'rgba(255,255,255,0.2)', textAlign: 'center', letterSpacing: '0.05em' },
};

export default Login;
