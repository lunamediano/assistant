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

      // 0) Company først (fanger "Hva tilbyr dere?", åpningstider, adresse osv.)
      const compIntent = detectCompanyIntent(lower);
      if (compIntent) {
        const r = handleCompanyIntent(compIntent, data.meta);
        if (r) {
          return {
            ...r,
            meta: { ...(r.meta || {}), route: 'company', intent: compIntent }
          };
        }
      }

      // 1) FAQ
      const faqMatch = detectFaq(lower, data.faq);
      if (faqMatch) {
        const r = handleFaq(faqMatch);
        return {
          ...r,
          meta: {
            ...(r.meta || {}),
            route: 'faq',
            id: faqMatch.id,
            src: faqMatch._src || faqMatch.source
          }
        };
      }

      // 2) Pris
      const priceIntent = detectPriceIntent(lower);
      if (priceIntent) {
        const r = handlePriceIntent(priceIntent, data.meta);
        if (r) {
          return {
            ...r,
            meta: { ...(r.meta || {}), route: 'price', intent: priceIntent }
          };
        }
      }

      // 3) Fallback
      const r = fallbackHandler(text);
      return { ...r, meta: { route: 'fallback' } };
    }
  };
}

module.exports = { createAssistant };
