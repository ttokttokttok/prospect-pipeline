import { join } from "node:path";
import { interpret } from "./interpret";
import { discoverCompanies } from "./companies";
import { findPeople } from "./people";
import { enrichPerson } from "./enrich";
import { writeRun } from "../output/export";
import type { Repo } from "../storage/repo";
import type { Company, EnrichedPerson, Person, Progress, RunParams } from "../types";

export async function runPipeline(
  jobId: string,
  params: RunParams,
  repo: Repo,
  runsDir = "runs",
): Promise<void> {
  const progress: Progress = { stage: "interpret", companies: 0, people: 0, contacts: 0 };
  const setStage = (stage: string) => {
    progress.stage = stage;
    repo.updateJob(jobId, { progress: { ...progress } });
  };

  try {
    repo.updateJob(jobId, { status: "running", progress: { ...progress } });

    setStage("interpret");
    const icp = await interpret(params.prompt);

    setStage("companies");
    const companies = await discoverCompanies(icp, 20);
    for (const c of companies) repo.upsertCompany(c);
    progress.companies = companies.length;
    setStage("people");

    // Collect people across all companies (concurrently).
    const peopleLists = await Promise.all(
      companies.map((c: Company) => findPeople(c, params.roles, 3)),
    );
    const people: Person[] = peopleLists.flat();
    progress.people = people.length;
    setStage("enrich");

    // Enrich each person; isolate failures so one bad profile doesn't kill the run.
    const enriched: EnrichedPerson[] = [];
    let contacts = 0;
    const results = await Promise.allSettled(
      people.map((p) =>
        enrichPerson(p, { contacts: params.contacts, skipContact: !repo.needsContact(p.linkedinUrl) }),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        const ep = r.value;
        repo.upsertPerson(ep);
        if (ep.signals.length) repo.addSignals(ep.linkedinUrl, ep.signals);
        if (ep.workEmail || ep.personalEmail || ep.phone) contacts++;
        enriched.push(ep);
      }
    }
    progress.people = enriched.length;
    progress.contacts = contacts;
    setStage("output");

    await writeRun(join(runsDir, jobId), { companies, people: enriched });

    repo.updateJob(jobId, {
      status: "completed",
      progress: { ...progress, stage: "completed" },
      finishedAt: new Date().toISOString(),
    });
  } catch (err) {
    repo.updateJob(jobId, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      finishedAt: new Date().toISOString(),
    });
  }
}
