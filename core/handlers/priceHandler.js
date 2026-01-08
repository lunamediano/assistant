// core/handlers/priceHandler.js

function detectPriceIntent(text = '', opts = {}) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;

  // Fang både lange og korte pris-spørsmål, inkl. oppfølgere:
  // "pris?", "og prisen?", "hva koster det", "kostnad", "hvor mye", etc.
  const isPrice =
    /\b(hva\s*koster|hvor\s*mye|pris(en)?|kostnad|koster\s+det|pris\?)\b/i.test(t) ||
    /^\s*(pris|prisen|og\s+pris(en)?|og\s+prisen)\s*\??\s*$/i.test(t);

  if (!isPrice) return null;

  // Valgfritt: ta med topicHint hvis du vil (ikke nødvendig når alt går til kalkulator)
  const topicHint = (opts && opts.topicHint) ? String(opts.topicHint).toLowerCase() : null;

  return { kind: 'price', topicHint };
}

function handlePriceIntent(intent, meta = {}) {
  if (!intent) return null;

  const url = 'https://lunamedia.no/priskalkulator';

  return {
    type: 'answer',
    text: `For pris: bruk priskalkulatoren her: ${url}`,
    meta: {
      source: 'priceHandler',
      url,
      topic: intent.topicHint || null
    }
  };
}

module.exports = { detectPriceIntent, handlePriceIntent };
