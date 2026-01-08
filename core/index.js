// core/index.js
const { detectFaq, handleFaq } = require('./handlers/faqHandler');
const { detectCompanyIntent, handleCompanyIntent } = require('./handlers/companyHandler');
const { detectPriceIntent, handlePriceIntent } = require('./handlers/priceHandler');
const { fallbackHandler } = require('./handlers/fallbackHandler');
const { loadKnowledge } = require('../data/loadData');

function deriveTopicFromHistory(history = []) {
  const last = [...history].reverse().find(m => typeof m?.text === 'string' || typeof m?.content === 'string');
  if (!last) return null;

  const topic = (last.topic || '').toLowerCase();
  if (topic) return topic;

  const raw = (last.text || last.content || '').toLowerCase();
  if (/vhs|videokassett|videobånd|videoband|video8|hi8|minidv|mini dv|digital8|video/.test(raw)) return 'video';
  if (/smalfilm|super ?8|8mm|8 mm|16mm|16 mm/.test(raw)) return 'smalfilm';
  if (/foto|bilde|bilder|dias|lysbild|negativ/.test(raw)) return 'foto';

  const metaSrc = (last.meta && (last.meta.src || last.meta.source)) || '';
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

      // 0) Company først (adresse, åpningstider, kontakt osv.)
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

      // 1) PRIS ALLTID TIL PRISKALKULATOR (overstyrer FAQ)
      const priceIntent = detectPriceIntent(lower);
      if (priceIntent) {
        const r = handlePriceIntent(priceIntent, data.meta);
        if (r) {
          return {
            ...r,
            meta: { ...(r.meta || {}), route: 'price', intent: priceIntent, topicHint: topicHint || null }
          };
        }
      }

      // 2) FAQ – med topicHint-boost
      const faqMatch = detectFaq(lower, data.faq, { topicHint });
      if (faqMatch) {
        const r = handleFaq(faqMatch);
        return {
          ...r,
          meta: {
            ...(r.meta || {}),
            route: 'faq',
            id: faqMatch.id,
            src: faqMatch._src || faqMatch.source,
            topicHint: topicHint || null
          }
        };
      }

      // 3) Fallback
      const r = fallbackHandler(text);
      return { ...r, meta: { route: 'fallback', topicHint: topicHint || null } };
    }
  };
}

module.exports = { createAssistant };
