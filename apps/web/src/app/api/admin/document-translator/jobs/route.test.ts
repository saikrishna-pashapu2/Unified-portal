import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));

vi.mock("@/lib/api-auth", () => ({ requireAdminSession: mocks.auth }));
vi.mock("@esgcredit/db-esg", () => ({
  esgPrisma: { $queryRawUnsafe: mocks.query },
}));

import { GET } from "./route";
import {
  normalizeAdminTranslatorJob,
  parseAdminTranslatorJobsQuery,
} from "@/lib/document-translator/admin-jobs";

const url = "http://localhost/api/admin/document-translator/jobs";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ response: null });
  mocks.query.mockResolvedValue([{ total: 0, items: [] }]);
});

describe("admin document translator jobs", () => {
  it.each([401, 403])("requires an admin session (%i) before querying", async (status) => {
    mocks.auth.mockResolvedValue({ response: new Response(null, { status }) });

    const response = await GET(new Request(url));

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each([
    "?period=invalid",
    "?status=processing",
    "?page=0",
    "?pageSize=101",
    `?q=${"x".repeat(201)}`,
  ])("rejects invalid filters before querying (%s)", async (search) => {
    const response = await GET(new Request(`${url}${search}`));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("defaults to the 30-day, 25-row admin listing contract", () => {
    expect(parseAdminTranslatorJobsQuery(new URLSearchParams())).toMatchObject({
      period: "30",
      kind: "all",
      status: "all",
      q: "",
      page: 1,
      pageSize: 25,
      skip: 0,
    });
  });

  it("filters drafts before pagination and keeps wildcard/Cyrillic search literal", async () => {
    mocks.query.mockResolvedValueOnce([
      {
        total: BigInt(51),
        items: [
          {
            kind: "xlsx",
            id: "a38eb791-f150-4ea6-93e7-3d4696546549",
            filename: "Бюджет.xlsx",
            targetLanguage: "Russian",
            status: "draft",
            stage: "draft",
            progress: 0,
            totalPages: null,
            changedCells: null,
            createdAt: new Date("2026-09-16T10:00:00.000Z"),
            completedAt: null,
            userName: "Тест Пользователь",
            userEmail: null,
            inputTokens: 0,
            outputTokens: 0,
            requests: null,
            message: "Choose the columns to translate.",
            error: null,
            errorTruncated: false,
            payload_json: { privatePayload: "HIDDEN_PAYLOAD_SENTINEL" },
            result_json: { translations: "HIDDEN_CHECKPOINT_SENTINEL" },
          },
        ],
      },
    ]);

    const response = await GET(
      new Request(
        `${url}?period=7&kind=xlsx&status=draft&q=%25_%D0%B1%D1%8E%D0%B4%D0%B6%D0%B5%D1%82&page=2&pageSize=50`,
      ),
    );
    const body = await response.json();
    const [sql, createdSince, kind, status, search, size, skip] =
      mocks.query.mock.calls[0];

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toMatchObject({ success: true, total: 51, page: 2, size: 50 });
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      kind: "xlsx",
      status: "draft",
      totalPages: null,
      changedCells: null,
      requests: null,
      completedAt: null,
    });
    expect(sql).toContain("strpos(lower(COALESCE(filename, '')), lower($4::text)) > 0");
    expect(sql).not.toMatch(/\bLIKE\b/i);
    expect(sql).toContain("WHEN 'draft' THEN status = 'draft'");
    expect([kind, status, search, size, skip]).toEqual([
      "xlsx",
      "draft",
      "%_бюджет",
      50,
      50,
    ]);
    expect(createdSince).toBeInstanceOf(Date);
    expect(JSON.stringify(body)).not.toContain("HIDDEN_PAYLOAD_SENTINEL");
    expect(JSON.stringify(body)).not.toContain("HIDDEN_CHECKPOINT_SENTINEL");
  });

  it("normalizes PDF and Excel rows while returning specific, redacted stored failures", async () => {
    // Deliberately synthetic tokens: exercise redaction without committing a
    // credential-shaped JWT fixture that secret scanners could mistake for one.
    const fakeBearer = ["unit", "test", "placeholder"].join("-");
    const rawFailure =
      "Provider failure: postgresql://dbuser:dbpass@db.example.test/esg?token=db-token " +
      "https://svc:password@example.test/api " +
      `Authorization: Bearer ${fakeBearer} OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz`;
    mocks.query.mockResolvedValueOnce([
      {
        total: 2,
        items: [
          {
            kind: "pdf",
            id: "7219f0fa-69e1-4490-acf2-c5af8ee79dae",
            filename: "report.pdf",
            targetLanguage: "Russian",
            status: "error",
            stage: "translation",
            progress: 99,
            totalPages: 4,
            changedCells: null,
            createdAt: "2026-09-17T07:00:00.000Z",
            completedAt: null,
            userName: "A User",
            userEmail: "a@example.test",
            inputTokens: 900,
            outputTokens: 250,
            requests: 7,
            message: null,
            error: rawFailure,
            errorTruncated: false,
            document_context: "HIDDEN_DOCUMENT_CONTEXT_SENTINEL",
          },
          {
            kind: "xlsx",
            id: "6cde586e-5e87-473d-a6ac-cd40efbc8e15",
            filename: "workbook.xlsx",
            targetLanguage: "Uzbek",
            status: "completed",
            stage: "completed",
            progress: 100,
            totalPages: null,
            changedCells: 14,
            createdAt: new Date("2026-09-17T06:00:00.000Z"),
            completedAt: new Date("2026-09-17T06:10:00.000Z"),
            userName: "B User",
            userEmail: null,
            inputTokens: "110",
            outputTokens: 38,
            requests: 3,
            message: "Translation completed.",
            error: null,
            errorTruncated: false,
          },
        ],
      },
    ]);

    const response = await GET(new Request(url));
    const body = await response.json();
    const sql = mocks.query.mock.calls[0][0] as string;

    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      kind: "pdf",
      totalPages: 4,
      changedCells: null,
      inputTokens: 900,
      outputTokens: 250,
      requests: 7,
      error: "Provider failure: postgresql://[REDACTED]@db.example.test/esg?token=[REDACTED] https://[REDACTED]@example.test/api Authorization: Bearer [REDACTED] OPENAI_API_KEY=[REDACTED]",
    });
    expect(body.items[1]).toMatchObject({
      kind: "xlsx",
      status: "completed",
      totalPages: null,
      changedCells: 14,
      inputTokens: 110,
      outputTokens: 38,
      requests: 3,
      completedAt: "2026-09-17T06:10:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("password@example.test");
    expect(JSON.stringify(body)).not.toContain("dbuser:dbpass");
    expect(JSON.stringify(body)).not.toContain("db-token");
    expect(JSON.stringify(body)).not.toContain(fakeBearer);
    expect(JSON.stringify(body)).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz");
    expect(JSON.stringify(body)).not.toContain("HIDDEN_DOCUMENT_CONTEXT_SENTINEL");
    expect(sql).toContain("pdf_queue.last_error");
    expect(sql).toContain("j.message");
    expect(sql).toContain("x.last_error");
    expect(sql).toContain("requestLedger,inputTokens");
    expect(sql).toContain("contextInputTokens");
    expect(sql).toContain("page_usage.page_input_tokens");
    expect(sql).not.toMatch(/\bj\.error\b/);
  });

  it("bounds exposed errors and marks old JSON metrics nullable", () => {
    const largeError = "x".repeat(12_001);
    const normalized = normalizeAdminTranslatorJob({
      kind: "xlsx",
      id: "6cde586e-5e87-473d-a6ac-cd40efbc8e15",
      filename: "legacy.xlsx",
      targetLanguage: "Russian",
      status: "error",
      stage: "error",
      progress: 99,
      totalPages: null,
      changedCells: null,
      createdAt: new Date("2026-09-16T10:00:00.000Z"),
      completedAt: null,
      userName: "Unknown",
      userEmail: null,
      inputTokens: null,
      outputTokens: undefined,
      requests: null,
      message: null,
      error: largeError,
      errorTruncated: false,
      result_json: { translations: "MUST_NOT_LEAK" },
    });

    expect(normalized).toMatchObject({
      totalPages: null,
      changedCells: null,
      completedAt: null,
      inputTokens: 0,
      outputTokens: 0,
      requests: null,
      errorTruncated: true,
    });
    expect(normalized?.error).toHaveLength(12_000);
    expect(JSON.stringify(normalized)).not.toContain("MUST_NOT_LEAK");
  });

  it("uses a single parameterized count/page statement and returns totals for empty later pages", async () => {
    mocks.query.mockResolvedValueOnce([{ total: BigInt(37), items: [] }]);

    const response = await GET(
      new Request(`${url}?kind=pdf&status=attention&page=4&pageSize=10`),
    );
    const body = await response.json();
    const [sql, , kind, status, q, size, skip] = mocks.query.mock.calls[0];

    expect(body).toEqual({
      success: true,
      items: [],
      total: 37,
      page: 4,
      size: 10,
    });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(sql).toContain("totals AS (");
    expect(sql).toContain("page_jobs AS (");
    expect([kind, status, q, size, skip]).toEqual([
      "pdf",
      "attention",
      "",
      10,
      30,
    ]);
  });
});
