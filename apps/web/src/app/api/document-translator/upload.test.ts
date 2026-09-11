import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  pdf: vi.fn(),
  excel: vi.fn(),
}));
vi.mock("@/lib/pdfx-v2/auth", () => ({ requirePdfxUser: mocks.auth }));
vi.mock("@/lib/pdfx-v2/pipeline", () => ({
  startPdfTranslationV2Job: mocks.pdf,
}));
vi.mock("@/lib/xlsx-translator/jobs", () => ({
  createExcelDraft: mocks.excel,
}));
vi.mock("@/lib/jobs/queue", () => ({
  JobConcurrencyLimitError: class extends Error {},
}));
import { POST } from "../pdfx-v2/upload/route";
afterEach(() => vi.unstubAllEnvs());
async function upload(bytes: Uint8Array, name: string, expectedKind: string, origin?: string) {
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array(bytes)], name, {
      type: "application/octet-stream",
    }),
  );
  form.set("targetLang", "Russian");
  form.set("expectedKind", expectedKind);
  return POST(
    new Request("http://localhost/api/pdfx-v2/upload", {
      method: "POST",
      body: form,
      headers: origin ? { origin } : undefined,
    }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 7 });
  mocks.pdf.mockResolvedValue("pdf-job");
  mocks.excel.mockResolvedValue({ jobId: "excel-job", kind: "xlsx" });
});
describe("Unified upload routing", () => {
  it("accepts the production public origin through an internal proxy URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://unifiedportal.duckdns.org");
    const response = await upload(new Uint8Array([80, 75, 3, 4, 0]), "book.xlsx", "xlsx", "https://unifiedportal.duckdns.org");
    expect(response.status).toBe(200);
    expect(mocks.excel).toHaveBeenCalledOnce();
  });
  it("rejects cross-origin upload before inspecting or queuing a document", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://unifiedportal.duckdns.org");
    const response = await upload(new Uint8Array([80, 75, 3, 4, 0]), "book.xlsx", "xlsx", "https://attacker.example");
    expect(response.status).toBe(403);
    expect(mocks.excel).not.toHaveBeenCalled();
    expect(mocks.pdf).not.toHaveBeenCalled();
  });
  it("routes genuine PDF bytes to the existing PDF flow despite generic MIME", async () => {
    const p = await PDFDocument.create();
    p.addPage();
    const r = await upload(await p.save(), "sample.pdf", "pdf");
    expect(await r.json()).toMatchObject({ kind: "pdf", jobId: "pdf-job" });
    expect(mocks.excel).not.toHaveBeenCalled();
  });
  it("routes ZIP workbook candidates to inspection, not the PDF processor", async () => {
    const r = await upload(
      new Uint8Array([80, 75, 3, 4, 0]),
      "sample.xlsx",
      "xlsx",
    );
    expect(await r.json()).toMatchObject({ kind: "xlsx", jobId: "excel-job" });
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.excel).toHaveBeenCalledWith(
      7,
      "sample.xlsx",
      expect.any(Buffer),
      "Russian",
    );
  });
  it("does not start a paid PDF job from a mislabelled Excel inspection", async () => {
    const p = await PDFDocument.create();
    p.addPage();
    expect(
      (await upload(await p.save(), "mislabelled.xlsx", "xlsx")).status,
    ).toBe(422);
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.excel).not.toHaveBeenCalled();
  });
  it("rejects unsupported bytes before either backend is started", async () => {
    expect(
      (
        await upload(
          new TextEncoder().encode("not a spreadsheet"),
          "bad.xlsx",
          "xlsx",
        )
      ).status,
    ).toBe(415);
    expect(mocks.excel).not.toHaveBeenCalled();
    expect(mocks.pdf).not.toHaveBeenCalled();
  });
});
