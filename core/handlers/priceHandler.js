// core/handlers/priceHandler.js
const { loadKnowledge } = require('../../data/loadData');

function safeNorm(s) {
  try {
    return (s || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9æøåéèüöß\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
function has(text, ...needles) {
  const t = safeNorm(text);
  return needles.some(n => t.includes(safeNorm(n)));
}

// --- små hjelpere for tall / priser ---
const num = s => {
  if (!s) return null;
  const m = String(s).replace(/\s/g, '').match(/(\d+[.,]?\d*)/);
  if (!m) return null;
  return parseFloat(m[1].replace(',', '.'));
};

function extractNumbers(text) {
  const t = safeNorm(text);
  const out = {};

  // timer (fanger "3 timer", "12t", "1,5 time")
  const mHours = t.match(/(\d+[.,]?\d*)\s*(t(imer)?|h|time)\b/);
  if (mHours) out.hours = parseFloat(mHours[1].replace(',', '.'));

  // minutter (fanger "30 min", "45minutter")
  const mMins = t.match(/(\d+[.,]?\d*)\s*(min(utt(er)?)?)\b/);
  if (mMins) out.minutes = parseFloat(mMins[1].replace(',', '.'));

  // antall ruller (smalfilm)
  const mRull = t.match(/(\d+)\s*(rull(er)?)\b/);
  if (mRull) out.rolls = parseInt(mRull[1], 10);

  // hint om USB/minnepenn
  out.wantUsb = has(t, 'usb', 'minnepenn', 'minne penn', 'flashdrive');

  return out;
}

function detectPriceIntent(text) {
  if (!text) return null;
  if (has(text, 'leveringstid', 'hvor lang tid', 'når ferdig', 'ventetid')) return 'delivery_time';
  if (has(text, 'pris', 'koster', 'kostnad', 'hva tar dere', 'hva er prisen')) return 'price';
  // heuristikk: tall + vhs/smalfilm
  if (/\d/.test(text) && has(text, 'vhs', 'video', 'smalfilm', 'super 8', '8mm')) return 'price';
  return null;
}

function handlePriceIntent(intent, meta, userText = '') {
  try {
    const m = meta || {};
    const p = m.prices || {};
    const d = m.delivery || {};
    const ask = extractNumbers(userText);

    if (intent === 'delivery_time') {
      const std = d.standard_dager ? `${d.standard_dager}` : 'noen dager';
      const rush = d.rush_mulig ? ` Ekspress kan være mulig${d.rush_tillegg ? ` (${d.rush_tillegg})` : ''}.` : '';
      return {
        type: 'answer',
        text: `Leveringstid er normalt ${std}.${rush ? rush : ''}`,
        meta: d._source ? { source: d._source } : undefined
      };
    }

    if (intent === 'price') {
      // Forsøk enkel kalkulasjon når vi har tall
      const vhsRate = num(p.video_per_time);           // eks. "Kr 315,-" -> 315
      const smallRate = num(p.smalfilm_per_minutt);    // eks. "Fra kr 75,-" -> 75
      const usbPrice = p.minnepenn;                    // vis tekst om USB hvis ønsket

      const lines = [];
      let didCompute = false;

      // VHS – hvis bruker oppgir timer/minutter
      if ((/vhs|video|minidv|hi8|video8/.test(safeNorm(userText))) && vhsRate) {
        const h = (ask.hours || 0) + (ask.minutes ? ask.minutes / 60 : 0);
        if (h > 0) {
          // mengderabatt – heuristikk: 10% >=10t, 20% >=20t
          let rate = vhsRate;
          let rabTxt = '';
          if (h >= 20) { rate = vhsRate * 0.8; rabTxt = ' (20% mengderabatt)'; }
          else if (h >= 10) { rate = vhsRate * 0.9; rabTxt = ' (10% mengderabatt)'; }

          const sum = Math.round(h * rate);
          lines.push(`VHS: ca. ${sum} kr for ~${h.toFixed(1)} t × ${Math.round(rate)} kr/t${rabTxt}.`);
          didCompute = true;
        }
      }

      // Smalfilm – hvis bruker oppgir minutter / ruller
      if ((/smalfilm|super\s*8|8mm/.test(safeNorm(userText))) && smallRate) {
        const mins = ask.minutes || (ask.hours ? ask.hours * 60 : 0);
        if (mins > 0) {
          const sum = Math.round(mins * smallRate);
          lines.push(`Smalfilm: ca. ${sum} kr for ~${Math.round(mins)} min × ${Math.round(smallRate)} kr/min.`);
          didCompute = true;
        }
        if (ask.rolls) {
          lines.push(`(Oppstartsgebyr pr. rull kommer i tillegg – oppgis i tilbud.)`);
        }
      }

      if (ask.wantUsb && usbPrice) {
        lines.push(`USB/minnepenn: ${usbPrice}.`);
      }

      if (didCompute) {
        lines.push(`\nForbehold: Endelig pris avhenger av faktisk spilletid/omfang. Vil du ha et nøyaktig tilbud?`);
        return { type: 'answer', text: lines.join('\n'), meta: p._source ? { source: p._source } : undefined };
      }

      // Ellers: vis kjappe priseksempler
      const out = [];
      if (p.video_per_time) out.push(`• Video (VHS m.fl.): ${p.video_per_time} per time`);
      if (p.smalfilm_per_minutt) out.push(`• Smalfilm: ${p.smalfilm_per_minutt} per minutt`);
      if (p.scanning_foto_per_stk) out.push(`• Fotoskanning: ${p.scanning_foto_per_stk} per bilde`);
      if (p.minnepenn) out.push(`• Minnepenn: ${p.minnepenn}`);
      if (!out.length) return null;

      return {
        type: 'answer',
        text: `Priseksempler:\n${out.join('\n')}\n`,
        meta: p._source ? { source: p._source } : undefined
      };
    }

    return null;
  } catch {
    return null;
  }
}

module.exports = { detectPriceIntent, handlePriceIntent };
