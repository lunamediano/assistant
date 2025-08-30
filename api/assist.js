// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ---------------------- utils ---------------------- */
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
function formatNOK(n){ return toNum(n,0).toLocaleString("no-NO"); }
function round5(n){ return Math.round(n / 5) * 5; }

/* ---------------------- load data ---------------------- */
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

/* ---------------------- FAQ-søk ---------------------- */
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
    if (!best || bestLocal > best.score) {
      best = { item, score: bestLocal };
    }
  }
  if (best && best.score >= minScore) {
    return [{ a: best.item.a, score: best.score, q: best.item.q }];
  }
  return [];
}

/* ---------------------- PRICE INTENTS ---------------------- */
// Smalfilm: parse
function intSafe(x){ const n = parseInt(String(x).replace(/\D+/g,''),10); return Number.isFinite(n)?n:null; }
function parseSmalfilmFromText(txt){
  const m = (txt||"").toLowerCase();
  const hasSmalfilm = /(smalfilm|super\s*8|8\s*mm|16\s*mm)/.test(m);
  if(!hasSmalfilm) return null;
  const min = m.match(/(\d{1,4})\s*(min|minutt|minutter)/);
  const hr  = m.match(/(\d{1,3})\s*(t|timer)/);
  const rolls = m.match(/(\d{1,3})\s*(rull|ruller)/);

  let minutter = null;
  if (hr) minutter = intSafe(hr[1]) * 60;
  if (min && intSafe(min[1])!=null) minutter = intSafe(min[1]);

  const ruller = rolls ? intSafe(rolls[1]) : null;
  return { minutter, ruller };
}
function extractSmalfilmFromHistory(history){
  if(!Array.isArray(history)) return {};
  for (let i = history.length - 1; i >= 0; i--){
    const h = history[i];
    if(!h?.content) continue;
    const hit = parseSmalfilmFromText(h.content);
    if(hit) return hit;
  }
  return {};
}
function smalfilmDiscount(totalMinutes){
  if (totalMinutes >= 360) return 0.20; // ≥ 6 timer
  if (totalMinutes >= 180) return 0.10; // ≥ 3 timer
  return 0;
}
function calcSmalfilmPrice({minutter, ruller}, priceMap){
  const perMin   = intSafe(priceMap?.smalfilm_min_rate) ?? 75;
  const startGeb = intSafe(priceMap?.smalfilm_start_per_rull) ?? 95;
  const usbMin   = intSafe(priceMap?.usb_min_price) ?? 295;

  const mins  = intSafe(minutter);
  const rolls = intSafe(ruller) ?? 1;

  if (mins == null){
    return {
      text: [
        `Smalfilm prises med ca. ${perMin} kr per minutt + ${startGeb} kr i startgebyr per rull.`,
        `Vi gir 10% rabatt når samlet spilletid er over 3 timer, og 20% rabatt over 6 timer.`,
        `Oppgi gjerne antall minutter og ruller for et konkret prisestimat. USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`
      ].join(" "),
      source: "PRICE"
    };
  }

  const disc   = smalfilmDiscount(mins);
  const arbeid = mins * perMin * (1 - disc);
  const start  = rolls * startGeb;
  const total  = round5(arbeid + start);

  let parts = [`For ${mins} minutter smalfilm og ${rolls} rull${rolls>1?"er":""} er prisen ca ${formatNOK(total)} kr.`];
  if (disc>0) parts.push(`(Rabatt er inkludert: ${(disc*100).toFixed(0)}% for ${(mins/60).toFixed(1)} timer totalt.)`);
  parts.push(`USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`);

  return { text: parts.join(" "), source: "PRICE" };
}

// VHS: parse + rabatt
function parseVhsFromText(txt){
  const m = (txt||"").toLowerCase();
  if(!/(vhs|videokassett|videobånd|minidv|hi8|video8|vhsc)/.test(m)) return null;
  const hours = m.match(/(\d{1,3})\s*(t|time|timer)/);
  const tapes = m.match(/(\d{1,3})\s*(kassett|kassetter|bånd|videobånd)/);
  // Vi regner alltid på tid (timer). Antall kassetter brukes bare til å be om tid.
  return { timer: hours ? intSafe(hours[1]) : null, kassetter: tapes ? intSafe(tapes[1]) : null };
}
function extractVhsFromHistory(history){
  if(!Array.isArray(history)) return {};
  for (let i = history.length - 1; i >= 0; i--){
    const hit = parseVhsFromText(history[i]?.content||"");
    if(hit) return hit;
  }
  return {};
}
function vhsDiscount(totalHours){
  if (totalHours >= 20) return 0.20;
  if (totalHours >= 10) return 0.10;
  return 0;
}
function calcVhsPrice({timer, kassetter}, priceMap){
  const perHour = intSafe(priceMap?.vhs_per_time) ?? intSafe(priceMap?.video_per_time) ?? 315;
  const usbMin  = intSafe(priceMap?.usb_min_price) ?? intSafe(priceMap?.minnepenn) ?? 295;

  // hvis «kassetter» oppgitt uten timer: forklar tidsprising
  if (timer == null && kassetter != null){
    return {
      text: `VHS prises per digitalisert time (ca. ${perHour} kr/time). Oppgi gjerne samlet spilletid for kassettene, så kan jeg beregne totalpris. USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`,
      source: "PRICE"
    };
  }
  if (timer == null){
    return {
      text: `VHS prises per digitalisert time (ca. ${perHour} kr/time). Oppgi gjerne omtrent hvor mange timer opptak du har, så beregner jeg et prisestimat. USB/minnepenn fra ${usbMin} kr.`,
      source: "PRICE"
    };
  }

  const hrs  = intSafe(timer) ?? 0;
  const disc = vhsDiscount(hrs);
  const total = round5(hrs * perHour * (1 - disc));

  let msg = `For ${hrs} time${hrs!==1?"r":""} video blir prisen ca ${formatNOK(total)} kr.`;
  if (disc > 0) {
    const threshold = (disc === 0.20) ? 20 : 10;
    msg += ` (Rabatt inkludert: ${(disc*100).toFixed(0)}% for over ${threshold} timer.)`;
  }
  msg += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
  return { text: msg, source: "PRICE" };
}

/* ---------------------- e-post varsling ---------------------- */
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const NOTIFY_TO   = process.env.NOTIFY_TO   || "kontakt@lunamedia.no";
const NOTIFY_FROM = process.env.NOTIFY_FROM || "Luna <no-reply@lunamedia.no>";

function looksLikeEmail(s=""){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
function lastAssistantMessage(history=[]){
  for(let i=history.length-1;i>=0;i--){
    if(history[i]?.role==="assistant"){ return history[i].content || ""; }
  }
  return "";
}
function renderTranscriptHTML(history=[], lastUser=""){
  const rows = [...history, lastUser ? {role:"user", content:lastUser}:null].filter(Boolean)
    .map(h => {
      const who = h.role === "assistant" ? "Luna" : "Kunde";
      const txt = (h.content||"").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      return `<tr><td style="padding:8px 12px;font-weight:700">${who}</td><td style="padding:8px 12px">${txt}</td></tr>`;
    }).join("");
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial">
      <h2 style="margin:0 0 8px">Ny henvendelse via chat</h2>
      <p>Automatisk varsel fra Luna-widgeten. Se transkriptet under.</p>
      <table border="0" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background:#fafafa;border:1px solid #eee">
        ${rows}
      </table>
      <p style="margin-top:16px;color:#666">Sendt ${new Date().toLocaleString("no-NO")}</p>
    </div>
  `;
}
async function notifyOwner({userEmail, history=[], lastUserMsg=""}){
  // Ikke feile hardt hvis vi ikke har Resend
  if (!resend) {
    console.log("[Luna notify] (ingen RESEND_API_KEY) ville sendt varsel til", NOTIFY_TO, {
      userEmail, lastUserMsg, count: history?.length || 0
    });
    return { ok: false, hint: "no_resend_key" };
  }
  const subject = `Chat – kunde ønsker tilbud (${userEmail})`;
  const html = renderTranscriptHTML(history, lastUserMsg);
  try{
    const res = await resend.emails.send({
      from: NOTIFY_FROM,
      to: NOTIFY_TO.split(",").map(s => s.trim()).filter(Boolean),
      subject,
      html,
      reply_to: userEmail // svar direkte til kunden fra innboksen deres
    });
    return { ok: true, id: res?.data?.id || null };
  }catch(e){
    console.error("Resend send-feil:", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

/* ---------------------- Handler ---------------------- */
export default async function handler(req, res) {
  const allowed = (process.env.LUNA_ALLOWED_ORIGINS || "*")
    .split(",")
    .map(s => s.trim());
  const origin = req.headers.origin || "";
  if (allowed.includes("*") || allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let body = req.body || {};
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const message = (body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    const debug   = !!body.debug;

    if (!message) return res.status(400).json({ error: "Missing message" });

    // === Load FAQ & prices ===
    const { faq, prices, tried, loaded } = loadData();
    const kbHits = simpleSearch(message, faq);

    if (debug) {
      console.log("DATA DEBUG — tried:", tried);
      console.log("DATA DEBUG — loaded:", loaded);
      console.log("DATA DEBUG — counts:", {
        faq: faq.length,
        priceKeys: Object.keys(prices || {}).length
      });
    }

    /* ---------- 1) FAQ ---------- */
    if (kbHits?.[0]?.a) {
      const payload = { answer: kbHits[0].a, source: "FAQ" };
      if (debug) payload._debug = { score: kbHits[0].score, matchedQuestion: kbHits[0].q, data: { tried, loaded, faqCount: faq.length, priceKeys: Object.keys(prices).length }};
      return res.status(200).json(payload);
    }

    /* ---------- 2) PRICE INTENTS ---------- */
    // Smalfilm
    const smNow = parseSmalfilmFromText(message);
    const smHist = extractSmalfilmFromHistory(history);
    const sm = smNow || (smHist.minutter || smHist.ruller ? { minutter: smHist.minutter ?? null, ruller: smHist.ruller ?? null } : null);
    if (sm){
      const merged = {
        minutter: smNow?.minutter ?? smHist.minutter ?? null,
        ruller:   smNow?.ruller   ?? smHist.ruller   ?? null
      };
      const out = calcSmalfilmPrice(merged, prices);
      return res.status(200).json({ answer: out.text, source: "AI" });
    }

    // VHS
    const vNow = parseVhsFromText(message);
    const vHist = extractVhsFromHistory(history);
    const vhs = vNow || (vHist.timer || vHist.kassetter ? { timer: vHist.timer ?? null, kassetter: vHist.kassetter ?? null } : null);
    if (vhs){
      const out = calcVhsPrice({
        timer:     vNow?.timer ?? vHist.timer ?? null,
        kassetter: vNow?.kassetter ?? vHist.kassetter ?? null
      }, prices);
      return res.status(200).json({ answer: out.text, source: "AI" });
    }

    /* ---------- 3) E-POST FANGST & VARSEL ---------- */
    // Hvis brukeren skriver en e-postadresse – og forrige assistent-svar tilbød «tilbud via e-post» – send varsel.
    if (looksLikeEmail(message)) {
      const prevAssist = lastAssistantMessage(history);
      if (/(tilbud|sender deg et tilbud|via e-?post)/i.test(prevAssist)) {
        // Fyr av varsel (best effort – ikke blokker bruker)
        notifyOwner({ userEmail: message, history, lastUserMsg: message }).catch(()=>{});
        // Svar hyggelig til kunden
        return res.status(200).json({
          answer: `Takk! Jeg sender deg et prisoverslag til ${message} straks. Om noe mangler, svar gjerne på e-posten.`,
          source: "AI"
        });
      }
    }

    /* ---------- 4) LLM fallback ---------- */
    const system = [
      'Du er "Luna" – en vennlig og presis AI-assistent for Luna Media (Vestfold).',
      "Svar kort på norsk. Bruk priseksempler og FAQ nedenfor når relevant.",
      "Hvis noe er uklart eller pris mangler: si det, og foreslå tilbud via skjema/e-post.",
      "Tilby menneskelig overtakelse ved spesielle behov.",
      "",
      "Priser (kan være tomt):",
      JSON.stringify(prices, null, 2)
    ].join("\n");

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const model = process.env.LUNA_MODEL || "gpt-4o-mini";

    const user = `Kunde spør: ${message}
Svar på norsk, maks 2–3 setninger.`;

    let answer =
      "Beklager, jeg har ikke et godt svar på dette akkurat nå. " +
      "Send oss gjerne en e-post på kontakt@lunamedia.no eller ring 33 74 02 80.";

    if (!OPENAI_API_KEY) {
      console.warn("Mangler OPENAI_API_KEY – fallback only.");
      const payload = { answer, source: "fallback_no_key" };
      if (debug) payload._debug = { tried, loaded, faqCount: faq.length, priceKeys: Object.keys(prices).length };
      return res.status(200).json(payload);
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

      if (!resp.ok) {
        console.error("OpenAI HTTP error:", resp.status, data?.error || data);
        throw new Error(data?.error?.message || `OpenAI feilkode ${resp.status}`);
      }

      const content = data?.choices?.[0]?.message?.content?.trim();
      if (content) answer = content;

      const payload = { answer, source: "AI" };
      if (debug) payload._debug = { tried, loaded, faqCount: faq.length, priceKeys: Object.keys(prices).length };
      return res.status(200).json(payload);
    } catch (e) {
      console.error("OpenAI-kall feilet:", e?.message);
      const payload = { answer, source: "fallback_openai_error" };
      if (debug) payload._debug = { error: e?.message, tried, loaded, faqCount: faq.length, priceKeys: Object.keys(prices).length };
      return res.status(200).json(payload);
    }

  } catch (err) {
    console.error("Handler-feil:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
