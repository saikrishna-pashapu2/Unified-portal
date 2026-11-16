import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUserSession } from "@/lib/api-auth";
import { requireSameOriginJson } from "@/lib/admin-mutation";
import { enforceApiUsage } from "@/lib/api-usage";
import { recordArticleAiFeedback } from "@/lib/article-ai/service";
import { articleAiFailure, privateJson } from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const feedbackSchema = z.object({
  domain: z.enum(["esg", "credit"]),
  articleId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  action: z.enum(["confirm", "dismiss"]),
  expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sharedSelectionId: z.string().uuid(),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await requireUserSession();
  if (auth.response) return auth.response;
  const requestError = requireSameOriginJson(request);
  if (requestError) return requestError;
  const parsed = feedbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return privateJson({ error: "Provide a valid shared article selection, action, and version." }, 400);
  try {
    const limited = await enforceApiUsage(request, { userId: auth.userId, feature: "article_ai_feedback", perMinute: 60 });
    if (limited) return limited;
    const { domain, articleId, action, expectedVersion, sharedSelectionId } = parsed.data;
    const result = await recordArticleAiFeedback(auth.userId, domain, articleId, action, expectedVersion, sharedSelectionId);
    return privateJson(result, result.pending ? 202 : 200);
  } catch (error) {
    return articleAiFailure(error);
  }
}
