// server.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import https from "https";
import http from "http";
import { SYSTEM_PROMPT } from "./systemPrompt.js";

const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || "z-ai/glm-5.1";
const KAPRUKA_MCP_URL = process.env.KAPRUKA_MCP_URL || "https://mcp.kapruka.com/mcp";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:5173";

if (!process.env.NVIDIA_API_KEY) {
  console.error("Missing NVIDIA_API_KEY in .env");
  process.exit(1);
}

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
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

// Custom MCP SSE/Streamable HTTP client connection function using native http/https
function callMcp(baseUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(baseUrl);
    const lib = baseUrl.startsWith("https:") ? https : http;

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
      if (res.statusCode !== 200) {
        let body = "";
        res.on("data", chunk => body += chunk);
        res.on("end", () => {
          reject(new Error(`Failed to connect to SSE. Status: ${res.statusCode}, Body: ${body}`));
        });
        return;
      }

      let buffer = "";
      let postUrl = null;
      let result = null;
      const requestId = Math.floor(Math.random() * 1000000);
      let sentPost = false;

      let currentEvent = null;
      let currentData = "";

      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop();

        for (const line of lines) {
          if (line.trim() === "") {
            const eventType = currentEvent || "message";
            if (eventType === "endpoint" && currentData) {
              postUrl = new URL(currentData.trim(), baseUrl).toString();
              if (!sentPost) {
                sentPost = true;

                const postUrlObj = new URL(postUrl);
                const postLib = postUrl.startsWith("https:") ? https : http;
                const postData = JSON.stringify({
                  jsonrpc: "2.0",
                  id: requestId,
                  method,
                  params
                });

                const postOptions = {
                  hostname: postUrlObj.hostname,
                  port: postUrlObj.port || (postUrlObj.protocol === "https:" ? 443 : 80),
                  path: postUrlObj.pathname + postUrlObj.search,
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(postData),
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                  }
                };

                const postReq = postLib.request(postOptions, (postRes) => {
                  postRes.on("data", () => {}); // consume response
                });
                postReq.on("error", (err) => {
                  console.error("POST request error in MCP call:", err.message);
                });
                postReq.write(postData);
                postReq.end();
              }
            } else if (eventType === "message" && currentData) {
              try {
                const parsed = JSON.parse(currentData.trim());
                if (parsed.id === requestId) {
                  result = parsed.result;
                  req.destroy(); // close the SSE request
                  resolve(result);
                  return;
                }
              } catch (e) {
                // Ignore
              }
            }
            currentEvent = null;
            currentData = "";
          } else if (line.startsWith("event:")) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            currentData += (currentData ? "\n" : "") + line.slice(5).trim();
          }
        }
      });

      res.on("end", () => {
        if (result === null) {
          reject(new Error("SSE connection ended without response"));
        }
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.end();
  });
}

// Dynamically loaded MCP tools
let mcpTools = [];
async function loadMcpTools() {
  try {
    const res = await callMcp(KAPRUKA_MCP_URL, "tools/list");
    mcpTools = res?.tools || [];
    console.log(`Successfully loaded ${mcpTools.length} tools from Kapruka MCP server:`, mcpTools.map(t => t.name));
  } catch (err) {
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

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/chat", async (req, res) => {
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
    let currentMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history
    ];

    const products = [];
    const orderRef = { value: null };

    // Max 10 sequential tool calls per user interaction loop
    for (let loop = 0; loop < 10; loop++) {
      const requestBody = {
        model: MODEL,
        messages: currentMessages,
        temperature: 1,
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

app.listen(PORT, async () => {
  console.log(`Kapu backend running on http://localhost:${PORT}`);
  await loadMcpTools();
});

export default app;

