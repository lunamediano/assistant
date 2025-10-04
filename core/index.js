// core/index.js
const path = require('path');
const { detectFaq, handleFaq } = require('./handlers/faqHandler');
const { detectCompanyIntent, handleCompanyIntent } = require('./handlers/companyHandler');
const { detectPriceIntent, handlePriceIntent } = require('./handlers/priceHandler');

// Robust import: støtt både named og default
const fb = require('./handlers/fallbackHandler');
const fallbackHandler = fb.fallbackHandler || fb.default || fb;

function resolveLoadKnowledge() {
  const guesses = [
    path.join(__dirname, '..', 'data', 'loadData.js'),
    path.join(process.cwd(), 'data', 'loadData.js'),
    '/var/task/data/loadData.js',
  ];

  let lastError = null;
  for (const candidate of guesses) {
    try {
      const mod = require(candidate);
      if (mod && typeof mod.loadKnowledge === 'function') {
        return mod.loadKnowledge;
      }
    } catch (err) {
      lastError = err;
    }
  }

  const detail = lastError && lastError.message ? ` (${lastError.message})` : '';
  throw new Error(`Kunne ikke laste data/loadData.js${detail}`);
}

const loadKnowledge = resolveLoadKnowledge();

const DEBUG = (process.env.DEBUG_ASSISTANT || '').toLowerCase() === '1';

function createAssistant() {
  const data = loadKnowledge(); // last en gang

  return {
    async handle({ text }) {
      const input = typeof text === 'string' ? text : '';
      const lower = input.toLowerCase();

      try {
        // 1) FAQ
        const faqMatch = detectFaq(lower, data.faq);
        if (faqMatch) {
          DEBUG && console.log('[route] faq ->', faqMatch.id || faqMatch.q);
          const r = handleFaq(faqMatch);
          if (r) return r;
        }

        // 2) Firma/praktisk
        const compIntent = detectCompanyIntent(lower);
        if (compIntent) {
          DEBUG && console.log('[route] company ->', compIntent);
          const r = handleCompanyIntent(compIntent, data.meta);
          if (r) return r;
        }

        // 3) Pris/levering
        const priceIntent = detectPriceIntent(lower);
        if (priceIntent) {
          DEBUG && console.log('[route] price ->', priceIntent);
          const r = handlePriceIntent(priceIntent, data.meta);
          if (r) return r;
        }

        // 4) Fallback
        DEBUG && console.log('[route] fallback');
        return fallbackHandler(input);
      } catch (err) {
        console.error('[assistant] error:', err);
        // NB: vi svarer kontrollert, ikke kaster:
        return {
          type: 'answer',
          text: 'Beklager, noe gikk galt på serveren. Prøv igjen om litt.',
          error: String(err && err.message ? err.message : err),
        };
      }
    },
  };
}

module.exports = { createAssistant };
