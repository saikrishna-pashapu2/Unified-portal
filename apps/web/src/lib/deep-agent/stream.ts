import "server-only";
import type { DeepAgentStreamEvent } from "@/lib/deep-agent/types";

interface StreamAgentParams {
  agent: any;
  threadId: string;
  message: string;
  signal?: AbortSignal;
  onEvent: (event: DeepAgentStreamEvent) => Promise<void> | void;
}

interface StreamAgentResult {
  answer: string;
  reasoning: string;
}

interface NormalizedChunk {
  path: string[];
  mode: string;
  payload: unknown;
}

function nowIso(): string {
  return new Date().toISOString();
}

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (
          part &&
          typeof part === "object" &&
          "text" in part &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .join("");
  }

  return "";
}

function normalizeChunk(chunk: unknown): NormalizedChunk | null {
  if (!Array.isArray(chunk)) {
    return null;
  }

  if (
    chunk.length === 3 &&
    Array.isArray(chunk[0]) &&
    typeof chunk[1] === "string"
  ) {
    return {
      path: chunk[0].map(String),
      mode: chunk[1],
      payload: chunk[2],
    };
  }

  if (chunk.length === 2 && typeof chunk[0] === "string") {
    return {
      path: [],
      mode: chunk[0],
      payload: chunk[1],
    };
  }

  return null;
}

export async function streamDeepAgent(params: StreamAgentParams): Promise<StreamAgentResult> {
  let answer = "";
  let reasoning = "";
  let thoughtTransitionEmitted = false;

  const stream = await params.agent.stream(
    { messages: [{ role: "user", content: params.message }] },
    {
      streamMode: ["messages", "updates", "tasks", "debug"],
      subgraphs: true,
      debug: true,
      configurable: {
        thread_id: params.threadId,
      },
      signal: params.signal,
    },
  );

  for await (const rawChunk of stream) {
    const chunk = normalizeChunk(rawChunk);
    if (!chunk) {
      continue;
    }

    if (chunk.mode === "messages") {
      if (!Array.isArray(chunk.payload) || chunk.payload.length < 2) {
        continue;
      }

      const message = chunk.payload[0] as any;
      const metadata =
        (chunk.payload[1] as Record<string, unknown> | undefined) || {};
      const messageType =
        typeof message?._getType === "function"
          ? message._getType()
          : typeof message?.type === "string"
            ? message.type
            : "unknown";

      const reasoningDelta =
        typeof message?.additional_kwargs?.reasoning_content === "string"
          ? message.additional_kwargs.reasoning_content
          : "";
      if (reasoningDelta) {
        reasoning += reasoningDelta;
        await params.onEvent({
          type: "thinking_delta",
          threadId: params.threadId,
          timestamp: nowIso(),
          reasoning: reasoningDelta,
          nodePath: chunk.path,
          node:
            (metadata.langgraph_node as string | undefined) ??
            (metadata.node as string | undefined),
          metadata,
        });
      }

      const contentDelta = extractText(message?.content);
      if (contentDelta) {
        if (!thoughtTransitionEmitted && reasoning.length > 0) {
          thoughtTransitionEmitted = true;
          await params.onEvent({
            type: "thought_transition",
            threadId: params.threadId,
            timestamp: nowIso(),
            content: "Thought complete. Generating final answer.",
            nodePath: chunk.path,
            node:
              (metadata.langgraph_node as string | undefined) ??
              (metadata.node as string | undefined),
            metadata,
          });
        }

        answer += contentDelta;
        await params.onEvent({
          type: "answer_delta",
          threadId: params.threadId,
          timestamp: nowIso(),
          content: contentDelta,
          nodePath: chunk.path,
          node:
            (metadata.langgraph_node as string | undefined) ??
            (metadata.node as string | undefined),
          metadata,
        });
      }

      const toolCalls = Array.isArray(message?.tool_calls)
        ? message.tool_calls
        : [];
      for (const toolCall of toolCalls) {
        await params.onEvent({
          type: "tool_call",
          threadId: params.threadId,
          timestamp: nowIso(),
          toolName: toolCall?.name,
          toolCallId: toolCall?.id,
          toolArgs: toolCall?.args,
          nodePath: chunk.path,
          node:
            (metadata.langgraph_node as string | undefined) ??
            (metadata.node as string | undefined),
          metadata,
        });
      }

      if (messageType === "tool") {
        await params.onEvent({
          type: "tool_result",
          threadId: params.threadId,
          timestamp: nowIso(),
          content: extractText(message?.content),
          nodePath: chunk.path,
          node:
            (metadata.langgraph_node as string | undefined) ??
            (metadata.node as string | undefined),
          metadata,
        });
      }

      continue;
    }

    if (chunk.mode === "tasks") {
      const task = (chunk.payload || {}) as Record<string, unknown>;
      const base = {
        threadId: params.threadId,
        timestamp: nowIso(),
        nodePath: chunk.path,
        taskId: typeof task.id === "string" ? task.id : undefined,
        taskName: typeof task.name === "string" ? task.name : undefined,
        metadata: {
          hasInput: "input" in task,
          hasResult: "result" in task,
          interrupts: Array.isArray(task.interrupts) ? task.interrupts.length : 0,
        },
      };

      if ("input" in task) {
        await params.onEvent({
          ...base,
          type: "subagent_start",
          content: `Subagent task started: ${base.taskName || "task"}`,
        });
      } else if ("result" in task) {
        await params.onEvent({
          ...base,
          type: "subagent_end",
          content: `Subagent task completed: ${base.taskName || "task"}`,
        });
      }

      continue;
    }

    if (chunk.mode === "updates") {
      if (!chunk.payload || typeof chunk.payload !== "object") {
        continue;
      }

      const updates = chunk.payload as Record<string, unknown>;
      for (const [node, update] of Object.entries(updates)) {
        const updateObj = update as Record<string, unknown> | undefined;
        const keys =
          updateObj && typeof updateObj === "object"
            ? Object.keys(updateObj)
            : [];

        if (updateObj && Array.isArray(updateObj.todos)) {
          await params.onEvent({
            type: "todo_update",
            threadId: params.threadId,
            timestamp: nowIso(),
            nodePath: chunk.path,
            node,
            metadata: {
              todos: updateObj.todos,
            },
          });
        }

        await params.onEvent({
          type: "state_update",
          threadId: params.threadId,
          timestamp: nowIso(),
          nodePath: chunk.path,
          node,
          metadata: {
            keys,
          },
        });
      }

      continue;
    }

    if (chunk.mode === "debug") {
      const debugPayload = chunk.payload as Record<string, unknown> | undefined;

      await params.onEvent({
        type: "debug",
        threadId: params.threadId,
        timestamp: nowIso(),
        nodePath: chunk.path,
        node:
          (debugPayload?.node as string | undefined) ??
          (debugPayload?.name as string | undefined),
        metadata: {
          event:
            (debugPayload?.event as string | undefined) ??
            (debugPayload?.type as string | undefined) ??
            "debug",
          name:
            (debugPayload?.name as string | undefined) ??
            (debugPayload?.node as string | undefined),
        },
      });
    }
  }

  await params.onEvent({
    type: "done",
    threadId: params.threadId,
    timestamp: nowIso(),
    done: true,
    content: answer,
    reasoning,
  });

  return {
    answer,
    reasoning,
  };
}
