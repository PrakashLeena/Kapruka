/**
 * VoiceRecognition.js
 *
 * Abstraction layer over the browser's Web Speech API (SpeechRecognition).
 *
 * Interface:
 *   VoiceRecognitionService.isSupported()  → boolean
 *   VoiceRecognitionService.start()        → void
 *   VoiceRecognitionService.stop()         → void
 *   VoiceRecognitionService.onResult(fn)   → void  — fn(transcript: string)
 *   VoiceRecognitionService.onError(fn)    → void  — fn(errorMessage: string)
 *   VoiceRecognitionService.onEnd(fn)      → void  — fn()
 *
 * Future migration:
 *   To swap in Whisper / Deepgram / Azure Speech, create a new file that
 *   implements the exact same interface above and import it instead of this
 *   file in useVoice.js. No hook or component code needs to change.
 */

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

let _recognition = null;

// ── Callback registry ──────────────────────────────────────────────────────────
let _onResultCallback = null;
let _onErrorCallback = null;
let _onEndCallback = null;

function _buildRecognition() {
  if (!SpeechRecognition) return null;

  const rec = new SpeechRecognition();
  rec.lang = "en-US";
  rec.continuous = false;       // auto-stop after one utterance
  rec.interimResults = false;   // only fire when confidence is final
  rec.maxAlternatives = 1;

  rec.onresult = (event) => {
    const transcript = event.results[0][0].transcript.trim();
    if (transcript && _onResultCallback) {
      _onResultCallback(transcript);
    }
  };

  rec.onerror = (event) => {
    let message = "Speech recognition error.";
    switch (event.error) {
      case "not-allowed":
      case "permission-denied":
        message = "Microphone access was denied. Please allow microphone access and try again.";
        break;
      case "no-speech":
        message = "No speech detected. Please try again.";
        break;
      case "network":
        message = "Network error during speech recognition. Please check your connection.";
        break;
      case "aborted":
        // User-initiated stop — not an error to surface
        return;
      default:
        message = `Speech recognition error: ${event.error}`;
    }
    if (_onErrorCallback) _onErrorCallback(message);
  };

  rec.onend = () => {
    if (_onEndCallback) _onEndCallback();
  };

  return rec;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const VoiceRecognitionService = {
  /**
   * Returns true if the current browser supports the Web Speech API.
   */
  isSupported() {
    return SpeechRecognition !== null;
  },

  /**
   * Register a callback that fires when the final transcript is ready.
   * @param {(transcript: string) => void} fn
   */
  onResult(fn) {
    _onResultCallback = fn;
  },

  /**
   * Register a callback that fires on a recoverable error.
   * @param {(errorMessage: string) => void} fn
   */
  onError(fn) {
    _onErrorCallback = fn;
  },

  /**
   * Register a callback that fires when recognition ends (success or failure).
   * @param {() => void} fn
   */
  onEnd(fn) {
    _onEndCallback = fn;
  },

  /**
   * Start listening. Builds a fresh SpeechRecognition instance each time
   * to avoid the Chrome bug where a stopped instance cannot be restarted.
   */
  start() {
    if (!SpeechRecognition) {
      if (_onErrorCallback) {
        _onErrorCallback("Voice input is not supported in this browser. Please use Chrome or Edge.");
      }
      return;
    }
    // Always build a fresh instance — Chrome throws InvalidStateError on restart
    _recognition = _buildRecognition();
    try {
      _recognition.start();
    } catch (err) {
      // Already started — ignore
      console.warn("[VoiceRecognition] start() called while already running:", err);
    }
  },

  /**
   * Stop listening immediately (user-initiated cancel).
   */
  stop() {
    if (_recognition) {
      try {
        _recognition.abort(); // abort fires onend without onerror
      } catch (_) {
        // ignore
      }
      _recognition = null;
    }
  },
};
