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
    const raw = fs.readFileSync(file, "utf8");
    if (kind === "json") return JSON.parse(raw);
    if (kind === "yaml") return yaml.load(raw);
    return raw;
  } catch { return null; }
}
const toInt = (v, d=0) => {
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : d;
};
const toNum = (v, d=0) => Number.isFinite(Number(v)) ? Number(v) : d;
const nok = (n) => toNum(n,0).toLocaleString("no-NO");
const round5 = (n) => Math.round(n/5)*5;

function normalize(s=""){
  return (s+"").toLowerCase().normalize("NFKD");
}
const NO_WORDNUM = {
  "null":0,"en":1,"ett":1,"ei":1,"to":2,"tre":3,"fire":4,"fem":5,"seks":6,"sju":7,"syv":7,
  "åtte":8,"ni":9,"ti":10,"elleve":11,"tolv":12,"tretten":13,"fjorten":14,"femten":15,
  "seksten":16,"sytten":17,"atten":18,"nitten":19,"tjue":20
};
function wordToNum(w){
  const k = normalize(w).replace(/[^a-zæøå]/g,"");
  return NO_WORDNUM.hasOwnProperty(k) ? NO_WORDNUM[k] : null;
}

/* -------------------- data -------------------- */
function loadData() {
  const faqCandidates = [
    path.join(__dirname, "..", "data", "faq.yaml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yaml"),
    path.join(__dirname, "..", "knowledge", "luna.yml"),
  ];
  let faq = []; let prices = {};
  for (const p of faqCandidates) {
    if (!fs.existsSync(p)) continue;
    const parsed = safeRead(p, "yaml");
    if (!parsed) continue;
    if (p.endsWith("luna.yml")) {
      const f =
        Array.isArray(parsed?.faq) ? parsed.faq :
        Array.isArray(parsed?.knowledge?.faq) ? parsed.knowledge.faq : [];
      if (f?.length) faq = faq.concat(f);
      const pr = parsed?.priser || parsed?.prices || parsed?.company?.prices;
      if (pr && typeof pr === "object") prices = { ...prices, ...pr };
    } else {
      const items = Array.isArray(parsed) ? parsed : (parsed?.faq || []);
      if (items?.length) faq = faq.concat(items);
    }
  }
  const priceJson = safeRead(path.join(__dirname, "..", "data", "priser.json"), "json");
  if (priceJson && typeof priceJson === "object") prices = { ...prices, ...priceJson };
  return { faq, prices };
}

/* -------------------- FAQ search -------------------- */
function normTokens(s){ return normalize(s).replace(/[^\p{Letter}\p{Number}\s]/gu," ").replace(/\s+/g," ").trim().split(" "); }
function jaccard(aTokens,bTokens){
  if(!aTokens.length||!bTokens.length) return 0;
  const a=new Set(aTokens), b=new Set(bTokens);
  const inter=[...a].filter(x=>b.has(x)).length;
  const uni=new Set([...a,...b]).size;
  return inter/uni;
}
function simpleSearch(userMessage, faqArray, minScore=0.65){
  const qTokens = normTokens(userMessage);
  let best=null;
  for(const item of faqArray||[]){
    const candidates=[item.q, ...(item.alt||[])].map(x=>normTokens(x));
    let bestLocal=0;
    for(const cand of candidates){
      const score=jaccard(qTokens,cand);
      if(score>bestLocal) bestLocal=score;
    }
    if(!best || bestLocal>best.score) best={ item, score:bestLocal };
  }
  if(best && best.score>=minScore) return [{ a:best.item.a, score:best.score, q:best.item.q }];
  return [];
}

/* -------------------- Intents: purchase & repair -------------------- */
const PURCHASE_WORDS = [
  "kjøpe","kjøp","selger","bestille","pris på usb","minnepenn","ramme","rammer","fotoutskrift","print","fine art","papir","tomme videokassetter","tom kassett","blank kassett","dvd-plater","cd-plater"
];
function looksLikePurchase(msg){ const m=normalize(msg); return PURCHASE_WORDS.some(w=>m.includes(w)); }
function mentions(m, arr){ const s=normalize(m); return arr.some(w=>s.includes(w)); }

function handlePurchaseIntent(message, prices={}){
  if(!looksLikePurchase(message)) return null;
  const m = message.toLowerCase();
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
        "Ja, vi selger USB/minnepenner i ulike størrelser (god kvalitet). Pris fra ca. " + usbMin + " kr. Si gjerne hvor mye lagringsplass du trenger (for eksempel 32/64/128 GB), så foreslår vi riktig størrelse.",
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

// Kassett-reparasjon
const REPAIR_WORDS = ["ødelagt kassett","reparere kassett","kassett ødelagt","bånd brutt","spole gått av","reparasjon kassett","fixe kassett"];
function handleCassetteRepair(message){
  const m = normalize(message);
  if(!REPAIR_WORDS.some(w=>m.includes(w))) return null;
  return {
    answer:
      "Ja – vi reparerer videokassetter (VHS, VHSc, Video8/Hi8, MiniDV m.fl.). Vi skjøter brudd i båndet, bytter hus/spole ved behov og kan ofte redde innholdet. Pris avhenger av skadeomfang og antall kassetter – be gjerne om tilbud, så vurderer vi saken og kostnaden før vi begynner.",
    source: "AI"
  };
}

/* -------------------- Parsing helpers -------------------- */
function extractMinutes(text=""){
  const m = normalize(text);
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
function extractCount(text="", word){
  const m = normalize(text);
  const d = m.match(new RegExp("(\\d{1,3})\\s*"+word+"\\b"));
  if (d) return toInt(d[1]);
  const w = m.match(new RegExp("([a-zæøå]+)\\s*"+word+"\\b"));
  if (w){ const n = wordToNum(w[1]); if(n!=null) return n; }
  return null;
}
function extractDiameters(text=""){
  // returns array of numbers in cm
  const nums = [];
  const re = /(\d{1,2}(?:[.,]\d)?)\s*cm\b/gi;
  let m;
  while((m = re.exec(text))){ nums.push(parseFloat(m[1].replace(",", "."))); }
  return nums;
}
function historyFind(history, fn){
  if(!Array.isArray(history)) return null;
  for(let i=history.length-1;i>=0;i--){
    const h=history[i];
    if (h?.role!=="user") continue;
    const v = fn(h.content||"");
    if (v!=null && (Array.isArray(v)? v.length : true)) return v;
  }
  return null;
}

/* -------------------- Smalfilm/S8 estimator -------------------- */
// Minutes per spool, by nearest diameter (cm)
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

// 8mm/S8 standard prising (minutter + startgebyr per rull)
function priceS8Std({ minutes, rolls, prices, hasSound=false }){
  const perMinBase = toNum(prices.smalfilm_min_rate ?? prices.smalfilm_per_minutt ?? 75);
  const startGeb   = toNum(prices.smalfilm_start_per_rull ?? 95);
  // S8 med lyd: +100/20min => +5 kr/min
  const perMin = hasSound ? perMinBase + 5 : perMinBase;
  const usbMin = toNum(prices.usb_min_price ?? prices.minnepenn ?? 295);
  const mins   = Math.max(0, toInt(minutes));
  const r      = Math.max(1, toInt(rolls ?? 1));
  const disc   = smalfilmDiscount(mins);
  const total  = round5(mins * perMin * (1 - disc) + r * startGeb);
  let out = `For ${mins} minutter smalfilm og ${r} ${r===1?"rull":"ruller"} er prisen ca ${nok(total)} kr.`;
  if (disc>0) out += ` (Rabatt er inkludert: ${(disc*100).toFixed(0)}% for ${(mins/60).toFixed(1)} timer totalt.)`;
  out += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
  out += ` Det vil alltid være noen usikre variabler i utregning av lengde på smalfilm dersom du ikke vet dette eksakt. Betrakt derfor svaret som et estimat, og kontakt oss gjerne per telefon eller e-post for et sikrere estimat og eventuelt pristilbud.`;
  return { answer: out, source: "Pris" };
}

// 16mm prising
function price16mm({ minutes, rolls=1, sound="none" /* "magnetisk" | "optisk" | "none" */ }){
  // base 1795/20min => 89.75 / min
  let perMin = 1795/20;
  const start = 125 * Math.max(1, toInt(rolls));
  if (sound === "magnetisk") perMin += 200/20;  // +10/min
  if (sound === "optisk")    perMin  = 2990/20; // 149.5/min (optisk erstatter base)
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

// Video (VHS/Hi8/MiniDV) prising
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

/* -------------------- Film intent parsing (8mm/S8 + 16mm) -------------------- */
function looksLikeS8or8mm(msg){
  const m = normalize(msg);
  return /(super\s*8|s8\b|8\s*mm|8mm|dobbel[-\s]?8|d8\b)/.test(m);
}
function looksLike16mm(msg){
  return /\b16\s*mm\b|\b16mm\b/.test(normalize(msg));
}
function extractSound16(msg){
  const m = normalize(msg);
  if (/\boptisk\b/.test(m)) return "optisk";
  if (/\bmagnetisk\b/.test(m)) return "magnetisk";
  return "none";
}
function parseCombinedFilm(message, history){
  const m = message;
  const isS8 = looksLikeS8or8mm(m) || looksLikeS8or8mm(historyFind(history,h=>h)||"");
  const is16 = looksLike16mm(m)    || looksLike16mm(historyFind(history,h=>h)||"");

  const diamsNow = extractDiameters(m);
  const diamsHist= historyFind(history, extractDiameters) || [];
  const diameters = (diamsNow.length?diamsNow:[]).concat(diamsHist.length?diamsHist:[]);

  // Identify if user said "super 8" explicitly
  const isSuper8 = /super\s*8|s8\b/.test(normalize(m)) || /super\s*8|s8\b/.test(normalize(historyFind(history,h=>h)||""));

  // Count rolls if given
  const rollsS8 = extractCount(m, "rull") ?? extractCount(m, "ruller");
  const rollsHist = historyFind(history, t => extractCount(t, "rull") ?? extractCount(t,"ruller")) ?? null;

  const minutesAny = extractMinutes(m);
  const minutesHist = historyFind(history, extractMinutes);

  // 16mm specifics
  const sound16 = extractSound16(m) || extractSound16(historyFind(history,h=>h)||"");

  return {
    isS8, is16,
    diameters, isSuper8,
    rollsS8: rollsS8 ?? rollsHist,
    minutesAny: minutesAny ?? minutesHist,
    sound16
  };
}

/* -------------------- handler -------------------- */
export default async function handler(req, res){
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
    if (!message) return res.status(400).json({ error:"Missing message" });

    const { faq, prices } = loadData();

    // 0) Hard intents: purchase / repair
    const purchase = handlePurchaseIntent(message, prices);
    if (purchase) return res.status(200).json(purchase);

    const repair = handleCassetteRepair(message);
    if (repair) return res.status(200).json(repair);

    // 1) FAQ
    const kbHits = simpleSearch(message, faq);
    if (kbHits?.[0]?.a) return res.status(200).json({ answer: kbHits[0].a, source: "FAQ" });

    // 2) Film intents (S8/8mm + 16mm) — combined & follow-ups
    const parsed = parseCombinedFilm(message, history);

    // If S8 diameters were provided, estimate minutes and price
    if (parsed.isS8 && parsed.diameters.length){
      const mins = estimateS8MinutesFromDiameters(parsed.diameters, parsed.isSuper8);
      const rolls = parsed.rollsS8 ?? parsed.diameters.length || 1;
      const hasSound = /lyd/.test(normalize(message)); // enkel heuristikk
      return res.status(200).json(
        priceS8Std({ minutes: mins, rolls, prices, hasSound })
      );
    }

    // If S8 mentioned with minutes directly:
    if (parsed.isS8 && parsed.minutesAny != null){
      const rolls = parsed.rollsS8 ?? 1;
      const hasSound = /lyd/.test(normalize(message));
      return res.status(200).json(
        priceS8Std({ minutes: parsed.minutesAny, rolls, prices, hasSound })
      );
    }

    // If user asks "hvordan beregne" / mangler data for S8
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

    // 16 mm intent
    if (parsed.is16){
      // minutes known?
      if (parsed.minutesAny != null){
        return res.status(200).json(
          price16mm({ minutes: parsed.minutesAny, rolls: 1, sound: parsed.sound16 })
        );
      }
      // ask for minutes/meters + lyd
      const ask =
        "For 16 mm trenger jeg minutter (eller meter) per rull, og om lyden er optisk eller magnetisk. Skriv for eksempel: «16 mm: 35 min, optisk lyd».";
      return res.status(200).json({ answer: ask, source: "AI" });
    }

    // Video (VHS/Hi8/MiniDV) — hvis melding inneholder disse
    if (/(vhs|videokassett|videobånd|hi8|video8|minidv|vhsc)/i.test(message)){
      const minutes = extractMinutes(message) ?? historyFind(history, extractMinutes);
      return res.status(200).json( priceVideo({ minutes }, prices) );
    }

    // 3) LLM fallback – med forsiktighet rundt påstander om personer/partnere
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const model = process.env.LUNA_MODEL || "gpt-4o-mini";

    const guard =
      "Ikke finn opp fakta om personer eller samarbeidspartnere. Hvis du blir spurt om hvem som jobber i Luna Media eller konkrete samarbeid, svar nøkternt at du ikke kan bekrefte dette her og henvis til e-post/telefon for avklaring.";

    const system = [
      'Du er "Luna" – en vennlig og presis assistent for Luna Media (Vestfold).',
      "Svar kort på norsk (2–3 setninger). Bruk konkrete tall bare når du er sikker.",
      guard
    ].join("\n");

    let answer =
      "Beklager, jeg har ikke et godt svar på dette akkurat nå. Send oss gjerne en e-post på kontakt@lunamedia.no eller ring 33 74 02 80.";

    if (!OPENAI_API_KEY){
      return res.status(200).json({ answer, source:"fallback_no_key" });
    }

    try{
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model, temperature:0.3, max_tokens:300,
          messages: [
            { role:"system", content: system },
            ...history.slice(-12),
            { role:"user", content: `Kunde spør: ${message}\nSvar kort, konkret, og ikke bruk markdown-stjerner.` }
          ]
        })
      });
      const text = await resp.text();
      let data; try{ data = JSON.parse(text); } catch { throw new Error("OpenAI JSON parse error: " + text); }
      if (!resp.ok) throw new Error(data?.error?.message || `OpenAI ${resp.status}`);
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (content) answer = content.replace(/\*\*/g,""); // fjern ev. stjerner
      return res.status(200).json({ answer, source:"AI" });
    } catch (e){
      console.error("OpenAI-kall feilet:", e?.message);
      return res.status(200).json({ answer, source:"fallback_openai_error" });
    }

  } catch (err){
    console.error("Handler-feil:", err);
    return res.status(500).json({ error:"Server error" });
  }
}
