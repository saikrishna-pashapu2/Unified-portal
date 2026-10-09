import { NextResponse } from "next/server";
import { ensureUserId } from "@/lib/session-user";
import {
  getDriverCatalogPreview,
} from "@/lib/esg-drivers/catalog-store";
import { catalogErrorResponse } from "../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ versionId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const userId = await ensureUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { versionId } = await context.params;
    return NextResponse.json(await getDriverCatalogPreview(versionId));
  } catch (error) {
    return catalogErrorResponse(error);
  }
}
