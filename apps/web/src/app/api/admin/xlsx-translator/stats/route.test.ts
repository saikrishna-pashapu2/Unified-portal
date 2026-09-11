import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/api-auth", () => ({ requireAdminSession: mocks.auth }));
vi.mock("@esgcredit/db-esg", () => ({ esgPrisma: { $queryRaw: mocks.query } }));
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ response: null });
  mocks.query.mockResolvedValue([
    { jobs: BigInt(2), requests: BigInt(3), input_tokens: BigInt(100), output_tokens: BigInt(20) },
  ]);
});
describe("Excel admin usage", () => {
  it("requires an admin session before querying usage", async () => {
    mocks.auth.mockResolvedValue({
      response: new Response(null, { status: 403 }),
    });
    expect(
      (
        await GET(
          new Request("http://localhost/api/admin/xlsx-translator/stats"),
        )
      ).status,
    ).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("validates the reporting period", async () => {
    expect(
      (
        await GET(
          new Request(
            "http://localhost/api/admin/xlsx-translator/stats?period=invalid",
          ),
        )
      ).status,
    ).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("returns private numeric counters without cell contents", async () => {
    const r = await GET(
      new Request(
        "http://localhost/api/admin/xlsx-translator/stats?period=all",
      ),
    );
    expect(await r.json()).toEqual({
      jobs: 2,
      requests: 3,
      input_tokens: 100,
      output_tokens: 20,
    });
    expect(r.headers.get("cache-control")).toBe("private, no-store");
  });
});
