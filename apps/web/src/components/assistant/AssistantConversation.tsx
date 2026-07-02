"use client";

import { useEffect, useMemo, useRef } from "react";
import { Bot, ChevronDown, User, Wrench } from "lucide-react";
import type { ChatTurn } from "@/hooks/useDeepAgent";
import { StreamTypeBadge } from "@/components/assistant/StreamTypeBadge";
import { cn } from "@/lib/utils";

interface AssistantConversationProps {
  turns: ChatTurn[];
  isLoading: boolean;
}

function safeStringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatStatus(turn: ChatTurn): string {
  if (turn.status === "streaming") return "streaming";
  if (turn.status === "error") return "error";
  return "done";
}

export function AssistantConversation({ turns, isLoading }: AssistantConversationProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [turns, isLoading]);

  const sortedTurns = useMemo(() => turns, [turns]);

  return (
    <div
      ref={scrollRef}
      className="h-[calc(100vh-290px)] overflow-y-auto rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm backdrop-blur-sm sm:p-6"
    >
      <div className="space-y-6">
        {sortedTurns.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-sky-300 bg-sky-50/80 p-6 text-sm text-sky-900">
            Ask naturally. The assistant will answer in chat style, with optional dropdowns for reasoning,
            tools, and subagents.
          </div>
        ) : null}

        {sortedTurns.map((turn) => (
          <div key={turn.id} className="space-y-3">
            <div className="flex justify-end gap-3">
              <div className="max-w-[85%] rounded-3xl bg-slate-900 px-4 py-3 text-sm text-white">
                <p className="whitespace-pre-wrap">{turn.userMessage}</p>
              </div>
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-700">
                <User size={14} />
              </div>
            </div>

            <div className="flex justify-start gap-3">
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700">
                <Bot size={14} />
              </div>

              <div className="w-full max-w-[92%] space-y-3">
                <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800">
                  <div className="mb-2 flex items-center gap-2">
                    <StreamTypeBadge
                      type={
                        turn.status === "streaming"
                          ? "status"
                          : turn.status === "error"
                            ? "error"
                            : "done"
                      }
                    />
                    <span className="text-xs text-slate-500">{formatStatus(turn)}</span>
                  </div>

                  <p className="whitespace-pre-wrap leading-relaxed">
                    {turn.assistantMessage || (turn.status === "streaming" ? "..." : "")}
                  </p>

                  {turn.thoughts.length > 0 ? (
                    <div className="mt-3 space-y-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <p className="font-semibold uppercase tracking-wide">Thoughts</p>
                      {turn.thoughts.map((thought, index) => (
                        <p key={`${turn.id}-thought-${index}`} className="whitespace-pre-wrap">
                          {thought}
                        </p>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 space-y-2">
                    <details className="group rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Reasoning
                        <ChevronDown
                          size={14}
                          className="transition-transform group-open:rotate-180"
                        />
                      </summary>
                      <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-xs text-slate-700">
                        {turn.reasoning || "No reasoning available for this turn."}
                      </pre>
                    </details>

                    <details className="group rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Tool Usage ({turn.tools.length})
                        <ChevronDown
                          size={14}
                          className="transition-transform group-open:rotate-180"
                        />
                      </summary>

                      <div className="mt-2 space-y-2">
                        {turn.tools.length === 0 ? (
                          <p className="text-xs text-slate-500">No tool calls for this turn.</p>
                        ) : (
                          turn.tools.map((tool, index) => (
                            <div
                              key={`${turn.id}-tool-${tool.id || index}`}
                              className="rounded-lg border border-cyan-200 bg-cyan-50 p-2 text-xs text-cyan-900"
                            >
                              <p className="flex items-center gap-1 font-semibold">
                                <Wrench size={11} />
                                {tool.name}
                              </p>
                              {tool.args !== undefined ? (
                                <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px]">
                                  {safeStringify(tool.args)}
                                </pre>
                              ) : null}
                              {tool.result ? (
                                <pre className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px]">
                                  {tool.result}
                                </pre>
                              ) : (
                                <p className="mt-1 text-[11px] text-cyan-700">pending result...</p>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </details>
                  </div>
                </div>

                {turn.subagents.length > 0 ? (
                  <div className="space-y-2">
                    {turn.subagents.map((subagent) => (
                      <details
                        key={`${turn.id}-subagent-${subagent.id}`}
                        className="group rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2"
                      >
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-violet-900">
                          <span className="truncate">
                            Subagent: {subagent.name}
                          </span>
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[10px]",
                                subagent.status === "running"
                                  ? "bg-violet-200 text-violet-900"
                                  : "bg-emerald-200 text-emerald-900",
                              )}
                            >
                              {subagent.status}
                            </span>
                            <ChevronDown
                              size={14}
                              className="transition-transform group-open:rotate-180"
                            />
                          </div>
                        </summary>

                        <div className="mt-2 space-y-2 text-xs text-violet-900">
                          {subagent.thoughts.length > 0 ? (
                            <div className="rounded-lg border border-violet-200 bg-white/70 p-2">
                              <p className="mb-1 font-semibold uppercase tracking-wide text-[11px]">
                                Thoughts
                              </p>
                              {subagent.thoughts.map((thought, index) => (
                                <p key={`${subagent.id}-thought-${index}`} className="whitespace-pre-wrap">
                                  {thought}
                                </p>
                              ))}
                            </div>
                          ) : null}

                          <details className="group rounded-lg border border-violet-200 bg-white/70 px-2 py-1">
                            <summary className="flex cursor-pointer list-none items-center justify-between font-semibold uppercase tracking-wide text-[11px] text-violet-800">
                              Reasoning
                              <ChevronDown
                                size={12}
                                className="transition-transform group-open:rotate-180"
                              />
                            </summary>
                            <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[11px] text-violet-900">
                              {subagent.reasoning || "No reasoning captured for this subagent."}
                            </pre>
                          </details>

                          <details className="group rounded-lg border border-violet-200 bg-white/70 px-2 py-1">
                            <summary className="flex cursor-pointer list-none items-center justify-between font-semibold uppercase tracking-wide text-[11px] text-violet-800">
                              Tool Usage ({subagent.tools.length})
                              <ChevronDown
                                size={12}
                                className="transition-transform group-open:rotate-180"
                              />
                            </summary>
                            <div className="mt-1 space-y-1">
                              {subagent.tools.length === 0 ? (
                                <p className="text-[11px] text-violet-700">No subagent tool calls.</p>
                              ) : (
                                subagent.tools.map((tool, index) => (
                                  <div
                                    key={`${subagent.id}-tool-${tool.id || index}`}
                                    className="rounded border border-violet-200 bg-violet-100/40 p-1.5 text-[11px]"
                                  >
                                    <p className="font-semibold">{tool.name}</p>
                                    {tool.args !== undefined ? (
                                      <pre className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap">
                                        {safeStringify(tool.args)}
                                      </pre>
                                    ) : null}
                                    {tool.result ? (
                                      <pre className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap">
                                        {tool.result}
                                      </pre>
                                    ) : null}
                                  </div>
                                ))
                              )}
                            </div>
                          </details>
                        </div>
                      </details>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
