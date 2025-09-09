// api/debug/mode.js
const { createAssistant } = require('../../core');

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

  const flag = (process.env.USE_MODULAR_ASSISTANT || '').toLowerCase();
  const useModular = flag === '1' || flag === 'true';

  res.status(200).json({
    computed: { useModular },
    env: {
      ASSISTANT_MODE: process.env.ASSISTANT_MODE || 'unset',
      USE_MODULAR_ASSISTANT: process.env.USE_MODULAR_ASSISTANT || 'unset',
    },
    coreOk: typeof createAssistant === 'function',
    vercel: {
      env: process.env.VERCEL_ENV || 'unknown',
      url: process.env.VERCEL_URL || 'unset',
      commit: process.env.VERCEL_GIT_COMMIT_SHA || 'unset',
    },
  });
};
