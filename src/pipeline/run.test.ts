import { test, expect, vi, beforeEach } from "vitest";

const { interpret, discoverCompanies, findPeople, enrichPerson, writeRun } = vi.hoisted(() => ({
  interpret: vi.fn(),
  discoverCompanies: vi.fn(),
  findPeople: vi.fn(),
  enrichPerson: vi.fn(),
  writeRun: vi.fn(),
}));
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
    headline: null, twitter: null, workEmail: null, personalEmail: null, phone: null,
    skills: [], experience: [], education: [], certifications: [], languages: [],
    isInfluencer: false, jobsCount: null, recommenderCount: null, posts: [], webMentions: [], rawProfile: null,
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
    .mockResolvedValueOnce({ linkedinUrl: "https://linkedin.com/in/ok", companyDomain: "acme.com", name: "OK", title: "CTO", headline: null, twitter: null, workEmail: null, personalEmail: null, phone: null, skills: [], experience: [], education: [], certifications: [], languages: [], isInfluencer: false, jobsCount: null, recommenderCount: null, posts: [], webMentions: [], rawProfile: null })
    .mockRejectedValueOnce(new Error("enrich boom"));
  repo.createJob("job3", params);
  await runPipeline("job3", params, repo, "/tmp/prospect-test");
  const job = repo.getJob("job3")!;
  expect(job.status).toBe("completed");
  expect(job.progress.people).toBe(1); // only the successful one persisted
});
