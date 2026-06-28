import { services } from "../orange.js";
import type { EnrichedPerson, Person, Signal } from "../types.js";

export async function enrichPerson(
  person: Person,
  opts: { contacts: boolean; skipContact?: boolean },
): Promise<EnrichedPerson> {
  const wantContact = opts.contacts && !opts.skipContact;

  const [profile, contact, signals] = await Promise.all([
    enrichProfile(person.linkedinUrl),
    wantContact ? getContact(person) : Promise.resolve(null),
    gatherSignals(person),
  ]);

  return {
    ...person,
    headline: profile?.headline ?? null,
    twitter: profile?.twitter_handle ?? null,
    workEmail: contact?.work_emails?.[0] ?? null,
    personalEmail: contact?.personal_emails?.[0] ?? null,
    phone: contact?.work_phones?.[0] ?? contact?.personal_phones?.[0] ?? contact?.unknown_phones?.[0] ?? null,
    signals,
  };
}

async function enrichProfile(url: string): Promise<any | null> {
  try {
    return await services.person.linkedin.enrich({ url });
  } catch {
    return null;
  }
}

async function getContact(person: Person): Promise<any | null> {
  try {
    return await services.person.contact.get({ linkedinUrl: person.linkedinUrl, required: ["email", "phone"] });
  } catch {
    return null;
  }
}

async function gatherSignals(person: Person): Promise<Signal[]> {
  const name = `"${person.name}"`;
  try {
    const batches = await services.web.batchSearch({
      queries: [
        { query: `${name} site:linkedin.com/posts` },
        { query: `${name} site:x.com` },
        { query: `${name} ${person.title ?? ""} interview OR blog OR podcast` },
      ],
    });
    const sources: Signal["source"][] = ["linkedin", "twitter", "web"];
    const signals: Signal[] = [];
    batches.forEach((b: any, i: number) => {
      for (const r of (b?.results ?? []).slice(0, 3)) {
        signals.push({ source: sources[i], content: r.snippet ?? r.title ?? "", url: r.link });
      }
    });
    return signals;
  } catch {
    return [];
  }
}
