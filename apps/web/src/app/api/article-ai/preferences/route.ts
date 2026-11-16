import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUserSession } from "@/lib/api-auth";
import { requireSameOriginJson } from "@/lib/admin-mutation";
import { enforceApiUsage } from "@/lib/api-usage";
import { getArticleAiPreference, setArticleAiPreference } from "@/lib/article-ai/service";
import { isArticleAiDomain } from "@/lib/article-ai/types";
import { articleAiFailure, privateJson } from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const preferenceSchema = z.object({ domain: z.enum(["esg", "credit"]), enabled: z.boolean() }).strict();

export async function GET(request: NextRequest) {
  const auth = await requireUserSession();
  if (auth.response) return auth.response;
  const domain = request.nextUrl.searchParams.get("domain");
  if (!isArticleAiDomain(domain)) return privateJson({ error: "Choose ESG or Credit." }, 400);
  try {
    return privateJson(await getArticleAiPreference(auth.userId, domain));
  } catch (error) {
    return articleAiFailure(error);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUserSession();
  if (auth.response) return auth.response;
  const requestError = requireSameOriginJson(request);
  if (requestError) return requestError;
  const parsed = preferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return privateJson({ error: "Provide a domain and an on/off setting." }, 400);
  try {
    const limited = await enforceApiUsage(request, { userId: auth.userId, feature: "article_ai_preference", perMinute: 30 });
    if (limited) return limited;
    return privateJson(await setArticleAiPreference(auth.userId, parsed.data.domain, parsed.data.enabled));
  } catch (error) {
    return articleAiFailure(error);
  }
}
