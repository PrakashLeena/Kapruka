// server.js
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });

import express from "express";
import cors from "cors";
import https from "https";
import http from "http";
import { MongoClient } from "mongodb";
import { buildSystemPrompt } from "./systemPrompt.js";

const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || "z-ai/glm-5.1";
const KAPRUKA_MCP_URL = process.env.KAPRUKA_MCP_URL || "https://mcp.kapruka.com/mcp";
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || "http://localhost:5173").replace(/\/$/, "");
const MONGODB_URI = process.env.MONGODB_URI;

// Keep-Alive HTTP/HTTPS agents to optimize MCP latency by reusing TCP/TLS connections
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 10000 });
const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 10000 });

// ─── In-Memory MCP Response Cache ─────────────────────────────────────────────
// Caches read-only tool responses (search, categories, delivery checks) to avoid
// redundant round-trips to the Kapruka MCP server within a short window.
const mcpCache = new Map();

function getCached(key) {
  const entry = mcpCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    mcpCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value, ttlMs) {
  mcpCache.set(key, { value, expires: Date.now() + ttlMs });
}

// Evict stale entries every minute to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of mcpCache) {
    if (now > entry.expires) mcpCache.delete(key);
  }
}, 60_000);

const MCP_TOOL_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

/**
 * Returns true if the tool is safe to cache (read-only, no side effects).
 * Excludes any tool whose name suggests it creates, modifies, or places orders.
 */
function isToolCacheable(toolName) {
  const writePhrases = ["create", "order", "checkout", "add", "remove", "update", "delete", "place", "submit", "purchase"];
  const lower = toolName.toLowerCase();
  return !writePhrases.some((p) => lower.includes(p));
}

if (!process.env.NVIDIA_API_KEY) {
  console.warn("WARNING: NVIDIA_API_KEY is not set in the environment variables.");
}
if (!MONGODB_URI) {
  console.warn("WARNING: MONGODB_URI is not set. Chat history will not persist.");
}

// ─── MongoDB Setup ────────────────────────────────────────────────────────────
let db = null;
let mongoClient = null;

async function connectMongo() {
  if (db) return db;
  if (!MONGODB_URI) return null;
  try {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    db = mongoClient.db("kapruka_agent");
    // Create index for quick lookup by sessionId/userId and sorting by date
    await db.collection("chat_sessions").createIndex({ userId: 1, updatedAt: -1 });
    await db.collection("chat_sessions").createIndex({ createdAt: -1 });
    console.log("✅ Connected to MongoDB Atlas");
    return db;
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err.message);
    return null;
  }
}

function getChatCollection() {
  return db?.collection("chat_sessions") ?? null;
}

// ─── Session helpers (MongoDB-backed, with in-memory fallback) ────────────────
const memSessions = new Map(); // fallback when MongoDB unavailable

async function getHistory(sessionId, userId) {
  const col = getChatCollection();
  if (col) {
    if (!userId) return [];
    const doc = await col.findOne({ _id: sessionId, userId });
    return doc ? doc.messages : [];
  }
  // in-memory fallback
  const memKey = `${userId || "guest"}:${sessionId}`;
  if (!memSessions.has(memKey)) memSessions.set(memKey, []);
  return memSessions.get(memKey);
}

async function saveHistory(sessionId, messages, firstUserMessage, userId) {
  const col = getChatCollection();
  const now = new Date();
  if (col) {
    if (!userId) {
      console.warn("Attempted to save chat history without a userId");
      return;
    }
    const update = {
      $set: {
        messages,
        updatedAt: now,
      },
      $setOnInsert: {
        title: firstUserMessage
          ? firstUserMessage.slice(0, 60) + (firstUserMessage.length > 60 ? "…" : "")
          : "New Chat",
        createdAt: now,
      },
    };
    await col.updateOne(
      { _id: sessionId, userId },
      update,
      { upsert: true }
    );
  } else {
    const memKey = `${userId || "guest"}:${sessionId}`;
    memSessions.set(memKey, messages);
  }
}

const MAX_HISTORY_MESSAGES = 24;
function trimHistory(history) {
  if (history.length > MAX_HISTORY_MESSAGES) {
    history.splice(0, history.length - MAX_HISTORY_MESSAGES);
  }
}

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({
  origin: (origin, callback) => {
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

// ─── MCP helpers ─────────────────────────────────────────────────────────────
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
      headers,
      agent: urlObj.protocol === "https:" ? keepAliveHttpsAgent : keepAliveHttpAgent
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

/**
 * Wrapper around callMcp("tools/call") that caches responses for read-only tools.
 * Write tools (create order, etc.) bypass the cache entirely.
 */
async function callMcpCached(baseUrl, toolName, toolArgs) {
  if (isToolCacheable(toolName)) {
    const cacheKey = `${toolName}:${JSON.stringify(toolArgs)}`;
    const hit = getCached(cacheKey);
    if (hit) {
      console.log(`[cache HIT] ${toolName}`);
      return hit;
    }
    const result = await callMcp(baseUrl, "tools/call", { name: toolName, arguments: toolArgs });
    setCache(cacheKey, result, MCP_TOOL_CACHE_TTL);
    return result;
  }
  // Non-cacheable write tool — call directly
  return callMcp(baseUrl, "tools/call", { name: toolName, arguments: toolArgs });
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
    // If it's not JSON, it could be a Markdown response. We'll skip product parsing for it.
    return;
  }

  const items = Array.isArray(parsed) ? parsed : parsed.results ?? parsed.products ?? [parsed];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    // Order / checkout result (has a pay link).
    const payUrl = item.pay_url ?? item.payment_url ?? item.checkout_url ?? item.pay_link;
    if (payUrl) {
      let totalVal = null;
      let currencyVal = "LKR";
      
      if (item.summary && typeof item.summary === "object") {
        totalVal = item.summary.grand_total ?? item.summary.total ?? null;
        currencyVal = item.summary.currency ?? "LKR";
      } else {
        totalVal = item.total ?? item.amount ?? null;
        currencyVal = item.currency ?? "LKR";
      }

      orderRef.value = {
        orderNumber: item.order_number ?? item.order_id ?? item.order_ref ?? null,
        payUrl,
        total: totalVal,
        currency: currencyVal,
      };
      continue;
    }

    // Product-like result.
    const name = item.name ?? item.title ?? item.product_name;
    if (!name) continue;

    let priceVal = null;
    let currencyVal = "LKR";

    if (item.price && typeof item.price === "object") {
      priceVal = item.price.amount;
      currencyVal = item.price.currency ?? "LKR";
    } else {
      priceVal = item.price ?? item.amount ?? null;
      currencyVal = item.currency ?? "LKR";
    }

    products.push({
      id: item.id ?? item.product_id ?? name,
      name,
      price: priceVal,
      currency: currencyVal,
      image: item.image ?? item.image_url ?? item.images?.[0] ?? null,
      url: item.url ?? item.product_url ?? null,
      inStock: item.in_stock ?? item.stock !== 0,
      sourceTool: toolName,
    });
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get("/", (_req, res) => res.send("Kapruka Agent Backend is running successfully!"));

app.get("/health", (_req, res) => res.json({
  ok: true,
  mongo: { connected: !!db },
  mcp: {
    url: KAPRUKA_MCP_URL,
    connected: mcpTools.length > 0,
    toolCount: mcpTools.length,
    lastError: mcpLoadError,
  },
}));

app.get("/debug-mcp", async (req, res) => {
  try {
    const list = await callMcp(KAPRUKA_MCP_URL, "tools/list");
    let sampleCall = null;
    if (list?.tools?.length > 0) {
      // Find a search or list tool
      const searchTool = list.tools.find(t => t.name.includes("search") || t.name.includes("products") || t.name.includes("list"));
      if (searchTool) {
        const sampleArgs = {};
        // Check inputSchema to pass correct arg name
        const props = searchTool.inputSchema?.properties || {};
        if (props.query) {
          sampleArgs.query = "cake";
        } else if (props.keyword) {
          sampleArgs.keyword = "cake";
        } else if (props.search) {
          sampleArgs.search = "cake";
        }
        try {
          sampleCall = await callMcp(KAPRUKA_MCP_URL, "tools/call", {
            name: searchTool.name,
            arguments: sampleArgs
          });
        } catch (err) {
          sampleCall = { error: err.message };
        }
      }
    }
    res.json({
      mcpUrl: KAPRUKA_MCP_URL,
      tools: list?.tools || [],
      sampleCall
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Chat History Endpoints ───────────────────────────────────────────────────

/**
 * GET /chats
 * Returns a list of all chat sessions (id, title, createdAt, messageCount)
 */
app.get("/chats", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "userId query parameter is required." });
    }
    const col = getChatCollection();
    if (!col) {
      // Return in-memory sessions as fallback, filtered by user
      const list = Array.from(memSessions.entries())
        .filter(([key]) => key.startsWith(`${userId}:`))
        .map(([key, msgs]) => {
          const id = key.split(":")[1];
          return {
            id,
            title: msgs.find(m => m.role === "user")?.content?.slice(0, 60) || "New Chat",
            createdAt: new Date().toISOString(),
            messageCount: msgs.length,
          };
        });
      return res.json(list);
    }
    const sessions = await col
      .find({ userId }, { projection: { _id: 1, title: 1, createdAt: 1, updatedAt: 1, messages: 1 } })
      .sort({ updatedAt: -1, createdAt: -1 })
      .toArray();

    const list = sessions.map(s => ({
      id: s._id,
      title: s.title || "New Chat",
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages?.length ?? 0,
    }));
    res.json(list);
  } catch (err) {
    console.error("GET /chats error:", err);
    res.status(500).json({ error: "Failed to fetch chat history." });
  }
});

/**
 * GET /chats/:id
 * Returns full message history for a single chat session
 */
app.get("/chats/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "userId query parameter is required." });
    }
    const col = getChatCollection();
    if (!col) {
      const memKey = `${userId}:${id}`;
      const msgs = memSessions.get(memKey) || [];
      return res.json({ id, messages: msgs });
    }
    const doc = await col.findOne({ _id: id, userId });
    if (!doc) return res.status(404).json({ error: "Chat not found." });
    res.json({ id: doc._id, title: doc.title, messages: doc.messages || [], createdAt: doc.createdAt });
  } catch (err) {
    console.error("GET /chats/:id error:", err);
    res.status(500).json({ error: "Failed to load chat." });
  }
});

/**
 * DELETE /chats/:id
 * Permanently deletes a chat session from the database
 */
app.delete("/chats/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: "userId query parameter is required." });
    }
    const col = getChatCollection();
    if (!col) {
      const memKey = `${userId}:${id}`;
      memSessions.delete(memKey);
      return res.json({ ok: true });
    }
    const result = await col.deleteOne({ _id: id, userId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "Chat not found." });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /chats/:id error:", err);
    res.status(500).json({ error: "Failed to delete chat." });
  }
});

// ─── Main Chat Endpoint ───────────────────────────────────────────────────────
app.post("/chat", async (req, res) => {
  if (!process.env.NVIDIA_API_KEY) {
    return res.status(500).json({ error: "NVIDIA_API_KEY is not configured on the server." });
  }

  const { sessionId, message, userId } = req.body ?? {};

  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "Missing sessionId" });
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Missing message" });
  }

  const history = await getHistory(sessionId, userId);
  const isFirstMessage = history.length === 0;
  const firstUserMessage = isFirstMessage ? message : null;

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
      { role: "system", content: buildSystemPrompt() },
      ...history
    ];

    const products = [];
    const orderRef = { value: null };

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
        // Execute all tool calls requested in this turn in parallel to reduce backend latency
        const toolPromises = assistantMessage.tool_calls.map(async (toolCall) => {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);

          console.log(`Executing tool ${toolName} in parallel with args:`, toolArgs);
          
          // Wrap flat arguments into a nested 'params' object if needed
          let finalArgs = toolArgs;
          const toolMeta = mcpTools.find(t => t.name === toolName);
          if (toolMeta?.inputSchema?.required?.includes("params") && !toolArgs.params) {
            finalArgs = { params: toolArgs };
          }
          
          // Force 'response_format' to 'json' so we get structured product lists
          if (finalArgs.params) {
            finalArgs.params.response_format = "json";
          } else {
            finalArgs.response_format = "json";
          }

          let toolResult;
          try {
            toolResult = await callMcpCached(KAPRUKA_MCP_URL, toolName, finalArgs);
            processToolResponse(toolName, toolResult, products, orderRef);
          } catch (err) {
            console.error(`Error calling tool ${toolName}:`, err.message);
            toolResult = {
              content: [{ type: "text", text: `Error calling tool: ${err.message}` }],
              isError: true,
            };
          }

          return {
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify(toolResult),
          };
        });

        const toolResponses = await Promise.all(toolPromises);
        currentMessages.push(...toolResponses);
        continue;
      }

      // Final text response reached
      const text = assistantMessage.content || "";
      history.push({ role: "assistant", content: text });
      trimHistory(history);

      // Persist to MongoDB
      await saveHistory(sessionId, history, firstUserMessage, userId);

      return res.json({ text, products, order: orderRef.value });
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

// ─── SSE Streaming Helpers ───────────────────────────────────────────────────

/**
 * Async generator that calls the NVIDIA API with stream:true and yields
 * parsed JSON chunks. Handles SSE framing internally.
 */
async function* streamLLMCall(messages, tools) {
  const requestBody = {
    model: MODEL,
    messages,
    temperature: 0.2,
    top_p: 1,
    stream: true,
  };
  if (tools && tools.length > 0) requestBody.tools = tools;

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
    throw new Error(`NVIDIA API error: ${response.status} — ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // retain incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === ":" || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;
        try {
          yield JSON.parse(data);
        } catch {
          // malformed chunk — skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Streaming Chat Endpoint ──────────────────────────────────────────────────
/**
 * POST /chat/stream
 * Identical logic to POST /chat but streams the final LLM response back to
 * the client as Server-Sent Events so text appears token-by-token.
 *
 * SSE event types emitted:
 *   { type: "delta",    text: "..." }   — text chunk (stream to bubble)
 *   { type: "products", data: [...] }   — product cards to display
 *   { type: "order",    data: {...} }   — checkout pay-link card
 *   { type: "done" }                    — stream complete
 *   { type: "error",    message: "..." } — fatal error
 */
app.post("/chat/stream", async (req, res) => {
  if (!process.env.NVIDIA_API_KEY) {
    return res.status(500).json({ error: "NVIDIA_API_KEY is not configured on the server." });
  }

  // ── SSE headers ────────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx/Vercel proxy buffering
  if (res.socket) {
    res.socket.setTimeout(0);
    res.socket.setNoDelay(true);
  }
  res.flushHeaders();

  const emit = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const { sessionId, message, userId } = req.body ?? {};

  if (!sessionId || typeof sessionId !== "string") {
    emit({ type: "error", message: "Missing sessionId" });
    return res.end();
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    emit({ type: "error", message: "Missing message" });
    return res.end();
  }

  const history = await getHistory(sessionId, userId);
  const isFirstMessage = history.length === 0;
  const firstUserMessage = isFirstMessage ? message : null;

  history.push({ role: "user", content: message });

  try {
    const openAiTools = await getOpenAiTools();
    if (openAiTools.length === 0) {
      history.pop();
      emit({ type: "error", message: "The shopping catalog is currently offline. Please check the Kapruka MCP connection." });
      return res.end();
    }

    let currentMessages = [
      { role: "system", content: buildSystemPrompt() },
      ...history,
    ];

    const products = [];
    const orderRef = { value: null };

    // ── Agentic loop (max 10 turns) ──────────────────────────────────────────
    for (let loop = 0; loop < 10; loop++) {
      // Accumulate the full response from the streamed chunks
      let fullContent = "";
      const toolCallsMap = {}; // index → partial tool call object
      let hasToolCalls = false;

      for await (const chunk of streamLLMCall(currentMessages, openAiTools)) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // ── Text delta: stream immediately to client ──────────────────────
        if (delta.content) {
          fullContent += delta.content;
          emit({ type: "delta", text: delta.content });
        }

        // ── Tool call delta: accumulate silently (don't stream to client) ─
        if (delta.tool_calls) {
          hasToolCalls = true;
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!toolCallsMap[idx]) {
              toolCallsMap[idx] = {
                id: tc.id || "",
                type: "function",
                function: { name: "", arguments: "" },
              };
            }
            if (tc.id) toolCallsMap[idx].id = tc.id;
            if (tc.function?.name) toolCallsMap[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCallsMap[idx].function.arguments += tc.function.arguments;
          }
        }
      }

      const toolCalls = Object.values(toolCallsMap).filter(Boolean);

      // Build and append the assistant message for this turn
      const assistantMessage = { role: "assistant", content: fullContent || null };
      if (hasToolCalls && toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls;
      }
      currentMessages.push(assistantMessage);

      // ── Tool-calling turn: execute tools, continue loop ──────────────────
      if (hasToolCalls && toolCalls.length > 0) {
        const toolPromises = toolCalls.map(async (toolCall) => {
          const toolName = toolCall.function.name;
          let toolArgs;
          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            toolArgs = {};
          }

          console.log(`[stream] Executing tool ${toolName} with args:`, toolArgs);

          // Wrap flat args into nested params object if the schema requires it
          let finalArgs = toolArgs;
          const toolMeta = mcpTools.find((t) => t.name === toolName);
          if (toolMeta?.inputSchema?.required?.includes("params") && !toolArgs.params) {
            finalArgs = { params: toolArgs };
          }

          // Force JSON response format for structured product lists
          if (finalArgs.params) {
            finalArgs.params.response_format = "json";
          } else {
            finalArgs.response_format = "json";
          }

          let toolResult;
          try {
            toolResult = await callMcpCached(KAPRUKA_MCP_URL, toolName, finalArgs);
            processToolResponse(toolName, toolResult, products, orderRef);
          } catch (err) {
            console.error(`[stream] Error calling tool ${toolName}:`, err.message);
            toolResult = {
              content: [{ type: "text", text: `Error calling tool: ${err.message}` }],
              isError: true,
            };
          }

          return {
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify(toolResult),
          };
        });

        const toolResponses = await Promise.all(toolPromises);
        currentMessages.push(...toolResponses);
        continue; // next agentic loop iteration
      }

      // ── Final text turn: persist + emit metadata + close stream ──────────
      history.push({ role: "assistant", content: fullContent });
      trimHistory(history);
      await saveHistory(sessionId, history, firstUserMessage, userId);

      if (products.length > 0) emit({ type: "products", data: products });
      if (orderRef.value) emit({ type: "order", data: orderRef.value });
      emit({ type: "done" });
      return res.end();
    }

    // Loop limit exceeded
    history.pop();
    emit({ type: "error", message: "Tool execution loop limit exceeded." });
    res.end();
  } catch (err) {
    console.error("Unexpected error in /chat/stream:", err);
    history.pop();
    emit({ type: "error", message: "Something went wrong on our end." });
    res.end();
  }
});

// ─── Warmup Endpoint (used by Vercel cron to prevent cold starts) ─────────────
app.get("/warmup", (_req, res) => {
  res.json({ ok: true, warmedAt: new Date().toISOString() });
});

// ─── Server Start ─────────────────────────────────────────────────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, async () => {
    console.log(`Kapu backend running on http://localhost:${PORT}`);
    await connectMongo();
    await loadMcpTools();
  });
} else {
  // On Vercel, connect lazily on first request
  connectMongo().catch(err => console.error("Mongo connect error:", err));
}

export default app;
