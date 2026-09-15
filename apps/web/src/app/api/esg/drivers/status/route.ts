import { NextResponse } from "next/server";
import { ensureUserId } from "@/lib/session-user";
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

  const job = await getEsgDriverJob(jobId, userId, { includeCheckpoint: true });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    country: job.country,
    sector: job.sector,
    language: job.language,
    selectionPolicy: job.selectionPolicy,
    candidateCount: job.candidateCount,
    candidateAssessedCount: job.candidateAssessedCount,
    publishedDriverCount: job.publishedDriverCount,
    expectedDriverCount: job.expectedDriverCount,
    driverPlan: job.checkpoint?.version === 2 ? job.checkpoint.definitions.map((d, index) => ({ id: d.id, number: index + 1, title: d.name, section: d.section })) : undefined,
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    error: job.error,
    activity: job.activity,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  });
}
