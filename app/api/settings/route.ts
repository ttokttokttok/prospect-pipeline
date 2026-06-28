import { NextResponse } from "next/server";
import { getRepo } from "../../../src/server/jobs";
import type { SenderProfile } from "../../../src/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ profile: getRepo().getSenderProfile() });
}

export async function PUT(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const profile: SenderProfile = {
    senderName: String(body.senderName ?? ""),
    senderCompany: String(body.senderCompany ?? ""),
    offer: String(body.offer ?? ""),
    valueProp: String(body.valueProp ?? ""),
    socialProof: String(body.socialProof ?? ""),
    cta: String(body.cta ?? ""),
    tone: String(body.tone ?? ""),
  };
  getRepo().setSenderProfile(profile);
  return NextResponse.json({ profile });
}
