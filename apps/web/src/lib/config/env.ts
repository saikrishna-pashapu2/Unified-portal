import { z } from "zod";

const optionalString = z.string().optional();

export const envSchema = z
  .object({
    CRON_SECRET: optionalString,
    CUSTOM_AI_KEY: optionalString,
    CUSTOM_AI_URL: optionalString,
    EMAIL_PASS: optionalString,
    EMAIL_USER: optionalString,
    ENABLE_ALERT_SCHEDULER: optionalString,
    ESG_DRIVER_SELECTION_MODE: z.enum(["catalog", "legacy"]).optional(),
    GOOGLE_API_KEY_2: optionalString,
    GOOGLE_CSE_ID_2: optionalString,
    MAIL_FROM: optionalString,
    MAIL_PASSWORD: optionalString,
    MAIL_PORT: optionalString,
    MAIL_SERVER: optionalString,
    MAIL_USERNAME: optionalString,
    NEXT_PHASE: optionalString,
    NEXT_PUBLIC_API_URL: optionalString,
    NEXT_RUNTIME: optionalString,
    NEXTAUTH_URL: optionalString,
    OLLAMA_API_KEY: optionalString,
    OLLAMA_HOST: optionalString,
    OLLAMA_MODEL: optionalString,
    OPENAI_API_KEY: optionalString,
    OPENAI_ESG_DRIVERS_MODEL: optionalString,
    OPENAI_ORG_ID: optionalString,
    PDFX_STORAGE_DIR: optionalString,
    SPGLOBAL_SEARCH_TOKEN: optionalString,
    TAVILY_API_KEY: optionalString,
  })
  .passthrough();

export type RawEnv = z.input<typeof envSchema>;

export interface EnvConfig {
  CRON_SECRET?: string;
  CUSTOM_AI_KEY: string;
  CUSTOM_AI_URL: string;
  EMAIL_PASS?: string;
  EMAIL_USER?: string;
  ENABLE_ALERT_SCHEDULER?: string;
  ESG_DRIVER_SELECTION_MODE: "catalog" | "legacy";
  GOOGLE_API_KEY_2?: string;
  GOOGLE_CSE_ID_2?: string;
  MAIL_FROM?: string;
  MAIL_PASSWORD?: string;
  MAIL_PORT: string;
  MAIL_SERVER: string;
  MAIL_USERNAME?: string;
  NEXT_PHASE?: string;
  NEXT_PUBLIC_API_URL: string;
  NEXT_RUNTIME?: string;
  NEXTAUTH_URL: string;
  OLLAMA_API_KEY?: string;
  OLLAMA_HOST: string;
  OLLAMA_MODEL: string;
  OPENAI_API_KEY?: string;
  OPENAI_ESG_DRIVERS_MODEL: string;
  OPENAI_ORG_ID?: string;
  PDFX_STORAGE_DIR: string;
  SPGLOBAL_SEARCH_TOKEN?: string;
  TAVILY_API_KEY?: string;
}

function formatEnvError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

export function loadEnv(rawEnv: RawEnv): Readonly<EnvConfig> {
  const parsed = envSchema.safeParse(rawEnv);

  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${formatEnvError(parsed.error)}`);
  }

  const raw = parsed.data;
  const config: EnvConfig = {
    CRON_SECRET: raw.CRON_SECRET,
    CUSTOM_AI_KEY: raw.CUSTOM_AI_KEY ?? "",
    CUSTOM_AI_URL: raw.CUSTOM_AI_URL ?? "",
    EMAIL_PASS: raw.EMAIL_PASS,
    EMAIL_USER: raw.EMAIL_USER,
    ENABLE_ALERT_SCHEDULER: raw.ENABLE_ALERT_SCHEDULER,
    ESG_DRIVER_SELECTION_MODE: raw.ESG_DRIVER_SELECTION_MODE || "catalog",
    GOOGLE_API_KEY_2: raw.GOOGLE_API_KEY_2,
    GOOGLE_CSE_ID_2: raw.GOOGLE_CSE_ID_2,
    MAIL_FROM: raw.MAIL_FROM || raw.MAIL_USERNAME,
    MAIL_PASSWORD: raw.MAIL_PASSWORD,
    MAIL_PORT: raw.MAIL_PORT || "587",
    MAIL_SERVER: raw.MAIL_SERVER || "smtp.gmail.com",
    MAIL_USERNAME: raw.MAIL_USERNAME,
    NEXT_PHASE: raw.NEXT_PHASE,
    NEXT_PUBLIC_API_URL: raw.NEXT_PUBLIC_API_URL || "http://localhost:3000",
    NEXT_RUNTIME: raw.NEXT_RUNTIME,
    NEXTAUTH_URL: raw.NEXTAUTH_URL || "http://localhost:3000",
    OLLAMA_API_KEY: raw.OLLAMA_API_KEY,
    OLLAMA_HOST: (raw.OLLAMA_HOST ?? "").trim() || "https://ollama.com",
    OLLAMA_MODEL: (raw.OLLAMA_MODEL ?? "").trim() || "minimax-m2.5:cloud",
    OPENAI_API_KEY: raw.OPENAI_API_KEY,
    OPENAI_ESG_DRIVERS_MODEL: raw.OPENAI_ESG_DRIVERS_MODEL || "gpt-5.4-mini",
    OPENAI_ORG_ID: raw.OPENAI_ORG_ID || undefined,
    PDFX_STORAGE_DIR: raw.PDFX_STORAGE_DIR || ".pdfx_store",
    SPGLOBAL_SEARCH_TOKEN: raw.SPGLOBAL_SEARCH_TOKEN,
    TAVILY_API_KEY: raw.TAVILY_API_KEY,
  };

  return Object.freeze(config);
}

export const env = loadEnv(process.env);
