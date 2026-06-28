import type { Db } from "./db";
import type { Company, EnrichedPerson, Job, Progress, RunParams } from "../types";

const EMPTY_PROGRESS: Progress = { stage: "queued", companies: 0, people: 0, contacts: 0 };

export class Repo {
  constructor(private db: Db) {}

  createJob(id: string, params: RunParams): Job {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO jobs (id, prompt, status, params, progress, error, created_at, finished_at)
         VALUES (?, ?, 'queued', ?, ?, NULL, ?, NULL)`,
      )
      .run(id, params.prompt, JSON.stringify(params), JSON.stringify(EMPTY_PROGRESS), now);
    return this.getJob(id)!;
  }

  updateJob(id: string, patch: Partial<Pick<Job, "status" | "progress" | "error" | "finishedAt">>): void {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (patch.status !== undefined) { sets.push("status = ?"); vals.push(patch.status); }
    if (patch.progress !== undefined) { sets.push("progress = ?"); vals.push(JSON.stringify(patch.progress)); }
    if (patch.error !== undefined) { sets.push("error = ?"); vals.push(patch.error); }
    if (patch.finishedAt !== undefined) { sets.push("finished_at = ?"); vals.push(patch.finishedAt); }
    if (sets.length === 0) return;
    vals.push(id);
    this.db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  }

  getJob(id: string): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as any;
    return row ? rowToJob(row) : null;
  }

  listJobs(limit = 50): Job[] {
    const rows = this.db
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(limit) as any[];
    return rows.map(rowToJob);
  }

  upsertCompany(c: Company): void {
    this.db
      .prepare(
        `INSERT INTO companies (domain, name, linkedin, fit_score, why, first_seen)
         VALUES (@domain, @name, @linkedin, @fitScore, @why, @now)
         ON CONFLICT(domain) DO UPDATE SET
           name=excluded.name, linkedin=excluded.linkedin,
           fit_score=excluded.fit_score, why=excluded.why`,
      )
      .run({ ...c, now: new Date().toISOString() });
  }

  upsertPerson(p: EnrichedPerson): void {
    this.db
      .prepare(
        `INSERT INTO people (linkedin_url, company_domain, name, title, twitter, work_email, personal_email, phone, last_enriched_at, dossier)
         VALUES (@linkedinUrl, @companyDomain, @name, @title, @twitter, @workEmail, @personalEmail, @phone, @now, @dossier)
         ON CONFLICT(linkedin_url) DO UPDATE SET
           company_domain=excluded.company_domain, name=excluded.name, title=excluded.title,
           twitter=excluded.twitter, work_email=excluded.work_email,
           personal_email=excluded.personal_email, phone=excluded.phone,
           last_enriched_at=excluded.last_enriched_at, dossier=excluded.dossier`,
      )
      .run({
        linkedinUrl: p.linkedinUrl, companyDomain: p.companyDomain, name: p.name, title: p.title,
        twitter: p.twitter, workEmail: p.workEmail, personalEmail: p.personalEmail, phone: p.phone,
        dossier: JSON.stringify(p), now: new Date().toISOString(),
      });
  }

  getDossier(linkedinUrl: string): EnrichedPerson | null {
    const row = this.db.prepare("SELECT dossier FROM people WHERE linkedin_url = ?").get(linkedinUrl) as any;
    return row?.dossier ? (JSON.parse(row.dossier) as EnrichedPerson) : null;
  }

  getPerson(linkedinUrl: string): { lastEnrichedAt: string | null } | null {
    const row = this.db.prepare("SELECT last_enriched_at FROM people WHERE linkedin_url = ?").get(linkedinUrl) as any;
    return row ? { lastEnrichedAt: row.last_enriched_at } : null;
  }

  needsContact(linkedinUrl: string): boolean {
    const p = this.getPerson(linkedinUrl);
    return !p || p.lastEnrichedAt === null;
  }

  addSignals(linkedinUrl: string, signals: { source: "linkedin" | "twitter" | "web"; content: string; url: string }[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO signals (person_linkedin_url, source, content, url, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    for (const s of signals) {
      stmt.run(linkedinUrl, s.source, s.content, s.url, now);
    }
  }
}

function rowToJob(row: any): Job {
  return {
    id: row.id,
    prompt: row.prompt,
    status: row.status,
    params: JSON.parse(row.params),
    progress: JSON.parse(row.progress),
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}
