"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ErrorResult from "@/components/ui/error-result";

type CreditHealthState = "checking" | "connectivity_error" | "other_error";

export default function CreditError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [healthState, setHealthState] = useState<CreditHealthState>("checking");

  useEffect(() => {
    let mounted = true;

    async function checkCreditHealth() {
      try {
        const res = await fetch("/api/credit/health", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));

        if (!mounted) return;

        if (res.status === 503 && data?.reason === "db_connectivity") {
          setHealthState("connectivity_error");
          return;
        }

        setHealthState("other_error");
      } catch {
        if (!mounted) return;
        setHealthState("other_error");
      }
    }

    checkCreditHealth();
    return () => {
      mounted = false;
    };
  }, [error]);

  if (healthState === "checking") {
    return (
      <div className="mx-auto max-w-2xl px-6 py-14">
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <h1 className="text-xl font-semibold text-slate-900">
            Checking Credit service status...
          </h1>
          <p className="mt-2 text-sm text-slate-700">
            Please wait a moment while we verify availability.
          </p>
        </div>
      </div>
    );
  }

  if (healthState === "connectivity_error") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-14">
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
          <h1 className="text-xl font-semibold text-amber-900">
            Credit pages are temporarily unavailable
          </h1>
          <p className="mt-2 text-sm text-amber-900">
            Credit data is temporarily unavailable due to a reported AWS
            infrastructure incident in the UAE (me-central-1) affecting
            database connectivity. ESG pages are available and working normally.
          </p>
          <div className="mt-5 flex gap-3">
            <Link
              href="/esg"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              View ESG Pages
            </Link>
            <button
              onClick={reset}
              className="rounded-lg border border-amber-700 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              Try Again
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <ErrorResult
      title="Something went wrong"
      description={error.message || "Please try again."}
      onRetry={reset}
    />
  );
}
