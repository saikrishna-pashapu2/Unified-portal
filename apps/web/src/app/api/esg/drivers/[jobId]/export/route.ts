import { NextResponse } from "next/server";
import { ensureUserId } from "@/lib/session-user";
import { enforceApiUsage } from "@/lib/api-usage";
import { workbookErrorResponse, writeWorkbookBuffer } from "@/lib/workbook";
import {
  getEsgDriverJob,
  isDriverJobId,
  type EsgDriver,
  type EsgDriverResult,
  type EsgDriverSource,
} from "@/lib/esg-drivers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DriverJobParams = { jobId: string };

const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const DRIVER_HEADERS = [
  "Driver Section",
  "Driver Type",
  "Driver Title",
  "Driver Text",
  "Country/Sector Relevance",
  "Evidence/KPI",
  "Key Sources",
  "Source Links",
  "Confidence",
  "Last Checked",
];

const SOURCE_HEADERS = [
  "Source ID",
  "Used By Drivers",
  "Approved Source",
  "Approval Usage",
  "Title",
  "Domain",
  "URL",
  "Snippet",
  "Publication Date",
  "Updated Date",
  "Last Modified",
  "Retrieved At",
  "Authority",
  "Freshness",
  "Relevance",
  "Source Score",
];

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

  const job = await getEsgDriverJob(jobId, userId);
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
            ? `Driver pack ${job.status}.`
            : "Driver pack is not ready for export.",
        status: job.status,
      },
      { status: missingCompletedResult ? 500 : terminal ? 409 : 202 },
    );
  }

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

async function buildDriverWorkbook(result: EsgDriverResult): Promise<Buffer> {
  return writeWorkbookBuffer([
    {
      name: "Summary",
      rows: buildSummaryRows(result),
      columnWidths: [24, 80],
    },
    {
      name: "Drivers",
      rows: [DRIVER_HEADERS, ...result.drivers.map(driverToRow)],
      columnWidths: [24, 20, 42, 72, 64, 54, 42, 64, 12, 16],
      autoFilter: `A1:J${Math.max(result.drivers.length + 1, 1)}`,
      freezeRows: 1,
    },
    {
      name: "Sources",
      rows: [
        SOURCE_HEADERS,
        ...result.evidence.map((source) => sourceToRow(source, result.drivers)),
      ],
      columnWidths: [16, 24, 36, 16, 54, 26, 64, 90, 18, 18, 18, 18, 12, 12, 12, 12],
      autoFilter: `A1:P${Math.max(result.evidence.length + 1, 1)}`,
      freezeRows: 1,
    },
  ]);
}

function buildSummaryRows(result: EsgDriverResult): Array<Array<string | number>> {
  const averageConfidence =
    result.drivers.reduce((sum, driver) => sum + driver.confidence, 0) /
    Math.max(result.drivers.length, 1);

  return [
    ["ESG Driver Pack Export", ""],
    ["Country", result.country],
    ["Sector", result.sector],
    ["Language", result.language],
    ["Catalog Version", result.catalogVersion || "legacy-unknown"],
    ["Generated At", result.generatedAt],
    ["Completion", result.completion === "partial" ? "Partial" : "Complete"],
    ["Driver Count", result.drivers.length],
    ["Expected Driver Count", result.expectedDriverCount ?? 12],
    [
      "Omitted Driver Slots",
      (result.slotFailures || []).map((failure) => failure.driverId).join(", ") || "None",
    ],
    ["Source Count", result.evidence.length],
    ["Average Confidence", Math.round(averageConfidence)],
    ["Warnings", result.warnings.join("\n") || "None"],
  ];
}

function driverToRow(driver: EsgDriver): Array<string | number> {
  return [
    driver.driverSection,
    driver.driverType,
    driver.driverTitle,
    driver.driverText,
    driver.countrySectorRelevance,
    driver.evidenceKpi,
    driver.keySources.join("\n"),
    driver.sourceLinks.join("\n"),
    driver.confidence,
    driver.lastChecked,
  ];
}

function sourceToRow(
  source: EsgDriverSource,
  drivers: EsgDriver[],
): Array<string | number> {
  const usedByDrivers = drivers
    .filter(
      (driver) =>
        driver.sourceRefs.includes(source.id) || driver.sourceLinks.includes(source.url),
    )
    .map((driver) => driver.id)
    .join(", ");

  return [
    source.id,
    usedByDrivers,
    source.approvalLabel || "",
    source.approvalUsage || "",
    source.title,
    source.domain,
    source.url,
    source.contentSnippet || source.snippet,
    source.publishedDate || "",
    source.updatedDate || "",
    source.lastModified || "",
    source.retrievedAt,
    source.authorityScore,
    source.freshnessScore,
    source.relevanceScore,
    source.sourceScore,
  ];
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
