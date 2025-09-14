module.exports = function buildContext({ knowledge }) {
  return {
    knowledge,
    user: {},
    session: { startedAt: new Date().toISOString() }
  };
};
