import { NextResponse } from "next/server";
import { startRun, getRepo } from "../../../src/server/jobs";
import { DEFAULT_ROLES } from "../../../src/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body?.prompt || typeof body.prompt !== "string") {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  const jobId = startRun({
    prompt: body.prompt,
    contacts: body.contacts !== false,
    roles: Array.isArray(body.roles) && body.roles.length ? body.roles : DEFAULT_ROLES,
    posts: body.posts !== false,
  });
  return NextResponse.json({ jobId }, { status: 201 });
}

export async function GET() {
  return NextResponse.json({ jobs: getRepo().listJobs() });
}
