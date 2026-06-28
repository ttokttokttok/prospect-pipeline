# Cold-Email Drafting (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a finished, editable cold-email draft per person from a set-once sender profile + the brain view.

**Architecture:** A set-once `SenderProfile` (settings table) + a grounded `draftEmail()` (Orange Slice AI) produce one `{subject, body}` cached per person; surfaced on the dossier with edit/copy/regenerate, and a `/settings` page for the profile.

**Tech Stack:** TypeScript (ESM), Orange Slice SDK (`src/orange`), better-sqlite3, Vitest, Next.js 16, Tailwind v4.

## Global Constraints

- **All Orange Slice access through `src/orange`** (single mock seam). AI via `services.ai.generateObject` (`intelligence: "medium"`, cast `as Parameters<typeof services.ai.generateObject>[0]`, as in `synthesize.ts`).
- **ESM.** Non-test source uses extensionless imports; test files use `.js`. Vitest 4.1.9 → `vi.hoisted`.
- **Run `npm run build` after every task** (Vitest does not full-type-check).
- **Cache rules mirror synthesis:** `getOrCreateDraft` returns the cached draft unless `force`; never caches an empty draft (`subject || body`); the dossier route returns `409 { error: "needs_profile" }` when no sender profile is saved.
- **Grounding:** `draftEmail` must use real dossier/synthesis facts + the sender profile; no fabrication; degrade to `{ subject:"", body:"" }` on failure (never throw).
- **Backend (Tasks 1-3) is TDD'd; API routes + UI (Tasks 4-6) are verified by `npm run build` + a manual pass** (no React test runner).

---

### Task 1: Types + `draftEmail()`

**Files:**
- Modify: `src/types.ts`
- Create: `src/pipeline/draft.ts`
- Test: `src/pipeline/draft.test.ts`

**Interfaces:**
- Consumes: `services.ai.generateObject` (mocked), `EnrichedPerson`, `Synthesis`.
- Produces:
  - `SenderProfile = { senderName, senderCompany, offer, valueProp, socialProof, cta, tone }` (all `string`).
  - `EmailDraft = { subject: string; body: string }`.
  - `draftEmail(person: EnrichedPerson, synthesis: Synthesis | null, profile: SenderProfile): Promise<EmailDraft>`.

- [ ] **Step 1: Write the failing test** — `src/pipeline/draft.test.ts`:

```ts
import { test, expect, vi, beforeEach } from "vitest";

const { generateObject } = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("../orange.js", () => ({ services: { ai: { generateObject } } }));

import { draftEmail } from "./draft.js";
import type { EnrichedPerson, SenderProfile, Synthesis } from "../types.js";

const person: EnrichedPerson = {
  linkedinUrl: "u", companyDomain: "acme.com", name: "Jane Doe", title: "CTO",
  headline: "CTO at Acme", twitter: null, workEmail: null, personalEmail: null, phone: null,
  skills: ["Go"], experience: [], education: [], certifications: [], languages: [],
  isInfluencer: false, jobsCount: null, recommenderCount: null,
  posts: [{ source: "linkedin", text: "Shipping our infra platform", url: null, postedAt: null, likes: null }],
  webMentions: [], rawProfile: null,
};
const synthesis: Synthesis = {
  summary: "CTO focused on infra.", interests: ["infra"], hooks: [{ angle: "her infra post", why: "she posted about it" }],
  currentFocus: "Shipping the new infra platform", interestProfile: [{ category: "Infra", score: 90 }],
};
const profile: SenderProfile = {
  senderName: "Sam", senderCompany: "DeployCo", offer: "a faster CI platform",
  valueProp: "cut build times 60%", socialProof: "used by Stripe and Vercel",
  cta: "open to a quick 15-min call?", tone: "warm and direct",
};

beforeEach(() => generateObject.mockReset());

test("maps the model object to {subject, body}", async () => {
  generateObject.mockResolvedValue({ object: { subject: "Faster CI for Acme", body: "Hi Jane, ..." } });
  const out = await draftEmail(person, synthesis, profile);
  expect(out).toEqual({ subject: "Faster CI for Acme", body: "Hi Jane, ..." });
});

test("prompt includes the offer and a grounded person fact", async () => {
  generateObject.mockResolvedValue({ object: { subject: "", body: "" } });
  await draftEmail(person, synthesis, profile);
  const prompt = generateObject.mock.calls[0][0].prompt as string;
  expect(prompt).toContain("a faster CI platform");           // offer
  expect(prompt).toContain("used by Stripe and Vercel");      // social proof
  expect(prompt).toContain("open to a quick 15-min call?");   // cta
  expect(prompt).toContain("Shipping the new infra platform"); // grounded fact (currentFocus)
});

test("degrades to an empty draft on failure", async () => {
  generateObject.mockRejectedValueOnce(new Error("ai down"));
  expect(await draftEmail(person, synthesis, profile)).toEqual({ subject: "", body: "" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/draft.test.ts`
Expected: FAIL ("Cannot find module './draft.js'").

- [ ] **Step 3: Add the types** — append to `src/types.ts`:

```ts
export interface SenderProfile {
  senderName: string;
  senderCompany: string;
  offer: string;
  valueProp: string;
  socialProof: string;
  cta: string;
  tone: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
}
```

- [ ] **Step 4: Implement `src/pipeline/draft.ts`**

```ts
import { services } from "../orange";
import type { EmailDraft, EnrichedPerson, SenderProfile, Synthesis } from "../types";

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "Short, specific, relevance-driven subject line (not salesy)." },
    body: { type: "string", description: "The email body, ~80-120 words." },
  },
  required: ["subject", "body"],
};

export async function draftEmail(
  person: EnrichedPerson,
  synthesis: Synthesis | null,
  profile: SenderProfile,
): Promise<EmailDraft> {
  const recipient = [
    `Name: ${person.name}`,
    `Title: ${person.title ?? "(unknown)"} at ${person.companyDomain}`,
    person.headline ? `Headline: ${person.headline}` : "",
    synthesis?.currentFocus ? `Current focus: ${synthesis.currentFocus}` : "",
    synthesis?.interests?.length ? `Interests: ${synthesis.interests.join(", ")}` : "",
    synthesis?.hooks?.length ? `Hooks: ${synthesis.hooks.map((h) => h.angle).join("; ")}` : "",
    person.posts.length ? `Recent post: "${person.posts[0].text}"` : "",
  ].filter(Boolean).join("\n");

  const sender = [
    `From: ${profile.senderName}, ${profile.senderCompany}`,
    `Offer: ${profile.offer}`,
    `Value: ${profile.valueProp}`,
    `Social proof: ${profile.socialProof}`,
    `CTA: ${profile.cta}`,
    `Tone: ${profile.tone}`,
  ].join("\n");

  try {
    const { object } = await services.ai.generateObject({
      prompt:
        `Write ONE short, personalized cold email. Best practices: a specific non-salesy subject; ` +
        `open with a genuine personalized line grounded in a REAL fact about the recipient below ` +
        `(their current focus, a hook, or their recent post) — never generic flattery; ONE sentence ` +
        `connecting the sender's offer/value/social-proof to THEIR context; exactly ONE soft, ` +
        `low-friction CTA (use the sender's CTA, phrased as a question); ~80-120 words; match the ` +
        `sender's tone; sign off as the sender. Do NOT fabricate anything.\n\n` +
        `--- RECIPIENT ---\n${recipient}\n\n--- SENDER ---\n${sender}`,
      schema: SCHEMA,
      intelligence: "medium",
    } as Parameters<typeof services.ai.generateObject>[0]);
    return { subject: String(object.subject ?? ""), body: String(object.body ?? "") };
  } catch {
    return { subject: "", body: "" };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/pipeline/draft.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Build + commit**

Run: `npm run build`  (expected clean)
```bash
git add src/types.ts src/pipeline/draft.ts src/pipeline/draft.test.ts
git commit -m "feat: draftEmail — grounded cold-email drafter (subject + body)"
```

---

### Task 2: settings table + draft column + repo methods

**Files:**
- Modify: `src/storage/db.ts`
- Modify: `src/storage/repo.ts`
- Modify: `src/storage/repo.test.ts`

**Interfaces:**
- Consumes: `SenderProfile`, `EmailDraft` (Task 1).
- Produces:
  - `settings (key TEXT PRIMARY KEY, value TEXT)` table; `people.draft TEXT` column.
  - `Repo.getSenderProfile(): SenderProfile | null`, `Repo.setSenderProfile(p): void`, `Repo.getDraft(linkedinUrl): EmailDraft | null`, `Repo.setDraft(linkedinUrl, d): void`.

- [ ] **Step 1: Write the failing tests** — append to `src/storage/repo.test.ts`:

```ts
test("sender profile round-trips via settings", () => {
  expect(repo.getSenderProfile()).toBeNull();
  const profile = { senderName: "Sam", senderCompany: "DeployCo", offer: "CI", valueProp: "fast", socialProof: "Stripe", cta: "call?", tone: "warm" };
  repo.setSenderProfile(profile);
  expect(repo.getSenderProfile()).toEqual(profile);
  // upsert overwrites
  repo.setSenderProfile({ ...profile, offer: "CD" });
  expect(repo.getSenderProfile()!.offer).toBe("CD");
});

test("draft round-trips on the person row", () => {
  const url = "https://linkedin.com/in/jane";
  repo.upsertPerson({
    linkedinUrl: url, companyDomain: "acme.com", name: "Jane", title: "CTO", headline: null, twitter: null,
    workEmail: null, personalEmail: null, phone: null, skills: [], experience: [], education: [],
    certifications: [], languages: [], isInfluencer: false, jobsCount: null, recommenderCount: null,
    posts: [], webMentions: [], rawProfile: null,
  } as any);
  expect(repo.getDraft(url)).toBeNull();
  repo.setDraft(url, { subject: "Hi", body: "Body" });
  expect(repo.getDraft(url)).toEqual({ subject: "Hi", body: "Body" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/storage/repo.test.ts`
Expected: FAIL (`repo.getSenderProfile`/`getDraft` not functions).

- [ ] **Step 3: Update `src/storage/db.ts`** — add `draft TEXT` to the `people` CREATE TABLE (after `synthesis TEXT`), add the `settings` table to the schema, and extend the migration. The `people` block's last column line becomes `  synthesis TEXT,\n  draft TEXT\n);`. Add this table to the SCHEMA string (e.g. after the `signals` table):

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```
And in the migration block add:
```ts
  if (!cols.some((c) => c.name === "draft")) db.exec("ALTER TABLE people ADD COLUMN draft TEXT");
```
(The `settings` table is created by `CREATE TABLE IF NOT EXISTS`, so it needs no PRAGMA guard.)

- [ ] **Step 4: Add repo methods** — in `src/storage/repo.ts`, merge `SenderProfile`, `EmailDraft` into the existing type import, then add (next to `getSynthesis`/`setSynthesis`):

```ts
  getSenderProfile(): SenderProfile | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'sender_profile'").get() as any;
    return row?.value ? (JSON.parse(row.value) as SenderProfile) : null;
  }

  setSenderProfile(p: SenderProfile): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('sender_profile', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(p));
  }

  getDraft(linkedinUrl: string): EmailDraft | null {
    const row = this.db.prepare("SELECT draft FROM people WHERE linkedin_url = ?").get(linkedinUrl) as any;
    return row?.draft ? (JSON.parse(row.draft) as EmailDraft) : null;
  }

  setDraft(linkedinUrl: string, d: EmailDraft): void {
    this.db.prepare("UPDATE people SET draft = ? WHERE linkedin_url = ?").run(JSON.stringify(d), linkedinUrl);
  }
```

- [ ] **Step 5: Run tests + full suite + build**

Run: `npx vitest run src/storage/repo.test.ts && npm test && npm run build`
Expected: pass; build clean.

- [ ] **Step 6: Commit**

```bash
git add src/storage/db.ts src/storage/repo.ts src/storage/repo.test.ts
git commit -m "feat: settings table (sender profile) + per-person draft column"
```

---

### Task 3: `getOrCreateDraft` + detail includes draft

**Files:**
- Modify: `src/server/people.ts`
- Modify: `src/server/people.test.ts`

**Interfaces:**
- Consumes: `draftEmail` (Task 1), repo draft/profile methods (Task 2), `SenderProfile`/`EmailDraft`.
- Produces:
  - `getOrCreateDraft(repo, id, profile: SenderProfile, force = false, gen = draftEmail): Promise<EmailDraft | null>` — cache hit unless `force`; null for unknown id; never caches empty.
  - `getPersonDetail` returns `{ dossier, synthesis, metrics, draft }`.

- [ ] **Step 1: Write the failing test** — append to `src/server/people.test.ts`:

```ts
const profile = { senderName: "Sam", senderCompany: "Co", offer: "x", valueProp: "y", socialProof: "z", cta: "call?", tone: "warm" };

test("getPersonDetail includes the cached draft (null when none)", () => {
  expect(getPersonDetail(repo, encodeId(url))!.draft).toBeNull();
});

test("getOrCreateDraft generates+caches on miss, returns cache on hit, force bypasses, empty not cached", async () => {
  const gen = vi.fn().mockResolvedValue({ subject: "S", body: "B" });
  const first = await getOrCreateDraft(repo, encodeId(url), profile, false, gen);
  expect(first).toEqual({ subject: "S", body: "B" });
  expect(gen).toHaveBeenCalledTimes(1);
  await getOrCreateDraft(repo, encodeId(url), profile, false, gen); // cache hit
  expect(gen).toHaveBeenCalledTimes(1);
  await getOrCreateDraft(repo, encodeId(url), profile, true, gen);  // force regenerates
  expect(gen).toHaveBeenCalledTimes(2);

  const emptyGen = vi.fn().mockResolvedValue({ subject: "", body: "" });
  const url2 = "https://linkedin.com/in/empty";
  repo.upsertPerson({ ...({} as any), linkedinUrl: url2, companyDomain: "x.com", name: "E", title: null, headline: null, twitter: null, workEmail: null, personalEmail: null, phone: null, skills: [], experience: [], education: [], certifications: [], languages: [], isInfluencer: false, jobsCount: null, recommenderCount: null, posts: [], webMentions: [], rawProfile: null });
  await getOrCreateDraft(repo, encodeId(url2), profile, false, emptyGen);
  expect(repo.getDraft(url2)).toBeNull(); // empty not cached
});

test("getOrCreateDraft returns null for unknown id", async () => {
  const gen = vi.fn();
  expect(await getOrCreateDraft(repo, encodeId("https://x/none"), profile, false, gen)).toBeNull();
  expect(gen).not.toHaveBeenCalled();
});
```
(The existing `beforeEach` already upserts `person` at `url` — reuse it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/people.test.ts`
Expected: FAIL (`getOrCreateDraft` not exported; `detail.draft` undefined).

- [ ] **Step 3: Update `src/server/people.ts`** — add imports `import { draftEmail } from "../pipeline/draft";` and merge `EmailDraft`, `SenderProfile` into the type import. Update `getPersonDetail` to include `draft`:

```ts
export function getPersonDetail(
  repo: Repo,
  id: string,
): { dossier: EnrichedPerson; synthesis: Synthesis | null; metrics: PersonMetrics; draft: EmailDraft | null } | null {
  const url = decodeId(id);
  const dossier = repo.getDossier(url);
  if (!dossier) return null;
  return { dossier, synthesis: repo.getSynthesis(url), metrics: computeMetrics(dossier), draft: repo.getDraft(url) };
}
```
Add `getOrCreateDraft`:
```ts
export async function getOrCreateDraft(
  repo: Repo,
  id: string,
  profile: SenderProfile,
  force = false,
  gen: (p: EnrichedPerson, s: Synthesis | null, prof: SenderProfile) => Promise<EmailDraft> = draftEmail,
): Promise<EmailDraft | null> {
  const url = decodeId(id);
  if (!force) { const cached = repo.getDraft(url); if (cached) return cached; }
  const dossier = repo.getDossier(url);
  if (!dossier) return null;
  const d = await gen(dossier, repo.getSynthesis(url), profile);
  if (d.subject || d.body) repo.setDraft(url, d);
  return d;
}
```

- [ ] **Step 4: Run test + full suite + build**

Run: `npx vitest run src/server/people.test.ts && npm test && npm run build`
Expected: pass; build clean.

- [ ] **Step 5: Commit**

```bash
git add src/server/people.ts src/server/people.test.ts
git commit -m "feat: getOrCreateDraft (cache/force/no-empty) + draft in person detail"
```

---

### Task 4: API routes (`/api/settings`, `/api/people/[id]/draft`)

**Files:**
- Create: `app/api/settings/route.ts`
- Create: `app/api/people/[id]/draft/route.ts`

**Interfaces:**
- Consumes: `getRepo`, `getOrCreateDraft`, repo `getSenderProfile`/`setSenderProfile`, `SenderProfile`.
- Produces: `GET/PUT /api/settings`; `POST /api/people/:id/draft[?force=1]`. Build-verified.

- [ ] **Step 1: Create `app/api/settings/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getRepo } from "../../../src/server/jobs";
import type { SenderProfile } from "../../../src/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ profile: getRepo().getSenderProfile() });
}

export async function PUT(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const profile: SenderProfile = {
    senderName: String(body.senderName ?? ""),
    senderCompany: String(body.senderCompany ?? ""),
    offer: String(body.offer ?? ""),
    valueProp: String(body.valueProp ?? ""),
    socialProof: String(body.socialProof ?? ""),
    cta: String(body.cta ?? ""),
    tone: String(body.tone ?? ""),
  };
  getRepo().setSenderProfile(profile);
  return NextResponse.json({ profile });
}
```

- [ ] **Step 2: Create `app/api/people/[id]/draft/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getRepo } from "../../../../../src/server/jobs";
import { getOrCreateDraft } from "../../../../../src/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = getRepo();
  const profile = repo.getSenderProfile();
  if (!profile) return NextResponse.json({ error: "needs_profile" }, { status: 409 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  const draft = await getOrCreateDraft(repo, id, profile, force);
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ draft });
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds; routes `ƒ /api/settings` and `ƒ /api/people/[id]/draft` appear. Run `npm test` to confirm no regressions.

- [ ] **Step 4: Commit**

```bash
git add app/api/settings app/api/people
git commit -m "feat: /api/settings + /api/people/[id]/draft routes"
```

---

### Task 5: `/settings` page + header link

**Files:**
- Create: `app/settings/page.tsx`
- Modify: `app/page.tsx` (header link to `/settings`)

**Interfaces:**
- Consumes: `GET/PUT /api/settings`, `SenderProfile` (type), `primitives`.
- Produces: a working `/settings` form. Build + manual.

- [ ] **Step 1: Create `app/settings/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SenderProfile } from "../../src/types";
import { Button } from "../../src/ui/primitives";

const EMPTY: SenderProfile = { senderName: "", senderCompany: "", offer: "", valueProp: "", socialProof: "", cta: "", tone: "" };
const FIELDS: { key: keyof SenderProfile; label: string; placeholder: string; textarea?: boolean }[] = [
  { key: "senderName", label: "Your name", placeholder: "Sam Rivera" },
  { key: "senderCompany", label: "Company / role", placeholder: "DeployCo — Founder" },
  { key: "offer", label: "What you're offering", placeholder: "a faster CI/CD platform", textarea: true },
  { key: "valueProp", label: "Value prop", placeholder: "cuts build times ~60%", textarea: true },
  { key: "socialProof", label: "Social proof", placeholder: "used by Stripe, Vercel; YC-backed", textarea: true },
  { key: "cta", label: "Call to action", placeholder: "open to a quick 15-min call?" },
  { key: "tone", label: "Tone", placeholder: "warm and direct, no corporate fluff" },
];

export default function SettingsPage() {
  const [profile, setProfile] = useState<SenderProfile>(EMPTY);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d) => { if (d.profile) setProfile({ ...EMPTY, ...d.profile }); });
  }, []);

  async function save() {
    setSaved(false);
    const res = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(profile) });
    if (res.ok) setSaved(true);
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link href="/" className="text-sm text-neutral-500">← Back</Link>
      <h1 className="mt-3 mb-1 text-2xl font-bold">Sender profile</h1>
      <p className="mb-6 text-sm text-neutral-500">Set once — used to draft every cold email.</p>
      <div className="space-y-4">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-sm font-medium">{f.label}</span>
            {f.textarea ? (
              <textarea
                value={profile[f.key]} placeholder={f.placeholder} rows={2}
                onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            ) : (
              <input
                value={profile[f.key]} placeholder={f.placeholder}
                onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value })}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            )}
          </label>
        ))}
        <div className="flex items-center gap-3">
          <Button onClick={save}>Save</Button>
          {saved && <span className="text-sm text-green-600">Saved ✓</span>}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Add a header link on the home page** — in `app/page.tsx`, change the `<h1>` line region so the title row includes a Settings link. Replace the `<h1 ...>Prospect</h1>` line with:

```tsx
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Prospect</h1>
        <Link href="/settings" className="text-sm text-blue-600 hover:underline">Sender profile →</Link>
      </div>
```
(`Link` is already imported in `app/page.tsx`.)

- [ ] **Step 3: Build + manual**

Run: `npm run build`  (route `/settings` appears)
Manual (controller): open `/settings`, fill fields, Save → "Saved ✓"; reload → values persist.

- [ ] **Step 4: Commit**

```bash
git add app/settings/page.tsx app/page.tsx
git commit -m "feat: /settings sender-profile page + header link"
```

---

### Task 6: Dossier "Draft email" section

**Files:**
- Modify: `app/people/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/people/:id` (now includes `draft`), `POST /api/people/:id/draft[?force=1]`, `EmailDraft` (type), `primitives`.
- Produces: the draft section. Build + manual.

- [ ] **Step 1: Add draft state + type import** — in `app/people/[id]/page.tsx`:
  - Extend the type import: `import type { EnrichedPerson, Synthesis, PersonMetrics, EmailDraft } from "../../../src/types";`
  - Add state: `const [draft, setDraft] = useState<EmailDraft | null>(null);`, `const [draftLoading, setDraftLoading] = useState(false);`, `const [needsProfile, setNeedsProfile] = useState(false);`
  - In the mount effect, after `setMetrics(data.metrics);` add `setDraft(data.draft ?? null);`
  - Add a generate handler:
```tsx
  async function generateDraft(force = false) {
    setDraftLoading(true);
    setNeedsProfile(false);
    try {
      const res = await fetch(`/api/people/${id}/draft${force ? "?force=1" : ""}`, { method: "POST" });
      if (res.status === 409) { setNeedsProfile(true); return; }
      if (res.ok) setDraft((await res.json()).draft);
    } finally {
      setDraftLoading(false);
    }
  }
```

- [ ] **Step 2: Render the Draft email section** — insert this block right after the AI synthesis `Card` (before the Skills section):

```tsx
      <Card className="mt-5 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">✉ Cold-email draft</h2>
          <div className="flex gap-2">
            {draft && <Button className="bg-neutral-100 text-neutral-700 hover:bg-neutral-200" onClick={() => navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`).catch(() => {})}>Copy</Button>}
            <Button className="bg-neutral-100 text-neutral-700 hover:bg-neutral-200" onClick={() => generateDraft(!!draft)} disabled={draftLoading}>
              {draftLoading ? "Drafting…" : draft ? "Regenerate" : "Draft email"}
            </Button>
          </div>
        </div>
        {needsProfile ? (
          <p className="text-sm text-neutral-600">Set up your <Link href="/settings" className="text-blue-600 underline">sender profile</Link> first to draft emails.</p>
        ) : draftLoading && !draft ? (
          <div className="space-y-2"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-20 w-full" /></div>
        ) : draft ? (
          <div className="space-y-2">
            <input
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium"
            />
            <textarea
              value={draft.body} rows={8}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
        ) : (
          <p className="text-sm text-neutral-500">No draft yet — click “Draft email”.</p>
        )}
      </Card>
```
(`Link`, `Card`, `Button`, `Skeleton` are already imported in the file.)

- [ ] **Step 3: Build + manual**

Run: `npm run build`  (route `/people/[id]` still builds)
Manual (controller, live): with a saved sender profile, open a person → "Draft email" → an editable subject+body appears grounded in their dossier/offer; edit works; Copy copies; Regenerate refreshes. With NO profile saved, the section shows the "set up your sender profile" link.

- [ ] **Step 4: Commit**

```bash
git add "app/people/[id]/page.tsx"
git commit -m "feat: dossier cold-email draft section (editable + copy + regenerate)"
```

---

## Self-Review

**Spec coverage:**
- `SenderProfile` (incl. `socialProof`) + `EmailDraft` types → Task 1. ✓
- Grounded `draftEmail()` with cold-email best-practices prompt, degrade-to-empty → Task 1. ✓
- `settings` kv table + sender-profile round-trip; `people.draft` column → Task 2. ✓
- `getOrCreateDraft` (cache/force/no-empty) + detail returns `draft` → Task 3. ✓
- API: `GET/PUT /api/settings`; `POST /api/people/[id]/draft` with 409 needs_profile → Task 4. ✓
- `/settings` page (7 fields) + header link → Task 5. ✓
- Dossier draft section: explicit button, editable subject/body, copy, regenerate, needs-profile state, cached draft shown on load → Task 6. ✓
- One draft + Regenerate, no variants/sequences/sending → respected (non-goals). ✓
- Backend TDD'd; routes + UI build+manual → Tasks 1-3 vs 4-6. ✓

**Placeholder scan:** No TBD/TODO. UI verification is build+manual per the spec's testing decision; every code step has complete code.

**Type consistency:** `SenderProfile`/`EmailDraft` (Task 1) flow into repo (Task 2), `getOrCreateDraft`/`getPersonDetail` (Task 3), routes (Task 4), and both pages (Tasks 5-6) with identical field names (`senderName`, `socialProof`, `cta`, …; `subject`/`body`). `getOrCreateDraft`'s injectable `gen` defaults to `draftEmail` and is overridden in tests. The draft route's `needs_profile` 409 is handled by the dossier `setNeedsProfile` path (Task 6). `getPersonDetail` now returns `draft` and the dossier reads `data.draft`.
