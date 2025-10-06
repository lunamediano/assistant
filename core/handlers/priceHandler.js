// core/handlers/priceHandler.js
const { loadKnowledge } = require('../../data/loadData');

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
      .replace(/[^a-z0-9æøåéèüöß\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
function has(text, ...needles) {
  const t = safeNorm(text);
  return needles.some(n => t.includes(safeNorm(n)));
}

// --- små hjelpere for tall / priser ---
const num = s => {
  if (!s) return null;
  const m = String(s).replace(/\s/g, '').match(/(\d+[.,]?\d*)/);
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.'));
};

function extractNumbers(text) {
  const t = safeNorm(text);
  const out = {};

  // timer (fanger "3 timer", "12t", "1,5 time")
  const mHours = t.match(/(\d+[.,]?\d*)\s*(t(imer)?|h|time)\b/);
  if (mHours) out.hours = parseFloat(mHours[1].replace(',', '.'));

  // minutter (fanger "30 min", "45minutter")
  const mMins = t.match(/(\d+[.,]?\d*)\s*(min(utt(er)?)?)\b/);
  if (mMins) out.minutes = parseFloat(mMins[1].replace(',', '.'));

  // antall ruller (smalfilm)
  const mRull = t.match(/(\d+)\s*(rull(er)?)\b/);
  if (mRull) out.rolls = parseInt(mRull[1], 10);

  // hint om USB/minnepenn
  out.wantUsb = has(t, 'usb', 'minnepenn', 'minne penn', 'flashdrive');

  return out;
}

function detectPriceIntent(text) {
  if (!text) return null;
  if (has(text, 'leveringstid', 'hvor lang tid', 'når ferdig', 'ventetid')) return 'delivery_time';
  if (has(text, 'pris', 'koster', 'kostnad', 'hva tar dere', 'hva er prisen')) return 'price';
  // heuristikk: t
