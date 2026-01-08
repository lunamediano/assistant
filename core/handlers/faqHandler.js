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
  // Digitalisering (forbruker/kassetter)
  videoDigit: /\b(digitaliser|digitalisering|overfør|overfore|konverter|kopier|til\s*fil|til\s*mp4|usb|nedlasting|vhs|vhs-c|videokassett|videobånd|videoband|video8|hi8|minidv|mini\s*dv|digital8)\b/i,

  // Produksjon (opptak/bedrift/event)
  videoProd: /\b(film(e|ing)?|opptak|videoproduksjon|profilfilm|reklamefilm|informasjonsvideo|innholdsfilm|dokumentar|intervju|event|bryllup|konfirmasjon|bedrift|sosiale\s*medier)\b/i,

  smalfilm: /(smalfilm|super ?8|8mm|8 mm|16mm|16 mm)\b/i,
  foto: /(foto|bilde|bilder|dias|lysbild|negativ)\b/i,
  format: /\b(formater?|formatliste|støttede|stottede)\b/i
};

function isPriceQuestion(t) {
  return /\b(hva\s*koster|hvor\s*mye|pris(en)?|kostnad|koster\s+det)\b/i.test(t || '');
}

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

  // 4) Domene-booster/dempere
  const itemHayRaw = [q, ...(alts || []), ...(tags || [])].join(' ');
  const itemHay = itemHayRaw.toLowerCase();

  const textSmal  = K.smalfilm.test(t);
  const textFoto  = K.foto.test(t);
  const textFmt   = K.format.test(t);

  const textVideoDigit = K.videoDigit.test(t);
  const textVideoProd  = K.videoProd.test(t);

  const itemVideoDigit =
    /\b(video-digitalisering|digitaliser|overfør|vhs|videokassett|video8|hi8|minidv|digital8)\b/i.test(itemHay);

  const itemVideoProd =
    /\b(video-produksjon|videoproduksjon|profilfilm|reklamefilm|opptak|filming|intervju|event|bedrift|dokumentar)\b/i.test(itemHay);

  const itemSmal  = /smalfilm|super ?8|8mm|16 ?mm\b/i.test(itemHay);
  const itemFoto2 = /foto|bilde|dias|negativ\b/i.test(itemHay);
  const itemFmt   = /format|formater|formatliste|støttede|stottede\b/i.test(itemHay);

  // --- VIDEO: SPLITT digitalisering vs produksjon ---
  // Hvis teksten tydelig handler om digitalisering:
  if (textVideoDigit) {
    if (itemVideoDigit) score += 110;
    if (itemVideoProd)  score -= 60; // demp produksjon
  }

  // Hvis teksten tydelig handler om produksjon/opptak:
  if (textVideoProd && !textVideoDigit) {
    if (itemVideoProd)  score += 110;
    if (itemVideoDigit) score -= 40;
  }

  // Hvis teksten bare sier "video" uten signaler, men topicHint finnes:
  // (Lett dytt – ikke like aggressivt)
  if (!textVideoDigit && !textVideoProd && topicHint === 'video') {
    if (itemVideoDigit) score += 20;
    if (itemVideoProd)  score += 10;
  }

  // --- SMALFILM/FOTO som før ---
  if (textSmal) {
    if (itemSmal) score += 80;
  }
  if (textFoto) {
    if (itemFoto2) score += 60;
  }

  // 5) Pris-spørsmål: (FAQ kan fortsatt score, men i din løsning blir pris vanligvis håndtert før FAQ)
  const askingPrice = isPriceQuestion(t);
  if (askingPrice) {
    if (/pris|kostnad/.test(itemHay)) score += 15;
    if (textVideoDigit && itemVideoDigit) score += 25;
    if (textSmal && itemSmal)             score += 25;
    if (textFoto && itemFoto2)            score += 25;
  }

  // 6) Format-spørsmål
  if (textFmt) {
    if (itemFmt) score += 35;
    if (!textSmal && !textFoto && !textVideoDigit && !textVideoProd && topicHint) {
      if (topicHint === 'smalfilm' && itemSmal) score += 30;
      if (topicHint === 'foto' && itemFoto2) score += 30;
      if (topicHint === 'video' && itemVideoDigit) score += 30; // format-spm om video er oftest digitalisering
    }
  }

  return score;
}

function detectFaq(userText, faqItems, opts = {}) {
  if (!userText || !faqItems || !faqItems.length) return null;

  // Hvis dere fortsatt vil sende ALL pris til priskalkulator:
  if (isPriceQuestion(userText)) return null;

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
