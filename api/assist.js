// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ---------------- helpers ---------------- */
function safeRead(file, kind = "text") {
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (kind === "json") return JSON.parse(raw);
    if (kind === "yaml") return yaml.load(raw);
    return raw;
  } catch { return null; }
}
const toInt  = (v, d=0) => {
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : d;
};
const toNum  = (v, d=0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const nok    = (n) => toNum(n,0).toLocaleString("no-NO");
const round5 = (n) => Math.round(n/5)*5;

/* ---------------- load data ---------------- */
function loadData() {
  const faqFiles = [
    path.join(__dirname, "..", "data", "faq.yaml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yaml"),
    path.join(__dirname, "..", "knowledge", "luna.yml"),
  ];
  let faq = []; let prices = {};

  for (const p of faqFiles) {
    if (!fs.existsSync(p)) continue;
    const parsed = safeRead(p, "yaml"); if (!parsed) continue;

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
  if (priceJson && typeof priceJson === "object") {
    prices = { ...prices, ...priceJson };
  }
  return { faq, prices };
}

/* ---------------- FAQ search ---------------- */
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

/* ---------------- norsk tallord ---------------- */
const NO_WORDNUM = {
  null:0,en:1,ett:1,ei:1,to:2,tre:3,fire:4,fem:5,seks:6,sju:7,syv:7,åtte:8,ni:9,ti:10,
  elleve:11,tolv:12,tretten:13,fjorten:14,femten:15,seksten:16,sytten:17,atten:18,nitten:19,tjue:20
};
const wordToNum = (w) => {
  const k = (w||"").toLowerCase().normalize("NFKD").replace(/[^a-zæøå]/g,"");
  return Object.prototype.hasOwnProperty.call(NO_WORDNUM,k) ? NO_WORDNUM[k] : null;
};

/* ---------------- ekstraktører ---------------- */
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

/* ---------------- LEVERINGS-INTENT ---------------- */
function looksLikeDelivery(msg = "") {
  const m = (msg || "").toLowerCase();
  const keys = [
    "hvor kan jeg levere","hvor leverer jeg","hvor levere",
    "innlevering","levere","levering","innlevere",
    "motta","tar dere imot","tar dere i mot","ta imot",
    "materiale","pakke","forsendelse","post","norgespakke",
    "adresse","hvor skal jeg sende","hvor sender jeg"
  ];
  return keys.some(k => m.includes(k));
}
function handleDeliveryIntent(message) {
  if (!looksLikeDelivery(message)) return null;
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

/* ---------------- KJØPS-INTENT ---------------- */
const PURCHASE_WORDS = [
  "kjøpe","kjøp","selger dere","kan jeg kjøpe","bestille","pris på usb","minnepenn pris",
  "ramme","rammer","fotoutskrift","print","fine art","papir","tom kassett","tomme videokassetter",
  "blank kassett","dvd-plater","cd-plater","minnepenner","memory stick"
];
const includesAny = (m, arr) => arr.some(w => m.includes(w));

function handlePurchaseIntent(message, prices={}) {
  const m = (message||"").toLowerCase();
  if (!includesAny(m, PURCHASE_WORDS)) return null;

  const usbMin = Number(prices?.usb_min_price ?? prices?.minnepenn ?? 295);

  // Tomme kassetter
  if (includesAny(m, ["tom kassett","tomme videokassetter","blank kassett","vhs-kassett"]) &&
      !includesAny(m, ["minnepenn","usb"])) {
    return {
      answer:
        "Vi selger ikke tomme video-/VHS-kassetter. Vi **digitaliserer** eksisterende opptak. " +
        `Til lagring selger vi **USB/minnepenner** i flere størrelser (fra ca. ${usbMin} kr). ` +
        "Vi tilbyr også **fotoutskrifter i fine-art** og **rammer**. Si hva du ønsker, så hjelper jeg deg.",
      source: "Info"
    };
  }
  // USB/minnepenn
  if (includesAny(m, ["usb","minnepenn","minnepenner","memory stick"])) {
    return {
      answer: `Ja, vi selger **USB/minnepenner** i ulike størrelser. Pris fra ca. ${usbMin} kr. ` +
              "Si hvor mye lagringsplass du trenger (f.eks. 32/64/128 GB), så foreslår jeg riktig størrelse.",
      source: "Info"
    };
  }
  // Prints/Rammer
  if (includesAny(m, ["fotoutskrift","print","fine art","papir","ramme","rammer"])) {
    return {
      answer: "Ja, vi tilbyr **fotoutskrifter i fine-art-kvalitet** og **rammer**. " +
              "Oppgi ønsket størrelse og antall (f.eks. 30×40 cm, 5 stk), så gir vi pris og leveringstid.",
      source: "Info"
    };
  }
  // Generelt
  return {
    answer: "Vi har et begrenset utvalg for salg: **USB/minnepenner**, **fine-art-prints** og **rammer**. " +
            "Fortell hva du ønsker (type/størrelse/antall), så hjelper jeg deg med pris og levering.",
    source: "Info"
  };
}

/* ---------------- BOOKING-INTENT (med e-postvarsel via Resend) ---------------- */
const BOOKING_WORDS = [
  "filme","filming","videoopptak","opptak","arrangement","konfirmasjon","bryllup","jubileum",
  "event","konsert","seremoni","presentasjon","lansering","messe","konferanse"
];
const looksLikeBooking = (s="") => BOOKING_WORDS.some(w => s.toLowerCase().includes(w));

const extractEmail = (s="") => (s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[])[0]||null;
function extractDate(s=""){
  const m = (s||"").toLowerCase().match(/\b(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?|\d{1,2}\s*(?:jan|feb|mar|apr|mai|jun|jul|aug|sep|sept|okt|nov|des|januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember))\b/);
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
    const hit  = extractor(history[i]?.content || "");
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
  let when  = extractDate(message);
  let time  = extractTimeRange(message);
  let place = extractPlace(message);
  let want  = extractDeliverable(message);
  let email = extractEmail(message);

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
  if (!slots.want)  need.push("ønsket leveranse (klippet film/SoMe-klipp)");
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
              `Skriv f.eks.: “${slots.place||"Sted"} ${slots.when||"12.10"} ${slots.time||"12–15"}, ` +
              `${slots.want||"klippet film"} – ${slots.email||"navn@epost.no"}”.`,
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
    "Siste meldinger (nyest øverst):",
    ...(Array.isArray(history) ? history.slice(-10).reverse().map(h => `- ${h.role}: ${h.content}`) : [])
  ].join("\n");

  const sendRes = await sendBookingEmail({ to, from, subject, text });
  const confirm =
    `Takk! Jeg har notert *${slots.when}, ${slots.time}* på *${slots.place}*, ` +
    `med leveranse *${slots.want}*. Jeg sender et uforpliktende tilbud til ${slots.email} svært snart.`;

  return {
    answer: confirm + (sendRes.ok ? "" : " (Varsling feilet, men vi følger opp manuelt.)"),
    source: "Info"
  };
}

/* ---------------- PRIS: Smalfilm + Video ---------------- */
function smalfilmDiscount(totalMinutes){
  if (totalMinutes >= 360) return 0.20;   // ≥6 t
  if (totalMinutes >= 180) return 0.10;   // ≥3 t
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

function parseVideoIntent(text=""){
  const m = text.toLowerCase();
  if (!/(vhs|videokassett|videobånd|hi8|video8|minidv|vhsc)/.test(m)) return null;
  const minutter = extractMinutes(m);
  const kMatch   = m.match(/(\d{1,3})\s*(kassett|kassetter|bånd|videobånd)\b/);
  const kassetter= kMatch ? toInt(kMatch[1]) : null;
  return { minutter, kassetter };
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
    const lowH = k * 1.0, highH = k * 2.0;
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
    answer: `Video prises pr time (${perTime} kr/time). Oppgi total spilletid (timer/minutter), så regner jeg et konkret estimat. USB/minnepenn i tillegg (fra ${usbMin} kr).`,
    source: "Pris"
  };
}

/* ---------------- handler ---------------- */
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

    // 0) Levering – PRIORITERT
    const deliveryHit = handleDeliveryIntent(message);
    if (deliveryHit) return res.status(200).json(deliveryHit);

    // 1) Kjøp – før pris/FAQ for å fange “kan jeg kjøpe …”
    const buyHit = handlePurchaseIntent(message, prices);
    if (buyHit) return res.status(200).json(buyHit);

    // 2) FAQ
    const kbHits = simpleSearch(message, faq);
    if (kbHits?.[0]?.a) return res.status(200).json({ answer: kbHits[0].a, source: "FAQ" });

    // 3) Booking
    const bookingHit = await handleBookingIntent(message, history);
    if (bookingHit) return res.status(200).json(bookingHit);

    // 4) Pris-intent – video
    const vIntent = parseVideoIntent(message);
    if (vIntent){
      if (vIntent.minutter == null) {
        for (let i=history.length-1;i>=0;i--){
          const h=history[i]; if (h?.role!=="user") continue;
          const n = extractMinutes(h?.content||""); if (n!=null){ vIntent.minutter=n; break; }
        }
      }
      return res.status(200).json( priceVideo(vIntent, prices) );
    }

    // 5) Pris-intent – smalfilm
    const hasSmalfilm = /(smalfilm|super\s*8|super8|8\s*mm|8mm|16\s*mm|16mm)/.test(message.toLowerCase());
    if (hasSmalfilm){
      let minutter = extractMinutes(message);
      let ruller   = extractRuller(message);
      if (minutter==null){
        for (let i=history.length-1;i>=0;i--){
          const h=history[i]; if (h?.role!=="user") continue;
          const n = extractMinutes(h?.content||""); if (n!=null){ minutter=n; break; }
        }
      }
      if (ruller==null){
        for (let i=history.length-1;i>=0;i--){
          const h=history[i]; if (h?.role!=="user") continue;
          const n = extractRuller(h?.content||""); if (n!=null){ ruller=n; break; }
        }
      }
      return res.status(200).json( priceSmalfilm(minutter, ruller, prices) );
    }

    // 6) LLM fallback
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
    let answer = "Beklager, jeg har ikke et godt svar på dette akkurat nå. Send oss e-post på kontakt@lunamedia.no eller ring 33 74 02 80.";

    if (!OPENAI_API_KEY) return res.status(200).json({ answer, source:"fallback_no_key" });

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
