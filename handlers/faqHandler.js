// assistant/handlers/faqHandler.js
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

// Finn beste match i faq-lista
function detectFaq(userText, faqList) {
  const qn = normalize(userText);
  let best = null;

  for (const item of faqList) {
    const baseQ = item.q || '';
    const baseScore = jaccard(qn, baseQ);

    // Bonus hvis userText inneholder hele spørsmålet (eller motsatt)
    const containsBonus =
      normalize(baseQ).includes(qn) || qn.includes(normalize(baseQ)) ? 0.15 : 0;

    // Match på alt-varianter
    let altScore = 0;
    for (const alt of item.alt || []) {
      altScore = Math.max(altScore, jaccard(qn, alt));
      if (normalize(alt).includes(qn) || qn.includes(normalize(alt))) {
        altScore = Math.max(altScore, 0.75); // sterk bonus ved “inneholder”
      }
    }

    const score = Math.max(baseScore + containsBonus, altScore);

    if (!best || score > best.score) best = { item, score };
  }

  // terskel: 0.38 er snill, 0.45 mer konservativ
  return best && best.score >= 0.40 ? best.item : null;
}

function handleFaq(item) {
  return {
    type: 'answer',
    text: (item.a || '').endsWith('\n') ? item.a : item.a + '\n',
    meta: {
      matched_question: item.q,
      source: item.source,
      related: (item.related || []).slice(0, 3)
    }
  };
}

module.exports = { detectFaq, handleFaq };
