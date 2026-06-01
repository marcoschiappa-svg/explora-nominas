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

  // Busca perfil por UID primero, luego por email como fallback
  async function obtenerPerfil(uid, emailBusqueda) {
    const snap = await getDoc(doc(db, 'usuarios_portal', uid));
    if (snap.exists()) return snap.data();

    // Fallback: buscar por email (útil cuando el usuario fue creado con email/pass
    // y ahora entra con Google, o viceversa)
    if (emailBusqueda) {
      const q = query(collection(db, 'usuarios_portal'), where('email', '==', emailBusqueda));
      const resultado = await getDocs(q);
      if (!resultado.empty) return resultado.docs[0].data();
    }
    return null;
  }

  async function loginGoogle() {
    setCargando(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const perfil = await obtenerPerfil(result.user.uid, result.user.email);
      if (!perfil) {
        setError('Tu cuenta no está habilitada en el portal. Contactá al administrador.');
        await auth.signOut();
        return;
      }
      if (perfil.estado !== 'activo') {
        setError('Tu cuenta está inactiva. Contactá al administrador.');
        await auth.signOut();
        return;
      }
      onLogin({ uid: result.user.uid, email: result.user.email, ...perfil });
    } catch (err) {
      setError('Error al iniciar sesión con Google. Intentá de nuevo.');
      console.error(err);
    } finally {
      setCargando(false);
    }
  }

  async function loginEmail(e) {
    e.preventDefault();
    if (!email || !password) { setError('Completá email y contraseña.'); return; }
    setCargando(true);
    setError('');
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const perfil = await obtenerPerfil(result.user.uid, result.user.email);
      if (!perfil) {
        setError('Tu cuenta no está habilitada en el portal. Contactá al administrador.');
        await auth.signOut();
        return;
      }
      if (perfil.estado !== 'activo') {
        setError('Tu cuenta está inactiva. Contactá al administrador.');
        await auth.signOut();
        return;
      }
      onLogin({ uid: result.user.uid, email: result.user.email, ...perfil });
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setError('Email o contraseña incorrectos.');
      } else if (err.code === 'auth/user-not-found') {
        setError('No existe una cuenta con ese email.');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Demasiados intentos. Esperá unos minutos.');
      } else {
        setError('Error al iniciar sesión. Intentá de nuevo.');
      }
    } finally {
      setCargando(false);
    }
  }

  async function resetPassword() {
    if (!email) { setError('Ingresá tu email primero.'); return; }
    setCargando(true);
    setError('');
    try {
      await sendPasswordResetEmail(auth, email);
      setResetEnviado(true);
    } catch (err) {
      setError('No se pudo enviar el email de recuperación.');
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.logoArea}>
          <img src="/logo.png" alt="Explora" style={styles.logo} />
        </div>
        <div style={styles.titulo}>Portal Operativo</div>
        <div style={styles.subtitulo}>Explora S.A.</div>

        {modo === 'selector' && (
          <div style={styles.selectorWrap}>
            <button style={styles.btnGoogle} onClick={() => setModo('google')}>
              <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
                <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
                <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.31z"/>
              </svg>
              Ingresar con Google
            </button>
            <div style={styles.divider}><span>o</span></div>
            <button style={styles.btnEmail} onClick={() => setModo('email')}>
              ✉️ Ingresar con email y contraseña
            </button>
          </div>
        )}

        {modo === 'google' && (
          <div style={styles.selectorWrap}>
            <p style={styles.modoDesc}>Para cuentas corporativas @explora.com.ar</p>
            {error && <div style={styles.error}>{error}</div>}
            <button style={styles.btnGoogle} onClick={loginGoogle} disabled={cargando}>
              <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
                <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
                <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.31z"/>
              </svg>
              {cargando ? 'Ingresando...' : 'Continuar con Google'}
            </button>
            <button style={styles.btnVolver} onClick={() => { setModo('selector'); setError(''); }}>← Volver</button>
          </div>
        )}

        {modo === 'email' && (
          <div style={styles.selectorWrap}>
            <p style={styles.modoDesc}>Ingresá con tu email y contraseña</p>
            {error && <div style={styles.error}>{error}</div>}
            {resetEnviado && <div style={styles.success}>✓ Email de recuperación enviado. Revisá tu bandeja.</div>}
            <form onSubmit={loginEmail} style={styles.form}>
              <div style={styles.formField}>
                <label style={styles.formLabel}>Email</label>
                <input style={styles.input} type="email" placeholder="tu@email.com"
                  value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
              </div>
              <div style={styles.formField}>
                <label style={styles.formLabel}>Contraseña</label>
                <div style={styles.passwordRow}>
                  <input
                    style={{ ...styles.input, flex: 1 }}
                    type={verPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password" />
                  <button type="button" style={styles.btnVerPass}
                    onClick={() => setVerPassword(!verPassword)}>
                    {verPassword ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              <button type="submit"
                style={{ ...styles.btnPrimary, opacity: cargando ? 0.7 : 1 }}
                disabled={cargando}>
                {cargando ? 'Ingresando...' : 'Ingresar'}
              </button>
            </form>
            <button style={styles.btnReset} onClick={resetPassword} disabled={cargando}>
              Olvidé mi contraseña
            </button>
            <button style={styles.btnVolver} onClick={() => { setModo('selector'); setError(''); setResetEnviado(false); }}>← Volver</button>
          </div>
        )}

        <div style={styles.footer}>
          Portal operativo interno · Explora S.A.
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F5F5F5', padding: '1rem' },
  card: { background: '#fff', borderRadius: 16, border: '0.5px solid #E5E7EB', padding: '2rem', width: '100%', maxWidth: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.06)' },
  logoArea: { display: 'flex', justifyContent: 'center', marginBottom: 16 },
  logo: { height: 48, objectFit: 'contain' },
  titulo: { textAlign: 'center', fontSize: 18, fontWeight: 600, color: '#111827', marginBottom: 4 },
  subtitulo: { textAlign: 'center', fontSize: 13, color: '#9CA3AF', marginBottom: 28 },
  selectorWrap: { display: 'flex', flexDirection: 'column', gap: 12 },
  modoDesc: { textAlign: 'center', fontSize: 12, color: '#9CA3AF', margin: '0 0 4px' },
  btnGoogle: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '11px 16px', borderRadius: 10, border: '0.5px solid #E5E7EB', background: '#fff', color: '#111827', fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  btnEmail: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 16px', borderRadius: 10, border: '0.5px solid #E5E7EB', background: '#fff', color: '#111827', fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  divider: { display: 'flex', alignItems: 'center', gap: 10, color: '#D1D5DB', fontSize: 12 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  formField: { display: 'flex', flexDirection: 'column', gap: 5 },
  formLabel: { fontSize: 13, color: '#6B7280', fontWeight: 500 },
  input: { fontSize: 14, padding: '9px 11px', borderRadius: 8, border: '0.5px solid #E5E7EB', color: '#111827', width: '100%' },
  passwordRow: { display: 'flex', gap: 8, alignItems: 'center' },
  btnVerPass: { padding: '9px 11px', borderRadius: 8, border: '0.5px solid #E5E7EB', background: '#fff', cursor: 'pointer', fontSize: 14, flexShrink: 0 },
  btnPrimary: { padding: '11px', borderRadius: 10, border: 'none', background: '#C8102E', color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  btnReset: { background: 'none', border: 'none', color: '#6B7280', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0, textAlign: 'center' },
  btnVolver: { background: 'none', border: 'none', color: '#9CA3AF', fontSize: 13, cursor: 'pointer', padding: 0, textAlign: 'center' },
  error: { padding: '8px 12px', borderRadius: 8, background: '#FCEBEB', border: '0.5px solid #F87171', fontSize: 12, color: '#791F1F' },
  success: { padding: '8px 12px', borderRadius: 8, background: '#E1F5EE', border: '0.5px solid #5DCAA5', fontSize: 12, color: '#085041' },
  footer: { textAlign: 'center', fontSize: 11, color: '#D1D5DB', marginTop: 24 },
};

export default Login;