// api/assist.js
const ALLOWED_ORIGINS = [
  'https://h05693dfe8-staging.onrocket.site',
];

// tving bundleren til å inkludere core i lambdaen
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
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }
  return body || {};
}

function tryRequireCore() {
  const tries = [
    '../core',               // api/* -> ../core
    '../../core',            // api/debug/* -> ../../core
    '/var/task/api/core',    // absolutt (vanlig i Vercel)
    '/var/task/core',        // ev. alternativ absolutt
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
  return !!tryRequireCore(); // auto-detekt
}

module.exports = async (req, res) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const useModular = computeUseModular();

  try {
    const method = (req.method || 'GET').toUpperCase();
    const fromQuery = (req.query && (req.query.text || req.query.message)) || '';
    const fromBody = (() => {
      const b = parseBody(req);
      return (b.text || b.message || '');
    })();
    const text = method === 'GET' ? fromQuery : fromBody;

    if (useModular) {
      const core = tryRequireCore();
      if (core && typeof core.createAssistant === 'function') {
        const assistant = core.createAssistant();
        const reply = await assistant.handle({ text: String(text || '') });
        return res.status(200).json(reply);
      }
    }

    // Fallback (legacy)
    return res.status(200).json({ type: 'answer', text: 'Legacy assist svar (fallback).' });
  } catch (err) {
    console.error('API /api/assist feilet:', err);
    return res.status(500).json({ error: 'Internal error', details: String(err?.message || err) });
  }
};
