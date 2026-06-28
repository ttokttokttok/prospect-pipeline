import { services } from "../orange";

// Turn the founder's own writing into a reusable style guide that the comment
// generator conditions on — the direct answer to the "AI slop" objection.
export async function buildVoiceProfile(voiceInput: string | undefined): Promise<string> {
  const input = (voiceInput ?? "").trim();
  if (!input) return "";

  const samples = input
    .split(/\n-{3,}\n|\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const { object } = await services.ai.generateObject({
      prompt:
        "Summarize this person's writing voice so it can be reused to draft LinkedIn comments " +
        "in their style. Capture tone, typical sentence length, vocabulary, use of emoji and " +
        "punctuation, and recurring themes. Be concrete and prescriptive. Do not fabricate " +
        "facts about them.\n\n" +
        samples.map((s, i) => `Post ${i + 1}:\n${s}`).join("\n\n"),
      schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    });
    return String(object.summary ?? "").trim();
  } catch {
    return "";
  }
}
