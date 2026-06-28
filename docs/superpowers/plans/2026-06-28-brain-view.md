# Brain View (Phase 3 — Context Signals + Interest Radar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each person's dossier into a "how to approach them" brain view: AI current-focus + an AI-chosen interest radar, deterministic tenure/recency metrics, and recent posts — with posts + contacts collected by default.

**Architecture:** Extend the existing AI synthesis with `currentFocus` + `interestProfile`; add a pure `computeMetrics` function; surface both on the dossier (recharts radar + chips). Flip posts and contacts to default-on.

**Tech Stack:** TypeScript (ESM), Orange Slice SDK (`src/orange`), better-sqlite3, Vitest, Next.js 16, Tailwind v4, recharts.

## Global Constraints

- **All Orange Slice access through `src/orange`** (single mock seam). AI via `services.ai.generateObject` (`intelligence: "medium"`, cast past the SDK type as done in `synthesize.ts`).
- **ESM.** Non-test source uses extensionless imports; test files use `.js`. Vitest 4.1.9 → `vi.hoisted`.
- **Run `npm run build` after every task** (Vitest does not full-type-check; `next build` does).
- **Defaults:** posts and contacts both default **on**; `--no-posts` / `--no-contacts` (CLI) and `posts:false` / `contacts:false` (API) disable. The `last_enriched_at` credit cache still skips already-enriched people for contacts.
- **Grounding:** AI outputs (`currentFocus`, `interestProfile`) must be grounded in the dossier facts and degrade to `""`/`[]` on failure — never throw.
- **Backend (Tasks 1-4) is TDD'd; UI (Tasks 5-6) is verified by `npm run build` + a manual pass** (no React test runner). Radar uses **recharts**; if it breaks the Turbopack build, load it via `next/dynamic` with `ssr:false`, or fall back to a minimal SVG (last resort).

---

### Task 1: Posts + contacts default-on (CLI/API)

**Files:**
- Create: `src/cli.ts`
- Test: `src/cli.test.ts`
- Modify: `scripts/run.ts`
- Modify: `app/api/runs/route.ts`

**Interfaces:**
- Consumes: `RunParams`, `DEFAULT_ROLES` (unchanged shapes).
- Produces: `parseArgs(argv: string[]): RunParams` exported from `src/cli.ts` — `posts`/`contacts` default `true`, disabled by `--no-posts`/`--no-contacts`. `scripts/run.ts` imports it. API defaults both to true unless `false` is passed.

- [ ] **Step 1: Write the failing test** — `src/cli.test.ts`:

```ts
import { test, expect } from "vitest";
import { parseArgs } from "./cli.js";

test("posts and contacts default ON", () => {
  const p = parseArgs(["Series A dev tools"]);
  expect(p.prompt).toBe("Series A dev tools");
  expect(p.posts).toBe(true);
  expect(p.contacts).toBe(true);
  expect(p.roles).toEqual(["founder", "eng-leadership"]);
});

test("--no-posts and --no-contacts disable each", () => {
  const p = parseArgs(["prompt here", "--no-posts", "--no-contacts"]);
  expect(p.posts).toBe(false);
  expect(p.contacts).toBe(false);
});

test("--roles overrides", () => {
  const p = parseArgs(["prompt", "--roles=founder,cto"]);
  expect(p.roles).toEqual(["founder", "cto"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli.test.ts`
Expected: FAIL ("Cannot find module './cli.js'").

- [ ] **Step 3: Create `src/cli.ts`**

```ts
import { DEFAULT_ROLES, type RunParams } from "./types";

export function parseArgs(argv: string[]): RunParams {
  const prompt = argv.find((a) => !a.startsWith("--"));
  if (!prompt) throw new Error("prompt is required");
  const rolesArg = argv.find((a) => a.startsWith("--roles="));
  return {
    prompt,
    contacts: !argv.includes("--no-contacts"),
    posts: !argv.includes("--no-posts"),
    roles: rolesArg ? rolesArg.slice("--roles=".length).split(",") : DEFAULT_ROLES,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Use it in `scripts/run.ts`** — replace the local `parseArgs` function and its usage. Remove the in-file `function parseArgs(...) { ... }` block entirely and import the shared one. At the top of `scripts/run.ts` add `import { parseArgs } from "../src/cli";` and remove the now-unused `DEFAULT_ROLES` import if it is only used by the old parseArgs (keep `RunParams` import only if still referenced; otherwise remove). Update the usage/help text the CLI prints on missing prompt — since `parseArgs` now throws, wrap the call:

```ts
let params;
try {
  params = parseArgs(process.argv.slice(2));
} catch {
  console.error('Usage: npm run prospect -- "Series A dev tool companies" [--no-posts] [--no-contacts] [--roles=founder,eng-leadership]');
  process.exit(1);
}
```
(Keep the rest of `scripts/run.ts` — the `getRepo`/`newJobId`/`runPipeline` flow — unchanged, using `params`.)

- [ ] **Step 6: Flip API defaults** — in `app/api/runs/route.ts`, change the `startRun({...})` body:

```ts
  const jobId = startRun({
    prompt: body.prompt,
    contacts: body.contacts !== false,
    roles: Array.isArray(body.roles) && body.roles.length ? body.roles : DEFAULT_ROLES,
    posts: body.posts !== false,
  });
```
(`body.prompt` validation above this stays as-is.)

- [ ] **Step 7: Full suite + build**

Run: `npm test && npm run build`
Expected: all pass; build clean (route `/api/runs` still builds; `scripts/run.ts` type-checks).

- [ ] **Step 8: Commit**

```bash
git add src/cli.ts src/cli.test.ts scripts/run.ts app/api/runs/route.ts
git commit -m "feat: posts + contacts default-on (--no-posts/--no-contacts to disable)"
```

---

### Task 2: synthesize — currentFocus + interestProfile

**Files:**
- Modify: `src/types.ts`
- Modify: `src/pipeline/synthesize.ts`
- Modify: `src/pipeline/synthesize.test.ts`

**Interfaces:**
- Consumes: `services.ai.generateObject` (mocked), `EnrichedPerson`.
- Produces:
  - `InterestAxis = { category: string; score: number }` (in `src/types.ts`).
  - `Synthesis` gains `currentFocus: string` and `interestProfile: InterestAxis[]`.
  - `synthesize` populates both (grounded; degrade to `""`/`[]`).

- [ ] **Step 1: Write the failing test** — append to `src/pipeline/synthesize.test.ts`:

```ts
test("maps currentFocus and interestProfile (with numeric score coercion)", async () => {
  generateObject.mockResolvedValue({ object: {
    summary: "x", interests: [], hooks: [],
    currentFocus: "Shipping Acme's infra platform",
    interestProfile: [
      { category: "Infrastructure", score: 90 },
      { category: "Developer Experience", score: "75" }, // string → number
      { category: "", score: 50 },                        // empty category dropped
    ],
  } });
  const out = await synthesize(person);
  expect(out.currentFocus).toBe("Shipping Acme's infra platform");
  expect(out.interestProfile).toEqual([
    { category: "Infrastructure", score: 90 },
    { category: "Developer Experience", score: 75 },
  ]);
});

test("currentFocus/interestProfile degrade to empty on failure", async () => {
  generateObject.mockRejectedValueOnce(new Error("ai down"));
  const out = await synthesize(person);
  expect(out.currentFocus).toBe("");
  expect(out.interestProfile).toEqual([]);
});
```

(The existing degradation test asserting `{ summary:"", interests:[], hooks:[] }` must also still hold — update that test's expected object to include `currentFocus: "", interestProfile: []`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/synthesize.test.ts`
Expected: FAIL (`out.currentFocus` undefined; degradation expected-object mismatch).

- [ ] **Step 3: Add the types** — in `src/types.ts`, add `InterestAxis` and extend `Synthesis`:

```ts
export interface InterestAxis {
  category: string;
  score: number;
}

export interface Synthesis {
  summary: string;
  interests: string[];
  hooks: Hook[];
  currentFocus: string;
  interestProfile: InterestAxis[];
}
```

- [ ] **Step 4: Extend `synthesize.ts`** — add to `SCHEMA.properties` (and `required`):

```ts
    currentFocus: { type: "string", description: "One sentence: what this person is working on/focused on RIGHT NOW, from their current role + most recent posts." },
    interestProfile: {
      type: "array",
      description: "5-7 professional interest categories you choose from the evidence, each scored 0-100 by how strongly the facts support it. Do not fabricate categories.",
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          score: { type: "number", description: "0-100 intensity." },
        },
        required: ["category", "score"],
      },
    },
```
Add `currentFocus` and `interestProfile` to the `required` array. Update the prompt's instruction sentence to: `... write a short professional summary, the person's interest themes, a one-sentence current focus, a 5-7 category interest profile scored 0-100, and 2-3 specific cold-email hooks. Each hook's "why" MUST cite a specific fact below. Do NOT fabricate anything.`

Then extend the returned object mapping:

```ts
    return {
      summary: typeof object.summary === "string" ? object.summary : "",
      interests: Array.isArray(object.interests) ? object.interests : [],
      hooks: Array.isArray(object.hooks)
        ? object.hooks.map((h: any) => ({ angle: String(h?.angle ?? ""), why: String(h?.why ?? "") })).filter((h: any) => h.angle)
        : [],
      currentFocus: typeof object.currentFocus === "string" ? object.currentFocus : "",
      interestProfile: Array.isArray(object.interestProfile)
        ? object.interestProfile
            .map((a: any) => ({ category: String(a?.category ?? ""), score: Number(a?.score) || 0 }))
            .filter((a: any) => a.category)
        : [],
    };
```
And update the `catch` return to `{ summary: "", interests: [], hooks: [], currentFocus: "", interestProfile: [] }`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/pipeline/synthesize.test.ts`
Expected: PASS.

- [ ] **Step 6: Build (type-check picks up the new required Synthesis fields)**

Run: `npm run build`
Expected: clean. (If any other `Synthesis` literal exists in the codebase it would error here — there are none outside tests; the dossier page reads fields optionally.)

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/pipeline/synthesize.ts src/pipeline/synthesize.test.ts
git commit -m "feat: synthesis currentFocus + AI-chosen interest profile (radar data)"
```

---

### Task 3: computeMetrics (tenure + recency)

**Files:**
- Modify: `src/types.ts`
- Create: `src/pipeline/metrics.ts`
- Test: `src/pipeline/metrics.test.ts`

**Interfaces:**
- Consumes: `EnrichedPerson`.
- Produces:
  - `PersonMetrics = { tenureMonths: number | null; recentlyActive: boolean; lastPostAt: string | null }` (in `src/types.ts`).
  - `computeMetrics(person: EnrichedPerson, now?: Date): PersonMetrics` (pure; `now` injectable for tests).

- [ ] **Step 1: Write the failing test** — `src/pipeline/metrics.test.ts`:

```ts
import { test, expect } from "vitest";
import { computeMetrics } from "./metrics.js";
import type { EnrichedPerson } from "../types.js";

const base: EnrichedPerson = {
  linkedinUrl: "u", companyDomain: "acme.com", name: "Jane", title: "CTO",
  headline: null, twitter: null, workEmail: null, personalEmail: null, phone: null,
  skills: [], experience: [], education: [], certifications: [], languages: [],
  isInfluencer: false, jobsCount: null, recommenderCount: null, posts: [], webMentions: [], rawProfile: null,
};
const NOW = new Date("2026-06-28T00:00:00Z");

test("tenureMonths from the current role's start date", () => {
  const p = { ...base, experience: [
    { title: "CTO", company: "Acme", companyDomain: "acme.com", isCurrent: true, startDate: "2024-06-01", endDate: null, summary: null },
  ] };
  expect(computeMetrics(p, NOW).tenureMonths).toBe(24);
});

test("tenureMonths null when no current role / no start date", () => {
  expect(computeMetrics(base, NOW).tenureMonths).toBeNull();
});

test("recentlyActive + lastPostAt from the most recent post", () => {
  const p = { ...base, posts: [
    { source: "linkedin" as const, text: "a", url: null, postedAt: "2026-01-01", likes: null },
    { source: "linkedin" as const, text: "b", url: null, postedAt: "2026-06-10", likes: null },
  ] };
  const m = computeMetrics(p, NOW);
  expect(m.lastPostAt).toBe("2026-06-10");
  expect(m.recentlyActive).toBe(true); // within 90 days of NOW
});

test("not recentlyActive when newest post is old; null lastPostAt with no posts", () => {
  const old = computeMetrics({ ...base, posts: [{ source: "linkedin", text: "a", url: null, postedAt: "2025-01-01", likes: null }] }, NOW);
  expect(old.recentlyActive).toBe(false);
  const none = computeMetrics(base, NOW);
  expect(none.lastPostAt).toBeNull();
  expect(none.recentlyActive).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pipeline/metrics.test.ts`
Expected: FAIL ("Cannot find module './metrics.js'").

- [ ] **Step 3: Add `PersonMetrics` to `src/types.ts`**

```ts
export interface PersonMetrics {
  tenureMonths: number | null;
  recentlyActive: boolean;
  lastPostAt: string | null;
}
```

- [ ] **Step 4: Implement `src/pipeline/metrics.ts`**

```ts
import type { EnrichedPerson, PersonMetrics } from "../types";

const DAY = 24 * 60 * 60 * 1000;

export function computeMetrics(person: EnrichedPerson, now: Date = new Date()): PersonMetrics {
  return {
    tenureMonths: tenure(person, now),
    lastPostAt: lastPost(person),
    recentlyActive: recentlyActive(person, now),
  };
}

function tenure(person: EnrichedPerson, now: Date): number | null {
  const current = person.experience.find((e) => e.isCurrent && e.startDate);
  if (!current?.startDate) return null;
  const start = new Date(current.startDate);
  if (isNaN(start.getTime())) return null;
  return (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
}

function lastPost(person: EnrichedPerson): string | null {
  const dated = person.posts.filter((p) => p.postedAt);
  if (!dated.length) return null;
  return dated.reduce((max, p) => (p.postedAt! > max ? p.postedAt! : max), dated[0].postedAt!);
}

function recentlyActive(person: EnrichedPerson, now: Date): boolean {
  const last = lastPost(person);
  if (!last) return false;
  const d = new Date(last);
  if (isNaN(d.getTime())) return false;
  return now.getTime() - d.getTime() <= 90 * DAY;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/pipeline/metrics.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/pipeline/metrics.ts src/pipeline/metrics.test.ts
git commit -m "feat: computeMetrics (tenure + posts-only recency)"
```

---

### Task 4: getPersonDetail returns metrics

**Files:**
- Modify: `src/server/people.ts`
- Modify: `src/server/people.test.ts`

**Interfaces:**
- Consumes: `computeMetrics` (Task 3), `PersonMetrics`.
- Produces: `getPersonDetail` returns `{ dossier, synthesis, metrics: PersonMetrics } | null`.

- [ ] **Step 1: Write the failing test** — append to `src/server/people.test.ts`:

```ts
test("getPersonDetail includes computed metrics", () => {
  const detail = getPersonDetail(repo, encodeId(url))!;
  expect(detail.metrics).toBeDefined();
  expect(detail.metrics).toHaveProperty("tenureMonths");
  expect(detail.metrics).toHaveProperty("recentlyActive");
  expect(detail.metrics).toHaveProperty("lastPostAt");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/people.test.ts`
Expected: FAIL (`detail.metrics` undefined).

- [ ] **Step 3: Update `getPersonDetail`** — in `src/server/people.ts`, add `import { computeMetrics } from "../pipeline/metrics";` and `import type { ..., PersonMetrics } from "../types";` (merge into existing type import), then:

```ts
export function getPersonDetail(
  repo: Repo,
  id: string,
): { dossier: EnrichedPerson; synthesis: Synthesis | null; metrics: PersonMetrics } | null {
  const url = decodeId(id);
  const dossier = repo.getDossier(url);
  if (!dossier) return null;
  return { dossier, synthesis: repo.getSynthesis(url), metrics: computeMetrics(dossier) };
}
```
(This also resolves the earlier double-`decodeId` minor by introducing the `url` local.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/people.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + build**

Run: `npm test && npm run build`
Expected: all pass; build clean (the `/api/people/[id]` route returns the richer detail automatically).

- [ ] **Step 6: Commit**

```bash
git add src/server/people.ts src/server/people.test.ts
git commit -m "feat: person detail includes computed metrics"
```

---

### Task 5: recharts install + interest radar component

**Files:**
- Modify: `package.json` (recharts dep)
- Create: `src/ui/radar.tsx`

**Interfaces:**
- Consumes: `InterestAxis` (type), recharts.
- Produces: `InterestRadar({ data }: { data: InterestAxis[] })` — a `"use client"` component; renders nothing when `data` is empty. Verified by build.

- [ ] **Step 1: Install recharts**

Run: `npm install recharts`

- [ ] **Step 2: Create `src/ui/radar.tsx`**

```tsx
"use client";

import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from "recharts";
import type { InterestAxis } from "../types";

export function InterestRadar({ data }: { data: InterestAxis[] }) {
  if (!data.length) return null;
  return (
    <div style={{ width: "100%", height: 300 }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid />
          <PolarAngleAxis dataKey="category" tick={{ fontSize: 11, fill: "#525252" }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar dataKey="score" stroke="#2563eb" fill="#3b82f6" fillOpacity={0.4} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Build to verify recharts works under Next 16 / Turbopack**

Run: `npm run build`
Expected: build succeeds. **If it fails** with an SSR/ESM error from recharts, apply the documented fallback: rename this file to `src/ui/radar-impl.tsx`, and create `src/ui/radar.tsx` that does `import dynamic from "next/dynamic"; export const InterestRadar = dynamic(() => import("./radar-impl").then(m => m.InterestRadar), { ssr: false });`. Re-run the build. If recharts still cannot build, report DONE_WITH_CONCERNS and note it — the controller will decide between a different lib and a minimal SVG.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/ui/radar.tsx
git commit -m "feat: recharts interest radar component"
```

---

### Task 6: Dossier brain view (current focus + chips + radar + recent posts)

**Files:**
- Modify: `app/people/[id]/page.tsx`

**Interfaces:**
- Consumes: `GET /api/people/:id` (now `{ dossier, synthesis, metrics }`), `InterestRadar` (Task 5), `PersonMetrics`/`Synthesis`/`EnrichedPerson` types.
- Produces: the brain view. Verified by build + manual.

- [ ] **Step 1: Add metrics state + type imports** — in `app/people/[id]/page.tsx`:
  - Extend the type import: `import type { EnrichedPerson, Synthesis, PersonMetrics } from "../../../src/types";`
  - Add: `import { InterestRadar } from "../../../src/ui/radar";`
  - Add state: `const [metrics, setMetrics] = useState<PersonMetrics | null>(null);`
  - In the mount effect, after `setSynthesis(data.synthesis);` add `setMetrics(data.metrics);`

- [ ] **Step 2: Render current focus + context chips** — in the header area (right after the headline/links block, before the AI synthesis Card), insert:

```tsx
      {(synthesis?.currentFocus || metrics) && (
        <div className="mt-3 rounded-lg bg-blue-50 p-3">
          {synthesis?.currentFocus && (
            <p className="text-sm"><span className="font-semibold text-blue-900">✦ Current focus: </span><span className="text-blue-900">{synthesis.currentFocus}</span></p>
          )}
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-600">
            {metrics?.tenureMonths != null && <span>⏳ {fmtTenure(metrics.tenureMonths)} at {p.companyDomain}</span>}
            {metrics?.recentlyActive && <span>🟢 Active recently</span>}
            {!metrics?.recentlyActive && metrics?.lastPostAt && <span>Last posted {metrics.lastPostAt}</span>}
          </div>
        </div>
      )}
```
And add this helper near the bottom `Section` helper:
```tsx
function fmtTenure(months: number): string {
  if (months < 12) return `${months} mo`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y}y ${m}mo` : `${y} yr${y > 1 ? "s" : ""}`;
}
```

- [ ] **Step 3: Render the radar inside the AI synthesis block** — in the synthesis content branch (where `synthesis.interests` badges render), add the radar above or below the interest badges, and keep the badges as a fallback when the profile is empty:

```tsx
            {synthesis.interestProfile && synthesis.interestProfile.length > 0 ? (
              <div className="mt-3"><InterestRadar data={synthesis.interestProfile} /></div>
            ) : synthesis.interests.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {synthesis.interests.map((t) => <Badge key={t} className="bg-blue-50 text-blue-700">{t}</Badge>)}
              </div>
            ) : null}
```
(Replace the existing `synthesis.interests.length > 0 && (...)` block with this combined conditional.)

- [ ] **Step 4: Show the 3 most recent posts (sorted)** — in the "Recent posts" Section, sort by `postedAt` desc and cap at 3:

```tsx
      {p.posts.length > 0 && (
        <Section title="Recent posts">
          <div className="space-y-2">
            {[...p.posts]
              .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
              .slice(0, 3)
              .map((post, i) => (
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
```

- [ ] **Step 5: Build + manual check**

Run: `npm run build`
Expected: build succeeds (route `/people/[id]`).
Manual (controller will do this): run dev, open a person whose synthesis has been regenerated (so `interestProfile`/`currentFocus` exist) and who has posts — confirm the radar renders, the current-focus line + tenure/recency chips show, and the 3 most-recent posts appear. Sections with no data stay hidden.

- [ ] **Step 6: Commit**

```bash
git add "app/people/[id]/page.tsx"
git commit -m "feat: dossier brain view — current focus, context chips, interest radar, recent posts"
```

---

## Self-Review

**Spec coverage:**
- Posts + contacts default-on (CLI `--no-*`, API `!==false`) → Task 1. ✓
- AI `currentFocus` + `interestProfile` (5-7 axes, 0-100, grounded, degrade) folded into existing synthesis call → Task 2. ✓
- Deterministic `tenureMonths` + posts-only `recentlyActive`/`lastPostAt` → Task 3. ✓
- `getPersonDetail` returns `metrics` → Task 4. ✓
- recharts radar (with documented dynamic/SSR fallback) → Task 5. ✓
- Dossier: current-focus headline + context chips + radar (fallback to interest tags) + 3 most-recent posts → Task 6. ✓
- Grounding + graceful degradation (empty → hidden, not crash) → Tasks 2/6. ✓
- Backend TDD'd; UI build+manual → Tasks 1-4 vs 5-6. ✓

**Placeholder scan:** No TBD/TODO. The recharts fallback (Task 5 Step 3) is a concrete contingency with exact code, not a placeholder. UI verification is build+manual per the spec's stated testing decision.

**Type consistency:** `InterestAxis` (Task 2) feeds `interestProfile` on `Synthesis` (Task 2) → `InterestRadar` prop (Task 5) → dossier render (Task 6), identical shape throughout. `PersonMetrics` (Task 3) returned by `computeMetrics` (Task 3) → `getPersonDetail` (Task 4) → dossier `metrics` state (Task 6). `RunParams` (unchanged shape) defaults set in `parseArgs` (Task 1) and the API (Task 1). `Synthesis` gains required `currentFocus`/`interestProfile`; the only non-test constructor is `synthesize` (Task 2) + its `catch`; the dossier reads them optionally (`synthesis?.currentFocus`, `synthesis.interestProfile`).
