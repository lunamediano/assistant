// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* ------------------------------------------------------- */
/*  Basissett                                              */
/* ------------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const toInt = (v, d=0) => {
  const n = parseInt(String(v).replace(/[^\d-]/g,""),10);
  return Number.isFinite(n) ? n : d;
};
const toNum = (v, d=0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const nok = (n) => toNum(n,0).toLocaleString("no-NO");
const round5 = (n) => Math.round(n/5)*5;

function safeRead(file, kind="text"){
  try{
    const raw = fs.readFileSync(file,"utf8");
    if (kind==="json") return JSON.parse(raw);
    if (kind==="yaml") return yaml.load(raw);
    return raw;
  }catch{ return null; }
}

/* ------------------------------------------------------- */
/*  Data: FAQ + pris                                       */
/* ------------------------------------------------------- */
function loadData(){
  const faqCandidates = [
    path.join(__dirname, "..", "data", "faq.yaml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yaml"),
    path.join(__dirname, "..", "knowledge", "luna.yml"),
  ];
  let faq = [];
  let prices = {};
  for (const p of faqCandidates){
    if (!fs.existsSync(p)) continue;
    const parsed = safeRead(p,"yaml");
    if (!parsed) continue;
    if (p.endsWith("luna.yml")){
      const f = Array.isArray(parsed?.faq) ? parsed.faq :
                Array.isArray(parsed?.knowledge?.faq) ? parsed.knowledge.faq : [];
      if (f?.length) faq = faq.concat(f);
      const pr = parsed?.priser || parsed?.prices || parsed?.company?.prices;
      if (pr && typeof pr==="object") prices = { ...prices, ...pr };
    }else{
      const f = Array.isArray(parsed) ? parsed : (parsed?.faq || []);
      if (f?.length) faq = faq.concat(f);
    }
  }
  const pjson = safeRead(path.join(__dirname,"..","data","priser.json"),"json");
  if (pjson && typeof pjson==="object") prices = { ...prices, ...pjson };
  return { faq, prices };
}

/* ------------------------------------------------------- */
/*  Enkel FAQ-søk                                          */
/* ------------------------------------------------------- */
function normalize(s=""){
  return (s+"").toLowerCase().normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}\s]/gu," ")
    .replace(/\s+/g," ")
    .trim();
}
function jaccard(aTokens,bTokens){
  if (!aTokens.length || !bTokens.length) return 0;
  const a = new Set(aTokens), b = new Set(bTokens);
  const inter = [...a].filter(x=>b.has(x)).length;
  const uni = new Set([...a,...b]).size;
  return inter/uni;
}
function simpleSearch(userMessage, faqArray, minScore=0.65){
  const qNorm = normalize(userMessage);
  const qTokens = qNorm.split(" ");
  let best=null;
  for (const item of faqArray||[]){
    const candidates = [item.q, ...(item.alt||[])].map(normalize).filter(Boolean);
    let bestLocal = 0;
    for (const cand of candidates){
      const score = jaccard(qTokens, cand.split(" "));
      if (score > bestLocal) bestLocal = score;
    }
    if (!best || bestLocal > best.score) best = { item, score: bestLocal };
  }
  if (best && best.score>=minScore) return [{ a: best.item.a, score: best.score, q: best.item.q }];
  return [];
}

/* ------------------------------------------------------- */
/*  Tallord (norsk)                                        */
/* ------------------------------------------------------- */
const NO_WORDNUM = {
  "null":0,"en":1,"ett":1,"ei":1,"to":2,"tre":3,"fire":4,"fem":5,"seks":6,"sju":7,"syv":7,"åtte":8,"ni":9,"ti":10,
  "elleve":11,"tolv":12,"tretten":13,"fjorten":14,"femten":15,"seksten":16,"sytten":17,"atten":18,"nitten":19,"tjue":20
};
function wordToNum(w){
  const k = (w||"").toLowerCase().normalize("NFKD").replace(/[^a-zæøå]/g,"");
  return Object.prototype.hasOwnProperty.call(NO_WORDNUM,k) ? NO_WORDNUM[k] : null;
}

/* ------------------------------------------------------- */
/*  Felles trekk (minutter / ruller)                       */
/* ------------------------------------------------------- */
function extractMinutes(text=""){
  const t = (text||"").toLowerCase();
  const mm = t.match(/(\d{1,4})\s*(min|minutt|minutter)\b/);
  const hh = t.match(/(\d{1,3}(?:[.,]\d)?)\s*(t|time|timer)\b/);
  if (mm) return toInt(mm[1]);
  if (hh) return Math.round(parseFloat(hh[1].replace(",", ".")) * 60);
  const wm = t.match(/([a-zæøå]+)\s*(min|minutt|minutter)\b/);
  const wh = t.match(/([a-zæøå]+)\s*(t|time|timer)\b/);
  if (wm){ const n = wordToNum(wm[1]); if (n!=null) return n; }
  if (wh){ const n = wordToNum(wh[1]); if (n!=null) return n*60; }
  return null;
}
function extractRuller(text=""){
  const t = (text||"").toLowerCase();
  const d = t.match(/(\d{1,3})\s*(rull|ruller|spole|spoler)\b/);
  if (d) return toInt(d[1]);
  const w = t.match(/([a-zæøå]+)\s*(rull|ruller|spole|spoler)\b/);
  if (w){ const n = wordToNum(w[1]); if (n!=null) return n; }
  return null;
}

/* ------------------------------------------------------- */
/*  Smalfilm: diameter → minutter                          */
/*  Tabell: 8 mm og Super 8 har ulik typisk spilletid      */
/* ------------------------------------------------------- */
const DIAM_TABLE = {
  "8mm": {
    7.5: 4, 12.7: 16, 14.5: 22, 17: 32
  },
  "s8": {
    7.5: 4, 12.7: 12, 14.5: 18, 17: 24
  }
};
function nearestKey(num, keys){
  // matcher 12, 12.7, 12,8 osv til nærmeste «offisielle» diameter
  const x = Number(num);
  let best = keys[0], bestDiff = Math.abs(x-keys[0]);
  for (const k of keys){
    const d = Math.abs(x-k);
    if (d < bestDiff){ best = k; bestDiff = d; }
  }
  return best;
}
function minutesFromDiamList(list, fmt="s8"){
  // list: array med diametre i cm (number)
  const tbl = fmt==="8mm" ? DIAM_TABLE["8mm"] : DIAM_TABLE["s8"];
  const keys = Object.keys(tbl).map(Number);
  let total = 0;
  for (const d of list){
    const k = nearestKey(d, keys);
    total += tbl[k];
  }
  return total; // minutter
}

/* ------------------------------------------------------- */
/*  Historikk: siste brukerinnlegg om smalfilm             */
/* ------------------------------------------------------- */
function historyHasSmalfilm(history=[]){
  for (let i=history.length-1; i>=0; i--){
    const h = history[i]; if (h?.role!=="user") continue;
    const t = (h.content||"").toLowerCase();
    if (/(smalfilm|super\s*8|super8|s8|8\s*mm|16\s*mm)/.test(t)) return true;
  }
  return false;
}

/* ------------------------------------------------------- */
/*  Prisregler                                             */
/* ------------------------------------------------------- */
function smalfilmDiscount(totalMinutes){
  if (totalMinutes >= 360) return 0.20;        // ≥6 t
  if (totalMinutes > 180)  return 0.10;        // >3 t
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
      `Oppgi minutter og ruller, eller diameter per rull (7,5 / 12,7 / 14,5 / 17 cm) for et konkret estimat.`,
      `USB/minnepenn i tillegg (fra ${usbMin} kr).`,
      `Det vil alltid være litt usikkerhet når lengde anslås – ta svaret som et estimat.`
    ].join(" ");
    return { answer: txt, source: "Pris" };
  }

  const mins = Math.max(0, toInt(minutter));
  const rolls = ruller != null ? Math.max(1, toInt(ruller)) : 1;

  const disc = smalfilmDiscount(mins);
  const arbeid = mins * perMin * (1 - disc);
  const start  = rolls * startGeb;
  const total  = round5(arbeid + start);

  let out = `For ${mins} minutter smalfilm og ${rolls} ${rolls===1?"rull":"ruller"} er prisen ca ${nok(total)} kr.`;
  if (disc>0) out += ` (Rabatt inkludert: ${(disc*100).toFixed(0)}%.)`;
  out += ` USB/minnepenn i tillegg (fra ${usbMin} kr). Det er alltid litt usikkerhet ved anslag – ta dette som et estimat.`;
  return { answer: out, source: "Pris" };
}

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
    const hrs = Math.max(0, toInt(minutter))/60;
    let disc = 0;
    if (hrs >= 20) disc = 0.20;
    else if (hrs >= 10) disc = 0.10;
    const total = round5(hrs * perTime * (1 - disc));
    let txt = `Video prises per time (${perTime} kr/time). For ${hrs.toFixed(1)} timer blir prisen ca ${nok(total)} kr.`;
    if (disc>0) txt += ` (Inkluderer ${(disc*100).toFixed(0)}% rabatt.)`;
    txt += ` USB/minnepenn i tillegg (fra ${usbMin} kr).`;
    return { answer: txt, source: "Pris" };
  }

  if (kassetter != null){
    const k = Math.max(1, toInt(kassetter));
    const lowH= k*1.0, highH=k*2.0;
    const lowDisc  = lowH>=20?0.20:(lowH>=10?0.10:0);
    const highDisc = highH>=20?0.20:(highH>=10?0.10:0);
    const low  = round5(lowH*perTime*(1-lowDisc));
    const high = round5(highH*perTime*(1-highDisc));
    const txt = [
      `Vi priser per time (${perTime} kr/time).`,
      `${k} ${k===1?"kassett":"kassetter"} kan typisk være ${lowH.toFixed(1)}–${highH.toFixed(1)} timer`,
      `⇒ ca ${nok(low)}–${nok(high)} kr (inkl. ev. volumrabatt).`,
      `USB/minnepenn i tillegg (fra ${usbMin} kr).`
    ].join(" ");
    return { answer: txt, source: "Pris" };
  }

  return { answer: `Video prises per time (${perTime} kr/time). Oppgi total spilletid, så regner jeg estimat. USB/minnepenn i tillegg (fra ${usbMin} kr).`, source: "Pris" };
}

/* ------------------------------------------------------- */
/*  Kjøp/produkt + reparasjon + levering/henting           */
/* ------------------------------------------------------- */
function cassetteRepairIntent(msg){
  const m = msg.toLowerCase();
  if (!/(reparer|fikse|ødelagt).*(kassett|videobånd|vhs|minidv|hi8|video8)/.test(m)) return null;
  return {
    answer: "Ja – vi reparerer kassetter (VHS, MiniDV, Hi8/Video8 m.m.) og kan deretter digitalisere innholdet. Ta kontakt på 33 74 02 80 eller kontakt@lunamedia.no for å avtale innlevering.",
    source: "AI"
  };
}

function deliveryIntent(msg){
  const m = msg.toLowerCase();
  if (!/(levere|levering|hvordan.*levere|kan dere hente|hente.*(drammen|oslo|vestfold|tonsberg|tønsberg|sandefjord|larvik)|frakt|post)/.test(m)) return null;

  // Drammen/henting-spørsmål
  if (/hente/.test(m)){
    return {
      answer: "Det kan hende vi kan hente materialet hos deg. Ta kontakt på 33 74 02 80 eller kontakt@lunamedia.no, så finner vi en god løsning.",
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

/* ------------------------------------------------------- */
/*  Smalfilm-veileder og oppfølging                        */
/* ------------------------------------------------------- */
function isSmalfilmContext(msg){
  const m = msg.toLowerCase();
  return /(smalfilm|super\s*8|super8|\bs8\b|8\s*mm|16\s*mm)/.test(m);
}

function smalfilmGuideIntent(msg){
  if (!isSmalfilmContext(msg)) return null;
  return {
    answer: [
      "Ja – vi tar både S8/8 mm og 16 mm.",
      "For S8/8 mm: oppgi diameter per rull (7,5 / 12,7 / 14,5 / 17 cm) og om det er 8 mm eller Super 8.",
      "For 16 mm: oppgi minutter (eller meter) per rull og om lyden er optisk eller magnetisk.",
      "Skriv for eksempel: «S8: 2 ruller, 12,7 cm og 14,5 cm. 16 mm: 3 ruller, 24 min, optisk lyd».",
      "Så estimerer jeg total spilletid og pris."
    ].join(" "),
    source: "AI"
  };
}

// Fanger opp oppfølging som inneholder diametre/minutter for s8/8mm og 16 mm
function parseFollowupSmalfilm(msg, prices){
  const m = msg.toLowerCase();
  if (!/(s8|super\s*8|8\s*mm|16\s*mm)/.test(m)) return null;

  // Finn S8/8mm-del
  // Eksempel: "s8: 2 ruller 12 cm og 14 cm" / "super 8: ...", "8 mm: ..."
  const s8Block = m.match(/(s8|super\s*8|8\s*mm)\s*:\s*([^\.]+)/);
  let s8Min = 0, s8Ruller = 0;

  if (s8Block){
    const fmt = /8\s*mm/.test(s8Block[1]) ? "8mm" : "s8";
    const diamStr = s8Block[2];
    // trekk rull-antall om oppgitt eksplisitt
    const explicitCount = extractRuller(diamStr);
    // finn alle tall som kan være diameter: 7.5, 12, 12.7, 14.5, 17, 17.3 osv
    const diams = (diamStr.match(/(\d{1,2}(?:[.,]\d)?)/g) || [])
      .map(x => parseFloat(x.replace(",", ".")))
      .filter(x => x>0 && x<=40);

    if (diams.length){
      s8Min = minutesFromDiamList(diams, fmt);
      s8Ruller = explicitCount || diams.length;
    }
  }

  // Finn 16mm-del
  // Eksempel: "16 mm: 3 ruller 1,5 time optisk lyd" eller "16 mm: 35 min optisk"
  const mm16Block = m.match(/16\s*mm\s*:\s*([^\.]+)/);
  let mm16Min = 0, mm16Ruller = 0, mm16Lyd = "uten lyd";
  if (mm16Block){
    const part = mm16Block[1];
    const r = extractRuller(part);
    if (r!=null) mm16Ruller = r;
    const mins = extractMinutes(part);
    if (mins!=null) mm16Min = mins;
    if (/optisk/.test(part)) mm16Lyd = "optisk";
    else if (/magnetisk/.test(part)) mm16Lyd = "magnetisk";
  }

  if (s8Min===0 && mm16Min===0) return null; // ingen nyttig info

  // Pris for S8/8mm (bruk generell smalfilmpris – per min + start per rull + rabatt)
  let s8Text = "";
  if (s8Min>0){
    const s8Price = priceSmalfilm(s8Min, s8Ruller||1, prices);
    s8Text = s8Price.answer;
  }

  // Pris for 16mm – bruk særregler hvis du har lagt dem i priser.json,
  // ellers fall tilbake til samme som smalfilm.
  let mm16Text = "";
  if (mm16Min>0){
    const p = priceSmalfilm(mm16Min, mm16Ruller||1, prices);
    if (mm16Lyd==="optisk") {
      mm16Text = p.answer + " (Oppgitt: optisk lyd.)";
    } else if (mm16Lyd==="magnetisk"){
      mm16Text = p.answer + " (Oppgitt: magnetisk lyd.)";
    } else {
      mm16Text = p.answer;
    }
  }

  const out = [s8Text, mm16Text].filter(Boolean).join(" ");
  if (!out) return null;

  return { answer: out, source: "Pris" };
}

/* ------------------------------------------------------- */
/*  HTTP-handler                                           */
/* ------------------------------------------------------- */
export default async function handler(req, res){
  // CORS
  const allowed = (process.env.LUNA_ALLOWED_ORIGINS || "*").split(",").map(s=>s.trim());
  const origin = req.headers.origin || "";
  if (allowed.includes("*") || allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS"){
    res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Content-Type");
    return res.status(200).end();
  }
  if (req.method !== "POST"){
    return res.status(405).json({ error:"Method not allowed" });
  }

  try{
    let body = req.body || {};
    if (typeof body === "string"){
      try{ body = JSON.parse(body); } catch { body = {}; }
    }
    const message = (body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    const debug   = !!body.debug;

    if (!message) return res.status(400).json({ error:"Missing message" });

    const { faq, prices } = loadData();

    // 0) Reparasjon av kassetter
    const fix = cassetteRepairIntent(message);
    if (fix) return res.status(200).json(fix);

    // 0b) Levering/henting
    const del = deliveryIntent(message);
    if (del) return res.status(200).json(del);

    // 1) FAQ
    const kb = simpleSearch(message, faq);
    if (kb?.[0]?.a){
      return res.status(200).json({ answer: kb[0].a, source: "FAQ" });
    }

    // 1b) Smalfilm veiledning hvis relevant (og ikke allerede ren diam-/min-info)
    if (isSmalfilmContext(message)){
      // Forsøk først å tolke en oppfølgingsstreng med konkrete data
      const follow = parseFollowupSmalfilm(message, prices);
      if (follow) return res.status(200).json(follow);

      // ellers gi veiledning
      const guide = smalfilmGuideIntent(message);
      if (guide) return res.status(200).json(guide);
    }

    // 2) Video (VHS/Hi8/MiniDV) pris
    const vIntent = parseVideoIntent(message);
    if (vIntent){
      if (vIntent.minutter == null){
        // kanskje nevnt tidligere
        for (let i=history.length-1; i>=0; i--){
          const n = extractMinutes(history[i]?.content||"");
          if (n!=null){ vIntent.minutter = n; break; }
        }
      }
      return res.status(200).json( priceVideo(vIntent, prices) );
    }

    // 3) Smalfilm «vanlig» (minutter+ruller)
    if (historyHasSmalfilm(history) || isSmalfilmContext(message)){
      const mins = extractMinutes(message);
      const rul  = extractRuller(message);
      const p = priceSmalfilm(mins, rul, prices);
      return res.status(200).json(p);
    }

    // 4) LLM fallback – kort
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const model = process.env.LUNA_MODEL || "gpt-4o-mini";
    let answer = "Beklager, jeg er usikker på spørsmålet. Kontakt oss gjerne på kontakt@lunamedia.no eller 33 74 02 80.";

    if (!OPENAI_API_KEY){
      return res.status(200).json({ answer, source: "fallback_no_key" });
    }

    const system = [
      'Du er "Luna" – en vennlig og presis assistent for Luna Media (Vestfold).',
      "Svar kort på norsk. Hvis noe er uklart: si det, og foreslå tilbud via e-post.",
      "Ved spørsmål om filming/booking: be om dato, sted, tidsrom, ønsket leveranse og e-post."
    ].join("\n");

    const user = `Kunde spør: ${message}\nSvar kort, maks 2–3 setninger. Ikke bruk markdown-utheving.`;

    try{
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Authorization":`Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model, temperature:0.3, max_tokens:300,
          messages: [{ role:"system", content: system }, ...history, { role:"user", content: user }]
        })
      });
      const text = await resp.text();
      let data; try{ data = JSON.parse(text); } catch { throw new Error("OpenAI JSON parse error: " + text); }
      if (!resp.ok) throw new Error(data?.error?.message || `OpenAI error ${resp.status}`);
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (content) answer = content;
      return res.status(200).json({ answer, source:"AI" });
    }catch(e){
      console.error("OpenAI error:", e?.message);
      return res.status(200).json({ answer, source:"fallback_openai_error" });
    }

  }catch(err){
    console.error("Handler-feil:", err);
    return res.status(500).json({ error:"Server error" });
  }
}
