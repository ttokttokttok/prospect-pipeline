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

---

## Phase 1 — Rich Dossier (DONE, merged)

`enrichPerson` now collects a structured dossier (all via Orange Slice):
- **Backbone** (reliable, ~1 credit): `enrich({extended:true})` → `skills`, `experience[]`, `education[]`, `certifications[]`, `languages[]`, `isInfluencer`, `jobsCount`, `recommenderCount`, plus the full `rawProfile` (nothing discarded).
- **Web footprint**: categorized dorks → `webMentions[]` (talk/podcast/github/article).
- **Posts (gated)**: `--posts` flag runs the live-validated Apify actor `harvestapi/linkedin-profile-posts` → `posts[]`. Dry runs do NOT call Apify (no surprise cost).

Persisted as a `dossier` JSON column on `people` (read by the Phase 2 UI) + `people.json`; CSV gains `skills`/`top_post`/`mentions_count`. Run with `--posts` to include LinkedIn posts.

### Phase 1 follow-ups (none blocking)
- **Twitter/X posts deferred** — `Post.source: "twitter"` exists but no Twitter actor runs yet (Phase 2 candidate; handles are often null anyway).
- Small cleanup ticket: drop `(services as any).apify` casts; add tests for CSV escaping of new cells, `addSignals` row insertion, and the posts `url`/`postedAt` mapping; tighten multi-part TLD handling in the dork company term.

---

## Phase 2 — Dossier UI + AI hooks (DONE, merged)

A web UI to browse prospects and understand each fast for cold emails.

- **Run it:** `npm run dev` → http://localhost:3000. A **people list** (cards: name, title, company, skills); a prompt box kicks off a run. Click a card → **dossier page**.
- **Dossier centerpiece:** an **AI synthesis** (summary + interest tags + 2-3 grounded cold-email **hooks**) generated via Orange Slice `ai.generateObject` (no OpenAI key), **on-demand + cached** in a new `people.synthesis` column. "Copy hooks" + "Regenerate" (force-bypasses cache). Below it: skills, experience timeline, education, recent posts, web footprint, contact links. Empty sections are hidden.
- **API:** `GET /api/people`, `GET /api/people/[id]`, `POST /api/people/[id]/synthesize[?force=1]`. People are addressed by a base64url-encoded id. Backend logic is TDD'd (`src/pipeline/synthesize.ts`, `src/server/people.ts`); routes + React pages are build-verified.
- **Verified live:** seeded 44 people, synthesis produced accurate, grounded hooks; cache hit ~33ms vs forced regenerate ~25s.
- **Stack added:** Tailwind v4 + lightweight local components in `src/ui/primitives.tsx` (no shadcn CLI).

### Phase 2 follow-ups (none blocking)
- Dossier shows email inline in the header but no `phone`/Contact section; clipboard write isn't `.catch()`'d; `interests` aren't per-item string-coerced (rare React key warning); a few index keys / no AbortController on unmount. All cosmetic.
- **Next phase (per Josh): cold-email *drafting/curation*** — Phase 2 gives the hooks (the angle); turning a hook into a finished, editable email draft is the planned next step.

---

## Phase 3 — Brain View (DONE, merged)

Per-person "how to approach them" signals on the dossier:
- **Current focus** (AI) — one-liner on what they're working on now (grounded in current role + recent posts).
- **Interest radar** (AI-chosen) — `interestProfile`: the model picks 5-7 categories and scores each 0-100; rendered as a **recharts** radar (`src/ui/radar.tsx`). Falls back to interest tags for syntheses cached before this phase.
- **Context chips** (deterministic, `src/pipeline/metrics.ts`) — tenure at current company + posts-only recency (`recentlyActive` / `Last posted …`).
- **3 most-recent posts** surfaced.
- All fold into the existing on-demand synthesis call (no extra AI cost) + one pure `computeMetrics`. `getPersonDetail` now returns `{ dossier, synthesis, metrics }`.

**Posts + contacts are now default-ON** (we have ample credits). Disable per run with `--no-posts` / `--no-contacts` (CLI) or `posts:false` / `contacts:false` (API). Note: a default run now takes several minutes (contact lookups ~10 min/person, parallelized); use `--no-contacts` for fast runs.

**Live-verified:** seeded posts for ~48 people; metrics correct; regenerated synthesis produced a grounded current-focus + a 7-axis interest profile (radar).

### To populate the brain view for older prospects
People collected before Phase 3 have no posts and old syntheses. Re-run the prompt (posts default-on) and Regenerate their synthesis (the button force-bypasses the cache) to fill in current-focus + radar.
