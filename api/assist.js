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

/* ---------------------- Price helpers (shared) ---------------------- */
// safe int
function intSafe(x){ const n = parseInt(String(x).replace(/\D+/g,''),10); return Number.isFinite(n)?n:null; }
// format/round
function formatNOK(n){ return Number(n||0).toLocaleString("no-NO"); }
function round5(n){ return Math.round(n / 5) * 5; }

/* --------- Smalfilm intent + kalkulasjon --------- */
function extractMinutesFromText(s = "") {
  const m = (s || "").toLowerCase();
  const mMin   = m.match(/(\d{1,4})\s*(min|minutt|minutter)/);
  const mTimer = m.match(/(\d{1,3})\s*(t|time|timer)/);
  if (mMin)   return toInt(mMin[1]);
  if (mTimer) return toInt(mTimer[1]) * 60;
  return null;
}
function extractRullerFromText(s = "") {
  const m = (s || "").toLowerCase().match(/(\d{1,3})\s*(rull|ruller)/);
  return m ? toInt(m[1]) : null;
}
function minutesFromHistory(history = []) {
  for (let i = history.length - 1; i >= 0; i--) {
    const n = extractMinutesFromText(history[i]?.content || "");
    if (n != null) return n;
  }
  return null;
}
function rullerFromHistory(history = []) {
  for (let i = history.length - 1; i >= 0; i--) {
    const n = extractRullerFromText(history[i]?.content || "");
    if (n != null) return n;
  }
  return null;
}
function parseSmalfilmIntent(msg) {
  const m = (msg || "").toLowerCase();
  if (!/(smalfilm|super\s*8|super8|8\s*mm|8mm|16\s*mm|16mm)/.test(m)) return null;
  const minutter = extractMinutesFromText(m);
  const ruller   = extractRullerFromText(m);
  return { minutter, ruller };
}
function smalfilmDiscount(totalMinutes){
  if (totalMinutes >= 360) return 0.20; // ≥ 6 timer
  if (totalMinutes >= 180) return 0.10; // ≥ 3 timer
  return 0;
}
function priceSmalfilm({ minutter, ruller }, prices, history) {
  const perMin   = toNum(prices.smalfilm_min_rate ?? prices.smalfilm_per_minutt ?? 75);
  const startGeb = toNum(prices.smalfilm_start_per_rull ?? 95);
  const usbMin   = toNum(prices.usb_min_price ?? prices.minnepenn ?? 295);

  // Fyll fra historikk dersom bare én del er oppgitt
  if (minutter == null) minutter = minutesFromHistory(history);
  if (ruller   == null) ruller   = rullerFromHistory(history);

  if (minutter == null) {
    return [
      `Smalfilm prises med ca. ${perMin} kr per minutt + ${startGeb} kr i startgebyr per rull.`,
      `Vi gir 10% rabatt når samlet spilletid er over 3 timer, og 20% rabatt over 6 timer.`,
      `Oppgi gjerne antall minutter og ruller for et konkret prisestimat. USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`
    ].join(" ");
  }

  const min = Math.max(0, toInt(minutter));
  const rolls = ruller ?? 1;
  const disc = smalfilmDiscount(min);

  const arbeid = min * perMin * (1 - disc);
  const start  = rolls * startGeb;
  const total  = round5(arbeid + start);

  let txt = `For ${min} minutter smalfilm og ${rolls} ${rolls === 1 ? "rull" : "ruller"} er prisen ca ${formatNOK(total)} kr.`;
  if (ruller == null) {
    const altTotal = round5(min * perMin * (1 - disc) + 2 * startGeb);
    txt += ` (Hvis dette gjelder 2 ruller, blir det ca ${formatNOK(altTotal)} kr.)`;
  }
  if (disc > 0) {
    txt += ` (Rabatt er inkludert: ${Math.round(disc * 100)}% for ${(min/60).toFixed(1)} timer totalt.)`;
  }
  txt += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
  return txt;
}

/* --------- VHS intent + kalkulasjon --------- */
function parseVhsIntent(msg) {
  const m = (msg || "").toLowerCase();
  if (!/(vhs|videokassett|videobånd|minidv|hi8|video8|vhsc)/.test(m)) return null;
  let minutter = extractMinutesFromText(m);
  const kMatch = m.match(/(\d{1,3})\s*(kassett|kassetter|bånd|videobånd)/);
  const kassetter = kMatch ? toInt(kMatch[1]) : null;
  return { minutter, kassetter };
}
function vhsDiscount(totalHours){
  if (totalHours >= 20) return 0.20;
  if (totalHours >= 10) return 0.10;
  return 0;
}
function priceVhs({ minutter, kassetter }, prices, history) {
  const perTime = toNum(
    prices.vhs_per_time ??
    prices.video_per_time ??
    prices.vhs_per_time_kr ??
    315
  );
  const usbMin  = toNum(prices.usb_min_price ?? prices.minnepenn ?? 295);

  if (minutter == null) minutter = minutesFromHistory(history);

  if (minutter != null) {
    const min = Math.max(0, toInt(minutter));
    const timer = min / 60;
    const disc = vhsDiscount(timer);
    const total = round5(timer * perTime * (1 - disc));
    let txt = `Video prises pr time digitalisert opptak (${perTime} kr/time). For ${timer.toFixed(1)} timer blir prisen ca ${formatNOK(total)} kr.`;
    if (disc > 0) txt += ` (Inkluderer ${Math.round(disc * 100)}% rabatt.)`;
    txt += ` USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`;
    return txt;
  }

  if (kassetter != null) {
    const k = toInt(kassetter);
    const timeLow  = (k * 60) / 60;
    const timeHigh = (k * 120) / 60;
    const discLow  = vhsDiscount(timeLow);
    const discHigh = vhsDiscount(timeHigh);
    const totLow   = round5(timeLow  * perTime * (1 - discLow));
    const totHigh  = round5(timeHigh * perTime * (1 - discHigh));
    return [
      `Vi priser per time digitalisert video (${perTime} kr/time).`,
      `${k} ${k===1?"kassett":"kassetter"} kan typisk være ${timeLow.toFixed(1)}–${timeHigh.toFixed(1)} timer`,
      `⇒ ca ${formatNOK(totLow)}–${formatNOK(totHigh)} kr (inkl. ev. volumrabatt).`,
      `Oppgi gjerne total spilletid for et mer presist estimat. USB/minnepenn i tillegg (fra ${usbMin} kr).`
    ].join(" ");
  }

  return `Video prises pr time (${perTime} kr/time). Oppgi gjerne total spilletid (timer/minutter), så regner jeg et konkret estimat. USB/minnepenn i tillegg (fra ${usbMin} kr).`;
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

    /* ---------- 1) Pris-intents (før FAQ/LLM) ---------- */
    const smIntent = parseSmalfilmIntent(message);
    if (smIntent) {
      const ans = priceSmalfilm(smIntent, prices, history);
      const payload = { answer: ans, source: "AI" };
      if (debug) payload._debug = { intent: "smalfilm", smIntent, prices };
      return res.status(200).json(payload);
    }
    const vhsIntent = parseVhsIntent(message);
    if (vhsIntent) {
      const ans = priceVhs(vhsIntent, prices, history);
      const payload = { answer: ans, source: "AI" };
      if (debug) payload._debug = { intent: "vhs", vhsIntent, prices };
      return res.status(200).json(payload);
    }

    /* ---------- 2) FAQ ---------- */
    if (kbHits?.[0]?.a) {
      const payload = { answer: kbHits[0].a, source: "FAQ" };
      if (debug) payload._debug = { score: kbHits[0].score, matchedQuestion: kbHits[0].q, data: { tried, loaded, faqCount: faq.length, priceKeys: Object.keys(prices).length }};
      return res.status(200).json(payload);
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
