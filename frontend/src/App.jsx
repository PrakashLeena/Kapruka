import { useEffect, useRef, useState } from "react";
import ChatMessage from "./components/ChatMessage.jsx";
import TypingIndicator from "./components/TypingIndicator.jsx";
import RightPane from "./components/RightPane.jsx";
import ChatSidebar from "./components/ChatSidebar.jsx";

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

// Helper to get or create a persistent guest user ID
function getOrCreateUser() {
  let user = localStorage.getItem("kapruka_user");
  if (!user) {
    user = "guest_" + Math.random().toString(36).substring(2, 6);
    localStorage.setItem("kapruka_user", user);
  }
  return user;
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentProducts, setCurrentProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  
  // Chat sessions & user states
  const [currentUser, setCurrentUser] = useState(getOrCreateUser);
  const [activeChatId, setActiveChatId] = useState(crypto.randomUUID());
  const [chats, setChats] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  const scrollRef = useRef(null);

  // Fetch chat sessions filtered by current user
  async function fetchChats() {
    try {
      const res = await fetch(`${BACKEND_URL}/chats?userId=${encodeURIComponent(currentUser)}`);
      if (res.ok) {
        const data = await res.json();
        setChats(data);
      }
    } catch (err) {
      console.error("Failed to fetch chat history list:", err);
    }
  }

  // Refetch chats when user changes
  useEffect(() => {
    fetchChats();
  }, [currentUser]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Load a selected chat session
  async function selectChat(chatId) {
    setActiveChatId(chatId);
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/chats/${chatId}?userId=${encodeURIComponent(currentUser)}`);
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
    try {
      const res = await fetch(`${BACKEND_URL}/chats/${chatId}?userId=${encodeURIComponent(currentUser)}`, {
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

  // Switch active user profile
  function handleSwitchUser(newUser) {
    localStorage.setItem("kapruka_user", newUser);
    setCurrentUser(newUser);
    // Clear chat display for the new user profile
    handleNewChat();
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

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: activeChatId,
          message: trimmed,
          userId: currentUser,
        }),
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

      if (data.products && data.products.length > 0) {
        setCurrentProducts(data.products);
        setSelectedProduct(null);
      }
      
      // Refresh chat sidebar to display updated titles/sessions
      fetchChats();
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: err.message || "Hmm, something went wrong on my end. Mind trying that again?",
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
    <div className="h-screen flex flex-col bg-cream-50 overflow-hidden">
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

          <div className="w-9 h-9 rounded-full bg-terracotta flex items-center justify-center font-display font-semibold">
            K
          </div>
          <div>
            <h1 className="font-display text-lg leading-tight">Kapu</h1>
            <p className="text-teal-50/70 text-xs">Your Kapruka shopping companion</p>
          </div>
        </div>
      </header>

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
          currentUser={currentUser}
          onSwitchUser={handleSwitchUser}
        />

        {/* Left Pane: Chat */}
        <div className="flex-1 flex flex-col min-w-0 h-full border-r border-cream-200">
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

        {/* Right Pane: Products */}
        <div className="w-full md:w-[380px] lg:w-[420px] shrink-0 h-full border-t md:border-t-0 md:border-l border-cream-200 bg-white">
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
