import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/pdfx-v2/auth", () => ({ requirePdfxUser: mocks.auth }));
vi.mock("@esgcredit/db-esg", () => ({ esgPrisma: { $queryRaw: mocks.query } }));
import { GET } from "./route";
import { parseHistoryQuery } from "@/lib/document-translator/history";

const counts = { all: 57, completed: 50, active: 3, attention: 3, draft: 1 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 7 });
  mocks.query.mockResolvedValue([
    {
      items: [
        { id: "excel", kind: "xlsx", status: "draft" },
        { id: "pdf", kind: "pdf", status: "completed" },
      ],
      total: 57,
      allTotal: 57,
      counts,
    },
  ]);
});
const request = (query = "") =>
  GET(new Request("http://localhost/api/document-translator/history" + query));

describe("Unified private history", () => {
  it("requires authentication before reading either history", async () => {
    mocks.auth.mockResolvedValue({
      response: new Response(null, { status: 401 }),
    });
    expect((await request()).status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each([
    "?page=-1",
    "?page=1.5",
    "?page=100001",
    "?pageSize=101",
    "?pageSize=0",
    "?status=bogus",
    "?kind=csv",
    "?q=" + "x".repeat(201),
  ])("rejects invalid history filters: %s", async (q) => {
    expect((await request(q)).status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("returns a later page and counts from one owner-scoped metadata-only statement", async () => {
    const r = await request("?page=3&pageSize=25");
    const result = await r.json();
    expect(result).toMatchObject({
      total: 57,
      allTotal: 57,
      page: 3,
      size: 25,
      counts,
    });
    expect(result.items.map((item: { kind: string }) => item.kind)).toEqual([
      "xlsx",
      "pdf",
    ]);
    expect(
      result.items.map((item: { canDownload: boolean }) => item.canDownload),
    ).toEqual([false, true]);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [template, ...values] = mocks.query.mock.calls[0];
    expect(values).toEqual([
      7,
      7,
      "xlsx_translation_v1",
      "all",
      "all",
      "",
      "all",
      25,
      50,
    ]);
    const sql = template.join("?");
    expect(sql.match(/WHERE user_id=/g)).toHaveLength(2);
    expect(sql).toContain("ORDER BY created_at DESC, id DESC, kind DESC");
    expect(sql).toContain("CASE WHEN status='done' THEN 'completed'");
    expect(sql).not.toMatch(/input_data|output_data|result_json|last_error/);
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
  it("applies literal Unicode search and file/status filters before pagination", async () => {
    const search = "База_100%'; DROP TABLE jobs;--";
    const r = await request(
      "?page=2&pageSize=10&kind=xlsx&status=attention&q=" +
        encodeURIComponent(search),
    );
    expect(r.status).toBe(200);
    const [template, ...values] = mocks.query.mock.calls[0];
    expect(values).toEqual([
      7,
      7,
      "xlsx_translation_v1",
      "xlsx",
      "xlsx",
      search,
      "attention",
      10,
      10,
    ]);
    const sql = template.join("?");
    expect(sql).not.toContain(search);
    expect(sql).toContain("strpos(lower(COALESCE(filename, '')), lower(");
    expect(sql.indexOf("FROM searched WHERE CASE")).toBeLessThan(
      sql.indexOf("LIMIT"),
    );
    expect(sql).toContain("status IN ('error', 'cancelled')");
    expect(sql).toContain("status IN ('queued', 'processing', 'cancelling')");
  });
  it("preserves the filtered total even when the requested page is empty", async () => {
    mocks.query.mockResolvedValueOnce([
      { items: [], total: 25, allTotal: 57, counts },
    ]);
    const data = await (
      await request("?page=2&pageSize=25&status=completed")
    ).json();
    expect(data).toMatchObject({ total: 25, allTotal: 57, page: 2, items: [] });
  });
  it("returns zero counts for an empty library", async () => {
    const empty = { all: 0, completed: 0, active: 0, attention: 0, draft: 0 };
    mocks.query.mockResolvedValueOnce([
      { items: [], total: 0, allTotal: 0, counts: empty },
    ]);
    expect(await (await request()).json()).toMatchObject({
      items: [],
      total: 0,
      counts: empty,
    });
  });
  it("supports every explicit filter without accepting arbitrary SQL fragments", () => {
    for (const status of ["all", "active", "completed", "attention", "draft"])
      expect(
        parseHistoryQuery(new URLSearchParams({ status, q: "  Реестр  " })),
      ).toMatchObject({ status, search: "Реестр", page: 1 });
    for (const kind of ["all", "pdf", "xlsx"])
      expect(parseHistoryQuery(new URLSearchParams({ kind }))).toMatchObject({
        kind,
      });
  });
  it("returns a retryable error without leaking database details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.query.mockRejectedValueOnce(new Error("private connection details"));
    const r = await request();
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain("private connection");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    log.mockRestore();
  });
});
