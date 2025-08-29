// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* =========================
   Safe helpers (med logging)
   ========================= */
function fileInfo(p) {
  try {
    const s = fs.statSync(p);
    return { exists: true, size: s.size };
  } catch {
    return { exists: false, size: 0 };
  }
}

function safeRead(p, kind = "text") {
  try {
    const raw = fs.readFileSync(p, "utf8");
    if (kind === "json") return JSON.parse(raw);
    if (kind === "yaml") return yaml.load(raw);
    return raw;
  } catch {
    return null;
  }
}

/* =====================================
   Last data fra flere lokasjoner + debug
   ===================================== */
function loadData(debug = false) {
  const tried = [];
  const loaded = [];

  const faqCandidates = [
    path.join(__dirname, "..", "data", "faq.yaml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yml"),
    path.join(__dirname, "..", "knowledge", "faq_round1.yaml"),
    path.join(__dirname, "..", "knowledge", "luna.yml")
  ];

  let faq = [];
  let prices = {};

  for (const p of faqCandidates) {
    const info = fileInfo(p);
    tried.push({ path: p, ...info });
    if (!info.exists) continue;

    const parsed = safeRead(p, "yaml");
    if (!parsed) continue;

    loaded.push({ path: p, size: info.size });

    if (p.endsWith("luna.yml")) {
      const fromLunaFaq =
        Array.isArray(parsed?.faq) ? parsed.faq :
        Array.isArray(parsed?.knowledge?.faq) ? parsed.knowledge.faq : [];
      if (fromLunaFaq?.length) faq = faq.concat(fromLunaFaq);

      const fromLunaPrices = parsed?.priser || parsed?.prices || parsed?.company?.prices;
      if (fromLunaPrices && typeof fromLunaPrices === "object") {
        prices = { ...prices, ...fromLunaPrices };
      }
    } else {
      const items = Array.isArray(parsed) ? parsed : (parsed?.faq || []);
      if (items?.length) faq = faq.concat(items);
    }
  }

  // Priser fra JSON
  const priceJsonPath = path.join(__dirname, "..", "data", "priser.json");
  const pjInfo = fileInfo(priceJsonPath);
  tried.push({ path: priceJsonPath, ...pjInfo });
  if (pjInfo.exists) {
    const pj = safeRead(priceJsonPath, "json");
    if (pj && typeof pj === "object") {
      loaded.push({ path: priceJsonPath, size: pjInfo.size });
      prices = { ...prices, ...pj };
    }
  }

  if (debug) {
    console.log("DATA DEBUG — tried:", tried);
    console.log("DATA DEBUG — loaded:", loaded);
    console.log("DATA DEBUG — counts:", { faq: faq.length, priceKeys: Object.keys(prices || {}).length });
  }

  return { faq, prices, _dataDebug: { tried, loaded, faqCount: faq.length, priceKeys: Object.keys(prices || {}).length } };
}

/* =========================
   FAQ-søk (presis Jaccard)
   ========================= */
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

/* ===========
   HTTP handler
   =========== */
export default async function handler(req, res) {
  // CORS
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

    // 1) Hent data og match FAQ
    const { faq, prices, _dataDebug } = loadData(debug);
    console.log("Loaded FAQ:", faq.length, "Loaded price keys:", Object.keys(prices).length);

    const kbHits = simpleSearch(message, faq);
    console.log(
      "FAQ hits:", kbHits.length,
      "for:", JSON.stringify(message),
      kbHits[0] ? `-> "${kbHits[0].q}" (score ${kbHits[0].score.toFixed(2)})` : "(ingen treff)"
    );

    // 2) FAQ har førsteprioritet
    if (kbHits?.[0]?.a) {
      const payload = {
        answer: kbHits[0].a
      };
      if (debug) {
        payload._debug = {
          source: "faq",
          score: kbHits[0].score,
          matchedQuestion: kbHits[0].q,
          data: _dataDebug
        };
      }
      return res.status(200).json(payload);
    } else {
      if (debug) console.log("Ingen FAQ-treff — fortsetter med LLM/fallback.");
    }

    // 3) LLM prompt
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
Bruk kun fakta fra "Priser" over hvis relevant. Hvis svaret ikke finnes, si at du er usikker og foreslå kontakt.
Svar på norsk, maks 2–3 setninger.`;

    // Fallback hvis LLM mangler/feiler
    let answer =
      "Beklager, jeg har ikke et godt svar på dette akkurat nå. " +
      "Send oss gjerne en e-post på kontakt@lunamedia.no eller ring 33 74 02 80.";

     // --- Midlertidig bryter: slå av LLM hvis USE_LLM=false ---
if (process.env.USE_LLM === "false") {
  const payload = { answer:
    "Beklager, jeg kan ikke hente ut mer informasjon akkurat nå, men jeg hjelper deg gjerne: " +
    "Spør meg om priser, leveringstid eller formater så svarer jeg etter vår FAQ. " +
    "Du kan også skrive til kontakt@lunamedia.no eller ringe 33 74 02 80."
  };
  if (debug) payload._debug = { source: "faq_only_mode" };
  return res.status(200).json(payload);
}

    if (!OPENAI_API_KEY) {
      console.warn("Mangler OPENAI_API_KEY – hopper over LLM og bruker fallback.");
      const payload = { answer };
      if (debug) payload._debug = { source: "fallback_no_key", data: _dataDebug };
      return res.status(200).json(payload);
    }

    // 4) Kall OpenAI
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
      try { data = JSON.parse(text); }
      catch { throw new Error("OpenAI JSON parse error: " + text); }

      if (!resp.ok) {
        console.error("OpenAI HTTP error:", resp.status, data?.error || data);
        throw new Error(data?.error?.message || `OpenAI feilkode ${resp.status}`);
      }

      const content = data?.choices?.[0]?.message?.content?.trim();
      if (content) answer = content;
      else console.warn("OpenAI: tomt content i svar:", data);

      const payload = { answer };
      if (debug) payload._debug = { source: "openai", data: _dataDebug };
      return res.status(200).json(payload);
    } catch (e) {
      console.error("OpenAI-kall feilet:", e?.message);
      const payload = { answer };
      if (debug) payload._debug = { source: "fallback_openai_error", error: e?.message, data: _dataDebug };
      return res.status(200).json(payload);
    }
  } catch (err) {
    console.error("Handler-feil:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
