"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DeepAgentInitResponse,
  DeepAgentStreamEvent,
} from "@/lib/deep-agent/types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentToolUsage {
  id?: string;
  name: string;
  args?: unknown;
  result?: string;
  timestamp: string;
}

export interface AgentSubagentUsage {
  id: string;
  name: string;
  status: "running" | "completed";
  startedAt: string;
  finishedAt?: string;
  reasoning: string;
  thoughts: string[];
  tools: AgentToolUsage[];
}

export interface ChatTurn {
  id: string;
  userMessage: string;
  assistantMessage: string;
  status: "streaming" | "completed" | "error";
  error?: string;
  reasoning: string;
  thoughts: string[];
  tools: AgentToolUsage[];
  subagents: AgentSubagentUsage[];
  startedAt: string;
  finishedAt?: string;
}

function makeTurnId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function upsertToolUsage(
  tools: AgentToolUsage[],
  incoming: {
    id?: string;
    name?: string;
    args?: unknown;
    result?: string;
    timestamp: string;
  },
): AgentToolUsage[] {
  const incomingName = incoming.name || "tool";
  const index = incoming.id
    ? tools.findIndex((tool) => tool.id && tool.id === incoming.id)
    : tools.findIndex((tool) => tool.name === incomingName && !tool.result);

  if (index === -1) {
    return [
      ...tools,
      {
        id: incoming.id,
        name: incomingName,
        args: incoming.args,
        result: incoming.result,
        timestamp: incoming.timestamp,
      },
    ];
  }

  const updated = [...tools];
  const current = updated[index];
  updated[index] = {
    ...current,
    id: current.id || incoming.id,
    name: current.name || incomingName,
    args: current.args ?? incoming.args,
    result: incoming.result ?? current.result,
    timestamp: incoming.timestamp || current.timestamp,
  };
  return updated;
}

export function useDeepAgent() {
  const [threadId, setThreadId] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [events, setEvents] = useState<DeepAgentStreamEvent[]>([]);
  const [thinking, setThinking] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const initialize = useCallback(async (): Promise<string | null> => {
    setIsInitializing(true);
    setError(null);
    try {
      const response = await fetch("/api/assistant/deep-agent/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId }),
      });

      if (!response.ok) {
        throw new Error("Failed to initialize deep agent");
      }

      const data = (await response.json()) as DeepAgentInitResponse;
      setThreadId(data.threadId);
      setWorkspace(data.workspace);
      return data.threadId;
    } catch (err: any) {
      setError(err?.message || "Failed to initialize deep agent");
      return null;
    } finally {
      setIsInitializing(false);
    }
  }, [threadId]);

  useEffect(() => {
    if (!threadId) {
      void initialize();
    }
  }, [threadId, initialize]);

  const sendMessage = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed) {
        return;
      }

      const activeThreadId = threadId || (await initialize());
      if (!activeThreadId) {
        setError("Deep agent thread is not available yet.");
        return;
      }

      setError(null);
      setThinking("");
      setIsLoading(true);

      const turnId = makeTurnId();
      const turnStartedAt = new Date().toISOString();
      setTurns((prev) => [
        ...prev,
        {
          id: turnId,
          userMessage: trimmed,
          assistantMessage: "",
          status: "streaming",
          reasoning: "",
          thoughts: [],
          tools: [],
          subagents: [],
          startedAt: turnStartedAt,
        },
      ]);

      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch("/api/assistant/deep-agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: activeThreadId,
            message: trimmed,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error("Failed to start deep agent stream");
        }

        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        let buffer = "";
        let assistantResponse = "";
        const activeSubagentStack: string[] = [];

        const updateTurn = (updater: (turn: ChatTurn) => ChatTurn) => {
          setTurns((prev) =>
            prev.map((turn) => (turn.id === turnId ? updater(turn) : turn)),
          );
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() || "";

          for (const frame of frames) {
            const line = frame
              .split("\n")
              .find((entry) => entry.startsWith("data: "));
            if (!line) {
              continue;
            }

            const raw = line.slice(6).trim();
            if (!raw) {
              continue;
            }

            let event: DeepAgentStreamEvent;
            try {
              event = JSON.parse(raw) as DeepAgentStreamEvent;
            } catch {
              continue;
            }

            setEvents((prev) => [...prev, event]);

            if (event.type === "thinking_delta" && event.reasoning) {
              setThinking((prev) => prev + event.reasoning);
              const activeSubagentId =
                activeSubagentStack.length > 0
                  ? activeSubagentStack[activeSubagentStack.length - 1]
                  : null;

              updateTurn((turn) => {
                if (!activeSubagentId) {
                  return {
                    ...turn,
                    reasoning: turn.reasoning + event.reasoning!,
                  };
                }

                return {
                  ...turn,
                  subagents: turn.subagents.map((subagent) =>
                    subagent.id === activeSubagentId
                      ? {
                          ...subagent,
                          reasoning: subagent.reasoning + event.reasoning!,
                        }
                      : subagent,
                  ),
                };
              });
            }

            if (event.type === "answer_delta" && event.content) {
              assistantResponse += event.content;
              setMessages((prev) => {
                if (prev.length === 0) return prev;
                const next = [...prev];
                next[next.length - 1] = {
                  role: "assistant",
                  content: assistantResponse,
                };
                return next;
              });

              updateTurn((turn) => ({
                ...turn,
                assistantMessage: turn.assistantMessage + event.content!,
              }));
            }

            if (event.type === "error") {
              setError(event.content || "Deep agent stream error");
              updateTurn((turn) => ({
                ...turn,
                status: "error",
                error: event.content || "Deep agent stream error",
                finishedAt: new Date().toISOString(),
              }));
            }

            if (event.type === "thought_transition" && event.content) {
              const activeSubagentId =
                activeSubagentStack.length > 0
                  ? activeSubagentStack[activeSubagentStack.length - 1]
                  : null;

              updateTurn((turn) => {
                if (!activeSubagentId) {
                  return {
                    ...turn,
                    thoughts: [...turn.thoughts, event.content!],
                  };
                }

                return {
                  ...turn,
                  subagents: turn.subagents.map((subagent) =>
                    subagent.id === activeSubagentId
                      ? {
                          ...subagent,
                          thoughts: [...subagent.thoughts, event.content!],
                        }
                      : subagent,
                  ),
                };
              });
            }

            if (event.type === "tool_call") {
              const activeSubagentId =
                activeSubagentStack.length > 0
                  ? activeSubagentStack[activeSubagentStack.length - 1]
                  : null;

              updateTurn((turn) => {
                if (!activeSubagentId) {
                  return {
                    ...turn,
                    tools: upsertToolUsage(turn.tools, {
                      id: event.toolCallId,
                      name: event.toolName,
                      args: event.toolArgs,
                      timestamp: event.timestamp,
                    }),
                  };
                }

                return {
                  ...turn,
                  subagents: turn.subagents.map((subagent) =>
                    subagent.id === activeSubagentId
                      ? {
                          ...subagent,
                          tools: upsertToolUsage(subagent.tools, {
                            id: event.toolCallId,
                            name: event.toolName,
                            args: event.toolArgs,
                            timestamp: event.timestamp,
                          }),
                        }
                      : subagent,
                  ),
                };
              });
            }

            if (event.type === "tool_result") {
              const activeSubagentId =
                activeSubagentStack.length > 0
                  ? activeSubagentStack[activeSubagentStack.length - 1]
                  : null;

              updateTurn((turn) => {
                if (!activeSubagentId) {
                  return {
                    ...turn,
                    tools: upsertToolUsage(turn.tools, {
                      id: event.toolCallId,
                      name: event.toolName,
                      result: event.content || "",
                      timestamp: event.timestamp,
                    }),
                  };
                }

                return {
                  ...turn,
                  subagents: turn.subagents.map((subagent) =>
                    subagent.id === activeSubagentId
                      ? {
                          ...subagent,
                          tools: upsertToolUsage(subagent.tools, {
                            id: event.toolCallId,
                            name: event.toolName,
                            result: event.content || "",
                            timestamp: event.timestamp,
                          }),
                        }
                      : subagent,
                  ),
                };
              });
            }

            if (event.type === "subagent_start") {
              const subagentId = event.taskId || `subagent-${event.timestamp}`;
              activeSubagentStack.push(subagentId);

              updateTurn((turn) => {
                const exists = turn.subagents.some(
                  (subagent) => subagent.id === subagentId,
                );
                if (exists) {
                  return {
                    ...turn,
                    subagents: turn.subagents.map((subagent) =>
                      subagent.id === subagentId
                        ? {
                            ...subagent,
                            status: "running",
                          }
                        : subagent,
                    ),
                  };
                }

                return {
                  ...turn,
                  subagents: [
                    ...turn.subagents,
                    {
                      id: subagentId,
                      name: event.taskName || "subagent",
                      status: "running",
                      startedAt: event.timestamp,
                      reasoning: "",
                      thoughts: event.content ? [event.content] : [],
                      tools: [],
                    },
                  ],
                };
              });
            }

            if (event.type === "subagent_end") {
              const subagentId = event.taskId || activeSubagentStack.at(-1);
              if (subagentId) {
                const index = activeSubagentStack.lastIndexOf(subagentId);
                if (index !== -1) {
                  activeSubagentStack.splice(index, 1);
                } else {
                  activeSubagentStack.pop();
                }

                updateTurn((turn) => ({
                  ...turn,
                  subagents: turn.subagents.map((subagent) =>
                    subagent.id === subagentId
                      ? {
                          ...subagent,
                          status: "completed",
                          finishedAt: event.timestamp,
                          thoughts: event.content
                            ? [...subagent.thoughts, event.content]
                            : subagent.thoughts,
                        }
                      : subagent,
                  ),
                }));
              }
            }

            if (event.type === "done" && event.threadId && !threadId) {
              setThreadId(event.threadId);
            }

            if (event.type === "done") {
              updateTurn((turn) => ({
                ...turn,
                status: turn.status === "error" ? "error" : "completed",
                finishedAt: new Date().toISOString(),
              }));
            }
          }
        }
      } catch (err: any) {
        if (err?.name !== "AbortError") {
          setError(err?.message || "Deep agent request failed");
          setTurns((prev) =>
            prev.map((turn) =>
              turn.id === turnId
                ? {
                    ...turn,
                    status: "error",
                    error: err?.message || "Deep agent request failed",
                    finishedAt: new Date().toISOString(),
                  }
                : turn,
            ),
          );
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    },
    [threadId, initialize],
  );

  const stop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  }, []);

  return {
    threadId,
    workspace,
    messages,
    turns,
    events,
    thinking,
    isInitializing,
    isLoading,
    error,
    initialize,
    sendMessage,
    stop,
  };
}
