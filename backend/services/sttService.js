// backend/services/sttService.js
//
// Azure Cognitive Services Speech-to-Text REST API wrapper.
// Supports Sinhala (si-LK), Tamil (ta-LK), and English (en-US).
//
// Azure STT DOES natively support si-LK — unlike the browser's Web Speech API
// (Chrome does not support Sinhala at all). This is the correct solution for
// Sinhala voice input.

import https from "https";

const AZURE_SPEECH_KEY    = process.env.AZURE_SPEECH_KEY    || "";
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION || "eastasia";

export function isAzureSttConfigured() {
  return !!AZURE_SPEECH_KEY;
}

/**
 * Transcribe audio using Azure Cognitive Services Speech-to-Text REST API.
 *
 * @param {Buffer} audioBuffer  - Raw audio binary (webm/opus, ogg/opus, or wav)
 * @param {string} language     - BCP-47 locale: 'si-LK' | 'ta-LK' | 'en-US'
 * @param {string} contentType  - MIME type matching the audio data
 * @returns {Promise<string>}   Transcribed text, or '' if no speech detected
 */
export async function transcribeSpeech(
  audioBuffer,
  language    = "si-LK",
  contentType = "audio/webm;codecs=opus"
) {
  if (!AZURE_SPEECH_KEY) {
    throw new Error("AZURE_SPEECH_KEY is not configured. Set it in your .env and Vercel environment variables.");
  }
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error("No audio data provided to transcribeSpeech.");
  }

  // Azure STT REST API endpoint
  // format=simple → returns { RecognitionStatus, DisplayText, Duration, Offset }
  const endpoint =
    `https://${AZURE_SPEECH_REGION}.stt.speech.microsoft.com` +
    `/speech/recognition/conversation/cognitiveservices/v1` +
    `?language=${encodeURIComponent(language)}&format=simple`;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(endpoint);

    const options = {
      hostname : urlObj.hostname,
      path     : urlObj.pathname + urlObj.search,
      method   : "POST",
      headers  : {
        "Ocp-Apim-Subscription-Key" : AZURE_SPEECH_KEY,
        "Content-Type"              : contentType,
        "Content-Length"            : audioBuffer.length,
        "Accept"                    : "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data",  (chunk) => { body += chunk; });
      res.on("end",   () => {
        console.log(`[Azure STT] HTTP ${res.statusCode} | lang=${language} | body=${body.slice(0, 300)}`);
        try {
          const json = JSON.parse(body);
          const status = json.RecognitionStatus;
          if (status === "Success") {
            resolve(json.DisplayText || "");
          } else if (
            status === "NoMatch" ||
            status === "InitialSilenceTimeout" ||
            status === "EndSilenceTimeout"
          ) {
            resolve(""); // silence / no speech — not an error
          } else {
            reject(new Error(`Azure STT error: ${status} | ${body.slice(0, 200)}`));
          }
        } catch (parseErr) {
          reject(new Error(`Azure STT parse error. HTTP ${res.statusCode}. Body: ${body.slice(0, 200)}`));
        }
      });
    });

    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error("Azure STT request timed out after 20 s"));
    });

    req.on("error", (err) => reject(new Error(`Azure STT network error: ${err.message}`)));
    req.write(audioBuffer);
    req.end();
  });
}
