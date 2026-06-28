/**
 * imageService.js
 *
 * Backend service for validating incoming images and formatting
 * multimodal request payloads for NVIDIA NIM API / Qwen 3.5.
 */

export const ImageService = {
  /**
   * Validates incoming base64 image.
   * @param {string} imageBase64
   * @returns {boolean} True if valid, throws error otherwise.
   */
  validate(imageBase64) {
    if (!imageBase64) {
      throw new Error("No image data provided.");
    }

    if (!imageBase64.startsWith("data:image/")) {
      throw new Error("Invalid image format. Must be a base64 encoded data URL.");
    }

    // Check size from base64 string length
    const sizeInBytes = (imageBase64.length * 3) / 4;
    const maxSizeBytes = 10 * 1024 * 1024; // 10MB limit

    if (sizeInBytes > maxSizeBytes) {
      throw new Error("Uploaded image exceeds the 10 MB size limit.");
    }

    return true;
  },

  /**
   * Compiles the text prompt and base64 image into standard OpenAI multimodal format.
   * @param {string} textPrompt
   * @param {string} imageBase64
   * @returns {Array<Object>} Message content array
   */
  buildMultimodalPayload(textPrompt, imageBase64) {
    const content = [];

    // Add text query if present
    if (textPrompt && textPrompt.trim()) {
      content.push({
        type: "text",
        text: textPrompt.trim()
      });
    }

    // Add base64 image if present
    if (imageBase64) {
      content.push({
        type: "image_url",
        image_url: {
          url: imageBase64
        }
      });
    }

    return content;
  }
};
