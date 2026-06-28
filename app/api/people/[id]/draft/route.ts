import { NextResponse } from "next/server";
import { getRepo } from "../../../../../src/server/jobs";
import { getOrCreateDraft } from "../../../../../src/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const repo = getRepo();
  const profile = repo.getSenderProfile();
  if (!profile) return NextResponse.json({ error: "needs_profile" }, { status: 409 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  const draft = await getOrCreateDraft(repo, id, profile, force);
  if (!draft) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ draft });
}
