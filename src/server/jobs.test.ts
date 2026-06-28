import { test, expect, vi, beforeEach } from "vitest";

const { runPipeline } = vi.hoisted(() => ({ runPipeline: vi.fn() }));
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
