import { useState } from "react";
import { signInWithGoogle, signInWithEmail, signUpWithEmail } from "../firebase.js";
import kaprukaLogo from "../send-online-logo.png";

export default function AuthModal({ isOpen, onClose }) {
  const [mode, setMode] = useState("login"); // "login" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (!isOpen) return null;

  function resetForm() {
    setEmail("");
    setPassword("");
    setDisplayName("");
    setError("");
    setLoading(false);
    setShowPassword(false);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function switchMode(newMode) {
    setMode(newMode);
    setError("");
  }

  function friendlyError(code) {
    const map = {
      "auth/invalid-email":          "Please enter a valid email address.",
      "auth/user-not-found":         "No account found with this email.",
      "auth/wrong-password":         "Incorrect password. Please try again.",
      "auth/invalid-credential":     "Invalid email or password. Please try again.",
      "auth/email-already-in-use":   "An account with this email already exists. Try signing in instead.",
      "auth/weak-password":          "Password must be at least 6 characters.",
      "auth/too-many-requests":      "Too many attempts. Please wait a moment and try again.",
      "auth/operation-not-allowed":  "This sign-in method is disabled. Please enable it in Firebase Console → Authentication → Sign-in methods.",
      "auth/network-request-failed": "Network error. Please check your internet connection.",
      "auth/popup-blocked":          "Popup was blocked. Please allow popups for this site and try again.",
      "auth/popup-closed-by-user":   "Sign-in was cancelled. Please try again.",
      "auth/cancelled-popup-request":"Sign-in was cancelled. Please try again.",
      "auth/internal-error":         "Firebase internal error. Please try again.",
    };
    return map[code] ?? `Error: ${code || "unknown"}. Check the browser console for details.`;
  }

  async function handleEmailSubmit(e) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setError("");

    try {
      if (mode === "login") {
        await signInWithEmail(email.trim(), password);
      } else {
        await signUpWithEmail(email.trim(), password, displayName.trim());
      }
      handleClose();
    } catch (err) {
      console.error("[Auth] Email auth error →", err.code, err.message);
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
      console.error("[Auth] Google sign-in error →", err.code, err.message);
      const ignoreErrors = ["auth/popup-closed-by-user", "auth/cancelled-popup-request"];
      if (!ignoreErrors.includes(err.code)) {
        setError(friendlyError(err.code));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-charcoal/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "login" ? "Sign In" : "Sign Up"}
      >
        {/* ── Header ── */}
        <div className="bg-teal px-6 pt-8 pb-6 text-white text-center relative">
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Close dialog"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          <div className="w-14 h-14 bg-white rounded-full overflow-hidden flex items-center justify-center mx-auto mb-3 shadow-lg">
            <img src={kaprukaLogo} alt="Kapruka Logo" className="w-full h-full object-cover" />
          </div>
          <h2 className="font-display text-xl font-bold">
            {mode === "login" ? "Welcome back!" : "Create account"}
          </h2>
          <p className="text-white/60 text-xs mt-1">
            {mode === "login"
              ? "Sign in to access your personalised shopping history"
              : "Join Kapu and save your shopping conversations"}
          </p>
        </div>

        {/* ── Body ── */}
        <div className="p-6 flex flex-col gap-4">
          {/* Tab switcher */}
          <div className="flex bg-cream-100 rounded-xl p-1 gap-1">
            {["login", "signup"].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                  mode === m
                    ? "bg-white text-teal shadow-sm"
                    : "text-charcoal/60 hover:text-charcoal"
                }`}
              >
                {m === "login" ? "Sign In" : "Sign Up"}
              </button>
            ))}
          </div>

          {/* Google button */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 border border-cream-200 rounded-xl py-2.5 text-sm font-medium text-charcoal hover:bg-cream-50 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-cream-200" />
            <span className="text-[11px] text-charcoal/40 font-medium">or with email</span>
            <div className="flex-1 border-t border-cream-200" />
          </div>

          {/* Email/Password form */}
          <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3" noValidate>
            {mode === "signup" && (
              <input
                id="auth-name"
                type="text"
                placeholder="Your name (optional)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
                className="w-full border border-cream-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal/30 placeholder-charcoal/30"
              />
            )}

            <input
              id="auth-email"
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete={mode === "login" ? "email" : "new-email"}
              className="w-full border border-cream-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal/30 placeholder-charcoal/30"
            />

            <div className="relative">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                placeholder="Password (min 6 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="w-full border border-cream-200 rounded-xl px-4 py-2.5 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-teal/30 placeholder-charcoal/30"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-charcoal/40 hover:text-charcoal transition-colors p-0.5"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>

            {/* Error message */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2.5 rounded-xl leading-relaxed">
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim() || !password.trim()}
              className="w-full bg-terracotta hover:bg-terracotta-dark disabled:bg-cream-200 disabled:text-charcoal/40 text-white font-semibold py-3 rounded-xl transition-all text-sm shadow-md hover:shadow active:scale-[0.98] flex items-center justify-center gap-2 mt-1"
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

          <p className="text-center text-[10px] text-charcoal/30 leading-relaxed">
            Secured by Firebase Authentication
          </p>
        </div>
      </div>
    </div>
  );
}
