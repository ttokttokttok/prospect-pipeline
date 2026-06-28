import { decodeId } from "../ids";
import { synthesize } from "../pipeline/synthesize";
import type { Repo } from "../storage/repo";
import type { EnrichedPerson, PersonCard, Synthesis } from "../types";

export function listPeopleCards(repo: Repo): PersonCard[] {
  return repo.listPeople();
}

export function getPersonDetail(
  repo: Repo,
  id: string,
): { dossier: EnrichedPerson; synthesis: Synthesis | null } | null {
  const dossier = repo.getDossier(decodeId(id));
  if (!dossier) return null;
  return { dossier, synthesis: repo.getSynthesis(decodeId(id)) };
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
