import { runPipeline } from "../src/pipeline/run";
import { getRepo, newJobId } from "../src/server/jobs";
import { parseArgs } from "../src/cli";

let params;
try {
  params = parseArgs(process.argv.slice(2));
} catch {
  console.error('Usage: npm run prospect -- "Series A dev tool companies" [--no-posts] [--no-contacts] [--roles=founder,eng-leadership]');
  process.exit(1);
}
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
