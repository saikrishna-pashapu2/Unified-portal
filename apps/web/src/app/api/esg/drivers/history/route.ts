import { NextResponse } from "next/server";
import { ensureUserId } from "@/lib/session-user";
import {
  InvalidEsgDriverJobsCursorError,
  listEsgDriverJobsPage,
} from "@/lib/esg-drivers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await ensureUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = new URL(request.url).searchParams;
  const limit = parseHistoryLimit(searchParams.get("limit"));
  const cursor = searchParams.get("cursor");
  if (
    limit === null ||
    (searchParams.has("cursor") &&
      (!cursor || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)))
  ) {
    return NextResponse.json(
      { error: "Invalid history pagination parameters." },
      { status: 400 },
    );
  }

  let page;
  try {
    page = await listEsgDriverJobsPage(userId, { limit, cursor });
  } catch (error: unknown) {
    if (error instanceof InvalidEsgDriverJobsCursorError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  return NextResponse.json({
    success: true,
    jobs: page.jobs.map((job) => ({
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
      needsAttention:
        job.status === "error" ||
        (job.status === "done" && job.result?.completion === "partial"),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    })),
    nextCursor: page.nextCursor,
    total: page.total,
    completed: page.completed,
    needsAttention: page.needsAttention,
  });
}

function parseHistoryLimit(value: string | null): number | null {
  if (value === null) return 20;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 50 ? parsed : null;
}
