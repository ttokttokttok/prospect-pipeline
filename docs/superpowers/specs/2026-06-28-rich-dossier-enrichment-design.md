# Phase 1 — Rich Person Dossier (Data Enrichment)

**Date:** 2026-06-28
**Status:** Approved (design)
**Owner:** joshua.yjn.chung@gmail.com
**Depends on:** the existing prospect pipeline (companies → people → enrich).
**Followed by:** Phase 2 (the dossier UI), then later cold-email curation.

## Summary

Today `enrichPerson` only collects `headline` and `twitter` — there is almost nothing to
visualize. This phase makes each person's dossier genuinely rich and *structured*, so the Phase 2
UI can render "what does this person care about" at a glance. All data is collected through Orange
Slice (no external scrapers). Three layers:

1. **Professional backbone** (reliable, 1-credit): skills, work experience, education, certifications,
   languages, influencer flag — via `person.linkedin.enrich({ extended: true })`.
2. **Recent posts** (what they actually talk about — the truest "interests" signal): recent
   LinkedIn activity, and Twitter/X posts when a handle exists — via `apify.runActor`.
3. **Web footprint**: conference talks, podcasts, GitHub, blog mentions — via web dorking
   (`web.batchSearch`).

The full nested dossier is persisted (so the Phase 2 API/UI can read it) and written to
`people.json`.

## Goals

- Every enriched person carries a structured dossier the UI can render section-by-section.
- "Interests" is answerable: skills + what they post about + their web footprint.
- Stays entirely within Orange Slice; no crawl4ai / external infra.
- Degrades gracefully — a failed Apify actor or empty dork yields empty arrays, never a crash, and
  the reliable backbone (extended enrich) still lands.

## Non-goals

- The UI itself (Phase 2).
- Cold-email generation (later phase).
- Personal social (Instagram/Facebook), personal Google — out of scope (brittle, ToS/privacy).
- New storage engine — we extend the existing SQLite schema.

## Data model

Extend `EnrichedPerson` (in `src/types.ts`). New fields (all default to `[]`/`null` on failure):

```ts
export interface Experience {
  title: string;
  company: string;
  companyDomain: string | null;
  isCurrent: boolean;
  startDate: string | null;   // "YYYY-MM" or "YYYY-MM-DD"
  endDate: string | null;
  summary: string | null;
}

export interface Education {
  school: string;
  degree: string | null;
  field: string | null;
  endYear: number | null;
}

export interface Post {
  source: "linkedin" | "twitter";
  text: string;
  url: string | null;
  postedAt: string | null;    // ISO if available, else null
  likes: number | null;
}

export interface WebMention {
  category: "talk" | "podcast" | "github" | "article" | "web";
  title: string;
  url: string;
  snippet: string | null;
}

// EnrichedPerson gains:
//   skills: string[]
//   experience: Experience[]
//   education: Education[]
//   certifications: string[]
//   languages: string[]
//   isInfluencer: boolean
//   posts: Post[]
//   webMentions: WebMention[]
// (existing fields stay: headline, twitter, workEmail, personalEmail, phone, signals)
```

`signals` (the existing flat array) stays for backward-compatibility but is superseded by
`posts` + `webMentions`; `run.ts` continues to populate the `signals` table from them.

## Collection (`src/pipeline/enrich.ts`)

`enrichPerson` keeps its current shape (parallel sub-fetches, each isolated in try/catch). Changes:

1. **Profile → extended.** Call `services.person.linkedin.enrich({ url, extended: true })`. Map:
   - `skills` ← `skills ?? []`
   - `experience` ← `experience[]` mapped to our `Experience` (title, company_name→company,
     company_domain, is_current, start_date, end_date, summary)
   - `education` ← `education[]` mapped to our `Education` (school.name, degree, field_of_study.name,
     end_date_year)
   - `certifications` ← `certifications[]` titles
   - `languages` ← `languages[]` names
   - `isInfluencer` ← `is_influencer ?? false`
   - `headline`, `twitter_handle` as today.

   These field names are **verified** against the SDK's `B2BPersonExtended` (`enrich.md` /
   `dist/expansion.d.ts`).

2. **Posts → Apify.** New `gatherPosts(person)`:
   - LinkedIn: run an Apify actor that fetches a profile's recent activity, input = the person's
     LinkedIn URL, `datasetListParams.limit` ≈ 10.
   - Twitter: only if `twitter` handle present; run a Twitter/X actor for recent tweets, limit ≈ 10.
   - **⚠️ Highest-risk item.** Per Orange Slice's apify doc ("never guess params — discover first"),
     implementation MUST: (a) discover the actor via the Algolia actor search, (b) fetch its input
     schema, (c) validate the output shape against a couple of real profiles before committing the
     field mapping, (d) on any failure return `[]`. The actor id(s) and exact output→`Post` mapping
     are resolved at implementation time and recorded in the implementation plan. Cost: Apify is
     variable/metered — keep `limit` small and run only for people we keep.

3. **Web footprint → dorks.** Replace the current generic `gatherSignals` with `gatherWebMentions`
   using `web.batchSearch` with categorized queries:
   - `"<name>" <company> (conference OR talk OR keynote)` → `talk`
   - `"<name>" (podcast OR interview)` → `podcast`
   - `"<name>" site:github.com` → `github`
   - `"<name>" <company> (blog OR article)` → `article`
   Map top ~3 results/category to `WebMention` (category, title, url, snippet). Empty is fine.

All three run in parallel with the contact fetch; the contact gate (`opts.contacts &&
!opts.skipContact`) is unchanged.

## Storage (`src/storage/`)

- Add a `dossier TEXT` column to `people` (JSON blob of the full `EnrichedPerson`). `upsertPerson`
  writes `JSON.stringify(person)` there; this is what the Phase 2 API/UI reads.
- Keep the flat columns (name, title, emails, twitter…) for the CSV/cache and `needsContact`.
- `signals` table: keep; `run.ts` populates it from `posts` + `webMentions` (denormalized, queryable).
- Migration is additive (`ALTER TABLE people ADD COLUMN dossier TEXT` guarded for existing DBs, or
  recreate in `db.ts` SCHEMA + an idempotent add-column on open).

## Output (`src/output/export.ts`)

- `people.json` already serializes the full `EnrichedPerson`, so it gains the new fields for free.
- `people.csv` stays a flat summary; add columns: `skills` (joined), `top_post` (most recent post
  text, truncated), `mentions_count`.

## Cost & runtime

- Extended enrich: same ~1 credit/person as now (just `extended:true`).
- Web dorks: ~4 `batchSearch` queries/person (cheap).
- **Apify is the cost/latency/flakiness center** — metered, slower. Mitigations: small `limit`,
  run posts only for the final kept people, graceful `[]` on failure, and keep it behind the same
  "only enrich people we keep" path. A run of ~47 people should still complete in a few minutes.

## Error handling

- Each sub-fetch (extended enrich, posts, web mentions, contact) is independently try/caught →
  returns `[]`/`null`/`false` on failure. One failing layer never drops the others.
- Apify actor failure (rate limit, bad actor, shape mismatch) → `posts: []`, logged, run continues.
- Backbone (extended enrich) is the reliability floor: even if posts + mentions both fail, the UI
  still has skills/experience/education to render.

## Testing

- Unit (mock the `../orange` seam, as today):
  - extended-enrich mapping: given a `B2BPersonExtended`-shaped object, assert `skills`,
    `experience`, `education`, `certifications`, `languages`, `isInfluencer` map correctly.
  - graceful degradation: enrich rejects → backbone empty but no throw; apify rejects → `posts: []`
    but skills/experience still populated.
  - `gatherWebMentions`: categorized queries map to the right `WebMention.category`.
  - `upsertPerson` writes a `dossier` JSON column round-trippable back to the object.
- **Live validation (gated, manual):** extend the existing `PROSPECT_E2E` run to assert a kept
  person has non-empty `skills`/`experience`, and report posts/mentions coverage (so we *see* the
  Apify reality rather than trusting mocks — the lesson from the `lp_*` fix).

## Build order within Phase 1

1. Types + extended-enrich mapping + tests (the reliable backbone — unblocks the UI immediately).
2. Web-footprint dorks + tests.
3. Storage `dossier` column + persistence + tests.
4. Apify posts (discovery → validate → map → degrade) — last, since it's the riskiest and the UI
   doesn't block on it.
