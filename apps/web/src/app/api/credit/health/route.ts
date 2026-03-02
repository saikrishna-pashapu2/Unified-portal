import { NextResponse } from "next/server";
import { creditPrisma } from "@esgcredit/db-credit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET() {
  try {
    await creditPrisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isCreditDbConnectivityError(error)) {
      return NextResponse.json(
        { ok: false, reason: "db_connectivity" },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: false, reason: "unknown" }, { status: 500 });
  }
}
