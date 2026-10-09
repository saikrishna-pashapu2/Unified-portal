import { NextResponse } from "next/server";
import { env } from "@/lib/config/env";
import {
  DriverCatalogPayloadTooLargeError,
  DriverCatalogStoreError,
  DriverCatalogValidationError,
} from "@/lib/esg-drivers/catalog-store";

export function catalogErrorResponse(error: unknown): NextResponse {
  if (error instanceof DriverCatalogValidationError) {
    return NextResponse.json(
      { error: error.message, issues: error.issues ?? [] },
      { status: 400 },
    );
  }
  if (error instanceof DriverCatalogStoreError) {
    if (error.status === 413) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    if (error.code === "stale_revision") {
      return NextResponse.json({ error: "stale_revision" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  console.error("[esg-driver-catalog] request failed:", error);
  return NextResponse.json(
    { error: "The workbook catalog is temporarily unavailable." },
    { status: 503 },
  );
}

export function requireCatalogMutationOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  try {
    allowed.add(new URL(env.NEXTAUTH_URL).origin);
  } catch {
    // The environment loader has already validated the configured URL where present.
  }
  if (!origin || !allowed.has(origin)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  return null;
}

export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength)) {
    const declaredLength = Number(contentLength);
    if (Number.isSafeInteger(declaredLength) && declaredLength > maxBytes) {
      throw new DriverCatalogPayloadTooLargeError();
    }
  }

  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new DriverCatalogPayloadTooLargeError();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function parseBoundedJsonBody<T>(
  request: Request,
  maxBytes: number,
): Promise<T> {
  const bytes = await readBoundedRequestBody(request, maxBytes);
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    throw new DriverCatalogStoreError(
      "invalid_workbook",
      400,
      "Invalid JSON request.",
    );
  }
}
