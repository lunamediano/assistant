// core/index.js
const { detectFaq, handleFaq } = require('./handlers/faqHandler');
const { detectCompanyIntent, handleCompanyIntent } = require('./handlers/companyHandler');
const { detectPriceIntent, handlePriceIntent } = require('./handlers/priceHandler');
const { fallbackHandler } = require('./handlers/fallbackHandler');
const { loadKnowledge } = require('../data/loadData');

function deriveTopicFromHistory(history = []) {
  // Se på siste element som har tekst eller topic
  const last = [...history].reverse().find(m => typeof m?.text === 'string' || typeof m?.topic === 'string');
  if (!last) return null;

  if (last.topic && typeof last.topic === 'string') {
    const t = last.topic.toLowerCase();
    if (t === 'video' || t === 'smalfilm' || t === 'foto') return t;
  }

  const text = (last.text || '').toLowerCase();
  if (/vhs|videokassett|videobånd|video8|hi8|minidv|video/.test(text)) return 'video';
  if (/smalfilm|super ?8|8mm|16 ?mm/.test(text)) return 'smalfilm';
  if (/foto|bilde|bilder|dias|negativ/.test(text)) return 'foto';

  const metaSrc = (last.meta && (last.meta.src || last.meta.source || last.meta._src)) || '';
  if (/\/video\.yml/i.test(metaSrc)) return 'video';
  if (/\/smalfilm\.yml/i.test(metaSrc)) return 'smalfilm';
  if (/\/foto\.yml/i.test(metaSrc)) return 'foto';

  return null;
}

// Avled tema fra kildefil eller tags
function topicFromFaqItem(item) {
  const src = (item && (item._src || item.source || item.src)) || '';
  const tags = Array.isArray(item?.tags) ? item.tags.map(s => String(s).toLowerCase()) : [];

  if (/\/video\.yml$/i.test(src) || tags.includes('video') || tags.includes('vhs')) return 'video';
  if (/\/smalfilm\.yml$/i.test(src) || tags.includes('smalfilm') || tags.includes('super8') || tags.includes('8mm') || tags.includes('16mm')) return 'smalfilm';
  if (/\/foto\.yml$/i.test(src) || tags.includes('foto') || tags.includes('dias') || tags.includes('negativer')) return 'foto';

  return null;
}

function createAssistant() {
  const data = loadKnowledge();

  return {
    async handle({ text, history = [] }) {
      const lower = (text || '').toLowerCase();
      const topicHint = deriveTopicFromHistory(history);

      // 0) Company
      const compIntent = detectCompanyIntent(lower);
      if (compIntent) {
        const r = handleCompanyIntent(compIntent, data.meta);
        if (r) {
          return {
            ...r,
            meta: { ...(r.meta || {}), route: 'company', intent: compIntent, topic: null }
          };
        }
      }

      // 1) FAQ – bruk topicHint i detectFaq (dersom din detectFaq støtter det)
      const faqMatch = detectFaq(lower, data.faq, { topicHint });
      if (faqMatch) {
        const r = handleFaq(faqMatch);
        const topic = topicFromFaqItem(faqMatch) || topicHint || null;
        return {
          ...r,
          meta: {
            ...(r.meta || {}),
            route: 'faq',
            id: faqMatch.id,
            src: faqMatch._src || faqMatch.source || faqMatch.src || null,
            topic,            // ✅ viktig: eksponér tema for assist.js (cookie)
            topicHint: topicHint || null
          }
        };
      }

      // 2) Pris – pass topicHint videre
      const priceIntent = detectPriceIntent(lower);
      if (priceIntent) {
        const r = handlePriceIntent(priceIntent, data.meta, { topicHint });
        if (r) {
          return {
            ...r,
            meta: { ...(r.meta || {}), route: 'price', intent: priceIntent.intent, topic: topicHint || r.meta?.topic || null }
          };
        }
      }

      // 3) Fallback
      const r = fallbackHandler(text);
      return { ...r, meta: { route: 'fallback', topic: topicHint || null } };
    }
  };
}

module.exports = { createAssistant };
