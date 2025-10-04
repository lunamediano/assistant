// api/debug.js
const fs = require('fs');
const path = require('path');

const BASE_ALLOWED_ORIGINS = [
  'https://lunamedia.vercel.app',
  'https://lunamedia-git-main-lunamedia.vercel.app',
  'https://h05693dfe8-staging.onrocket.site',
  'https://lunamedia.no',
];

function buildAllowedOrigins() {
  const extra = (process.env.LUNA_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return Array.from(new Set([...BASE_ALLOWED_ORIGINS, ...extra]));
}

function applyCors(req, res) {
  const allowedOrigins = buildAllowedOrigins();
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function handleOptions(req, res) {
  if ((req.method || '').toUpperCase() === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

function resolveCoreModule() {
  const guesses = [
    path.join(__dirname, '..', 'core'),
    path.join(process.cwd(), 'core'),
    '/var/task/core',
  ];
  for (const candidate of guesses) {
    try {
      const mod = require(candidate);
      if (mod && typeof mod.createAssistant === 'function') {
        return mod;
      }
    } catch (_) {}
  }
  return null;
}

function resolveLoadKnowledge() {
  const guesses = [
    path.join(__dirname, '..', 'data', 'loadData.js'),
    path.join(process.cwd(), 'data', 'loadData.js'),
    '/var/task/data/loadData.js',
  ];
  for (const candidate of guesses) {
    try {
      const mod = require(candidate);
      if (mod && typeof mod.loadKnowledge === 'function') {
        return mod.loadKnowledge;
      }
    } catch (_) {}
  }
  return null;
}

async function opEnv() {
  return {
    node: process.version,
    ASSISTANT_MODE: process.env.ASSISTANT_MODE || 'unset',
    USE_MODULAR_ASSISTANT: process.env.USE_MODULAR_ASSISTANT || 'unset',
    DEBUG_ASSISTANT: process.env.DEBUG_ASSISTANT || 'unset',
    VERCEL_ENV: process.env.VERCEL_ENV || 'unset',
  };
}

async function opMode() {
  const mode = (process.env.ASSISTANT_MODE || '').toLowerCase();
  const flag = (process.env.USE_MODULAR_ASSISTANT || '').toLowerCase();
  const useModular = mode === 'modular' || flag === '1' || flag === 'true';
  return {
    computed: { useModular },
    env: { ASSISTANT_MODE: mode || 'unset', USE_MODULAR_ASSISTANT: flag || 'unset' },
  };
}

async function opWhich() {
  const core = resolveCoreModule();
  return {
    ok: !!core,
    hasCreateAssistant: !!(core && typeof core.createAssistant === 'function'),
  };
}

async function opKnowledge() {
  const loadKnowledge = resolveLoadKnowledge();
  if (!loadKnowledge) {
    return { ok: false, error: 'Fant ikke loadKnowledge() i data/loadData.js' };
  }
  try {
    const data = loadKnowledge();
    const faq = Array.isArray(data?.faq) ? data.faq : [];
    const sample = faq.slice(0, 5).map((item) => ({
      id: item.id,
      q: item.q,
      source: item._src,
    }));
    return {
      ok: true,
      files: Array.isArray(data?.faqIndex?.files) ? data.faqIndex.files.length : 0,
      faqCount: faq.length,
      sample,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

async function opCompany() {
  const loadKnowledge = resolveLoadKnowledge();
  if (!loadKnowledge) {
    return { ok: false, error: 'Fant ikke loadKnowledge()' };
  }
  try {
    const data = loadKnowledge();
    return {
      ok: true,
      hasCompany: !!(data && data.meta && data.meta.company),
      company: data?.meta?.company || null,
      services: data?.meta?.services || [],
      prices: data?.meta?.prices || {},
      delivery: data?.meta?.delivery || {},
      sources: Array.isArray(data?.faqIndex?.files) ? data.faqIndex.files.length : 0,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

async function opLs(query) {
  const roots = ['/var/task', '/var/task/core', '/var/task/data', '/var/task/knowledge', '/var/task/api'];
  const pattern = String((query && query.pattern) || '').toLowerCase() || null;

  async function walk(root, out = [], depth = 0, maxDepth = 5) {
    try {
      const entries = await fs.promises.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(root, entry.name);
        const rel = full.replace('/var/task', '') || '/';
        if (!pattern || rel.toLowerCase().includes(pattern)) {
          out.push(rel);
        }
        if (entry.isDirectory() && depth < maxDepth) {
          await walk(full, out, depth + 1, maxDepth);
        }
      }
    } catch (_) {}
    return out;
  }

  const results = {};
  for (const root of roots) {
    results[root] = await walk(root);
  }
  return { ok: true, pattern, results };
}

const OPS = {
  env: opEnv,
  mode: opMode,
  which: opWhich,
  knowledge: opKnowledge,
  company: opCompany,
  ls: opLs,
};

module.exports = async (req, res) => {
  applyCors(req, res);
  if (handleOptions(req, res)) return;

  try {
    const fn = String((req.query && req.query.fn) || 'env');
    const handler = OPS[fn];
    if (!handler) {
      res.status(400).json({ ok: false, error: `Ukjent fn=${fn}` });
      return;
    }
    const result = await handler(req.query || {});
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
};
