import { NextRequest } from "next/server";
import { requireUserSession } from "@/lib/api-auth";
import { getArticleAiSelections } from "@/lib/article-ai/service";
import { isArticleAiDomain } from "@/lib/article-ai/types";
import { articleAiFailure, privateJson } from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireUserSession();
  if (auth.response) return auth.response;
  const domain = request.nextUrl.searchParams.get("domain");
  if (!isArticleAiDomain(domain)) return privateJson({ error: "Choose ESG or Credit." }, 400);
  const rawIds = request.nextUrl.searchParams.get("articleIds") ?? "";
  const parts = rawIds ? rawIds.split(",") : [];
  if (parts.length > 100 || parts.some(value => !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
    return privateJson({ error: "Provide up to 100 valid article IDs." }, 400);
  }
  try {
    return privateJson({ selections: await getArticleAiSelections(auth.userId, domain, Array.from(new Set(parts.map(Number)))) });
  } catch (error) {
    return articleAiFailure(error);
  }
}
