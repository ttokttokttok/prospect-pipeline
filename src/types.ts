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

export interface Experience {
  title: string;
  company: string;
  companyDomain: string | null;
  isCurrent: boolean;
  startDate: string | null;
  endDate: string | null;
  summary: string | null;
}

export interface Education {
  school: string;
  degree: string | null;
  field: string | null;
  endYear: number | null;
}

export interface Post {
  source: "linkedin" | "twitter";
  text: string;
  url: string | null;
  postedAt: string | null;
  likes: number | null;
}

export interface WebMention {
  category: "talk" | "podcast" | "github" | "article" | "web";
  title: string;
  url: string;
  snippet: string | null;
}

export interface EnrichedPerson extends Person {
  headline: string | null;
  twitter: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  skills: string[];
  experience: Experience[];
  education: Education[];
  certifications: string[];
  languages: string[];
  isInfluencer: boolean;
  jobsCount: number | null;
  recommenderCount: number | null;
  posts: Post[];
  webMentions: WebMention[];
  rawProfile: Record<string, unknown> | null;
}

export interface RunParams {
  prompt: string;
  contacts: boolean;
  roles: string[];
  posts: boolean;
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

export interface PersonCard {
  id: string;
  linkedinUrl: string;
  name: string;
  title: string | null;
  companyDomain: string;
  twitter: string | null;
  skills: string[];
  isInfluencer: boolean;
  hasSynthesis: boolean;
}

export interface Hook {
  angle: string;
  why: string;
}

export interface Synthesis {
  summary: string;
  interests: string[];
  hooks: Hook[];
}

// --- Champion Comment Engine (targeted organic outreach) ---

export interface PainPoint {
  label: string;
  evidence: string; // quote/paraphrase from the person's posts grounding the pain point
}

// A drafted LinkedIn comment on the person's most recent post, in the founder's voice.
export interface CommentDraft {
  postUrl: string | null; // the post being replied to
  postText: string | null; // its text (so the UI can show "replying to…")
  painPoints: PainPoint[];
  comment: string;
  postAngles: string[]; // secondary broadcast-post angles
}

// A drafted 1:1 message (LinkedIn DM or email) in the founder's voice.
export interface MessageDraft {
  message: string; // the body, works as DM or email
  subject: string; // only used when sent as email
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
