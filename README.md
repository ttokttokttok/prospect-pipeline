# Prospect

Prompt → ICP companies → key people → enriched dossiers. Collected into a shared SQLite DB with CSV/JSON exports.

## Setup
1. `npm install`
2. `cp .env.local.example .env.local` and set `ORANGESLICE_API_KEY` (or run `npx orangeslice login`).

## CLI (local one-off)
```bash
npm run prospect -- "Series A dev tool companies"                       # full run: posts + verified contacts (default-on)
npm run prospect -- "Series A dev tool companies" --no-contacts --no-posts   # fast/cheap: skip contact lookups + post scraping
```
Posts and contacts are collected by default; pass `--no-posts` / `--no-contacts` to skip either.
Outputs land in `runs/<jobId>/`.

## Server
```bash
npm run build && npm start    # long-running Node server
curl -X POST localhost:3000/api/runs -H 'content-type: application/json' \
  -d '{"prompt":"Series A dev tool companies","contacts":false}'
# → {"jobId":"job_..."}
curl localhost:3000/api/runs/<jobId>   # poll status + counts
```

## Cost note
By default each run calls `person.contact.get` (up to ~275 credits/person, ~10 min each, parallelized) —
pass `--no-contacts` for a fast run without verified emails/phones. Already-enriched people are
skipped automatically (credit cache).
