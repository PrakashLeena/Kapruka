import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import http from "http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "backend", ".env") });

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
const MODEL = process.env.CLAUDE_MODEL || "z-ai/glm-5.1";
const KAPRUKA_MCP_URL = process.env.KAPRUKA_MCP_URL || "https://mcp.kapruka.com/mcp";

console.log("=== Testing Backend Connections ===");
console.log("NVIDIA_BASE_URL:", NVIDIA_BASE_URL);
console.log("MODEL:", MODEL);
console.log("KAPRUKA_MCP_URL:", KAPRUKA_MCP_URL);
console.log("NVIDIA_API_KEY prefix:", NVIDIA_API_KEY ? NVIDIA_API_KEY.slice(0, 10) + "..." : "undefined");

async function testMcp() {
  console.log("\n1. Testing Kapruka MCP Server connection...");
  return new Promise((resolve) => {
    const urlObj = new URL(KAPRUKA_MCP_URL);
    const lib = KAPRUKA_MCP_URL.startsWith("https:") ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        "Accept": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    };

    const req = lib.request(options, (res) => {
      console.log(`- MCP Server Response Status: ${res.statusCode}`);
      console.log(`- Headers:`, JSON.stringify(res.headers, null, 2));

      if (res.statusCode === 200) {
        console.log("✓ Success: Kapruka MCP server is reachable.");
        req.destroy();
        resolve(true);
      } else {
        let body = "";
        res.on("data", chunk => body += chunk);
        res.on("end", () => {
          console.log(`✗ Failure: Kapruka MCP returned status ${res.statusCode}. Body: ${body}`);
          resolve(false);
        });
      }
    });

    req.on("error", (err) => {
      console.error("✗ Failure: Could not reach Kapruka MCP server:", err.message);
      resolve(false);
    });

    req.end();
  });
}

async function testNvidia() {
  console.log("\n2. Testing NVIDIA API connection...");
  if (!NVIDIA_API_KEY) {
    console.log("✗ Failure: NVIDIA_API_KEY is not defined in backend/.env");
    return;
  }

  try {
    const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NVIDIA_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: "Hello" }],
        temperature: 0.2
      })
    });

    console.log(`- NVIDIA API Response Status: ${res.status}`);
    const data = await res.json();
    if (res.ok) {
      console.log("✓ Success: NVIDIA API key is valid and responded successfully.");
      console.log("  Response content:", data.choices?.[0]?.message?.content);
    } else {
      console.log("✗ Failure: NVIDIA API returned error:", data);
    }
  } catch (err) {
    console.error("✗ Failure: NVIDIA API call failed:", err.message);
  }
}

async function run() {
  await testMcp();
  await testNvidia();
}

run();
