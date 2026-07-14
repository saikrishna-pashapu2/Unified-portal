import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MAX_WORKBOOK_DATA_ROWS,
  MAX_WORKBOOK_UPLOAD_BYTES,
  parseWorkbookBuffer,
  validateWorkbookFile,
  validateWorkbookMagic,
  validateWorkbookRequestSize,
  WorkbookSecurityError,
  writeWorkbookBuffer,
} from "@/lib/workbook";

describe("DEP-01 hardened workbook processing", () => {
  it("uses the official patched SheetJS distribution", () => {
    const require = createRequire(import.meta.url);
    expect(require("xlsx").version).toBe("0.20.3");
  });

  it("round-trips workbook data through the isolated worker", async () => {
    const buffer = await writeWorkbookBuffer([
      {
        name: "Companies",
        rows: [
          ["Company", "Score"],
          ["Example Corp", 87],
        ],
      },
    ]);

    const parsed = await parseWorkbookBuffer(buffer);

    expect(parsed).toEqual({
      sheetName: "Companies",
      rows: [
        ["Company", "Score"],
        ["Example Corp", 87],
      ],
    });
  });

  it("rejects invalid extensions, content types, signatures, and request sizes", () => {
    expect(() =>
      validateWorkbookFile(
        new File(["data"], "companies.xls", {
          type: "application/vnd.ms-excel",
        }),
      ),
    ).toThrow(WorkbookSecurityError);

    expect(() =>
      validateWorkbookFile(new File(["data"], "companies.xlsx", { type: "text/plain" })),
    ).toThrow("Invalid workbook content type");
    expect(() => validateWorkbookMagic(Buffer.from("not an xlsx"))).toThrow(
      "Invalid XLSX file signature",
    );
    expect(() =>
      validateWorkbookRequestSize(
        new Request("http://localhost/upload", {
          headers: { "content-length": String(MAX_WORKBOOK_UPLOAD_BYTES + 1024 * 1024 + 1) },
        }),
      ),
    ).toThrow("Workbook request is too large");
  });

  it("rejects excessive rows before application processing", async () => {
    const rows = Array.from({ length: MAX_WORKBOOK_DATA_ROWS + 2 }, (_, index) => [
      index === 0 ? "Company" : `Company ${index}`,
    ]);
    const buffer = await writeWorkbookBuffer([{ name: "Too Many", rows }]);

    await expect(parseWorkbookBuffer(buffer)).rejects.toThrow(
      "Workbook contains too many rows",
    );
  });
});
