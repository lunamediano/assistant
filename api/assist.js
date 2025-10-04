// api/assist.js
const path = require('path');

const BASE_ALLOWED_ORIGINS = [
  'https://lunamedia.vercel.app',
  'https://lunamedia-git-main-lunamedia.vercel.app',
  'https://h05693dfe8-staging.onrocket.site',
  'https://lunamedia.no',
];

function buildAllowedOrigins() {
  const extra = (process.env.LUNA_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return Array.from(new Set([...BASE_ALLOWED_ORIGINS, ...extra]));
}

function applyCors(req, res) {
  const allowedOrigins = buildAllowedOrigins();
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function parseBody(req) {
  const body = req.body;
  if (!body) return {};
  if (typeof body === 'object') return body;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch (_) {
      return {};
    }
  }
  return {};
}

function resolveCoreModule() {
  const guesses = [
    path.join(__dirname, '..', 'core'),
    path.join(process.cwd(), 'core'),
    '/var/task/core',
  ];

  for (const candidate of guesses) {
    try {
      const mod = require(candidate);
      if (mod && typeof mod.createAssistant === 'function') {
        return mod;
      }
    } catch (_) {}
  }
  return null;
}

function extractText(req) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET') {
    const query = req.query || {};
    return query.text || query.message || '';
  }
  const body = parseBody(req);
  return body.text || body.message || '';
}

module.exports = async (req, res) => {
  applyCors(req, res);
  if ((req.method || '').toUpperCase() === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  try {
    const core = resolveCoreModule();
    if (!core) {
      res.status(500).json({
        error: 'Modul core ikke tilgjengelig',
      });
      return;
    }

    const assistant = core.createAssistant();
    if (!assistant || typeof assistant.handle !== 'function') {
      res.status(500).json({
        error: 'createAssistant() returnerte ingen gyldig assistent',
      });
      return;
    }

    const text = String(extractText(req) || '');
    const reply = await assistant.handle({ text });
    res.status(200).json(reply || {});
  } catch (err) {
    console.error('[api/assist] Feil:', err);
    res.status(500).json({
      error: 'Internal Server Error',
      details: String(err && err.message ? err.message : err),
    });
  }
};
