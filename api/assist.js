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

/* ---------- Purchase intent utils ---------- */
const PURCHASE_WORDS = [
  "kjøpe","kjøp","selger dere","selger du","kan jeg kjøpe","bestille","pris på usb","minnepenn pris",
  "ramme","rammer","fotoutskrift","print","fine art","papir","tom kassett","tomme videokassetter",
  "blank kassett","dvd-plater","cd-plater","produkt","butikk","vare","sortiment"
];
function looksLikePurchase(msg=""){ const m=msg.toLowerCase(); return PURCHASE_WORDS.some(w=>m.includes(w)); }
function mentionsAny(msg="", words=[]){ const m=msg.toLowerCase(); return words.some(w=>m.includes(w)); }

/* ---------- Delivery / innlevering intent ---------- */
function looksLikeDelivery(msg = "") {
  const m = (msg || "").toLowerCase();
  return [
    "levere", "innlevering", "innlevere", "levering",
    "hvor kan jeg levere", "hvor leverer jeg", "adresse",
    "sende", "post", "norgespakke", "returnere", "hente"
  ].some(k => m.includes(k));
}

function handleDeliveryIntent(message) {
  if (!looksLikeDelivery(message)) return null;

  const text = [
    "Du kan sende pakken med **Norgespakke med sporing** til:",
    "Luna Media, **Pb. 60, 3107 Sem** (bruk mottakers mobil **997 05 630**).",
    "",
    "Du kan også levere direkte:",
    "- **Sem Senteret (2. etg.)**, Andebuveien 3, 3170 Sem",
    "- **Desk på Bislett** i Oslo (Sofies gate 66A) – **etter avtale**",
    "",
    "Ring **33 74 02 80** eller skriv til **kontakt@lunamedia.no** for å avtale levering/henting."
  ].join("\n");

  return { answer: text, source: "Info" };
}

/* ---------- Booking utils ---------- */
const BOOKING_KEYWORDS = [
  "filme","filming","videoopptak","opptak","filmopptak",
  "arrangement","konfirmasjon","bryllup","jubileum",
  "event","konsert","seremoni","presentasjon","lansering","messe","konferanse"
];
function looksLikeBooking(msg){ const m=(msg||"").toLowerCase(); return BOOKING_KEYWORDS.some(k=>m.includes(k)); }
function extractEmail(s=""){ const m=(s.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]); return m[0]||null; }
function extractDate(s=""){ const m=(s||"").toLowerCase().match(/\b(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?|\d{1,2}\s*(?:jan|feb|mar|apr|mai|jun|jul|aug|sep|sept|okt|nov|des|januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember))\b/); return m?m[1]:null; }
function extractTimeRange(s=""){ const m=(s||"").toLowerCase().match(/\b(?:kl\.?\s*)?(\d{1,2}(?::\d{2})?)\s*[–-]\s*(\d{1,2}(?::\d{2})?)\b/); return m?`${m[1]}–${m[2]}`:null; }
function extractPlace(s=""){ const m=(s||"").match(/\b(i|på)\s+([A-ZÆØÅ][\p{L}\- ]{1,40})\b/iu); return m?m[2].trim():null; }
function extractDeliverable(s=""){ const m=(s||"").toLowerCase(); if (/(klipp|redig|ferdig.*film|hovedfilm|sosiale medier|reels|tiktok|stories|som?e|teaser)/.test(m)) return "klippet film (ev. SoMe-klipp)"; if (/(råmateriale|råfiler)/.test(m)) return "råmateriale"; return null; }
function fromHistory(history, extractor){ if(!Array.isArray(history))return null; for(let i=history.length-1;i>=0;i--){ const t=history[i]?.content||""; const hit=extractor(t); if(hit) return hit; } return null; }
async function sendBookingEmail({to, from, subject, text}){ const key=process.env.RESEND_API_KEY; if(!key||!to||!from) return {ok:false,reason:"missing-config"}; const resp=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify({to:[to],from,subject,text})}); let data; try{data=await resp.json();}catch{data={};} return {ok:resp.ok,data}; }

/* --------------- load data --------------- */
function loadData(){
  const faqCandidates=[
    path.join(__dirname,"..","data","faq.yaml"),
    path.join(__dirname,"..","knowledge","faq_round1.yml"),
    path.join(__dirname,"..","knowledge","faq_round1.yaml"),
    path.join(__dirname,"..","knowledge","luna.yml"),
  ];
  let faq=[]; let prices={}; const tried=[],loaded=[];
  for(const p of faqCandidates){
    const isLuna=p.endsWith("luna.yml"); const exists=fs.existsSync(p);
    tried.push({path:p,exists,size:exists?fs.statSync(p).size:0}); if(!exists) continue;
    const parsed=safeRead(p,"yaml"); if(!parsed) continue; loaded.push({path:p,size:fs.statSync(p).size});
    if(isLuna){
      const fromLunaFaq = Array.isArray(parsed?.faq)?parsed.faq : Array.isArray(parsed?.knowledge?.faq)?parsed.knowledge.faq : [];
      if(fromLunaFaq?.length) faq=faq.concat(fromLunaFaq);
      const fromLunaPrices=parsed?.priser||parsed?.prices||parsed?.company?.prices;
      if(fromLunaPrices&&typeof fromLunaPrices==="object") prices={...prices,...fromLunaPrices};
    }else{
      const items=Array.isArray(parsed)?parsed:(parsed?.faq||[]); if(items?.length) faq=faq.concat(items);
    }
  }
  const priceJson=safeRead(path.join(__dirname,"..","data","priser.json"),"json");
  if(priceJson&&typeof priceJson==="object"){ prices={...prices,...priceJson}; loaded.push({path:"priser.json",size:JSON.stringify(priceJson).length}); }
  return {faq,prices,tried,loaded};
}

/* --------------- FAQ search --------------- */
function normalize(s=""){ return (s+"").toLowerCase().normalize("NFKD").replace(/[^\p{Letter}\p{Number}\s]/gu," ").replace(/\s+/g," ").trim(); }
function jaccard(aTokens,bTokens){ if(!aTokens.length||!bTokens.length) return 0; const a=new Set(aTokens), b=new Set(bTokens); const inter=[...a].filter(x=>b.has(x)).length; const uni=new Set([...a,...b]).size; return inter/uni; }
function simpleSearch(userMessage,faqArray,minScore=0.65){ const qNorm=normalize(userMessage), qTokens=qNorm.split(" "); let best=null; for(const item of faqArray||[]){ const candidates=[item.q,...(item.alt||[])].map(normalize).filter(Boolean); let bestLocal=0; for(const cand of candidates){ const score=jaccard(qTokens,cand.split(" ")); if(score>bestLocal) bestLocal=score; } if(!best||bestLocal>best.score) best={item,score:bestLocal}; } if(best&&best.score>=minScore) return [{a:best.item.a,score:best.score,q:best.item.q}]; return []; }

/* --------------- number words (no) --------------- */
const NO_WORDNUM={"null":0,"en":1,"ett":1,"ei":1,"to":2,"tre":3,"fire":4,"fem":5,"seks":6,"sju":7,"syv":7,"åtte":8,"ni":9,"ti":10,"elleve":11,"tolv":12,"tretten":13,"fjorten":14,"femten":15,"seksten":16,"sytten":17,"atten":18,"nitten":19,"tjue":20};
function wordToNum(w){ const k=(w||"").toLowerCase().normalize("NFKD").replace(/[^a-zæøå]/g,""); return Object.prototype.hasOwnProperty.call(NO_WORDNUM,k)?NO_WORDNUM[k]:null; }

/* --------------- extract helpers --------------- */
function extractMinutes(text=""){
  const m=(text||"").toLowerCase();
  const mm=m.match(/(\d{1,4})\s*(min|minutt|minutter)\b/);
  const hh=m.match(/(\d{1,3})\s*(t|time|timer)\b/);
  if(mm) return toInt(mm[1]);
  if(hh) return toInt(hh[1])*60;
  const wm=m.match(/([a-zæøå]+)\s*(min|minutt|minutter)\b/);
  const wh=m.match(/([a-zæøå]+)\s*(t|time|timer)\b/);
  if(wm){ const n=wordToNum(wm[1]); if(n!=null) return n; }
  if(wh){ const n=wordToNum(wh[1]); if(n!=null) return n*60; }
  return null;
}
function extractRuller(text=""){
  const m=(text||"").toLowerCase();
  const rd=m.match(/(\d{1,3})\s*(rull|ruller)\b/); if(rd) return toInt(rd[1]);
  const rw=m.match(/([a-zæøå]+)\s*(rull|ruller)\b/); if(rw){ const n=wordToNum(rw[1]); if(n!=null) return n; }
  return null;
}

/* --------------- smalfilm parsing --------------- */
function parseSmalfilmLoose(text=""){
  const m=text.toLowerCase();
  const hasFilm=/(smalfilm|super\s*8|super8|8\s*mm|8mm|16\s*mm|16mm)\b/.test(m);
  const mentionsRullOnly=/(rull|ruller)\b/.test(m);

  const gauge16=/(16\s*mm|16mm)\b/.test(m);
  const gaugeS8=/(super\s*8|super8)\b/.test(m);
  const gauge8=/(8\s*mm|8mm)\b/.test(m) && !gaugeS8;

  const soundOptical=/(optisk lyd|optisk)\b/.test(m);
  const soundMagnetic=/(magnetisk lyd|magnetlyd|magnetisk)\b/.test(m);
  const soundGeneric=/\blyd\b/.test(m);

  const minutter=extractMinutes(m);
  const ruller=extractRuller(m);

  let gauge=null;
  if(gauge16) gauge="16mm"; else if(gaugeS8) gauge="super8"; else if(gauge8) gauge="8mm";

  let sound=null;
  if(soundOptical) sound="optisk"; else if(soundMagnetic) sound="magnetisk"; else if(soundGeneric) sound="ja";

  return { hasFilm, mentionsRullOnly, minutter, ruller, gauge, sound };
}

// ARV bare fra meldinger som faktisk nevner smalfilm/gauge
function historySmalfilm(history=[]){
  let ctx={ hasFilm:false, minutter:null, ruller:null, gauge:null, sound:null };
  for(let i=history.length-1;i>=0;i--){
    const h=history[i]; if(h?.role!=="user") continue;
    const t=(h.content||"").toLowerCase();
    const hasFilm=/(smalfilm|super\s*8|super8|8\s*mm|8mm|16\s*mm|16mm)\b/.test(t);
    if(!hasFilm) continue;           // <-- Viktig: bare meldinger om smalfilm
    const min=extractMinutes(t);
    const rul=extractRuller(t);

    const gauge16=/(16\s*mm|16mm)\b/.test(t);
    const gaugeS8=/(super\s*8|super8)\b/.test(t);
    const gauge8=/(8\s*mm|8mm)\b/.test(t) && !gaugeS8;

    const soundOptical=/(optisk lyd|optisk)\b/.test(t);
    const soundMagnetic=/(magnetisk lyd|magnetlyd|magnetisk)\b/.test(t);
    const soundGeneric=/\blyd\b/.test(t);

    ctx.hasFilm=true;
    if(min != null && ctx.minutter == null) ctx.minutter=min;
    if(rul != null && ctx.ruller   == null) ctx.ruller=rul;
    if(!ctx.gauge){ if(gauge16) ctx.gauge="16mm"; else if(gaugeS8) ctx.gauge="super8"; else if(gauge8) ctx.gauge="8mm"; }
    if(!ctx.sound){ if(soundOptical) ctx.sound="optisk"; else if(soundMagnetic) ctx.sound="magnetisk"; else if(soundGeneric) ctx.sound="ja"; }
    if(ctx.minutter!=null && ctx.ruller!=null) break;
  }
  return ctx;
}
function minutesFromUserHistory(history=[]){
  for(let i=history.length-1;i>=0;i--){ const h=history[i]; if(h?.role!=="user") continue; const n=extractMinutes(h?.content||""); if(n!=null) return n; }
  return null;
}

/* --------------- pricing --------------- */
function smalfilmDiscount(totalMinutes){ if(totalMinutes >= 360) return 0.20; if(totalMinutes > 180) return 0.10; return 0; }

// satser for smalfilm ut fra gauge/lyd
function getSmalfilmRates(prices,{gauge,sound}){
  let perMin = toNum(prices.smalfilm_min_rate ?? prices.smalfilm_per_minutt ?? 75);
  let startGeb = toNum(prices.smalfilm_start_per_rull ?? 95);
  let addPerMin = 0;

  if(gauge==="16mm"){
    const per20Base = toNum(prices.film16_per20 ?? 1795);
    const per20Mag  = toNum(prices.film16_mag_sound_per20 ?? 200);
    const per20Opt  = toNum(prices.film16_optical_per20 ?? 2990);
    perMin   = per20Base/20;                   // 89.75
    startGeb = toNum(prices.film16_start_per_rull ?? 125);
    if(sound==="optisk"){ perMin = per20Opt/20; }
    else if(sound==="magnetisk" || sound==="ja"){ addPerMin += per20Mag/20; } // +10
  }

  if((gauge==="super8"||gauge==="8mm") && (sound==="ja"||sound==="magnetisk"||sound==="optisk")){
    const per20S8Sound = toNum(prices.super8_sound_per20 ?? 100);
    addPerMin += per20S8Sound/20;              // +5
  }

  return { perMin: perMin + addPerMin, startGeb };
}

function priceSmalfilm(minutter,ruller,prices,opts={}){
  const { perMin, startGeb } = getSmalfilmRates(prices,opts);
  const usbMin   = toNum(prices.usb_min_price ?? prices.minnepenn ?? 295);

  if(minutter == null){
    const gaugeTxt = opts?.gauge==="16mm"
      ? `16 mm prises ca. ${(toNum(prices.film16_per20 ?? 1795)/20).toFixed(2)} kr/min (+${(toNum(prices.film16_mag_sound_per20 ?? 200)/20).toFixed(2)} kr/min ved magnetisk lyd, eller ${(toNum(prices.film16_optical_per20 ?? 2990)/20).toFixed(2)} kr/min ved optisk lyd). Startgebyr ${toNum(prices.film16_start_per_rull ?? 125)} kr pr rull.`
      : `Smalfilm prises med ca. ${perMin.toFixed(2)} kr per minutt + ${startGeb} kr i startgebyr per rull.`;
    const txt=[gaugeTxt,`Vi gir 10% rabatt når samlet spilletid er over 3 timer, og 20% rabatt over 6 timer.`,`Oppgi gjerne antall minutter og ruller for et konkret prisestimat. USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`].join(" ");
    return { answer: txt, source: "Pris" };
  }

  const mins=Math.max(0,toInt(minutter));
  const rolls=ruller!=null?Math.max(1,toInt(ruller)):1;

  const disc=smalfilmDiscount(mins);
  const arbeid=mins*perMin*(1-disc);
  const start=rolls*startGeb;
  const total=round5(arbeid+start);

  const gaugeLabel=opts?.gauge?` (${opts.gauge})`:"";
  let out=`For ${mins} minutter smalfilm${gaugeLabel} og ${rolls} ${rolls===1?"rull":"ruller"} er prisen ca ${nok(total)} kr.`;
  if(disc>0) out+=` (Rabatt er inkludert: ${(disc*100).toFixed(0)}% for ${(mins/60).toFixed(1)} timer totalt.)`;
  out+=` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
  return { answer: out, source: "Pris" };
}

/* --- Video (VHS/Hi8/Video8/MiniDV etc.) -------------------- */
function parseVideoIntent(text=""){
  const m=text.toLowerCase();

  // Klassiske båndformater
  const hasTapeWord = /(vhs|videokassett|videobånd|hi8|video8|minidv|vhsc)\b/.test(m);

  // GENERISK mønster: "X timer/minutter video"
  const minutes = extractMinutes(m);
  const hasGenericVideo = /\bvideo(er)?\b/.test(m) && minutes!=null;

  if(!hasTapeWord && !hasGenericVideo) return null;

  const kMatch=m.match(/(\d{1,3})\s*(kassett|kassetter|bånd|videobånd)\b/);
  const kassetter=kMatch?toInt(kMatch[1]):null;
  return { minutter: minutes, kassetter };
}

// --- ERSTATT HELE DENNE FUNKSJONEN ---
function priceVideo({ minutter, kassetter }, prices) {
  // Tåler både tall og strenger som "315 kr"
  let perTime = toNum(prices.vhs_per_time, 0);
  if (!perTime) perTime = toNum(prices.video_per_time, 0);
  if (!perTime) perTime = toInt(prices.vhs_per_time_kr, 0);
  if (!perTime) perTime = 315; // siste fallback

  let usbMin = toNum(prices.usb_min_price, 0);
  if (!usbMin) usbMin = toInt(prices.usb_min_price, 0);
  if (!usbMin) usbMin = toInt(prices.minnepenn, 295);
  if (!usbMin) usbMin = 295;

  if (minutter != null) {
    const min = Math.max(0, toInt(minutter));
    const hrs = min / 60;

    // Rabatt: ≥10 t = 10%, ≥20 t = 20%
    let disc = 0;
    if (hrs >= 20) disc = 0.20;
    else if (hrs >= 10) disc = 0.10;

    const total = round5(hrs * perTime * (1 - disc));
    let txt = `Video prises pr time digitalisert opptak (${perTime} kr/time). For ${hrs.toFixed(1)} timer blir prisen ca ${nok(total)} kr.`;
    if (disc > 0) txt += ` (Inkluderer ${(disc * 100).toFixed(0)}% rabatt.)`;
    txt += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
    return { answer: txt, source: "Pris" };
  }

  if (kassetter != null) {
    const k = Math.max(1, toInt(kassetter));
    // anslag 60–120 min pr kassett
    const lowH  = k * 1.0;
    const highH = k * 2.0;

    const lowDisc  = lowH  >= 20 ? 0.20 : (lowH  >= 10 ? 0.10 : 0);
    const highDisc = highH >= 20 ? 0.20 : (highH >= 10 ? 0.10 : 0);

    const low  = round5(lowH  * perTime * (1 - lowDisc));
    const high = round5(highH * perTime * (1 - highDisc));

    const txt = [
      `Vi priser per time digitalisert video (${perTime} kr/time).`,
      `${k} ${k === 1 ? "kassett" : "kassetter"} kan typisk være ${lowH.toFixed(1)}–${highH.toFixed(1)} timer`,
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


/* ---------- Purchase intent ---------- */
function handlePurchaseIntent(message,prices={}){
  if(!looksLikePurchase(message)) return null;
  const m=message.toLowerCase();
  const usbMin=Number(prices?.usb_min_price ?? prices?.minnepenn ?? 295);

  if(mentionsAny(m,["tom kassett","tomme videokassetter","blank kassett","videokassetter","vhs-kassett"]) && !mentionsAny(m,["minnepenn","usb"])){
    return { answer:"Vi selger ikke tomme video-/VHS-kassetter. Vi digitaliserer derimot eksisterende opptak. Til lagring selger vi USB/minnepenner i flere størrelser (fra ca. "+usbMin+" kr), og vi tilbyr også fotoutskrifter i fine-art-kvalitet samt rammer. Si gjerne hva du ønsker å kjøpe, så hjelper jeg deg videre.", source:"AI" };
  }
  if(mentionsAny(m,["usb","minnepenn","minnepenner","memory stick"])){
    return { answer:`Ja, vi selger USB/minnepenner i ulike størrelser (god kvalitet, 10 års garanti). Pris fra ca. ${usbMin} kr. Si gjerne hvor mye lagringsplass du trenger (f.eks. 32/64/128 GB), så foreslår jeg riktig størrelse.`, source:"AI" };
  }
  if(mentionsAny(m,["fotoutskrift","print","fine art","papir","ramme","rammer"])){
    return { answer:"Ja, vi tilbyr fotoutskrifter i fine-art-kvalitet og rammer. Oppgi gjerne ønsket størrelse og antall (f.eks. 30×40 cm, 5 stk), så gir vi pris og leveringstid.", source:"AI" };
  }
  return { answer:"Vi har et begrenset utvalg produkter for salg: USB/minnepenner, fotoutskrifter i fine-art-kvalitet og rammer. Fortell meg hva du ønsker (type, størrelse/kapasitet og antall), så hjelper jeg med pris og levering.", source:"AI" };
}

/* ---------- Booking intent ---------- */
function parseBookingIntent(message,history){
  if(!looksLikeBooking(message)) return null;
  let when=extractDate(message), time=extractTimeRange(message), place=extractPlace(message), want=extractDeliverable(message), email=extractEmail(message);
  if(!when) when=fromHistory(history,extractDate);
  if(!time) time=fromHistory(history,extractTimeRange);
  if(!place) place=fromHistory(history,extractPlace);
  if(!want) want=fromHistory(history,extractDeliverable);
  if(!email) email=fromHistory(history,extractEmail);
  return { when,time,place,want,email };
}
function missingBookingSlots(slots){ const need=[]; if(!slots.when)need.push("dato"); if(!slots.time)need.push("tidsrom"); if(!slots.place)need.push("sted"); if(!slots.want)need.push("ønsket leveranse (f.eks. klippet film/SoMe-klipp)"); if(!slots.email)need.push("e-postadresse"); return need; }
async function handleBookingIntent(message,history){
  const slots=parseBookingIntent(message,history); if(!slots) return null;
  const need=missingBookingSlots(slots);
  if(need.length){ return { answer:`Supert! For å gi et konkret tilbud trenger jeg ${need.join(", ")}. Skriv f.eks.: “${slots.place||"Sted"} ${slots.when||"12.10"} ${slots.time||"12–15"}, ${slots.want||"klippet film"} – ${slots.email||"navn@epost.no"}”.`, source:"AI" }; }
  const to=process.env.LUNA_ALERT_TO||"kontakt@lunamedia.no";
  const from=process.env.LUNA_ALERT_FROM||"Luna Media <post@lunamedia.no>";
  const subject=`Bookingforespørsel: ${slots.when} ${slots.time} – ${slots.place}`;
  const text=["Ny forespørsel om filming:","",`Dato: ${slots.when}`,`Tidsrom: ${slots.time}`,`Sted: ${slots.place}`,`Ønsket leveranse: ${slots.want}`,`Kontakt: ${slots.email}`,"","Hele dialogen (siste meldinger først):",...(Array.isArray(history)?history.slice(-10).reverse().map(h=>`- ${h.role}: ${h.content}`):[])].join("\n");
  const sendRes=await sendBookingEmail({to,from,subject,text});
  const confirm=`Takk! Jeg har notert ${slots.when}, ${slots.time} på ${slots.place}, med leveranse “${slots.want}”. Jeg sender et uforpliktende tilbud til ${slots.email} veldig snart.`;
  return { answer: confirm + (sendRes.ok?"":" (Lite hint: e-postvarslet mitt feilet – men vi følger opp manuelt.)"), source:"AI" };
}

/* --------------- handler --------------- */
export default async function handler(req,res){
  const allowed=(process.env.LUNA_ALLOWED_ORIGINS||"*").split(",").map(s=>s.trim());
  const origin=req.headers.origin||"";
  if(allowed.includes("*")||allowed.includes(origin)){ res.setHeader("Access-Control-Allow-Origin",origin||"*"); res.setHeader("Vary","Origin"); }
  if(req.method==="OPTIONS"){ res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers","Content-Type"); return res.status(200).end(); }
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});

  try{
    let body=req.body||{}; if(typeof body==="string"){ try{ body=JSON.parse(body);}catch{ body={}; } }
    const message=(body.message||"").trim();
    const history=Array.isArray(body.history)?body.history:[];
    if(!message) return res.status(400).json({error:"Missing message"});

    const { faq, prices } = loadData();

    // 1) FAQ
    const kbHits=simpleSearch(message,faq);
    if(kbHits?.[0]?.a) return res.status(200).json({answer:kbHits[0].a,source:"FAQ"});

    // 2) Purchase intent
    const salesHit=handlePurchaseIntent(message,prices);
    if(salesHit) return res.status(200).json(salesHit);

    // 3) Video-pris
    const vIntent=parseVideoIntent(message);
    if(vIntent){
      if(vIntent.minutter==null) vIntent.minutter=minutesFromUserHistory(history);
      return res.status(200).json( priceVideo(vIntent,prices) );
    }

    // 4) Smalfilm (med gauge/lyd + “arv” kun fra smalfilm-meldinger)
    const smNow=parseSmalfilmLoose(message);
    const smHist=historySmalfilm(history);
    const shouldSmalfilm = smNow.hasFilm || (smNow.mentionsRullOnly && (smHist.hasFilm || smHist.minutter!=null));
    if(shouldSmalfilm){
      const minutter = smNow.minutter ?? smHist.minutter ?? null;
      const ruller   = smNow.ruller   ?? smHist.ruller   ?? null;
      const gauge    = smNow.gauge    ?? smHist.gauge    ?? null;
      const sound    = smNow.sound    ?? smHist.sound    ?? null;
      return res.status(200).json( priceSmalfilm(minutter,ruller,prices,{gauge,sound}) );
    }

    // 5) Booking intent
    const bookingHit=await handleBookingIntent(message,history);
    if(bookingHit) return res.status(200).json(bookingHit);

    // 6) LLM fallback m/ filming-guard
    const system=[
      'Du er "Luna" – en vennlig og presis AI-assistent for Luna Media (Vestfold).',
      "Svar kort på norsk. Bruk priseksempler og FAQ nedenfor når relevant.",
      "Hvis noe er uklart eller pris mangler: si det, og foreslå tilbud via skjema/e-post.",
      "Tilby menneskelig overtakelse ved spesielle behov.",
      "VIKTIG: Hvis kunden spør om filming/booking (arrangement, bryllup, konfirmasjon, event):",
      "- Tilby ALLTID menneskelig overtakelse i tillegg til svaret.",
      "- Be konkret om: dato, sted, tidsrom, ønsket leveranse (klippet film/SoMe-klipp), og e-post.",
      "- Eksempeltillegg: «Vi kan ta dette videre på e-post – kan du oppgi dato, sted, tidsrom og e-post?»",
      "",
      "Priser (kan være tomt):",
      JSON.stringify(prices,null,2)
    ].join("\n");

    const OPENAI_API_KEY=process.env.OPENAI_API_KEY;
    const model=process.env.LUNA_MODEL||"gpt-4o-mini";
    const user=`Kunde spør: ${message}\nSvar på norsk, maks 2–3 setninger.`;
    let answer="Beklager, jeg har ikke et godt svar på dette akkurat nå. Send oss gjerne e-post på kontakt@lunamedia.no eller ring 33 74 02 80.";
    if(!OPENAI_API_KEY) return res.status(200).json({answer,source:"fallback_no_key"});

    try{
      const resp=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${OPENAI_API_KEY}`},body:JSON.stringify({model,temperature:0.3,max_tokens:400,messages:[{role:"system",content:system},...history,{role:"user",content:user}]})});
      const text=await resp.text(); let data; try{ data=JSON.parse(text);}catch{ throw new Error("OpenAI JSON parse error: "+text); }
      if(!resp.ok) throw new Error(data?.error?.message||`OpenAI feilkode ${resp.status}`);
      const content=data?.choices?.[0]?.message?.content?.trim(); if(content) answer=content;
      return res.status(200).json({answer,source:"AI"});
    }catch(e){
      console.error("OpenAI-kall feilet:",e?.message);
      return res.status(200).json({answer,source:"fallback_openai_error"});
    }
  }catch(err){
    console.error("Handler-feil:",err);
    return res.status(500).json({error:"Server error"});
  }
}
