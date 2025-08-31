// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ───────────────────────── Utils ───────────────────────── */
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
const nok   = (n) => toNum(n,0).toLocaleString("no-NO");
const round5 = (n) => Math.round(n/5)*5;

function stripMd(s=""){ return s.replace(/\*\*/g,""); } // never show **

/* ─────────────────── Load FAQ + price data ─────────────────── */
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
    const parsed = safeRead(p,"yaml"); if (!parsed) continue;
    if (p.endsWith("luna.yml")){
      const f = Array.isArray(parsed?.faq) ? parsed.faq :
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
  if (priceJson && typeof priceJson === "object") {
    prices = { ...prices, ...priceJson };
  }
  return { faq, prices };
}

/* ─────────────────── Small helpers ─────────────────── */
function normalize(s=""){
  return (s+"").toLowerCase().normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu," ").replace(/\s+/g," ").trim();
}
function jaccard(aTokens,bTokens){
  if(!aTokens.length||!bTokens.length) return 0;
  const a=new Set(aTokens), b=new Set(bTokens);
  const inter=[...a].filter(x=>b.has(x)).length;
  const uni=new Set([...a,...b]).size;
  return inter/uni;
}
function simpleSearch(userMessage, faqArray, minScore=0.65){
  const qTokens = normalize(userMessage).split(" ");
  let best=null;
  for(const item of faqArray||[]){
    const candidates=[item.q, ...(item.alt||[])].map(normalize).filter(Boolean);
    let local=0;
    for(const cand of candidates){ local = Math.max(local, jaccard(qTokens, cand.split(" "))); }
    if(!best || local>best.score) best={ item, score:local };
  }
  return (best && best.score>=minScore) ? [{ a:best.item.a, score:best.score, q:best.item.q }] : [];
}

/* ─────────────────── Numbers in words (NO) ─────────────────── */
const NO_WORDNUM = { "null":0,"en":1,"ett":1,"ei":1,"to":2,"tre":3,"fire":4,"fem":5,"seks":6,"sju":7,"syv":7,"åtte":8,"ni":9,"ti":10,"elleve":11,"tolv":12,"tretten":13,"fjorten":14,"femten":15,"seksten":16,"sytten":17,"atten":18,"nitten":19,"tjue":20 };
const wordNum = (w)=> NO_WORDNUM[(w||"").toLowerCase().normalize("NFKD").replace(/[^a-zæøå]/g,"")] ?? null;

/* ─────────────────── Parsers ─────────────────── */
function extractMinutes(text=""){
  const t = normalize(text);
  let m = t.match(/(\d{1,4})\s*(min|minutt|minutter)\b/);
  if (m) return toInt(m[1]);
  m = t.match(/(\d{1,3})\s*(t|time|timer)\b/);
  if (m) return toInt(m[1])*60;
  m = t.match(/([a-zæøå]+)\s*(min|minutt|minutter)\b/);
  if (m){ const n = wordNum(m[1]); if(n!=null) return n; }
  m = t.match(/([a-zæøå]+)\s*(t|time|timer)\b/);
  if (m){ const n = wordNum(m[1]); if(n!=null) return n*60; }
  return null;
}
function extractRuller(text=""){
  const t = normalize(text);
  let m = t.match(/(\d{1,3})\s*(rull|ruller|spole|spoler)\b/);
  if (m) return toInt(m[1]);
  m = t.match(/([a-zæøå]+)\s*(rull|ruller|spole|spoler)\b/);
  if (m){ const n = wordNum(m[1]); if(n!=null) return n; }
  return null;
}
function extractAllDiameters(text=""){
  // returns [ {cm:12.7}, {cm:17}, ... ]
  const out=[];
  const t = text.toLowerCase().replace(",",".");
  const re = /(\d{1,2}(?:\.\d)?)\s*cm\b/g;
  let m;
  while((m=re.exec(t))!==null){ out.push({ cm: Number(m[1]) }); }
  return out;
}
function contains16mm(text=""){ return /\b16\s*mm\b/.test(text.toLowerCase()); }
function contains8mm(text=""){ return /\b(?:8\s*mm|dobbel[-\s]?8|d-?8)\b/.test(text.toLowerCase()); }
function containsSuper8(text=""){ return /\b(?:super\s*8|super8|s-?8|s8)\b/i.test(text); } // S8 aliases

/* ─────────────────── Diameter → minutter ─────────────────── */
/* Basert på tabellen du ga (8 mm vs Super 8) */
function minutesFromDiameter(cm, isSuper8){
  const n = Number(cm||0);
  // nearest bucket
  const buckets = [
    { cm:7.5,  s8:4,  d8:4 },
    { cm:12.7, s8:12, d8:16 },
    { cm:14.5, s8:18, d8:22 },
    { cm:17.0, s8:24, d8:32 }
  ];
  // pick closest
  let best=buckets[0], bestDiff=1e9;
  for(const b of buckets){
    const diff = Math.abs(n - b.cm);
    if (diff<bestDiff){ best=b; bestDiff=diff; }
  }
  return isSuper8 ? best.s8 : best.d8;
}

/* ─────────────────── Smalfilm discount ─────────────────── */
function smalfilmDiscount(totalMinutes){
  if (totalMinutes >= 360) return 0.20;   // ≥ 6 t
  if (totalMinutes >= 180) return 0.10;   // ≥ 3 t
  return 0;
}

/* ─────────────────── Pricing: Smalfilm ─────────────────── */
function priceSmalfilmCore({ minutter, ruller, fmt, hasAudio=false, audioType=null }, prices){
  // fmt: "s8" | "8mm" | "16mm"
  const perMin   = toNum(prices.smalfilm_min_rate ?? prices.smalfilm_per_minutt ?? 75);
  const startGeb = toNum(prices.smalfilm_start_per_rull ?? 95);
  const usbMin   = toNum(prices.usb_min_price ?? prices.minnepenn ?? 295);

  // lydtillegg per 20 min (S8 +100, 16mm magnetisk +200, 16mm optisk +2990)
  const s8AudioPer20   = 100;
  const mm16MagPer20   = 200;
  const mm16OptPer20   = 2990;

  if (minutter == null){
    const txt = [
      "Smalfilm prises med ca. " + perMin + " kr per minutt + " + startGeb + " kr i startgebyr per rull.",
      "Vi gir 10% rabatt når samlet spilletid er over 3 timer, og 20% rabatt over 6 timer.",
      "Oppgi gjerne antall minutter og ruller for et konkret prisestimat. USB/minnepenn kommer i tillegg (fra " + usbMin + " kr).",
      "Det vil alltid være noen usikre variabler i utregning av lengde på smalfilm dersom du ikke vet dette eksakt. " +
      "Betrakt derfor svaret som et estimat, og kontakt oss gjerne for et sikrere estimat og evt. pristilbud."
    ].join(" ");
    return { answer: txt, source:"Pris" };
  }

  const mins   = Math.max(0, toInt(minutter));
  const rolls  = ruller != null ? Math.max(1, toInt(ruller)) : 1;
  const disc   = smalfilmDiscount(mins);
  const arbeid = mins * perMin * (1 - disc);
  const start  = rolls * startGeb;

  // lydtillegg
  let audio = 0;
  if (hasAudio){
    const chunks = Math.ceil(mins / 20);
    if (fmt==="s8") audio = chunks * s8AudioPer20;
    if (fmt==="16mm" && audioType==="magnetisk") audio = chunks * mm16MagPer20;
    if (fmt==="16mm" && audioType==="optisk")    audio = chunks * mm16OptPer20;
  }

  const total = round5(arbeid + start + audio);
  let out = `For ${mins} minutter smalfilm og ${rolls} ${rolls===1?"rull":"ruller"} er prisen ca ${nok(total)} kr.`;
  if (disc>0) out += ` (Rabatt er inkludert: ${(disc*100).toFixed(0)}% for ${(mins/60).toFixed(1)} timer totalt.)`;
  if (audio>0) out += ` (Inkluderer tillegg for lyd.)`;
  out += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
  out += ` Det vil alltid være noen usikre variabler i utregning av lengde på smalfilm dersom du ikke vet dette eksakt. Betrakt derfor svaret som et estimat.`;
  return { answer: out, source:"Pris" };
}

/* Understand “smalfilm” question + diameters + s8 synonyms */
function smalfilmIntent(message, history){
  const m = message.toLowerCase();

  const isS8   = containsSuper8(m);
  const is8mm  = contains8mm(m) && !isS8;
  const is16   = contains16mm(m);

  const anySmalfilm = /(smalfilm|super\s*8|super8|s-?8|s8|8\s*mm|16\s*mm)/i.test(m);
  if (!anySmalfilm) return null;

  // minutes directly
  let minutter = extractMinutes(m);
  // ruller count (also from “2 ruller” or “2 s8-ruller”)
  let ruller   = extractRuller(m) ?? null;

  // diameters in this message -> estimate minutes
  const dias = extractAllDiameters(m);
  if (dias.length){
    const s8Flag = isS8 || (!is8mm && !is16); // default to S8 if not specified
    let sum=0;
    for (const d of dias){ sum += minutesFromDiameter(d.cm, s8Flag); }
    if (sum>0){
      minutter = (minutter ?? 0) + sum;
      if (ruller==null) ruller = dias.length;
    }
  }

  // If user says “jeg har 2 s8-ruller” -> treat as ruller=2, ask diameters if minutes missing
  const s8Ruller = m.match(/(\d{1,3})\s*s-?8(?:|[\s-])rull(?:er)?/i);
  if (s8Ruller && !ruller) ruller = toInt(s8Ruller[1]);

  // Audio hints
  const hasAudio = /\blyd\b|magnetisk|optisk/.test(m);
  let audioType = null;
  if (/optisk/.test(m)) audioType = "optisk";
  else if (/magnetisk/.test(m)) audioType = "magnetisk";

  // Try history for missing minutes/ruller
  if (minutter==null && Array.isArray(history)){
    for (let i=history.length-1;i>=0;i--){
      const h=history[i]; if (h?.role!=="user") continue;
      const t=h.content||"";
      const mm=extractMinutes(t); if (mm!=null){ minutter=mm; break; }
    }
  }
  if (ruller==null && Array.isArray(history)){
    for (let i=history.length-1;i>=0;i--){
      const h=history[i]; if (h?.role!=="user") continue;
      const t=h.content||"";
      const rr=extractRuller(t); if (rr!=null){ ruller=rr; break; }
    }
  }

  // if only ruller provided and no minutes or diameters: ask for diameters
  if (minutter==null && ruller!=null){
    const guide =
      "Kjempefint! For å anslå spilletid per rull, oppgi diameter på spolene og om det er 8 mm eller Super 8.\n" +
      "Tommelfingereverdier pr rull:\n" +
      "• 7,5 cm → 8 mm: ca 4 min | Super 8: ca 4 min\n" +
      "• 12,7 cm → 8 mm: ca 16 min | Super 8: ca 12 min\n" +
      "• 14,5 cm → 8 mm: ca 22 min | Super 8: ca 18 min\n" +
      "• 17 cm → 8 mm: ca 32 min | Super 8: ca 24 min\n" +
      "Skriv f.eks.: «" + ruller + " ruller, 12,7 cm, Super 8». Så regner jeg total tid og pris.";
    return { followup: guide, fmt: is16?"16mm":(isS8?"s8":(is8mm?"8mm":"s8")) };
  }

  return {
    minutter, ruller,
    fmt: is16 ? "16mm" : (isS8 ? "s8" : (is8mm ? "8mm" : "s8")),
    hasAudio, audioType
  };
}

/* ─────────────────── Pricing: Video (VHS/Hi8/…) ─────────────────── */
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
    if (hrs >= 20) disc = 0.20; else if (hrs >= 10) disc = 0.10;
    const total = round5(hrs * perTime * (1 - disc));
    let txt = `Video prises pr time digitalisert opptak (${perTime} kr/time). For ${hrs.toFixed(1)} timer blir prisen ca ${nok(total)} kr.`;
    if (disc>0) txt += ` (Inkluderer ${(disc*100).toFixed(0)}% rabatt.)`;
    txt += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
    return { answer: txt, source:"Pris" };
  }

  if (kassetter != null){
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
    return { answer: txt, source:"Pris" };
  }

  return { answer:`Video prises pr time (${perTime} kr/time). Oppgi gjerne total spilletid (timer/minutter).`, source:"Pris" };
}

/* ─────────────────── Purchase guard ─────────────────── */
function handlePurchaseIntent(message, prices={}){
  const m = normalize(message);
  const usbMin = Number(prices?.usb_min_price ?? prices?.minnepenn ?? 295);

  const looks = /(kjøp|kjøpe|selger|bestille|minnepenn|usb|ramme|rammer|fotoutskrift|print|fine art|papir|tomme? kassett|dvd-plater|cd-plater)/.test(m);
  if (!looks) return null;

  // tomme kassetter
  if (/(tomme?|blanke?).*kassett/.test(m) && !/usb|minnepenn/.test(m)){
    return { answer: stripMd(
      `Vi selger ikke tomme video-/VHS-kassetter. Vi digitaliserer derimot eksisterende opptak. ` +
      `Til lagring selger vi USB/minnepenner i flere størrelser (fra ca. ${usbMin} kr), ` +
      `og vi tilbyr også fotoutskrifter i fine-art-kvalitet og rammer. Si gjerne hva du ønsker å kjøpe, så hjelper jeg deg videre.`
    ), source:"AI" };
  }
  // usb
  if (/usb|minnepenn/.test(m)){
    return { answer: stripMd(`Ja, vi selger USB/minnepenner i ulike størrelser (god kvalitet). Pris fra ca. ${usbMin} kr. Si gjerne hvor mye lagringsplass du trenger (f.eks. 32/64/128 GB).`), source:"AI" };
  }
  // prints/rammer
  if (/fotoutskrift|print|fine art|papir|ramme|rammer/.test(m)){
    return { answer: stripMd(`Ja, vi tilbyr fotoutskrifter i fine-art-kvalitet og rammer. Oppgi gjerne ønsket størrelse og antall (f.eks. 30×40 cm, 5 stk), så gir vi pris og leveringstid.`), source:"AI" };
  }
  // generic
  return { answer: stripMd(`Vi har et begrenset utvalg produkter for salg: USB/minnepenner, fotoutskrifter i fine-art-kvalitet og rammer. Fortell meg hva du ønsker (type, størrelse/kapasitet og antall), så hjelper jeg med pris og levering.`), source:"AI" };
}

/* ─────────────────── Delivery quick-answer ─────────────────── */
function deliveryIntent(message){
  if (!/(lever|levere|levere til|hvor kan jeg levere|kan dere hente|hente)/i.test(message)) return null;

  // special: “kan dere hente i …”
  const m = message.toLowerCase();
  if (/hent/.test(m)){
    return {
      answer: "Det kan hende vi kan hente hjemme hos deg. Ta kontakt, så finner vi en god løsning på dette – ring 33 74 02 80 eller skriv til kontakt@lunamedia.no.",
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
  return { answer: text, source:"AI" };
}

/* ─────────────────── People/partners safety ─────────────────── */
function unknownPeopleGuard(message){
  if (!/(er .* del av luna|jobber .* i luna|samarbeid.* (med|mellom))/i.test(message)) return null;
  if (/samarbeid/.test(message.toLowerCase())){
    return { answer:"Vi har flere gode samarbeidspartnere. Kontakt oss gjerne om du ønsker nærmere informasjon, så får du riktig navn og avklaring.", source:"AI" };
  }
  return { answer:"Det kjenner jeg ikke til. Ta gjerne kontakt direkte, så får du en korrekt avklaring.", source:"AI" };
}

/* ─────────────────── Handler ─────────────────── */
export default async function handler(req, res){
  // CORS
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

  try{
    let body = req.body || {};
    if (typeof body === "string"){ try{ body = JSON.parse(body); } catch { body = {}; } }
    const message = (body.message||"").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    if (!message) return res.status(400).json({ error:"Missing message" });

    const { faq, prices } = loadData();

    /* 1) FAQ exact-enough */
    const kb = simpleSearch(message, faq);
    if (kb?.[0]?.a) return res.status(200).json({ answer: kb[0].a, source:"FAQ" });

    /* 2) Delivery quick-answer */
    const del = deliveryIntent(message);
    if (del) return res.status(200).json(del);

    /* 3) Purchase guard */
    const sales = handlePurchaseIntent(message, prices);
    if (sales) return res.status(200).json(sales);

    /* 4) People/partners guard */
    const ppl = unknownPeopleGuard(message);
    if (ppl) return res.status(200).json(ppl);

    /* 5) Video pricing */
    const vIntent = parseVideoIntent(message);
    if (vIntent){
      if (vIntent.minutter == null){
        // maybe user said “18 timer video” earlier
        for (let i=history.length-1;i>=0;i--){
          const h=history[i]; if (h?.role!=="user") continue;
          const mm=extractMinutes(h?.content||""); if (mm!=null){ vIntent.minutter=mm; break; }
        }
      }
      return res.status(200).json( priceVideo(vIntent, prices) );
    }

    /* 6) Smalfilm (with S8 aliases, multi-diameter, audio) */
    const sm = smalfilmIntent(message, history);
    if (sm){
      if (sm.followup) return res.status(200).json({ answer: sm.followup, source:"AI" });
      return res.status(200).json( priceSmalfilmCore(sm, prices) );
    }

    /* 7) Mixed “8 mm + 16 mm” hint */
    if (/(8\s*mm).*?(16\s*mm)|(16\s*mm).*?(8\s*mm)/i.test(message) || (containsSuper8(message) && contains16mm(message))){
      const txt =
        "Ja – vi tar begge deler. Oppgi gjerne ca minutter **eller** meter for 16 mm (og antall ruller), " +
        "samt om 16 mm har optisk eller magnetisk lyd. For 8 mm/Super 8 kan du oppgi minutter eller diameter (7,5 / 12,7 / 14,5 / 17 cm).";
      return res.status(200).json({ answer: stripMd(txt), source:"AI" });
    }

    /* 8) LLM fallback (short + filming hand-off) */
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY){
      const fallback = "Beklager, jeg har ikke et godt svar akkurat nå. Send oss gjerne e-post på kontakt@lunamedia.no eller ring 33 74 02 80.";
      return res.status(200).json({ answer:fallback, source:"fallback_no_key" });
    }

    const system = [
      'Du er "Luna" – en vennlig og presis AI-assistent for Luna Media (Vestfold).',
      "Svar kort på norsk (maks 2–3 setninger).",
      "Hvis kunden spør om filming/booking av arrangement: be om dato, sted, tidsrom, ønsket leveranse og e-post, og tilby menneskelig overtakelse."
    ].join("\n");

    const resp = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{ "Content-Type":"application/json","Authorization":`Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.LUNA_MODEL || "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          { role:"system", content: system },
          ...history,
          { role:"user", content: `Kunde spør: ${message}\nSvar kort på norsk.` }
        ]
      })
    });

    const text = await resp.text();
    let data; try{ data = JSON.parse(text); } catch { throw new Error("OpenAI JSON parse error: " + text); }
    if (!resp.ok) throw new Error(data?.error?.message || `OpenAI ${resp.status}`);

    const content = (data?.choices?.[0]?.message?.content || "").trim();
    const add = /filming|opptak|arrangement|bryllup|konfirmasjon|event/i.test(message)
      ? " Vi kan ta dette videre på e-post – kan du oppgi dato, sted, tidsrom og e-post?"
      : "";
    return res.status(200).json({ answer: content + add, source:"AI" });

  } catch (e){
    console.error("assist.js error:", e);
    return res.status(500).json({ error:"Server error" });
  }
}
