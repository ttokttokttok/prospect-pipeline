import { test, expect, vi, beforeEach } from "vitest";

const { linkedinEnrich, contactGet, batchSearch } = vi.hoisted(() => ({
  linkedinEnrich: vi.fn(),
  contactGet: vi.fn(),
  batchSearch: vi.fn(),
}));
vi.mock("../orange.js", () => ({
  services: {
    person: { linkedin: { enrich: linkedinEnrich }, contact: { get: contactGet } },
    web: { batchSearch },
  },
}));

import { enrichPerson } from "./enrich.js";
import type { Person } from "../types.js";

const person: Person = { linkedinUrl: "https://linkedin.com/in/jane", companyDomain: "acme.com", name: "Jane Doe", title: "CTO" };

beforeEach(() => {
  linkedinEnrich.mockReset();
  contactGet.mockReset();
  batchSearch.mockReset();
  linkedinEnrich.mockResolvedValue({ headline: "CTO at Acme", twitter_handle: "janedoe" });
  batchSearch.mockResolvedValue([
    { results: [{ title: "Jane on LinkedIn", link: "https://linkedin.com/posts/jane_1", snippet: "shipped X" }] },
    { results: [{ title: "Jane tweet", link: "https://x.com/janedoe/status/1", snippet: "hot take" }] },
    { results: [{ title: "Jane interview", link: "https://blog.com/jane", snippet: "podcast" }] },
  ]);
});

test("enriches profile and gathers signals without contacts when contacts=false", async () => {
  const out = await enrichPerson(person, { contacts: false });
  expect(out.headline).toBe("CTO at Acme");
  expect(out.twitter).toBe("janedoe");
  expect(out.workEmail).toBeNull();
  expect(contactGet).not.toHaveBeenCalled();
  expect(out.signals.length).toBeGreaterThan(0);
  expect(out.signals.some((s) => s.source === "twitter")).toBe(true);
});

test("fetches contact info when contacts=true and not skipped", async () => {
  contactGet.mockResolvedValue({ work_emails: ["jane@acme.com"], personal_emails: ["jane@gmail.com"], work_phones: ["+1555"], personal_phones: [], unknown_phones: [] });
  const out = await enrichPerson(person, { contacts: true });
  expect(contactGet).toHaveBeenCalledWith(expect.objectContaining({ linkedinUrl: person.linkedinUrl }));
  expect(out.workEmail).toBe("jane@acme.com");
  expect(out.personalEmail).toBe("jane@gmail.com");
  expect(out.phone).toBe("+1555");
});

test("skips contact lookup when skipContact=true (cache hit)", async () => {
  const out = await enrichPerson(person, { contacts: true, skipContact: true });
  expect(contactGet).not.toHaveBeenCalled();
  expect(out.workEmail).toBeNull();
});
