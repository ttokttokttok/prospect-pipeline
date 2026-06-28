import { services } from "../orange";
import { domainFromUrl } from "../types";
import type { Company, ICP } from "../types";

interface RawCompany {
  name: string;
  domain: string;
  linkedin: string | null;
  description: string | null;
  source: "crunchbase" | "web";
}

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    fitScore: { type: "number", description: "0-100 fit against the ICP." },
    why: { type: "string", description: "One sentence justification." },
  },
  required: ["fitScore", "why"],
};

export async function discoverCompanies(icp: ICP, limit = 20): Promise<Company[]> {
  const [fromCb, fromWeb] = await Promise.all([fromCrunchbase(icp).catch(() => []), fromWeb_(icp).catch(() => [])]);

  // Dedupe by domain (crunchbase wins on conflict — richer data).
  const byDomain = new Map<string, RawCompany>();
  for (const c of [...fromCb, ...fromWeb]) {
    if (!byDomain.has(c.domain)) byDomain.set(c.domain, c);
  }
  const raw = [...byDomain.values()];

  // Score each independently (one generateObject call per company).
  const scored = await Promise.all(
    raw.map(async (c): Promise<Company> => {
      // Crunchbase-sourced companies are already filtered to the ICP's funding
      // stage, so tell the scorer it's verified — otherwise it hedges ("can't
      // confirm Series A") about a fact we've already confirmed via the query.
      const verified =
        c.source === "crunchbase" && icp.fundingStage
          ? `\nVerified funding stage (via Crunchbase): ${icp.fundingStage}`
          : "";
      const { object } = await services.ai.generateObject({
        prompt:
          `Score how well this company fits the ICP (0-100) and explain in one sentence. Do not fabricate.\n\n` +
          `ICP: ${JSON.stringify(icp)}\n\nCompany: ${c.name} — ${c.description ?? "(no description)"} (${c.domain})${verified}`,
        schema: SCORE_SCHEMA,
      });
      return {
        domain: c.domain, name: c.name, linkedin: c.linkedin, description: c.description,
        source: c.source, fitScore: Number(object.fitScore) || 0, why: String(object.why ?? ""),
      };
    }),
  );

  return scored.sort((a, b) => b.fitScore - a.fitScore).slice(0, limit);
}

async function fromCrunchbase(icp: ICP): Promise<RawCompany[]> {
  if (!icp.fundingStage) return [];
  const stage = icp.fundingStage.replace(/'/g, "''");
  // Match ANY of the ICP keywords (interpret often emits jargon like "devtools"
  // first, which matches no descriptions; OR-ing all keywords avoids 0-row results).
  const keywordClause = icp.keywords.length
    ? "AND (" +
      icp.keywords
        .map((k) => {
          const e = k.replace(/'/g, "''");
          return `short_description ILIKE '%${e}%' OR primary_category ILIKE '%${e}%'`;
        })
        .join(" OR ") +
      ")"
    : "";
  const rows = (await services.crunchbase.search({
    sql: `SELECT name, website_url, linkedin_url, short_description
          FROM public.crunchbase_scraper_lean
          WHERE operating_status = 'active'
            AND last_funding_type = '${stage}'
            ${keywordClause}
          ORDER BY rank_org ASC NULLS LAST
          LIMIT 60`,
  })) as any[];
  return rows
    .map((r): RawCompany | null => {
      const domain = domainFromUrl(r.website_url);
      return domain
        ? { name: r.name, domain, linkedin: r.linkedin_url ?? null, description: r.short_description ?? null, source: "crunchbase" }
        : null;
    })
    .filter((x): x is RawCompany => x !== null);
}

async function fromWeb_(icp: ICP): Promise<RawCompany[]> {
  const q = [...icp.keywords, icp.industry, icp.geo, "company"].filter(Boolean).join(" ");
  const { results } = await services.web.search({ query: q });
  return (results ?? [])
    .map((r: any): RawCompany | null => {
      const domain = domainFromUrl(r.link);
      return domain
        ? { name: r.title, domain, linkedin: null, description: r.snippet ?? null, source: "web" }
        : null;
    })
    .filter((x): x is RawCompany => x !== null);
}
