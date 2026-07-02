"use client";

import { Children, type ReactNode, useState } from "react";
import { cn } from "../styles";

export default function SourceDetailTabs({
  tabs,
  children,
}: {
  tabs: Array<{ id: string; label: string }>;
  children: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? "");
  const panels = Children.toArray(children);
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTab));

  return (
    <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm shadow-slate-200/70">
      <div className="border-b border-slate-300 bg-white px-5 pt-4 sm:px-6">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-t-md border border-slate-300 px-4 py-2.5 text-sm font-medium text-white",
                tab.id === activeTab ? "bg-blue-900" : "bg-slate-900",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-5 sm:p-6">{panels[activeIndex]}</div>
    </section>
  );
}
