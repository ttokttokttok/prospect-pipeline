# Phase 4 — Cold-Email Drafting

**Date:** 2026-06-28
**Status:** Approved (design)
**Owner:** joshua.yjn.chung@gmail.com
**Depends on:** Phase 1-3 (dossier, synthesis/hooks, brain view).

## Summary

Turn each person's brain view into a finished, editable cold-email draft. A **set-once sender
profile** captures your side (who you are, your offer, value prop, social proof, CTA, tone). The
drafter combines that with the person's dossier + synthesis (hooks, current focus, interests) to
produce one strong `{ subject, body }` via Orange Slice's `ai.generateObject`, following cold-email
best practices and grounded in real facts. On the dossier, a "Draft email" section generates an
editable draft with Copy + Regenerate; the last draft is cached.

## Goals

- Drafts that are specific to the person (grounded in their dossier/hooks) AND carry your offer/CTA.
- Capture your side once; reuse for every draft.
- Explicit, on-demand drafting (a button) — not auto-generated for everyone.
- No sending integration; copy-paste out. (Gmail/Instantly integration is a possible later phase.)

## Non-goals

- Multiple variants / A/B drafts; follow-up sequences (chosen: one draft + Regenerate).
- Sending/scheduling emails.
- Persisting *manual* edits server-side (MVP caches the AI-generated draft; in-browser edits + copy).
- Per-person offer overrides (one global sender profile).

## Data model

```ts
export interface SenderProfile {
  senderName: string;     // you
  senderCompany: string;  // your company / role
  offer: string;          // what you're pitching (1-2 lines)
  valueProp: string;      // why it matters / outcome
  socialProof: string;    // a credibility line (customers, results, backing)
  cta: string;            // your ask, e.g. "open to a quick 15-min call?"
  tone: string;           // e.g. "warm and direct, no corporate fluff"
}

export interface EmailDraft {
  subject: string;
  body: string;
}
```

## The drafter (`src/pipeline/draft.ts`)

`draftEmail(person: EnrichedPerson, synthesis: Synthesis | null, profile: SenderProfile): Promise<EmailDraft>`
via `services.ai.generateObject` (`intelligence: "medium"`, cast as in `synthesize.ts`). The prompt
encodes cold-email best practices and is grounded in the brain view:

- **Subject:** short, specific, relevance-driven (not salesy / not clickbait).
- **Open** with a genuine personalized line from a real hook / their `currentFocus` / a recent post —
  never generic flattery.
- **One sentence** connecting the offer's value (`offer` + `valueProp` + `socialProof`) to *their*
  context (interests / current focus).
- **One soft, low-friction CTA** = `profile.cta` (a question, not "book a demo now").
- **Short** (~80-120 words), human, in `profile.tone`, **no fabrication**, signed as
  `senderName` / `senderCompany`.

Inputs fed to the model: person facts (name, title, company, headline, currentFocus, top interests,
1-2 recent posts, a couple of hooks) + the full sender profile. Degrades to `{ subject: "", body: "" }`
on failure.

## Storage (`src/storage/`)

- **`settings` table** (key-value): `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`. The
  sender profile is stored under key `sender_profile` as JSON. Repo: `getSenderProfile(): SenderProfile | null`,
  `setSenderProfile(p): void`.
- **`people.draft TEXT`** column (JSON `EmailDraft`), additive idempotent migration (same pattern as
  `dossier`/`synthesis`). Repo: `getDraft(linkedinUrl): EmailDraft | null`, `setDraft(linkedinUrl, d): void`.

## Server (`src/server/people.ts`)

- `getOrCreateDraft(repo, id, profile, force = false, gen = draftEmail): Promise<EmailDraft | null>` —
  if `!force`, return the cached draft if present; else load the dossier (null if unknown id), load
  synthesis (for grounding), call `gen(dossier, synthesis, profile)`, cache only when non-empty
  (`subject || body`, mirroring the synthesis no-poison rule), return it.
- `getPersonDetail` also returns the cached `draft` → `{ dossier, synthesis, metrics, draft }`.

## API

- `GET /api/settings` → `{ profile: SenderProfile | null }`.
- `PUT /api/settings` (body = `SenderProfile`) → `{ profile }`; minimal validation (strings; missing
  fields default to `""`).
- `POST /api/people/[id]/draft[?force=1]`:
  - If no saved sender profile → `409 { error: "needs_profile" }`.
  - Else `getOrCreateDraft`; `404` for unknown id; `200 { draft }` otherwise.

## UI

- **`/settings` page** (`"use client"`): a form for the 7 `SenderProfile` fields; loads `GET /api/settings`,
  saves via `PUT`; a small "saved" confirmation. A link to it from the home page header.
- **Dossier "Draft email" section** (`app/people/[id]/page.tsx`): shows the cached `draft` if present
  (editable subject input + body textarea), plus a **"Draft email"** / **"Regenerate"** button (POST,
  `?force=1` for regenerate) and **Copy**. On `409 needs_profile`, show "Set up your sender profile
  first →" linking to `/settings`. While generating: a loading state. Empty-draft AI result → a
  "couldn't draft — retry" state.

## Error handling / degradation

- No sender profile → API 409; UI guides to `/settings` (raw dossier/brain view unaffected).
- `draftEmail` AI failure → empty draft (not cached); UI shows retry.
- Unknown id → 404.

## Testing

- **Backend (TDD, mock `../orange`):** `draftEmail` builds a grounded prompt (includes person facts +
  the offer/valueProp/socialProof/cta) and maps the model object to `{subject, body}`; degrades to empty.
  `getSenderProfile`/`setSenderProfile` round-trip; `getDraft`/`setDraft` round-trip. `getOrCreateDraft`:
  cache hit doesn't call `gen`; force bypasses; empty result not cached; null for unknown id.
  `getPersonDetail` includes `draft`.
- **API routes + UI:** build-verified + manual pass (no React test runner). Controller will set a
  profile, draft an email live, and confirm it's grounded + copyable.

## Build order

1. `SenderProfile`/`EmailDraft` types + `draftEmail()` + tests.
2. `settings` table + `draft` column + repo methods + tests.
3. `getOrCreateDraft` + `getPersonDetail` includes draft + tests.
4. API routes (`/api/settings`, `/api/people/[id]/draft`) (thin; logic tested in 3).
5. `/settings` page (+ header link).
6. Dossier "Draft email" section (editable + copy + regenerate + needs-profile state).
