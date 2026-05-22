import React, { useState } from 'react';
import Login from './pages/Login';
import Home from './pages/Home';
import Pedidos from './pages/Pedidos';

function App() {
  const [pantalla, setPantalla] = useState('login');
  const [usuario, setUsuario] = useState(null);

  function handleLogin(u) {
    setUsuario(u);
    setPantalla('home');
  }

  function handleModulo(id) {
    setPantalla(id);
  }

  if (pantalla === 'pedidos') {
    return <Pedidos usuario={usuario} onVolver={() => setPantalla('home')} />;
  }

  if (pantalla === 'home') {
    return <Home usuario={usuario} onModulo={handleModulo} />;
  }

  return <Login onLogin={handleLogin} />;
}

export default App;