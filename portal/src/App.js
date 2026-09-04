import React, { useState, useEffect } from 'react';
import { auth, ENTORNO } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { cargarSesion, tieneAlgunRol } from './sesion';
import Login from './pages/Login';
import Home from './pages/Home';
import Pedidos from './pages/Pedidos';
import PedidosLegacy from './pages/PedidosLegacy';
import Coordinador from './pages/Coordinador';
import Programacion from './pages/Programacion';
import Transportista from './pages/Transportista';
import MisDespachos from './pages/MisDespachos';
import Chofer from './pages/Chofer';
import MisViajes from './pages/MisViajes';
import Seguimiento from './pages/Seguimiento';
import Admin from './pages/Admin';
import Organizaciones from './pages/Organizaciones';
import Usuarios from './pages/Usuarios';
import Productos from './pages/Productos';
import Camiones from './pages/Camiones';
import Tarifario from './Tarifario';
import Pie from './ui/Pie';
import { TemaProvider, useTema } from './ui/TemaContext';
import BarraSuperior from './ui/BarraSuperior';

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
        // `cargarSesion` lee los DOS modelos: el documento viejo de
        // `usuarios_portal` —que es lo que usan las pantallas actuales— y el
        // perfil nuevo de `usuarios`, que queda en `usuario.perfil`.
        //
        // Devuelve null si el usuario no puede entrar. El perfil nuevo puede
        // ser null sin que eso impida entrar: los choferes y cualquiera dado
        // de alta desde el Admin viejo todavía no lo tienen, y siguen usando
        // el portal como siempre. Lo que no pueden es escribir el modelo
        // nuevo, y eso lo imponen las reglas, no esta pantalla.
        const sesion = await cargarSesion(firebaseUser);
        if (sesion) {
          setUsuario(sesion);
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

  // Antes esta función tenía ~15 `return` distintos, uno por rama. Pasa a
  // armar el CONTENIDO en una variable (`cuerpo`) y devolverlo una sola vez,
  // envuelto por `BarraSuperior` — así la barra aparece en todas las ramas
  // (cargando, login, cada módulo, Home) sin tener que agregarla quince
  // veces. Ninguna condición de ruteo cambió, solo la forma de devolverlas.
  let cuerpo;

  if (cargando) {
    // Sin fondo propio: hereda el de `Pagina`, que ya es el del tema actual.
    // Antes tenia '#F5F5F5' fijo y se notaba un flash claro al entrar en
    // modo oscuro mientras Firebase resuelve la sesion.
    cuerpo = (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img src="/logo.png" alt="Explora" style={{ height: 40, opacity: 0.4 }} />
      </div>
    );
  } else if (!usuario) {
    cuerpo = <Login onLogin={handleLogin} />;
  } else {
    const rol = usuario.rol;

    // A partir de acá, cada módulo rutea contra una de dos fuentes:
    //   - Los LEGACY (pedidos_legacy, coordinador, transportista, chofer,
    //     seguimiento, admin, tarifario) comparan contra `rol`, el campo viejo
    //     de `usuarios_portal`. No cambian.
    //   - Los NUEVOS (los que en `Home.js` llevan `nuevo: true`) usan
    //     `tieneAlgunRol(usuario, [...])`, con la MISMA lista de roles que el
    //     tile correspondiente en `Home.js`, mirando `perfil.roles`.
    if (modulo === 'pedidos' && tieneAlgunRol(usuario, ['admin', 'comercial', 'coordinador'])) {
      cuerpo = <Pedidos usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'pedidos_legacy' && (rol === 'admin' || rol === 'comercial' || rol === 'coordinador')) {
      // Los pedidos que quedaron en `pedidos_portal`, en solo lectura. Este
      // bloque se borra cuando no quede ninguno vivo.
      cuerpo = <PedidosLegacy usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'coordinador' && (rol === 'admin' || rol === 'coordinador')) {
      cuerpo = <Coordinador usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'programacion' && tieneAlgunRol(usuario, ['admin', 'coordinador'])) {
      cuerpo = <Programacion usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'transportista' && (rol === 'admin' || rol === 'transportista')) {
      cuerpo = <Transportista usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'mis_despachos' && tieneAlgunRol(usuario, ['admin', 'transportista'])) {
      cuerpo = <MisDespachos usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'chofer' && (rol === 'admin' || rol === 'chofer')) {
      cuerpo = <Chofer usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'mis_viajes' && tieneAlgunRol(usuario, ['chofer'])) {
      cuerpo = <MisViajes usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'seguimiento' && tieneAlgunRol(usuario, ['admin', 'coordinador', 'transportista'])) {
      cuerpo = <Seguimiento usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'admin' && rol === 'admin') {
      cuerpo = <Admin usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'organizaciones' && tieneAlgunRol(usuario, ['admin', 'comercial'])) {
      cuerpo = <Organizaciones usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'usuarios' && tieneAlgunRol(usuario, ['admin', 'transportista'])) {
      cuerpo = <Usuarios usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'productos' && tieneAlgunRol(usuario, ['admin'])) {
      cuerpo = <Productos usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'camiones' && tieneAlgunRol(usuario, ['admin', 'coordinador', 'transportista'])) {
      cuerpo = <Camiones usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'tarifario' && rol !== 'transportista') {
      cuerpo = <Tarifario userRole={rol} userEmail={usuario.email} onVolver={() => setModulo('home')} />;
    } else {
      cuerpo = <Home usuario={usuario} onModulo={setModulo} />;
    }
  }

  return (
    <>
      <div style={{ position: 'sticky', top: 0, zIndex: 9999 }}>
        <FranjaEntorno />
        <BarraSuperior
          usuario={usuario}
          onIrAInicio={() => setModulo('home')}
          onLogout={handleLogout}
        />
      </div>
      {cuerpo}
    </>
  );
}

/**
 * El contenedor real de toda la app -- esto es lo que faltaba.
 *
 * `App.css` tiene una clase `.app` con `min-height: 100vh` que NADIE usa en
 * este archivo (no hay ningun `className="app"` en ningun lado): quedo
 * huerfana. Sin un contenedor asi, todo cuelga directo de `<body>`, que
 * `App.css` fija en un gris claro fijo -- por eso el fondo se veia "en caja"
 * (la columna de 960px de cada pantalla se pone oscura, pero los costados y
 * el resto del alto de la ventana quedan con el fondo de siempre) y por eso
 * `Pie` aparecia pegado al contenido en vez de al fondo de la ventana: nada
 * empujaba el pie hacia abajo cuando el contenido era mas corto que la
 * pantalla.
 *
 * `Pagina` reemplaza esa clase muerta por un div real: ocupa el 100% del
 * alto de la ventana, tiene el fondo del tema actual (por eso necesita
 * useTema() -- tiene que vivir DENTRO de <TemaProvider>, no en `App`), y es
 * flex en columna con el contenido a `flex: 1` para que `Pie` quede
 * empujado al fondo cuando sobra espacio, y despues del contenido cuando no
 * sobra -- el patron clasico de "sticky footer".
 */
function Pagina() {
  const { colores } = useTema();

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: colores.fondo,
        color: colores.texto,
      }}
    >
      <div style={{ flex: '1 0 auto', minHeight: 0 }}>
        <Contenido />
      </div>
      <Pie />
    </div>
  );
}

/**
 * Punto de entrada del portal: `Pagina` (que incluye el contenido y el pie
 * de pagina) dentro de `TemaProvider`, para que tanto ella como cualquier
 * pantalla de adentro puedan leer el tema actual.
 */
function App() {
  return (
    <TemaProvider>
      <Pagina />
    </TemaProvider>
  );
}

export default App;