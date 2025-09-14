// core/handlers/priceHandler.js
function safeNorm(s) {
  try {
    return (s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return (s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9æøåéèüöß\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
function has(text, ...needles) {
  const t = safeNorm(text);
  return needles.some(n => t.includes(safeNorm(n)));
}

function detectPriceIntent(text) {
  if (!text) return null;
  if (has(text, 'leveringstid', 'hvor lang tid', 'når ferdig', 'ventetid')) return 'delivery_time';
  if (has(text, 'pris', 'koster', 'kostnad', 'hva tar dere', 'hva er prisen')) return 'price';
  return null;
}

function handlePriceIntent(intent, meta) {
  try {
    const m = meta || {};

    if (intent === 'delivery_time') {
      const d = m.delivery || {};
      const std = d.standard_dager ? `${d.standard_dager}` : 'noen dager';
      const rush = d.rush_mulig ? ` Ekspress kan være mulig${d.rush_tillegg ? ` (${d.rush_tillegg})` : ''}.` : '';
      return {
        type: 'answer',
        text: `Leveringstid er normalt ${std}.${rush ? rush : ''}`,
        meta: d._source ? { source: d._source } : undefined
      };
    }

    if (intent === 'price') {
      const p = m.prices || {};
      const out = [];
      if (p.video_per_time) out.push(`• Video (VHS m.fl.): ${p.video_per_time} per time`);
      if (p.smalfilm_per_minutt) out.push(`• Smalfilm: ${p.smalfilm_per_minutt} per minutt`);
      if (p.scanning_foto_per_stk) out.push(`• Fotoskanning: ${p.scanning_foto_per_stk} per bilde`);
      if (p.minnepenn) out.push(`• Minnepenn: ${p.minnepenn}`);
      if (!out.length) return null;
      return { type: 'answer', text: `Priseksempler:\n${out.join('\n')}\n`, meta: p._source ? { source: p._source } : undefined };
    }

    return null;
  } catch {
    return null;
  }
}

module.exports = { detectPriceIntent, handlePriceIntent };
