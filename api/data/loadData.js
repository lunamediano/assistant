// api/data/loadData.js
const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const YAML = require('js-yaml');
const { KnowledgeDoc } = require('./schema');

const KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge'); // api/knowledge
//

function normalizeFaqItem(entry, file) {
  const q = entry.q || entry.question;
  const a = entry.a || entry.answer;
  const id = entry.id || `${path.basename(file)}:${(q || '').slice(0, 64)}`;
  return {
    id, q, a,
    alt: Array.isArray(entry.alt) ? entry.alt : [],
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    _src: file
  };
}

function mergeMeta(into, from, file) {
  if (!from) return;
  const company = from.firma || from.company;
  if (company) into.company = { ...(into.company || {}), ...company, _source: file };
  const services = from.tjenester || from.services;
  if (Array.isArray(services)) {
    into.services = [...(into.services || []), ...services.map(s => ({ ...s, _source: file }))];
  }
  const prices = from.priser || from.prices;
  if (prices && typeof prices === 'object') {
    into.prices = { ...(into.prices || {}), ...prices, _source: file };
  }
  const delivery = from.levering || from.delivery;
  if (delivery) into.delivery = { ...(into.delivery || {}), ...delivery, _source: file };
}

function loadKnowledge() {
  const patterns = [
    path.join(KNOWLEDGE_DIR, '**/*.y?(a)ml'),
    '!' + path.join(KNOWLEDGE_DIR, '**/_*.y?(a)ml'),
    '!' + path.join(KNOWLEDGE_DIR, '**/draft-*.y?(a)ml'),
  ];
  const files = fg.sync(patterns, { dot: false, onlyFiles: true }).sort();

  const allFaq = [];
  const byId = new Set();
  const byKey = new Set();
  const meta = {};

  for (const file of files) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      console.warn('[Knowledge] Kunne ikke lese', file, e.message);
      continue;
    }
    let doc;
    try {
      doc = YAML.load(raw, { filename: file }) || {};
    } catch (e) {
      console.warn('[Knowledge] YAML-feil i', file, e.message);
      continue;
    }

    const parsed = KnowledgeDoc.safeParse(doc);
    if (!parsed.success) {
      console.warn('[Knowledge] Skjemafeil i', file, parsed.error.issues);
      continue;
    }

    for (const entry of parsed.data.faq || []) {
      const item = normalizeFaqItem(entry, file);
      const key = (item.q || '').trim().toLowerCase();
      if (byId.has(item.id) || byKey.has(key)) continue;
      byId.add(item.id);
      byKey.add(key);
      allFaq.push(item);
    }

    mergeMeta(meta, parsed.data, file);
  }

  return { faq: allFaq, meta, faqIndex: { files }, count: { faq: allFaq.length } };
}

module.exports = { loadKnowledge };
