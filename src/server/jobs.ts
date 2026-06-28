import { randomUUID } from "node:crypto";
import { openDb } from "../storage/db";
import { Repo } from "../storage/repo";
import { runPipeline } from "../pipeline/run";
import type { RunParams } from "../types";

let repo: Repo | null = null;

export function getRepo(): Repo {
  if (!repo) repo = new Repo(openDb());
  return repo;
}

export function newJobId(): string {
  return "job_" + randomUUID();
}

export function startRun(params: RunParams): string {
  const id = newJobId();
  const r = getRepo();
  r.createJob(id, params);
  // Fire-and-forget: long-running server keeps the process alive.
  void runPipeline(id, params, r).catch((err) => {
    r.updateJob(id, { status: "failed", error: String(err), finishedAt: new Date().toISOString() });
  });
  return id;
}
