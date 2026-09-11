import { afterEach, describe, expect, it, vi } from "vitest";
import { isTranslatorRequestOriginAllowed } from "@/lib/document-translator/request-origin";

afterEach(() => vi.unstubAllEnvs());
const publicOrigin = "https://unifiedportal.duckdns.org";
const request = (origin: string, extra: Record<string, string> = {}) =>
  new Request("https://localhost:3000/api/xlsx-translator/job", {
    headers: { origin, ...extra },
  });

describe("Translator origin checks behind Nginx", () => {
  it("accepts the public portal origin despite Next's internal request URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", publicOrigin);
    expect(isTranslatorRequestOriginAllowed(request(publicOrigin))).toBe(true);
  });
  it.each([
    "https://attacker.example",
    "https://unifiedportal.duckdns.org.attacker.example",
    "https://localhost:3000",
    "null",
    publicOrigin + "/path",
  ])("rejects untrusted origins and spoofed forwarded hosts: %s", (origin) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", publicOrigin);
    expect(isTranslatorRequestOriginAllowed(request(origin, {
      host: "attacker.example",
      "x-forwarded-host": "attacker.example",
    }))).toBe(false);
  });
  it.each(["", "invalid", "file:///tmp/config", "https://user:password@example.test"])(
    "fails closed on invalid production public-origin configuration", (value) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("NEXTAUTH_URL", value);
      expect(isTranslatorRequestOriginAllowed(request(publicOrigin))).toBe(false);
    },
  );
  it("uses the actual request origin locally, even with a production env file", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXTAUTH_URL", publicOrigin);
    expect(isTranslatorRequestOriginAllowed(request("https://localhost:3000"))).toBe(true);
    expect(isTranslatorRequestOriginAllowed(request(publicOrigin))).toBe(false);
  });
  it("retains support for authenticated clients without an Origin header", () => {
    expect(isTranslatorRequestOriginAllowed(new Request("http://localhost/api"))).toBe(true);
  });
});
