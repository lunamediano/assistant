// api/assist.js
// build-bump: 2025-10-30T10:05Z

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

// ---- debug helpers (each returns JSON-safe payload; never throws) ----
const dbg = {
  ping: () => ({ ok: true, pong: true, time: new Date().toISOString() }),
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
  version: () => ({
    ok: true,
    build: '2025-10-30T10:05Z',
    commit: process.env.VERCEL_GIT_COMMIT_SHA || 'local',
    tag: process.env.VERCEL_GIT_COMMIT_REF || 'unknown'
  }),
  which: () => {
    try {
      const hasCreate = typeof require('../core').createAssistant === 'function';
      return {
        ok: true,
        hasCreate,
        required: hasCreate ? ['createAssistant'] : [],
        error: hasCreate ? null : 'Fant ikke core eller createAssistant'
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  },
  knowledge: () => {
    try {
      const data = loadKnowledge(); // kan kaste -> vi fanger
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
      const data = loadKnowledge(); // kan kaste -> vi fanger
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

    // GET = health/debug (?fn=ping|env|mode|version|which|knowledge|company)
    if (req.method === 'GET') {
      const fn = (req.query && req.query.fn) || null;
      if (!fn) return res.status(200).json({ status: 'ok', time: new Date().toISOString() });

      if (dbg[fn]) {
        // Viktig: aldri la et debug-kall boble opp til 500
        try {
          const payload = dbg[fn]();
          return res.status(200).json(payload);
        } catch (e) {
          return res.status(200).json({ ok: false, error: `debug fn failed: ${String(e?.message || e)}` });
        }
      }
      return res.status(400).json({ ok: false, error: `Ukjent fn=${fn}` });
    }

    if (req.method !== 'POST')
      return res.status(405).json({ error: 'Method not allowed' });

    // POST = chat
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const text    = (body?.message || body?.text || '').trim();
    const history = Array.isArray(body?.history) ? body.history : [];
    const trace   = (req.query && (req.query.trace === '1' || req.query.trace === 'true')) || !!body?.trace;

    if (!text) return res.status(400).json({ error: 'Missing message' });

    // send videre historikk til kjernen
    const result = await getAssistant().handle({ text, history });

    if (result && typeof result.text === 'string') {
      let meta = result.meta || null;
      if (meta && !trace && meta.candidates) {
        const { candidates, ...rest } = meta;
        meta = rest;
      }
      return res.status(200).json({
        ok: true,
        answer: result.text,
        text: result.text,
        suggestion: result.suggestion || null,
        meta,
        source: result.type || 'answer'
      });
    }

    // fallback
    return res.status(200).json({
      ok: true,
      answer: 'Jeg er ikke helt sikker – kan du utdype litt?',
      text: 'Jeg er ikke helt sikker – kan du utdype litt?',
      suggestion: 'Vil du beskrive hva du har (antall kassetter/ruller/bilder) – så gir jeg et kjapt estimat?',
      source: 'fallback'
    });

  } catch (err) {
    // Siste skanse – logg og svar 500
    console.error('[assist] error:', err && err.stack ? err.stack : err);
    return res.status(500).json({
      ok: false,
      answer: 'Server error',
      text: 'Server error',
      error: 'Server error'
    });
  }
};
