// api/debug/knowledge.js
// Laster kunnskapsbasen og returnerer litt statistikk

function tryLoadKnowledge() {
  const tries = ['../../data/loadData', '../data/loadData', '/var/task/data/loadData'];
  for (const p of tries) {
    try { return require(p).loadKnowledge; } catch {}
  }
  return null;
}

module.exports = async (_req, res) => {
  const loadKnowledge = tryLoadKnowledge();
  if (!loadKnowledge) {
    return res.status(500).json({
      ok: false,
      error: 'Fant ikke loadData i noen kjente stier'
    });
  }
  try {
    const data = loadKnowledge();
    const faqFiles = data?.faqIndex?.files || [];
    const faqCount = data?.faq?.length || 0;

    res.status(200).json({
      ok: true,
      files: faqFiles.length,
      faqCount,
      sample: (data?.faq || []).slice(0, 5).map(x => ({
        id: x.id, q: x.q, src: x._src
      })),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
};

// --- Vercel bundle-hint
module.exports.config = {
  runtime: 'nodejs20.x',
  includeFiles: ['core/**', 'data/**', 'knowledge/**'],
};
