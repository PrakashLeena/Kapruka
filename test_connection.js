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

function mcpPost(payload, sessionId) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(KAPRUKA_MCP_URL);
    const lib = KAPRUKA_MCP_URL.startsWith("https:") ? https : http;
    const postData = JSON.stringify(payload);
    const headers = {
      "Accept": "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
      "User-Agent": "KaprukaAgentConnectionTest/1.0"
    };

    if (sessionId) {
      headers["Mcp-Session-Id"] = sessionId;
    }

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers
    };

    const finish = (res, body) => {
      resolve({
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        headers: res.headers,
        body
      });
    };

    const req = lib.request(options, (res) => {
      let body = "";
      let resolved = false;
      const contentType = res.headers["content-type"] || "";

      const finishOnce = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        finish(res, body);
        req.destroy();
      };

      const timeout = setTimeout(finishOnce, 15000);

      res.on("data", chunk => {
        body += chunk;
        if (contentType.includes("text/event-stream") && body.includes("data:")) {
          finishOnce();
        }
      });
      res.on("end", finishOnce);
    });

    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error("MCP request timed out"));
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function testMcp() {
  console.log("\n1. Testing Kapruka MCP Server connection...");

  try {
    const initialize = await mcpPost({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "kapruka-agent-connection-test",
          version: "1.0.0"
        }
      }
    });

    console.log(`- Initialize Status: ${initialize.status}`);
    console.log("- Initialize Headers:", JSON.stringify(initialize.headers, null, 2));
    console.log(`- Initialize Body: ${initialize.body}`);

    const sessionId = initialize.headers["mcp-session-id"];
    if (!initialize.ok || !sessionId) {
      console.log("x Failure: Kapruka MCP did not return a valid Mcp-Session-Id.");
      return false;
    }

    console.log(`- Server Session ID: ${sessionId}`);

    const initialized = await mcpPost({
      jsonrpc: "2.0",
      method: "notifications/initialized"
    }, sessionId);
    console.log(`- Initialized Notification Status: ${initialized.status}`);

    const tools = await mcpPost({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    }, sessionId);

    console.log(`- Tools/List Status: ${tools.status}`);
    console.log("- Tools/List Headers:", JSON.stringify(tools.headers, null, 2));
    console.log(`- Tools/List Body: ${tools.body}`);

    if (tools.ok) {
      console.log("✓ Success: Kapruka MCP initialized and tools/list responded successfully!");
      return true;
    }

    console.log("x Failure: Kapruka MCP tools/list returned error status.");
    return false;
  } catch (err) {
    console.error("x Failure: Could not reach Kapruka MCP server:", err.message);
    return false;
  }
}

async function testNvidia() {
  console.log("\n2. Testing NVIDIA API connection...");
  if (!NVIDIA_API_KEY) {
    console.log("x Failure: NVIDIA_API_KEY is not defined in backend/.env");
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
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
    clearTimeout(timeout);

    console.log(`- NVIDIA API Response Status: ${res.status}`);
    const data = await res.json();
    if (res.ok) {
      console.log("✓ Success: NVIDIA API key is valid and responded successfully.");
      console.log("  Response content:", data.choices?.[0]?.message?.content);
    } else {
      console.log("x Failure: NVIDIA API returned error:", data);
    }
  } catch (err) {
    console.error("x Failure: NVIDIA API call failed:", err.message);
  }
}

async function run() {
  await testMcp();
  await testNvidia();
  process.exit(0);
}

run().catch((err) => {
  console.error("Unexpected test failure:", err);
  process.exit(1);
});

