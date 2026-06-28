import { test, expect } from "vitest";
import { companiesCsv, peopleCsv } from "./export.js";
import type { Company, EnrichedPerson } from "../types.js";

test("companiesCsv has header and escapes commas/quotes", () => {
  const rows: Company[] = [
    { domain: "acme.com", name: "Acme, Inc", linkedin: null, description: null, fitScore: 90, why: 'says "hi"', source: "web" },
  ];
  const csv = companiesCsv(rows);
  const lines = csv.trim().split("\n");
  expect(lines[0]).toBe("name,domain,linkedin,fit_score,why");
  expect(lines[1]).toContain('"Acme, Inc"');
  expect(lines[1]).toContain('"says ""hi"""');
});

test("peopleCsv flattens contact fields", () => {
  const people: EnrichedPerson[] = [
    { linkedinUrl: "https://linkedin.com/in/jane", companyDomain: "acme.com", name: "Jane", title: "CTO",
      twitter: "janedoe", workEmail: "jane@acme.com", personalEmail: null, phone: null, headline: "CTO", signals: [] },
  ];
  const csv = peopleCsv(people);
  expect(csv.split("\n")[0]).toBe("name,title,company,linkedin,twitter,work_email,personal_email,phone");
  expect(csv).toContain("jane@acme.com");
});
