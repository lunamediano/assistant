// build-bump: 2025-10-06T11:55Z

// /api/assist.js  (CommonJS – health, debug og chat i én lambda)

const { createAssistant } = require('../core');
const { loadKnowledge }   = require('../data/loadData');

let assistant;
function getAssistant() {
  if (!assistant) assistant = createAssistant();
  return assistant;
}

function setCors(req, res) {
  const defaults = [
    'https://h05693dfe8-staging.onrocket.site',
    'https://lunamedia.no'
  ];
  const extra = (process.env.LUNA_ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const allowed = new Set([...defaults, ...extra]);
  const origin = req.headers.origin || '';
  if (allowed.has(origin) || allowed.has('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// i loadData.js eller tilsvarende
const knowledgeFiles = [
  'knowledge/faq_round1.yml',   // legg denne først!
  'knowledge/faq/video.yml',
  'knowledge/faq/smalfilm.yml',
  'knowledge/faq/foto.yml',
  'knowledge/faq/pris.yml',
  'knowledge/faq/spesial.yml'
];

// ---- debug helpers ----
const dbg = {
  env: () => ({
    ASSISTANT_MODE: process.env.ASSISTANT_MODE || 'unset',
    USE_MODULAR_ASSISTANT: process.env.USE_MODULAR_ASSISTANT || 'unset',
    DEBUG_ASSISTANT: process.env.DEBUG_ASSISTANT || 'unset',
    node: process.version
  }),
  mode: () => {
    const flag = (process.env.USE_MODULAR_ASSISTANT || '').toLowerCase();
    const mode = (process.env.ASSISTANT_MODE || '').toLowerCase();
    const computed = mode === 'modular' || flag === '1' || flag === 'true';
    return {
      computed: { useModular: computed },
      env: { ASSISTANT_MODE: mode || 'unset', USE_MODULAR_ASSISTANT: flag || 'unset' }
    };
  },
  which: () => {
    const hasCreate = typeof require('../core').createAssistant === 'function';
    return {
      ok: true,
      hasCreate,
      required: hasCreate ? ['createAssistant'] : [],
      error: hasCreate ? null : 'Fant ikke core eller createAssistant'
    };
  },
  knowledge: () => {
    try {
      const data = loadKnowledge();
      const files = data?.faqIndex?.files || data?.files || [];
      const faqCount = data?.count?.faq ?? data?.faq?.length ?? 0;
      const sample = (data?.faq || [])
        .slice(0, 5)
        .map(x => ({ id: x.id, q: x.q, src: x._src || x.source || x.src }));
      return { ok: true, files: files.length, faqCount, sample };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
  company: () => {
    try {
      const data = loadKnowledge();
      return {
        ok: true,
        hasCompany: !!data?.meta?.company,
        company: data?.meta?.company || null,
        services: data?.meta?.services || [],
        prices: data?.meta?.prices || {},
        delivery: data?.meta?.delivery || {},
        sources: (data?.faqIndex?.files || data?.files || []).length
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }
};

module.exports = async (req, res) => {
  try {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();

    // GET = health eller debug (?fn=env|mode|which|knowledge|company)
    if (req.method === 'GET') {
      const fn = (req.query && req.query.fn) || null;
      if (!fn) return res.status(200).json({ status: 'ok', time: new Date().toISOString() });
      if (dbg[fn]) return res.status(200).json(dbg[fn]());
      return res.status(400).json({ ok: false, error: `Ukjent fn=${fn}` });
    }

    if (req.method !== 'POST')
      return res.status(405).json({ error: 'Method not allowed' });

    // POST = chat
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const text  = (body?.message || body?.text || '').trim();
    const trace = (req.query && (req.query.trace === '1' || req.query.trace === 'true')) || !!body?.trace;

    if (!text) return res.status(400).json({ error: 'Missing message' });

    const result = await getAssistant().handle({ text });

    if (result && typeof result.text === 'string') {
      // Skjul top-k kandidater fra meta hvis trace ikke er slått på
      let meta = result.meta || null;
      if (meta && !trace && meta.candidates) {
        const { candidates, ...rest } = meta;
        meta = rest;
      }

      return res.status(200).json({
        ok: true,
        answer: result.text,
        text: result.text,
        meta,
        source: result.type || 'answer'
      });
    }

    // fallback hvis resultatet ikke har tekst
    return res.status(200).json({
      ok: true,
      answer: 'Jeg er ikke helt sikker – kan du utdype litt?',
      text: 'Jeg er ikke helt sikker – kan du utdype litt?',
      source: 'fallback'
    });

  } catch (err) {
    console.error('[assist] error:', err && err.stack ? err.stack : err);
    return res.status(500).json({
      ok: false,
      answer: 'Server error',
      text: 'Server error',
      error: 'Server error'
    });
  }
};
