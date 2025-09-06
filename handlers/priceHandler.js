// assistant/handlers/priceHandler.js
const PRICE_HINTS = [
  ['minnepenn', 'minne', 'usb'],
  ['video', 'vhs'],
  ['smalfilm', 'super 8', '8mm'],
  ['foto', 'dias', 'negativ']
];

function detectPriceIntent(text) {
  const t = text.toLowerCase();
  if (t.includes('leveringstid') || t.includes('hvor lang tid')) return 'delivery_time';
  if (t.includes('pris') || t.includes('koster') || t.includes('kostnad')) return 'price';
  return null;
}

function handlePriceIntent(intent, meta) {
  if (!meta) return null;

  if (intent === 'delivery_time') {
    const d = meta.delivery || {};
    return {
      type: 'answer',
      text: `Leveringstid er normalt ${d.standard_dager || 'noen dager'}. ` +
            (d.rush_mulig ? `Ekspress er mulig (${d.rush_tillegg}).` : ''),
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

    return {
      type: 'answer',
      text: `Priseksempler:\n${lines.join('\n')}\n`,
      meta: { source: p._source }
    };
  }

  return null;
}

module.exports = { detectPriceIntent, handlePriceIntent };
