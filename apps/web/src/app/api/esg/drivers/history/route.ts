import { NextResponse } from "next/server";
import { ensureUserId } from "@/lib/auth-db";
import { listEsgDriverJobs } from "@/lib/esg-drivers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await ensureUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await listEsgDriverJobs(userId, 20);

  return NextResponse.json({
    success: true,
    jobs: jobs.map((job) => ({
      id: job.id,
      country: job.country,
      sector: job.sector,
      language: job.language,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      error: job.error,
      latestActivity: job.activity[job.activity.length - 1] || null,
      driverCount: job.result?.drivers.length || 0,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    })),
  });
}
