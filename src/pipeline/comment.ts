import { services } from "../orange";
import type { CommentDraft, EnrichedPerson, PainPoint } from "../types";

const SCHEMA = {
  type: "object",
  properties: {
    painPoints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short name of the pain point." },
          evidence: { type: "string", description: "Quote/paraphrase from their posts that grounds it." },
        },
        required: ["label", "evidence"],
      },
      description: "2-3 pain points the person plausibly cares about, grounded in their posts.",
    },
    comment: {
      type: "string",
      description: "A comment to leave on their most recent post, in the founder's voice.",
    },
    postAngles: {
      type: "array",
      items: { type: "string" },
      description: "1-2 secondary broadcast-post angles the founder could publish.",
    },
  },
  required: ["painPoints", "comment", "postAngles"],
};

// Targeted-outreach generation: the person's real posts + founder voice + product →
// a drafted, in-voice comment on their latest post, plus pain points and post angles.
// Sibling to synthesize.ts (which produces cold-email hooks instead).
export async function generateComment(
  person: EnrichedPerson,
  voiceSummary: string,
  product: string,
): Promise<CommentDraft> {
  const posts = [...person.posts].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
  const latest = posts[0] ?? null;

  const voiceGuide = voiceSummary
    ? `Write in THIS voice (match tone, sentence length, vocabulary, punctuation):\n${voiceSummary}`
    : "Write in a natural, human, non-salesy voice.";
  const activity = posts.length
    ? posts.slice(0, 5).map((p, i) => `Post ${i + 1}:\n${p.text}`).join("\n\n")
    : "(no posts available)";
  const footprint = person.webMentions.length
    ? "\n\nWeb footprint: " + person.webMentions.slice(0, 5).map((m) => `${m.category}: ${m.title}`).join("; ")
    : "";

  const { object } = await services.ai.generateObject({
    prompt:
      "You help a founder engage a prospect on LinkedIn with an organic, targeted comment — NOT " +
      "an ad. From the person's recent posts, infer the pain points they care about, then draft a " +
      "comment to leave on their MOST RECENT post that subtly surfaces one pain point relevant to " +
      "the founder's product. The comment must read as a genuine human reply, be specific to that " +
      "post, add value, and NOT pitch overtly. No fabrication. Avoid cringe, emoji spam, and " +
      "openers like 'Great post!'.\n\n" +
      `${voiceGuide}\n\n` +
      `Founder's product: ${product || "(unspecified)"}\n\n` +
      `Person: ${person.name} — ${person.title ?? "(no title)"}\n` +
      `Most recent post:\n${latest?.text ?? "(none available)"}\n\n` +
      `More of their recent activity:\n${activity}${footprint}`,
    schema: SCHEMA,
    // `intelligence` is a documented runtime param absent from the SDK type; cast to keep it.
    intelligence: "medium",
  } as Parameters<typeof services.ai.generateObject>[0]);

  return {
    postUrl: latest?.url ?? null,
    postText: latest?.text ?? null,
    painPoints: normalizePainPoints(object.painPoints),
    comment: String(object.comment ?? ""),
    postAngles: Array.isArray(object.postAngles) ? object.postAngles.map(String) : [],
  };
}

function normalizePainPoints(raw: unknown): PainPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({ label: String(p.label ?? ""), evidence: String(p.evidence ?? "") }));
}
