import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUserAuthStateById: vi.fn(),
  getServerSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/nextauth-options", () => ({ authOptions: {} }));
vi.mock("@/lib/auth-db", () => ({
  findUserAuthStateById: mocks.findUserAuthStateById,
}));

import { ensureUserId } from "@/lib/session-user";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerSession.mockResolvedValue({ user: { id: "42" } });
});

describe("stale session user resolution", () => {
  it("returns the existing active user ID", async () => {
    mocks.findUserAuthStateById.mockResolvedValue({ id: 42, is_active_db: true });

    await expect(ensureUserId()).resolves.toBe(42);
  });

  it("returns null instead of recreating a deleted user", async () => {
    mocks.findUserAuthStateById.mockResolvedValue(null);

    await expect(ensureUserId()).resolves.toBeNull();
  });

  it("returns null for an inactive user", async () => {
    mocks.findUserAuthStateById.mockResolvedValue({ id: 42, is_active_db: false });

    await expect(ensureUserId()).resolves.toBeNull();
  });
});
