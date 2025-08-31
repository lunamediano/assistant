// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* -------------------- utils -------------------- */
function safeRead(file, kind = "text") {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    if (kind === "json") return JSON.parse(raw);
    if (kind === "yaml") return yaml.load(raw);
    return raw;
  } catch {
    return null; // never throw -> avoids 500
  }
}
const toInt = (v, d=0) => {
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : d;
};
const toNum = (v, d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
const nok = (n) => toNum(n,0).toLocaleString("no-NO");
const round5 = (n) => Math.round(n/5)*5;
const lc = (s="") => s.toLowerCase();

/* Normalize without Unicode property escapes */
function normalizeSimple(s=""){
  return lc(s).normalize("NFKD");
}
function keepLettersDigitsSpaces(s=""){
  // Keep a–z, digits, spaces, and Norwegian letters æøå
  return s.replace(/[^a-z0-9æøå\s.,:;!?()+\-]/gi, " ");
}
function stripMdStars(s=""){ return s.replace(/\*\*/g,""); }

/* -------------------- number words (no) -------------------- */
const NO_WORDNUM = {
  "null":0,"en":1,"ett":1,"ei":1,"to":2,"tre":3,"fire":4,"fem":5,"seks":6,"sju":7,"syv":7,
  "åtte":8,"ni":9,"ti":10,"elleve":11,"tolv":12,"tretten":13,"fjorten":14,"femten":15,
  "seksten":16,"sytten":17,"atten":18,"nitten":19,"tjue":20
};
function wordToNum(w){
  const k = keepLettersDigitsSpaces(normalizeSimple(w)).replace(/[^a-zæøå]/g,"");
  return NO_WORDNUM.hasOwnProperty(k) ? NO_WORDNUM[k] : null;
}

/* -------------------- data -------------------- */
function loadData() {
  try {
    const faqCandidates = [
      path.join(__dirname, "..", "data", "faq.yaml"),
      path.join(__dirname, "..", "knowledge", "faq_round1.yml"),
      path.join(__dirname, "..", "knowledge", "faq_round1.yaml"),
      path.join(__dirname, "..", "knowledge", "luna.yml"),
    ];
    let faq = []; let prices = {};
    for (const p of faqCandidates) {
      const parsed = safeRead(p, "yaml");
      if (!parsed) continue;
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
    if (priceJson && typeof priceJson === "object") prices = { ...prices, ...priceJson };
    return { faq, prices };
  } catch {
    return { faq: [], prices: {} };
  }
}

/* -------------------- FAQ search (safe) -------------------- */
function tokens(s){
  const t = keepLettersDigitsSpaces(normalizeSimple(s))
    .replace(/\s+/g," ").trim().split(" ");
  return t.filter(Boolean);
}
function jaccard(aTokens,bTokens){
  if(!aTokens.length||!bTokens.length) return 0;
  const a=new Set(aTokens), b=new Set(bTokens);
  const inter=[...a].filter(x=>b.has(x)).length;
  const uni=new Set([...a,...b]).size;
  return inter/uni;
}
function itemAnswer(item){ return typeof item?.a === "string" ? stripMdStars(item.a) : ""; }
function simpleSearch(userMessage, faqArray, minScore=0.65){
  const qTokens = tokens(userMessage);
  let best=null;
  for(const item of faqArray||[]){
    const candidates=[item.q, ...(item.alt||[])].map(tokens);
    let bestLocal=0;
    for(const cand of candidates){
      const score=jaccard(qTokens,cand);
      if(score>bestLocal) bestLocal=score;
    }
    if(!best || bestLocal>best.score) best={ item, score:bestLocal };
  }
  if(best && best.score>=minScore) return [{ a:itemAnswer(best.item), score:best.score }];
  return [];
}

/* -------------------- extractors -------------------- */
function extractMinutes(text=""){
  const m = normalizeSimple(text);
  const mm = m.match(/(\d{1,4})\s*(min|minutt|minutter)\b/);
  const hh = m.match(/(\d{1,3})\s*(t|time|timer)\b/);
  if (mm) return toInt(mm[1]);
  if (hh) return toInt(hh[1]) * 60;
  const wm = m.match(/([a-zæøå]+)\s*(min|minutt|minutter)\b/i);
  const wh = m.match(/([a-zæøå]+)\s*(t|time|timer)\b/i);
  if (wm){ const n = wordToNum(wm[1]); if(n!=null) return n; }
  if (wh){ const n = wordToNum(wh[1]); if(n!=null) return n*60; }
  return null;
}
function extractCount(text="", word){
  const m = normalizeSimple(text);
  const d = m.match(new RegExp("(\\d{1,3})\\s*"+word+"\\b","i"));
  if (d) return toInt(d[1]);
  const w = m.match(new RegExp("([a-zæøå]+)\\s*"+word+"\\b","i"));
  if (w){ const n = wordToNum(w[1]); if(n!=null) return n; }
  return null;
}
function extractDiameters(text=""){
  const nums = [];
  const re = /(\d{1,2}(?:[.,]\d)?)\s*cm\b/gi;
  let m;
  while((m = re.exec(text))){ nums.push(parseFloat(m[1].replace(",", "."))); }
  return nums;
}
function historyFind(history, extractor){
  if(!Array.isArray(history)) return null;
  for(let i=history.length-1;i>=0;i--){
    const h=history[i];
    if (h?.role!=="user") continue;
    const v = extractor(h.content || "");
    if (v!=null && (Array.isArray(v)? v.length>0 : true)) return v;
  }
  return null;
}

/* -------------------- purchase / repair / delivery intents -------------------- */
const PURCHASE_WORDS = [
  "kjøpe","kjøp","selger","bestille","pris på usb","minnepenn","ramme","rammer","fotoutskrift","print","fine art","papir","tomme videokassetter","tom kassett","blank kassett","dvd-plater","cd-plater"
];
function looksLikePurchase(msg){ const m=normalizeSimple(msg); return PURCHASE_WORDS.some(w=>m.includes(w)); }
function mentions(m, arr){ const s=normalizeSimple(m); return arr.some(w=>s.includes(w)); }

function handlePurchaseIntent(message, prices={}){
  if(!looksLikePurchase(message)) return null;
  const m = lc(message);
  const usbMin = Number(prices?.usb_min_price ?? prices?.minnepenn ?? 295);

  if (mentions(m, ["tom kassett","tomme videokassetter","blank kassett","vhs-kassett"]) &&
      !mentions(m, ["usb","minnepenn"])) {
    return {
      answer:
        "Vi selger ikke tomme video-/VHS-kassetter. Vi digitaliserer derimot eksisterende opptak. Til lagring selger vi USB/minnepenner i flere størrelser (fra ca. " + usbMin + " kr), og vi tilbyr også fotoutskrifter i fine-art-kvalitet og rammer.",
      source: "AI"
    };
  }
  if (mentions(m, ["usb","minnepenn","minnepenner","memory stick"])) {
    return {
      answer:
        "Ja, vi selger USB/minnepenner i ulike størrelser. Pris fra ca. " + usbMin + " kr. Si gjerne hvor mye lagringsplass du trenger (for eksempel 32/64/128 GB), så foreslår vi riktig størrelse.",
      source: "AI"
    };
  }
  if (mentions(m, ["fotoutskrift","print","fine art","ramme","rammer","papir"])) {
    return {
      answer:
        "Ja, vi tilbyr fotoutskrifter i fine-art-kvalitet og rammer. Oppgi ønsket størrelse og antall (for eksempel 30×40 cm, 5 stk), så gir vi pris og leveringstid.",
      source: "AI"
    };
  }
  return {
    answer:
      "Vi har et begrenset utvalg produkter for salg: USB/minnepenner, fotoutskrifter i fine-art-kvalitet og rammer. Fortell gjerne hva du ønsker (type, størrelse/kapasitet og antall), så hjelper vi deg med pris og levering.",
    source: "AI"
  };
}

const REPAIR_WORDS = ["ødelagt kassett","reparere kassett","kassett ødelagt","bånd brutt","spole gått av","reparasjon kassett","fixe kassett"];
function handleCassetteRepair(message){
  const m = normalizeSimple(message);
  if(!REPAIR_WORDS.some(w=>m.includes(w))) return null;
  return {
    answer:
      "Ja – vi reparerer videokassetter (VHS, VHSc, Video8/Hi8, MiniDV m.fl.). Vi skjøter brudd i båndet, bytter hus/spole ved behov og kan ofte redde innholdet. Pris avhenger av skadeomfang og antall kassetter – be gjerne om tilbud.",
    source: "AI"
  };
}

const DELIVERY_WORDS = ["levere","levering","post","sendes","adresse","hente","henting","innlevering","leverer dere","kan dere hente","hente i"];
function handleDelivery(message){
  const m = normalizeSimple(message);
  if (!DELIVERY_WORDS.some(w=>m.includes(w))) return null;

  // "hente i <sted>"
  const pick = m.match(/\bhent[e]?\b.*\bi\s+([a-zæøå]+)/i);
  if (pick){
    const place = pick[1];
    return {
      answer:
        `Det kan hende vi kan hente i ${place}. Ta kontakt, så finner vi en god løsning. Ring 33 74 02 80 eller skriv til kontakt@lunamedia.no.`,
      source: "AI"
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
    "Ring 33 74 02 80 eller skriv til kontakt@lunamedia.no for å avtale levering/henting."
  ].join("\n");
  return { answer: text, source: "AI" };
}

/* -------------------- Film parsing (S8/8mm + 16mm) -------------------- */
function looksLikeS8or8mm(msg){ return /(super\s*8|\bs8\b|8\s*mm|8mm|dobbel[-\s]?8|\bd8\b)/i.test(msg); }
function looksLike16mm(msg){ return /\b16\s*mm\b|\b16mm\b/i.test(msg); }
function extractSound16(msg){
  const m = normalizeSimple(msg);
  if (/\boptisk\b/.test(m)) return "optisk";
  if (/\bmagnetisk\b/.test(m)) return "magnetisk";
  return "none";
}
function parseCombinedFilm(message, history){
  const isS8 = looksLikeS8or8mm(message) || !!historyFind(history, t=>looksLikeS8or8mm(t)?true:null);
  const is16 = looksLike16mm(message)    || !!historyFind(history, t=>looksLike16mm(t)?true:null);

  const diamsNow = extractDiameters(message);
  const diamsHist= historyFind(history, extractDiameters) || [];
  const diameters = (diamsNow.length?diamsNow:[]).concat(diamsHist.length?diamsHist:[]);

  const isSuper8 = /super\s*8|\bs8\b/i.test(message) || !!historyFind(history, t=>/super\s*8|\bs8\b/i.test(t)?true:null);

  const rollsS8 = extractCount(message, "rull") ?? extractCount(message, "ruller") ??
                  historyFind(history, t => extractCount(t,"rull") ?? extractCount(t,"ruller"));
  const minutesAny = extractMinutes(message) ?? historyFind(history, extractMinutes);
  const sound16 = extractSound16(message) || (historyFind(history, t=>extractSound16(t)) ?? "none");

  return { isS8, is16, diameters, isSuper8, rollsS8, minutesAny, sound16 };
}

/* -------------------- S8/8mm tabell -------------------- */
const S8_MAP = [
  { d: 7.5,  minutes: { s8: 4,   std8: 4 } },
  { d: 12.7, minutes: { s8: 12,  std8: 16 } },
  { d: 14.5, minutes: { s8: 18,  std8: 22 } },
  { d: 17.0, minutes: { s8: 24,  std8: 32 } },
];
function nearestS8(d){
  if (!Number.isFinite(d)) return null;
  let best=null, diff=1e9;
  for(const row of S8_MAP){
    const dd = Math.abs(d - row.d);
    if (dd < diff){ diff = dd; best = row; }
  }
  return best;
}
function estimateS8MinutesFromDiameters(diams=[], isSuper8=true){
  let total=0;
  for(const d of diams){
    const row = nearestS8(d);
    if (row) total += isSuper8 ? row.minutes.s8 : row.minutes.std8;
  }
  return total;
}

/* -------------------- Pricing -------------------- */
function smalfilmDiscount(totalMinutes){
  if (totalMinutes >= 360) return 0.20;   // ≥ 6 t
  if (totalMinutes >  180) return 0.10;   // > 3 t
  return 0;
}

function priceS8Std({ minutes, rolls, prices, hasSound=false }){
  const perMinBase = toNum(prices.smalfilm_min_rate ?? prices.smalfilm_per_minutt ?? 75);
  const startGeb   = toNum(prices.smalfilm_start_per_rull ?? 95);
  const perMin     = hasSound ? perMinBase + 5 : perMinBase; // +5 kr/min ved lyd på S8
  const usbMin     = toNum(prices.usb_min_price ?? prices.minnepenn ?? 295);
  const mins       = Math.max(0, toInt(minutes));
  const r          = Math.max(1, toInt(rolls ?? 1));
  const disc       = smalfilmDiscount(mins);
  const total      = round5(mins * perMin * (1 - disc) + r * startGeb);

  let out = `For ${mins} minutter smalfilm og ${r} ${r===1?"rull":"ruller"} er prisen ca ${nok(total)} kr.`;
  if (disc>0) out += ` (Rabatt er inkludert: ${(disc*100).toFixed(0)}% for ${(mins/60).toFixed(1)} timer totalt.)`;
  out += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
  out += ` Det vil alltid være noen usikre variabler i utregning av lengde på smalfilm dersom du ikke vet dette eksakt. Betrakt derfor svaret som et estimat, og kontakt oss gjerne per telefon eller e-post for et sikrere estimat og eventuelt pristilbud.`;
  return { answer: out, source: "Pris" };
}

function price16mm({ minutes, rolls=1, sound="none" }){
  let perMin = 1795/20;                 // 89,75/min
  const start = 125 * Math.max(1, toInt(rolls));
  if (sound === "magnetisk") perMin += 200/20;  // +10/min
  if (sound === "optisk")    perMin  = 2990/20; // 149,5/min (erstatter base)
  const mins = Math.max(0, toInt(minutes));
  const total = round5(mins * perMin + start);
  let label = "uten oppgitt lyd";
  if (sound==="magnetisk") label = "med magnetisk lyd";
  if (sound==="optisk")    label = "med optisk lyd";
  let out = `For ${mins} minutter 16 mm (${label}) og ${rolls} ${rolls===1?"rull":"ruller"} er prisen ca ${nok(total)} kr.`;
  out += " USB/minnepenn kommer i tillegg (fra 295 kr).";
  out += " Dette er et estimat – kontakt oss gjerne for nøyaktig tilbud.";
  return { answer: out, source: "Pris" };
}

function priceVideo({ minutes }, prices){
  const perTime = toNum(prices?.vhs_per_time ?? prices?.video_per_time ?? prices?.vhs_per_time_kr ?? 315);
  const usbMin  = toNum(prices?.usb_min_price ?? prices?.minnepenn ?? 295);
  if (minutes == null){
    return {
      answer: `Video prises per time digitalisert opptak (${perTime} kr/time). Oppgi gjerne samlet spilletid, så beregner jeg et estimat. USB/minnepenn i tillegg (fra ${usbMin} kr).`,
      source: "Pris"
    };
  }
  const hrs = Math.max(0, toInt(minutes))/60;
  let disc = 0;
  if (hrs >= 20) disc = 0.20;
  else if (hrs >= 10) disc = 0.10;
  const total = round5(hrs * perTime * (1 - disc));
  let out = `Video prises per time digitalisert opptak (${perTime} kr/time). For ${hrs.toFixed(1)} timer blir prisen ca ${nok(total)} kr.`;
  if (disc>0) out += ` (Inkluderer ${(disc*100).toFixed(0)}% rabatt.)`;
  out += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
  return { answer: out, source: "Pris" };
}

/* -------------------- handler -------------------- */
export default async function handler(req, res){
  // CORS
  try {
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
  } catch {
    // continue; never 500 on CORS
  }

  let body = {};
  try {
    // Next.js usually parses JSON already, but guard both ways
    if (typeof req.body === "object" && req.body !== null) {
      body = req.body;
    } else if (typeof req.body === "string") {
      body = JSON.parse(req.body || "{}");
    } else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString("utf8");
      body = JSON.parse(raw || "{}");
    }
  } catch {
    body = {};
  }

  try {
    const message = (body?.message || "").trim();
    const history = Array.isArray(body?.history) ? body.history : [];
    if (!message) {
      return res.status(200).json({ answer: "Si gjerne litt mer om hva du lurer på, så hjelper jeg deg.", source: "AI" });
    }

    const { faq, prices } = loadData();

    // purchase / repair / delivery
    const purchase = handlePurchaseIntent(message, prices);
    if (purchase) return res.status(200).json(purchase);

    const repair = handleCassetteRepair(message);
    if (repair) return res.status(200).json(repair);

    const delivery = handleDelivery(message);
    if (delivery) return res.status(200).json(delivery);

    // FAQ
    const kbHits = simpleSearch(message, faq);
    if (kbHits?.[0]?.a) return res.status(200).json({ answer: kbHits[0].a, source: "FAQ" });

    // Film intents
    const parsed = parseCombinedFilm(message, history);

    // S8/8 mm via diametre
    if (parsed.isS8 && parsed.diameters.length){
      const mins = estimateS8MinutesFromDiameters(parsed.diameters, parsed.isSuper8);
      const rolls = parsed.rollsS8 ?? parsed.diameters.length || 1;
      const hasSound = /lyd/i.test(message);
      return res.status(200).json( priceS8Std({ minutes: mins, rolls, prices, hasSound }) );
    }
    // S8/8 mm via minutter
    if (parsed.isS8 && parsed.minutesAny != null){
      const rolls = parsed.rollsS8 ?? 1;
      const hasSound = /lyd/i.test(message);
      return res.status(200).json( priceS8Std({ minutes: parsed.minutesAny, rolls, prices, hasSound }) );
    }
    // S8 veiledning
    if (parsed.isS8){
      const guide =
        "For å anslå spilletid per rull: oppgi diameter på spolene og om det er 8 mm eller Super 8.\n" +
        "Tommelfingerverdier per rull:\n" +
        "• 7,5 cm → 8 mm: ca 4 min | Super 8: ca 4 min\n" +
        "• 12–13 cm → 8 mm: ca 16 min | Super 8: ca 12 min\n" +
        "• 14–15 cm → 8 mm: ca 22 min | Super 8: ca 18 min\n" +
        "• 17–18 cm → 8 mm: ca 32 min | Super 8: ca 24 min\n" +
        "Skriv for eksempel: «2 ruller, 12,7 cm, Super 8». Da kan jeg regne total tid og pris.";
      return res.status(200).json({ answer: guide, source: "AI" });
    }

    // 16 mm
    if (parsed.is16){
      if (parsed.minutesAny != null){
        return res.status(200).json( price16mm({ minutes: parsed.minutesAny, rolls: 1, sound: parsed.sound16 }) );
      }
      return res.status(200).json({
        answer: "For 16 mm: oppgi minutter (eller meter) per rull, og om lyden er optisk eller magnetisk. Skriv f.eks.: «16 mm: 35 min, optisk lyd».",
        source: "AI"
      });
    }

    // Video (VHS/Hi8/MiniDV)
    if (/(vhs|videokassett|videobånd|hi8|video8|minidv|vhsc)/i.test(message)){
      const minutes = extractMinutes(message) ?? historyFind(history, extractMinutes);
      return res.status(200).json( priceVideo({ minutes }, prices) );
    }

    // LLM fallback (kept but fully guarded)
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY){
      return res.status(200).json({
        answer: "Beklager, jeg har ikke et godt svar på dette akkurat nå. Send oss gjerne e-post på kontakt@lunamedia.no eller ring 33 74 02 80.",
        source:"fallback_no_key"
      });
    }

    const guard =
      "Ikke finn opp fakta om personer eller samarbeidspartnere. " +
      "Hvis du blir spurt om hvem som jobber i Luna Media eller konkrete samarbeid, svar nøkternt at du ikke kan bekrefte dette her og henvis til e-post/telefon. " +
      "Ikke bruk markdown-stjerner.";
    const system = [
      'Du er "Luna" – en vennlig og presis assistent for Luna Media (Vestfold).',
      "Svar kort på norsk (2–3 setninger). Bruk konkrete tall bare når du er sikker.",
      guard
    ].join("\n");

    let answer =
      "Beklager, jeg har ikke et godt svar på dette akkurat nå. Send oss gjerne e-post på kontakt@lunamedia.no eller ring 33 74 02 80.";

    let data = null;
    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: process.env.LUNA_MODEL || "gpt-4o-mini",
          temperature:0.3, max_tokens:300,
          messages: [
            { role:"system", content: system },
            ...history.slice(-12),
            { role:"user", content: `Kunde spør: ${message}\nSvar kort, konkret, og ikke bruk markdown-stjerner.` }
          ]
        })
      });
      const raw = await resp.text();
      try { data = JSON.parse(raw); } catch { data = null; }
      if (resp.ok) {
        const content = data?.choices?.[0]?.message?.content?.trim();
        if (content) answer = stripMdStars(content);
      }
    } catch {
      // ignore – use fallback answer
    }

    return res.status(200).json({ answer, source:"AI" });

  } catch (err){
    console.error("assist.js runtime error:", err?.stack || err?.message || err);
    return res.status(200).json({
      answer: "Oi, her oppsto det et teknisk problem. Kan du prøve på nytt, eller kontakte oss på kontakt@lunamedia.no?",
      source: "fallback_runtime_error"
    });
  }
}

// Optional: keep Node runtime (fs not allowed on Edge)
export const config = { api: { bodyParser: false } };
