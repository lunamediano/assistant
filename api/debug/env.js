// api/debug/env.js
module.exports = async (req, res) => {
  res.status(200).json({
    USE_MODULAR_ASSISTANT: process.env.USE_MODULAR_ASSISTANT ?? 'unset',
    DEBUG_ASSISTANT: process.env.DEBUG_ASSISTANT ?? 'unset',
    node: process.version,
    vercel: {
      env: process.env.VERCEL_ENV,                // "production" | "preview" | "development"
      url: process.env.VERCEL_URL,                // host for akkurat denne deployen
      commit: process.env.VERCEL_GIT_COMMIT_SHA,  // hvilken commit denne lambdaen ble bygget fra
      buildTime: process.env.BUILD_TIME || 'n/a'
    }
  });
};
