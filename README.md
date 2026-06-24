# NutriChat — WhatsApp-style Nutrition Agent 🥗

A nutrition / calorie-tracking chat app with a WhatsApp look. Snap a food
**photo** or **describe** your meal; the agent identifies the food, asks
portion-size questions when unsure, estimates calories + macros with a
confidence score, and keeps a **running daily log**.

Runs entirely as a web app — open the URL in any browser, no accounts needed.

Built with **Next.js (App Router)** + the **Vercel AI SDK** (`ToolLoopAgent`) +
**Claude Opus 4.8** (vision) via the **Vercel AI Gateway**.

## How it works

```
Browser chat UI ──► POST /api/chat ──► nutritionAgent (Claude Opus 4.8, vision)
                                          tools: logMeal, getDailyLog,
                                                 setProfile, clearDay
                                          store: .data/log.json (per browser id)
```

- `app/page.tsx` — WhatsApp-style chat UI (text + image upload, `useChat`).
- `app/api/chat/route.ts` — streams the agent's reply back to the UI.
- `agent/nutrition-agent.ts` — the agent: nutritionist instructions + tools.
- `lib/store.ts` — per-user file store (profile, meal log, history). Each browser
  gets a stable id in `localStorage`. Swap for Postgres/Redis in production.

## Run locally

```bash
npm install
cp .env.example .env.local      # add AI_GATEWAY_API_KEY
npm run dev                     # http://localhost:3000
```

Get `AI_GATEWAY_API_KEY` from **Vercel → AI Gateway → API Keys**. (On a Vercel
deployment it's handled automatically via OIDC and can be omitted.)

## Deploy to Vercel

```bash
npm i -g vercel
vercel login
vercel deploy            # preview URL
vercel env add AI_GATEWAY_API_KEY
vercel deploy --prod
```

## Try it

- Send a photo of your lunch → detected items, calorie range, macros, confidence.
- "2 chapati and egg gravy with 2 eggs" → logged with a running total.
- "My goal is 1800 kcal, I'm in India" → saved to your profile.
- "Daily Summary" / "End Day Report" → full daily nutrition report.
- "Clear today" → resets the day.

## Notes

- The JSON file store is single-instance. For multi-user / scale, move it to a
  shared DB (Vercel Marketplace Neon Postgres / Upstash Redis).
- Model is set in `agent/nutrition-agent.ts` (`anthropic/claude-opus-4.8`).
  Switch to `anthropic/claude-sonnet-4.6` to cut cost ~40% with similar vision.
