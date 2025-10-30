// core/handlers/priceHandler.js

function detectPriceIntent(text) {
  const t = (text || '').toLowerCase();
  if (
    /(hva\s*koster|pris|kostnad|hvor\s*mye|price)/i.test(t) ||
    /^kr\s*\??$/i.test(t)
  ) {
    return 'generic_price';
  }
  return null;
}

function chooseTopicFromCtx(ctx = {}) {
  // 1) Direkte hint (topicHint / lastTopic)
  const hint = (ctx.topicHint || ctx.lastTopic || '').toLowerCase();
  if (hint === 'video' || hint === 'smalfilm' || hint === 'foto') return hint;

  // 2) Se på forrige FAQ-id
  const id = (ctx.lastFaqId || '').toLowerCase();
  if (id.startsWith('vhs') || id.includes('video')) return 'video';
  if (id.startsWith('smalfilm') || id.includes('smalfilm')) return 'smalfilm';
  if (id.startsWith('foto') || id.includes('foto')) return 'foto';

  // 3) Se på kildefil
  const src = (ctx.lastFaqSrc || '').toLowerCase();
  if (/\/video\.yml$/i.test(src)) return 'video';
  if (/\/smalfilm\.yml$/i.test(src)) return 'smalfilm';
  if (/\/foto\.yml$/i.test(src)) return 'foto';

  return null;
}

function handlePriceIntent(intent, meta = {}, ctx = {}) {
  if (intent !== 'generic_price') return null;

  const topic = chooseTopicFromCtx(ctx);

  if (!topic) {
    return {
      type: 'answer',
      text: 'Gjelder det **video**, **smalfilm** eller **foto**? Så gir jeg riktig pris med en gang.',
      suggestion: 'Video • Smalfilm • Foto',
      meta: { needsTopic: true }
    };
  }

  // Svar per tema – tekstlige defaults (kan senere mappes til meta.prices)
  if (topic === 'video') {
    const t = [
      'Video (VHS/Video8/Hi8/MiniDV): **kr 315,- per digitalisert time**.',
      'Mengderabatt: **–10 %** fra **10 timer**, **–20 %** fra **20 timer**.',
      'USB/minnepenn fra **kr 295,-** (eller egen USB / nedlasting).'
    ].join(' ');
    return { type: 'answer', text: t, meta: { topic: 'video', source: 'priceHandler' } };
  }

  if (topic === 'smalfilm') {
    const t = [
      'Smalfilm: **8 mm/Super 8 fra ca. kr 75 per minutt**, **16 mm fra ca. kr 90 per minutt**.',
      'Startgebyr **kr 95 per rull**. Film med lyd gir et tillegg.',
      'Vi gir rabatt etter omfang. Oppgi ca. minuttene/rullene, så gir vi et uforpliktende estimat.'
    ].join(' ');
    return { type: 'answer', text: t, meta: { topic: 'smalfilm', source: 'priceHandler' } };
  }

  if (topic === 'foto') {
    const t = [
      'Fotoskanning: fra **kr 10,- per bilde/dias** (inkl. mva), oppløsning etter behov.',
      'Retusjering/restaurering: fra **ca. kr 700,- pr foto** (avhenger av omfang).'
    ].join(' ');
    return { type: 'answer', text: t, meta: { topic: 'foto', source: 'priceHandler' } };
  }

  // Sikkerhetsnett
  return {
    type: 'answer',
    text: 'Gjelder det **video**, **smalfilm** eller **foto**? Så gir jeg riktig pris med en gang.',
    suggestion: 'Video • Smalfilm • Foto',
    meta: { needsTopic: true }
  };
}

module.exports = { detectPriceIntent, handlePriceIntent };
