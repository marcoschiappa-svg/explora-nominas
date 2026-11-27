/* -----------------------------------------------------------------------------
 * v1.2.7 — LECTURAS COMPARTIDAS
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     `explora-portal` superó la cuota diaria gratuita de Firestore. La
 *     solución (`suscripciones-compartidas.js` + caché persistente en
 *     `firebase.js`) hace que los datos sobrevivan a las pantallas: hay que
 *     cortarlos explícitamente al cerrar sesión o cambiar de usuario.
 *
 *   CAUSA RAÍZ
 *     Antes cada pantalla cerraba sus listeners al desmontarse, así que el
 *     logout no tenía que hacer nada más que `signOut`. Con suscripciones
 *     compartidas (que siguen vivas 10 minutos después de salir de una
 *     pantalla) y caché en IndexedDB, `signOut` solo ya no alcanza.
 *
 *   ALCANCE
 *     1. `handleLogout` usa `cerrarSesionCompleta()` (`cerrar-sesion.js`):
 *        cierra suscripciones, `signOut`, termina Firestore, borra la caché
 *        local y recarga la página.
 *     2. `onAuthStateChanged`: si no hay usuario, o si el uid cambió respecto
 *        del anterior, `cerrarTodasLasSuscripciones()` ANTES de cualquier otra
 *        cosa. Así nunca quedan datos de un usuario en la sesión de otro,
 *        tampoco cuando el logout viene de otra pestaña o la sesión vence.
 *     3. Logout desde otra pestaña: si esta pestaña tenía una sesión del
 *        portal cargada y Auth informa que ya no hay usuario, y el cierre NO
 *        lo inició esta pestaña (bandera de `cerrar-sesion.js`,
 *        `cierreIniciadoEnEstaPestana()`), se hace `window.location.reload()`.
 *        Sin esto, la pestaña quedaba en Login con Firestore terminado (el
 *        borrado de la caché de la otra pestaña lo termina) y había que
 *        recargarla a mano. "Tenía una sesión" = `cargarSesion` devolvió una
 *        sesión en esta pestaña: así no recargan ni la carga inicial en Login
 *        ni el `signOut` que hacen `Login.js` y este archivo cuando el usuario
 *        no tiene acceso (perdería el mensaje de "sin acceso").
 *
 *   LIMITACIONES CONOCIDAS
 *     El logout recarga la página (antes no): se ve un parpadeo de la pantalla
 *     de carga antes del Login. Las salidas que no pasan por el botón (otra
 *     pestaña, sesión vencida) cierran las suscripciones pero no borran la
 *     caché local (ver `cerrar-sesion.js`). Por (3), esas salidas también
 *     recargan la pestaña: con la sesión vencida o revocada se ve una recarga
 *     antes del Login. Lo que se estuviera escribiendo en un formulario de esa
 *     pestaña se pierde (antes también se perdía, al pasar a Login).
 *
 *   CÓMO SE VERIFICA
 *     Entrar a Programación, volver a Home y cerrar sesión: la página recarga
 *     en Login. Con dos pestañas, cerrar sesión en una: la otra se recarga
 *     sola, queda en Login y se puede volver a entrar sin F5. Abrir el portal
 *     sin sesión: queda en Login sin recargas en bucle. Entrar con un usuario
 *     sin acceso: aparece el mensaje de "sin acceso" y no se recarga.
 *
 * -----------------------------------------------------------------------------
 * v1.2.5 — UN SOLO TARIFARIO Y ALTO FIJO PARA SEGUIMIENTO
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     (a) Home tenía dos tarifarios. (b) En Seguimiento la página entera
 *     scrolleaba y el mapa tomaba el alto que le dejaba la lista.
 *
 *   CAUSA RAÍZ
 *     (a) Convivencia con el legacy desde v1.2.0 (RF-09), ya terminada.
 *     (b) La cadena de alto se cortaba en el wrapper de `Contenido` dentro de
 *     `Pagina`: `{ flex: '1 0 auto', minHeight: 0 }` SIN `display: flex`, y
 *     `Pagina` con `minHeight: 100vh` (no `height`). El arreglo de v1.1.x
 *     puso `flex: 1, minHeight: 0` en `Seguimiento` (`wrap`/`layout`), pero
 *     eso solo funciona si TODOS los ancestros son flex con alto acotado.
 *     Cuando `Pagina` pasó a ser "sticky footer" (`minHeight` + `flex: '1 0
 *     auto'`, para que el pie quede abajo en las pantallas cortas), el padre
 *     de Seguimiento dejó de ser flex y de tener alto definido: el `flex: 1`
 *     de Seguimiento quedó sin efecto y el alto pasó a depender del
 *     contenido (la lista).
 *
 *   ALCANCE
 *     1. Sale la rama `tarifario` y el import de `Tarifario.js` (el archivo
 *        queda en el repo sin referencias).
 *     2. `Pagina` recibe `altoFijo`. Solo Seguimiento lo pide: `Pagina` toma
 *        `height: 100vh` + `overflow: hidden` y el wrapper del contenido pasa a
 *        flex en columna con `flex: '1 1 0'`, `minHeight: 0`. El resto de las
 *        pantallas sigue con el sticky footer y el scroll de siempre.
 *     3. `Pagina` pasa a envolver desde ADENTRO de `Contenido` (que es quien
 *        sabe qué módulo se muestra), en vez de al revés. Sigue dentro de
 *        `TemaProvider`.
 *
 *   LIMITACIONES CONOCIDAS
 *     En Seguimiento el pie (`Pie`) sigue visible al fondo de la ventana: el
 *     mapa ocupa el alto entre `BarraSuperior` y el pie.
 *
 *   CÓMO SE VERIFICA
 *     Home muestra un solo tile "Tarifario". Seguimiento no tiene scroll de
 *     página; Pedidos, Programación y el resto scrollean igual que antes.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-07) — RUTEO CONTRA LA TABLA ÚNICA DE MÓDULOS
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Cada rama de ruteo repetía su propia lista de roles, a veces contra el
 *     `rol` legacy y a veces contra `tieneAlgunRol` — sin criterio único.
 *     `tarifario` era el caso más notorio: solo exigía `rol !== 'transportista'`,
 *     sin límite real de roles, mientras el tile de `Home.js` sí lo limitaba.
 *
 *   CAUSA RAÍZ
 *     No existía un solo lugar que dijera qué rol puede usar cada módulo.
 *
 *   ALCANCE
 *     Todas las ramas pasan a `puede(id)`, que llama a
 *     `puedeVerModulo(usuario, moduloPorId(id))` de `modulos.js`. El mapeo
 *     id → componente se queda acá, que es lo único específico de este
 *     archivo.
 *
 *   LIMITACIONES CONOCIDAS
 *     Ninguna — el comportamiento de ruteo (caer a Home si no corresponde)
 *     es el mismo de antes.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. Entrar a un módulo por estado sin
 *     el rol correspondiente cae a Home, igual que antes de esta tarea.
 *
 * v1.2.0 (RF-10 y RF-05) -- dos ramas nuevas, mismo patrón que el resto:
 *   `calendario` -> `CalendarioOperativo.js`, `ciclo_vida` -> `CicloVida.js`
 *   (esta última se da de baja en v1.2.3: ver el bloque de más abajo).
 *   Los roles salen de `modulos.js`, como siempre -- nada de roles propios
 *   acá.
 *
 * -----------------------------------------------------------------------------
 * v1.2.3 -- SIN RUTAS DEL MODELO ANTERIOR
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     Seguían ruteadas seis pantallas que operaban sobre `pedidos_portal` y
 *     `usuarios_portal` (o quedaron redundantes): Pedidos anteriores
 *     (`PedidosLegacy`), Programación anterior (`Coordinador`), Despachos
 *     anteriores (`Transportista`), Viajes anteriores (`Chofer`),
 *     Administración (`Admin`) y la vista Ciclo de vida (`CicloVida`).
 *
 *   CAUSA RAÍZ
 *     Después de v1.2.3 todos los pedidos del modelo viejo están migrados al
 *     modelo nuevo y cerrados (`scripts/migrar-pedidos-legacy.js`): esas
 *     pantallas no tienen nada que operar. El ciclo de vida pasa a ser un modal
 *     dentro del pedido (`pages/CicloVidaPedido.js`, desde `Pedidos.js`).
 *
 *   ALCANCE
 *     Se sacan los seis `import` y sus ramas de ruteo; los seis archivos se
 *     borran del repo. Un valor de `modulo` que ya no existe sigue cayendo a
 *     Home, igual que cualquier módulo al que el usuario no puede entrar.
 *
 *   LIMITACIONES CONOCIDAS
 *     `cargarSesion()` sigue leyendo `usuarios_portal` como respaldo del login
 *     (`sesion.js` no se toca en esta versión).
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. Ningún tile de Home lleva a una de
 *     las seis pantallas, y `grep` de sus nombres sobre `src/` solo encuentra
 *     comentarios que explican la baja.
 *
 * -----------------------------------------------------------------------------
 * v1.2.0 (RF-09) -- SE DESHACE EL PASO A `usuario`: `Tarifario` QUEDA LEGACY
 * -----------------------------------------------------------------------------
 *   SÍNTOMA
 *     El párrafo de ALCANCE de más arriba decía que `Tarifario` pasa a
 *     recibir `usuario` en vez de `userRole`/`userEmail` — eso nunca se
 *     terminó de revertir acá cuando RF-09 reemplazó la pantalla entera, y
 *     ahora que esa pantalla vuelve a su versión ORIGINAL (con `T_BASE` y
 *     modo admin por contraseña), la rama de este archivo quedó
 *     desalineada con la firma real del componente.
 *
 *   CAUSA RAÍZ
 *     RF-09 se revierte, pero `Tarifario.js` no: queda como legacy, sin
 *     modificarse, hasta que se apruebe y se adopte `NuevoTarifario.js`
 *     (pantalla nueva, en paralelo, sobre la colección `rutas`).
 *
 *   ALCANCE
 *     La rama de `tarifario` vuelve a pasarle `userRole={usuario.rol}` y
 *     `userEmail={usuario.email}` (los campos legacy que ya trae el objeto
 *     de sesión, ver `sesion.js`), en vez de `usuario`. Rama nueva
 *     `nuevo_tarifario` -> `NuevoTarifario.js`, mismo patrón que el resto
 *     (`usuario`/`onVolver`). La visibilidad de ambos módulos sigue
 *     saliendo de `modulos.js` sin cambios.
 *
 *   LIMITACIONES CONOCIDAS
 *     Mientras conviven las dos pantallas, un cambio de tarifa en una no se
 *     refleja en la otra (colecciones separadas) — ver `COMPORTAMIENTO.md`.
 *
 *   CÓMO SE VERIFICA
 *     `CI=true npm run build` sin warnings. Manual: el Tarifario legacy pide
 *     la clave de administrador igual que antes de v1.2.0.
 * -------------------------------------------------------------------------- */

import React, { useState, useEffect } from 'react';
import { auth, ENTORNO } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { cerrarTodasLasSuscripciones } from './suscripciones-compartidas';
import { cerrarSesionCompleta, cierreIniciadoEnEstaPestana } from './cerrar-sesion';
import { cargarSesion } from './sesion';
import { moduloPorId, puedeVerModulo } from './modulos';
import Login from './pages/Login';
import Home from './pages/Home';
import Pedidos from './pages/Pedidos';
import Programacion from './pages/Programacion';
import MisDespachos from './pages/MisDespachos';
import MisViajes from './pages/MisViajes';
import Seguimiento from './pages/Seguimiento';
import Organizaciones from './pages/Organizaciones';
import Usuarios from './pages/Usuarios';
import Productos from './pages/Productos';
import Camiones from './pages/Camiones';
import CalendarioOperativo from './pages/CalendarioOperativo';
import NuevoTarifario from './pages/NuevoTarifario';
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
    // v1.2.7 (2): uid de la última notificación de Auth (null = sin usuario).
    let uidAnterior = null;
    // v1.2.7 (3): si esta pestaña llegó a tener una sesión del portal cargada
    // (no alcanza con que Auth haya informado un usuario: ver el encabezado).
    let habiaSesion = false;
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      // v1.2.7 (2): antes que cualquier otra cosa -- nunca quedan datos de un
      // usuario en la sesión de otro.
      const uidNuevo = firebaseUser ? firebaseUser.uid : null;
      if (!firebaseUser || (uidAnterior !== null && uidAnterior !== uidNuevo)) {
        cerrarTodasLasSuscripciones();
      }
      uidAnterior = uidNuevo;

      // v1.2.7 (3): logout hecho en OTRA pestaña (o sesión vencida): recargar,
      // para arrancar con una instancia de Firestore nueva. No recarga si el
      // cierre lo inició esta pestaña (lo hace `cerrarSesionCompleta` al
      // final) ni si no había sesión (carga inicial en Login).
      if (!firebaseUser) {
        const recargar = habiaSesion && !cierreIniciadoEnEstaPestana();
        habiaSesion = false;
        if (recargar) {
          window.location.reload();
          return;
        }
      }

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
          habiaSesion = true; // v1.2.7 (3)
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
    // v1.2.7 (1): cierra suscripciones, signOut, termina Firestore, borra la
    // caché local y recarga la página (no vuelve de acá).
    await cerrarSesionCompleta();
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
    // v1.2.0 (RF-07): el ruteo ya no repite roles propios por módulo — todos
    // se resuelven contra la tabla única de `modulos.js`
    // (`puedeVerModulo(usuario, moduloPorId(id))`). El mapeo id → componente
    // sigue viviendo acá, que es lo único específico de `App.js`. Si el
    // módulo pedido no existe o el usuario no puede verlo, cae a Home, igual
    // que antes.
    const puede = (id) => puedeVerModulo(usuario, moduloPorId(id));

    if (modulo === 'pedidos' && puede('pedidos')) {
      cuerpo = <Pedidos usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'programacion' && puede('programacion')) {
      cuerpo = <Programacion usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'mis_despachos' && puede('mis_despachos')) {
      cuerpo = <MisDespachos usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'mis_viajes' && puede('mis_viajes')) {
      cuerpo = <MisViajes usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'seguimiento' && puede('seguimiento')) {
      cuerpo = <Seguimiento usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'organizaciones' && puede('organizaciones')) {
      cuerpo = <Organizaciones usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'usuarios' && puede('usuarios')) {
      cuerpo = <Usuarios usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'productos' && puede('productos')) {
      cuerpo = <Productos usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'camiones' && puede('camiones')) {
      cuerpo = <Camiones usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'calendario' && puede('calendario')) {
      // v1.2.0 (RF-10)
      cuerpo = <CalendarioOperativo usuario={usuario} onVolver={() => setModulo('home')} />;
    } else if (modulo === 'nuevo_tarifario' && puede('nuevo_tarifario')) {
      // v1.2.5 (1): único tarifario (la rama `tarifario` legacy se dio de baja).
      cuerpo = <NuevoTarifario usuario={usuario} onVolver={() => setModulo('home')} />;
    } else {
      cuerpo = <Home usuario={usuario} onModulo={setModulo} />;
    }
  }

  // v1.2.5 (2): solo Seguimiento ocupa exactamente el alto de la ventana.
  const altoFijo = !!usuario && modulo === 'seguimiento' && puedeVerModulo(usuario, moduloPorId('seguimiento'));

  // v1.2.5 (3): `Pagina` envuelve desde acá.
  return (
    <Pagina altoFijo={altoFijo}>
      <div style={{ position: 'sticky', top: 0, zIndex: 9999, flexShrink: 0 }}>
        <FranjaEntorno />
        <BarraSuperior
          usuario={usuario}
          onIrAInicio={() => setModulo('home')}
          onLogout={handleLogout}
        />
      </div>
      {cuerpo}
    </Pagina>
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
function Pagina({ altoFijo, children }) {
  const { colores } = useTema();

  // v1.2.5 (2): con `altoFijo`, la cadena de alto queda acotada de punta a
  // punta (100vh -> wrapper flex -> pantalla con `flex: 1, minHeight: 0`).
  // Sin él, exactamente el sticky footer de antes.
  return (
    <div
      style={{
        ...(altoFijo ? { height: '100vh', overflow: 'hidden' } : { minHeight: '100vh' }),
        display: 'flex',
        flexDirection: 'column',
        background: colores.fondo,
        color: colores.texto,
      }}
    >
      <div
        style={altoFijo
          ? { flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }
          : { flex: '1 0 auto', minHeight: 0 }}
      >
        {children}
      </div>
      <Pie />
    </div>
  );
}

/**
 * Punto de entrada del portal: `Contenido` (que se envuelve en `Pagina`, con
 * el pie de pagina -- v1.2.5 (3)) dentro de `TemaProvider`, para que tanto ella como cualquier
 * pantalla de adentro puedan leer el tema actual.
 */
function App() {
  return (
    <TemaProvider>
      <Contenido />
    </TemaProvider>
  );
}

export default App;
