import React, { useState, useEffect } from 'react';
import { auth, ENTORNO } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import Login from './pages/Login';
import Home from './pages/Home';
import Pedidos from './pages/Pedidos';
import Coordinador from './pages/Coordinador';
import Transportista from './pages/Transportista';
import Chofer from './pages/Chofer';
import Seguimiento from './pages/Seguimiento';
import Admin from './pages/Admin';
import Tarifario from './Tarifario';

/**
 * Franja de aviso que aparece arriba de todo cuando el portal NO está
 * apuntando a la base de datos real.
 *
 * Existe para evitar el accidente más caro posible: creer que estás en la
 * base de prueba y estar tocando producción, o al revés. Si no ves ninguna
 * franja, estás en la base REAL.
 *
 * No se renderiza nada en producción, así que el portal real queda
 * exactamente igual que antes.
 */
function FranjaEntorno() {
  if (ENTORNO === 'produccion') return null;

  const config = {
    staging: {
      texto: '🧪 ENTORNO DE PRUEBA — entorno-prueba-explora · Nada de lo que hagas acá afecta a producción',
      fondo: '#7C4A12',
    },
    emulador: {
      texto: '🔧 EMULADOR LOCAL — los datos viven en tu máquina y se borran al cerrar el emulador',
      fondo: '#374151',
    },
  }[ENTORNO];

  return (
    <div style={{
      background: config.fondo,
      color: '#fff',
      padding: '6px 16px',
      fontSize: 12,
      fontWeight: 600,
      textAlign: 'center',
      letterSpacing: '0.03em',
      position: 'sticky',
      top: 0,
      zIndex: 9999,
    }}>
      {config.texto}
    </div>
  );
}

/**
 * Contenido del portal. Es lo que antes era `App()` completo: la lógica de
 * sesión y el ruteo entre módulos, sin ningún cambio.
 *
 * Se separó en su propia función porque tiene varios `return` distintos, y la
 * franja de entorno tiene que aparecer en todos ellos — incluida la pantalla
 * de login y la de carga.
 */
function Contenido() {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [modulo, setModulo] = useState('home');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const snap = await getDoc(doc(db, 'usuarios_portal', firebaseUser.uid));
        if (snap.exists() && snap.data().estado === 'activo') {
          setUsuario({ uid: firebaseUser.uid, email: firebaseUser.email, ...snap.data() });
        } else {
          await auth.signOut();
          setUsuario(null);
        }
      } else {
        setUsuario(null);
      }
      setCargando(false);
    });
    return () => unsub();
  }, []);

  function handleLogin(perfil) {
    setUsuario(perfil);
    setModulo('home');
  }

  async function handleLogout() {
    await auth.signOut();
    setUsuario(null);
    setModulo('home');
  }

  if (cargando) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F5F5F5' }}>
        <img src="/logo.png" alt="Explora" style={{ height: 40, opacity: 0.4 }} />
      </div>
    );
  }

  if (!usuario) return <Login onLogin={handleLogin} />;

  const rol = usuario.rol;

  if (modulo === 'pedidos' && (rol === 'admin' || rol === 'comercial' || rol === 'coordinador')) {
    return <Pedidos usuario={usuario} onVolver={() => setModulo('home')} />;
  }
  if (modulo === 'coordinador' && (rol === 'admin' || rol === 'coordinador')) {
    return <Coordinador usuario={usuario} onVolver={() => setModulo('home')} />;
  }
  if (modulo === 'transportista' && (rol === 'admin' || rol === 'transportista')) {
    return <Transportista usuario={usuario} onVolver={() => setModulo('home')} />;
  }
  if (modulo === 'chofer' && (rol === 'admin' || rol === 'chofer')) {
    return <Chofer usuario={usuario} onVolver={() => setModulo('home')} />;
  }
  if (modulo === 'seguimiento' && (rol === 'admin' || rol === 'coordinador')) {
    return <Seguimiento usuario={usuario} onVolver={() => setModulo('home')} />;
  }
  if (modulo === 'admin' && rol === 'admin') {
    return <Admin usuario={usuario} onVolver={() => setModulo('home')} />;
  }
  if (modulo === 'tarifario' && rol !== 'transportista') {
    return <Tarifario userRole={rol} userEmail={usuario.email} onVolver={() => setModulo('home')} />;
  }

  return <Home usuario={usuario} onModulo={setModulo} onLogout={handleLogout} />;
}

/**
 * Punto de entrada del portal: la franja de entorno (si corresponde) y el
 * contenido.
 */
function App() {
  return (
    <>
      <FranjaEntorno />
      <Contenido />
    </>
  );
}

export default App;