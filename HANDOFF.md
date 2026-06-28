# Prospect — Handoff

A prompt-to-outreach-list tool for a hackathon. You type an ICP ("Series A dev tool
companies"), it finds matching companies, the key people at each, enriches their
profiles, and (optionally) pulls verified contact info — into a local DB + CSV/JSON.

Built on **Orange Slice** (`orangeslice` npm SDK — 30+ B2B data providers behind one API).

- **Repo:** github.com/ttokttokttok/prospect-pipeline · branch `main`
- **Stack:** Next.js 16 (App Router, self-hosted) · TypeScript (ESM) · better-sqlite3 · Vitest · tsx · Node ≥ 22 (built on v24)
- **Status:** Works end-to-end against the live API for the dry-run path. 33 tests + 1 gated e2e passing; `npm run build` clean.

---

## 1. Get it running (5 min)

```bash
npm install
```

You need an Orange Slice API key. Either:
- `npx orangeslice login` (opens browser, saves to `~/.config/orangeslice/config.json`), **or**
- create `.env.local` (gitignored) with:
  ```
  ORANGESLICE_API_KEY=osk_your_key_here
  PROSPECT_DB_PATH=./prospect.db
  ```

> ⚠️ **There is no key in the repo** — `.env.local` and `.mcp.json` are gitignored. Get your own key (ask Josh, or sign up). The shared account's key lives only on Josh's machine.

### Run the CLI (the fastest way to see it work)
```bash
npm run prospect -- "Series A dev tool companies"            # DRY RUN — no contact lookups, cheap
npm run prospect -- "Series A dev tool companies" --contacts  # spends credits on emails/phones (see §5)
npm run prospect -- "fintech startups" --roles=founder,eng-leadership
```
Output lands in `runs/<jobId>/`: `companies.csv`, `people.csv`, `people.json` (full dossiers).
Everything is also upserted into `prospect.db` (SQLite).

### Run the server
```bash
npm run build && npm start          # long-running Node server (NOT serverless)
curl -X POST localhost:3000/api/runs -H 'content-type: application/json' \
  -d '{"prompt":"Series A dev tool companies","contacts":false}'
# → {"jobId":"job_..."}
curl localhost:3000/api/runs/<jobId>   # poll status + counts + results
curl localhost:3000/api/runs           # list recent jobs
```
Runs happen in the background (the long pipeline can't fit in one HTTP request); you poll for status.

### Tests
```bash
npm test          # 33 passing + 1 skipped (the skipped one is the live e2e)
```

---

## 2. What it does (the pipeline)

```
prompt
  → interpret        ai.generateObject → ICP { fundingStage, keywords, industry, geo, sizeMax }
  → discoverCompanies crunchbase (broad category/description match) + web search, AI-scored, top 20
  → findPeople       getEmployeesFromLinkedin per company (founders + eng leadership), ~3 each
  → enrichPerson     linkedin.enrich (headline, twitter) + optional contact.get + web-dork signals
  → output           SQLite upsert + companies.csv / people.csv / people.json
```

**Typical dry run today:** ~20 companies, ~47 people, ~15s. Real prominent Series A devtools
(Depot, Fern, Trunk, Resend, Appwrite, SurrealDB…). Generalizes to fintech / AI infra / healthcare.

---

## 3. Code map

| Path | Responsibility |
|---|---|
| `src/orange.ts` | **The only file that imports `orangeslice`.** Single SDK seam — all tests mock this. |
| `src/types.ts` | Shared types (`ICP`, `Company`, `Person`, `EnrichedPerson`, `Job`, …) + `domainFromUrl`, `DEFAULT_ROLES`. |
| `src/pipeline/interpret.ts` | prompt → structured ICP. |
| `src/pipeline/companies.ts` | ICP → scored companies (crunchbase + web, dedupe, AI score, top N). |
| `src/pipeline/people.ts` | company → people (founder + eng-leadership title filters, dedupe, cap). |
| `src/pipeline/enrich.ts` | person → profile + (gated) contact + signals. |
| `src/pipeline/run.ts` | orchestrates all stages for one job, writes progress, isolates per-person failures. |
| `src/storage/db.ts` | open SQLite + schema (`jobs`, `companies`, `people`, `signals`). |
| `src/storage/repo.ts` | job CRUD, upserts, `needsContact` (credit cache), `addSignals`. |
| `src/output/export.ts` | CSV/JSON writers. |
| `src/server/jobs.ts` | `getRepo()` singleton, `startRun()` (fire-and-forget), `newJobId()`. |
| `app/api/runs/route.ts`, `app/api/runs/[id]/route.ts` | HTTP API. |
| `scripts/run.ts` | the `npm run prospect` CLI. |
| `src/e2e.test.ts` | live end-to-end test, gated behind `PROSPECT_E2E=1`. |
| `docs/superpowers/specs/…-design.md` | full design spec. |
| `docs/superpowers/plans/…-pipeline.md` | the implementation plan (task-by-task). |

**Conventions:** ESM. Non-test source uses **extensionless** imports (`from "../types"`); **test
files keep `.js`** (`from "./types.js"`). Don't "fix" this — Turbopack needs extensionless, Vitest
needs/allows `.js`. SQLite is synchronous (better-sqlite3, no `await`).

---

## 4. Credit cache (important for cost)

`person.contact.get` is the expensive call (up to ~275 credits/person). The `people` table stores
`last_enriched_at`; `repo.needsContact()` returns false for anyone already enriched, so **re-runs
never re-charge for the same person**. Dry runs never call `contact.get` at all.

---

## 5. Known issues / next steps (honest list)

**Not yet validated:**
- ⚠️ **`--contacts` has only been unit-tested, never run live.** It's the last unverified SDK seam
  and the only one that spends real money. With ~47 people that's a big first bill. **Validate on a
  one-company slice first** (e.g. a narrow prompt) before a full run — an SDK field-shape surprise
  could hide here (one already bit us on the employee fields; see git log `fix: correct SDK field names`).

**Quality / tuning:**
- **Signals come back empty.** The per-person LinkedIn/Twitter/web dork queries in `enrich.ts`
  (`gatherSignals`) rarely hit. Tune the queries if dossier depth matters.
- **People title noise.** The founder filter (`people.ts` `FOUNDER_FILTER`) occasionally matches
  "Executive Assistant to the CEO" / "Office of the CTO" (substring `CEO`/`CTO`). ~1 in 3 per company
  at worst. Tighten the regex or add an exclusion if needed.
- **Company volume is ~20** (the AI-scorer's slice). Crunchbase now returns hundreds of candidates;
  bump the `limit` arg / `LIMIT 50` in `companies.ts` if you want more.

**Robustness:**
- **Crashed-job sweep not implemented.** If the server restarts mid-run, that job stays stuck in
  `running` forever (the fire-and-forget promise is lost). Add a startup sweep that marks orphaned
  `running` jobs as `failed`. (Spec'd, deferred for v1.)
- **No auth / single shared dataset.** Anyone hitting the API writes to the same DB. Fine for the
  hackathon; add `user_id` + auth if it goes multi-user.

**Not built (deliberately deferred):**
- UI to browse results · CRM push (HubSpot/Attio) · Postgres (we use local SQLite) ·
  personal-social scraping (IG/FB — out of scope: brittle, ToS/privacy risk).

---

## 6. Quick "is it working?" check

```bash
PROSPECT_E2E=1 npx vitest run src/e2e.test.ts   # real dry run, no contacts; needs the API key
ls runs/e2e/                                     # companies.csv, people.csv, people.json
```
If that produces ~20 companies and dozens of people, you're good.
