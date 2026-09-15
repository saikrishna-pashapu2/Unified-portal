import { buildDriverWorkbook } from "@/lib/esg-drivers/export";
import { NextResponse } from "next/server";
import { ensureUserId } from "@/lib/session-user";
import { savedResultError } from '@/lib/esg-drivers/result-integrity';
import { enforceApiUsage } from "@/lib/api-usage";
import { workbookErrorResponse } from "@/lib/workbook";
import {
  getEsgDriverJob,
  isDriverJobId,
  type EsgDriverResult,
} from "@/lib/esg-drivers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DriverJobParams = { jobId: string };

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(request: Request, context: any) {
  const userId = await ensureUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = (await Promise.resolve(context.params)) as DriverJobParams;
  if (!isDriverJobId(jobId)) {
    return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
  }

  const limited = await enforceApiUsage(request, {
    feature: "esg_driver_export",
    userId,
    perMinute: 6,
    perDay: 50,
  });
  if (limited) return limited;

  const job = await getEsgDriverJob(jobId, userId, { includeCheckpoint: true });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "done" || !job.result) {
    const terminal = job.status === "error" || job.status === "cancelled";
    const missingCompletedResult = job.status === "done" && !job.result;
    return NextResponse.json(
      {
        error: missingCompletedResult
          ? "Completed driver pack is unavailable."
          : terminal
            ? job.error || `Driver pack ${job.status}.`
            : "Driver pack is not ready for export.",
        status: job.status,
      },
      { status: missingCompletedResult ? 500 : terminal ? 409 : 202 },
    );
  }

  const integrityError = savedResultError(job.result, job.checkpoint);
  if (integrityError) return NextResponse.json({ error: integrityError }, { status: 409 });

  let buffer: Buffer;
  try {
    buffer = await buildDriverWorkbook(job.result);
  } catch (error) {
    const response = workbookErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
  const filename = buildExportFilename(job.result, job.id);

  return new NextResponse(buffer as any, {
    headers: {
      "content-type": XLSX_CONTENT_TYPE,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

function buildExportFilename(result: EsgDriverResult, jobId: string): string {
  const generatedDate = result.generatedAt.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const base = [
    "esg-drivers",
    result.country,
    result.sector,
    result.language,
    generatedDate,
    jobId.slice(0, 8),
  ]
    .map(slugifyFilenamePart)
    .filter(Boolean)
    .join("-");

  return `${base || `esg-drivers-${jobId}`}.xlsx`;
}

function slugifyFilenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
