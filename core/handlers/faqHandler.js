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
const VIDEO_WORDS   = ['vhs','video','minidv','mini dv','video8','hi8','digital8','vhs c','camcorder'];
const SMALFILM_WORDS= ['smalfilm','super 8','super8','8mm','8 mm','16mm','16 mm'];

const HIGH_PRIORITY_RULES = [
  // Q: "Hva tilbyr dere?"
  {
    when: (q) => anyContains(q, ['hva tilbyr dere','hva gjør dere','hvilke tjenester']),
    pick: (faq) => faq.find(x => x.id === 'intro-tjenester')
  },
];

function scoreCandidate(query, item, idxOrderBias = 0) {
  // Base materials
  const qn = norm(query);
  const qtoks = tokens(query);
  const fields = [item.q, ...(item.alt || [])].map(norm).filter(Boolean);

  let score = 0;

  // 1) Exact phrase hits (on q or any alt)
  for (const f of fields) {
    if (qn === f) score += 120;
    if (f.includes(qn)) score += 80; // query as substring of field
    if (qn.includes(f) && f.length > 6) score += 40; // field is contained in query (avoid tiny words)
  }

  // 2) Token overlap: +6 per shared token (diminishing)
  for (const t of qtoks) {
    if (!t) continue;
    if (fields.some(f => f.split(' ').includes(t))) score += 6;
    else if (fields.some(f => f.includes(t))) score += 2;
  }

  // 3) Format boosting / penalty
  const mentionsVideo    = anyContains(query, VIDEO_WORDS);
  const mentionsSmalfilm = anyContains(query, SMALFILM_WORDS);

  const isVideoFaq = (item.tags || []).includes('vhs') || (item.tags || []).includes('video');
  const isSmalFaq  = (item.tags || []).includes('smalfilm');

  if (mentionsVideo && isVideoFaq) score += 40;
  if (mentionsSmalfilm && isSmalFaq) score += 40;

  // Penalize cross-domain confusion when user is explicit
  if (mentionsVideo && isSmalFaq && !isVideoFaq) score -= 35;
  if (mentionsSmalfilm && isVideoFaq && !isSmalFaq) score -= 35;

  // 4) Light boost for very short queries that contain a clear domain word
  if (qtoks.length <= 4) {
    if (mentionsVideo && isVideoFaq) score += 10;
    if (mentionsSmalfilm && isSmalFaq) score += 10;
  }

  // 5) Tie-breaker: prefer earlier files (round1 first) via tiny bias
  score += idxOrderBias;

  return score;
}

// Public API used by /core
function detectFaq(userText, faqList) {
  const q = userText || '';
  if (!q.trim()) return null;

  // 0) High-priority explicit picks
  for (const rule of HIGH_PRIORITY_RULES) {
    try {
      if (rule.when(q)) {
        const chosen = rule.pick(faqList || []);
        if (chosen) return { item: chosen, score: 999, reason: 'high_priority' };
      }
    } catch {}
  }

  // 1) Score all items
  let best = null;
  for (let i = 0; i < (faqList || []).length; i++) {
    const item = faqList[i];
    const bias = Math.max(0, 2 - Math.floor(i/100)); // tiny earlier-is-better bias
    const s = scoreCandidate(q, item, bias);

    if (!best || s > best.score) {
      best = { item, score: s };
    }
  }

  // 2) Thresholds: avoid spurious matches
  if (!best || best.score < 20) return null; // too weak, let fallback handle

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
