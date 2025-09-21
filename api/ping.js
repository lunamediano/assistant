// api/ping.js
module.exports = async (req, res) => {
  res.status(200).json({ ok: true, now: Date.now() });
};
