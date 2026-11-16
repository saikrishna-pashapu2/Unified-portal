import { NextResponse } from "next/server";
import { ArticleAiError } from "@/lib/article-ai/errors";

export function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}

export function articleAiFailure(error: unknown) {
  if (error instanceof ArticleAiError && error.status !== 503) {
    return privateJson({ error: error.message, code: error.code }, error.status);
  }
  // Never expose database, provider, credential, or another account's details.
  console.error("[article-ai] Request failed", { kind: error instanceof Error ? error.name : "UnknownError" });
  return privateJson({ error: "AI article settings are temporarily unavailable. Please try again.", code: "unavailable" }, 503);
}
