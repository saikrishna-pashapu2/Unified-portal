import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  owned: vi.fn(),
  auth: vi.fn(),
  remove: vi.fn(),
  cancel: vi.fn(),
  start: vi.fn(),
  restore: vi.fn(),
  review: vi.fn(),
  resume: vi.fn(),
  recheck: vi.fn(),
  additionReview: vi.fn(),
  add: vi.fn(),
}));
vi.mock("@/lib/pdfx-v2/auth", () => ({ requirePdfxUser: mocks.auth }));
vi.mock("@esgcredit/db-esg", () => ({
  esgPrisma: { background_jobs: { deleteMany: mocks.remove } },
}));
vi.mock("@/lib/xlsx-translator/jobs", () => ({
  ownedExcelJob: mocks.owned,
  excelJobView: vi.fn(),
  SelectionSchema: { parse: vi.fn() },
  startExcelJob: mocks.start,
  restoreExcelDraft: mocks.restore,
  reviewExcelRecovery: mocks.review,
  resumeExcelJob: mocks.resume,
  finalizeExcelSavedResults: mocks.recheck,
  reviewExcelAddition: mocks.additionReview,
  addExcelTranslation: mocks.add,
}));
vi.mock("@/lib/jobs/queue", () => ({
  requestBackgroundJobCancellation: mocks.cancel,
  JobConcurrencyLimitError: class extends Error {},
  rethrowBackgroundJobEnqueueError: (e: unknown) => {
    throw e;
  },
}));
import { GET, POST, DELETE } from "./[jobId]/route";
import { incrementalInput } from "@/lib/xlsx-translator/test-fixtures";
import { inspectWorkbook } from "@/lib/xlsx-translator/workbook";
import { buildJobPlan } from "@/lib/xlsx-translator/job-plan";
import { strToU8, unzipSync, zipSync } from "fflate";
const id = "11111111-1111-4111-8111-111111111111",
  context = { params: Promise.resolve({ jobId: id }) };
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 7 });
  mocks.owned.mockResolvedValue(null);
});
describe("Excel API access controls", () => {
  it("accepts a same-portal mutation through Next's private production URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://unifiedportal.duckdns.org");
    mocks.owned.mockResolvedValue({ status: "processing" });
    mocks.cancel.mockResolvedValue("cancelling");
    const response = await POST(new Request(`https://localhost:3000/api/xlsx-translator/${id}`, {
      method: "POST",
      headers: { origin: "https://unifiedportal.duckdns.org" },
      body: JSON.stringify({ action: "cancel" }),
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.cancel).toHaveBeenCalledWith(id, 7);
  });
  it("accepts a same-portal terminal deletion through the production proxy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://unifiedportal.duckdns.org");
    mocks.remove.mockResolvedValue({ count: 1 });
    const response = await DELETE(new Request(`https://localhost:3000/api/xlsx-translator/${id}`, {
      method: "DELETE",
      headers: { origin: "https://unifiedportal.duckdns.org" },
    }), context);
    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it("explains support review for missing legacy results now identified as already in the target language", async () => {
    const parts = unzipSync(incrementalInput());
    const text =
      "Услуга по техническому обслуживанию фотоэлектрических панелей";
    parts["xl/worksheets/sheet1.xml"] = strToU8(
      `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row></sheetData></worksheet>`,
    );
    const input_data = Buffer.from(zipSync(parts));
    const result_json = { translations: {}, attempts: {}, requests: 0 };
    mocks.owned.mockResolvedValue({
      status: "done",
      input_data,
      output_data: input_data,
      payload_json: {
        filename: "test.xlsx",
        targetLang: "Russian",
        planVersion: 2,
        selections: [{ sheet: "Data", range: "A1" }],
      },
      result_json,
    });
    const preview = await GET(
      new Request(
        `http://localhost/api/xlsx-translator/${id}?view=preview&sheet=Data&range=A1`,
      ),
      context,
    );
    const data = await preview.json();
    expect(preview.status).toBe(200);
    expect(data.unavailableCells).toBe(1);
    expect(data.cells[0]).toMatchObject({
      language: "Russian",
      text,
      translated: text,
      translationPending: false,
      translationUnavailable: true,
    });
    expect(data.translationWarning).toContain(
      "Only eligible cells can be selected again",
    );
    expect(data.translationWarning).toContain("already in the target language");
    expect(data.translationWarning).toContain(
      "support review of this saved job",
    );
    expect(data.translationWarning).not.toContain(
      "review those cells to translate them",
    );
    const download = await GET(
      new Request(`http://localhost/api/xlsx-translator/${id}?view=download`),
      context,
    );
    expect(download.status).toBe(409);
    expect((await download.json()).error).toContain("support review");
    expect(result_json).toEqual({
      translations: {},
      attempts: {},
      requests: 0,
    });
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.recheck).not.toHaveBeenCalled();
  });
  it("serves legacy completed downloads as values-only without rewriting the saved job", async () => {
    const input_data = incrementalInput();
    const payload_json = {
      filename: "old.xlsx",
      targetLang: "Russian",
      selections: [{ sheet: "Data", range: "A1:A2" }],
    };
    const plan = buildJobPlan(inspectWorkbook(input_data), payload_json);
    mocks.owned.mockResolvedValue({
      status: "done",
      input_data,
      output_data: input_data,
      payload_json,
      result_json: {
        translations: { [plan.entries[0].id]: "Quyosh panellari" },
      },
    });
    const response = await GET(
      new Request(
        "http://localhost/api/xlsx-translator/" + id + "?view=download",
      ),
      context,
    );
    expect(response.status).toBe(200);
    const downloaded = inspectWorkbook(
      Buffer.from(await response.arrayBuffer()),
    );
    expect(downloaded.inspection.formulaCount).toBe(0);
    expect(downloaded.sheets[0].cells.get("B1")?.text).toBe("2");
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it("previews only the latest exact cell replacement and keeps original text intact", async () => {
    const input_data = incrementalInput();
    const payload_json = {
      filename: "test.xlsx",
      targetLang: "Russian",
      selections: [{ sheet: "Data", range: "A1:A2" }],
      additions: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          selections: [{ sheet: "Data", range: "A1" }],
          planHash: "unused",
        },
      ],
    };
    const plan = buildJobPlan(inspectWorkbook(input_data), payload_json);
    mocks.owned.mockResolvedValue({
      status: "done",
      input_data,
      payload_json,
      result_json: {
        translations: {
          [plan.entries[0].id]: "Earlier translation",
          [plan.entries[1].id]: "Selected cell translation",
        },
      },
    });
    const response = await GET(
      new Request(
        "http://localhost/api/xlsx-translator/" +
          id +
          "?view=preview&sheet=Data&range=A1:B2",
      ),
      context,
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.cells.find((c: any) => c.address === "A1")).toMatchObject({
      text: "Quyosh panellari",
      translated: "Selected cell translation",
    });
    expect(result.cells.find((c: any) => c.address === "A2")).toMatchObject({
      text: "Quyosh panellari",
      translated: "Earlier translation",
    });
    expect(result.cells.find((c: any) => c.address === "B1").formula).toBe(
      true,
    );
    expect(result.unavailableCells).toBe(0);
    expect(result.translationWarning).toBeUndefined();
    expect(
      result.cells.every(
        (c: any) => !c.translationPending && !c.translationUnavailable,
      ),
    ).toBe(true);
  });
  it.each([
    ["done", null],
    ["done", {}],
    ["done", { translations: {} }],
    ["error", { translations: {} }],
    ["cancelled", { translations: {} }],
  ])(
    "marks missing results as unavailable, not perpetually pending for %s",
    async (status, result_json) => {
      const input_data = incrementalInput();
      mocks.owned.mockResolvedValue({
        status,
        input_data,
        payload_json: {
          filename: "test.xlsx",
          targetLang: "Russian",
          selections: [{ sheet: "Data", range: "A1:A2" }],
        },
        result_json,
      });
      const response = await GET(
        new Request(
          `http://localhost/api/xlsx-translator/${id}?view=preview&sheet=Data&range=A1:B2`,
        ),
        context,
      );
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.unavailableCells).toBe(2);
      expect(result.translationWarning).toContain("no saved translation");
      for (const address of ["A1", "A2"]) {
        expect(
          result.cells.find((cell: any) => cell.address === address),
        ).toMatchObject({
          text: "Quyosh panellari",
          translated: "Quyosh panellari",
          translationPending: false,
          translationUnavailable: true,
        });
      }
      expect(
        result.cells.find((cell: any) => cell.address === "B1")
          .translationUnavailable,
      ).toBe(false);
      expect(mocks.start).not.toHaveBeenCalled();
      expect(mocks.add).not.toHaveBeenCalled();
      expect(mocks.resume).not.toHaveBeenCalled();
      expect(mocks.recheck).not.toHaveBeenCalled();
    },
  );
  it.each(["queued", "processing"])(
    "keeps unresolved %s cells pending even before the first checkpoint",
    async (status) => {
      mocks.owned.mockResolvedValue({
        status,
        input_data: incrementalInput(),
        payload_json: {
          filename: "test.xlsx",
          targetLang: "Russian",
          selections: [{ sheet: "Data", range: "A1" }],
        },
        result_json: null,
      });
      const response = await GET(
        new Request(
          `http://localhost/api/xlsx-translator/${id}?view=preview&sheet=Data&range=A1:B2`,
        ),
        context,
      );
      const result = await response.json();
      expect(
        result.cells.find((cell: any) => cell.address === "A1"),
      ).toMatchObject({
        text: "Quyosh panellari",
        translationPending: true,
        translationUnavailable: false,
      });
      expect(result.unavailableCells).toBe(0);
      expect(result.translationWarning).toBeUndefined();
    },
  );
  it("retains accepted neighbouring cells when only an added cell has no saved result", async () => {
    const input_data = incrementalInput();
    const payload_json = {
      filename: "test.xlsx",
      targetLang: "Russian",
      selections: [{ sheet: "Data", range: "A1:A2" }],
      additions: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          selections: [{ sheet: "Data", range: "A1" }],
          planHash: "unused",
        },
      ],
    };
    const plan = buildJobPlan(inspectWorkbook(input_data), payload_json);
    mocks.owned.mockResolvedValue({
      status: "done",
      input_data,
      payload_json,
      result_json: {
        translations: { [plan.entries[0].id]: "Accepted earlier translation" },
      },
    });
    const response = await GET(
      new Request(
        `http://localhost/api/xlsx-translator/${id}?view=preview&sheet=Data&range=A1:B2`,
      ),
      context,
    );
    const result = await response.json();
    expect(result.unavailableCells).toBe(1);
    expect(
      result.cells.find((cell: any) => cell.address === "A1"),
    ).toMatchObject({
      text: "Quyosh panellari",
      translated: "Quyosh panellari",
      translationUnavailable: true,
      translationPending: false,
    });
    expect(
      result.cells.find((cell: any) => cell.address === "A2"),
    ).toMatchObject({
      text: "Quyosh panellari",
      translated: "Accepted earlier translation",
      translationUnavailable: false,
      translationPending: false,
    });
  });
  it("does not mark draft selections as already requested translations", async () => {
    mocks.owned.mockResolvedValue({
      status: "draft",
      input_data: incrementalInput(),
      payload_json: {
        filename: "draft.xlsx",
        targetLang: "Russian",
        selections: [{ sheet: "Data", range: "A1" }],
      },
      result_json: null,
    });
    const response = await GET(
      new Request(
        `http://localhost/api/xlsx-translator/${id}?view=preview&sheet=Data&range=A1:B2`,
      ),
      context,
    );
    const result = await response.json();
    expect(result.unavailableCells).toBe(0);
    expect(result.translationWarning).toBeUndefined();
    expect(
      result.cells.every(
        (cell: any) => !cell.translationPending && !cell.translationUnavailable,
      ),
    ).toBe(true);
  });
  it("does not claim a selected workbook is verified if its original source has expired", async () => {
    mocks.owned.mockResolvedValue({
      status: "done",
      input_data: null,
      output_data: incrementalInput(),
      payload_json: {
        filename: "expired.xlsx",
        targetLang: "Russian",
        selections: [{ sheet: "Data", range: "A1" }],
      },
      result_json: { translations: {} },
    });
    const response = await GET(
      new Request(`http://localhost/api/xlsx-translator/${id}?view=download`),
      context,
    );
    expect(response.status).toBe(410);
    expect((await response.json()).error).toContain("cannot be verified");
  });
  it.each([null, { translations: {} }])(
    "blocks a falsely completed download when its accepted checkpoint is missing",
    async (result_json) => {
      const input_data = incrementalInput();
      mocks.owned.mockResolvedValue({
        status: "done",
        input_data,
        output_data: input_data,
        payload_json: {
          filename: "test.xlsx",
          targetLang: "Russian",
          selections: [{ sheet: "Data", range: "A1:A2" }],
        },
        result_json,
      });
      const response = await GET(
        new Request(`http://localhost/api/xlsx-translator/${id}?view=download`),
        context,
      );
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain("no saved translation");
      expect(mocks.start).not.toHaveBeenCalled();
      expect(mocks.add).not.toHaveBeenCalled();
    },
  );
  it("does not offer the previous output as a completed download while an addition is queued", async () => {
    mocks.owned.mockResolvedValue({
      status: "queued",
      output_data: Buffer.from("previous output"),
    });
    const response = await GET(
      new Request(
        "http://localhost/api/xlsx-translator/" + id + "?view=download",
      ),
      context,
    );
    expect(response.status).toBe(409);
  });
  it("separates addition review from confirmation and never accepts a target override", async () => {
    mocks.owned.mockResolvedValue({ status: "done" });
    mocks.additionReview.mockResolvedValue({ key: "snapshot", maxRequests: 2 });
    mocks.add.mockResolvedValue({ jobId: id });
    const selections = [{ sheet: "Other", range: "B2" }];
    const post = (action: string) =>
      POST(
        new Request("http://localhost/api/xlsx-translator/" + id, {
          method: "POST",
          body: JSON.stringify({
            action,
            selections,
            targetLang: "Arabic",
            confirmationKey: "snapshot",
          }),
        }),
        context,
      );
    expect((await post("addition-plan")).status).toBe(200);
    expect(mocks.additionReview).toHaveBeenCalledWith(id, 7, selections);
    expect(mocks.add).not.toHaveBeenCalled();
    expect((await post("add")).status).toBe(200);
    expect(mocks.add).toHaveBeenCalledWith(id, 7, selections, "snapshot");
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each(["recovery-plan", "resume", "recheck", "addition-plan", "add"])(
    "requires ownership before %s",
    async (action) => {
      const r = await POST(
        new Request("http://localhost/api/xlsx-translator/" + id, {
          method: "POST",
          body: JSON.stringify({ action }),
        }),
        context,
      );
      expect(r.status).toBe(404);
      expect(mocks.review).not.toHaveBeenCalled();
      expect(mocks.resume).not.toHaveBeenCalled();
      expect(mocks.recheck).not.toHaveBeenCalled();
      expect(mocks.additionReview).not.toHaveBeenCalled();
      expect(mocks.add).not.toHaveBeenCalled();
    },
  );
  it("rechecks only through the authenticated owner's offline helper", async () => {
    mocks.owned.mockResolvedValue({ status: "error" });
    mocks.recheck.mockResolvedValue({ jobId: id, additionalRequests: 0 });
    const response = await POST(
      new Request("http://localhost/api/xlsx-translator/" + id, {
        method: "POST",
        body: JSON.stringify({ action: "recheck" }),
      }),
      context,
    );
    expect(response.status).toBe(200);
    expect(mocks.recheck).toHaveBeenCalledWith(id, 7);
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("keeps recovery review separate from the paid confirmation", async () => {
    mocks.owned.mockResolvedValue({ status: "error" });
    mocks.review.mockResolvedValue({ key: "snapshot", maxRequests: 1 });
    await POST(
      new Request("http://localhost/api/xlsx-translator/" + id, {
        method: "POST",
        body: JSON.stringify({ action: "recovery-plan" }),
      }),
      context,
    );
    expect(mocks.review).toHaveBeenCalledWith(id, 7);
    expect(mocks.resume).not.toHaveBeenCalled();
    mocks.resume.mockResolvedValue({ jobId: id });
    await POST(
      new Request("http://localhost/api/xlsx-translator/" + id, {
        method: "POST",
        body: JSON.stringify({ action: "resume", confirmationKey: "snapshot" }),
      }),
      context,
    );
    expect(mocks.resume).toHaveBeenCalledWith(id, 7, "snapshot");
  });
  it("does not restore another users failed job", async () => {
    const r = await POST(
      new Request("http://localhost/api/xlsx-translator/" + id, {
        method: "POST",
        body: JSON.stringify({ action: "restore" }),
      }),
      context,
    );
    expect(r.status).toBe(404);
    expect(mocks.restore).not.toHaveBeenCalled();
  });
  it("restores only through the authenticated owner-scoped helper without starting translation", async () => {
    mocks.owned.mockResolvedValue({ status: "error" });
    mocks.restore.mockResolvedValue({ jobId: id });
    const r = await POST(
      new Request("http://localhost/api/xlsx-translator/" + id, {
        method: "POST",
        body: JSON.stringify({ action: "restore" }),
      }),
      context,
    );
    expect(r.status).toBe(200);
    expect(mocks.restore).toHaveBeenCalledWith(id, 7);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each(["inspect", "preview", "download", "status"])(
    "requires ownership for %s",
    async (view) => {
      const r = await GET(
        new Request(`http://localhost/api/xlsx-translator/${id}?view=${view}`),
        context,
      );
      expect(r.status).toBe(404);
      expect(mocks.owned).toHaveBeenCalledWith(id, 7, view !== "status");
    },
  );
  it("rejects cross-origin mutations", async () => {
    const r = await POST(
      new Request("http://localhost/api/xlsx-translator/" + id, {
        method: "POST",
        headers: { Origin: "https://evil.example" },
        body: "{}",
      }),
      context,
    );
    expect(r.status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("does not cancel a job belonging to someone else", async () => {
    const r = await POST(
      new Request("http://localhost/api/xlsx-translator/" + id, {
        method: "POST",
        body: JSON.stringify({ action: "cancel" }),
      }),
      context,
    );
    expect(r.status).toBe(404);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("only deletes the authenticated users terminal Excel records", async () => {
    mocks.remove.mockResolvedValue({ count: 1 });
    const r = await DELETE(
      new Request("http://localhost/api/xlsx-translator/" + id, {
        method: "DELETE",
      }),
      context,
    );
    expect(r.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith({
      where: {
        id,
        user_id: 7,
        job_type: "xlsx_translation_v1",
        status: { in: ["draft", "done", "error", "cancelled"] },
      },
    });
  });
});
