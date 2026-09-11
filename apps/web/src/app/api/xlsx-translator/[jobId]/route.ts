import { NextResponse } from "next/server";
import { esgPrisma } from "@esgcredit/db-esg";
import { requirePdfxUser } from "@/lib/pdfx-v2/auth";
import { buildPdfContentDisposition } from "@/lib/pdfx-v2/constants";
import {
  requestBackgroundJobCancellation,
  JobConcurrencyLimitError,
  rethrowBackgroundJobEnqueueError,
} from "@/lib/jobs/queue";
import {
  buildPlan,
  inspectWorkbook,
  sheetPreview,
  WorkbookInputError,
  assertSavedFormulaResults,
  valuesOnlyWorkbook,
} from "@/lib/xlsx-translator/workbook";
import {
  excelJobView,
  ownedExcelJob,
  SelectionSchema,
  startExcelJob,
  restoreExcelDraft,
  reviewExcelRecovery,
  resumeExcelJob,
  finalizeExcelSavedResults,
  reviewExcelAddition,
  addExcelTranslation,
} from "@/lib/xlsx-translator/jobs";
import {
  XLSX_JOB_TYPE,
  type ExcelCheckpoint,
  type ExcelPayload,
} from "@/lib/xlsx-translator/types";
import { z } from "zod";
import { buildJobPlan } from "@/lib/xlsx-translator/job-plan";
import { isTranslatorRequestOriginAllowed } from "@/lib/document-translator/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ jobId: string }> };
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const missingResultsAdvice =
  "Some selected cells have no saved translation results. Their original text is shown and a complete download is unavailable. Only eligible cells can be selected again; cells already in the target language or protected by workbook rules require support review of this saved job.";
async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new WorkbookInputError("Missing request body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.length;
      if (size > 128 * 1024) {
        await reader.cancel();
        throw new WorkbookInputError("Selection request is too large.");
      }
      chunks.push(r.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WorkbookInputError("Invalid selection JSON.");
  }
}
function failure(error: unknown) {
  if (error instanceof WorkbookInputError || error instanceof z.ZodError)
    return json(
      {
        error:
          error instanceof z.ZodError
            ? "Invalid table selection."
            : error.message,
      },
      422,
    );
  if (error instanceof JobConcurrencyLimitError)
    return json(
      {
        error:
          "Two Excel translations are already active. Wait for one to finish.",
      },
      429,
    );
  console.error(
    "[xlsx-translator] request failed",
    error instanceof Error ? error.name : "Error",
  );
  return json({ error: "Spreadsheet request failed. Please try again." }, 500);
}
function checkpointPreviewData(
  book: ReturnType<typeof inspectWorkbook>,
  payload: ExcelPayload,
  checkpoint: ExcelCheckpoint | null,
  status: string,
) {
  const translations: Record<string, string> = {};
  const pending = new Set<string>();
  const unavailable = new Set<string>();
  // A draft is only a selection preview: it has no requested translations yet.
  if (status !== "draft" && (payload.selections || payload.additions?.length)) {
    const active = ["queued", "processing", "cancelling"].includes(status);
    for (const entry of buildJobPlan(book, payload).entries) {
      const accepted = checkpoint?.translations?.[entry.id];
      if (typeof accepted === "string") {
        for (const key of entry.cells) translations[key] = accepted;
      } else {
        for (const key of entry.cells)
          (active ? pending : unavailable).add(key);
      }
    }
  }
  return { translations, pending, unavailable };
}
export async function GET(request: Request, context: Context) {
  const auth = await requirePdfxUser();
  if (auth.response) return auth.response;
  try {
    const url = new URL(request.url),
      view = url.searchParams.get("view") || "status";
    const { jobId } = await context.params,
      row = await ownedExcelJob(jobId, auth.userId, view !== "status");
    if (!row) return json({ error: "Workbook not found." }, 404);
    if (view === "download") {
      if (row.status !== "done" || !row.output_data)
        return json({ error: "The translated workbook is not ready." }, 409);
      const p = row.payload_json as unknown as ExcelPayload;
      if (p.selections?.length || p.additions?.length) {
        if (!row.input_data)
          return json(
            {
              error:
                "Workbook source has expired; the completed translation cannot be verified.",
            },
            410,
          );
        const { unavailable } = checkpointPreviewData(
          inspectWorkbook(Buffer.from(row.input_data)),
          p,
          row.result_json as unknown as ExcelCheckpoint | null,
          row.status,
        );
        if (unavailable.size)
          return json(
            {
              error: missingResultsAdvice,
            },
            409,
          );
      }
      return new NextResponse(
        new Uint8Array(valuesOnlyWorkbook(Buffer.from(row.output_data))),
        {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": buildPdfContentDisposition(
              "attachment",
              `translated_${p.filename}`,
            ),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    if (view === "status") return json(excelJobView(row));
    if (!row.input_data)
      return json({ error: "Workbook source has expired." }, 410);
    const book = inspectWorkbook(Buffer.from(row.input_data));
    if (view === "inspect")
      return json({
        job: excelJobView(row),
        inspection: book.inspection,
        selections: [
          ...((row.payload_json as unknown as ExcelPayload).selections || []),
          ...(
            (row.payload_json as unknown as ExcelPayload).additions || []
          ).flatMap((a) => a.selections),
        ],
      });
    if (view === "preview") {
      const p = row.payload_json as unknown as ExcelPayload,
        c = row.result_json as unknown as ExcelCheckpoint | null;
      const { translations, pending, unavailable } = checkpointPreviewData(
        book,
        p,
        c,
        row.status,
      );
      const sheet = url.searchParams.get("sheet") || book.sheets[0].name;
      const preview = sheetPreview(
        book,
        sheet,
        url.searchParams.get("range") || "A1:H30",
        translations,
        pending,
      );
      return json({
        ...preview,
        cells: preview.cells.map((cell) => ({
          ...cell,
          translationUnavailable: unavailable.has(
            JSON.stringify([sheet, cell.address]),
          ),
        })),
        unavailableCells: unavailable.size,
        ...(unavailable.size
          ? {
              translationWarning:
                row.status === "done"
                  ? `This job was marked complete, but its saved results are incomplete. ${missingResultsAdvice}`
                  : missingResultsAdvice,
            }
          : {}),
      });
    }
    return json({ error: "Unsupported view." }, 400);
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, context: Context) {
  const auth = await requirePdfxUser();
  if (auth.response) return auth.response;
  if (!isTranslatorRequestOriginAllowed(request))
    return json({ error: "Invalid request origin." }, 403);
  try {
    const payload = z
      .object({
        action: z.enum([
          "cancel",
          "plan",
          "start",
          "restore",
          "recovery-plan",
          "resume",
          "recheck",
          "addition-plan",
          "add",
        ]),
        confirmationKey: z.string().max(64).optional(),
        selections: z.unknown().optional(),
        targetLang: z.string().optional(),
      })
      .parse(await body(request));
    const { jobId } = await context.params,
      row = await ownedExcelJob(jobId, auth.userId, payload.action === "plan");
    if (!row) return json({ error: "Workbook not found." }, 404);
    if (payload.action === "addition-plan")
      return json(
        await reviewExcelAddition(jobId, auth.userId, payload.selections),
      );
    if (payload.action === "add")
      return json(
        await addExcelTranslation(
          jobId,
          auth.userId,
          payload.selections,
          payload.confirmationKey || "",
        ),
      );
    if (payload.action === "recheck")
      return json(await finalizeExcelSavedResults(jobId, auth.userId));
    if (payload.action === "recovery-plan")
      return json(await reviewExcelRecovery(jobId, auth.userId));
    if (payload.action === "resume")
      return json(
        await resumeExcelJob(jobId, auth.userId, payload.confirmationKey || ""),
      );
    if (payload.action === "restore")
      return json(await restoreExcelDraft(jobId, auth.userId));
    if (payload.action === "cancel")
      return json({
        status: await requestBackgroundJobCancellation(jobId, auth.userId),
      });
    if (payload.action === "plan") {
      if (row.status !== "draft" || !row.input_data)
        return json({ error: "Only draft workbooks can be selected." }, 409);
      const selections = SelectionSchema.parse(payload.selections),
        target = z
          .enum(["English", "Russian", "Arabic"])
          .parse(payload.targetLang);
      const book = inspectWorkbook(Buffer.from(row.input_data));
      assertSavedFormulaResults(book);
      const plan = buildPlan(book, selections, target);
      return json({
        selectedCells: plan.selectedCells,
        protectedCells: plan.protectedCells,
        uniqueTexts: plan.entries.length,
        characters: plan.characters,
        batches: plan.batches.length,
        maxRequests: plan.batches.length * 2,
        examples: plan.entries.slice(0, 8).map((e) => ({
          text: e.source,
          context: e.context,
          language: e.language,
        })),
        note: "Estimate only: two requests maximum per batch. Provider tokens are reported after translation.",
      });
    }
    if (payload.action === "start") {
      try {
        return json(
          await startExcelJob(
            jobId,
            auth.userId,
            payload.selections,
            payload.targetLang || "",
          ),
        );
      } catch (error) {
        rethrowBackgroundJobEnqueueError(error);
      }
    }
    return json({ error: "Unsupported action." }, 400);
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  const auth = await requirePdfxUser();
  if (auth.response) return auth.response;
  if (!isTranslatorRequestOriginAllowed(request))
    return json({ error: "Invalid request origin." }, 403);
  try {
    const { jobId } = await context.params;
    if (!z.string().uuid().safeParse(jobId).success)
      return json({ error: "Workbook not found." }, 404);
    const deleted = await esgPrisma.background_jobs.deleteMany({
      where: {
        id: jobId,
        user_id: auth.userId,
        job_type: XLSX_JOB_TYPE,
        status: { in: ["draft", "done", "error", "cancelled"] },
      },
    });
    return deleted.count
      ? json({ success: true })
      : json(
          {
            error:
              "Workbook not found or still active. Cancel it before deleting.",
          },
          409,
        );
  } catch (error) {
    return failure(error);
  }
}
