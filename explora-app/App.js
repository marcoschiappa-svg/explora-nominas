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
 * equivocados). Si las fuentes fallan, la app sigue con la fuente del sistema.
 * =============================================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { View, ActivityIndicator, Image, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './src/config/firebase';
import { cargarPerfilChofer } from './src/perfilChofer';
import LoginScreen from './src/screens/LoginScreen';
import ChoferScreen from './src/screens/ChoferScreen';
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

  if (cargando || !temaListo || (!fuentesListas && !errorFuentes)) {
    return (
      <>
        <StatusBar style={estiloBarraCarga} />
        <PantallaCarga estilos={estilos} />
      </>
    );
  }

  if (!usuario) {
    return (
      <>
        <StatusBar style={estiloBarraCarga} />
        <LoginScreen onLogin={setUsuario} />
      </>
    );
  }

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
