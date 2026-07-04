/**
 * Transliterator.js
 *
 * Provides phonetic transliteration fallback for Tamil and Sinhala scripts
 * into Romanized (Tanglish/Singlish) representations. Used specifically for
 * Text-to-Speech (TTS) when the user's browser does not have native Tamil or
 * Sinhala speech synthesis voices installed.
 */

const TAMIL_VOWELS = {
  'அ': 'a', 'ஆ': 'aa', 'இ': 'i', 'ஈ': 'ee', 'உ': 'u', 'ஊ': 'oo',
  'எ': 'e', 'ஏ': 'ae', 'ஐ': 'ai', 'ஒ': 'o', 'ஓ': 'oe', 'ஔ': 'au'
};

const TAMIL_CONSONANTS = {
  'க': 'k', 'ங': 'ng', 'ச': 'ch', 'ஞ': 'nj', 'ட': 't', 'ண': 'n',
  'த': 'th', 'ந': 'n', 'ப': 'p', 'ம': 'm', 'ய': 'y', 'ர': 'r',
  'ல': 'l', 'வ': 'v', 'ழ': 'zh', 'ள': 'l', 'ற': 'r', 'ன': 'n',
  'ஜ': 'j', 'ஷ': 'sh', 'ஸ': 's', 'ஹ': 'h'
};

const TAMIL_VOWEL_SIGNS = {
  'ா': 'aa', 'i': 'i', 'ி': 'i', 'ீ': 'ee', 'ு': 'u', 'ூ': 'oo',
  'ெ': 'e', 'ே': 'ae', 'ை': 'ai', 'ொ': 'o', 'ோ': 'oe', 'ௌ': 'au'
};

const TAMIL_PULLI = '்';

const SINHALA_VOWELS = {
  'අ': 'a', 'ආ': 'aa', 'ඇ': 'ae', 'ඈ': 'aee', 'ඉ': 'i', 'ඊ': 'ii',
  'උ': 'u', 'ඌ': 'uu', 'එ': 'e', 'ඒ': 'ee', 'ඓ': 'ai', 'ඔ': 'o',
  'ඕ': 'oo', 'ඖ': 'au'
};

const SINHALA_CONSONANTS = {
  'ක': 'k', 'ඛ': 'k', 'ග': 'g', 'ඝ': 'g', 'ඞ': 'ng', 'ඟ': 'ng',
  'ච': 'ch', 'ඡ': 'ch', 'ජ': 'j', 'ඣ': 'j', 'ඤ': 'ny', 'ඥ': 'gn',
  'ට': 't', 'ඨ': 't', 'ඩ': 'd', 'ඪ': 'd', 'ණ': 'n', 'ඬ': 'nd',
  'ත': 'th', 'ථ': 'th', 'ද': 'd', 'ධ': 'd', 'න': 'n', 'ඳ': 'nd',
  'ප': 'p', 'ඵ': 'p', 'බ': 'b', 'භ': 'b', 'ම': 'm', 'ඹ': 'mb',
  'ය': 'y', 'ර': 'r', 'ල': 'l', 'ව': 'v', 'ශ': 'sh', 'ෂ': 'sh',
  'ස': 's', 'හ': 'h', 'ළ': 'l', 'ෆ': 'f'
};

const SINHALA_VOWEL_SIGNS = {
  'ා': 'aa', 'ැ': 'ae', 'ෑ': 'aee', 'ි': 'i', 'ී': 'ii',
  'ු': 'u', 'ූ': 'uu', 'ෘ': 'ru', 'ෙ': 'e', 'ේ': 'ee',
  'ෛ': 'ai', 'ො': 'o', 'ෝ': 'oo', 'ෞ': 'au'
};

const SINHALA_HAL = '්';

/**
 * Transliterates Tamil script text to Romanized Tamil (Tanglish/Thanglish)
 * @param {string} text
 * @returns {string}
 */
export function transliterateTamil(text) {
  if (!text) return "";
  let result = "";
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (TAMIL_VOWELS[char]) {
      result += TAMIL_VOWELS[char];
      i++;
      continue;
    }

    if (TAMIL_CONSONANTS[char]) {
      const base = TAMIL_CONSONANTS[char];
      const nextChar = text[i + 1];

      if (nextChar === TAMIL_PULLI) {
        result += base;
        i += 2;
      } else if (TAMIL_VOWEL_SIGNS[nextChar]) {
        result += base + TAMIL_VOWEL_SIGNS[nextChar];
        i += 2;
      } else {
        // Implicit 'a' sound for stand-alone consonants
        result += base + "a";
        i++;
      }
      continue;
    }

    result += char;
    i++;
  }
  return result;
}

/**
 * Transliterates Sinhala script text to Romanized Sinhala (Singlish)
 * @param {string} text
 * @returns {string}
 */
export function transliterateSinhala(text) {
  if (!text) return "";
  let result = "";
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (SINHALA_VOWELS[char]) {
      result += SINHALA_VOWELS[char];
      i++;
      continue;
    }

    if (SINHALA_CONSONANTS[char]) {
      const base = SINHALA_CONSONANTS[char];
      const nextChar = text[i + 1];

      if (nextChar === SINHALA_HAL) {
        result += base;
        i += 2;
      } else if (SINHALA_VOWEL_SIGNS[nextChar]) {
        result += base + SINHALA_VOWEL_SIGNS[nextChar];
        i += 2;
      } else {
        // Implicit 'a' sound for stand-alone consonants
        result += base + "a";
        i++;
      }
      continue;
    }

    result += char;
    i++;
  }
  return result;
}

/**
 * Checks if the text has Tamil script characters
 * @param {string} text
 * @returns {boolean}
 */
export function hasTamilScript(text) {
  return /[\u0B80-\u0BFF]/.test(text);
}

/**
 * Checks if the text has Sinhala script characters
 * @param {string} text
 * @returns {boolean}
 */
export function hasSinhalaScript(text) {
  return /[\u0D80-\u0DFF]/.test(text);
}
