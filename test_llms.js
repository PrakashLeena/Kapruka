import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "backend", ".env") });

console.log("Loaded env file: ", path.resolve(__dirname, "backend", ".env"));
console.log("OPENAI_API_KEY prefix:", process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.slice(0, 15) + "..." : "undefined");
console.log("GEMINI_API_KEY_1 prefix:", process.env.GEMINI_API_KEY_1 ? process.env.GEMINI_API_KEY_1.slice(0, 15) + "..." : "undefined");
console.log("GEMINI_API_KEY_2 prefix:", process.env.GEMINI_API_KEY_2 ? process.env.GEMINI_API_KEY_2.slice(0, 15) + "..." : "undefined");

const PROVIDERS = [
  {
    name: "OpenAI",
    key: process.env.OPENAI_API_KEY || process.env.NVIDIA_API_KEY,
    baseUrl: (process.env.OPENAI_BASE_URL || process.env.NVIDIA_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.CLAUDE_MODEL || "gpt-4o",
  },
  {
    name: "Gemini",
    key: process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY_2,
    baseUrl: (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai").replace(/\/$/, ""),
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  },
].filter(p => p.key);

async function testAll() {
  for (const provider of PROVIDERS) {
    console.log(`\nTesting provider: ${provider.name} (${provider.model}) at ${provider.baseUrl}`);
    try {
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${provider.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: "user", content: "Hi" }],
          temperature: 0.2,
        }),
      });

      console.log(`Status: ${response.status} ${response.statusText}`);
      const text = await response.text();
      try {
        const json = JSON.parse(text);
        if (response.ok) {
          console.log(`Success! Response:`, json.choices?.[0]?.message?.content);
        } else {
          console.log(`Failed! JSON:`, JSON.stringify(json, null, 2));
        }
      } catch {
        console.log(`Failed! Raw response:`, text.slice(0, 500));
      }
    } catch (err) {
      console.error(`Network error:`, err);
    }
  }
}

testAll();
