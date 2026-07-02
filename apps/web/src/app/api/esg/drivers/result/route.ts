import { NextResponse } from "next/server";
import { ensureUserId } from "@/lib/auth-db";
import { getEsgDriverJob } from "@/lib/esg-drivers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await ensureUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobId = new URL(request.url).searchParams.get("jobId") || "";
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const job = await getEsgDriverJob(jobId, userId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "done" || !job.result) {
    return NextResponse.json(
      {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        stage: job.stage,
        error: job.error,
      },
      { status: job.status === "error" ? 500 : 202 },
    );
  }

  return NextResponse.json({
    success: true,
    jobId: job.id,
    result: job.result,
  });
}
