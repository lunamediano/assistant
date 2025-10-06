// /api/assist.js  (samlet assist + debug)

const { createAssistant } = require('../core');
const { loadKnowledge }   = require('../data/loadData');

// ---------- init (varm start gjenbrukes mellom kall på Vercel) ----------
let assistant;
function getAssistant() {
  if (!assistant) assistant = createAssistant();
  return assistant;
}

// ---------- CORS ----------
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

// ---------- DEBUG HELPERS ----------
function dbg_env() {
  return {
    ASSISTANT_MODE: process.env.ASSISTANT_MODE || 'unset',
    USE_MODULAR_ASSISTANT: process.env.USE_MODULAR_ASSISTANT || 'unset',
    DEBUG_ASSISTANT: process.env.DEBUG_ASSISTANT || 'unset',
    node: process.version,
  };
}
function dbg_mode() {
  const flag = (process.env.USE_MODULAR_ASSISTANT||'').toLowerCase();
  const mode = (process.env.ASSISTANT_MODE||'').toLowerCase();
  const computed = (mode==='modular' || flag==='1' || flag==='true');
  return { computed: { useModular: computed }, env: { ASSISTANT_MODE: mode || 'unset', USE_MODULAR_ASSISTANT: flag || 'unset' } };
}
function dbg_which() {
  const hasCreate = typeof (require('../core').createAssistant) === 'function';
  return { ok:true, hasCreate, required: hasCreate ? ['createAssistant'] : [], error: hasCreate ? null : 'Fant ikke core eller createAssistant' };
}
function dbg_knowledge() {
  try{
    const data = loadKnowledge();
    const files = data?.faqIndex?.files || data?.files || [];
    const faqCount = data?.count?.faq ?? data?.faq?.length ?? 0;
    const sample = (data?.faq || []).slice(0,5).map(x => ({ id:x.id, q:x.q, src: x._src || x.source }));
    return { ok:true, files: files.length, faqCount, sample };
  }catch(e){
    return { ok:false, error: String(e?.message || e) };
  }
}
function dbg_company() {
  try{
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
  }catch(e){
    return { ok:false, error: String(e?.message || e) };
  }
}

// ---------- handler ----------
module.exports = async (req, res) => {
  try {
    setCors(req, res);

    // Preflight
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    // GET: health / debug
    if (req.method === 'GET') {
      const fn = (req.query && req.query.fn) || null;
      if (!fn) {
        return res.status(200).json({ status: 'ok', time: new Date().toISOString() });
      }
      switch (fn) {
        case 'env':        return res.status(200).json(dbg_env());
        case 'mode':       return res.status(200).json(dbg_mode());
        case 'which':      return res.status(200).json(dbg_which());
        case 'knowledge':  return res.status(200).json(dbg_knowledge());
        case 'company':    return res.status(200).json(dbg_company());
        default:           return res.status(400).json({ ok:false, error:`Ukjent fn=${fn}` });
      }
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // Parse body
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const text = (body?.message || body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Missing message' });

    // Route via modular assistant
    const a = getAssistant();
    const result = await a.handle({ text });

    if (result && typeof result.text === 'string') {
      return res.status(200).json({
        answer: result.text,
        meta: result.meta || null,
        source: result.type || 'answer',
      });
    }

    return res.status(200).json({
      answer: 'Jeg er ikke helt sikker – kan du si litt mer konkret hva du lurer på?',
      source: 'fallback',
    });

  } catch (err) {
    console.error('[assist] error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'Server error' });
  }
};
