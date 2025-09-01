// /api/assist.js
// Miljøvariabler som må settes i drift/dev:
// - RESEND_API_KEY=... (fra Resend → API Keys)
// - LUNA_FROM_EMAIL=kontakt@lunamedia.no
// - LUNA_FROM_NAME=Luna Media

import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ========== utils ========== */
function safeRead(file, kind = "text") {
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (kind === "json") return JSON.parse(raw);
    if (kind === "yaml") return yaml.load(raw);
    return raw;
  } catch {
    return null;
  }
}
const toInt = (v, d = 0) => {
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : d;
};
const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const nok = (n) => toNum(n, 0).toLocaleString("no-NO");
const round5 = (n) => Math.round(n / 5) * 5;

/* ========== Resend sender ========== */
async function sendViaResend({ to, subject, text, html }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    throw new Error("Mangler RESEND_API_KEY i miljøvariabler");
  }
  const fromEmail = process.env.LUNA_FROM_EMAIL || "kontakt@lunamedia.no";
  const fromName = process.env.LUNA_FROM_NAME || "Luna Media";
  const from = `${fromName} <${fromEmail}>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
      html, // kan utelates; Resend støtter text-only
      reply_to: fromEmail,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    const msg = data?.message || data?.error || JSON.stringify(data);
    throw new Error(`Resend-feil: ${msg}`);
  }
  return data; // { id, ... }
}

/* ========== data loader ========== */
function loadData() {
  const faqCandidates = [
    path.join(__dirname, "..", "data", "faq.yaml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yaml"),
    path.join(__dirname, "..", "knowledge", "luna.yml"),
  ];

  let faq = [];
  let prices = {};
  for (const p of faqCandidates) {
    if (!fs.existsSync(p)) continue;
    const parsed = safeRead(p, "yaml");
    if (!parsed) continue;

    if (p.endsWith("luna.yml")) {
      const fromLunaFaq = Array.isArray(parsed?.faq)
        ? parsed.faq
        : Array.isArray(parsed?.knowledge?.faq)
        ? parsed.knowledge.faq
        : [];
      if (fromLunaFaq?.length) faq = faq.concat(fromLunaFaq);

      const fromLunaPrices =
        parsed?.priser || parsed?.prices || parsed?.company?.prices;
      if (fromLunaPrices && typeof fromLunaPrices === "object") {
        prices = { ...prices, ...fromLunaPrices };
      }
    } else {
      const items = Array.isArray(parsed) ? parsed : parsed?.faq || [];
      if (items?.length) faq = faq.concat(items);
    }
  }

  const priceJson = safeRead(
    path.join(__dirname, "..", "data", "priser.json"),
    "json"
  );
  if (priceJson && typeof priceJson === "object") {
    prices = { ...prices, ...priceJson };
  }
  return { faq, prices };
}

/* ========== simple FAQ search ========== */
function normalize(s = "") {
  return (s + "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function jaccard(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return inter / uni;
}
function simpleSearch(userMessage, faqArray, minScore = 0.65) {
  const qTokens = normalize(userMessage).split(" ");
  let best = null;
  for (const item of faqArray || []) {
    const candidates = [item.q, ...(item.alt || [])]
      .map(normalize)
      .filter(Boolean);
    let bestLocal = 0;
    for (const cand of candidates) {
      const score = jaccard(qTokens, cand.split(" "));
      if (score > bestLocal) bestLocal = score;
    }
    if (!best || bestLocal > best.score) best = { item, score: bestLocal };
  }
  if (best && best.score >= minScore) {
    return [{ a: best.item.a, score: best.score, q: best.item.q }];
  }
  return [];
}

/* ========== number words (no) ========== */
const NO_WORDNUM = {
  null: 0,
  en: 1,
  ett: 1,
  ei: 1,
  to: 2,
  tre: 3,
  fire: 4,
  fem: 5,
  seks: 6,
  sju: 7,
  syv: 7,
  åtte: 8,
  ni: 9,
  ti: 10,
  elleve: 11,
  tolv: 12,
  tretten: 13,
  fjorten: 14,
  femten: 15,
  seksten: 16,
  sytten: 17,
  atten: 18,
  nitten: 19,
  tjue: 20,
};
function wordToNum(w) {
  const k = (w || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-zæøå]/g, "");
  return Object.prototype.hasOwnProperty.call(NO_WORDNUM, k)
    ? NO_WORDNUM[k]
    : null;
}

/* ========== text extractors ========== */
function extractMinutes(text = "") {
  const m = (text || "").toLowerCase();
  const mm = m.match(/(\d{1,4})\s*(min|minutt|minutter)\b/);
  const hh = m.match(/(\d{1,3})\s*(t|time|timer)\b/);
  if (mm) return toInt(mm[1]);
  if (hh) return toInt(hh[1]) * 60;
  const wm = m.match(/([a-zæøå]+)\s*(min|minutt|minutter)\b/);
  const wh = m.match(/([a-zæøå]+)\s*(t|time|timer)\b/);
  if (wm) {
    const n = wordToNum(wm[1]);
    if (n != null) return n;
  }
  if (wh) {
    const n = wordToNum(wh[1]);
    if (n != null) return n * 60;
  }
  return null;
}
function extractCount(text = "", tokenRegex) {
  const m = (text || "").toLowerCase();
  const d = m.match(new RegExp(`(\\d{1,3})\\s*${tokenRegex}`));
  if (d) return toInt(d[1]);
  const w = m.match(new RegExp(`([a-zæøå]+)\\s*${tokenRegex}`));
  if (w) {
    const n = wordToNum(w[1]);
    if (n != null) return n;
  }
  return null;
}
function extractRuller(text = "") {
  return extractCount(text, "(rull|ruller)\\b");
}
function extractDiameters(text = "") {
  // Finn flere cm-verdier i en setning: "12 cm, 14 cm og 17 cm"
  const arr = [];
  const re = /(\d{1,2}(?:[.,]\d)?)\s*cm\b/gi;
  let m;
  while ((m = re.exec(text))) {
    arr.push(Number(String(m[1]).replace(",", ".")));
  }
  return arr;
}
function minutesFromUserHistory(history = []) {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h?.role !== "user") continue;
    const n = extractMinutes(h?.content || "");
    if (n != null) return n;
  }
  return null;
}

/* ========== category detector (for «én om gangen») ========== */
function detectMediaCategories(msg = "") {
  const m = msg.toLowerCase();
  const video = /(vhs|videokassett|videobånd|hi8|video8|minidv|vhsc)/.test(m);
  const s8 = /(super\s*8|\bs8\b|8\s*mm)/.test(m);
  const mm16 = /16\s*mm/.test(m);
  const picked = [];
  if (video) picked.push("video");
  if (s8) picked.push("s8");
  if (mm16) picked.push("16mm");
  return picked;
}
function multiCategoryResponse(picked) {
  const bullet = {
    video:
      "- Video: oppgi samlet spilletid (timer/minutter) eller antall kassetter.",
    s8: "- S8/8 mm: oppgi diametre per rull (7,5 / 12,7 / 14,5 / 17 cm) og om det er 8 mm eller Super 8.",
    "16mm":
      "- 16 mm: oppgi minutter (eller meter) per rull og om lyden er optisk eller magnetisk.",
  };
  const list = picked.map((k) => bullet[k]).join("\n");
  return {
    answer:
      "For at jeg skal gi et presist estimat, ta gjerne én type om gangen. Velg hva du vil starte med og send detaljene:\n" +
      list +
      "\n\nEksempel: «S8: 2 ruller, 12,7 cm og 14,5 cm (Super 8)» eller «Video: 7,5 timer» eller «16 mm: 3 ruller, 24 min, optisk lyd».",
    source: "AI",
  };
}

/* ========== delivery / repair / purchase intents ========== */
function deliveryIntent(msg = "") {
  const m = msg.toLowerCase();
  if (!/(levere|levering|hente|henting|post|adresse|send(e)?|innlevering)/.test(m))
    return null;

  // «hente i drammen» / «kan dere hente»
  if (/(kan.*hente|hente.*hos|hente.*drammen|hjemmehenting)/.test(m)) {
    return {
      answer:
        "Det kan være at vi kan hente materialet hjemme hos deg – ta kontakt, så finner vi en løsning.",
      source: "AI",
    };
  }

  const text = [
    "Du kan sende pakken med Norgespakke med sporing til:",
    "Luna Media, Pb. 60, 3107 Sem (bruk mottakers mobil 997 05 630).",
    "",
    "Du kan også levere direkte:",
    "- Sem Senteret (2. etg.), Andebuveien 3, 3170 Sem",
    "- Desk på Bislett i Oslo (Sofies gate 66A) – etter avtale",
    "",
    "Ring 33 74 02 80 eller skriv til kontakt@lunamedia.no for å avtale levering/henting.",
  ].join("\n");
  return { answer: text, source: "AI" };
}

function cassetteRepairIntent(msg = "") {
  const m = msg.toLowerCase();
  if (!/(reparer|fiks|fix|ødelagt|knekt).*(kassett|bånd|videokassett|vhs|minidv|hi8|video8)/.test(m))
    return null;
  return {
    answer:
      "Ja, vi reparerer kassetter (VHS, MiniDV, Hi8/Video8 m.fl.). Beskriv skaden (knekt bånd, husskade osv.), så sier vi hvordan vi løser det og gir prisoverslag.",
    source: "AI",
  };
}

function looksLikePurchase(msg = "") {
  const m = msg.toLowerCase();
  return /(kjøp|kjøpe|selger|minnepenn|usb|ramme|rammer|fotoutskrift|fine\s*art|tomme\s*video|blank\s*kassett)/.test(
    m
  );
}
function purchaseIntent(msg = "", prices = {}) {
  if (!looksLikePurchase(msg)) return null;
  const m = msg.toLowerCase();
  const usbMin = Number(prices?.usb_min_price ?? prices?.minnepenn ?? 295);

  if (/(tom|blank).*(kassett|vhs)/.test(m)) {
    return {
      answer:
        "Vi selger ikke tomme video-/VHS-kassetter. Vi digitaliserer derimot eksisterende opptak. Til lagring selger vi USB/minnepenner i flere størrelser (fra ca. " +
        usbMin +
        " kr). Vi tilbyr også fotoutskrifter i fine-art-kvalitet og rammer.",
      source: "AI",
    };
  }
  if (/(usb|minnepenn|minnepenner|memory stick)/.test(m)) {
    return {
      answer:
        "Ja, vi selger USB/minnepenner i flere størrelser (god kvalitet). Pris fra ca. " +
        usbMin +
        " kr. Si gjerne hv
