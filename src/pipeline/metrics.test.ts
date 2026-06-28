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
