// core/handlers/priceHandler.js
// Robust pris-handler: defensiv lasting av priser + null/undefined-safe beregninger.

const fs = require('fs');
const path = require('path');

// --- Last priser.json trygt (uten require) ---
function loadPrices() {
  try {
    // Filen ligger under api/data/priser.json
    // Denne handleren ligger i api/core/handlers → gå opp til api/ og inn i data/
    const p = path.join(__dirname, '..', '..', 'data', 'priser.json');
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    // Fall back til tomt oppsett – vi kaster ikke!
    return null;
  }
}

const PRICES = loadPrices();

// --- Intent-detektor ---
function detectPriceIntent(text = '') {
  const t = (text || '').toLowerCase();
  if (/(pris|koster|kostnad|rabatt|hva\s+koster)/.test(t)) return 'generic_price';
  return null;
}

function formatCurrency(n) {
  const x = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat('no-NO').format(x);
  } catch {
    return String(x);
  }
}

function answerForVideo() {
  const p = PRICES || {};
  const rate = Number(p.vhs_time_rate ?? p?.services?.video?.rate ?? 315);
  const d10  = Number(p.vhs_bulk_discount_10h ?? 0.10);
  const d20  = Number(p.vhs_bulk_discount_20h ?? 0.20);
  const usb  = Number(p.usb_min_price ?? p?.services?.common?.usb_from ?? 295);

  let s = `Video (VHS/Video8/Hi8/MiniDV): **kr ${formatCurrency(rate)} per time digitalisert video**.\n`;
  s += `Mengderabatt: **–${Math.round(d10*100)} %** fra **10 timer**, **–${Math.round(d20*100)} %** fra **20 timer**.\n`;
  if (usb) s += `USB/minnepenn fra **kr ${formatCurrency(usb)}**.`;
  return s.trim();
}

function answerForSmalfilm() {
  const p = PRICES || {};
  const r8   = Number(p.smalfilm_min_rate ?? p?.services?.smalfilm?.units?.['8mm_super8']?.rate ?? 75);
  const r16  = Number(p.smalfilm_16mm_min_rate ?? p?.services?.smalfilm?.units?.['16mm']?.rate ?? 90);
  const start= Number(p.smalfilm_start_per_rull ?? 95);

  let s = `Smalfilm:\n• **8 mm/Super 8:** fra **kr ${formatCurrency(r8)} per minutt**\n`;
  s += `• **16 mm:** fra **kr ${formatCurrency(r16)} per minutt**\n`;
  s += `• Startgebyr: **kr ${formatCurrency(start)} per rull**\n`;
  s += `Rabatt vurderes ut fra mengde. Filmer med lyd kan gi tillegg.`;
  return s.trim();
}

function answerForFoto() {
  const p = PRICES || {};
  const scanFrom = Number(p?.services?.foto?.scan_from_price_per_item ?? 10);
  const retFrom  = Number(p.retusjering_from ?? p?.services?.foto?.retouch_from_price ?? 700);

  let s = `Foto/dias/negativer:\n• Skanning fra **kr ${formatCurrency(scanFrom)} per bilde/dias**\n`;
  s += `• Retusjering fra **kr ${formatCurrency(retFrom)} per fotografi** (avhenger av omfang)\n`;
  s += `USB eller nedlasting etter ønske.`;
  return s.trim();
}

function answerGenericAskWhich() {
  return `Gjelder det **video**, **smalfilm** eller **foto**? Så gir jeg riktig pris med én gang.`;
}

function handlePriceIntent(intent, _meta, opts = {}) {
  try {
    const hint = String(opts?.topicHint || '').toLowerCase();

    if (hint === 'video') {
      return { type: 'answer', text: answerForVideo(), meta: { source: 'priser.json', topic: 'video' } };
    }
    if (hint === 'smalfilm') {
      return { type: 'answer', text: answerForSmalfilm(), meta: { source: 'priser.json', topic: 'smalfilm' } };
    }
    if (hint === 'foto') {
      return { type: 'answer', text: answerForFoto(), meta: { source: 'priser.json', topic: 'foto' } };
    }

    // Uten hint spør vi kort hva det gjelder
    return { type: 'answer', text: answerGenericAskWhich(), meta: { source: 'priser.json', need: 'topic' } };
  } catch (e) {
    // Absolutt siste skanse: aldri 500 – gi et fornuftig svar
    return {
      type: 'answer',
      text: 'Prisene varierer mellom video, smalfilm og foto. Gjelder det video, smalfilm eller foto?',
      meta: { source: 'priser.json', error: 'priceHandler caught', detail: String(e && e.message || e) }
    };
  }
}

module.exports = { detectPriceIntent, handlePriceIntent };
