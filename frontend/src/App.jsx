import { useEffect, useRef, useState } from "react";
import ChatMessage from "./components/ChatMessage.jsx";
import TypingIndicator from "./components/TypingIndicator.jsx";
// Resolve the backend URL based on environment variables and active environment
const BACKEND_URL = (
  import.meta.env.VITE_BACKEND_URL || (import.meta.env.DEV ? "http://localhost:3000" : "")

).replace(/\/$/, "");




const STARTERS = [
  "Apology gift for an upset spouse",
  "Birthday gift for my mother, around 5000 LKR",
  "Send chocolates to Kandy, arriving tomorrow",
  "මගේ යාළුවට උපන්දින තෑග්ගක්",
];

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionId = useRef(crypto.randomUUID());
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, message: trimmed }),
      });

      if (!res.ok) throw new Error("Request failed");
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.text || "Sorry, I didn't quite catch that - could you say it differently?",
          products: data.products ?? [],
          order: data.order ?? null,
        },
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Hmm, something went wrong on my end. Mind trying that again?",
          products: [],
          order: null,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <div className="h-screen flex flex-col bg-cream-50">
      {/* Header */}
      <header className="shrink-0 bg-teal text-white px-5 py-4 flex items-center gap-3 shadow-sm">
        <div className="w-9 h-9 rounded-full bg-terracotta flex items-center justify-center font-display font-semibold">
          K
        </div>
        <div>
          <h1 className="font-display text-lg leading-tight">Kapu</h1>
          <p className="text-teal-50/70 text-xs">Your Kapruka shopping companion</p>
        </div>
      </header>

      {/* Messages */}
      <main ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          {messages.length === 0 && (
            <div className="text-center py-10 flex flex-col items-center gap-5">
              <div>
                <h2 className="font-display text-2xl text-charcoal">Mokakda onna karanne?</h2>
                <p className="text-charcoal/60 text-sm mt-1.5">
                  Tell me what's going on - a gift, an occasion, or just what you need - and I'll
                  take it from there.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-md">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="text-xs px-3 py-1.5 rounded-full border border-teal/30 text-teal hover:bg-teal hover:text-white transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <ChatMessage
              key={i}
              message={m}
              onAddToCart={(product) => sendMessage(`Add ${product.name} to my cart`)}
            />
          ))}

          {loading && (
            <div className="flex items-start gap-2">
              <div className="shrink-0 w-7 h-7 rounded-full bg-teal text-white flex items-center justify-center text-xs font-semibold font-display mt-0.5">
                K
              </div>
              <TypingIndicator />
            </div>
          )}
        </div>
      </main>

      {/* Input bar */}
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-cream-200 bg-cream-50 p-3">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type in Sinhala, Tamil, English, or mix it up..."
            disabled={loading}
            className="flex-1 bg-white border border-cream-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="w-10 h-10 shrink-0 rounded-full bg-terracotta hover:bg-terracotta-dark disabled:bg-cream-200 text-white flex items-center justify-center transition-colors"
            aria-label="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 11l18-8-8 18-2-8-8-2z" />
            </svg>
          </button>
        </div>
        <p className="text-center text-[11px] text-charcoal/40 mt-2">Powered by Kapruka · guest checkout, no account needed</p>
      </form>
    </div>
  );
}
