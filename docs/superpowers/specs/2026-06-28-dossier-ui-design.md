# Phase 2 — Dossier UI + AI Hooks

**Date:** 2026-06-28
**Status:** Approved (design)
**Owner:** joshua.yjn.chung@gmail.com
**Depends on:** Phase 1 (the persisted `dossier` JSON on `people`).
**Followed by:** later "cold email curation" phase (drafting), out of scope here.

## Summary

A web UI to browse collected prospects and understand each one *fast*, in service of writing
better cold emails. The centerpiece of each person's page is an **AI synthesis** — a short summary,
their interest themes, and 2-3 concrete cold-email **hooks** — generated via Orange Slice's
`ai.generateObject` (no OpenAI key) on demand and cached. Below the synthesis, the structured
dossier (skills, experience, education, recent posts, web footprint) is shown scannably so the user
can verify the AI's claims. No charts in v1 (per-person data is too thin to chart); email *drafting*
is deferred to a later phase.

## Goals

- Open a person and, within seconds, know who they are and how to open a cold email to them.
- AI hooks are grounded in the real dossier (no fabrication) and copyable.
- Pay AI credits only for people actually viewed (on-demand + cache).
- Reuse the existing SQLite store and pipeline; the UI is a read/display layer plus one AI step.

## Non-goals

- Charts / aggregate analytics (later).
- Cold-email drafting / sending (later "curation" phase).
- Auth / multi-tenant (still single shared dataset).
- Twitter posts (deferred from Phase 1).

## Architecture

Two layers:
1. **AI synthesis (backend):** `synthesize(person)` → `Synthesis`, generated on demand, cached in a
   new `synthesis` column on `people`.
2. **UI:** Next.js App Router pages (Tailwind + shadcn/ui) reading from SQLite through thin API
   routes that use the existing `Repo`.

```
browser ─▶ Next API route ─▶ Repo (SQLite) ─▶ dossier JSON / synthesis JSON
                        └▶ synthesize() ─▶ services.ai.generateObject (cache result)
runs still go through the existing POST /api/runs
```

## Data model

```ts
export interface Hook { angle: string; why: string }     // a cold-email opener + its grounding
export interface Synthesis {
  summary: string;        // 2-3 sentences: who they are
  interests: string[];    // themes (e.g. "developer experience", "infra", "hiring")
  hooks: Hook[];          // 2-3 concrete, dossier-grounded openers
}
```
Stored as JSON in a new `people.synthesis TEXT` column (nullable; null = not yet generated).

## Backend pieces

- `src/pipeline/synthesize.ts` — `synthesize(person: EnrichedPerson): Promise<Synthesis>`.
  Builds a prompt from the dossier (headline, skills, recent experience, recent posts, web mentions),
  instructs the model to ground every hook in a specific dossier fact and not fabricate, and returns
  the `Synthesis` via `services.ai.generateObject` (intelligence `"medium"` — this is judgment/copy,
  not classification). Degrades: on failure returns `{ summary: "", interests: [], hooks: [] }`.
- `src/storage/repo.ts` additions:
  - `listPeople(limit?): PersonCard[]` where `PersonCard = { linkedinUrl, name, title, companyDomain, twitter, skills: string[], isInfluencer, hasSynthesis: boolean }` (skills/isInfluencer parsed from the stored `dossier`).
  - `getSynthesis(linkedinUrl): Synthesis | null`
  - `setSynthesis(linkedinUrl, s: Synthesis): void`
- `src/storage/db.ts` — add `synthesis TEXT` to `people` with the same idempotent `PRAGMA`/`ALTER`
  migration used for `dossier`.

## API routes (Next.js, `runtime="nodejs"`, `dynamic="force-dynamic"`)

- `GET /api/people` → `{ people: PersonCard[] }` (for the list/grid).
- `GET /api/people/[id]` → `{ dossier: EnrichedPerson, synthesis: Synthesis | null }`. `id` is the
  URL-encoded `linkedinUrl`; routes `decodeURIComponent` it. 404 if no dossier.
- `POST /api/people/[id]/synthesize` → returns `{ synthesis }`; if already cached, returns the cache;
  else calls `synthesize()`, caches via `setSynthesis`, returns it.
- (`POST /api/runs`, `GET /api/runs/:id` already exist.)

## UI (Tailwind + shadcn/ui)

**Setup:** add Tailwind + shadcn to the existing Next app (`globals.css`, `tailwind`/`postcss`
config, shadcn init). Components used: `card`, `badge`, `button`, `skeleton`, `separator`, `avatar`.

**`/` — People list:**
- A prompt input + "Run" button (POST `/api/runs`, poll `/api/runs/:id`, refresh the list on
  completion; show run status inline).
- A responsive grid of **person cards**: name, title, `@company`, 3-5 skill badges, influencer badge.
  Card links to `/people/[id]`.

**`/people/[id]` — Dossier (hero):**
- **Header:** name, title, `@company`, headline; link buttons (LinkedIn, X if `twitter`, email if present); influencer badge.
- **AI synthesis block (top, emphasized):** `summary` paragraph; `interests` as badges; `hooks` as a
  list (each: bold `angle`, muted `why`). A **"Copy hooks"** button (copies the hooks as text for
  drafting) and a **"Regenerate"** button (re-POST synthesize, bypassing cache). If `synthesis` is
  null on load, auto-POST synthesize and show a `skeleton` until it returns.
- **Skills:** badge chips.
- **Experience:** vertical timeline, current first (title · company · dates · summary).
- **Education:** list (school · degree · field · year).
- **Recent posts:** cards (text · postedAt · likes · link) — only shown if `posts` non-empty.
- **Web footprint:** grouped by category (talk / podcast / github / article) as labeled links — only
  if `webMentions` non-empty.
- **Contact:** email(s) / phone if present.

Empty/absent sections render nothing (no empty shells).

## Error handling

- `synthesize()` failure → returns empty `Synthesis`; the UI shows a "couldn't generate — retry"
  state with the Regenerate button (raw dossier still fully visible).
- `GET /api/people/[id]` with unknown id → 404 → dossier page shows a not-found state.
- Run trigger failures surface inline on the list page (reuse existing `/api/runs` error shape).

## Testing

- **Backend (mock `../orange` seam):** `synthesize` builds a grounded prompt and maps the model
  object into `Synthesis` with safe defaults; degrades to empty on throw. `repo.listPeople` returns
  card rows with skills/isInfluencer parsed from `dossier` and `hasSynthesis` reflecting the column;
  `getSynthesis`/`setSynthesis` round-trip; synthesize endpoint returns cache when present (does NOT
  re-call the model) and generates+caches when absent.
- **API routes:** unit-test the handlers with a mocked repo/synthesize — status codes, id decode,
  cache-hit vs generate path.
- **UI:** light component tests are optional for the hackathon; rely on the build + a manual pass.
  (If time-boxed, prioritize backend/API tests; verify the UI by running it.)
- **Manual:** `npm run dev`, open `/`, click a person, confirm the AI block populates and Copy works.

## Build order

1. `Synthesis` types + `synthesize()` + tests.
2. `synthesis` column migration + repo `listPeople`/`getSynthesis`/`setSynthesis` + tests.
3. API routes (`/api/people`, `/api/people/[id]`, `/api/people/[id]/synthesize`) + tests.
4. Tailwind + shadcn setup; people-list page (+ run trigger).
5. Dossier page (header, AI block w/ copy+regenerate, scannable sections).
6. Loading/empty/error states + build + manual pass.
