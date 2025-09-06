// assistant/handlers/priceHandler.js
function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function has(text, ...needles) {
  const t = norm(text);
  return needles.some(n => t.includes(norm(n)));
}

function detectPriceIntent(text) {
  if (has(text, 'leveringstid', 'hvor lang tid', 'når ferdig')) return 'delivery_time';
  if (has(text, 'pris', 'koster', 'kostnad', 'hva tar dere', 'hva er prisen')) return 'price';
  return null;
}

function handlePriceIntent(intent, meta) {
  if (!meta) return null;

  if (intent === 'delivery_time') {
    const d = meta.delivery || {};
    return {
      type: 'answer',
      text:
        `Leveringstid er normalt ${d.standard_dager || 'noen dager'}. ` +
        (d.rush_mulig ? `Ekspress kan være mulig (${d.rush_tillegg}).` : ''),
      meta: { source: d._source }
    };
  }

  if (intent === 'price') {
    const p = meta.prices || {};
    const lines = [];
    if (p.video_per_time) lines.push(`• Video (VHS m.fl.): ${p.video_per_time} per time`);
    if (p.smalfilm_per_minutt) lines.push(`• Smalfilm: ${p.smalfilm_per_minutt} per minutt`);
    if (p.scanning_foto_per_stk) lines.push(`• Fotoskanning: ${p.scanning_foto_per_stk} per bilde`);
    if (p.minnepenn) lines.push(`• Minnepenn: ${p.minnepenn}`);
    if (!lines.length) return null;

    return { type: 'answer', text: `Priseksempler:\n${lines.join('\n')}\n`, meta: { source: p._source } };
  }

  return null;
}

module.exports = { detectPriceIntent, handlePriceIntent };
