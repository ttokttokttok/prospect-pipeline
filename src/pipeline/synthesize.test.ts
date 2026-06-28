import { test, expect, vi, beforeEach } from "vitest";

const { generateObject } = vi.hoisted(() => ({
  generateObject: vi.fn(),
}));
vi.mock("../orange.js", () => ({
  services: {
    ai: { generateObject },
  },
}));

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
  generateObject.mockRejectedValueOnce(new Error("ai down"));
  const out = await synthesize(person);
  expect(out).toEqual({ summary: "", interests: [], hooks: [] });
});
