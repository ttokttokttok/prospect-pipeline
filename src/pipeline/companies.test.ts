import { test, expect, vi, beforeEach } from "vitest";

const { cbSearch, webSearch, generateObject } = vi.hoisted(() => ({
  cbSearch: vi.fn(),
  webSearch: vi.fn(),
  generateObject: vi.fn(),
}));
vi.mock("../orange.js", () => ({
  services: {
    crunchbase: { search: cbSearch },
    web: { search: webSearch },
    ai: { generateObject },
  },
}));

import { discoverCompanies } from "./companies.js";
import type { ICP } from "../types.js";

const icp: ICP = { fundingStage: "series_a", keywords: ["devtools"], industry: null, geo: "US", sizeMax: null };

beforeEach(() => {
  cbSearch.mockReset();
  webSearch.mockReset();
  generateObject.mockReset();
  // default qualifier: score 80
  generateObject.mockResolvedValue({ object: { fitScore: 80, why: "matches devtools + series a" } });
});

test("queries crunchbase when fundingStage is present and dedupes by domain", async () => {
  cbSearch.mockResolvedValue([
    { name: "Acme", website_url: "https://acme.com", linkedin_url: "https://linkedin.com/company/acme", short_description: "dev tool" },
    { name: "Acme Dup", website_url: "https://www.acme.com/", linkedin_url: null, short_description: "dup" },
  ]);
  webSearch.mockResolvedValue({ results: [] });
  const out = await discoverCompanies(icp, 20);
  expect(cbSearch).toHaveBeenCalled();
  expect(out).toHaveLength(1);
  expect(out[0].domain).toBe("acme.com");
  expect(out[0].fitScore).toBe(80);
});

test("sorts by fitScore desc and respects limit", async () => {
  cbSearch.mockResolvedValue([
    { name: "Low", website_url: "https://low.com", linkedin_url: null, short_description: "" },
    { name: "High", website_url: "https://high.com", linkedin_url: null, short_description: "" },
  ]);
  webSearch.mockResolvedValue({ results: [] });
  generateObject
    .mockResolvedValueOnce({ object: { fitScore: 30, why: "" } })
    .mockResolvedValueOnce({ object: { fitScore: 95, why: "" } });
  const out = await discoverCompanies(icp, 1);
  expect(out).toHaveLength(1);
  expect(out[0].name).toBe("High");
});

test("skips crunchbase when fundingStage is null", async () => {
  webSearch.mockResolvedValue({
    results: [{ title: "Foo", link: "https://foo.com", snippet: "a devtool" }],
  });
  const out = await discoverCompanies({ ...icp, fundingStage: null }, 20);
  expect(cbSearch).not.toHaveBeenCalled();
  expect(out[0].domain).toBe("foo.com");
});

test("crunchbase query matches ALL keywords, not just the first", async () => {
  const multi: ICP = { ...icp, keywords: ["devtools", "developer tools", "developer tooling"] };
  cbSearch.mockResolvedValue([]);
  webSearch.mockResolvedValue({ results: [] });
  await discoverCompanies(multi, 20);
  const sql = cbSearch.mock.calls[0][0].sql as string;
  expect(sql).toContain("%devtools%");
  expect(sql).toContain("%developer tools%");
  expect(sql).toContain("%developer tooling%");
  expect(sql).toContain("last_funding_type = 'series_a'");
});

test("returns crunchbase results even when web.search rejects", async () => {
  cbSearch.mockResolvedValue([
    { name: "Acme", website_url: "https://acme.com", linkedin_url: null, short_description: "dev tool" },
  ]);
  webSearch.mockRejectedValue(new Error("web search unavailable"));
  const out = await discoverCompanies(icp, 20);
  expect(out).toHaveLength(1);
  expect(out[0].domain).toBe("acme.com");
});
