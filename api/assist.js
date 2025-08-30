// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ---------------- utils ---------------- */
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

/* --------------- load data --------------- */
function loadData() {
  const faqCandidates = [
    path.join(__dirname, "..", "data", "faq.yaml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yaml"),
    path.join(__dirname, "..", "knowledge", "luna.yml"),
  ];
  let faq = []; let prices = {};
  const tried=[], loaded=[];
  for (const p of faqCandidates) {
    const isLuna = p.endsWith("luna.yml");
    const exists = fs.existsSync(p);
    tried.push({ path:p, exists, size: exists ? fs.statSync(p).size : 0 });
    if (!exists) continue;
    const parsed = safeRead(p, "yaml"); if (!parsed) continue;
    loaded.push({ path:p, size: fs.statSync(p).size });

    if (isLuna) {
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
    loaded.push({ path: "priser.json", size: JSON.stringify(priceJson).length });
  }
  return { faq, prices, tried, loaded };
}

/* --------------- FAQ search --------------- */
function normalize(s=""){
  return (s+"").toLowerCase().normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu," ")
    .replace(/\s+/g," ").trim();
}
function jaccard(aTokens,bTokens){
  if(!aTokens.length||!bTokens.length) return 0;
  const a=new Set(aTokens), b=new Set(bTokens);
  const inter=[...a].filter(x=>b.has(x)).length;
  const uni=new Set([...a,...b]).size;
  return inter/uni;
}
function simpleSearch(userMessage, faqArray, minScore=0.65){
  const qNorm=normalize(userMessage), qTokens=qNorm.split(" ");
  let best=null;
  for(const item of faqArray||[]){
    const candidates=[item.q, ...(item.alt||[])].map(normalize).filter(Boolean);
    let bestLocal=0;
    for(const cand of candidates){
      const score=jaccard(qTokens, cand.split(" "));
      if(score>bestLocal) bestLocal=score;
    }
    if(!best || bestLocal>best.score) best={ item, score:bestLocal };
  }
  if(best && best.score>=minScore) return [{ a:best.item.a, score:best.score, q:best.item.q }];
  return [];
}

/* --------------- price intents --------------- */
// helpers to pull minutes / ruller from any text
function extractMinutes(text=""){
  const m = (text||"").toLowerCase();
  const mm = m.match(/(\d{1,4})\s*(min|minutt|minutter)/);
  const hh = m.match(/(\d{1,3})\s*(t|time|timer)/);
  if (mm) return toInt(mm[1]);
  if (hh) return toInt(hh[1]) * 60;
  return null;
}
function extractRuller(text=""){
  const m = (text||"").toLowerCase().match(/(\d{1,3})\s*(rull|ruller)/);
  return m ? toInt(m[1]) : null;
}

// parse current message (loose)
function parseSmalfilmLoose(text=""){
  const m = text.toLowerCase();
  const hasFilm = /(smalfilm|super\s*8|super8|8\s*mm|8mm|16\s*mm|16mm)/.test(m);
  const mentionsRullOnly = /(rull|ruller)/.test(m);
  const minutter = extractMinutes(m);
  const ruller   = extractRuller(m);
  return { hasFilm, mentionsRullOnly, minutter, ruller };
}
// scan history to find last smalfilm context
function historySmalfilm(history=[]){
  let ctx = { hasFilm:false, minutter:null, ruller:null };
  for (let i = history.length-1; i>=0; i--){
    const t = (history[i]?.content||"").toLowerCase();
    const hasFilm = /(smalfilm|super\s*8|super8|8\s*mm|8mm|16\s*mm|16mm)/.test(t);
    const min = extractMinutes(t);
    const rul = extractRuller(t);
    if (hasFilm) ctx.hasFilm = true;
    if (min != null && ctx.minutter == null) ctx.minutter = min;
    if (rul != null && ctx.ruller   == null) ctx.ruller   = rul;
    if (ctx.hasFilm && ctx.minutter!=null && ctx.ruller!=null) break;
  }
  return ctx;
}

function smalfilmDiscount(totalMinutes){
  if (totalMinutes >= 360) return 0.20;   // ≥ 6 t
  if (totalMinutes >  180) return 0.10;   // > 3 t
  return 0;
}

function priceSmalfilm(minutter, ruller, prices){
  const perMin   = toNum(prices.smalfilm_min_rate ?? prices.smalfilm_per_minutt ?? 75);
  const startGeb = toNum(prices.smalfilm_start_per_rull ?? 95);
  const usbMin   = toNum(prices.usb_min_price ?? prices.minnepenn ?? 295);

  if (minutter == null){
    const txt = [
      `Smalfilm prises med ca. ${perMin} kr per minutt + ${startGeb} kr i startgebyr per rull.`,
      `Vi gir 10% rabatt når samlet spilletid er over 3 timer, og 20% rabatt over 6 timer.`,
      `Oppgi gjerne antall minutter og ruller for et konkret prisestimat. USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`
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

  return { answer: out, source: "Pris" };
}

// video (VHS/Hi8/Video8/MiniDV)
function parseVideoIntent(text=""){
  const m = text.toLowerCase();
  if (!/(vhs|videokassett|videobånd|hi8|video8|minidv|vhsc)/.test(m)) return null;
  const minutter = extractMinutes(m);
  const kMatch   = m.match(/(\d{1,3})\s*(kassett|kassetter|bånd|videobånd)/);
  const kassetter= kMatch ? toInt(kMatch[1]) : null;
  return { minutter, kassetter };
}
function minutesFromHistory(history=[]){
  for (let i = history.length-1; i>=0; i--){
    const n = extractMinutes(history[i]?.content||"");
    if (n != null) return n;
  }
  return null;
}
function priceVideo({minutter, kassetter}, prices){
  const perTime = toNum(
    prices.vhs_per_time ?? prices.video_per_time ?? prices.vhs_per_time_kr ?? 315
  );
  const usbMin  = toNum(prices.usb_min_price ?? prices.minnepenn ?? 295);

  if (minutter != null){
    const min = Math.max(0, toInt(minutter));
    const hrs = min/60;
    let disc = 0;
    if (hrs >= 20) disc = 0.20;
    else if (hrs >= 10) disc = 0.10;
    const total = round5(hrs * perTime * (1 - disc));
    let txt = `Video prises pr time digitalisert opptak (${perTime} kr/time). For ${hrs.toFixed(1)} timer blir prisen ca ${nok(total)} kr.`;
    if (disc>0) txt += ` (Inkluderer ${(disc*100).toFixed(0)}% rabatt.)`;
    txt += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
    return { answer: txt, source: "Pris" };
  }

  if (kassetter != null){
    const k = Math.max(1, toInt(kassetter));
    const lowH = k * 1.0, highH = k * 2.0; // 60–120 min pr kassett (anslag)
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

/* --------------- handler --------------- */
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
    const debug   = !!body.debug;
    if (!message) return res.status(400).json({ error:"Missing message" });

    const { faq, prices, tried, loaded } = loadData();
    if (debug){
      console.log("DATA DEBUG — counts:", { faq:faq.length, priceKeys:Object.keys(prices||{}).length });
    }

    // 1) FAQ
    const kbHits = simpleSearch(message, faq);
    if (kbHits?.[0]?.a) {
      const payload = { answer: kbHits[0].a, source: "FAQ" };
      if (debug) payload._debug = { score: kbHits[0].score, matchedQuestion: kbHits[0].q };
      return res.status(200).json(payload);
    }

    // 2) Price intents (context-aware)
    // 2a) If message mentions a *video* format (incl. hi8/video8/minidv), go video path first
    const videoIntent = parseVideoIntent(message);
    if (videoIntent) {
      // pull minutes from history if omitted
      if (videoIntent.minutter == null) videoIntent.minutter = minutesFromHistory(history);
      const out = priceVideo(videoIntent, prices);
      if (debug) out._debug = { intent:"video", videoIntent };
      return res.status(200).json(out);
    }

    // 2b) Smalfilm with context
    const smNow  = parseSmalfilmLoose(message);
    const smHist = historySmalfilm(history);
    const shouldSmalfilm =
      smNow.hasFilm
      || (smNow.mentionsRullOnly && (smHist.hasFilm || smHist.minutter!=null));

    if (shouldSmalfilm){
      const minutter = smNow.minutter ?? smHist.minutter ?? null;
      const ruller   = smNow.ruller   ?? smHist.ruller   ?? null;
      const out = priceSmalfilm(minutter, ruller, prices);
      if (debug) out._debug = { intent:"smalfilm", smNow, smHist };
      return res.status(200).json(out);
    }

    // 3) LLM fallback
    const system = [
      'Du er "Luna" – en vennlig og presis AI-assistent for Luna Media (Vestfold).',
      "Svar kort på norsk. Bruk priseksempler og FAQ nedenfor når relevant.",
      "Hvis noe er uklart eller pris mangler: si det, og foreslå tilbud via skjema/e-post.",
      "",
      "Priser (kan være tomt):",
      JSON.stringify(prices, null, 2)
    ].join("\n");

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const model = process.env.LUNA_MODEL || "gpt-4o-mini";
    const user = `Kunde spør: ${message}\nSvar på norsk, maks 2–3 setninger.`;

    let answer = "Beklager, jeg har ikke et godt svar på dette akkurat nå. Send oss gjerne e-post på kontakt@lunamedia.no eller ring 33 74 02 80.";

    if (!OPENAI_API_KEY){
      return res.status(200).json({ answer, source:"fallback_no_key" });
    }

    try{
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method:"POST",
        headers:{ "Content-Type":"application/json", "Authorization":`Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model, temperature:0.3, max_tokens:400,
          messages: [
            { role:"system", content: system },
            ...history,
            { role:"user", content: user }
          ]
        })
      });
      const text = await resp.text();
      let data; try{ data = JSON.parse(text); } catch { throw new Error("OpenAI JSON parse error: " + text); }
      if (!resp.ok) throw new Error(data?.error?.message || `OpenAI feilkode ${resp.status}`);
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (content) answer = content;
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
