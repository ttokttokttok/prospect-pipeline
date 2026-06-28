import { test, expect } from "vitest";
import { openDb } from "./db.js";

test("openDb creates all tables", () => {
  const db = openDb(":memory:");
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r: any) => r.name);
  expect(names).toContain("jobs");
  expect(names).toContain("companies");
  expect(names).toContain("people");
  expect(names).toContain("signals");
  db.close();
});
