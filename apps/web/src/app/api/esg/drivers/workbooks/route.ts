import { NextResponse } from "next/server";
import { enforceApiUsage } from "@/lib/api-usage";
import { ensureUserId } from "@/lib/session-user";
import {
  DRIVER_CATALOG_FILE_MAX_BYTES,
  DRIVER_CATALOG_REQUEST_MAX_BYTES,
  getDriverCatalogPreview,
  listDriverCatalogs,
  uploadDriverCatalog,
} from "@/lib/esg-drivers/catalog-store";
import {
  catalogErrorResponse,
  readBoundedRequestBody,
  requireCatalogMutationOrigin,
} from "./http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = await ensureUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return NextResponse.json(await listDriverCatalogs(new URL(request.url).searchParams.get("cursor")));
  } catch (error) {
    return catalogErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const userId = await ensureUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const originError = requireCatalogMutationOrigin(request);
  if (originError) return originError;

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "multipart/form-data") {
    return NextResponse.json(
      { error: "Content-Type must be multipart/form-data" },
      { status: 415 },
    );
  }

  try {
    const limited = await enforceApiUsage(request, {
      feature: "esg_driver_catalog_upload",
      userId,
      perMinute: 3,
      perDay: 20,
    });
    if (limited) return limited;

    const body = await readBoundedRequestBody(request, DRIVER_CATALOG_REQUEST_MAX_BYTES);
    const replay = new Request(request.url, {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body: body as unknown as BodyInit,
    });
    const form = await replay.formData();
    const value = form.get("file") ?? form.get("workbook");
    if (!value || typeof value !== "object" || !("arrayBuffer" in value)) {
      return NextResponse.json(
        { error: "Attach one workbook file in the file field." },
        { status: 400 },
      );
    }

    const file = value as File;
    if (file.size > DRIVER_CATALOG_FILE_MAX_BYTES) {
      return NextResponse.json({ error: "The workbook upload is too large." }, { status: 413 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length > DRIVER_CATALOG_FILE_MAX_BYTES) {
      return NextResponse.json({ error: "The workbook upload is too large." }, { status: 413 });
    }

    return NextResponse.json(await uploadDriverCatalog(userId, bytes, file.name));
  } catch (error) {
    return catalogErrorResponse(error);
  }
}
