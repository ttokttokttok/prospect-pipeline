import { decodeId } from "../ids";
import { computeMetrics } from "../pipeline/metrics";
import { draftEmail } from "../pipeline/draft";
import { synthesize } from "../pipeline/synthesize";
import type { Repo } from "../storage/repo";
import type { EmailDraft, EnrichedPerson, PersonCard, PersonMetrics, SenderProfile, Synthesis } from "../types";

export function listPeopleCards(repo: Repo): PersonCard[] {
  return repo.listPeople();
}

export function getPersonDetail(
  repo: Repo,
  id: string,
): { dossier: EnrichedPerson; synthesis: Synthesis | null; metrics: PersonMetrics; draft: EmailDraft | null } | null {
  const url = decodeId(id);
  const dossier = repo.getDossier(url);
  if (!dossier) return null;
  return { dossier, synthesis: repo.getSynthesis(url), metrics: computeMetrics(dossier), draft: repo.getDraft(url) };
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
