// api/debug/mode.js
module.exports = async (req, res) => {
  const mode = (process.env.ASSISTANT_MODE || '').toLowerCase().trim();
  const legacyFlag = (process.env.USE_MODULAR_ASSISTANT || '').toLowerCase().trim();

  // NB: kopier samme logikk som i api/assist.js
  // Hvis du midlertidig har "const useModular = true" i assist.js,
  // kan du sette den samme tvangen her for å sjekke at bygget er riktig.
  let useModular;
  try {
    // KOMMENTER EN AV DISSE TO LINJENE, avhengig av hva du faktisk har i assist.js:
    // 1) Hvis du tester hardkodet tvang:
    // useModular = true;

    // 2) Hvis du tester env-basert styring:
    useModular =
      mode === 'modular' ||
      legacyFlag === '1' ||
      legacyFlag === 'true';
  } catch {
    useModular = false;
  }

  // Finn ut om kjernen kan lastes
  let coreOk = false;
  try {
    const core = require('../../core');
    coreOk = typeof core.createAssistant === 'function';
  } catch { /* noop */ }

  res.status(200).json({
    computed: { useModular },
    env: { ASSISTANT_MODE: mode || 'unset', USE_MODULAR_ASSISTANT: legacyFlag || 'unset' },
    coreOk,
    vercel: {
      env: process.env.VERCEL_ENV,
      url: process.env.VERCEL_URL,
      commit: process.env.VERCEL_GIT_COMMIT_SHA
    }
  });
};
