/**
 * useVoice.js
 *
 * Custom React hook that orchestrates the complete voice lifecycle:
 *   1. Listens via VoiceRecognitionService (Web Speech API)
 *   2. Calls the existing sendMessage() with the transcript
 *   3. Watches for the new assistant message to arrive
 *   4. Speaks the response via SpeechPlayerService (SpeechSynthesis)
 *
 * Props:
 *   sendMessage  — the EXACT same sendMessage() function from App.jsx
 *   messages     — the live messages array from App.jsx
 *
 * Returns:
 *   voiceState        — 'idle' | 'listening' | 'thinking' | 'speaking'
 *   startListening()  — start mic capture
 *   stopAll()         — cancel mic + TTS, return to idle
 *   error             — string | null (user-facing error message)
 *   clearError()      — dismiss the error
 *   selectedLang      — 'sinhala' | 'tamil' | 'english'
 *   setSelectedLang   — update the mic language
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { VoiceRecognitionService } from "../services/VoiceRecognition.js";
import { SpeechPlayerService } from "../services/SpeechPlayer.js";
import { detectLanguage, detectConversationLanguage } from "../services/LanguageDetector.js";

/**
 * @typedef {'idle'|'listening'|'thinking'|'speaking'} VoiceState
 */

// Language prefix tags embedded in the voice message so the LLM knows
// which language to respond in, regardless of recognition locale.
const LANG_HINT = {
  sinhala: "[සිංහල] ",  // Tells LLM: user is speaking Sinhala/Singlish → respond in Sinhala
  tamil:   "[தமிழ்] ",  // Tells LLM: user is speaking Tamil → respond in Tamil
  english: "",            // No prefix needed for English
};

export function useVoice({ sendMessage, messages, ttsEnabled = false }) {
  /** @type {[VoiceState, Function]} */
  const [voiceState, setVoiceState] = useState("idle");
  const [error, setError] = useState(null);

  // Explicit language chosen by the user via the language picker
  const [selectedLang, setSelectedLang] = useState(() => {
    // Default based on browser locale; most Sri Lankan users will be on Sinhala
    const bl = (navigator.language || "").toLowerCase();
    if (bl.startsWith("si")) return "sinhala";
    if (bl.startsWith("ta")) return "tamil";
    return "sinhala"; // default to sinhala for Kapruka's primary market
  });

  // Keep a ref to messages to avoid stale closure issues in the onResult listener
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Keep a ref to selectedLang so the onResult callback always reads current value
  const selectedLangRef = useRef(selectedLang);
  useEffect(() => {
    selectedLangRef.current = selectedLang;
    // Keep recognition service in sync whenever user changes language
    VoiceRecognitionService.setLanguage(selectedLang);
    SpeechPlayerService.setLanguage(selectedLang);
  }, [selectedLang]);

  // Track how many messages existed when we sent a voice message.
  const pendingResponseRef = useRef(false);
  const messagesLengthAtSendRef = useRef(0);

  // ── Register service callbacks once on mount ─────────────────────────────────
  useEffect(() => {
    // Speech recognition result → send to existing chat pipeline
    VoiceRecognitionService.onResult((transcript) => {
      // Transition: listening → thinking
      setVoiceState("thinking");
      pendingResponseRef.current = true;
      messagesLengthAtSendRef.current = messagesRef.current.length;

      const lang = selectedLangRef.current;

      // Sync TTS language with what was selected
      SpeechPlayerService.setLanguage(lang);

      console.log("[useVoice] Voice message in language:", lang, "transcript:", transcript);

      // Prepend language hint so LLM knows which language to respond in,
      // PLUS 🎤 so it's visually distinguishable in the chat history.
      const hint = LANG_HINT[lang] || "";
      sendMessage(`🎤 ${hint}${transcript}`);
    });

    // Speech recognition ended — recording is done, transcription is in progress.
    // Transition listening → thinking to show spinner while Azure STT processes audio.
    // (If onResult already fired first, prev won't be "listening" — no-op.)
    VoiceRecognitionService.onEnd(() => {
      setVoiceState((prev) => (prev === "listening" ? "thinking" : prev));
    });

    // Speech recognition error
    VoiceRecognitionService.onError((msg) => {
      setError(msg);
      setVoiceState("idle");
    });

    // TTS finished speaking → return to idle
    SpeechPlayerService.onEnd(() => {
      setVoiceState("idle");
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep ttsEnabled in a ref so the message-watcher effect always reads the latest value
  const ttsEnabledRef = useRef(ttsEnabled);
  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);

  // ── Watch messages for new assistant response ────────────────────────────────
  useEffect(() => {
    if (!pendingResponseRef.current) return;

    const currentMsgs = messagesRef.current;

    // Find the latest user message in the entire conversation
    const userMsgs = currentMsgs.filter((m) => m.role === "user");
    const lastUserMsg = userMsgs[userMsgs.length - 1];

    // Only read if the user's last message was a voice message (starts with 🎤)
    const isVoicePrompt = lastUserMsg?.text?.startsWith("🎤");

    if (!isVoicePrompt) {
      pendingResponseRef.current = false;
      return;
    }

    // Wait for the assistant to add at least one new message AND finish streaming
    const newMessages = currentMsgs.slice(messagesLengthAtSendRef.current);
    const latestAssistant = newMessages.findLast?.((m) => m.role === "assistant");

    // findLast may not exist in older Chrome — safe fallback
    const lastAssistantMsg =
      latestAssistant || [...newMessages].reverse().find((m) => m.role === "assistant");

    if (lastAssistantMsg && !lastAssistantMsg.streaming) {
      pendingResponseRef.current = false;

      if (ttsEnabledRef.current) {
        // TTS is ON — speak the reply
        setVoiceState("speaking");
        SpeechPlayerService.speak(lastAssistantMsg.text || "");
      } else {
        // TTS is OFF — just return to idle silently
        setVoiceState("idle");
      }
    }
  }, [messages]);

  // ── Public actions ───────────────────────────────────────────────────────────

  const startListening = useCallback(() => {
    // If TTS is speaking, stop it first
    SpeechPlayerService.stop();
    setError(null);
    setVoiceState("listening");

    const lang = selectedLangRef.current;
    VoiceRecognitionService.setLanguage(lang);
    SpeechPlayerService.setLanguage(lang);
    console.log("[useVoice] Starting recognition in language:", lang);

    VoiceRecognitionService.start();
  }, []);

  const stopAll = useCallback(() => {
    VoiceRecognitionService.stop();
    SpeechPlayerService.stop();
    pendingResponseRef.current = false;
    setVoiceState("idle");
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    voiceState,
    startListening,
    stopAll,
    error,
    clearError,
    isSupported: VoiceRecognitionService.isSupported(),
    selectedLang,
    setSelectedLang,
  };
}
