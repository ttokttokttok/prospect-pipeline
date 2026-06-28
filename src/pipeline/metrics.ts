import type { EnrichedPerson, PersonMetrics } from "../types";

const DAY = 24 * 60 * 60 * 1000;

export function computeMetrics(person: EnrichedPerson, now: Date = new Date()): PersonMetrics {
  return {
    tenureMonths: tenure(person, now),
    lastPostAt: lastPost(person),
    recentlyActive: recentlyActive(person, now),
  };
}

function tenure(person: EnrichedPerson, now: Date): number | null {
  const current = person.experience.find((e) => e.isCurrent && e.startDate);
  if (!current?.startDate) return null;
  const start = new Date(current.startDate);
  if (isNaN(start.getTime())) return null;
  return (now.getUTCFullYear() - start.getUTCFullYear()) * 12 + (now.getUTCMonth() - start.getUTCMonth());
}

function lastPost(person: EnrichedPerson): string | null {
  const dated = person.posts.filter((p) => p.postedAt);
  if (!dated.length) return null;
  return dated.reduce((max, p) => (p.postedAt! > max ? p.postedAt! : max), dated[0].postedAt!);
}

function recentlyActive(person: EnrichedPerson, now: Date): boolean {
  const last = lastPost(person);
  if (!last) return false;
  const d = new Date(last);
  if (isNaN(d.getTime())) return false;
  return now.getTime() - d.getTime() <= 90 * DAY;
}
