export interface ICP {
  fundingStage: string | null;
  keywords: string[];
  industry: string | null;
  geo: string | null;
  sizeMax: number | null;
}

export interface Company {
  domain: string;
  name: string;
  linkedin: string | null;
  description: string | null;
  fitScore: number;
  why: string;
  source: "crunchbase" | "web";
}

export interface Person {
  linkedinUrl: string;
  companyDomain: string;
  name: string;
  title: string | null;
}

export interface Signal {
  source: "linkedin" | "twitter" | "web";
  content: string;
  url: string;
}

export interface EnrichedPerson extends Person {
  twitter: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  headline: string | null;
  signals: Signal[];
}

export interface RunParams {
  prompt: string;
  contacts: boolean;
  roles: string[];
}

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface Progress {
  stage: string;
  companies: number;
  people: number;
  contacts: number;
}

export interface Job {
  id: string;
  prompt: string;
  status: JobStatus;
  params: RunParams;
  progress: Progress;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export const DEFAULT_ROLES = ["founder", "eng-leadership"];

export function domainFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const withProto = url.includes("://") ? url : `https://${url}`;
    const host = new URL(withProto).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}
