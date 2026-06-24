import { useState } from "react";

export default function ChatSidebar({
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  isOpen,
  onClose,
  currentUser,
  onSwitchUser,
}) {
  const [deletingId, setDeletingId] = useState(null);
  const [isEditingUser, setIsEditingUser] = useState(false);
  const [userInputValue, setUserInputValue] = useState("");

  const formatDate = (dateString) => {
    if (!dateString) return "";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };

  const handleDelete = async (e, chatId) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this chat session? This cannot be undone.")) {
      setDeletingId(chatId);
      try {
        await onDeleteChat(chatId);
      } finally {
        setDeletingId(null);
      }
    }
  };

  const handleUserSubmit = (e) => {
    e.preventDefault();
    const cleanUsername = userInputValue.trim();
    if (cleanUsername) {
      onSwitchUser(cleanUsername);
      setIsEditingUser(false);
    }
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-charcoal/40 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Panel */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-cream-100 border-r border-cream-200 flex flex-col transition-transform duration-300 md:static md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Sidebar Header / New Chat Button */}
        <div className="p-4 shrink-0 border-b border-cream-200/80 flex flex-col gap-3">
          <button
            onClick={() => {
              onNewChat();
              onClose?.();
            }}
            className="w-full bg-teal hover:bg-teal-light text-white font-medium py-2.5 px-4 rounded-xl shadow-md hover:shadow transition-all flex items-center justify-center gap-2 text-sm"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Chat
          </button>
        </div>

        {/* Chat List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-charcoal/50 uppercase tracking-wider">
            Recent Conversations
          </div>

          {chats.length === 0 ? (
            <div className="text-center py-8 px-4">
              <span className="text-2xl block mb-1">💬</span>
              <p className="text-xs text-charcoal/50">No previous chats yet.</p>
            </div>
          ) : (
            chats.map((chat) => {
              const isActive = chat.id === activeChatId;
              const isDeleting = chat.id === deletingId;

              return (
                <div
                  key={chat.id}
                  onClick={() => {
                    onSelectChat(chat.id);
                    onClose?.();
                  }}
                  className={`group relative flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                    isActive
                      ? "bg-white border border-cream-200 shadow-sm text-teal font-medium"
                      : "hover:bg-cream-50 text-charcoal/80"
                  }`}
                >
                  <span className="text-lg shrink-0">
                    {isActive ? "💬" : "✉️"}
                  </span>
                  <div className="flex-1 min-w-0 pr-6">
                    <p className="text-xs font-semibold truncate leading-tight">
                      {chat.title || "Untitled Conversation"}
                    </p>
                    <p className="text-[10px] text-charcoal/40 mt-1">
                      {formatDate(chat.createdAt)}
                    </p>
                  </div>

                  {/* Delete Button */}
                  <button
                    onClick={(e) => handleDelete(e, chat.id)}
                    disabled={isDeleting}
                    className="absolute right-2 opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-lg hover:bg-red-50 text-charcoal/40 hover:text-red-500 transition-all"
                    title="Delete Chat"
                  >
                    {isDeleting ? (
                      <div className="w-3.5 h-3.5 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* User Profile Section at the bottom */}
        <div className="p-4 shrink-0 border-t border-cream-200 bg-cream-100/50 flex flex-col gap-2">
          {isEditingUser ? (
            <form onSubmit={handleUserSubmit} className="flex gap-1.5 items-center">
              <input
                type="text"
                value={userInputValue}
                onChange={(e) => setUserInputValue(e.target.value)}
                placeholder="Enter username..."
                className="flex-1 bg-white border border-cream-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-teal"
                autoFocus
              />
              <button
                type="submit"
                className="bg-teal hover:bg-teal-light text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
              >
                Save
              </button>
            </form>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-full bg-teal text-white flex items-center justify-center font-bold text-xs shrink-0">
                  {currentUser.substring(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-charcoal/40 uppercase tracking-wider font-semibold">Logged in as</p>
                  <p className="text-xs font-bold text-charcoal truncate" title={currentUser}>
                    {currentUser}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setUserInputValue(currentUser);
                  setIsEditingUser(true);
                }}
                className="text-[10px] text-teal hover:underline font-semibold"
              >
                Switch
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
