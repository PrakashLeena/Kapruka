// backend/services/sttService.js
//
// Azure Cognitive Services Speech-to-Text REST API wrapper.
// Supports Sinhala (si-LK), Tamil (ta-IN), and English (en-US).
//
// Azure STT DOES natively support si-LK — unlike the browser's Web Speech API
// (Chrome does not support Sinhala at all). This is the correct solution for
// Sinhala voice input.
//
// Region note: 'eastasia' is the primary region, and it supports both si-LK
// and ta-IN.

import https from "https";

const AZURE_SPEECH_KEY    = process.env.AZURE_SPEECH_KEY    || "";
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION || "eastasia";

// ─── Startup config validation ───────────────────────────────────────────────
if (!AZURE_SPEECH_KEY) {
  console.warn("[sttService] ⚠️  AZURE_SPEECH_KEY is not set. Speech-to-text will be disabled.");
  console.warn("[sttService]    → Set AZURE_SPEECH_KEY in Vercel environment variables (project: kapruka).");
} else if (AZURE_SPEECH_KEY.length < 20) {
  console.warn("[sttService] ⚠️  AZURE_SPEECH_KEY looks malformed (too short). Double-check it in Vercel env vars.");
}
if (!process.env.AZURE_SPEECH_REGION) {
  console.warn(`[sttService] ℹ️  AZURE_SPEECH_REGION not set — defaulting to '${AZURE_SPEECH_REGION}'.`);
}

// Keep-Alive HTTPS agent to optimize latency for concurrent Azure REST calls
const keepAliveAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 15000 });

// Fallback regions tried if the primary returns 400/404 for an unsupported
// language/locale. Fallbacks are a safety net.
const FALLBACK_REGIONS = ["centralindia", "southeastasia"];

export function isAzureSttConfigured() {
  return !!AZURE_SPEECH_KEY;
}

/**
 * Perform a single Azure STT REST call.
 *
 * @param {Buffer} audioBuffer
 * @param {string} language     - BCP-47 locale: 'si-LK' | 'ta-IN' | 'en-US'
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
      agent    : keepAliveAgent, // Reuse sockets for parallel requests
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

        // 401 / 403 = authentication failure (wrong/expired key). Propagate
        // immediately — retrying other regions won't help.
        // 400 / 404 = region or language not supported — allow fallback retry.
        if (res.statusCode === 401 || res.statusCode === 403) {
          const authErr = Object.assign(
            new Error(
              `Azure STT auth failure (HTTP ${res.statusCode}). ` +
              "The AZURE_SPEECH_KEY is likely expired or invalid — rotate it in the Azure Portal and update Vercel env vars."
            ),
            { httpStatus: res.statusCode }
          );
          return reject(authErr);
        }
        if (res.statusCode === 400 || res.statusCode === 404) {
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
 * @param {string} language     - BCP-47 locale: 'si-LK' | 'ta-IN' | 'en-US'
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
      // Auth failures (401/403) and network errors should not be retried.
      if (!err.httpStatus || err.httpStatus === 401 || err.httpStatus === 403) {
        throw err;
      }
      console.warn(`[Azure STT] Region '${region}' returned HTTP ${err.httpStatus} for lang=${language}. Trying next region...`);
    }
  }

  throw lastError;
}

// Common English words (stop words and conversational/shopping terms).
// Used to identify if the en-US transcriber produced a coherent English phrase.
const COMMON_ENGLISH_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "for", "to", "in", "on", "at", "by", "of", "with",
  "about", "is", "was", "are", "were", "been", "have", "has", "had", "do", "does", "did",
  "i", "you", "he", "she", "it", "we", "they", "my", "your", "his", "her", "its", "our", "their",
  "me", "him", "us", "them", "this", "that", "these", "those", "what", "which", "who", "why", "how",
  "where", "when", "some", "any", "no", "not", "all", "can", "will", "just", "should", "would",
  "show", "send", "gift", "gifts", "cake", "cakes", "flower", "flowers", "chocolate", "chocolates",
  "buy", "order", "price", "delivery", "deliver", "location", "address", "cost", "hello", "hi",
  "please", "thank", "thanks", "wife", "mother", "father", "husband", "friend", "birthday",
  "anniversary", "today", "tomorrow", "yesterday", "now", "here", "there", "good", "morning",
  "evening", "night", "day", "welcome", "card", "message", "write", "happy", "love", "sorry",
  "apology", "wrong", "late", "drink", "beer", "wine", "alcohol", "drunk", "angry", "upset",
  "want", "need", "like", "love", "prefer", "choose", "select", "find", "search", "get"
]);

/**
 * Calculate the proportion of valid English words in a text block.
 *
 * @param {string} text
 * @returns {number} Float 0.0 to 1.0 representing English word density
 */
function getEnglishScore(text) {
  if (!text) return 0;
  const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const matches = words.filter(w => COMMON_ENGLISH_WORDS.has(w)).length;
  return matches / words.length;
}

/**
 * Automatically identify language and transcribe the spoken audio.
 * Runs transcriptions for Sinhala, Tamil, and English in parallel, then
 * picks the most accurate result using script analysis (detecting native
 * Unicode ranges for regional scripts) and English syntax scoring.
 *
 * @param {Buffer} audioBuffer
 * @param {string} contentType
 * @returns {Promise<{ transcript: string, language: 'sinhala'|'tamil'|'english' }>}
 */
export async function transcribeSpeechAuto(
  audioBuffer,
  contentType = "audio/webm;codecs=opus"
) {
  console.log(`[Azure STT] Starting parallel language auto-detection...`);
  const t0 = Date.now();

  const [siResult, taResult, enResult] = await Promise.allSettled([
    transcribeSpeech(audioBuffer, "si-LK", contentType),
    transcribeSpeech(audioBuffer, "ta-IN", contentType),
    transcribeSpeech(audioBuffer, "en-US", contentType),
  ]);

  const siText = siResult.status === "fulfilled" ? siResult.value : "";
  const taText = taResult.status === "fulfilled" ? taResult.value : "";
  const enText = enResult.status === "fulfilled" ? enResult.value : "";

  console.log(`[Azure STT] Parallel LID completed in ${Date.now() - t0}ms`);
  console.log(` -> Sinhala (si-LK): "${siText}"`);
  console.log(` -> Tamil (ta-IN):   "${taText}"`);
  console.log(` -> English (en-US): "${enText}"`);

  // Detect script characters to verify regional language matches
  const hasSinhalaScript = /[\u0D80-\u0DFF]/.test(siText);
  const hasTamilScript   = /[\u0B80-\u0BFF]/.test(taText);

  // Evaluate the English transcription quality
  const enScore = getEnglishScore(enText);
  const enWordCount = enText.trim().split(/\s+/).filter(Boolean).length;
  console.log(` -> English evaluation: score=${enScore.toFixed(2)}, wordCount=${enWordCount}`);

  // If the English transcript contains coherent English grammar/words, trust it
  // over the Sinhala/Tamil engines, which will otherwise write English words
  // phonetically in Sinhala/Tamil script (e.g. transcribing "birthday gift" as "බර්ත්ඩේ ගිෆ්ට්").
  const isCoherentEnglish = enScore >= 0.6 && enWordCount >= 2;

  if (isCoherentEnglish) {
    return { transcript: enText.trim(), language: "english" };
  }

  // 1. Prioritize native Sinhala script matched from the si-LK engine
  if (hasSinhalaScript && siText.trim()) {
    return { transcript: siText.trim(), language: "sinhala" };
  }

  // 2. Prioritize native Tamil script matched from the ta-IN engine
  if (hasTamilScript && taText.trim()) {
    return { transcript: taText.trim(), language: "tamil" };
  }

  // 3. Fallback to English transcript if it produced a non-empty result
  if (enText.trim()) {
    return { transcript: enText.trim(), language: "english" };
  }

  // 4. Final safety fallbacks if no script or English text matched
  if (siText.trim()) {
    return { transcript: siText.trim(), language: "sinhala" };
  }
  if (taText.trim()) {
    return { transcript: taText.trim(), language: "tamil" };
  }

  return { transcript: "", language: "english" };
}
