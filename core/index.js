// core/index.js
const { detectFaq, handleFaq } = require('./handlers/faqHandler');
const { detectCompanyIntent, handleCompanyIntent } = require('./handlers/companyHandler');
const { detectPriceIntent, handlePriceIntent } = require('./handlers/priceHandler');
const { fallbackHandler } = require('./handlers/fallbackHandler');
const { loadKnowledge } = require('../data/loadData');

function createAssistant() {
  const data = loadKnowledge();

  return {
    async handle({ text }) {
      const lower = (text || '').toLowerCase();

      // 1) FAQ
      const faqMatch = detectFaq(lower, data.faq);
      if (faqMatch) return handleFaq(faqMatch);

      // 2) Firma / praktisk
      const compIntent = detectCompanyIntent(lower);
      if (compIntent) {
        const r = handleCompanyIntent(compIntent, data.meta);
        if (r) return r;
      }

      // 3) Pris / levering
      const priceIntent = detectPriceIntent(lower);
      if (priceIntent) {
        const r = handlePriceIntent(priceIntent, data.meta);
        if (r) return r;
      }

      // 4) Fallback
      return fallbackHandler(text);
    }
  };
}

module.exports = { createAssistant };
