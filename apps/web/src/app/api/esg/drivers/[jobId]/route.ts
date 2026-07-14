import { NextResponse } from "next/server";
import { ensureUserId } from "@/lib/session-user";
import { deleteEsgDriverJob, isDriverJobId } from "@/lib/esg-drivers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DriverJobParams = { jobId: string };

export async function DELETE(
  _request: Request,
  context: any,
) {
  const userId = await ensureUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = (await Promise.resolve(context.params)) as DriverJobParams;
  if (!isDriverJobId(jobId)) {
    return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
  }

  const outcome = await deleteEsgDriverJob(jobId, userId);
  if (!outcome) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (outcome === "linked") {
    return NextResponse.json(
      {
        error:
          "This driver pack is the parent of a retry job and must be retained for provenance.",
      },
      { status: 409 },
    );
  }

  return NextResponse.json(
    { success: true, jobId, status: outcome },
    { status: outcome === "cancelling" ? 202 : 200 },
  );
}
