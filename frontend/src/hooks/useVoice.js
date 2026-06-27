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
 *   voiceState   — 'idle' | 'listening' | 'thinking' | 'speaking'
 *   startListening() — start mic capture
 *   stopAll()        — cancel mic + TTS, return to idle
 *   error            — string | null (user-facing error message)
 *   clearError()     — dismiss the error
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { VoiceRecognitionService } from "../services/VoiceRecognition.js";
import { SpeechPlayerService } from "../services/SpeechPlayer.js";

/**
 * @typedef {'idle'|'listening'|'thinking'|'speaking'} VoiceState
 */

export function useVoice({ sendMessage, messages }) {
  /** @type {[VoiceState, Function]} */
  const [voiceState, setVoiceState] = useState("idle");
  const [error, setError] = useState(null);

  // Keep a ref to messages to avoid stale closure issues in the onResult listener
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Track how many messages existed when we sent a voice message.
  // We use this to detect when a NEW assistant message has arrived.
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

      // Call the EXACT same sendMessage used by text input
      // Prepend 🎤 so it's visually distinguishable in the chat history
      sendMessage(`🎤 ${transcript}`);
    });

    // Speech recognition ended (no result or after result) → guard idle fallback
    VoiceRecognitionService.onEnd(() => {
      // If we got a result, we're now in 'thinking'. Don't override that.
      setVoiceState((prev) => (prev === "listening" ? "idle" : prev));
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
  // Note: intentionally empty deps — we bind once, sendMessage is stable

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
    const lastAssistantMsg = latestAssistant ||
      [...newMessages].reverse().find((m) => m.role === "assistant");

    if (lastAssistantMsg && !lastAssistantMsg.streaming) {
      // New completed assistant message arrived — speak it
      pendingResponseRef.current = false;
      setVoiceState("speaking");
      SpeechPlayerService.speak(lastAssistantMsg.text || "");
    }
  }, [messages]);

  // ── Public actions ───────────────────────────────────────────────────────────

  const startListening = useCallback(() => {
    // If TTS is speaking, stop it first
    SpeechPlayerService.stop();
    setError(null);
    setVoiceState("listening");
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
  };
}
