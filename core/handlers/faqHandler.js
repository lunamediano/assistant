// core/handlers/faqHandler.js
function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(s) {
  return new Set(norm(s).split(' ').filter(Boolean));
}

function overlapScore(aTokens, bTokens) {
  let hits = 0;
  for (const t of aTokens) if (bTokens.has(t)) hits++;
  return hits;
}

/**
 * Finn beste FAQ-treff.
 * opts.topicHint kan være 'video' | 'vhs' | 'smalfilm' | 'foto'
 */
function detectFaq(userText, allFaq, opts = {}) {
  const qTokens = tokenize(userText);
  let best = null;
  let bestScore = 0;

  for (const f of allFaq) {
    const candTexts = [f.q, ...(Array.isArray(f.alt) ? f.alt : [])].filter(Boolean);
    let candScore = 0;

    for (const t of candTexts) {
      candScore = Math.max(candScore, overlapScore(qTokens, tokenize(t)));
    }

    // Boost for eksakt ord (“pris”, “kostnad”) + kort spm
    if (/^hva koster det\??$/.test(norm(userText))) candScore += 1;

    // Topic-boost
    const tags = Array.isArray(f.tags) ? f.tags.map(norm) : [];
    const idn  = norm(f.id || '');
    const topic = norm(opts.topicHint || '');
    if (topic) {
      if (tags.includes(topic)) candScore += 3;
      if (topic === 'video' && (tags.includes('vhs') || tags.includes('minidv') || tags.includes('hi8'))) candScore += 2;
      if (topic === 'vhs' && tags.includes('video')) candScore += 2;
      if (topic === 'smalfilm' && (tags.includes('super8') || tags.includes('8mm') || tags.includes('16mm'))) candScore += 2;
      if (topic && idn.startsWith(topic)) candScore += 1;
    }

    if (candScore > bestScore) {
      bestScore = candScore;
      best = f;
    }
  }

  // veldig lav score? ingen klare treff
  if (!best || bestScore === 0) return null;
  return best;
}

function handleFaq(faqItem) {
  return {
    type: 'answer',
    text: faqItem.a,
    meta: {
      id: faqItem.id,
      tags: faqItem.tags || [],
      src: faqItem._src || faqItem.source || faqItem.src || null
    }
  };
}

module.exports = { detectFaq, handleFaq };
