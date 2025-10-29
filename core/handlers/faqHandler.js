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

// Domenesignaler
const K = {
  video: /(vhs|videokassett|videobånd|videoband|video8|hi8|minidv|mini dv|digital8|video)\b/i,
  smalfilm: /(smalfilm|super ?8|8mm|8 mm|16mm|16 mm)\b/i,
  foto: /(foto|bilde|bilder|dias|lysbild|negativ)\b/i,
  format: /\b(formater?|formatliste|støttede|stottede)\b/i
};

function scoreItem(userText, item, opts = {}) {
  const t = userText;
  const q = item.q || '';
  const alts = Array.isArray(item.alt) ? item.alt : [];
  const tags = Array.isArray(item.tags) ? item.tags : [];

  let score = 0;

  // 1) Eksakte undertreff
  if (contains(t, q)) score += 60;
  if (anyContains(t, alts)) score += 45;

  // 2) Overlapp-heuristikk
  const tokens = norm(t).split(' ').filter(Boolean);
  const hay = norm([q, ...(alts || []), ...(tags || [])].join(' '));
  const overlap = tokens.filter(w => hay.includes(` ${w} `)).length;
  score += Math.min(overlap * 3, 30);

  // 3) Topic-hint fra historikk
  const topicHint = opts.topicHint || null;
  if (topicHint && tags.includes(topicHint)) score += 25;

  // 4) Aggressive domene-booster/dempere
  const itemHayRaw = [q, ...(alts || []), ...(tags || [])].join(' ');
  const itemHay = itemHayRaw.toLowerCase();

  const textVideo = K.video.test(t);
  const textSmal  = K.smalfilm.test(t);
  const textFoto  = K.foto.test(t);
  const textFmt   = K.format.test(t);

  const itemVideo = /vhs|videokassett|videobånd|video8|hi8|minidv|digital8|video\b/i.test(itemHay);
  const itemSmal  = /smalfilm|super ?8|8mm|16 ?mm\b/i.test(itemHay);
  const itemFoto  = /foto|bilde|dias|negativ\b/i.test(itemHay);
  const itemFmt   = /format|formater|formatliste|støttede|stottede\b/i.test(itemHay);

  if (textVideo) {
    if (itemVideo) score += 80;
    if (itemSmal)  score -= 35;
  }
  if (textSmal) {
    if (itemSmal)  score += 80;
    if (itemVideo) score -= 35;
  }
  if (textFoto && itemFoto) score += 60;

  // 5) Pris-spørsmål
  const askingPrice = /\b(hva\s+koster|pris|kostnad|hvor mye)\b/i.test(t);
  if (askingPrice) {
    if (/pris|kostnad/.test(itemHay)) score += 15;
    if (textVideo && itemVideo) score += 25;
    if (textSmal && itemSmal)   score += 25;
    if (textFoto && itemFoto)   score += 25;
  }

  // 6) Format-spørsmål: boost poster som handler om formater
  if (textFmt) {
    if (itemFmt) score += 35;          // eksplisitt “formater”-innhold
    // Hvis ingen domeneord i spørsmålet, men vi har topicHint, dytt det mot riktig domene
    if (!textVideo && !textSmal && !textFoto && topicHint) {
      if (topicHint === 'video' && itemVideo) score += 30;
      if (topicHint === 'smalfilm' && itemSmal) score += 30;
      if (topicHint === 'foto' && itemFoto) score += 30;
    }
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

  if (bestScore < 25) return null;

  best._debug = { bestScore, candidates: candidates.sort((a,b)=>b.score-a.score).slice(0,5) };
  return best;
}

function handleFaq(item) {
  if (!item) return null;
  const meta = { source: item._src || item.source || item.src, id: item.id };
  if (item._debug) meta.candidates = item._debug.candidates;
  return { type: 'answer', text: item.a, meta };
}

module.exports = { detectFaq, handleFaq };
