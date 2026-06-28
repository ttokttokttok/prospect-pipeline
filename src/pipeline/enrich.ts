import { services } from "../orange";
import type { Education, EnrichedPerson, Experience, Person } from "../types";

export async function enrichPerson(
  person: Person,
  opts: { contacts: boolean; skipContact?: boolean; posts?: boolean },
): Promise<EnrichedPerson> {
  const wantContact = opts.contacts && !opts.skipContact;

  const [profile, contact] = await Promise.all([
    enrichProfile(person.linkedinUrl),
    wantContact ? getContact(person) : Promise.resolve(null),
  ]);

  return {
    ...person,
    headline: (profile?.headline as string) ?? null,
    twitter: (profile?.twitter_handle as string) ?? null,
    workEmail: contact?.work_emails?.[0] ?? null,
    personalEmail: contact?.personal_emails?.[0] ?? null,
    phone: contact?.work_phones?.[0] ?? contact?.personal_phones?.[0] ?? contact?.unknown_phones?.[0] ?? null,
    skills: Array.isArray(profile?.skills) ? (profile!.skills as string[]) : [],
    experience: mapExperience(profile),
    education: mapEducation(profile),
    certifications: ((profile?.certifications as any[]) ?? []).map((c) => c?.title).filter(Boolean),
    languages: ((profile?.languages as any[]) ?? [])
      .map((l) => (typeof l === "string" ? l : l?.name ?? l?.language ?? ""))
      .filter(Boolean),
    isInfluencer: Boolean(profile?.is_influencer),
    jobsCount: typeof profile?.jobs_count === "number" ? (profile!.jobs_count as number) : null,
    recommenderCount: typeof profile?.recommender_count === "number" ? (profile!.recommender_count as number) : null,
    posts: [],
    webMentions: [],
    rawProfile: profile ?? null,
  };
}

function mapExperience(profile: Record<string, any> | null): Experience[] {
  return ((profile?.experience as any[]) ?? []).map((e) => ({
    title: e?.title ?? "",
    company: e?.company_name ?? "",
    companyDomain: e?.company_domain ?? null,
    isCurrent: Boolean(e?.is_current),
    startDate: e?.start_date ?? null,
    endDate: e?.end_date ?? null,
    summary: e?.summary ?? null,
  }));
}

function mapEducation(profile: Record<string, any> | null): Education[] {
  return ((profile?.education as any[]) ?? []).map((ed) => ({
    school: ed?.school?.name ?? "",
    degree: ed?.degree ?? null,
    field: ed?.field_of_study?.name ?? null,
    endYear: typeof ed?.end_date_year === "number" ? ed.end_date_year : null,
  }));
}

async function enrichProfile(url: string): Promise<Record<string, any> | null> {
  try {
    return (await services.person.linkedin.enrich({ url, extended: true })) as Record<string, any>;
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
