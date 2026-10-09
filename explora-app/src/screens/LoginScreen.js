/**
 * =============================================================================
 * LoginScreen.js — Ingreso a TrackEx (rol: chofer)
 * =============================================================================
 *
 * PROPÓSITO
 * Autentica al chofer con DNI + contraseña, con email + contraseña, o con
 * biometría (reingreso). El perfil se valida con `cargarPerfilChofer`
 * (documento `usuarios/{uid}` activo y con rol chofer).
 *
 * -----------------------------------------------------------------------------
 * LAYOUT (cómo está armado y por qué)
 * -----------------------------------------------------------------------------
 *   <View raíz, flex 1, fondo del tema>
 *     <KeyboardAvoidingView flex 1>
 *       <ScrollView keyboardShouldPersistTaps="handled" flexGrow 1>
 *         <ColumnaCentrada> logo, título, pestañas, formulario </ColumnaCentrada>
 *       </ScrollView>
 *     </KeyboardAvoidingView>
 *     <PieVersion />   ← hermano del ScrollView; oculto con el teclado abierto
 *
 *   - El ScrollView garantiza que los campos sigan alcanzables aunque el
 *     teclado tape parte de la pantalla (teléfono chico u horizontal).
 *   - El pie queda FUERA del ScrollView: siempre al fondo, sin scrollear. Se
 *     oculta con el teclado visible para no robarle espacio al formulario.
 *   - `ColumnaCentrada` limita el formulario a 600 de ancho en pantallas
 *     grandes; el fondo ocupa todo el ancho.
 *
 * KeyboardAvoidingView: con edge-to-edge (Android 15+) el sistema ya no
 * redimensiona la ventana al abrir el teclado, y la documentación de Expo
 * indica manejarlo con `KeyboardAvoidingView`. Se usa `behavior="padding"` en
 * ambas plataformas. A VERIFICAR EN DISPOSITIVO (no se puede determinar sin uno).
 *
 * INSETS (edge-to-edge): el padding superior suma `insets.top` (reemplaza el
 * 80 fijo anterior) y los laterales respetan notch o cámara en horizontal.
 *
 * TEMA Y TIPOGRAFÍA: colores de los tokens compartidos vía `useTema()`;
 * Montserrat con `fontFamily: fuente(peso)` (nunca la propiedad de peso). Los estilos se
 * arman en `crearEstilos` dentro de un `useMemo`.
 * Literales de color permitidos (no hay token): '#fff' para texto sobre el
 * botón de acento, y '#000' como `shadowColor` de la pestaña activa.
 *
 * FACE ID: guarda solo `{ uid }` (clave `explora_last_user_v2`); ver más abajo.
 * =============================================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Keyboard,
  KeyboardAvoidingView, ActivityIndicator, Alert, Image
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '../config/firebase';
import { CHOFER_DOMAIN } from '../config/constants';
import { cargarPerfilChofer } from '../perfilChofer';
import { useTema } from '../tema/TemaContext';
import { fuente } from '../tema/fuentes';
import { TAMANO_TITULO_LOGIN } from '../tema/dimensiones';
import { marca, colorEstado, espacio, radio, tipografia } from '../compartido';
import ColumnaCentrada from '../componentes/ColumnaCentrada';
import PieVersion from '../componentes/PieVersion';

const FACEID_KEY = 'explora_faceid_enabled';

/**
 * Clave del último usuario para Face ID. v2 guarda SOLO `{ uid }`: el perfil se
 * relee de Firestore en cada ingreso con biometría, así nunca se restaura un
 * perfil con la forma vieja (sin `datos_chofer.dni`).
 */
const LAST_USER_KEY = 'explora_last_user_v2';

/** Clave de la versión anterior (guardaba el perfil completo). Se borra al arrancar. */
const LAST_USER_KEY_VIEJA = 'explora_last_user';

export default function LoginScreen({ onLogin }) {
  const [modo, setModo] = useState('dni'); // 'dni' | 'email'
  const [dni, setDni] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [faceIDDisponible, setFaceIDDisponible] = useState(false);
  const [authListo, setAuthListo] = useState(false);

  /** True mientras el teclado está abierto: oculta el pie de versión. */
  const [tecladoVisible, setTecladoVisible] = useState(false);

  const { colores: c } = useTema();
  const insets = useSafeAreaInsets();
  const s = useMemo(
    () => crearEstilos(c, insets),
    // Se depende de los números y no del objeto `insets`, que cambia de
    // identidad en cada render aunque los valores sean los mismos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c, insets.top, insets.bottom, insets.left, insets.right]
  );

  /* EFECTO 1 — Visibilidad del teclado, para ocultar el pie. Sin dependencias:
     los listeners se registran una vez y se dan de baja al desmontar. */
  useEffect(() => {
    const mostrar = Keyboard.addListener('keyboardDidShow', () => setTecladoVisible(true));
    const ocultar = Keyboard.addListener('keyboardDidHide', () => setTecladoVisible(false));
    return () => { mostrar.remove(); ocultar.remove(); };
  }, []);

  // Esperar a que Firebase Auth inicialice antes de cualquier cosa
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, () => {
      setAuthListo(true);
    });
    return () => unsub();
  }, []);

  // Recién cuando Firebase está listo, verificar Face ID. Antes se borra la
  // clave vieja del perfil guardado: su forma ya no sirve (ver LAST_USER_KEY).
  useEffect(() => {
    if (authListo) {
      AsyncStorage.removeItem(LAST_USER_KEY_VIEJA).catch(() => {});
      verificarFaceID();
    }
  }, [authListo]);

  async function verificarFaceID() {
    const habilitado = await AsyncStorage.getItem(FACEID_KEY);
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    setFaceIDDisponible(habilitado === 'true' && compatible && enrolled);
    if (habilitado === 'true' && compatible && enrolled) {
      intentarFaceID();
    }
  }

  async function intentarFaceID() {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Ingresá a TrackEx',
      fallbackLabel: 'Usar DNI y contraseña',
    });
    if (!result.success) return;

    // Con biometría se reingresa solo si la sesión de Firebase Auth sigue viva
    // y es la del último usuario. Si no, se limpia y se pide login normal.
    try {
      const crudo = await AsyncStorage.getItem(LAST_USER_KEY);
      const guardado = crudo ? JSON.parse(crudo) : null;
      const actual = auth.currentUser;
      if (!guardado?.uid || !actual || actual.uid !== guardado.uid) {
        await AsyncStorage.removeItem(LAST_USER_KEY).catch(() => {});
        setError('Tu sesión venció. Ingresá con tu DNI y contraseña.');
        return;
      }
      const { usuario, error: motivo } = await cargarPerfilChofer(actual.uid);
      if (!usuario) {
        setError(motivo);
        await auth.signOut();
        return;
      }
      onLogin(usuario);
    } catch (err) {
      setError('Error al iniciar sesión. Intentá de nuevo.');
    }
  }

  async function loginDNI() {
    const dniLimpio = dni.trim().replace(/\D/g, '');
    if (!dniLimpio || !password) { setError('Ingresá tu DNI y contraseña.'); return; }
    if (dniLimpio.length < 7 || dniLimpio.length > 8) { setError('El DNI debe tener 7 u 8 dígitos.'); return; }
    setCargando(true); setError('');
    try {
      const emailInterno = dniLimpio + CHOFER_DOMAIN;
      const result = await signInWithEmailAndPassword(auth, emailInterno, password);
      const { usuario, error: motivo } = await cargarPerfilChofer(result.user.uid);
      if (!usuario) { setError(motivo); await auth.signOut(); return; }

      await AsyncStorage.setItem(LAST_USER_KEY, JSON.stringify({ uid: usuario.uid }));
      const faceIDYaHabilitado = await AsyncStorage.getItem(FACEID_KEY);
      if (faceIDYaHabilitado !== 'true') {
        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (compatible && enrolled) {
          Alert.alert(
            '¿Activar Face ID?',
            'La próxima vez podés entrar con Face ID sin escribir tu DNI.',
            [
              { text: 'Ahora no', style: 'cancel', onPress: () => onLogin(usuario) },
              { text: 'Activar', onPress: async () => {
                await AsyncStorage.setItem(FACEID_KEY, 'true');
                onLogin(usuario);
              }},
            ]
          );
          return;
        }
      }
      onLogin(usuario);
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') setError('DNI o contraseña incorrectos.');
      else if (err.code === 'auth/too-many-requests') setError('Demasiados intentos. Esperá unos minutos.');
      else setError('Error al iniciar sesión. Intentá de nuevo.');
    } finally { setCargando(false); }
  }

  async function loginEmail() {
    if (!email || !password) { setError('Completá email y contraseña.'); return; }
    setCargando(true); setError('');
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      const { usuario, error: motivo } = await cargarPerfilChofer(result.user.uid);
      if (!usuario) { setError(motivo); await auth.signOut(); return; }
      await AsyncStorage.setItem(LAST_USER_KEY, JSON.stringify({ uid: usuario.uid }));
      onLogin(usuario);
    } catch (err) {
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') setError('Email o contraseña incorrectos.');
      else if (err.code === 'auth/too-many-requests') setError('Demasiados intentos. Esperá unos minutos.');
      else setError('Error al iniciar sesión.');
    } finally { setCargando(false); }
  }

  // Pantalla de carga mientras Firebase inicializa
  if (!authListo) {
    return (
      <View style={s.cargaInicial}>
        <ActivityIndicator size="large" color={marca} />
      </View>
    );
  }

  const phColor = c.textoTenue;

  return (
    <View style={s.raiz}>
      <KeyboardAvoidingView style={s.flex} behavior="padding">
        <ScrollView
          style={s.flex}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.scrollContenido}
        >
          <ColumnaCentrada>
            <Image source={require('../../assets/icon.png')} style={s.logo} resizeMode="contain" />
            <Text style={s.titulo}>TrackEx</Text>
            <Text style={s.subtitulo}>Complejo Industrial PGSM</Text>

            {/* Tabs */}
            <View style={s.tabs}>
              <TouchableOpacity style={[s.tab, modo === 'dni' && s.tabActive]} onPress={() => { setModo('dni'); setError(''); }}>
                <Text style={[s.tabTxt, modo === 'dni' && s.tabTxtActive]}>🚛 Chofer (DNI)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.tab, modo === 'email' && s.tabActive]} onPress={() => { setModo('email'); setError(''); }}>
                <Text style={[s.tabTxt, modo === 'email' && s.tabTxtActive]}>✉ Email</Text>
              </TouchableOpacity>
            </View>

            {error ? <Text style={s.error}>{error}</Text> : null}

            {modo === 'dni' && (
              <View style={s.form}>
                <Text style={s.label}>Número de DNI</Text>
                <TextInput style={s.input} placeholder="12345678" placeholderTextColor={phColor} keyboardType="numeric"
                  value={dni} onChangeText={t => setDni(t.replace(/\D/g, ''))} maxLength={8} autoComplete="username" />
                <Text style={s.label}>Contraseña</Text>
                <View style={s.passRow}>
                  <TextInput style={[s.input, s.flex]} placeholder="••••••••" placeholderTextColor={phColor}
                    secureTextEntry={!verPassword} value={password} onChangeText={setPassword} autoComplete="current-password" />
                  <TouchableOpacity style={s.btnVer} onPress={() => setVerPassword(!verPassword)}>
                    <Text>{verPassword ? '🙈' : '👁'}</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={[s.btnPrimary, { opacity: cargando ? 0.7 : 1 }]} onPress={loginDNI} disabled={cargando}>
                  {cargando ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryTxt}>Ingresar</Text>}
                </TouchableOpacity>
                {faceIDDisponible && (
                  <TouchableOpacity style={s.btnFaceID} onPress={intentarFaceID}>
                    <Text style={s.btnFaceIDTxt}>Ingresar con biometría</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {modo === 'email' && (
              <View style={s.form}>
                <Text style={s.label}>Email</Text>
                <TextInput style={s.input} placeholder="tu@email.com" placeholderTextColor={phColor} keyboardType="email-address"
                  autoCapitalize="none" value={email} onChangeText={setEmail} autoComplete="email" />
                <Text style={s.label}>Contraseña</Text>
                <View style={s.passRow}>
                  <TextInput style={[s.input, s.flex]} placeholder="••••••••" placeholderTextColor={phColor}
                    secureTextEntry={!verPassword} value={password} onChangeText={setPassword} autoComplete="current-password" />
                  <TouchableOpacity style={s.btnVer} onPress={() => setVerPassword(!verPassword)}>
                    <Text>{verPassword ? '🙈' : '👁'}</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={[s.btnPrimary, { opacity: cargando ? 0.7 : 1 }]} onPress={loginEmail} disabled={cargando}>
                  {cargando ? <ActivityIndicator color="#fff" /> : <Text style={s.btnPrimaryTxt}>Ingresar</Text>}
                </TouchableOpacity>
              </View>
            )}
          </ColumnaCentrada>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Pie: HERMANO del ScrollView (siempre al fondo) y oculto con el teclado. */}
      {!tecladoVisible && <PieVersion />}
    </View>
  );
}

/**
 * Arma los estilos de la pantalla con los colores del tema y los insets.
 *
 * Paleta: todo sale de los tokens compartidos. Literales permitidos: '#fff'
 * (texto sobre el botón de acento) y '#000' (shadowColor de la pestaña activa).
 * Tipografía: `fontFamily: fuente(peso)`, nunca la propiedad de peso.
 *
 * @param {Object} c Colores del tema (`temaClaro` o `temaOscuro`).
 * @param {{top:number,bottom:number,left:number,right:number}} insets Insets seguros.
 * @returns {Object} Estilos de `StyleSheet.create`.
 */
function crearEstilos(c, insets) {
  const peso = tipografia.peso;
  const tam = tipografia.tamano;
  return StyleSheet.create({
    // --- Contenedores ---
    raiz: { flex: 1, backgroundColor: c.fondo },
    flex: { flex: 1 },
    cargaInicial: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.fondo },
    scrollContenido: {
      flexGrow: 1,
      paddingTop: insets.top + 48,
      paddingBottom: espacio.xxl,
      paddingLeft: Math.max(insets.left, espacio.xl),
      paddingRight: Math.max(insets.right, espacio.xl),
    },

    // --- Encabezado de marca ---
    logo: { width: 80, height: 80, alignSelf: 'center', marginBottom: espacio.lg },
    titulo: { fontSize: TAMANO_TITULO_LOGIN, fontFamily: fuente(peso.fuerte), color: c.texto, textAlign: 'center', letterSpacing: -0.5 },
    subtitulo: { fontSize: tam.md, fontFamily: fuente(peso.normal), color: c.textoSuave, textAlign: 'center', marginBottom: espacio.xxl },

    // --- Pestañas ---
    tabs: { flexDirection: 'row', backgroundColor: c.fondoAlterno, borderRadius: radio.lg, padding: 3, marginBottom: 20 },
    tab: { flex: 1, paddingVertical: espacio.sm, borderRadius: radio.md, alignItems: 'center' },
    // '#000': sombra de la pestaña activa (RN exige shadowColor; no hay token).
    tabActive: { backgroundColor: c.superficie, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
    tabTxt: { fontSize: tam.md, color: c.textoSecundario, fontFamily: fuente(peso.medio) },
    tabTxtActive: { color: c.texto },

    // --- Error ---
    error: { backgroundColor: colorEstado.peligroFondo, borderRadius: radio.md, padding: espacio.md, fontSize: tam.md, fontFamily: fuente(peso.normal), color: colorEstado.peligroTexto, marginBottom: espacio.md },

    // --- Formulario ---
    form: { gap: espacio.sm },
    label: { fontSize: tam.sm, fontFamily: fuente(peso.negrita), color: c.textoSecundario, letterSpacing: 0.3, marginTop: espacio.xs },
    input: { fontSize: tam.xl, fontFamily: fuente(peso.normal), padding: 13, borderRadius: radio.lg, borderWidth: 1.5, borderColor: c.borde, color: c.texto, backgroundColor: c.fondoAlterno },
    passRow: { flexDirection: 'row', gap: espacio.sm, alignItems: 'center' },
    btnVer: { padding: 13, borderRadius: radio.lg, borderWidth: 1.5, borderColor: c.borde, backgroundColor: c.fondoAlterno },
    // '#fff': texto sobre el fondo de acento (marca); legible en los dos temas.
    btnPrimary: { backgroundColor: marca, padding: 14, borderRadius: radio.lg, alignItems: 'center', marginTop: espacio.sm },
    btnPrimaryTxt: { color: '#fff', fontSize: tam.xl, fontFamily: fuente(peso.negrita) },
    btnFaceID: { padding: 14, borderRadius: radio.lg, borderWidth: 1.5, borderColor: c.borde, alignItems: 'center', marginTop: espacio.sm },
    btnFaceIDTxt: { fontSize: tam.xl, color: c.texto, fontFamily: fuente(peso.medio) },
  });
}
