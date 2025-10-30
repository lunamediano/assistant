// api/diag-faq.js
// Diagnoseside for FAQ-match – viser poeng, kandidater, og kilde

const { detectFaq } = require('../core/handlers/faqHandler');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');

// Last inn FAQ-filen
const FAQ_PATH = path.join(process.cwd(), 'knowledge', 'faq_round1.yml');
let FAQ_ITEMS = [];

function loadFaq() {
  try {
    const file = fs.readFileSync(FAQ_PATH, 'utf8');
    const parsed = yaml.load(file);
    FAQ_ITEMS = parsed.items || parsed;
  } catch (e) {
    console.error('Kunne ikke laste FAQ:', e);
    FAQ_ITEMS = [];
  }
}
loadFaq();

module.exports = async function handler(req, res) {
  const { q, topic } = req.query || {};
  if (!q) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(`
      <h2>FAQ Diagnosepanel</h2>
      <form>
        <label>Skriv et spørsmål:</label><br>
        <input type="text" name="q" value="" style="width:400px" />
        <button type="submit">Test</button>
      </form>
      <p>Eksempler: <code>Tar dere VHS?</code> – <code>Hva koster smalfilm?</code> – <code>Hvilke formater støttes?</code></p>
    `);
  }

  const match = detectFaq(q, FAQ_ITEMS, { topicHint: topic });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!match) {
    return res.end(`<h3>❌ Ingen treff for:</h3><p><code>${q}</code></p>`);
  }

  const debug = match._debug || {};
  const top5 = debug.candidates || [];

  res.end(`
    <h3>✅ Beste treff for:</h3>
    <p><code>${q}</code></p>
    <h4>Resultat:</h4>
    <pre>${JSON.stringify({ id: match.id, text: match.a, source: match._src, score: debug.bestScore }, null, 2)}</pre>
    <h4>Kandidater (Top 5):</h4>
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
      <tr><th>ID</th><th>Score</th><th>Spørsmål</th><th>Kilde</th></tr>
      ${top5.map(c =>
        `<tr><td>${c.id}</td><td>${c.score.toFixed(1)}</td><td>${c.q}</td><td>${c._src || ''}</td></tr>`
      ).join('')}
    </table>
    <p style="margin-top:10px"><a href="/api/diag-faq">← Ny test</a></p>
  `);
};
