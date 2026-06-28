import { test, expect, vi, beforeEach } from "vitest";

const { linkedinEnrich, contactGet, batchSearch, apifyRun } = vi.hoisted(() => ({
  linkedinEnrich: vi.fn(),
  contactGet: vi.fn(),
  batchSearch: vi.fn(),
  apifyRun: vi.fn(),
}));
vi.mock("../orange.js", () => ({
  services: {
    person: { linkedin: { enrich: linkedinEnrich }, contact: { get: contactGet } },
    web: { batchSearch },
    apify: { runActor: apifyRun },
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
  apifyRun.mockReset();
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

test("does not fetch posts when posts flag is off", async () => {
  const out = await enrichPerson(person, { contacts: false });
  expect(out.posts).toEqual([]);
  expect(apifyRun).not.toHaveBeenCalled();
});

test("fetches and maps linkedin posts when posts=true", async () => {
  apifyRun.mockResolvedValue({
    items: [
      {
        content: "Shipping v2 today!",
        linkedinUrl: "https://linkedin.com/posts/1",
        postedAt: { date: "2026-06-01T00:00:00Z" },
        engagement: { likes: 42 },
      },
    ],
    usageTotalUsd: 0.01,
  });
  const out = await enrichPerson(person, { contacts: false, posts: true });
  expect(out.posts[0]).toMatchObject({ source: "linkedin", text: "Shipping v2 today!", likes: 42 });
});

test("posts degrade to [] when the actor throws", async () => {
  apifyRun.mockRejectedValue(new Error("apify rate limit"));
  const out = await enrichPerson(person, { contacts: false, posts: true });
  expect(out.posts).toEqual([]);
  expect(out.skills).toEqual(["TypeScript", "Distributed Systems"]); // backbone intact
});
