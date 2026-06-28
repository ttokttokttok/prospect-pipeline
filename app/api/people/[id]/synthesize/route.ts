import { NextResponse } from "next/server";
import { getRepo } from "../../../../../src/server/jobs";
import { getOrCreateSynthesis } from "../../../../../src/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const force = new URL(req.url).searchParams.get("force") === "1";
  const synthesis = await getOrCreateSynthesis(getRepo(), id, undefined, force);
  if (!synthesis) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ synthesis });
}
