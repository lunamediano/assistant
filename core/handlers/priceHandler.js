// core/handlers/priceHandler.js
const path = require('path');
let PRISER = null;
try {
  PRISER = require('../../data/priser.json');
} catch {
  PRISER = null; // fallback hvis fil mangler – vi håndterer det nedenfor
}

function norm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- intent detection ----
function detectPriceIntent(text) {
  const t = norm(text);

  // generisk pris-forespørsel
  const priceWords = /(pris|priser|kostnad|hva koster|hva koster det|prisoverslag|estimat|tilbud)\b/;
  if (!priceWords.test(t)) return null;

  // prøv å lese tema fra teksten
  if (/\b(vhs|videokassett|videobånd|video8|hi8|minidv|video)\b/.test(t)) return 'price_video';
  if (/\b(smalfilm|super ?8|8mm|16 ?mm)\b/.test(t)) return 'price_smalfilm';
  if (/\b(foto|bilde|bilder|dias|negativ)\b/.test(t)) return 'price_foto';

  return 'price_generic';
}

function formatCurrency(nok) {
  try {
    return new Intl.NumberFormat('no-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(nok);
  } catch {
    return `kr ${Number(nok).toLocaleString('no-NO', { maximumFractionDigits: 0 })},-`;
  }
}

function priceTextVideo(p) {
  const h = p?.vhs_time_rate ?? 315;
  const d10 = p?.vhs_bulk_discount_10h ?? 0.10;
  const d20 = p?.vhs_bulk_discount_20h ?? 0.20;
  const usb = p?.usb_min_price ?? 295;

  return {
    type: 'answer',
    text:
      `Video (VHS/Hi8/MiniDV m.fl.): ${formatCurrency(h)} per digitalisert time.\n` +
      `Mengderabatt: −${Math.round(d10 * 100)} % fra 10 timer, −${Math.round(d20 * 100)} % fra 20 timer.\n` +
      `USB/minnepenn fra ${formatCurrency(usb)} (eller egen USB/nedlasting).`,
    meta: { source: 'priser.json', topic: 'video' }
  };
}

function priceTextSmalfilm(p) {
  const minRate = p?.smalfilm_min_rate ?? 75;
  const start = p?.smalfilm_start_per_rull ?? 95;
  const usb = p?.usb_min_price ?? 295;

  return {
    type: 'answer',
    text:
      `Smalfilm (8 mm / Super 8 / 16 mm): fra ${formatCurrency(minRate)} per minutt.\n` +
      `Startgebyr: ${formatCurrency(start)} per rull. Lyd på film gir et tillegg.\n` +
      `USB/minnepenn fra ${formatCurrency(usb)} (eller nedlasting / egen USB).`,
    meta: { source: 'priser.json', topic: 'smalfilm' }
  };
}

function priceTextFoto(p) {
  const fotoFrom = 10; // fra kunnskapsfilene – sett gjerne i priser.json hvis ønskelig
  const usb = p?.usb_min_price ?? 295;

  return {
    type: 'answer',
    text:
      `Fotoskanning: fra ${formatCurrency(fotoFrom)} per bilde/dias (inkl. mva), etter ønsket oppløsning.\n` +
      `Levering via nedlasting eller på USB/minnepenn fra ${formatCurrency(usb)}.`,
    meta: { source: 'faq/foto.yml', topic: 'foto' }
  };
}

/**
 * Velg topic basert på intent + topicHint.
 * priority: explicit intent > topicHint > null
 */
function resolveTopic(intent, topicHint) {
  if (intent === 'price_video') return 'video';
  if (intent === 'price_smalfilm') return 'smalfilm';
  if (intent === 'price_foto') return 'foto';
  if (intent === 'price_generic') {
    if (topicHint === 'video' || topicHint === 'smalfilm' || topicHint === 'foto') return topicHint;
    return null;
  }
  return null;
}

function handlePriceIntent(intent, _meta, opts = {}) {
  const topic = resolveTopic(intent, opts.topicHint || null);

  // Hvis vi ikke klarer å avgjøre tema, be høflig om presisering (men nå vil dette
  // kun skje når hverken tekst eller historikk sier noe om video/smalfilm/foto).
  if (!topic) {
    return {
      type: 'answer',
      text: 'Gjelder det **video**, **smalfilm** eller **foto**?',
      meta: { source: 'priceHandler', need: 'topic' }
    };
  }

  // Returnér riktig pris-tekst basert på tema
  if (topic === 'video') return priceTextVideo(PRISER || {});
  if (topic === 'smalfilm') return priceTextSmalfilm(PRISER || {});
  if (topic === 'foto') return priceTextFoto(PRISER || {});

  // Fallback (bør i praksis ikke skje)
  return {
    type: 'answer',
    text: 'Jeg fant ikke prisinformasjon for dette temaet akkurat nå.',
    meta: { source: 'priceHandler', topic }
  };
}

module.exports = { detectPriceIntent, handlePriceIntent };
