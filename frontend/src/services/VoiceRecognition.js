/**
 * VoiceRecognition.js
 *
 * REPLACED: Browser Web Speech API → MediaRecorder + Azure Speech-to-Text
 *
 * Why: Chrome's Web Speech API does NOT support Sinhala (si-LK) at all.
 * Azure Cognitive Services STT natively supports si-LK, ta-LK, and en-US.
 *
 * How it works:
 *  1. getUserMedia() captures microphone audio
 *  2. MediaRecorder records to webm/opus chunks
 *  3. Silence detection auto-stops after ~2s of quiet (or 10s max)
 *  4. Audio blob is POST-ed to /api/speech/transcribe with language param
 *  5. Backend calls Azure STT → returns transcript
 *  6. onResult callback fires with the text
 *
 * Public interface is IDENTICAL to the old Web Speech API version —
 * no changes needed in useVoice.js or any component.
 *
 *   VoiceRecognitionService.isSupported()  → boolean
 *   VoiceRecognitionService.start()        → void
 *   VoiceRecognitionService.stop()         → void
 *   VoiceRecognitionService.setLanguage(lang) → void
 *   VoiceRecognitionService.getLanguage()  → string (BCP-47)
 *   VoiceRecognitionService.onResult(fn)   → void — fn(transcript: string)
 *   VoiceRecognitionService.onError(fn)    → void — fn(errorMessage: string)
 *   VoiceRecognitionService.onEnd(fn)      → void — fn()
 */

// ── Backend URL (same pattern as SpeechPlayer.js) ─────────────────────────────
const BACKEND_URL = (
  import.meta.env.VITE_BACKEND_URL !== undefined && import.meta.env.VITE_BACKEND_URL !== ""
    ? import.meta.env.VITE_BACKEND_URL
    : (import.meta.env.DEV ? "http://localhost:3000" : "")
).replace(/\/$/, "");

// ── Language → BCP-47 locale for Azure STT ───────────────────────────────────
// Azure natively supports all three. si-LK works properly here!
const LANG_MAP = {
  sinhala: "si-LK",
  tamil:   "ta-LK",
  english: "en-US",
};

// ── State ─────────────────────────────────────────────────────────────────────
let _lang = "si-LK";                // current Azure STT locale
let _mediaRecorder  = null;
let _audioChunks    = [];
let _stream         = null;
let _audioCtx       = null;
let _autoStopTimer  = null;
let _silenceTimer   = null;
let _isAborted      = false;        // true when stop() is called before onstop

// ── Callbacks ─────────────────────────────────────────────────────────────────
let _onResultCallback = null;
let _onErrorCallback  = null;
let _onEndCallback    = null;

// ── Silence detection config ──────────────────────────────────────────────────
const SILENCE_THRESHOLD_DB  = 18;   // amplitude avg below this → silence
const SILENCE_DURATION_MS   = 2000; // ms of silence before auto-stop
const MAX_RECORDING_MS       = 10000; // hard cap — auto-stop after 10 s

// ── Internal helpers ──────────────────────────────────────────────────────────

function _stopStream() {
  if (_stream) {
    _stream.getTracks().forEach((t) => t.stop());
    _stream = null;
  }
  if (_audioCtx) {
    try { _audioCtx.close(); } catch (_) {}
    _audioCtx = null;
  }
}

function _clearTimers() {
  clearTimeout(_autoStopTimer);
  clearTimeout(_silenceTimer);
  _autoStopTimer = null;
  _silenceTimer  = null;
}

/**
 * Set up silence detection using Web Audio API AnalyserNode.
 * When the mic goes quiet for SILENCE_DURATION_MS, auto-stop.
 */
function _startSilenceDetection(stream) {
  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source   = _audioCtx.createMediaStreamSource(stream);
    const analyser = _audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArr = new Uint8Array(analyser.frequencyBinCount);
    let silenceStart = null;

    const check = () => {
      if (!_mediaRecorder || _mediaRecorder.state !== "recording") return;

      analyser.getByteFrequencyData(dataArr);
      const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length;

      if (avg < SILENCE_THRESHOLD_DB) {
        if (!silenceStart) {
          silenceStart = Date.now();
        } else if (Date.now() - silenceStart >= SILENCE_DURATION_MS) {
          // Silence long enough — auto stop
          console.log("[VoiceRecognition] Silence detected — auto stopping");
          if (_mediaRecorder && _mediaRecorder.state === "recording") {
            _mediaRecorder.stop();
          }
          return;
        }
      } else {
        silenceStart = null; // speech resumed — reset timer
      }

      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  } catch (err) {
    // Silence detection is non-critical — log and continue without it
    console.warn("[VoiceRecognition] Silence detection unavailable:", err.message);
  }
}

/**
 * Send recorded audio to backend /api/speech/transcribe → Azure STT.
 */
async function _transcribeAndFire(blob, mimeType) {
  if (!blob || blob.size < 500) {
    if (_onErrorCallback) _onErrorCallback("No speech detected. Please try again.");
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/speech/transcribe?language=${_lang}`, {
      method: "POST",
      headers: { "Content-Type": mimeType },
      body: blob,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const { transcript } = await res.json();
    console.log(`[VoiceRecognition] Transcript (${_lang}): "${transcript}"`);

    if (transcript && transcript.trim()) {
      if (_onResultCallback) _onResultCallback(transcript.trim());
    } else {
      if (_onErrorCallback) _onErrorCallback("No speech detected. Please speak clearly and try again.");
    }
  } catch (err) {
    console.error("[VoiceRecognition] Transcription error:", err.message);
    if (_onErrorCallback) _onErrorCallback(`Speech recognition failed: ${err.message}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const VoiceRecognitionService = {
  /**
   * Returns true if MediaRecorder + getUserMedia are available.
   * Both Chrome and Firefox support this; Safari 14.1+ also supports it.
   */
  isSupported() {
    return !!(
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia &&
      typeof MediaRecorder !== "undefined"
    );
  },

  /**
   * Set the recognition language before calling start().
   * Accepts app language keys ('sinhala' | 'tamil' | 'english')
   * OR raw BCP-47 strings ('si-LK', 'ta-LK', 'en-US').
   */
  setLanguage(lang) {
    _lang = LANG_MAP[lang] || lang || "si-LK";
    console.log("[VoiceRecognition] Language set to:", _lang);
  },

  getLanguage() {
    return _lang;
  },

  onResult(fn) { _onResultCallback = fn; },
  onError(fn)  { _onErrorCallback  = fn; },
  onEnd(fn)    { _onEndCallback    = fn; },

  /**
   * Start recording from the microphone.
   * Builds a fresh MediaRecorder each call.
   */
  async start() {
    if (!this.isSupported()) {
      if (_onErrorCallback) {
        _onErrorCallback("Voice input is not supported in this browser. Please use Chrome or Edge.");
      }
      return;
    }

    // Reset state
    _audioChunks = [];
    _isAborted   = false;
    _clearTimers();

    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,      // Azure STT works best at 16 kHz
        },
      });
    } catch (err) {
      let msg = "Microphone error. Please try again.";
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        msg = "Microphone access was denied. Please allow microphone access and try again.";
      } else if (err.name === "NotFoundError") {
        msg = "No microphone found. Please connect a microphone and try again.";
      }
      if (_onErrorCallback) _onErrorCallback(msg);
      return;
    }

    // Pick the best supported MIME type
    const mimeType =
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" :
      MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")  ? "audio/ogg;codecs=opus"  :
      MediaRecorder.isTypeSupported("audio/webm")             ? "audio/webm"             :
      "";

    try {
      _mediaRecorder = new MediaRecorder(
        _stream,
        mimeType ? { mimeType } : {}
      );
    } catch (err) {
      _stopStream();
      if (_onErrorCallback) _onErrorCallback(`Could not start recording: ${err.message}`);
      return;
    }

    const effectiveMimeType = _mediaRecorder.mimeType || mimeType || "audio/webm";

    _mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) _audioChunks.push(e.data);
    };

    _mediaRecorder.onstop = async () => {
      _clearTimers();
      _stopStream();

      // If user manually cancelled, don't fire callbacks or transcribe
      if (_isAborted) return;

      // Recording ended naturally (silence / max time) — signal UI
      // useVoice transitions listening → thinking while Azure STT processes
      if (_onEndCallback) _onEndCallback();

      const blob = new Blob(_audioChunks, { type: effectiveMimeType });
      _audioChunks = [];

      await _transcribeAndFire(blob, effectiveMimeType);
    };

    _mediaRecorder.onerror = (e) => {
      console.error("[VoiceRecognition] MediaRecorder error:", e.error);
      _clearTimers();
      _stopStream();
      if (_onErrorCallback) _onErrorCallback(`Recording error: ${e.error?.message || "unknown"}`);
    };

    // Start recording — collect data every 250 ms so we have chunks on stop
    _mediaRecorder.start(250);

    // Start silence detection (auto-stops when user goes quiet)
    _startSilenceDetection(_stream);

    // Hard limit — stop after MAX_RECORDING_MS regardless
    _autoStopTimer = setTimeout(() => {
      if (_mediaRecorder && _mediaRecorder.state === "recording") {
        console.log("[VoiceRecognition] Max recording time reached — auto stopping");
        _mediaRecorder.stop();
      }
    }, MAX_RECORDING_MS);

    console.log(`[VoiceRecognition] Recording started (lang=${_lang}, mimeType=${effectiveMimeType})`);
  },

  /**
   * Stop recording immediately (user-initiated cancel).
   * Sets _isAborted so onstop skips transcription.
   */
  stop() {
    _isAborted = true;
    _clearTimers();
    if (_mediaRecorder && _mediaRecorder.state === "recording") {
      _mediaRecorder.stop();
    }
    _stopStream();
  },
};
