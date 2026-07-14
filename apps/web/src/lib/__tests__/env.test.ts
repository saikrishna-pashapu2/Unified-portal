import { describe, expect, it } from "vitest";
import { loadEnv } from "@/lib/config/env";

describe("env config", () => {
  it("applies the same defaults as the previous call sites", () => {
    expect(loadEnv({})).toMatchObject({
      CUSTOM_AI_KEY: "",
      CUSTOM_AI_URL: "",
      ESG_DRIVER_SELECTION_MODE: "catalog",
      MAIL_PORT: "587",
      MAIL_SERVER: "smtp.gmail.com",
      NEXT_PUBLIC_API_URL: "http://localhost:3000",
      NEXTAUTH_URL: "http://localhost:3000",
      OLLAMA_HOST: "https://ollama.com",
      OLLAMA_MODEL: "minimax-m2.5:cloud",
      OPENAI_ESG_DRIVERS_MODEL: "gpt-5.4-mini",
      PDFX_STORAGE_DIR: ".pdfx_store",
    });
  });

  it("allows an explicit legacy ESG driver selector rollback", () => {
    expect(
      loadEnv({ ESG_DRIVER_SELECTION_MODE: "legacy" })
        .ESG_DRIVER_SELECTION_MODE,
    ).toBe("legacy");
    expect(() =>
      loadEnv({ ESG_DRIVER_SELECTION_MODE: "unknown" as "catalog" }),
    ).toThrow(/Invalid environment configuration/);
  });

  it("keeps MAIL_FROM fallback tied to MAIL_USERNAME", () => {
    expect(loadEnv({ MAIL_USERNAME: "alerts@example.com" }).MAIL_FROM).toBe(
      "alerts@example.com",
    );
    expect(
      loadEnv({
        MAIL_FROM: "sender@example.com",
        MAIL_USERNAME: "alerts@example.com",
      }).MAIL_FROM,
    ).toBe("sender@example.com");
  });

  it("trims OLLAMA host/model before applying defaults", () => {
    expect(loadEnv({ OLLAMA_HOST: "   ", OLLAMA_MODEL: " custom-model " })).toMatchObject({
      OLLAMA_HOST: "https://ollama.com",
      OLLAMA_MODEL: "custom-model",
    });
  });

  it("fails validation for non-string env values", () => {
    expect(() => loadEnv({ OPENAI_API_KEY: 123 as unknown as string })).toThrow(
      /Invalid environment configuration/,
    );
  });
});
