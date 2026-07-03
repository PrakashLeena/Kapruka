import { useEffect, useRef, useState } from "react";
import ChatMessage from "./components/ChatMessage.jsx";
import TypingIndicator from "./components/TypingIndicator.jsx";
import RightPane from "./components/RightPane.jsx";
import ChatSidebar from "./components/ChatSidebar.jsx";
import VoiceButton from "./components/VoiceButton.jsx";
import ImageButton from "./components/ImageButton.jsx";
import { useVoice } from "./hooks/useVoice.js";
import { onAuthChange } from "./firebase.js";
import { detectConversationLanguage } from "./services/LanguageDetector.js";
import kaprukaLogo from "./kapruka_com_logo.jpg";
import sendOnlineLogo from "./send-online-logo.png";

const BACKEND_URL = (
  import.meta.env.VITE_BACKEND_URL !== undefined
    ? import.meta.env.VITE_BACKEND_URL
    : (import.meta.env.DEV ? "http://localhost:3000" : "")
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
  const [currentProducts, setCurrentProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [authToken, setAuthToken] = useState(null);

  // Firebase auth state: null = not logged in, object = logged in user
  const [firebaseUser, setFirebaseUser] = useState(undefined); // undefined = still loading

  // Chat sessions state
  const [activeChatId, setActiveChatId] = useState(crypto.randomUUID());
  const [chats, setChats] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("chat"); // "chat" | "products" on mobile

  // Language detected from user messages: 'english' | 'tamil' | 'sinhala'
  const [conversationLang, setConversationLang] = useState("english");

  const scrollRef = useRef(null);

  // Listen to Firebase auth state changes
  useEffect(() => {
    const unsubscribe = onAuthChange(async (user) => {
      let token = null;
      if (user) {
        try {
          token = await user.getIdToken();
        } catch (err) {
          console.warn("Failed to fetch Firebase ID token:", err);
        }
      }
      setAuthToken(token);
      setFirebaseUser(user); // null if logged out, user object if logged in
      setCurrentProducts([]);
      setSelectedProduct(null);
    });
    return () => unsubscribe();
  }, []);

  // Guest ID is in-memory only (no localStorage) so it's discarded on page refresh.
  // Logged-in users use their Firebase UID for persistent history.
  const [guestId] = useState(() => `guest_${crypto.randomUUID()}`);

  // Derive the userId from Firebase user uid, or fall back to guest ID
  const userId = firebaseUser?.uid ?? guestId;

  function buildHeaders(extraHeaders = {}) {
    return {
      ...extraHeaders,
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    };
  }

  // Fetch chat sessions filtered by current user's Firebase uid
  async function fetchChats(targetUserId = userId, selectLatest = false) {
    if (!targetUserId) {
      setChats([]);
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/chats?userId=${encodeURIComponent(targetUserId)}`, {
        headers: buildHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setChats(data);
        if (selectLatest && data.length > 0) {
          // Select the most recent chat session
          await selectChat(data[0].id, targetUserId);
        } else if (selectLatest) {
          // If no previous chats, start a new one
          handleNewChat();
        }
      }
    } catch (err) {
      console.error("Failed to fetch chat history list:", err);
    }
  }

  // Refetch chats only for authenticated users. Guests get ephemeral in-memory chat only.
  useEffect(() => {
    if (firebaseUser === undefined) return; // still loading

    // Clear previous user's data immediately to prevent private chat leaking
    setChats([]);
    handleNewChat();

    if (firebaseUser) {
      // Logged-in user — load persisted history from backend
      fetchChats(firebaseUser.uid, true);
    }
    // Guest (firebaseUser === null): nothing to fetch, chat lives in React state only
  }, [firebaseUser]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Load a selected chat session
  async function selectChat(chatId, targetUserId = userId) {
    if (!targetUserId) return;
    setActiveChatId(chatId);
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/chats/${chatId}?userId=${encodeURIComponent(targetUserId)}`, {
        headers: buildHeaders(),
      });
      if (!res.ok) throw new Error("Failed to load chat history");
      const data = await res.json();

      const formattedMessages = (data.messages || []).map((m) => ({
        role: m.role,
        text: m.content || m.text || "",
        products: [],
        order: null,
      }));

      setMessages(formattedMessages);
      setCurrentProducts([]);
      setSelectedProduct(null);
    } catch (err) {
      console.error("Error loading chat session:", err);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }

  // Delete a chat session
  async function deleteChat(chatId) {
    if (!userId) return;
    try {
      const res = await fetch(`${BACKEND_URL}/chats/${chatId}?userId=${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: buildHeaders(),
      });
      if (res.ok) {
        setChats((prev) => prev.filter((c) => c.id !== chatId));
        if (chatId === activeChatId) {
          handleNewChat();
        }
      }
    } catch (err) {
      console.error("Error deleting chat session:", err);
    }
  }

  // Start a new chat
  function handleNewChat() {
    setActiveChatId(crypto.randomUUID());
    setMessages([]);
    setCurrentProducts([]);
    setSelectedProduct(null);
  }

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    // Detect language from this message and update conversation language
    setMessages((prev) => {
      const updatedMsgs = [...prev, { role: "user", text: trimmed }];
      const lang = detectConversationLanguage(updatedMsgs);
      setConversationLang(lang);
      return updatedMsgs;
    });
    setInput("");
    setLoading(true); // show TypingIndicator during tool-call phase

    const maxRetries = 3;
    let attempt = 0;
    let success = false;

    // Unique key used to locate the streaming assistant bubble
    const streamKey = `stream_${Date.now()}`;
    let assistantBubbleAdded = false;

    while (attempt < maxRetries && !success) {
      attempt++;
      try {
        if (attempt > 1) {
          console.warn(`Connection issue encountered. Retrying silently (${attempt}/${maxRetries}) in 1.5s...`);
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }

        const res = await fetch(`${BACKEND_URL}/chat/stream`, {
          method: "POST",
          headers: buildHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            sessionId: activeChatId,
            message: trimmed,
            userId,
          }),
        });

        if (!res.ok) throw new Error("Request failed");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop(); // retain any incomplete last line

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let event;
            try { event = JSON.parse(line.slice(6)); } catch { continue; }

            if (event.type === "delta") {
              if (!assistantBubbleAdded) {
                // First text token: hide TypingIndicator, create message bubble
                setLoading(false);
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", text: event.text, streaming: true, products: [], order: null, _key: streamKey },
                ]);
                assistantBubbleAdded = true;
              } else {
                // Subsequent tokens: append to the bubble
                setMessages((prev) =>
                  prev.map((m) =>
                    m._key === streamKey ? { ...m, text: m.text + event.text } : m
                  )
                );
              }
            } else if (event.type === "products") {
              if (event.data?.length > 0) {
                setCurrentProducts(event.data);
                setSelectedProduct(null);
                setActiveTab("products");
              }
            } else if (event.type === "order") {
              setMessages((prev) =>
                prev.map((m) => (m._key === streamKey ? { ...m, order: event.data } : m))
              );
            } else if (event.type === "done") {
              // Mark streaming complete (removes blinking cursor)
              setMessages((prev) =>
                prev.map((m) => (m._key === streamKey ? { ...m, streaming: false } : m))
              );
              fetchChats();
              success = true;
            } else if (event.type === "error") {
              throw new Error(event.message || "Stream error");
            }
          }
        }

        // If we finished streaming successfully, break out of the retry loop
        if (success) {
          break;
        }
      } catch (err) {
        console.error(`Attempt ${attempt} failed:`, err);

        if (attempt >= maxRetries) {
          const errText = err.message || "Hmm, something went wrong on my end. Mind trying that again?";
          if (assistantBubbleAdded) {
            // Append error note to the partially-streamed bubble
            setMessages((prev) =>
              prev.map((m) =>
                m._key === streamKey ? { ...m, text: m.text || errText, streaming: false } : m
              )
            );
          } else {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", text: errText, products: [], order: null },
            ]);
          }
        } else {
          // If we are retrying:
          if (assistantBubbleAdded) {
            // Remove the partially streamed bubble so we start fresh on the next attempt
            setMessages((prev) => prev.filter((m) => m._key !== streamKey));
            assistantBubbleAdded = false;
          }
          // Maintain loading/typing state
          setLoading(true);
        }
      }
    }

    setLoading(false);
    // Ensure streaming flag is cleared even if done event was missed
    if (assistantBubbleAdded) {
      setMessages((prev) =>
        prev.map((m) => (m._key === streamKey ? { ...m, streaming: false } : m))
      );
    }
  }

  async function sendImageMessage(file, onComplete) {
    if (loading) {
      if (onComplete) onComplete();
      return;
    }
    setLoading(true);

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = reader.result;
        const commaIdx = dataUrl.indexOf(",");
        if (commaIdx === -1) throw new Error("Failed to encode image");
        const imageBase64 = dataUrl.slice(commaIdx + 1);

        const res = await fetch(`${BACKEND_URL}/chat/image-search`, {
          method: "POST",
          headers: buildHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            imageBase64,
            mimeType: file.type,
            sessionId: activeChatId,
            userId,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Image analysis failed");
        }

        const readerStream = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantBubbleAdded = false;
        const streamKey = `stream_${Date.now()}`;

        while (true) {
          const { done, value } = await readerStream.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop(); // retain incomplete line

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let event;
            try { event = JSON.parse(line.slice(6)); } catch { continue; }

            if (event.type === "image_query") {
              // Add user bubble displaying what the image query was
              setMessages((prev) => {
                const updatedMsgs = [...prev, { role: "user", text: `📷 [Searched Image: "${event.query}"]` }];
                const lang = detectConversationLanguage(updatedMsgs);
                setConversationLang(lang);
                return updatedMsgs;
              });
            } else if (event.type === "delta") {
              if (!assistantBubbleAdded) {
                setLoading(false);
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", text: event.text, streaming: true, products: [], order: null, _key: streamKey },
                ]);
                assistantBubbleAdded = true;
              } else {
                setMessages((prev) =>
                  prev.map((m) =>
                    m._key === streamKey ? { ...m, text: m.text + event.text } : m
                  )
                );
              }
            } else if (event.type === "products") {
              if (event.data?.length > 0) {
                setCurrentProducts(event.data);
                setSelectedProduct(null);
                setActiveTab("products");
              }
            } else if (event.type === "order") {
              setMessages((prev) =>
                prev.map((m) => (m._key === streamKey ? { ...m, order: event.data } : m))
              );
            } else if (event.type === "done") {
              setMessages((prev) =>
                prev.map((m) => (m._key === streamKey ? { ...m, streaming: false } : m))
              );
              fetchChats();
            } else if (event.type === "error") {
              throw new Error(event.message || "Stream error");
            }
          }
        }
      } catch (err) {
        console.error("Image search error:", err);
        const errText = err.message || "Something went wrong analyzing the image. Mind trying that again?";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: errText, products: [], order: null },
        ]);
      } finally {
        setLoading(false);
        if (onComplete) onComplete();
      }
    };

    reader.onerror = () => {
      console.error("FileReader error");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Failed to read the image file.", products: [], order: null },
      ]);
      setLoading(false);
      if (onComplete) onComplete();
    };

    reader.readAsDataURL(file);
  }

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage(input);
  }

  // ── Voice integration ──────────────────────────────────────────────────────
  // useVoice receives the existing sendMessage() and messages so voice reuses
  // the exact same chat pipeline. No business logic is duplicated.
  const {
    voiceState,
    startListening,
    stopAll,
    error: voiceError,
    clearError,
    isSupported: voiceSupported,
    selectedLang: voiceLang,
    setSelectedLang: setVoiceLang,
  } = useVoice({ sendMessage, messages });

  // Show a loading spinner while Firebase resolves initial auth state
  if (firebaseUser === undefined) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-cream-50">
        <div className="flex flex-col items-center gap-6 max-w-sm px-6 text-center">
          {/* Animated Logo Container */}
          <div className="relative">
            {/* Glowing background circles */}
            <div className="absolute inset-0 bg-teal/10 rounded-full blur-xl scale-125 animate-pulse" />
            <div className="absolute inset-0 bg-terracotta/5 rounded-full blur-2xl scale-150 animate-pulse delay-75" />
            
            {/* Logo image with custom animation */}
            <div className="relative w-28 h-28 rounded-full overflow-hidden border-4 border-teal/20 shadow-xl bg-white flex items-center justify-center animate-bounce-custom">
              <img
                src={sendOnlineLogo}
                alt="Kapruka Logo"
                className="w-full h-full object-cover animate-pulse-slow"
              />
            </div>
          </div>
          
          {/* Animated Text */}
          <div className="space-y-2 animate-fade-in-up">
            <h1 className="text-xl font-bold font-display text-charcoal tracking-wide">
              Kapruka AI
            </h1>
            <p className="text-xs text-charcoal/50 font-medium">
              Connecting you with smart shopping in Sri Lanka
            </p>
          </div>
          
          {/* Subtle horizontal progress line */}
          <div className="w-32 h-1 bg-cream-200 rounded-full overflow-hidden mt-2 relative">
            <div className="absolute top-0 bottom-0 left-0 bg-teal rounded-full w-12 animate-progress" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-cream-50 overflow-hidden relative">
      {/* Ambient decorative glowing blobs */}
      <div className="mesh-bg-glow">
        <div className="mesh-glow-orb-1" />
        <div className="mesh-glow-orb-2" />
      </div>

      {/* Header */}
      <header className="shrink-0 bg-teal text-white px-5 py-4 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center gap-3">
          {/* Hamburger Menu Icon for Mobile */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-teal-light text-white transition-colors"
            aria-label="Toggle Sidebar"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="w-9 h-9 rounded-full bg-white overflow-hidden flex items-center justify-center shadow-inner">
            <img src={kaprukaLogo} alt="Kapruka Logo" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="font-display text-lg leading-tight">Kapu</h1>
            <p className="text-teal-50/70 text-xs">Your Kapruka shopping companion</p>
          </div>
        </div>

        {/* Header: show user info or sign-in hint */}
        {firebaseUser && (
          <div className="hidden md:flex items-center gap-2">
            {firebaseUser.photoURL ? (
              <img
                src={firebaseUser.photoURL}
                alt={firebaseUser.displayName}
                className="w-7 h-7 rounded-full border-2 border-white/30"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-gold text-charcoal flex items-center justify-center text-xs font-bold">
                {(firebaseUser.displayName || firebaseUser.email || "U").substring(0, 1).toUpperCase()}
              </div>
            )}
            <span className="text-xs text-teal-50/80 max-w-[120px] truncate">
              {firebaseUser.displayName || firebaseUser.email}
            </span>
          </div>
        )}
      </header>

      {/* Mobile Tab Switcher */}
      <div className="shrink-0 flex border-b border-cream-200 bg-white md:hidden">
        <button
          type="button"
          onClick={() => setActiveTab("chat")}
          className={`flex-1 py-3 text-center text-xs font-bold border-b-2 transition-all uppercase tracking-wider ${
            activeTab === "chat"
              ? "border-teal text-teal"
              : "border-transparent text-charcoal/50"
          }`}
        >
          Chat Conversation
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("products")}
          className={`flex-1 py-3 text-center text-xs font-bold border-b-2 transition-all uppercase tracking-wider relative ${
            activeTab === "products"
              ? "border-teal text-teal"
              : "border-transparent text-charcoal/50"
          }`}
        >
          Product Catalog
          {currentProducts.length > 0 && (
            <span className="ml-2 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-gold text-charcoal">
              {currentProducts.length}
            </span>
          )}
        </button>
      </div>

      {/* Main split layout with Sidebar included */}
      <div className="flex-1 flex flex-row overflow-hidden relative">
        <ChatSidebar
          chats={chats}
          activeChatId={activeChatId}
          onSelectChat={selectChat}
          onNewChat={handleNewChat}
          onDeleteChat={deleteChat}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          currentUser={firebaseUser}
        />

        {/* Left Pane: Chat */}
        <div className={`flex-1 flex flex-col min-w-0 h-full border-r border-cream-200 ${
          activeTab === "chat" ? "flex" : "hidden md:flex"
        }`}>
          {/* Messages */}
          <main ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 sm:py-5">
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
                        type="button"
                        key={s}
                        onClick={() => sendMessage(s)}
                        className="text-xs px-3 py-1.5 rounded-full border border-teal/30 text-teal hover:bg-teal hover:text-white transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  {!firebaseUser && (
                    <p className="text-xs text-charcoal/40 bg-cream-100 px-4 py-2 rounded-full">
                      💡 Sign in via the sidebar to save your conversation history
                    </p>
                  )}
                </div>
              )}

              {messages.map((m, i) => (
                <ChatMessage
                  key={i}
                  message={m}
                  speakLang={conversationLang}
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
          <form onSubmit={handleSubmit} className="shrink-0 border-t border-cream-200 bg-cream-50 p-2 sm:p-3">
            <div className="max-w-2xl mx-auto flex items-center gap-1 sm:gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type or speak..."
                disabled={loading}
                className="flex-1 min-w-0 bg-white border border-cream-200 rounded-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              />
              {/* Voice button */}
              <VoiceButton
                voiceState={voiceState}
                onStart={startListening}
                onStop={stopAll}
                disabled={loading}
                error={voiceError}
                onClearError={clearError}
                isSupported={voiceSupported}
                selectedLang={voiceLang}
                onLangChange={setVoiceLang}
              />

              {/* Image upload search button */}
              <ImageButton
                onImageSelected={sendImageMessage}
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="w-8 h-8 sm:w-10 sm:h-10 shrink-0 rounded-full bg-terracotta hover:bg-terracotta-dark disabled:bg-cream-200 text-white flex items-center justify-center transition-colors"
                aria-label="Send message"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 11l18-8-8 18-2-8-8-2z" />
                </svg>
              </button>
            </div>
            <p className="text-center text-[11px] text-charcoal/40 mt-2">
              Powered by Kapruka · guest checkout, no account needed
            </p>
          </form>
        </div>

        {/* Right Pane: Products */}
        <div className={`w-full md:w-[380px] lg:w-[420px] shrink-0 h-full border-t md:border-t-0 md:border-l border-cream-200 bg-white ${
          activeTab === "products" ? "block" : "hidden md:block"
        }`}>
          <RightPane
            products={currentProducts}
            onAddToCart={(product) => sendMessage(`Add ${product.name} to my cart`)}
            selectedProduct={selectedProduct}
            setSelectedProduct={setSelectedProduct}
          />
        </div>
      </div>
    </div>
  );
}


