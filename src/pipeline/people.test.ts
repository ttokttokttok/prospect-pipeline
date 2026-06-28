import { test, expect, vi, beforeEach } from "vitest";

const { getEmployees, findUrl } = vi.hoisted(() => ({
  getEmployees: vi.fn(),
  findUrl: vi.fn(),
}));
vi.mock("../orange.js", () => ({
  services: { company: { getEmployeesFromLinkedin: getEmployees, linkedin: { findUrl } } },
}));

import { findPeople } from "./people.js";
import type { Company } from "../types.js";

const company: Company = {
  domain: "acme.com", name: "Acme", linkedin: "https://linkedin.com/company/acme",
  description: null, fitScore: 90, why: "", source: "crunchbase",
};

beforeEach(() => {
  getEmployees.mockReset();
  findUrl.mockReset();
});

test("merges founders (web) + eng leadership (db), dedupes, caps at perCompany", async () => {
  getEmployees
    // founders (web strategy)
    .mockResolvedValueOnce({ employees: [
      { name: "Ana Founder", title: "CEO & Co-Founder", linkedinUrl: "https://linkedin.com/in/ana" },
      { name: "Dup", title: "CTO", linkedinUrl: "https://linkedin.com/in/ana" },
    ] })
    // eng leadership (database strategy)
    .mockResolvedValueOnce({ employees: [
      { name: "Bo Eng", title: "VP Engineering", linkedinUrl: "https://linkedin.com/in/bo" },
      { name: "Cy Eng", title: "Head of Platform", linkedinUrl: "https://linkedin.com/in/cy" },
    ] });
  const people = await findPeople(company, ["founder", "eng-leadership"], 3);
  const urls = people.map((p) => p.linkedinUrl);
  expect(new Set(urls).size).toBe(urls.length); // no dupes
  expect(people).toHaveLength(3);
  expect(people[0].companyDomain).toBe("acme.com");
});

test("resolves company linkedin url when missing", async () => {
  findUrl.mockResolvedValue("https://linkedin.com/company/acme");
  getEmployees.mockResolvedValue({ employees: [] });
  await findPeople({ ...company, linkedin: null }, ["founder"], 3);
  expect(findUrl).toHaveBeenCalledWith(expect.objectContaining({ website: "acme.com" }));
});

test("skips people with no linkedinUrl", async () => {
  getEmployees.mockResolvedValue({ employees: [{ name: "No URL", title: "CEO", linkedinUrl: null }] });
  const people = await findPeople(company, ["founder"], 3);
  expect(people).toHaveLength(0);
});
