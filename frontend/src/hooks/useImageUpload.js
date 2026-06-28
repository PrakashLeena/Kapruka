/**
 * useImageUpload.js
 *
 * Custom hook to manage the lifecycle of an uploaded image:
 * selection, validation, client-side compression, and state resetting.
 */

import { useState, useCallback } from "react";
import { ImageService } from "../services/ImageService.js";

export function useImageUpload() {
  const [image, setImage] = useState(null); // base64 compressed data URL
  const [error, setError] = useState(null);
  const [isCompressing, setIsCompressing] = useState(false);

  const processFile = useCallback(async (file) => {
    if (!file) return;

    setError(null);
    const validationError = ImageService.validate(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsCompressing(true);
    try {
      // Compress to a maximum of 1024x1024 to keep the base64 small and fast
      const compressedBase64 = await ImageService.compress(file, 1024, 1024, 0.7);
      setImage(compressedBase64);
    } catch (err) {
      console.error("[useImageUpload] Compression error:", err);
      setError("Failed to process the image. Please try another one.");
    } finally {
      setIsCompressing(false);
    }
  }, []);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  }, [processFile]);

  const clearImage = useCallback(() => {
    setImage(null);
    setError(null);
  }, []);

  return {
    image,
    error,
    isCompressing,
    processFile,
    handleFileChange,
    clearImage,
    setError
  };
}
