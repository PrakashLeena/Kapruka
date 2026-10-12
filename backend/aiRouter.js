// aiRouter.js
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated Google Gemini AI router for the Kapruka Agent backend.
//
// Powers:
//   - Chat streaming completions with SSE
//   - Non-streaming chat completions
//   - Function / Tool calling with Kapruka MCP
//   - Gemini Vision for image-based product search
//   - Automatic multi-model failover for high availability & rate-limit resilience
// ─────────────────────────────────────────────────────────────────────────────

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });

// ─── Provider config ─────────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL   = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

// Fallback Gemini models in order of priority if a model hits quota or temporary demand spikes
const GEMINI_FALLBACK_MODELS = Array.from(new Set([
  GEMINI_MODEL,
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-flash-lite-latest",
  "gemini-flash-latest",
])).filter(Boolean);

// Timeout budgets (ms)
const GEMINI_TIMEOUT_MS = 60_000;
const IMAGE_TIMEOUT_MS  = 25_000;

// ─── Public: provider availability ───────────────────────────────────────────
/**
 * Returns a snapshot of whether Gemini is configured.
 * Used by /health endpoint and startup checks.
 */
export function getProviderStatus() {
  return {
    gemini: !!GEMINI_API_KEY,
  };
}

// ─── Internal: low-level fetch with retry ─────────────────────────────────────
/**
 * Helper to fetch with retries on HTTP 429 and 503 using exponential backoff.
 * Also handles transient fetch failures/timeouts.
 */
async function fetchWithRetry(url, options, maxRetries = 1, baseDelayMs = 600) {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, options);
      if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
        attempt++;
        const delay = baseDelayMs * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4);
        console.warn(`[aiRouter] HTTP ${res.status} from ${url}. Retrying attempt ${attempt}/${maxRetries} after ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < maxRetries && (err.name === "AbortError" || err.message.includes("fetch") || err.message.includes("network"))) {
        attempt++;
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(`[aiRouter] Network error/timeout fetching ${url}: ${err.message}. Retrying attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
}

/**
 * POST to Google Gemini API using the OpenAI-compatible endpoint.
 * @param {object[]} messages  OpenAI-format message array
 * @param {object[]|undefined} tools   OpenAI function-calling tools
 * @param {boolean} stream
 * @param {string} modelName
 * @returns {Promise<Response>}
 */
async function _fetchGemini(messages, tools, stream, modelName = GEMINI_MODEL) {
  const body = {
    model: modelName,
    messages,
    temperature: 0.2,
    top_p: 0.95,
    stream,
  };
  if (tools && tools.length > 0) body.tools = tools;

  return fetchWithRetry("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GEMINI_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
}

// ─── Public: streaming call ───────────────────────────────────────────────────
/**
 * Returns a live streaming Response from Google Gemini with automatic model failover.
 * The SSE wire format is OpenAI-compatible.
 *
 * @param {object[]} messages  Full message array (system + history + user)
 * @param {object[]|undefined} tools  OpenAI function-calling tool definitions
 * @returns {Promise<{ response: Response, provider: string }>}
 * @throws if Gemini API is not configured or all models fail
 */
export async function callPrimaryStream(messages, tools) {
  if (!GEMINI_API_KEY) {
    throw new Error("[aiRouter] GEMINI_API_KEY is not configured in environment variables.");
  }

  const modelErrors = [];

  for (const model of GEMINI_FALLBACK_MODELS) {
    try {
      console.log(`[aiRouter] → stream | provider: Google Gemini (${model})`);
      const res = await _fetchGemini(messages, tools, true, model);
      if (res.ok) return { response: res, provider: `gemini (${model})` };

      const errText = await res.text();
      const msg = `Gemini (${model}) ${res.status}: ${errText.slice(0, 200)}`;
      modelErrors.push(msg);
      console.warn(`[aiRouter] ${msg} — trying next Gemini candidate`);
    } catch (err) {
      const msg = `Gemini (${model}) error: ${err.message}`;
      modelErrors.push(msg);
      console.warn(`[aiRouter] ${msg} — trying next Gemini candidate`);
    }
  }

  throw new Error(`[aiRouter] All Gemini models failed: ${modelErrors.join(" | ")}`);
}

// ─── Public: non-streaming call ───────────────────────────────────────────────
/**
 * Returns parsed JSON data from Google Gemini with automatic model failover.
 *
 * @param {object[]} messages
 * @param {object[]|undefined} tools
 * @returns {Promise<{ data: object, provider: string }>}
 * @throws if Gemini API is not configured or all models fail
 */
export async function callPrimaryNonStream(messages, tools) {
  if (!GEMINI_API_KEY) {
    throw new Error("[aiRouter] GEMINI_API_KEY is not configured in environment variables.");
  }

  const modelErrors = [];

  for (const model of GEMINI_FALLBACK_MODELS) {
    try {
      console.log(`[aiRouter] → non-stream | provider: Google Gemini (${model})`);
      const res = await _fetchGemini(messages, tools, false, model);
      if (res.ok) {
        const data = await res.json();
        return { data, provider: `gemini (${model})` };
      }

      const errText = await res.text();
      const msg = `Gemini (${model}) ${res.status}: ${errText.slice(0, 200)}`;
      modelErrors.push(msg);
      console.warn(`[aiRouter] ${msg} — trying next Gemini candidate`);
    } catch (err) {
      const msg = `Gemini (${model}) non-stream error: ${err.message}`;
      modelErrors.push(msg);
      console.warn(`[aiRouter] ${msg} — trying next Gemini candidate`);
    }
  }

  throw new Error(`[aiRouter] All Gemini models failed: ${modelErrors.join(" | ")}`);
}

// ─── Public: image analysis (Gemini Vision) ──────────────────────────────────
/**
 * Extracts a concise product search query from a base64-encoded product image using Gemini Vision.
 *
 * @param {string} imageBase64  Base64-encoded image data (no data URI prefix)
 * @param {string} mimeType     e.g. "image/jpeg"
 * @returns {Promise<{ query: string, provider: string }>}
 * @throws if Gemini API is not configured or all models fail
 */
export async function analyzeImageForQuery(imageBase64, mimeType = "image/jpeg") {
  if (!GEMINI_API_KEY) {
    throw new Error("[aiRouter] GEMINI_API_KEY is not configured in environment variables.");
  }

  const prompt = `You are a shopping assistant for Kapruka.com, a Sri Lankan e-commerce site.
Look at this product image and extract a concise, specific product search query (3-8 words) 
that would find this exact product or similar products on an e-commerce platform.
Focus on: product type, key features, brand if visible, color/style if distinctive.
Reply with ONLY the search query — no explanation, no punctuation at the end.
Examples: "dark chocolate gift box", "birthday cake chocolate", "silk saree blue".`;

  const modelErrors = [];

  for (const model of GEMINI_FALLBACK_MODELS) {
    try {
      console.log(`[aiRouter] → image | provider: Gemini Vision (${model})`);
      const res = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
                { text: prompt },
              ],
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 64 },
          }),
          signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        }
      );

      if (res.ok) {
        const data = await res.json();
        const query = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (query) return { query, provider: `gemini (${model})` };
        console.warn(`[aiRouter] Gemini Vision (${model}) returned empty query — trying next candidate`);
      } else {
        const errText = await res.text();
        const msg = `Gemini Vision (${model}) ${res.status}: ${errText.slice(0, 200)}`;
        modelErrors.push(msg);
        console.warn(`[aiRouter] ${msg} — trying next candidate`);
      }
    } catch (err) {
      const msg = `Gemini Vision (${model}) error: ${err.message}`;
      modelErrors.push(msg);
      console.warn(`[aiRouter] ${msg} — trying next candidate`);
    }
  }

  throw new Error(`[aiRouter] Gemini Vision failed on all models: ${modelErrors.join(" | ")}`);
}
