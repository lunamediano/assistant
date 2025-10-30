// core/index.js
const { detectFaq, handleFaq } = require('./handlers/faqHandler');
const { detectCompanyIntent, handleCompanyIntent } = require('./handlers/companyHandler');
const { detectPriceIntent, handlePriceIntent } = require('./handlers/priceHandler');
const { fallbackHandler } = require('./handlers/fallbackHandler');
const { loadKnowledge } = require('../data/loadData');

function deriveTopicFromHistory(history = []) {
  // Finn siste melding med tekst (bruker eller assistent)
  const last = [...history].reverse().find(m => typeof m?.text === 'string');
  if (!last) return null;

  // 1) Hvis klienten allerede har satt topic, bruk den
  const t = (last.topic || '').toLowerCase().trim();
  if (t) return t;

  // 2) Prøv å lese tema fra tekst
  const text = (last.text || '').toLowerCase();
  if (/vhs|videokassett|videobånd|video8|hi8|minidv|video/.test(text)) return 'video';
  if (/smalfilm|super ?8|8mm|16 ?mm/.test(text)) return 'smalfilm';
  if (/foto|bilde|bilder|dias|negativ/.test(text)) return 'foto';

  // 3) Prøv å lese av kilde-sti dersom klienten sender meta tilbake i history
  const src = (last.meta && (last.meta.src || last.meta.source || last.meta._src)) || '';
  if (/\/video\.yml/i.test(src)) return 'video';
  if (/\/smalfilm\.yml/i.test(src)) return 'smalfilm';
  if (/\/foto\.yml/i.test(src)) return 'foto';

  return null;
}

function createAssistant() {
  const data = loadKnowledge();

  return {
    async handle({ text, history = [] }) {
      const userText = (text || '').trim();
      const lower = userText.toLowerCase();
      const topicHint = deriveTopicFromHistory(history); // 'video' | 'smalfilm' | 'foto' | null

      // 👇 Augmenter teksten med topicHint slik at “hva koster det?” blir “hva koster det smalfilm”
      // Dette gjør at detectFaq/detectPrice kan treffe riktige FAQ/alt-tags uten å endre selve matcher-logikken.
      const effectiveText = topicHint ? `${userText} ${topicHint}` : userText;
      const effectiveLower = effectiveText.toLowerCase();

      // 0) Company først (adresse/åpningstider/telefon/e-post/levering)
      const compIntent = detectCompanyIntent(effectiveLower);
      if (compIntent) {
        const r = handleCompanyIntent(compIntent, data.meta);
        if (r) {
          return {
            ...r,
            meta: { ...(r.meta || {}), route: 'company', intent: compIntent, topicHint: topicHint || null }
          };
        }
      }

      // 1) FAQ – bruk augmented tekst + topicHint (dersom faqHandler støtter det)
      const faqMatch = detectFaq(effectiveLower, data.faq, { topicHint });
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

      // 2) Pris – også med augmented tekst
      const priceIntent = detectPriceIntent(effectiveLower);
      if (priceIntent) {
        const r = handlePriceIntent(priceIntent, data.meta, { topicHint });
        if (r) {
          return {
            ...r,
            meta: { ...(r.meta || {}), route: 'price', intent: priceIntent, topicHint: topicHint || null }
          };
        }
      }

      // 3) Fallback
      const r = fallbackHandler(userText);
      return { ...r, meta: { route: 'fallback', topicHint: topicHint || null } };
    }
  };
}

module.exports = { createAssistant };
