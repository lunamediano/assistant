// core/handlers/faqHandler.js
const { loadKnowledge } = require('../../data/loadData');

function norm(s){ return (s||'').toLowerCase().normalize('NFKD').replace(/[^\p{Letter}\p{Number}\s]/gu,' ').replace(/\s+/g,' ').trim(); }

function detectFaq(userText, faq) {
  const t = norm(userText);
  // 1) eksakt Q-match
  for (const item of faq) {
    if (norm(item.q) === t) return item;
  }
  // 2) alt-ord treff
  for (const item of faq) {
    if ((item.alt||[]).some(a => t.includes(norm(a)))) return item;
  }
  // 3) enkel nøkkelordsjekk
  for (const item of faq) {
    if (t.includes(norm(item.q))) return item;
  }
  return null;
}

function pickSuggestion(item){
  const tags = item.tags || [];
  if (tags.includes('vhs') || tags.includes('video')) {
    return 'Vil du ha et kjapt prisestimat? Skriv ca. hvor mange kassetter og ønsket leveranse (USB/nedlasting).';
  }
  if (tags.includes('smalfilm')) {
    return 'Vil du ha estimat? Oppgi omtrent antall ruller og (om mulig) omtrentlig spilletid per rull.';
  }
  if (tags.includes('foto') || tags.includes('dias') || tags.includes('negativer')) {
    return 'Si gjerne ca. antall bilder/dias og ønsket oppløsning – så anslår jeg pris.';
  }
  if (tags.includes('spesial') || tags.includes('bedrift') || tags.includes('arrangement')) {
    return 'Vil du ha forslag til opplegg og pris? Oppgi sted, dato, tidsrom og ønsket leveranse.';
  }
  return 'Vil du beskrive kort hva du har – så lager jeg et raskt estimat?';
}

function handle({ message, ctx, intent }) {
  const data = loadKnowledge();
  const item = detectFaq(message, data.faq);
  if (!item) return null;

  const suggestion = pickSuggestion(item);
  return {
    type: 'answer',
    text: item.a,
    suggestion,                     // ✅ ny
    meta: {
      id: item.id,
      source: item._src,
      tags: item.tags || [],
      matched_question: item.q
    }
  };
}

module.exports = { detectFaq, handleFaq: handle };
