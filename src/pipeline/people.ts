import { services } from "../orange";
import type { Company, Person } from "../types";

interface RawEmployee {
  lp_public_profile_url: string | null;
  lp_formatted_name: string | null;
  lp_title: string | null;
}

export async function findPeople(company: Company, roles: string[], perCompany = 3): Promise<Person[]> {
  const linkedinUrl = company.linkedin ?? (await resolveCompanyUrl(company));
  if (!linkedinUrl) return [];

  const batches = await Promise.all(roles.map((role) => fetchRole(linkedinUrl, role)));
  const merged: RawEmployee[] = batches.flat();

  const byUrl = new Map<string, Person>();
  for (const e of merged) {
    if (!e?.lp_public_profile_url) continue;
    if (byUrl.has(e.lp_public_profile_url)) continue;
    byUrl.set(e.lp_public_profile_url, {
      linkedinUrl: e.lp_public_profile_url,
      companyDomain: company.domain,
      name: e.lp_formatted_name ?? "",
      title: e.lp_title ?? null,
    });
  }
  return [...byUrl.values()].slice(0, perCompany);
}

async function resolveCompanyUrl(company: Company): Promise<string | null> {
  try {
    return await services.company.linkedin.findUrl({ companyName: company.name, website: company.domain });
  } catch {
    return null;
  }
}

async function fetchRole(linkedinUrl: string, role: string): Promise<RawEmployee[]> {
  try {
    if (role === "founder") {
      const { employees } = await services.company.getEmployeesFromLinkedin({
        linkedinUrl,
        searchStrategy: "web",
        titleVariations: ["founder", "ceo", "cto"], // web strategy: max 3 variations
        limit: 10,
      });
      return (employees ?? []) as RawEmployee[];
    }
    if (role === "eng-leadership") {
      const { employees } = await services.company.getEmployeesFromLinkedin({
        linkedinUrl,
        searchStrategy: "database",
        titleSqlFilter: "pos.title ~* '\\m(VP|Director|Head)\\M' AND pos.title ~* '\\m(Engineering|Platform|Infrastructure)\\M'",
        limit: 10,
      });
      return (employees ?? []) as RawEmployee[];
    }
    // generic role keyword → database title search
    const { employees } = await services.company.getEmployeesFromLinkedin({
      linkedinUrl,
      searchStrategy: "database",
      titleVariations: [role],
      limit: 10,
    });
    return (employees ?? []) as RawEmployee[];
  } catch {
    return [];
  }
}
