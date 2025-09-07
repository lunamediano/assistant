// api/debug/which.js
module.exports = async (req, res) => {
  const info = { ok: true, required: null, hasCreate: false, error: null };

  try {
    // NB: which.js ligger i api/debug → to nivå opp til /core
    const core = require('../../core');
    info.required = Object.keys(core);
    info.hasCreate = typeof core.createAssistant === 'function';
  } catch (e) {
    info.error = String(e && e.message ? e.message : e);
  }

  res.status(200).json(info);
};
