// smoke.js
// Minimal røyktester for Luna Assistant API
// Kjør:  node smoke.js
// Endre ENDPOINT ved behov (standard peker på Vercel-app'en din)

const ENDPOINT = process.env.ASSIST_ENDPOINT || "https://assistant-sigma-lovat.vercel.app/api/assist";

async function post(message, history = [], trace = false) {
  const url = trace ? `${ENDPOINT}?trace=1` : ENDPOINT;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history })
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) {
    throw new Error(`Ikke-JSON respons (${res.status}): ${text}`);
  }
  if (!res.ok || json.ok === false) {
    throw new Error(`API-feil ${res.status}: ${json.error || text}`);
  }
  return json;
}

function containsAny(haystack, needles) {
  const t = (haystack || "").toLowerCase();
  return needles.some(n => t.includes(n.toLowerCase()));
}
function notContainsAny(haystack, needles) {
  const t = (haystack || "").toLowerCase();
  return needles.every(n => !t.includes(n.toLowerCase()));
}

async function runTest(name, { history = [], message, expectIncludes = [], expectNotIncludes = [] }) {
  const start = Date.now();
  try {
    const resp = await post(message, history, false);
    const out = resp.text || "";
    const okInc = expectIncludes.length === 0 || containsAny(out, expectIncludes);
    const okExc = expectNotIncludes.length === 0 || notContainsAny(out, expectNotIncludes);
    const ok = okInc && okExc;

    const ms = Date.now() - start;
    console.log(`${ok ? "✅" : "❌"} ${name} (${ms}ms)`);
    if (!ok) {
      console.log("  ├─ message:", message);
      if (history.length) console.log("  ├─ history:", JSON.stringify(history, null, 2));
      console.log("  ├─ response:", out);
      if (expectIncludes.length) console.log("  ├─ expectIncludes:", expectIncludes);
      if (expectNotIncludes.length) console.log("  └─ expectNotIncludes:", expectNotIncludes);
      return false;
    }
    return true;
  } catch (err) {
    const ms = Date.now() - start;
    console.log(`❌ ${name} (${ms}ms)`);
    console.error("  └─ Error:", err.message);
    return false;
  }
}

async function main() {
  const results = [];

  // 1) Direkte: Video-pris skal gi 315/time og ikke smalfilmminutt
  results.push(await runTest("Video → pris (direkte)", {
    message: "Hvor mye koster det å digitalisere en VHS-kassett?",
    expectIncludes: ["315", "time"],
    expectNotIncludes: ["per minutt", "startgebyr"]
  }));

  // 2) Kontekst: Smalfilm → pris (oppfølging med history/meta.src)
  results.push(await runTest("Smalfilm → 'Hva koster det?'", {
    history: [
      { role: "user", text: "Digitaliserer dere smalfilm?" },
      { role: "assistant",
        text: "Ja, vi digitaliserer smalfilm ...",
        meta: { src: "/var/task/knowledge/faq/smalfilm.yml" }
      }
    ],
    message: "Hva koster det?",
    expectIncludes: ["per minutt", "startgebyr", "rull"],
    expectNotIncludes: ["315", "per time"]
  }));

  // 3) Kontekst: Video → pris (oppfølging)
  results.push(await runTest("Video → 'Hva koster det?'", {
    history: [
      { role: "user", text: "Digitaliserer dere video?" },
      { role: "assistant",
        text: "Ja, vi tar VHS/VHS-C, Video8/Hi8, MiniDV ...",
        meta: { src: "/var/task/knowledge/faq/video.yml" }
      }
    ],
    message: "Hva koster det?",
    expectIncludes: ["315", "time"],
    expectNotIncludes: ["per minutt", "startgebyr"]
  }));

  // 4) Kontekst: Foto retusjering → pris (oppfølging)
  results.push(await runTest("Foto retusjering → 'Hva koster det?'", {
    history: [
      { role: "user", text: "Tilbyr dere retusjering av bilder?" },
      { role: "assistant",
        text: "Ja, vi retusjerer og fargekorrigerer ...",
        meta: { src: "/var/task/knowledge/faq/foto.yml", id: "foto-retusjering" }
      }
    ],
    message: "Hva koster det?",
    expectIncludes: ["700", "fotografi"],     // fra foto-pris-retusjering
    expectNotIncludes: ["315", "per time", "per minutt", "startgebyr"]
  }));

  // 5) Video-formater (bør treffe video.yml)
  results.push(await runTest("Video → formater", {
    message: "Hvilke videoformater tar dere?",
    expectIncludes: ["VHS", "VHS-C", "Video8", "Hi8", "MiniDV"]
  }));

  // 6) Smalfilm-formater (bør treffe smalfilm.yml)
  results.push(await runTest("Smalfilm → formater", {
    message: "Hvilke smalfilmformater tar dere?",
    expectIncludes: ["8 mm", "Super 8", "16 mm"]
  }));

  // 7) Levering (bør treffe levering.yml)
  results.push(await runTest("Levering → hvor kan jeg levere", {
    message: "Hvor kan jeg levere?",
    expectIncludes: ["Sem", "Bislett"]
  }));

  const pass = results.every(Boolean);
  console.log("\n=======================");
  console.log(pass ? "🎉 Alle tester besto" : "⚠️  Noen tester feilet");
  process.exit(pass ? 0 : 1);
}

main().catch(err => {
  console.error("Uventet feil i testløpet:", err);
  process.exit(1);
});
