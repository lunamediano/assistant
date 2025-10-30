// api/assist.js
// build-bump: 2025-10-30T12:55Z

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
    'https://lunamedia.no',
    'https://assistant-sigma-lovat.vercel.app'
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
  res.setHeader('Access-Control-Allow-Credentials', 'true'); // ✅ viktig for cross-site cookies
}

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
  version: () => ({
    ok: true,
    build: '2025-10-30T12:55Z',
    commit: process.env.VERCEL_GIT_COMMIT_SHA || 'local',
    tag: process.env.VERCEL_GIT_COMMIT_REF || 'unknown'
  }),
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
  },
  diag: () => {
    try {
      const core = require('../core');
      const faqH = require('../core/handlers/faqHandler');
      const priceH = require('../core/handlers/priceHandler');
      const compH = require('../core/handlers/companyHandler');
      return {
        ok: true,
        out: {
          priceHandler: {
            ok: !!priceH,
            exports: Object.keys(priceH || {}),
            types: {
              detectPriceIntent: typeof priceH.detectPriceIntent,
              handlePriceIntent: typeof priceH.handlePriceIntent
            }
          },
          faqHandler: {
            ok: !!faqH,
            exports: Object.keys(faqH || {})
          },
          companyHandler: {
            ok: !!compH,
            exports: Object.keys(compH || {})
          },
          coreIndex: {
            ok: !!core,
            exports: Object.keys(core || {})
          },
          coreLoadError: null
        }
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }
};

// --- Cookie utils ---
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(part => {
    const [k, ...rest] = part.split('=');
    if (!k) return;
    const key = k.trim();
    const val = decodeURIComponent((rest.join('=') || '').trim());
    if (key) out[key] = val;
  });
  return out;
}

function setTopicCookie(res, topic) {
  if (!topic) return;
  const maxAge = 15 * 60; // 15 min
  // Cross-site cookie: må være SameSite=None + Secure
  const cookie = `lm_topic=${encodeURIComponent(topic)}; Path=/; Max-Age=${maxAge}; SameSite=None; Secure`;
  res.setHeader('Set-Cookie', cookie);
}

module.exports = async (req, res) => {
  try {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.status(204).end();

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

    // History fra klient (om den finnes)
    const clientHistory = Array.isArray(body?.history) ? body.history : [];

    // Les forrige tema fra cookie og legg det inn som en «syntetisk» history-oppføring
    const cookies = parseCookies(req);
    const cookieTopic = (cookies.lm_topic || '').toLowerCase();
    const cookieHistory = cookieTopic
      ? [{ text: '', topic: cookieTopic, meta: { src: `cookie:${cookieTopic}` } }]
      : [];

    const allHistory = [...cookieHistory, ...clientHistory];

    const result = await getAssistant().handle({ text, history: allHistory });

    if (result && typeof result.text === 'string') {
      // Sett lm_topic-cookie når vi får et tydelig tema i meta
      const topic = result?.meta?.topic;
      if (topic && (topic === 'video' || topic === 'smalfilm' || topic === 'foto')) {
        setTopicCookie(res, topic);
      }

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
