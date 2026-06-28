# Rich Person Dossier (Phase 1 — Data Enrichment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each enriched person carry a rich, structured dossier (skills, experience, education, posts, web footprint) collected entirely through Orange Slice, persisted for the Phase 2 UI.

**Architecture:** Extend `EnrichedPerson` with structured dossier fields. `enrichPerson` gains three isolated sub-fetches — extended LinkedIn profile (reliable backbone), web-footprint dorks, and gated Apify posts — each degrading to empty on failure. The full dossier is persisted as a JSON column on `people` and written to `people.json`.

**Tech Stack:** TypeScript (ESM), Orange Slice SDK (via `src/orange`), better-sqlite3, Vitest.

## Global Constraints

- **All Orange Slice access goes through `src/orange`** (the single mock seam). No external scrapers (no crawl4ai); Apify is reached via `services.apify.runActor`.
- **ESM.** Non-test source uses extensionless imports (`from "../types"`); test files use `.js` (`from "./enrich.js"`). Vitest 4.1.9 → mocked fns via `vi.hoisted(() => vi.fn())`.
- **Graceful degradation:** every dossier sub-fetch is wrapped in try/catch and returns `[]`/`null`/`false` on failure. The extended-enrich backbone is the reliability floor; posts/mentions failing must never drop it or throw.
- **Verified SDK field names (do not guess):** `person.linkedin.enrich({ url, extended: true })` returns `B2BPersonExtended` with `skills: string[]|null`, `experience[]` (`title`, `company_name`, `company_domain`, `is_current`, `start_date`, `end_date`, `summary`), `education[]` (`school.name`, `degree`, `field_of_study.name`, `end_date_year`), `certifications[]` (`title`), `languages[]`, `is_influencer`, `jobs_count`, `recommender_count`, `twitter_handle`, `headline`. Source: `orangeslice-docs/.../enrich.md` + `node_modules/orangeslice/dist/expansion.d.ts`.
- **Capture-everything:** store the entire extended payload verbatim in `rawProfile`; nothing discarded.
- **Cost:** extended enrich ≈ 1 credit/person; web dorks cheap. **Apify is metered (min ~50 credits/run/actor)** → gated behind a `posts` flag, small `limit`, graceful `[]`.

---

### Task 1: Dossier types + extended-profile backbone

**Files:**
- Modify: `src/types.ts`
- Modify: `src/pipeline/enrich.ts`
- Modify: `src/pipeline/enrich.test.ts`
- Modify: `src/pipeline/run.test.ts` (mock literals must satisfy the new `EnrichedPerson`)
- Modify: `src/storage/repo.test.ts` (mock literal)

**Interfaces:**
- Consumes: `Person` (unchanged), `services.person.linkedin.enrich`, `services.person.contact.get`.
- Produces:
  - `Experience = { title: string; company: string; companyDomain: string | null; isCurrent: boolean; startDate: string | null; endDate: string | null; summary: string | null }`
  - `Education = { school: string; degree: string | null; field: string | null; endYear: number | null }`
  - `Post = { source: "linkedin" | "twitter"; text: string; url: string | null; postedAt: string | null; likes: number | null }`
  - `WebMention = { category: "talk" | "podcast" | "github" | "article" | "web"; title: string; url: string; snippet: string | null }`
  - `EnrichedPerson` now also has: `skills: string[]`, `experience: Experience[]`, `education: Education[]`, `certifications: string[]`, `languages: string[]`, `isInfluencer: boolean`, `jobsCount: number | null`, `recommenderCount: number | null`, `posts: Post[]`, `webMentions: WebMention[]`, `rawProfile: Record<string, unknown> | null`. The `signals` field is **removed** (replaced by `posts` + `webMentions`).
  - `enrichPerson(person, opts: { contacts: boolean; skipContact?: boolean; posts?: boolean })` — unchanged signature except the optional `posts` flag (wired in Task 4; ignored here). Returns the new `EnrichedPerson` with `posts: []`, `webMentions: []` for now.

- [ ] **Step 1: Write the failing test** — replace the body of `src/pipeline/enrich.test.ts` with:

```ts
import { test, expect, vi, beforeEach } from "vitest";

const { linkedinEnrich, contactGet, batchSearch } = vi.hoisted(() => ({
  linkedinEnrich: vi.fn(),
  contactGet: vi.fn(),
  batchSearch: vi.fn(),
}));
vi.mock("../orange.js", () => ({
  services: {
    person: { linkedin: { enrich: linkedinEnrich }, contact: { get: contactGet } },
    web: { batchSearch },
  },
}));

import { enrichPerson } from "./enrich.js";
import type { Person } from "../types.js";

const person: Person = { linkedinUrl: "https://linkedin.com/in/jane", companyDomain: "acme.com", name: "Jane Doe", title: "CTO" };

const extendedProfile = {
  headline: "CTO at Acme",
  twitter_handle: "janedoe",
  skills: ["TypeScript", "Distributed Systems"],
  is_influencer: true,
  jobs_count: 4,
  recommender_count: 7,
  experience: [
    { title: "CTO", company_name: "Acme", company_domain: "acme.com", is_current: true, start_date: "2021-01-01", end_date: null, summary: "Leads eng" },
  ],
  education: [
    { school: { name: "MIT" }, degree: "BS", field_of_study: { name: "EECS" }, end_date_year: 2014 },
  ],
  certifications: [{ title: "AWS SA" }],
  languages: [{ name: "English" }, "Spanish"],
};

beforeEach(() => {
  linkedinEnrich.mockReset();
  contactGet.mockReset();
  batchSearch.mockReset();
  linkedinEnrich.mockResolvedValue(extendedProfile);
  batchSearch.mockResolvedValue([]);
});

test("maps the extended profile backbone into the dossier", async () => {
  const out = await enrichPerson(person, { contacts: false });
  expect(out.headline).toBe("CTO at Acme");
  expect(out.twitter).toBe("janedoe");
  expect(out.skills).toEqual(["TypeScript", "Distributed Systems"]);
  expect(out.experience[0]).toMatchObject({ title: "CTO", company: "Acme", isCurrent: true });
  expect(out.education[0]).toMatchObject({ school: "MIT", degree: "BS", field: "EECS", endYear: 2014 });
  expect(out.certifications).toEqual(["AWS SA"]);
  expect(out.languages).toEqual(["English", "Spanish"]);
  expect(out.isInfluencer).toBe(true);
  expect(out.jobsCount).toBe(4);
  expect(out.rawProfile).not.toBeNull();
  expect(out.posts).toEqual([]);
  expect(out.webMentions).toEqual([]);
});

test("requests the extended profile", async () => {
  await enrichPerson(person, { contacts: false });
  expect(linkedinEnrich).toHaveBeenCalledWith(expect.objectContaining({ url: person.linkedinUrl, extended: true }));
});

test("degrades to an empty backbone when enrich throws, without throwing", async () => {
  linkedinEnrich.mockRejectedValue(new Error("enrich down"));
  const out = await enrichPerson(person, { contacts: false });
  expect(out.skills).toEqual([]);
  expect(out.experience).toEqual([]);
  expect(out.headline).toBeNull();
  expect(out.rawProfile).toBeNull();
});

test("fetches contact info when contacts=true and not skipped", async () => {
  contactGet.mockResolvedValue({ work_emails: ["jane@acme.com"], personal_emails: [], work_phones: ["+1555"], personal_phones: [], unknown_phones: [] });
  const out = await enrichPerson(person, { contacts: true });
  expect(out.workEmail).toBe("jane@acme.com");
  expect(out.phone).toBe("+1555");
});

test("skips contact lookup when skipContact=true", async () => {
  const out = await enrichPerson(person, { contacts: true, skipContact: true });
  expect(contactGet).not.toHaveBeenCalled();
  expect(out.workEmail).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/enrich.test.ts`
Expected: FAIL (type errors / `out.skills` undefined — new fields don't exist yet).

- [ ] **Step 3: Add the types** — in `src/types.ts`, replace the `Signal` interface and the `EnrichedPerson` interface with:

```ts
export interface Experience {
  title: string;
  company: string;
  companyDomain: string | null;
  isCurrent: boolean;
  startDate: string | null;
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
  postedAt: string | null;
  likes: number | null;
}

export interface WebMention {
  category: "talk" | "podcast" | "github" | "article" | "web";
  title: string;
  url: string;
  snippet: string | null;
}

export interface EnrichedPerson extends Person {
  headline: string | null;
  twitter: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  skills: string[];
  experience: Experience[];
  education: Education[];
  certifications: string[];
  languages: string[];
  isInfluencer: boolean;
  jobsCount: number | null;
  recommenderCount: number | null;
  posts: Post[];
  webMentions: WebMention[];
  rawProfile: Record<string, unknown> | null;
}
```

(Delete the old `Signal` interface — it is no longer used. If `grep -rn "Signal" src` shows other references after this task, they are updated in the tasks that own those files: `repo.ts`/`run.ts` in Task 3.)

- [ ] **Step 4: Rewrite `src/pipeline/enrich.ts`**

```ts
import { services } from "../orange";
import type { Education, EnrichedPerson, Experience, Person } from "../types";

export async function enrichPerson(
  person: Person,
  opts: { contacts: boolean; skipContact?: boolean; posts?: boolean },
): Promise<EnrichedPerson> {
  const wantContact = opts.contacts && !opts.skipContact;

  const [profile, contact] = await Promise.all([
    enrichProfile(person.linkedinUrl),
    wantContact ? getContact(person) : Promise.resolve(null),
  ]);

  return {
    ...person,
    headline: (profile?.headline as string) ?? null,
    twitter: (profile?.twitter_handle as string) ?? null,
    workEmail: contact?.work_emails?.[0] ?? null,
    personalEmail: contact?.personal_emails?.[0] ?? null,
    phone: contact?.work_phones?.[0] ?? contact?.personal_phones?.[0] ?? contact?.unknown_phones?.[0] ?? null,
    skills: Array.isArray(profile?.skills) ? (profile!.skills as string[]) : [],
    experience: mapExperience(profile),
    education: mapEducation(profile),
    certifications: ((profile?.certifications as any[]) ?? []).map((c) => c?.title).filter(Boolean),
    languages: ((profile?.languages as any[]) ?? [])
      .map((l) => (typeof l === "string" ? l : l?.name ?? l?.language ?? ""))
      .filter(Boolean),
    isInfluencer: Boolean(profile?.is_influencer),
    jobsCount: typeof profile?.jobs_count === "number" ? (profile!.jobs_count as number) : null,
    recommenderCount: typeof profile?.recommender_count === "number" ? (profile!.recommender_count as number) : null,
    posts: [],
    webMentions: [],
    rawProfile: profile ?? null,
  };
}

function mapExperience(profile: Record<string, any> | null): Experience[] {
  return ((profile?.experience as any[]) ?? []).map((e) => ({
    title: e?.title ?? "",
    company: e?.company_name ?? "",
    companyDomain: e?.company_domain ?? null,
    isCurrent: Boolean(e?.is_current),
    startDate: e?.start_date ?? null,
    endDate: e?.end_date ?? null,
    summary: e?.summary ?? null,
  }));
}

function mapEducation(profile: Record<string, any> | null): Education[] {
  return ((profile?.education as any[]) ?? []).map((ed) => ({
    school: ed?.school?.name ?? "",
    degree: ed?.degree ?? null,
    field: ed?.field_of_study?.name ?? null,
    endYear: typeof ed?.end_date_year === "number" ? ed.end_date_year : null,
  }));
}

async function enrichProfile(url: string): Promise<Record<string, any> | null> {
  try {
    return (await services.person.linkedin.enrich({ url, extended: true })) as Record<string, any>;
  } catch {
    return null;
  }
}

async function getContact(person: Person): Promise<any | null> {
  try {
    return await services.person.contact.get({ linkedinUrl: person.linkedinUrl, required: ["email", "phone"] });
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run the enrich tests to verify they pass**

Run: `npx vitest run src/pipeline/enrich.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Fix the broken `EnrichedPerson` literals in other tests**

In `src/pipeline/run.test.ts`, the `enrichPerson.mockResolvedValue(...)` / `.mockResolvedValueOnce(...)` literals construct `EnrichedPerson`. Replace each literal's tail `twitter: null, workEmail: null, personalEmail: null, phone: null, headline: null, signals: []` with:
```ts
headline: null, twitter: null, workEmail: null, personalEmail: null, phone: null,
skills: [], experience: [], education: [], certifications: [], languages: [],
isInfluencer: false, jobsCount: null, recommenderCount: null, posts: [], webMentions: [], rawProfile: null,
```
In `src/storage/repo.test.ts`, the `EnrichedPerson` literal (`const person: EnrichedPerson = {...}`) likewise: remove `signals: []` and add the same tail fields shown above (keep its existing `workEmail: "jane@x.com"`).

- [ ] **Step 7: Run the full suite to verify nothing else broke**

Run: `npm test`
Expected: PASS (run.ts will still reference `ep.signals` — that is fixed in Task 3; if `npm test` fails ONLY in `run.test.ts`/`run.ts` on `signals`, proceed — Task 3 fixes it. If it fails in `enrich`/`types`/`repo`, fix here.)

> Note: `run.ts` line `if (ep.signals.length) repo.addSignals(...)` will not type-check after `signals` is removed. To keep this task's build green, in `src/pipeline/run.ts` replace that single line `if (ep.signals.length) repo.addSignals(ep.linkedinUrl, ep.signals);` with `// signals persisted in Task 3` for now. Run `npm run build` and confirm clean.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/pipeline/enrich.ts src/pipeline/enrich.test.ts src/pipeline/run.ts src/pipeline/run.test.ts src/storage/repo.test.ts
git commit -m "feat: extended-profile dossier backbone (skills/experience/education)"
```

---

### Task 2: Web-footprint mentions

**Files:**
- Modify: `src/pipeline/enrich.ts`
- Modify: `src/pipeline/enrich.test.ts`

**Interfaces:**
- Consumes: `services.web.batchSearch`, `WebMention`, `Post` types.
- Produces: `enrichPerson` now populates `webMentions` from categorized dorks. Adds `gatherWebMentions(person): Promise<WebMention[]>` (internal).

- [ ] **Step 1: Write the failing test** — append to `src/pipeline/enrich.test.ts`:

```ts
test("gathers categorized web mentions from dork batches", async () => {
  batchSearch.mockResolvedValue([
    { results: [{ title: "Jane keynote at ConfX", link: "https://confx.com/jane", snippet: "talk" }] }, // talk
    { results: [{ title: "Jane on a podcast", link: "https://pod.fm/jane", snippet: "ep 12" }] },       // podcast
    { results: [{ title: "jane (GitHub)", link: "https://github.com/jane", snippet: "repos" }] },        // github
    { results: [{ title: "Jane blog", link: "https://blog.com/jane", snippet: "post" }] },               // article
  ]);
  const out = await enrichPerson(person, { contacts: false });
  const cats = out.webMentions.map((m) => m.category);
  expect(cats).toContain("talk");
  expect(cats).toContain("github");
  expect(out.webMentions.find((m) => m.category === "github")?.url).toBe("https://github.com/jane");
});

test("web mentions degrade to [] when batchSearch throws", async () => {
  batchSearch.mockRejectedValue(new Error("serp down"));
  const out = await enrichPerson(person, { contacts: false });
  expect(out.webMentions).toEqual([]);
  expect(out.skills).toEqual(["TypeScript", "Distributed Systems"]); // backbone still landed
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/enrich.test.ts`
Expected: FAIL (`out.webMentions` is `[]` — not yet populated).

- [ ] **Step 3: Implement `gatherWebMentions` and wire it in** — in `src/pipeline/enrich.ts`:

Add `WebMention` to the type import:
```ts
import type { Education, EnrichedPerson, Experience, Person, WebMention } from "../types";
```
Add the contact/profile fetch to also run mentions in parallel — change the `Promise.all` to:
```ts
  const [profile, contact, webMentions] = await Promise.all([
    enrichProfile(person.linkedinUrl),
    wantContact ? getContact(person) : Promise.resolve(null),
    gatherWebMentions(person),
  ]);
```
Set `webMentions` in the returned object (replace `webMentions: [],`):
```ts
    webMentions,
```
Add the function:
```ts
async function gatherWebMentions(person: Person): Promise<WebMention[]> {
  const name = `"${person.name}"`;
  const company = person.companyDomain.replace(/\.[a-z]+$/i, "");
  const specs: { category: WebMention["category"]; query: string }[] = [
    { category: "talk", query: `${name} ${company} (conference OR talk OR keynote)` },
    { category: "podcast", query: `${name} (podcast OR interview)` },
    { category: "github", query: `${name} site:github.com` },
    { category: "article", query: `${name} ${company} (blog OR article)` },
  ];
  try {
    const batches = await services.web.batchSearch({ queries: specs.map((s) => ({ query: s.query })) });
    const out: WebMention[] = [];
    batches.forEach((b: any, i: number) => {
      for (const r of (b?.results ?? []).slice(0, 3)) {
        if (!r?.link) continue;
        out.push({ category: specs[i].category, title: r.title ?? "", url: r.link, snippet: r.snippet ?? null });
      }
    });
    return out;
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run the enrich tests to verify they pass**

Run: `npx vitest run src/pipeline/enrich.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/enrich.ts src/pipeline/enrich.test.ts
git commit -m "feat: categorized web-footprint mentions (talks/podcasts/github/articles)"
```

---

### Task 3: Persist the dossier + populate the signals table

**Files:**
- Modify: `src/storage/db.ts`
- Modify: `src/storage/repo.ts`
- Modify: `src/storage/repo.test.ts`
- Modify: `src/pipeline/run.ts`

**Interfaces:**
- Consumes: `EnrichedPerson` (Task 1), `Post`/`WebMention`.
- Produces:
  - `people` table gains a `dossier TEXT` column (JSON of the full `EnrichedPerson`).
  - `Repo.upsertPerson` writes `dossier`. New `Repo.getDossier(linkedinUrl): EnrichedPerson | null`.
  - `run.ts` populates the `signals` table from `ep.posts` + `ep.webMentions`.

- [ ] **Step 1: Write the failing test** — append to `src/storage/repo.test.ts`:

```ts
test("upsertPerson stores the full dossier as JSON and getDossier round-trips it", () => {
  const url = "https://linkedin.com/in/jane";
  const person: EnrichedPerson = {
    linkedinUrl: url, companyDomain: "x.com", name: "Jane", title: "CTO",
    headline: "CTO", twitter: "jane", workEmail: null, personalEmail: null, phone: null,
    skills: ["Go", "K8s"], experience: [], education: [], certifications: [], languages: [],
    isInfluencer: false, jobsCount: 3, recommenderCount: null,
    posts: [{ source: "linkedin", text: "hello", url: "u", postedAt: null, likes: 5 }],
    webMentions: [], rawProfile: { foo: "bar" },
  };
  repo.upsertPerson(person);
  const back = repo.getDossier(url)!;
  expect(back.skills).toEqual(["Go", "K8s"]);
  expect(back.posts[0].text).toBe("hello");
  expect(back.rawProfile).toEqual({ foo: "bar" });
});
```

(Also update the existing repo `EnrichedPerson` literal from Task 1 Step 6 if not already carrying the new fields.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/repo.test.ts`
Expected: FAIL (`repo.getDossier` is not a function).

- [ ] **Step 3: Add the `dossier` column** — in `src/storage/db.ts`, add `dossier TEXT` to the `people` CREATE TABLE (after `last_enriched_at TEXT`), and make `openDb` idempotently add it for pre-existing DBs. After `db.exec(SCHEMA);` add:

```ts
  // Idempotent migration for DBs created before the dossier column existed.
  const cols = db.prepare("PRAGMA table_info(people)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "dossier")) {
    db.exec("ALTER TABLE people ADD COLUMN dossier TEXT");
  }
```
The `people` block becomes:
```
CREATE TABLE IF NOT EXISTS people (
  linkedin_url TEXT PRIMARY KEY,
  company_domain TEXT,
  name TEXT,
  title TEXT,
  twitter TEXT,
  work_email TEXT,
  personal_email TEXT,
  phone TEXT,
  last_enriched_at TEXT,
  dossier TEXT
);
```

- [ ] **Step 4: Write `dossier` in `upsertPerson` and add `getDossier`** — in `src/storage/repo.ts`:

Update the `EnrichedPerson` import (it already imports types). In `upsertPerson`, add `dossier` to the column list, the `VALUES`, the `ON CONFLICT` update, and the bound params:
```ts
  upsertPerson(p: EnrichedPerson): void {
    this.db
      .prepare(
        `INSERT INTO people (linkedin_url, company_domain, name, title, twitter, work_email, personal_email, phone, last_enriched_at, dossier)
         VALUES (@linkedinUrl, @companyDomain, @name, @title, @twitter, @workEmail, @personalEmail, @phone, @now, @dossier)
         ON CONFLICT(linkedin_url) DO UPDATE SET
           company_domain=excluded.company_domain, name=excluded.name, title=excluded.title,
           twitter=excluded.twitter, work_email=excluded.work_email,
           personal_email=excluded.personal_email, phone=excluded.phone,
           last_enriched_at=excluded.last_enriched_at, dossier=excluded.dossier`,
      )
      .run({
        linkedinUrl: p.linkedinUrl, companyDomain: p.companyDomain, name: p.name, title: p.title,
        twitter: p.twitter, workEmail: p.workEmail, personalEmail: p.personalEmail, phone: p.phone,
        dossier: JSON.stringify(p), now: new Date().toISOString(),
      });
  }

  getDossier(linkedinUrl: string): EnrichedPerson | null {
    const row = this.db.prepare("SELECT dossier FROM people WHERE linkedin_url = ?").get(linkedinUrl) as any;
    return row?.dossier ? (JSON.parse(row.dossier) as EnrichedPerson) : null;
  }
```

- [ ] **Step 5: Populate the signals table from posts + mentions** — in `src/pipeline/run.ts`, replace the placeholder line from Task 1 (`// signals persisted in Task 3`) with:

```ts
        const sigs = [
          ...ep.posts.map((p) => ({ source: p.source as "linkedin" | "twitter", content: p.text, url: p.url ?? "" })),
          ...ep.webMentions.map((m) => ({ source: "web" as const, content: m.snippet ?? m.title, url: m.url })),
        ];
        if (sigs.length) repo.addSignals(ep.linkedinUrl, sigs);
```

(`addSignals` already accepts `{ source, content, url }[]`; the `Signal` type was removed but `addSignals`'s param is structural — confirm its signature reads `signals: { source: "linkedin"|"twitter"|"web"; content: string; url: string }[]`; if it still imports the deleted `Signal` type, change the import to an inline type `{ source: "linkedin" | "twitter" | "web"; content: string; url: string }[]` in `repo.ts`.)

- [ ] **Step 6: Run the storage + run tests**

Run: `npx vitest run src/storage/repo.test.ts src/pipeline/run.test.ts`
Expected: PASS.

- [ ] **Step 7: Full suite + build**

Run: `npm test && npm run build`
Expected: all pass; build clean.

- [ ] **Step 8: Commit**

```bash
git add src/storage/db.ts src/storage/repo.ts src/storage/repo.test.ts src/pipeline/run.ts
git commit -m "feat: persist full dossier JSON column + populate signals from posts/mentions"
```

---

### Task 4: Apify posts (gated) + the `posts` flag

**Files:**
- Modify: `src/types.ts` (`RunParams` gains `posts`)
- Modify: `src/pipeline/enrich.ts`
- Modify: `src/pipeline/enrich.test.ts`
- Modify: `src/pipeline/run.ts` (pass `posts` through)
- Modify: `app/api/runs/route.ts` (accept `posts` in body)
- Modify: `scripts/run.ts` (`--posts` flag)

**Interfaces:**
- Consumes: `services.apify.runActor`, `Post` type.
- Produces: `enrichPerson` populates `posts` when `opts.posts === true`. `RunParams` gains `posts: boolean`. CLI `--posts`, API `body.posts`.

> **⚠️ Discovery required — do NOT guess the actor.** Orange Slice's apify doc mandates discovering the actor and validating its output shape. Steps 1–3 below are that discovery; record the chosen actor id + a real output sample in your report.

- [ ] **Step 1: Discover a LinkedIn-profile-posts actor** — run this throwaway script (`npx tsx` it from the repo root with `ORANGESLICE_API_KEY` set; delete after):

```ts
const res = await fetch("https://ow0o5i3qo7-dsn.algolia.net/1/indexes/prod_PUBLIC_STORE/query", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", "x-algolia-api-key": "0ecccd09f50396a4dbbe5dbfb17f4525", "x-algolia-application-id": "OW0O5I3QO7" },
  body: JSON.stringify({ query: "linkedin profile posts", hitsPerPage: 8, filters: "NOT currentPricingInfo.pricingModel:FLAT_PRICE_PER_MONTH", attributesToRetrieve: ["name", "username", "title", "stats", "currentPricingInfo"] }),
});
console.log((await res.json()).hits.map((h: any) => `${h.username}/${h.name} — ${h.title}`));
```
Pick a non-rental actor that scrapes a profile's recent posts by profile URL. Record its id (e.g. `someuser/linkedin-profile-posts`) — call it `LINKEDIN_POSTS_ACTOR`.

- [ ] **Step 2: Validate its output shape** — run `services.apify.runActor({ actor: LINKEDIN_POSTS_ACTOR, input: { /* the actor's documented input — usually a profileUrl/username */ }, datasetListParams: { limit: 5 } })` against one real profile (e.g. a known founder URL from a prior run). Note the actual item field names for text/url/date/likes. Record them in your report. (If no usable actor is found or it errors, STOP and report BLOCKED — do not fabricate a mapping.)

- [ ] **Step 3: Write the failing test** — append to `src/pipeline/enrich.test.ts` (mock the actor with the shape you observed in Step 2; the example below uses common field names — adjust to the real ones):

```ts
const apifyRun = vi.hoisted(() => vi.fn()) as any;
// extend the existing vi.mock factory: add apify to services. If the factory is already defined,
// MERGE this into it rather than declaring a second vi.mock for the same path.
```

Then add (and ensure the single `vi.mock("../orange.js", ...)` factory includes `apify: { runActor: apifyRun }` under `services`):

```ts
test("does not fetch posts when posts flag is off", async () => {
  const out = await enrichPerson(person, { contacts: false });
  expect(out.posts).toEqual([]);
});

test("fetches and maps linkedin posts when posts=true", async () => {
  apifyRun.mockResolvedValue({ items: [
    { text: "Shipping v2 today!", url: "https://linkedin.com/posts/1", postedAtISO: "2026-06-01T00:00:00Z", numLikes: 42 },
  ], usageTotalUsd: 0.01 });
  const out = await enrichPerson(person, { contacts: false, posts: true });
  expect(out.posts[0]).toMatchObject({ source: "linkedin", text: "Shipping v2 today!", likes: 42 });
});

test("posts degrade to [] when the actor throws", async () => {
  apifyRun.mockRejectedValue(new Error("apify rate limit"));
  const out = await enrichPerson(person, { contacts: false, posts: true });
  expect(out.posts).toEqual([]);
  expect(out.skills).toEqual(["TypeScript", "Distributed Systems"]); // backbone intact
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/pipeline/enrich.test.ts`
Expected: FAIL (`out.posts` empty when `posts:true`).

- [ ] **Step 5: Implement `gatherPosts` and wire it in** — in `src/pipeline/enrich.ts`. Use the actor id + field names from Steps 1–2; the mapping below is defensive across common variants (keep the fallbacks):

```ts
import type { Education, EnrichedPerson, Experience, Person, Post, WebMention } from "../types";

const LINKEDIN_POSTS_ACTOR = "REPLACE_WITH_DISCOVERED_ACTOR"; // from Task 4 Step 1

async function gatherPosts(person: Person): Promise<Post[]> {
  try {
    const { items } = await services.apify.runActor({
      actor: LINKEDIN_POSTS_ACTOR,
      input: { profileUrl: person.linkedinUrl, profileUrls: [person.linkedinUrl] },
      datasetListParams: { limit: 10 },
    });
    return (items ?? []).map((it: any): Post => ({
      source: "linkedin",
      text: it.text ?? it.postText ?? it.content ?? "",
      url: it.url ?? it.postUrl ?? it.link ?? null,
      postedAt: it.postedAtISO ?? it.postedAt ?? it.date ?? null,
      likes: it.numLikes ?? it.likes ?? it.reactionCount ?? null,
    })).filter((p: Post) => p.text);
  } catch {
    return [];
  }
}
```
Add it to the parallel block, conditioned on the flag:
```ts
  const [profile, contact, webMentions, posts] = await Promise.all([
    enrichProfile(person.linkedinUrl),
    wantContact ? getContact(person) : Promise.resolve(null),
    gatherWebMentions(person),
    opts.posts ? gatherPosts(person) : Promise.resolve([] as Post[]),
  ]);
```
And set `posts,` in the returned object (replace `posts: [],`).

- [ ] **Step 6: Thread the `posts` flag** —
  - `src/types.ts`: add `posts: boolean;` to `RunParams`.
  - `src/pipeline/run.ts`: in the `enrichPerson(p, {...})` call, add `posts: params.posts`.
  - `app/api/runs/route.ts`: in the `startRun({...})` body, add `posts: body.posts === true,`.
  - `scripts/run.ts`: in `parseArgs`, add `posts: argv.includes("--posts"),` to the returned object; update the usage string to include `[--posts]`.

- [ ] **Step 7: Run focused + full suite + build**

Run: `npx vitest run src/pipeline/enrich.test.ts && npm test && npm run build`
Expected: all pass; build clean.

- [ ] **Step 8: Commit**

```bash
git add src/types.ts src/pipeline/enrich.ts src/pipeline/enrich.test.ts src/pipeline/run.ts app/api/runs/route.ts scripts/run.ts
git commit -m "feat: gated Apify post collection (--posts) with defensive mapping"
```

---

### Task 5: Output columns + live dossier validation

**Files:**
- Modify: `src/output/export.ts`
- Modify: `src/output/export.test.ts`
- Modify: `src/e2e.test.ts`

**Interfaces:**
- Consumes: `EnrichedPerson` (full dossier).
- Produces: `people.csv` gains `skills`, `top_post`, `mentions_count`. The gated e2e asserts the backbone landed live.

- [ ] **Step 1: Write the failing test** — in `src/output/export.test.ts`, update the `peopleCsv` test's person literal to include the new fields, and assert the new columns:

```ts
test("peopleCsv includes dossier summary columns", () => {
  const people: EnrichedPerson[] = [
    { linkedinUrl: "https://linkedin.com/in/jane", companyDomain: "acme.com", name: "Jane", title: "CTO",
      headline: "CTO", twitter: "janedoe", workEmail: "jane@acme.com", personalEmail: null, phone: null,
      skills: ["Go", "K8s"], experience: [], education: [], certifications: [], languages: [],
      isInfluencer: false, jobsCount: null, recommenderCount: null,
      posts: [{ source: "linkedin", text: "Shipping v2", url: "u", postedAt: null, likes: 1 }],
      webMentions: [{ category: "github", title: "gh", url: "https://github.com/jane", snippet: null }],
      rawProfile: null },
  ];
  const csv = peopleCsv(people);
  expect(csv.split("\n")[0]).toBe("name,title,company,linkedin,twitter,work_email,personal_email,phone,skills,top_post,mentions_count");
  expect(csv).toContain("Go; K8s");
  expect(csv).toContain("Shipping v2");
  expect(csv).toContain(",1"); // mentions_count
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/output/export.test.ts`
Expected: FAIL (header mismatch / new columns absent).

- [ ] **Step 3: Update `peopleCsv`** — in `src/output/export.ts`, replace the `peopleCsv` header + rows:

```ts
export function peopleCsv(people: EnrichedPerson[]): string {
  return toCsv(
    ["name", "title", "company", "linkedin", "twitter", "work_email", "personal_email", "phone", "skills", "top_post", "mentions_count"],
    people.map((p) => [
      p.name, p.title, p.companyDomain, p.linkedinUrl, p.twitter, p.workEmail, p.personalEmail, p.phone,
      p.skills.join("; "),
      p.posts[0]?.text ?? "",
      p.webMentions.length,
    ]),
  );
}
```

- [ ] **Step 4: Run export tests**

Run: `npx vitest run src/output/export.test.ts`
Expected: PASS.

- [ ] **Step 5: Strengthen the gated e2e** — in `src/e2e.test.ts`, after the existing assertions, add (still inside the `runIf(runE2E)` test, which already builds `runs/e2e`):

```ts
  // Inspect the persisted dossier of the first kept person.
  const { Repo } = await import("./storage/repo.js");
  const { openDb } = await import("./storage/db.js");
  const repo2 = new Repo(openDb(process.env.PROSPECT_DB_PATH ?? "./prospect.db"));
  // (the e2e run above used an in-memory db; for a real check, read people.json instead)
  const fs = await import("node:fs/promises");
  const peopleJson = JSON.parse(await fs.readFile("runs/e2e/people.json", "utf8"));
  const withSkills = peopleJson.filter((p: any) => (p.skills?.length ?? 0) > 0).length;
  console.log(`[e2e] people=${peopleJson.length} withSkills=${withSkills} ` +
    `withExperience=${peopleJson.filter((p: any) => (p.experience?.length ?? 0) > 0).length} ` +
    `withMentions=${peopleJson.filter((p: any) => (p.webMentions?.length ?? 0) > 0).length} ` +
    `withPosts=${peopleJson.filter((p: any) => (p.posts?.length ?? 0) > 0).length}`);
  expect(withSkills).toBeGreaterThan(0); // the reliable backbone must land live
```

(Remove the unused `repo2`/`openDb` import lines if your e2e reads `people.json` directly — keep the file read + the `withSkills` assertion + the coverage log. The log is how we *see* the Apify/mention reality instead of trusting mocks.)

- [ ] **Step 6: Run unit suite (e2e auto-skips) + build**

Run: `npm test && npm run build`
Expected: all pass; e2e skipped; build clean.

- [ ] **Step 7: (Manual, spends credits) Live validation**

Run: `PROSPECT_E2E=1 npx vitest run src/e2e.test.ts`
Expected: completes; logs `withSkills>0`. Eyeball `runs/e2e/people.json` for a populated dossier. To validate posts too: temporarily set the e2e's run params `posts: true` (and expect Apify credits to be spent). **Do not run in CI.**

- [ ] **Step 8: Commit**

```bash
git add src/output/export.ts src/output/export.test.ts src/e2e.test.ts
git commit -m "feat: dossier summary CSV columns + live backbone validation in e2e"
```

---

## Self-Review

**Spec coverage:**
- Professional backbone (skills/experience/education/certs/languages/influencer/jobs/recommender) → Task 1. ✓
- Recent posts via Apify (gated) → Task 4. ✓
- Web footprint dorks (talk/podcast/github/article) → Task 2. ✓
- `rawProfile` capture-everything → Task 1. ✓
- Data model (`Experience`/`Education`/`Post`/`WebMention`, extended `EnrichedPerson`, `signals` field removed) → Task 1. ✓
- Storage `dossier` JSON column + additive migration + persistence → Task 3. ✓
- `signals` table retained, populated from posts+mentions → Task 3. ✓
- Output: `people.json` (automatic via full serialization) + CSV summary columns → Task 5. ✓
- Graceful degradation everywhere → tested in Tasks 1, 2, 4. ✓
- Live validation (see Apify/mention reality, not mocks) → Task 5 e2e. ✓
- `posts` gating flag (cheap dry runs) → Task 4 (refinement noted in plan intro). ✓

**Placeholder scan:** The only literal placeholder is `LINKEDIN_POSTS_ACTOR = "REPLACE_WITH_DISCOVERED_ACTOR"` — this is *intentional and procedural*: Task 4 Steps 1–2 are the concrete discovery (with runnable code) that produces the value, and the apify doc forbids guessing it. Not a vague TODO. No other placeholders.

**Type consistency:** `EnrichedPerson` fields defined in Task 1 are used identically in Tasks 3/5 (`skills`, `experience`, `posts`, `webMentions`, `rawProfile`, `jobsCount`). `Post`/`WebMention` shapes match between producer (enrich, Tasks 2/4) and consumers (repo Task 3, export Task 5). `RunParams.posts` (Task 4) flows enrich opts → run → API → CLI consistently. `addSignals` param shape matches the `{source,content,url}` objects built in Task 3.
