// api/data/loadData.js
// Laster og samler all kunnskap (FAQ, metadata) for assistenten.

const fs = require('fs');
const path = require('path');
const YAML = require('js-yaml');
const { KnowledgeDoc } = require('./schema');

const KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');

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
  // Bestemt lastrekkefølge — round1 først (generell), deretter temaer
  const orderedFiles = [
    'faq_round1.yml',
    'faq/video.yml',
    'faq/smalfilm.yml',
    'faq/foto.yml',
    'faq/pris.yml',
    'faq/spesial.yml'
  ].map(f => path.join(KNOWLEDGE_DIR, f));

  const allFaq = [];
  const byId = new Set();
  const byKey = new Set();
  const meta = {};
  const loadedFiles = [];

  for (const file of orderedFiles) {
    if (!fs.existsSync(file)) {
      console.warn(`[Knowledge] Fil mangler: ${file}`);
      continue;
    }

    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      console.warn('[Knowledge] Kunne ikke lese', fil
