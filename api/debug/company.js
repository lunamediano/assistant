// api/debug/company.js
// Leser meta/firma-info fra loadKnowledge()

function tryLoadKnowledge() {
  // fra api/debug/* er veien til data/* to nivåer opp
  const tries = ['../../data/loadData', '../data/loadData', '/var/task/data/loadData'];
  for (const p of tries) {
    try { return require(p).loadKnowledge; } catch {}
  }
  return null;
}

module.exports = async (_req, res) => {
  const loadKnowledge = tryLoadKnowledge();
  if (!loadKnowledge) {
    return res.status(500).json({ ok: false, error: 'Finner ikke loadKnowledge()' });
  }
  try {
    const data = loadKnowledge(); // synkron i vår kode
    res.status(200).json({
      ok: true,
      hasCompany: !!data?.meta?.company,
      company: data?.meta?.company || null,
      sources: data?.meta?._source ? 1 : 0,
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
