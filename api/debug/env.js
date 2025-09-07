// api/debug/env.js
module.exports = async (req, res) => {
  res.status(200).json({
    ASSISTANT_MODE: process.env.ASSISTANT_MODE ?? 'unset',
    USE_MODULAR_ASSISTANT: process.env.USE_MODULAR_ASSISTANT ?? 'unset',
    DEBUG_ASSISTANT: process.env.DEBUG_ASSISTANT ?? 'unset',
    node: process.version,
    vercel: {
      env: process.env.VERCEL_ENV,
      url: process.env.VERCEL_URL,
      commit: process.env.VERCEL_GIT_COMMIT_SHA,
      buildTime: process.env.BUILD_TIME || 'n/a'
    }
  });
};
