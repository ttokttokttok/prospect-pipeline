import { DEFAULT_ROLES, type RunParams } from "./types";

export function parseArgs(argv: string[]): RunParams {
  const prompt = argv.find((a) => !a.startsWith("--"));
  if (!prompt) throw new Error("prompt is required");
  const rolesArg = argv.find((a) => a.startsWith("--roles="));
  return {
    prompt,
    contacts: !argv.includes("--no-contacts"),
    posts: !argv.includes("--no-posts"),
    roles: rolesArg ? rolesArg.slice("--roles=".length).split(",") : DEFAULT_ROLES,
  };
}
