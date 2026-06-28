# Dossier UI + AI Hooks (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web UI to browse collected prospects and understand each one fast — each person's page leads with an AI-generated summary + cold-email hooks (via Orange Slice), over a scannable dossier.

**Architecture:** Backend adds an on-demand, cached AI synthesis (`synthesize()` → stored in a new `people.synthesis` column) and thin server helpers/API routes over the existing `Repo`. The UI (Next.js App Router client components, Tailwind v4) consumes those routes: a people-list page and a person-dossier page.

**Tech Stack:** TypeScript (ESM), Orange Slice SDK (via `src/orange`), better-sqlite3, Vitest, Next.js 16 App Router, Tailwind v4.

## Global Constraints

- **All Orange Slice access through `src/orange`** (single mock seam). The AI synthesis uses `services.ai.generateObject` — NOT OpenAI (no OpenAI key).
- **ESM.** Non-test TS source uses extensionless imports (`from "../types"`); test files use `.js`. Vitest 4.1.9 → mocked fns via `vi.hoisted`.
- **Graceful degradation:** `synthesize()` returns `{ summary: "", interests: [], hooks: [] }` on failure (raw dossier still renders).
- **On-demand + cache:** synthesis is generated when first requested and cached in `people.synthesis`; a cache hit must NOT re-call the model.
- **Person id:** base64url-encoded `linkedinUrl` (URL-safe, single route segment). Encode in `src/ids.ts`; decode in routes. The client treats the id as opaque.
- **UI scope (per spec):** backend + server helpers are TDD'd; Next route files and React pages are verified by `npm run build` + a manual pass (no React test runner is set up). Use **Tailwind v4 + lightweight local components** (shadcn-style), not the shadcn CLI.
- **API routes:** `runtime = "nodejs"`, `dynamic = "force-dynamic"`; `[id]` params are awaited (`params: Promise<{ id: string }>`), mirroring the existing `app/api/runs/[id]/route.ts`.

---

### Task 1: Synthesis types + `synthesize()`

**Files:**
- Modify: `src/types.ts`
- Create: `src/pipeline/synthesize.ts`
- Test: `src/pipeline/synthesize.test.ts`

**Interfaces:**
- Consumes: `services.ai.generateObject` (mocked), `EnrichedPerson`.
- Produces:
  - `Hook = { angle: string; why: string }`
  - `Synthesis = { summary: string; interests: string[]; hooks: Hook[] }`
  - `synthesize(person: EnrichedPerson): Promise<Synthesis>`

- [ ] **Step 1: Write the failing test**

`src/pipeline/synthesize.test.ts`:
```ts
import { test, expect, vi, beforeEach } from "vitest";

const { generateObject } = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("../orange.js", () => ({ services: { ai: { generateObject } } }));

import { synthesize } from "./synthesize.js";
import type { EnrichedPerson } from "../types.js";

const person: EnrichedPerson = {
  linkedinUrl: "https://linkedin.com/in/jane", companyDomain: "acme.com", name: "Jane Doe", title: "CTO",
  headline: "CTO at Acme", twitter: "janedoe", workEmail: null, personalEmail: null, phone: null,
  skills: ["Go", "Kubernetes"], experience: [], education: [], certifications: [], languages: [],
  isInfluencer: true, jobsCount: 4, recommenderCount: 2,
  posts: [{ source: "linkedin", text: "Shipping our new infra", url: "u", postedAt: null, likes: 9 }],
  webMentions: [], rawProfile: null,
};

beforeEach(() => generateObject.mockReset());

test("maps the model output into a Synthesis", async () => {
  generateObject.mockResolvedValue({ object: {
    summary: "Jane is a CTO focused on infra.",
    interests: ["infrastructure", "developer experience"],
    hooks: [{ angle: "Mention her infra post", why: "she posted about shipping new infra" }],
  } });
  const out = await synthesize(person);
  expect(out.summary).toContain("CTO");
  expect(out.interests).toContain("infrastructure");
  expect(out.hooks[0]).toMatchObject({ angle: expect.any(String), why: expect.any(String) });
});

test("includes dossier facts in the prompt (skills + post text)", async () => {
  generateObject.mockResolvedValue({ object: { summary: "", interests: [], hooks: [] } });
  await synthesize(person);
  const prompt = generateObject.mock.calls[0][0].prompt as string;
  expect(prompt).toContain("Kubernetes");
  expect(prompt).toContain("Shipping our new infra");
});

test("degrades to an empty synthesis on failure", async () => {
  generateObject.mockRejectedValue(new Error("ai down"));
  const out = await synthesize(person);
  expect(out).toEqual({ summary: "", interests: [], hooks: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/synthesize.test.ts`
Expected: FAIL ("Cannot find module './synthesize.js'").

- [ ] **Step 3: Add the types** — append to `src/types.ts`:

```ts
export interface Hook {
  angle: string;
  why: string;
}

export interface Synthesis {
  summary: string;
  interests: string[];
  hooks: Hook[];
}
```

- [ ] **Step 4: Implement `src/pipeline/synthesize.ts`**

```ts
import { services } from "../orange";
import type { EnrichedPerson, Synthesis } from "../types";

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-3 sentences on who this person is, professionally." },
    interests: { type: "array", items: { type: "string" }, description: "Their professional interest themes." },
    hooks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          angle: { type: "string", description: "A concrete cold-email opener." },
          why: { type: "string", description: "The specific dossier fact that grounds this angle." },
        },
        required: ["angle", "why"],
      },
      description: "2-3 cold-email hooks, each grounded in a real fact below.",
    },
  },
  required: ["summary", "interests", "hooks"],
};

export async function synthesize(person: EnrichedPerson): Promise<Synthesis> {
  const facts = [
    `Name: ${person.name}`,
    `Title: ${person.title ?? "(unknown)"} at ${person.companyDomain}`,
    person.headline ? `Headline: ${person.headline}` : "",
    person.skills.length ? `Skills: ${person.skills.join(", ")}` : "",
    person.experience.length
      ? `Experience: ${person.experience.slice(0, 4).map((e) => `${e.title} @ ${e.company}`).join("; ")}`
      : "",
    person.education.length ? `Education: ${person.education.map((e) => e.school).join(", ")}` : "",
    person.posts.length ? `Recent posts: ${person.posts.slice(0, 5).map((p) => `"${p.text}"`).join(" | ")}` : "",
    person.webMentions.length
      ? `Web footprint: ${person.webMentions.slice(0, 5).map((m) => `${m.category}: ${m.title}`).join("; ")}`
      : "",
  ].filter(Boolean).join("\n");

  try {
    const { object } = await services.ai.generateObject({
      prompt:
        `You help write personalized B2B cold-email openers. Based ONLY on the facts below, ` +
        `write a short professional summary, the person's interest themes, and 2-3 specific cold-email ` +
        `hooks. Each hook's "why" MUST cite a specific fact below. Do NOT fabricate anything.\n\n${facts}`,
      schema: SCHEMA,
      intelligence: "medium",
    });
    return {
      summary: typeof object.summary === "string" ? object.summary : "",
      interests: Array.isArray(object.interests) ? object.interests : [],
      hooks: Array.isArray(object.hooks)
        ? object.hooks
            .map((h: any) => ({ angle: String(h?.angle ?? ""), why: String(h?.why ?? "") }))
            .filter((h: any) => h.angle)
        : [],
    };
  } catch {
    return { summary: "", interests: [], hooks: [] };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/pipeline/synthesize.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/pipeline/synthesize.ts src/pipeline/synthesize.test.ts
git commit -m "feat: AI synthesis (summary + interests + grounded cold-email hooks)"
```

---

### Task 2: `synthesis` column + id util + repo methods

**Files:**
- Modify: `src/storage/db.ts`
- Create: `src/ids.ts`
- Test: `src/ids.test.ts`
- Modify: `src/types.ts`
- Modify: `src/storage/repo.ts`
- Modify: `src/storage/repo.test.ts`

**Interfaces:**
- Consumes: `EnrichedPerson`, `Synthesis` (Task 1), `Db`.
- Produces:
  - `src/ids.ts`: `encodeId(linkedinUrl: string): string`, `decodeId(id: string): string` (base64url round-trip).
  - `PersonCard = { id: string; linkedinUrl: string; name: string; title: string | null; companyDomain: string; twitter: string | null; skills: string[]; isInfluencer: boolean; hasSynthesis: boolean }` (in `src/types.ts`).
  - `people.synthesis TEXT` column.
  - `Repo.listPeople(limit?): PersonCard[]`, `Repo.getSynthesis(linkedinUrl): Synthesis | null`, `Repo.setSynthesis(linkedinUrl, s: Synthesis): void`.

- [ ] **Step 1: Write the failing tests**

`src/ids.test.ts`:
```ts
import { test, expect } from "vitest";
import { encodeId, decodeId } from "./ids.js";

test("encodeId/decodeId round-trips a linkedin url and is url-safe", () => {
  const url = "https://www.linkedin.com/in/jane-doe";
  const id = encodeId(url);
  expect(id).not.toMatch(/[/+=]/); // url-safe, no slashes/plus/padding
  expect(decodeId(id)).toBe(url);
});
```

Append to `src/storage/repo.test.ts`:
```ts
test("listPeople returns cards with parsed skills, influencer flag, and synthesis presence", () => {
  const base = {
    linkedinUrl: "https://linkedin.com/in/jane", companyDomain: "acme.com", name: "Jane", title: "CTO",
    headline: "CTO", twitter: "jane", workEmail: null, personalEmail: null, phone: null,
    experience: [], education: [], certifications: [], languages: [], jobsCount: null, recommenderCount: null,
    posts: [], webMentions: [], rawProfile: null,
  };
  repo.upsertPerson({ ...base, skills: ["Go", "K8s"], isInfluencer: true } as any);
  const cards = repo.listPeople();
  expect(cards).toHaveLength(1);
  expect(cards[0]).toMatchObject({ name: "Jane", skills: ["Go", "K8s"], isInfluencer: true, hasSynthesis: false });
  expect(cards[0].id).toBeTruthy();
});

test("getSynthesis/setSynthesis round-trip and flip hasSynthesis", () => {
  const url = "https://linkedin.com/in/jane";
  repo.upsertPerson({
    linkedinUrl: url, companyDomain: "acme.com", name: "Jane", title: "CTO", headline: null, twitter: null,
    workEmail: null, personalEmail: null, phone: null, skills: [], experience: [], education: [],
    certifications: [], languages: [], isInfluencer: false, jobsCount: null, recommenderCount: null,
    posts: [], webMentions: [], rawProfile: null,
  } as any);
  expect(repo.getSynthesis(url)).toBeNull();
  repo.setSynthesis(url, { summary: "s", interests: ["a"], hooks: [{ angle: "x", why: "y" }] });
  expect(repo.getSynthesis(url)!.hooks[0].angle).toBe("x");
  expect(repo.listPeople()[0].hasSynthesis).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/ids.test.ts src/storage/repo.test.ts`
Expected: FAIL (`./ids.js` missing; `repo.listPeople`/`getSynthesis` not functions).

- [ ] **Step 3: Create `src/ids.ts`**

```ts
// Server-only (uses Buffer). Never import from client components.
export function encodeId(linkedinUrl: string): string {
  return Buffer.from(linkedinUrl, "utf8").toString("base64url");
}

export function decodeId(id: string): string {
  return Buffer.from(id, "base64url").toString("utf8");
}
```

- [ ] **Step 4: Add `PersonCard` to `src/types.ts`**

```ts
export interface PersonCard {
  id: string;
  linkedinUrl: string;
  name: string;
  title: string | null;
  companyDomain: string;
  twitter: string | null;
  skills: string[];
  isInfluencer: boolean;
  hasSynthesis: boolean;
}
```

- [ ] **Step 5: Add the `synthesis` column** — in `src/storage/db.ts`, add `synthesis TEXT` to the `people` CREATE TABLE (after `dossier TEXT`) and extend the idempotent migration. Replace the dossier migration block with one that covers both columns:

```ts
  const cols = db.prepare("PRAGMA table_info(people)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "dossier")) db.exec("ALTER TABLE people ADD COLUMN dossier TEXT");
  if (!cols.some((c) => c.name === "synthesis")) db.exec("ALTER TABLE people ADD COLUMN synthesis TEXT");
```
And add `synthesis TEXT` to the `CREATE TABLE IF NOT EXISTS people (...)` schema string (line after `dossier TEXT`).

- [ ] **Step 6: Add repo methods** — in `src/storage/repo.ts`, add `import { encodeId } from "../ids";` and `import type { PersonCard, Synthesis } from "../types";` (merge into existing type import), then:

```ts
  listPeople(limit = 200): PersonCard[] {
    const rows = this.db
      .prepare("SELECT linkedin_url, name, title, company_domain, twitter, dossier, synthesis FROM people ORDER BY rowid DESC LIMIT ?")
      .all(limit) as any[];
    return rows.map((r) => {
      let skills: string[] = [];
      let isInfluencer = false;
      if (r.dossier) {
        try {
          const d = JSON.parse(r.dossier);
          skills = Array.isArray(d.skills) ? d.skills : [];
          isInfluencer = Boolean(d.isInfluencer);
        } catch { /* ignore malformed dossier */ }
      }
      return {
        id: encodeId(r.linkedin_url),
        linkedinUrl: r.linkedin_url,
        name: r.name ?? "",
        title: r.title ?? null,
        companyDomain: r.company_domain ?? "",
        twitter: r.twitter ?? null,
        skills,
        isInfluencer,
        hasSynthesis: r.synthesis != null,
      };
    });
  }

  getSynthesis(linkedinUrl: string): Synthesis | null {
    const row = this.db.prepare("SELECT synthesis FROM people WHERE linkedin_url = ?").get(linkedinUrl) as any;
    return row?.synthesis ? (JSON.parse(row.synthesis) as Synthesis) : null;
  }

  setSynthesis(linkedinUrl: string, s: Synthesis): void {
    this.db.prepare("UPDATE people SET synthesis = ? WHERE linkedin_url = ?").run(JSON.stringify(s), linkedinUrl);
  }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/ids.test.ts src/storage/repo.test.ts`
Expected: PASS.

- [ ] **Step 8: Full suite + build, then commit**

Run: `npm test && npm run build`
Expected: all pass; build clean.
```bash
git add src/ids.ts src/ids.test.ts src/types.ts src/storage/db.ts src/storage/repo.ts src/storage/repo.test.ts
git commit -m "feat: synthesis column + person-card listing + synthesis cache"
```

---

### Task 3: Server helpers (`src/server/people.ts`)

**Files:**
- Create: `src/server/people.ts`
- Test: `src/server/people.test.ts`

**Interfaces:**
- Consumes: `Repo`, `synthesize` (Task 1), `decodeId`, `EnrichedPerson`/`Synthesis`/`PersonCard`.
- Produces:
  - `listPeopleCards(repo: Repo): PersonCard[]`
  - `getPersonDetail(repo: Repo, id: string): { dossier: EnrichedPerson; synthesis: Synthesis | null } | null`
  - `getOrCreateSynthesis(repo: Repo, id: string, gen?: (p: EnrichedPerson) => Promise<Synthesis>): Promise<Synthesis | null>` — returns cached synthesis if present (does NOT call `gen`); else loads the dossier, generates, caches, returns. Null if no dossier for the id. `gen` defaults to `synthesize`.

- [ ] **Step 1: Write the failing test**

`src/server/people.test.ts`:
```ts
import { test, expect, vi, beforeEach } from "vitest";
import { openDb } from "../storage/db.js";
import { Repo } from "../storage/repo.js";
import { listPeopleCards, getPersonDetail, getOrCreateSynthesis } from "./people.js";
import { encodeId } from "../ids.js";
import type { EnrichedPerson } from "../types.js";

let repo: Repo;
const url = "https://linkedin.com/in/jane";
const person = {
  linkedinUrl: url, companyDomain: "acme.com", name: "Jane", title: "CTO", headline: null, twitter: null,
  workEmail: null, personalEmail: null, phone: null, skills: ["Go"], experience: [], education: [],
  certifications: [], languages: [], isInfluencer: false, jobsCount: null, recommenderCount: null,
  posts: [], webMentions: [], rawProfile: null,
} as EnrichedPerson;

beforeEach(() => {
  repo = new Repo(openDb(":memory:"));
  repo.upsertPerson(person);
});

test("getPersonDetail returns dossier + null synthesis for a known id", () => {
  const detail = getPersonDetail(repo, encodeId(url))!;
  expect(detail.dossier.name).toBe("Jane");
  expect(detail.synthesis).toBeNull();
});

test("getPersonDetail returns null for an unknown id", () => {
  expect(getPersonDetail(repo, encodeId("https://linkedin.com/in/nobody"))).toBeNull();
});

test("getOrCreateSynthesis generates+caches on miss, returns cache on hit (no second gen)", async () => {
  const gen = vi.fn().mockResolvedValue({ summary: "s", interests: [], hooks: [] });
  const first = await getOrCreateSynthesis(repo, encodeId(url), gen);
  expect(first!.summary).toBe("s");
  expect(gen).toHaveBeenCalledTimes(1);
  const second = await getOrCreateSynthesis(repo, encodeId(url), gen);
  expect(second!.summary).toBe("s");
  expect(gen).toHaveBeenCalledTimes(1); // cache hit — not regenerated
});

test("getOrCreateSynthesis returns null for unknown id", async () => {
  const gen = vi.fn();
  expect(await getOrCreateSynthesis(repo, encodeId("https://x/none"), gen)).toBeNull();
  expect(gen).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/people.test.ts`
Expected: FAIL ("Cannot find module './people.js'").

- [ ] **Step 3: Implement `src/server/people.ts`**

```ts
import { decodeId } from "../ids";
import { synthesize } from "../pipeline/synthesize";
import type { Repo } from "../storage/repo";
import type { EnrichedPerson, PersonCard, Synthesis } from "../types";

export function listPeopleCards(repo: Repo): PersonCard[] {
  return repo.listPeople();
}

export function getPersonDetail(
  repo: Repo,
  id: string,
): { dossier: EnrichedPerson; synthesis: Synthesis | null } | null {
  const dossier = repo.getDossier(decodeId(id));
  if (!dossier) return null;
  return { dossier, synthesis: repo.getSynthesis(decodeId(id)) };
}

export async function getOrCreateSynthesis(
  repo: Repo,
  id: string,
  gen: (p: EnrichedPerson) => Promise<Synthesis> = synthesize,
): Promise<Synthesis | null> {
  const url = decodeId(id);
  const cached = repo.getSynthesis(url);
  if (cached) return cached;
  const dossier = repo.getDossier(url);
  if (!dossier) return null;
  const s = await gen(dossier);
  repo.setSynthesis(url, s);
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/people.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/people.ts src/server/people.test.ts
git commit -m "feat: server helpers for people list/detail and cached synthesis"
```

---

### Task 4: API routes

**Files:**
- Create: `app/api/people/route.ts`
- Create: `app/api/people/[id]/route.ts`
- Create: `app/api/people/[id]/synthesize/route.ts`

**Interfaces:**
- Consumes: `getRepo` (from `src/server/jobs`), `listPeopleCards`/`getPersonDetail`/`getOrCreateSynthesis` (Task 3).
- Produces: `GET /api/people` → `{ people }`; `GET /api/people/:id` → `{ dossier, synthesis }` or 404; `POST /api/people/:id/synthesize` → `{ synthesis }` or 404.
- Verified by `npm run build` + manual (no unit tests — thin wrappers over Task 3 helpers, which are tested).

- [ ] **Step 1: Create `app/api/people/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getRepo } from "../../../src/server/jobs";
import { listPeopleCards } from "../../../src/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ people: listPeopleCards(getRepo()) });
}
```

- [ ] **Step 2: Create `app/api/people/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getRepo } from "../../../../src/server/jobs";
import { getPersonDetail } from "../../../../src/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getPersonDetail(getRepo(), id);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}
```

- [ ] **Step 3: Create `app/api/people/[id]/synthesize/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getRepo } from "../../../../../src/server/jobs";
import { getOrCreateSynthesis } from "../../../../../src/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const synthesis = await getOrCreateSynthesis(getRepo(), id);
  if (!synthesis) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ synthesis });
}
```

- [ ] **Step 4: Build + smoke test the routes**

Run: `npm run build`
Expected: build succeeds; routes `ƒ /api/people`, `ƒ /api/people/[id]`, `ƒ /api/people/[id]/synthesize` appear.

Manual smoke (optional, needs data + key): `npm start`, then `curl localhost:3000/api/people` → `{"people":[...]}`.

- [ ] **Step 5: Commit**

```bash
git add app/api/people
git commit -m "feat: /api/people list, detail, and synthesize routes"
```

---

### Task 5: Tailwind setup + UI primitives + people-list page

**Files:**
- Modify: `package.json` (tailwind deps)
- Create: `postcss.config.mjs`
- Create: `app/globals.css`
- Modify: `app/layout.tsx` (import globals)
- Create: `src/ui/primitives.tsx` (Card, Badge, Button, Skeleton, `cn`)
- Modify: `app/page.tsx` (people-list page)

**Interfaces:**
- Consumes: `GET /api/people`, `POST /api/runs`, `GET /api/runs/:id`, `PersonCard` (type only).
- Produces: a working `/` page. Verified by `npm run build` + manual.

- [ ] **Step 1: Install Tailwind v4**

Run: `npm install -D tailwindcss @tailwindcss/postcss postcss`

- [ ] **Step 2: Create `postcss.config.mjs`**

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

- [ ] **Step 3: Create `app/globals.css`**

```css
@import "tailwindcss";

:root { color-scheme: light dark; }
body { @apply bg-neutral-50 text-neutral-900 antialiased; }
```

- [ ] **Step 4: Import globals in `app/layout.tsx`** — add as the first line of the file:

```tsx
import "./globals.css";
```
(Keep the existing `metadata` export and `RootLayout` component.)

- [ ] **Step 5: Create `src/ui/primitives.tsx`**

```tsx
import * as React from "react";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-neutral-200 bg-white shadow-sm", className)} {...props} />;
}

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700", className)}
      {...props}
    />
  );
}

export function Button({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white",
        "hover:bg-neutral-700 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-neutral-200", className)} />;
}
```

- [ ] **Step 6: Write the people-list page** — replace `app/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { PersonCard } from "../src/types";
import { Card, Badge, Button, Skeleton } from "../src/ui/primitives";

export default function Home() {
  const [people, setPeople] = useState<PersonCard[] | null>(null);
  const [prompt, setPrompt] = useState("");
  const [runStatus, setRunStatus] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/people");
    const data = await res.json();
    setPeople(data.people);
  }
  useEffect(() => { load(); }, []);

  async function startRun() {
    if (!prompt.trim()) return;
    setRunStatus("starting…");
    const res = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const { jobId } = await res.json();
    const poll = setInterval(async () => {
      const j = await (await fetch(`/api/runs/${jobId}`)).json();
      setRunStatus(`${j.status} — ${j.progress?.stage ?? ""} (${j.progress?.people ?? 0} people)`);
      if (j.status === "completed" || j.status === "failed") {
        clearInterval(poll);
        load();
      }
    }, 2000);
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Prospect</h1>
      <p className="mb-6 text-sm text-neutral-500">Browse collected prospects and their cold-email hooks.</p>

      <div className="mb-6 flex gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder='e.g. "Series A dev tool companies"'
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <Button onClick={startRun}>Run</Button>
      </div>
      {runStatus && <p className="mb-4 text-sm text-neutral-600">{runStatus}</p>}

      {people === null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : people.length === 0 ? (
        <p className="text-sm text-neutral-500">No people yet. Run a prompt above.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {people.map((p) => (
            <Link key={p.id} href={`/people/${p.id}`}>
              <Card className="h-full p-4 transition hover:shadow-md">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{p.name}</div>
                  {p.isInfluencer && <Badge className="bg-amber-100 text-amber-800">Top Voice</Badge>}
                </div>
                <div className="text-sm text-neutral-600">{p.title}</div>
                <div className="text-xs text-neutral-400">@{p.companyDomain}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.skills.slice(0, 5).map((s) => <Badge key={s}>{s}</Badge>)}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 7: Build + manual check**

Run: `npm run build`
Expected: build succeeds (route `○ /` or `ƒ /`).
Manual: `npm run dev`, open http://localhost:3000 — the page renders; if the DB has people they show as cards; the prompt box triggers a run and the status line updates.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json postcss.config.mjs app/globals.css app/layout.tsx src/ui/primitives.tsx app/page.tsx
git commit -m "feat: tailwind setup + people-list page with run trigger"
```

---

### Task 6: Dossier page (AI hooks + scannable sections)

**Files:**
- Create: `app/people/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/people/:id`, `POST /api/people/:id/synthesize`, `EnrichedPerson`/`Synthesis` (types), `primitives`.
- Produces: the `/people/[id]` dossier page. Verified by `npm run build` + manual.

- [ ] **Step 1: Write the dossier page** — `app/people/[id]/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { EnrichedPerson, Synthesis } from "../../../src/types";
import { Card, Badge, Button, Skeleton } from "../../../src/ui/primitives";

export default function DossierPage() {
  const { id } = useParams<{ id: string }>();
  const [dossier, setDossier] = useState<EnrichedPerson | null>(null);
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);
  const [synthLoading, setSynthLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  async function generate() {
    setSynthLoading(true);
    try {
      const res = await fetch(`/api/people/${id}/synthesize`, { method: "POST" });
      if (res.ok) setSynthesis((await res.json()).synthesis);
    } finally {
      setSynthLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/people/${id}`);
      if (!res.ok) { setNotFound(true); return; }
      const data = await res.json();
      setDossier(data.dossier);
      setSynthesis(data.synthesis);
      if (!data.synthesis) generate();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function copyHooks() {
    if (!synthesis) return;
    const text = synthesis.hooks.map((h) => `• ${h.angle} (${h.why})`).join("\n");
    navigator.clipboard.writeText(text);
  }

  if (notFound) return <main className="mx-auto max-w-3xl p-6"><Link href="/" className="text-sm text-neutral-500">← Back</Link><p className="mt-4">Person not found.</p></main>;
  if (!dossier) return <main className="mx-auto max-w-3xl p-6"><Skeleton className="h-40" /></main>;

  const p = dossier;
  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/" className="text-sm text-neutral-500">← Back</Link>

      <header className="mt-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{p.name}</h1>
          {p.isInfluencer && <Badge className="bg-amber-100 text-amber-800">Top Voice</Badge>}
        </div>
        <div className="text-neutral-600">{p.title} · @{p.companyDomain}</div>
        {p.headline && <div className="mt-1 text-sm text-neutral-500">{p.headline}</div>}
        <div className="mt-2 flex gap-3 text-sm">
          <a className="text-blue-600 hover:underline" href={p.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a>
          {p.twitter && <a className="text-blue-600 hover:underline" href={`https://x.com/${p.twitter}`} target="_blank" rel="noreferrer">X</a>}
          {p.workEmail && <a className="text-blue-600 hover:underline" href={`mailto:${p.workEmail}`}>{p.workEmail}</a>}
        </div>
      </header>

      {/* AI synthesis — the centerpiece */}
      <Card className="mt-5 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">✦ AI summary</h2>
          <div className="flex gap-2">
            <Button className="bg-neutral-100 text-neutral-700 hover:bg-neutral-200" onClick={copyHooks}>Copy hooks</Button>
            <Button className="bg-neutral-100 text-neutral-700 hover:bg-neutral-200" onClick={generate} disabled={synthLoading}>Regenerate</Button>
          </div>
        </div>
        {synthLoading && !synthesis ? (
          <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-2/3" /></div>
        ) : synthesis && (synthesis.summary || synthesis.hooks.length) ? (
          <>
            <p className="text-sm text-neutral-800">{synthesis.summary}</p>
            {synthesis.interests.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {synthesis.interests.map((t) => <Badge key={t} className="bg-blue-50 text-blue-700">{t}</Badge>)}
              </div>
            )}
            {synthesis.hooks.length > 0 && (
              <ul className="mt-3 space-y-2">
                {synthesis.hooks.map((h, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-neutral-900">{h.angle}</span>
                    <span className="text-neutral-500"> — {h.why}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="text-sm text-neutral-500">Couldn’t generate hooks. <button className="underline" onClick={generate}>Retry</button></div>
        )}
      </Card>

      {p.skills.length > 0 && (
        <Section title="Skills">
          <div className="flex flex-wrap gap-1">{p.skills.map((s) => <Badge key={s}>{s}</Badge>)}</div>
        </Section>
      )}

      {p.experience.length > 0 && (
        <Section title="Experience">
          <ol className="space-y-3 border-l border-neutral-200 pl-4">
            {p.experience.map((e, i) => (
              <li key={i}>
                <div className="text-sm font-medium">{e.title} · {e.company}</div>
                <div className="text-xs text-neutral-500">{e.startDate ?? ""}{e.endDate ? ` – ${e.endDate}` : e.isCurrent ? " – present" : ""}</div>
                {e.summary && <div className="text-sm text-neutral-600">{e.summary}</div>}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {p.education.length > 0 && (
        <Section title="Education">
          <ul className="space-y-1 text-sm text-neutral-700">
            {p.education.map((ed, i) => <li key={i}>{ed.school}{ed.degree ? ` — ${ed.degree}` : ""}{ed.field ? `, ${ed.field}` : ""}{ed.endYear ? ` (${ed.endYear})` : ""}</li>)}
          </ul>
        </Section>
      )}

      {p.posts.length > 0 && (
        <Section title="Recent posts">
          <div className="space-y-2">
            {p.posts.map((post, i) => (
              <Card key={i} className="p-3">
                <p className="text-sm text-neutral-800">{post.text}</p>
                <div className="mt-1 text-xs text-neutral-400">
                  {post.postedAt ?? ""}{post.likes != null ? ` · ${post.likes} likes` : ""}
                  {post.url && <> · <a className="text-blue-600 hover:underline" href={post.url} target="_blank" rel="noreferrer">view</a></>}
                </div>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {p.webMentions.length > 0 && (
        <Section title="Web footprint">
          <ul className="space-y-1 text-sm">
            {p.webMentions.map((m, i) => (
              <li key={i}>
                <Badge className="mr-2">{m.category}</Badge>
                <a className="text-blue-600 hover:underline" href={m.url} target="_blank" rel="noreferrer">{m.title || m.url}</a>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Build + manual check**

Run: `npm run build`
Expected: build succeeds (route `ƒ /people/[id]`).
Manual: `npm run dev`, open `/`, click a person card → the dossier renders; the AI summary auto-generates (skeleton → summary + interests + hooks); "Copy hooks" copies; "Regenerate" refreshes; absent sections (no posts/mentions) don't render empty shells.

- [ ] **Step 3: Commit**

```bash
git add app/people
git commit -m "feat: person dossier page with AI hooks + scannable sections"
```

---

## Self-Review

**Spec coverage:**
- AI synthesis (summary/interests/grounded hooks) via `services.ai.generateObject`, degrades to empty → Task 1. ✓
- `synthesis` column + on-demand-cache (cache hit doesn't re-call model) → Tasks 2 (storage) + 3 (`getOrCreateSynthesis`). ✓
- `Synthesis`/`Hook`/`PersonCard` data model → Tasks 1/2. ✓
- repo `listPeople`/`getSynthesis`/`setSynthesis` → Task 2. ✓
- API routes `/api/people`, `/api/people/[id]`, `/api/people/[id]/synthesize` (404s, id decode) → Task 4 (logic tested in Task 3). ✓
- base64url person id → Task 2 (`src/ids.ts`). ✓
- People-list page (cards + run trigger) → Task 5. ✓
- Dossier page: header+links, AI block (copy + regenerate + auto-generate skeleton), skills chips, experience timeline, education, posts, web footprint, contact; empty sections render nothing → Task 6. ✓
- Tailwind + lightweight components (shadcn-style, no CLI) → Task 5. ✓
- Error/empty/loading states → Tasks 5/6. ✓
- No charts; no email drafting → respected. ✓

**Placeholder scan:** No TBD/TODO. UI tasks (4/5/6) are verified by build + manual per the spec's explicit testing decision (no React test runner); backend/server logic (1/2/3) is fully TDD'd. The one `eslint-disable` line is intentional (the `generate` dep in the effect is stable for the page's lifetime).

**Type consistency:** `Synthesis`/`Hook` (Task 1) used identically in repo (Task 2), server helpers (Task 3), routes (Task 4), and the dossier page (Task 6). `PersonCard` (Task 2) shape matches `listPeople` (Task 2) → `listPeopleCards` (Task 3) → `/api/people` (Task 4) → list page (Task 5). `encodeId`/`decodeId` (Task 2) used in `listPeople` (encode) and server helpers (decode) consistently. `getOrCreateSynthesis`'s injectable `gen` defaults to `synthesize` and is overridden in tests. `EnrichedPerson` fields rendered in Task 6 all exist from Phase 1.
