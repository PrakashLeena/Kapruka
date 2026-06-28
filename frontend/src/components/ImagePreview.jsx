/**
 * ImagePreview.jsx
 *
 * Displays a thumbnail preview of the selected image before sending it,
 * with a remove button and compression spinner.
 */

import React from "react";

export default function ImagePreview({ image, isCompressing, onRemove }) {
  if (!image && !isCompressing) return null;

  return (
    <div className="flex items-center gap-3 p-2 bg-cream-100/70 border-t border-cream-200 animate-fadeIn">
      <div className="relative group flex items-center justify-center bg-white border border-cream-300 rounded-xl overflow-hidden shadow-sm w-20 h-20 shrink-0">
        {isCompressing ? (
          <div className="flex flex-col items-center justify-center p-2 text-center">
            <svg
              className="animate-spin w-5 h-5 text-teal mb-1"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
            <span className="text-[9px] text-charcoal/50">Processing</span>
          </div>
        ) : (
          <>
            <img
              src={image}
              alt="Upload preview"
              className="w-full h-full object-cover"
            />
            <button
              type="button"
              onClick={onRemove}
              title="Remove image"
              aria-label="Remove image"
              className="absolute -top-1 -right-1 m-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full p-1 transition-all duration-150 shadow-md"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </>
        )}
      </div>
      <div className="text-xs text-charcoal/60">
        {isCompressing ? (
          <p className="font-semibold text-teal animate-pulse">Optimizing image size...</p>
        ) : (
          <div>
            <p className="font-semibold text-charcoal">Image attached</p>
            <p className="text-[10px] text-charcoal/40">Will be sent with your next prompt</p>
          </div>
        )}
      </div>
    </div>
  );
}
