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

test("merges founders + eng leadership, dedupes, caps at perCompany", async () => {
  getEmployees
    // founders
    .mockResolvedValueOnce({ employees: [
      { lp_public_profile_url: "https://linkedin.com/in/ana", lp_formatted_name: "Ana Founder", lp_title: "CEO & Co-Founder" },
      { lp_public_profile_url: "https://linkedin.com/in/ana", lp_formatted_name: "Dup", lp_title: "CTO" },
    ] })
    // eng leadership (database strategy)
    .mockResolvedValueOnce({ employees: [
      { lp_public_profile_url: "https://linkedin.com/in/bo", lp_formatted_name: "Bo Eng", lp_title: "VP Engineering" },
      { lp_public_profile_url: "https://linkedin.com/in/cy", lp_formatted_name: "Cy Eng", lp_title: "Head of Platform" },
    ] });
  const people = await findPeople(company, ["founder", "eng-leadership"], 3);
  const urls = people.map((p) => p.linkedinUrl);
  expect(new Set(urls).size).toBe(urls.length); // no dupes
  expect(people).toHaveLength(3);
  expect(people[0].companyDomain).toBe("acme.com");
});

test("founder lookup uses database strategy with usOnly:false (web strategy returned 0)", async () => {
  getEmployees.mockResolvedValue({ employees: [] });
  await findPeople(company, ["founder"], 3);
  const params = getEmployees.mock.calls[0][0];
  expect(params.searchStrategy).toBe("database");
  expect(params.usOnly).toBe(false);
  expect(params.titleSqlFilter).toMatch(/Founder/i);
});

test("resolves company linkedin url when missing", async () => {
  findUrl.mockResolvedValue("https://linkedin.com/company/acme");
  getEmployees.mockResolvedValue({ employees: [] });
  await findPeople({ ...company, linkedin: null }, ["founder"], 3);
  expect(findUrl).toHaveBeenCalledWith(expect.objectContaining({ website: "acme.com" }));
});

test("skips people with no linkedinUrl", async () => {
  getEmployees.mockResolvedValue({ employees: [{ lp_public_profile_url: null, lp_formatted_name: "No URL", lp_title: "CEO" }] });
  const people = await findPeople(company, ["founder"], 3);
  expect(people).toHaveLength(0);
});
