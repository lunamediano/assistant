// core/handlers/priceHandler.js

function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function has(text, ...needles) {
  const t = norm(text);
  return needles.some(n => t.includes(norm(n)));
}

// --- Intent detection (kategori-basert) ---
function detectPriceIntent(text) {
  const t = norm(text);

  // USB/minnepenn
  if (has(t, 'minnepenn', 'minne penn', 'minnepinne', 'usb', 'memory stick', 'minne pinne')) {
    return 'price_usb';
  }

  // VHS / Video
  if (
    has(
      t,
      'vhs',
      'videokassett',
      'video kassett',
      'videobånd',
      'video',
      'camcorder',
      'hi8',
      'mini dv',
      'minidv',
      'video8',
      'video 8'
    )
  ) {
    return 'price_video';
  }

  // Smalfilm
  if (has(t, 'smalfilm', 'super 8', 'super8', '8mm', '8 mm')) {
    return 'price_smalfilm';
  }

  // Foto / Dias / Negativer
  if (
    has(
      t,
      'foto',
      'bilder',
      'papirbilder',
      'dias',
      'lysbild',
      'negativ',
      'scanning',
      'skanning',
      'skanne foto',
      'skanne bilder'
    )
  ) {
    return 'price_foto';
  }

  // Generelt pris-spørsmål
  if (has(t, 'pris', 'prisene', 'koster', 'kostnad', 'hva tar dere', 'hva er prisen')) {
    return 'price_overview';
  }

  return null;
}

// Hjelper for å bygge pen tekst
function buildLines(p) {
  const lines = [];
  if (p.video_per_time) lines.push(`• Video (VHS m.fl.): ${p.video_per_time} per time`);
  if (p.smalfilm_per_minutt) lines.push(`• Smalfilm: ${p.smalfilm_per_minutt} per minutt`);
  if (p.scanning_foto_per_stk) lines.push(`• Fotoskanning: ${p.scanning_foto_per_stk} per bilde`);
  if (p.minnepenn) lines.push(`• Minnepenn: ${p.minnepenn}`);
  return lines;
}

// --- Intent handling ---
function handlePriceIntent(intent, meta) {
  if (!meta) return null;
  const p = meta.prices || {};
  const src = { source: p._source };

  switch (intent) {
    case 'price_usb': {
      const text = p.minnepenn
        ? `Minnepenn koster: ${p.minnepenn}.`
        : `Minnepenn-pris er ikke spesifisert her – spør oss gjerne, så finner vi rett størrelse og pris.`;
      return { type: 'answer', text, meta: src };
    }

    case 'price_video': {
      const text = p.video_per_time
        ? `Video (VHS m.fl.): ${p.video_per_time} per time videoinnhold.`
        : `Pris for video er ikke spesifisert her – be om tilbud, så regner vi på omfanget.`;
      return { type: 'answer', text, meta: src };
    }

    case 'price_smalfilm': {
      const text = p.smalfilm_per_minutt
        ? `Smalfilm: ${p.smalfilm_per_minutt} per minutt film.`
        : `Pris for smalfilm er ikke spesifisert her – be om tilbud, så beregner vi etter lengde og antall ruller.`;
      return { type: 'answer', text, meta: src };
    }

    case 'price_foto': {
      const text = p.scanning_foto_per_stk
        ? `Fotoskanning: ${p.scanning_foto_per_stk} per bilde (avhenger av oppløsning/volum).`
        : `Pris for fotoskanning er ikke spesifisert her – si litt om mengde og ønsket kvalitet, så gir vi pris.`;
      return { type: 'answer', text, meta: src };
    }

    case 'price_overview': {
      const lines = buildLines(p);
      if (!lines.length) return null;
      return {
        type: 'answer',
        text: `Priseksempler:\n${lines.join('\n')}\n`,
        meta: src
      };
    }

    default:
      return null;
  }
}

module.exports = { detectPriceIntent, handlePriceIntent };
