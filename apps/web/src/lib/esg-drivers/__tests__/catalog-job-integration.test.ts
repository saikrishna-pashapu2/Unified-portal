import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transactionStatements: Array<{ sql: string; values: unknown[] }> = [];
  const txQueryRaw = vi.fn(async (_strings: TemplateStringsArray) => [] as unknown[]);
  const txExecuteRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    transactionStatements.push({ sql: strings.join("?"), values });
    return 1;
  });
  const transactionClient = { $queryRaw: txQueryRaw, $executeRaw: txExecuteRaw };
  const transaction = vi.fn(async (callback: (client: typeof transactionClient) => unknown) => callback(transactionClient));
  const queryRaw = vi.fn(async () => [] as unknown[]);
  const executeRaw = vi.fn(async () => 1);
  const activeCatalog = vi.fn();
  return {
    transactionStatements,
    transactionClient,
    txQueryRaw,
    txExecuteRaw,
    transaction,
    queryRaw,
    executeRaw,
    activeCatalog,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@esgcredit/db-esg", () => ({
  esgPrisma: {
    $transaction: mocks.transaction,
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
  },
}));
vi.mock("../catalog-store", () => ({
  getActiveDriverCatalog: mocks.activeCatalog,
}));

const catalogId = "b9c8b7a6-1234-4abc-8def-1234567890ab";
const activeCatalog = {
  summary: {
    id: catalogId,
    version: "custom-v1",
    workbook: "Custom ESG Drivers.xlsx",
    sha256: "a".repeat(64),
    uploadedAt: "2026-10-09T00:00:00.000Z",
    uploadedBy: { id: 7, name: "tester" },
    driverCount: 2,
    sheetCount: 1,
    sourceCount: 1,
    isActive: true,
    isBundled: false,
  },
  catalog: {
    version: "custom-v1",
    workbook: "Custom ESG Drivers.xlsx",
    sha256: "a".repeat(64),
    sheets: [{
      name: "Retail Finance",
      drivers: [
        { id: "global-1", sheet: "Retail Finance", row: 2, section: "Global Drivers", type: "General", name: "Global driver", logic: "Global logic", evidenceKpi: "Global evidence", keySources: "Source", sourceUrls: ["https://example.test/source"] },
        { id: "custom-1", sheet: "Retail Finance", row: 3, section: "ألمانيا", type: "Country-related", name: "Custom driver", logic: "Custom logic", evidenceKpi: "Custom evidence", keySources: "Source", sourceUrls: ["https://example.test/source"] },
      ],
      sources: [{ url: "https://example.test/source", label: "Source", cells: ["A1"] }],
    }],
  },
  options: {
    workbook: "Custom ESG Drivers.xlsx",
    version: "custom-v1",
    countries: ["ألمانيا"],
    sectors: ["Retail Finance"],
    counts: { "Retail Finance": { "ألمانيا": 2 } },
  },
  revision: 4,
};

function jobRow(id: string, input: { country: string; sector: string; language: string }) {
  return {
    id,
    user_id: 7,
    country: input.country,
    sector: input.sector,
    language: input.language,
    status: "queued",
    progress: 0,
    stage: "queued",
    error_message: null,
    result_json: null,
    evidence_json: null,
    checkpoint_json: null,
    checkpoint_summary: null,
    catalog_version: "custom-v1",
    checkpoint_catalog_version: "custom-v1",
    checkpoint_catalog_version_id: catalogId,
    checkpoint_workbook: "Custom ESG Drivers.xlsx",
    checkpoint_workbook_sha256: "a".repeat(64),
    parent_job_id: null,
    activity_json: [],
    created_at: "2026-10-09T00:00:00.000Z",
    updated_at: "2026-10-09T00:00:00.000Z",
    completed_at: null,
  };
}

afterEach(() => {
  mocks.transactionStatements.length = 0;
  mocks.txQueryRaw.mockReset().mockResolvedValue([]);
  mocks.txExecuteRaw.mockReset().mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    mocks.transactionStatements.push({ sql: strings.join("?"), values });
    return 1;
  });
  mocks.queryRaw.mockReset().mockResolvedValue([]);
  mocks.executeRaw.mockReset().mockResolvedValue(1);
  mocks.transaction.mockClear();
  mocks.activeCatalog.mockReset();
});

describe("dynamic catalog job creation", () => {
  it("snapshots a nonstatic scope and queue row through the same transaction", async () => {
    mocks.activeCatalog.mockResolvedValue(activeCatalog);
    const input = { country: "ألمانيا", sector: "Retail Finance", language: "English" };
    const id = "4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec";
    mocks.queryRaw.mockResolvedValue([jobRow(id, input)]);

    const { createEsgDriverJob } = await import("../jobs");
    const job = await createEsgDriverJob(7, input);

    expect(job.catalogVersion).toBe("custom-v1");
    expect(job.catalogVersionId).toBe(catalogId);
    expect(mocks.activeCatalog).toHaveBeenCalledWith(mocks.transactionClient);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000 });

    const domainInsert = mocks.transactionStatements.find(({ sql }) => sql.includes("INSERT INTO esg_driver_jobs"));
    const queueInsert = mocks.transactionStatements.find(({ sql }) => sql.includes("INSERT INTO background_jobs"));
    const checkpointJson = domainInsert?.values.find((value): value is string => typeof value === "string" && value.includes('"catalogVersionId"'));
    expect(checkpointJson).toBeDefined();
    expect(JSON.parse(checkpointJson!)).toMatchObject({
      catalogVersionId: catalogId,
      catalogVersion: "custom-v1",
      workbook: "Custom ESG Drivers.xlsx",
      input,
    });
    expect(queueInsert?.values).toContain("esg_driver_excel_v5");
    expect(queueInsert?.values).toContain(JSON.stringify(input));
  });

  it("returns a stale-version conflict before writing domain or queue rows", async () => {
    mocks.activeCatalog.mockResolvedValue(activeCatalog);
    const { createEsgDriverJob, EsgDriverCatalogVersionConflictError } = await import("../jobs");

    await expect(createEsgDriverJob(7, {
      country: "ألمانيا",
      sector: "Retail Finance",
      language: "English",
      expectedWorkbookVersion: "custom-v0",
    })).rejects.toBeInstanceOf(EsgDriverCatalogVersionConflictError);

    expect(mocks.transactionStatements).toHaveLength(0);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("keeps an explicitly supplied pinned checkpoint independent of the active catalog", async () => {
    const { createWorkbookCheckpoint } = await import("../workbook");
    const { createEsgDriverJob } = await import("../jobs");
    const input = { country: "ألمانيا", sector: "Retail Finance", language: "English" };
    const checkpoint = createWorkbookCheckpoint(input, activeCatalog.catalog as any, catalogId);
    mocks.activeCatalog.mockRejectedValue(new Error("active catalog changed"));
    mocks.queryRaw.mockResolvedValue([jobRow("4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec", input)]);

    await createEsgDriverJob(7, input, { checkpoint });

    expect(mocks.activeCatalog).not.toHaveBeenCalled();
    expect(mocks.transactionStatements.find(({ sql }) => sql.includes("INSERT INTO background_jobs"))?.values).toContain("esg_driver_excel_v5");
  });
});
