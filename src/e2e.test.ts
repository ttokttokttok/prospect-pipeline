import { test, expect } from "vitest";
import { runPipeline } from "./pipeline/run.js";
import { Repo } from "./storage/repo.js";
import { openDb } from "./storage/db.js";

const runE2E = process.env.PROSPECT_E2E === "1";

test.runIf(runE2E)("real pipeline finds companies + people (dry run, no contacts)", async () => {
  const repo = new Repo(openDb(":memory:"));
  repo.createJob("e2e", { prompt: "Series A dev tool companies", contacts: false, roles: ["founder", "eng-leadership"], posts: false });
  await runPipeline("e2e", { prompt: "Series A dev tool companies", contacts: false, roles: ["founder", "eng-leadership"], posts: false }, repo, "runs");
  const job = repo.getJob("e2e")!;
  expect(job.status).toBe("completed");
  expect(job.progress.companies).toBeGreaterThan(0);

  // Inspect the persisted dossier of the first kept person.
  const fs = await import("node:fs/promises");
  const peopleJson = JSON.parse(await fs.readFile("runs/e2e/people.json", "utf8"));
  const withSkills = peopleJson.filter((p: any) => (p.skills?.length ?? 0) > 0).length;
  console.log(`[e2e] people=${peopleJson.length} withSkills=${withSkills} ` +
    `withExperience=${peopleJson.filter((p: any) => (p.experience?.length ?? 0) > 0).length} ` +
    `withMentions=${peopleJson.filter((p: any) => (p.webMentions?.length ?? 0) > 0).length} ` +
    `withPosts=${peopleJson.filter((p: any) => (p.posts?.length ?? 0) > 0).length}`);
  expect(withSkills).toBeGreaterThan(0); // the reliable backbone must land live
}, 600_000);
