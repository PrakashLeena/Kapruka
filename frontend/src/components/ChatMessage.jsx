import OrderCard from "./OrderCard.jsx";

export default function ChatMessage({ message, onAddToCart }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-terracotta text-white px-4 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed">
          {message.text}
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
          <div className="bg-white border border-cream-200 border-l-[3px] border-l-teal px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed">
            {message.text}
            {/* Blinking cursor shown while the LLM is still streaming tokens */}
            {message.streaming && (
              <span
                className="inline-block w-[2px] h-[1em] bg-teal ml-0.5 align-middle animate-pulse"
                aria-hidden="true"
              />
            )}
          </div>
        )}
        {message.order && <OrderCard order={message.order} />}
      </div>
    </div>
  );
}
