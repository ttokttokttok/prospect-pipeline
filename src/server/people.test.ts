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
