export default function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-4 py-3 rounded-2xl rounded-bl-sm bg-white border border-cream-200 w-fit">
      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-teal" style={{ animationDelay: "0ms" }} />
      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-teal" style={{ animationDelay: "150ms" }} />
      <span className="typing-dot w-1.5 h-1.5 rounded-full bg-teal" style={{ animationDelay: "300ms" }} />
    </div>
  );
}
