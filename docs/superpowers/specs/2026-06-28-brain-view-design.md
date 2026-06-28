# Phase 3 — "Brain View" (Context Signals + Interest Radar)

**Date:** 2026-06-28
**Status:** Approved (design)
**Owner:** joshua.yjn.chung@gmail.com
**Depends on:** Phase 1 (dossier), Phase 2 (dossier UI + synthesis).
**Followed by:** cold-email drafting/curation phase (consumes this context).

## Summary

Turn each person's dossier into a "digital twin / how-to-approach-them" view. On top of the existing
AI synthesis, add: a grounded **current focus** ("what they're working on now"), an AI-chosen
**interest profile** (5-7 categories scored 0-100) rendered as a **radar chart**, deterministic
**tenure + recency** metrics, and the person's **3 most recent posts**. To populate all of this,
**post collection becomes default-on** (it's ~$0.00005/person per our live test). Everything feeds
the upcoming cold-email phase.

## Goals

- At a glance, understand what someone cares about (radar) and is doing now (current focus) — to know how to approach them.
- All signals grounded in the dossier (no fabrication); cheap (folds into the existing synthesis call + one pure metrics function).
- Brain view is actually populated by default (posts on).

## Non-goals

- Cross-person / aggregate graph (separate future idea).
- Cold-email drafting (next phase).
- Seniority/trajectory/influence signals (explicitly dropped — user picked focus + tenure/recency only).

## Decisions (locked)

- **Posts default ON** — drop the `--posts` gate; collect posts on every run. Keep a `--no-posts`
  escape hatch (CLI) / `posts:false` (API).
- **Contacts default ON** — credits are not a constraint (~52k available), so verified email/phone is
  fetched on every run too. Keep a `--no-contacts` escape hatch (CLI) / `contacts:false` (API).
  Note: this makes a default run take **several minutes** (contact.get is ~10 min/person, parallelized)
  rather than ~15s — accepted. The `last_enriched_at` credit cache still prevents re-paying across runs.
- **Momentum = posts-only** — recency is based on the most recent post date (no role-change heuristic).
- **Radar via recharts** (a specialized chart lib), not hand-rolled. Verify it builds under Next 16 /
  React 19 / Turbopack; if it genuinely fights the build, fall back to a minimal SVG radar.

## Data model

```ts
// synthesize output (Synthesis) gains:
export interface InterestAxis { category: string; score: number }   // score 0-100
//   currentFocus: string
//   interestProfile: InterestAxis[]   // 5-7 AI-chosen axes
// (existing summary, interests, hooks stay)

// deterministic, computed (not stored):
export interface PersonMetrics {
  tenureMonths: number | null;   // months in current role
  recentlyActive: boolean;       // most recent post within ~90 days
  lastPostAt: string | null;     // ISO date of most recent post, or null
}
```

## Backend

- **Posts + contacts default-on** (`src/types.ts`, `src/pipeline/run.ts`, `app/api/runs/route.ts`, `scripts/run.ts`):
  - `RunParams.posts` and `RunParams.contacts` default `true`.
  - CLI: `--no-posts` sets `posts:false`, `--no-contacts` sets `contacts:false` (replace the old
    `--posts`/`--contacts` enable flags; update usage string).
  - API: `posts: body.posts !== false`, `contacts: body.contacts !== false` (default true).
  - `run.ts` already threads both to `enrichPerson`; gatherPosts gates on `opts.posts`, contact fetch
    on `opts.contacts && !opts.skipContact` (the credit cache still skips already-enriched people).
- **`synthesize.ts`** — extend the schema/prompt/mapping with:
  - `currentFocus`: grounded one-liner from current role + recent posts.
  - `interestProfile`: 5-7 `{category, score}` axes, scores 0-100, grounded; instruct "pick the
    categories yourself from the evidence; do not fabricate." Degrade to `""`/`[]` on failure.
- **`src/pipeline/metrics.ts`** — `computeMetrics(person: EnrichedPerson): PersonMetrics` (pure):
  - `tenureMonths`: from the current experience entry (`isCurrent`) `startDate` to now; `null` if absent.
  - `lastPostAt`: max `postedAt` across `posts`; `null` if no posts.
  - `recentlyActive`: `lastPostAt` within ~90 days.
- **`getPersonDetail`** → returns `{ dossier, synthesis, metrics }` (metrics via `computeMetrics`, computed on the fly — no new storage). The detail API route already returns whatever `getPersonDetail` gives.

## UI

- **`src/ui/radar.tsx`** — a `"use client"` component wrapping recharts `RadarChart` for `InterestAxis[]`
  (one series, 0-100 domain, category labels). Renders nothing if the profile is empty. (If recharts
  SSR/build issues appear, load it via `next/dynamic` with `ssr:false`, or fall back to a minimal SVG.)
- **Dossier page** additions (consumes the now-richer detail):
  - **Current focus** headline at the top of the AI block (above summary), styled prominently.
  - **Context strip** chips: tenure (e.g. `2 yrs at Acme`) and recency (`Active recently` /
    `Last posted 3w ago`; omitted if no posts).
  - **Interest radar** in the AI block (from `interestProfile`); **fallback** to the existing interest
    tags when `interestProfile` is empty (e.g. syntheses cached before this phase).
  - **Recent posts**: ensure the posts section shows the **3 most recent** (sorted by `postedAt` desc),
    emphasized as a core signal.

## Error handling / degradation

- `synthesize` failure → empty `currentFocus`/`interestProfile` (plus existing empty-summary handling);
  UI hides the radar / focus line and falls back to interest tags. Empty synthesis still not cached
  (Phase 2 fix).
- `computeMetrics` returns nulls/false for missing data; UI omits the corresponding chip.
- No posts (e.g. `--no-posts`, or pre-existing data) → no recency chip, no recent-posts section, radar
  and focus still work from profile/experience.

## Migration note

Existing collected people have **no posts** and syntheses **without** `currentFocus`/`interestProfile`.
To populate the brain view, re-run prospects (posts now default-on) and Regenerate their synthesis
(force-bypass already exists). The UI degrades gracefully until then.

## Testing

- **Backend (TDD, mock `../orange`):**
  - `synthesize` maps `currentFocus` + `interestProfile` (incl. score coercion to numbers) and degrades to `""`/`[]`.
  - `computeMetrics`: tenure from a current role with a start date; `lastPostAt`/`recentlyActive` from posts (recent vs old vs none) — use fixed `postedAt` dates in fixtures (do not rely on real "now" drift beyond a wide threshold).
  - defaults: `RunParams`/CLI/API default both `posts` and `contacts` to on; `--no-posts`/`--no-contacts` (and `posts:false`/`contacts:false`) disable each.
  - `getPersonDetail` includes `metrics`.
- **UI:** build-verified + manual pass (no React test runner). The controller will run the dev server, regenerate a synthesis, and confirm the radar + focus + chips + recent posts render.

## Build order

1. Posts default-on (types/run/API/CLI) + tests.
2. `synthesize` currentFocus + interestProfile + tests.
3. `metrics.ts` computeMetrics + tests.
4. `getPersonDetail` returns metrics + test.
5. recharts install + `src/ui/radar.tsx` (build-verified).
6. Dossier page: current focus headline + context chips + radar + recent-posts emphasis (build + manual).
