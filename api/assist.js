// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* -------------------- Safe file helpers -------------------- */
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

/* -------------------- Load data -------------------- */
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

/* -------------------- FAQ-søk -------------------- */
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

/* -------------------- Utils for pris -------------------- */
const fmt = (n) => Number(n).toLocaleString("no-NO");
const toInt = (x) => {
  if (x == null) return null;
  const n = parseInt(String(x).replace(/\D+/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};
const toFloat = (x) => {
  if (x == null) return null;
  const n = parseFloat(String(x).replace(",", ".").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const round = (n) => Math.round(Number(n));

/* -------------------- Intent: Smalfilm -------------------- */
function parseSmalfilmIntent(msg) {
  const m = msg.toLowerCase();
  if (!/(smalfilm|super\s*8|8\s*mm)/.test(m)) return null;

  // minutter / timer
  let minutter = null;
  const mMin = m.match(/(\d{1,4})\s*(min|minutt|minutter)/);
  const mTimer = m.match(/(\d{1,2})\s*(t|time|timer)/);
  if (mMin) minutter = toInt(mMin[1]);
  else if (mTimer) minutter = toInt(mTimer[1]) * 60;

  // ruller
  const mRull = m.match(/(\d{1,3})\s*(rull|ruller)/);
  const ruller = mRull ? toInt(mRull[1]) : null;

  return { minutter, ruller };
}

function priceSmalfilm({ minutter, ruller }, prices) {
  // riktig nøkkel-navn + fallback
  const perMin   = toFloat(prices.smalfilm_per_minutt) ?? 75;
  const startGeb = toFloat(prices.smalfilm_start_per_rull) ?? 95;
  const usbMin   = toFloat(prices.usb_min_price || prices.minnepenn_min_price) ?? 295;

  // Når minutter ikke oppgitt: forklar modell kort
  if (minutter == null) {
    return [
      `Smalfilm prises med ca. ${fmt(perMin)} kr per minutt + ${fmt(startGeb)} kr i startgebyr per rull.`,
      `Vi gir 10% rabatt når det samlet er over 3 timer med film, og 20% rabatt over 6 timer med film.`,
      `Oppgi gjerne antall minutter og ruller for et konkret prisestimat. USB/minnepenn kommer i tillegg (fra ${fmt(usbMin)} kr).`
    ].join(" ");
  }

  const r = ruller ?? 1;
  const grunn = minutter * perMin + r * startGeb;

  // Rabattregler på minuttvolum
  let rabatt = 0;
  if (minutter > 180 && minutter < 360) rabatt = 0.10;
  if (minutter >= 360) rabatt = 0.20;

  const total = round(grunn * (1 - rabatt));
  const deler = [
    `For ${minutter} minutter smalfilm og ${r} rull er prisen ca ${fmt(total)} kr`,
    rabatt ? `(inkl. ${Math.round(rabatt * 100)}% rabatt)` : "",
    `.`
  ].join(" ");

  const tilleggsNotis = `USB/minnepenn kommer i tillegg (fra ${fmt(usbMin)} kr).`;
  const rullHint = (ruller == null)
    ? ` Hvis dette egentlig gjelder 2 ruller, øker totalen litt pga. startgebyret. Oppgi gjerne antall ruller for nøyaktig pris.`
    : "";

  return deler + rullHint + " " + tilleggsNotis;
}

/* -------------------- Intent: VHS (timer + rabatt) -------------------- */
function parseVhsIntent(msg) {
  const m = msg.toLowerCase();
  if (!/(vhs|videokassett|videokassetter|video)/.test(m)) return null;

  // forsøk å hente timeantall (heltall)
  const mTimer = m.match(/(\d{1,3})\s*(t|time|timer)/);
  const timer = mTimer ? toInt(mTimer[1]) : null;

  return { timer };
}

function priceVhs({ timer }, prices) {
  const perTime = toFloat(prices.vhs_per_time || prices.vhs_per_kassett /* legacy */) ?? 315;

  if (timer == null) {
    return `VHS prises per time digitalisert video (ca. ${fmt(perTime)} kr per time). Vi gir 10% rabatt over 10 timer og 20% rabatt over 20 timer. Oppgi gjerne antall timer for et estimat.`;
  }

  // Rabatt: >10t =10%, ≥20t=20%
  let rabatt = 0;
  if (timer > 10 && timer < 20) rabatt = 0.10;
  if (timer >= 20) rabatt = 0.20;

  const grunn = timer * perTime;
  const total = round(grunn * (1 - rabatt));

  return `For ca. ${timer} time(r) digitalisert video blir prisen rundt ${fmt(total)} kr${rabatt ? ` (inkl. ${Math.round(rabatt*100)}% rabatt)` : ""}.`;
}

/* -------------------- Handler -------------------- */
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

    // === 1) Intent: Smalfilm-pris ===
    const smIntent = parseSmalfilmIntent(message);
    if (smIntent) {
      const ans = priceSmalfilm(smIntent, prices);
      const payload = { answer: ans, source: "AI" };
      if (debug) payload._debug = { intent: "smalfilm", smIntent, prices };
      return res.status(200).json(payload);
    }

    // === 2) Intent: VHS-pris ===
    const vhsIntent = parseVhsIntent(message);
    if (vhsIntent) {
      const ans = priceVhs(vhsIntent, prices);
      const payload = { answer: ans, source: "AI" };
      if (debug) payload._debug = { intent: "vhs", vhsIntent, prices };
      return res.status(200).json(payload);
    }

    // === 3) FAQ ===
    if (kbHits?.[0]?.a) {
      const payload = { answer: kbHits[0].a, source: "FAQ" };
      if (debug)
        payload._debug = {
          score: kbHits[0].score,
          matchedQuestion: kbHits[0].q,
          data: { tried, loaded, faqCount: faq.length, priceKeys: Object.keys(prices).length }
        };
      return res.status(200).json(payload);
    }

    // === 4) LLM fallback ===
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

    let answer = "Beklager, jeg har ikke et godt svar på dette akkurat nå. " +
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
