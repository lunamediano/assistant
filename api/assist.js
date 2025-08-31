// /api/assist.js
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
        " kr. Si gjerne hvor mye lagringsplass du trenger (f.eks. 32/64/128 GB).",
      source: "AI",
    };
  }
  if (/(fotoutskrift|print|fine\s*art|papir|ramme|rammer)/.test(m)) {
    return {
      answer:
        "Ja, vi tilbyr fotoutskrifter i fine-art-kvalitet og rammer. Oppgi ønsket størrelse og antall (f.eks. 30×40 cm, 5 stk), så gir vi pris og leveringstid.",
      source: "AI",
    };
  }
  return {
    answer:
      "Vi har et begrenset utvalg produkter for salg: USB/minnepenner, fotoutskrifter i fine-art-kvalitet og rammer. Fortell hva du ønsker (type, størrelse/kapasitet og antall), så hjelper jeg med pris og levering.",
    source: "AI",
  };
}

/* ========== S8/8 mm: diameter → minutter (anslag) ========== */
const S8_TABLE = [
  { cmMin: 7.0, cmMax: 8.0, s8Min: 4, d8Min: 4 },
  { cmMin: 12.0, cmMax: 13.3, s8Min: 12, d8Min: 16 },
  { cmMin: 14.0, cmMax: 15.0, s8Min: 18, d8Min: 22 },
  { cmMin: 16.5, cmMax: 17.5, s8Min: 24, d8Min: 32 },
];
function minutesFromDiameter(cm, isSuper8 = true) {
  for (const row of S8_TABLE) {
    if (cm >= row.cmMin && cm <= row.cmMax) {
      return isSuper8 ? row.s8Min : row.d8Min;
    }
  }
  // fallback grove anslag
  if (cm >= 11 && cm < 14) return isSuper8 ? 12 : 16;
  if (cm >= 14 && cm < 16) return isSuper8 ? 18 : 22;
  if (cm >= 16 && cm < 18.5) return isSuper8 ? 24 : 32;
  return isSuper8 ? 4 : 4;
}

/* ========== smalfilm pris/intent (8mm/S8 generisk) ========== */
function smalfilmDiscount(totalMinutes) {
  if (totalMinutes >= 360) return 0.2; // ≥ 6 t
  if (totalMinutes > 180) return 0.1; // > 3 t
  return 0;
}
function priceSmalfilm(minutter, ruller, prices, addUncertaintyLine = true) {
  const perMin = toNum(
    prices.smalfilm_min_rate ?? prices.smalfilm_per_minutt ?? 75
  );
  const startGeb = toNum(prices.smalfilm_start_per_rull ?? 95);
  const usbMin = toNum(prices.usb_min_price ?? prices.minnepenn ?? 295);

  if (minutter == null) {
    let txt =
      `Smalfilm prises med ca. ${perMin} kr per minutt + ${startGeb} kr i startgebyr per rull. ` +
      `Vi gir 10% rabatt over 3 timer og 20% rabatt over 6 timer. ` +
      `Oppgi antall minutter og ruller for et konkret prisestimat. USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
    if (addUncertaintyLine) {
      txt +=
        " Det vil alltid være noen usikre variabler i utregning av lengde på smalfilm dersom du ikke vet dette eksakt. " +
        "Betrakt derfor svaret som et estimat, og kontakt oss gjerne for et sikrere estimat og evt. pristilbud.";
    }
    return { answer: txt, source: "Pris" };
  }

  const mins = Math.max(0, toInt(minutter));
  const rolls = ruller != null ? Math.max(1, toInt(ruller)) : 1;

  const disc = smalfilmDiscount(mins);
  const total = round5(mins * perMin * (1 - disc) + rolls * startGeb);

  let out =
    `For ${mins} minutter smalfilm og ${rolls} ${rolls === 1 ? "rull" : "ruller"} ` +
    `er prisen ca ${nok(total)} kr.`;
  if (disc > 0)
    out += ` (Rabatt er inkludert: ${(disc * 100).toFixed(0)}% for ${(mins / 60).toFixed(
      1
    )} timer totalt.)`;
  out += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
  if (addUncertaintyLine) {
    out +=
      " Det vil alltid være litt usikkerhet ved anslag – ta dette som et estimat.";
  }
  return { answer: out, source: "Pris" };
}

/* ========== 16 mm pris (20-min blokker + lydtillegg) ========== */
function price16mm({ minutter, lyd }, prices) {
  // Grunnpris pr 20 min 16mm (uten lyd)
  const basePer20 = toNum(prices?.film16_base_20min ?? 1795); // inkl mva
  // Lyd-tillegg pr 20 min
  const magAddPer20 = toNum(prices?.film16_magnet_20min ?? 200);
  const optAddPer20 = toNum(prices?.film16_optisk_20min ?? 2990);

  if (minutter == null) {
    return {
      answer:
        "16 mm prises pr 20 minutters blokker. Uten lyd: ca " +
        nok(basePer20) +
        " per 20 min. Med **magnetisk** lyd: +" +
        nok(magAddPer20) +
        " per 20 min. Med **optisk** lyd: +" +
        nok(optAddPer20) +
        " per 20 min. Oppgi antall minutter (eller meter) pr rull og om lyden er optisk/magnetisk, så beregner jeg.",
      source: "Pris",
    };
  }

  const mins = Math.max(0, toInt(minutter));
  const blocks = Math.ceil(mins / 20);
  let add = 0;
  const m = (lyd || "").toLowerCase();
  if (/optisk/.test(m)) add = optAddPer20;
  else if (/magnet/.test(m)) add = magAddPer20;

  const total = round5(blocks * (basePer20 + add));
  return {
    answer:
      `For ca. ${mins} minutter 16 mm` +
      (add ? ` med ${/optisk/.test(m) ? "optisk" : "magnetisk"} lyd` : "") +
      ` blir prisen ca ${nok(total)} kr (beregnet i 20-min blokker).`,
    source: "Pris",
  };
}

/* ========== Video pris (VHS/Hi8/MiniDV…) ========== */
function priceVideo({ minutter }, prices) {
  const perTime = toNum(
    prices.vhs_per_time ?? prices.video_per_time ?? prices.vhs_per_time_kr ?? 315
  );
  const usbMin = toNum(prices.usb_min_price ?? prices.minnepenn ?? 295);

  if (minutter == null) {
    return {
      answer:
        `Video prises pr time digitalisert opptak (${perTime} kr/time). Oppgi total spilletid, så regner jeg pris. ` +
        `USB/minnepenn i tillegg (fra ${usbMin} kr).`,
      source: "Pris",
    };
  }
  const hrs = Math.max(0, toInt(minutter)) / 60;
  let disc = 0;
  if (hrs >= 20) disc = 0.2;
  else if (hrs >= 10) disc = 0.1;

  const total = round5(hrs * perTime * (1 - disc));
  let txt =
    `Video prises pr time (${perTime} kr/time). For ${hrs.toFixed(1)} timer blir prisen ca ${nok(
      total
    )} kr.`;
  if (disc > 0) txt += ` (Inkluderer ${(disc * 100).toFixed(0)}% rabatt.)`;
  txt += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
  return { answer: txt, source: "Pris" };
}

/* ========== parsere for intensjoner ========== */
function parseVideoIntent(text = "") {
  const m = text.toLowerCase();
  if (!/(vhs|videokassett|videobånd|hi8|video8|minidv|vhsc)/.test(m)) return null;
  const minutter = extractMinutes(m);
  return { minutter };
}

function parseS8Intent(text = "", history = []) {
  const m = text.toLowerCase();
  const s8hit = /(super\s*8|\bs8\b|8\s*mm)/.test(m);
  if (!s8hit) return null;

  const isSuper8 = /(super\s*8|\bs8\b)/.test(m);
  const diameters = extractDiameters(text);
  let ruller = extractRuller(text);

  // Dersom bruker bare sier "2 ruller S8" uten minutter/diameter: husk antall
  if (ruller == null) {
    // prøv fra tidligere
    for (let i = history.length - 1; i >= 0; i--) {
      const d = extractRuller(history[i]?.content || "");
      if (d != null) {
        ruller = d;
        break;
      }
    }
  }

  // Estimer minutter fra oppgitte diametre
  let minutter = null;
  if (diameters.length) {
    minutter = diameters
      .map((cm) => minutesFromDiameter(cm, isSuper8))
      .reduce((a, b) => a + b, 0);
  } else {
    // eksplisitt «4 timer» i tekst?
    minutter = extractMinutes(m);
  }

  return { isSuper8, diameters, ruller, minutter };
}

function parse16mmIntent(text = "", history = []) {
  const m = text.toLowerCase();
  if (!/16\s*mm/.test(m)) return null;
  const minutter = extractMinutes(m) ?? minutesFromUserHistory(history);
  let lyd = null;
  if (/optisk/.test(m)) lyd = "optisk";
  else if (/magnet/.test(m) || /magnetisk/.test(m)) lyd = "magnetisk";
  return { minutter, lyd };
}

/* ========== handler ========== */
export default async function handler(req, res) {
  const allowed = (process.env.LUNA_ALLOWED_ORIGINS || "*")
    .split(",")
    .map((s) => s.trim());
  const origin = req.headers.origin || "";
  if (allowed.includes("*") || allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let body = req.body || {};
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }
    const message = (body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    if (!message) return res.status(400).json({ error: "Missing message" });

    const { faq, prices } = loadData();

    /* 0) Fast intents som ikke skal drukne i pris */
    const repair = cassetteRepairIntent(message);
    if (repair) return res.status(200).json(repair);

    const delivery = deliveryIntent(message);
    if (delivery) return res.status(200).json(delivery);

    const sales = purchaseIntent(message, prices);
    if (sales) return res.status(200).json(sales);

    // Ber om én kategori om gangen hvis flere nevnes
    const cats = detectMediaCategories(message);
    if (cats.length >= 2) {
      return res.status(200).json(multiCategoryResponse(cats));
    }

    /* 1) FAQ */
    const kbHits = simpleSearch(message, faq);
    if (kbHits?.[0]?.a) {
      return res.status(200).json({ answer: kbHits[0].a, source: "FAQ" });
    }

    /* 2) Prisintents i prioritert rekkefølge */
    // 2a) 16 mm
    const mm16 = parse16mmIntent(message, history);
    if (mm16) {
      return res.status(200).json(price16mm(mm16, prices));
    }

    // 2b) Video
    const v = parseVideoIntent(message);
    if (v) {
      if (v.minutter == null) v.minutter = minutesFromUserHistory(history);
      return res.status(200).json(priceVideo(v, prices));
    }

    // 2c) S8 / 8 mm (smalfilm)
    const s8 = parseS8Intent(message, history);
    if (s8) {
      // Har vi minutter (fra diametre eller eksplisitt)?
      if (s8.minutter != null) {
        // Estimer rull-antall dersom ikke oppgitt men diametre finnes
        const r = s8.ruller ?? (s8.diameters.length ? s8.diameters.length : null);
        const resp = priceSmalfilm(s8.minutter, r, prices, true);
        // legg til veileder for flere ruller hvis ikke alle ble spesifisert
        if (!s8.diameters.length) {
          resp.answer +=
            " Hvis du ikke vet spilletiden: oppgi diametre per rull (7,5 / 12,7 / 14,5 / 17 cm) og om det er 8 mm eller Super 8.";
        }
        return res.status(200).json(resp);
      } else {
        // Veileder: be om diametre
        const guide = [
          "Kjempefint! For å anslå spilletid per rull: oppgi diametre på spolene og om det er 8 mm eller Super 8.",
          "Tommelverdier pr rull:",
          "• 7,5 cm → 8 mm: ca 4 min | Super 8: ca 4 min",
          "• 12–13 cm → 8 mm: ca 16 min | Super 8: ca 12 min",
          "• 14–15 cm → 8 mm: ca 22 min | Super 8: ca 18 min",
          "• 17–18 cm → 8 mm: ca 32 min | Super 8: ca 24 min",
          "Skriv f.eks.: «2 ruller, 12,7 cm og 14,5 cm (Super 8)».",
        ].join("\n");
        return res.status(200).json({ answer: guide, source: "AI" });
      }
    }

    /* 3) LLM fallback (med kort filming/booking-vakt i prompt) */
    const system = [
      'Du er "Luna" – en vennlig og presis AI-assistent for Luna Media (Vestfold).',
      "Svar kort på norsk. Bruk priseksempler og FAQ når relevant.",
      "Hvis noe er uklart: si det, og foreslå tilbud via e-post.",
      "Hvis kunden ber om filming/booking (arrangement): be om dato, sted, tidsrom, ønsket leveranse og e-post – og tilby menneskelig overtakelse.",
      "",
      "Priser (kan være tomt):",
      JSON.stringify(prices, null, 2),
    ].join("\n");

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const model = process.env.LUNA_MODEL || "gpt-4o-mini";

    let answer =
      "Beklager, jeg har ikke et godt svar på dette akkurat nå. Send oss gjerne e-post på kontakt@lunamedia.no eller ring 33 74 02 80.";

    if (!OPENAI_API_KEY) {
      return res.status(200).json({ answer, source: "fallback_no_key" });
    }

    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: 400,
          messages: [
            { role: "system", content: system },
            ...history,
            { role: "user", content: `Kunde spør: ${message}\nSvar på norsk, maks 2–3 setninger.` },
          ],
        }),
      });

      const text = await resp.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("OpenAI JSON parse error: " + text);
      }

      if (!resp.ok) {
        throw new Error(data?.error?.message || `OpenAI feilkode ${resp.status}`);
      }

      const content = data?.choices?.[0]?.message?.content?.trim();
      if (content) answer = content;

      return res.status(200).json({ answer, source: "AI" });
    } catch (e) {
      console.error("OpenAI-kall feilet:", e?.message);
      return res.status(200).json({ answer, source: "fallback_openai_error" });
    }
  } catch (err) {
    console.error("Handler-feil:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
