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
 *  2. MediaRecorder records to webm/opus chunks (Chrome) or ogg/opus (Firefox)
 *  3. Silence detection auto-stops after language-appropriate quiet window
 *  4. Audio blob is CONVERTED to 16-bit PCM WAV using AudioContext — this is
 *     critical because Azure STT REST API does NOT accept audio/webm;codecs=opus
 *     (Chrome's native format). WAV/PCM is universally accepted by Azure.
 *  5. WAV blob is POST-ed to /api/speech/transcribe with language param
 *  6. Backend calls Azure STT → returns transcript
 *  7. onResult callback fires with the text
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
// Threshold: Web Audio getByteFrequencyData() returns 0–255 per frequency bin.
// 18 was too aggressive — it would trigger on normal breathing pauses in
// Sinhala/Tamil where inter-word silences are naturally longer than in English.
const SILENCE_THRESHOLD_DB  = 25;   // amplitude avg below this → silence

// Language-aware silence windows: Sinhala/Tamil speakers have longer natural
// pauses between words/phrases than English speakers.
const SILENCE_DURATION_MS_EN  = 2500; // ms of silence for English
const SILENCE_DURATION_MS_LK  = 3000; // ms of silence for Sinhala / Tamil
const MAX_RECORDING_MS        = 15000; // hard cap — auto-stop after 15 s

// ── Language-specific user-facing error messages ──────────────────────────────
const NO_SPEECH_MSG = {
  "si-LK": "කතාව හඳුනාගත නොහැකි විය. කරුණාකර නැවත උත්සාහ කරන්න.",   // Sinhala
  "ta-LK": "பேச்சு புரியவில்லை. மீண்டும் முயற்சிக்கவும்.",             // Tamil
  "en-US": "No speech detected. Please speak clearly and try again.",
};

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
 * When the mic goes quiet for the language-appropriate window, auto-stop.
 *
 * English  → 2.5 s  (faster speech, shorter pauses)
 * Sinhala  → 3.0 s  (longer natural inter-word pauses)
 * Tamil    → 3.0 s  (longer vowel stretches in Tamil speech)
 */
function _startSilenceDetection(stream) {
  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source   = _audioCtx.createMediaStreamSource(stream);
    const analyser = _audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    // Pick silence duration based on active language
    const isLK = _lang === "si-LK" || _lang === "ta-LK";
    const silenceDuration = isLK ? SILENCE_DURATION_MS_LK : SILENCE_DURATION_MS_EN;
    console.log(`[VoiceRecognition] Silence window: ${silenceDuration}ms (lang=${_lang})`);

    const dataArr = new Uint8Array(analyser.frequencyBinCount);
    let silenceStart = null;

    const check = () => {
      if (!_mediaRecorder || _mediaRecorder.state !== "recording") return;

      analyser.getByteFrequencyData(dataArr);
      const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length;

      if (avg < SILENCE_THRESHOLD_DB) {
        if (!silenceStart) {
          silenceStart = Date.now();
        } else if (Date.now() - silenceStart >= silenceDuration) {
          // Sustained silence long enough — auto stop
          console.log(`[VoiceRecognition] Silence detected (avg=${avg.toFixed(1)}) — auto stopping`);
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

// ── Audio format conversion ───────────────────────────────────────────────────

/**
 * Convert any browser-recorded audio blob to 16-bit PCM WAV at 16 kHz mono.
 *
 * CRITICAL FIX: Azure STT REST API officially supports audio/wav (PCM) and
 * audio/ogg;codecs=opus, but does NOT accept audio/webm;codecs=opus — which
 * is the format Chrome's MediaRecorder uses by default. Sending webm to Azure
 * results in an empty transcript or a silent failure.
 *
 * We use AudioContext.decodeAudioData() which CAN decode webm/opus, ogg/opus,
 * etc. natively in the browser, then re-encode to standard 16-bit PCM WAV.
 *
 * @param {Blob} blob  — raw audio from MediaRecorder (any format)
 * @returns {Promise<Blob>}  — audio/wav blob, 16-bit PCM, 16000 Hz, mono
 */
async function _blobToWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();

  // Decode using the browser's built-in audio decoder (handles webm, ogg, mp4, etc.)
  const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
  let audioBuffer;
  try {
    audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    decodeCtx.close().catch(() => {});
  }

  const TARGET_SR = 16000; // 16 kHz — Azure STT optimal sample rate
  const N_CH      = 1;     // Mono — Azure STT REST works best with mono

  // ── Mix all channels down to mono ─────────────────────────────────────────
  let monoFloat;
  if (audioBuffer.numberOfChannels === 1) {
    monoFloat = audioBuffer.getChannelData(0).slice(); // copy
  } else {
    monoFloat = new Float32Array(audioBuffer.length);
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const chData = audioBuffer.getChannelData(ch);
      for (let i = 0; i < monoFloat.length; i++) {
        monoFloat[i] += chData[i] / audioBuffer.numberOfChannels;
      }
    }
  }

  // ── Resample to 16000 Hz if needed (linear interpolation) ─────────────────
  let pcmFloat = monoFloat;
  if (audioBuffer.sampleRate !== TARGET_SR) {
    const ratio  = audioBuffer.sampleRate / TARGET_SR;
    const newLen = Math.floor(monoFloat.length / ratio);
    pcmFloat = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const src  = i * ratio;
      const lo   = Math.floor(src);
      const hi   = Math.min(lo + 1, monoFloat.length - 1);
      const frac = src - lo;
      pcmFloat[i] = monoFloat[lo] * (1 - frac) + monoFloat[hi] * frac;
    }
  }

  // ── Convert float32 [-1,1] → int16 ────────────────────────────────────────
  const int16 = new Int16Array(pcmFloat.length);
  for (let i = 0; i < pcmFloat.length; i++) {
    const s = Math.max(-1, Math.min(1, pcmFloat[i]));
    int16[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7FFF);
  }

  // ── Write RIFF/WAV file header + PCM data ─────────────────────────────────
  const dataLen  = int16.byteLength;
  const wavBuf   = new ArrayBuffer(44 + dataLen);
  const view     = new DataView(wavBuf);
  const ws = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  ws(0, "RIFF");
  view.setUint32(4,  36 + dataLen,        true); // ChunkSize
  ws(8, "WAVE");
  ws(12, "fmt ");
  view.setUint32(16, 16,                  true); // PCM subchunk size = 16
  view.setUint16(20, 1,                   true); // AudioFormat = PCM (1)
  view.setUint16(22, N_CH,                true); // NumChannels
  view.setUint32(24, TARGET_SR,           true); // SampleRate
  view.setUint32(28, TARGET_SR * N_CH * 2, true); // ByteRate
  view.setUint16(32, N_CH * 2,            true); // BlockAlign
  view.setUint16(34, 16,                  true); // BitsPerSample
  ws(36, "data");
  view.setUint32(40, dataLen,             true); // Subchunk2Size

  // Copy PCM samples into the WAV buffer (after the 44-byte header)
  new Int16Array(wavBuf, 44).set(int16);

  return new Blob([wavBuf], { type: "audio/wav" });
}

// ── Transcription ─────────────────────────────────────────────────────────────

/**
 * Convert the recorded audio to WAV, then POST to backend → Azure STT.
 *
 * @param {Blob}   blob      — raw audio blob from MediaRecorder
 * @param {string} mimeType  — original MIME type (used only as fallback label)
 */
async function _transcribeAndFire(blob, mimeType) {
  if (!blob || blob.size < 500) {
    const msg = NO_SPEECH_MSG[_lang] || NO_SPEECH_MSG["en-US"];
    if (_onErrorCallback) _onErrorCallback(msg);
    return;
  }

  // ── Convert to WAV/PCM before uploading ─────────────────────────────────────
  // Azure STT REST API does NOT support audio/webm;codecs=opus (Chrome's native
  // format). Converting to WAV/PCM is universally accepted by Azure regardless
  // of the recording language or region.
  let uploadBlob = blob;
  let uploadType = "audio/wav";

  try {
    uploadBlob = await _blobToWav(blob);
    console.log(`[VoiceRecognition] Converted ${mimeType} → audio/wav (${uploadBlob.size} bytes, lang=${_lang})`);
  } catch (convErr) {
    // If AudioContext decoding fails (very unusual), fall back to original format.
    // Some regions may still accept it — worth trying.
    console.warn("[VoiceRecognition] WAV conversion failed; sending original format:", convErr.message);
    uploadBlob = blob;
    uploadType = mimeType;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/speech/transcribe?language=${_lang}`, {
      method: "POST",
      headers: { "Content-Type": uploadType },
      body: uploadBlob,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || err.details || `HTTP ${res.status}`);
    }

    const { transcript } = await res.json();
    console.log(`[VoiceRecognition] Transcript (${_lang}): "${transcript}"`);

    if (transcript && transcript.trim()) {
      if (_onResultCallback) _onResultCallback(transcript.trim());
    } else {
      // Azure returned success but empty — speech not recognised in this language.
      const msg = NO_SPEECH_MSG[_lang] || NO_SPEECH_MSG["en-US"];
      if (_onErrorCallback) _onErrorCallback(msg);
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
          sampleRate: 16000,      // Hint to OS; actual rate depends on device
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

    // Pick the best supported MIME type.
    // Note: we always convert to WAV before uploading, so this only affects
    // what format the MediaRecorder uses internally — any will do.
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

      // _transcribeAndFire converts the blob to WAV before sending to Azure
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
