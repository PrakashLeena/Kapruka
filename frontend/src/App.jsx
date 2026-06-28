import { useEffect, useRef, useState } from "react";
import ChatMessage from "./components/ChatMessage.jsx";
import TypingIndicator from "./components/TypingIndicator.jsx";
import RightPane from "./components/RightPane.jsx";
import ChatSidebar from "./components/ChatSidebar.jsx";
import VoiceButton from "./components/VoiceButton.jsx";
import ImageUpload from "./components/ImageUpload.jsx";
import ImagePreview from "./components/ImagePreview.jsx";
import { useVoice } from "./hooks/useVoice.js";
import { useImageUpload } from "./hooks/useImageUpload.js";
import { onAuthChange } from "./firebase.js";
import { detectConversationLanguage } from "./services/LanguageDetector.js";
import kaprukaLogo from "./kapruka_com_logo.jpg";

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

  // Firebase auth state: null = not logged in, object = logged in user
  const [firebaseUser, setFirebaseUser] = useState(undefined); // undefined = still loading

  // Chat sessions state
  const [activeChatId, setActiveChatId] = useState(crypto.randomUUID());
  const [chats, setChats] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("chat"); // "chat" | "products" on mobile

  // Language detected from user messages: 'english' | 'tamil' | 'sinhala'
  const [conversationLang, setConversationLang] = useState("english");

  // Image Upload Hook Integration
  const {
    image: uploadedImage,
    error: imageError,
    isCompressing: imageCompressing,
    processFile: processImageFile,
    handleFileChange: handleImageFileChange,
    clearImage: clearUploadedImage,
    setError: setImageError
  } = useImageUpload();

  const [isDragging, setIsDragging] = useState(false);

  // Paste handler for images
  useEffect(() => {
    const handlePaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            processImageFile(file);
            e.preventDefault();
            break;
          }
        }
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [processImageFile]);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type.startsWith("image/")) {
        processImageFile(file);
      } else {
        setImageError("Only image files are supported.");
      }
    }
  };

  const scrollRef = useRef(null);

  // Listen to Firebase auth state changes
  useEffect(() => {
    const unsubscribe = onAuthChange(async (user) => {
      if (user) {
        // User logged in: migrate guest sessions to user account
        const storedGuestId = localStorage.getItem("kapruka_guest_id");
        if (storedGuestId) {
          try {
            await fetch(`${BACKEND_URL}/chats/migrate`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ guestId: storedGuestId, userId: user.uid }),
            });
          } catch (err) {
            console.error("Failed to migrate guest chats:", err);
          }
        }
      }
      setFirebaseUser(user); // null if logged out, user object if logged in
      setCurrentProducts([]);
      setSelectedProduct(null);
    });
    return () => unsubscribe();
  }, []);

  // Generate or retrieve a persistent guest ID
  const [guestId] = useState(() => {
    let id = localStorage.getItem("kapruka_guest_id");
    if (!id) {
      id = `guest_${crypto.randomUUID()}`;
      localStorage.setItem("kapruka_guest_id", id);
    }
    return id;
  });

  // Derive the userId from Firebase user uid, or fall back to guest ID
  const userId = firebaseUser?.uid ?? guestId;

  // Fetch chat sessions filtered by current user's Firebase uid
  async function fetchChats(targetUserId = userId, selectLatest = false) {
    if (!targetUserId) {
      setChats([]);
      return;
    }
    try {
      const res = await fetch(`${BACKEND_URL}/chats?userId=${encodeURIComponent(targetUserId)}`);
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

  // Refetch chats when user changes
  useEffect(() => {
    if (firebaseUser !== undefined) {
      fetchChats(userId, true);
    }
  }, [userId, firebaseUser]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Load a selected chat session
  async function selectChat(chatId, targetUserId = userId) {
    if (!targetUserId) return;
    setActiveChatId(chatId);
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/chats/${chatId}?userId=${encodeURIComponent(targetUserId)}`);
      if (!res.ok) throw new Error("Failed to load chat history");
      const data = await res.json();

      const formattedMessages = (data.messages || []).map((m) => {
        let text = "";
        let image = null;
        if (Array.isArray(m.content)) {
          const textObj = m.content.find((c) => c.type === "text");
          const imgObj = m.content.find((c) => c.type === "image_url");
          text = textObj ? textObj.text : "";
          image = imgObj ? imgObj.image_url?.url : null;
        } else {
          text = m.content || m.text || "";
        }

        return {
          role: m.role,
          text: text,
          image: image,
          products: [],
          order: null,
        };
      });

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

  async function sendMessage(textOrObj) {
    let text = "";
    let base64Image = null;

    if (typeof textOrObj === "object" && textOrObj !== null) {
      text = textOrObj.text || "";
      base64Image = textOrObj.image || null;
    } else {
      text = textOrObj || "";
    }

    const trimmed = text.trim();
    if (!trimmed && !base64Image) return;
    if (loading) return;

    // Detect language from this message and update conversation language
    setMessages((prev) => {
      const updatedMsgs = [...prev, { role: "user", text: trimmed, image: base64Image }];
      const lang = detectConversationLanguage(updatedMsgs);
      setConversationLang(lang);
      return updatedMsgs;
    });
    setInput("");
    clearUploadedImage();
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
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: activeChatId,
            message: trimmed,
            image: base64Image,
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

  function handleSubmit(e) {
    e.preventDefault();
    sendMessage({ text: input, image: uploadedImage });
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
  } = useVoice({ sendMessage, messages });

  // Show a loading spinner while Firebase resolves initial auth state
  if (firebaseUser === undefined) {
    return (
      <div className="h-dvh flex items-center justify-center bg-cream-50">
        <div className="flex flex-col items-center gap-3 text-charcoal/60">
          <div className="w-10 h-10 border-4 border-teal border-t-transparent rounded-full animate-spin" />
          <p className="text-sm">Loading Kapu...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="h-dvh flex flex-col bg-cream-50 overflow-hidden relative"
    >
      {/* Visual Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-teal/20 backdrop-blur-sm z-50 flex items-center justify-center pointer-events-none transition-all">
          <div className="bg-white border-2 border-dashed border-teal rounded-2xl p-6 text-teal font-semibold shadow-xl flex flex-col items-center gap-3">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Drop your image here to upload</span>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="shrink-0 bg-teal text-white px-5 py-4 flex items-center justify-between shadow-sm">
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
          <form onSubmit={handleSubmit} className="shrink-0 border-t border-cream-200 bg-cream-50 p-2.5 sm:p-3">
            {/* Image Error Alert */}
            {imageError && (
              <div className="max-w-2xl mx-auto mb-2 p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex justify-between items-center animate-fadeIn">
                <span>{imageError}</span>
                <button type="button" onClick={() => setImageError(null)} className="font-bold underline ml-2">Dismiss</button>
              </div>
            )}
            
            {/* Image Preview Thumbnail */}
            <div className="max-w-2xl mx-auto mb-2">
              <ImagePreview
                image={uploadedImage}
                isCompressing={imageCompressing}
                onRemove={clearUploadedImage}
              />
            </div>

            <div className="max-w-2xl mx-auto flex items-center gap-2">
              {/* Image Upload Button */}
              <ImageUpload
                onFileSelect={processImageFile}
                disabled={loading}
              />

              {/* Voice button — sits between text input and send button */}
              <VoiceButton
                voiceState={voiceState}
                onStart={startListening}
                onStop={stopAll}
                disabled={loading}
                error={voiceError}
                onClearError={clearError}
                isSupported={voiceSupported}
              />

              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type in Sinhala, Tamil, English, or mix it up..."
                disabled={loading}
                className="flex-1 bg-white border border-cream-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal/40"
              />

              <button
                type="submit"
                disabled={loading || (!input.trim() && !uploadedImage)}
                className="w-10 h-10 shrink-0 rounded-full bg-terracotta hover:bg-terracotta-dark disabled:bg-cream-200 text-white flex items-center justify-center transition-colors"
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
