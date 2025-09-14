// api/debug/knowledge.js
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
    return res.status(500).json({ ok: false, error: 'Fant ikke loadData i noen kjente stier' });
  }
  try {
    const data = loadKnowledge();
    const faqFiles = data?.faqIndex?.files || data?.files || [];
    const faqCount = data?.count?.faq ?? data?.faq?.length ?? 0;
    const sample = (data?.faq || []).slice(0, 5).map(x => ({
      id: x.id, q: x.q, src: x._src || x.source
    }));
    res.status(200).json({ ok: true, files: faqFiles.length, faqCount, sample });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
};

module.exports.config = {
  runtime: 'nodejs20.x',
  includeFiles: ['api/core/**','api/data/**','api/knowledge/**'],
};
