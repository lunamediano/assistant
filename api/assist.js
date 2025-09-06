// api/assist.js  (CommonJS, trygg for GET/POST)
module.exports = async (req, res) => {
  const useModular = process.env.USE_MODULAR_ASSISTANT === '1';

  try {
    // Les tekst trygt (fungerer for både GET og POST)
    const method = (req.method || 'GET').toUpperCase();
    const fromQuery = (req.query && (req.query.text || req.query.message)) || '';
    const fromBody =
      req.body && (req.body.text || req.body.message)
        ? (req.body.text || req.body.message)
        : '';
    const text = method === 'GET' ? fromQuery : fromBody;

    if (useModular) {
      let modular = null;
      try {
        // fra /api til /assistant (én mappe opp)
        modular = require('../assistant');
      } catch (e) {
        console.error('Kunne ikke require("../assistant"):', e);
      }

      if (modular && typeof modular.createAssistant === 'function') {
        const assistant = modular.createAssistant();
        const reply = await assistant.handle({ text });
        return res.status(200).json(reply);
      }
    }

    // Fallback (legacy)
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
