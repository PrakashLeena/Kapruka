/**
 * ImageUpload.jsx
 *
 * A camera icon button that triggers the file input for image uploads.
 * Styled in line with the Kapu design system.
 */

import React, { useRef } from "react";

export default function ImageUpload({ onFileSelect, disabled }) {
  const fileInputRef = useRef(null);

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file);
      // Reset input value so the same file can be selected again if cleared
      e.target.value = "";
    }
  };

  return (
    <div className="relative flex items-center">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleChange}
        accept="image/jpeg,image/jpg,image/png,image/webp"
        className="hidden"
        disabled={disabled}
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        title="Upload an image"
        aria-label="Upload an image"
        className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-all duration-200 ${
          disabled
            ? "bg-cream-100 text-charcoal/20 cursor-not-allowed"
            : "bg-cream-200 hover:bg-cream-300 text-charcoal/60 hover:text-charcoal"
        }`}
      >
        <svg
          width="18"
          height="18"
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
      </button>
    </div>
  );
}
