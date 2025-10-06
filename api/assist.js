// /api/assist.js  (CommonJS, Vercel serverless)

const { createAssistant } = require('../core');

// ---------- init (varm start gjenbrukes mellom kall på Vercel) ----------
let assistant;
function getAssistant() {
  if (!assistant) assistant = createAssistant();
  return assistant;
}

// ---------- CORS ----------
function setCors(req, res) {
  // Tillat staging + evt. whitelist via env
  const defaults = [
    'https://h05693dfe8-staging.onrocket.site',
    'https://lunamedia.no'
  ];
  const extra = (process.env.LUNA_ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const allowed = new Set([...defaults, ...extra]);

  const origin = req.headers.origin || '';
  if (allowed.has(origin) || allowed.has('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ---------- handler ----------
module.exports = async (req, res) => {
  try {
    setCors(req, res);

    // Preflight
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    // Healthcheck
    if (req.method === 'GET') {
      return res.status(200).json({
        status: 'ok',
        time: new Date().toISOString(),
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Parse body
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const text = (body?.message || body?.text || '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Missing message' });
    }

    // Route via modular assistant
    const a = getAssistant();
    const result = await a.handle({ text });

    // Normaliser svarformat til frontenden
    if (result && typeof result.text === 'string') {
      return res.status(200).json({
        answer: result.text,
        meta: result.meta || null,
        source: result.source || (result.type ? String(result.type) : 'modular'),
      });
    }

    // Fallback hvis ingen tekst
    return res.status(200).json({
      answer: 'Jeg er ikke helt sikker – kan du si litt mer konkret hva du lurer på?',
      source: 'fallback',
    });

  } catch (err) {
    console.error('[assist] error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'Server error' });
  }
};
