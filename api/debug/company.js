// api/debug/company.js
function tryLoadKnowledge() {
  const tries = ['../data/loadData', '/var/task/api/data/loadData'];
  for (const p of tries) {
    try {
      const mod = require(p);
      if (mod && typeof mod.loadKnowledge === 'function') return mod.loadKnowledge;
    } catch {}
  }
  return null;
}

module.exports = async (_req, res) => {
  const loadKnowledge = tryLoadKnowledge();
  if (!loadKnowledge) {
    return res.status(500).json({ ok: false, error: 'Finner ikke loadKnowledge()' });
  }
  try {
    const data = loadKnowledge();
    res.status(200).json({
      ok: true,
      hasCompany: !!data?.meta?.company,
      company: data?.meta?.company || null,
      services: data?.meta?.services || [],
      prices: data?.meta?.prices || {},
      delivery: data?.meta?.delivery || {},
      sources: (data?.faqIndex?.files || data?.files || []).length
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
};

module.exports.config = {
  runtime: 'nodejs20.x',
  includeFiles: ['api/core/**','api/data/**','api/knowledge/**'],
};
