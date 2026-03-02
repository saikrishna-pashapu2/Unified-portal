import Link from "next/link";
import Header from "@/components/header/Header";
import { creditPrisma } from "@esgcredit/db-credit";

function isCreditDbConnectivityError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const maybeError = error as { code?: string; message?: string };
  const message = String(maybeError.message ?? "").toLowerCase();

  return (
    maybeError.code === "P1001" ||
    message.includes("can't reach database server") ||
    message.includes("cannot reach database server") ||
    message.includes("connection timed out") ||
    message.includes("econnrefused")
  );
}

export default async function CreditLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  try {
    await creditPrisma.$queryRaw`SELECT 1`;
  } catch (error) {
    if (isCreditDbConnectivityError(error)) {
      return (
        <>
          <Header domain="credit" />
          <main className="mx-auto max-w-2xl px-6 py-14">
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6">
              <h1 className="text-xl font-semibold text-amber-900">
                Credit pages are temporarily unavailable
              </h1>
              <p className="mt-2 text-sm text-amber-900">
                Credit data is temporarily unavailable due to a reported AWS
                infrastructure incident in the UAE (me-central-1) affecting
                database connectivity. ESG pages are available and working
                normally.
              </p>
              <div className="mt-5 flex gap-3">
                <Link
                  href="/esg"
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  View ESG Pages
                </Link>
                <Link
                  href="/credit"
                  className="rounded-lg border border-amber-700 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
                >
                  Try Again
                </Link>
              </div>
            </div>
          </main>
        </>
      );
    }

    throw error;
  }

  return (
    <>
      <Header domain="credit" />
      <div className="min-h-[calc(100vh-64px)]">{children}</div>
    </>
  );
}
