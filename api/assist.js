// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------- Data loading (safe) ----------
function loadData() {
  const faqPath   = path.join(__dirname, "..", "data", "faq.yaml");
  const pricePath = path.join(__dirname, "..", "data", "priser.json");

  let faq = [];
  let prices = {};

  try {
    const raw = fs.readFileSync(faqPath, "utf8");
    const parsed = yaml.load(raw);
    // faq.yaml kan være { faq:[...] } eller bare [...]
    faq = Array.isArray(parsed) ? parsed : (parsed?.faq || []);
  } catch (e) {
    console.warn("Kunne ikke lese faq.yaml:", e.message);
    faq = [];
  }

  try {
    const raw = fs.readFileSync(pricePath, "utf8");
    prices = JSON.parse(raw) || {};
  } catch (e) {
    console.warn("Kunne ikke lese priser.json:", e.message);
    prices = {};
  }

  return { faq, prices };
}

// ---------- FAQ-søk (presis) ----------
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

function simpleSearch(userMessage, faqArray, minScore = 0.6) {
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
    return [{ a: best.item.a, score: best.score }];
  }
  return [];
}

// ---------- Handler ----------
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
    // Trygg henting av body
    let body = req.body || {};
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const message = (body.message || "").trim();
    const history = Array.isArray(body.history) ? body.history : [];
    if (!message) return res.status(400).json({ error: "Missing message" });

    // 1) Hent data og match FAQ
    const { faq, prices } = loadData();
    const kbHits = simpleSearch(message, faq);

    console.log("FAQ hits:", kbHits.length, "for:", message);

    // 2) FAQ har førsteprioritet
    if (kbHits?.[0]?.a) {
      return res.status(200).json({ answer: kbHits[0].a });
    }

    // 3) Bygg systemprompt til LLM (når FAQ ikke har treff)
    const system = [
      'Du er "Luna" – en vennlig og presis AI-assistent for Luna Media (Vestfold).',
      "Svar kort på norsk. Bruk priseksempler og FAQ nedenfor når relevant.",
      "Hvis noe er uklart eller pris mangler: si det, og foreslå tilbud via skjema/e-post.",
      "Tilby menneskelig overtakelse ved spesielle behov.",
      "",
      "FAQ-kandidater (kan være tomt):",
      JSON.stringify(kbHits, null, 2),
      "",
      "Priser (kan være tomt):",
      JSON.stringify(prices, null, 2)
    ].join("\n");

    // 4) LLM-kall (robust) – bruker OpenAI hvis nøkkel finnes
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const model = process.env.LUNA_MODEL || "gpt-4o-mini";

    const hint = ""; // ingen FAQ-treff – ingen hint
    const user = `Kunde spør: ${message}${hint}
Bruk kun fakta fra "FAQ-kandidater" og "Priser" over hvis relevant.
Hvis svaret ikke finnes i dataene: si at du er usikker og foreslå kontakt.
Svar på norsk, maks 2–3 setninger.`;

    // Fallback hvis LLM feiler
    let answer = "Beklager, jeg har ikke et godt svar på dette akkurat nå. " +
                 "Send oss gjerne en e-post på kontakt@lunamedia.no eller ring 33 74 02 80.";

    if (!OPENAI_API_KEY) {
      console.warn("Mangler OPENAI_API_KEY – hopper over LLM og bruker fallback.");
      return res.status(200).json({ answer });
    }

    const payload = {
      model,
      temperature: 0.3,
      max_tokens: 400,
      messages: [
        { role: "system", content: system },
        ...history,
        { role: "user", content: user }
      ]
    };

    let resp, text, data;
    try {
      resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify(payload)
      });

      text = await resp.text();
      try { data = JSON.parse(text); }
      catch (e) {
        console.error("OpenAI JSON parse error:", text);
        throw new Error("Kunne ikke tolke svar fra OpenAI");
      }

      if (!resp.ok) {
        console.error("OpenAI HTTP error:", resp.status, data?.error || data);
        throw new Error(data?.error?.message || `OpenAI feilkode ${resp.status}`);
      }

      const content = data?.choices?.[0]?.message?.content?.trim();
      if (content) {
        answer = content;
      } else {
        console.warn("OpenAI: tomt content i svar:", data);
      }
    } catch (e) {
      console.error("OpenAI-kall feilet:", e?.message);
      // behold fallback i `answer`
    }

    return res.status(200).json({ answer });
  } catch (err) {
    console.error("Handler-feil:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
