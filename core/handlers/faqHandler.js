// core/handlers/faqHandler.js
// Kombinert forbedret versjon (norsk normalisering + fuzzy + dine poengregler)

// ---------------- Normalisering ----------------
function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNo(s) {
  if (!s) return '';
  let t = norm(s);
  // Vanlige synonymer / skrivemåter
  t = t
    .replace(/tar dere/g, 'digitaliserer dere')
    .replace(/kan dere ta/g, 'digitaliserer dere')
    .replace(/håndterer dere/g, 'digitaliserer dere')
    .replace(/videobånd/g, 'videokassetter')
    .replace(/video bånd/g, 'videokassetter')
    .replace(/lysbilder/g, 'dias')
    .replace(/super8/g, 'super 8')
    .replace(/super 8mm/g, 'super 8')
    .replace(/16mm/g, '16 mm')
    .replace(/\bpris\b|\bkostnad\b|\bhva koster\b|\bprisen\b/g, 'hva koster');
  return t;
}

// ---------------- Hjelpefunksjoner ----------------
function contains(hay, needle) {
  return norm(hay).includes(norm(needle));
}
function anyContains(hay, list = []) {
  return (list || []).some(x => contains(hay, x));
}
function tokenSet(str) {
  return new Set((str || '').split(/\s+/).filter(Boolean));
}
function jaccard(aSet, bSet) {
  const A = new Set(aSet);
  const B = new Set(bSet);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = new Set([...A, ...B]).size || 1;
  return inter / uni;
}

// ---------------- Domenesignaler ----------------
const K = {
  video: /(vhs|videokassett|videobånd|videoband|video8|hi8|minidv|mini dv|digital8|video)\b/i,
  smalfilm: /(smalfilm|super ?8|8mm|8 mm|16mm|16 mm)\b/i,
  foto: /(foto|bilde|bilder|dias|lysbild|negativ)/i,
  format: /\b(formater?|formatliste|støttede|stottede)\b/i
};

// ---------------- Scoring ----------------
function scoreItem(userText, item, opts = {}) {
  const t = normalizeNo(userText);
  const q = normalizeNo(item.q || '');
  const alts = Array.isArray(item.alt) ? item.alt.map(normalizeNo) : [];
  const tags = Array.isArray(item.tags) ? item.tags.map(normalizeNo) : [];

  let score = 0;

  // 1) Eksakte undertreff
  if (contains(t, q)) score += 60;
  if (anyContains(t, alts)) score += 45;

  // 2) Overlapp / Jaccard-likhet
  const tokens = tokenSet(t);
  const hay = norm([q, ...(alts || []), ...(tags || [])].join(' '));
  const overlap = tokens.size ? jaccard(tokens, tokenSet(hay)) : 0;
  score += overlap * 50; // maks +50 poeng ved høy likhet

  // 3) Overlapp-antall som tidligere
  const overlapCount = [...tokens].filter(w => hay.includes(` ${w} `)).length;
  score += Math.min(overlapCount * 3, 30);

  // 4) Topic-hint fra historikk
  const topicHint = opts.topicHint || null;
  if (topicHint && tags.includes(topicHint)) score += 25;

  // 5) Domeneboost/demping
  const itemHay = [q, ...(alts || []), ...(tags || [])].join(' ').toLowerCase();
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

  // 6) Pris-spørsmål
  const askingPrice = /\b(hva\s+koster|pris|kostnad|hvor mye)\b/i.test(t);
  if (askingPrice) {
    if (/pris|kostnad/.test(itemHay)) score += 15;
    if (textVideo && itemVideo) score += 25;
    if (textSmal && itemSmal)   score += 25;
    if (textFoto && itemFoto)   score += 25;
  }

  // 7) Format-spørsmål
  if (textFmt) {
    if (itemFmt) score += 35;
    if (!textVideo && !textSmal && !textFoto && topicHint) {
      if (topicHint === 'video' && itemVideo) score += 30;
      if (topicHint === 'smalfilm' && itemSmal) score += 30;
      if (topicHint === 'foto' && itemFoto) score += 30;
    }
  }

  // YAML-boost (valgfri)
  if (typeof item.boost === 'number') score *= item.boost;

  return score;
}

// ---------------- Hoved: detectFaq ----------------
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

  // Terskel
  if (bestScore < 25) return null;

  best._debug = {
    bestScore,
    candidates: candidates.sort((a, b) => b.score - a.score).slice(0, 5)
  };
  return best;
}

// ---------------- handleFaq ----------------
function handleFaq(item) {
  if (!item) return null;
  const meta = {
    source: item._src || item.source || item.src,
    id: item.id
  };
  if (item._debug) meta.candidates = item._debug.candidates;
  return { type: 'answer', text: item.a, meta };
}

module.exports = { detectFaq, handleFaq };
