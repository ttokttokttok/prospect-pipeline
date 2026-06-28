import { test, expect } from "vitest";
import { domainFromUrl, DEFAULT_ROLES } from "./types.js";

test("domainFromUrl strips protocol and www", () => {
  expect(domainFromUrl("https://www.Stripe.com/about")).toBe("stripe.com");
  expect(domainFromUrl("http://lever.co")).toBe("lever.co");
});

test("domainFromUrl returns null for empty input", () => {
  expect(domainFromUrl(null)).toBeNull();
  expect(domainFromUrl("")).toBeNull();
});

test("DEFAULT_ROLES includes founders and eng leadership", () => {
  expect(DEFAULT_ROLES).toContain("founder");
  expect(DEFAULT_ROLES).toContain("eng-leadership");
});
