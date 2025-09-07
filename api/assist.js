// api/assist.js
module.exports = async (req, res) => {
  // Ny, robust toggle: ASSISTANT_MODE=modular
  const mode = (process.env.ASSISTANT_MODE || '').toLowerCase().trim();

  // Bakoverkompatibel toggle: USE_MODULAR_ASSISTANT=1/true
  const legacyFlag = (process.env.USE_MODULAR_ASSISTANT || '').toLowerCase().trim();

  const useModular = true;
    mode === 'modular' ||
    legacyFlag === '1' ||
    legacyFlag === 'true';

  try {
    // --- Les input trygt (både GET og POST / raw string eller JSON body) ---
    const method = (req.method || 'GET').toUpperCase();

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { /* ignorér hvis ikke JSON */ }
    }

    const fromQuery =
      (req.query && (req.query.text || req.query.message)) || '';

    const fromBody =
      (body && (body.text || body.message)) || '';

    const text = method === 'GET' ? fromQuery : fromBody;

    // --- Modulær kjerne ---
    if (useModular) {
      let core = null;
      try {
        // Kjernen ligger i ../core (én mappe opp fra api/)
        core = require('../core');
      } catch (e) {
        console.error('Kunne ikke require("../core"):', e);
      }

      if (core && typeof core.createAssistant === 'function') {
        const assistant = core.createAssistant();
        const reply = await assistant.handle({ text: String(text || '') });
        return res.status(200).json(reply);
      }
    }

    // --- Fallback (legacy) ---
    return res.status(200).json({
      type: 'answer',
      text: 'Legacy assist svar (fallback).'
    });

  } catch (err) {
    console.error('API /api/assist feilet:', err);
    return res.status(500).json({
      error: 'Internal error',
      details: String(err && err.message ? err.message : err)
    });
  }
};
