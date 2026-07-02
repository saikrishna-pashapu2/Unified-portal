import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { fetchIssEsgSource } from "@/lib/esg-sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireSession();
  if (auth.response) return auth.response;

  const name = new URL(req.url).searchParams.get("name")?.trim();
  if (!name) return NextResponse.json({ error: "Missing name" }, { status: 400 });

  return NextResponse.json(await fetchIssEsgSource(name));
}
