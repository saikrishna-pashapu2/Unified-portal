import { Badge } from "@/components/ui/badge";

interface AssistantHeaderProps {
  threadId: string | null;
  workspace: string | null;
  isLoading: boolean;
  isInitializing: boolean;
}

export function AssistantHeader({
  threadId,
  workspace,
  isLoading,
  isInitializing,
}: AssistantHeaderProps) {
  const state = isInitializing ? "Initializing" : isLoading ? "Thinking" : "Ready";
  const stateClass = isInitializing || isLoading ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white/75 px-4 py-3 shadow-sm backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Assistant</h1>
          <p className="text-xs text-slate-500">Chat-first experience with expandable deep-agent traces</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge className={stateClass}>{state}</Badge>
          <Badge variant="outline" className="border-slate-300 bg-white/80 text-slate-600">
            thread: <span className="ml-1 max-w-36 truncate font-mono">{threadId || "..."}</span>
          </Badge>
          <Badge variant="outline" className="border-slate-300 bg-white/80 text-slate-600">
            ws: <span className="ml-1 max-w-36 truncate font-mono">{workspace || "..."}</span>
          </Badge>
        </div>
      </div>
    </section>
  );
}
