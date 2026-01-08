// core/handlers/priceHandler.js

function detectPriceIntent(text = '') {
  const t = (text || '').toLowerCase();

  // Pris-signaler (bredt, fordi vi vil fange "og prisen?" osv.)
  const priceRe =
    /\b(hva\s*koster|pris(en)?|kostnad(en)?|hvor\s*mye|kr\b|koster\s*det|pris\s*på|tilbud|rabatt|priskalkulator)\b/i;

  if (!priceRe.test(t)) return null;

  return { intent: 'price_to_calculator' };
}

function handlePriceIntent(priceIntent, meta) {
  if (!priceIntent) return null;

  // All pris går til priskalkulator – ingen kalkulasjon i boten.
  const url = 'https://lunamedia.no/priskalkulator';

  return {
    type: 'answer',
    text:
      `For pris: bruk vår priskalkulator her: ${url}\n\n` +
      `Hvis du vil, kan du si kort hva du skal digitalisere (VHS, smalfilm eller foto) og ca. mengde, ` +
      `så kan jeg forklare hva du bør legge inn i kalkulatoren.`,
    suggestion: 'Åpne priskalkulatoren og legg inn antall/omfang – så får du pris med én gang.',
    meta: {
      ...(meta || {}),
      source: 'price-handler',
      action: 'redirect',
      url
    }
  };
}

module.exports = { detectPriceIntent, handlePriceIntent };
