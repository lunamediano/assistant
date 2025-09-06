const detectIntent = require('../nlu/intentDetect');
const faqHandler = require('../handlers/faqHandler');
const fallbackHandler = require('../handlers/fallbackHandler');

async function route({ message, ctx }) {
  const intent = await detectIntent(message, ctx);

  switch (intent.type) {
    case 'FAQ':
      return faqHandler.handle({ message, ctx, intent });
    default:
      return fallbackHandler.handle({ message, ctx, intent });
  }
}

module.exports = { route };
