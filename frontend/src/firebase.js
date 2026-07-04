// firebase.js — Firebase initialization and auth helpers
import { initializeApp, getApps, getApp } from "firebase/app";
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

// Use existing app if already initialized (safe for Vite HMR)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Force browser language for auth UI messages
auth.useDeviceLanguage();

// Google provider — always show account picker
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// ─── Auth Helpers ─────────────────────────────────────────────────────────────

export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signUpWithEmail(email, password, displayName) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName && displayName.trim()) {
    await updateProfile(credential.user, { displayName: displayName.trim() });
    // Force token refresh so displayName is available immediately
    await credential.user.reload();
  }
  return credential;
}

export function signOutUser() {
  return signOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}
