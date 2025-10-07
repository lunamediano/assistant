// core/index.js
const { detectFaq, handleFaq } = require('./handlers/faqHandler');
const { detectCompanyIntent, handleCompanyIntent } = require('./handlers/companyHandler');
const { detectPriceIntent, handlePriceIntent } = require('./handlers/priceHandler');
const { fallbackHandler } = require('./handlers/fallbackHandler');
const { loadKnowledge } = require('../data/loadData');

function createAssistant() {
  // Last all kunnskap én gang ved cold start
  const data = loadKnowledge();

  return {
    /**
     * @param {object} args
     * @param {string} args.text        Brukerens melding
     * @param {Array}  [args.history]   Samtalehistorikk (array av {role, content} eller lign.)
     */
    async handle({ text, history = [] }) {
      const lower = (text || '').toLowerCase();

      // 0) Firma / praktisk info først (fanger "Hva tilbyr dere?", åpningstider, adresse osv.)
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

      // 1) FAQ – direkte treff mot kunnskapsbasen
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

      // 2) Pris – kontekstsensitiv (bruker history for generiske spørsmål som "hva koster det?")
      const priceIntent = detectPriceIntent(lower, history);
      if (priceIntent) {
        const r = handlePriceIntent(priceIntent, data);
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
