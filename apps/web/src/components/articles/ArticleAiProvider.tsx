"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type {
  ArticleAiDomain,
  ArticleAiFeedbackResult,
  ArticleAiPreference,
  ArticleAiSelection,
} from "@/lib/article-ai/types";

type FeedbackAction = "confirm" | "dismiss";

type FeedbackResponse =
  | { ok: true; result: ArticleAiFeedbackResult }
  | { ok: false; error: string; conflict?: boolean };

export type ArticleAiContextValue = {
  domain: ArticleAiDomain;
  isAuthenticated: boolean;
  preference: ArticleAiPreference | null;
  selections: ReadonlyMap<number, ArticleAiSelection>;
  loading: boolean;
  savingPreference: boolean;
  error: string | null;
  pendingArticleIds: ReadonlySet<number>;
  pendingPollingExhausted: ReadonlySet<number>;
  refresh: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<boolean>;
  submitFeedback: (
    articleId: number,
    action: FeedbackAction,
  ) => Promise<FeedbackResponse>;
  selectionFor: (articleId: number) => ArticleAiSelection | null;
};

const ArticleAiContext = createContext<ArticleAiContextValue | null>(null);

function normalizeError(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export default function ArticleAiProvider({
  domain,
  articleIds,
  isAuthenticated,
  children,
}: {
  domain: ArticleAiDomain;
  articleIds: number[];
  isAuthenticated: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const normalizedIds = useMemo(
    () => Array.from(new Set(articleIds.filter((id) => Number.isSafeInteger(id) && id > 0))),
    [articleIds],
  );
  const idsKey = normalizedIds.join(",");
  const requestKey = `${domain}:${isAuthenticated ? "auth" : "anonymous"}:${idsKey}`;
  const loadedKey = useRef<string | null>(null);
  const activeRequestKey = useRef(requestKey);
  const requestGeneration = useRef(0);
  const selectionController = useRef<AbortController | null>(null);
  const preferenceController = useRef<AbortController | null>(null);
  activeRequestKey.current = requestKey;
  const [preference, setPreference] = useState<ArticleAiPreference | null>(null);
  const [selections, setSelections] = useState<Map<number, ArticleAiSelection>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(isAuthenticated);
  const [savingPreference, setSavingPreference] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingArticleIds, setPendingArticleIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [pendingPollingExhausted, setPendingPollingExhausted] = useState<Set<number>>(
    () => new Set(),
  );
  const [pollingRetryToken, setPollingRetryToken] = useState(0);
  const pendingSelectionKey = useMemo(
    () =>
      Array.from(selections.values())
        .filter((selection) => selection.pendingConfirmation)
        .sort((left, right) => left.articleId - right.articleId)
        .map((selection) => `${selection.articleId}:${selection.version}`)
        .join(","),
    [selections],
  );

  useEffect(() => {
    selectionController.current?.abort();
    preferenceController.current?.abort();
    loadedKey.current = null;
    setPreference(null);
    setSelections(new Map());
    setError(null);
    setLoading(isAuthenticated);
    setSavingPreference(false);
    setPendingArticleIds(new Set());
    setPendingPollingExhausted(new Set());
    setPollingRetryToken(0);
  }, [isAuthenticated, requestKey]);

  const loadState = useCallback(
    async (force = false) => {
      if (!isAuthenticated) {
        setLoading(false);
        setPreference(null);
        setSelections(new Map());
        setError(null);
        return;
      }
      if (!force && loadedKey.current === requestKey) return;
      loadedKey.current = requestKey;
      const generation = ++requestGeneration.current;
      selectionController.current?.abort();
      const controller = new AbortController();
      selectionController.current = controller;
      setLoading(true);
      setError(null);

      try {
        const selectionQuery = new URLSearchParams({ domain });
        if (idsKey) selectionQuery.set("articleIds", idsKey);

        // Keep this as exactly one selection request for the whole current page.
        const [preferenceResponse, selectionResponse] = await Promise.all([
          fetch(`/api/article-ai/preferences?domain=${domain}`, {
            cache: "no-store",
            signal: controller.signal,
          }),
          idsKey
            ? fetch(`/api/article-ai/selections?${selectionQuery.toString()}`, {
                cache: "no-store",
                signal: controller.signal,
              })
            : Promise.resolve(null),
        ]);

        const preferencePayload = await readJson(preferenceResponse);
        if (!preferenceResponse.ok) {
          throw new Error(
            normalizeError(preferencePayload, "Could not load AI article settings."),
          );
        }
        if (generation !== requestGeneration.current || activeRequestKey.current !== requestKey) return;
        setPreference(preferencePayload as ArticleAiPreference);

        if (selectionResponse) {
          const selectionPayload = await readJson(selectionResponse);
          if (!selectionResponse.ok) {
            throw new Error(
              normalizeError(selectionPayload, "Could not load AI article selections."),
            );
          }
          const nextSelections = new Map<number, ArticleAiSelection>();
          const rows =
            selectionPayload && typeof selectionPayload === "object" && "selections" in selectionPayload
              ? (selectionPayload as { selections?: unknown }).selections
              : [];
          if (Array.isArray(rows)) {
            for (const row of rows) {
              if (!row || typeof row !== "object") continue;
              const selection = row as ArticleAiSelection;
              if (Number.isSafeInteger(selection.articleId)) {
                nextSelections.set(selection.articleId, selection);
              }
            }
          }
          if (generation !== requestGeneration.current || activeRequestKey.current !== requestKey) return;
          setSelections(nextSelections);
        } else {
          if (generation !== requestGeneration.current || activeRequestKey.current !== requestKey) return;
          setSelections(new Map());
        }
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        if (generation !== requestGeneration.current || activeRequestKey.current !== requestKey) return;
        setError(caught instanceof Error ? caught.message : "Could not load AI article settings.");
      } finally {
        if (generation === requestGeneration.current && activeRequestKey.current === requestKey) {
          setLoading(false);
        }
      }
    },
    [domain, idsKey, isAuthenticated, requestKey],
  );

  useEffect(() => {
    void loadState();
  }, [loadState]);

  // Pending confirmations are asynchronous on the worker side. Poll only while
  // the current article view is visible, with a bounded backoff so an abandoned
  // tab cannot poll forever. A refresh also lets confirmed human likes update
  // the existing LikeButton count from the server-rendered tree.
  useEffect(() => {
    if (!isAuthenticated || !pendingSelectionKey) return;

    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let visibilityHandler: (() => void) | null = null;
    const pendingIds = new Set(
      pendingSelectionKey
        .split(",")
        .map((entry) => Number(entry.split(":", 1)[0]))
        .filter((articleId) => Number.isSafeInteger(articleId) && articleId > 0),
    );
    const delays = [1_000, 2_000, 5_000, 10_000, 15_000, 20_000, 30_000];

    setPendingPollingExhausted(new Set());

    const schedule = () => {
      if (cancelled || attempt >= delays.length) {
        if (!cancelled && attempt >= delays.length) {
          setPendingPollingExhausted(pendingIds);
        }
        return;
      }
      timer = setTimeout(run, delays[attempt]);
    };

    const run = async () => {
      if (cancelled) return;
      timer = null;
      if (document.visibilityState !== "visible") {
        visibilityHandler = () => {
          if (cancelled) return;
          if (document.visibilityState !== "visible") return;
          if (visibilityHandler) {
            document.removeEventListener("visibilitychange", visibilityHandler);
            visibilityHandler = null;
          }
          schedule();
        };
        document.addEventListener("visibilitychange", visibilityHandler);
        return;
      }

      attempt += 1;
      await loadState(true);
      if (cancelled) return;
      router.refresh?.();
      schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (visibilityHandler) {
        document.removeEventListener("visibilitychange", visibilityHandler);
      }
    };
  }, [
    isAuthenticated,
    loadState,
    pendingSelectionKey,
    pollingRetryToken,
    preference?.enabled,
    router,
  ]);

  const refresh = useCallback(async () => {
    loadedKey.current = null;
    setPendingPollingExhausted(new Set());
    setPollingRetryToken((current) => current + 1);
    await loadState(true);
  }, [loadState]);

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (!isAuthenticated) return false;
      const mutationKey = requestKey;
      preferenceController.current?.abort();
      const controller = new AbortController();
      preferenceController.current = controller;
      setSavingPreference(true);
      setError(null);
      try {
        const response = await fetch("/api/article-ai/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain, enabled }),
          signal: controller.signal,
        });
        const payload = await readJson(response);
        if (activeRequestKey.current !== mutationKey) return false;
        if (!response.ok) {
          setError(normalizeError(payload, "Could not save AI article settings."));
          return false;
        }
        setPreference(payload as ArticleAiPreference);
        if (enabled) {
          await loadState(true);
        }
        return true;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return false;
        if (activeRequestKey.current !== mutationKey) return false;
        setError(caught instanceof Error ? caught.message : "Could not save AI article settings.");
        return false;
      } finally {
        if (activeRequestKey.current === mutationKey) setSavingPreference(false);
      }
    },
    [domain, isAuthenticated, loadState, requestKey],
  );

  const submitFeedback = useCallback(
    async (articleId: number, action: FeedbackAction): Promise<FeedbackResponse> => {
      if (!isAuthenticated) return { ok: false, error: "Sign in to manage your private digest picks." };
      const selection = selections.get(articleId);
      if (!selection) return { ok: false, error: "This AI pick is no longer available." };
      if (!selection.sharedSelectionId) {
        return { ok: false, error: "This AI pick needs a refresh before feedback can be saved." };
      }
      if (pendingArticleIds.has(articleId) || selection.pendingConfirmation) {
        return { ok: false, error: "This AI pick is still being saved." };
      }

      const feedbackKey = requestKey;
      const feedbackGeneration = requestGeneration.current;
      setPendingArticleIds((current) => new Set(current).add(articleId));
      try {
        const response = await fetch("/api/article-ai/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain,
            articleId,
            action,
            expectedVersion: selection.version,
            sharedSelectionId: selection.sharedSelectionId,
          }),
        });
        const payload = await readJson(response);
        if (
          activeRequestKey.current !== feedbackKey ||
          requestGeneration.current !== feedbackGeneration
        ) {
          return { ok: false, error: "The article view changed while feedback was saving." };
        }
        if (!response.ok) {
          if (response.status === 409) {
            await refresh();
            return {
              ok: false,
              conflict: true,
              error: "This AI pick changed. The latest state is now shown.",
            };
          }
          return {
            ok: false,
            error: normalizeError(payload, "Could not save your AI article feedback."),
          };
        }

        const result = payload as ArticleAiFeedbackResult;
        if (result.selection) {
          setSelections((current) => {
            const next = new Map(current);
            next.set(articleId, result.selection);
            return next;
          });
        }
        router.refresh?.();
        return { ok: true, result };
      } catch (caught) {
        return {
          ok: false,
          error: caught instanceof Error ? caught.message : "Could not save your AI article feedback.",
        };
      } finally {
        if (activeRequestKey.current === feedbackKey) {
          setPendingArticleIds((current) => {
            const next = new Set(current);
            next.delete(articleId);
            return next;
          });
        }
      }
    },
    [
      domain,
      isAuthenticated,
      pendingArticleIds,
      refresh,
      requestKey,
      router,
      selections,
    ],
  );

  const selectionMap = useMemo<ReadonlyMap<number, ArticleAiSelection>>(
    () => selections,
    [selections],
  );
  const pendingSet = useMemo<ReadonlySet<number>>(
    () => pendingArticleIds,
    [pendingArticleIds],
  );
  const pendingPollingSet = useMemo<ReadonlySet<number>>(
    () => pendingPollingExhausted,
    [pendingPollingExhausted],
  );
  const value = useMemo<ArticleAiContextValue>(
    () => ({
      domain,
      isAuthenticated,
      preference,
      selections: selectionMap,
      loading,
      savingPreference,
      error,
      pendingArticleIds: pendingSet,
      pendingPollingExhausted: pendingPollingSet,
      refresh,
      setEnabled,
      submitFeedback,
      selectionFor: (articleId: number) => selectionMap.get(articleId) ?? null,
    }),
    [
      domain,
      error,
      isAuthenticated,
      loading,
      pendingSet,
      pendingPollingSet,
      preference,
      refresh,
      savingPreference,
      selectionMap,
      setEnabled,
      submitFeedback,
    ],
  );

  return <ArticleAiContext.Provider value={value}>{children}</ArticleAiContext.Provider>;
}

export function useArticleAi() {
  const value = useContext(ArticleAiContext);
  if (!value) {
    throw new Error("useArticleAi must be used inside ArticleAiProvider");
  }
  return value;
}
