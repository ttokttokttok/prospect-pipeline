import { NextResponse } from "next/server";
import { getRepo } from "../../../src/server/jobs";
import { listPeopleCards } from "../../../src/server/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ people: listPeopleCards(getRepo()) });
}
