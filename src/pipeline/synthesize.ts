import { services } from "../orange";
import type { EnrichedPerson, Synthesis } from "../types";

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-3 sentences on who this person is, professionally." },
    interests: { type: "array", items: { type: "string" }, description: "Their professional interest themes." },
    hooks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          angle: { type: "string", description: "A concrete cold-email opener." },
          why: { type: "string", description: "The specific dossier fact that grounds this angle." },
        },
        required: ["angle", "why"],
      },
      description: "2-3 cold-email hooks, each grounded in a real fact below.",
    },
  },
  required: ["summary", "interests", "hooks"],
};

export async function synthesize(person: EnrichedPerson): Promise<Synthesis> {
  const facts = [
    `Name: ${person.name}`,
    `Title: ${person.title ?? "(unknown)"} at ${person.companyDomain}`,
    person.headline ? `Headline: ${person.headline}` : "",
    person.skills.length ? `Skills: ${person.skills.join(", ")}` : "",
    person.experience.length
      ? `Experience: ${person.experience.slice(0, 4).map((e) => `${e.title} @ ${e.company}`).join("; ")}`
      : "",
    person.education.length ? `Education: ${person.education.map((e) => e.school).join(", ")}` : "",
    person.posts.length ? `Recent posts: ${person.posts.slice(0, 5).map((p) => `"${p.text}"`).join(" | ")}` : "",
    person.webMentions.length
      ? `Web footprint: ${person.webMentions.slice(0, 5).map((m) => `${m.category}: ${m.title}`).join("; ")}`
      : "",
  ].filter(Boolean).join("\n");

  try {
    const { object } = await services.ai.generateObject({
      prompt:
        `You help write personalized B2B cold-email openers. Based ONLY on the facts below, ` +
        `write a short professional summary, the person's interest themes, and 2-3 specific cold-email ` +
        `hooks. Each hook's "why" MUST cite a specific fact below. Do NOT fabricate anything.\n\n${facts}`,
      schema: SCHEMA,
      intelligence: "medium",
    });
    return {
      summary: typeof object.summary === "string" ? object.summary : "",
      interests: Array.isArray(object.interests) ? object.interests : [],
      hooks: Array.isArray(object.hooks)
        ? object.hooks
            .map((h: any) => ({ angle: String(h?.angle ?? ""), why: String(h?.why ?? "") }))
            .filter((h: any) => h.angle)
        : [],
    };
  } catch {
    return { summary: "", interests: [], hooks: [] };
  }
}
