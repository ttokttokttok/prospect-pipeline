import { services } from "../orange";
import type { EnrichedPerson, MessageDraft } from "../types";

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "A short, specific email subject line (used only if sent as email)." },
    message: {
      type: "string",
      description:
        "A personalized 1:1 message (4-6 sentences) that works as a LinkedIn DM or email. " +
        "Opens with a specific, genuine reference to the person; ends with a low-friction ask.",
    },
  },
  required: ["subject", "message"],
};

// Targeted 1:1 outreach: the person's dossier + founder voice + product → a personalized
// DM/email in the founder's voice. Sibling to comment.ts (public reply) and synthesize.ts
// (cold-email hooks); this produces a full, send-ready message body + subject.
export async function generateMessage(
  person: EnrichedPerson,
  voiceSummary: string,
  product: string,
): Promise<MessageDraft> {
  const posts = [...person.posts].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
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
      "You help a founder send a personalized 1:1 outreach message (LinkedIn DM or email) to a " +
      "prospect. Ground it in the person's recent posts / public activity, reference something " +
      "specific and genuine, connect it to the founder's product WITHOUT a hard pitch, and end with " +
      "a low-friction ask (e.g. a quick look). Keep it 4-6 sentences. No fabrication. Avoid cringe, " +
      "flattery, and templated openers.\n\n" +
      `${voiceGuide}\n\n` +
      `Founder's product: ${product || "(unspecified)"}\n\n` +
      `Person: ${person.name} — ${person.title ?? "(no title)"}\n` +
      `Their recent activity:\n${activity}${footprint}`,
    schema: SCHEMA,
    // `intelligence` is a documented runtime param absent from the SDK type; cast to keep it.
    intelligence: "medium",
  } as Parameters<typeof services.ai.generateObject>[0]);

  return { message: String(object.message ?? ""), subject: String(object.subject ?? "") };
}
