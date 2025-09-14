// api/debug/knowledge.js
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

  try {
    // ✅ KORREKT sti i prod (core ligger på toppnivå)
    const { loadKnowledge } = require('../../core/data/loadData');

    const data = loadKnowledge();
    const faq = Array.isArray(data?.faq) ? data.faq : [];
    const meta = data?.meta || {};
    const company = meta.company || {};
    const prices = meta.prices || {};
    const delivery = meta.delivery || {};

    res.status(200).json({
      ok: true,
      files: faq.length,
      faqCount: faq.length,
      sample: faq.slice(0, 5).map(x => ({
        id: x.id || null,
        q: x.q || null,
        src: x._source || null,
      })),
      metaSummary: {
        hasCompany: !!company.navn,
        hasPrices: Object.keys(prices).length > 0,
        hasDelivery: Object.keys(delivery).length > 0,
        sourceCompany: company._source || null,
        sourcePrices: prices._source || null,
        sourceDelivery: delivery._source || null,
      },
    });
  } catch (e) {
    res.status(200).json({
      ok: false,
      error: String(e && e.message ? e.message : e),
      stack: e?.stack ? String(e.stack).split('\n').slice(0, 6) : null,
    });
  }
};
