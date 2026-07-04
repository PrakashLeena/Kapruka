// aiRouter.js
// ─────────────────────────────────────────────────────────────────────────────
// Central AI client factory and routing layer for the Kapruka Agent backend.
//
// Request routing priority (highest → lowest):
//   1. TGI — your fine-tuned Qwen3-14B LoRA served via Hugging Face TGI
//             (set TGI_ENDPOINT_URL + optionally TGI_API_KEY)
//   2. OpenAI GPT-4o — fallback; fires when TGI is absent, times out, or
//             returns a non-200 (set OPENAI_API_KEY)
//   3. NVIDIA Qwen 3.5 — third-tier fallback; fires when TGI and OpenAI both fail
//             (set NVIDIA_QWEN_KEY)
//   4. Gemini flash — used as a secondary fallback for image analysis only
//             (set GEMINI_API_KEY)
// ─────────────────────────────────────────────────────────────────────────────

// ─── Provider config (read at module load; dotenv already applied in server.js) ──
const TGI_ENDPOINT_URL = process.env.TGI_ENDPOINT_URL?.replace(/\/$/, "") || "";
const TGI_API_KEY      = process.env.TGI_API_KEY || "";
// TGI_MODEL: use "tgi" for Hugging Face TGI endpoints (the model name is ignored by real TGI)
// or the actual model slug for NVIDIA NIM / other OpenAI-compatible providers.
// Example for NVIDIA NIM: TGI_MODEL=qwen/qwen3.5-397b-a17b
const TGI_MODEL        = process.env.TGI_MODEL || "tgi";
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY || "";
const GEMINI_API_KEY   = process.env.GEMINI_API_KEY || "";
const NVIDIA_QWEN_KEY  = process.env.NVIDIA_QWEN_KEY || "";

// Startup sanity check: warn if TGI_ENDPOINT_URL looks like NVIDIA NIM but TGI_MODEL is still
// the default "tgi" placeholder (which NVIDIA NIM will reject with a 400 bad model error).
if (TGI_ENDPOINT_URL.includes("integrate.api.nvidia.com") && TGI_MODEL === "tgi") {
  console.warn(
    "[aiRouter] ⚠️  TGI_ENDPOINT_URL points to NVIDIA NIM but TGI_MODEL is still 'tgi'. " +
    "NVIDIA NIM will reject this with a 400 error. " +
    "Set TGI_MODEL=qwen/qwen3.5-397b-a17b (or your chosen NIM model slug) in Vercel env vars."
  );
}

// Timeout budgets (ms)
const TGI_TIMEOUT_MS         = 30_000;
const OPENAI_TIMEOUT_MS      = 60_000;
const NVIDIA_QWEN_TIMEOUT_MS = 60_000;
const IMAGE_TIMEOUT_MS       = 20_000;

// ─── Public: provider availability ───────────────────────────────────────────
/**
 * Returns a snapshot of which providers are currently configured.
 * Used by the /health endpoint and startup logs.
 */
export function getProviderStatus() {
  return {
    tgi:    !!TGI_ENDPOINT_URL,
    openai: !!OPENAI_API_KEY,
    qwen35: !!NVIDIA_QWEN_KEY,
    gemini: !!GEMINI_API_KEY,
  };
}

// ─── Internal: low-level fetch wrappers ──────────────────────────────────────

/**
 * Helper to fetch with retries on HTTP 429 (Too Many Requests) using exponential backoff.
 * Also handles transient fetch failures/timeouts.
 */
async function fetchWithRetry(url, options, maxRetries = 3, baseDelayMs = 1000) {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429 && attempt < maxRetries) {
        attempt++;
        const delay = baseDelayMs * Math.pow(2, attempt - 1) * (0.8 + Math.random() * 0.4); // exponential backoff with jitter
        console.warn(`[aiRouter] HTTP 429 received from ${url}. Retrying attempt ${attempt}/${maxRetries} after ${Math.round(delay)}ms...`);
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
 * POST to the HF TGI endpoint (OpenAI-compatible /v1/chat/completions).
 * @param {object[]} messages  OpenAI-format message array
 * @param {object[]|undefined} tools   OpenAI function-calling tools
 * @param {boolean} stream
 * @returns {Promise<Response>}
 */
async function _fetchTGI(messages, tools, stream) {
  const body = {
    model: TGI_MODEL,   // "tgi" for HF TGI endpoints; set TGI_MODEL env var for NVIDIA NIM / other providers
    messages,
    temperature: 0.2,
    top_p: 1,
    stream,
  };
  if (tools && tools.length > 0) body.tools = tools;

  return fetchWithRetry(`${TGI_ENDPOINT_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(TGI_API_KEY ? { Authorization: `Bearer ${TGI_API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TGI_TIMEOUT_MS),
  });
}

/**
 * POST to the OpenAI API.
 * @param {object[]} messages
 * @param {object[]|undefined} tools
 * @param {boolean} stream
 * @returns {Promise<Response>}
 */
async function _fetchOpenAI(messages, tools, stream) {
  const body = {
    model: "gpt-4o",
    messages,
    temperature: 0.2,
    top_p: 1,
    stream,
  };
  if (tools && tools.length > 0) body.tools = tools;

  return fetchWithRetry("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
  });
}

/**
 * POST to NVIDIA Qwen 3.5 model endpoint.
 * @param {object[]} messages
 * @param {object[]|undefined} tools
 * @param {boolean} stream
 * @returns {Promise<Response>}
 */
async function _fetchNvidiaQwen(messages, tools, stream) {
  const body = {
    model: "qwen/qwen3.5-397b-a17b",
    messages,
    temperature: 0.60,
    top_p: 0.95,
    top_k: 20,
    presence_penalty: 0,
    repetition_penalty: 1,
    stream,
  };
  if (tools && tools.length > 0) body.tools = tools;

  return fetchWithRetry("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${NVIDIA_QWEN_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(NVIDIA_QWEN_TIMEOUT_MS),
  });
}

// ─── Public: streaming call ───────────────────────────────────────────────────

/**
 * Returns a live streaming Response from the best available LLM provider.
 * The SSE format is OpenAI-compatible regardless of which provider wins.
 *
 * Route: TGI (if configured) → OpenAI GPT-4o → NVIDIA Qwen 3.5
 *
 * @param {object[]} messages  Full message array (system + history + user)
 * @param {object[]|undefined} tools  OpenAI function-calling tool definitions
 * @returns {Promise<{ response: Response, provider: string }>}
 * @throws if all configured providers fail
 */
export async function callPrimaryStream(messages, tools) {
  // ── Tier 1: TGI (fine-tuned Qwen3-14B) ──────────────────────────────────
  if (TGI_ENDPOINT_URL) {
    try {
      console.log("[aiRouter] → stream | provider: TGI (Qwen3-14B)");
      const res = await _fetchTGI(messages, tools, true);
      if (res.ok) return { response: res, provider: "tgi" };

      const errText = await res.text();
      console.warn(`[aiRouter] TGI ${res.status} — falling back to OpenAI. Body: ${errText.slice(0, 200)}`);
    } catch (err) {
      console.warn(`[aiRouter] TGI error: ${err.message} — falling back to OpenAI`);
    }
  }

  // ── Tier 2: OpenAI GPT-4o ────────────────────────────────────────────────
  let lastErrorMsg = "";
  if (OPENAI_API_KEY) {
    try {
      console.log("[aiRouter] → stream | provider: OpenAI GPT-4o (fallback)");
      const res = await _fetchOpenAI(messages, tools, true);
      if (res.ok) return { response: res, provider: "openai" };

      const errText = await res.text();
      lastErrorMsg = `OpenAI ${res.status}: ${errText.slice(0, 200)}`;
      console.warn(`[aiRouter] ${lastErrorMsg} — falling back to NVIDIA Qwen 3.5`);
    } catch (err) {
      lastErrorMsg = `OpenAI error: ${err.message}`;
      console.warn(`[aiRouter] ${lastErrorMsg} — falling back to NVIDIA Qwen 3.5`);
    }
  }

  // ── Tier 3: NVIDIA Qwen 3.5 ─────────────────────────────────────────────
  if (NVIDIA_QWEN_KEY) {
    try {
      console.log("[aiRouter] → stream | provider: NVIDIA Qwen 3.5 (397B fallback)");
      const res = await _fetchNvidiaQwen(messages, tools, true);
      if (res.ok) return { response: res, provider: "qwen35" };

      const errText = await res.text();
      throw new Error(`NVIDIA Qwen ${res.status}: ${errText.slice(0, 300)}`);
    } catch (err) {
      throw new Error(`[aiRouter] All stream providers failed. Last: ${err.message}`);
    }
  }

  throw new Error(`[aiRouter] No streaming LLM provider configured or succeeded. (Tried TGI, OpenAI, Qwen). Last error: ${lastErrorMsg}`);
}

// ─── Public: non-streaming call ───────────────────────────────────────────────

/**
 * Returns parsed JSON data from the best available LLM provider (no streaming).
 * Used by the POST /chat (non-SSE) endpoint.
 *
 * @param {object[]} messages
 * @param {object[]|undefined} tools
 * @returns {Promise<{ data: object, provider: string }>}
 * @throws if all configured providers fail
 */
export async function callPrimaryNonStream(messages, tools) {
  // ── Tier 1: TGI ──────────────────────────────────────────────────────────
  if (TGI_ENDPOINT_URL) {
    try {
      console.log("[aiRouter] → non-stream | provider: TGI (Qwen3-14B)");
      const res = await _fetchTGI(messages, tools, false);
      if (res.ok) {
        const data = await res.json();
        return { data, provider: "tgi" };
      }
      const errText = await res.text();
      console.warn(`[aiRouter] TGI ${res.status} — falling back to OpenAI. Body: ${errText.slice(0, 200)}`);
    } catch (err) {
      console.warn(`[aiRouter] TGI non-stream error: ${err.message} — falling back to OpenAI`);
    }
  }

  // ── Tier 2: OpenAI GPT-4o ────────────────────────────────────────────────
  let lastErrorMsg = "";
  if (OPENAI_API_KEY) {
    try {
      console.log("[aiRouter] → non-stream | provider: OpenAI GPT-4o (fallback)");
      const res = await _fetchOpenAI(messages, tools, false);
      if (res.ok) {
        const data = await res.json();
        return { data, provider: "openai" };
      }
      const errText = await res.text();
      lastErrorMsg = `OpenAI ${res.status}: ${errText.slice(0, 200)}`;
      console.warn(`[aiRouter] ${lastErrorMsg} — falling back to NVIDIA Qwen 3.5`);
    } catch (err) {
      lastErrorMsg = `OpenAI non-stream error: ${err.message}`;
      console.warn(`[aiRouter] ${lastErrorMsg} — falling back to NVIDIA Qwen 3.5`);
    }
  }

  // ── Tier 3: NVIDIA Qwen 3.5 ─────────────────────────────────────────────
  if (NVIDIA_QWEN_KEY) {
    try {
      console.log("[aiRouter] → non-stream | provider: NVIDIA Qwen 3.5 (397B fallback)");
      const res = await _fetchNvidiaQwen(messages, tools, false);
      if (res.ok) {
        const data = await res.json();
        return { data, provider: "qwen35" };
      }
      const errText = await res.text();
      throw new Error(`NVIDIA Qwen ${res.status}: ${errText.slice(0, 300)}`);
    } catch (err) {
      throw new Error(`[aiRouter] All non-stream providers failed. Last: ${err.message}`);
    }
  }

  throw new Error(`[aiRouter] No non-streaming LLM provider configured or succeeded. Last error: ${lastErrorMsg}`);
}

// ─── Public: image analysis ───────────────────────────────────────────────────

/**
 * Extracts a short product search query from a base64-encoded product image.
 * Tries GPT-4o Vision first (better accuracy), falls back to Gemini 1.5 Flash.
 *
 * @param {string} imageBase64  Base64-encoded image data (no data URI prefix)
 * @param {string} mimeType     e.g. "image/jpeg"
 * @returns {Promise<{ query: string, provider: string }>}
 * @throws if all image providers fail
 */
export async function analyzeImageForQuery(imageBase64, mimeType = "image/jpeg") {
  const prompt = `You are a shopping assistant for Kapruka.com, a Sri Lankan e-commerce site.
Look at this product image and extract a concise, specific product search query (3-8 words) 
that would find this exact product or similar products on an e-commerce platform.
Focus on: product type, key features, brand if visible, color/style if distinctive.
Reply with ONLY the search query — no explanation, no punctuation at the end.
Examples: "dark chocolate gift box", "birthday cake chocolate", "silk saree blue".`;

  // ── Tier 1: GPT-4o Vision ─────────────────────────────────────────────────
  if (OPENAI_API_KEY) {
    try {
      console.log("[aiRouter] → image | provider: GPT-4o Vision");
      const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${imageBase64}`,
                  detail: "low",   // "low" keeps costs down for thumbnail-quality queries
                },
              },
              { type: "text", text: prompt },
            ],
          }],
          max_tokens: 64,
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      });

      if (res.ok) {
        const data = await res.json();
        const query = data.choices?.[0]?.message?.content?.trim();
        if (query) return { query, provider: "openai" };
        console.warn("[aiRouter] GPT-4o Vision returned empty query — falling back to Gemini");
      } else {
        const errText = await res.text();
        console.warn(`[aiRouter] GPT-4o Vision ${res.status} — falling back to Gemini. Body: ${errText.slice(0, 200)}`);
      }
    } catch (err) {
      console.warn(`[aiRouter] GPT-4o Vision error: ${err.message} — falling back to Gemini`);
    }
  }

  // ── Tier 2: Gemini 1.5 Flash Vision ──────────────────────────────────────
  if (GEMINI_API_KEY) {
    console.log("[aiRouter] → image | provider: Gemini 1.5 Flash Vision (fallback)");
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
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
      if (query) return { query, provider: "gemini" };
    } else {
      const errText = await res.text();
      console.error(`[aiRouter] Gemini Vision ${res.status}: ${errText.slice(0, 200)}`);
    }
  }

  throw new Error("[aiRouter] Image analysis failed on all providers (tried GPT-4o Vision and Gemini).");
}
