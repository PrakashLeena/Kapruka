// backend/services/sttService.js
//
// Azure Cognitive Services Speech-to-Text REST API wrapper.
// Supports Sinhala (si-LK), Tamil (ta-LK), and English (en-US).
//
// Azure STT DOES natively support si-LK — unlike the browser's Web Speech API
// (Chrome does not support Sinhala at all). This is the correct solution for
// Sinhala voice input.
//
// Region note: 'centralindia' has the broadest language coverage including
// si-LK, ta-LK and en-US. The older 'eastasia' region does NOT support si-LK.

import https from "https";

const AZURE_SPEECH_KEY    = process.env.AZURE_SPEECH_KEY    || "";
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION || "eastasia";

// Fallback regions tried if the primary returns 400/404 for an unsupported
// language/locale. eastasia supports si-LK, ta-LK, en-US. Fallbacks are a
// safety net in case a specific locale isn't available in the primary region.
const FALLBACK_REGIONS = ["centralindia", "southeastasia"];

export function isAzureSttConfigured() {
  return !!AZURE_SPEECH_KEY;
}

/**
 * Perform a single Azure STT REST call.
 *
 * @param {Buffer} audioBuffer
 * @param {string} language     - BCP-47 locale: 'si-LK' | 'ta-LK' | 'en-US'
 * @param {string} contentType
 * @param {string} region       - Azure region slug
 * @returns {Promise<string>}   Transcribed text, or '' if no speech detected
 * @throws  {Error}             On HTTP/network errors or unrecognised statuses
 */
function _callAzureSTT(audioBuffer, language, contentType, region) {
  const endpoint =
    `https://${region}.stt.speech.microsoft.com` +
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
        console.log(`[Azure STT] HTTP ${res.statusCode} | region=${region} | lang=${language} | body=${body.slice(0, 300)}`);

        // 4xx on these endpoints typically means the region or key is wrong.
        // Propagate so the caller can retry with a fallback region.
        if (res.statusCode === 400 || res.statusCode === 404 || res.statusCode === 403) {
          return reject(Object.assign(
            new Error(`Azure STT HTTP ${res.statusCode}: ${body.slice(0, 200)}`),
            { httpStatus: res.statusCode }
          ));
        }

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

/**
 * Transcribe audio using Azure Cognitive Services Speech-to-Text REST API.
 * Automatically retries with fallback regions if the primary region returns
 * a 400/404 (e.g. unsupported language in that region).
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

  const regionsToTry = [AZURE_SPEECH_REGION, ...FALLBACK_REGIONS.filter(r => r !== AZURE_SPEECH_REGION)];

  let lastError;
  for (const region of regionsToTry) {
    try {
      const transcript = await _callAzureSTT(audioBuffer, language, contentType, region);
      if (region !== AZURE_SPEECH_REGION) {
        console.warn(`[Azure STT] Primary region '${AZURE_SPEECH_REGION}' failed for ${language}; succeeded with fallback '${region}'.`);
      }
      return transcript;
    } catch (err) {
      lastError = err;
      // Only retry on HTTP 400/404 (region/language not supported).
      // For timeouts, network errors, or auth failures (403 key issue), propagate immediately.
      if (!err.httpStatus || err.httpStatus === 403) {
        throw err;
      }
      console.warn(`[Azure STT] Region '${region}' returned HTTP ${err.httpStatus} for lang=${language}. Trying next region...`);
    }
  }

  throw lastError;
}
