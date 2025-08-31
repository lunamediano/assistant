// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* ========================================================================== */
/* Setup                                                                      */
/* ========================================================================== */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ---------------------------- Utils --------------------------------------- */
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
function toInt(v, def = 0) {
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : def;
}
function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function nok(n) {
  return toNum(n, 0).toLocaleString("no-NO");
}
function round5(n) {
  return Math.round(n / 5) * 5;
}

/* ---------------------------- Load data ----------------------------------- */
function loadData() {
  const faqCandidates = [
    path.join(__dirname, "..", "data", "faq.yaml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yaml"),
    path.join(__dirname, "..", "knowledge", "luna.yml"),
  ];
  let faq = [];
  let prices = {};
  const tried = [];
  const loaded = [];

  for (const p of faqCandidates) {
    const isLuna = p.endsWith("luna.yml");
    const exists = fs.existsSync(p);
    tried.push({ path: p, exists, size: exists ? fs.statSync(p).size : 0 });
    if (!exists) continue;
    const parsed = safeRead(p, "yaml");
    if (!parsed) continue;
    loaded.push({ path: p, size: fs.statSync(p).size });

    if (isLuna) {
      const fromLunaFaq =
        Array.isArray(parsed?.faq) ? parsed.faq :
        Array.isArray(parsed?.knowledge?.faq) ? parsed.knowledge.faq : [];
      if (fromLunaFaq?.length) faq = faq.concat(fromLunaFaq);

      const fromLunaPrices = parsed?.priser || parsed?.prices || parsed?.company?.prices;
      if (fromLunaPrices && typeof fromLunaPrices === "object") {
        prices = { ...prices, ...fromLunaPrices };
      }
    } else {
      const items = Array.isArray(parsed) ? parsed : (parsed?.faq || []);
      if (items?.length) faq = faq.concat(items);
    }
  }

  const priceJson = safeRead(path.join(__dirname, "..", "data", "priser.json"), "json");
  if (priceJson && typeof priceJson === "object") {
    prices = { ...prices, ...priceJson };
    loaded.push({ path: "priser.json", size: JSON.stringify(priceJson).length });
  }
  return { faq, prices, tried, loaded };
}

/* ---------------------------- Simple FAQ search --------------------------- */
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
    if (!best || bestLocal > best.score) best = { item, score: bestLocal };
  }
  if (best && best.score >= minScore) {
    return [{ a: best.item.a, score: best.score, q: best.item.q }];
  }
  return [];
}

/* ========================================================================== */
/* Language helpers (norske tallord)                                          */
/* ========================================================================== */
const NO_WORDNUM = {
  "null":0,"en":1,"ett":1,"ei":1,"to":2,"tre":3,"fire":4,"fem":5,"seks":6,"sju":7,"syv":7,
  "åtte":8,"ni":9,"ti":10,"elleve":11,"tolv":12,"tretten":13,"fjorten":14,"femten":15,
  "seksten":16,"sytten":17,"atten":18,"nitten":19,"tjue":20
};
function wordToNum(w){
  const k = (w||"").toLowerCase().normalize("NFKD").replace(/[^a-zæøå]/g,"");
  return Object.prototype.hasOwnProperty.call(NO_WORDNUM, k) ? NO_WORDNUM[k] : null;
}

/* ========================================================================== */
/* Parsere for tid, ruller, mm                                               */
/* ========================================================================== */
function extractMinutes(text=""){
  const m = (text||"").toLowerCase();
  const mm = m.match(/(\d{1,4})\s*(min|minutt|minutter)\b/);
  const hh = m.match(/(\d{1,3})\s*(t|time|timer)\b/);
  if (mm) return toInt(mm[1]);
  if (hh) return toInt(hh[1]) * 60;
  const wm = m.match(/([a-zæøå]+)\s*(min|minutt|minutter)\b/);
  const wh = m.match(/([a-zæøå]+)\s*(t|time|timer)\b/);
  if (wm){ const n = wordToNum(wm[1]); if(n!=null) return n; }
  if (wh){ const n = wordToNum(wh[1]); if(n!=null) return n*60; }
  return null;
}
function extractRuller(text=""){
  const m = (text||"").toLowerCase();
  const rd = m.match(/(\d{1,3})\s*(rull|ruller)\b/);
  if (rd) return toInt(rd[1]);
  const rw = m.match(/([a-zæøå]+)\s*(rull|ruller)\b/);
  if (rw){ const n = wordToNum(rw[1]); if(n!=null) return n; }
  return null;
}
function minutesFromUserHistory(history=[]){
  for (let i=history.length-1; i>=0; i--){
    const h=history[i];
    if (h?.role !== "user") continue;
    const n = extractMinutes(h?.content||"");
    if (n != null) return n;
  }
  return null;
}

/* ========================================================================== */
/* Domene‐spesifikke intents                                                 */
/* ========================================================================== */

/* ---------- Film format aliaser ---------- */
const S8_RE       = /\b(s-?8|super\s*8|super8)\b/i;
const EIGHT_RE    = /\b(8\s*mm|8mm|dobbel\s*8|d8|regular\s*8)\b/i;
const SIXTEEN_RE  = /\b(16\s*mm|16mm)\b/i;

/* ---------- Diameter → minutter (tommelregler) ---------- */
const MAP_MIN_S8  = { 7.5: 4, 12.7: 12, 14.5: 18, 17: 24 };
const MAP_MIN_R8  = { 7.5: 4, 12.7: 16, 14.5: 22, 17: 32 };
const DIAM_KEYS   = [7.5, 12.7, 14.5, 17];

function nearestStdDiameter(cm) {
  const v = Number(String(cm).replace(",", "."));
  let best = DIAM_KEYS[0], d = Infinity;
  for (const k of DIAM_KEYS) {
    const diff = Math.abs(v - k);
    if (diff < d) { d = diff; best = k; }
  }
  return best;
}
function parseS8Diameters(text) {
  const cmMatches = [...text.matchAll(/(\d{1,2}(?:[.,]\d)?)\s*cm/gi)].map(m => m[1]);
  return cmMatches.map(nearestStdDiameter);
}
function parseMinutesLoose(text) {
  const m = text.match(/(\d{1,4})(?:[.,](\d))?\s*(min|minutt|minutter)\b/i);
  if (!m) return null;
  const whole = parseInt(m[1], 10);
  const frac  = m[2] ? parseInt(m[2],10)/10 : 0;
  return whole + frac;
}
function parseSound16(text) {
  if (/optisk/i.test(text)) return "optisk";
  if (/magnet/i.test(text)) return "magnetisk";
  return null;
}
function estimateMinutesFromDiameters(diams = [], isSuper8 = true) {
  const map = isSuper8 ? MAP_MIN_S8 : MAP_MIN_R8;
  return diams.reduce((sum, d) => sum + (map[d] || 0), 0);
}

/* ---------- Kjøpsintents ---------- */
const PURCHASE_WORDS = [
  "kjøpe","kjøp","selger dere","kan jeg kjøpe","bestille",
  "pris på usb","minnepenn","ramme","rammer","fotoutskrift","print",
  "fine art","papir","tomme videokassetter","tom kassett","blank kassett","dvd-plater","cd-plater"
];
function looksLikePurchase(msg=""){
  const m = msg.toLowerCase();
  return PURCHASE_WORDS.some(w => m.includes(w));
}
function mentionsAny(msg="", words=[]){
  const m = msg.toLowerCase();
  return words.some(w => m.includes(w));
}
function handlePurchaseIntent(message, prices={}){
  if (!looksLikePurchase(message)) return null;
  const m = message.toLowerCase();
  const usbMin = Number(prices?.usb_min_price ?? prices?.minnepenn ?? 295);

  if (mentionsAny(m, ["tom kassett","tomme videokassetter","blank kassett","videokassetter","vhs-kassett"])
      && !mentionsAny(m, ["minnepenn","usb"])) {
    return {
      answer:
        "Vi selger ikke tomme video-/VHS-kassetter. Vi digitaliserer derimot eksisterende opptak. " +
        "Til lagring selger vi USB/minnepenner i flere størrelser (fra ca. " + usbMin + " kr), " +
        "og vi tilbyr også fotoutskrifter i fine-art-kvalitet og rammer. Si gjerne hva du ønsker å kjøpe.",
      source: "AI"
    };
  }
  if (mentionsAny(m, ["usb","minnepenn","minnepenner","memory stick"])) {
    return {
      answer:
        "Ja, vi selger USB/minnepenner i ulike størrelser (god kvalitet, 10 års garanti). Pris fra ca. " +
        usbMin + " kr. Si gjerne hvor mye lagringsplass du trenger (for eksempel 32/64/128 GB).",
      source: "AI"
    };
  }
  if (mentionsAny(m, ["fotoutskrift","print","fine art","papir","ramme","rammer"])) {
    return {
      answer:
        "Ja, vi tilbyr fotoutskrifter i fine-art-kvalitet og rammer. Oppgi ønsket størrelse og antall (for eksempel 30×40 cm, 5 stk), så gir vi pris og leveringstid.",
      source: "AI"
    };
  }
  return {
    answer:
      "Vi har et begrenset utvalg produkter for salg: USB/minnepenner, fotoutskrifter i fine-art-kvalitet og rammer. " +
      "Fortell hva du ønsker (type, størrelse/kapasitet og antall), så hjelper jeg med pris og levering.",
    source: "AI"
  };
}

/* ---------- Reparasjon av kassetter ---------- */
const REPAIR_RE = /(reparer|reparasjon|fikse|fix|ordne)\s*(av)?\s*(kassett|kassetter|videokassett|videobånd|minidv|hi8|video8|vhsc|vhs)/i;
function handleRepairIntent(message) {
  if (!REPAIR_RE.test(message)) return null;
  return {
    answer:
      "Ja, vi reparerer videokassetter (VHS, VHS-C, Video8/Hi8, MiniDV m.fl.). " +
      "Typisk inkluderer det skjøting av avrevne bånd, bytte av skall og utbedring av fastkjørt bånd. " +
      "Etter reparasjon kan vi også digitalisere innholdet. Ta kontakt på 33 74 02 80 eller kontakt@lunamedia.no for vurdering og pris.",
    source: "FAQ"
  };
}

/* ---------- Levering / henting ---------- */
const DELIVERY_RE = /(hvordan|hvor)\s+(kan\s+)?(jeg\s+)?(levere|sende|levering)|norgespakke|hente/i;
function handleDeliveryIntent(message) {
  if (!DELIVERY_RE.test(message)) return null;
  const answer = [
    "Du kan sende pakken med Norgespakke med sporing til:",
    "Luna Media, Pb. 60, 3107 Sem (bruk mottakers mobil 997 05 630).",
    "",
    "Du kan også levere direkte:",
    "- Sem Senteret (2. etg.), Andebuveien 3, 3170 Sem",
    "- Desk på Bislett i Oslo (Sofies gate 66A) – etter avtale",
    "",
    "Ring 33 74 02 80 eller skriv til kontakt@lunamedia.no for å avtale levering/henting. Henting kan avtales i nærområdet ved behov (f.eks. Drammen)."
  ].join("\n");
  return { answer, source: "FAQ" };
}

/* ---------- Mixed S8/8mm + 16mm intro ---------- */
function handleMixedFilmIntro(message) {
  const hasS8or8 = S8_RE.test(message) || EIGHT_RE.test(message) || /\bs8\b/i.test(message);
  const has16    = SIXTEEN_RE.test(message);
  if (!hasS8or8 || !has16) return null;
  const answer =
    "Ja – vi tar begge deler.\n\n" +
    "• S8/8 mm: Oppgi diameter per rull (7,5 / 12,7 / 14,5 / 17 cm) og om det er 8 mm eller Super 8.\n" +
    "• 16 mm: Oppgi minutter (eller meter) per rull og om lyden er optisk eller magnetisk.\n\n" +
    "Skriv for eksempel: «S8: 2 ruller, 12,7 cm og 14,5 cm (Super 8). 16 mm: 3 ruller, 24 min, optisk lyd».";
  return { answer, source: "AI" };
}

/* ========================================================================== */
/* Priser                                                                      */
/* ========================================================================== */
function smalfilmDiscount(totalMinutes){
  if (totalMinutes >= 360) return 0.20;         // ≥ 6 timer
  if (totalMinutes >= 181) return 0.10;         // > 3 timer (presis >180)
  return 0;
}
function priceSmalfilm(minutter, ruller, prices){
  const perMin   = toNum(prices.smalfilm_min_rate ?? prices.smalfilm_per_minutt ?? 75);
  const startGeb = toNum(prices.smalfilm_start_per_rull ?? 95);
  const usbMin   = toNum(prices.usb_min_price ?? prices.minnepenn ?? 295);

  if (minutter == null){
    const txt = [
      "Smalfilm prises med ca. " + perMin + " kr per minutt + " + startGeb + " kr i startgebyr per rull.",
      "Vi gir 10% rabatt når samlet spilletid er over 3 timer, og 20% rabatt over 6 timer.",
      "Oppgi antall minutter og ruller for et konkret prisestimat. USB/minnepenn kommer i tillegg (fra " + usbMin + " kr).",
      "Det vil alltid være noen usikre variabler i utregning av lengde på smalfilm hvis du ikke vet dette eksakt. " +
        "Betrakt derfor svaret som et estimat – kontakt oss gjerne for et sikrere estimat/tilbud."
    ].join(" ");
    return { answer: txt, source: "Pris" };
  }

  const mins  = Math.max(0, toInt(minutter));
  const rolls = ruller != null ? Math.max(1, toInt(ruller)) : 1;

  const disc   = smalfilmDiscount(mins);
  const arbeid = mins * perMin * (1 - disc);
  const start  = rolls * startGeb;
  const total  = round5(arbeid + start);

  let out =
    "For " + mins + " minutter smalfilm og " + rolls + " " + (rolls===1?"rull":"ruller") +
    " er prisen ca " + nok(total) + " kr.";
  if (disc>0) out += " (Rabatt er inkludert: " + (disc*100).toFixed(0) + "% for " + (mins/60).toFixed(1) + " timer totalt.)";
  out += " USB/minnepenn kommer i tillegg (fra " + usbMin + " kr). " +
         "Betrakt svaret som et estimat hvis lengden ikke er helt sikker.";

  return { answer: out, source: "Pris" };
}

/* Video (VHS/Hi8/Video8/MiniDV) */
function parseVideoIntent(text=""){
  const m = text.toLowerCase();
  if (!/(vhs|videokassett|videobånd|hi8|video8|minidv|vhsc)/.test(m)) return null;
  const minutter = extractMinutes(m);
  const kMatch   = m.match(/(\d{1,3})\s*(kassett|kassetter|bånd|videobånd)\b/);
  const kassetter= kMatch ? toInt(kMatch[1]) : null;
  return { minutter, kassetter };
}
function priceVideo({minutter, kassetter}, prices){
  const perTime = toNum(prices.vhs_per_time ?? prices.video_per_time ?? prices.vhs_per_time_kr ?? 315);
  const usbMin  = toNum(prices.usb_min_price ?? prices.minnepenn ?? 295);

  if (minutter != null){
    const min = Math.max(0, toInt(minutter));
    const hrs = min/60;
    let disc = 0;
    if (hrs >= 20) disc = 0.20;
    else if (hrs >= 10) disc = 0.10;
    const total = round5(hrs * perTime * (1 - disc));
    let txt = "Video prises pr time digitalisert opptak (" + perTime + " kr/time). For " +
              hrs.toFixed(1) + " timer blir prisen ca " + nok(total) + " kr.";
    if (disc>0) txt += " (Inkluderer " + (disc*100).toFixed(0) + "% rabatt.)";
    txt += " USB/minnepenn kommer i tillegg (fra " + usbMin + " kr).";
    return { answer: txt, source: "Pris" };
  }

  if (kassetter != null){
    const k = Math.max(1, toInt(kassetter));
    const lowH = k * 1.0, highH = k * 2.0; // 60–120 min pr kassett (anslag)
    const lowDisc  = lowH  >= 20 ? 0.20 : (lowH  >= 10 ? 0.10 : 0);
    const highDisc = highH >= 20 ? 0.20 : (highH >= 10 ? 0.10 : 0);
    const low  = round5(lowH  * perTime * (1 - lowDisc));
    const high = round5(highH * perTime * (1 - highDisc));
    const txt =
      "Vi priser per time digitalisert video (" + perTime + " kr/time). " +
      k + " " + (k===1?"kassett":"kassetter") + " kan typisk være " + lowH.toFixed(1) + "–" + highH.toFixed(1) + " timer " +
      "⇒ ca " + nok(low) + "–" + nok(high) + " kr (inkl. ev. volumrabatt). " +
      "Oppgi gjerne total spilletid for et mer presist estimat. USB/minnepenn i tillegg (fra " + usbMin + " kr).";
    return { answer: txt, source: "Pris" };
  }

  return {
    answer: "Video prises pr time (" + perTime + " kr/time). Oppgi gjerne total spilletid (timer/minutter), så regner jeg et konkret estimat. USB/minnepenn i tillegg (fra " + usbMin + " kr).",
    source: "Pris"
  };
}

/* ========================================================================== */
/* Handler                                                                     */
/* ========================================================================== */
export default async function handler(req, res){
  /* CORS */
  const allowed = (process.env.LUNA_ALLOWED_ORIGINS || "*").split(",").map(s=>s.trim());
  const origin = req.headers.origin || "";
  if (allowed.includes("*") || allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type");
    return res.status(200).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error:"Method not allowed" });

  try {
    let body = req.body || {};
    if (typeof body === "string") { try{ body = JSON.parse(body); } catch { body = {}; } }
    const message = (body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    const debug   = !!body.debug;
    if (!message) return res.status(400).json({ error:"Missing message" });

    const { faq, prices } = loadData();

    /* 0) Raskt: reparasjon / levering / kjøp */
    const repair = handleRepairIntent(message);
    if (repair) return res.status(200).json(repair);

    const delivery = handleDeliveryIntent(message);
    if (delivery) return res.status(200).json(delivery);

    const sales = handlePurchaseIntent(message, prices);
    if (sales) return res.status(200).json(sales);

    /* 1) FAQ */
    const kbHits = simpleSearch(message, faq);
    if (kbHits?.[0]?.a) {
      return res.status(200).json({ answer: kbHits[0].a, source: "FAQ" });
    }

    /* 1.5) Intro for blandet S8/8mm + 16mm */
    const mixIntro = handleMixedFilmIntro(message);
    if (mixIntro) return res.status(200).json(mixIntro);

    /* 2) Pris-intents: Video først (vhs/hi8 etc.) */
    const vIntent = parseVideoIntent(message);
    if (vIntent){
      if (vIntent.minutter == null) vIntent.minutter = minutesFromUserHistory(history);
      return res.status(200).json( priceVideo(vIntent, prices) );
    }

    /* 2.1) Smalfilm (S8/8mm/16mm – pris på minutter) */
    const mentionsSmalfilm = /(smalfilm|super\s*8|super8|8\s*mm|8mm|16\s*mm|16mm|s-?8)\b/i.test(message.toLowerCase());
    if (mentionsSmalfilm){
      const mins = extractMinutes(message) ?? minutesFromUserHistory(history);
      const rull = extractRuller(message);
      const priced = priceSmalfilm(mins, rull, prices);
      return res.status(200).json(priced);
    }

    /* 2.2) Oppfølger: hvis kunden svarer med diametre/minutter i fritekst */
    (function maybeFollowUpFilmParsing(){
      const lower = message.toLowerCase();

      if (S8_RE.test(lower) || EIGHT_RE.test(lower) || /\bs8\b/i.test(lower)) {
        const diams = parseS8Diameters(message);
        if (diams.length >= 1) {
          const isS8 = S8_RE.test(lower) || /\bs8\b/i.test(lower);
          const mins = estimateMinutesFromDiameters(diams, isS8);
          if (mins > 0) {
            return res.status(200).json({
              answer:
                "Basert på diameter " + diams.join(" cm, ") + " cm anslår jeg ca " + mins + " minutter " +
                (isS8 ? "Super 8" : "8 mm") + ". Oppgi gjerne hvor mange slike ruller du har, så regner jeg total tid og pris.",
              source: "AI"
            });
          }
          return res.status(200).json({
            answer:
              "Kan du oppgi diameter pr rull som 7,5 / 12,7 / 14,5 / 17 cm, og om det er 8 mm eller Super 8? Da anslår jeg minutter og pris.",
            source: "AI"
          });
        }
      }

      if (SIXTEEN_RE.test(lower)) {
        const mins = parseMinutesLoose(message);
        const lyd  = parseSound16(message);
        if (mins || lyd) {
          const parts = [];
          if (mins) parts.push(mins + " minutter");
          if (lyd)  parts.push(lyd + " lyd");
          return res.status(200).json({
            answer:
              "Notert for 16 mm: " + parts.join(", ") + ". Har du flere ruller eller minuttsum, så kan jeg beregne pris (optisk/magnetisk lyd prises forskjellig).",
            source: "AI"
          });
        }
      }
    })();

    /* 3) LLM fallback */
    const system = [
      'Du er "Luna" – en vennlig og presis AI-assistent for Luna Media (Vestfold).',
      "Svar kort på norsk. Bruk priseksempler og FAQ nedenfor når relevant.",
      "Hvis noe er uklart eller pris mangler: si det, og foreslå tilbud via e-post.",
      "Tilby menneskelig overtakelse ved spesielle behov.",
      "Priser (kan være tomt):",
      JSON.stringify(prices, null, 2)
    ].join("\n");

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const model = process.env.LUNA_MODEL || "gpt-4o-mini";
    const user = `Kunde spør: ${message}\nSvar på norsk, maks 2–3 setninger.`;

    let answer =
      "Beklager, jeg har ikke et godt svar på dette akkurat nå. " +
      "Send oss gjerne en e-post på kontakt@lunamedia.no eller ring 33 74 02 80.";

    if (!OPENAI_API_KEY) {
      return res.status(200).json({ answer, source: "fallback_no_key" });
    }

    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: 400,
          messages: [
            { role: "system", content: system },
            ...history,
            { role: "user", content: user }
          ]
        })
      });

      const text = await resp.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error("OpenAI JSON parse error: " + text); }
      if (!resp.ok) throw new Error(data?.error?.message || ("OpenAI feilkode " + resp.status));
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (content) answer = content;
      return res.status(200).json({ answer, source: "AI" });

    } catch (e) {
      console.error("OpenAI-kall feilet:", e?.message);
      return res.status(200).json({ answer, source: "fallback_openai_error" });
    }

  } catch (err){
    console.error("Handler-feil:", err);
    return res.status(500).json({ error:"Server error" });
  }
}
