// api/debug/knowledge.js
const { loadKnowledge } = require('../../data/loadData');

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

  const data = loadKnowledge();
  res.status(200).json({
    ok: true,
    files: data.sources.length,
    faqCount: data.faq.length,
    sample: data.faq.slice(0, 5),
  });
};
