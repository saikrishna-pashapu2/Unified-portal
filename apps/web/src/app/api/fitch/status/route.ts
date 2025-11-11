import { NextResponse } from "next/server";
import { JOBS } from "../upload/jobstore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("jobId") ?? "";
  const job = JOBS.get(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ 
    status: job.status, 
    error: job.error ?? null,
    progress: job.progress ?? null
  });
}