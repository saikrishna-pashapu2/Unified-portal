import { NextRequest } from "next/server";
import { requireSession, unauthorized } from "@/lib/api-auth";
import { createDeepAgentRuntime, streamDeepAgent } from "@/lib/deep-agent";
import type { DeepAgentChatRequest, DeepAgentStreamEvent } from "@/lib/deep-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toSseChunk(event: DeepAgentStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession();
    if (auth.response) return auth.response;

    const userId = (auth.session.user as any).id;
    if (!userId) {
      return unauthorized();
    }

    const body = (await request.json()) as DeepAgentChatRequest;
    const message = body.message?.trim();

    if (!message) {
      return new Response(
        JSON.stringify({ error: "Missing message" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const runtime = await createDeepAgentRuntime({
      threadId: body.threadId,
      userId: String(userId),
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const emit = async (event: DeepAgentStreamEvent) => {
          controller.enqueue(encoder.encode(toSseChunk(event)));
        };

        try {
          await emit({
            type: "status",
            threadId: runtime.context.threadId,
            timestamp: new Date().toISOString(),
            content: "Deep agent session started.",
            metadata: {
              workspace: runtime.context.workspaceRelative,
              model: runtime.model,
            },
          });

          await streamDeepAgent({
            agent: runtime.agent,
            threadId: runtime.context.threadId,
            message,
            signal: request.signal,
            onEvent: emit,
          });
        } catch (error: any) {
          console.error("Deep agent stream error:", error);
          await emit({
            type: "error",
            threadId: runtime.context.threadId,
            timestamp: new Date().toISOString(),
            content:
              error?.name === "AbortError"
                ? "Stream aborted by client."
                : "Deep agent failed while streaming.",
            metadata: {
              name: error?.name || "Error",
            },
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Deep agent chat failed:", error);
    return new Response(
      JSON.stringify({ error: "Failed to start deep agent chat" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
