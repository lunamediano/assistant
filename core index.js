// core/index.js
const { detectFaq, handleFaq } = require('./handlers/faqHandler');
const { detectCompanyIntent, handleCompanyIntent } = require('./handlers/companyHandler');
const { detectPriceIntent, handlePriceIntent } = require('./handlers/priceHandler');
const { fallbackHandler } = require('./handlers/fallbackHandler');
const { loadKnowledge } = require('../../data/loadData'); // to nivå opp

const DEBUG = process.env.DEBUG_ASSISTANT === '1';

function createAssistant() {
  // Last kunnskap én gang pr. instans
  const data = loadKnowledge();

  return {
    async handle({ text }) {
      const input = typeof text === 'string' ? text : '';
      const lower = input.toLowerCase();

      try {
        // 1) FAQ (fuzzy)
        const faqMatch = detectFaq(lower, data.faq);
        if (faqMatch) {
          DEBUG && console.log('[route] faq ->', faqMatch.id || faqMatch.q);
          return handleFaq(faqMatch);
        }

        // 2) Firma / praktisk (adresse, tider, telefon, e-post, leveringstid)
        const compIntent = detectCompanyIntent(lower);
        if (compIntent) {
          DEBUG && console.log('[route] company ->', compIntent);
          const r = handleCompanyIntent(compIntent, data.meta);
          if (r) return r;
        }

        // 3) Pris / kategorier (USB, VHS/Video, Smalfilm, Foto) + oversikt
        const priceIntent = detectPriceIntent(lower);
        if (priceIntent) {
          DEBUG && console.log('[route] price ->', priceIntent);
          const r = handlePriceIntent(priceIntent, data.meta);
          if (r) return r;
        }

        // 4) Fallback (høflig og sikker)
        DEBUG && console.log('[route] fallback');
        return fallbackHandler(input);
      } catch (err) {
        console.error('[assistant] error:', err);
        return {
          type: 'answer',
          text: 'Beklager, noe gikk galt på serveren. Prøv igjen om litt.',
          error: String(err && err.message ? err.message : err)
        };
      }
    }
  };
}

module.exports = { createAssistant };
