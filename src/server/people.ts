import { decodeId } from "../ids";
import { computeMetrics } from "../pipeline/metrics";
import { draftEmail } from "../pipeline/draft";
import { synthesize } from "../pipeline/synthesize";
import { buildVoiceProfile } from "../pipeline/voice";
import { generateComment } from "../pipeline/comment";
import { generateMessage } from "../pipeline/message";
import type { Repo } from "../storage/repo";
import type { CommentDraft, EmailDraft, EnrichedPerson, MessageDraft, PersonCard, PersonMetrics, SenderProfile, Synthesis } from "../types";

export function listPeopleCards(repo: Repo): PersonCard[] {
  return repo.listPeople();
}

export function getPersonDetail(
  repo: Repo,
  id: string,
): {
  dossier: EnrichedPerson;
  synthesis: Synthesis | null;
  metrics: PersonMetrics;
  comment: CommentDraft | null;
  message: MessageDraft | null;
  draft: EmailDraft | null;
} | null {
  const url = decodeId(id);
  const dossier = repo.getDossier(url);
  if (!dossier) return null;
  return {
    dossier,
    synthesis: repo.getSynthesis(url),
    metrics: computeMetrics(dossier),
    comment: repo.getComment(url),
    message: repo.getMessage(url),
    draft: repo.getDraft(url),
  };
}

// Drafts an in-voice comment from the person's real posts. Inputs (voice/product)
// vary, so this always regenerates and overwrites the cached draft.
export async function draftComment(
  repo: Repo,
  id: string,
  voiceInput: string,
  product: string,
  gen: typeof generateComment = generateComment,
): Promise<CommentDraft | null> {
  const url = decodeId(id);
  const dossier = repo.getDossier(url);
  if (!dossier) return null;
  const voiceSummary = await buildVoiceProfile(voiceInput);
  const c = await gen(dossier, voiceSummary, product);
  if (c.comment) repo.setComment(url, c);
  return c;
}

// Drafts a 1:1 message (DM/email). Like draftComment, always regenerates from current inputs.
export async function draftMessage(
  repo: Repo,
  id: string,
  voiceInput: string,
  product: string,
  gen: typeof generateMessage = generateMessage,
): Promise<MessageDraft | null> {
  const url = decodeId(id);
  const dossier = repo.getDossier(url);
  if (!dossier) return null;
  const voiceSummary = await buildVoiceProfile(voiceInput);
  const m = await gen(dossier, voiceSummary, product);
  if (m.message) repo.setMessage(url, m);
  return m;
}

export async function getOrCreateDraft(
  repo: Repo,
  id: string,
  profile: SenderProfile,
  force = false,
  gen: (p: EnrichedPerson, s: Synthesis | null, prof: SenderProfile) => Promise<EmailDraft> = draftEmail,
): Promise<EmailDraft | null> {
  const url = decodeId(id);
  if (!force) { const cached = repo.getDraft(url); if (cached) return cached; }
  const dossier = repo.getDossier(url);
  if (!dossier) return null;
  const d = await gen(dossier, repo.getSynthesis(url), profile);
  if (d.subject || d.body) repo.setDraft(url, d);
  return d;
}

export async function getOrCreateSynthesis(
  repo: Repo,
  id: string,
  gen: (p: EnrichedPerson) => Promise<Synthesis> = synthesize,
  force = false,
): Promise<Synthesis | null> {
  const url = decodeId(id);
  if (!force) { const cached = repo.getSynthesis(url); if (cached) return cached; }
  const dossier = repo.getDossier(url);
  if (!dossier) return null;
  const s = await gen(dossier);
  if (s.summary || s.hooks.length) repo.setSynthesis(url, s);
  return s;
}
