# Kapu - a Kapruka shopping agent

A full-screen chat shopping experience built on the Kapruka MCP. The short
version of how it works: Claude does the reasoning (figuring out what
someone actually needs from a situation, not just a search term) and calls
Kapruka's tools directly through Anthropic's native MCP connector - there's
no hand-written tool-calling glue code in this project at all.

```
kapruka-agent/
  backend/     Express server - one /chat endpoint, talks to Claude + Kapruka MCP
  frontend/    React + Tailwind full-screen chat UI
```

## 1. Run the backend

```bash
cd backend
cp .env.example .env
# open .env and paste your real ANTHROPIC_API_KEY (get one at console.anthropic.com)
npm install
npm run dev
```

You should see `Kapu backend running on http://localhost:3000`.

Quick sanity check it's alive:
```bash
curl http://localhost:3000/health
```

## 2. Run the frontend

In a second terminal:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

## 3. Configure Firebase auth for logged-in sessions

Guest browsing still works without extra setup, but if you want saved chats for
logged-in users you need Firebase Admin credentials on the backend so the server
can verify the ID token sent by the frontend.

Add one of these to `backend/.env`:

- `FIREBASE_SERVICE_ACCOUNT_JSON` - the full service account JSON as a single line string
- `GOOGLE_APPLICATION_CREDENTIALS` - path to a service account JSON file on disk

Keep the existing Firebase client config in `frontend/src/firebase.js` pointed at
the same Firebase project.

## 4. Test the thing that actually matters

Before you touch the UI again, throw real situations at it and read how it
reasons, not just whether it returns products:

- "Mama iiye drink panala vaade welaawata gedhara aawa, wife hari kaduwela
  innawa" (the apology-gift scenario) - does it infer flowers/chocolates,
  ask for delivery city, and offer to write a gift message, without you
  having to say the word "flowers"?
- "Add a card and a small teddy bear too" after picking a first item - does
  it hold a multi-item cart across turns?
- "It needs to get there before Saturday" - does it call
  `kapruka_check_delivery` and actually confirm a date instead of just
  agreeing?
- The same question once in Sinhala script, once in Tamil script, once in
  Thanglish - does it reply in kind each time?

If any of these feel weak, the fix is almost always in
`backend/systemPrompt.js`, not in the frontend.

## 5. A note on product data field names

`server.js` has an `extractToolResults()` function that tries several
common field-name variants (`name`/`title`, `image`/`image_url`/`images[0]`,
`pay_url`/`payment_url`/`checkout_url`, etc.) because the exact JSON shape
the live Kapruka MCP returns wasn't available while scaffolding this. The
first time you run a real search, add a quick `console.log(rawText)` inside
that function, look at the actual shape, and tighten the field names to
match exactly - it's a five-minute edit once you can see real data.

## 6. Deploy

**Frontend → Vercel** (free, fastest path to a public URL):
1. Push this repo to GitHub
2. Import it in Vercel, set the root directory to `frontend`
3. Add an environment variable `VITE_BACKEND_URL` pointing at your deployed
   backend URL
4. Deploy

**Backend → Render or Railway** (free tier is enough for a demo):
1. New web service, root directory `backend`
2. Build command: `npm install` · Start command: `npm start`
3. Add environment variables: `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`,
   `ALLOWED_ORIGIN` (your Vercel URL), `KAPRUKA_MCP_URL`
4. Deploy, then set `VITE_BACKEND_URL` on the frontend to this service's URL

Free-tier backends on Render can go to sleep after inactivity. Set up a
free [UptimeRobot](https://uptimerobot.com) check pinging `/health` every
10 minutes so the service is awake when judges open the link.

## 7. Cost notes

Sonnet 4.6 is currently $3 per million input tokens and $15 per million
output tokens - a full shopping conversation (browsing through to checkout)
is roughly 3,000-6,000 tokens total, so a few cents per conversation at
most. The `cache_control: { type: "ephemeral" }` on the system prompt in
`server.js` cuts repeat-turn input cost further. For real production
traffic at scale, route simple lookups to Haiku 4.5 ($1/$5 per million
tokens) and keep Sonnet for the situational-reasoning turns - but for a
hackathon demo, just leave it on Sonnet throughout.

## 8. What to tune if you have extra time

In priority order:
1. `backend/systemPrompt.js` - the actual differentiator, see step 3 above
2. Field-name mapping in `extractToolResults()` once you see real data
3. The gift-message drafting flow (have Kapu offer 2-3 short message
   options instead of one, the customer picks or edits)
4. Loading/error states in the frontend for flaky network conditions
