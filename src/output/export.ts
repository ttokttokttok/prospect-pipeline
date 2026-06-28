import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Company, EnrichedPerson } from "../types";

function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: unknown[][]): string {
  return [header.join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
}

export function companiesCsv(companies: Company[]): string {
  return toCsv(
    ["name", "domain", "linkedin", "fit_score", "why"],
    companies.map((c) => [c.name, c.domain, c.linkedin, c.fitScore, c.why]),
  );
}

export function peopleCsv(people: EnrichedPerson[]): string {
  return toCsv(
    ["name", "title", "company", "linkedin", "twitter", "work_email", "personal_email", "phone"],
    people.map((p) => [p.name, p.title, p.companyDomain, p.linkedinUrl, p.twitter, p.workEmail, p.personalEmail, p.phone]),
  );
}

export async function writeRun(
  dir: string,
  data: { companies: Company[]; people: EnrichedPerson[] },
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(join(dir, "companies.csv"), companiesCsv(data.companies)),
    writeFile(join(dir, "people.csv"), peopleCsv(data.people)),
    writeFile(join(dir, "people.json"), JSON.stringify(data.people, null, 2)),
  ]);
}
