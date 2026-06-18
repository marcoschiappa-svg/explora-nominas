import React, { useState, useEffect } from 'react';
import { auth } from './firebase';
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

function App() {
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

export default App;
