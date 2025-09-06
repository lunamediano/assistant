// api/debug/which.js
module.exports = async (req, res) => {
  let info = { ok: true, required: null, hasCreate: false, error: null };

  try {
    const core = require('../core'); // <- MÅ lykkes
    info.required = Object.keys(core);
    info.hasCreate = typeof core.createAssistant === 'function';
  } catch (e) {
    info.error = String(e && e.message ? e.message : e);
  }

  res.status(200).json(info);
};
