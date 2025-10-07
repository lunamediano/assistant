// core/handlers/priceHandler.js
//
// Kontekstsensitiv pris-intent:
// - Gjenkjenner generiske pris-spørsmål ("hva koster det", "pris?", "hvor mye koster det")
// - Inferred topic fra history (video / smalfilm / foto / retusjering)
// - Svarer med riktig prisutdrag basert på kunnskapsgrunnlaget

function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const PRICE_TRIGGERS = [
  'hva koster det',
  'hva koster',
  'pris',
  'pris?',
  'hvor mye koster',
  'kostnad',
  'hva tar dere'
];

const TOPIC_KEYWORDS = {
  video:    ['vhs', 'video', 'videokassett', 'videobånd', 'hi8', 'video8', 'minidv', 'digital8'],
  smalfilm: ['smalfilm', 'super 8', 'super8', '8 mm', '8mm', '16 mm', '16mm'],
  foto:     ['foto', 'bilde', 'bilder', 'dias', 'lysbild', 'negativ', 'negativer', 'fotoskanning'],
  retusj:   ['retusj', 'retusjering', 'restaurering', 'reparere bilde', 'fikse bilde', 'fargekorrigering']
};

// Hent "siste tema" fra history (bruker og/eller assistent-svar)
function inferTopicFromHistory(history = []) {
  // Søk bakover i historikken etter siste tydelige emne
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const t = norm(msg?.content || msg?.text || '');
    if (!t) continue;

    // Sjekk eksplisitte topic-ord først
    for (const topic of Object.keys(TOPIC_KEYWORDS)) {
      if (TOPIC_KEYWORDS[topic].some(k => t.includes(norm(k)))) {
        return topic; // 'video' | 'smalfilm' | 'foto' | 'retusj'
      }
    }

    // Hint fra FAQ-id i meta (om du sender det i UI senere)
    if (msg?.meta?.matched_id) {
      const id = String(msg.meta.matched_id);
      if (id.startsWith('vhs') || id.includes('video'))   return 'video';
      if (id.includes('smalfilm') || id.includes('super')) return 'smalfilm';
      if (id.includes('foto'))                              return 'foto';
      if (id.includes('retusj'))                            return 'retusj';
    }
  }
  return null;
}

function isGenericPriceQuestion(text) {
  const t = norm(text);
  return PRICE_TRIGGERS.some(p => t.includes(norm(p)));
}

function detectPriceIntent(text, history = []) {
  const t = norm(text);

  // Eksplicitte tema i samme melding:
  for (const topic of Object.keys(TOPIC_KEYWORDS)) {
    if (TOPIC_KEYWORDS[topic].some(k => t.includes(norm(k))) && isGenericPriceQuestion(t)) {
      return { type: 'PRICE', topic };
    }
  }

  // Generisk "hva koster det?" → prøv å hente tema fra history
  if (isGenericPriceQuestion(t)) {
    const topic = inferTopicFromHistory(history);
    return { type: 'PRICE', topic: topic || null };
  }

  return null;
}

// Svar basert på kunnskapen i luna.yml + dine FAQ-tekster
function handlePriceIntent(intent, data) {
  if (!intent || intent.type !== 'PRICE') return null;

  // Hent prisverdier fra luna.yml (de ligger i meta.prices)
  const prices = data?.meta?.prices || {};
  // NB: Retusjering har du lagt i foto.yml – vi skriver en kort, trygg opsjon.
  const delivery = data?.meta?.delivery || {};

  const answerFor = (topic) => {
    switch (topic) {
      case 'video':
        // Fra luna.yml + rabatt fra video.yml-teksten
        return (
          `${prices.video_per_time || 'Kr 315,-'} per digitalisert time videoinnhold.\n` +
          `Mengderabatt: –10 % fra 10 timer, –20 % fra 20 timer.`
        );

      case 'smalfilm':
        // Fra smalfilm.yml-teksten
        return (
          `Fra ca. kr 75 per minutt (8 mm/Super 8). 16 mm fra ca. kr 90 per minutt.\n` +
          `Startgebyr kr 95 per rull. Tillegg for film med lyd. Vi gir rabatt ved større mengder.`
        );

      case 'foto':
        // Fra luna.yml (fotoskanning per stk)
        return (
          `${prices.scanning_foto_per_stk || 'Fra kr 10,-'} per bilde/dias.\n` +
          `Oppløsning etter behov (skjerm/utskrift).`
        );

      case 'retusj':
        // Fra din foto.yml (du satte "fra ca. 700,-")
        return (
          `Fra ca. kr 700,- per fotografi (moderate rifter/riper/misfarging). ` +
          `Endelig pris avhenger av omfanget – vi gir estimat etter å ha sett bildet.`
        );

      default:
        // Helt generisk – safe “oversikt”
        return [
          prices.video_per_time ? `• Video: ${prices.video_per_time} per digitalisert time.` : '• Video: kr 315,- per time.',
          '• Smalfilm: fra ca. kr 75 per minutt (8 mm/Super 8). 16 mm fra ca. kr 90 per minutt. Startgebyr kr 95 per rull.',
          prices.scanning_foto_per_stk ? `• Fotoskanning: ${prices.scanning_foto_per_stk} per bilde/dias.` : '• Fotoskanning: fra kr 10,- per bilde/dias.',
          '• Retusjering: fra ca. kr 700,- per fotografi (avhenger av omfang).'
        ].join('\n');
    }
  };

  const text = answerFor(intent.topic);
  return {
    type: 'answer',
    text,
    meta: { route: 'price', topic: intent.topic || 'generic' }
  };
}

module.exports = { detectPriceIntent, handlePriceIntent };
