// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
const EMAIL_RX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

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

/* ---------------------- Pris-intents (Smalfilm + VHS) ---------------------- */
// trygt heltall
function intSafe(x){ const n = parseInt(String(x).replace(/\D+/g,''),10); return Number.isFinite(n)?n:null; }
function formatNOK(n){ return n.toLocaleString("no-NO"); }
function round5(n){ return Math.round(n / 5) * 5; }

// Smalfilm: trekk ut minutter/ruller fra tekst
function parseSmalfilmFromText(txt){
  const m = (txt||"").toLowerCase();
  const hasSmalfilm = /(smalfilm|super\s*8|super8|8\s*mm|8mm|16\s*mm|16mm)/.test(m);
  if(!hasSmalfilm) return null;
  const min = m.match(/(\d{1,4})\s*(min|minutt|minutter)/);
  const hr  = m.match(/(\d{1,3})\s*(t|time|timer)/);
  const rolls = m.match(/(\d{1,3})\s*(rull|ruller)/);

  let minutter = null;
  if (hr) minutter = intSafe(hr[1]) * 60;
  if (min && intSafe(min[1])!=null) minutter = intSafe(min[1]);

  const ruller = rolls ? intSafe(rolls[1]) : null;
  return { minutter, ruller };
}
// Hent tidligere oppgitt kontekst fra history
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
// Rabatt etter total minutter
function smalfilmDiscount(totalMinutes){
  if (totalMinutes >= 360) return 0.20; // ≥ 6 timer
  if (totalMinutes >= 180) return 0.10; // ≥ 3 timer
  return 0;
}
// Beregn smalfilmpris
function calcSmalfilmPrice({minutter, ruller}, priceMap){
  const perMin   = intSafe(priceMap?.smalfilm_min_rate) ?? 75;
  const startGeb = intSafe(priceMap?.smalfilm_start_per_rull) ?? 95;
  const usbMin   = intSafe(priceMap?.usb_min_price) ?? 295;

  const mins = intSafe(minutter);
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

  const disc = smalfilmDiscount(mins);
  const arbeid = mins * perMin * (1 - disc);
  const start = rolls * startGeb;
  const total = round5(arbeid + start);

  let parts = [`For ${mins} minutter smalfilm og ${rolls} rull${rolls>1?"er":""} er prisen ca ${formatNOK(total)} kr.`];
  if (disc>0) parts.push(`(Rabatt er inkludert: ${(disc*100).toFixed(0)}% for ${(mins/60).toFixed(1)} timer totalt.)`);
  parts.push(`USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`);

  return { text: parts.join(" "), source: "PRICE" };
}

// VHS
function parseVhsFromText(txt){
  const m = (txt||"").toLowerCase();
  if(!/(vhs|videokassett|videobånd|minidv|hi8|video8|vhsc)/.test(m)) return null;
  const hours = m.match(/(\d{1,3})\s*(t|time|timer)/);
  const tapes = m.match(/(\d{1,3})\s*(kassett|kassetter|bånd|videobånd)/);
  const mins  = m.match(/(\d{1,4})\s*(min|minutt|minutter)/);

  let timer = hours ? intSafe(hours[1]) : null;
  if (!timer && mins) {
    const mm = intSafe(mins[1]);
    if (mm != null) timer = mm/60;
  }
  return { timer: timer!=null ? Number(timer) : null, kassetter: tapes ? intSafe(tapes[1]) : null };
}
function extractVhsFromHistory(history){
  if(!Array.isArray(history)) return {};
  for (let i = history.length - 1; i >= 0; i--){
    const hit = parseVhsFromText(history[i]?.content||"");
    if(hit && (hit.timer!=null || hit.kassetter!=null)) return hit;
  }
  return {};
}
function vhsDiscount(totalHours){
  if (totalHours >= 20) return 0.20; // ≥20 timer
  if (totalHours >= 10) return 0.10; // ≥10 timer
  return 0;
}
function calcVhsPrice({timer, kassetter}, priceMap){
  const perHour = intSafe(priceMap?.vhs_per_time) ?? intSafe(priceMap?.video_per_time) ?? 315;
  const usbMin  = intSafe(priceMap?.usb_min_price) ?? 295;

  if (timer == null && kassetter != null){
    const k = intSafe(kassetter);
    const timeLow  = k * 1.0;
    const timeHigh = k * 2.0;
    const rabLow  = vhsDiscount(timeLow);
    const rabHigh = vhsDiscount(timeHigh);
    const totLow  = round5(timeLow  * perHour * (1 - rabLow));
    const totHigh = round5(timeHigh * perHour * (1 - rabHigh));
    return {
      text: [
        `Vi priser per time digitalisert video (${perHour} kr/time).`,
        `${k} ${k===1?"kassett":"kassetter"} kan typisk være ${timeLow.toFixed(1)}–${timeHigh.toFixed(1)} timer`,
        `⇒ ca ${formatNOK(totLow)}–${formatNOK(totHigh)} kr (inkl. ev. volumrabatt).`,
        `Oppgi gjerne total spilletid for et mer presist estimat. USB/minnepenn fra ${usbMin} kr.`
      ].join(" "),
      source: "PRICE"
    };
  }

  if (timer == null){
    return {
      text: `VHS prises per time (${perHour} kr/time). Oppgi total spilletid (timer/minutter), så beregner jeg et estimat. USB/minnepenn fra ${usbMin} kr.`,
      source: "PRICE"
    };
  }

  const hrs = Number(timer);
  const disc = vhsDiscount(hrs);
  const total = round5(hrs * perHour * (1 - disc));
  let msg = `For ${hrs.toFixed(1).replace(".0","")} time${hrs!==1?"r":""} video blir prisen ca ${formatNOK(total)} kr.`;
  if (disc>0) msg += ` (Rabatt inkludert: ${(disc*100).toFixed(0)}%.)`;
  msg += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
  return { text: msg, source: "PRICE" };
}

/* ---------------------- E-post via Resend ---------------------- */
async function sendEmail({ subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.SALES_INBOX || "kontakt@lunamedia.no";
  if (!apiKey) return { ok: false, reason: "RESEND_API_KEY missing" };

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Luna Media Assistent <noreply@lunamedia.no>",
      to: [to],
      subject,
      html,
      text
    })
  });

  if (!resp.ok) {
    const err = await resp.text().catch(()=> "");
    return { ok:false, reason: `HTTP ${resp.status}: ${err}` };
  }
  return { ok:true };
}

function findEmailInHistory(history = []) {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = (history[i]?.content || "").match(EMAIL_RX);
    if (m) return m[0];
  }
  return null;
}
function wantsOffer(msg="", history=[]) {
  const m = (msg||"").toLowerCase();
  const hit = /(tilbud|send.*tilbud|ja takk|gi meg.*tilbud|send.*pris|kan.*få.*tilbud)/.test(m);
  if (hit) return true;
  const last = history[history.length-1]?.content?.toLowerCase() || "";
  if (/ønsker du et tilbud\??/.test(last) && /\bja\b/.test(m)) return true;
  return false;
}
function buildTranscript(history = [], lastUserMsg = "", lastAssistantAnswer = "") {
  const lines = [];
  for (const h of history.slice(-20)) {
    if (!h?.content) continue;
    lines.push(`${h.role === "user" ? "Kunde" : "Luna"}: ${h.content}`);
  }
  if (lastUserMsg) lines.push(`Kunde: ${lastUserMsg}`);
  if (lastAssistantAnswer) lines.push(`Luna: ${lastAssistantAnswer}`);
  return lines.join("\n\n");
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

    // helper: send response AND e-post (alltid hvis vi har e-postadresse)
    const finalize = async (answer, source, extraDebug = undefined) => {
      const emailNow = message.match(EMAIL_RX)?.[0] || findEmailInHistory(history);
      const offer = wantsOffer(message, history);

      if (emailNow) {
        const subject = offer
          ? `Ny prisforespørsel fra ${emailNow}`
          : `Ny henvendelse fra ${emailNow}`;
        const transcript = buildTranscript(history, message, answer?.text || answer);
        const html = `<p>Fra: <strong>${emailNow}</strong></p><pre style="font-family:ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap">${transcript}</pre>`;
        const sent = await sendEmail({ subject, html, text: transcript });
        if (debug) console.log("Resend result:", sent);
      }

      const payload = typeof answer === "object" && answer.text
        ? { answer: answer.text, source: source || answer.source || "AI" }
        : { answer: String(answer || "Beklager, noe gikk galt."), source: source || "AI" };

      if (debug) payload._debug = extraDebug || {};
      return res.status(200).json(payload);
    };

    /* ---------- 1) FAQ ---------- */
    const kbHits = simpleSearch(message, faq);
    if (kbHits?.[0]?.a) {
      return finalize(kbHits[0].a, "FAQ", { score: kbHits[0].score, matchedQuestion: kbHits[0].q });
    }

    /* ---------- 2) Pris-intents ---------- */
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
      return finalize(out, out.source, { intent: "smalfilm", merged, prices });
    }

    // VHS
    const vNow  = parseVhsFromText(message);
    const vHist = extractVhsFromHistory(history);
    const vhs   = vNow || (vHist.timer || vHist.kassetter ? { timer: vHist.timer ?? null, kassetter: vHist.kassetter ?? null } : null);
    if (vhs){
      const merged = {
        timer:     vNow?.timer ?? vHist.timer ?? null,
        kassetter: vNow?.kassetter ?? vHist.kassetter ?? null
      };
      const out = calcVhsPrice(merged, prices);
      return finalize(out, out.source, { intent: "vhs", merged, prices });
    }

    /* ---------- 3) LLM fallback ---------- */
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
      return finalize(answer, "fallback_no_key", { tried, loaded });
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

      return finalize(answer, "AI", { tried, loaded });
    } catch (e) {
      console.error("OpenAI-kall feilet:", e?.message);
      return finalize(answer, "fallback_openai_error", { error: e?.message, tried, loaded });
    }

  } catch (err) {
    console.error("Handler-feil:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
