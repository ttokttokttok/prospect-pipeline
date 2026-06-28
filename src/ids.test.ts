import { test, expect } from "vitest";
import { encodeId, decodeId } from "./ids.js";

test("encodeId/decodeId round-trips a linkedin url and is url-safe", () => {
  const url = "https://www.linkedin.com/in/jane-doe";
  const id = encodeId(url);
  expect(id).not.toMatch(/[/+=]/); // url-safe, no slashes/plus/padding
  expect(decodeId(id)).toBe(url);
});
