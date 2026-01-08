// core/handlers/priceHandler.js
// Pris: alltid henvis til priskalkulatoren (ingen kalkulasjon i chat)

function detectPriceIntent(text) {
  const t = (text || '').toLowerCase();

  // Pris-/kostnadssignaler
  const isPrice =
    /\b(hva\s*koster|pris|priser|kostnad|koster\s*det|hvor\s*mye|tilbud|prisoverslag|estim(at|at))\b/i.test(t);

  if (!isPrice) return null;

  // Grov topic-detect (kun for meta/hint; svar er uansett priskalkulator)
  let topic = null;
  if (/\b(vhs|vhs-c|videokassett|videobånd|video8|hi8|minidv|digital8)\b/i.test(t)) topic = 'video';
  else if (/\b(smalfilm|super\s*8|8mm|8\s*mm|16mm|16\s*mm)\b/i.test(t)) topic = 'smalfilm';
  else if (/\b(foto|bilde|bilder|dias|lysbild|negativ)\b/i.test(t)) topic = 'foto';

  return { kind: 'price', topic };
}

function handlePriceIntent(priceIntent, meta) {
  if (!priceIntent) return null;

  const url = 'https://lunamedia.no/priskalkulator';

  return {
    type: 'answer',
    text:
      `For pris: bruk vår priskalkulator her:\n` +
      `${url}\n\n` +
      `Der får du raskt pris basert på type materiale og omfang.`,
    meta: {
      ...(meta || {}),
      source: 'price-handler',
      action: 'redirect',
      url,
      topic: priceIntent.topic || null
    }
  };
}

module.exports = { detectPriceIntent, handlePriceIntent };
