// smoke.js - enkel røyktest for /api/assist
// Kjør med: ASSIST_ENDPOINT="https://assistant-sigma-lovat.vercel.app/api/assist" npm run smoke

// Hent fetch (native hvis tilgjengelig, ellers node-fetch)
async function getFetch() {
  if (global.fetch) return global.fetch;
  const { default: fetch } = await import('node-fetch');
  return fetch;
}

function pretty(obj) {
  try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
}

// Bygg URL (håndterer path/query elegant)
function withQuery(base, q = {}) {
  const url = new URL(base);
  Object.entries(q).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  return url.toString();
}

(async () => {
  const fetch = await getFetch();
  const endpoint = process.env.ASSIST_ENDPOINT?.trim() ||
                   "https://assistant-sigma-lovat.vercel.app/api/assist";

  const results = [];
  const push = (name, ok, info = {}) => results.push({ name, ok, ...info });

  // ---- 1) Health ----
  try {
    const r = await fetch(endpoint);
    const j = await r.json();
    const ok = r.ok && j?.status === "ok";
    push("health", ok, { response: j });
    console.log("\n[health]", ok ? "OK" : "FAIL", pretty(j));
  } catch (e) {
    push("health", false, { error: String(e) });
    console.error("\n[health] ERROR:", e);
  }

  // ---- 2) Knowledge listing ----
  try {
    const url = withQuery(endpoint, { fn: "knowledge" });
    const r = await fetch(url);
    const j = await r.json();
    const ok = r.ok && j?.ok === true && typeof j?.faqCount === "number";
    push("knowledge", ok, { files: j?.files, faqCount: j?.faqCount, sample: j?.sample });
    console.log("\n[knowledge]", ok ? "OK" : "FAIL", pretty({ files: j?.files, faqCount: j?.faqCount, sample: j?.sample }));
  } catch (e) {
    push("knowledge", false, { error: String(e) });
    console.error("\n[knowledge] ERROR:", e);
  }

  // Helper: POST-chat
  async function chat(message, history = [], trace = false) {
    const url = trace ? withQuery(endpoint, { trace: "1" }) : endpoint;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, trace })
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, data: j };
  }

  // ---- 3) FAQ: Video-tilbud ----
  let lastAssistant = null;
  let convo = [];
  try {
    const { ok, data } = await chat("Digitaliserer dere video?");
    const pass = ok && data?.ok && typeof data?.text === "string";
    lastAssistant = data;
    convo.push({ role: "user", text: "Digitaliserer dere video?" });
    convo.push({ role: "assistant", text: data?.text, meta: data?.meta });
    push("faq_video_basic", pass, { response: data });
    console.log("\n[faq_video_basic]", pass ? "OK" : "FAIL", pretty(data));
  } catch (e) {
    push("faq_video_basic", false, { error: String(e) });
    console.error("\n[faq_video_basic] ERROR:", e);
  }

  // ---- 4) Oppfølging pris i samme tråd (historikk) ----
  try {
    const { ok, data } = await chat("Hva koster det?", convo, true);
    const pass = ok && data?.ok && typeof data?.text === "string";
    convo.push({ role: "user", text: "Hva koster det?" });
    convo.push({ role: "assistant", text: data?.text, meta: data?.meta });
    // Ikke hard-assert på at det er "video"-pris; vi logger route/meta for å verifisere topic binding
    push("price_followup_after_video", pass, { response: data });
    console.log("\n[price_followup_after_video]", pass ? "OK" : "FAIL", pretty(data));
  } catch (e) {
    push("price_followup_after_video", false, { error: String(e) });
    console.error("\n[price_followup_after_video] ERROR:", e);
  }

  // ---- 5) FAQ: Smalfilm→formater ----
  let convo2 = [];
  try {
    const first = await chat("Digitaliserer dere smalfilm?");
    convo2.push({ role: "user", text: "Digitaliserer dere smalfilm?" });
    convo2.push({ role: "assistant", text: first.data?.text, meta: first.data?.meta });
    const second = await chat("Hvilke smalfilmformater tar dere?", convo2, true);
    const ok = first.ok && second.ok && typeof second.data?.text === "string";
    push("smalfilm_formats_followup", ok, { first: first.data, second: second.data });
    console.log("\n[smalfilm_formats_followup]", ok ? "OK" : "FAIL", pretty({ first: first.data, second: second.data }));
  } catch (e) {
    push("smalfilm_formats_followup", false, { error: String(e) });
    console.error("\n[smalfilm_formats_followup] ERROR:", e);
  }

  // ---- 6) Foto retusjering → pris ----
  let convo3 = [];
  try {
    const first = await chat("Tilbyr dere retusjering av bilder?");
    convo3.push({ role: "user", text: "Tilbyr dere retusjering av bilder?" });
    convo3.push({ role: "assistant", text: first.data?.text, meta: first.data?.meta });
    const second = await chat("Hva koster det?", convo3, true);
    const ok = first.ok && second.ok && typeof second.data?.text === "string";
    push("foto_retusjering_price_followup", ok, { first: first.data, second: second.data });
    console.log("\n[foto_retusjering_price_followup]", ok ? "OK" : "FAIL", pretty({ first: first.data, second: second.data }));
  } catch (e) {
    push("foto_retusjering_price_followup", false, { error: String(e) });
    console.error("\n[foto_retusjering_price_followup] ERROR:", e);
  }

  // ---- Oppsummering ----
  const passed = results.filter(r => r.ok).length;
  const total  = results.length;
  console.log("\n================ SUMMARY ================");
  results.forEach(r => console.log(`${r.ok ? "✅" : "❌"} ${r.name}`));
  console.log(`\nPassed ${passed}/${total}`);

  // Non-zero exit code hvis noe feiler (nyttig i CI)
  if (passed !== total) process.exit(1);
})();
