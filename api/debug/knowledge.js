// api/debug/knowledge.js
const { loadKnowledge } = require('../../data/loadData');

module.exports = async (req, res) => {
  try {
    const data = loadKnowledge();
    res.status(200).json({
      ok: true,
      files: data.files.length,
      faqCount: data.count.faq,
      sample: data.faq.slice(0, 5).map(x => ({
        id: x.id,
        q: x.q,
        src: x.source
      }))
    });
  } catch (e) {
    console.error('debug/knowledge error:', e);
    res.status(500).json({
      ok: false,
      error: String(e && e.message ? e.message : e)
    });
  }
};
// test
