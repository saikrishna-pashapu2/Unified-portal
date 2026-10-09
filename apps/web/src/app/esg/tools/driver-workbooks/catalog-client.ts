"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DriverCatalogActivation,
  DriverCatalogListResponse,
  DriverCatalogVersion,
} from "@/lib/esg-drivers/catalog-contracts";

const CATALOG_PATH = "/api/esg/drivers/workbooks";

export interface DriverWorkbookCatalogState {
  catalog: DriverCatalogListResponse | null;
  loading: boolean;
  error: string;
}

export interface DriverWorkbookCatalogController extends DriverWorkbookCatalogState {
  refresh: () => Promise<DriverCatalogListResponse | null>;
  loadMore: () => Promise<DriverCatalogListResponse | null>;
}

export function catalogErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const payload = data as {
    error?: unknown;
    issues?: Array<{ sheet?: unknown; cell?: unknown; message?: unknown }>;
  };
  const message = typeof payload.error === "string" ? payload.error : fallback;
  const issues = Array.isArray(payload.issues)
    ? payload.issues
        .map((issue) => {
          if (!issue || typeof issue !== "object") return "";
          const location = [
            typeof issue.sheet === "string" ? issue.sheet : "",
            typeof issue.cell === "string" ? issue.cell : "",
          ]
            .filter(Boolean)
            .join(" ");
          const detail = typeof issue.message === "string" ? issue.message : "";
          return location && detail ? `${location}: ${detail}` : detail || location;
        })
        .filter(Boolean)
    : [];
  return issues.length > 0 ? `${message} ${issues.join(" ")}` : message;
}

function mergeCatalogPages(
  current: DriverCatalogListResponse,
  next: DriverCatalogListResponse,
): DriverCatalogListResponse {
  const versions = uniqueById([...current.versions, ...next.versions]);
  const activations = uniqueById([...current.activations, ...next.activations]);
  return {
    ...current,
    versions,
    activations,
    nextCursor: next.nextCursor,
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function fetchCatalog(
  signal: AbortSignal,
  cursor?: string | null,
): Promise<DriverCatalogListResponse> {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`${CATALOG_PATH}${params}`, {
    cache: "no-store",
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(catalogErrorMessage(data, "Unable to load driver workbooks."));
  }
  return data as DriverCatalogListResponse;
}

export function useDriverWorkbookCatalog(): DriverWorkbookCatalogController {
  const [state, setState] = useState<DriverWorkbookCatalogState>({
    catalog: null,
    loading: true,
    error: "",
  });
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async (): Promise<DriverCatalogListResponse | null> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState((current) => ({ ...current, loading: true, error: "" }));

    try {
      const catalog = await fetchCatalog(controller.signal);
      if (controller.signal.aborted || requestRef.current !== requestId) return null;
      setState({ catalog, loading: false, error: "" });
      return catalog;
    } catch (error: unknown) {
      if (controller.signal.aborted || requestRef.current !== requestId) return null;
      const message = error instanceof Error ? error.message : "Unable to load driver workbooks.";
      setState((current) => ({ ...current, loading: false, error: message }));
      return null;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const loadMore = useCallback(async (): Promise<DriverCatalogListResponse | null> => {
    const currentCatalog = state.catalog;
    const cursor = currentCatalog?.nextCursor;
    const expectedRevision = currentCatalog?.revision;
    if (!cursor || expectedRevision === undefined || state.loading) return currentCatalog;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    try {
      const next = await fetchCatalog(controller.signal, cursor);
      if (
        controller.signal.aborted ||
        requestRef.current !== requestId ||
        next.revision !== expectedRevision
      ) {
        return null;
      }
      setState((current) => {
        if (
          !current.catalog ||
          current.catalog.revision !== expectedRevision ||
          current.catalog.nextCursor !== cursor
        ) {
          return current;
        }
        return {
          ...current,
          catalog: mergeCatalogPages(current.catalog, next),
          error: "",
        };
      });
      return next;
    } catch (error: unknown) {
      if (controller.signal.aborted || requestRef.current !== requestId) return null;
      const message = error instanceof Error ? error.message : "Unable to load more driver workbooks.";
      setState((current) => ({ ...current, error: message }));
      return null;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [state.catalog, state.loading]);

  useEffect(() => {
    void refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  return { ...state, refresh, loadMore };
}

export function formatCatalogAttribution(
  person: { name: string } | null | undefined,
  timestamp: string | null | undefined,
): string {
  const name = person?.name || "Unknown user";
  if (!timestamp) return name;
  const date = new Date(timestamp);
  const formatted = Number.isNaN(date.getTime())
    ? timestamp
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  return `${name} · ${formatted}`;
}

export function versionLabel(version: DriverCatalogVersion): string {
  return version.version || version.workbook || version.id;
}

export function activationLabel(activation: DriverCatalogActivation): string {
  return formatCatalogAttribution(activation.activatedBy, activation.activatedAt);
}
