import { useRef, useState } from "react";

/**
 * ImageButton — camera icon button for the chat input bar.
 *
 * Props:
 *   onImageSelected(file: File)  — called with the chosen file
 *   disabled: boolean
 */
export default function ImageButton({ onImageSelected, disabled }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null); // object URL of chosen image
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  function handleClick() {
    if (disabled || isLoading) return;
    setError(null);
    inputRef.current?.click();
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate type
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    // Validate size (max 4 MB for Gemini inline_data)
    if (file.size > 4 * 1024 * 1024) {
      setError("Image must be under 4 MB.");
      return;
    }

    // Show preview
    const url = URL.createObjectURL(file);
    setPreview(url);
    setIsLoading(true);

    // Hand off to parent — parent clears state when done
    onImageSelected(file, () => {
      setIsLoading(false);
      setPreview(null);
      URL.revokeObjectURL(url);
      // Reset input so same file can be re-selected
      e.target.value = "";
    });
  }

  function dismissError() {
    setError(null);
  }

  return (
    <div className="relative flex items-center">
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        aria-label="Upload product image"
      />

      {/* Preview thumbnail shown while uploading */}
      {preview && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 animate-fade-in">
          <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-teal shadow-lg bg-white">
            <img
              src={preview}
              alt="Uploading preview"
              className="w-full h-full object-cover"
            />
            {/* Spinner overlay */}
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          </div>
          <span className="text-[10px] text-charcoal/60 bg-white/90 px-2 py-0.5 rounded-full shadow text-center whitespace-nowrap">
            Analyzing image…
          </span>
        </div>
      )}

      {/* Error tooltip */}
      {error && (
        <div
          className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 bg-red-500 text-white text-[11px] px-3 py-1.5 rounded-lg shadow-lg whitespace-nowrap cursor-pointer animate-fade-in"
          onClick={dismissError}
          role="alert"
        >
          {error} ✕
        </div>
      )}

      {/* Camera button */}
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isLoading}
        aria-label="Search by image"
        title="Search by image"
        className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-all duration-200
          ${
            isLoading
              ? "bg-teal/20 text-teal cursor-wait"
              : disabled
              ? "bg-cream-200 text-charcoal/30 cursor-not-allowed"
              : "bg-white border border-cream-200 text-teal hover:bg-teal hover:text-white hover:border-teal hover:shadow-md active:scale-95"
          }`}
      >
        {isLoading ? (
          /* Mini spinner when processing */
          <svg
            className="w-4 h-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
          >
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" />
          </svg>
        ) : (
          /* Camera icon */
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        )}
      </button>
    </div>
  );
}
