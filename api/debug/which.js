// api/debug/which.js
// Sjekker at core finnes og at createAssistant er tilgjengelig

function tryRequireCore() {
  const tries = ['../../core', '../core', '/var/task/core', '/var/task/api/core'];
  for (const p of tries) {
    try { return require(p); } catch {}
  }
  return null;
}

module.exports = async (_req, res) => {
  const core = tryRequireCore();
  const hasCreate = !!(core && typeof core.createAssistant === 'function');
  res.status(200).json({
    ok: true,
    required: hasCreate ? ['createAssistant'] : [],
    hasCreate,
    error: hasCreate ? null : 'Fant ikke core eller createAssistant'
  });
};

// --- Per-funksjon konfig: pakk inn core/data/knowledge i lambdaen
module.exports.config = {
  runtime: 'nodejs20.x',
  includeFiles: ['core/**', 'data/**', 'knowledge/**'],
};
