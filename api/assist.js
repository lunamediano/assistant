// api/assist.js
const ALLOWED_ORIGINS = [
  'https://h05693dfe8-staging.onrocket.site',
];

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  // --- CORS + preflight ---
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Tillat både "1" og "true"
  const flag = (process.env.USE_MODULAR_ASSISTANT || '').toLowerCase();
  const useModular = flag === '1' || flag === 'true';

  try {
    // --- Hent tekst fra GET eller POST (tåler body som string/JSON) ---
    const method = (req.method || 'GET').toUpperCase();

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* ignorér */ }
    }

    const fromQuery =
      (req.query && (req.query.text || req.query.message)) || '';

    const fromBody =
      (body && (body.text || body.message)) || '';

    const text = method === 'GET' ? fromQuery : fromBody;

    // --- Bruk modulær kjerne hvis flagget er på ---
    if (useModular) {
      let modular = null;
      try {
        modular = require('../core'); // kjernen vår
      } catch (e) {
        console.error('Kunne ikke require("../core"):', e);
      }

      if (modular && typeof modular.createAssistant === 'function') {
        const assistant = modular.createAssistant();
        const reply = await assistant.handle({ text: String(text || '') });
        return res.status(200).json(reply);
      }
    }

    // --- Fallback (legacy) ---
    return res.status(200).json({
      type: 'answer',
      text: 'Legacy assist svar (fallback).'
    });

  } catch (err) {
    console.error('API /api/assist feilet:', err);
    return res.status(500).json({
      error: 'Internal error',
      details: String(err && err.message ? err.message : err)
    });
  }
};
