// assistant/index.js
const { detectFaq, handleFaq } = require('./handlers/faqHandler');
const { detectCompanyIntent, handleCompanyIntent } = require('./handlers/companyHandler');
const { fallbackHandler } = require('./handlers/fallbackHandler');
const { loadKnowledge } = require('../data/loadData');

function createAssistant() {
  const data = loadKnowledge();

  return {
    async handle({ text }) {
      const lower = text.toLowerCase();

      // 1) FAQ
      const faqMatch = detectFaq(text, data.faq);
      if (faqMatch) {
        return handleFaq(faqMatch);
      }

      // 2) Praktisk info (firma / company)
      const companyIntent = detectCompanyIntent(lower);
      if (companyIntent) {
        const reply = handleCompanyIntent(companyIntent, data.meta);
        if (reply) return reply;
      }

      // 3) Fallback
      return fallbackHandler(text);
    }
  };
}

module.exports = { createAssistant };
