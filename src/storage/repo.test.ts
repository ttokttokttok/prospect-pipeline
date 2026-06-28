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
    headline: null, twitter: null, workEmail: "jane@x.com", personalEmail: null, phone: null,
    skills: [], experience: [], education: [], certifications: [], languages: [],
    isInfluencer: false, jobsCount: null, recommenderCount: null, posts: [], webMentions: [], rawProfile: null,
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
