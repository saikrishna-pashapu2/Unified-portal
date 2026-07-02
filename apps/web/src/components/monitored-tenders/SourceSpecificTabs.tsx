"use client";

import { useState } from "react";
import type { SourceSpecificView } from "@/lib/monitored-tenders/presentation";
import { prettyScalar } from "@/lib/monitored-tenders/format";
import { cn } from "./styles";

function RowsTable({ rows }: { rows: Array<{ label: string; value: unknown }> }) {
  if (!rows.length) return <p className="text-sm text-slate-500">No fields were extracted for this section.</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="min-w-full text-sm">
        <tbody className="divide-y divide-slate-200">
          {rows.map((row, index) => (
            <tr key={`${row.label}-${index}`} className="align-top">
              <th className="w-1/3 bg-slate-50 px-4 py-3 text-left font-medium text-slate-600">{row.label}</th>
              <td className="px-4 py-3 text-slate-950">
                {typeof row.value === "string" && row.value.startsWith("http") ? (
                  <a href={row.value} target="_blank" rel="noopener noreferrer" className="break-all text-blue-700 hover:text-blue-900">
                    {row.value}
                  </a>
                ) : (
                  prettyScalar(row.value)
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ItemsTable({ items, emptyText }: { items: Array<Record<string, any>>; emptyText?: string }) {
  if (!items.length) return <p className="text-sm text-slate-500">{emptyText ?? "No items were extracted for this section."}</p>;
  const columns = Array.from(
    items.reduce<Set<string>>((set, item) => {
      Object.keys(item).slice(0, 12).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  ).slice(0, 8);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-900 text-white">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-4 py-3 text-left font-medium">
                {column.replaceAll("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {items.map((item, index) => (
            <tr key={index} className="align-top">
              {columns.map((column) => {
                const value = item[column];
                return (
                  <td key={column} className="max-w-md px-4 py-3 text-slate-700">
                    {typeof value === "string" && value.startsWith("http") ? (
                      <a href={value} target="_blank" rel="noopener noreferrer" className="break-all text-blue-700 hover:text-blue-900">
                        {value}
                      </a>
                    ) : typeof value === "object" && value !== null ? (
                      <pre className="max-h-40 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>
                    ) : (
                      prettyScalar(value)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SourceSpecificTabs({ view }: { view: SourceSpecificView }) {
  const [activeTab, setActiveTab] = useState(view.tabs[0]?.id ?? "");
  const tab = view.tabs.find((candidate) => candidate.id === activeTab) ?? view.tabs[0];

  return (
    <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm shadow-slate-200/70">
      <div className="border-b border-slate-300 bg-white px-5 pt-4 sm:px-6">
        <div className="flex flex-wrap gap-1">
          {view.tabs.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => setActiveTab(candidate.id)}
              className={cn(
                "rounded-t-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-white",
                candidate.id === activeTab ? "bg-blue-900" : "bg-slate-900",
              )}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        {tab?.sections.map((section, index) => (
          <section key={`${section.title}-${index}`}>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{section.title}</h3>
            {section.rows ? <RowsTable rows={section.rows} /> : null}
            {section.items ? <ItemsTable items={section.items} emptyText={section.emptyText} /> : null}
          </section>
        ))}
      </div>
    </section>
  );
}
