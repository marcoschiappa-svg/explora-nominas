import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyA_cmSLuKPVYXjgQu75varhmEBkaY0uwss",
  authDomain: "explora-portal.firebaseapp.com",
  projectId: "explora-portal",
  storageBucket: "explora-portal.firebasestorage.app",
  messagingSenderId: "871895783017",
  appId: "1:871895783017:web:9503299046accde84774f8"
};

const app      = initializeApp(firebaseConfig);
export const auth     = getAuth(app);
export const db       = getFirestore(app);
export const provider = new GoogleAuthProvider();

provider.setCustomParameters({
  hd: 'explora.com.ar'
});

export async function loginConGoogle() {
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function logout() {
  await signOut(auth);
}