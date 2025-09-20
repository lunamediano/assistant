// api/debug.js
const fs = require('fs');
const path = require('path');

// ---- Vercel bundle-hint: pakk med kjernen og kunnskapen ----
module.exports.config = {
  runtime: 'nodejs20.x',
  includeFiles: ['core/**','data/**','knowledge/**'],
};

// ---- CORS (legg til flere domener ved behov) ----
const ALLOWED_ORIGINS = ['https://h05693dfe8-staging.onrocket.site'];
function cors(req, res) {
  const o = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function ok204(req, res){ if (req.method === 'OPTIONS') { res.status(204).end(); return true; } return false; }

// ---- helpers for requires ----
function tryRequireCore() {
  const tries = ['../core','/var/task/core'];
  for (const p of tries) { try { return require(p); } catch {} }
  return null;
}
function tryLoadKnowledgeFn() {
  const tries = ['../data/loadData','/var/task/data/loadData'];
  for (const p of tries) {
    try {
      const m = require(p);
      if (m && typeof m.loadKnowledge === 'function') return m.loadKnowledge;
    } catch {}
  }
  return null;
}

// ---- sub-ops ----
async function op_env() {
  return {
    ASSISTANT_MODE: process.env.ASSISTANT_MODE || 'unset',
    USE_MODULAR_ASSISTANT: process.env.USE_MODULAR_ASSISTANT || 'unset',
    DEBUG_ASSISTANT: process.env.DEBUG_ASSISTANT || 'unset',
    node: process.version,
  };
}
async function op_mode() {
  const flag = (process.env.USE_MODULAR_ASSISTANT||'').toLowerCase();
  const mode = (process.env.ASSISTANT_MODE||'').toLowerCase();
  const computed = (mode==='modular' || flag==='1' || flag==='true');
  return { computed: { useModular: computed }, env: { ASSISTANT_MODE: mode || 'unset', USE_MODULAR_ASSISTANT: flag || 'unset' } };
}
async function op_ping(){ return { ok:true, now: Date.now() }; }

async function op_ls(q) {
  const roots = ['/var/task','/var/task/core','/var/task/data','/var/task/knowledge','/var/task/api'];
  const pattern = String(q.pattern || '').toLowerCase() || null;
  async function walk(root, out=[], depth=0, maxDepth=6){
    try{
      const ents = await fs.promises.readdir(root, { withFileTypes:true });
      for(const e of ents){
        const p = path.join(root, e.name);
        const rel = p.replace('/var/task','');
        if(!pattern || rel.toLowerCase().includes(pattern)) out.push(rel || '/');
        if(e.isDirectory() && depth<maxDepth) await walk(p, out, depth+1, maxDepth);
      }
    }catch(_){}
    return out;
  }
  const results = {};
  for(const r of roots) results[r] = await walk(r);
  return { ok:true, node: process.version, roots, pattern, results };
}

async function op_which(){
  const core = tryRequireCore();
  const hasCreate = !!(core && typeof core.createAssistant === 'function');
  return {
    ok: true,
    required: hasCreate ? ['createAssistant'] : [],
    hasCreate,
    error: hasCreate ? null : 'Fant ikke core eller createAssistant'
  };
}

async function op_knowledge(){
  const loadKnowledge = tryLoadKnowledgeFn();
  if(!loadKnowledge) return { ok:false, error:'Fant ikke loadData i noen kjente stier' };
  try{
    const data = loadKnowledge();
    const files = data?.files || [];
    const faqCount = data?.count?.faq ?? data?.faq?.length ?? 0;
    const sample = (data?.faq || []).slice(0,5).map(x => ({ id:x.id, q:x.q, src: x.source || x._src }));
    return { ok:true, files: files.length, faqCount, sample };
  }catch(e){
    return { ok:false, error: String(e?.message || e) };
  }
}

async function op_company(){
  const loadKnowledge = tryLoadKnowledgeFn();
  if(!loadKnowledge) return { ok:false, error:'Finner ikke loadKnowledge()' };
  try{
    const data = loadKnowledge();
    return {
      ok: true,
      hasCompany: !!data?.meta?.company,
      company: data?.meta?.company || null,
      services: data?.meta?.services || [],
      prices: data?.meta?.prices || {},
      delivery: data?.meta?.delivery || {},
      sources: (data?.files || []).length
    };
  }catch(e){
    return { ok:false, error: String(e?.message || e) };
  }
}

// ---- main multiplexer ----
module.exports = async (req, res) => {
  cors(req, res);
  if (ok204(req, res)) return;

  try{
    const fn = (req.query && req.query.fn) || 'env';
    let out;
    switch(fn){
      case 'env': out = await op_env(); break;
      case 'mode': out = await op_mode(); break;
      case 'ping': out = await op_ping(); break;
      case 'ls': out = await op_ls(req.query||{}); break;
      case 'which': out = await op_which(); break;
      case 'knowledge': out = await op_knowledge(); break;
      case 'company': out = await op_company(); break;
      default: out = { ok:false, error:`Ukjent fn=${fn}` };
    }
    res.status(200).json(out);
  }catch(err){
    res.status(500).json({ ok:false, error: String(err?.message || err) });
  }
};
