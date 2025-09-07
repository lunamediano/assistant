// core/handlers/faqHandler.js

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

// Finn beste match i faq-lista (bruker q + alt)
function detectFaq(userText, faqList) {
  if (!userText || !Array.isArray(faqList) || faqList.length === 0) return null;

  const qn = normalize(userText);
  let bestItem = null;
  let bestScore = 0;

  for (const item of faqList) {
    const baseQ = item.q || '';
    const baseScore = jaccard(qn, baseQ);

    let altScore = 0;
    for (const alt of item.alt || []) {
      altScore = Math.max(altScore, jaccard(qn, alt));
      // Litt ekstra hvis “inneholder”
      if (normalize(alt).includes(qn) || qn.includes(normalize(alt))) {
        altScore = Math.max(altScore, 0.75);
      }
    }

    // Bonus dersom hele spørsmålet er inneholdt
    const containsBonus =
      normalize(baseQ).includes(qn) || qn.includes(normalize(baseQ)) ? 0.15 : 0;

    const score = Math.max(baseScore + containsBonus, altScore);

    if (score > bestScore) {
      bestScore = score;
      bestItem = item;
    }
  }

  // terskel for “god nok” match
  return bestScore >= 0.40 ? bestItem : null;
}

function handleFaq(item) {
  return {
    type: 'answer',
    text: (item.a || '').endsWith('\n') ? item.a : (item.a || '') + '\n',
    meta: {
      matched_question: item.q,
      source: item._source || item.source || item.src,
      related: (item.related || []).slice(0, 3)
    }
  };
}

module.exports = { detectFaq, handleFaq };
