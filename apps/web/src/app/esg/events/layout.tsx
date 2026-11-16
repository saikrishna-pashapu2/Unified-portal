import type { Metadata } from "next";
import { eventEditorial, eventSans } from "@/lib/fonts/events";

export const metadata: Metadata = {
  title: {
    default: "ESG Event Ledger",
    template: "%s | ESG Event Ledger",
  },
  description:
    "Discover ESG, climate, sustainable-finance, and responsible-investment events around the world.",
};

export default function EsgEventsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      className={`${eventSans.variable} ${eventEditorial.variable} min-w-0 font-[family-name:var(--font-event-sans)]`}
    >
      {children}
    </div>
  );
}
