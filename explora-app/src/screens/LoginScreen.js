import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Image
} from 'react-native';
import { signInWithEmailAndPassword, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth, db } from '../config/firebase';
import { CHOFER_DOMAIN } from '../config/constants';

const FACEID_KEY = 'explora_faceid_enabled';
const LAST_USER_KEY = 'explora_last_user';

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

  // Esperar a que Firebase Auth inicialice antes de cualquier cosa
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, () => {
      setAuthListo(true);
    });
    return () => unsub();
  }, []);

  // Recién cuando Firebase está listo, verificar Face ID
  useEffect(() => {
    if (authListo) {
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
      promptMessage: 'Ingresá a Portal Explora',
      fallbackLabel: 'Usar DNI y contraseña',
    });
    if (result.success) {
      const ultimoUsuario = await AsyncStorage.getItem(LAST_USER_KEY);
      if (ultimoUsuario) {
        onLogin(JSON.parse(ultimoUsuario));
      }
    }
  }

  async function obtenerPerfil(uid, emailBusqueda) {
    const snap = await getDoc(doc(db, 'usuarios_portal', uid));
    if (snap.exists()) return snap.data();
    if (emailBusqueda) {
      const q = query(collection(db, 'usuarios_portal'), where('email', '==', emailBusqueda));
      const resultado = await getDocs(q);
      if (!resultado.empty) return resultado.docs[0].data();
    }
    return null;
  }

  async function loginDNI() {
    const dniLimpio = dni.trim().replace(/\D/g, '');
    if (!dniLimpio || !password) { setError('Ingresá tu DNI y contraseña.'); return; }
    if (dniLimpio.length < 7 || dniLimpio.length > 8) { setError('El DNI debe tener 7 u 8 dígitos.'); return; }
    setCargando(true); setError('');
    try {
      const emailInterno = dniLimpio + CHOFER_DOMAIN;
      const result = await signInWithEmailAndPassword(auth, emailInterno, password);
      const perfil = await obtenerPerfil(result.user.uid, emailInterno);
      if (!perfil) { setError('Tu DNI no está habilitado. Contactá al transportista.'); await auth.signOut(); return; }
      if (perfil.estado !== 'activo') { setError('Tu cuenta está inactiva.'); await auth.signOut(); return; }
      const usuario = { uid: result.user.uid, email: emailInterno, ...perfil };

      await AsyncStorage.setItem(LAST_USER_KEY, JSON.stringify(usuario));
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
      const perfil = await obtenerPerfil(result.user.uid, result.user.email);
      if (!perfil) { setError('Tu cuenta no está habilitada.'); await auth.signOut(); return; }
      if (perfil.estado !== 'activo') { setError('Tu cuenta está inactiva.'); await auth.signOut(); return; }
      const usuario = { uid: result.user.uid, email: result.user.email, ...perfil };
      await AsyncStorage.setItem(LAST_USER_KEY, JSON.stringify(usuario));
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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
        <ActivityIndicator size="large" color="#C8102E" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.inner}>
        <Image source={require('../../assets/icon.png')} style={s.logo} resizeMode="contain" />
        <Text style={s.titulo}>Portal Explora</Text>
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
            <TextInput style={s.input} placeholder="26401217" keyboardType="numeric"
              value={dni} onChangeText={t => setDni(t.replace(/\D/g, ''))} maxLength={8} autoComplete="username" />
            <Text style={s.label}>Contraseña</Text>
            <View style={s.passRow}>
              <TextInput style={[s.input, { flex: 1 }]} placeholder="••••••••"
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
                <Text style={s.btnFaceIDTxt}>󰗋 Usar Face ID</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {modo === 'email' && (
          <View style={s.form}>
            <Text style={s.label}>Email</Text>
            <TextInput style={s.input} placeholder="tu@email.com" keyboardType="email-address"
              autoCapitalize="none" value={email} onChangeText={setEmail} autoComplete="email" />
            <Text style={s.label}>Contraseña</Text>
            <View style={s.passRow}>
              <TextInput style={[s.input, { flex: 1 }]} placeholder="••••••••"
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
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff' },
  inner: { flex: 1, paddingHorizontal: 24, paddingTop: 80, paddingBottom: 40 },
  logo: { width: 80, height: 80, alignSelf: 'center', marginBottom: 16 },
  titulo: { fontSize: 26, fontWeight: '700', color: '#111827', textAlign: 'center', letterSpacing: -0.5 },
  subtitulo: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', marginBottom: 32 },
  tabs: { flexDirection: 'row', backgroundColor: '#F3F4F6', borderRadius: 10, padding: 3, marginBottom: 20 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  tabTxt: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  tabTxtActive: { color: '#111827' },
  error: { backgroundColor: '#FEF2F2', borderRadius: 8, padding: 12, fontSize: 13, color: '#B91C1C', marginBottom: 12 },
  form: { gap: 8 },
  label: { fontSize: 12, fontWeight: '600', color: '#374151', letterSpacing: 0.3, marginTop: 4 },
  input: { fontSize: 15, padding: 13, borderRadius: 10, borderWidth: 1.5, borderColor: '#E5E7EB', color: '#111827', backgroundColor: '#FAFAFA' },
  passRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  btnVer: { padding: 13, borderRadius: 10, borderWidth: 1.5, borderColor: '#E5E7EB', backgroundColor: '#FAFAFA' },
  btnPrimary: { backgroundColor: '#C8102E', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  btnPrimaryTxt: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnFaceID: { padding: 14, borderRadius: 10, borderWidth: 1.5, borderColor: '#E5E7EB', alignItems: 'center', marginTop: 8 },
  btnFaceIDTxt: { fontSize: 15, color: '#111827', fontWeight: '500' },
});
