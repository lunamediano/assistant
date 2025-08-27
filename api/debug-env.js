export default async function handler(req, res) {
  res.json({
    has_OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    // legg gjerne til andre du vil sjekke:
    // has_OPENAI_KEY: !!process.env.OPENAI_KEY,
    // demo: process.env.DEMO || null,
    runtime: process.env.VERCEL ? "vercel" : "local"
  });
}
