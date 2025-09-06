// api/debug/company.js
const { loadKnowledge } = require('../../data/loadData');

module.exports = async (req, res) => {
  try {
    const data = loadKnowledge();
    res.status(200).json({
      ok: true,
      hasCompany: !!data.meta.company,
      company: data.meta.company || null,
      services: data.meta.services || [],
      prices: data.meta.prices || {},
      delivery: data.meta.delivery || {},
      sources: data.files.length
    });
  } catch (e) {
    console.error('debug/company error:', e);
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};
