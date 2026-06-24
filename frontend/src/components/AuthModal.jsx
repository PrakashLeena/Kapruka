import { useState } from "react";
import {
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
} from "../firebase.js";

export default function AuthModal({ isOpen, onClose }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  function resetForm() {
    setEmail("");
    setPassword("");
    setDisplayName("");
    setError("");
    setLoading(false);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function switchMode(newMode) {
    setMode(newMode);
    setError("");
  }

  async function handleEmailSubmit(e) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError("");
    try {
      if (mode === "login") {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password, displayName);
      }
      handleClose();
    } catch (err) {
      setError(friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setLoading(true);
    setError("");
    try {
      await signInWithGoogle();
      handleClose();
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        setError(friendlyError(err.code));
      }
    } finally {
      setLoading(false);
    }
  }

  function friendlyError(code) {
    switch (code) {
      case "auth/invalid-email": return "Please enter a valid email address.";
      case "auth/user-not-found": return "No account found with this email.";
      case "auth/wrong-password": return "Incorrect password. Please try again.";
      case "auth/email-already-in-use": return "An account with this email already exists.";
      case "auth/weak-password": return "Password should be at least 6 characters.";
      case "auth/too-many-requests": return "Too many attempts. Please try again later.";
      case "auth/invalid-credential": return "Invalid email or password. Please try again.";
      default: return "Something went wrong. Please try again.";
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-charcoal/50 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={handleClose}
      >
        {/* Modal Card */}
        <div
          className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="bg-teal px-6 pt-8 pb-6 text-white text-center relative">
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-teal-light transition-colors"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div className="w-14 h-14 bg-terracotta rounded-full flex items-center justify-center mx-auto mb-3 font-display font-bold text-2xl shadow-lg">
              K
            </div>
            <h2 className="font-display text-xl font-bold">
              {mode === "login" ? "Welcome back!" : "Create account"}
            </h2>
            <p className="text-teal-50/70 text-xs mt-1">
              {mode === "login"
                ? "Sign in to access your personalized shopping history"
                : "Join Kapu and save your shopping conversations"}
            </p>
          </div>

          {/* Modal Body */}
          <div className="p-6 flex flex-col gap-4">
            {/* Tab Switch */}
            <div className="flex bg-cream-100 rounded-xl p-1 gap-1">
              <button
                onClick={() => switchMode("login")}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                  mode === "login"
                    ? "bg-white text-teal shadow-sm"
                    : "text-charcoal/60 hover:text-charcoal"
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => switchMode("signup")}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                  mode === "signup"
                    ? "bg-white text-teal shadow-sm"
                    : "text-charcoal/60 hover:text-charcoal"
                }`}
              >
                Sign Up
              </button>
            </div>

            {/* Google Sign-In Button */}
            <button
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 border border-cream-200 rounded-xl py-2.5 text-sm font-medium text-charcoal hover:bg-cream-50 transition-colors disabled:opacity-50"
            >
              {/* Google icon SVG */}
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                <path fill="none" d="M0 0h48v48H0z"/>
              </svg>
              Continue with Google
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-cream-200" />
              <span className="text-[11px] text-charcoal/40 font-medium">or with email</span>
              <div className="flex-1 border-t border-cream-200" />
            </div>

            {/* Email/Password Form */}
            <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3">
              {mode === "signup" && (
                <input
                  type="text"
                  placeholder="Your name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full border border-cream-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal/30 placeholder-charcoal/30"
                />
              )}
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full border border-cream-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal/30 placeholder-charcoal/30"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full border border-cream-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal/30 placeholder-charcoal/30"
              />

              {/* Error message */}
              {error && (
                <div className="bg-red-50 border border-red-100 text-red-600 text-xs px-3 py-2 rounded-lg">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !email || !password}
                className="w-full bg-terracotta hover:bg-terracotta-dark disabled:bg-cream-200 disabled:text-charcoal/40 text-white font-semibold py-3 rounded-xl transition-all text-sm shadow-md hover:shadow flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : mode === "login" ? (
                  "Sign In"
                ) : (
                  "Create Account"
                )}
              </button>
            </form>

            <p className="text-center text-[11px] text-charcoal/40">
              Your data is secured by Firebase Authentication
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
