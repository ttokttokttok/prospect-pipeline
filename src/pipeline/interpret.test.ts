import { test, expect, vi, beforeEach } from "vitest";

const generateObject = vi.hoisted(() => vi.fn());
vi.mock("../orange.js", () => ({ services: { ai: { generateObject } } }));

import { interpret } from "./interpret.js";

beforeEach(() => generateObject.mockReset());

test("interpret maps generateObject output into an ICP", async () => {
  generateObject.mockResolvedValue({
    object: { fundingStage: "series_a", keywords: ["developer tools", "devtools"], industry: "Software", geo: "US", sizeMax: 200 },
  });
  const icp = await interpret("Series A dev tool companies in the US");
  expect(icp.fundingStage).toBe("series_a");
  expect(icp.keywords).toContain("devtools");
  expect(icp.sizeMax).toBe(200);
});

test("interpret tolerates missing fields with safe defaults", async () => {
  generateObject.mockResolvedValue({ object: { keywords: ["fintech"] } });
  const icp = await interpret("fintech startups");
  expect(icp.fundingStage).toBeNull();
  expect(icp.keywords).toEqual(["fintech"]);
  expect(icp.geo).toBeNull();
});
