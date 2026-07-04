// backend/services/ttsService.js

const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY || "";
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION || "eastus";

// Escape characters for valid XML payload
function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/**
 * Checks if Azure TTS is configured in .env
 * @returns {boolean}
 */
export function isAzureTtsConfigured() {
  return !!AZURE_SPEECH_KEY && !!AZURE_SPEECH_REGION;
}

/**
 * Synthesizes text to speech using Azure Cognitive Services.
 *
 * @param {string} text - Native script text (Sinhala or Tamil)
 * @param {'sinhala'|'tamil'} language
 * @returns {Promise<Buffer>} Audio buffer in MP3 format
 */
export async function synthesizeSpeech(text, language) {
  if (!isAzureTtsConfigured()) {
    throw new Error("Azure Speech Service credentials (AZURE_SPEECH_KEY / AZURE_SPEECH_REGION) are not configured.");
  }

  let locale = "si-LK";
  let voiceName = "si-LK-SameeraNeural"; // Sinhala (Sri Lanka)

  if (language === "tamil") {
    locale = "ta-LK";
    voiceName = "ta-LK-SaranyaNeural"; // Tamil (Sri Lanka) - Fallback is ta-IN-PallaviNeural
  }

  const endpoint = `https://${AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = `
    <speak version='1.0' xml:lang='${locale}'>
      <voice xml:lang='${locale}' name='${voiceName}'>
        ${escapeXml(text)}
      </voice>
    </speak>
  `.trim();

  console.log(`[Azure TTS] Requesting voice ${voiceName} for text: "${text.slice(0, 40)}..."`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "KaprukaShoppingAgentTTS",
    },
    body: ssml,
  });

  if (!response.ok) {
    const errorText = await response.text();
    // If the Sri Lankan Tamil voice is unavailable in this region, fall back to Indian Tamil
    if (language === "tamil" && (response.status === 400 || response.status === 404)) {
      console.warn(`[Azure TTS] ${voiceName} not available in region ${AZURE_SPEECH_REGION}. Retrying with ta-IN-PallaviNeural...`);
      const fallbackVoice = "ta-IN-PallaviNeural";
      const fallbackLocale = "ta-IN";
      const fallbackSsml = `
        <speak version='1.0' xml:lang='${fallbackLocale}'>
          <voice xml:lang='${fallbackLocale}' name='${fallbackVoice}'>
            ${escapeXml(text)}
          </voice>
        </speak>
      `.trim();
      
      const retryRes = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": AZURE_SPEECH_KEY,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "KaprukaShoppingAgentTTS",
        },
        body: fallbackSsml,
      });

      if (retryRes.ok) {
        const arrayBuffer = await retryRes.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }
    }
    
    throw new Error(`Azure Speech API failed: ${response.status} - ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
