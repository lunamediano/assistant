// core/handlers/priceHandler.js

function detectPriceIntent(lower, history = []) {
  const hasPriceWord = /(pris|koster|kostnad|betaling|rabatt|tilbud)/.test(lower);
  if (!hasPriceWord) return null;

  // Finn siste tema i historikken (video, smalfilm, foto, retusjering, spesial)
  let lastTopic = null;
  const reversed = [...(history || [])].reverse();
  for (const h of reversed) {
    const content = (h.content || h.text || '').toLowerCase();
    if (/vhs|video|videokassett/.test(content)) { lastTopic = 'video'; break; }
    if (/smalfilm|super\s*8|8mm|16mm/.test(content)) { lastTopic = 'smalfilm'; break; }
    if (/foto|bilde|dias|negativ/.test(content)) { lastTopic = 'foto'; break; }
    if (/retusj|restaurer|reparer/.test(content)) { lastTopic = 'retusjering'; break; }
  }

  return { type: 'price', topic: lastTopic };
}

function handlePriceIntent(intent, data) {
  const topic = intent.topic;
  const faqs = data.faq || [];

  if (!topic) {
    // Ingen tidligere tema → gi nøytralt svar
    return {
      text: 'Prisene varierer litt mellom video, smalfilm og foto. Hva gjelder det?'
    };
  }

  // Finn riktig prisoppføring fra FAQ basert på tema
  const match = faqs.find(f => {
    if (!f.id) return false;
    if (topic === 'video') return /vhs|video/.test(f.id);
    if (topic === 'smalfilm') return /smalfilm/.test(f.id);
    if (topic === 'foto') return /foto-pris|foto-.*pris/.test(f.id);
    if (topic === 'retusjering') return /foto-pris-retusjering/.test(f.id);
    return false;
  });

  if (match) {
    return {
      text: match.a,
      meta: { topic, id: match.id, _src: match._src }
    };
  }

  // Fallback – hvis ingen spesifikk pris ble funnet
  return {
    text: `Jeg finner ingen konkret pris for ${topic}-tjenesten akkurat nå, men vi kan gi et estimat om du beskriver omfanget.`,
    meta: { topic, route: 'price' }
  };
}

module.exports = { detectPriceIntent, handlePriceIntent };
