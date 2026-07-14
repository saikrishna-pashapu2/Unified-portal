import { NextResponse } from "next/server";
import { enforceApiUsage } from "@/lib/api-usage";
import {
  assertDriverGenerationConfig,
  createEsgDriverResumeJob,
  EsgDriverResumeConflictError,
  EsgDriverResumeParentNotFoundError,
  getEsgDriverJob,
  isDriverJobId,
  isResumableEsgDriverJob,
} from "@/lib/esg-drivers";
import { JobConcurrencyLimitError } from "@/lib/jobs/queue";
import { ensureUserId } from "@/lib/session-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DriverJobParams = { jobId: string };

export async function POST(request: Request, context: any) {
  const userId = await ensureUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = (await Promise.resolve(context.params)) as DriverJobParams;
  if (!isDriverJobId(jobId)) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const parent = await getEsgDriverJob(jobId, userId, {
    includeCheckpoint: true,
  });
  if (!parent) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (!isResumableEsgDriverJob(parent)) {
    return NextResponse.json(
      { error: "Only completed partial ESG driver jobs can be resumed." },
      { status: 409 },
    );
  }

  try {
    assertDriverGenerationConfig();
    const limited = await enforceApiUsage(request, {
      feature: "esg_driver_generation",
      userId,
      perMinute: 2,
      maxConcurrentJobs: 1,
      jobType: "esg_driver",
    });
    if (limited) return limited;

    const job = await createEsgDriverResumeJob(userId, parent);
    return NextResponse.json(
      { success: true, jobId: job.id, parentJobId: parent.id, job },
      { status: 201 },
    );
  } catch (error: any) {
    console.error("[esg-drivers] failed to resume generation job:", error);
    if (error instanceof JobConcurrencyLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    if (error instanceof EsgDriverResumeParentNotFoundError) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    if (error instanceof EsgDriverResumeConflictError) {
      return NextResponse.json(
        { error: "Only completed partial ESG driver jobs can be resumed." },
        { status: 409 },
      );
    }
    const message = error?.message || "Failed to resume ESG driver generation.";
    const configurationError = String(message).startsWith(
      "Missing ESG driver runtime config:",
    );
    return NextResponse.json(
      {
        error: configurationError
          ? "ESG driver generation is temporarily unavailable."
          : message,
      },
      { status: configurationError ? 503 : 500 },
    );
  }
}
