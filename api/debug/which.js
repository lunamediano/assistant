// api/debug/which.js
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
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  let required = [];
  let hasCreate = false;
  let error = null;

  try {
    const core = require('../../core');
    required = Object.keys(core);
    hasCreate = typeof core.createAssistant === 'function';
  } catch (e) {
    error = String(e && e.message ? e.message : e);
  }

  res.status(200).json({ ok: true, required, hasCreate, error });
};
