import { test, expect } from "vitest";
import { parseArgs } from "./cli.js";

test("posts and contacts default ON", () => {
  const p = parseArgs(["Series A dev tools"]);
  expect(p.prompt).toBe("Series A dev tools");
  expect(p.posts).toBe(true);
  expect(p.contacts).toBe(true);
  expect(p.roles).toEqual(["founder", "eng-leadership"]);
});

test("--no-posts and --no-contacts disable each", () => {
  const p = parseArgs(["prompt here", "--no-posts", "--no-contacts"]);
  expect(p.posts).toBe(false);
  expect(p.contacts).toBe(false);
});

test("--roles overrides", () => {
  const p = parseArgs(["prompt", "--roles=founder,cto"]);
  expect(p.roles).toEqual(["founder", "cto"]);
});
