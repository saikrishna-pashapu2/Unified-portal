import { beforeEach, describe, it, expect, vi } from "vitest";
import { zipSync, strToU8, unzipSync } from "fflate";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  request: vi.fn(),
  cancel: vi.fn(),
  progress: vi.fn(),
  find: vi.fn(),
  count: vi.fn(),
  lock: vi.fn(),
}));
vi.mock("@esgcredit/db-esg", () => ({
  esgPrisma: {
    background_jobs: { updateMany: mocks.update, findFirst: mocks.find },
    $transaction: async (fn: any) =>
      fn({
        $executeRaw: mocks.lock,
        background_jobs: { count: mocks.count, updateMany: mocks.update },
      }),
  },
}));
vi.mock("@/lib/jobs/queue", () => ({
  createBackgroundJobData: vi.fn(),
  JobLeaseLostError: class extends Error {},
  JobConcurrencyLimitError: class extends Error {},
  rethrowBackgroundJobEnqueueError: (e: unknown) => {
    throw e;
  },
  throwIfJobCancelled: mocks.cancel,
  updateBackgroundJobProgress: mocks.progress,
}));
vi.mock("./translate", async () => {
  const actual =
    await vi.importActual<typeof import("./translate")>("./translate");
  return { ...actual, requestBatch: mocks.request };
});
vi.mock("@/lib/config/env", () => ({ env: {} }));
import {
  planHash,
  processExcelTranslation,
  startExcelJob,
  restoreExcelDraft,
  excelJobView,
  ExcelSelectionError,
  reviewExcelRecovery,
  resumeExcelJob,
  recheckExcelSavedResults,
  finalizeExcelSavedResults,
  reviewExcelAddition,
  addExcelTranslation,
} from "./jobs";
import type { ClaimedBackgroundJob } from "@/lib/jobs/queue";
import { buildPlan, inspectWorkbook } from "./workbook";
import { buildJobPlan } from "./job-plan";
import type { ExcelCheckpoint, ExcelPayload } from "./types";
import { incrementalInput } from "./test-fixtures";
const input = Buffer.from(
  zipSync(
    Object.fromEntries(
      Object.entries({
        "[Content_Types].xml":
          '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
        "xl/workbook.xml":
          '<workbook xmlns:r="urn:r"><sheets><sheet name="Data" r:id="r1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels":
          '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml":
          '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Quyosh panellari</t></is></c></row></sheetData></worksheet>',
      }).map(([k, v]) => [k, strToU8(v)]),
    ),
  ),
);
const selections = [{ sheet: "Data", range: "A1:A1" }];
const makeJob = (result: unknown = null) =>
  ({
    id: "11111111-1111-4111-8111-111111111111",
    leaseOwner: "generic:test",
    inputData: input,
    payload: {
      filename: "test.xlsx",
      targetLang: "Russian",
      selections,
      planHash: planHash(selections, "Russian"),
    },
    result,
  }) as unknown as ClaimedBackgroundJob;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.cancel.mockResolvedValue(undefined);
  mocks.progress.mockResolvedValue(undefined);
  mocks.find.mockResolvedValue({
    status: "draft",
    input_data: input,
    payload_json: { filename: "test.xlsx" },
  });
  mocks.count.mockResolvedValue(0);
  mocks.lock.mockResolvedValue(1);
});
describe("Excel durable request budget", () => {
  it("reuses a saved v2 Russian-preservation result with its old ID and no new requests", async () => {
    const parts = unzipSync(input);
    const text =
      "Услуга по техническому обслуживанию фотоэлектрических панелей";
    parts["xl/worksheets/sheet1.xml"] = strToU8(
      `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row></sheetData></worksheet>`,
    );
    const inputData = Buffer.from(zipSync(parts));
    const entry = buildPlan(
      inspectWorkbook(inputData),
      selections,
      "Russian",
      false,
      true,
    ).entries[0];
    expect(entry.language).toBe("Unknown");
    const checkpoint = {
      version: 1,
      translations: { [entry.id]: text },
      attempts: { 0: 1 },
      requests: 1,
      inputTokens: 396,
      outputTokens: 70,
      cachedInputTokens: 0,
      completedBatches: 1,
      totalBatches: 1,
      translatedCells: 0,
    };
    const job = makeJob(checkpoint);
    job.inputData = inputData;
    job.payload = { ...job.payload, planVersion: 2 };
    const result = await processExcelTranslation(job);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(result.result).toEqual(checkpoint);
    expect(
      inspectWorkbook(result.outputData).sheets[0].cells.get("A1")?.text,
    ).toBe(text);
  });
  it("rejects already-Russian selections before any request and keeps completed unchanged jobs extendable", async () => {
    const text =
      "Центр подготовки к олимпийским и паралимпийским видам спорта Намангана HV2330700729";
    const parts = unzipSync(input);
    parts["xl/worksheets/sheet1.xml"] = strToU8(
      `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row></sheetData></worksheet>`,
    );
    mocks.find.mockResolvedValue({
      status: "draft",
      input_data: Buffer.from(zipSync(parts)),
      payload_json: { filename: "test.xlsx" },
    });
    await expect(
      startExcelJob(makeJob().id, 7, selections, "Russian"),
    ).rejects.toThrow("target-language text");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    const row = {
      id: makeJob().id,
      payload_json: makeJob().payload,
      result_json: {
        version: 1,
        translations: { acceptedId: text },
        attempts: { 0: 1 },
        requests: 1,
        completedBatches: 1,
        totalBatches: 1,
        translatedCells: 0,
        inputTokens: 396,
        outputTokens: 70,
        cachedInputTokens: 0,
      },
      status: "done",
      last_error: null,
      progress: 100,
      created_at: new Date(),
    };
    expect(excelJobView(row as any)).toMatchObject({
      canExtend: true,
      canDownload: true,
      hasTranslation: true,
      message: expect.stringContaining(
        "Selected text reviewed; no text changes were needed",
      ),
    });
    mocks.find.mockResolvedValue({
      ...row,
      input_data: Buffer.from(zipSync(parts)),
    });
    await expect(reviewExcelAddition(row.id, 7, selections)).rejects.toThrow(
      "target-language text",
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("queues and translates saved formula text with the new plan version", async () => {
    const parts = unzipSync(input);
    parts["xl/worksheets/sheet1.xml"] = strToU8(
      '<worksheet><sheetData><row r="1"><c r="A1" t="str"><f>CONCAT("Quyosh"," panellari")</f><v>Quyosh panellari</v></c></row></sheetData></worksheet>',
    );
    const inputData = Buffer.from(zipSync(parts));
    mocks.find.mockResolvedValue({
      status: "draft",
      input_data: inputData,
      payload_json: { filename: "test.xlsx" },
    });
    await startExcelJob(makeJob().id, 7, selections, "Russian");
    const saved = mocks.update.mock.calls[0][0].data;
    expect(saved.payload_json.planVersion).toBe(3);
    mocks.request.mockImplementation(async (entries) => {
      expect(entries[0].source).toBe("Quyosh panellari");
      expect(JSON.stringify(entries)).not.toContain("CONCAT");
      return {
        value: {
          cells: entries.map((e: any) => ({
            id: e.id,
            text: "Солнечные панели",
            sourceLanguage: "Uzbek",
            action: "translated",
          })),
        },
        usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
      };
    });
    const result = await processExcelTranslation({
      ...makeJob(saved.result_json),
      inputData,
      payload: saved.payload_json,
    });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const cell = inspectWorkbook(result.outputData).sheets[0].cells.get("A1");
    expect(cell).toMatchObject({ text: "Солнечные панели", formula: false });
  });
  it("rejects missing cached formula results before enqueueing or spending requests", async () => {
    const parts = unzipSync(input);
    parts["xl/worksheets/sheet1.xml"] = strToU8(
      '<worksheet><sheetData><row r="1"><c r="A1" t="str"><f>CONCAT("Quyosh"," panellari")</f></c></row></sheetData></worksheet>',
    );
    mocks.find.mockResolvedValue({
      status: "draft",
      input_data: Buffer.from(zipSync(parts)),
      payload_json: { filename: "test.xlsx" },
    });
    await expect(
      startExcelJob(makeJob().id, 7, selections, "Russian"),
    ).rejects.toThrow("recalculate");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  const incrementalRow = () => {
    const input_data = incrementalInput(),
      selections = [{ sheet: "Data", range: "A1:A2" }];
    const payload_json = {
      filename: "test.xlsx",
      targetLang: "Russian",
      selections,
      planHash: planHash(selections, "Russian"),
    };
    const entry = buildPlan(inspectWorkbook(input_data), selections, "Russian")
      .entries[0];
    return {
      id: makeJob().id,
      status: "done",
      input_data,
      payload_json,
      result_json: {
        version: 1 as const,
        translations: { [entry.id]: "Солнечные панели" },
        attempts: { 0: 2 },
        requests: 2,
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 10,
        completedBatches: 1,
        totalBatches: 1,
        translatedCells: 2,
      },
    };
  };
  it.each([
    { sheet: "Other", range: "A1" },
    { sheet: "Data", range: "A1" },
  ])(
    "adds scope %j in the same job without retranslating other cells",
    async (selection) => {
      const row = incrementalRow();
      mocks.find.mockResolvedValue(row);
      const review = await reviewExcelAddition(row.id, 7, [selection]);
      expect(review.maxRequests).toBe(2);
      expect(mocks.request).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
      await addExcelTranslation(row.id, 7, [selection], review.key);
      const written = mocks.update.mock.calls[0][0];
      expect(written.data.payload_json.additions.at(-1).planVersion).toBe(3);
      expect(written.where).toMatchObject({
        id: row.id,
        user_id: 7,
        status: "done",
        result_json: { equals: row.result_json },
      });
      expect(written.data.result_json).toMatchObject({
        requests: 2,
        inputTokens: 100,
        attempts: { 0: 2 },
        translations: row.result_json.translations,
      });
      const j = makeJob(written.data.result_json);
      j.inputData = row.input_data;
      j.payload = written.data.payload_json;
      mocks.request.mockImplementation(async (entries) => {
        expect(entries).toHaveLength(1);
        expect(entries[0].cells).toEqual([
          JSON.stringify([selection.sheet, "A1"]),
        ]);
        return {
          value: {
            cells: entries.map((e: any) => ({
              id: e.id,
              text: "Солнечная энергетика",
              sourceLanguage: "Uzbek",
              action: "translated",
            })),
          },
          usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
        };
      });
      const output = await processExcelTranslation(j);
      expect(mocks.request).toHaveBeenCalledTimes(1);
      expect(output.result.requests).toBe(3);
      expect(output.result.inputTokens).toBe(110);
      expect(output.result.attempts["0"]).toBe(2);
      const book = inspectWorkbook(output.outputData);
      expect(
        book.sheets.find((s) => s.name === selection.sheet)!.cells.get("A1")!
          .text,
      ).toBe("Солнечная энергетика");
      expect(book.sheets[0].cells.get("A2")!.text).toBe("Солнечные панели");
      expect(book.sheets[0].cells.get("B1")!.formula).toBe(false);
      expect(book.sheets[0].cells.get("B1")!.text).toBe("2");
      mocks.request.mockClear();
      await processExcelTranslation({ ...j, result: output.result });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it("rejects changed selections, active jobs, protected cells and double confirmations", async () => {
    const row = incrementalRow();
    mocks.find.mockResolvedValue(row);
    const selected = [{ sheet: "Other", range: "A1" }],
      review = await reviewExcelAddition(row.id, 7, selected);
    await expect(
      addExcelTranslation(
        row.id,
        7,
        [{ sheet: "Data", range: "A1" }],
        review.key,
      ),
    ).rejects.toThrow("changed");
    await expect(
      reviewExcelAddition(row.id, 7, [{ sheet: "Data", range: "B1" }]),
    ).rejects.toThrow("No eligible");
    mocks.count.mockResolvedValueOnce(2);
    await expect(
      addExcelTranslation(row.id, 7, selected, review.key),
    ).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.update.mockResolvedValueOnce({ count: 0 });
    await expect(
      addExcelTranslation(row.id, 7, selected, review.key),
    ).rejects.toThrow("already submitted");
    mocks.find.mockResolvedValue({ ...row, status: "processing" });
    await expect(reviewExcelAddition(row.id, 7, selected)).rejects.toThrow(
      "Wait",
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("requires a fresh addition review after a language-rules upgrade changes the request allowance", async () => {
    const row = incrementalRow();
    const parts = unzipSync(row.input_data);
    parts["xl/worksheets/sheet2.xml"] = strToU8(
      `<worksheet><sheetData>${Array.from(
        { length: 42 },
        (_, i) =>
          `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>${i ? `Станция учун ${i}` : "Quyosh panellari"}</t></is></c></row>`,
      ).join("")}</sheetData></worksheet>`,
    );
    row.input_data = Buffer.from(zipSync(parts));
    const scope = [{ sheet: "Other", range: "A1:A42" }];
    expect(
      buildPlan(inspectWorkbook(row.input_data), scope, "Russian", false, true)
        .batches,
    ).toHaveLength(1);
    const oldReviewKey = createHash("sha256")
      .update(
        JSON.stringify({
          id: row.id,
          status: row.status,
          payload: row.payload_json,
          checkpoint: row.result_json,
          selections: scope,
        }),
      )
      .digest("hex");
    mocks.find.mockResolvedValue(row);
    const fresh = await reviewExcelAddition(row.id, 7, scope);
    expect(fresh.batches).toBe(2);
    expect(fresh.maxRequests).toBe(4);
    expect(fresh.key).not.toBe(oldReviewKey);
    await expect(
      addExcelTranslation(row.id, 7, scope, oldReviewKey),
    ).rejects.toThrow("Review it again");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    await addExcelTranslation(row.id, 7, scope, fresh.key);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const written = mocks.update.mock.calls[0][0].data;
    expect(written.payload_json.additions[0].planVersion).toBe(3);
    expect(written.result_json).toMatchObject({
      requests: 2,
      attempts: { 0: 2 },
      translations: row.result_json.translations,
      totalBatches: 3,
    });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("binds an addition review to derived entry IDs even when its saved selection and allowance are unchanged", async () => {
    const row = incrementalRow();
    const scope = [{ sheet: "Other", range: "A1" }];
    mocks.find.mockResolvedValue(row);
    const original = await reviewExcelAddition(row.id, 7, scope);
    const parts = unzipSync(row.input_data);
    parts["xl/worksheets/sheet2.xml"] = strToU8(
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Quyosh panellari yangilangan</t></is></c></row></sheetData></worksheet>',
    );
    mocks.find.mockResolvedValue({
      ...row,
      input_data: Buffer.from(zipSync(parts)),
    });
    const refreshed = await reviewExcelAddition(row.id, 7, scope);
    expect(refreshed.maxRequests).toBe(original.maxRequests);
    expect(refreshed.key).not.toBe(original.key);
    await expect(
      addExcelTranslation(row.id, 7, scope, original.key),
    ).rejects.toThrow("Review it again");
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("keeps distinct budgets and cumulative results through consecutive additions", async () => {
    let row: any = incrementalRow();
    mocks.request.mockImplementation(async (entries) => ({
      value: {
        cells: entries.map((e: any) => ({
          id: e.id,
          text: "Солнечная станция",
          sourceLanguage: "Uzbek",
          action: "translated",
        })),
      },
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
    }));
    for (const scope of [
      [{ sheet: "Other", range: "A1" }],
      [{ sheet: "Data", range: "A1" }],
    ]) {
      mocks.find.mockResolvedValue(row);
      mocks.update.mockClear();
      const review = await reviewExcelAddition(row.id, 7, scope);
      await addExcelTranslation(row.id, 7, scope, review.key);
      const data = mocks.update.mock.calls[0][0].data,
        j = makeJob(data.result_json);
      j.inputData = row.input_data;
      j.payload = data.payload_json;
      const output = await processExcelTranslation(j);
      row = {
        ...row,
        status: "done",
        payload_json: j.payload,
        result_json: output.result,
        output_data: output.outputData,
      };
    }
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(row.result_json.requests).toBe(4);
    expect(row.result_json.inputTokens).toBe(120);
    expect(Object.values(row.result_json.attempts).sort()).toEqual([1, 1, 2]);
    expect(new Set(row.payload_json.additions.map((a: any) => a.id)).size).toBe(
      2,
    );
    const book = inspectWorkbook(row.output_data);
    expect(book.sheets[0].cells.get("A1")!.text).toBe("Солнечная станция");
    expect(book.sheets[0].cells.get("A2")!.text).toBe("Солнечные панели");
    expect(book.sheets[1].cells.get("A1")!.text).toBe("Солнечная станция");
  });
  it("does not reset an addition's two-request limit across worker restarts", async () => {
    const row = incrementalRow(),
      scope = [{ sheet: "Other", range: "A1" }];
    mocks.find.mockResolvedValue(row);
    const review = await reviewExcelAddition(row.id, 7, scope);
    await addExcelTranslation(row.id, 7, scope, review.key);
    const data = mocks.update.mock.calls[0][0].data,
      j = makeJob(data.result_json);
    j.inputData = row.input_data;
    j.payload = data.payload_json;
    mocks.request.mockRejectedValue(new Error("Request timeout"));
    for (let i = 0; i < 3; i++) {
      await expect(processExcelTranslation(j)).rejects.toThrow();
      j.result = mocks.update.mock.calls.at(-1)![0].data.result_json;
    }
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect((j.result as any).requests).toBe(4);
    expect((j.result as any).attempts["0"]).toBe(2);
  });
  it("does not spend unused budgets on unrelated earlier failures during a cell addition", async () => {
    const row = incrementalRow();
    row.status = "error";
    row.result_json.translations = {};
    row.result_json.attempts = { 0: 0 };
    mocks.find.mockResolvedValue(row);
    const scope = [{ sheet: "Other", range: "A1" }],
      review = await reviewExcelAddition(row.id, 7, scope);
    await addExcelTranslation(row.id, 7, scope, review.key);
    const data = mocks.update.mock.calls[0][0].data;
    const j = makeJob(data.result_json);
    j.payload = data.payload_json;
    j.inputData = row.input_data;
    mocks.request.mockImplementation(async (entries) => ({
      value: {
        cells: entries.map((e: any) => ({
          id: e.id,
          text: "Солнечная станция",
          sourceLanguage: "Uzbek",
          action: "translated",
        })),
      },
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
    }));
    await expect(processExcelTranslation(j)).rejects.toThrow("Earlier batch");
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0][0][0].cells).toEqual(['["Other","A1"]']);
  });
  function stoppedSavedJob() {
    const parts = unzipSync(input);
    parts["xl/worksheets/sheet1.xml"] = strToU8(
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Quyosh panellari</t></is></c><c r="B1" t="inlineStr"><is><t>37-maktabi B2540609608</t></is></c><c r="C1"><v>37</v></c><c r="D1" t="inlineStr"><is><t>English remains</t></is></c></row></sheetData></worksheet>',
    );
    const inputData = Buffer.from(zipSync(parts)),
      selections = [{ sheet: "Data", range: "A1:D1", columns: [2] }];
    const p = {
      filename: "test.xlsx",
      targetLang: "Russian",
      selections,
      planHash: planHash(selections, "Russian"),
    };
    const entry = buildPlan(inspectWorkbook(inputData), selections, "Russian")
      .entries[0];
    const c: any = {
      ...checkpoint(),
      rejectedCells: {
        [entry.id]: {
          text: "школа №37 B2540609608",
          sourceLanguage: "Uzbek",
          action: "translated",
        },
      },
    };
    return {
      id: makeJob().id,
      status: "error",
      input_data: inputData,
      payload_json: p,
      result_json: c,
      entry,
    };
  }
  it("rechecks cached responses without requests or checkpoint mutation and writes column B only", () => {
    const row = stoppedSavedJob(),
      original = structuredClone(row.result_json);
    const result = recheckExcelSavedResults(
      row.input_data,
      row.payload_json,
      row.result_json,
    );
    expect(result).toMatchObject({
      recoveredEntries: 1,
      remainingEntries: 0,
      checkpoint: {
        requests: 2,
        inputTokens: 100,
        outputTokens: 20,
        attempts: { 0: 2 },
        translatedCells: 1,
        completedBatches: 1,
      },
    });
    expect(row.result_json).toEqual(original);
    const before = inspectWorkbook(row.input_data),
      after = inspectWorkbook(result.outputData!);
    for (const address of ["A1", "C1", "D1"])
      expect(after.sheets[0].cells.get(address)).toEqual(
        before.sheets[0].cells.get(address),
      );
    expect(after.sheets[0].cells.get("B1")!.text).toBe("школа №37 B2540609608");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("atomically finalizes a stopped job without queuing or resetting any usage", async () => {
    const row = stoppedSavedJob();
    mocks.find.mockResolvedValue(row);
    await finalizeExcelSavedResults(row.id, 7);
    const write = mocks.update.mock.calls[0][0];
    expect(write.where).toMatchObject({
      user_id: 7,
      status: "error",
      result_json: { equals: row.result_json },
      payload_json: { equals: row.payload_json },
    });
    expect(write.data).toMatchObject({
      status: "done",
      progress: 100,
      result_json: {
        requests: 2,
        attempts: { 0: 2 },
        inputTokens: 100,
        outputTokens: 20,
      },
    });
    expect(write.data.output_data.length).toBeGreaterThan(0);
    expect(write.data).not.toHaveProperty("attempts");
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.update.mockResolvedValueOnce({ count: 0 });
    await expect(finalizeExcelSavedResults(row.id, 7)).rejects.toThrow(
      "job changed",
    );
  });
  function savedPlaceNameAddition() {
    const places = [
      [
        "Chiroqchi tumani 8-DMTT B2551945085",
        "Чироқчинский район 8-DMTT B2551945085",
        "Чиракчинский район 8-DMTT B2551945085",
      ],
      [
        "Marg'ilon shahri 26-DMTT NS2481025360",
        "город Марғилон 26-DMTT NS2481025360",
        "город Маргилан 26-DMTT NS2481025360",
      ],
      [
        "Bo'stonliq tumani 18-DMTT TA22B0311613",
        "Бўстонлиқский район 18-DMTT TA22B0311613",
        "Бостанлыкский район 18-DMTT TA22B0311613",
      ],
    ];
    const parts = unzipSync(input);
    parts["xl/worksheets/sheet1.xml"] = strToU8(
      '<worksheet><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>Quyosh panellari</t></is></c></row>' +
        places
          .map(
            ([source], i) =>
              `<row r="${i + 2}"><c r="A${i + 2}" t="inlineStr"><is><t>${source}</t></is></c><c r="B${i + 2}" t="inlineStr"><is><t>${source}</t></is></c><c r="C${i + 2}"><v>${i + 100}</v></c></row>`,
          )
          .join("") +
        "</sheetData></worksheet>",
    );
    const inputData = Buffer.from(zipSync(parts));
    const namespace = "5bb8c238-2eeb-4f62-a465-058bade1ba45";
    const originalScope = [{ sheet: "Data", range: "B1" }];
    const addedScope = [{ sheet: "Data", range: "A2:C4", columns: [2] }];
    const payload: ExcelPayload = {
      filename: "places.xlsx",
      targetLang: "Russian",
      planVersion: 3,
      selections: originalScope,
      planHash: planHash(originalScope, "Russian"),
      additions: [
        {
          id: namespace,
          planVersion: 3,
          selections: addedScope,
          planHash: planHash(addedScope, "Russian"),
        },
      ],
    };
    const plan = buildJobPlan(inspectWorkbook(inputData), payload);
    const acceptedId = plan.batches[0][0].id;
    const saved: ExcelCheckpoint = {
      ...checkpoint(),
      version: 1,
      translations: { [acceptedId]: "Солнечные панели" },
      attempts: { 0: 1, [`${namespace}:0`]: 2 },
      requests: 3,
      completedBatches: 1,
      totalBatches: 2,
      translatedCells: 1,
      rejectedCells: Object.fromEntries(
        plan.batches[1].map((entry) => [
          entry.id,
          {
            text: places.find(([source]) => source === entry.source)![1],
            action: "translated",
            sourceLanguage: "Uzbek",
          },
        ]),
      ),
      batchIssues: {
        [`${namespace}:0`]: plan.batches[1].map((entry) => ({
          id: entry.id,
          reason: "Uzbek prose remains in the Russian translation.",
        })),
      },
    };
    return { inputData, payload, saved, places, plan, acceptedId, namespace };
  }
  it("recovers all three namespaced place-name candidates offline without altering accepted or unselected cells", () => {
    const row = savedPlaceNameAddition();
    const original = structuredClone(row.saved);
    const originalBytes = Buffer.from(row.inputData);
    const result = recheckExcelSavedResults(
      row.inputData,
      row.payload,
      row.saved,
    );
    expect(result).toMatchObject({
      recoveredEntries: 3,
      remainingEntries: 0,
      checkpoint: {
        requests: 3,
        inputTokens: 100,
        outputTokens: 20,
        attempts: original.attempts,
        translatedCells: 4,
        completedBatches: 2,
        batchIssues: {},
        rejectedCells: {},
      },
    });
    expect(
      row.plan.batches[1].every((entry) =>
        entry.id.startsWith(row.namespace + ":"),
      ),
    ).toBe(true);
    expect(row.saved).toEqual(original);
    expect(row.inputData).toEqual(originalBytes);
    expect(result.checkpoint.translations[row.acceptedId]).toBe(
      original.translations[row.acceptedId],
    );
    const before = inspectWorkbook(row.inputData).sheets[0];
    const after = inspectWorkbook(result.outputData!).sheets[0];
    expect(after.cells.size).toBe(before.cells.size);
    expect(after.cells.get("B1")!.text).toBe("Солнечные панели");
    row.places.forEach(([, , expected], index) => {
      const r = index + 2;
      expect(after.cells.get(`B${r}`)!.text).toBe(expected);
      for (const col of ["A", "C"])
        expect(after.cells.get(`${col}${r}`)).toEqual(
          before.cells.get(`${col}${r}`),
        );
    });
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not produce a completed workbook when a corrected place name still contains Uzbek prose", () => {
    const row = savedPlaceNameAddition();
    row.saved.rejectedCells![row.plan.batches[1][2].id].text += " учун";
    const original = structuredClone(row.saved);
    const result = recheckExcelSavedResults(
      row.inputData,
      row.payload,
      row.saved,
    );
    expect(result).toMatchObject({
      recoveredEntries: 2,
      remainingEntries: 1,
      outputData: null,
    });
    expect(result.checkpoint.requests).toBe(original.requests);
    expect(result.checkpoint.attempts).toEqual(original.attempts);
    expect(row.saved).toEqual(original);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("does not finalize active, missing, malformed or still-invalid saved translations", async () => {
    const row = stoppedSavedJob();
    for (const status of ["processing", "queued", "cancelled", "done"]) {
      mocks.find.mockResolvedValue({ ...row, status });
      await expect(finalizeExcelSavedResults(row.id, 7)).rejects.toThrow(
        "Only a stopped",
      );
    }
    for (const candidate of [
      undefined,
      { text: "wrong" },
      {
        text: "школа №38 B2540609608",
        sourceLanguage: "Uzbek",
        action: "translated",
      },
    ]) {
      mocks.find.mockResolvedValue({
        ...row,
        result_json: {
          ...row.result_json,
          rejectedCells: { [row.entry.id]: candidate },
        },
      });
      await expect(finalizeExcelSavedResults(row.id, 7)).rejects.toThrow(
        "1 text entries",
      );
    }
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("retains already-accepted cell text instead of overwriting it with a saved rejection", () => {
    const row = stoppedSavedJob();
    row.result_json.translations[row.entry.id] =
      "Сохранённая школа №37 B2540609608";
    const result = recheckExcelSavedResults(
      row.input_data,
      row.payload_json,
      row.result_json,
    );
    expect(result.recoveredEntries).toBe(0);
    expect(result.checkpoint.translations[row.entry.id]).toBe(
      row.result_json.translations[row.entry.id],
    );
  });
  const checkpoint = () => ({
    version: 1,
    translations: {},
    attempts: { 0: 2 },
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: 0,
    requests: 2,
    completedBatches: 0,
    totalBatches: 1,
    translatedCells: 0,
  });
  const recoverable = () => ({
    id: makeJob().id,
    status: "error",
    input_data: input,
    payload_json: makeJob().payload,
    result_json: checkpoint(),
  });
  it("reviews without charging and queues only an explicitly confirmed one-time recovery", async () => {
    const row = recoverable();
    mocks.find.mockResolvedValue(row);
    const review = await reviewExcelRecovery(row.id, 7);
    expect(review).toMatchObject({
      maxRequests: 1,
      pendingEntries: 1,
      exhaustedBatches: 1,
    });
    expect(mocks.update).not.toHaveBeenCalled();
    await expect(resumeExcelJob(row.id, 7, "stale")).rejects.toThrow("changed");
    expect(mocks.update).not.toHaveBeenCalled();
    await resumeExcelJob(row.id, 7, review.key);
    const write = mocks.update.mock.calls[0][0];
    expect(write.where).toMatchObject({
      user_id: 7,
      status: "error",
      result_json: { equals: row.result_json },
    });
    expect(write.data.result_json).toMatchObject({
      ...row.result_json,
      recoveryApproved: true,
      recoveryGranted: ["0"],
    });
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.find.mockResolvedValue({
      ...row,
      result_json: write.data.result_json,
    });
    await expect(reviewExcelRecovery(row.id, 7)).rejects.toThrow(
      "not eligible",
    );
  });
  it("enforces concurrency and atomic double-submit protection during recovery", async () => {
    mocks.find.mockResolvedValue(recoverable());
    const review = await reviewExcelRecovery(makeJob().id, 7);
    mocks.count.mockResolvedValueOnce(2);
    await expect(resumeExcelJob(makeJob().id, 7, review.key)).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
    mocks.update.mockResolvedValueOnce({ count: 0 });
    await expect(resumeExcelJob(makeJob().id, 7, review.key)).rejects.toThrow(
      "already submitted",
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("allows only the one confirmed extra request, with original usage retained", async () => {
    let saved: any = {
      ...checkpoint(),
      recoveryApproved: true,
      recoveryGranted: ["0"],
    };
    mocks.update.mockImplementation(async (args) => {
      saved = structuredClone(args.data.result_json);
      return { count: 1 };
    });
    mocks.request.mockImplementation(async (entries) => ({
      value: {
        cells: entries.map((e: any) => ({
          id: e.id,
          text: e.source,
          sourceLanguage: "Uzbek",
          action: "translated",
        })),
      },
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
    }));
    await expect(processExcelTranslation(makeJob(saved))).rejects.toThrow(
      "three approved",
    );
    expect(saved).toMatchObject({
      requests: 3,
      attempts: { 0: 3 },
      inputTokens: 110,
      outputTokens: 25,
    });
    await expect(processExcelTranslation(makeJob(saved))).rejects.toThrow(
      "three approved",
    );
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(saved.rejectedCells).toBeDefined();
  });
  it("processes later batches despite one exhausted cell, without declaring an incomplete workbook complete", async () => {
    const parts = unzipSync(input);
    parts["xl/worksheets/sheet1.xml"] = strToU8(
      `<worksheet><sheetData>${Array.from({ length: 41 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>Quyosh panellari ${i + 1}</t></is></c></row>`).join("")}</sheetData></worksheet>`,
    );
    const j = makeJob();
    j.inputData = Buffer.from(zipSync(parts));
    const selected = [{ sheet: "Data", range: "A1:A41" }];
    j.payload = {
      ...j.payload,
      selections: selected,
      planHash: planHash(selected, "Russian"),
    };
    let saved: any;
    mocks.update.mockImplementation(async (args) => {
      saved = structuredClone(args.data.result_json);
      return { count: 1 };
    });
    mocks.request.mockImplementation(async (entries) => ({
      value: {
        cells: entries.map((e: any) => ({
          id: e.id,
          text: e.source.endsWith(" 1")
            ? "Солнечные панели 999"
            : e.source.replace("Quyosh panellari", "Солнечные панели"),
          sourceLanguage: "Uzbek",
          action: "translated",
        })),
      },
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
    }));
    await expect(processExcelTranslation(j)).rejects.toThrow(
      "batch 1 exhausted",
    );
    expect(saved).toMatchObject({
      translatedCells: 40,
      completedBatches: 1,
      totalBatches: 2,
      requests: 3,
      attempts: { 0: 2, 1: 1 },
    });
    expect(mocks.request.mock.calls[2][0][0].source).toBe(
      "Quyosh panellari 41",
    );
    const rejected = Object.values(saved.rejectedCells) as any[];
    expect(rejected).toHaveLength(1);
    expect(rejected[0].text).toBe("Солнечные панели 999");
  });
  const twoCellJob = (result: unknown = null) => {
    const parts = unzipSync(input);
    parts["xl/worksheets/sheet1.xml"] = strToU8(
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Quyosh panellari 25</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Quyosh panellari 26</t></is></c></row></sheetData></worksheet>',
    );
    const j = makeJob(result);
    j.inputData = Buffer.from(zipSync(parts));
    const selected = [{ sheet: "Data", range: "A1:A2" }];
    j.payload = {
      ...j.payload,
      selections: selected,
      planHash: planHash(selected, "Russian"),
    };
    return j;
  };
  it("saves valid cells before retrying only the rejected cell with specific feedback", async () => {
    let saved: any;
    mocks.update.mockImplementation(async (args) => {
      saved = structuredClone(args.data.result_json);
      return { count: 1 };
    });
    mocks.request.mockImplementation(async (entries, _target, feedback) => {
      if (mocks.request.mock.calls.length === 2) {
        expect(entries).toHaveLength(1);
        expect(entries[0].source).toBe("Quyosh panellari 26");
        expect(Object.keys(saved.translations)).toHaveLength(1);
        expect(saved.translatedCells).toBe(1);
        expect(feedback).toContain(entries[0].id);
        expect(feedback).toContain("numeric");
        expect(feedback).toContain("26");
      }
      return {
        value: {
          cells: entries.map((e: any, i: number) => ({
            id: e.id,
            text:
              mocks.request.mock.calls.length === 1 && i === 1
                ? "Солнечные панели 99"
                : e.source.replace("Quyosh panellari", "Солнечные панели"),
            sourceLanguage: "Uzbek",
            action: "translated",
          })),
        },
        usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
      };
    });
    const result = await processExcelTranslation(twoCellJob());
    expect(result.result).toMatchObject({
      translatedCells: 2,
      completedBatches: 1,
      requests: 2,
      inputTokens: 200,
      outputTokens: 40,
      batchIssues: {},
    });
    expect(inspectWorkbook(result.outputData).inspection.sheetCount).toBe(1);
  });
  it("retains partial results and exact rejection reasons at the cap, including after restart", async () => {
    let saved: any;
    mocks.update.mockImplementation(async (args) => {
      saved = structuredClone(args.data.result_json);
      return { count: 1 };
    });
    mocks.request.mockImplementation(async (entries) => ({
      value: {
        cells: entries.map((e: any) => ({
          id: e.id,
          text: e.source.endsWith("25")
            ? "Солнечные панели 25"
            : "Солнечные панели 99",
          sourceLanguage: "Uzbek",
          action: "translated",
        })),
      },
      usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
    }));
    await expect(processExcelTranslation(twoCellJob())).rejects.toThrow(
      "numeric",
    );
    expect(saved).toMatchObject({
      translatedCells: 1,
      completedBatches: 0,
      requests: 2,
      attempts: { 0: 2 },
      inputTokens: 200,
    });
    expect(Object.keys(saved.translations)).toHaveLength(1);
    expect(saved.batchIssues[0]).toHaveLength(1);
    await expect(processExcelTranslation(twoCellJob(saved))).rejects.toThrow(
      saved.batchIssues[0][0].id,
    );
    expect(mocks.request).toHaveBeenCalledTimes(2);
    const view = excelJobView({
      status: "error",
      payload_json: twoCellJob().payload,
      result_json: saved,
      created_at: new Date(),
      progress: 0,
    } as any);
    expect(view).toMatchObject({
      hasTranslation: true,
      canDownload: false,
      usage: { translatedCells: 1 },
    });
    expect(view.usage).not.toHaveProperty("batchIssues");
  });
  const oldHash = (s: unknown) =>
    createHash("sha256")
      .update(JSON.stringify({ selections: s, target: "Russian" }))
      .digest("hex");
  const ordered = [
    {
      sheet: "Data",
      range: "A1:A1",
      columns: [1],
      sourceLanguage: "Auto" as const,
    },
  ];
  const persisted = [
    {
      range: "A1:A1",
      sheet: "Data",
      columns: [1],
      sourceLanguage: "Auto" as const,
    },
  ];
  it("preserves the original v1 checksum after JSONB reorders object keys", () => {
    expect(oldHash(ordered)).not.toBe(oldHash(persisted));
    expect(planHash(persisted, "Russian")).toBe(oldHash(ordered));
    expect(planHash([{ ...persisted[0], range: "A2:A2" }], "Russian")).not.toBe(
      oldHash(ordered),
    );
    expect(planHash(persisted, "Arabic")).not.toBe(oldHash(ordered));
  });
  it("processes an enqueued payload after a database-order round trip", async () => {
    await startExcelJob(makeJob().id, 7, ordered, "Russian");
    const saved = mocks.update.mock.calls[0][0].data;
    const id = buildPlan(inspectWorkbook(input), ordered, "Russian").entries[0]
      .id;
    mocks.request.mockResolvedValue({
      value: {
        cells: [
          {
            id,
            text: "Солнечные панели",
            sourceLanguage: "Uzbek",
            action: "translated",
          },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 0 },
    });
    const j = makeJob(saved.result_json);
    j.payload = { ...saved.payload_json, selections: persisted };
    expect((await processExcelTranslation(j)).result.completedBatches).toBe(1);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("rejects changed or invalid selections before any provider requests", async () => {
    const j = makeJob();
    j.payload.planHash = "invalid";
    await expect(processExcelTranslation(j)).rejects.toBeInstanceOf(
      ExcelSelectionError,
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });
  const unstarted = () => ({
    status: "error",
    last_error: "Invalid spreadsheet job selection.",
    input_data: input,
    payload_json: {
      targetLang: "Russian",
      selections: persisted,
      planHash: oldHash(ordered),
    },
    result_json: {
      version: 1,
      requests: 0,
      completedBatches: 0,
      attempts: {},
      translations: {},
    },
    created_at: new Date(),
    id: makeJob().id,
    progress: 0,
  });
  it("returns only the unstarted compatibility failure to draft without queuing or billing", async () => {
    mocks.find.mockResolvedValue(unstarted());
    await restoreExcelDraft(makeJob().id, 7);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "error",
          user_id: 7,
          result_json: { equals: unstarted().result_json },
        }),
        data: expect.objectContaining({ status: "draft" }),
      }),
    );
    expect(mocks.request).not.toHaveBeenCalled();
    expect(excelJobView(unstarted() as any)).toMatchObject({
      hasTranslation: false,
      canRestoreDraft: true,
      canDownload: false,
    });
  });
  it("never resets a job with a reserved request, saved work, or a different failure", async () => {
    for (const override of [
      { result_json: { ...unstarted().result_json, requests: 1 } },
      { result_json: { ...unstarted().result_json, attempts: { 0: 1 } } },
      {
        result_json: {
          ...unstarted().result_json,
          translations: { cell: "result" },
        },
      },
      { last_error: "Translation request failed" },
    ]) {
      mocks.find.mockResolvedValue({ ...unstarted(), ...override });
      await expect(restoreExcelDraft(makeJob().id, 7)).rejects.toThrow(
        "cannot be returned",
      );
    }
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("locks draft submission and enforces concurrent-job protection", async () => {
    mocks.count.mockImplementation(async () => {
      expect(mocks.lock).toHaveBeenCalled();
      return 2;
    });
    await expect(
      startExcelJob(makeJob().id, 7, selections, "Russian"),
    ).rejects.toThrow();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("queues a draft exactly once without calling the provider from the web request", async () => {
    await startExcelJob(makeJob().id, 7, selections, "Russian");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "draft",
          user_id: 7,
          job_type: "xlsx_translation_v1",
        }),
        data: expect.objectContaining({ status: "queued" }),
      }),
    );
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.update.mockResolvedValue({ count: 0 });
    await expect(
      startExcelJob(makeJob().id, 7, selections, "Russian"),
    ).rejects.toThrow("already submitted");
  });
  it("saves a reservation before the model call and records usage", async () => {
    const id = buildPlan(inspectWorkbook(input), selections, "Russian")
      .entries[0].id;
    mocks.request.mockImplementation(async () => {
      expect(mocks.update).toHaveBeenCalled();
      return {
        value: {
          cells: [
            {
              id,
              text: "Солнечные панели",
              sourceLanguage: "Uzbek",
              action: "translated",
            },
          ],
        },
        usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 5 },
      };
    });
    const result = await processExcelTranslation(makeJob());
    expect(result.result.requests).toBe(1);
    expect(result.result.inputTokens).toBe(100);
    expect(result.result.translatedCells).toBe(1);
    expect(result.outputData.length).toBeGreaterThan(0);
    mocks.request.mockClear();
    await processExcelTranslation(makeJob(result.result));
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("counts timeout attempts across restarts and never exceeds two calls per batch", async () => {
    let checkpoint: unknown = null;
    mocks.update.mockImplementation(async (args) => {
      checkpoint = JSON.parse(JSON.stringify(args.data.result_json));
      return { count: 1 };
    });
    mocks.request.mockRejectedValue(new Error("timeout"));
    await expect(processExcelTranslation(makeJob(checkpoint))).rejects.toThrow(
      "bounded retry",
    );
    await expect(processExcelTranslation(makeJob(checkpoint))).rejects.toThrow(
      "bounded retry",
    );
    await expect(processExcelTranslation(makeJob(checkpoint))).rejects.toThrow(
      "exhausted",
    );
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
  it("does not call the provider after cancellation or a lost reservation lease", async () => {
    mocks.cancel.mockRejectedValueOnce(new Error("cancelled"));
    await expect(processExcelTranslation(makeJob())).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.update.mockResolvedValue({ count: 0 });
    await expect(processExcelTranslation(makeJob())).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
