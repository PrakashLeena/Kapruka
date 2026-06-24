// api/index.js — Vercel serverless entry point
// This file is intentionally self-contained: Vercel's bundler can't handle
// the __dirname / fileURLToPath pattern from server.js, so we inline the
// express app here without that boilerplate.

import express from "express";
import cors from "cors";
import https from "https";
import http from "http";

// ─── Config (all from Vercel env vars — no .env file needed) ───────────────
const MODEL           = process.env.CLAUDE_MODEL    || "z-ai/glm-5.1";
const NVIDIA_BASE_URL = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
const KAPRUKA_MCP_URL = process.env.KAPRUKA_MCP_URL || "https://mcp.kapruka.com/mcp";
const ALLOWED_ORIGIN  = (process.env.ALLOWED_ORIGIN || "").replace(/\/$/, "");

// ─── System prompt (inline copy — keep in sync with backend/systemPrompt.js) ─
const SYSTEM_PROMPT = `
You are Kapu, a warm, witty shopping companion for Kapruka, Sri Lanka's
largest e-commerce platform. You help people figure out what to buy, not
just search for things they already know the name of.

## Who you're talking to
Sri Lankan customers, shopping for themselves or for people in their life.
Many will write in Sinhala script, Tamil script, plain English, or
romanized Thanglish/Tanglish (Sinhala or Tamil words spelled out in English
letters, e.g. "kohomada", "epdiyana", "evlo vilai"). Mirror whatever the
customer uses. If they write in Thanglish, reply in Thanglish. If they
switch languages mid-conversation, switch with them. Never force pure
English on someone who didn't start in pure English, and never correct
their spelling or grammar.

## Your real job: understand the SITUATION, not just the SEARCH TERM
A huge number of customers don't know what they want - they know what's
*happening* in their life right now. Your job is to translate a situation
into a real, purchasable recommendation. Before you recommend anything,
work out (silently, don't interrogate the customer with a checklist):

- WHO is this for - self, spouse/partner, parent, child, friend, colleague
- WHAT's the emotional context or occasion - apology, birthday, anniversary,
  "just because", congratulations, condolence, festival (Avurudu, Vesak,
  Christmas, Deepavali, Eid)
- BUDGET - ask if it's not mentioned, never assume a number
- WHEN it needs to arrive, and WHERE (delivery city)

If the customer describes a situation instead of naming a product, translate
it yourself into 2-3 concrete recommendation categories. Don't ask "what
product are you looking for" - that puts the work back on them, which is
exactly what they came to you to avoid.

Worked example (use this as a calibration reference, don't repeat it
verbatim to customers):
  Customer: "Mama iiye drink panala vaade welaawata gedhara aawa, wife
  hari kaduwela innawa."
  (Came home late after drinking, wife is quite upset.)
  Your reasoning: this calls for a sincere apology gesture, not a generic
  gift. Good categories: fresh flowers (roses or a soft bouquet, not
  anything that reads as "cheap"), good chocolates, maybe a small jewelry
  piece if budget allows. Delivery should be fast - today or first thing
  tomorrow, since the situation is urgent. A heartfelt gift message matters
  more here than in a normal gift, so proactively offer to help write one.
  You would NOT recommend something generic like a gift card here - the
  situation calls for something that shows effort.

## Tool use rules
- **SEARCH FIRST, TALK SECOND.** At the very first hint of product intent -
  even if the customer hasn't named a product yet - immediately call
  kapruka_search_products (or kapruka_list_categories) with your best
  inferred search term. Do NOT wait for more clarification before searching.
  You can ask a follow-up question AND search in the same turn.
- Never invent a product, price, or delivery estimate. Use MCP tools for
  every product, price, and delivery check.
- Infer search terms from situations:
    - "wife is upset" -> search "flowers", "chocolates"
    - "birthday mother" -> search "birthday cake", "gift for mother"
    - "apology gift" -> search "flowers", "chocolates", "gift hamper"
    - "friend is sick" -> search "get well soon", "fruit basket"
    - "Avurudu" -> search "New Year gift", "kavum kokis"
  Call 1-2 searches immediately.
- Use kapruka_list_categories to explore the catalog when the intent is
  broad or unclear before narrowing to kapruka_search_products.
- Always run kapruka_check_delivery before confirming a delivery date or
  promising same-day/next-day delivery.
- Build up a cart across the conversation as the customer adds items - you
  can recommend, search, and check delivery for multiple items before a
  single kapruka_create_order call at the end. Don't create an order until
  the customer has confirmed everything (items, recipient, address, date).
- If a product is a cake, flower, or perishable combo, double check the
  perishable warning kapruka_check_delivery returns and mention it.

## Conversation style
- Ask ONE short clarifying question at a time. Never a multi-part checklist.
- Be visual in how you describe things, but let the actual product cards
  (rendered by the frontend from your tool results) do the heavy lifting -
  you don't need to describe every product in detail in text, just react to
  it naturally ("this one's lovely for an apology gift, soft pink roses").
- Have a point of view - if asked "what do you think", give a real opinion,
  don't just list options neutrally.
- Keep replies conversational and not too long. This is a chat, not an essay.

## Getting to checkout
Once the customer has picked their items, confirm in this order before
calling kapruka_create_order:
1. Final item list (and quantities)
2. Recipient name and delivery address/city
3. Delivery date
4. Whether they want a gift message - if yes, offer to draft one for them
   based on the situation, then let them edit it
5. Sender details for the order

After creating the order, clearly present the pay link as the next step -
make it feel like the natural last step of the conversation, not a sudden
handoff to a different page.
`.trim();

// ─── MCP plumbing ──────────────────────────────────────────────────────────
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
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers
    };

    const finish = (res, body) => {
      const dataLine = body.split(/\r?\n/).find(l => l.startsWith("data:"));
      let resultBody = dataLine ? dataLine.slice(5).trim() : body;
      let json = null;
      try { json = resultBody ? JSON.parse(resultBody) : null; } catch { /* raw */ }
      resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, headers: res.headers, body, json });
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
        const ct = res.headers["content-type"] || "";
        if (ct.includes("text/event-stream")) {
          const dl = body.split(/\r?\n/).find(l => l.startsWith("data:"));
          if (dl) { try { JSON.parse(dl.slice(5).trim()); finishOnce(); } catch { /* wait */ } }
        } else {
          try { JSON.parse(body); finishOnce(); } catch { /* wait */ }
        }
      });
      res.on("end", finishOnce);
    });

    req.setTimeout(20000, () => { req.destroy(); reject(new Error("MCP request timed out")); });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

let mcpSessionId = null;
async function ensureMcpSession() {
  if (mcpSessionId) return mcpSessionId;
  const init = await mcpPost(KAPRUKA_MCP_URL, {
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "kapruka-agent-backend", version: "1.0.0" } }
  });
  const sid = init.headers["mcp-session-id"];
  if (!init.ok || !sid) throw new Error(`MCP init failed: ${init.status} ${init.body}`);
  mcpSessionId = sid;
  await mcpPost(KAPRUKA_MCP_URL, { jsonrpc: "2.0", method: "notifications/initialized" }, mcpSessionId);
  return mcpSessionId;
}

async function callMcp(method, params = {}) {
  const sid = await ensureMcpSession();
  const id = Math.floor(Math.random() * 1_000_000);
  const resp = await mcpPost(KAPRUKA_MCP_URL, { jsonrpc: "2.0", id, method, params }, sid);
  if (!resp.ok) {
    if (resp.status === 404 || resp.status === 400) mcpSessionId = null;
    throw new Error(`MCP ${method} failed: ${resp.status} ${resp.body}`);
  }
  if (resp.json?.error) throw new Error(`MCP error: ${JSON.stringify(resp.json.error)}`);
  return resp.json?.result;
}

// ─── MCP tools cache ────────────────────────────────────────────────────────
let mcpTools = [];
let mcpLoadError = null;

async function loadMcpTools() {
  try {
    const res = await callMcp("tools/list");
    mcpTools = res?.tools || [];
    mcpLoadError = null;
    console.log(`Loaded ${mcpTools.length} MCP tools:`, mcpTools.map(t => t.name));
  } catch (err) {
    mcpTools = [];
    mcpLoadError = err.message;
    console.error("Failed to load MCP tools:", err.message);
  }
}

async function getOpenAiTools() {
  if (mcpTools.length === 0) await loadMcpTools();
  return mcpTools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
}

// ─── Product extraction ─────────────────────────────────────────────────────
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
  try { parsed = JSON.parse(rawText); } catch { return; }
  if (!parsed || typeof parsed !== "object") return;
  const items = Array.isArray(parsed) ? parsed : parsed.results ?? parsed.products ?? [parsed];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const payUrl = item.pay_url ?? item.payment_url ?? item.checkout_url ?? item.pay_link;
    if (payUrl) {
      orderRef.value = { orderNumber: item.order_number ?? item.order_id ?? null, payUrl, total: item.total ?? item.amount ?? null, currency: item.currency ?? "LKR" };
      continue;
    }
    const name = item.name ?? item.title ?? item.product_name;
    if (!name) continue;
    products.push({
      id: item.id ?? item.product_id ?? name, name,
      price: item.price ?? item.amount ?? null,
      currency: item.currency ?? "LKR",
      image: item.image ?? item.image_url ?? item.images?.[0] ?? null,
      url: item.url ?? item.product_url ?? null,
      inStock: item.in_stock ?? item.stock !== 0,
      sourceTool: toolName,
    });
  }
}

// ─── Parallel background search ─────────────────────────────────────────────
const SITUATION_MAP = [
  { rx: /upset|angry|fight|argue|apolog|sorry|forgive|mad|kadura|kaduwela|husbandan|wahini/i, terms: ["flowers", "chocolates"] },
  { rx: /birthday|born|upandina|upadina|pirandha/i,                                            terms: ["birthday cake", "birthday gift"] },
  { rx: /anniversar|valentine|love|romance|darling|sweetheart/i,                               terms: ["flowers", "jewelry"] },
  { rx: /sick|ill|hospital|recover|get well|unwell/i,                                          terms: ["fruit basket", "get well soon"] },
  { rx: /avurudu|new year|sinhala.*new|aluth.*avurudu/i,                                       terms: ["new year gift", "hamper"] },
  { rx: /graduat|congrat|pass|exam|promot/i,                                                   terms: ["gift hamper", "chocolates"] },
  { rx: /baby|newborn|infant|pregnant/i,                                                       terms: ["baby gift", "soft toy"] },
  { rx: /wedding|married|bride|groom|nuptial/i,                                                terms: ["wedding gift", "flowers"] },
  { rx: /mother|mom|amma|father|dad|thatha/i,                                                  terms: ["flowers", "gift hamper"] },
  { rx: /child|kid|son|daughter|putha|duwee/i,                                                 terms: ["toy", "kids gift"] },
  { rx: /chocolate|sweet|candy|cake/i,                                                         terms: ["chocolates"] },
  { rx: /flower|rose|bouquet|puspaya/i,                                                        terms: ["flowers"] },
  { rx: /deliver|send|post|courier/i,                                                          terms: ["gift hamper"] },
  { rx: /vesak|deepavali|diwali|christmas|eid|poya/i,                                         terms: ["festival gift", "hamper"] },
];

function extractSearchKeywords(message) {
  const matched = [];
  for (const { rx, terms } of SITUATION_MAP) {
    if (rx.test(message)) {
      for (const t of terms) { if (!matched.includes(t)) matched.push(t); }
      if (matched.length >= 2) break;
    }
  }
  if (matched.length === 0) {
    const words = message.replace(/[^a-zA-Z\s]/g, " ").trim().split(/\s+/).filter(w => w.length > 3);
    if (words.length > 0) matched.push(words.slice(0, 3).join(" "));
  }
  return matched.slice(0, 2);
}

async function parallelProductSearch(message) {
  const keywords = extractSearchKeywords(message);
  if (!keywords.length) return [];
  const searchTool = mcpTools.find(t => t.name === "kapruka_search_products");
  if (!searchTool) return [];
  const results = await Promise.allSettled(
    keywords.map(kw => callMcp("tools/call", { name: "kapruka_search_products", arguments: { query: kw } }))
  );
  const products = [];
  const orderRef = { value: null };
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "fulfilled") {
      processToolResponse("kapruka_search_products", results[i].value, products, orderRef);
    } else {
      console.warn(`Parallel search "${keywords[i]}" failed:`, results[i].reason?.message);
    }
  }
  return products;
}

// ─── Session store ──────────────────────────────────────────────────────────
const sessions = new Map();
function getHistory(sid) { if (!sessions.has(sid)) sessions.set(sid, []); return sessions.get(sid); }
function trimHistory(h) { if (h.length > 24) h.splice(0, h.length - 24); }

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")
        || origin.startsWith("https://localhost:") || origin.startsWith("https://127.0.0.1:")
        || (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN)
        || (origin && origin.endsWith(".vercel.app"))
    ) { cb(null, true); } else { cb(null, false); }
  }
}));
app.use(express.json({ limit: "2mb" }));

app.get("/", (_req, res) => res.send("Kapruka Agent Backend is running!"));
app.get("/health", (_req, res) => res.json({ ok: true, mcp: { url: KAPRUKA_MCP_URL, connected: mcpTools.length > 0, toolCount: mcpTools.length, lastError: mcpLoadError } }));

app.post("/chat", async (req, res) => {
  if (!process.env.NVIDIA_API_KEY) {
    return res.status(500).json({ error: "NVIDIA_API_KEY is not configured on the server." });
  }
  const { sessionId, message } = req.body ?? {};
  if (!sessionId || typeof sessionId !== "string") return res.status(400).json({ error: "Missing sessionId" });
  if (!message || typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "Missing message" });

  const history = getHistory(sessionId);
  history.push({ role: "user", content: message });

  try {
    const openAiTools = await getOpenAiTools();
    if (openAiTools.length === 0) {
      history.pop();
      return res.status(503).json({ error: "The shopping catalog is currently offline. Please try again.", detail: mcpLoadError });
    }

    let currentMessages = [{ role: "system", content: SYSTEM_PROMPT }, ...history];
    const products = [];
    const orderRef = { value: null };

    // Fire parallel search immediately as a safety net
    const parallelSearchPromise = parallelProductSearch(message).catch(err => {
      console.warn("Parallel search rejected:", err.message);
      return [];
    });

    for (let loop = 0; loop < 10; loop++) {
      const requestBody = {
        model: MODEL,
        messages: currentMessages,
        temperature: 0.2,
        top_p: 1,
        tools: openAiTools,
      };

      const response = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.NVIDIA_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Nvidia API error:", response.status, errText);
        history.pop();
        return res.status(502).json({ error: "The agent had trouble responding. Please try again." });
      }

      const data = await response.json();
      const assistantMessage = data.choices?.[0]?.message;
      if (!assistantMessage) throw new Error("No message returned from Nvidia API");

      currentMessages.push(assistantMessage);

      if (assistantMessage.tool_calls?.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);
          console.log(`Executing tool ${toolName}:`, toolArgs);
          let toolResult;
          try {
            toolResult = await callMcp("tools/call", { name: toolName, arguments: toolArgs });
            processToolResponse(toolName, toolResult, products, orderRef);
          } catch (err) {
            console.error(`Tool ${toolName} error:`, err.message);
            toolResult = { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
          }
          currentMessages.push({ role: "tool", tool_call_id: toolCall.id, name: toolName, content: JSON.stringify(toolResult) });
        }
        continue;
      }

      const text = assistantMessage.content || "";
      history.push({ role: "assistant", content: text });
      trimHistory(history);

      // AI-found products take priority; fall back to parallel search
      let finalProducts = products;
      if (finalProducts.length === 0) {
        try { finalProducts = await parallelSearchPromise; } catch (err) { console.warn("Parallel search error:", err.message); }
      }

      return res.json({ text, products: finalProducts, order: orderRef.value });
    }

    history.pop();
    return res.status(502).json({ error: "Tool execution loop limit exceeded." });

  } catch (err) {
    console.error("Unexpected error in /chat:", err);
    history.pop();
    return res.status(500).json({ error: "Something went wrong on our end." });
  }
});

export default app;
