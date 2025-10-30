// core/handlers/priceHandler.js

function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectPriceIntent(text) {
  const t = norm(text);
  // enkle prisord
  if (/(hva koster|pris|kostnad|hvor mye|hvor mye koster)/.test(t)) return 'price_general';
  return null;
}

// Velg kategori basert på (1) topicHint, (2) brukerens tekst, (3) siste history-tekst/meta
function chooseCategory({ topicHint, userText = '', history = [] } = {}) {
  const t = norm(userText);

  // 1) TopicHint fra kjernen
  if (topicHint === 'video' || /video/.test(t)) return 'video';
  if (topicHint === 'smalfilm' || /(smalfilm|super 8|8mm|16mm|16 mm)/.test(t)) return 'smalfilm';
  if (topicHint === 'foto' || /(foto|bilde|bilder|dias|negativ)/.test(t)) return 'foto';

  // 2) Sjekk history (siste relevante melding)
  const last = [...(history || [])].reverse().find(m => typeof m?.text === 'string');
  if (last) {
    const lt = norm(last.text);
    if (/video|vhs|videokassett|videobånd|video8|hi8|minidv/.test(lt)) return 'video';
    if (/smalfilm|super 8|8mm|16mm|16 mm/.test(lt)) return 'smalfilm';
    if (/foto|bilde|bilder|dias|negativ/.test(lt)) return 'foto';

    const src = (last.meta && (last.meta.src || last.meta.source)) || '';
    if (/\/video\.yml/i.test(src)) return 'video';
    if (/\/smalfilm\.yml/i.test(src)) return 'smalfilm';
    if (/\/foto\.yml/i.test(src)) return 'foto';
  }

  return null; // ukjent – be om presisering
}

function priceTextFor(category) {
  switch (category) {
    case 'video':
      return {
        text:
          'Video (VHS/VHS-C/Video8/Hi8/MiniDV): **kr 315,- per digitalisert time**. Mengderabatt: –10 % fra 10 timer, –20 % fra 20 timer.',
        meta: { src: '/knowledge/faq/video.yml', id: 'vhs-pris', category: 'video' }
      };
    case 'smalfilm':
      return {
        text:
          'Smalfilm: **fra ca. kr 75/min (8 mm/Super 8)** og **fra ca. kr 90/min (16 mm)** + **kr 95 per rull** (start). Tillegg for lyd. Mengderabatt etter omfang.',
        meta: { src: '/knowledge/faq/smalfilm.yml', id: 'smalfilm-pris', category: 'smalfilm' }
      };
    case 'foto':
      return {
        text:
          'Fotoskanning: **fra ca. kr 10,- per bilde/dias** (inkl. mva). Oppløsning etter behov (skjerm/utskrift).',
        meta: { src: '/knowledge/faq/foto.yml', id: 'foto-pris-opplosning', category: 'foto' }
      };
    default:
      return null;
  }
}

function handlePriceIntent(_intent, _meta, ctx = {}) {
  const category = chooseCategory(ctx);

  if (!category) {
    // kunne ikke avgjøre – be brukeren spesifisere, men hold det kort
    return {
      type: 'answer',
      text: 'Gjelder det video, smalfilm eller fotoskanning?',
      suggestion: 'Skriv f.eks. «video», «smalfilm» eller «foto».',
      meta: { need: 'category' }
    };
  }

  const p = priceTextFor(category);
  if (p) {
    return {
      type: 'answer',
      text: p.text,
      meta: { ...(p.meta || {}) }
    };
  }

  // fallback (burde ikke skje)
  return {
    type: 'answer',
    text: 'Prisene varierer mellom video, smalfilm og foto. Si gjerne hva det gjelder, så får du riktig pris.',
    meta: { need: 'category' }
  };
}

module.exports = { detectPriceIntent, handlePriceIntent };
