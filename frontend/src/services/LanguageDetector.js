/**
 * LanguageDetector.js
 *
 * Detects whether Romanized text is Tamil (Tanglish), Sinhala (Singlish),
 * or general English, using weighted keyword frequency scoring.
 *
 * Returns: 'tamil' | 'sinhala' | 'english'
 *
 * Design: purely client-side, zero network calls, instant.
 * Future: swap internals with a proper langdetect model if needed.
 */

// ── Romanized Tamil (Tanglish) keyword patterns ────────────────────────────────
// Common Tamil words written in English letters
const TAMIL_KEYWORDS = [
  // Greetings & polite
  "vannakam", "vanakkam", "nanri", "romba", "nandri",
  // Pronouns
  "naan", "naane", "neenga", "neengal", "avan", "aval", "avanga", "avar",
  "avargal", "unga", "ungaluku", "engaluku", "enakku", "unakku",
  // Questions
  "epdi", "eppadi", "evlo", "evvalo", "enna", "yenna", "enga", "yenga",
  "ethu", "evaru", "yaar", "yaaru", "enge",
  // Common verbs / words
  "irukku", "irukken", "irukka", "irukkinga", "sollinga", "sollunga",
  "ponga", "paarunga", "parunga", "kelambu", "varinga", "vango",
  "saaptu", "saapteenga", "saaptinga", "pochu", "achu", "aachu",
  "theriyum", "theriyala", "puriyala", "purinju",
  // Adjectives / misc
  "nalla", "nallaa", "nallathu", "konjam", "konjam", "bayangara",
  "super", "jolly", "appadi", "apdi", "sari", "saro", "pakka",
  // Family
  "amma", "appa", "akka", "anna", "thambi", "thangachi", "paati", "thatha",
  // Places / misc Tamil
  "veettu", "veetu", "kadai", "vilai", "priceu", "porul",
  "thodangu", "mudinja", "kandippa", "definitely", "occasion",
  // Particle patterns unique to Tanglish
  "nga", "inga", "unga", "enga", "yenna", "la", "da", "di",
];

// ── Romanized Sinhala (Singlish) keyword patterns ─────────────────────────────
const SINHALA_KEYWORDS = [
  // Greetings & polite
  "ayubowan", "sthuthi", "istuti", "bohoma", "sthutiy",
  // Pronouns
  "mama", "oyaa", "oya", "eyaa", "eya", "api", "apita", "oyalata",
  "maata", "eyaata",
  // Questions
  "kohomada", "mokakda", "mokada", "kawda", "kavda", "keeyada",
  "kiyada", "kohedada", "kohe",
  // Common verbs / words
  "innawa", "thiyanawa", "thiynawa", "weda", "karanna", "karala",
  "yanawa", "enawa", "balanna", "balaganna", "puluwani", "bari",
  "hondin", "hari", "naraka", "lassana", "honda",
  // Adjectives / misc
  "hodai", "hoda", "wishesh", "danno", "danne",
  "baluwa", "ganna", "denna", "genawa",
  // Family
  "amma", "thaththa", "ayya", "akka", "malli", "nangi",
  // Particle patterns unique to Singlish
  "neda", "ne", "da", "wa", "eka", "ekak", "ekath",
  "wela", "kala", "gena", "saha",
];

// ── Scoring helper ─────────────────────────────────────────────────────────────

/**
 * Score how many keywords from a list appear in the normalized text.
 * Longer keyword matches score higher (avoids false positives on short words).
 * @param {string} normalizedText - lowercase, trimmed input
 * @param {string[]} keywords
 * @returns {number}
 */
function _score(normalizedText, keywords) {
  let score = 0;
  for (const kw of keywords) {
    // Use word boundary check: keyword should appear as a whole word
    const regex = new RegExp(`\\b${kw}\\b`, "i");
    if (regex.test(normalizedText)) {
      // Longer keywords = more confident signal, weight them more
      score += Math.max(1, kw.length - 3);
    }
  }
  return score;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Detect the script style of the given text.
 *
 * @param {string} text
 * @returns {'tamil' | 'sinhala' | 'english'}
 */
export function detectLanguage(text) {
  if (!text || !text.trim()) return "english";

  const normalized = text.toLowerCase().trim();

  // Quick check: actual Tamil script chars → Tamil
  if (/[\u0B80-\u0BFF]/.test(text)) return "tamil";
  // Quick check: actual Sinhala script chars → Sinhala
  if (/[\u0D80-\u0DFF]/.test(text)) return "sinhala";

  const tamilScore = _score(normalized, TAMIL_KEYWORDS);
  const sinhalaScore = _score(normalized, SINHALA_KEYWORDS);

  // Require a minimum confidence threshold to avoid false positives
  const MIN_SCORE = 3;

  if (tamilScore === 0 && sinhalaScore === 0) return "english";
  if (tamilScore >= MIN_SCORE && tamilScore > sinhalaScore) return "tamil";
  if (sinhalaScore >= MIN_SCORE && sinhalaScore > tamilScore) return "sinhala";

  // Tie or both below threshold → English
  return "english";
}

/**
 * Detect language from a list of recent messages (uses last 3 user messages).
 * Helps maintain consistent voice across a conversation.
 *
 * @param {{ role: string, text: string }[]} messages
 * @returns {'tamil' | 'sinhala' | 'english'}
 */
export function detectConversationLanguage(messages) {
  const recentUserMsgs = messages
    .filter((m) => m.role === "user")
    .slice(-3) // last 3 user turns
    .map((m) => m.text || "")
    .join(" ");

  return detectLanguage(recentUserMsgs);
}
