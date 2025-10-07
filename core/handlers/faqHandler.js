// core/handlers/faqHandler.js
const { loadKnowledge } = require('../../data/loadData');

// --- utils ---
function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokens(s) {
  return norm(s).split(' ').filter(Boolean);
}
function containsPhrase(hay, needle) {
  return norm(hay).includes(norm(needle));
}
function anyContains(hay, arr) {
  const h = norm(hay);
  return arr.some(p => h.includes(norm(p)));
}

// Formatord for hinting/penalty
const VIDEO_WORDS    = ['vhs','video','minidv','mini dv','video8','hi8','digital8','vhs c','camcorder'];
const SMALFILM_WORDS = ['smalfilm','super 8','super8','8mm','8 mm','16mm','16 mm'];

// ——— High-priority regler
const SERVICE_QUERIES = [
  'hva tilbyr dere',
  'hvilke tjenester',
  'hvilke tjenester tilbyr dere',
  'hva gjør dere',
  'hva kan dere hjelpe med',
  'tjenester luna media',
  'hva slags tjenester'
];

function pickIntroServicesFaq(faqList) {
  if (!Array.isArray(faqList)) return null;
  // 1) Prøv eksakt id
  let hit = faqList.find(x => x && x.id === 'intro-tjenester');
  if (hit) return hit;
  // 2) Prøv å finne i faq_round1.yml med “tjeneste” i spørsmålet
  hit = faqList.find(x =>
    x &&
    typeof x.q === 'string' &&
    (x._src || x.source || '').endsWith('faq_round1.yml') &&
    norm(x.q).includes('tjeneste')
  );
  return hit || null;
}

function scoreCandidate(query, item, idxOrderBias = 0) {
  const qn = norm(query);
  const qtoks = tokens(query);
  const fields = [item.q, ...(item.alt || [])].map(norm).filter(Boolean);

  let score = 0;

  // 1) Eksakte/frase-treff
  for (const f of fields) {
    if (qn === f) score += 120;
    if (f.includes(qn)) score += 80;            // query som substring i felt
    if (qn.includes(f) && f.length > 6) score += 40; // felt inni query
  }

  // 2) Token-overlapp
  for (const t of qtoks) {
    if (!t) continue;
    if (fields.some(f => f.split(' ').includes(t))) score += 6;
    else if (fields.some(f => f.includes(t))) score += 2;
  }

  // 3) Domeneboost/straff
  const mentionsVideo    = anyContains(query, VIDEO_WORDS);
  const mentionsSmalfilm = anyContains(query, SMALFILM_WORDS);

  const tags = item.tags || [];
  const isVideoFaq = tags.includes('vhs') || tags.includes('video');
  const isSmalFaq  = tags.includes('smalfilm');

  if (mentionsVideo && isVideoFaq) score += 40;
  if (mentionsSmalfilm && isSmalFaq) score += 40;

  if (mentionsVideo && isSmalFaq && !isVideoFaq) score -= 35;
  if (mentionsSmalfilm && isVideoFaq && !isSmalFaq) score -= 35;

  // 4) Korte spørsmål → litt ekstra vekt hvis domenet matcher
  if (qtoks.length <= 4) {
    if (mentionsVideo && isVideoFaq) score += 10;
    if (mentionsSmalfilm && isSmalFaq) score += 10;
  }

  // 5) Liten bias for tidligere filer (faq_round1 kommer typisk først)
  score += idxOrderBias;

  return score;
}

// Public API brukt av /core
function detectFaq(userText, faqList) {
  const q = userText || '';
  if (!q.trim()) return null;

  // High priority: “hva tilbyr dere” etc.
  if (anyContains(q, SERVICE_QUERIES)) {
    const chosen = pickIntroServicesFaq(faqList);
    if (chosen) return { item: chosen, score: 999, reason: 'high_priority:intro-services' };
    // fallthrough hvis ikke funnet, så scorer vi videre
  }

  // Score alle kandidater
  let best = null;
  for (let i = 0; i < (faqList || []).length; i++) {
    const item = faqList[i];
    const bias = Math.max(0, 2 - Math.floor(i / 100)); // bitteliten "tidlig er bedre"
    const s = scoreCandidate(q, item, bias);
    if (!best || s > best.score) best = { item, score: s };
  }

  // Minimumsterskel
  if (!best || best.score < 20) return null;

  return best;
}

function handleFaq(match) {
  if (!match || !match.item) return null;
  return {
    type: 'answer',
    text: match.item.a,
    meta: {
      matched_question: match.item.q,
      related: [],
      source: match.item._src
    }
  };
}

module.exports = {
  detectFaq,
  handleFaq,
};
