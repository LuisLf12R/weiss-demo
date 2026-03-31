require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = 'claude-sonnet-4-20250514';

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
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
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

    const { messages, system } = normalizeMessages(incomingMessages);

    if (messages.length === 0) {
      return res.status(400).json({ error: 'No valid user/assistant messages found.' });
    }

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
      max_tokens: 1024,
      messages,
      ...(system ? { system } : {}),
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

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
