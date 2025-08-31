// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* -------------------- tiny utils -------------------- */
const lc  = (s="") => s.toLowerCase();
const nok = (n) => Number(n || 0).toLocaleString("no-NO");
const toInt = (v,d=0)=>{ const n=parseInt(String(v).replace(/[^\d-]/g,""),10); return Number.isFinite(n)?n:d; };
const toNum = (v,d=0)=> Number.isFinite(Number(v)) ? Number(v) : d;
const round5 = (n)=> Math.round(n/5)*5;
const stripMd = (s="")=> s.replace(/\*\*/g,"");

/* Keep it ASCII-safe */
const clean = (s="") => s.normalize("NFKD");

/* Safe file/YAML/JSON load (never throws) */
function safeRead(file, kind="text"){
  try{
    if(!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file,"utf8");
    if(kind==="json") return JSON.parse(raw);
    if(kind==="yaml") return yaml.load(raw);
    return raw;
  }catch{ return null; }
}

/* -------------------- data load (optional) -------------------- */
function loadData(){
  try{
    const faqCandidates = [
      path.join(__dirname, "..", "data", "faq.yaml"),
      path.join(__dirname, "..", "knowledge", "faq_round1.yml"),
      path.join(__dirname, "..", "knowledge", "faq_round1.yaml"),
      path.join(__dirname, "..", "knowledge", "luna.yml"),
    ];
    let faq = []; let prices = {};
    for(const p of faqCandidates){
      const doc = safeRead(p, "yaml");
      if(!doc) continue;
      if(p.endsWith("luna.yml")){
        const items = Array.isArray(doc?.faq) ? doc.faq
                    : Array.isArray(doc?.knowledge?.faq) ? doc.knowledge.faq : [];
        if(items?.length) faq = faq.concat(items);
        const pr = doc?.priser || doc?.prices || doc?.company?.prices;
        if(pr && typeof pr === "object") prices = { ...prices, ...pr };
      }else{
        const items = Array.isArray(doc) ? doc : (doc?.faq || []);
        if(items?.length) faq = faq.concat(items);
      }
    }
    const pj = safeRead(path.join(__dirname,"..","data","priser.json"),"json");
    if(pj && typeof pj==="object") prices = { ...prices, ...pj };
    return { faq, prices };
  }catch{
    return { faq: [], prices: {} };
  }
}

/* -------------------- FAQ search (simple, safe) -------------------- */
function tokens(s=""){
  return clean(s)
    .replace(/[^a-z0-9æøå\s]/gi," ")
    .toLowerCase()
    .replace(/\s+/g," ")
    .trim()
    .split(" ")
    .filter(Boolean);
}
function jaccard(a,b){
  if(!a.length||!b.length) return 0;
  const A=new Set(a), B=new Set(b);
  const inter=[...A].filter(x=>B.has(x)).length;
  const uni=new Set([...A,...B]).size;
  return inter/uni;
}
function simpleSearch(q, faq, min=0.65){
  const qt = tokens(q);
  let best=null;
  for(const it of faq||[]){
    const cand = [it.q, ...(it.alt||[])]
      .map(tokens);
    let score=0;
    for(const c of cand) score=Math.max(score,jaccard(qt,c));
    if(!best||score>best.score) best={it,score};
  }
  if(best && best.score>=min) return [{ a: stripMd(best.it?.a||"") }];
  return [];
}

/* -------------------- extractors -------------------- */
const NO_WORDNUM = { "null":0,"en":1,"ett":1,"ei":1,"to":2,"tre":3,"fire":4,"fem":5,"seks":6,"sju":7,"syv":7,"åtte":8,"ni":9,"ti":10 };
function wordToNum(w){ const k=clean(w).toLowerCase().replace(/[^a-zæøå]/g,""); return NO_WORDNUM[k] ?? null; }

function extractMinutes(t=""){
  const m = clean(t).toLowerCase();
  const mm = m.match(/(\d{1,4})\s*(min|minutt|minutter)\b/);
  const hh = m.match(/(\d{1,3})\s*(t|time|timer)\b/);
  if(mm) return toInt(mm[1]);
  if(hh) return toInt(hh[1])*60;
  const wm = m.match(/([a-zæøå]+)\s*(min|minutt|minutter)\b/);
  const wh = m.match(/([a-zæøå]+)\s*(t|time|timer)\b/);
  if(wm){ const n=wordToNum(wm[1]); if(n!=null) return n; }
  if(wh){ const n=wordToNum(wh[1]); if(n!=null) return n*60; }
  return null;
}
function extractCount(t="", word){
  const m = clean(t).toLowerCase();
  const d = m.match(new RegExp("(\\d{1,3})\\s*"+word+"\\b"));
  if(d) return toInt(d[1]);
  const w = m.match(new RegExp("([a-zæøå]+)\\s*"+word+"\\b"));
  if(w){ const n=wordToNum(w[1]); if(n!=null) return n; }
  return null;
}
function extractDiameters(t=""){
  const nums=[]; const re=/(\d{1,2}(?:[.,]\d)?)\s*cm\b/gi; let m;
  while((m=re.exec(t))) nums.push(parseFloat(m[1].replace(",", ".")));
  return nums;
}
function fromUserHistory(history, extractor){
  if(!Array.isArray(history)) return null;
  for(let i=history.length-1;i>=0;i--){
    const h=history[i]; if(h?.role!=="user") continue;
    const v = extractor(h.content||"");
    if(Array.isArray(v)? v.length: v!=null) return v;
  }
  return null;
}

/* -------------------- purchase / delivery / repair -------------------- */
const PURCHASE_WORDS = ["kjøpe","kjøp","selger","bestille","minnepenn","usb","ramme","rammer","fotoutskrift","print","fine art","papir","tomme videokassetter","tom kassett","blank kassett"];
function looksLikePurchase(msg){ const m=lc(msg); return PURCHASE_WORDS.some(w=>m.includes(w)); }

function handlePurchase(message, prices={}){
  if(!looksLikePurchase(message)) return null;
  const m=lc(message);
  const usbMin = Number(prices?.usb_min_price ?? prices?.minnepenn ?? 295);

  if ((m.includes("tom")||m.includes("tomme")||m.includes("blank")) && (m.includes("kassett")||m.includes("videokassett"))){
    return { answer: `Vi selger ikke tomme video-/VHS-kassetter. Vi digitaliserer derimot opptak. Til lagring selger vi USB/minnepenner i flere størrelser (fra ca. ${usbMin} kr) og vi tilbyr fotoutskrifter og rammer.`, source:"AI" };
  }
  if (m.includes("usb")||m.includes("minnepenn")){
    return { answer: `Ja, vi selger USB/minnepenner i ulike størrelser. Pris fra ca. ${usbMin} kr. Si gjerne hvor mye lagringsplass du trenger (f.eks. 32/64/128 GB).`, source:"AI" };
  }
  if (m.includes("fotoutskrift")||m.includes("print")||m.includes("fine art")||m.includes("ramme")){
    return { answer: "Ja, vi tilbyr fotoutskrifter i fine-art-kvalitet og rammer. Oppgi ønsket størrelse og antall (f.eks. 30×40 cm, 5 stk), så gir vi pris og leveringstid.", source:"AI" };
  }
  return { answer: "Vi selger USB/minnepenner, fotoutskrifter i fine-art-kvalitet og rammer. Si hva du ønsker (type, størrelse/kapasitet og antall), så får du pris og levering.", source:"AI" };
}

const DELIVERY_WORDS = ["levere","levering","post","send","adresse","hente","henting","innlevering","kan dere hente","hente i"];
function handleDelivery(message){
  const m=lc(message);
  if(!DELIVERY_WORDS.some(w=>m.includes(w))) return null;

  const hent = m.match(/\bhent[e]?\b.*\bi\s+([a-zæøå]+)/i);
  if(hent){
    const place = hent[1];
    return { answer: `Det kan hende vi kan hente i ${place}. Ta kontakt, så finner vi en god løsning. Ring 33 74 02 80 eller skriv til kontakt@lunamedia.no.`, source:"AI" };
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
  return { answer:text, source:"AI" };
}

const REPAIR_TRIGGERS = ["ødelagt kassett","reparere kassett","kassett ødelagt","bånd brutt","spole gått av","reparasjon kassett","fixe kassett"];
function handleRepair(message){
  const m=lc(message);
  if(!REPAIR_TRIGGERS.some(w=>m.includes(w))) return null;
  return { answer: "Ja – vi reparerer videokassetter (VHS, VHSc, Video8/Hi8, MiniDV m.fl.). Vi skjøter brudd i båndet, bytter hus/spole ved behov og kan ofte redde innholdet. Pris avhenger av skadeomfang og antall kassetter – be gjerne om tilbud.", source:"AI" };
}

/* -------------------- film helpers -------------------- */
function looksLikeS8or8mm(msg){ return /(super\s*8|\bs8\b|8\s*mm|8mm|dobbel[-\s]?8|\bd8\b)/i.test(msg); }
function looksLike16mm(msg){ return /\b16\s*mm\b|\b16mm\b/i.test(msg); }
function extractSound16(msg){
  const m=lc(msg);
  if (m.includes("optisk")) return "optisk";
  if (m.includes("magnetisk")) return "magnetisk";
  return "none";
}

/* S8 map (approx.) */
const S8_MAP = [
  { d: 7.5,  minutes: { s8: 4,  std8: 4  } },
  { d: 12.7, minutes: { s8: 12, std8: 16 } },
  { d: 14.5, minutes: { s8: 18, std8: 22 } },
  { d: 17.0, minutes: { s8: 24, std8: 32 } },
];
function nearestS8(d){
  if(!Number.isFinite(d)) return null;
  let best=null, diff=1e9;
  for(const row of S8_MAP){
    const dd=Math.abs(d-row.d);
    if(dd<diff){ diff=dd; best=row; }
  }
  return best;
}
function estimateS8MinutesFromDiameters(diams=[], isSuper8=true){
  let total=0;
  for(const d of diams){
    const row=nearestS8(d);
    if(row) total += isSuper8 ? row.minutes.s8 : row.minutes.std8;
  }
  return total;
}

/* pricing */
function smalfilmDiscount(totalMinutes){
  if (totalMinutes >= 360) return 0.20;   // ≥ 6 t
  if (totalMinutes >  180) return 0.10;   // > 3 t
  return 0;
}
function priceSmalfilm({ minutes, rolls=1, prices, hasSound=false }){
  const perMinBase = toNum(prices?.smalfilm_min_rate ?? prices?.smalfilm_per_minutt ?? 75);
  const startGeb   = toNum(prices?.smalfilm_start_per_rull ?? 95);
  const perMin     = hasSound ? perMinBase + 5 : perMinBase; // S8 m/lyd +5/min
  const usbMin     = toNum(prices?.usb_min_price ?? prices?.minnepenn ?? 295);
  const mins       = Math.max(0, toInt(minutes));
  const r          = Math.max(1, toInt(rolls));
  const disc       = smalfilmDiscount(mins);
  const total      = round5(mins * perMin * (1 - disc) + r * startGeb);

  let out = `For ${mins} minutter smalfilm og ${r} ${r===1?"rull":"ruller"} er prisen ca ${nok(total)} kr.`;
  if (disc>0) out += ` (Rabatt er inkludert: ${(disc*100).toFixed(0)}% for ${(mins/60).toFixed(1)} timer totalt.)`;
  out += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
  out += ` Det vil alltid være noen usikre variabler i utregning av lengde på smalfilm dersom du ikke vet dette eksakt. Betrakt derfor svaret som et estimat, og kontakt oss gjerne per telefon eller e-post for et sikrere estimat og eventuelt pristilbud.`;
  return { answer: out, source:"Pris" };
}
function price16mm({ minutes, rolls=1, sound="none" }){
  // Base: 1795 per 20 min (89.75/min). Magnetisk +200/20 (=+10/min). Optisk = 2990/20 (=149.5/min).
  let perMin = 1795/20;
  if (sound === "magnetisk") perMin += 200/20;
  if (sound === "optisk")    perMin  = 2990/20;
  const start = 125 * Math.max(1, toInt(rolls));
  const mins  = Math.max(0, toInt(minutes));
  const total = round5(mins * perMin + start);
  const label = sound==="optisk" ? "med optisk lyd" : (sound==="magnetisk" ? "med magnetisk lyd" : "uten oppgitt lyd");
  let out = `For ${mins} minutter 16 mm (${label}) og ${rolls} ${rolls===1?"rull":"ruller"} er prisen ca ${nok(total)} kr. USB/minnepenn i tillegg (fra 295 kr). Dette er et estimat – be gjerne om nøyaktig tilbud.`;
  return { answer: out, source:"Pris" };
}
function priceVideo(minutes, prices){
  const perTime = toNum(prices?.vhs_per_time ?? prices?.video_per_time ?? prices?.vhs_per_time_kr ?? 315);
  const usbMin  = toNum(prices?.usb_min_price ?? prices?.minnepenn ?? 295);
  if(minutes==null){
    return { answer:`Video prises per time (${perTime} kr/time). Oppgi samlet spilletid, så beregner jeg et estimat. USB/minnepenn i tillegg (fra ${usbMin} kr).`, source:"Pris" };
  }
  const hrs = Math.max(0, toInt(minutes))/60;
  let disc = 0; if(hrs>=20) disc=0.20; else if(hrs>=10) disc=0.10;
  const total = round5(hrs * perTime * (1 - disc));
  let out = `Video prises per time (${perTime} kr/time). For ${hrs.toFixed(1)} timer blir prisen ca ${nok(total)} kr.`;
  if(disc>0) out += ` (Inkluderer ${(disc*100).toFixed(0)}% rabatt.)`;
  out += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
  return { answer: out, source:"Pris" };
}

/* -------------------- handler -------------------- */
export default async function handler(req, res){
  try{
    // CORS (simple & safe)
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

    // Body (use Next/Vercel default parser; also accept string)
    let body = req.body;
    if (typeof body === "string") { try{ body = JSON.parse(body); } catch{ body = {}; } }
    if (!body || typeof body !== "object") body = {};

    const message = (body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    if (!message) {
      return res.status(200).json({ answer: "Si gjerne litt mer om hva du lurer på, så hjelper jeg deg videre.", source:"AI" });
    }

    const { faq, prices } = loadData();

    // 1) Delivery / Repair / Purchase (fast paths)
    const delivery = handleDelivery(message); if (delivery) return res.status(200).json(delivery);
    const repair   = handleRepair(message);   if (repair)   return res.status(200).json(repair);
    const sales    = handlePurchase(message, prices); if (sales) return res.status(200).json(sales);

    // 2) FAQ
    const kb = simpleSearch(message, faq);
    if (kb?.[0]?.a) return res.status(200).json({ answer: kb[0].a, source:"FAQ" });

    // 3) Film pricing/intents
    const isS8  = looksLikeS8or8mm(message) || !!fromUserHistory(history, t=>looksLikeS8or8mm(t)?true:null);
    const is16  = looksLike16mm(message)     || !!fromUserHistory(history, t=>looksLike16mm(t)?true:null);

    // S8/8mm flow
    if (isS8){
      const diams  = extractDiameters(message);
      const diamsH = fromUserHistory(history, extractDiameters) || [];
      const diameters = diams.length? diams : diamsH;

      const rollsS8 = extractCount(message,"rull") ?? extractCount(message,"ruller")
                   ?? fromUserHistory(history, t => extractCount(t,"rull") ?? extractCount(t,"ruller"));
      const minsAny = extractMinutes(message) ?? fromUserHistory(history, extractMinutes);
      const isSuper8 = /\bs8\b|super\s*8/i.test(message) || !!fromUserHistory(history, t=> (/\bs8\b|super\s*8/i.test(t) ? true : null));
      const hasSound = /lyd/i.test(message) || /lyd/i.test(fromUserHistory(history, x=>x)||"");

      if (diameters?.length){
        const mins = estimateS8MinutesFromDiameters(diameters, isSuper8);
        const rolls = rollsS8 ?? diameters.length || 1;
        return res.status(200).json( priceSmalfilm({ minutes: mins, rolls, prices, hasSound }) );
      }
      if (minsAny!=null){
        const rolls = rollsS8 ?? 1;
        return res.status(200).json( priceSmalfilm({ minutes: minsAny, rolls, prices, hasSound }) );
      }

      const guide =
        "For å anslå spilletid per rull: oppgi diameter på spolene og om det er 8 mm eller Super 8.\n" +
        "Tommelfingerverdier pr rull:\n" +
        "• 7,5 cm → 8 mm: ca 4 min | Super 8: ca 4 min\n" +
        "• 12–13 cm → 8 mm: ca 16 min | Super 8: ca 12 min\n" +
        "• 14–15 cm → 8 mm: ca 22 min | Super 8: ca 18 min\n" +
        "• 17–18 cm → 8 mm: ca 32 min | Super 8: ca 24 min\n" +
        "Skriv f.eks.: «2 ruller, 12,7 cm, Super 8» – så regner jeg total tid og pris.";
      return res.status(200).json({ answer: guide, source:"AI" });
    }

    // 16 mm flow
    if (is16){
      const minutes16 = extractMinutes(message) ?? fromUserHistory(history, extractMinutes);
      const sound16   = extractSound16(message) || extractSound16(fromUserHistory(history, x=>x)||"");
      if (minutes16!=null) {
        return res.status(200).json( price16mm({ minutes: minutes16, rolls: 1, sound: sound16 }) );
      }
      return res.status(200).json({
        answer: "For 16 mm: oppgi minutter (eller meter) pr rull, og om lyden er optisk eller magnetisk. Skriv f.eks.: «16 mm: 35 min, optisk lyd».",
        source: "AI"
      });
    }

    // Video (VHS/Hi8/MiniDV)
    if (/(vhs|videokassett|videobånd|hi8|video8|minidv|vhsc)\b/i.test(message)){
      const m = extractMinutes(message) ?? fromUserHistory(history, extractMinutes);
      return res.status(200).json( priceVideo(m, prices) );
    }

    // 4) Guarded fallback (no markdown, no claims about people/partners)
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY){
      return res.status(200).json({
        answer: "Beklager, jeg har ikke et godt svar på dette akkurat nå. Send oss gjerne e-post på kontakt@lunamedia.no eller ring 33 74 02 80.",
        source:"fallback_no_key"
      });
    }

    const system =
      'Du er "Luna" – en vennlig assistent for Luna Media (Vestfold). Svar kort på norsk uten markdown-stjerner. ' +
      'Ikke finn på fakta om ansatte eller samarbeid. Henvis heller til kontakt@lunamedia.no eller 33 74 02 80 for slike spørsmål.';

    let answer = "Beklager, jeg har ikke et godt svar på dette nå. Skriv til kontakt@lunamedia.no eller ring 33 74 02 80.";
    try{
      const resp = await fetch("https://api.openai.com/v1/chat/completions",{
        method:"POST",
        headers:{ "Content-Type":"application/json","Authorization":`Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: process.env.LUNA_MODEL || "gpt-4o-mini",
          temperature:0.3, max_tokens:300,
          messages:[
            { role:"system", content: system },
            ...history.slice(-10),
            { role:"user", content: `Kunde spør: ${message}. Svar kort, konkret, uten markdown-stjerner.` }
          ]
        })
      });
      const raw = await resp.text();
      let data=null; try{ data=JSON.parse(raw); }catch{}
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (resp.ok && content) answer = stripMd(content);
    }catch{}

    return res.status(200).json({ answer, source:"AI" });

  }catch(err){
    console.error("assist.js fatal:", err?.stack||err?.message||err);
    return res.status(200).json({
      answer: "Oi, her oppsto det et teknisk problem hos oss. Kan du prøve på nytt, eller kontakte kontakt@lunamedia.no?",
      source: "fallback_runtime_error"
    });
  }
}
