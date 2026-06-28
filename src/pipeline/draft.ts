import { services } from "../orange";
import type { EmailDraft, EnrichedPerson, SenderProfile, Synthesis } from "../types";

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "Short, specific, relevance-driven subject line (not salesy)." },
    body: { type: "string", description: "The email body, ~80-120 words." },
  },
  required: ["subject", "body"],
};

export async function draftEmail(
  person: EnrichedPerson,
  synthesis: Synthesis | null,
  profile: SenderProfile,
): Promise<EmailDraft> {
  const recipient = [
    `Name: ${person.name}`,
    `Title: ${person.title ?? "(unknown)"} at ${person.companyDomain}`,
    person.headline ? `Headline: ${person.headline}` : "",
    synthesis?.currentFocus ? `Current focus: ${synthesis.currentFocus}` : "",
    synthesis?.interests?.length ? `Interests: ${synthesis.interests.join(", ")}` : "",
    synthesis?.hooks?.length ? `Hooks: ${synthesis.hooks.map((h) => h.angle).join("; ")}` : "",
    person.posts.length ? `Recent post: "${person.posts[0].text}"` : "",
  ].filter(Boolean).join("\n");

  const sender = [
    `From: ${profile.senderName}, ${profile.senderCompany}`,
    `Offer: ${profile.offer}`,
    `Value: ${profile.valueProp}`,
    `Social proof: ${profile.socialProof}`,
    `CTA: ${profile.cta}`,
    `Tone: ${profile.tone}`,
  ].join("\n");

  try {
    const { object } = await services.ai.generateObject({
      prompt:
        `Write ONE short, personalized cold email. Best practices: a specific non-salesy subject; ` +
        `open with a genuine personalized line grounded in a REAL fact about the recipient below ` +
        `(their current focus, a hook, or their recent post) — never generic flattery; ONE sentence ` +
        `connecting the sender's offer/value/social-proof to THEIR context; exactly ONE soft, ` +
        `low-friction CTA (use the sender's CTA, phrased as a question); ~80-120 words; match the ` +
        `sender's tone; sign off as the sender. Do NOT fabricate anything.\n\n` +
        `--- RECIPIENT ---\n${recipient}\n\n--- SENDER ---\n${sender}`,
      schema: SCHEMA,
      intelligence: "medium",
    } as Parameters<typeof services.ai.generateObject>[0]);
    return { subject: String(object.subject ?? ""), body: String(object.body ?? "") };
  } catch {
    return { subject: "", body: "" };
  }
}
