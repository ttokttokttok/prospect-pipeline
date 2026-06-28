import { NextResponse } from "next/server";
import { getRepo } from "../../../../../src/server/jobs";
import { draftMessage } from "../../../../../src/server/people";

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
  const message = await draftMessage(getRepo(), id, voiceInput, product);
  if (!message) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ message });
}
