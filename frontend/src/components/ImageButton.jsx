import { useRef, useState, useEffect } from "react";

/**
 * ImageButton — camera icon button for the chat input bar.
 * Provides instant in-app camera capture as well as photo gallery uploads.
 *
 * Props:
 *   onImageSelected(file: File, callback: () => void)  — called with chosen file
 *   disabled: boolean
 */
export default function ImageButton({ onImageSelected, disabled }) {
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [preview, setPreview] = useState(null); // object URL of chosen image
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // UI state for selection popover and camera overlay modal
  const [showMenu, setShowMenu] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState("environment"); // default to back camera

  // Start the webcam stream when the camera overlay modal is opened
  useEffect(() => {
    if (cameraOpen) {
      startCamera();
    } else {
      stopCameraStream();
    }
    return () => stopCameraStream();
  }, [cameraOpen, facingMode]);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // ── Camera Helpers ──────────────────────────────────────────────────────────

  async function startCamera() {
    stopCameraStream();
    try {
      const constraints = {
        video: {
          facingMode: facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("[Camera] Access failed:", err);
      setError("Unable to access camera. Please check your system permissions.");
      setCameraOpen(false);
    }
  }

  function stopCameraStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  function toggleCameraFacing() {
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
  }

  function capturePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas) {
      const ctx = canvas.getContext("2d");
      // Set canvas size to match current video stream feed dimensions
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            setError("Failed to capture image.");
            return;
          }
          const file = new File([blob], `capture_${Date.now()}.jpg`, { type: "image/jpeg" });
          setCameraOpen(false);
          processFile(file);
        },
        "image/jpeg",
        0.85
      );
    }
  }

  // ── Image Validation & Processing ──────────────────────────────────────────

  function processFile(file) {
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
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    });
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  }

  function handleClick() {
    if (disabled || isLoading) return;
    setError(null);
    setShowMenu((v) => !v);
  }

  function handleOpenGallery() {
    setShowMenu(false);
    fileInputRef.current?.click();
  }

  function handleOpenCamera() {
    setShowMenu(false);
    setCameraOpen(true);
  }

  return (
    <div className="relative flex items-center">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        aria-label="Upload product image"
      />

      {/* Choice Menu Popover */}
      {showMenu && (
        <>
          {/* Backdrop layer to click-out and dismiss the popover */}
          <div className="fixed inset-0 z-20" onClick={() => setShowMenu(false)} />
          
          <div className="absolute bottom-12 right-0 bg-white border border-cream-200 rounded-2xl shadow-xl z-30 py-1.5 min-w-[170px] animate-fade-in overflow-hidden">
            <button
              type="button"
              onClick={handleOpenCamera}
              className="w-full text-left px-4 py-2.5 text-xs hover:bg-cream-50 text-charcoal flex items-center gap-2.5 font-semibold transition-colors"
            >
              <span className="text-sm">📸</span> Open Camera
            </button>
            <button
              type="button"
              onClick={handleOpenGallery}
              className="w-full text-left px-4 py-2.5 text-xs hover:bg-cream-50 text-charcoal flex items-center gap-2.5 font-semibold transition-colors border-t border-cream-100/70"
            >
              <span className="text-sm">🖼️</span> Choose from Gallery
            </button>
          </div>
        </>
      )}

      {/* Instant In-App Camera Overlay Modal */}
      {cameraOpen && (
        <div className="fixed inset-0 bg-neutral-950 z-50 flex flex-col justify-between items-center pb-8 pt-6 select-none animate-fade-in">
          {/* Header */}
          <div className="w-full max-w-md px-6 flex justify-between items-center text-white shrink-0">
            <h3 className="font-display font-bold text-sm tracking-wide">Take Product Photo</h3>
            <button
              type="button"
              onClick={() => setCameraOpen(false)}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors text-sm font-semibold"
              aria-label="Close camera"
            >
              ✕
            </button>
          </div>

          {/* Live Video Window */}
          <div className="flex-1 w-full max-w-md aspect-square max-h-[60vh] bg-neutral-900 overflow-hidden flex items-center justify-center relative my-4 sm:rounded-3xl border border-white/10 shadow-2xl">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
            {/* Hidden canvas for capturing frame */}
            <canvas ref={canvasRef} className="hidden" />
          </div>

          {/* Controls Bar */}
          <div className="w-full max-w-md px-8 flex justify-around items-center shrink-0">
            {/* Toggle Front / Back Camera */}
            <button
              type="button"
              onClick={toggleCameraFacing}
              className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-white text-base transition-all active:scale-90"
              title="Switch Camera"
            >
              🔄
            </button>

            {/* Shutter Button */}
            <button
              type="button"
              onClick={capturePhoto}
              className="w-16 h-16 rounded-full border-4 border-white bg-white hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
              aria-label="Capture photo"
            >
              <div className="w-12 h-12 rounded-full bg-white border border-charcoal/10 shadow-inner" />
            </button>

            {/* Spacer to keep Shutter centered */}
            <div className="w-12 h-12" />
          </div>
        </div>
      )}

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
          className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 bg-red-500 text-white text-[11px] px-3 py-1.5 rounded-lg shadow-lg whitespace-nowrap cursor-pointer animate-fade-in font-medium"
          onClick={() => setError(null)}
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
        className={`w-8 h-8 sm:w-10 sm:h-10 shrink-0 rounded-full flex items-center justify-center transition-all duration-200
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
