/**
 * ImageService.js
 *
 * Frontend service to handle image validation and compression.
 */

const SUPPORTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const ImageService = {
  /**
   * Validates if a file is a supported image and within size limits.
   * @param {File} file
   * @returns {string|null} Error message, or null if valid.
   */
  validate(file) {
    if (!file) {
      return "No file selected.";
    }

    if (!SUPPORTED_TYPES.includes(file.type)) {
      return "Unsupported file format. Please upload JPG, JPEG, PNG, or WEBP.";
    }

    if (file.size > MAX_SIZE_BYTES) {
      return "File size exceeds the 10 MB limit.";
    }

    return null;
  },

  /**
   * Compresses an image file using Canvas.
   * Resizes the image to fit within maxWidth/maxHeight and outputs it as a compressed JPEG.
   * @param {File} file
   * @param {number} maxWidth
   * @param {number} maxHeight
   * @param {number} quality
   * @returns {Promise<string>} Base64 data URL
   */
  compress(file, maxWidth = 1024, maxHeight = 1024, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          // Calculate new dimensions preserving aspect ratio
          let width = img.width;
          let height = img.height;

          if (width > maxWidth || height > maxHeight) {
            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Failed to get canvas context"));
            return;
          }

          // Draw image on canvas
          ctx.drawImage(img, 0, 0, width, height);

          // Convert to base64 jpeg
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve(dataUrl);
        };
        img.onerror = (err) => reject(err);
        img.src = event.target.result;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  }
};
