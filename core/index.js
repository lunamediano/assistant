// core/index.js
const { detectFaq, handleFaq } = require('./handlers/faqHandler');
const { detectCompanyIntent, handleCompanyIntent } = require('./handlers/companyHandler');
const { detectPriceIntent, handlePriceIntent } = require('./handlers/priceHandler');
const { fallbackHandler } = require('./handlers/fallbackHandler');
const { loadKnowledge } = require('../data/loadData');

function deriveTopicFromHistory(history = []) {
  // se på siste bruker- eller assistentmelding
  const last = [...history].reverse().find(m => typeof m?.text === 'string');
  if (!last) return null;

  const t = (last.topic || '').toLowerCase();
  if (t) return t; // hvis klienten allerede satte topic

  const text = (last.text || '').toLowerCase();
  if (/vhs|videokassett|videobånd|video8|hi8|minidv|video/.test(text)) return 'video';
  if (/smalfilm|super ?8|8mm|16 ?mm/.test(text)) return 'smalfilm';
  if (/foto|bilde|bilder|dias|negativ/.test(text)) return 'foto';

  // prøv også meta fra forrige svar (dersom klienten sender den tilbake)
  const metaSrc = (last.meta && last.meta.src) || '';
  if (/\/video\.yml/i.test(metaSrc)) return 'video';
  if (/\/smalfilm\.yml/i.test(metaSrc)) return 'smalfilm';
  if (/\/foto\.yml/i.test(metaSrc)) return 'foto';

  return null;
}

function createAssistant() {
  const data = loadKnowledge();

  return {
    async handle({ text, history = [] }) {
      const lower = (text || '').toLowerCase();
      const topicHint = deriveTopicFromHistory(history);

      // 0) Company først
      const compIntent = detectCompanyIntent(lower);
      if (compIntent) {
        const r = handleCompanyIntent(compIntent, data.meta);
        if (r) return { ...r, meta: { ...(r.meta || {}), route: 'company', intent: compIntent } };
      }

      // 1) FAQ – med topicHint-boost
      const faqMatch = detectFaq(lower, data.faq, { topicHint });
      if (faqMatch) {
        const r = handleFaq(faqMatch);
        return {
          ...r,
          meta: {
            ...(r.meta || {}),
            route: 'faq',
            topicHint: topicHint || null
          }
        };
      }

      // 2) Pris (beholder som før – men kan også bruke topicHint her inni handleren hvis ønskelig)
      const priceIntent = detectPriceIntent(lower);
      if (priceIntent) {
        const r = handlePriceIntent(priceIntent, data.meta);
        if (r) return { ...r, meta: { ...(r.meta || {}), route: 'price', intent: priceIntent } };
      }

      // 3) Fallback
      const r = fallbackHandler(text);
      return { ...r, meta: { route: 'fallback', topicHint: topicHint || null } };
    }
  };
}

module.exports = { createAssistant };
