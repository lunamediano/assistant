// core/handlers/faqHandler.js

function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contains(hay, needle) {
  return norm(hay).includes(norm(needle));
}

function anyContains(hay, list = []) {
  return (list || []).some(x => contains(hay, x));
}

// Nøkkelordfamilier for kraftig disambiguering
const K = {
  video: /(vhs|videokassett|videobånd|videoband|video8|hi8|minidv|mini dv|digital8|video)\b/i,
  smalfilm: /(smalfilm|super ?8|8mm|8 mm|16mm|16 mm)\b/i,
  foto: /(foto|bilde|bilder|dias|lysbild|negativ)\b/i
};

function scoreItem(userText, item, opts = {}) {
  const t = userText;
  const q = item.q || '';
  const alts = Array.isArray(item.alt) ? item.alt : [];
  const tags = Array.isArray(item.tags) ? item.tags : [];

  let score = 0;

  // 1) Eksakte undertreffer på q/alt
  if (contains(t, q)) score += 60;
  if (anyContains(t, alts)) score += 45;

  // 2) Enkle token-overlapp (pris, kostnad, digitalisere, etc.)
  const tokens = norm(t).split(' ').filter(Boolean);
  const hay = norm([q, ...(alts || [])].join(' '));
  const overlap = tokens.filter(w => hay.includes(` ${w} `)).length;
  score += Math.min(overlap * 3, 30);

  // 3) Topic-hint fra historikk/forrige svar
  const topicHint = opts.topicHint || null;
  if (topicHint && tags.includes(topicHint)) score += 25;

  // 4) Aggressive domene-booster/dempere
  const itemHayRaw = [q, ...(alts || []), ...(tags || [])].join(' ');
  const itemHay = itemHayRaw.toLowerCase();

  const textVideo = K.video.test(t);
  const textSmal  = K.smalfilm.test(t);
  const textFoto  = K.foto.test(t);

  const itemVideo = /vhs|videokassett|videobånd|video8|hi8|minidv|digital8|video\b/i.test(itemHay);
  const itemSmal  = /smalfilm|super ?8|8mm|16 ?mm\b/i.test(itemHay);
  const itemFoto  = /foto|bilde|dias|negativ\b/i.test(itemHay);

  // Hvis brukeren sier "VHS / video", boost video-FAQ og demp smalfilm
  if (textVideo) {
    if (itemVideo) score += 80;
    if (itemSmal)  score -= 35;
  }
  // Hvis brukeren sier "smalfilm", boost smalfilm og demp video
  if (textSmal) {
    if (itemSmal)  score += 80;
    if (itemVideo) score -= 35;
  }
  // Hvis brukeren sier "foto/bilder", boost foto
  if (textFoto && itemFoto) score += 60;

  // 5) Pris-spesifikk finjustering
  const askingPrice = /\b(hva\s+koster|pris|kostnad|hvor mye)\b/i.test(t);
  if (askingPrice) {
    if (/pris|kostnad/.test(itemHay)) score += 15;
    // Vektlegg at pris-svar også tilhører korrekt domene
    if (textVideo && itemVideo) score += 25;
    if (textSmal && itemSmal)   score += 25;
    if (textFoto && itemFoto)   score += 25;
  }

  return score;
}

function detectFaq(userText, faqItems, opts = {}) {
  if (!userText || !faqItems || !faqItems.length) return null;

  let best = null;
  let bestScore = -1;
  const candidates = [];

  for (const item of faqItems) {
    const s = scoreItem(userText, item, opts);
    candidates.push({ id: item.id, score: s, _src: item._src, q: item.q });
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  }

  // Terskel for å akseptere svar
  if (bestScore < 25) return null;

  // Legg ved sporingsdata når trace=1
  best._debug = { bestScore, candidates: candidates.sort((a,b)=>b.score-a.score).slice(0,5) };
  return best;
}

function handleFaq(item) {
  if (!item) return null;
  const meta = { source: item._src || item.source || item.src, id: item.id };
  // Behold debug-kandidater dersom de finnes (API fjerner dem hvis trace ikke er på)
  if (item._debug) meta.candidates = item._debug.candidates;
  return { type: 'answer', text: item.a, meta };
}

module.exports = { detectFaq, handleFaq };
