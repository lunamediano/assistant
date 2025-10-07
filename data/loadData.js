// api/data/loadData.js
// Laster og samler all kunnskap (FAQ + meta) for assistenten – robust mot mappestruktur.

const fs = require('fs');
const path = require('path');
const YAML = require('js-yaml');
const { KnowledgeDoc } = require('./schema');

// Prøv først root/knowledge (slik det har fungert hos deg), fall back til api/knowledge
function resolveKnowledgeBaseDir() {
  const candidates = [
    path.join(__dirname, '..', '..', 'knowledge'), // <repo>/knowledge  ✅ vanlig hos deg
    path.join(__dirname, '..', 'knowledge'),       // <repo>/api/knowledge (fallback)
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return dir;
    } catch {}
  }
  // Siste utvei: returner første kandidat (så logger vi senere at filer mangler)
  return candidates[0];
}

const KNOWLEDGE_DIR = resolveKnowledgeBaseDir();

// Fast lastrekkefølge – round1 først (generelle svar), så tema-filer
const ORDERED_FILES = [
  'faq_round1.yml',
  'faq/video.yml',
  'faq/smalfilm.yml',
  'faq/foto.yml',
  'faq/pris.yml',
  'faq/spesial.yml',
];

function normalizeFaqItem(entry, file) {
  const q = entry.q || entry.question;
  const a = entry.a || entry.answer;
  const id = entry.id || `${path.basename(file)}:${(q || '').slice(0, 64)}`;
  return {
    id,
    q,
    a,
    alt: Array.isArray(entry.alt) ? entry.alt : [],
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    _src: file,
  };
}

function mergeMeta(into, from, file) {
  if (!from) return;
  const company = from.firma || from.company;
  if (company) into.company = { ...(into.company || {}), ...company, _source: file };

  const services = from.tjenester || from.services;
  if (Array.isArray(services)) {
    into.services = [
      ...(into.services || []),
      ...services.map((s) => ({ ...s, _source: file })),
    ];
  }

  const prices = from.priser || from.prices;
  if (prices && typeof prices === 'object') {
    into.prices = { ...(into.prices || {}), ...prices, _source: file };
  }

  const delivery = from.levering || from.delivery;
  if (delivery) into.delivery = { ...(into.delivery || {}), ...delivery, _source: file };
}

function loadKnowledge() {
  const files = ORDERED_FILES.map((rel) => path.join(KNOWLEDGE_DIR, rel));

  const allFaq = [];
  const byId = new Set();
  const byKey = new Set();
  const meta = {};
  const loadedFiles = [];

  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.warn(`[Knowledge] Fil mangler: ${file}`);
      continue;
    }

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
      if (!item.q || !item.a) {
        console.warn('[Knowledge] Hopper over FAQ uten q/a i', file, item.id);
        continue;
      }
      if (byId.has(item.id) || byKey.has(key)) {
        // Behold første forekomst (round1 prioritet)
        continue;
      }
      byId.add(item.id);
      byKey.add(key);
      allFaq.push(item);
    }

    mergeMeta(meta, parsed.data, file);
    loadedFiles.push(file);
  }

  // Ikke kast – men logg tydelig hvis ingenting ble lastet
  if (loadedFiles.length === 0) {
    console.warn(`[Knowledge] Fant ingen kunnskapsfiler i ${KNOWLEDGE_DIR}. Sjekk mappestruktur.`);
  } else {
    console.log(`[Knowledge] Lastet ${allFaq.length} FAQ fra ${loadedFiles.length} filer.`);
  }

  return {
    faq: allFaq,
    meta,
    faqIndex: { files: loadedFiles },
    count: { faq: allFaq.length },
  };
}

module.exports = { loadKnowledge };
