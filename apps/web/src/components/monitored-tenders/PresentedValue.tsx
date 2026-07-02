import type { PresentedNode } from "@/lib/monitored-tenders/presentation";
import { prettyScalar } from "@/lib/monitored-tenders/format";

export default function PresentedValue({ node }: { node: PresentedNode }) {
  if (node.kind === "scalar") {
    return <span className="whitespace-pre-wrap break-words">{prettyScalar(node.value)}</span>;
  }

  if (node.kind === "scalar_list") {
    return (
      <div className="flex flex-wrap gap-2">
        {node.items.map((item, index) => (
          <span key={index} className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
            {prettyScalar(item)}
          </span>
        ))}
      </div>
    );
  }

  if (node.kind === "mapping") {
    return (
      <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {node.rows.map((row, index) => (
          <div key={`${row.label}-${index}`} className="rounded-2xl border border-slate-200 bg-white/80 p-3">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{row.label}</dt>
            <dd className="mt-2 text-sm text-slate-900">
              <PresentedValue node={row.value} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <div className="space-y-3">
      {node.items.map((item, index) => (
        <article key={index} className="rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm shadow-slate-100">
          {"title" in item && item.title ? (
            <h4 className="mb-3 text-sm font-semibold text-slate-900">{item.title}</h4>
          ) : null}
          <PresentedValue node={item} />
        </article>
      ))}
    </div>
  );
}
