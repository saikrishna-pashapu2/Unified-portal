import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceApiUsage } from "@/lib/api-usage";
import { ensureUserId } from "@/lib/session-user";
import { activateDriverCatalog } from "@/lib/esg-drivers/catalog-store";
import {
  catalogErrorResponse,
  parseBoundedJsonBody,
  requireCatalogMutationOrigin,
} from "../../http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const activationRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

interface RouteContext {
  params: Promise<{ versionId: string }>;
}

export async function POST(request: Request, context: RouteContext) {
  const userId = await ensureUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const originError = requireCatalogMutationOrigin(request);
  if (originError) return originError;
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  try {
    const { versionId } = await context.params;
    const limited = await enforceApiUsage(request, {
      feature: "esg_driver_catalog_activation",
      userId,
      perMinute: 20,
      perDay: 20,
    });
    if (limited) return limited;

    const body = await parseBoundedJsonBody<unknown>(request, 32 * 1024);
    const parsed = activationRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "expectedRevision must be a non-negative integer." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await activateDriverCatalog(userId, versionId, parsed.data.expectedRevision),
    );
  } catch (error) {
    return catalogErrorResponse(error);
  }
}
