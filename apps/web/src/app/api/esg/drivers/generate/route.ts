import { NextResponse } from "next/server";
import { ensureUserId } from "@/lib/auth-db";
import {
  assertDriverGenerationConfig,
  createEsgDriverJob,
  generateDriversRequestSchema,
  runEsgDriverGenerationJob,
} from "@/lib/esg-drivers";

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
    return NextResponse.json(
      {
        error: "Country, sector, and language are required.",
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    assertDriverGenerationConfig();

    const job = await createEsgDriverJob(userId, parsed.data);
    void runEsgDriverGenerationJob(job.id, parsed.data);

    return NextResponse.json({
      success: true,
      jobId: job.id,
      job,
    });
  } catch (error: any) {
    console.error("[esg-drivers] failed to create generation job:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to start ESG driver generation." },
      { status: 500 },
    );
  }
}
