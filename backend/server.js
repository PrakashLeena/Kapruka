// server.js
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Guard: fileURLToPath can throw in some serverless bundlers
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: path.resolve(__dirname, ".env") });
} catch {
  // Running in a serverless/bundled environment — env vars come from the platform
}

import express from "express";
import cors from "cors";
import https from "https";
import http from "http";
import { SYSTEM_PROMPT } from "./systemPrompt.js";

const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || "z-ai/glm-5.1";
const KAPRUKA_MCP_URL = process.env.KAPRUKA_MCP_URL || "https://mcp.kapruka.com/mcp";
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || "http://localhost:5173").replace(/\/$/, "");


if (!process.env.NVIDIA_API_KEY) {
  console.warn("WARNING: NVIDIA_API_KEY is not set in the environment variables.");
}

const app = express();
app.use(cors({
  origin: (origin, callback) => {
    // Automatically allow localhost/127.0.0.1 in development, or the configured ALLOWED_ORIGIN, or requests with no origin
    if (
      !origin ||
      origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:") ||
      origin.startsWith("https://localhost:") ||
      origin.startsWith("https://127.0.0.1:") ||
      origin === ALLOWED_ORIGIN
    ) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked request from origin: ${origin}. Allowed origin is: ${ALLOWED_ORIGIN}`);
      callback(null, false);
    }
  }
}));

app.use(express.json({ limit: "2mb" }));

// In-memory session store: sessionId -> array of message objects.
const sessions = new Map();

function getHistory(sessionId) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  return sessions.get(sessionId);
}

const MAX_HISTORY_MESSAGES = 24;
function trimHistory(history) {
  if (history.length > MAX_HISTORY_MESSAGES) {
    history.splice(0, history.length - MAX_HISTORY_MESSAGES);
  }
}

function mcpPost(baseUrl, payload, sessionId) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(baseUrl);
    const lib = baseUrl.startsWith("https:") ? https : http;
    const postData = JSON.stringify(payload);
    const headers = {
      "Accept": "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(postData),
      "User-Agent": "KaprukaAgentBackend/1.0"
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
      let resultBody = body;
      const dataLine = body
        .split(/\r?\n/)
        .find(line => line.startsWith("data:"));

      if (dataLine) {
        resultBody = dataLine.slice(5).trim();
      }

      let json = null;
      try {
        json = resultBody ? JSON.parse(resultBody) : null;
      } catch {
        // keep json null and let caller inspect raw body
      }

      resolve({
        status: res.statusCode,
        ok: res.statusCode >= 200 && res.statusCode < 300,
        headers: res.headers,
        body,
        json
      });
    };

    const req = lib.request(options, (res) => {
      let body = "";
      let resolved = false;
      res.setEncoding("utf8");

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
        const contentType = res.headers["content-type"] || "";
        if (contentType.includes("text/event-stream")) {
          const dataLine = body.split(/\r?\n/).find(line => line.startsWith("data:"));
          if (dataLine) {
            const jsonStr = dataLine.slice(5).trim();
            try {
              JSON.parse(jsonStr);
              finishOnce();
            } catch (e) {
              // Incomplete JSON, wait for more chunks
            }
          }
        } else {
          try {
            JSON.parse(body);
            finishOnce();
          } catch (e) {
            // Incomplete JSON, wait for more chunks
          }
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

let mcpSessionId = null;
async function ensureMcpSession() {
  if (mcpSessionId) return mcpSessionId;

  const init = await mcpPost(KAPRUKA_MCP_URL, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "kapruka-agent-backend",
        version: "1.0.0"
      }
    }
  });

  const sessionId = init.headers["mcp-session-id"];
  if (!init.ok || !sessionId) {
    throw new Error(`MCP initialize failed. Status: ${init.status}, Body: ${init.body}`);
  }

  mcpSessionId = sessionId;
  await mcpPost(KAPRUKA_MCP_URL, {
    jsonrpc: "2.0",
    method: "notifications/initialized"
  }, mcpSessionId);

  return mcpSessionId;
}

async function callMcp(baseUrl, method, params = {}) {
  const sessionId = await ensureMcpSession();
  const id = Math.floor(Math.random() * 1000000);
  const response = await mcpPost(baseUrl, {
    jsonrpc: "2.0",
    id,
    method,
    params
  }, sessionId);

  if (!response.ok) {
    if (response.status === 404 || response.status === 400) {
      mcpSessionId = null;
    }
    throw new Error(`MCP ${method} failed. Status: ${response.status}, Body: ${response.body}`);
  }

  if (response.json?.error) {
    throw new Error(`MCP ${method} error: ${JSON.stringify(response.json.error)}`);
  }

  return response.json?.result;
}

// Dynamically loaded MCP tools
let mcpTools = [];
let mcpLoadError = null;
async function loadMcpTools() {
  try {
    const res = await callMcp(KAPRUKA_MCP_URL, "tools/list");
    mcpTools = res?.tools || [];
    mcpLoadError = null;
    console.log(`Successfully loaded ${mcpTools.length} tools from Kapruka MCP server:`, mcpTools.map(t => t.name));
  } catch (err) {
    mcpTools = [];
    mcpLoadError = err.message;
    console.error("Failed to load MCP tools at startup:", err.message);
  }
}

async function getOpenAiTools() {
  if (mcpTools.length === 0) {
    await loadMcpTools();
  }
  return mcpTools.map(tool => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}

// ---------------------------------------------------------------------------
// Parallel background product search
// Extracts up to 2 search keywords from the raw user message using a
// heuristic keyword map (no extra API call needed). If the AI's own tool
// use finds products those take priority; these results are only used as
// a fallback to ensure the catalog is never blank on first contact.
// ---------------------------------------------------------------------------

const SITUATION_MAP = [
  // Apology / relationship
  { rx: /upset|angry|fight|argue|apolog|sorry|forgive|mad|kadura|kaduwela|husbandan|wahini/i, terms: ["flowers", "chocolates"] },
  // Birthday
  { rx: /birthday|born|upandina|upadina|pirandha/i, terms: ["birthday cake", "birthday gift"] },
  // Anniversary / love
  { rx: /anniversar|valentine|love|romance|darling|sweetheart/i, terms: ["flowers", "jewelry"] },
  // Get well / sick
  { rx: /sick|ill|hospital|recover|get well|unwell/i, terms: ["fruit basket", "get well soon"] },
  // New Year / Avurudu
  { rx: /avurudu|new year|sinhala.*new|aluth.*avurudu/i, terms: ["new year gift", "hamper"] },
  // Graduation / congratulations
  { rx: /graduat|congrat|pass|exam|promot/i, terms: ["gift hamper", "chocolates"] },
  // Baby / newborn
  { rx: /baby|newborn|born|infant|pregnant/i, terms: ["baby gift", "soft toy"] },
  // Wedding
  { rx: /wedding|married|bride|groom|nuptial/i, terms: ["wedding gift", "flowers"] },
  // Mother / father
  { rx: /mother|mom|amma|father|dad|thatha/i, terms: ["flowers", "gift hamper"] },
  // Children / kids
  { rx: /child|kid|son|daughter|putha|duwee/i, terms: ["toy", "kids gift"] },
  // Chocolate / sweets generic
  { rx: /chocolate|sweet|candy|cake/i, terms: ["chocolates"] },
  // Flowers generic
  { rx: /flower|rose|bouquet|puspaya/i, terms: ["flowers"] },
  // Delivery explicit
  { rx: /deliver|send|post|courier/i, terms: ["gift hamper"] },
  // Festival
  { rx: /vesak|deepavali|diwali|christmas|eid|poya/i, terms: ["festival gift", "hamper"] },
];

function extractSearchKeywords(message) {
  const matched = [];
  for (const { rx, terms } of SITUATION_MAP) {
    if (rx.test(message)) {
      for (const t of terms) {
        if (!matched.includes(t)) matched.push(t);
      }
      if (matched.length >= 2) break;
    }
  }
  // Also pick any explicit short word groups (2-3 consecutive words) if nothing matched
  if (matched.length === 0) {
    const clean = message.replace(/[^a-zA-Z\s]/g, " ").trim();
    const words = clean.split(/\s+/).filter(w => w.length > 3);
    if (words.length > 0) matched.push(words.slice(0, 3).join(" "));
  }
  return matched.slice(0, 2);
}

async function parallelProductSearch(message) {
  const keywords = extractSearchKeywords(message);
  if (keywords.length === 0) return [];

  const searchTool = mcpTools.find(t => t.name === "kapruka_search_products");
  if (!searchTool) return [];

  const results = await Promise.allSettled(
    keywords.map(kw =>
      callMcp(KAPRUKA_MCP_URL, "tools/call", {
        name: "kapruka_search_products",
        arguments: { query: kw }
      })
    )
  );

  const products = [];
  const orderRef = { value: null };
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "fulfilled") {
      processToolResponse("kapruka_search_products", results[i].value, products, orderRef);
    } else {
      console.warn(`Parallel search for "${keywords[i]}" failed:`, results[i].reason?.message);
    }
  }
  return products;
}

// Process and extract product/order data from tool call response
function processToolResponse(toolName, responseData, products, orderRef) {
  if (!responseData) return;

  let rawText = "";
  if (responseData.content && Array.isArray(responseData.content)) {
    rawText = responseData.content.find(c => c.type === "text")?.text || "";
  } else if (typeof responseData === "string") {
    rawText = responseData;
  } else {
    rawText = JSON.stringify(responseData);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return; // Not JSON
  }

  const items = Array.isArray(parsed) ? parsed : parsed.results ?? parsed.products ?? [parsed];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    // Order / checkout result (has a pay link).
    const payUrl = item.pay_url ?? item.payment_url ?? item.checkout_url ?? item.pay_link;
    if (payUrl) {
      orderRef.value = {
        orderNumber: item.order_number ?? item.order_id ?? null,
        payUrl,
        total: item.total ?? item.amount ?? null,
        currency: item.currency ?? "LKR",
      };
      continue;
    }

    // Product-like result.
    const name = item.name ?? item.title ?? item.product_name;
    if (!name) continue;

    products.push({
      id: item.id ?? item.product_id ?? name,
      name,
      price: item.price ?? item.amount ?? null,
      currency: item.currency ?? "LKR",
      image: item.image ?? item.image_url ?? item.images?.[0] ?? null,
      url: item.url ?? item.product_url ?? null,
      inStock: item.in_stock ?? item.stock !== 0,
      sourceTool: toolName,
    });
  }
}

app.get("/", (_req, res) => res.send("Kapruka Agent Backend is running successfully!"));
app.get("/health", (_req, res) => res.json({
  ok: true,
  mcp: {
    url: KAPRUKA_MCP_URL,
    connected: mcpTools.length > 0,
    toolCount: mcpTools.length,
    lastError: mcpLoadError,
  },
}));


app.post("/chat", async (req, res) => {
  if (!process.env.NVIDIA_API_KEY) {
    return res.status(500).json({ error: "NVIDIA_API_KEY is not configured on the server." });
  }

  const { sessionId, message } = req.body ?? {};


  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "Missing sessionId" });
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Missing message" });
  }

  const history = getHistory(sessionId);
  history.push({ role: "user", content: message });

  try {
    const openAiTools = await getOpenAiTools();
    if (openAiTools.length === 0) {
      history.pop();
      return res.status(503).json({
        error: "The shopping catalog is currently offline. Please restart the backend or check the Kapruka MCP connection.",
        detail: mcpLoadError,
      });
    }

    let currentMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history
    ];

    const products = [];
    const orderRef = { value: null };

    // Fire parallel background product search immediately (safety net).
    // This resolves while the AI is thinking so the catalog never stays blank
    // when the user describes a situation rather than naming a product.
    const parallelSearchPromise = parallelProductSearch(message).catch(err => {
      console.warn("Parallel search rejected:", err.message);
      return [];
    });

    // Max 10 sequential tool calls per user interaction loop
    for (let loop = 0; loop < 10; loop++) {
      const requestBody = {
        model: MODEL,
        messages: currentMessages,
        temperature: 0.2,
        top_p: 1,
      };


      if (openAiTools.length > 0) {
        requestBody.tools = openAiTools;
      }

      const response = await fetch(`${process.env.NVIDIA_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Nvidia API error:", response.status, errText);
        history.pop(); // rollback user message on failure
        return res.status(502).json({ error: "The agent had trouble responding. Please try again." });
      }

      const data = await response.json();
      const assistantMessage = data.choices?.[0]?.message;

      if (!assistantMessage) {
        throw new Error("No message returned from Nvidia API");
      }

      // Add model response to history
      currentMessages.push(assistantMessage);

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);

          console.log(`Executing tool ${toolName} with args:`, toolArgs);
          let toolResult;
          try {
            toolResult = await callMcp(KAPRUKA_MCP_URL, "tools/call", {
              name: toolName,
              arguments: toolArgs,
            });
            processToolResponse(toolName, toolResult, products, orderRef);
          } catch (err) {
            console.error(`Error calling tool ${toolName}:`, err.message);
            toolResult = {
              content: [{ type: "text", text: `Error calling tool: ${err.message}` }],
              isError: true,
            };
          }

          currentMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify(toolResult),
          });
        }
        continue;
      }

      // Final text response reached
      const text = assistantMessage.content || "";
      history.push({ role: "assistant", content: text });
      trimHistory(history);

      // If the AI's own tool calls found products, use those (they're more
      // contextually accurate). Otherwise fall back to the parallel search.
      let finalProducts = products;
      if (finalProducts.length === 0) {
        try {
          const parallelProducts = await parallelSearchPromise;
          finalProducts = parallelProducts;
        } catch (err) {
          console.warn("Parallel search error (non-fatal):", err.message);
        }
      }

      return res.json({ text, products: finalProducts, order: orderRef.value });
    }

    // Loop limit exceeded
    history.pop();
    res.status(502).json({ error: "Tool execution loop limit exceeded." });
  } catch (err) {
    console.error("Unexpected error in /chat:", err);
    history.pop();
    res.status(500).json({ error: "Something went wrong on our end." });
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, async () => {
    console.log(`Kapu backend running on http://localhost:${PORT}`);
    await loadMcpTools();
  });
}

export default app;
