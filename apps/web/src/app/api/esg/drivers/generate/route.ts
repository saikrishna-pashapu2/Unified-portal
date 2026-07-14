import { NextResponse } from "next/server";
import { ensureUserId } from "@/lib/session-user";
import {
  assertDriverGenerationConfig,
  createEsgDriverJob,
  generateDriversRequestSchema,
} from "@/lib/esg-drivers";
import { enforceApiUsage } from "@/lib/api-usage";
import { JobConcurrencyLimitError } from "@/lib/jobs/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = await ensureUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = generateDriversRequestSchema.safeParse(body);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message?.trim();
    return NextResponse.json(
      {
        error: firstIssue?.slice(0, 240) || "Invalid ESG driver request.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
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

    const job = await createEsgDriverJob(userId, parsed.data);

    return NextResponse.json({
      success: true,
      jobId: job.id,
      job,
    });
  } catch (error: any) {
    console.error("[esg-drivers] failed to create generation job:", error);
    if (error instanceof JobConcurrencyLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    const message = error?.message || "Failed to start ESG driver generation.";
    const configurationError = String(message).startsWith(
      "Missing ESG driver runtime config:",
    );
    return NextResponse.json(
      { error: configurationError ? "ESG driver generation is temporarily unavailable." : message },
      { status: configurationError ? 503 : 500 },
    );
  }
}
