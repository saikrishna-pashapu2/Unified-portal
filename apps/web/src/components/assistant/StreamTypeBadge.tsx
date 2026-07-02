import type { DeepAgentStreamEventType } from "@/lib/deep-agent/types";
import { cn } from "@/lib/utils";

const labels: Record<DeepAgentStreamEventType, string> = {
  status: "status",
  thinking_delta: "thinking",
  answer_delta: "answer",
  thought_transition: "thought->answer",
  tool_call: "tool call",
  tool_result: "tool result",
  subagent_start: "subagent start",
  subagent_end: "subagent end",
  todo_update: "todo",
  state_update: "state",
  debug: "debug",
  error: "error",
  done: "done",
};

const styles: Record<DeepAgentStreamEventType, string> = {
  status: "bg-slate-200 text-slate-700",
  thinking_delta: "bg-amber-100 text-amber-800",
  answer_delta: "bg-emerald-100 text-emerald-800",
  thought_transition: "bg-orange-100 text-orange-800",
  tool_call: "bg-cyan-100 text-cyan-800",
  tool_result: "bg-blue-100 text-blue-800",
  subagent_start: "bg-indigo-100 text-indigo-800",
  subagent_end: "bg-violet-100 text-violet-800",
  todo_update: "bg-teal-100 text-teal-800",
  state_update: "bg-slate-100 text-slate-700",
  debug: "bg-zinc-200 text-zinc-800",
  error: "bg-rose-100 text-rose-800",
  done: "bg-emerald-200 text-emerald-900",
};

interface StreamTypeBadgeProps {
  type: DeepAgentStreamEventType;
  className?: string;
}

export function StreamTypeBadge({ type, className }: StreamTypeBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        styles[type],
        className,
      )}
    >
      {labels[type]}
    </span>
  );
}
