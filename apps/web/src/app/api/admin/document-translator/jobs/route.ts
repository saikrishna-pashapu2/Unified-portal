import { NextResponse } from "next/server";
import { esgPrisma } from "@esgcredit/db-esg";
import { requireAdminSession } from "@/lib/api-auth";
import {
  normalizeAdminTranslatorJob,
  parseAdminTranslatorJobsQuery,
  type AdminTranslatorJob,
} from "@/lib/document-translator/admin-jobs";
import { buildAdminTranslatorJobsQuery } from "@/lib/document-translator/admin-jobs-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

type AdminTranslatorJobsSqlRow = {
  total: number | bigint | string;
  items: unknown;
};

function numericTotal(value: unknown): number {
  const total = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isSafeInteger(total) && total >= 0 ? total : 0;
}

export async function GET(request: Request) {
  const auth = await requireAdminSession();
  if (auth.response) {
    auth.response.headers.set("Cache-Control", "private, no-store");
    return auth.response;
  }

  const filters = parseAdminTranslatorJobsQuery(
    new URL(request.url).searchParams,
  );
  if (!filters) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid translator job filters or pagination",
      },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const query = buildAdminTranslatorJobsQuery(filters);
    // The builder contains only fixed SQL and numbered placeholders. Every
    // caller-controlled filter is passed separately as a bound value.
    const [row] = await esgPrisma.$queryRawUnsafe<
      AdminTranslatorJobsSqlRow[]
    >(query.text, ...query.parameters);
    const rawItems = Array.isArray(row?.items) ? row.items : [];
    const items = rawItems
      .map(normalizeAdminTranslatorJob)
      .filter((item): item is AdminTranslatorJob => item !== null);

    return NextResponse.json(
      {
        success: true,
        items,
        total: numericTotal(row?.total),
        page: filters.page,
        size: filters.pageSize,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    // Database error objects can include connection URLs or credentials. Keep
    // the client response and server log free of raw exception text.
    console.error("[Admin Document Translator Jobs] Failed to load jobs");
    return NextResponse.json(
      { success: false, error: "Failed to load translator jobs" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
