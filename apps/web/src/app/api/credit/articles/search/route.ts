import { NextResponse } from "next/server";

import { requireUserSession } from "@/lib/api-auth";
import { getDailyArticlePickIds } from "@/lib/article-ai/daily-feed";
import { parseCreditArticleSearchParams } from "@/lib/credit-article-search/query";
import { consumeCreditArticleSearchRate } from "@/lib/credit-article-search/rate-limit";
import { searchCreditArticles } from "@/lib/credit-article-search/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  try { params = new URL(request.url).searchParams; }
  catch { return jsonResponse({ error: "Invalid request URL" }, 400); }
  const parsed = parseCreditArticleSearchParams(params);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);
  const retryAfter = consumeCreditArticleSearchRate(auth.userId);
  if (retryAfter !== null) {
    return jsonResponse({ error: "Credit article search rate limit exceeded" }, 429, { "Retry-After": String(retryAfter) });
  }
  try {
    const suggest = params.get("suggest") === "1" || params.get("suggest") === "true";
    const articleIds = params.get("ai") === "1" || params.get("ai") === "true"
      ? await getDailyArticlePickIds("credit", auth.userId)
      : undefined;
    const result = articleIds
      ? await searchCreditArticles(parsed.filters, { suggest, articleIds })
      : await searchCreditArticles(parsed.filters, { suggest });
    return jsonResponse(result);
  } catch {
    return jsonResponse({ error: "Credit article search is temporarily unavailable" }, 503);
  }
}
