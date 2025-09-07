# Luna Media – Skreddersydd AI‑assistent (MVP)

Dette repoet inneholder:
- `/public/embed.html` – chat‑widget som kan limes inn i WordPress (HTML‑blokk).
- `/api/assist.js` – serverless API (Node.js) som svarer på henvendelser (demo-fallback uten LLM aktivert).
- `/data/faq.yaml` og `/data/priser.json` – kunnskapsbase/faktagrunnlag.
- `/prompt/system_prompt.md` – rolle og tone for assistenten.

## Kom i gang (Vercel)
1. Koble repoet til Vercel og deploy.
2. Legg til Environment Variables:
   - `LUNA_ALLOWED_ORIGINS` = `https://lunamedia.no` (eller staging-URL ved test)
   - (Valgfritt) `OPENAI_API_KEY` for ekte LLM-svar senere
   - (Valgfritt) `LUNA_MODEL` (default `gpt-4o-mini` i eksempelet)
3. Etter deploy: API‑endepunktet er `https://<prosjekt>.vercel.app/api/assist`.
4. Åpne `public/embed.html` og bytt ut `API_URL` med din faktiske URL. Lim hele HTML‑en inn i WordPress på en testside.

## Redigere innhold
- Endre `data/faq.yaml` og `data/priser.json` for å tilpasse svar og priseksempler.
- Deploy på nytt for at endringene skal tre i kraft.

## Slå på ekte AI (valgfritt)
- Fjern kommenteringen i `/api/assist.js` og legg til pakken `openai` i `package.json`.

Deployed with USE_MODULAR_ASSISTANT=1
