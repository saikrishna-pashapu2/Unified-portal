import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriverWorkbook } from "../workbook-types";

const mocks = vi.hoisted(() => ({
  buildOptions: vi.fn(),
  compare: vi.fn(),
  executeRaw: vi.fn(),
  parse: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/esg-drivers/catalog-import", () => ({
  parseDriverCatalogUpload: mocks.parse,
}));
vi.mock("@/lib/esg-drivers/catalog-utils", () => ({
  buildWorkbookOptions: mocks.buildOptions,
  compareDriverCatalogs: mocks.compare,
}));
vi.mock("@esgcredit/db-esg", () => ({
  esgPrisma: {
    $executeRaw: mocks.executeRaw,
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}));

import {
  BUNDLED_DRIVER_CATALOG_ID,
  DriverCatalogStaleRevisionError,
  DriverCatalogValidationError,
  activateDriverCatalog,
  getActiveDriverCatalog,
  uploadDriverCatalog,
} from "../catalog-store";

const catalog: DriverWorkbook = {
  version: "excel-v2.test",
  workbook: "test.xlsx",
  sha256: "a".repeat(64),
  sheets: [{
    name: "Banking",
    drivers: [{
      id: "banking-r2",
      sheet: "Banking",
      row: 2,
      section: "Global Drivers",
      type: "Agreement",
      name: "Test driver",
      logic: "logic",
      evidenceKpi: "kpi",
      keySources: "source",
      sourceUrls: ["https://example.com/source"],
    }],
    sources: [{ url: "https://example.com/source", label: "Example", cells: ["G2"] }],
  }],
};

const activeId = "11111111-1111-4111-8111-111111111111";

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: activeId,
    version: catalog.version,
    workbook: catalog.workbook,
    sha256: catalog.sha256,
    display_name: catalog.workbook,
    catalog_json: catalog,
    warnings_json: [],
    driver_count: 1,
    sheet_count: 1,
    source_count: 1,
    is_bundled: false,
    uploaded_at: new Date("2026-10-09T10:00:00.000Z"),
    uploaded_by_user_id: 7,
    uploader_username: "tester",
    uploader_email: "tester@example.test",
    uploader_first_name: null,
    uploader_last_name: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executeRaw.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async (callback: (client: unknown) => Promise<unknown>) =>
    callback({ $executeRaw: mocks.executeRaw, $queryRaw: mocks.queryRaw }),
  );
  mocks.buildOptions.mockReturnValue({
    workbook: catalog.workbook,
    version: catalog.version,
    countries: ["UAE"],
    sectors: ["Banking"],
    counts: { Banking: { UAE: 1 } },
  });
  mocks.compare.mockReturnValue({
    addedDrivers: 0,
    removedDrivers: 0,
    changedDrivers: 0,
    addedSources: 0,
    removedSources: 0,
    addedSourceUrls: [],
    removedSourceUrls: [],
    changes: [],
    truncated: false,
  });
});

describe("shared ESG Driver catalog store", () => {
  it("seeds and reads the bundled catalog under the caller transaction lock", async () => {
    const activeRow = versionRow({
      id: BUNDLED_DRIVER_CATALOG_ID,
      is_bundled: true,
      uploaded_by_user_id: null,
      active_version_id: BUNDLED_DRIVER_CATALOG_ID,
      revision: 0,
    });
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      if (strings.join("").includes('FROM "esg_driver_catalog_state" s')) return [activeRow];
      return [];
    });

    const database = { $executeRaw: mocks.executeRaw, $queryRaw: mocks.queryRaw };
    const result = await getActiveDriverCatalog(database);

    expect(result.summary.id).toBe(BUNDLED_DRIVER_CATALOG_ID);
    expect(result.revision).toBe(0);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.queryRaw.mock.calls[0][0].join("")).toContain("FOR UPDATE");
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
  });

  it("rejects a stale activation while the state row is locked", async () => {
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      if (strings.join("").includes('FROM "esg_driver_catalog_state"')) {
        return [{ active_version_id: BUNDLED_DRIVER_CATALOG_ID, revision: 4 }];
      }
      return [];
    });

    await expect(activateDriverCatalog(7, activeId, 3)).rejects.toBeInstanceOf(DriverCatalogStaleRevisionError);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("keeps invalid workbook uploads inactive and returns parser issues", async () => {
    mocks.queryRaw.mockResolvedValue([]);
    mocks.parse.mockRejectedValue({
      issues: [{ sheet: "Banking", cell: "G1", message: "A Link column is required." }],
      status: 400,
    });

    await expect(uploadDriverCatalog(7, Buffer.from("invalid"), "bad.xlsx"))
      .rejects.toMatchObject({
        code: "invalid_workbook",
        issues: [{ sheet: "Banking", cell: "G1", message: "A Link column is required." }],
      });
    expect(mocks.parse).toHaveBeenCalledOnce();
    expect(mocks.executeRaw).toHaveBeenCalledTimes(2);
  });

  it("deduplicates identical bytes before invoking the parser", async () => {
    const existing = versionRow({ sha256: "2".repeat(64) });
    mocks.queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("");
      if (sql.includes('WHERE v.sha256')) return [existing];
      if (sql.includes('WHERE v.id')) return [existing];
      if (sql.includes('FROM "esg_driver_catalog_state" s')) return [{
        ...existing,
        active_version_id: existing.id,
        revision: 2,
      }];
      return [];
    });

    const result = await uploadDriverCatalog(7, Buffer.from("same bytes"), "renamed.xlsx");
    expect(result.version.id).toBe(existing.id);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.compare).toHaveBeenCalledOnce();
  });
});
