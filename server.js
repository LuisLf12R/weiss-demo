require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('Warning: ANTHROPIC_API_KEY is not set. /api/chat will fail until it is configured.');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// ─────────────────────────────────────────────────────────────
// Weiss system prompt — the enthusiast voice
// ─────────────────────────────────────────────────────────────
const WEISS_SYSTEM = `You are Weiss — a Porsche Intelligent Assistant who talks like a lifelong enthusiast, not a product brochure.

VOICE
• Writes like a friend who's owned three 911s. Confident, specific, earned.
• Uses short declarative sentences. Occasional fragment. No AI throat-clearing.
• Never says "As an AI" or "I'd be happy to". Never apologizes for opinions.
• Never says "certainly", "absolutely", or "great question".
• Favors sensory, tactile language — "9,000-rpm flat-six", "stick", "the pedal feels hydraulic".
• Knows the difference between a 992.2 GTS and a 991.2 GTS without being told.
• Has taste. Is willing to say "this is the one you keep" or "skip the base Carrera."

FORMAT
• Keep answers tight. 2–4 short paragraphs maximum for prose.
• Lead with the take. Don't warm up. Don't summarize the question back.
• When recommending specific cars, include their names EXACTLY as they appear in the catalog so the UI can render cards. The catalog: "911 Carrera GTS", "911 GT3", "Taycan 4S".
• When asked to compare, be direct about trade-offs. Name a winner when there is one.
• Prices: lead with MSRP when relevant. Don't pad with disclaimers.

KNOWLEDGE GUARDRAILS
• Stay in the Porsche lane. If asked about Ferrari/Lambo/etc., you can acknowledge them briefly but bring it back to the Porsche answer.
• If asked something you don't know (e.g. a specific owner's service history), say so in one line and move on.
• Don't fabricate spec numbers. If you're not sure, say "roughly" or "in that neighborhood".

CURRENT USER CONTEXT (informs tone, do not recite)
• Name: Marcus. Owns a Cayman S '19 and owned a 991.2 GTS '16. Mentions a manual repeatedly. Budget stated at $150k but both saved configs are past $160k. Eyeing Q3 2026 delivery.`;

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', model: MODEL, timestamp: new Date().toISOString() });
});

// Runtime config for the frontend — detects if API key is configured
app.get('/api/config', (req, res) => {
  res.json({
    llm: Boolean(process.env.ANTHROPIC_API_KEY),
    model: MODEL,
  });
});

function normalizeMessages(input) {
  const messages = [];
  const systemParts = [];

  for (const msg of input || []) {
    if (!msg || typeof msg !== 'object') continue;

    const role = msg.role;
    const content = msg.content;

    if (role === 'system') {
      if (typeof content === 'string' && content.trim()) {
        systemParts.push(content.trim());
      }
      continue;
    }

    if (role !== 'user' && role !== 'assistant') continue;

    if (typeof content === 'string') {
      messages.push({ role, content });
      continue;
    }

    if (Array.isArray(content)) {
      const blocks = content
        .map((part) => {
          if (typeof part === 'string') return { type: 'text', text: part };
          if (part && part.type === 'text' && typeof part.text === 'string') {
            return { type: 'text', text: part.text };
          }
          if (part && part.type === 'image' && part.source) {
            return part;
          }
          return null;
        })
        .filter(Boolean);

      if (blocks.length > 0) {
        messages.push({ role, content: blocks });
      }
    }
  }

  return {
    messages,
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
  };
}

app.post('/api/chat', async (req, res) => {
  try {
    const incomingMessages = req.body?.messages;

    if (!Array.isArray(incomingMessages)) {
      return res.status(400).json({ error: 'Body must include a messages array.' });
    }

    const { messages, system: userSystem } = normalizeMessages(incomingMessages);

    if (messages.length === 0) {
      return res.status(400).json({ error: 'No valid user/assistant messages found.' });
    }

    // Weiss system prompt always applied; any caller-supplied system is appended
    const system = userSystem ? `${WEISS_SYSTEM}\n\n${userSystem}` : WEISS_SYSTEM;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 1500,
      messages,
      system,
    });

    res.on('close', () => {
      if (typeof stream.abort === 'function') {
        stream.abort();
      } else if (stream.controller?.abort) {
        stream.controller.abort();
      }
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        sendEvent('delta', { text: event.delta.text });
      }
    }

    sendEvent('done', { done: true });
    res.end();
  } catch (error) {
    console.error('Chat endpoint error:', error);

    const statusCode = error.status || 500;
    const errorType = error.type || 'unknown';
    const errorMessage =
      statusCode === 401 ? 'Invalid API key — check ANTHROPIC_API_KEY.' :
      statusCode === 429 ? 'Rate limit reached — too many requests.' :
      statusCode === 529 ? 'Anthropic API is overloaded — try again shortly.' :
      error.message || 'Unexpected error contacting Anthropic.';

    if (!res.headersSent) {
      return res.status(statusCode).json({ error: errorMessage, type: errorType });
    }

    res.write(`event: error\ndata: ${JSON.stringify({ error: errorMessage })}\n\n`);
    res.end();
  }
});

// Default route → the router (auto-detects device)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Weiss demo · listening on http://localhost:${PORT} · model: ${MODEL}`);
});
