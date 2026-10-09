import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  ensureUserId: vi.fn(),
  enforceApiUsage: vi.fn(),
  getPreview: vi.fn(),
  list: vi.fn(),
  upload: vi.fn(),
}));

const mockedErrors = vi.hoisted(() => {
  class MockCatalogError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
      message: string,
      public readonly issues?: unknown[],
    ) {
      super(message);
    }
  }

  class MockValidationError extends MockCatalogError {
    constructor(issues: unknown[]) {
      super("invalid_workbook", 400, "Invalid ESG Driver workbook.", issues);
    }
  }

  class MockPayloadTooLargeError extends MockCatalogError {
    constructor() {
      super("payload_too_large", 413, "The workbook upload is too large.");
    }
  }

  return { MockCatalogError, MockValidationError, MockPayloadTooLargeError };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/session-user", () => ({ ensureUserId: mocks.ensureUserId }));
vi.mock("@/lib/api-usage", () => ({ enforceApiUsage: mocks.enforceApiUsage }));
vi.mock("@/lib/config/env", () => ({ env: { NEXTAUTH_URL: "http://localhost:3000" } }));
vi.mock("@/lib/esg-drivers/catalog-store", () => ({
  DRIVER_CATALOG_FILE_MAX_BYTES: 5 * 1024 * 1024,
  DRIVER_CATALOG_REQUEST_MAX_BYTES: 5 * 1024 * 1024 + 256 * 1024,
  DriverCatalogPayloadTooLargeError: mockedErrors.MockPayloadTooLargeError,
  DriverCatalogStoreError: mockedErrors.MockCatalogError,
  DriverCatalogValidationError: mockedErrors.MockValidationError,
  activateDriverCatalog: mocks.activate,
  getDriverCatalogPreview: mocks.getPreview,
  listDriverCatalogs: mocks.list,
  uploadDriverCatalog: mocks.upload,
}));

import { GET as listCatalogs, POST as uploadCatalog } from "../workbooks/route";
import { GET as previewCatalog } from "../workbooks/[versionId]/route";
import { POST as activateCatalog } from "../workbooks/[versionId]/activate/route";

const listResponse = {
  active: {
    id: "00000000-0000-4000-8000-000000000001",
    version: "excel-v2.test",
    workbook: "ESG_Drivers_September.xlsx",
    sha256: "a".repeat(64),
    uploadedAt: "2026-09-01T00:00:00.000Z",
    uploadedBy: { id: null, name: "Bundled catalog" },
    driverCount: 1,
    sheetCount: 1,
    sourceCount: 1,
    isActive: true,
    isBundled: true,
  },
  options: { workbook: "ESG_Drivers_September.xlsx", version: "excel-v2.test", countries: [], sectors: [], counts: {} },
  revision: 0,
  versions: [],
  nextCursor: null,
  activations: [],
};

beforeEach(() => {
  mocks.ensureUserId.mockResolvedValue(27);
  mocks.enforceApiUsage.mockResolvedValue(null);
  mocks.list.mockResolvedValue(listResponse);
  mocks.getPreview.mockResolvedValue({ version: listResponse.active, active: listResponse.active, revision: 0, diff: {}, warnings: [] });
  mocks.upload.mockResolvedValue({ version: listResponse.active, active: listResponse.active, revision: 0, diff: {}, warnings: [] });
  mocks.activate.mockResolvedValue(listResponse);
});

afterEach(() => vi.clearAllMocks());

describe("shared ESG Driver workbook catalog routes", () => {
  it("requires a fresh active user before reading or parsing anything", async () => {
    mocks.ensureUserId.mockResolvedValue(null);
    const response = await listCatalogs(new Request("http://localhost:3000/api/esg/drivers/workbooks"));
    expect(response.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();

    const upload = await uploadCatalog(new Request("http://localhost:3000/api/esg/drivers/workbooks", {
      method: "POST",
      headers: { Origin: "http://localhost:3000", "Content-Type": "multipart/form-data; boundary=bad" },
      body: "",
    }));
    expect(upload.status).toBe(401);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("allows any active signed-in user to list and preview versions", async () => {
    const list = await listCatalogs(new Request("http://localhost:3000/api/esg/drivers/workbooks?cursor=next"));
    expect(list.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("next");

    const preview = await previewCatalog(new Request("http://localhost:3000/api/esg/drivers/workbooks/version"), {
      params: Promise.resolve({ versionId: "version" }),
    });
    expect(preview.status).toBe(200);
    expect(mocks.getPreview).toHaveBeenCalledWith("version");
  });

  it("rejects cross-origin upload before consuming the body", async () => {
    const response = await uploadCatalog(new Request("http://localhost:3000/api/esg/drivers/workbooks", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "multipart/form-data; boundary=bad",
      },
      body: "ignored",
    }));
    expect(response.status).toBe(403);
    expect(mocks.enforceApiUsage).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("bounds an oversized streamed upload before parsing multipart data", async () => {
    const body = new Uint8Array(5 * 1024 * 1024 + 256 * 1024 + 1);
    const response = await uploadCatalog(new Request("http://localhost:3000/api/esg/drivers/workbooks", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "multipart/form-data; boundary=bad",
      },
      body,
    }));
    expect(response.status).toBe(413);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("returns structured validation issues and never activates an invalid upload", async () => {
    mocks.upload.mockRejectedValue(new mockedErrors.MockValidationError([
      { sheet: "Banking", cell: "G1", message: "A Link column is required." },
    ]));
    const form = new FormData();
    form.append("file", new File(["bad"], "bad.xlsx"));
    const response = await uploadCatalog(new Request("http://localhost:3000/api/esg/drivers/workbooks", {
      method: "POST",
      headers: { Origin: "http://localhost:3000" },
      body: form,
    }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid ESG Driver workbook.",
      issues: [{ sheet: "Banking", cell: "G1", message: "A Link column is required." }],
    });
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("enforces the daily activation limit before mutating the shared catalog", async () => {
    mocks.enforceApiUsage.mockResolvedValue(new Response(JSON.stringify({ error: "Daily activation limit reached" }), { status: 429 }));
    const response = await activateCatalog(new Request("http://localhost:3000/api/esg/drivers/workbooks/version/activate", {
      method: "POST",
      headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 4 }),
    }), { params: Promise.resolve({ versionId: "version" }) });
    expect(response.status).toBe(429);
    expect(mocks.enforceApiUsage).toHaveBeenCalledWith(expect.any(Request), expect.objectContaining({
      feature: "esg_driver_catalog_activation", userId: 27, perMinute: 20, perDay: 20,
    }));
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("maps stale expectedRevision to a conflict", async () => {
    mocks.activate.mockRejectedValue(new mockedErrors.MockCatalogError(
      "stale_revision",
      409,
      "The workbook catalog changed.",
    ));
    const response = await activateCatalog(new Request("http://localhost:3000/api/esg/drivers/workbooks/version/activate", {
      method: "POST",
      headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision: 4 }),
    }), { params: Promise.resolve({ versionId: "version" }) });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "stale_revision" });
    expect(mocks.activate).toHaveBeenCalledWith(27, "version", 4);
  });
});
