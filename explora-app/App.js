/**
 * =============================================================================
 * App.js — Raíz de TrackEx
 * =============================================================================
 *
 * PROPÓSITO
 * Arma los proveedores, carga fuentes y tema, restaura la sesión y decide qué
 * pantalla mostrar (login o ChoferScreen).
 *
 * ARQUITECTURA
 *   SafeAreaProvider → TemaProvider → Raiz
 * `Raiz` contiene la lógica y vive POR DEBAJO de los proveedores porque usa
 * `useTema()` (y las pantallas, `useSafeAreaInsets()`). El SafeAreaProvider va
 * por fuera de todo: con edge-to-edge (Android 15+) la app dibuja bajo las
 * barras del sistema y las pantallas necesitan los insets para no quedar
 * tapadas.
 *
 * StatusBar (expo-status-bar): se usa el componente y no `backgroundColor`,
 * que con edge-to-edge no tiene efecto. Login: íconos claros si el tema es
 * oscuro y oscuros si es claro. ChoferScreen: siempre claros, porque su
 * encabezado es de color en los dos temas.
 *
 * PANTALLA DE CARGA: se mantiene hasta que estén listos la sesión, la
 * preferencia de tema y las fuentes (evita un destello de tema o de fuente
 * equivocados). Con un usuario con sesión, además, hasta que termine la
 * verificación de versión mínima. Si las fuentes fallan, la app sigue con la
 * fuente del sistema.
 *
 * VERSIÓN MÍNIMA OBLIGATORIA (v1.1.1, Frente E)
 * La verificación (`verificarVersionMinima()`, versionMinima.js) corre cuando hay
 * un usuario con sesión, DESPUÉS del login: un efecto que depende de
 * `usuario?.uid` cubre tanto la sesión restaurada como el login nuevo
 * (`LoginScreen onLogin={setUsuario}`). Sin usuario no se verifica y
 * `versionBloqueo` vuelve a `null`. Se re-verifica en cada AppState 'active',
 * solo si hay usuario, para que una versión mínima subida con la app en segundo
 * plano se aplique al volver.
 *
 * Orden de render:
 *   1. Pantalla de carga mientras carga la sesión, el tema o las fuentes.
 *   2. Sin usuario: LoginScreen (no espera la verificación ni se bloquea).
 *   3. Con usuario y verificación pendiente (`versionBloqueo === null`): carga.
 *      ChoferScreen NO se monta hasta que termine; el tope de 5 s de
 *      `verificarVersionMinima` evita que quede trabada.
 *   4. Con usuario y `bloqueada`: ActualizarScreen.
 *   5. Con usuario y sin bloqueo: ChoferScreen.
 * Ante cualquier falla de la verificación no se bloquea.
 *
 * HISTORIAL: la primera versión verificaba al montar y la regla de
 * `configuracion_app` tenía lectura pública. Se cambió porque esa regla no pasa
 * el control del Paso 8 de Procedimiento.md; con lectura con sesión, verificar al
 * montar fallaría por permiso denegado antes de que Firebase restaure la sesión
 * y, por el criterio de no bloquear ante errores, nunca bloquearía.
 *
 *   - La tarea de GPS en segundo plano NO se detiene al bloquear, y su buffer se
 *     sube al actualizar, porque AsyncStorage se conserva entre actualizaciones.
 *   - Con la app bloqueada el chofer NO puede finalizar un viaje en curso: por
 *     eso la versión mínima se sube cuando no hay viajes EN_VIAJE en teléfonos
 *     con versiones viejas (ver CHANGELOG).
 * =============================================================================
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, ActivityIndicator, Image, StyleSheet, AppState } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './src/config/firebase';
import { cargarPerfilChofer } from './src/perfilChofer';
import LoginScreen from './src/screens/LoginScreen';
import ChoferScreen from './src/screens/ChoferScreen';
import ActualizarScreen from './src/screens/ActualizarScreen';
import { verificarVersionMinima } from './src/versionMinima';
import { TemaProvider, useTema } from './src/tema/TemaContext';
import { FUENTES } from './src/tema/fuentes';
import { marca } from './src/compartido';
import { configurarNotificaciones, registrarPushToken, borrarPushToken } from './src/notificaciones';

/**
 * Raíz de la app: provee insets y tema a todo el árbol. El contenido vive en
 * `Raiz` porque `useTema()` solo funciona por debajo del proveedor.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <TemaProvider>
        <Raiz />
      </TemaProvider>
    </SafeAreaProvider>
  );
}

/**
 * Pantalla de carga con los colores del tema.
 *
 * @param {Object} props
 * @param {Object} props.estilos Estilos de `Raiz` (fondo del tema).
 */
function PantallaCarga({ estilos }) {
  return (
    <View style={estilos.loading}>
      <Image source={require('./assets/icon.png')} style={estilos.logo} resizeMode="contain" />
      <ActivityIndicator color={marca} style={estilos.spinner} />
    </View>
  );
}

function Raiz() {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  // Resultado de `verificarVersionMinima()`: `null` mientras no se verificó (o
  // sin usuario); después `{ bloqueada, instalada, minima }`.
  const [versionBloqueo, setVersionBloqueo] = useState(null);

  // Espejo de `usuario` para el listener de AppState, que se registra una sola
  // vez y no vería el valor nuevo de React.
  const usuarioRef = useRef(null);
  usuarioRef.current = usuario;

  // Fuentes y tema: la pantalla de carga se mantiene hasta que estén listos.
  // Si las fuentes fallan se sigue igual con la fuente del sistema: no deben
  // bloquear la app.
  const [fuentesListas, errorFuentes] = useFonts(FUENTES);
  const { listo: temaListo, oscuro, colores: c } = useTema();

  const estilos = useMemo(() => StyleSheet.create({
    loading: { flex: 1, backgroundColor: c.fondo, alignItems: 'center', justifyContent: 'center' },
    logo: { width: 80, height: 80 },
    spinner: { marginTop: 20 },
  }), [c]);

  // Notificaciones: se configura el handler y el canal de Android UNA vez al
  // arrancar (sin dependencias). Tiene que ocurrir antes de pedir el permiso.
  useEffect(() => {
    configurarNotificaciones();
  }, []);

  // Versión mínima, verificación por usuario: depende de `usuario?.uid` (y no del
  // objeto, para no repetirla en cada re-render). Con usuario, vuelve a `null`
  // (pantalla de carga) y verifica; sin usuario, vuelve a `null` sin verificar.
  // `verificarVersionMinima` nunca lanza (tope de 5 s, sin bloqueo ante fallas),
  // así que `versionBloqueo` siempre termina resuelto. La bandera `activo` evita
  // guardar el resultado de un usuario que ya cerró sesión.
  useEffect(() => {
    setVersionBloqueo(null);
    if (!usuario?.uid) return undefined;

    let activo = true;
    verificarVersionMinima().then((resultado) => {
      if (activo) setVersionBloqueo(resultado);
    });
    return () => { activo = false; };
  }, [usuario?.uid]);

  // Re-verificación al volver a primer plano, solo con usuario. Sin
  // dependencias: el listener se registra una vez (lee el usuario por
  // `usuarioRef`) y se da de baja al desmontar. No vuelve a `null` para no
  // mostrar la pantalla de carga en cada regreso a la app.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (estado) => {
      if (estado !== 'active' || !usuarioRef.current?.uid) return;
      const uid = usuarioRef.current.uid;
      const resultado = await verificarVersionMinima();
      if (usuarioRef.current?.uid === uid) setVersionBloqueo(resultado);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (errorFuentes) console.warn('fuentes: no se pudieron cargar:', errorFuentes.message || errorFuentes);
  }, [errorFuentes]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Restauración de sesión: misma validación que el login (documento
        // `usuarios/{uid}` existente, activo y con rol chofer).
        try {
          const { usuario: perfil } = await cargarPerfilChofer(firebaseUser.uid);
          if (perfil) {
            setUsuario(perfil);
          } else {
            await signOut(auth);
            setUsuario(null);
          }
        } catch (err) {
          // Sin red o sin permisos: no se puede validar. Se deja la sesión de
          // Auth como está y se muestra el login; antes la promesa rechazada
          // dejaba la app en la pantalla de carga para siempre.
          console.warn('restaurar sesión:', err?.code, err?.message);
          setUsuario(null);
        }
      } else {
        setUsuario(null);
      }
      setCargando(false);
    });
    return () => unsub();
  }, []);

  // Registra el token push cuando el usuario queda autenticado. Depende de
  // `usuario?.uid` y no del objeto, para no reintentar en cada re-render.
  useEffect(() => {
    if (usuario?.uid) registrarPushToken(usuario);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.uid]);

  async function handleLogout() {
    // El token se borra ANTES de cerrar sesión: las reglas exigen estar
    // autenticado para escribir, y así un teléfono que deja de ser del chofer no
    // recibe más sus avisos. Espera 3 segundos como máximo (sin red no bloquea).
    if (usuario?.uid) await borrarPushToken(usuario.uid);
    await signOut(auth);
    setUsuario(null);
  }

  const estiloBarraCarga = oscuro ? 'light' : 'dark';

  // 1. Sesión, tema o fuentes sin resolver.
  if (cargando || !temaListo || (!fuentesListas && !errorFuentes)) {
    return (
      <>
        <StatusBar style={estiloBarraCarga} />
        <PantallaCarga estilos={estilos} />
      </>
    );
  }

  // 2. Sin usuario: login, sin esperar la verificación de versión.
  if (!usuario) {
    return (
      <>
        <StatusBar style={estiloBarraCarga} />
        <LoginScreen onLogin={setUsuario} />
      </>
    );
  }

  // 3. Con usuario y verificación de versión pendiente: carga. ChoferScreen no
  //    se monta hasta que termine (el tope de 5 s evita que quede trabada).
  if (versionBloqueo === null) {
    return (
      <>
        <StatusBar style={estiloBarraCarga} />
        <PantallaCarga estilos={estilos} />
      </>
    );
  }

  // 4. Versión instalada anterior a la mínima: no hay salida salvo actualizar.
  if (versionBloqueo.bloqueada) {
    return (
      <>
        <StatusBar style={estiloBarraCarga} />
        <ActualizarScreen instalada={versionBloqueo.instalada} minima={versionBloqueo.minima} />
      </>
    );
  }

  // 5. Sin bloqueo: ChoferScreen (o carga si el rol no es chofer, abajo).

  if (usuario.roles?.includes('chofer')) {
    return (
      <>
        {/* Siempre 'light': el encabezado de ChoferScreen es de color. */}
        <StatusBar style="light" />
        <ChoferScreen usuario={usuario} onLogout={handleLogout} />
      </>
    );
  }

  return (
    <>
      <StatusBar style={estiloBarraCarga} />
      <PantallaCarga estilos={estilos} />
    </>
  );
}
