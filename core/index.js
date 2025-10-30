// core/index.js
const { detectFaq, handleFaq } = require('./handlers/faqHandler');
const { detectCompanyIntent, handleCompanyIntent } = require('./handlers/companyHandler');
const { detectPriceIntent, handlePriceIntent } = require('./handlers/priceHandler');
const { fallbackHandler } = require('./handlers/fallbackHandler');
const { loadKnowledge } = require('../data/loadData');

function deriveTopicFromHistory(history = []) {
  // Finn siste melding som faktisk har tekst (user/assistant)
  const last = [...history].reverse().find(m => typeof m?.text === 'string');
  if (!last) return null;

  // 1) Hvis klienten har satt topic direkte
  const t = (last.topic || '').toLowerCase();
  if (t) return t;

  // 2) Heuristikk på tekstinnhold
  const text = (last.text || '').toLowerCase();
  if (/vhs|videokassett|videobånd|video8|hi8|minidv|video/.test(text)) return 'video';
  if (/smalfilm|super ?8|8mm|16 ?mm/.test(text)) return 'smalfilm';
  if (/foto|bilde|bilder|dias|negativ/.test(text)) return 'foto';

  // 3) Les forrige kilde (om meta sendes i history)
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

      // 0) Company-intents først
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

      // 1) FAQ – la detectFaq evt. bruke topicHint (OK om den ignorerer ekstra arg)
      const faqMatch = detectFaq(lower, data.faq, { topicHint });
      if (faqMatch) {
        const r = handleFaq(faqMatch);
        return {
          ...r,
          meta: {
            ...(r.meta || {}),
            route: 'faq',
            id: faqMatch.id,
            src: faqMatch._src || faqMatch.source || null,
            topic: faqMatch.topic || topicHint || null
          }
        };
      }

      // 2) Pris – gi handleren kontekst fra history
      const priceIntent = detectPriceIntent(lower);
      if (priceIntent) {
        const prev = [...history].reverse().find(m => m && m.meta && typeof m.meta === 'object');
        const ctx = {
          topicHint,
          lastFaqId: prev?.meta?.id || null,
          lastFaqSrc: prev?.meta?.src || null,
          lastTopic: prev?.meta?.topic || null
        };
        const r = handlePriceIntent(priceIntent, data.meta, ctx);
        if (r) {
          return {
            ...r,
            meta: { ...(r.meta || {}), route: 'price', intent: priceIntent, topicHint, ctx }
          };
        }
      }

      // 3) Fallback
      const r = fallbackHandler(text);
      return { ...r, meta: { route: 'fallback', topicHint: topicHint || null } };
    }
  };
}

module.exports = { createAssistant };
