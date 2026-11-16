import { ReactNode } from "react";
import { assistantDisplay, assistantMono } from "@/lib/fonts/assistant";

export default function AssistantLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${assistantDisplay.variable} ${assistantMono.variable} min-h-screen bg-[radial-gradient(circle_at_top_right,_#d1fae5_0%,_#f8fafc_38%,_#e0f2fe_100%)]`}
      style={{
        fontFamily: "var(--assistant-display), sans-serif",
      }}
    >
      {children}
    </div>
  );
}
