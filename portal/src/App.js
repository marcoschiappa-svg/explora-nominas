import React, { useState, useEffect } from 'react';
import { auth, loginConGoogle, logout } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import Login from './pages/Login';
import Home from './pages/Home';
import Pedidos from './pages/Pedidos';
import Coordinador from './pages/Coordinador';
import Transportista from './pages/Transportista';

function App() {
  const [pantalla, setPantalla] = useState('login');
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUsuario({
          nombre: user.displayName,
          email: user.email,
          foto: user.photoURL,
          uid: user.uid,
        });
        setPantalla('home');
      } else {
        setUsuario(null);
        setPantalla('login');
      }
      setCargando(false);
    });
    return () => unsub();
  }, []);

  async function handleLogin() {
    try {
      await loginConGoogle();
    } catch (err) {
      console.error('Error login:', err);
      alert('Error al iniciar sesión. Intentá de nuevo.');
    }
  }

  async function handleLogout() {
    await logout();
  }

  function handleModulo(id) {
    setPantalla(id);
  }

  if (cargando) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#9CA3AF', fontSize: 14 }}>
        Cargando...
      </div>
    );
  }

  if (pantalla === 'pedidos')       return <Pedidos      usuario={usuario} onVolver={() => setPantalla('home')} />;
  if (pantalla === 'coordinador')   return <Coordinador  usuario={usuario} onVolver={() => setPantalla('home')} />;
  if (pantalla === 'transportista') return <Transportista usuario={usuario} onVolver={() => setPantalla('home')} />;

  if (pantalla === 'home') {
    return <Home usuario={usuario} onModulo={handleModulo} onLogout={handleLogout} />;
  }

  return <Login onLogin={handleLogin} />;
}

export default App;