/**
 * SpeechPlayer.js
 *
 * Abstraction layer over the browser's SpeechSynthesis API (Text-To-Speech).
 *
 * Interface:
 *   SpeechPlayerService.speak(text)    → void
 *   SpeechPlayerService.stop()         → void
 *   SpeechPlayerService.isSpeaking()   → boolean
 *   SpeechPlayerService.onEnd(fn)      → void  — fn()
 *   SpeechPlayerService.isSupported()  → boolean
 *
 * Future migration:
 *   To swap in ElevenLabs / Kokoro TTS / Azure TTS, create a new file that
 *   implements the exact same interface above and import it instead of this
 *   file in useVoice.js. No hook or component code needs to change.
 */

const synth = window.speechSynthesis || null;

// ── Callback registry ──────────────────────────────────────────────────────────
let _onEndCallback = null;

/**
 * Strip markdown formatting characters so the TTS doesn't read them aloud.
 * e.g. "**Bold text**" → "Bold text"
 * @param {string} text
 * @returns {string}
 */
function _stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")      // **bold**
    .replace(/\*(.+?)\*/g, "$1")           // *italic*
    .replace(/#{1,6}\s+/g, "")             // # headings
    .replace(/`{1,3}[^`]*`{1,3}/g, "")    // `code` / ```blocks```
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")   // [link text](url)
    .replace(/^\s*[-*+]\s+/gm, "")        // - bullet points
    .replace(/^\s*\d+\.\s+/gm, "")        // 1. numbered lists
    .replace(/_{2}(.+?)_{2}/g, "$1")      // __bold__
    .replace(/_(.+?)_/g, "$1")            // _italic_
    .replace(/>\s+/g, "")                 // > blockquotes
    .replace(/\n{2,}/g, ". ")             // double newlines → pause
    .replace(/\n/g, " ")                  // remaining newlines → space
    .trim();
}

/**
 * Pick the best available English voice. Prefers a natural-sounding voice.
 * Falls back to whatever the browser provides.
 * @returns {SpeechSynthesisVoice | null}
 */
function _pickVoice() {
  if (!synth) return null;
  const voices = synth.getVoices();
  const preferred = [
    "Google UK English Female",
    "Google US English",
    "Microsoft Zira - English (United States)",
    "Microsoft David - English (United States)",
  ];
  for (const name of preferred) {
    const v = voices.find((v) => v.name === name);
    if (v) return v;
  }
  // Fallback: first English voice
  return voices.find((v) => v.lang.startsWith("en")) || voices[0] || null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const SpeechPlayerService = {
  /**
   * Returns true if the current browser supports SpeechSynthesis.
   */
  isSupported() {
    return synth !== null;
  },

  /**
   * Register a callback that fires when speech finishes (natural end or stop()).
   * @param {() => void} fn
   */
  onEnd(fn) {
    _onEndCallback = fn;
  },

  /**
   * Returns true if the browser is currently speaking.
   */
  isSpeaking() {
    return synth ? synth.speaking : false;
  },

  /**
   * Speak the given text aloud. Cancels any current speech first.
   * @param {string} text
   */
  speak(text) {
    if (!synth) return;

    // Cancel any in-progress speech before starting new
    synth.cancel();

    const cleanText = _stripMarkdown(text);
    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;   // natural speed
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Voices may not be loaded yet on first call — re-attempt after voices load
    const voice = _pickVoice();
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
      if (_onEndCallback) _onEndCallback();
    };

    utterance.onerror = (event) => {
      // "interrupted" fires when we call cancel() — not a real error
      if (event.error === "interrupted" || event.error === "canceled") return;
      console.warn("[SpeechPlayer] utterance error:", event.error);
      if (_onEndCallback) _onEndCallback();
    };

    // Chrome bug: speech gets stuck after ~15s — resuming first mitigates it
    synth.resume();
    synth.speak(utterance);
  },

  /**
   * Stop speaking immediately.
   */
  stop() {
    if (synth) {
      synth.cancel();
    }
  },
};
