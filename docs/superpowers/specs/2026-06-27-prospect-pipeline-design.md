# Prospect — prompt-to-dossier pipeline (server)

**Date:** 2026-06-27
**Status:** Approved (design)
**Owner:** joshua.yjn.chung@gmail.com

## Summary

A self-hosted Next.js server that turns a free-text ICP prompt (e.g. *"Series A dev tool
companies"*) into a researched outreach list. You `POST` a prompt, the server runs a background
pipeline that discovers matching companies, finds the key people at each, enriches their
professional profiles, retrieves verified contact info on demand, and gathers public
professional/social signals into a per-person dossier. Results land in a shared local SQLite
database (system of record + credit-saving cache) and are also exported as CSV/JSON per run.

For now the goal is **run and collect** — no UI and no per-user separation yet; data display and
multi-tenancy are explicit later phases.

Built on Orange Slice's `services.*` SDK.

## Goals

- `POST` one prompt, get a researched outreach list collected into a shared store.
- Anchor research on **professional + public** signals that help write a good first message.
- Avoid paying for the same person twice (credit caching across runs).
- Let the caller do a cheap dry run before spending credits on contact lookups.

## Non-goals (explicitly out of scope for v1)

- **UI / data display** — later phase; v1 is run-and-collect via API only.
- **Auth / per-user separation** — single shared dataset for now; add user_id + login later.
- Personal Instagram / Facebook scraping (high noise, brittle, ToS/privacy risk) — deferred.
- Personal Google account contents — impossible by design (owner-only).
- CRM push — possible later via Orange Slice integrations & spreadsheet APIs.

## Architecture

A **long-running Node server** (Next.js App Router, self-hosted via `next start` — *not* serverless,
so requests/background work can run for minutes). The pipeline is a plain TypeScript library; the
server is a thin layer that triggers it as a background job and exposes status/results.

```
client ──POST /api/runs {prompt, contacts?, roles?}──▶ server
   │                                                     │ create job row (status=queued)
   │◀──────────────── { jobId } (returns immediately) ───┤ kick off pipeline async (NOT awaited)
   │                                                     │
   │                                              [pipeline runs in-process,
   │                                               writes incrementally to SQLite,
   │                                               offloads heavy enrichment to
   │                                               Orange Slice run_code in background]
   │                                                     │
   └──GET /api/runs/:id──▶ { status, progress, counts, results } (poll)
```

Why this shape:
- A long-lived server has no platform request timeout, but holding an HTTP connection open for
  10+ minutes is fragile — so we still use a lightweight **in-process job model** (a jobs table +
  a fire-and-forget async function). No external queue/broker needed for a single server.
- Heavy enrichment (the 60 contact lookups) can be offloaded to Orange Slice `run_code`
  (runs in their sandbox, returns a `sandboxRunId`, poll `run_status`) so it doesn't tie up our
  own process.

## Scale & cost (per run)

- **20 companies × 3 people = 60 contacts** default run size.
- Cost center: `person.contact.get` — up to **275 credits each (~16,500/run)**, up to ~10 min each
  (parallelized → wall-clock in minutes). Gated by the `contacts` request flag.
- Crunchbase = 1 credit/row; LinkedIn enrich = 1 credit/result; web search cheap.

## Pipeline

```
ICP prompt
  [0] interpret  ai.generateObject → { stage, keywords, industry, geo, size }
  [1] companies  Series A → crunchbase.search ; fuzzy "devtool" → web.search(site:linkedin.com)  → ~20
  [2] qualify    ai.generateObject scores each company vs ICP, keep best 20
  [3] people     company.getEmployees (3/company, role-targeted)  → 60 people
  [4] profiles   person.linkedin.enrich (title, experience, skills, twitter_handle, …)
  [5] contact    person.contact.get (verified work+personal email, phone)   ⟵ gated by `contacts` flag
  [6] signals    LinkedIn posts (apify) ∥ Twitter (handle→apify) ∥ web dorking (mentions)
  [7] output     SQLite upsert + companies.csv + people.csv + people.json
```

Default target roles for step 3: **founders + eng leadership** (CEO/CTO/VP Eng/Head of Platform),
overridable per request via `roles`.

## Modules

Each module has one purpose, a typed interface, and is independently testable.

**Pipeline library (`src/pipeline/`):**
- `interpret.ts` — `prompt → ICP` (structured filters)
- `companies.ts` — `ICP → Company[]` (routes crunchbase vs web; includes qualify/score)
- `people.ts` — `Company → Person[]` (top-N, role-targeted)
- `enrich.ts` — `Person → EnrichedPerson` (profile + optional contact + signals); per-person fan-out
- `run.ts` — orchestrates [0]→[7] for one job, writing progress to storage as it goes

**Storage (`src/storage/`):**
- `db.ts` — SQLite open/migrate
- `repo.ts` — upsert/query; dedup & `last_enriched_at` cache; job CRUD

**Output (`src/output/`):**
- `export.ts` — write `companies.csv`, `people.csv`, `people.json` under `runs/<jobId>/`

**Server (`app/api/`):**
- `runs/route.ts` — `POST` create job + kick off pipeline; returns `{ jobId }`
- `runs/[id]/route.ts` — `GET` job status + counts + results

**CLI (optional, same library):**
- `scripts/run.ts` — `node run.js "<prompt>" [--contacts] [--roles=...]` for local one-off runs

## Storage

**SQLite (`prospect.db`) = shared system of record + cache. Files = human-friendly exports.**

- Single long-running server → one local SQLite file is fine and fast.
- Built-in `node:sqlite` if Node ≥ v22, else `better-sqlite3` (decided at build time by version check).
- The contact step skips any person whose `last_enriched_at` is set → no double-charging across runs.

Schema:

- `jobs` — `id` PK, `prompt`, `status` (queued|running|completed|failed), `params` (json),
  `progress` (json: stage + counts), `error`, `created_at`, `finished_at`
- `companies` — `domain` PK, `name`, `linkedin`, `fit_score`, `why`, `first_seen`
- `people` — `linkedin_url` PK, `company_domain` FK, `name`, `title`, `twitter`,
  `work_email`, `personal_email`, `phone`, `last_enriched_at`
- `signals` — `id` PK, `person_linkedin_url` FK, `source` (linkedin|twitter|web), `content`, `url`, `fetched_at`

(Rows are shared — no `user_id` yet; it gets added in the multi-tenancy phase.)

## Concurrency & resumability

- Independent calls parallelized with `Promise.all`; per-person enrichment runs concurrently.
- Each stage persists to SQLite as it completes, so a failure mid-run doesn't force re-paying for
  earlier stages; a job can be resumed from its last completed stage.
- Contact lookups deduped (never the same person twice, within or across runs).

## Error handling

- Per-person failures isolated — one bad profile doesn't kill the run; recorded in the job's
  `error`/progress and to `runs/<jobId>/errors.json` with a retry path.
- Missing contact info → empty arrays (provider charges 0 credits when not found), not a crash.
- Network/provider errors get bounded retry with backoff; persistent failures recorded, run continues.
- A crashed job is marked `failed` (not left `running`) on restart.

## API

- `POST /api/runs` — body `{ prompt: string, contacts?: boolean, roles?: string[] }` → `{ jobId }`
- `GET /api/runs/:id` — `{ status, progress, counts: {companies, people, contacts}, results? }`
- `GET /api/runs` — list recent jobs (for sanity/debugging)

## Output shape

- `companies.csv` — name, domain, linkedin, fit_score, why
- `people.csv` — name, title, company, linkedin, twitter, work_email, personal_email, phone
- `people.json` — all of the above **+** profile detail + recent posts + web mentions (full dossier)

## Future phases

1. **UI** — a page to enter a prompt, watch the chart build, and browse dossiers.
2. **Auth + multi-tenancy** — login (e.g. Clerk) + `user_id` on all rows.
3. **Postgres option** — swap SQLite for hosted Postgres if/when deployed serverless or scaled.
4. **CRM push** — Orange Slice spreadsheet sink + HubSpot/Attio integrations.
5. **Scheduled re-runs** — track signal changes over time.
