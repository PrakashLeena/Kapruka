import { useState, useEffect } from "react";
import { SpeechPlayerService } from "../services/SpeechPlayer.js";
import OrderCard from "./OrderCard.jsx";

export default function ChatMessage({ message, onAddToCart, speakLang = "english" }) {
  const isUser = message.role === "user";
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!SpeechPlayerService.isSupported()) return;

    let unsubscribe;
    if (isSpeaking) {
      unsubscribe = SpeechPlayerService.onEnd(() => {
        setIsSpeaking(false);
      });
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [isSpeaking]);

  const handleSpeak = () => {
    if (isSpeaking) {
      SpeechPlayerService.stop();
      setIsSpeaking(false);
    } else {
      // Set language so the correct Tamil/Sinhala/English voice is used
      SpeechPlayerService.setLanguage(speakLang);
      SpeechPlayerService.speak(message.text);
      setIsSpeaking(true);
    }
  };

  if (isUser) {
    const isVoice = message.text?.startsWith("🎤");
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-terracotta text-white px-4 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed flex flex-col gap-2">
          {message.image && (
            <div className="overflow-hidden rounded-xl bg-black/5">
              <img
                src={message.image}
                alt="Uploaded attachment"
                className="max-w-full max-h-64 object-cover rounded-xl border border-white/10 shadow-sm"
              />
            </div>
          )}
          {message.text && (
            <div className={isVoice ? "italic" : ""}>
              {message.text}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="shrink-0 w-7 h-7 rounded-full bg-teal text-white flex items-center justify-center text-xs font-semibold font-display mt-0.5">
        K
      </div>
      <div className="flex flex-col gap-2.5 max-w-[85%]">
        {message.text && (
          <div className="relative bg-white border border-cream-200 border-l-[3px] border-l-teal px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed pr-8">
            {message.text}
            {/* Blinking cursor shown while the LLM is still streaming tokens */}
            {message.streaming && (
              <span
                className="inline-block w-[2px] h-[1em] bg-teal ml-0.5 align-middle animate-pulse"
                aria-hidden="true"
              />
            )}
            
            {/* Speaker Icon for text-to-speech */}
            {!message.streaming && SpeechPlayerService.isSupported() && (
              <button
                type="button"
                onClick={handleSpeak}
                className={`absolute right-2 bottom-2 p-1 rounded-full hover:bg-cream-100 transition-colors ${
                  isSpeaking ? "text-teal" : "text-charcoal/30 hover:text-charcoal/60"
                }`}
                title={isSpeaking ? "Stop reading" : "Read aloud"}
              >
                {isSpeaking ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
              </button>
            )}
          </div>
        )}
        {message.order && <OrderCard order={message.order} />}
      </div>
    </div>
  );
}
