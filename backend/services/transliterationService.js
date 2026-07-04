// backend/services/transliterationService.js
import { callPrimaryNonStream } from "../aiRouter.js";

// A simple in-memory cache to save LLM tokens and round-trips for common phrases.
const transliterationCache = new Map();

// Pre-seeded cache entries for high-frequency terms
const PRE_SEEDED_CACHE = {
  // Sinhala (Singlish → Script)
  "sinhala:ayubowan": "ආයුබෝවන්",
  "sinhala:sthuthi": "ස්තුතියි",
  "sinhala:sthuthiy": "ස්තුතියි",
  "sinhala:istuti": "ස්තුතියි",
  "sinhala:kohomada": "කොහොමද",
  "sinhala:kohomada wada": "කොහොමද වැඩ",
  "sinhala:hondin innawa": "හොඳින් ඉන්නවා",
  "sinhala:hodai": "හොඳයි",
  "sinhala:hari": "හරි",
  "sinhala:subha dawasak": "සුභ දවසක්",
  "sinhala:mama": "මම",
  "sinhala:oyata": "ඔයාට",
  "sinhala:apita": "අපිට",

  // Tamil (Tanglish → Script)
  "tamil:vanakkam": "வணக்கம்",
  "tamil:vannakam": "வணக்கம்",
  "tamil:nandri": "நன்றி",
  "tamil:nanri": "நன்றி",
  "tamil:romba nandri": "ரொம்ப நன்றி",
  "tamil:epdi irukingal": "எப்படி இருக்கீங்க",
  "tamil:eppadi irukkinga": "எப்படி இருக்கீங்க",
  "tamil:sari": "சரி",
  "tamil:enna": "என்ன",
  "tamil:enakku": "எனக்கு",
  "tamil:ungaluku": "உங்களுக்கு",
};

// Load pre-seeded cache
for (const [key, val] of Object.entries(PRE_SEEDED_CACHE)) {
  transliterationCache.set(key, val);
}

/**
 * Checks if the text has Tamil script characters
 */
function hasTamilScript(text) {
  return /[\u0B80-\u0BFF]/.test(text);
}

/**
 * Checks if the text has Sinhala script characters
 */
function hasSinhalaScript(text) {
  return /[\u0D80-\u0DFF]/.test(text);
}

/**
 * Romanized Singlish/Tanglish to Native Script translator using the active LLM.
 *
 * @param {string} text - The input text (potentially Romanized Singlish/Tanglish)
 * @param {'sinhala'|'tamil'} language - Target language
 * @returns {Promise<string>} Native script string
 */
export async function romanToNativeScript(text, language) {
  if (!text || !text.trim()) return "";

  // 1. Guard: If script characters are already present, return text directly
  if (language === "sinhala" && hasSinhalaScript(text)) {
    return text;
  }
  if (language === "tamil" && hasTamilScript(text)) {
    return text;
  }

  const cacheKey = `${language}:${text.toLowerCase().trim()}`;

  // 2. Check memory cache
  if (transliterationCache.has(cacheKey)) {
    console.log(`[transliterationCache HIT] "${text.slice(0, 30)}" -> "${transliterationCache.get(cacheKey).slice(0, 30)}"`);
    return transliterationCache.get(cacheKey);
  }

  // 3. Fallback: ask the LLM to transliterate
  const systemPrompt = language === "sinhala" 
    ? "You are a precise Romanized Singlish to Sinhala script converter. Convert the following Romanized Singlish text into native Sinhala script (සිංහල). Do NOT translate English words or brand names (e.g. keep 'cake' as 'කේක්' or 'cake', 'delivery' as 'ඩිලිවරි' or 'delivery'). Respond with ONLY the Sinhala script response. No explanations, no introductions."
    : "You are a precise Romanized Tanglish to Tamil script converter. Convert the following Romanized Tamil (Tanglish/Thanglish) text into native Tamil script (தமிழ்). Do NOT translate English words or brand names. Respond with ONLY the Tamil script response. No explanations, no introductions.";

  try {
    console.log(`[transliteration] LLM routing requested for: "${text.slice(0, 60)}..."`);
    const { data } = await callPrimaryNonStream([
      { role: "system", content: systemPrompt },
      { role: "user", content: text }
    ]);

    const result = data.choices?.[0]?.message?.content?.trim() || "";
    if (result) {
      transliterationCache.set(cacheKey, result);
      return result;
    }
  } catch (err) {
    console.error("[transliteration] LLM conversion failed:", err.message);
  }

  // Final fallback: return original text if translation failed
  return text;
}
