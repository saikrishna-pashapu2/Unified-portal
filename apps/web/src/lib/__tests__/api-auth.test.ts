import { afterEach, describe, expect, it, vi } from "vitest";

type MockSession = {
  role?: string;
  is_admin?: boolean;
  user?: {
    email?: string;
    id?: string;
    role?: string;
    is_admin?: boolean;
    team?: string;
  };
};

async function loadApiAuth({
  cronSecret = "cron-secret",
  dbUser = null,
  session = null,
}: {
  cronSecret?: string;
  dbUser?: { is_admin: boolean } | null;
  session?: MockSession | null;
} = {}) {
  vi.resetModules();
  vi.stubEnv("CRON_SECRET", cronSecret);

  const findUnique = vi.fn().mockResolvedValue(dbUser);
  const getServerSession = vi.fn().mockResolvedValue(session);

  vi.doMock("server-only", () => ({}));
  vi.doMock("next-auth", () => ({ getServerSession }));
  vi.doMock("@/lib/nextauth-options", () => ({ authOptions: {} }));
  vi.doMock("@esgcredit/db-esg", () => ({
    esgPrisma: {
      users: {
        findUnique,
      },
    },
  }));

  const mod = await import("@/lib/api-auth");
  return { ...mod, findUnique, getServerSession };
}

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("api auth guards", () => {
  it("requireSession returns 401 when there is no session", async () => {
    const { requireSession } = await loadApiAuth({ session: null });

    const result = await requireSession();

    expect(result.response?.status).toBe(401);
    await expect(readJson(result.response!)).resolves.toEqual({ error: "Unauthorized" });
  });

  it("requireSession returns the current session when authenticated", async () => {
    const session = { user: { id: "42", email: "user@example.com" } };
    const { requireSession } = await loadApiAuth({ session });

    const result = await requireSession();

    expect(result.session).toBe(session);
  });

  it("requireAdminSession accepts admin role claims without querying the database", async () => {
    const session = { role: "admin", user: { email: "admin@example.com" } };
    const { findUnique, requireAdminSession } = await loadApiAuth({ session });

    const result = await requireAdminSession();

    expect(result.session).toBe(session);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("requireAdminSession accepts users marked admin in the ESG database", async () => {
    const session = { user: { email: "admin@example.com" } };
    const { findUnique, requireAdminSession } = await loadApiAuth({
      dbUser: { is_admin: true },
      session,
    });

    const result = await requireAdminSession();

    expect(result.session).toBe(session);
    expect(findUnique).toHaveBeenCalledWith({
      where: { email: "admin@example.com" },
      select: { is_admin: true },
    });
  });

  it("requireAdminSession returns 403 for non-admin users", async () => {
    const session = { user: { email: "user@example.com" } };
    const { requireAdminSession } = await loadApiAuth({
      dbUser: { is_admin: false },
      session,
    });

    const result = await requireAdminSession();

    expect(result.response?.status).toBe(403);
    await expect(readJson(result.response!)).resolves.toEqual({
      error: "Admin access required",
    });
  });

  it("requireCronSecret accepts the configured bearer token", async () => {
    const { requireCronSecret } = await loadApiAuth({ cronSecret: " cron-secret " });
    const request = new Request("http://localhost/api/cron", {
      headers: { authorization: "Bearer cron-secret" },
    });

    expect(requireCronSecret(request)).toBeNull();
  });

  it("requireCronSecret returns 401 for an invalid bearer token", async () => {
    const { requireCronSecret } = await loadApiAuth({ cronSecret: "cron-secret" });
    const request = new Request("http://localhost/api/cron", {
      headers: { authorization: "Bearer wrong-secret" },
    });

    const response = requireCronSecret(request);

    expect(response?.status).toBe(401);
    await expect(readJson(response!)).resolves.toEqual({ error: "Unauthorized" });
  });

  it("requireCronSecret fails closed when the cron secret is missing", async () => {
    const { requireCronSecret } = await loadApiAuth({ cronSecret: "" });
    const request = new Request("http://localhost/api/cron", {
      headers: { authorization: "Bearer anything" },
    });

    const response = requireCronSecret(request);

    expect(response?.status).toBe(500);
    await expect(readJson(response!)).resolves.toEqual({
      error: "Server misconfiguration",
    });
  });
});
