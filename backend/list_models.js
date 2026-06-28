import fetch from "node-fetch"; // wait, does node have global fetch? Node 18+ does! Let's just use global fetch.
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });

const apiKey = process.env.NVIDIA_API_KEY;
const baseUrl = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";

console.log("Using API Key:", apiKey ? apiKey.slice(0, 10) + "..." : "missing");
console.log("Using Base URL:", baseUrl);

async function main() {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`
      }
    });
    if (!res.ok) {
      console.error("Error response:", res.status, await res.text());
      return;
    }
    const data = await res.json();
    console.log("Available models count:", data.data?.length);
    const visionModels = data.data?.filter(m => 
      m.id.toLowerCase().includes("vision") || 
      m.id.toLowerCase().includes("vl") ||
      m.id.toLowerCase().includes("cosmos") ||
      m.id.toLowerCase().includes("paligemma") ||
      m.id.toLowerCase().includes("neva")
    ) || [];
    console.log("Vision Models:");
    visionModels.forEach(m => console.log("-", m.id));
    console.log("\nAll Models:");
    data.data?.forEach(m => console.log("-", m.id));
  } catch (err) {
    console.error("Error fetching models:", err);
  }
}

main();
