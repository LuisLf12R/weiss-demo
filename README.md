# Weiss — Porsche Intelligent Assistant

Interactive demo. Enthusiast-voice assistant (Claude Sonnet 4.5), live streaming conversation, desktop + mobile prototypes, dealer brief, configurator hand-off.

## Routes

- **`/`** — auto-detects device. Mobile → mobile prototype fullscreen. Desktop/tablet → full design canvas.
- **`/Weiss.html?view=desktop`** — desktop prototype fullscreen.
- **`/Weiss.html?view=mobile`** — mobile prototype fullscreen.
- **`/Weiss.html?view=canvas`** — original side-by-side canvas (desktop + mobile + moments + rationale).
- Append **`&tweaks=1`** to any view to show the Tweaks panel (voice, configurator, consent, view switcher).

## Running locally

```bash
cp .env.example .env    # paste your Anthropic key
npm install
npm start               # listens on :3000
```

## Deploy to Railway

1. Push this repo to GitHub (already connected).
2. In Railway: New Project → Deploy from GitHub → pick `weiss-demo`.
3. Add env var **`ANTHROPIC_API_KEY`** (required).
4. Railway injects `PORT`; server uses it.
5. Default command is `npm start` (Procfile: `web: node server.js`).

## API

- **`GET /api/config`** → `{ llm: true|false, model }`. Frontend uses this to detect availability.
- **`POST /api/chat`** → SSE stream. Body: `{ messages: [{role, content}] }`. System prompt (the Weiss voice) is applied server-side.
- **`GET /health`** → liveness.

## Architecture

- `server.js` — Express + Anthropic SDK. Injects Weiss system prompt, streams SSE.
- `index.html` — splash + device router.
- `Weiss.html` — prototype shell. React + Babel inline.
- `components/` — desktop / mobile / features / shared / consent.
- `assets/weiss-client.js` — `Weiss.ask({messages}, {onDelta, onDone, onError})` SSE client.
- `assets/` — car imagery.

## What's wired

- Desktop Assistant: chip / Enter / mic → streaming Claude response → rec cards parsed from the response → Configure → Send to dealer → switches to Dealership view.
- Mobile: ask home → thread (live streaming) → rec detail → configure → composer + attach sheet + voice + garage + consent sheet.
- Voice: scripted transcript reveal (Web Speech unreliable in sandboxed iframes), submits to the same pipeline.
- Dealer hand-off: scripted (no real send).

## Tweaks panel

Add `?tweaks=1`. Trigger voice overlay, inject configurator, show consent banner, switch desktop view.
