// firebase.js — Firebase initialization and auth helpers
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAfvmHh7Xh4iTY9-5UP4qYLw0RxINyj2ns",
  authDomain: "kapruka-12737.firebaseapp.com",
  projectId: "kapruka-12737",
  storageBucket: "kapruka-12737.firebasestorage.app",
  messagingSenderId: "469498840773",
  appId: "1:469498840773:web:e4ecf15f71b4d50f83d2ac",
  measurementId: "G-ZDZCSMWGHS",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// ─── Auth Helpers ─────────────────────────────────────────────────────────────

export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUpWithEmail(email, password, displayName) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    await updateProfile(credential.user, { displayName });
  }
  return credential;
}

export function signOutUser() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}
