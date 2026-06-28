import { services } from "../orange";
import type { ICP } from "../types";

const SCHEMA = {
  type: "object",
  properties: {
    fundingStage: { type: ["string", "null"], description: "Crunchbase last_funding_type, e.g. 'series_a', 'seed'. Null if unspecified." },
    keywords: { type: "array", items: { type: "string" }, description: "Search keywords describing the product/space, e.g. ['developer tools','devtools']." },
    industry: { type: ["string", "null"] },
    geo: { type: ["string", "null"], description: "Country or region, e.g. 'US'." },
    sizeMax: { type: ["number", "null"], description: "Max headcount if implied, else null." },
  },
  required: ["keywords"],
};

export async function interpret(prompt: string): Promise<ICP> {
  const { object } = await services.ai.generateObject({
    prompt: `Extract a B2B ideal-customer-profile filter from this request. Do not fabricate values; use null when unspecified.\n\nRequest: ${prompt}`,
    schema: SCHEMA,
  }) as any;
  return {
    fundingStage: object.fundingStage ?? null,
    keywords: Array.isArray(object.keywords) ? object.keywords : [],
    industry: object.industry ?? null,
    geo: object.geo ?? null,
    sizeMax: typeof object.sizeMax === "number" ? object.sizeMax : null,
  };
}
