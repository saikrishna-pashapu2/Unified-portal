import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), getPreference: vi.fn(), setPreference: vi.fn(), selections: vi.fn(), feedback: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env", () => ({ env: { NEXTAUTH_URL: "https://portal.test" } }));
vi.mock("@/lib/api-auth", () => ({ requireUserSession: mocks.auth }));
vi.mock("@/lib/api-usage", () => ({ enforceApiUsage: mocks.limit }));
vi.mock("@/lib/article-ai/service", () => ({
  getArticleAiPreference: mocks.getPreference,
  setArticleAiPreference: mocks.setPreference,
  getArticleAiSelections: mocks.selections,
  recordArticleAiFeedback: mocks.feedback,
}));

import { GET as getPreference, PATCH } from "./preferences/route";
import { GET as getSelections } from "./selections/route";
import { POST } from "./feedback/route";
import { ArticleAiConflictError } from "@/lib/article-ai/errors";

function request(path: string, body?: unknown, origin = "https://portal.test") {
  return new NextRequest(`https://portal.test/api/article-ai/${path}`, body === undefined ? {} : {
    method: path === "preferences" ? "PATCH" : "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}
const feedback = { domain: "credit", articleId: 19, action: "confirm", expectedVersion: 3, sharedSelectionId: "11111111-1111-4111-8111-111111111111" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ userId: 7, session: { user: { id: "7" } } });
  mocks.limit.mockResolvedValue(null);
  mocks.getPreference.mockResolvedValue({ domain: "esg", enabled: false });
  mocks.setPreference.mockResolvedValue({ domain: "credit", enabled: true });
  mocks.selections.mockResolvedValue([]);
  mocks.feedback.mockResolvedValue({ pending: false, humanLiked: true });
});

describe("private article AI routes", () => {
  it("requires authentication on every endpoint before accessing data", async () => {
    mocks.auth.mockResolvedValue({ response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const responses = await Promise.all([
      getPreference(request("preferences?domain=esg")),
      getSelections(request("selections?domain=credit&articleIds=19")),
      PATCH(request("preferences", { domain: "esg", enabled: true })),
      POST(request("feedback", feedback)),
    ]);
    expect(responses.map(response => response.status)).toEqual([401, 401, 401, 401]);
    expect(mocks.getPreference).not.toHaveBeenCalled();
    expect(mocks.selections).not.toHaveBeenCalled();
    expect(mocks.setPreference).not.toHaveBeenCalled();
    expect(mocks.feedback).not.toHaveBeenCalled();
  });

  it("uses the session identity, keeps domains separate, and disables caching", async () => {
    const response = await getSelections(request("selections?domain=credit&articleIds=19,20,19&userId=88"));
    expect(response.status).toBe(200);
    expect(mocks.selections).toHaveBeenCalledWith(7, "credit", [19, 20]);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    await getPreference(request("preferences?domain=esg&userId=88"));
    expect(mocks.getPreference).toHaveBeenCalledWith(7, "esg");
  });

  it.each(["other", "ESG", "", "esg%27%3BDROP"]) ("rejects invalid domain %s", async domain => {
    const response = await getPreference(request(`preferences?domain=${domain}`));
    expect(response.status).toBe(400);
    expect(mocks.getPreference).not.toHaveBeenCalled();
  });

  it.each(["-1", "1.5", "1,", "0", "9007199254740992", Array.from({ length: 101 }, (_, i) => i + 1).join(",")])("rejects malformed or unbounded article IDs", async ids => {
    expect((await getSelections(request(`selections?domain=esg&articleIds=${ids}`))).status).toBe(400);
    expect(mocks.selections).not.toHaveBeenCalled();
  });

  it("rejects recipient/user overrides and malformed action/version", async () => {
    expect((await PATCH(request("preferences", { domain: "credit", enabled: true, userId: 88 }))).status).toBe(400);
    expect((await POST(request("feedback", { ...feedback, to: "someone@else.test" }))).status).toBe(400);
    expect((await POST(request("feedback", { ...feedback, sharedSelectionId: undefined }))).status).toBe(400);
    expect((await POST(request("feedback", { ...feedback, expectedVersion: 0 }))).status).toBe(400);
    expect((await POST(request("feedback", { ...feedback, action: "likeAll" }))).status).toBe(400);
    expect(mocks.feedback).not.toHaveBeenCalled();
  });

  it("requires same-origin JSON mutations and handles invalid JSON", async () => {
    expect((await PATCH(request("preferences", { domain: "esg", enabled: true }, "https://evil.test"))).status).toBe(403);
    const nonJson = new NextRequest("https://portal.test/api/article-ai/feedback", { method: "POST", headers: { origin: "https://portal.test" }, body: "{}" });
    expect((await POST(nonJson)).status).toBe(415);
    const invalidJson = new NextRequest("https://portal.test/api/article-ai/preferences", { method: "PATCH", headers: { "content-type": "application/json", origin: "https://portal.test" }, body: "{" });
    expect((await PATCH(invalidJson)).status).toBe(400);
    expect(mocks.setPreference).not.toHaveBeenCalled();
  });

  it("persists the selected domain and honors mutation rate limits", async () => {
    expect((await PATCH(request("preferences", { domain: "credit", enabled: true }))).status).toBe(200);
    expect(mocks.setPreference).toHaveBeenCalledWith(7, "credit", true);
    mocks.limit.mockResolvedValueOnce(NextResponse.json({ error: "Rate limit" }, { status: 429 }));
    expect((await POST(request("feedback", feedback))).status).toBe(429);
    expect(mocks.feedback).not.toHaveBeenCalled();
  });

  it("returns pending Credit acknowledgement and conflict responses", async () => {
    mocks.feedback.mockResolvedValueOnce({ pending: true, humanLiked: false });
    const pending = await POST(request("feedback", feedback));
    expect(pending.status).toBe(202);
    expect(await pending.json()).toEqual({ pending: true, humanLiked: false });
    expect(mocks.feedback).toHaveBeenCalledWith(7, "credit", 19, "confirm", 3, feedback.sharedSelectionId);
    mocks.feedback.mockRejectedValueOnce(new ArticleAiConflictError());
    expect((await POST(request("feedback", feedback))).status).toBe(409);
  });

  it("accepts an optional exact Monday cohort key and rejects non-Monday keys", async () => {
    const withCohort = { ...feedback, targetWeekKey: "2026-11-16" };
    const response = await POST(request("feedback", withCohort));
    expect(response.status).toBe(200);
    expect(mocks.feedback).toHaveBeenCalledWith(7, "credit", 19, "confirm", 3, feedback.sharedSelectionId, "2026-11-16");
    expect((await POST(request("feedback", { ...feedback, targetWeekKey: "2026-11-17" }))).status).toBe(400);
  });

  it("sanitizes dependency failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getPreference.mockRejectedValueOnce(new Error("password=SECRET another-user@example.test"));
    const response = await getPreference(request("preferences?domain=esg"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/SECRET|another-user/);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/SECRET|another-user/);
    log.mockRestore();
  });
});
