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
