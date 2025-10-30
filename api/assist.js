// api/assist.js
// build-bump: 2025-10-30T15:20Z

const { loadKnowledge } = require('../data/loadData');

let assistant = null;
let coreLoadError = null;

// Lazy loader for core to prevent 500s on debug routes if a handler has syntax errors
function getAssistant() {
  if (assistant) return assistant;
  try {
    // IMPORTANT: require here (lazy), not at top
    const { createAssistant } = require('../core');
    assistant = createAssistant();
    coreLoadError = null;
  } catch (e) {
    coreLoadError = String(e && e.stack ? e.stack : e);
    assistant = null;
  }
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

// ---- debug helpers ----
const dbg = {
  env: () => ({
    ASSISTANT_MODE: process.env.ASSISTANT_MODE || 'unset',
    USE_MODULAR_ASSISTANT: process.env.USE_MODULAR_ASSISTANT || 'unset',
    DEBUG_ASSISTANT: process.env.DEBUG_ASSISTANT || 'unset',
    node: process.version
  }),
  version: () => ({
    ok: true,
    build: '2025-10-30T15:20Z',
    commit: process.env.VERCEL_GIT_COMMIT_SHA || 'local',
    tag: process.env.VERCEL_GIT_COMMIT_REF || 'unknown'
  }),
  which: () => {
    try {
      const core = require('../core'); // may throw if handlers broken
      return {
        ok: true,
        hasCreate: typeof core.createAssistant === 'function'
      };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
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
  },
  // NEW: deep diagnostics so we see exactly which handler/path breaks
  diag: () => {
    const out = {};
    try {
      // try each handler individually to narrow the fault
      out.priceHandler = (() => {
        try {
          const ph = require('../core/handlers/priceHandler');
          return {
            ok: true,
            exports: Object.keys(ph || {}),
            types: {
              detectPriceIntent: typeof ph.detectPriceIntent,
              handlePriceIntent: typeof ph.handlePriceIntent
            }
          };
        } catch (e) {
          return { ok: false, error: String(e && e.stack ? e.stack : e) };
        }
      })();

      out.faqHandler = (() => {
        try {
          const fh = require('../core/handlers/faqHandler');
          return { ok: true, exports: Object.keys(fh || {}) };
        } catch (e) {
          return { ok: false, error: String(e && e.stack ? e.stack : e) };
        }
      })();

      out.companyHandler = (() => {
        try {
          const ch = require('../core/handlers/companyHandler');
          return { ok: true, exports: Object.keys(ch || {}) };
        } catch (e) {
          return { ok: false, error: String(e && e.stack ? e.stack : e) };
        }
      })();

      out.coreIndex = (() => {
        try {
          const core = require('../core');
          return { ok: true, exports: Object.keys(core || {}) };
        } catch (e) {
          return { ok: false, error: String(e && e.stack ? e.stack : e) };
        }
      })();

      // include last core load error (from lazy init)
      out.coreLoadError = coreLoadError || null;

      return { ok: true, out };
    } catch (e) {
      return { ok: false, error: String(e && e.stack ? e.stack : e) };
    }
  }
};

module.exports = async (req, res) => {
  try {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();

    // GET = health/debug (?fn=env|version|which|knowledge|company|diag)
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

    const text    = (body?.message || body?.text || '').trim();
    const history = Array.isArray(body?.history) ? body.history : [];
    const trace   = (req.query && (req.query.trace === '1' || req.query.trace === 'true')) || !!body?.trace;

    if (!text) return res.status(400).json({ error: 'Missing message' });

    // Ensure core is loaded (and capture error if not)
    const a = getAssistant();
    if (!a) {
      return res.status(500).json({
        ok: false,
        answer: 'Server error',
        text: 'Server error',
        error: coreLoadError || 'Unknown core load error'
      });
    }

    const result = await a.handle({ text, history });

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
    console.error('[assist] error:', err && err.stack ? err.stack : err);
    return res.status(500).json({
      ok: false,
      answer: 'Server error',
      text: 'Server error',
      error: 'Server error'
    });
  }
};
