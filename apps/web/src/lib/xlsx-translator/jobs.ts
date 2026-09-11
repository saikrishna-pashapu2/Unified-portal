import { randomUUID, createHash } from "node:crypto";
import { esgPrisma } from "@esgcredit/db-esg";
import { z } from "zod";
import {
  createBackgroundJobData,
  JobConcurrencyLimitError,
  rethrowBackgroundJobEnqueueError,
  JobLeaseLostError,
  throwIfJobCancelled,
  updateBackgroundJobProgress,
  type ClaimedBackgroundJob,
} from "@/lib/jobs/queue";
import {
  XLSX_JOB_TYPE,
  type ExcelPayload,
  type ExcelCheckpoint,
  type ExcelJobView,
} from "./types";
import {
  buildPlan,
  inspectWorkbook,
  writeTranslations,
  WorkbookInputError,
  assertSavedFormulaResults,
} from "./workbook";
import {
  requestBatch,
  validateBatchCells,
  validateSavedCandidate,
  type BatchUsage,
} from "./translate";
import { protectedTokens } from "./language";
import { buildJobPlan } from "./job-plan";
import { isPdfxV2TargetLanguage } from "@/lib/pdfx-v2/types";

export class ExcelRequestBudgetError extends Error {}
export class ExcelSelectionError extends Error {}
const CURRENT_PLAN_VERSION = 3 as const;

export const SelectionSchema = z
  .array(
    z.object({
      sheet: z.string().min(1).max(100),
      range: z.string().min(1).max(40),
      columns: z
        .array(z.number().int().min(1).max(16384))
        .max(16384)
        .optional(),
      sourceLanguage: z
        .enum(["Auto", "Uzbek", "Russian", "English", "Arabic", "Unknown"])
        .optional(),
    }),
  )
  .min(1)
  .max(200);
const emptyCheckpoint = (): ExcelCheckpoint => ({
  version: 1,
  translations: {},
  attempts: {},
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  requests: 0,
  completedBatches: 0,
  totalBatches: 0,
  translatedCells: 0,
});
export const planHash = (selections: unknown, target: string) =>
  createHash("sha256")
    // JSONB does not preserve object key order. Rebuild schema fields in their
    // original deterministic order, retaining the v1 enqueue hash format.
    .update(
      JSON.stringify({ selections: SelectionSchema.parse(selections), target }),
    )
    .digest("hex");

function validSelection(payload: ExcelPayload): boolean {
  try {
    return (
      isPdfxV2TargetLanguage(payload.targetLang) &&
      (payload.planVersion === undefined ||
        payload.planVersion === 2 ||
        payload.planVersion === 3) &&
      payload.planHash === planHash(payload.selections, payload.targetLang) &&
      (!payload.additions ||
        (Array.isArray(payload.additions) &&
          payload.additions.length <= 200 &&
          new Set(payload.additions.map((a) => a.id)).size ===
            payload.additions.length &&
          payload.additions.every(
            (a) =>
              z.string().uuid().safeParse(a.id).success &&
              (a.planVersion === undefined ||
                a.planVersion === 2 ||
                a.planVersion === 3) &&
              a.planHash === planHash(a.selections, payload.targetLang),
          )))
    );
  } catch {
    return false;
  }
}

function canRestoreDraft(row: {
  status: string;
  last_error: string | null;
  result_json: unknown;
  payload_json: unknown;
}) {
  const c = row.result_json as ExcelCheckpoint | null;
  return (
    row.status === "error" &&
    row.last_error === "Invalid spreadsheet job selection." &&
    !!c &&
    c.requests === 0 &&
    c.completedBatches === 0 &&
    Object.keys(c.attempts || {}).length === 0 &&
    Object.keys(c.translations || {}).length === 0 &&
    validSelection(row.payload_json as ExcelPayload)
  );
}
export async function createExcelDraft(
  userId: number,
  filename: string,
  input: Buffer,
  targetLang: string,
) {
  const book = inspectWorkbook(input),
    id = randomUUID();
  const safeName =
    filename
      .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
      .slice(0, 180)
      .replace(/\.[^.]*$/, "") + ".xlsx";
  try {
    await esgPrisma.background_jobs.create({
      data: {
        ...createBackgroundJobData({
          id,
          jobType: XLSX_JOB_TYPE,
          userId,
          payload: { filename: safeName, targetLang },
          inputData: input,
          maxAttempts: 3,
        }),
        status: "draft",
      },
    });
  } catch (error) {
    rethrowBackgroundJobEnqueueError(error);
  }
  return { jobId: id, kind: "xlsx", inspection: book.inspection };
}
export async function ownedExcelJob(
  id: string,
  userId: number,
  includeData = false,
) {
  if (!z.string().uuid().safeParse(id).success) return null;
  return esgPrisma.background_jobs.findFirst({
    where: { id, user_id: userId, job_type: XLSX_JOB_TYPE },
    select: {
      id: true,
      payload_json: true,
      result_json: true,
      status: true,
      last_error: true,
      progress: true,
      created_at: true,
      input_data: includeData,
      output_data: includeData,
    },
  });
}
export function excelJobView(
  row: NonNullable<Awaited<ReturnType<typeof ownedExcelJob>>>,
): ExcelJobView {
  const p = row.payload_json as unknown as ExcelPayload,
    c = row.result_json as unknown as ExcelCheckpoint | null;
  const status = row.status === "done" ? "completed" : row.status;
  return {
    id: row.id,
    filename: p.filename,
    targetLang: p.targetLang,
    status,
    progress: status === "error" ? Math.min(row.progress, 99) : row.progress,
    createdAt: row.created_at.toISOString(),
    canDownload: status === "completed",
    hasTranslation: Object.keys(c?.translations || {}).length > 0,
    canRestoreDraft: canRestoreDraft(row),
    canExtend:
      ["done", "error"].includes(row.status) && !!c && validSelection(p),
    canRecheckSaved:
      status === "error" &&
      !!c &&
      Object.keys(c.rejectedCells || {}).length > 0 &&
      validSelection(p),
    canReviewRecovery:
      status === "error" &&
      !!c &&
      c.requests > 0 &&
      !c.recoveryApproved &&
      validSelection(p),
    message:
      status === "draft"
        ? "Choose the tables and columns to translate."
        : status === "error"
          ? canRestoreDraft(row)
            ? "Translation did not start because of a saved-selection compatibility error. No translation API requests were made. Return to review to try again."
            : Object.keys(c?.translations || {}).length
              ? "Translation stopped. Validated cells are retained; the preview is partial and no incomplete download is offered."
              : "Translation stopped before any translated cells were saved. Only the original workbook is available."
          : status === "cancelled"
            ? "Translation cancelled."
            : status === "completed"
              ? c &&
                c.requests > 0 &&
                Object.keys(c.translations || {}).length > 0 &&
                c.translatedCells === 0
                ? "Selected text reviewed; no text changes were needed in the saved results. It may already be in the target language or contain protected content. You can select another cell or worksheet to continue."
                : "Selected cells processed. Protected and unselected content preserved. You can select another cell or worksheet to continue."
              : `${c?.completedBatches || 0} of ${c?.totalBatches || 0} text batches completed`,
    usage: c
      ? {
          version: 1,
          inputTokens: c.inputTokens,
          outputTokens: c.outputTokens,
          cachedInputTokens: c.cachedInputTokens,
          requests: c.requests,
          completedBatches: c.completedBatches,
          totalBatches: c.totalBatches,
          translatedCells: c.translatedCells,
        }
      : null,
  };
}

// Only the pre-API v1 compatibility failure may be returned to draft. Never
// clear paid request reservations or silently restart a failed translation.
export async function restoreExcelDraft(id: string, userId: number) {
  const row = await ownedExcelJob(id, userId, true);
  if (!row || !row.input_data || !canRestoreDraft(row))
    throw new WorkbookInputError(
      "This job cannot be returned to review without resetting translation work.",
    );
  const changed = await esgPrisma.background_jobs.updateMany({
    where: {
      id,
      user_id: userId,
      job_type: XLSX_JOB_TYPE,
      status: "error",
      last_error: "Invalid spreadsheet job selection.",
      payload_json: { equals: row.payload_json as any },
      result_json: { equals: row.result_json as any },
    },
    data: {
      status: "draft",
      attempts: 0,
      progress: 0,
      last_error: null,
      completed_at: null,
      lease_owner: null,
      lease_expires_at: null,
      cancel_requested: false,
      updated_at: new Date(),
    },
  });
  if (changed.count !== 1)
    throw new WorkbookInputError(
      "This job changed. Refresh before trying again.",
    );
  return { jobId: id };
}
export async function startExcelJob(
  id: string,
  userId: number,
  raw: unknown,
  target: string,
) {
  const selections = SelectionSchema.parse(raw);
  if (!isPdfxV2TargetLanguage(target))
    throw new WorkbookInputError("Unsupported target language.");
  const row = await ownedExcelJob(id, userId, true);
  if (!row || !row.input_data)
    throw new WorkbookInputError("Workbook not found.");
  if (row.status !== "draft")
    throw new WorkbookInputError("This workbook has already been submitted.");
  const book = inspectWorkbook(Buffer.from(row.input_data));
  assertSavedFormulaResults(book);
  const plan = buildPlan(book, selections, target);
  if (!plan.entries.length)
    throw new WorkbookInputError(
      "No eligible text in this selection. English, target-language text, numbers, identifiers and protected formatting stay unchanged.",
    );
  const payload = {
    ...(row.payload_json as unknown as ExcelPayload),
    targetLang: target,
    planVersion: CURRENT_PLAN_VERSION,
    selections,
    planHash: planHash(selections, target),
  };
  const checkpoint = {
    ...emptyCheckpoint(),
    totalBatches: plan.batches.length,
  };
  // The shared queue trigger checks INSERT only. Draft-to-queued transitions
  // must take the same lock and check concurrency atomically themselves.
  const changed = await esgPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${userId}::integer, hashtext(${XLSX_JOB_TYPE}))`;
    const active = await tx.background_jobs.count({
      where: {
        user_id: userId,
        job_type: XLSX_JOB_TYPE,
        status: { in: ["queued", "processing"] },
      },
    });
    if (active >= 2) throw new JobConcurrencyLimitError();
    return tx.background_jobs.updateMany({
      where: { id, user_id: userId, job_type: XLSX_JOB_TYPE, status: "draft" },
      data: {
        status: "queued",
        payload_json: payload as any,
        result_json: checkpoint as any,
        available_at: new Date(),
        updated_at: new Date(),
      },
    });
  });
  if (changed.count !== 1)
    throw new WorkbookInputError("This workbook was already submitted.");
  return { jobId: id, batches: plan.batches.length };
}

// Pure offline revalidation and serialization. Never calls a provider or
// changes the supplied checkpoint; accepted entries and all spend counters
// remain intact. Replacements are built only from the saved selection plan.
export function recheckExcelSavedResults(
  input: Buffer,
  payload: ExcelPayload,
  saved: ExcelCheckpoint,
) {
  if (!validSelection(payload))
    throw new ExcelSelectionError("Invalid spreadsheet job selection.");
  const book = inspectWorkbook(input);
  assertSavedFormulaResults(book);
  const plan = buildJobPlan(book, payload);
  const checkpoint = structuredClone(saved);
  let recoveredEntries = 0;
  for (const entry of plan.entries) {
    if (checkpoint.translations[entry.id] !== undefined) continue;
    const candidate = checkpoint.rejectedCells?.[entry.id];
    if (!candidate) continue;
    const checked = validateSavedCandidate(
      entry,
      candidate,
      payload.targetLang,
    );
    if (checked.translations[entry.id] !== undefined) {
      checkpoint.translations[entry.id] = checked.translations[entry.id];
      delete checkpoint.rejectedCells![entry.id];
      recoveredEntries++;
    }
  }
  const remainingEntries = plan.entries.filter(
    (e) => checkpoint.translations[e.id] === undefined,
  ).length;
  if (remainingEntries)
    return { recoveredEntries, remainingEntries, checkpoint, outputData: null };
  const replacements: Record<string, string> = {};
  for (const entry of plan.entries)
    if (checkpoint.translations[entry.id] !== entry.source)
      for (const cell of entry.cells)
        replacements[cell] = checkpoint.translations[entry.id];
  checkpoint.completedBatches = plan.batches.length;
  checkpoint.totalBatches = plan.batches.length;
  checkpoint.translatedCells = Object.keys(replacements).length;
  checkpoint.batchIssues = {};
  checkpoint.rejectedCells = {};
  delete checkpoint.lastRequestFailure;
  const outputData = writeTranslations(book, replacements);
  return { recoveredEntries, remainingEntries, checkpoint, outputData };
}

// Explicit owner action; never queues translation or grants/resets requests.
// Commit output and status together, only if the error-state snapshot still
// matches. An active, changed or deleted job cannot be finalized underneath it.
export async function finalizeExcelSavedResults(id: string, userId: number) {
  const row = await ownedExcelJob(id, userId, true);
  if (!row || row.status !== "error" || !row.input_data || !row.result_json)
    throw new WorkbookInputError(
      "Only a stopped workbook with saved results can be rechecked.",
    );
  const result = recheckExcelSavedResults(
    Buffer.from(row.input_data),
    row.payload_json as unknown as ExcelPayload,
    row.result_json as unknown as ExcelCheckpoint,
  );
  if (!result.outputData || result.remainingEntries)
    throw new WorkbookInputError(
      `${result.remainingEntries} text entries still need correction or a saved response. No API calls were made and saved results were not changed.`,
    );
  const changed = await esgPrisma.background_jobs.updateMany({
    where: {
      id,
      user_id: userId,
      job_type: XLSX_JOB_TYPE,
      status: "error",
      payload_json: { equals: row.payload_json as any },
      result_json: { equals: row.result_json as any },
    },
    data: {
      status: "done",
      progress: 100,
      output_data: result.outputData,
      result_json: result.checkpoint as any,
      last_error: null,
      completed_at: new Date(),
      updated_at: new Date(),
      lease_owner: null,
      lease_expires_at: null,
    },
  });
  if (changed.count !== 1)
    throw new WorkbookInputError(
      "This job changed. Refresh before rechecking it.",
    );
  return {
    jobId: id,
    recoveredEntries: result.recoveredEntries,
    additionalRequests: 0,
  };
}

async function additionDetails(id: string, userId: number, raw: unknown) {
  const selections = SelectionSchema.parse(raw);
  const row = await ownedExcelJob(id, userId, true);
  const p = row?.payload_json as unknown as ExcelPayload;
  const c = row?.result_json as unknown as ExcelCheckpoint;
  if (
    !row ||
    !row.input_data ||
    !["done", "error"].includes(row.status) ||
    !c ||
    !validSelection(p)
  )
    throw new WorkbookInputError(
      "Wait for the current translation to stop before selecting more cells or worksheets.",
    );
  if ((p.additions?.length || 0) >= 200)
    throw new WorkbookInputError(
      "This workbook has reached its 200-addition safety limit.",
    );
  const book = inspectWorkbook(Buffer.from(row.input_data));
  assertSavedFormulaResults(book);
  const plan = buildPlan(book, selections, p.targetLang);
  if (!plan.entries.length)
    throw new WorkbookInputError(
      "No eligible text in this selection. English, target-language text, numbers, identifiers and protected cells remain unchanged.",
    );
  const existing = new Set(
    buildJobPlan(book, p)
      .entries.filter((e) => c.translations[e.id] !== undefined)
      .flatMap((e) => e.cells),
  );
  const replacements = plan.entries.reduce(
    (n, e) => n + e.cells.filter((cell) => existing.has(cell)).length,
    0,
  );
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        id,
        status: row.status,
        payload: row.payload_json,
        checkpoint: row.result_json,
        selections,
        // A previously reviewed allowance must not survive a rules deployment
        // or a changed derived scope. Paid scopes retain their original keys;
        // this snapshot applies only to this new addition confirmation.
        planVersion: CURRENT_PLAN_VERSION,
        plan: {
          selectedCells: plan.selectedCells,
          protectedCells: plan.protectedCells,
          entries: plan.entries.map((entry) => ({
            id: entry.id,
            cells: entry.cells,
          })),
          batches: plan.batches.map((batch) => batch.map((entry) => entry.id)),
          maxRequests: plan.batches.length * 2,
          replacingCells: replacements,
        },
      }),
    )
    .digest("hex");
  return {
    row,
    p,
    c,
    selections,
    review: {
      key,
      targetLang: p.targetLang,
      selections,
      selectedCells: plan.selectedCells,
      protectedCells: plan.protectedCells,
      uniqueTexts: plan.entries.length,
      batches: plan.batches.length,
      maxRequests: plan.batches.length * 2,
      replacingCells: replacements,
      examples: plan.entries
        .slice(0, 5)
        .map((e) => ({ text: e.source, context: e.context })),
    },
  };
}
export async function reviewExcelAddition(
  id: string,
  userId: number,
  raw: unknown,
) {
  return (await additionDetails(id, userId, raw)).review;
}
export async function addExcelTranslation(
  id: string,
  userId: number,
  raw: unknown,
  confirmationKey: string,
) {
  const { row, p, c, selections, review } = await additionDetails(
    id,
    userId,
    raw,
  );
  if (review.key !== confirmationKey)
    throw new WorkbookInputError(
      "The selection or workbook changed. Review it again before confirming.",
    );
  const payload: ExcelPayload = {
    ...p,
    additions: [
      ...(p.additions || []),
      {
        id: randomUUID(),
        planVersion: CURRENT_PLAN_VERSION,
        selections,
        planHash: planHash(selections, p.targetLang),
      },
    ],
  };
  const checkpoint = { ...c, totalBatches: c.totalBatches + review.batches };
  const changed = await esgPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${userId}::integer, hashtext(${XLSX_JOB_TYPE}))`;
    const active = await tx.background_jobs.count({
      where: {
        user_id: userId,
        job_type: XLSX_JOB_TYPE,
        status: { in: ["queued", "processing"] },
      },
    });
    if (active >= 2) throw new JobConcurrencyLimitError();
    return tx.background_jobs.updateMany({
      where: {
        id,
        user_id: userId,
        job_type: XLSX_JOB_TYPE,
        status: row.status,
        payload_json: { equals: row.payload_json as any },
        result_json: { equals: row.result_json as any },
      },
      data: {
        status: "queued",
        attempts: 0,
        progress: 0,
        last_error: null,
        completed_at: null,
        cancel_requested: false,
        lease_owner: null,
        lease_expires_at: null,
        available_at: new Date(),
        updated_at: new Date(),
        payload_json: payload as any,
        result_json: checkpoint as any,
      },
    });
  });
  if (changed.count !== 1)
    throw new WorkbookInputError(
      "This addition was already submitted or the workbook changed.",
    );
  return { jobId: id, maxRequests: review.maxRequests };
}

async function recoveryDetails(id: string, userId: number) {
  const row = await ownedExcelJob(id, userId, true);
  const c = row?.result_json as unknown as ExcelCheckpoint | null;
  const p = row?.payload_json as unknown as ExcelPayload;
  if (
    !row ||
    !row.input_data ||
    row.status !== "error" ||
    !c ||
    !c.requests ||
    c.recoveryApproved ||
    !validSelection(p)
  )
    throw new WorkbookInputError(
      "This workbook is not eligible for a recovery. Saved work and request counters were not changed.",
    );
  const plan = buildJobPlan(inspectWorkbook(Buffer.from(row.input_data)), p);
  const granted: string[] = [];
  let maxRequests = 0,
    pendingEntries = 0;
  for (let i = 0; i < plan.batches.length; i++) {
    const pending = plan.batches[i].filter(
      (e) => c.translations[e.id] === undefined,
    );
    if (!pending.length) continue;
    pendingEntries += pending.length;
    const key = plan.batchKeys[i];
    const attempts = c.attempts[key] || 0;
    if (!Number.isInteger(attempts) || attempts < 0 || attempts > 2)
      throw new WorkbookInputError(
        "Invalid saved request counters; contact support.",
      );
    if (attempts === 2) {
      granted.push(key);
      maxRequests++;
    } else maxRequests += 2 - attempts;
  }
  if (!maxRequests)
    throw new WorkbookInputError(
      "No remaining translation work is eligible for recovery.",
    );
  const key = createHash("sha256")
    .update(
      JSON.stringify({
        id,
        payload: row.payload_json,
        checkpoint: row.result_json,
      }),
    )
    .digest("hex");
  return {
    row,
    c,
    granted,
    review: {
      key,
      maxRequests,
      pendingEntries,
      savedCells: c.translatedCells,
      exhaustedBatches: granted.length,
    },
  };
}
export async function reviewExcelRecovery(id: string, userId: number) {
  return (await recoveryDetails(id, userId)).review;
}
// This is a user-confirmed, one-time recovery, not a worker retry. Never
// reset paid counters or retranslate accepted entries. Recheck the snapshot
// and shared concurrency lock so double-clicks cannot grant extra requests.
export async function resumeExcelJob(
  id: string,
  userId: number,
  confirmationKey: string,
) {
  const { row, c, granted, review } = await recoveryDetails(id, userId);
  if (review.key !== confirmationKey)
    throw new WorkbookInputError(
      "The job changed. Review the recovery again before confirming.",
    );
  const changed = await esgPrisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${userId}::integer, hashtext(${XLSX_JOB_TYPE}))`;
    const active = await tx.background_jobs.count({
      where: {
        user_id: userId,
        job_type: XLSX_JOB_TYPE,
        status: { in: ["queued", "processing"] },
      },
    });
    if (active >= 2) throw new JobConcurrencyLimitError();
    return tx.background_jobs.updateMany({
      where: {
        id,
        user_id: userId,
        job_type: XLSX_JOB_TYPE,
        status: "error",
        payload_json: { equals: row.payload_json as any },
        result_json: { equals: row.result_json as any },
      },
      data: {
        status: "queued",
        attempts: 0,
        last_error: null,
        completed_at: null,
        lease_owner: null,
        lease_expires_at: null,
        cancel_requested: false,
        available_at: new Date(),
        updated_at: new Date(),
        result_json: {
          ...c,
          recoveryApproved: true,
          recoveryGranted: granted,
          recoveryForAddition:
            (row.payload_json as unknown as ExcelPayload).additions?.at(-1)
              ?.id || "",
        } as any,
      },
    });
  });
  if (changed.count !== 1)
    throw new WorkbookInputError(
      "This recovery was already submitted or the job changed.",
    );
  return { jobId: id, maxRequests: review.maxRequests };
}

export async function processExcelTranslation(job: ClaimedBackgroundJob) {
  const payload = job.payload as unknown as ExcelPayload;
  if (!job.inputData || !payload || !validSelection(payload))
    throw new ExcelSelectionError("Invalid spreadsheet job selection.");
  const book = inspectWorkbook(job.inputData),
    plan = buildJobPlan(book, payload);
  assertSavedFormulaResults(book);
  const checkpoint =
    (job.result as ExcelCheckpoint | null) || emptyCheckpoint();
  checkpoint.totalBatches = plan.batches.length;
  const isComplete = (batch: typeof plan.entries) =>
    batch.every((e) => checkpoint.translations[e.id] !== undefined);
  async function save() {
    checkpoint.completedBatches = plan.batches.filter(isComplete).length;
    checkpoint.translatedCells = plan.entries.reduce(
      (count, entry) =>
        count +
        (checkpoint.translations[entry.id] !== undefined &&
        checkpoint.translations[entry.id] !== entry.source
          ? entry.cells.length
          : 0),
      0,
    );
    const updated = await esgPrisma.background_jobs.updateMany({
      where: {
        id: job.id,
        job_type: XLSX_JOB_TYPE,
        status: "processing",
        lease_owner: job.leaseOwner,
        lease_expires_at: { gte: new Date() },
        cancel_requested: false,
      },
      data: { result_json: checkpoint as any, updated_at: new Date() },
    });
    if (updated.count !== 1) {
      await throwIfJobCancelled(job.id, job.leaseOwner);
      throw new JobLeaseLostError();
    }
  }
  const recordUsage = (u: BatchUsage) => {
    checkpoint.inputTokens += u.inputTokens;
    checkpoint.outputTokens += u.outputTokens;
    checkpoint.cachedInputTokens += u.cachedInputTokens;
  };
  const unresolved: string[] = [];
  for (let i = 0; i < plan.batches.length; i++) {
    const batch = plan.batches[i],
      key = plan.batchKeys[i];
    if (isComplete(batch)) continue;
    const latest = payload.additions?.at(-1)?.id;
    if (
      latest &&
      !key.startsWith(latest + ":") &&
      !(
        checkpoint.recoveryApproved && checkpoint.recoveryForAddition === latest
      )
    ) {
      unresolved.push(
        `Earlier batch ${i + 1} still has unresolved cells; this addition does not authorize new requests for that scope.`,
      );
      continue;
    }
    let complete = false;
    const limit =
      checkpoint.recoveryApproved && checkpoint.recoveryGranted?.includes(key)
        ? 3
        : 2;
    while ((checkpoint.attempts[key] || 0) < limit) {
      const pending = batch.filter(
        (e) => checkpoint.translations[e.id] === undefined,
      );
      const feedback = JSON.stringify(
        (checkpoint.batchIssues?.[key] || [])
          .filter((issue) => pending.some((e) => e.id === issue.id))
          .map((issue) => ({
            ...issue,
            preserveTokens: protectedTokens(
              pending.find((e) => e.id === issue.id)!.source,
            ),
          })),
      );
      await throwIfJobCancelled(job.id, job.leaseOwner);
      checkpoint.attempts[key] = (checkpoint.attempts[key] || 0) + 1;
      checkpoint.requests++;
      // Reserve persistently before calling the provider. Unknown-billing timeouts still consume an attempt.
      await save();
      let value: Awaited<ReturnType<typeof requestBatch>>["value"];
      try {
        const response = await requestBatch(
          pending,
          payload.targetLang,
          feedback,
        );
        recordUsage(response.usage);
        value = response.value;
        delete checkpoint.lastRequestFailure;
      } catch (error) {
        const u = (error as { providerUsage?: BatchUsage }).providerUsage;
        if (u) recordUsage(u);
        checkpoint.lastRequestFailure = u
          ? "unreadable_response"
          : "request_failed";
        await save();
        throw new Error(
          "Translation request failed; a bounded retry will resume the saved workbook.",
        );
      }
      const checked = validateBatchCells(pending, value, payload.targetLang);
      Object.assign(checkpoint.translations, checked.translations);
      checkpoint.rejectedCells ||= {};
      for (const entry of pending) {
        if (checked.translations[entry.id] !== undefined)
          delete checkpoint.rejectedCells[entry.id];
        else {
          const candidates = value.cells.filter((c) => c.id === entry.id);
          if (candidates.length === 1 && candidates[0].text.length <= 32767) {
            const { text, sourceLanguage, action } = candidates[0];
            checkpoint.rejectedCells[entry.id] = {
              text,
              sourceLanguage,
              action,
            };
          } else delete checkpoint.rejectedCells[entry.id];
        }
      }
      checkpoint.batchIssues ||= {};
      checkpoint.batchIssues[key] = checked.issues;
      complete = isComplete(batch);
      if (complete) delete checkpoint.batchIssues[key];
      // Save accepted cells, usage and specific rejection reasons together,
      // before a corrective request or a terminal budget error.
      await save();
      if (complete) {
        break;
      }
    }
    if (!complete)
      unresolved.push(
        `Spreadsheet batch ${i + 1} exhausted its ${limit === 2 ? "two" : "three approved"} request attempts. No further API calls will be made for this batch. ` +
          (checkpoint.batchIssues?.[key]?.length
            ? checkpoint.batchIssues[key]
                .map((issue) => `${issue.id}: ${issue.reason}`)
                .join("; ")
            : checkpoint.lastRequestFailure === "unreadable_response"
              ? "The provider response was incomplete or unreadable."
              : "No validated response was saved before the request budget was exhausted."),
      );
    await updateBackgroundJobProgress(
      job.id,
      job.leaseOwner,
      Math.floor(((i + 1) / plan.batches.length) * 95),
      {
        message: `Processed batch ${i + 1} of ${plan.batches.length}; ${unresolved.length} batch(es) need review`,
      },
    );
  }
  if (unresolved.length)
    throw new ExcelRequestBudgetError(unresolved.join("\n"));
  const replacements: Record<string, string> = {};
  for (const entry of plan.entries) {
    const text = checkpoint.translations[entry.id];
    if (text === undefined)
      throw new Error("A translation checkpoint is missing.");
    if (text !== entry.source)
      for (const key of entry.cells) replacements[key] = text;
  }
  await throwIfJobCancelled(job.id, job.leaseOwner);
  const outputData = writeTranslations(book, replacements);
  checkpoint.translatedCells = Object.keys(replacements).length;
  return { outputData, result: checkpoint };
}
