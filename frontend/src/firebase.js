// firebase.js — Firebase initialization and auth helpers
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
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
  apiKey: "AIzaSyDVVjLgVJRxcCzGEAc20lqT3sMtwqGdKBY",
  authDomain: "kapruka-5b90a.firebaseapp.com",
  projectId: "kapruka-5b90a",
  storageBucket: "kapruka-5b90a.firebasestorage.app",
  messagingSenderId: "943317842783",
  appId: "1:943317842783:web:8759e1ce5739805a21d4ea",
  measurementId: "G-5PJCEY9C3R"
};

// Use existing app if already initialized (safe for Vite HMR)
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const analytics = getAnalytics(app);
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
