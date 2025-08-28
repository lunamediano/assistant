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

// Robust LLM-kall med fallback – bruker din eksisterende `system`
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const model = process.env.LUNA_MODEL || "gpt-4o-mini";

// Hvis du har en systemPrompt fra fil, bruk den; ellers bruk `system` som du allerede har definert.
const systemFinal =
  (typeof systemPrompt === "string" && systemPrompt.trim())
    ? systemPrompt
    : system;

// Historikk hvis du har; unngå crash
const chatHistory = Array.isArray(history) ? history : [];

const hint = kbHits?.[0]?.a ? `\n\nHint fra kunnskapsbase: ${kbHits[0].a}` : "";
const user = `Kunde spør: ${message}${hint}
Svar kort, presist og vennlig. Svar på norsk.`;

let answer = kbHits?.[0]?.a || "Beklager, jeg har ikke et godt svar på dette akkurat nå.";

if (!OPENAI_API_KEY) {
  console.warn("Mangler OPENAI_API_KEY – bruker FAQ-fallback.");
} else {
  const payload = {
    model,
    temperature: 0.3,
    max_tokens: 400,
    messages: [
      { role: "system", content: systemFinal },
      ...chatHistory,
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
      console.error("OpenAI: JSON parse error:", text);
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
      console.warn("OpenAI: ingen content i svar:", data);
    }
  } catch (e) {
    console.error("OpenAI-kall feilet:", e?.message);
    // behold FAQ-fallback i `answer`
  }
}

return res.status(200).json({ answer });



  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
