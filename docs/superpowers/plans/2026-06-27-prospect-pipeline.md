# Prospect Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A self-hosted Next.js server that turns an ICP prompt into a researched outreach list (companies → people → enriched dossiers) collected into a shared local SQLite store, with CSV/JSON exports.

**Architecture:** A plain TypeScript pipeline library (`src/`) does all the work over the Orange Slice `services.*` SDK, accessed through a single mockable seam (`src/orange.ts`). A thin Next.js App Router layer (`app/api/`) triggers the pipeline as an in-process background job and exposes status/results. Storage is `better-sqlite3` (system of record + credit cache). No UI, no auth yet.

**Tech Stack:** Next.js 15 (App Router, self-hosted via `next start`), TypeScript (ESM), `orangeslice` SDK, `better-sqlite3`, Vitest (tests), `tsx` (CLI runner).

## Global Constraints

- **Node ≥ 22** required (dev machine is v24.11.1). ESM only (`"type": "module"`).
- **SQLite driver:** `better-sqlite3` (synchronous). Declared in `next.config.ts` `serverExternalPackages`.
- **All Orange Slice SDK access goes through `src/orange.ts`** — never `import { services } from "orangeslice"` anywhere else. This is the single mock seam for tests.
- **No real SDK calls in unit tests.** Tests mock `src/orange.ts`. The only credit-spending test is the manually-run, env-gated e2e in Task 13.
- **Default run size:** 20 companies, 3 people/company. Default roles: founders + eng leadership.
- **Contact lookups (`person.contact.get`) are gated** behind the `contacts` request flag and skipped for anyone with a non-null `last_enriched_at`.
- **Parallelize independent SDK calls** with `Promise.all` / `services.web.batchSearch`.
- Crunchbase rule: query only `public.crunchbase_scraper_lean`, SELECT only, always `LIMIT`.

---

### Task 1: Project scaffold

**Files:**
- Modify: `package.json` (scripts, deps, `"type": "module"`)
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.local.example`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `src/smoke.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a buildable Next.js app and a working `npm test` command.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install next@latest react@latest react-dom@latest orangeslice@latest better-sqlite3
npm install -D typescript @types/react @types/node @types/better-sqlite3 vitest tsx
```

- [ ] **Step 2: Set ESM + scripts in `package.json`**

Merge these keys into `package.json` (keep existing `dependencies`/`devDependencies` from Step 1):
```json
{
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "prospect": "tsx scripts/run.ts"
  }
}
```

- [ ] **Step 3: Create config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "jsx": "preserve",
    "resolveJsonModule": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

`.env.local.example`:
```
# Orange Slice API key (osk_...). Copy to .env.local and fill in.
ORANGESLICE_API_KEY=
# Where the SQLite DB lives (default ./prospect.db)
PROSPECT_DB_PATH=./prospect.db
```

- [ ] **Step 4: Create minimal app shell**

`app/layout.tsx`:
```tsx
export const metadata = { title: "Prospect" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`app/page.tsx`:
```tsx
export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Prospect</h1>
      <p>Run-and-collect API. POST a prompt to <code>/api/runs</code>.</p>
    </main>
  );
}
```

- [ ] **Step 5: Write a smoke test**

`src/smoke.test.ts`:
```ts
import { test, expect } from "vitest";

test("vitest runs", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 6: Run the smoke test**

Run: `npm test`
Expected: PASS, 1 test passed.

- [ ] **Step 7: Verify the app builds**

Run: `npm run build`
Expected: build completes with no type errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js + vitest + sqlite project"
```

---

### Task 2: Domain types

**Files:**
- Create: `src/types.ts`
- Test: `src/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ICP` = `{ fundingStage: string | null; keywords: string[]; industry: string | null; geo: string | null; sizeMax: number | null }`
  - `Company` = `{ domain: string; name: string; linkedin: string | null; description: string | null; fitScore: number; why: string; source: "crunchbase" | "web" }`
  - `Person` = `{ linkedinUrl: string; companyDomain: string; name: string; title: string | null }`
  - `Signal` = `{ source: "linkedin" | "twitter" | "web"; content: string; url: string }`
  - `EnrichedPerson` = `Person & { twitter: string | null; workEmail: string | null; personalEmail: string | null; phone: string | null; headline: string | null; signals: Signal[] }`
  - `RunParams` = `{ prompt: string; contacts: boolean; roles: string[] }`
  - `JobStatus` = `"queued" | "running" | "completed" | "failed"`
  - `Job` = `{ id: string; prompt: string; status: JobStatus; params: RunParams; progress: Progress; error: string | null; createdAt: string; finishedAt: string | null }`
  - `Progress` = `{ stage: string; companies: number; people: number; contacts: number }`
  - `DEFAULT_ROLES: string[]`, `domainFromUrl(url: string | null): string | null`

- [ ] **Step 1: Write the failing test**

`src/types.test.ts`:
```ts
import { test, expect } from "vitest";
import { domainFromUrl, DEFAULT_ROLES } from "./types.js";

test("domainFromUrl strips protocol and www", () => {
  expect(domainFromUrl("https://www.Stripe.com/about")).toBe("stripe.com");
  expect(domainFromUrl("http://lever.co")).toBe("lever.co");
});

test("domainFromUrl returns null for empty input", () => {
  expect(domainFromUrl(null)).toBeNull();
  expect(domainFromUrl("")).toBeNull();
});

test("DEFAULT_ROLES includes founders and eng leadership", () => {
  expect(DEFAULT_ROLES).toContain("founder");
  expect(DEFAULT_ROLES).toContain("eng-leadership");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/types.test.ts`
Expected: FAIL ("Cannot find module './types.js'").

- [ ] **Step 3: Write minimal implementation**

`src/types.ts`:
```ts
export interface ICP {
  fundingStage: string | null;
  keywords: string[];
  industry: string | null;
  geo: string | null;
  sizeMax: number | null;
}

export interface Company {
  domain: string;
  name: string;
  linkedin: string | null;
  description: string | null;
  fitScore: number;
  why: string;
  source: "crunchbase" | "web";
}

export interface Person {
  linkedinUrl: string;
  companyDomain: string;
  name: string;
  title: string | null;
}

export interface Signal {
  source: "linkedin" | "twitter" | "web";
  content: string;
  url: string;
}

export interface EnrichedPerson extends Person {
  twitter: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  headline: string | null;
  signals: Signal[];
}

export interface RunParams {
  prompt: string;
  contacts: boolean;
  roles: string[];
}

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface Progress {
  stage: string;
  companies: number;
  people: number;
  contacts: number;
}

export interface Job {
  id: string;
  prompt: string;
  status: JobStatus;
  params: RunParams;
  progress: Progress;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export const DEFAULT_ROLES = ["founder", "eng-leadership"];

export function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const withProto = url.includes("://") ? url : `https://${url}`;
    const host = new URL(withProto).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/types.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/types.test.ts
git commit -m "feat: domain types and helpers"
```

---

### Task 3: SDK seam (`src/orange.ts`)

**Files:**
- Create: `src/orange.ts`

**Interfaces:**
- Consumes: `ORANGESLICE_API_KEY` env var.
- Produces: `export const services` (the configured Orange Slice services object). This is the ONLY import of `orangeslice` in the codebase and the single mock point for all tests.

- [ ] **Step 1: Write the implementation (no unit test — thin config wrapper)**

`src/orange.ts`:
```ts
import { configure, services } from "orangeslice";

const apiKey = process.env.ORANGESLICE_API_KEY;
if (apiKey) {
  configure({ apiKey });
}

export { services };
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/orange.ts
git commit -m "feat: orangeslice SDK seam"
```

---

### Task 4: Storage — db + migrations

**Files:**
- Create: `src/storage/db.ts`
- Test: `src/storage/db.test.ts`

**Interfaces:**
- Consumes: `PROSPECT_DB_PATH` env (default `./prospect.db`).
- Produces: `openDb(path?: string): Database` (a `better-sqlite3` instance with all tables migrated). For tests, pass `":memory:"`.

- [ ] **Step 1: Write the failing test**

`src/storage/db.test.ts`:
```ts
import { test, expect } from "vitest";
import { openDb } from "./db.js";

test("openDb creates all tables", () => {
  const db = openDb(":memory:");
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r: any) => r.name);
  expect(names).toContain("jobs");
  expect(names).toContain("companies");
  expect(names).toContain("people");
  expect(names).toContain("signals");
  db.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/db.test.ts`
Expected: FAIL ("Cannot find module './db.js'").

- [ ] **Step 3: Write minimal implementation**

`src/storage/db.ts`:
```ts
import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  params TEXT NOT NULL,
  progress TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS companies (
  domain TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  linkedin TEXT,
  fit_score INTEGER,
  why TEXT,
  first_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  linkedin_url TEXT PRIMARY KEY,
  company_domain TEXT,
  name TEXT,
  title TEXT,
  twitter TEXT,
  work_email TEXT,
  personal_email TEXT,
  phone TEXT,
  last_enriched_at TEXT
);
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_linkedin_url TEXT NOT NULL,
  source TEXT NOT NULL,
  content TEXT,
  url TEXT,
  fetched_at TEXT NOT NULL
);
`;

export function openDb(path = process.env.PROSPECT_DB_PATH ?? "./prospect.db") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export type Db = ReturnType<typeof openDb>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/storage/db.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storage/db.ts src/storage/db.test.ts
git commit -m "feat: sqlite db open + schema migration"
```

---

### Task 5: Storage — repository

**Files:**
- Create: `src/storage/repo.ts`
- Test: `src/storage/repo.test.ts`

**Interfaces:**
- Consumes: `Db` from Task 4; types from Task 2.
- Produces a `Repo` class wrapping a `Db`:
  - `createJob(id: string, params: RunParams): Job`
  - `updateJob(id: string, patch: Partial<Pick<Job, "status" | "progress" | "error" | "finishedAt">>): void`
  - `getJob(id: string): Job | null`
  - `listJobs(limit?: number): Job[]`
  - `upsertCompany(c: Company): void`
  - `upsertPerson(p: EnrichedPerson): void` (sets `last_enriched_at` to now)
  - `getPerson(linkedinUrl: string): { lastEnrichedAt: string | null } | null`
  - `needsContact(linkedinUrl: string): boolean` (false if already enriched — the credit cache)
  - `addSignals(linkedinUrl: string, signals: Signal[]): void`

- [ ] **Step 1: Write the failing test**

`src/storage/repo.test.ts`:
```ts
import { test, expect, beforeEach } from "vitest";
import { openDb } from "./db.js";
import { Repo } from "./repo.js";
import type { Company, EnrichedPerson, RunParams } from "../types.js";

let repo: Repo;
const params: RunParams = { prompt: "series a devtools", contacts: false, roles: ["founder"] };

beforeEach(() => {
  repo = new Repo(openDb(":memory:"));
});

test("createJob then getJob round-trips params", () => {
  repo.createJob("job1", params);
  const job = repo.getJob("job1")!;
  expect(job.status).toBe("queued");
  expect(job.params.prompt).toBe("series a devtools");
});

test("updateJob persists status and progress", () => {
  repo.createJob("job1", params);
  repo.updateJob("job1", { status: "running", progress: { stage: "people", companies: 20, people: 5, contacts: 0 } });
  const job = repo.getJob("job1")!;
  expect(job.status).toBe("running");
  expect(job.progress.companies).toBe(20);
});

test("needsContact is true for new person, false after enrich", () => {
  const company: Company = { domain: "x.com", name: "X", linkedin: null, description: null, fitScore: 90, why: "", source: "web" };
  repo.upsertCompany(company);
  const url = "https://linkedin.com/in/jane";
  expect(repo.needsContact(url)).toBe(true);
  const person: EnrichedPerson = {
    linkedinUrl: url, companyDomain: "x.com", name: "Jane", title: "CTO",
    twitter: null, workEmail: "jane@x.com", personalEmail: null, phone: null, headline: null, signals: [],
  };
  repo.upsertPerson(person);
  expect(repo.needsContact(url)).toBe(false);
});

test("listJobs returns most recent first", () => {
  repo.createJob("a", params);
  repo.createJob("b", params);
  const ids = repo.listJobs().map((j) => j.id);
  expect(ids).toEqual(["b", "a"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/repo.test.ts`
Expected: FAIL ("Cannot find module './repo.js'").

- [ ] **Step 3: Write minimal implementation**

`src/storage/repo.ts`:
```ts
import type { Db } from "./db.js";
import type { Company, EnrichedPerson, Job, Progress, RunParams, Signal } from "../types.js";

const EMPTY_PROGRESS: Progress = { stage: "queued", companies: 0, people: 0, contacts: 0 };

export class Repo {
  constructor(private db: Db) {}

  createJob(id: string, params: RunParams): Job {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO jobs (id, prompt, status, params, progress, error, created_at, finished_at)
         VALUES (?, ?, 'queued', ?, ?, NULL, ?, NULL)`,
      )
      .run(id, params.prompt, JSON.stringify(params), JSON.stringify(EMPTY_PROGRESS), now);
    return this.getJob(id)!;
  }

  updateJob(id: string, patch: Partial<Pick<Job, "status" | "progress" | "error" | "finishedAt">>): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.status !== undefined) { sets.push("status = ?"); vals.push(patch.status); }
    if (patch.progress !== undefined) { sets.push("progress = ?"); vals.push(JSON.stringify(patch.progress)); }
    if (patch.error !== undefined) { sets.push("error = ?"); vals.push(patch.error); }
    if (patch.finishedAt !== undefined) { sets.push("finished_at = ?"); vals.push(patch.finishedAt); }
    if (sets.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  getJob(id: string): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as any;
    return row ? rowToJob(row) : null;
  }

  listJobs(limit = 50): Job[] {
    const rows = this.db
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(limit) as any[];
    return rows.map(rowToJob);
  }

  upsertCompany(c: Company): void {
    this.db
      .prepare(
        `INSERT INTO companies (domain, name, linkedin, fit_score, why, first_seen)
         VALUES (@domain, @name, @linkedin, @fitScore, @why, @now)
         ON CONFLICT(domain) DO UPDATE SET
           name=excluded.name, linkedin=excluded.linkedin,
           fit_score=excluded.fit_score, why=excluded.why`,
      )
      .run({ ...c, now: new Date().toISOString() });
  }

  upsertPerson(p: EnrichedPerson): void {
    this.db
      .prepare(
        `INSERT INTO people (linkedin_url, company_domain, name, title, twitter, work_email, personal_email, phone, last_enriched_at)
         VALUES (@linkedinUrl, @companyDomain, @name, @title, @twitter, @workEmail, @personalEmail, @phone, @now)
         ON CONFLICT(linkedin_url) DO UPDATE SET
           company_domain=excluded.company_domain, name=excluded.name, title=excluded.title,
           twitter=excluded.twitter, work_email=excluded.work_email,
           personal_email=excluded.personal_email, phone=excluded.phone,
           last_enriched_at=excluded.last_enriched_at`,
      )
      .run({
        linkedinUrl: p.linkedinUrl, companyDomain: p.companyDomain, name: p.name, title: p.title,
        twitter: p.twitter, workEmail: p.workEmail, personalEmail: p.personalEmail, phone: p.phone,
        now: new Date().toISOString(),
      });
  }

  getPerson(linkedinUrl: string): { lastEnrichedAt: string | null } | null {
    const row = this.db.prepare("SELECT last_enriched_at FROM people WHERE linkedin_url = ?").get(linkedinUrl) as any;
    return row ? { lastEnrichedAt: row.last_enriched_at } : null;
  }

  needsContact(linkedinUrl: string): boolean {
    const p = this.getPerson(linkedinUrl);
    return !p || p.lastEnrichedAt === null;
  }

  addSignals(linkedinUrl: string, signals: Signal[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO signals (person_linkedin_url, source, content, url, fetched_at) VALUES (?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    const tx = this.db.transaction((items: Signal[]) => {
      for (const s of items) stmt.run(linkedinUrl, s.source, s.content, s.url, now);
    });
    tx(signals);
  }
}

function rowToJob(row: any): Job {
  return {
    id: row.id,
    prompt: row.prompt,
    status: row.status,
    params: JSON.parse(row.params),
    progress: JSON.parse(row.progress),
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/storage/repo.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storage/repo.ts src/storage/repo.test.ts
git commit -m "feat: storage repository with job CRUD and contact cache"
```

---

### Task 6: Interpret prompt → ICP

**Files:**
- Create: `src/pipeline/interpret.ts`
- Test: `src/pipeline/interpret.test.ts`

**Interfaces:**
- Consumes: `services.ai.generateObject` (via mocked `../orange.js`); `ICP` type.
- Produces: `interpret(prompt: string): Promise<ICP>`.

- [ ] **Step 1: Write the failing test**

`src/pipeline/interpret.test.ts`:
```ts
import { test, expect, vi, beforeEach } from "vitest";

const generateObject = vi.fn();
vi.mock("../orange.js", () => ({ services: { ai: { generateObject } } }));

import { interpret } from "./interpret.js";

beforeEach(() => generateObject.mockReset());

test("interpret maps generateObject output into an ICP", async () => {
  generateObject.mockResolvedValue({
    object: { fundingStage: "series_a", keywords: ["developer tools", "devtools"], industry: "Software", geo: "US", sizeMax: 200 },
  });
  const icp = await interpret("Series A dev tool companies in the US");
  expect(icp.fundingStage).toBe("series_a");
  expect(icp.keywords).toContain("devtools");
  expect(icp.sizeMax).toBe(200);
});

test("interpret tolerates missing fields with safe defaults", async () => {
  generateObject.mockResolvedValue({ object: { keywords: ["fintech"] } });
  const icp = await interpret("fintech startups");
  expect(icp.fundingStage).toBeNull();
  expect(icp.keywords).toEqual(["fintech"]);
  expect(icp.geo).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/interpret.test.ts`
Expected: FAIL ("Cannot find module './interpret.js'").

- [ ] **Step 3: Write minimal implementation**

`src/pipeline/interpret.ts`:
```ts
import { services } from "../orange.js";
import type { ICP } from "../types.js";

const SCHEMA = {
  type: "object",
  properties: {
    fundingStage: { type: ["string", "null"], description: "Crunchbase last_funding_type, e.g. 'series_a', 'seed'. Null if unspecified." },
    keywords: { type: "array", items: { type: "string" }, description: "Search keywords describing the product/space, e.g. ['developer tools','devtools']." },
    industry: { type: ["string", "null"] },
    geo: { type: ["string", "null"], description: "Country or region, e.g. 'US'." },
    sizeMax: { type: ["number", "null"], description: "Max headcount if implied, else null." },
  },
  required: ["keywords"],
};

export async function interpret(prompt: string): Promise<ICP> {
  const { object } = await services.ai.generateObject({
    prompt: `Extract a B2B ideal-customer-profile filter from this request. Do not fabricate values; use null when unspecified.\n\nRequest: ${prompt}`,
    schema: SCHEMA,
    intelligence: "low",
  });
  return {
    fundingStage: object.fundingStage ?? null,
    keywords: Array.isArray(object.keywords) ? object.keywords : [],
    industry: object.industry ?? null,
    geo: object.geo ?? null,
    sizeMax: typeof object.sizeMax === "number" ? object.sizeMax : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline/interpret.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/interpret.ts src/pipeline/interpret.test.ts
git commit -m "feat: interpret prompt into structured ICP"
```

---

### Task 7: Discover & qualify companies

**Files:**
- Create: `src/pipeline/companies.ts`
- Test: `src/pipeline/companies.test.ts`

**Interfaces:**
- Consumes: `services.crunchbase.search`, `services.web.search`, `services.ai.generateObject` (mocked); `ICP`, `Company`, `domainFromUrl`.
- Produces: `discoverCompanies(icp: ICP, limit?: number): Promise<Company[]>` — returns up to `limit` (default 20) companies, deduped by domain, scored, sorted by `fitScore` desc.

- [ ] **Step 1: Write the failing test**

`src/pipeline/companies.test.ts`:
```ts
import { test, expect, vi, beforeEach } from "vitest";

const cbSearch = vi.fn();
const webSearch = vi.fn();
const generateObject = vi.fn();
vi.mock("../orange.js", () => ({
  services: {
    crunchbase: { search: cbSearch },
    web: { search: webSearch },
    ai: { generateObject },
  },
}));

import { discoverCompanies } from "./companies.js";
import type { ICP } from "../types.js";

const icp: ICP = { fundingStage: "series_a", keywords: ["devtools"], industry: null, geo: "US", sizeMax: null };

beforeEach(() => {
  cbSearch.mockReset();
  webSearch.mockReset();
  generateObject.mockReset();
  // default qualifier: score 80
  generateObject.mockResolvedValue({ object: { fitScore: 80, why: "matches devtools + series a" } });
});

test("queries crunchbase when fundingStage is present and dedupes by domain", async () => {
  cbSearch.mockResolvedValue([
    { name: "Acme", website_url: "https://acme.com", linkedin_url: "https://linkedin.com/company/acme", short_description: "dev tool" },
    { name: "Acme Dup", website_url: "https://www.acme.com/", linkedin_url: null, short_description: "dup" },
  ]);
  webSearch.mockResolvedValue({ results: [] });
  const out = await discoverCompanies(icp, 20);
  expect(cbSearch).toHaveBeenCalled();
  expect(out).toHaveLength(1);
  expect(out[0].domain).toBe("acme.com");
  expect(out[0].fitScore).toBe(80);
});

test("sorts by fitScore desc and respects limit", async () => {
  cbSearch.mockResolvedValue([
    { name: "Low", website_url: "https://low.com", linkedin_url: null, short_description: "" },
    { name: "High", website_url: "https://high.com", linkedin_url: null, short_description: "" },
  ]);
  webSearch.mockResolvedValue({ results: [] });
  generateObject
    .mockResolvedValueOnce({ object: { fitScore: 30, why: "" } })
    .mockResolvedValueOnce({ object: { fitScore: 95, why: "" } });
  const out = await discoverCompanies(icp, 1);
  expect(out).toHaveLength(1);
  expect(out[0].name).toBe("High");
});

test("skips crunchbase when fundingStage is null", async () => {
  webSearch.mockResolvedValue({
    results: [{ title: "Foo", link: "https://foo.com", snippet: "a devtool" }],
  });
  const out = await discoverCompanies({ ...icp, fundingStage: null }, 20);
  expect(cbSearch).not.toHaveBeenCalled();
  expect(out[0].domain).toBe("foo.com");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/companies.test.ts`
Expected: FAIL ("Cannot find module './companies.js'").

- [ ] **Step 3: Write minimal implementation**

`src/pipeline/companies.ts`:
```ts
import { services } from "../orange.js";
import { domainFromUrl } from "../types.js";
import type { Company, ICP } from "../types.js";

interface RawCompany {
  name: string;
  domain: string;
  linkedin: string | null;
  description: string | null;
  source: "crunchbase" | "web";
}

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    fitScore: { type: "number", description: "0-100 fit against the ICP." },
    why: { type: "string", description: "One sentence justification." },
  },
  required: ["fitScore", "why"],
};

export async function discoverCompanies(icp: ICP, limit = 20): Promise<Company[]> {
  const [fromCb, fromWeb] = await Promise.all([fromCrunchbase(icp), fromWeb_(icp)]);

  // Dedupe by domain (crunchbase wins on conflict — richer data).
  const byDomain = new Map<string, RawCompany>();
  for (const c of [...fromCb, ...fromWeb]) {
    if (!byDomain.has(c.domain)) byDomain.set(c.domain, c);
  }
  const raw = [...byDomain.values()];

  // Score each independently (one generateObject call per company).
  const scored = await Promise.all(
    raw.map(async (c): Promise<Company> => {
      const { object } = await services.ai.generateObject({
        prompt:
          `Score how well this company fits the ICP (0-100) and explain in one sentence. Do not fabricate.\n\n` +
          `ICP: ${JSON.stringify(icp)}\n\nCompany: ${c.name} — ${c.description ?? "(no description)"} (${c.domain})`,
        schema: SCORE_SCHEMA,
        intelligence: "low",
      });
      return {
        domain: c.domain, name: c.name, linkedin: c.linkedin, description: c.description,
        source: c.source, fitScore: Number(object.fitScore) || 0, why: String(object.why ?? ""),
      };
    }),
  );

  return scored.sort((a, b) => b.fitScore - a.fitScore).slice(0, limit);
}

async function fromCrunchbase(icp: ICP): Promise<RawCompany[]> {
  if (!icp.fundingStage) return [];
  const kw = icp.keywords[0]?.replace(/'/g, "''") ?? "";
  const stage = icp.fundingStage.replace(/'/g, "''");
  const rows = (await services.crunchbase.search({
    sql: `SELECT name, website_url, linkedin_url, short_description
          FROM public.crunchbase_scraper_lean
          WHERE operating_status = 'active'
            AND last_funding_type = '${stage}'
            AND (short_description ILIKE '%${kw}%' OR primary_category ILIKE '%${kw}%')
          ORDER BY rank_org ASC NULLS LAST
          LIMIT 60`,
  })) as any[];
  return rows
    .map((r): RawCompany | null => {
      const domain = domainFromUrl(r.website_url);
      return domain
        ? { name: r.name, domain, linkedin: r.linkedin_url ?? null, description: r.short_description ?? null, source: "crunchbase" }
        : null;
    })
    .filter((x): x is RawCompany => x !== null);
}

async function fromWeb_(icp: ICP): Promise<RawCompany[]> {
  const q = [...icp.keywords, icp.industry, icp.geo, "company"].filter(Boolean).join(" ");
  const { results } = await services.web.search({ query: q });
  return (results ?? [])
    .map((r: any): RawCompany | null => {
      const domain = domainFromUrl(r.link);
      return domain
        ? { name: r.title, domain, linkedin: null, description: r.snippet ?? null, source: "web" }
        : null;
    })
    .filter((x): x is RawCompany => x !== null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline/companies.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/companies.ts src/pipeline/companies.test.ts
git commit -m "feat: discover and qualify companies from crunchbase + web"
```

---

### Task 8: Find people at companies

**Files:**
- Create: `src/pipeline/people.ts`
- Test: `src/pipeline/people.test.ts`

**Interfaces:**
- Consumes: `services.company.getEmployeesFromLinkedin`, `services.company.linkedin.findUrl` (mocked); `Company`, `Person`.
- Produces: `findPeople(company: Company, roles: string[], perCompany?: number): Promise<Person[]>` — up to `perCompany` (default 3) people, deduped by linkedinUrl. Founders use web strategy; eng-leadership uses database + titleSqlFilter.

- [ ] **Step 1: Write the failing test**

`src/pipeline/people.test.ts`:
```ts
import { test, expect, vi, beforeEach } from "vitest";

const getEmployees = vi.fn();
const findUrl = vi.fn();
vi.mock("../orange.js", () => ({
  services: { company: { getEmployeesFromLinkedin: getEmployees, linkedin: { findUrl } } },
}));

import { findPeople } from "./people.js";
import type { Company } from "../types.js";

const company: Company = {
  domain: "acme.com", name: "Acme", linkedin: "https://linkedin.com/company/acme",
  description: null, fitScore: 90, why: "", source: "crunchbase",
};

beforeEach(() => {
  getEmployees.mockReset();
  findUrl.mockReset();
});

test("merges founders (web) + eng leadership (db), dedupes, caps at perCompany", async () => {
  getEmployees
    // founders (web strategy)
    .mockResolvedValueOnce({ employees: [
      { name: "Ana Founder", title: "CEO & Co-Founder", linkedinUrl: "https://linkedin.com/in/ana" },
      { name: "Dup", title: "CTO", linkedinUrl: "https://linkedin.com/in/ana" },
    ] })
    // eng leadership (database strategy)
    .mockResolvedValueOnce({ employees: [
      { name: "Bo Eng", title: "VP Engineering", linkedinUrl: "https://linkedin.com/in/bo" },
      { name: "Cy Eng", title: "Head of Platform", linkedinUrl: "https://linkedin.com/in/cy" },
    ] });
  const people = await findPeople(company, ["founder", "eng-leadership"], 3);
  const urls = people.map((p) => p.linkedinUrl);
  expect(new Set(urls).size).toBe(urls.length); // no dupes
  expect(people).toHaveLength(3);
  expect(people[0].companyDomain).toBe("acme.com");
});

test("resolves company linkedin url when missing", async () => {
  findUrl.mockResolvedValue("https://linkedin.com/company/acme");
  getEmployees.mockResolvedValue({ employees: [] });
  await findPeople({ ...company, linkedin: null }, ["founder"], 3);
  expect(findUrl).toHaveBeenCalledWith(expect.objectContaining({ website: "acme.com" }));
});

test("skips people with no linkedinUrl", async () => {
  getEmployees.mockResolvedValue({ employees: [{ name: "No URL", title: "CEO", linkedinUrl: null }] });
  const people = await findPeople(company, ["founder"], 3);
  expect(people).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/people.test.ts`
Expected: FAIL ("Cannot find module './people.js'").

- [ ] **Step 3: Write minimal implementation**

`src/pipeline/people.ts`:
```ts
import { services } from "../orange.js";
import type { Company, Person } from "../types.js";

export async function findPeople(company: Company, roles: string[], perCompany = 3): Promise<Person[]> {
  const linkedinUrl = company.linkedin ?? (await resolveCompanyUrl(company));
  if (!linkedinUrl) return [];

  const batches = await Promise.all(roles.map((role) => fetchRole(linkedinUrl, role)));
  const merged: any[] = batches.flat();

  const byUrl = new Map<string, Person>();
  for (const e of merged) {
    if (!e?.linkedinUrl) continue;
    if (byUrl.has(e.linkedinUrl)) continue;
    byUrl.set(e.linkedinUrl, {
      linkedinUrl: e.linkedinUrl,
      companyDomain: company.domain,
      name: e.name ?? "",
      title: e.title ?? null,
    });
  }
  return [...byUrl.values()].slice(0, perCompany);
}

async function resolveCompanyUrl(company: Company): Promise<string | null> {
  try {
    return await services.company.linkedin.findUrl({ companyName: company.name, website: company.domain });
  } catch {
    return null;
  }
}

async function fetchRole(linkedinUrl: string, role: string): Promise<any[]> {
  try {
    if (role === "founder") {
      const { employees } = await services.company.getEmployeesFromLinkedin({
        linkedinUrl,
        searchStrategy: "web",
        titleVariations: ["founder", "ceo", "cto"], // web strategy: max 3 variations
        limit: 10,
      });
      return employees ?? [];
    }
    if (role === "eng-leadership") {
      const { employees } = await services.company.getEmployeesFromLinkedin({
        linkedinUrl,
        searchStrategy: "database",
        titleSqlFilter: "pos.title ~* '\\m(VP|Director|Head)\\M' AND pos.title ~* '\\m(Engineering|Platform|Infrastructure)\\M'",
        limit: 10,
      });
      return employees ?? [];
    }
    // generic role keyword → database title search
    const { employees } = await services.company.getEmployeesFromLinkedin({
      linkedinUrl,
      searchStrategy: "database",
      titleVariations: [role],
      limit: 10,
    });
    return employees ?? [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline/people.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/people.ts src/pipeline/people.test.ts
git commit -m "feat: find founders + eng leadership per company"
```

---

### Task 9: Enrich a person (profile + contact + signals)

**Files:**
- Create: `src/pipeline/enrich.ts`
- Test: `src/pipeline/enrich.test.ts`

**Interfaces:**
- Consumes: `services.person.linkedin.enrich`, `services.person.contact.get`, `services.web.batchSearch` (mocked); `Person`, `EnrichedPerson`, `Signal`.
- Produces: `enrichPerson(person: Person, opts: { contacts: boolean; skipContact?: boolean }): Promise<EnrichedPerson>`.
  - Always enriches profile + gathers signals.
  - Calls `contact.get` only when `opts.contacts === true` AND `opts.skipContact !== true` (the caller passes `skipContact` from the repo cache).

- [ ] **Step 1: Write the failing test**

`src/pipeline/enrich.test.ts`:
```ts
import { test, expect, vi, beforeEach } from "vitest";

const linkedinEnrich = vi.fn();
const contactGet = vi.fn();
const batchSearch = vi.fn();
vi.mock("../orange.js", () => ({
  services: {
    person: { linkedin: { enrich: linkedinEnrich }, contact: { get: contactGet } },
    web: { batchSearch },
  },
}));

import { enrichPerson } from "./enrich.js";
import type { Person } from "../types.js";

const person: Person = { linkedinUrl: "https://linkedin.com/in/jane", companyDomain: "acme.com", name: "Jane Doe", title: "CTO" };

beforeEach(() => {
  linkedinEnrich.mockReset();
  contactGet.mockReset();
  batchSearch.mockReset();
  linkedinEnrich.mockResolvedValue({ headline: "CTO at Acme", twitter_handle: "janedoe" });
  batchSearch.mockResolvedValue([
    { results: [{ title: "Jane on LinkedIn", link: "https://linkedin.com/posts/jane_1", snippet: "shipped X" }] },
    { results: [{ title: "Jane tweet", link: "https://x.com/janedoe/status/1", snippet: "hot take" }] },
    { results: [{ title: "Jane interview", link: "https://blog.com/jane", snippet: "podcast" }] },
  ]);
});

test("enriches profile and gathers signals without contacts when contacts=false", async () => {
  const out = await enrichPerson(person, { contacts: false });
  expect(out.headline).toBe("CTO at Acme");
  expect(out.twitter).toBe("janedoe");
  expect(out.workEmail).toBeNull();
  expect(contactGet).not.toHaveBeenCalled();
  expect(out.signals.length).toBeGreaterThan(0);
  expect(out.signals.some((s) => s.source === "twitter")).toBe(true);
});

test("fetches contact info when contacts=true and not skipped", async () => {
  contactGet.mockResolvedValue({ work_emails: ["jane@acme.com"], personal_emails: ["jane@gmail.com"], work_phones: ["+1555"], personal_phones: [], unknown_phones: [] });
  const out = await enrichPerson(person, { contacts: true });
  expect(contactGet).toHaveBeenCalledWith(expect.objectContaining({ linkedinUrl: person.linkedinUrl }));
  expect(out.workEmail).toBe("jane@acme.com");
  expect(out.personalEmail).toBe("jane@gmail.com");
  expect(out.phone).toBe("+1555");
});

test("skips contact lookup when skipContact=true (cache hit)", async () => {
  const out = await enrichPerson(person, { contacts: true, skipContact: true });
  expect(contactGet).not.toHaveBeenCalled();
  expect(out.workEmail).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/enrich.test.ts`
Expected: FAIL ("Cannot find module './enrich.js'").

- [ ] **Step 3: Write minimal implementation**

`src/pipeline/enrich.ts`:
```ts
import { services } from "../orange.js";
import type { EnrichedPerson, Person, Signal } from "../types.js";

export async function enrichPerson(
  person: Person,
  opts: { contacts: boolean; skipContact?: boolean },
): Promise<EnrichedPerson> {
  const wantContact = opts.contacts && !opts.skipContact;

  const [profile, contact, signals] = await Promise.all([
    enrichProfile(person.linkedinUrl),
    wantContact ? getContact(person) : Promise.resolve(null),
    gatherSignals(person),
  ]);

  return {
    ...person,
    headline: profile?.headline ?? null,
    twitter: profile?.twitter_handle ?? null,
    workEmail: contact?.work_emails?.[0] ?? null,
    personalEmail: contact?.personal_emails?.[0] ?? null,
    phone: contact?.work_phones?.[0] ?? contact?.personal_phones?.[0] ?? contact?.unknown_phones?.[0] ?? null,
    signals,
  };
}

async function enrichProfile(url: string): Promise<any | null> {
  try {
    return await services.person.linkedin.enrich({ url });
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

async function gatherSignals(person: Person): Promise<Signal[]> {
  const name = `"${person.name}"`;
  try {
    const batches = await services.web.batchSearch({
      queries: [
        { query: `${name} site:linkedin.com/posts` },
        { query: `${name} site:x.com` },
        { query: `${name} ${person.title ?? ""} interview OR blog OR podcast` },
      ],
    });
    const sources: Signal["source"][] = ["linkedin", "twitter", "web"];
    const signals: Signal[] = [];
    batches.forEach((b: any, i: number) => {
      for (const r of (b?.results ?? []).slice(0, 3)) {
        signals.push({ source: sources[i], content: r.snippet ?? r.title ?? "", url: r.link });
      }
    });
    return signals;
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline/enrich.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/enrich.ts src/pipeline/enrich.test.ts
git commit -m "feat: enrich person profile, contact, and public signals"
```

---

### Task 10: Exports (CSV/JSON)

**Files:**
- Create: `src/output/export.ts`
- Test: `src/output/export.test.ts`

**Interfaces:**
- Consumes: `Company`, `EnrichedPerson`.
- Produces:
  - `companiesCsv(companies: Company[]): string`
  - `peopleCsv(people: EnrichedPerson[]): string`
  - `writeRun(dir: string, data: { companies: Company[]; people: EnrichedPerson[] }): Promise<void>` (writes `companies.csv`, `people.csv`, `people.json` into `dir`, creating it).

- [ ] **Step 1: Write the failing test**

`src/output/export.test.ts`:
```ts
import { test, expect } from "vitest";
import { companiesCsv, peopleCsv } from "./export.js";
import type { Company, EnrichedPerson } from "../types.js";

test("companiesCsv has header and escapes commas/quotes", () => {
  const rows: Company[] = [
    { domain: "acme.com", name: "Acme, Inc", linkedin: null, description: null, fitScore: 90, why: 'says "hi"', source: "web" },
  ];
  const csv = companiesCsv(rows);
  const lines = csv.trim().split("\n");
  expect(lines[0]).toBe("name,domain,linkedin,fit_score,why");
  expect(lines[1]).toContain('"Acme, Inc"');
  expect(lines[1]).toContain('"says ""hi"""');
});

test("peopleCsv flattens contact fields", () => {
  const people: EnrichedPerson[] = [
    { linkedinUrl: "https://linkedin.com/in/jane", companyDomain: "acme.com", name: "Jane", title: "CTO",
      twitter: "janedoe", workEmail: "jane@acme.com", personalEmail: null, phone: null, headline: "CTO", signals: [] },
  ];
  const csv = peopleCsv(people);
  expect(csv.split("\n")[0]).toBe("name,title,company,linkedin,twitter,work_email,personal_email,phone");
  expect(csv).toContain("jane@acme.com");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/output/export.test.ts`
Expected: FAIL ("Cannot find module './export.js'").

- [ ] **Step 3: Write minimal implementation**

`src/output/export.ts`:
```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Company, EnrichedPerson } from "../types.js";

function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: unknown[][]): string {
  return [header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
}

export function companiesCsv(companies: Company[]): string {
  return toCsv(
    ["name", "domain", "linkedin", "fit_score", "why"],
    companies.map((c) => [c.name, c.domain, c.linkedin, c.fitScore, c.why]),
  );
}

export function peopleCsv(people: EnrichedPerson[]): string {
  return toCsv(
    ["name", "title", "company", "linkedin", "twitter", "work_email", "personal_email", "phone"],
    people.map((p) => [p.name, p.title, p.companyDomain, p.linkedinUrl, p.twitter, p.workEmail, p.personalEmail, p.phone]),
  );
}

export async function writeRun(
  dir: string,
  data: { companies: Company[]; people: EnrichedPerson[] },
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(join(dir, "companies.csv"), companiesCsv(data.companies)),
    writeFile(join(dir, "people.csv"), peopleCsv(data.people)),
    writeFile(join(dir, "people.json"), JSON.stringify(data.people, null, 2)),
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/output/export.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/output/export.ts src/output/export.test.ts
git commit -m "feat: csv/json run exports"
```

---

### Task 11: Pipeline orchestrator

**Files:**
- Create: `src/pipeline/run.ts`
- Test: `src/pipeline/run.test.ts`

**Interfaces:**
- Consumes: `interpret`, `discoverCompanies`, `findPeople`, `enrichPerson` (all mocked via their modules); `Repo`; `writeRun`; types.
- Produces: `runPipeline(jobId: string, params: RunParams, repo: Repo, runsDir?: string): Promise<void>` — drives stages [0]→[7], updating job progress/status in `repo`, isolating per-person failures, marking `completed`/`failed`.

- [ ] **Step 1: Write the failing test**

`src/pipeline/run.test.ts`:
```ts
import { test, expect, vi, beforeEach } from "vitest";

const interpret = vi.fn();
const discoverCompanies = vi.fn();
const findPeople = vi.fn();
const enrichPerson = vi.fn();
const writeRun = vi.fn();
vi.mock("./interpret.js", () => ({ interpret }));
vi.mock("./companies.js", () => ({ discoverCompanies }));
vi.mock("./people.js", () => ({ findPeople }));
vi.mock("./enrich.js", () => ({ enrichPerson }));
vi.mock("../output/export.js", () => ({ writeRun }));

import { runPipeline } from "./run.js";
import { Repo } from "../storage/repo.js";
import { openDb } from "../storage/db.js";
import type { RunParams } from "../types.js";

let repo: Repo;
const params: RunParams = { prompt: "series a devtools", contacts: false, roles: ["founder"] };

beforeEach(() => {
  vi.clearAllMocks();
  repo = new Repo(openDb(":memory:"));
  interpret.mockResolvedValue({ fundingStage: "series_a", keywords: ["devtools"], industry: null, geo: null, sizeMax: null });
  discoverCompanies.mockResolvedValue([
    { domain: "acme.com", name: "Acme", linkedin: "u", description: null, fitScore: 90, why: "", source: "crunchbase" },
  ]);
  findPeople.mockResolvedValue([
    { linkedinUrl: "https://linkedin.com/in/jane", companyDomain: "acme.com", name: "Jane", title: "CTO" },
  ]);
  enrichPerson.mockResolvedValue({
    linkedinUrl: "https://linkedin.com/in/jane", companyDomain: "acme.com", name: "Jane", title: "CTO",
    twitter: null, workEmail: null, personalEmail: null, phone: null, headline: null, signals: [],
  });
  writeRun.mockResolvedValue(undefined);
});

test("completes a run and records counts", async () => {
  repo.createJob("job1", params);
  await runPipeline("job1", params, repo, "/tmp/prospect-test");
  const job = repo.getJob("job1")!;
  expect(job.status).toBe("completed");
  expect(job.progress.companies).toBe(1);
  expect(job.progress.people).toBe(1);
  expect(writeRun).toHaveBeenCalled();
});

test("marks job failed if a stage throws", async () => {
  discoverCompanies.mockRejectedValue(new Error("crunchbase down"));
  repo.createJob("job2", params);
  await runPipeline("job2", params, repo, "/tmp/prospect-test");
  const job = repo.getJob("job2")!;
  expect(job.status).toBe("failed");
  expect(job.error).toContain("crunchbase down");
});

test("one bad person does not fail the whole run", async () => {
  findPeople.mockResolvedValue([
    { linkedinUrl: "https://linkedin.com/in/ok", companyDomain: "acme.com", name: "OK", title: "CTO" },
    { linkedinUrl: "https://linkedin.com/in/bad", companyDomain: "acme.com", name: "Bad", title: "CEO" },
  ]);
  enrichPerson
    .mockResolvedValueOnce({ linkedinUrl: "https://linkedin.com/in/ok", companyDomain: "acme.com", name: "OK", title: "CTO", twitter: null, workEmail: null, personalEmail: null, phone: null, headline: null, signals: [] })
    .mockRejectedValueOnce(new Error("enrich boom"));
  repo.createJob("job3", params);
  await runPipeline("job3", params, repo, "/tmp/prospect-test");
  const job = repo.getJob("job3")!;
  expect(job.status).toBe("completed");
  expect(job.progress.people).toBe(1); // only the successful one persisted
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/run.test.ts`
Expected: FAIL ("Cannot find module './run.js'").

- [ ] **Step 3: Write minimal implementation**

`src/pipeline/run.ts`:
```ts
import { join } from "node:path";
import { interpret } from "./interpret.js";
import { discoverCompanies } from "./companies.js";
import { findPeople } from "./people.js";
import { enrichPerson } from "./enrich.js";
import { writeRun } from "../output/export.js";
import type { Repo } from "../storage/repo.js";
import type { Company, EnrichedPerson, Person, Progress, RunParams } from "../types.js";

export async function runPipeline(
  jobId: string,
  params: RunParams,
  repo: Repo,
  runsDir = "runs",
): Promise<void> {
  const progress: Progress = { stage: "interpret", companies: 0, people: 0, contacts: 0 };
  const setStage = (stage: string) => {
    progress.stage = stage;
    repo.updateJob(jobId, { progress: { ...progress } });
  };

  try {
    repo.updateJob(jobId, { status: "running", progress: { ...progress } });

    setStage("interpret");
    const icp = await interpret(params.prompt);

    setStage("companies");
    const companies = await discoverCompanies(icp, 20);
    for (const c of companies) repo.upsertCompany(c);
    progress.companies = companies.length;
    setStage("people");

    // Collect people across all companies (concurrently).
    const peopleLists = await Promise.all(
      companies.map((c: Company) => findPeople(c, params.roles, 3)),
    );
    const people: Person[] = peopleLists.flat();
    progress.people = people.length;
    setStage("enrich");

    // Enrich each person; isolate failures so one bad profile doesn't kill the run.
    const enriched: EnrichedPerson[] = [];
    let contacts = 0;
    const results = await Promise.allSettled(
      people.map((p) =>
        enrichPerson(p, { contacts: params.contacts, skipContact: !repo.needsContact(p.linkedinUrl) }),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        const ep = r.value;
        repo.upsertPerson(ep);
        if (ep.signals.length) repo.addSignals(ep.linkedinUrl, ep.signals);
        if (ep.workEmail || ep.personalEmail || ep.phone) contacts++;
        enriched.push(ep);
      }
    }
    progress.people = enriched.length;
    progress.contacts = contacts;
    setStage("output");

    await writeRun(join(runsDir, jobId), { companies, people: enriched });

    repo.updateJob(jobId, {
      status: "completed",
      progress: { ...progress, stage: "completed" },
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    repo.updateJob(jobId, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      finishedAt: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pipeline/run.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/run.ts src/pipeline/run.test.ts
git commit -m "feat: pipeline orchestrator with progress + failure isolation"
```

---

### Task 12: Server — job runner + API routes

**Files:**
- Create: `src/server/jobs.ts`
- Create: `app/api/runs/route.ts`
- Create: `app/api/runs/[id]/route.ts`
- Test: `src/server/jobs.test.ts`

**Interfaces:**
- Consumes: `Repo`, `openDb`, `runPipeline`, types.
- Produces (`src/server/jobs.ts`):
  - `getRepo(): Repo` — lazy singleton over `openDb()` (one shared DB for the long-running server).
  - `startRun(params: RunParams): string` — creates a job, fires `runPipeline` in the background (NOT awaited), returns `jobId`.
  - `newJobId(): string` — `"job_" + randomUUID()`.
- API contract:
  - `POST /api/runs` body `{ prompt: string, contacts?: boolean, roles?: string[] }` → `201 { jobId }`; `400` if `prompt` missing.
  - `GET /api/runs/:id` → `200 Job` or `404`.
  - `GET /api/runs` → `200 { jobs: Job[] }`.

- [ ] **Step 1: Write the failing test**

`src/server/jobs.test.ts`:
```ts
import { test, expect, vi, beforeEach } from "vitest";

const runPipeline = vi.fn();
vi.mock("../pipeline/run.js", () => ({ runPipeline }));
// Force a fresh in-memory DB per test run.
process.env.PROSPECT_DB_PATH = ":memory:";

import { startRun, getRepo, newJobId } from "./jobs.js";

beforeEach(() => runPipeline.mockReset().mockResolvedValue(undefined));

test("newJobId is prefixed and unique", () => {
  expect(newJobId()).toMatch(/^job_/);
  expect(newJobId()).not.toBe(newJobId());
});

test("startRun creates a queued job and invokes the pipeline", async () => {
  const id = startRun({ prompt: "series a devtools", contacts: false, roles: ["founder"] });
  expect(getRepo().getJob(id)).not.toBeNull();
  // background call fired
  await Promise.resolve();
  expect(runPipeline).toHaveBeenCalledWith(id, expect.objectContaining({ prompt: "series a devtools" }), expect.anything());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/jobs.test.ts`
Expected: FAIL ("Cannot find module './jobs.js'").

- [ ] **Step 3: Write `src/server/jobs.ts`**

```ts
import { randomUUID } from "node:crypto";
import { openDb } from "../storage/db.js";
import { Repo } from "../storage/repo.js";
import { runPipeline } from "../pipeline/run.js";
import type { RunParams } from "../types.js";

let repo: Repo | null = null;

export function getRepo(): Repo {
  if (!repo) repo = new Repo(openDb());
  return repo;
}

export function newJobId(): string {
  return "job_" + randomUUID();
}

export function startRun(params: RunParams): string {
  const id = newJobId();
  const r = getRepo();
  r.createJob(id, params);
  // Fire-and-forget: long-running server keeps the process alive.
  void runPipeline(id, params, r).catch((err) => {
    r.updateJob(id, { status: "failed", error: String(err), finishedAt: new Date().toISOString() });
  });
  return id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/jobs.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the API routes**

`app/api/runs/route.ts`:
```ts
import { NextResponse } from "next/server";
import { startRun, getRepo } from "../../../src/server/jobs.js";
import { DEFAULT_ROLES } from "../../../src/types.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body?.prompt || typeof body.prompt !== "string") {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  const jobId = startRun({
    prompt: body.prompt,
    contacts: body.contacts === true,
    roles: Array.isArray(body.roles) && body.roles.length ? body.roles : DEFAULT_ROLES,
  });
  return NextResponse.json({ jobId }, { status: 201 });
}

export async function GET() {
  return NextResponse.json({ jobs: getRepo().listJobs() });
}
```

`app/api/runs/[id]/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getRepo } from "../../../../src/server/jobs.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getRepo().getJob(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(job);
}
```

- [ ] **Step 6: Verify build + full test suite**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server app/api
git commit -m "feat: job runner + /api/runs routes"
```

---

### Task 13: CLI runner, README, and gated e2e

**Files:**
- Create: `scripts/run.ts`
- Create: `README.md`
- Create: `src/e2e.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `startRun`-style logic but synchronous/awaited for CLI; `runPipeline`, `getRepo`, `newJobId`.
- Produces: a CLI `npm run prospect -- "<prompt>" [--contacts] [--roles=a,b]` that runs the pipeline to completion and prints the output paths.

- [ ] **Step 1: Add `.gitignore` entries**

Append to `.gitignore` (create if missing):
```
node_modules/
.next/
.env.local
prospect.db
prospect.db-*
runs/
```

- [ ] **Step 2: Write the CLI**

`scripts/run.ts`:
```ts
import { runPipeline } from "../src/pipeline/run.js";
import { getRepo, newJobId } from "../src/server/jobs.js";
import { DEFAULT_ROLES, type RunParams } from "../src/types.js";

function parseArgs(argv: string[]): RunParams {
  const prompt = argv.find((a) => !a.startsWith("--"));
  if (!prompt) {
    console.error('Usage: npm run prospect -- "Series A dev tool companies" [--contacts] [--roles=founder,eng-leadership]');
    process.exit(1);
  }
  const rolesArg = argv.find((a) => a.startsWith("--roles="));
  return {
    prompt,
    contacts: argv.includes("--contacts"),
    roles: rolesArg ? rolesArg.slice("--roles=".length).split(",") : DEFAULT_ROLES,
  };
}

const params = parseArgs(process.argv.slice(2));
const repo = getRepo();
const id = newJobId();
repo.createJob(id, params);
console.log(`Running ${id} — "${params.prompt}" (contacts: ${params.contacts})`);
await runPipeline(id, params, repo);
const job = repo.getJob(id)!;
console.log(`Status: ${job.status}`);
if (job.error) console.error("Error:", job.error);
console.log("Counts:", job.progress);
console.log(`Output: runs/${id}/  (companies.csv, people.csv, people.json)`);
```

- [ ] **Step 3: Write the README**

`README.md`:
```markdown
# Prospect

Prompt → ICP companies → key people → enriched dossiers. Collected into a shared SQLite DB with CSV/JSON exports.

## Setup
1. `npm install`
2. `cp .env.local.example .env.local` and set `ORANGESLICE_API_KEY` (or run `npx orangeslice login`).

## CLI (local one-off)
```bash
npm run prospect -- "Series A dev tool companies"          # cheap dry run (no contact lookups)
npm run prospect -- "Series A dev tool companies" --contacts   # spends credits on emails/phones
```
Outputs land in `runs/<jobId>/`.

## Server
```bash
npm run build && npm start    # long-running Node server
curl -X POST localhost:3000/api/runs -H 'content-type: application/json' \
  -d '{"prompt":"Series A dev tool companies","contacts":false}'
# → {"jobId":"job_..."}
curl localhost:3000/api/runs/<jobId>   # poll status + counts
```

## Cost note
`--contacts` calls `person.contact.get` (up to ~275 credits/person, ~10 min each, parallelized).
Already-enriched people are skipped automatically (credit cache).
```

- [ ] **Step 4: Write the gated e2e test (no credits in CI)**

`src/e2e.test.ts`:
```ts
import { test, expect } from "vitest";
import { runPipeline } from "./pipeline/run.js";
import { Repo } from "./storage/repo.js";
import { openDb } from "./storage/db.js";

const runE2E = process.env.PROSPECT_E2E === "1";

test.runIf(runE2E)("real pipeline finds companies + people (dry run, no contacts)", async () => {
  const repo = new Repo(openDb(":memory:"));
  repo.createJob("e2e", { prompt: "Series A dev tool companies", contacts: false, roles: ["founder", "eng-leadership"] });
  await runPipeline("e2e", { prompt: "Series A dev tool companies", contacts: false, roles: ["founder", "eng-leadership"] }, repo, "runs");
  const job = repo.getJob("e2e")!;
  expect(job.status).toBe("completed");
  expect(job.progress.companies).toBeGreaterThan(0);
}, 600_000);
```

- [ ] **Step 5: Run unit suite (e2e auto-skips)**

Run: `npm test`
Expected: all pass; the e2e test is skipped (no `PROSPECT_E2E`).

- [ ] **Step 6: (Manual, spends credits) Run the real dry-run e2e**

Run: `PROSPECT_E2E=1 npx vitest run src/e2e.test.ts`
Expected: completes with `companies > 0`. Inspect `runs/e2e/companies.csv`.
**Do not run in CI.** Requires `ORANGESLICE_API_KEY`.

- [ ] **Step 7: Commit**

```bash
git add scripts/run.ts README.md src/e2e.test.ts .gitignore
git commit -m "feat: CLI runner, README, gated e2e"
```

---

## Self-Review

**Spec coverage:**
- Summary / run-and-collect via API → Tasks 11, 12. ✓
- Pipeline stages [0]–[7] → interpret (6), companies (7), people (8), enrich incl. contact+signals (9), output (10), orchestration (11). ✓
- Default 20×3, founders + eng leadership → Tasks 7/8/11 + `DEFAULT_ROLES` (2). ✓
- Contact gate + credit cache (`last_enriched_at`, skip) → Tasks 5 (`needsContact`), 9 (`skipContact`), 11 (wiring). ✓
- Storage: jobs/companies/people/signals tables, SQLite shared → Tasks 4/5. (Driver = `better-sqlite3`, overriding the spec's tentative `node:sqlite` for Next.js flag-friction; rationale in Global Constraints.) ✓
- Concurrency (`Promise.all`/batchSearch) + failure isolation (`allSettled`) → Tasks 7/8/9/11. ✓
- Error handling: per-person isolation, missing contact → nulls, job marked failed → Tasks 9/11. ✓
- API: `POST /api/runs`, `GET /api/runs/:id`, `GET /api/runs` → Task 12. ✓
- Output shapes (companies.csv, people.csv, people.json) → Task 10. ✓
- CLI + dry-run-first workflow → Task 13. ✓
- Non-goals (no UI/auth/IG-FB/Postgres now) → respected; future phases untouched. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; every test step has real assertions. ✓

**Type consistency:** `RunParams`, `Progress`, `Job`, `Company`, `Person`, `EnrichedPerson`, `Signal`, `ICP` defined in Task 2 and used with identical field names throughout (`fitScore`, `linkedinUrl`, `companyDomain`, `workEmail`, `personalEmail`, `lastEnrichedAt`). Repo method names (`needsContact`, `upsertPerson`, `addSignals`) match their callers in Task 11. SDK seam `../orange.js` mocked identically in every pipeline test. ✓
