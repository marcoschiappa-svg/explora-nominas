import React, { useState } from 'react';

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);

  function handleGoogle() {
    onLogin({ nombre: 'María Fernández', email: 'maria@explora.com.ar', rol: 'comercial' });
  }

  function handleLink(e) {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      alert('Ingresá un email válido');
      return;
    }
    setEnviado(true);
  }

  return (
    <div style={styles.screen}>
      <div style={styles.card}>

        <div style={styles.logoArea}>
          <div style={styles.logoCircle}>e</div>
          <span style={styles.logoText}>XPLORA</span>
        </div>

        <p style={styles.subtitulo}>Portal operativo</p>
        <p style={styles.hint}>Ingresá con tu cuenta para continuar</p>

        <div style={styles.seccion}>
          <p style={styles.seccionLabel}>Personal Explora</p>
          <button style={styles.btnGoogle} onClick={handleGoogle}>
            Ingresar con Google
          </button>
        </div>

        <div style={styles.divider}><span>o</span></div>

        <div style={styles.seccion}>
          <p style={styles.seccionLabel}>Transportistas externos</p>
          {!enviado ? (
            <form onSubmit={handleLink}>
              <input
                style={styles.input}
                type="email"
                placeholder="tu@empresa.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
              <button style={styles.btnLink} type="submit">
                Recibir link de acceso
              </button>
            </form>
          ) : (
            <div style={styles.success}>
              ✓ Link enviado a <strong>{email}</strong>. Revisá tu correo.
            </div>
          )}
        </div>

        <p style={styles.ayuda}>
          ¿Problemas para ingresar? Contactá al administrador.
        </p>

      </div>
    </div>
  );
}

const styles = {
  screen: {
    minHeight: '100vh',
    background: '#F3F4F6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem',
  },
  card: {
    background: '#fff',
    border: '0.5px solid #E5E7EB',
    borderRadius: 12,
    padding: '2rem',
    width: '100%',
    maxWidth: 360,
  },
  logoArea: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  logoCircle: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: '#D63B1F',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    fontWeight: 800,
  },
  logoText: {
    fontSize: 20,
    fontWeight: 500,
    color: '#111827',
  },
  subtitulo: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: 500,
    color: '#111827',
    marginBottom: 4,
  },
  hint: {
    textAlign: 'center',
    fontSize: 12,
    color: '#9CA3AF',
    marginBottom: 24,
  },
  seccion: {
    marginBottom: 16,
  },
  seccionLabel: {
    fontSize: 11,
    fontWeight: 500,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 8,
  },
  btnGoogle: {
    width: '100%',
    padding: '10px',
    borderRadius: 8,
    border: '0.5px solid #D1D5DB',
    background: '#fff',
    color: '#111827',
    fontSize: 14,
    cursor: 'pointer',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    textAlign: 'center',
    margin: '16px 0',
    color: '#9CA3AF',
    fontSize: 12,
    gap: 8,
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 8,
    border: '0.5px solid #D1D5DB',
    fontSize: 13,
    marginBottom: 8,
    color: '#111827',
  },
  btnLink: {
    width: '100%',
    padding: '10px',
    borderRadius: 8,
    border: 'none',
    background: '#534AB7',
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  success: {
    padding: '8px 12px',
    borderRadius: 8,
    background: '#E1F5EE',
    color: '#085041',
    fontSize: 12,
    border: '0.5px solid #5DCAA5',
  },
  ayuda: {
    textAlign: 'center',
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 16,
  },
};

export default Login;