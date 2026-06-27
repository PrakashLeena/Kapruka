/**
 * VoiceAnimation.jsx
 *
 * Renders visual feedback for the current voice state:
 *   - listening  → three concentric pulsing rings (red)
 *   - speaking   → five animated bars like an audio waveform (teal)
 *   - idle / thinking → nothing (null)
 *
 * All animation is pure CSS — no canvas, no external library.
 */

/**
 * @param {{ state: 'idle'|'listening'|'thinking'|'speaking' }} props
 */
export default function VoiceAnimation({ state }) {
  if (state === "listening") {
    return (
      <div
        className="voice-animation-listening"
        aria-hidden="true"
        title="Listening…"
      >
        <span className="voice-ring voice-ring-1" />
        <span className="voice-ring voice-ring-2" />
        <span className="voice-ring voice-ring-3" />
      </div>
    );
  }

  if (state === "speaking") {
    return (
      <div
        className="voice-animation-speaking"
        aria-hidden="true"
        title="Speaking…"
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`voice-bar voice-bar-${i}`} />
        ))}
      </div>
    );
  }

  return null;
}
