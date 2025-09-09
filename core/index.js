// core/index.js
const { detectFaq, handleFaq } = require('./handlers/faqHandler');
const { detectCompanyIntent, handleCompanyIntent } = require('./handlers/companyHandler');
const { detectPriceIntent, handlePriceIntent } = require('./handlers/priceHandler');
const { fallbackHandler } = require('./handlers/fallbackHandler');
const { loadKnowledge } = require('../data/loadData');

// Slå på med DEBUG_ASSISTANT=1 (eller "true")
const DEBUG = ['1', 'true'].includes(String(process.env.DEBUG_ASSISTANT || '').toLowerCase());

// Enkel “safe log” som bare logger når DEBUG er aktiv
function dlog(...args) {
  if (DEBUG) console.log(...args);
}

// Litt hjelp for å følge ett kall
function newReqId() {
  // f.eks. "r-1725712345678-3f9"
  const rnd = Math.random().toString(16).slice(2, 5);
  return `r-${Date.now()}-${rnd}`;
}

function createAssistant() {
  // Last kunnskapen én gang per instans
  const data = loadKnowledge();
  dlog('[boot] knowledge loaded:', {
    faqCount: Array.isArray(data.faq) ? data.faq.length : 0,
    hasMeta: !!data.meta,
  });

  return {
    async handle({ text }) {
      const reqId = newReqId();
      const t0 = Date.now();

      const input = typeof text === 'string' ? text : '';
      const lower = input.toLowerCase();

      dlog(`[${reqId}] incoming`, {
        len: input.length,
        sample: input.slice(0, 120),
      });

      try {
        // 1) FAQ (fuzzy)
        const faqMatch = detectFaq(lower, data.faq);
        if (faqMatch) {
          dlog(
            `[${reqId}] route=f aq`,
            { matchId: faqMatch.id || null, q: faqMatch.q || null, source: faqMatch.source || faqMatch.src || null }
          );
          return handleFaq(faqMatch);
        }

        // 2) Firma / praktisk
        const compIntent = detectCompanyIntent(lower);
        if (compIntent) {
          dlog(`[${reqId}] route=company`, { intent: compIntent });
          const r = handleCompanyIntent(compIntent, data.meta);
          if (r) return r;
        }

        // 3) Pris / levering
        const priceIntent = detectPriceIntent(lower);
        if (priceIntent) {
          dlog(`[${reqId}] route=price`, { intent: priceIntent });
          const r = handlePriceIntent(priceIntent, data.meta);
          if (r) return r;
        }

        // 4) Fallback
        dlog(`[${reqId}] route=fallback`);
        return fallbackHandler(input);
      } catch (err) {
        console.error(`[${reqId}] [assistant] error:`, err);
        return {
          type: 'answer',
          text: 'Beklager, noe gikk galt på serveren. Prøv igjen om litt.',
          error: String(err && err.message ? err.message : err),
        };
      } finally {
        const dt = Date.now() - t0;
        dlog(`[${reqId}] done`, { ms: dt });
      }
    },
  };
}

module.exports = { createAssistant };
