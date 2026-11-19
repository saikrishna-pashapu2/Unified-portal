import { NextResponse } from "next/server";

import { requireUserSession } from "@/lib/api-auth";
import { getDailyArticlePickIds } from "@/lib/article-ai/daily-feed";
import { parseArticleSearchParams } from "@/lib/esg-article-search/query";
import { consumeEsgArticleSearchRate } from "@/lib/esg-article-search/rate-limit";
import { searchEsgArticles } from "@/lib/esg-article-search/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isEnabledFlag(value: string | null): boolean {
  return value === "1" || value === "true";
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): NextResponse {
  const response = NextResponse.json(body, { status, headers });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireUserSession();
  if (auth.response) return auth.response;

  let params: URLSearchParams;
  try {
    params = new URL(request.url).searchParams;
  } catch {
    return jsonResponse({ error: "Invalid request URL" }, 400);
  }

  const parsed = parseArticleSearchParams(params);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

  const suggest = isEnabledFlag(params.get("suggest"));
  const retryAfter = consumeEsgArticleSearchRate(auth.userId);
  if (retryAfter !== null) {
    return jsonResponse(
      { error: "Article search rate limit exceeded" },
      429,
      { "Retry-After": String(retryAfter) },
    );
  }

  try {
    const articleIds = isEnabledFlag(params.get("ai"))
      ? await getDailyArticlePickIds("esg", auth.userId)
      : undefined;
    const result = articleIds
      ? await searchEsgArticles(parsed.filters, { suggest, articleIds })
      : await searchEsgArticles(parsed.filters, { suggest });
    return jsonResponse(result);
  } catch {
    // Keep database errors out of the response: raw SQL errors can include
    // schema details and connection metadata. The caller can retry safely.
    return jsonResponse({ error: "Article search is temporarily unavailable" }, 503);
  }
}
