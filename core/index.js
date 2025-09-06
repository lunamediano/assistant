const { route } = require('./runtime/router');
const buildContext = require('./runtime/context');
const { loadKnowledge } = require('../data/loadData');

function createAssistant(options = {}) {
  const knowledge = loadKnowledge();
  const ctx = buildContext({ knowledge, ...options });

  return {
    async handle(message) {
      return route({ message, ctx });
    }
  };
}

module.exports = { createAssistant };
