// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadData() {
  const faqPath = path.join(__dirname, "..", "data", "faq.yaml");
  const pricePath = path.join(__dirname, "..", "data", "priser.json");
  const faq = yaml.load(fs.readFileSync(faqPath, "utf8"));
  const prices = JSON.parse(fs.readFileSync(pricePath, "utf8"));
  return { faq, prices };
}

function simpleSearch(query, docs) {
  const q = (query || "").toLowerCase();
  const scored = (docs || []).map(item => {
    const hay = ((item.q || "") + " " + (item.a || "")).toLowerCase();
    let score = 0;
    q.split(/\s+/).forEach(w => { if (w && hay.includes(w)) score++; });
    return { item, score };
  }).sort((a,b)=>b.score-a.score);
  return scored.slice(0,3).map(x=>x.item);
}

export default async function handler(req, res) {
  const allowed = (process.env.LUNA_ALLOWED_ORIGINS || "*").split(",").map(s=>s.trim());
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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message, history = [], email = null } = req.body || {};
    if (!message) return res.status(400).json({ error: "Missing message" });

    const { faq, prices } = loadData();
    const kbHits = simpleSearch(message, faq || []);

    const system = [
      'Du er "Luna" – en vennlig og presis AI-assistent for Luna Media (Vestfold).',
      'Svar kort på norsk. Bruk priseksempler og FAQ nedenfor når relevant.',
      'Hvis noe er uklart eller pris mangler: si det, og foreslå tilbud via skjema/e-post.',
      'Tilby menneskelig overtakelse ved spesielle behov.',
      "",
      "FAQ-treff:",
      JSON.stringify(kbHits, null, 2),
      "",
      "Priser:",
      JSON.stringify(prices, null, 2)
    ].join("\n");

    // -- LLM-kall (valgfritt): aktiver når du har OPENAI_API_KEY --
    // import OpenAI from "openai";
    // const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // const completion = await openai.chat.completions.create({
    //   model: process.env.LUNA_MODEL || "gpt-4o-mini",
    //   messages: [
    //     { role: "system", content: system },
    //     ...history,
    //     { role: "user", content: message }
    //   ],
    //   temperature: 0.3,
    // });
    // const answer = completion.choices[0].message.content;

    // === START: ekte LLM-svar med fallback ===
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Bygg en systemprompt som gir modellen kontekst
const system = systemPrompt || "Du er en hjelpsom norsk kundeserviceassistent for Luna Media.";

// Gi modellen hint om beste FAQ-treff (om vi fant noe)
const hint = kbHits && kbHits[0]
  ? `\n\nFaglig hint (fra kunnskapsbase): ${kbHits[0].a}`
  : "";

// Brukerprompt – selve spørsmålet
const user = `Kunde spør: ${message}${hint}
Svar kort, presist og vennlig. Inkluder kun det som er relevant.`;

// Hvis API-nøkkelen finnes, spør modellen. Ellers bruk fallbacken vår.
let answer;

if (OPENAI_API_KEY) {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",          // bruk evt. annet navn hvis du vil
      temperature: 0.3,
      max_tokens: 400,
      messages: [
        { role: "system", content: system },
        { role: "user",   content: user }
      ]
    })
  });

  const data = await resp.json();

  // Hent modellens svar, fall tilbake til FAQ-hint om noe skulle feile
  answer =
    data?.choices?.[0]?.message?.content?.trim()
    || (kbHits && kbHits[0] ? kbHits[0].a : null)
    || "Beklager, jeg har ikke et godt svar på dette akkurat nå.";
} else {
  // Fallback hvis nøkkel mangler
  answer =
    (kbHits && kbHits[0] ? kbHits[0].a : null)
    || "Beklager, jeg har ikke et godt svar på dette akkurat nå.";
}

return res.status(200).json({ answer });
// === SLUTT: ekte LLM-svar med fallback ===

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
