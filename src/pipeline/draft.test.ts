import { test, expect, vi, beforeEach } from "vitest";

const { generateObject } = vi.hoisted(() => ({ generateObject: vi.fn() }));
vi.mock("../orange.js", () => ({ services: { ai: { generateObject } } }));

import { draftEmail } from "./draft.js";
import type { EnrichedPerson, SenderProfile, Synthesis } from "../types.js";

const person: EnrichedPerson = {
  linkedinUrl: "u", companyDomain: "acme.com", name: "Jane Doe", title: "CTO",
  headline: "CTO at Acme", twitter: null, workEmail: null, personalEmail: null, phone: null,
  skills: ["Go"], experience: [], education: [], certifications: [], languages: [],
  isInfluencer: false, jobsCount: null, recommenderCount: null,
  posts: [{ source: "linkedin", text: "Shipping our infra platform", url: null, postedAt: null, likes: null }],
  webMentions: [], rawProfile: null,
};
const synthesis: Synthesis = {
  summary: "CTO focused on infra.", interests: ["infra"], hooks: [{ angle: "her infra post", why: "she posted about it" }],
  currentFocus: "Shipping the new infra platform", interestProfile: [{ category: "Infra", score: 90 }],
};
const profile: SenderProfile = {
  senderName: "Sam", senderCompany: "DeployCo", offer: "a faster CI platform",
  valueProp: "cut build times 60%", socialProof: "used by Stripe and Vercel",
  cta: "open to a quick 15-min call?", tone: "warm and direct",
};

beforeEach(() => generateObject.mockReset());

test("maps the model object to {subject, body}", async () => {
  generateObject.mockResolvedValue({ object: { subject: "Faster CI for Acme", body: "Hi Jane, ..." } });
  const out = await draftEmail(person, synthesis, profile);
  expect(out).toEqual({ subject: "Faster CI for Acme", body: "Hi Jane, ..." });
});

test("prompt includes the offer and a grounded person fact", async () => {
  generateObject.mockResolvedValue({ object: { subject: "", body: "" } });
  await draftEmail(person, synthesis, profile);
  const prompt = generateObject.mock.calls[0][0].prompt as string;
  expect(prompt).toContain("a faster CI platform");           // offer
  expect(prompt).toContain("used by Stripe and Vercel");      // social proof
  expect(prompt).toContain("open to a quick 15-min call?");   // cta
  expect(prompt).toContain("Shipping the new infra platform"); // grounded fact (currentFocus)
});

test("degrades to an empty draft on failure", async () => {
  generateObject.mockRejectedValueOnce(new Error("ai down"));
  expect(await draftEmail(person, synthesis, profile)).toEqual({ subject: "", body: "" });
});
