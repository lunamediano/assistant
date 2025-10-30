// core/handlers/priceHandler.js
// Enkel pris-intent + svar som bruker topicHint for å velge riktig prisområde.

const path = require('path');
// Les priser fra JSON én gang:
let PRICES = null;
try {
  PRICES = require('../../data/priser.json');
} catch (e) {
  // fail soft – lar handleren fortsatt svare noe generelt
  PRICES = null;
}

// veldig enkel detektor: leter etter “pris”, “koster”, “kostnad”, “rabatt”
function detectPriceIntent(text = '') {
  const t = (text || '').toLowerCase();
  if (/(pris|koster|kostnad|rabatt)/.test(t)) return 'generic_price';
  return null;
}

function formatCurrency(n) {
  try {
    return new Intl.NumberFormat('no-NO').format(n);
  } catch {
    return String(n);
  }
}

function answerForVideo() {
  // Bruker både gammel flate nøkler og ev. services.video
  const rate = (PRICES?.vhs_time_rate) ?? (PRICES?.services?.video?.rate) ?? 315;
  const d10  = (PRICES?.vhs_bulk_discount_10h) ?? 0.10;
  const d20  = (PRICES?.vhs_bulk_discount_20h) ?? 0.20;

  let s = `Video (VHS/Video8/Hi8/MiniDV): **kr ${formatCurrency(rate)} per time digitalisert video**.\n`;
  s += `Mengderabatt: **–${Math.round(d10*100)} %** fra **10 timer**, **–${Math.round(d20*100)} %** fra **20 timer**.\n`;
  if (PRICES?.usb_min_price) {
    s += `USB/minnepenn fra **kr ${formatCurrency(PRICES.usb_min_price)}** (størrelse etter behov).`;
  }
  return s.trim();
}

function answerForSmalfilm() {
  const r8  = (PRICES?.smalfilm_min_rate) ?? (PRICES?.services?.smalfilm?.units?.['8mm_super8']?.rate) ?? 75;
  const r16 = (PRICES?.smalfilm_16mm_min_rate) ?? (PRICES?.services?.smalfilm?.units?.['16mm']?.rate) ?? 90;
  const start = (PRICES?.smalfilm_start_per_rull) ?? 95;

  let s = `Smalfilm:\n• **8 mm/Super 8:** fra **kr ${formatCurrency(r8)} per minutt**\n`;
  s += `• **16 mm:** fra **kr ${formatCurrency(r16)} per minutt**\n`;
  s += `• Startgebyr: **kr ${formatCurrency(start)} per rull**\n`;
  s += `Rabatt vurderes ut fra mengde. Filmer med lyd kan gi tillegg.`;
  return s.trim();
}

function answerForFoto() {
  const scanFrom = (PRICES?.services?.foto?.scan_from_price_per_item) ?? 10;
  const retFrom  = (PRICES?.retusjering_from) ?? (PRICES?.services?.foto?.retouch_from_price) ?? 700;

  let s = `Foto/dias/negativer:\n• Skanning fra **kr ${formatCurrency(scanFrom)} per bilde/dias**\n`;
  s += `• Retusjering fra **kr ${formatCurrency(retFrom)} per fotografi** (avhenger av omfang)\n`;
  s += `USB/nedlasting etter ønske.`;
  return s.trim();
}

function answerGenericAskWhich() {
  return `Gjelder det **video**, **smalfilm** eller **foto**? Så gir jeg riktig pris med en gang.`;
}

function handlePriceIntent(intent, meta, opts = {}) {
  // velg tema ut fra hint (fra historikk) eller meta.company/services hvis du ønsker
  const hint = (opts.topicHint || '').toLowerCase();

  if (hint === 'video') {
    return {
      type: 'answer',
      text: answerForVideo(),
      meta: { source: 'priser.json', topic: 'video' }
    };
  }
  if (hint === 'smalfilm') {
    return {
      type: 'answer',
      text: answerForSmalfilm(),
      meta: { source: 'priser.json', topic: 'smalfilm' }
    };
  }
  if (hint === 'foto') {
    return {
      type: 'answer',
      text: answerForFoto(),
      meta: { source: 'priser.json', topic: 'foto' }
    };
  }

  // ingen hint → spør hva det gjelder (kort og tydelig)
  return {
    type: 'answer',
    text: answerGenericAskWhich(),
    meta: { source: 'priser.json', need: 'topic' }
  };
}

module.exports = { detectPriceIntent, handlePriceIntent };
