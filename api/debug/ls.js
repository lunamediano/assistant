// api/debug/ls.js
const fs = require('fs');
const path = require('path');

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

async function walk(root, { maxDepth = 4, pattern = null }, out = [], depth = 0) {
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(root, e.name);
      const rel = p.replace('/var/task', '');
      if (!pattern || rel.toLowerCase().includes(pattern)) out.push(rel || '/');
      if (e.isDirectory() && depth < maxDepth) await walk(p, { maxDepth, pattern }, out, depth + 1);
    }
  } catch (_) { /* ignore */ }
  return out;
}

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  module.exports.config = {
  runtime: 'nodejs20.x',
  includeFiles: ['api/core/**','api/data/**','api/knowledge/**'],
};

  const pattern = String((req.query && req.query.pattern) || '').toLowerCase() || null;
  const roots = ['/var/task', '/var/task/api', '/var/task/core', path.dirname(__dirname)];
  const results = {};
  // list a few roots
  for (const r of roots) results[r] = await walk(r, { maxDepth: 6, pattern });

  res.status(200).json({
    ok: true,
    node: process.version,
    cwd: process.cwd(),
    roots,
    pattern,
    results
  });
};
