import { NextResponse } from "next/server";
import { getRepo } from "../../../../../src/server/jobs";
import { draftComment } from "../../../../../src/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  const voiceInput = typeof body?.voiceInput === "string" ? body.voiceInput : "";
  const product = typeof body?.product === "string" ? body.product : "";
  const comment = await draftComment(getRepo(), id, voiceInput, product);
  if (!comment) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ comment });
}
