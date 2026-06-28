import { runPipeline } from "../src/pipeline/run";
import { getRepo, newJobId } from "../src/server/jobs";
import { DEFAULT_ROLES, type RunParams } from "../src/types";

function parseArgs(argv: string[]): RunParams {
  const prompt = argv.find((a) => !a.startsWith("--"));
  if (!prompt) {
    console.error('Usage: npm run prospect -- "Series A dev tool companies" [--contacts] [--posts] [--roles=founder,eng-leadership]');
    process.exit(1);
  }
  const rolesArg = argv.find((a) => a.startsWith("--roles="));
  return {
    prompt,
    contacts: argv.includes("--contacts"),
    posts: argv.includes("--posts"),
    roles: rolesArg ? rolesArg.slice("--roles=".length).split(",") : DEFAULT_ROLES,
  };
}

const params = parseArgs(process.argv.slice(2));
const repo = getRepo();
const id = newJobId();
repo.createJob(id, params);
console.log(`Running ${id} — "${params.prompt}" (contacts: ${params.contacts})`);
await runPipeline(id, params, repo);
const job = repo.getJob(id)!;
console.log(`Status: ${job.status}`);
if (job.error) console.error("Error:", job.error);
console.log("Counts:", job.progress);
console.log(`Output: runs/${id}/  (companies.csv, people.csv, people.json)`);
