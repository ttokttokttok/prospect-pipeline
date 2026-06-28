import { NextResponse } from "next/server";
import { getRepo } from "../../../../src/server/jobs";
import { getPersonDetail } from "../../../../src/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getPersonDetail(getRepo(), id);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(detail);
}
