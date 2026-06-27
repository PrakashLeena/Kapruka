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
const _onEndCallbacks = new Set();

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

// ── Current language mode (set by useVoice or ChatMessage before speaking) ─────
// 'english' | 'tamil' | 'sinhala'
let _currentLang = "english";

/**
 * Pick the best available TTS voice for the given language.
 *
 * Priority per language:
 *   tamil   → ta-LK › ta-IN › any "tamil" › en-IN › en-GB › en fallback
 *   sinhala → si-LK › any "sinhala" › en-IN › en-GB › en fallback
 *   english → en-LK › en-IN › Google UK Female › Google US › en fallback
 *
 * @param {'english'|'tamil'|'sinhala'} [lang]
 * @returns {SpeechSynthesisVoice | null}
 */
function _pickVoice(lang = _currentLang) {
  if (!synth) return null;
  const voices = synth.getVoices();
  if (!voices.length) return null;

  const find = (test) => voices.find(test) || null;

  if (lang === "tamil") {
    // 1. Native Tamil Sri Lanka
    const v = find((v) => v.lang === "ta-LK")
      // 2. Native Tamil India
      || find((v) => v.lang === "ta-IN")
      // 3. Any Tamil locale
      || find((v) => v.lang.startsWith("ta"))
      // 4. Voice whose name contains "Tamil"
      || find((v) => v.name.toLowerCase().includes("tamil"))
      // 5. Indian English (South Indian accent – close to Tamil tone)
      || find((v) => v.lang === "en-IN")
      || find((v) => v.lang.startsWith("en-IN"))
      || find((v) => v.name.toLowerCase().includes("india"))
      // 6. Any English
      || find((v) => v.lang.startsWith("en"))
      || voices[0];
    console.log("[SpeechPlayer] Tamil voice selected:", v?.name, v?.lang);
    return v;
  }

  if (lang === "sinhala") {
    // 1. Native Sinhala Sri Lanka
    const v = find((v) => v.lang === "si-LK")
      // 2. Any Sinhala locale
      || find((v) => v.lang.startsWith("si"))
      // 3. Voice whose name contains "Sinhala" or "Sinhalese"
      || find((v) => v.name.toLowerCase().includes("sinhala") || v.name.toLowerCase().includes("sinhal"))
      // 4. Sri Lankan English
      || find((v) => v.lang === "en-LK")
      // 5. Indian English (closest regional accent available in most browsers)
      || find((v) => v.lang === "en-IN")
      || find((v) => v.name.toLowerCase().includes("india"))
      // 6. Any English
      || find((v) => v.lang.startsWith("en"))
      || voices[0];
    console.log("[SpeechPlayer] Sinhala voice selected:", v?.name, v?.lang);
    return v;
  }

  // ── English (default) ──────────────────────────────────────────────────────
  const v = find((v) => v.lang === "en-LK")
    || find((v) => v.lang === "en-IN")
    || find((v) => v.name === "Google UK English Female")
    || find((v) => v.name === "Google US English")
    || find((v) => v.name === "Microsoft Zira - English (United States)")
    || find((v) => v.name === "Microsoft David - English (United States)")
    || find((v) => v.lang.startsWith("en"))
    || voices[0];
  console.log("[SpeechPlayer] English voice selected:", v?.name, v?.lang);
  return v;
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
   * @returns {() => void} unsubscribe function
   */
  onEnd(fn) {
    _onEndCallbacks.add(fn);
    return () => {
      _onEndCallbacks.delete(fn);
    };
  },

  /**
   * Set the active language for voice selection.
   * Call this before speak() when you know the language of the content.
   * @param {'english'|'tamil'|'sinhala'} lang
   */
  setLanguage(lang) {
    if (["english", "tamil", "sinhala"].includes(lang)) {
      _currentLang = lang;
    }
  },

  /**
   * Get the currently active language.
   * @returns {'english'|'tamil'|'sinhala'}
   */
  getLanguage() {
    return _currentLang;
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
      _onEndCallbacks.forEach((fn) => {
        try { fn(); } catch (e) { console.error(e); }
      });
    };

    utterance.onerror = (event) => {
      // "interrupted" fires when we call cancel() — not a real error
      if (event.error === "interrupted" || event.error === "canceled") return;
      console.warn("[SpeechPlayer] utterance error:", event.error);
      _onEndCallbacks.forEach((fn) => {
        try { fn(); } catch (e) { console.error(e); }
      });
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
      // Ensure all subscribers are notified that speech stopped
      _onEndCallbacks.forEach((fn) => {
        try { fn(); } catch (e) { console.error(e); }
      });
    }
  },
};
