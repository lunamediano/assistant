module.exports = async function detectIntent(message, ctx) {
  const text = (message.text || '').toLowerCase();
  if (!text) return { type: 'FALLBACK' };

  const hasFaqHit = ctx.knowledge.faq.some(item => {
    const q = (item.q || '').toLowerCase();
    const alts = (item.alt || []).map(s => s.toLowerCase());
    return (q && text.includes(q.slice(0, Math.min(10, q.length)))) ||
           alts.some(a => a && text.includes(a));
  });

  if (hasFaqHit) return { type: 'FAQ' };
  return { type: 'FALLBACK' };
};
