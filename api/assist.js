// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* =============== Utils =============== */
function safeRead(file, kind = "text") {
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (kind === "json") return JSON.parse(raw);
    if (kind === "yaml") return yaml.load(raw);
    return raw;
  } catch { return null; }
}
const toInt = (v, d = 0) => {
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : d;
};
const toNum = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
const nok   = (n) => toNum(n, 0).toLocaleString("no-NO");
const round5= (n) => Math.round(n / 5) * 5;

function mentionsAny(msg = "", words = []) {
  const m = (msg || "").toLowerCase();
  return words.some(w => m.includes(w));
}
function hasAnyWord(m = "", words = []) {
  const s = (m || "").toLowerCase();
  return words.some(w => s.includes(w));
}

// --- smalfilm-kontekst og lengde-ord ---
function smalfilmInText(s=""){
  const m = (s||"").toLowerCase();
  return /(smalfilm|super\s*8|super8|8\s*mm|8mm|16\s*mm|16mm)/.test(m);
}
function hasLengthWords(s=""){
  const m = (s||"").toLowerCase();
  return /(lengde|hvor.*(lang|mye).*(film|minutt)|minutt|beregn|anslå|estim)/.test(m);
}
function inSmalfilmContext(history=[]){
  // se på siste 6 brukermeldinger
  let hits = 0;
  for (let i = history.length - 1; i >= 0 && hits < 2; i--){
    const h = history[i];
    if (h?.role !== "user") continue;
    if (smalfilmInText(h?.content||"")) { hits++; if (hits>=1) break; }
  }
  return hits > 0;
}


/* =============== Load data =============== */
function loadData() {
  const faqCandidates = [
    path.join(__dirname, "..", "data", "faq.yaml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yaml"),
    path.join(__dirname, "..", "knowledge", "luna.yml"),
  ];
  let faq = []; let prices = {};
  for (const p of faqCandidates) {
    const exists = fs.existsSync(p);
    if (!exists) continue;
    const parsed = safeRead(p, "yaml"); if (!parsed) continue;

    if (p.endsWith("luna.yml")) {
      const fromLunaFaq =
        Array.isArray(parsed?.faq) ? parsed.faq :
        Array.isArray(parsed?.knowledge?.faq) ? parsed.knowledge.faq : [];
      if (fromLunaFaq?.length) faq = faq.concat(fromLunaFaq);

      const fromLunaPrices = parsed?.priser || parsed?.prices || parsed?.company?.prices;
      if (fromLunaPrices && typeof fromLunaPrices === "object")
        prices = { ...prices, ...fromLunaPrices };
    } else {
      const items = Array.isArray(parsed) ? parsed : (parsed?.faq || []);
      if (items?.length) faq = faq.concat(items);
    }
  }
  const priceJson = safeRead(path.join(__dirname, "..", "data", "priser.json"), "json");
  if (priceJson && typeof priceJson === "object") {
    prices = { ...prices, ...priceJson };
  }
  return { faq, prices };
}

/* =============== FAQ-søk (enkel fuzzy) =============== */
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
  const inter = [...a].filter(x => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return inter / uni;
}
function simpleSearch(userMessage, faqArray, minScore = 0.65) {
  const qNorm   = normalize(userMessage);
  const qTokens = qNorm.split(" ");
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
    if (!best || bestLocal > best.score) {
      best = { item, score: bestLocal };
    }
  }
  if (best && best.score >= minScore) {
    return [{ a: best.item.a, score: best.score, q: best.item.q }];
  }
  return [];
}

/* =============== NO: tallord -> tall =============== */
const NO_WORDNUM = {
  "null":0,"en":1,"ett":1,"ei":1,"to":2,"tre":3,"fire":4,"fem":5,"seks":6,"sju":7,"syv":7,
  "åtte":8,"ni":9,"ti":10,"elleve":11,"tolv":12,"tretten":13,"fjorten":14,"femten":15,
  "seksten":16,"sytten":17,"atten":18,"nitten":19,"tjue":20
};
function wordToNum(w) {
  const k = (w || "").toLowerCase().normalize("NFKD").replace(/[^a-zæøå]/g, "");
  return Object.prototype.hasOwnProperty.call(NO_WORDNUM, k) ? NO_WORDNUM[k] : null;
}

/* =============== Ekstraksjon (minutter, ruller, osv.) =============== */
function extractMinutes(text = "") {
  const m = (text || "").toLowerCase();
  const mm = m.match(/(\d{1,4})\s*(min|minutt|minutter)\b/);
  const hh = m.match(/(\d{1,3})\s*(t|time|timer)\b/);
  if (mm) return toInt(mm[1]);
  if (hh) return toInt(hh[1]) * 60;
  const wm = m.match(/([a-zæøå]+)\s*(min|minutt|minutter)\b/);
  const wh = m.match(/([a-zæøå]+)\s*(t|time|timer)\b/);
  if (wm){ const n = wordToNum(wm[1]); if (n != null) return n; }
  if (wh){ const n = wordToNum(wh[1]); if (n != null) return n * 60; }
  return null;
}
function extractRuller(text = "") {
  const m = (text || "").toLowerCase();
  const rd = m.match(/(\d{1,3})\s*(rull|ruller)\b/);
  if (rd) return toInt(rd[1]);
  const rw = m.match(/([a-zæøå]+)\s*(rull|ruller)\b/);
  if (rw){ const n = wordToNum(rw[1]); if (n != null) return n; }
  return null;
}

/* =============== Smalfilm-intent =============== */
function parseSmalfilmLoose(text = "") {
  const m = (text || "").toLowerCase();
  const hasFilm = /(smalfilm|super\s*8|super8|8\s*mm|8mm|16\s*mm|16mm)/.test(m);
  const mentionsRullOnly = /(rull|ruller)/.test(m);
  const minutter = extractMinutes(m);
  const ruller   = extractRuller(m);
  return { hasFilm, mentionsRullOnly, minutter, ruller };
}
function historySmalfilm(history = []) {
  let ctx = { hasFilm:false, minutter:null, ruller:null };
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h?.role !== "user") continue;
    const t = (h.content || "").toLowerCase();
    const hasFilm = /(smalfilm|super\s*8|super8|8\s*mm|8mm|16\s*mm|16mm)/.test(t);
    const min = extractMinutes(t);
    const rul = extractRuller(t);
    if (hasFilm) ctx.hasFilm = true;
    if (min != null && ctx.minutter == null) ctx.minutter = min;
    if (rul != null && ctx.ruller   == null) ctx.ruller   = rul;
    if (ctx.hasFilm && ctx.minutter != null && ctx.ruller != null) break;
  }
  return ctx;
}
function minutesFromUserHistory(history = []) {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i]; if (h?.role !== "user") continue;
    const n = extractMinutes(h?.content || "");
    if (n != null) return n;
  }
  return null;
}

/* =============== Spole/diameter -> minutter (anslag) =============== */
// tabell i minutter (avrundet) for 8mm / Super8
const SPOOL_TABLE = [
  { d: 7.5,  m: 15, min8: 4,  minS8: 4  },
  { d: 12.7, m: 60, min8: 16, minS8: 12 },
  { d: 13.0, m: 60, min8: 16, minS8: 12 }, // toleranse-variant
  { d: 14.5, m: 90, min8: 22, minS8: 18 },
  { d: 15.0, m: 90, min8: 22, minS8: 18 }, // toleranse-variant
  { d: 17.0, m:120, min8: 32, minS8: 24 },
  { d: 18.0, m:120, min8: 32, minS8: 24 }
];
function estFromDiameter(diamCm, type = null) {
  // finn nærmeste diameter i tabellen
  let best = null, bestDiff = Infinity;
  for (const row of SPOOL_TABLE) {
    const diff = Math.abs((row.d || 0) - diamCm);
    if (diff < bestDiff) { bestDiff = diff; best = row; }
  }
  if (!best) return null;
  const min8  = best.min8;
  const minS8 = best.minS8;
  if (type === "8mm")   return { minutes: min8,  label: "8mm" };
  if (type === "super8")return { minutes: minS8, label: "Super 8" };
  // ukjent type → gi begge
  return { rangeText: `ca. ${min8} min (8mm) eller ca. ${minS8} min (Super 8)` };
}
function estFromMeters(meters, type = null) {
  // map 15/60/90/120 m (runde til nærmeste kjente)
  const candidates = SPOOL_TABLE.map(x => x.m);
  let best = null, bestDiff = Infinity, row = null;
  for (const m of candidates) {
    const diff = Math.abs(meters - m);
    if (diff < bestDiff) { bestDiff = diff; best = m; }
  }
  row = SPOOL_TABLE.find(x => x.m === best);
  if (!row) return null;
  if (type === "8mm")   return { minutes: row.min8,  label: "8mm" };
  if (type === "super8")return { minutes: row.minS8, label: "Super 8" };
  return { rangeText: `ca. ${row.min8} min (8mm) eller ca. ${row.minS8} min (Super 8)` };
}
// Oppdag “spole/diameter/meter” ELLER tidligere smalfilm-prat + lengdespørsmål
function handleSmalfilmLengthIntent(message, history){
  const m = (message || "").toLowerCase();

  const mentionsFilm = smalfilmInText(m) || inSmalfilmContext(history);
  const mentionsLen  = hasLengthWords(m) || /(spol|diameter|cm|meter|m)\b/.test(m);
  if (!mentionsFilm || !mentionsLen) return null;

  // Eksplisitte tall?
  const cmMatch = m.match(/(\d{1,2}(?:[.,]\d)?)\s*cm/);
  const mMatch  = m.match(/(\d{1,3})\s*(?:m|meter)\b/);
  const isS8    = /(super\s*8|super8)/.test(m);
  const is8     = /(8\s*mm|8mm)/.test(m) && !isS8;

  // Har vi konkrete mål? → beregn
  if (cmMatch || mMatch){
    let est;
    if (cmMatch){
      const d = parseFloat(cmMatch[1].replace(",", "."));
      est = estFromDiameter(d, isS8 ? "super8" : (is8 ? "8mm" : null));
    } else {
      const meters = toInt(mMatch[1]);
      est = estFromMeters(meters, isS8 ? "super8" : (is8 ? "8mm" : null));
    }
    if (!est) return null;

    if (est.minutes){
      return {
        answer: `Det tilsvarer omtrent ${est.minutes} minutter ${est.label}. Oppgi gjerne hvor mange slike spoler du har, så kan jeg anslå total spilletid og pris.`,
        source: "Info"
      };
    }
    return {
      answer: `Det tilsvarer ${est.rangeText}. Si gjerne om det er 8mm eller Super 8 – og hvor mange spoler – så regner jeg total tid og pris.`,
      source: "Info"
    };
  }

  // Ingen cm/meter oppgitt → gi tydelig veiledning
  const ask = [
    "Jeg kan hjelpe deg å anslå spilletid per spole.",
    "Fortell enten **diameteren på spolen** (for eksempel 7,5 cm / 12,7 cm / 14,5 cm / 17 cm) eller **omtrent hvor mange meter** film som står på.",
    "Si også om det er **8mm** eller **Super 8** (hvis du vet det). Eksempel: «12,7 cm, Super 8, 16 spoler».",
  ].join("\n");
  return { answer: ask, source: "Info" };
}


/* =============== Prisregler =============== */
// Smalfilm rabatt
function smalfilmDiscount(totalMinutes) {
  if (totalMinutes >= 360) return 0.20;   // ≥ 6 t
  if (totalMinutes >= 180) return 0.10;   // ≥ 3 t
  return 0;
}
// Smalfilm 8/16 basispriser + tillegg
function priceSmalfilm(minutter, ruller, prices, type = "super8", lyd = "ingen") {
  // Super 8 / 8mm standard
  let per20   = toNum(prices.s8_per_20min, 1500); // fallbacks
  let perMin  = per20 / 20;
  let startGeb= toNum(prices.smalfilm_start_per_rull, 95);
  let usbMin  = toNum(prices.usb_min_price ?? prices.minnepenn, 295);

  // 16mm – spesialpriser
  if (type === "16mm") {
    const per20_16_optisk   = toNum(prices.mm16_optisk_per_20min, 2990);
    const per20_16_magnetisk= toNum(prices.mm16_magnetisk_per_20min, 1795);
    const per20_16_silent   = toNum(prices.mm16_silent_per_20min, 1795);
    const start_16          = toNum(prices.mm16_start_per_rull, 125);

    if (lyd === "optisk") per20 = per20_16_optisk;
    else if (lyd === "magnetisk") per20 = per20_16_magnetisk;
    else per20 = per20_16_silent;

    perMin   = per20 / 20;
    startGeb = start_16;
  } else {
    // Super 8 lydtillegg pr 20 min
    const s8_lydtillegg_per_20 = toNum(prices.s8_lydtillegg_per_20, 100);
    if (lyd === "magnetisk") {
      per20 += s8_lydtillegg_per_20;
      perMin = per20 / 20;
    }
  }

  const disclaimer =
    "Det vil alltid være noen usikre variabler i utregning av lengde på smalfilm (dersom du ikke vet dette eksakt). " +
    "Betrakt derfor svaret som et estimat, og kontakt oss gjerne på telefon eller e-post for et sikrere estimat og eventuelt pristilbud.";

  if (minutter == null) {
    const txt = [
      `Smalfilm prises med ca. ${Math.round(perMin)} kr per minutt + ${startGeb} kr i startgebyr per rull.`,
      `Vi gir 10% rabatt når samlet spilletid er over 3 timer, og 20% rabatt over 6 timer.`,
      `Oppgi antall minutter og ruller for et konkret prisestimat. USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`,
      "",
      disclaimer
    ].join(" ");
    return { answer: txt, source: "Pris" };
  }

  const mins  = Math.max(0, toInt(minutter));
  const rolls = ruller != null ? Math.max(1, toInt(ruller)) : 1;

  const disc   = smalfilmDiscount(mins);
  const arbeid = mins * perMin * (1 - disc);
  const start  = rolls * startGeb;
  const total  = round5(arbeid + start);

  let out = `For ${mins} minutter smalfilm og ${rolls} ${rolls===1?"rull":"ruller"} er prisen ca ${nok(total)} kr.`;
  if (disc>0) out += ` (Rabatt er inkludert: ${(disc*100).toFixed(0)}% for ${(mins/60).toFixed(1)} timer totalt.)`;
  out += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
  out += `\n\n${disclaimer}`;

  return { answer: out, source: "Pris" };
}

/* VHS/Video */
function parseVideoIntent(text = "") {
  const m = (text || "").toLowerCase();
  if (!/(vhs|videokassett|videobånd|hi8|video8|minidv|vhsc)/.test(m)) return null;
  const minutter = extractMinutes(m);
  const kMatch   = m.match(/(\d{1,3})\s*(kassett|kassetter|bånd|videobånd)\b/);
  const kassetter= kMatch ? toInt(kMatch[1]) : null;
  return { minutter, kassetter };
}
function priceVideo({ minutter, kassetter }, prices) {
  const perTime = toNum(
    prices.vhs_per_time ?? prices.video_per_time ?? prices.vhs_per_time_kr, 315
  );
  const usbMin  = toNum(prices.usb_min_price ?? prices.minnepenn, 295);

  if (minutter != null) {
    const min = Math.max(0, toInt(minutter));
    const hrs = min / 60;
    let disc = 0;
    if (hrs >= 20) disc = 0.20;
    else if (hrs >= 10) disc = 0.10;
    const total = round5(hrs * perTime * (1 - disc));
    let txt = `Video prises pr time digitalisert opptak (${perTime} kr/time). For ${hrs.toFixed(1)} timer blir prisen ca ${nok(total)} kr.`;
    if (disc>0) txt += ` (Inkluderer ${(disc*100).toFixed(0)}% rabatt.)`;
    txt += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
    return { answer: txt, source: "Pris" };
  }

  if (kassetter != null) {
    const k = Math.max(1, toInt(kassetter));
    const lowH = k * 1.0, highH = k * 2.0; // 60–120 min pr kassett
    const lowDisc  = lowH  >= 20 ? 0.20 : (lowH  >= 10 ? 0.10 : 0);
    const highDisc = highH >= 20 ? 0.20 : (highH >= 10 ? 0.10 : 0);
    const low  = round5(lowH  * perTime * (1 - lowDisc));
    const high = round5(highH * perTime * (1 - highDisc));
    const txt = [
      `Vi priser per time digitalisert video (${perTime} kr/time).`,
      `${k} ${k===1?"kassett":"kassetter"} kan typisk være ${lowH.toFixed(1)}–${highH.toFixed(1)} timer`,
      `⇒ ca ${nok(low)}–${nok(high)} kr (inkl. ev. volumrabatt).`,
      `Oppgi gjerne total spilletid for et mer presist estimat. USB/minnepenn i tillegg (fra ${usbMin} kr).`
    ].join(" ");
    return { answer: txt, source: "Pris" };
  }

  return {
    answer: `Video prises pr time (${perTime} kr/time). Oppgi gjerne total spilletid (timer/minutter), så regner jeg et konkret estimat. USB/minnepenn i tillegg (fra ${usbMin} kr).`,
    source: "Pris"
  };
}

/* =============== PURCHASE / SALG =============== */
const PURCHASE_WORDS = [
  "kjøpe","kjøp","selger dere","selger du","kan jeg kjøpe","bestille","pris på usb","minnepenn pris",
  "ramme","rammer","fotoutskrift","print","fine art","papir","tom kassett","tomme videokassetter",
  "blank kassett","dvd-plater","cd-plater","minnepenn","usb","memory stick"
];
function handlePurchaseIntent(message, prices = {}) {
  const m = (message || "").toLowerCase();
  if (!hasAnyWord(m, PURCHASE_WORDS)) return null;

  const usbMin = Number(prices?.usb_min_price ?? prices?.minnepenn ?? 295);

  if (hasAnyWord(m, ["tom kassett","tomme videokassetter","blank kassett","vhs-kassett","videokassetter"]) &&
      !hasAnyWord(m, ["minnepenn","usb"])) {
    return {
      answer:
        "Vi selger ikke tomme video-/VHS-kassetter. Vi digitaliserer derimot eksisterende opptak. " +
        `Til lagring selger vi USB/minnepenner i flere størrelser (fra ca. ${usbMin} kr). ` +
        "Vi tilbyr også fotoutskrifter i fine-art-kvalitet og rammer. Si gjerne hva du ønsker, så hjelper jeg deg videre.",
      source: "Info"
    };
  }

  if (hasAnyWord(m, ["usb","minnepenn","minnepenner","memory stick","memory-stick"])) {
    return {
      answer:
        `Ja, vi selger USB/minnepenner i ulike størrelser. Pris fra ca. ${usbMin} kr. ` +
        "Si gjerne hvor mye lagringsplass du trenger (for eksempel 32/64/128 GB), så foreslår jeg riktig størrelse.",
      source: "Info"
    };
  }

  if (hasAnyWord(m, ["fotoutskrift","print","fine art","papir","ramme","rammer"])) {
    return {
      answer:
        "Ja, vi tilbyr fotoutskrifter i fine-art-kvalitet og rammer. " +
        "Oppgi ønsket størrelse og antall (for eksempel 30×40 cm, 5 stk), så gir vi pris og leveringstid.",
      source: "Info"
    };
  }

  return {
    answer:
      "Vi har et begrenset utvalg for salg: USB/minnepenner, fotoutskrifter i fine-art-kvalitet og rammer. " +
      "Fortell hva du ønsker (type, størrelse/kapasitet og antall), så hjelper jeg deg med pris og levering.",
    source: "Info"
  };
}

/* =============== Henting/levering intents =============== */
function handlePickupIntent(message) {
  const m = (message || "").toLowerCase();
  if (/(hente|henting|kan dere hente)/.test(m)) {
    return {
      answer:
        "Det kan være at vi kan hente materialet hjemme hos deg. Ta kontakt, så finner vi en løsning som passer.",
      source: "Info"
    };
  }
  return null;
}
function handleDeliveryIntent(message) {
  const m = (message || "").toLowerCase();
  if (/(lever|levering|hvordan.*lever|hvor.*levere|post)/.test(m)) {
    const text = [
      "Du kan sende pakken med Norgespakke med sporing til:",
      "Luna Media, Pb. 60, 3107 Sem (bruk mottakers mobil 997 05 630).",
      "",
      "Du kan også levere direkte:",
      "- Sem Senteret (2. etg.), Andebuveien 3, 3170 Sem",
      "- Desk på Bislett i Oslo (Sofies gate 66A) – etter avtale",
      "",
      "Ring 33 74 02 80 eller skriv til kontakt@lunamedia.no for å avtale levering/henting."
    ].join("\n");
    return { answer: text, source: "Info" };
  }
  return null;
}

/* =============== Booking intent + e-postvarsel =============== */
const BOOKING_KEYWORDS = [
  "filme","filming","videoopptak","opptak",
  "arrangement","konfirmasjon","bryllup","jubileum",
  "event","konsert","seremoni","presentasjon","lansering"
];
function looksLikeBooking(msg) {
  const m = (msg || "").toLowerCase();
  return BOOKING_KEYWORDS.some(k => m.includes(k));
}
function extractEmail(s=""){ const m=(s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]); return m[0]||null; }
function extractDate(s=""){
  const m = (s||"").toLowerCase()
    .match(/\b(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?|\d{1,2}\s*(?:jan|feb|mar|apr|mai|jun|jul|aug|sep|sept|okt|nov|des|januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember))\b/);
  return m ? m[1] : null;
}
function extractTimeRange(s=""){
  const m = (s||"").toLowerCase().match(/\b(?:kl\.?\s*)?(\d{1,2}(?::\d{2})?)\s*[–-]\s*(\d{1,2}(?::\d{2})?)\b/);
  return m ? `${m[1]}–${m[2]}` : null;
}
function extractPlace(s=""){
  const m = (s||"").match(/\b(i|på)\s+([A-ZÆØÅ][\p{L}\- ]{1,40})\b/iu);
  return m ? m[2].trim() : null;
}
function extractDeliverable(s=""){
  const m = (s||"").toLowerCase();
  if (/(klipp|redig|ferdig.*film|hovedfilm|sosiale medier|reels|tiktok|stories|som?e|teaser)/.test(m)) return "klippet film (ev. SoMe-klipp)";
  if (/(råmateriale|råfiler)/.test(m)) return "råmateriale";
  return null;
}
function fromHistory(history, extractor){
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--){
    const text = history[i]?.content || "";
    const hit  = extractor(text);
    if (hit) return hit;
  }
  return null;
}
async function sendBookingEmail({to, from, subject, text}) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to || !from) return { ok:false, reason:"missing-config" };
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to:[to], from, subject, text })
  });
  let data; try { data = await resp.json(); } catch { data = {}; }
  return { ok: resp.ok, data };
}
function parseBookingIntent(message, history){
  if (!looksLikeBooking(message)) return null;
  let when   = extractDate(message);
  let time   = extractTimeRange(message);
  let place  = extractPlace(message);
  let want   = extractDeliverable(message);
  let email  = extractEmail(message);
  if (!when)  when  = fromHistory(history, extractDate);
  if (!time)  time  = fromHistory(history, extractTimeRange);
  if (!place) place = fromHistory(history, extractPlace);
  if (!want)  want  = fromHistory(history, extractDeliverable);
  if (!email) email = fromHistory(history, extractEmail);
  return { when, time, place, want, email };
}
function missingBookingSlots(slots){
  const need = [];
  if (!slots.when)  need.push("dato");
  if (!slots.time)  need.push("tidsrom");
  if (!slots.place) need.push("sted");
  if (!slots.want)  need.push("ønsket leveranse (f.eks. klippet film/SoMe-klipp)");
  if (!slots.email) need.push("e-postadresse");
  return need;
}
async function handleBookingIntent(message, history){
  const slots = parseBookingIntent(message, history);
  if (!slots) return null;
  const need = missingBookingSlots(slots);
  if (need.length){
    return {
      answer: `Supert! For å gi et konkret tilbud trenger jeg ${need.join(", ")}. ` +
              `Skriv for eksempel: "${slots.place||"Sted"} ${slots.when||"12.10"} ${slots.time||"12–15"}, ` +
              `${slots.want||"klippet film"} – ${slots.email||"navn@epost.no"}".`,
      source: "Info"
    };
  }
  const to   = process.env.LUNA_ALERT_TO   || "kontakt@lunamedia.no";
  const from = process.env.LUNA_ALERT_FROM || "Luna Media <post@lunamedia.no>";
  const subject = `Bookingforespørsel: ${slots.when} ${slots.time} – ${slots.place}`;
  const text = [
    "Ny forespørsel om filming:",
    "",
    `Dato: ${slots.when}`,
    `Tidsrom: ${slots.time}`,
    `Sted: ${slots.place}`,
    `Ønsket leveranse: ${slots.want}`,
    `Kontakt: ${slots.email}`,
    "",
    "Hele dialogen (siste meldinger først):",
    ...(Array.isArray(history) ? history.slice(-10).reverse().map(h => `- ${h.role}: ${h.content}`) : [])
  ].join("\n");
  const sendRes = await sendBookingEmail({ to, from, subject, text });
  const confirm =
    `Takk! Jeg har notert ${slots.when}, ${slots.time} på ${slots.place}, ` +
    `med leveranse ${slots.want}. Jeg sender et uforpliktende tilbud til ${slots.email} svært snart.`;
  return { answer: confirm + (sendRes.ok ? "" : " (Lite hint: e-postvarslet mitt feilet – men vi følger opp manuelt.)"), source: "Info" };
}

/* =============== Guards for personer/partnere =============== */
function handleIdentityClaimIntent(message) {
  const m = (message || "").toLowerCase();
  if (/er\s+.+\s+(en\s+)?del av\s+luna\s+media\??/.test(m) || /ansatt i luna media/.test(m)) {
    return {
      answer: "Det kan jeg ikke bekrefte i chatten. Kontakt oss gjerne på kontakt@lunamedia.no eller 33 74 02 80, så får du en rask avklaring.",
      source: "Info"
    };
  }
  if (m.includes("samarbeid") && m.includes("luna media")) {
    return {
      answer: "Vi har flere gode samarbeidspartnere. Ta gjerne kontakt hvis du ønsker detaljer om samarbeid i en konkret sak.",
      source: "Info"
    };
  }
  return null;
}

/* =============== Handler =============== */
export default async function handler(req, res) {
  const allowed = (process.env.LUNA_ALLOWED_ORIGINS || "*").split(",").map(s => s.trim());
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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const message = (body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    if (!message) return res.status(400).json({ error: "Missing message" });

    const { faq, prices } = loadData();

    // 1) FAQ
    const kbHits = simpleSearch(message, faq);
    if (kbHits?.[0]?.a) return res.status(200).json({ answer: kbHits[0].a, source: "FAQ" });

    // 2) Guards
    const idGuard = handleIdentityClaimIntent(message);
    if (idGuard) return res.status(200).json(idGuard);

    // 3) Henting/levering
    const pick = handlePickupIntent(message);
    if (pick) return res.status(200).json(pick);
    const delv = handleDeliveryIntent(message);
    if (delv) return res.status(200).json(delv);

    // 4) Spole/diameter → minutter (hjelpeanslag)
    const spool = handleSmalfilmLengthIntent(message, history);
    if (spool) return res.status(200).json(spool);

    // 5) Purchase intent
    const salesHit = handlePurchaseIntent(message, prices);
    if (salesHit) return res.status(200).json(salesHit);

    // 6) Pris-intents
    const vIntent = parseVideoIntent(message);
    if (vIntent) {
      if (vIntent.minutter == null) vIntent.minutter = minutesFromUserHistory(history);
      return res.status(200).json(priceVideo(vIntent, prices));
    }
    const smNow  = parseSmalfilmLoose(message);
    const smHist = historySmalfilm(history);
    const shouldSmalfilm = smNow.hasFilm || (smNow.mentionsRullOnly && (smHist.hasFilm || smHist.minutter != null));
    if (shouldSmalfilm) {
      const minutter = smNow.minutter ?? smHist.minutter ?? null;
      const ruller   = smNow.ruller   ?? smHist.ruller   ?? null;
      const m = message.toLowerCase();
      const type = /16\s*mm|16mm/.test(m) ? "16mm" : "super8";
      const lyd  = /optisk/.test(m) ? "optisk" : (/lyd|magnet/i.test(m) ? "magnetisk" : "ingen");
      return res.status(200).json(priceSmalfilm(minutter, ruller, prices, type, lyd));
    }

    // 7) Booking intent
    const bookingHit = await handleBookingIntent(message, history);
    if (bookingHit) return res.status(200).json(bookingHit);

    // 8) LLM fallback
    const system = [
      'Du er "Luna" – en vennlig og presis AI-assistent for Luna Media (Vestfold).',
      "Svar kort på norsk. Bruk priseksempler og FAQ nedenfor når relevant.",
      "Hvis noe er uklart eller pris mangler: si det, og foreslå tilbud via skjema/e-post.",
      "Gi aldri bastante bekreftelser om personer, ansettelser eller partnerskap; be kunden kontakte oss for avklaring.",
      "VIKTIG: Hvis kunden spør om filming/booking (arrangement, bryllup, konfirmasjon, event):",
      "- Tilby alltid menneskelig overtakelse i tillegg til svaret.",
      "- Be konkret om: dato, sted, tidsrom, ønsket leveranse (klippet film/SoMe), og e-post.",
      "",
      "Priser (kan være tomt):",
      JSON.stringify(prices, null, 2)
    ].join("\n");

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const model = process.env.LUNA_MODEL || "gpt-4o-mini";
    const user = `Kunde spør: ${message}\nSvar på norsk, maks 2–3 setninger.`;

    let answer =
      "Beklager, jeg har ikke et godt svar på dette akkurat nå. " +
      "Send oss gjerne e-post på kontakt@lunamedia.no eller ring 33 74 02 80.";

    if (!OPENAI_API_KEY) {
      return res.status(200).json({ answer, source: "fallback_no_key" });
    }

    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model, temperature: 0.3, max_tokens: 400,
          messages: [
            { role: "system", content: system },
            ...history,
            { role: "user", content: user }
          ]
        })
      });
      const text = await resp.text();
      let data; try { data = JSON.parse(text); } catch { throw new Error("OpenAI JSON parse error: " + text); }
      if (!resp.ok) throw new Error(data?.error?.message || `OpenAI feilkode ${resp.status}`);
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
