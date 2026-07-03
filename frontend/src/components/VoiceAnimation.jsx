/**
 * VoiceAnimation.jsx
 *
 * Renders high-fidelity visual feedback matching the Gemini & ChatGPT voice experiences:
 *   - listening → 4 fluid, glowing, multi-colored waves pulsating gently
 *   - speaking  → 4 high-amplitude active waves dancing rapidly
 *
 * Designed to feel fluid, premium, and responsive.
 */

/**
 * @param {{ state: 'idle'|'listening'|'thinking'|'speaking' }} props
 */
export default function VoiceAnimation({ state }) {
  if (!state || state === "idle" || state === "thinking") return null;

  return (
    <div className="absolute bottom-12 right-0 sm:right-auto z-40 flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/90 backdrop-blur-md border border-cream-200 shadow-xl animate-fade-in-up">
      <span className="text-[10px] font-bold text-charcoal/50 uppercase tracking-wider select-none">
        {state === "listening" ? "Listening" : "Speaking"}
      </span>
      
      {/* Wave container: 4 colorful fluid visualizer bars */}
      <div className="flex items-center gap-1 h-5 w-10 justify-center">
        <span className={`w-1 rounded-full bg-teal animate-voice-bar-1 transition-all duration-300 ${
          state === "listening" ? "opacity-70 h-2" : "opacity-100 h-4"
        }`} />
        <span className={`w-1 rounded-full bg-terracotta animate-voice-bar-2 transition-all duration-300 ${
          state === "listening" ? "opacity-70 h-3" : "opacity-100 h-5"
        }`} />
        <span className={`w-1 rounded-full bg-amber-400 animate-voice-bar-3 transition-all duration-300 ${
          state === "listening" ? "opacity-70 h-1.5" : "opacity-100 h-3"
        }`} />
        <span className={`w-1 rounded-full bg-purple-500 animate-voice-bar-4 transition-all duration-300 ${
          state === "listening" ? "opacity-70 h-2.5" : "opacity-100 h-4.5"
        }`} />
      </div>
    </div>
  );
}
