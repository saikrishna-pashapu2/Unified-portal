import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadRateLimit() {
  vi.resetModules();
  return import("@/lib/rate-limit");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.resetModules();
});

describe("login rate limit", () => {
  it("allows the first login check and normalizes the email key", async () => {
    const { checkLoginRateLimit, getAttemptCount } = await loadRateLimit();

    expect(checkLoginRateLimit(" User@Example.com ")).toEqual({
      allowed: true,
      remainingAttempts: 4,
    });
    expect(getAttemptCount("user@example.com")).toBe(1);
  });

  it("locks an email after the fifth recorded failed attempt", async () => {
    const { checkLoginRateLimit, recordFailedAttempt } = await loadRateLimit();

    for (let index = 0; index < 4; index += 1) {
      expect(recordFailedAttempt("user@example.com").isLocked).toBe(false);
    }

    expect(recordFailedAttempt("user@example.com")).toEqual({
      remainingAttempts: 0,
      isLocked: true,
    });
    expect(checkLoginRateLimit("user@example.com")).toEqual({
      allowed: false,
      resetTime: new Date("2026-01-01T00:15:00.000Z"),
    });
  });

  it("resets the login window after the lockout duration expires", async () => {
    const { checkLoginRateLimit, recordFailedAttempt } = await loadRateLimit();

    for (let index = 0; index < 5; index += 1) {
      recordFailedAttempt("user@example.com");
    }

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);

    expect(checkLoginRateLimit("user@example.com")).toEqual({
      allowed: true,
      remainingAttempts: 4,
    });
  });

  it("currently increments during both pre-check and failed-attempt recording", async () => {
    const { checkLoginRateLimit, recordFailedAttempt } = await loadRateLimit();

    expect(checkLoginRateLimit("user@example.com").remainingAttempts).toBe(4);
    // TODO: This captures current behavior: auth calls both functions, so one bad
    // password consumes two attempts. Do not change in this safety-net milestone.
    expect(recordFailedAttempt("user@example.com")).toEqual({
      remainingAttempts: 3,
      isLocked: false,
    });
  });
});

describe("api rate limit", () => {
  it("allows requests until the window limit is reached", async () => {
    const { checkApiRateLimit } = await loadRateLimit();

    expect(checkApiRateLimit("ip:1", 2, 1000)).toEqual({
      allowed: true,
      remaining: 1,
      resetTime: Date.parse("2026-01-01T00:00:01.000Z"),
    });
    expect(checkApiRateLimit("ip:1", 2, 1000)).toEqual({
      allowed: true,
      remaining: 0,
      resetTime: Date.parse("2026-01-01T00:00:01.000Z"),
    });
    expect(checkApiRateLimit("ip:1", 2, 1000)).toEqual({
      allowed: false,
      remaining: 0,
      resetTime: Date.parse("2026-01-01T00:00:01.000Z"),
    });
  });

  it("starts a fresh API window after expiry", async () => {
    const { checkApiRateLimit } = await loadRateLimit();

    checkApiRateLimit("ip:1", 1, 1000);
    expect(checkApiRateLimit("ip:1", 1, 1000).allowed).toBe(false);

    vi.advanceTimersByTime(1001);

    expect(checkApiRateLimit("ip:1", 1, 1000)).toEqual({
      allowed: true,
      remaining: 0,
      resetTime: Date.parse("2026-01-01T00:00:02.001Z"),
    });
  });
});
