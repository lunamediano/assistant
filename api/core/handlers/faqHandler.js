function score(text, item) {
  const t = text.toLowerCase();
  let s = 0;
  if (item.q) s += t.includes(item.q.toLowerCase()) ? 3 : 0;
  for (const alt of item.alt || []) s += t.includes((alt || '').toLowerCase()) ? 1 : 0;
  for (const tag of item.tags || []) s += t.includes((tag || '').toLowerCase()) ? 0.5 : 0;
  return s;
}

async function handle({ message, ctx }) {
  const text = message.text || '';

  const ranked = ctx.knowledge.faq
    .map(item => ({ item, score: score(text, item) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (ranked.length === 0) {
    return {
      type: 'answer',
      text: 'Jeg fant ingen direkte match i kunnskapsbasen. Kan du si litt mer spesifikt?'
    };
  }

  const best = ranked[0].item;
  return {
    type: 'answer',
    text: best.a,
    meta: {
      matched_question: best.q,
      source: best.source,
      related: ranked.slice(1).map(x => ({ q: x.item.q, source: x.item.source }))
    }
  };
}

module.exports = { handle };
