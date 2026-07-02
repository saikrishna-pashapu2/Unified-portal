import { NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/api-auth";
import {
  getDeepAgentRuntimeConfig,
  getDeepAgentSessionContext,
} from "@/lib/deep-agent";
import type {
  DeepAgentInitRequest,
  DeepAgentInitResponse,
} from "@/lib/deep-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.response) return auth.response;

    const userId = (auth.session.user as any).id;
    if (!userId) {
      return unauthorized();
    }

    const body = (await request.json().catch(() => ({}))) as DeepAgentInitRequest;

    const runtimeConfig = getDeepAgentRuntimeConfig();
    const context = await getDeepAgentSessionContext({
      threadId: body.threadId,
      userId: String(userId),
    });

    const response: DeepAgentInitResponse = {
      success: true,
      threadId: context.threadId,
      workspace: context.workspaceRelative,
      model: {
        host: runtimeConfig.ollamaHost,
        name: runtimeConfig.ollamaModel,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Deep agent init failed:", error);
    return NextResponse.json(
      { error: "Failed to initialize deep agent session" },
      { status: 500 },
    );
  }
}
