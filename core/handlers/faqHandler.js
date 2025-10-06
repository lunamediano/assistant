// core/handlers/faqHandler.js

const { loadKnowledge } = require('../../data/loadData');

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(str) {
  return new Set(normalize(str).split(' ').filter(Boolean));
}

function jaccard(a, b) {
  const A = tokenSet(a), B = tokenSet(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const uni = A.size + B.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

/**
 * Finn beste match (med top-K trace)
 * @returns {null | { item, score, candidates:[{id,q,score,src}] }}
 */
function detectFaq(userText, faqList, opts = {}) {
  if (!userText || !Array.isArray(faqList) || faqList.length === 0) return null;

  const minScore = typeof opts.minScore === 'number' ? opts.minScore : 0.50; // skjerpet terskel
  const qn = normalize(userText);

  const scored = [];

  for (const item of faqList) {
    const baseQ = item.q || '';
    const baseScore = jaccard(qn, baseQ);

    let altScore = 0;
    for (const alt of item.alt || []) {
      let score = jaccard(qn, alt);
      // lite bonus ved "inneholder"
      const an = normalize(alt);
      if (an.includes(qn) || qn.includes(an)) score = Math.max(score, 0.75);
      if (score > altScore) altScore = score;
    }

    const containsBonus =
      normalize(baseQ).includes(qn) || qn.includes(normalize(baseQ)) ? 0.15 : 0;

    const score = Math.max(baseScore + containsBonus, altScore);

    scored.push({
      item,
      score,
      id: item.id,
      q: item.q,
      src: item._src || item.source || item.src
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (!best || best.score < minScore) return null;

  return {
    item: best.item,
    score: best.score,
    candidates: scored.slice(0, 3).map(x => ({
      id: x.id, q: x.q, score: +x.score.toFixed(3), src: x.src
    }))
  };
}

function handleFaq(matchOrItem) {
  const item = matchOrItem?.item || matchOrItem;
  const score = typeof matchOrItem?.score === 'number' ? matchOrItem.score : undefined;
  const candidates = Array.isArray(matchOrItem?.candidates) ? matchOrItem.candidates : undefined;

  return {
    type: 'answer',
    text: (item.a || '').endsWith('\n') ? item.a : (item.a || '') + '\n',
    meta: {
      matched_question: item.q,
      source: item._src || item.source || item.src,
      score: typeof score === 'number' ? +score.toFixed(3) : undefined,
      candidates // beholdes i API bare når trace=1 (se /api/assist.js)
    }
  };
}

module.exports = { detectFaq, handleFaq };
