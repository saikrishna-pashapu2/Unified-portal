import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("Excel production worker integration", () => {
  const worker = readFileSync(
    fileURLToPath(new URL("../../esg-driver-worker.mts", import.meta.url)),
    "utf8",
  );
  it("claims and processes Excel jobs in the existing production entrypoint", () => {
    expect(worker).toContain('"xlsx_translation_v1",');
    expect(worker).toContain('job.jobType === "xlsx_translation_v1"');
    expect(worker).toContain("await processExcelTranslation(job)");
  });
  it("keeps spent request budgets and invalid selections terminal", () => {
    expect(worker).toMatch(/error instanceof ExcelRequestBudgetError \|\| error instanceof ExcelSelectionError\s*\? \{ forceTerminal: true \}/);
    expect(worker).not.toContain("keepRetrying: true");
  });
  it("preserves the deployed v5 PDF retry ceilings", () => {
    expect(worker).toContain("maximumAttempts: PDF_TRANSLATION_MAX_ATTEMPTS");
    expect(worker).toContain("forceTerminal: isPdfxBudgetError(error)");
    expect(worker).not.toMatch(/pdf_translation_v[67]/);
  });
});
