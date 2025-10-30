// core/index.js
const { detectFaq, handleFaq } = require('./handlers/faqHandler');
const { detectCompanyIntent, handleCompanyIntent } = require('./handlers/companyHandler');
const { detectPriceIntent, handlePriceIntent } = require('./handlers/priceHandler');
const { fallbackHandler } = require('./handlers/fallbackHandler');
const { loadKnowledge } = require('../data/loadData');

function deriveTopicFromHistory(history = []) {
  // se på siste bruker- eller assistentmelding
  const last = [...history].reverse().find(m => typeof m?.text === 'string' || m?.meta);
  if (!last) return null;

  // 1) eksplisitt “topic” fra klient (om du begynner å sende det)
  const t = (last.topic || '').toLowerCase();
  if (t) return t;

  // 2) se på teksten i siste melding
  const text = (last.text || '').toLowerCase();
  if (/vhs|videokassett|videobånd|video8|hi8|minidv|video/.test(text)) return 'video';
  if (/smalfilm|super ?8|8mm|16 ?mm/.test(text)) return 'smalfilm';
  if (/foto|bilde|bilder|dias|negativ/.test(text)) return 'foto';

  // 3) se på meta.src fra forrige svar (om klienten sender meta tilbake i history)
  const src = (last.meta && (last.meta.src || last.meta.source)) || '';
  if (/\/video\.yml$/i.test(src)) return 'video';
  if (/\/smalfilm\.yml$/i.test(src)) return 'smalfilm';
  if (/\/foto\.yml$/i.test(src)) return 'foto';

  return null;
}

function topicFromFilepath(src = '') {
  if (/\/video\.yml$/i.test(src)) return 'video';
  if (/\/smalfilm\.yml$/i.test(src)) return 'smalfilm';
  if (/\/foto\.yml$/i.test(src)) return 'foto';
  return null;
}

function createAssistant() {
  const data = loadKnowledge();

  return {
    async handle({ text, history = [] }) {
      const lower = (text || '').toLowerCase();
      const topicHintFromHistory = deriveTopicFromHistory(history);

      // 0) Company
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

      // 1) FAQ (med topicHint-boost inni detectFaq)
      const faqMatch = detectFaq(lower, data.faq, { topicHint: topicHintFromHistory });
      if (faqMatch) {
        const r = handleFaq(faqMatch);

        // legg på src og topic slik at neste melding kan bruke det
        const src = faqMatch._src || faqMatch.source || faqMatch.src || null;
        const topicFromSrc = topicFromFilepath(src);

        return {
          ...r,
          meta: {
            ...(r.meta || {}),
            route: 'faq',
            id: faqMatch.id,
            src,                         // ✅ viktig for neste steg
            topic: topicFromSrc || null, // ✅ hjelper “hva koster det?” i neste melding
          }
        };
      }

      // 2) Pris – send med topicHint fra historikk
      const priceIntent = detectPriceIntent(lower);
      if (priceIntent) {
        const r = handlePriceIntent(priceIntent, data.meta, {
          topicHint: topicHintFromHistory
        });
        if (r) {
          return {
            ...r,
            meta: { ...(r.meta || {}), route: 'price', intent: priceIntent, topicHint: topicHintFromHistory || null }
          };
        }
      }

      // 3) Fallback
      const r = fallbackHandler(text);
      return { ...r, meta: { route: 'fallback', topicHint: topicHintFromHistory || null } };
    }
  };
}

module.exports = { createAssistant };
