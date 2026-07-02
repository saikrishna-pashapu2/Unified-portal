import { NextResponse } from "next/server";
import { ensureUserId } from "@/lib/auth-db";
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

  const deleted = await deleteEsgDriverJob(jobId, userId);
  if (!deleted) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, jobId });
}
