import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, Image, StyleSheet } from 'react-native';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from './src/config/firebase';
import LoginScreen from './src/screens/LoginScreen';
import ChoferScreen from './src/screens/ChoferScreen';

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const snap = await getDoc(doc(db, 'usuarios_portal', firebaseUser.uid));
        if (snap.exists() && snap.data().estado === 'activo') {
          setUsuario({ uid: firebaseUser.uid, email: firebaseUser.email, ...snap.data() });
        } else {
          await signOut(auth);
          setUsuario(null);
        }
      } else {
        setUsuario(null);
      }
      setCargando(false);
    });
    return () => unsub();
  }, []);

  async function handleLogout() {
    await signOut(auth);
    setUsuario(null);
  }

  if (cargando) {
    return (
      <View style={s.loading}>
        <Image source={require('./assets/icon.png')} style={s.logo} resizeMode="contain" />
        <ActivityIndicator color="#C8102E" style={{ marginTop: 20 }} />
      </View>
    );
  }

  if (!usuario) {
    return <LoginScreen onLogin={setUsuario} />;
  }

  if (usuario.rol === 'chofer' || usuario.rol === 'transportista') {
    return <ChoferScreen usuario={usuario} onLogout={handleLogout} />;
  }

  return (
    <View style={s.loading}>
      <Image source={require('./assets/icon.png')} style={s.logo} resizeMode="contain" />
      <ActivityIndicator color="#C8102E" style={{ marginTop: 20 }} />
    </View>
  );
}

const s = StyleSheet.create({
  loading: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  logo: { width: 80, height: 80 },
});
