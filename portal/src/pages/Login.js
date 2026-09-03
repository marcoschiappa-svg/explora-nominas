/**
 * =============================================================================
 * Login.js — Pantalla de inicio de sesión (Portal Explora)
 * =============================================================================
 *
 * PROPÓSITO
 * Login con tres caminos: Google (cuentas internas @explora.com.ar),
 * email + contraseña, y DNI + contraseña (choferes, con un dominio interno
 * sintético `{dni}@explora-portal.com`).
 *
 * -----------------------------------------------------------------------------
 * REDISENO -- EL SCROLL Y B1
 * -----------------------------------------------------------------------------
 *   EL SCROLL: `wrap` y `panel` pedian cada uno `minHeight: '100vh'`. Un
 *   primer intento lo cambio por `flex: 1, minHeight: 0`, calcando el
 *   arreglo de Seguimiento.js -- pero ESE arreglo depende de que TODA la
 *   cadena de contenedores de App.js (Pagina -> Contenido -> este div)
 *   tenga flexbox bien armado de punta a punta, y en la practica el scroll
 *   siguio apareciendo: sin una altura definida en algun eslabon de esa
 *   cadena, la imagen de fondo con `height: '100%'` cae a su tamaño
 *   intrinseco (la foto entera), empuja todo hacia abajo, y aparece el
 *   scroll que no debia estar.
 *
 *   Ahora `wrap` usa `position: 'fixed', inset: 0` -- Login se planta
 *   exactamente sobre el viewport siempre, sin depender de como este
 *   armado nada por fuera de este archivo. Mas simple y a prueba de fallos
 *   que encadenar flex entre varios componentes. De paso tapa la barra
 *   superior sticky (zIndex por encima de sus 9999 a proposito), asi que
 *   ya no se ve el logo duplicado que se comento la vuelta anterior.
 *
 *   B1: `crearEstilos(colores, oscuro)` + `useEstilos()`, paleta rojo/azul
 *   en vez de grises, mismo patron que el resto de las pantallas migradas.
 *   La foto de fondo y su overlay quedan igual en los dos temas a
 *   proposito: es una imagen de marca, no una superficie de UI.
 *
 *   Ninguna funcion de autenticacion cambio (loginGoogle, loginEmail,
 *   loginChofer, resetPassword) -- solo la presentacion.
 * ========================================================================== */

import React, { useState, useMemo } from 'react';
import { auth } from '../firebase';
import {
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { cargarSesion } from '../sesion';
import { marca, colorEstado, radio, tipografia, paletaTexto } from '../ui/tokens';
import { useTema } from '../ui/TemaContext';

const CHOFER_DOMAIN = '@explora-portal.com';

// Un solo mensaje para "no existe" y para "existe pero está inactivo": la
// distinción no le sirve a quien mira la pantalla, y mantenerla acá habría
// significado que `cargarSesion` devolviera algo más que null/sesión —
// justo lo que se quiere evitar después de tener la lógica duplicada en dos
// lugares.
const MENSAJE_SIN_ACCESO = 'Tu cuenta no está habilitada o está inactiva. Contactá al administrador.';
const MENSAJE_SIN_ACCESO_CHOFER = 'Tu DNI no está habilitado o está inactivo. Contactá al transportista.';

function Login({ onLogin }) {
  const styles = useEstilos();
  const [modo, setModo] = useState('selector');
  const [email, setEmail] = useState('');
  const [dni, setDni] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [resetEnviado, setResetEnviado] = useState(false);

  async function loginGoogle() {
    setCargando(true); setError('');
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const sesion = await cargarSesion(result.user);
      if (!sesion) { setError(MENSAJE_SIN_ACCESO); await auth.signOut(); return; }
      onLogin(sesion);
    } catch (err) {
      // El código de error se registra además de mostrarse. Descartarlo hacía
      // imposible distinguir "Google rechazó el login" de "Firestore rechazó la
      // lectura del perfil", que son problemas completamente distintos.
      console.error('Login Google falló:', err?.code || err?.name || 'desconocido', err?.message || '', err);
      setError(`Error al iniciar sesión con Google (${err?.code || 'desconocido'}). Intentá de nuevo.`);
    } finally { setCargando(false); }
  }

  async function loginEmail(e) {
    e.preventDefault();
    if (!email || !password) { setError('Completá email y contraseña.'); return; }
    setCargando(true); setError('');
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const sesion = await cargarSesion(result.user);
      if (!sesion) { setError(MENSAJE_SIN_ACCESO); await auth.signOut(); return; }
      onLogin(sesion);
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
      const sesion = await cargarSesion(result.user);
      if (!sesion) { setError(MENSAJE_SIN_ACCESO_CHOFER); await auth.signOut(); return; }
      onLogin(sesion);
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
    <div style={styles.wrap}>
      <div style={styles.fotoWrap}>
        <img src="/planta_bg.jpg" alt="" style={styles.foto} />
        <div style={styles.fotoOverlay} />
        <div style={styles.fotoBadge}>
          <div style={styles.fotoBadgeTitulo}>Complejo Industrial PGSM</div>
          <div style={styles.fotoBadgeSub}>Puerto General San Martín · Santa Fe</div>
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.panelInner}>
          <div style={styles.logoArea}>
            <img src="/logo.png" alt="Explora" style={styles.logo} />
          </div>

          <div style={styles.heading}>Portal Operativo</div>
          <div style={styles.subheading}>Iniciá sesión para continuar</div>

          {/* Selector */}
          {modo === 'selector' && (
            <div style={styles.formWrap}>
              <button style={styles.btnGoogle} onClick={() => setModo('google')}>
                <GoogleIcon /> Ingresar con Google
              </button>
              <div style={styles.divider}>
                <span style={styles.dividerLine} />
                <span style={styles.dividerText}>o</span>
                <span style={styles.dividerLine} />
              </div>
              <button style={styles.btnEmail} onClick={() => setModo('email')}>
                ✉ Ingresar con email y contraseña
              </button>
              <button style={styles.btnChofer} onClick={() => setModo('chofer')}>
                🚛 Ingresar como chofer (DNI)
              </button>
            </div>
          )}

          {/* Google */}
          {modo === 'google' && (
            <div style={styles.formWrap}>
              <p style={styles.modoDesc}>Cuentas corporativas @explora.com.ar</p>
              {error && <div style={styles.error}>{error}</div>}
              <button style={styles.btnGoogle} onClick={loginGoogle} disabled={cargando}>
                <GoogleIcon /> {cargando ? 'Ingresando...' : 'Continuar con Google'}
              </button>
              <button style={styles.btnVolver} onClick={volver}>← Volver</button>
            </div>
          )}

          {/* Email */}
          {modo === 'email' && (
            <div style={styles.formWrap}>
              {error && <div style={styles.error}>{error}</div>}
              {resetEnviado && <div style={styles.success}>✓ Email enviado. Revisá tu bandeja.</div>}
              <form onSubmit={loginEmail} style={styles.form}>
                <div style={styles.field}>
                  <label style={styles.label}>Email</label>
                  <input style={styles.input} type="email" placeholder="tu@email.com"
                    value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Contraseña</label>
                  <div style={styles.passRow}>
                    <input style={{ ...styles.input, flex: 1 }}
                      type={verPassword ? 'text' : 'password'} placeholder="••••••••"
                      value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                    <button type="button" style={styles.btnVer} onClick={() => setVerPassword(!verPassword)}>
                      {verPassword ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
                <button type="submit" style={{ ...styles.btnPrimary, opacity: cargando ? 0.7 : 1 }} disabled={cargando}>
                  {cargando ? 'Ingresando...' : 'Ingresar'}
                </button>
              </form>
              <button style={styles.btnReset} onClick={resetPassword} disabled={cargando}>Olvidé mi contraseña</button>
              <button style={styles.btnVolver} onClick={volver}>← Volver</button>
            </div>
          )}

          {/* Chofer — DNI */}
          {modo === 'chofer' && (
            <div style={styles.formWrap}>
              <div style={styles.choferBanner}>
                🚛 Acceso para choferes
              </div>
              {error && <div style={styles.error}>{error}</div>}
              <form onSubmit={loginChofer} style={styles.form}>
                <div style={styles.field}>
                  <label style={styles.label}>Número de DNI</label>
                  <input style={styles.input} type="text" placeholder="26401217"
                    value={dni}
                    onChange={e => setDni(e.target.value.replace(/\D/g, ''))}
                    maxLength={8}
                    inputMode="numeric"
                    autoComplete="username" />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Contraseña</label>
                  <div style={styles.passRow}>
                    <input style={{ ...styles.input, flex: 1 }}
                      type={verPassword ? 'text' : 'password'} placeholder="••••••••"
                      value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
                    <button type="button" style={styles.btnVer} onClick={() => setVerPassword(!verPassword)}>
                      {verPassword ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>
                <button type="submit" style={{ ...styles.btnPrimary, background: colorEstado.acentoVerde, opacity: cargando ? 0.7 : 1 }} disabled={cargando}>
                  {cargando ? 'Ingresando...' : 'Ingresar'}
                </button>
              </form>
              <button style={styles.btnVolver} onClick={volver}>← Volver</button>
            </div>
          )}

          <div style={styles.footer}>Explora S.A. · Uso interno · PGSM</div>
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

/* -----------------------------------------------------------------------------
 * Estilos -- crearEstilos(colores, oscuro) + useEstilos(), mismo patron que
 * el resto de las pantallas migradas.
 * -------------------------------------------------------------------------- */

function crearEstilos(colores, oscuro) {
  const pal = paletaTexto(oscuro);

  return {
    // "flex: 1, minHeight: 0" en vez de "minHeight: 100vh" -- ver el
    // comentario de cabecera: con el 100vh a mano, Login sumaba una
    // pantalla entera DE MAS sobre la barra sticky de arriba, y aparecia
    // scroll donde no debia haber.
    // `position: fixed` + `inset: 0` en vez de `flex: 1, minHeight: 0` --
    // ese primer intento dependia de que TODA la cadena de contenedores en
    // App.js (Pagina -> Contenido -> este div) tuviera flexbox bien armado
    // de punta a punta, y evidentemente algo en el medio no estaba
    // resolviendo una altura real: sin una altura definida, la imagen de
    // fondo con `height: '100%'` cae a su tamaño intrinseco (el de la
    // foto completa), empuja todo hacia abajo, y aparece el scroll.
    //
    // Con `fixed` + `inset: 0`, Login se planta exactamente sobre el
    // viewport siempre -- 100% del alto y ancho de la ventana, sin
    // depender de como este armado nada por fuera de este archivo. De
    // paso tapa la barra superior sticky que quedaba rara arriba de una
    // pantalla de login (logo repetido, ver el comentario que te habia
    // dejado la vuelta pasada) -- el zIndex esta por encima de esa barra
    // (9999) a proposito.
    wrap: { position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', fontFamily: tipografia.familia },
    fotoWrap: { flex: 1, position: 'relative', overflow: 'hidden' },
    foto: { width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%', display: 'block' },
    fotoOverlay: { position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.1) 60%)' },
    fotoBadge: { position: 'absolute', bottom: 32, left: 32 },
    fotoBadgeTitulo: { fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4, letterSpacing: '-0.3px' },
    fotoBadgeSub: { fontSize: 13, color: 'rgba(255,255,255,0.6)' },

    // El panel ya no pide su propio "minHeight: 100vh" -- alcanza con
    // estirarse al alto de "wrap" (comportamiento por defecto de flexbox
    // en una fila), y "overflowY: auto" queda de red de seguridad si algun
    // dia el contenido no entra en una pantalla muy baja.
    panel: {
      width: '100%', maxWidth: 440, background: colores.superficieModal, display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '2.5rem 2rem', boxShadow: '-8px 0 32px rgba(0,0,0,0.08)', boxSizing: 'border-box',
      overflowY: 'auto',
    },
    panelInner: { width: '100%', display: 'flex', flexDirection: 'column', gap: 0 },
    logoArea: { marginBottom: 32 },
    logo: { height: 40, objectFit: 'contain' },
    heading: { fontSize: 24, fontWeight: 700, color: colores.texto, letterSpacing: '-0.5px', marginBottom: 6 },
    subheading: { fontSize: 14, color: pal.azul, marginBottom: 32 },
    formWrap: { display: 'flex', flexDirection: 'column', gap: 12 },
    modoDesc: { fontSize: 12, color: pal.azul, margin: '0 0 4px', textAlign: 'center' },
    form: { display: 'flex', flexDirection: 'column', gap: 14 },
    field: { display: 'flex', flexDirection: 'column', gap: 6 },
    label: { fontSize: 12, color: colores.textoSecundario, fontWeight: tipografia.peso.negrita, letterSpacing: '0.02em' },
    input: { fontSize: 14, padding: '11px 13px', borderRadius: radio.md, border: `1.5px solid ${colores.borde}`, color: colores.texto, width: '100%', boxSizing: 'border-box', outline: 'none', background: colores.fondoAlterno, fontFamily: tipografia.familia },
    passRow: { display: 'flex', gap: 8, alignItems: 'center' },
    btnVer: { padding: '11px 12px', borderRadius: radio.md, border: `1.5px solid ${colores.borde}`, background: colores.fondoAlterno, cursor: 'pointer', fontSize: 14, color: pal.azul, flexShrink: 0 },
    btnPrimary: { padding: 12, borderRadius: radio.md, border: 'none', background: marca, color: '#fff', fontSize: 14, fontWeight: tipografia.peso.negrita, cursor: 'pointer', letterSpacing: '0.02em' },
    btnGoogle: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 16px', borderRadius: radio.md, border: `1.5px solid ${colores.borde}`, background: colores.superficie, color: colores.texto, fontSize: 14, fontWeight: tipografia.peso.medio, cursor: 'pointer' },
    btnEmail: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderRadius: radio.md, border: `1.5px solid ${colores.borde}`, background: colores.superficie, color: colores.textoSecundario, fontSize: 14, cursor: 'pointer' },
    btnChofer: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderRadius: radio.md, border: `1.5px solid ${colorEstado.acentoVerde}`, background: colorEstado.exitoFondo, color: colorEstado.acentoVerde, fontSize: 14, fontWeight: tipografia.peso.medio, cursor: 'pointer' },
    choferBanner: { padding: '10px 14px', borderRadius: radio.md, background: colorEstado.exitoFondo, border: `1px solid ${colorEstado.exitoBorde}`, fontSize: 13, color: colorEstado.acentoVerde, fontWeight: tipografia.peso.medio, textAlign: 'center' },
    divider: { display: 'flex', alignItems: 'center', gap: 10 },
    dividerLine: { flex: 1, height: 1, background: colores.borde },
    dividerText: { fontSize: 12, color: pal.azul },
    btnReset: { background: 'none', border: 'none', color: pal.azul, fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0, textAlign: 'center' },
    btnVolver: { background: 'none', border: 'none', color: pal.azul, fontSize: 13, cursor: 'pointer', padding: 0, textAlign: 'center', marginTop: 4 },
    error: { padding: '10px 14px', borderRadius: radio.md, background: colorEstado.peligroFondo, border: `1px solid ${colorEstado.peligroBordeAlterno}`, fontSize: 12, color: colorEstado.peligroTexto },
    success: { padding: '10px 14px', borderRadius: radio.md, background: colorEstado.exitoFondo, border: `1px solid ${colorEstado.exitoBorde}`, fontSize: 12, color: colorEstado.exitoTexto },
    footer: { marginTop: 48, fontSize: 11, color: pal.azul, textAlign: 'center' },
  };
}

function useEstilos() {
  const { colores, oscuro } = useTema();
  return useMemo(() => crearEstilos(colores, oscuro), [colores, oscuro]);
}

export default Login;
