/**
 * VoiceButton.jsx
 *
 * Microphone button with four visual states matching the voice lifecycle:
 *
 *   idle      → grey mic icon — click to start listening
 *   listening → pulsing red mic icon + VoiceAnimation rings — click to cancel
 *   thinking  → teal spinning indicator — no click (disabled while backend responds)
 *   speaking  → teal waveform VoiceAnimation — click to stop TTS
 *
 * Props:
 *   voiceState    — 'idle'|'listening'|'thinking'|'speaking'
 *   onStart       — () => void  called when mic should start
 *   onStop        — () => void  called when user cancels
 *   disabled      — boolean    true while backend request is loading (text path)
 *   error         — string|null
 *   onClearError  — () => void
 *   isSupported   — boolean    false = show unsupported message instead of button
 */

import VoiceAnimation from "./VoiceAnimation.jsx";

const LABELS = {
  idle: "Start voice input",
  listening: "Stop listening",
  thinking: "Processing…",
  speaking: "Stop speaking",
};

export default function VoiceButton({
  voiceState,
  onStart,
  onStop,
  disabled,
  error,
  onClearError,
  isSupported,
}) {
  // ── Browser not supported ─────────────────────────────────────────────────────
  if (!isSupported) {
    return (
      <div className="relative flex items-center">
        <button
          type="button"
          disabled
          title="Voice input is not supported in this browser. Please use Chrome or Edge."
          className="w-10 h-10 shrink-0 rounded-full bg-cream-200 text-charcoal/30 flex items-center justify-center cursor-not-allowed"
          aria-label="Voice input not supported"
        >
          <MicIcon muted />
        </button>
      </div>
    );
  }

  // ── Determine click handler ───────────────────────────────────────────────────
  function handleClick() {
    if (error) onClearError();
    if (voiceState === "idle") {
      onStart();
    } else if (voiceState === "listening" || voiceState === "speaking") {
      onStop();
    }
    // voiceState === "thinking" → button is disabled, no click
  }

  const isDisabled = disabled && voiceState === "idle";
  const isThinking = voiceState === "thinking";

  // ── Button colour classes per state ──────────────────────────────────────────
  const btnClass = {
    idle: "bg-cream-200 hover:bg-cream-300 text-charcoal/60 hover:text-charcoal",
    listening: "bg-red-500 hover:bg-red-600 text-white voice-btn-listening",
    thinking: "bg-teal/20 text-teal cursor-not-allowed",
    speaking: "bg-teal hover:bg-teal-light text-white",
  }[voiceState];

  return (
    <div className="relative flex items-center">
      {/* Listening / Speaking animation shown outside the button */}
      {(voiceState === "listening" || voiceState === "speaking") && (
        <VoiceAnimation state={voiceState} />
      )}

      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled || isThinking}
        title={LABELS[voiceState]}
        aria-label={LABELS[voiceState]}
        aria-pressed={voiceState === "listening"}
        className={`relative w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-all duration-200 ${btnClass}`}
      >
        {isThinking ? (
          /* Spinner while waiting for backend response */
          <svg
            className="animate-spin w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" />
          </svg>
        ) : (
          <MicIcon muted={false} />
        )}
      </button>

      {/* Error tooltip */}
      {error && (
        <div
          role="alert"
          className="absolute bottom-12 left-1/2 -translate-x-1/2 w-64 bg-red-600 text-white text-xs rounded-xl px-3 py-2 shadow-lg z-50 text-center"
        >
          {error}
          <button
            type="button"
            onClick={onClearError}
            className="block mx-auto mt-1 underline text-white/80 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// ── Inline SVG mic icon ───────────────────────────────────────────────────────
function MicIcon({ muted }) {
  if (muted) {
    // Mic with a diagonal slash (unsupported state)
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}
