// api/debug/which.js
function tryRequireCore() {
  const tries = ['../core', '/var/task/api/core']; // fra api/debug/* er ../core korrekt
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

module.exports.config = {
  runtime: 'nodejs20.x',
  includeFiles: ['api/core/**','api/data/**','api/knowledge/**'],
};
