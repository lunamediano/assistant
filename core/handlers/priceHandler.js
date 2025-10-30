// core/handlers/priceHandler.js

function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Små hjelpelister for enkel emnedeteksjon
const TOKENS = {
  video: [
    'vhs','videokassett','videobånd','videoband','video8','hi8','minidv','mini dv',
    'digital8','digital 8','video','svhs','s vhs'
  ],
  smalfilm: [
    'smalfilm','super 8','super8','8mm','8 mm','16mm','16 mm','filmrull','film rull',
    'smalfilmpris','smalfilm pris'
  ],
  foto: [
    'foto','bilde','bilder','dias','lysbild','slide','negativ','negativer','skanning','skanne'
  ]
};

function containsAny(text, arr) {
  const t = norm(text);
  return arr.some(tok => t.includes(norm(tok)));
}

// Prøv å hente emne (subject) direkte fra teksten
function inferSubjectFromText(text) {
  if (!text) return null;
  if (containsAny(text, TOKENS.smalfilm)) return 'smalfilm';
  if (containsAny(text, TOKENS.video))    return 'video';
  if (containsAny(text, TOKENS.foto))     return 'foto';
  return null;
}

// «Mild fallback»: noen svært vanlige oppfølginger
function gentleFollowupSubject(text) {
  const t = norm(text);
  if (/^og smalfilm\??$/.test(t) || /smalfilm\??$/.test(t)) return 'smalfilm';
  if (/^og video\??$/.test(t)    || /video\??$/.test(t))    return 'video';
  if (/^og foto\??$/.test(t)     || /foto\??$/.test(t))     return 'foto';
  return null;
}

/**
 * detectPriceIntent(text: string) -> { intent: 'price', subject?: 'video'|'smalfilm'|'foto', raw: string } | null
 */
function detectPriceIntent(text) {
  const t = norm(text);

  // nøkkelord for «pris-intensjon»
  const looksLikePrice =
    t.includes('pris') ||
    t.includes('hva koster') ||
    t.includes('kostnad') ||
    t.includes('hvor mye koster') ||
    t.includes('prisene') ||
    t.includes('prislista') ||
    t.includes('prisliste');

  if (!looksLikePrice) return null;

  // Prøv først å se om emnet står i selve spørsmålet
  const subject =
    inferSubjectFromText(t) ||
    gentleFollowupSubject(t) ||
    null;

  return { intent: 'price', subject, raw: text };
}

/**
 * handlePriceIntent(priceIntent, meta, { topicHint } = {})
 *  - priceIntent.subject kan være 'video' | 'smalfilm' | 'foto' | null
 *  - topicHint kan være 'video' | 'smalfilm' | 'foto' | null (fra historikken)
 */
function handlePriceIntent(priceIntent, meta, { topicHint } = {}) {
  // Velg emne i prioritert rekkefølge:
  //  1) eksplisitt i spørsmålet (subject)
  //  2) topicHint (fra historikk)
  //  3) prøv «mild fallback» på nytt (i tilfelle subject ikke ble satt, men teksten likevel er avslørende)
  //  4) siste utvei: spør hvilket format
  let subject =
    priceIntent?.subject ||
    topicHint ||
    gentleFollowupSubject(priceIntent?.raw || '') ||
    null;

  // Hvis vi fortsatt ikke har subject: spør brukeren presist
  if (!subject) {
    return {
      type: 'answer',
      text:
        'Prisene varierer mellom video, smalfilm og fotoskanning. Gjelder det **video**, **smalfilm** eller **foto**?',
      meta: { source: 'priceHandler', subject: null }
    };
  }

  // Canned priser – hold konsistent med dagens kunnskapsfiler
  if (subject === 'video') {
    return {
      type: 'answer',
      text:
        'Video (VHS, Video8/Hi8, MiniDV m.fl.): **kr 315,- per digitalisert time**. ' +
        'Mengderabatt: **–10 %** fra **10 timer**, **–20 %** fra **20 timer**.',
      meta: { source: 'priceHandler', subject: 'video' }
    };
  }

  if (subject === 'smalfilm') {
    return {
      type: 'answer',
      text:
        'Smalfilm: **8 mm/Super 8 fra ca. kr 75 per minutt**, **16 mm fra ca. kr 90 per minutt**. ' +
        'Startgebyr **kr 95 per rull**. Film **med lyd** gir et lite tillegg. ' +
        'Vi gir rabatt ut fra omfang – gi oss gjerne ca. mengde så får du et estimat.',
      meta: { source: 'priceHandler', subject: 'smalfilm' }
    };
  }

  if (subject === 'foto') {
    return {
      type: 'answer',
      text:
        'Fotoskanning: fra **kr 10,- per bilde/dias** (inkl. mva). ' +
        'Oppløsning velges etter behov (skjerm/utskrift). ' +
        'Retusjering tilbys også (fra-nivå, avhenger av omfang).',
      meta: { source: 'priceHandler', subject: 'foto' }
    };
  }

  // Hvis subject har en uventet verdi – spør presist
  return {
    type: 'answer',
    text: 'Gjelder pris for **video**, **smalfilm** eller **foto**?',
    meta: { source: 'priceHandler', subject: null }
  };
}

module.exports = { detectPriceIntent, handlePriceIntent };
