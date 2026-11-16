import type { Metadata } from "next";
import { ledgerEditorial, ledgerSans } from "@/lib/fonts/events-alert";

export const metadata: Metadata = {
  title: "Event Email Alerts | Admin",
  description: "Manage and monitor the ESG weekly event email alert.",
};

export default function EventEmailAlertsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${ledgerSans.variable} ${ledgerEditorial.variable} min-w-0 font-[family-name:var(--font-event-alert-sans)]`}>
      {children}
    </div>
  );
}
