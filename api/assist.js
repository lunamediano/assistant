// api/assist.js

// --- Per-funksjon konfig: tving bundleren til å ta med core/data/knowledge ---
module.exports.config = {
  runtime: 'nodejs20.x',
  includeFiles: ['core/**', 'data/**', 'knowledge/**']
};

// --- CORS whitelist (staging-domenet ditt) ---
const ALLOWED_ORIGINS = [
  'https://h05693dfe8-staging.onrocket.site',
];

// Liten “hint” til bundleren i tillegg (skader ikke)
try { require('../core'); } catch {}

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch {}
  }
  return body || {};
}

function tryRequireCore() {
  const tries = [
    '../core',            // api/* -> ../core
    '../../core',         // api/debug/* -> ../../core
    '/var/task/core',     // absolutt sti i Vercel
    '/var/task/api/core', // ev. alternativ absolutt
  ];
  for (const p of tries) {
    try { return require(p); } catch {}
  }
  return null;
}

function computeUseModular() {
  const mode = (process.env.ASSISTANT_MODE || '').toLowerCase();
  const flag = (process.env.USE_MODULAR_ASSISTANT || '').toLowerCase();
  if (mode === 'modular' || flag === '1' || flag === 'true') return true;
  return !!tryRequireCore(); // auto når core faktisk er pakket inn
}

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const useModular = computeUseModular();

  try {
    const method = (req.method || 'GET').toUpperCase();
    const q = (req.query && (req.query.text || req.query.message)) || '';
    const b = parseBody(req);
    const bodyText = b.text || b.message || '';
    const text = method === 'GET' ? q : bodyText;

    if (useModular) {
      const core = tryRequireCore();
      if (core && typeof core.createAssistant === 'function') {
        const assistant = core.createAssistant();
        const reply = await assistant.handle({ text: String(text || '') });
        return res.status(200).json(reply);
      }
    }

    // Fallback (legacy)
    return res.status(200).json({
      type: 'answer',
      text: 'Legacy assist svar (fallback).'
    });
  } catch (err) {
    console.error('API /api/assist feilet:', err);
    return res.status(500).json({
      error: 'Internal error',
      details: String(err?.message || err)
    });
  }
};
