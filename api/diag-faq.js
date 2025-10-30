// api/diag-faq.js
// Diagnose for FAQ-match – bruker samme loader og matcher som assistenten

const { detectFaq } = require('../core/handlers/faqHandler');
const { loadKnowledge } = require('../data/loadData');

// enkel HTML-escape
function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach(part => {
    const [k, ...rest] = part.split('=');
    if (!k) return;
    const key = k.trim();
    const val = decodeURIComponent((rest.join('=') || '').trim());
    if (key) out[key] = val;
  });
  return out;
}

function pageShell(content) {
  return `<!doctype html>
<html lang="no">
<head>
<meta charset="utf-8" />
<title>FAQ Diagnose</title>
<style>
  body{font:14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial; padding:20px; color:#222}
  input[type=text]{width:520px; padding:8px; font:inherit}
  select{padding:6px; font:inherit}
  button{padding:8px 12px; font-weight:700; cursor:pointer}
  table{border-collapse:collapse; margin-top:10px; width:100%; max-width:900px}
  th,td{border:1px solid #ddd; padding:8px; vertical-align:top}
  th{background:#f7f7f7}
  .ok{color:#056; font-weight:700}
  .warn{color:#b36b00; font-weight:700}
  .bad{color:#b00020; font-weight:700}
  .muted{color:#666}
  .src{background:#294452; color:#fff; font-weight:700; border-radius:8px; padding:2px 8px; display:inline-block}
  .tip{background:#f6f7f9; border:1px solid #e5e8ec; padding:10px; border-radius:10px}
</style>
</head>
<body>
<h2>FAQ Diagnose</h2>
${content}
</body>
</html>`;
}

module.exports = async (req, res) => {
  try {
    const data = loadKnowledge(); // { faq, meta, faqIndex: { files }, count: { faq } }
    const files = data?.faqIndex?.files || [];
    const total = data?.count?.faq ?? (data?.faq?.length || 0);

    const urlQ = (req.query && req.query.q) || '';
    const urlTopic = (req.query && req.query.topic) || '';
    const cookies = parseCookies(req);
    const cookieTopic = (cookies.lm_topic || '').toLowerCase();

    // UI – skjema
    if (!urlQ) {
      const form = `
<form method="get" action="/api/diag-faq">
  <div style="margin-bottom:8px">
    <label for="q"><strong>Testspørsmål:</strong></label><br>
    <input type="text" id="q" name="q" placeholder="f.eks. Tar dere VHS?  /  Hva koster smalfilm?" />
  </div>
  <div style="margin-bottom:8px">
    <label for="topic"><strong>topic-hint (valgfritt):</strong></label>
    <select id="topic" name="topic">
      <option value="">(ingen)</option>
      <option value="video">video</option>
      <option value="smalfilm">smalfilm</option>
      <option value="foto">foto</option>
    </select>
    <span class="muted">Cookie lm_topic: ${cookieTopic || '–'}</span>
  </div>
  <button type="submit">Test</button>
</form>
<p class="tip">
  Laster <strong>${files.length}</strong> kunnskapsfiler, totalt <strong>${total}</strong> FAQ-punkter.
</p>
<p>Eksempler: <code>Tar dere VHS?</code> – <code>Hva koster smalfilm?</code> – <code>Hvilke smalfilmformater tar dere?</code></p>
`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(pageShell(form));
    }

    // Kjør match med samme deteksjon
    const topicHint = (urlTopic || cookieTopic || '').toLowerCase() || null;
    const match = detectFaq(urlQ, data.faq, { topicHint });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (!match) {
      const html = `
<p class="bad">❌ Ingen treff for:</p>
<p><code>${esc(urlQ)}</code></p>
<p class="muted">topic-hint: ${topicHint || '–'}</p>
<p><a href="/api/diag-faq">← Ny test</a></p>
`;
      return res.end(pageShell(html));
    }

    const dbg = match._debug || {};
    const bestScore = typeof dbg.bestScore === 'number' ? dbg.bestScore : NaN;
    const cls = bestScore >= 80 ? 'ok' : bestScore >= 50 ? 'warn' : 'bad';

    const top5 = (dbg.candidates || []).map(c => `
      <tr>
        <td>${esc(c.id || '')}</td>
        <td class="${c.score >= 80 ? 'ok' : c.score >= 50 ? 'warn' : 'bad'}">${Number(c.score).toFixed(1)}</td>
        <td>${esc(c.q || '')}</td>
        <td>${esc(c._src || '')}</td>
      </tr>
    `).join('');

    const result = `
<h3>✅ Beste treff</h3>
<p><strong>Spørsmål:</strong> <code>${esc(urlQ)}</code></p>
<p><strong>topic-hint:</strong> ${topicHint || '–'} &nbsp; <span class="src">${esc(match._src || match.source || '')}</span></p>
<table>
<tr><th>ID</th><td>${esc(match.id || '')}</td></tr>
<tr><th>Score</th><td class="${cls}">${isNaN(bestScore) ? '–' : bestScore.toFixed(1)}</td></tr>
<tr><th>Svar (a)</th><td>${esc(match.a || '(tom)')}</td></tr>
</table>

<h4>Kandidater (Top 5)</h4>
<table>
  <tr><th>ID</th><th>Score</th><th>Spørsmål</th><th>Kilde</th></tr>
  ${top5 || '<tr><td colspan="4" class="muted">Ingen kandidater</td></tr>'}
</table>

<p style="margin-top:10px"><a href="/api/diag-faq">← Ny test</a></p>
`;
    return res.end(pageShell(result));

  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Diag-feil: ' + (e?.stack || e?.message || String(e)));
  }
};
