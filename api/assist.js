// /api/assist.js
import yaml from "js-yaml";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* =========================
   Safe file helpers
   ========================= */
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

/* =========================
   Load data (FAQ + priser)
   ========================= */
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

/* =========================
   FAQ-søk (enkel Jaccard)
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

/* =========================
   Pris-intenter (Smalfilm + VHS)
   ========================= */

// Trygg int-parsing
function intSafe(x) {
  const n = parseInt(x, 10);
  return Number.isFinite(n) ? n : null;
}

// Ekstraher hh:mm, timer, minutter
function extractDuration(msgLower) {
  // hh:mm
  const hm = msgLower.match(/(\d{1,2})[:.](\d{1,2})/);
  if (hm) {
    const h = intSafe(hm[1]) || 0;
    const m = intSafe(hm[2]) || 0;
    return h * 60 + m;
  }
  // "x timer" / "x t"
  const h1 = msgLower.match(/(\d{1,3})\s*(timer|t)\b/);
  // "y min"
  const m1 = msgLower.match(/(\d{1,4})\s*(min|minutter)\b/);

  const minutes = (h1 ? intSafe(h1[1]) * 60 : 0) + (m1 ? intSafe(m1[1]) : 0);
  return minutes || null;
}

/* ---- SMALFILM ---- */
function parseSmalfilmIntent(message) {
  const m = message.toLowerCase();
  if (!/(smalfilm|super\s*8|8\s*mm)/.test(m)) return null;

  const minutter = extractDuration(m);
  const rullMatch = m.match(/(\d{1,3})\s*(rull|ruller)\b/);
  const ruller = rullMatch ? intSafe(rullMatch[1]) : null;

  return { type: "smalfilm", minutter, ruller };
}

function smalfilmPriceText({ minutter, ruller }, prices) {
  // Nøkler (med fornuftige fallback)
  const perMin   = prices.smalfilm_per_minutt ?? prices.smalfilm_min_rate ?? 75;
  const startGeb = prices.smalfilm_start_per_rull ?? 95;
  const usbMin   = prices.usb_min_price ?? 295;

  // Rabattgrenser i MINUTTER (3 t og 6 t)
  const disc3 = prices.smalfilm_discount_3h ?? 0.10;
  const disc6 = prices.smalfilm_discount_6h ?? 0.20;
  const thr3  = 3 * 60;
  const thr6  = 6 * 60;

  const rr = (ruller ?? prices.smalfilm_default_ruller ?? 1);

  // Når minutter ikke oppgitt: forklar modell kort
  if (minutter == null) {
    return [
      `Smalfilm prises med ca. ${perMin} kr per minutt + ${startGeb} kr i startgebyr per rull.`,
      `Vi gir 10% rabatt når det samlet er over 3 timer med film, og 20% rabatt over 6 timer med film.`,
      `Oppgi gjerne antall minutter og ruller for et konkret prisestimat. USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`
    ].join(" ");
  }

  // Grunnpris
  let sum = minutter * perMin + rr * startGeb;

  // Rabatt
  let rabattTxt = "";
  if (minutter >= thr6) {
    const r = Math.round(sum * disc6);
    sum = sum - r;
    rabattTxt = ` (inkl. 20% rabatt)`;
  } else if (minutter >= thr3) {
    const r = Math.round(sum * disc3);
    sum = sum - r;
    rabattTxt = ` (inkl. 10% rabatt)`;
  }

  const parts = [];
  parts.push(`For ${minutter} minutter smalfilm og ${rr} rull er prisen ca ${sum.toLocaleString("no-NO")} kr${rabattTxt}.`);
  if (ruller == null) {
    parts.push(`(Hvis dette gjelder 2 ruller, påvirker startgebyret totalen litt. Oppgi gjerne antall ruller for helt nøyaktig pris.)`);
  }
  parts.push(`USB/minnepenn kommer i tillegg (fra ${usbMin} kr).`);
  return parts.join(" ");
}

/* ---- VHS / VIDEO ---- */
function parseVhsIntent(message) {
  const m = message.toLowerCase();
  if (!/(vhs|videokassett|videobånd|minidv|hi8|video8|kassett(er)?\b)/.test(m)) return null;

  const minutter = extractDuration(m);

  // Noen spør kun "jeg har 4 kassetter" – fang opp dette
  const kass = m.match(/(\d{1,3})\s*(kassett|kassetter)\b/);
  const cassettes = kass ? intSafe(kass[1]) : null;

  return { type: "vhs", minutter, cassettes };
}

function vhsPriceText({ minutter, cassettes }, prices) {
  // Nøkler (fallback)
  const rate = prices.vhs_per_time ?? prices.video_per_time ?? 315;

  // Rabattgrenser (timer)
  const disc10 = prices.vhs_discount_10h ?? 0.10;
  const disc20 = prices.vhs_discount_20h ?? 0.20;

  // Hvis bare kassetter oppgitt: forklar at prisen går på spilletid
  if (minutter == null && cassettes != null) {
    return [
      `VHS prises per time digitalisert video (kr ${rate} per time).`,
      `Oppgi gjerne total spilletid (timer/minutter) for et konkret prisestimat.`,
      `Vi gir 10% rabatt ved 10 timer og 20% ved 20 timer eller mer.`
    ].join(" ");
  }

  // Hvis ingen tid funnet i det hele tatt:
  if (minutter == null) {
    return [
      `VHS prises per time digitalisert video (kr ${rate} per time).`,
      `Oppgi gjerne hvor mange timer/minutter du har, så regner jeg ut pris. Rabatter: 10% over 10 t og 20% over 20 t.`
    ].join(" ");
  }

  // Beregn pris proporsjonalt på minutter
  let sum = Math.round((minutter / 60) * rate);

  // Rabatt etter timer
  const timer = minutter / 60;
  let rabattTxt = "";
  if (timer >= 20) {
    const r = Math.round(sum * disc20);
    sum -= r;
    rabattTxt = ` (inkl. 20% rabatt)`;
  } else if (timer >= 10) {
    const r = Math.round(sum * disc10);
    sum -= r;
    rabattTxt = ` (inkl. 10% rabatt)`;
  }

  return `For ca. ${timer.toFixed(1).replace(".", ",")} time(r) video blir prisen rundt ${sum.toLocaleString("no-NO")} kr${rabattTxt}. Pris beregnes etter faktisk spilletid (kr ${rate}/time).`;
}

/* =========================
   HTTP handler
   ========================= */
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

    // === 1) FAQ først ===
    if (kbHits?.[0]?.a) {
      const payload = { answer: kbHits[0].a, source: "FAQ" };
      if (debug) {
        payload._debug = {
          score: kbHits[0].score,
          matchedQuestion: kbHits[0].q,
          data: { tried, loaded, faqCount: faq.length, priceKeys: Object.keys(prices).length }
        };
      }
      return res.status(200).json(payload);
    }

    // === 2) Pris-regler (før OpenAI) ===
    // Smalfilm
    const smIntent = parseSmalfilmIntent(message);
    if (smIntent) {
      const answer = smalfilmPriceText(smIntent, prices);
      const payload = { answer, source: "AI" }; // regelbasert, men merkert som AI for sluttbruker
      if (debug) payload._debug = { source: "price_rule_smalfilm", smIntent, prices };
      return res.status(200).json(payload);
    }

    // VHS / video
    const vhsIntent = parseVhsIntent(message);
    if (vhsIntent) {
      const answer = vhsPriceText(vhsIntent, prices);
      const payload = { answer, source: "AI" };
      if (debug) payload._debug = { source: "price_rule_vhs", vhsIntent, prices };
      return res.status(200).json(payload);
    }

    // === 3) LLM fallback ===
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
