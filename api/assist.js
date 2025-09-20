// api/assist.js

// i tryRequireCore: prøv '../core' og '/var/task/core'

module.exports.config = {
  runtime: 'nodejs20.x',
  includeFiles: ['core/**','data/**','knowledge/**'],
};

// --- CORS whitelist (legg evt. til flere domener ved behov) ---
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

// --- Hjelpefunksjon: parse body ---
function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch {}
  }
  return body || {};
}

// --- Hjelpefunksjon: prøv å require core ---
function tryRequireCore() {
  const tries = [
    '../core',             // api/* -> ../core
    '/var/task/api/core',  // absolutt Vercel-sti
    '/var/task/core',      // fallback
  ];
  for (const p of tries) {
    try { return require(p); } catch {}
  }
  return null;
}

// --- Bestem om vi skal bruke modulær assistent ---
function computeUseModular() {
  const mode = (process.env.ASSISTANT_MODE || '').toLowerCase();
  const flag = (process.env.USE_MODULAR_ASSISTANT || '').toLowerCase();
  if (mode === 'modular' || flag === '1' || flag === 'true') return true;
  return !!tryRequireCore(); // fallback: aktiver hvis core faktisk finnes
}

// --- Selve handleren ---
module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const useModular = computeUseModular();

  try {
    const method = (req.method || 'GET').toUpperCase();
    const fromQuery = (req.query && (req.query.text || req.query.message)) || '';
    const body = parseBody(req);
    const fromBody = body.text || body.message || '';
    const text = method === 'GET' ? fromQuery : fromBody;

    if (useModular) {
      const core = tryRequireCore();
      if (core && typeof core.createAssistant === 'function') {
        const assistant = core.createAssistant();
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
      details: String(err?.message || err)
    });
  }
};
