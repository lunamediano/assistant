const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const YAML = require('js-yaml');
const { KnowledgeDoc } = require('./schema');

function normalizeFaqItem(entry, file) {
  const q = entry.q || entry.question;
  const a = entry.a || entry.answer;
  const id = entry.id || `${path.basename(file)}:${(q || '').slice(0, 64)}`;
  return {
    id,
    q,
    a,
    alt: Array.isArray(entry.alt) ? entry.alt : [],
    tags: Array.isArray(entry.tags) ? entry.tags : []
  };
}

function loadKnowledge() {
  const baseDir = path.join(__dirname, '..', 'knowledge');
  const patterns = [
    path.join(baseDir, '**/*.y?(a)ml'),
    '!' + path.join(baseDir, '**/_*.y?(a)ml'),
    '!' + path.join(baseDir, '**/draft-*.y?(a)ml')
  ];
  const files = fg.sync(patterns, { dot: false, onlyFiles: true });

  files.sort((a, b) => a.localeCompare(b, 'en')); // stabil

  const allFaq = [];
  const byId = new Map();
  const byKey = new Set();

  for (const file of files) {
    let raw = '';
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      console.warn(`[Knowledge] Kunne ikke lese ${file}:`, e.message);
      continue;
    }

    let doc;
    try {
      doc = YAML.load(raw, { filename: file }) || {};
    } catch (e) {
      console.warn(`[Knowledge] YAML-feil i ${file}:`, e.message);
      continue;
    }

    const parsed = KnowledgeDoc.safeParse(doc);
    if (!parsed.success) {
      console.warn(`[Knowledge] Skjemafeil i ${file}:`, parsed.error.issues);
      continue;
    }

    for (const entry of parsed.data.faq) {
      const item = normalizeFaqItem(entry, file);
      const key = `${item.q}`.trim().toLowerCase();
      if (byId.has(item.id) || byKey.has(key)) {
        continue; // duplikat
      }
      byId.set(item.id, true);
      byKey.add(key);
      allFaq.push({ ...item, source: file });
    }
  }

  return {
    faq: allFaq,
    count: { faq: allFaq.length },
    files
  };
}

module.exports = { loadKnowledge };
