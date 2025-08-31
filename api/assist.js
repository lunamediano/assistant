// /api/assist.js  — ultra-kompatibel, uten || / ?? / optional chaining
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ---------------- basic helpers (konservativ syntaks) ---------------- */
function or2(a,b){ return (a!==undefined && a!==null && a!=="" ? a : b); }
function lc(s){ return (s||"").toLowerCase(); }
function clean(s){ try{ return (s||"").normalize("NFKD"); }catch{ return (s||""); } }
function nok(n){ var v=Number(n||0); return v.toLocaleString("no-NO"); }
function toInt(v,d){ var n=parseInt(String(v).replace(/[^\d-]/g,""),10); return isFinite(n)?n:(d||0); }
function toNum(v,d){ var n=Number(v); return isFinite(n)?n:(d||0); }
function round5(n){ return Math.round(n/5)*5; }
function stripMd(s){ return (s||"").replace(/\*\*/g,""); }

/* Safe file read */
function safeRead(file, kind){
  try{
    if(!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file,"utf8");
    if(kind==="json"){ try{ return JSON.parse(raw); }catch{ return null; } }
    if(kind==="yaml"){ try{ return yaml.load(raw); }catch{ return null; } }
    return raw;
  }catch{ return null; }
}

/* ---------------- load optional data ---------------- */
function loadData(){
  var faq = []; var prices = {};
  try{
    var cands = [
      path.join(__dirname,"..","data","faq.yaml"),
      path.join(__dirname,"..","knowledge","faq_round1.yml"),
      path.join(__dirname,"..","knowledge","faq_round1.yaml"),
      path.join(__dirname,"..","knowledge","luna.yml")
    ];
    for(var i=0;i<cands.length;i++){
      var p=cands[i];
      var doc = safeRead(p,"yaml");
      if(!doc) continue;
      var isLuna = /luna\.yml$/i.test(p);
      if(isLuna){
        var items = Array.isArray(doc&&doc.faq)?doc.faq:(Array.isArray(doc&&doc.knowledge&&doc.knowledge.faq)?doc.knowledge.faq:[]);
        if(items&&items.length) faq = faq.concat(items);
        var pr = (doc&&doc.priser)?doc.priser:((doc&&doc.prices)?doc.prices:((doc&&doc.company&&doc.company.prices)?doc.company.prices:null));
        if(pr && typeof pr==="object"){
          for(var k in pr){ if(Object.prototype.hasOwnProperty.call(pr,k)) prices[k]=pr[k]; }
        }
      }else{
        var arr = Array.isArray(doc)?doc:(doc&&doc.faq?doc.faq:[]);
        if(arr&&arr.length) faq = faq.concat(arr);
      }
    }
    var pj = safeRead(path.join(__dirname,"..","data","priser.json"),"json");
    if(pj && typeof pj==="object"){ for(var k2 in pj){ prices[k2]=pj[k2]; } }
  }catch{}
  return { faq: faq||[], prices: prices||{} };
}

/* ---------------- tiny search (ASCII-safe) ---------------- */
function toks(s){
  return clean(s).replace(/[^a-z0-9æøå\s]/gi," ").toLowerCase().replace(/\s+/g," ").trim().split(" ").filter(Boolean);
}
function jaccard(a,b){
  if(!a.length||!b.length) return 0;
  var A={}; for(var i=0;i<a.length;i++) A[a[i]]=1;
  var inter=0, uniObj={}; for(var j=0;j<a.length;j++) uniObj[a[j]]=1; for(var k=0;k<b.length;k++){ if(A[b[k]]) inter++; uniObj[b[k]]=1; }
  var uni=Object.keys(uniObj).length;
  return inter/uni;
}
function simpleSearch(q, faq, min){
  min = min || 0.65;
  var qt = toks(q);
  var best=null;
  for(var i=0;i<(faq||[]).length;i++){
    var it = faq[i];
    var cands = []; 
    if(it && it.q) cands.push(toks(it.q));
    if(it && Array.isArray(it.alt)){ for(var a=0;a<it.alt.length;a++) cands.push(toks(it.alt[a])); }
    var bestLocal=0;
    for(var c=0;c<cands.length;c++){ var sc=jaccard(qt,cands[c]); if(sc>bestLocal) bestLocal=sc; }
    if(!best || bestLocal>best.score) best={ it:it, score:bestLocal };
  }
  if(best && best.score>=min) return [{ a: stripMd(best.it && best.it.a ? best.it.a : "") }];
  return [];
}

/* ---------------- extractors ---------------- */
var NO_WORDNUM = { "null":0,"en":1,"ett":1,"ei":1,"to":2,"tre":3,"fire":4,"fem":5,"seks":6,"sju":7,"syv":7,"åtte":8,"ni":9,"ti":10 };
function wordToNum(w){ var k=clean(w).toLowerCase().replace(/[^a-zæøå]/g,""); return Object.prototype.hasOwnProperty.call(NO_WORDNUM,k)?NO_WORDNUM[k]:null; }

function extractMinutes(text){
  var m = lc(clean(text));
  var mm = m.match(/(\d{1,4})\s*(min|minutt|minutter)\b/);
  var hh = m.match(/(\d{1,3})\s*(t|time|timer)\b/);
  if(mm) return toInt(mm[1]);
  if(hh) return toInt(hh[1])*60;
  var wm = m.match(/([a-zæøå]+)\s*(min|minutt|minutter)\b/);
  var wh = m.match(/([a-zæøå]+)\s*(t|time|timer)\b/);
  if(wm){ var n1=wordToNum(wm[1]); if(n1!=null) return n1; }
  if(wh){ var n2=wordToNum(wh[1]); if(n2!=null) return n2*60; }
  return null;
}
function extractCount(text, word){
  var m = lc(clean(text));
  var rx1 = new RegExp("(\\d{1,3})\\s*"+word+"\\b");
  var rx2 = new RegExp("([a-zæøå]+)\\s*"+word+"\\b");
  var d = m.match(rx1); if(d) return toInt(d[1]);
  var w = m.match(rx2); if(w){ var n=wordToNum(w[1]); if(n!=null) return n; }
  return null;
}
function extractDiameters(text){
  var out=[]; var re=/(\d{1,2}(?:[.,]\d)?)\s*cm\b/gi; var m;
  while((m=re.exec(text||""))) out.push(parseFloat(String(m[1]).replace(",",".")));
  return out;
}
function fromUserHistory(history, extractor){
  if(!Array.isArray(history)) return null;
  for(var i=history.length-1;i>=0;i--){
    var h=history[i]; if(!h || h.role!=="user") continue;
    var v = extractor(h.content||"");
    if(Array.isArray(v)){ if(v.length) return v; }
    else if(v!==null && v!==undefined) return v;
  }
  return null;
}

/* ---------------- intents: purchase / delivery / repair ---------------- */
var PURCHASE_WORDS = ["kjøpe","kjøp","selger","bestille","minnepenn","usb","ramme","rammer","fotoutskrift","print","fine art","papir","tomme videokassetter","tom kassett","blank kassett"];
function looksLikePurchase(msg){
  var m=lc(msg);
  for(var i=0;i<PURCHASE_WORDS.length;i++){ if(m.indexOf(PURCHASE_WORDS[i])!==-1) return true; }
  return false;
}
function handlePurchase(message, prices){
  if(!looksLikePurchase(message)) return null;
  prices = prices || {};
  var m=lc(message);
  var usbMin = toNum(prices.usb_min_price ? prices.usb_min_price : (prices.minnepenn ? prices.minnepenn : 295), 295);

  if( (m.indexOf("tom")!==-1 || m.indexOf("tomme")!==-1 || m.indexOf("blank")!==-1) &&
      (m.indexOf("kassett")!==-1 || m.indexOf("videokassett")!==-1) ){
    return { answer: "Vi selger ikke tomme video-/VHS-kassetter. Vi digitaliserer derimot opptak. Til lagring selger vi USB/minnepenner i flere størrelser (fra ca. " + nok(usbMin) + " kr) og vi tilbyr fotoutskrifter og rammer.", source:"AI" };
  }
  if(m.indexOf("usb")!==-1 || m.indexOf("minnepenn")!==-1){
    return { answer: "Ja, vi selger USB/minnepenner i ulike størrelser. Pris fra ca. " + nok(usbMin) + " kr. Si gjerne hvor mye lagringsplass du trenger (f.eks. 32/64/128 GB).", source:"AI" };
  }
  if(m.indexOf("fotoutskrift")!==-1 || m.indexOf("print")!==-1 || m.indexOf("fine art")!==-1 || m.indexOf("ramme")!==-1){
    return { answer: "Ja, vi tilbyr fotoutskrifter i fine-art-kvalitet og rammer. Oppgi ønsket størrelse og antall (f.eks. 30×40 cm, 5 stk), så gir vi pris og leveringstid.", source:"AI" };
  }
  return { answer: "Vi selger USB/minnepenner, fotoutskrifter i fine-art-kvalitet og rammer. Si hva du ønsker (type, størrelse/kapasitet og antall), så får du pris og levering.", source:"AI" };
}

var DELIVERY_WORDS = ["levere","levering","post","send","adresse","hente","henting","innlevering","kan dere hente","hente i"];
function handleDelivery(message){
  var m=lc(message);
  var match=false; for(var i=0;i<DELIVERY_WORDS.length;i++){ if(m.indexOf(DELIVERY_WORDS[i])!==-1){ match=true; break; } }
  if(!match) return null;

  var hent = m.match(/\bhent[e]?\b.*\bi\s+([a-zæøå]+)/i);
  if(hent && hent[1]){
    var place = hent[1];
    return { answer: "Det kan hende vi kan hente i " + place + ". Ta kontakt, så finner vi en god løsning. Ring 33 74 02 80 eller skriv til kontakt@lunamedia.no.", source:"AI" };
  }

  var text = [
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

var REPAIR_TRIGGERS = ["ødelagt kassett","reparere kassett","kassett ødelagt","bånd brutt","spole gått av","reparasjon kassett","fixe kassett"];
function handleRepair(message){
  var m=lc(message);
  var hit=false; for(var i=0;i<REPAIR_TRIGGERS.length;i++){ if(m.indexOf(REPAIR_TRIGGERS[i])!==-1){ hit=true; break; } }
  if(!hit) return null;
  return { answer: "Ja – vi reparerer videokassetter (VHS, VHSc, Video8/Hi8, MiniDV m.fl.). Vi skjøter brudd i båndet, bytter hus/spole ved behov og kan ofte redde innholdet. Pris avhenger av skadeomfang og antall kassetter – be gjerne om tilbud.", source:"AI" };
}

/* ---------------- film helpers & pricing ---------------- */
function looksLikeS8or8mm(msg){ return /(super\s*8|\bs8\b|8\s*mm|8mm|dobbel[-\s]?8|\bd8\b)/i.test(msg||""); }
function looksLike16mm(msg){   return /\b16\s*mm\b|\b16mm\b/i.test(msg||""); }
function extractSound16(msg){
  var m=lc(msg||"");
  if(m.indexOf("optisk")!==-1) return "optisk";
  if(m.indexOf("magnetisk")!==-1) return "magnetisk";
  return "none";
}

var S8_MAP = [
  { d: 7.5,  minutes: { s8: 4,  std8: 4  } },
  { d: 12.7, minutes: { s8: 12, std8: 16 } },
  { d: 14.5, minutes: { s8: 18, std8: 22 } },
  { d: 17.0, minutes: { s8: 24, std8: 32 } }
];
function nearestS8(d){
  if(!isFinite(d)) return null;
  var best=null, diff=1e9;
  for(var i=0;i<S8_MAP.length;i++){
    var row=S8_MAP[i]; var dd=Math.abs(d-row.d);
    if(dd<diff){ diff=dd; best=row; }
  }
  return best;
}
function estimateS8MinutesFromDiameters(diams, isSuper8){
  diams = diams||[]; var total=0;
  for(var i=0;i<diams.length;i++){
    var row=nearestS8(diams[i]);
    if(row){ total += (isSuper8? row.minutes.s8 : row.minutes.std8); }
  }
  return total;
}

function smalfilmDiscount(totalMinutes){
  if(totalMinutes>=360) return 0.20;
  if(totalMinutes>180)  return 0.10;
  return 0;
}
function priceSmalfilm(input){
  input = input||{};
  var prices = input.prices||{};
  var perMinBase = toNum(prices.smalfilm_min_rate ? prices.smalfilm_min_rate : (prices.smalfilm_per_minutt ? prices.smalfilm_per_minutt : 75),75);
  var startGeb   = toNum(prices.smalfilm_start_per_rull ? prices.smalfilm_start_per_rull : 95,95);
  var usbMin     = toNum(prices.usb_min_price ? prices.usb_min_price : (prices.minnepenn ? prices.minnepenn : 295),295);
  var perMin     = input.hasSound ? (perMinBase + 5) : perMinBase;

  var mins  = Math.max(0,toInt(input.minutes,0));
  var rolls = Math.max(1,toInt(or2(input.rolls,1),1));
  var disc  = smalfilmDiscount(mins);
  var total = round5(mins*perMin*(1-disc) + rolls*startGeb);

  var out = "For " + mins + " minutter smalfilm og " + rolls + " " + (rolls===1?"rull":"ruller") + " er prisen ca " + nok(total) + " kr.";
  if(disc>0) out += " (Rabatt er inkludert: " + (disc*100).toFixed(0) + "% for " + (mins/60).toFixed(1) + " timer totalt.)";
  out += " USB/minnepenn kommer i tillegg (fra " + nok(usbMin) + " kr).";
  out += " Det vil alltid være noen usikre variabler i utregning av lengde på smalfilm dersom du ikke vet dette eksakt. Betrakt derfor svaret som et estimat, og kontakt oss gjerne per telefon eller e-post for et sikrere estimat og eventuelt pristilbud.";
  return { answer: out, source:"Pris" };
}
function price16mm(input){
  input = input||{};
  var minutes = Math.max(0,toInt(or2(input.minutes,0),0));
  var rolls   = Math.max(1,toInt(or2(input.rolls,1),1));
  var sound   = or2(input.sound,"none");

  var perMin = 1795/20;
  if(sound==="magnetisk") perMin += 200/20;
  if(sound==="optisk")    perMin  = 2990/20;

  var start = 125 * rolls;
  var total = round5(minutes*perMin + start);
  var label = (sound==="optisk"?"med optisk lyd":(sound==="magnetisk"?"med magnetisk lyd":"uten oppgitt lyd"));
  var out = "For " + minutes + " minutter 16 mm ("+label+") og " + rolls + " " + (rolls===1?"rull":"ruller") + " er prisen ca " + nok(total) + " kr. USB/minnepenn i tillegg (fra 295 kr). Dette er et estimat – be gjerne om nøyaktig tilbud.";
  return { answer: out, source:"Pris" };
}
function priceVideo(minutes, prices){
  prices = prices||{};
  var perTime = toNum(prices.vhs_per_time ? prices.vhs_per_time : (prices.video_per_time ? prices.video_per_time : (prices.vhs_per_time_kr ? prices.vhs_per_time_kr : 315)),315);
  var usbMin  = toNum(prices.usb_min_price ? prices.usb_min_price : (prices.minnepenn ? prices.minnepenn : 295),295);
  if(minutes===null || minutes===undefined){
    return { answer:"Video prises per time ("+nok(perTime)+" kr/time). Oppgi samlet spilletid, så beregner jeg et estimat. USB/minnepenn i tillegg (fra "+nok(usbMin)+" kr).", source:"Pris" };
  }
  var hrs = Math.max(0,toInt(minutes,0))/60;
  var disc = 0; if(hrs>=20) disc=0.20; else if(hrs>=10) disc=0.10;
  var total = round5(hrs*perTime*(1-disc));
  var out = "Video prises per time ("+nok(perTime)+" kr/time). For " + hrs.toFixed(1) + " timer blir prisen ca " + nok(total) + " kr.";
  if(disc>0) out += " (Inkluderer " + (disc*100).toFixed(0) + "% rabatt.)";
  out += " USB/minnepenn kommer i tillegg (fra " + nok(usbMin) + " kr).";
  return { answer: out, source:"Pris" };
}

/* ---------------- handler ---------------- */
export default async function handler(req, res){
  try{
    // CORS (uten ||)
    var allowed = (process.env.LUNA_ALLOWED_ORIGINS ? process.env.LUNA_ALLOWED_ORIGINS : "*").split(",").map(function(s){return s.trim();});
    var origin  = req.headers && req.headers.origin ? req.headers.origin : "";
    var corsOk=false;
    for(var i=0;i<allowed.length;i++){ if(allowed[i]==="*"){ corsOk=true; break; } }
    if(!corsOk){
      for(var j=0;j<allowed.length;j++){ if(allowed[j]===origin){ corsOk=true; break; } }
    }
    if(corsOk){
      res.setHeader("Access-Control-Allow-Origin", origin || "*");
      res.setHeader("Vary","Origin");
    }
    if(req.method==="OPTIONS"){
      res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers","Content-Type");
      return res.status(200).end();
    }
    if(req.method!=="POST") return res.status(405).json({ error:"Method not allowed" });

    // Body
    var body = req.body;
    if(typeof body==="string"){ try{ body=JSON.parse(body); }catch{ body={}; } }
    if(!body || typeof body!=="object") body={};
    var message = (body.message||"").trim();
    var history = Array.isArray(body.history)? body.history : [];
    if(!message) return res.status(200).json({ answer:"Si gjerne litt mer om hva du lurer på, så hjelper jeg deg videre.", source:"AI" });

    var data = loadData();
    var faq  = data.faq;
    var prices = data.prices;

    // intents: levering, reparasjon, kjøp
    var del = handleDelivery(message); if(del) return res.status(200).json(del);
    var rep = handleRepair(message);   if(rep) return res.status(200).json(rep);
    var pur = handlePurchase(message, prices); if(pur) return res.status(200).json(pur);

    // FAQ
    var hit = simpleSearch(message, faq, 0.65);
    if(hit && hit[0] && hit[0].a) return res.status(200).json({ answer: hit[0].a, source:"FAQ" });

    // Film: S8 / 8mm
    var s8Seen = looksLikeS8or8mm(message) ? true : (fromUserHistory(history, function(t){ return looksLikeS8or8mm(t)?true:null; }) ? true:false);
    if(s8Seen){
      var di1 = extractDiameters(message);
      var di2 = fromUserHistory(history, extractDiameters) || [];
      var diameters = di1 && di1.length ? di1 : di2;
      var rollsS8 = extractCount(message,"rull"); if(rollsS8===null) rollsS8 = extractCount(message,"ruller");
      if(rollsS8===null){ var rHist = fromUserHistory(history, function(t){ var a=extractCount(t,"rull"); if(a===null) a=extractCount(t,"ruller"); return a; }); if(rHist!==null) rollsS8=rHist; }
      var minsAny = extractMinutes(message); if(minsAny===null){ minsAny = fromUserHistory(history, extractMinutes); }
      var isSuper8 = (/\bs8\b|super\s*8/i.test(message)) ? true : (fromUserHistory(history,function(t){ return (/\bs8\b|super\s*8/i.test(t))?true:null; })?true:false);
      var hasSound = (/lyd/i.test(message)) ? true : (/lyd/i.test(or2(fromUserHistory(history,function(x){return x;}), "")) ? true:false);

      if(diameters && diameters.length){
        var mins = estimateS8MinutesFromDiameters(diameters, isSuper8);
        var rolls = (rollsS8!==null && rollsS8!==undefined) ? rollsS8 : (diameters.length?diameters.length:1);
        return res.status(200).json( priceSmalfilm({ minutes: mins, rolls: rolls, prices: prices, hasSound: hasSound }) );
      }
      if(minsAny!==null){
        var rolls2 = (rollsS8!==null && rollsS8!==undefined) ? rollsS8 : 1;
        return res.status(200).json( priceSmalfilm({ minutes: minsAny, rolls: rolls2, prices: prices, hasSound: hasSound }) );
      }

      var guide = ""
      + "For å anslå spilletid per rull: oppgi diameter på spolene og om det er 8 mm eller Super 8.\n"
      + "Tommelfingerverdier pr rull:\n"
      + "• 7,5 cm → 8 mm: ca 4 min | Super 8: ca 4 min\n"
      + "• 12–13 cm → 8 mm: ca 16 min | Super 8: ca 12 min\n"
      + "• 14–15 cm → 8 mm: ca 22 min | Super 8: ca 18 min\n"
      + "• 17–18 cm → 8 mm: ca 32 min | Super 8: ca 24 min\n"
      + "Skriv f.eks.: «2 ruller, 12,7 cm, Super 8» – så regner jeg total tid og pris.";
      return res.status(200).json({ answer: guide, source:"AI" });
    }

    // Film: 16 mm
    var mm16Seen = looksLike16mm(message) ? true : (fromUserHistory(history,function(t){ return looksLike16mm(t)?true:null; })?true:false);
    if(mm16Seen){
      var minutes16 = extractMinutes(message); if(minutes16===null){ minutes16 = fromUserHistory(history, extractMinutes); }
      var sound16   = extractSound16(message); if(sound16==="none"){ var tmp = extractSound16(or2(fromUserHistory(history,function(x){return x;}), "")); sound16 = tmp; }
      if(minutes16!==null){
        return res.status(200).json( price16mm({ minutes: minutes16, rolls: 1, sound: sound16 }) );
      }
      return res.status(200).json({ answer:"For 16 mm: oppgi minutter (eller meter) pr rull, og om lyden er optisk eller magnetisk. Skriv f.eks.: «16 mm: 35 min, optisk lyd».", source:"AI" });
    }

    // Video (VHS/Hi8/Video8/MiniDV)
    if(/(vhs|videokassett|videobånd|hi8|video8|minidv|vhsc)\b/i.test(message)){
      var mv = extractMinutes(message); if(mv===null){ mv = fromUserHistory(history, extractMinutes); }
      return res.status(200).json( priceVideo(mv, prices) );
    }

    // Fallback (uten markdown, ingen påstander om folk/partnere)
    var OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if(!OPENAI_API_KEY){
      return res.status(200).json({ answer:"Beklager, jeg har ikke et godt svar på dette akkurat nå. Send oss gjerne e-post på kontakt@lunamedia.no eller ring 33 74 02 80.", source:"fallback_no_key" });
    }
    var system = "Du er 'Luna' – en vennlig assistent for Luna Media (Vestfold). Svar kort på norsk uten markdown-stjerner. Ikke finn på fakta om ansatte eller samarbeid; henvis til kontakt@lunamedia.no eller 33 74 02 80.";

    var answer = "Beklager, jeg har ikke et godt svar på dette nå. Skriv til kontakt@lunamedia.no eller ring 33 74 02 80.";
    try{
      var resp = await fetch("https://api.openai.com/v1/chat/completions",{
        method:"POST",
        headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+OPENAI_API_KEY },
        body: JSON.stringify({
          model: process.env.LUNA_MODEL ? process.env.LUNA_MODEL : "gpt-4o-mini",
          temperature:0.3, max_tokens:300,
          messages:[
            { role:"system", content: system },
            ...(Array.isArray(history)? history.slice(-10) : []),
            { role:"user", content: "Kunde spør: " + message + ". Svar kort, konkret, uten markdown-stjerner." }
          ]
        })
      });
      var raw = await resp.text(); var data=null; try{ data=JSON.parse(raw); }catch{}
      if(resp.ok && data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content){
        answer = stripMd(data.choices[0].message.content.trim());
      }
    }catch{}
    return res.status(200).json({ answer: answer, source:"AI" });

  }catch(err){
    console.error("assist.js fatal:", err && (err.stack||err.message||err));
    return res.status(200).json({ answer:"Oi, her oppsto det et teknisk problem hos oss. Kan du prøve på nytt, eller kontakte kontakt@lunamedia.no?", source:"fallback_runtime_error" });
  }
}
