"use client";

import {
  AlertCircle,
  ArrowDownAZ,
  ArrowUp,
  CalendarDays,
  ChevronDown,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import {
  type FormEvent,
  type FocusEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ArticleSearchFilters,
  ArticleSearchResponse,
  EsgArticleSearchItem,
} from "@/lib/esg-article-search/types";
import { articleSearchParams } from "@/lib/esg-article-search/query";
import ArticleSearchHighlight from "./ArticleSearchHighlight";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 160;
const SUGGESTION_LIMIT = 6;

type EsgArticleSearchProps = {
  filters: ArticleSearchFilters;
  sources: string[];
};

type SuggestionState = "idle" | "loading" | "ready" | "error";

function searchPath(filters: ArticleSearchFilters) {
  const query = articleSearchParams(filters).toString();
  return `/esg/articles${query ? `?${query}` : ""}`;
}

function dateLabel(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function itemHref(item: EsgArticleSearchItem, filters: ArticleSearchFilters, typedQuery: string) {
  const backUrl = searchPath({
    ...filters,
    q: typedQuery,
    page: 1,
  });
  return `/esg/articles/${encodeURIComponent(String(item.id))}?back=${encodeURIComponent(backUrl)}`;
}

function suggestionMeta(item: EsgArticleSearchItem) {
  const date = dateLabel(item.published);
  return [item.source, date].filter(Boolean).join(" · ");
}

export default function EsgArticleSearch({
  filters,
  sources,
}: EsgArticleSearchProps) {
  const router = useRouter();
  const pathname = usePathname() || "/esg/articles";
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestGeneration = useRef(0);
  const abortController = useRef<AbortController | null>(null);
  const isComposing = useRef(false);
  const inputFocused = useRef(false);
  const escapedQuery = useRef<string | null>(null);
  const dismissedQuery = useRef<string | null>(null);
  const forceRetryRequest = useRef(false);
  const sortTouched = useRef(false);
  const previousQuery = useRef(filters.q);
  const queryId = useId();
  const listboxId = `${queryId}-suggestions`;
  const hintId = `${queryId}-hint`;
  const errorId = `${queryId}-error`;

  const [query, setQuery] = useState(filters.q);
  const [source, setSource] = useState(filters.source);
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const [sort, setSort] = useState<ArticleSearchFilters["sort"]>(filters.sort);
  const [suggestions, setSuggestions] = useState<EsgArticleSearchItem[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionState, setSuggestionState] = useState<SuggestionState>("idle");
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [compositionEndNonce, setCompositionEndNonce] = useState(0);

  const trimmedQuery = query.trim();
  const queryTooShort = trimmedQuery.length > 0 && trimmedQuery.length < MIN_QUERY_LENGTH;
  const queryTooLong = trimmedQuery.length > MAX_QUERY_LENGTH;
  const activeSuggestionId =
    activeSuggestion >= 0 && suggestions[activeSuggestion]
      ? `${listboxId}-option-${suggestions[activeSuggestion].id}`
      : undefined;

  const hasSuggestionOptions = suggestionsOpen && suggestionState === "ready" && suggestions.length > 0;

  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("sort")) {
      sortTouched.current = true;
    }
  }, []);

  useEffect(() => {
    const wasEmpty = previousQuery.current.trim().length === 0;
    if (wasEmpty && query.trim() && !sortTouched.current && filters.sort === "newest") {
      setSort("relevance");
    }
    previousQuery.current = query;
  }, [filters.sort, query]);

  useEffect(() => {
    setQuery(filters.q);
    setSource(filters.source);
    setFrom(filters.from);
    setTo(filters.to);
    setSort(filters.sort);
    escapedQuery.current = null;
  }, [filters.from, filters.q, filters.sort, filters.source, filters.to]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        inputFocused.current = false;
        dismissedQuery.current = query.trim();
        setSuggestionsOpen(false);
        setActiveSuggestion(-1);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [query]);

  useEffect(() => {
    requestGeneration.current += 1;
    const generation = requestGeneration.current;
    abortController.current?.abort();
    abortController.current = null;

    const value = query.trim();
    const forceOpen = forceRetryRequest.current;
    forceRetryRequest.current = false;
    setActiveSuggestion(-1);
    setSuggestions([]);
    setSuggestionError(null);

    if (
      value.length < MIN_QUERY_LENGTH ||
      value.length > MAX_QUERY_LENGTH ||
      escapedQuery.current === value ||
      (dismissedQuery.current === value && !forceOpen) ||
      isComposing.current ||
      (!inputFocused.current && !forceOpen)
    ) {
      setSuggestionState("idle");
      if (value.length < MIN_QUERY_LENGTH || value.length > MAX_QUERY_LENGTH) {
        setSuggestionsOpen(false);
      }
      return;
    }

    setSuggestionState("loading");
    setSuggestionsOpen(true);
    const timeout = window.setTimeout(async () => {
      const controller = new AbortController();
      abortController.current = controller;
      const params = new URLSearchParams({ q: value, suggest: "1" });
      if (source) params.set("source", source);
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      try {
        const response = await fetch(`/api/esg/articles/search?${params.toString()}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        const payload = (await response.json().catch(() => null)) as ArticleSearchResponse | { error?: string } | null;

        if (generation !== requestGeneration.current) return;
        if (!response.ok) {
          throw new Error(
            payload && "error" in payload && payload.error
              ? payload.error
              : "Suggestions are unavailable right now.",
          );
        }

        setSuggestions(payload && "items" in payload ? payload.items.slice(0, SUGGESTION_LIMIT) : []);
        setSuggestionState("ready");
        if (forceOpen || (inputFocused.current && dismissedQuery.current !== value)) setSuggestionsOpen(true);
      } catch (error) {
        if (generation !== requestGeneration.current || controller.signal.aborted) return;
        setSuggestionState("error");
        setSuggestionError(error instanceof Error ? error.message : "Suggestions are unavailable right now.");
        if (forceOpen || (inputFocused.current && dismissedQuery.current !== value)) setSuggestionsOpen(true);
      } finally {
        if (generation === requestGeneration.current) abortController.current = null;
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controllerAbort(abortController, generation, requestGeneration);
    };
  }, [compositionEndNonce, from, query, retryNonce, source, to]);

  const currentFilters = useMemo<ArticleSearchFilters>(
    () => ({
      q: query,
      source,
      from,
      to,
      sort,
      page: 1,
    }),
    [from, query, sort, source, to],
  );

  const closeSuggestions = useCallback(() => {
    setSuggestionsOpen(false);
    setActiveSuggestion(-1);
  }, []);

  const navigateToSearch = useCallback(
    (nextFilters: ArticleSearchFilters) => {
      requestGeneration.current += 1;
      abortController.current?.abort();
      abortController.current = null;
      closeSuggestions();
      router.push(searchPath(nextFilters));
    },
    [closeSuggestions, router],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (isComposing.current) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    navigateToSearch(currentFilters);
  };

  const handleClear = () => {
    escapedQuery.current = null;
    dismissedQuery.current = null;
    setQuery("");
    setSuggestions([]);
    setSuggestionState("idle");
    navigateToSearch({ ...currentFilters, q: "", page: 1 });
    inputRef.current?.focus();
  };

  const selectSuggestion = (item: EsgArticleSearchItem) => {
    closeSuggestions();
    router.push(itemHref(item, { ...currentFilters, q: query }, query));
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing.current) return;
    if (event.key === "ArrowDown") {
      if (!suggestionsOpen && suggestions.length > 0 && suggestionState === "ready" && escapedQuery.current !== query.trim()) {
        dismissedQuery.current = null;
        setSuggestionsOpen(true);
      }
      if (suggestions.length === 0) return;
      event.preventDefault();
      setActiveSuggestion((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      if (!suggestionsOpen || suggestions.length === 0) return;
      event.preventDefault();
      setActiveSuggestion((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
      return;
    }
    if (event.key === "Enter" && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
      event.preventDefault();
      selectSuggestion(suggestions[activeSuggestion]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      escapedQuery.current = query.trim();
      requestGeneration.current += 1;
      abortController.current?.abort();
      abortController.current = null;
      closeSuggestions();
      return;
    }
    if (event.key === "Tab") {
      closeSuggestions();
    }
  };

  const handleQueryChange = (value: string) => {
    if (value.trim() !== escapedQuery.current) escapedQuery.current = null;
    if (value.trim() !== dismissedQuery.current) dismissedQuery.current = null;
    setQuery(value);
  };

  const handleFocus = () => {
    inputFocused.current = true;
    const value = query.trim();
    if (
      value.length >= MIN_QUERY_LENGTH &&
      value.length <= MAX_QUERY_LENGTH &&
      escapedQuery.current !== value
    ) {
      const wasDismissed = dismissedQuery.current === value;
      dismissedQuery.current = null;
      if (suggestions.length > 0 && suggestionState === "ready") {
        setSuggestionsOpen(true);
      } else if (suggestionState !== "error" || wasDismissed) {
        setRetryNonce((current) => current + 1);
      }
    }
  };

  const handleInputBlur = (event: FocusEvent<HTMLInputElement>) => {
    const nextTarget = event.relatedTarget as Element | null;
    const movingToSuggestion = Boolean(nextTarget?.closest('[role="option"]'));
    const movingToRetry = Boolean(nextTarget?.closest("[data-search-retry]"));
    const movingToViewAll = Boolean(nextTarget?.closest("[data-search-view-all]"));
    if (!movingToSuggestion && !movingToRetry && !movingToViewAll) {
      inputFocused.current = false;
      dismissedQuery.current = query.trim();
      closeSuggestions();
    }
  };

  return (
    <div ref={rootRef} className="relative" data-testid="esg-article-search">
      <form
        method="get"
        action={pathname}
        role="search"
        onSubmit={handleSubmit}
        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_36px_-24px_rgba(15,23,42,0.5)] sm:p-5"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor={queryId} className="mb-2 block text-sm font-semibold text-slate-900">
              Search the ESG archive
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-emerald-700"
                aria-hidden="true"
              />
              <input
                ref={inputRef}
                id={queryId}
                name="q"
                type="text"
                value={query}
                maxLength={MAX_QUERY_LENGTH}
                autoComplete="off"
                placeholder="Try climate disclosure, carbon markets, or governance"
                role="combobox"
                aria-autocomplete="list"
                aria-controls={hasSuggestionOptions ? listboxId : undefined}
                aria-expanded={hasSuggestionOptions}
                aria-activedescendant={hasSuggestionOptions ? activeSuggestionId : undefined}
                aria-describedby={suggestionError ? `${hintId} ${errorId}` : hintId}
                onFocus={handleFocus}
                onBlur={handleInputBlur}
                onChange={(event) => handleQueryChange(event.target.value)}
                onCompositionStart={() => {
                  isComposing.current = true;
                  requestGeneration.current += 1;
                  abortController.current?.abort();
                  abortController.current = null;
                  closeSuggestions();
                }}
                onCompositionEnd={(event) => {
                  isComposing.current = false;
                  handleQueryChange(event.currentTarget.value);
                  setCompositionEndNonce((current) => current + 1);
                }}
                onKeyDown={handleInputKeyDown}
                className="h-12 w-full rounded-xl border border-slate-300 bg-slate-50 pl-11 pr-11 text-sm text-slate-950 shadow-inner outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
              {query ? (
                <button
                  type="button"
                  onClick={handleClear}
                  className="absolute right-2.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1"
                  aria-label="Clear article search"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
              {suggestionsOpen ? (
                <div className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-24px_rgba(15,23,42,0.45)]">
                  {suggestionState === "loading" ? (
                    <div className="flex items-center gap-3 px-4 py-4 text-sm text-slate-600" role="status">
                      <Loader2 className="h-4 w-4 animate-spin text-emerald-700 motion-reduce:animate-none" aria-hidden="true" />
                      Looking across the archive…
                    </div>
                  ) : suggestionState === "error" ? (
                    <div className="flex items-center justify-between gap-3 px-4 py-4 text-sm text-rose-700" role="alert">
                      <span className="flex min-w-0 items-center gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span id={errorId} className="truncate">{suggestionError ?? "Suggestions are unavailable right now."}</span>
                      </span>
                      <button
                        type="button"
                        data-search-retry="true"
                        onClick={() => {
                          escapedQuery.current = null;
                          dismissedQuery.current = null;
                          forceRetryRequest.current = true;
                          inputFocused.current = true;
                          inputRef.current?.focus();
                          setRetryNonce((value) => value + 1);
                        }}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-semibold text-rose-800 transition hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-1"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        Retry
                      </button>
                    </div>
                  ) : (
                    <>
                      {suggestions.length === 0 ? (
                        <p className="px-4 py-4 text-sm text-slate-600" role="status">
                          No matching articles yet.
                        </p>
                      ) : (
                        <div id={listboxId} role="listbox" aria-label="Article suggestions" className="max-h-[min(26rem,60vh)] overflow-y-auto py-1">
                          {suggestions.map((item, index) => {
                            const meta = suggestionMeta(item);
                            return (
                              <a
                                key={item.id}
                                id={`${listboxId}-option-${item.id}`}
                                role="option"
                                aria-selected={index === activeSuggestion}
                                href={itemHref(item, { ...currentFilters, q: query }, query)}
                                onPointerDown={(event) => {
                                  if (event.pointerType === "touch") {
                                    event.preventDefault();
                                    selectSuggestion(item);
                                  }
                                }}
                                onClick={(event) => {
                                  event.preventDefault();
                                  selectSuggestion(item);
                                }}
                                className={`block border-l-2 px-4 py-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600 ${
                                  index === activeSuggestion
                                    ? "border-emerald-600 bg-emerald-50"
                                    : "border-transparent hover:bg-slate-50"
                                }`}
                              >
                                <span className="block break-words text-sm font-semibold leading-5 text-slate-900">
                                  <ArticleSearchHighlight text={item.title} query={query} />
                                </span>
                                {meta ? <span className="mt-1 block text-xs font-medium text-slate-500">{meta}</span> : null}
                                {item.snippet ? (
                                  <span className="mt-1 block line-clamp-2 text-xs leading-5 text-slate-600">
                                    <ArticleSearchHighlight text={item.snippet} query={query} />
                                  </span>
                                ) : null}
                              </a>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5">
                        <span className="text-[11px] uppercase tracking-[0.11em] text-slate-600">
                          Use ↑ ↓ to move · Enter to open · Esc to close
                        </span>
                        <button
                          type="button"
                          data-search-view-all="true"
                          onClick={() => navigateToSearch(currentFilters)}
                          className="text-xs font-semibold text-emerald-800 underline decoration-emerald-300 underline-offset-4 transition hover:text-emerald-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1"
                        >
                          View all results
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
            <p id={hintId} className="mt-2 text-xs leading-5 text-slate-500">
              {queryTooLong
                ? `Search terms can be at most ${MAX_QUERY_LENGTH} characters.`
                : queryTooShort
                  ? `Type ${MIN_QUERY_LENGTH - trimmedQuery.length} more character${MIN_QUERY_LENGTH - trimmedQuery.length === 1 ? "" : "s"} for suggestions.`
                  : `Suggestions start at ${MIN_QUERY_LENGTH} characters. Press Enter to search the full archive (up to ${MAX_QUERY_LENGTH} characters).`}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:w-[23rem] lg:grid-cols-[1fr_1fr]">
            <div>
              <label htmlFor={`${queryId}-source`} className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                Source
              </label>
              <div className="relative">
                <select
                  id={`${queryId}-source`}
                  name="source"
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  className="h-11 w-full appearance-none rounded-xl border border-slate-300 bg-slate-50 px-3 pr-9 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                >
                  <option value="">All sources</option>
                  {sources.map((sourceName) => (
                    <option key={sourceName} value={sourceName}>
                      {sourceName}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              </div>
            </div>
            <div>
              <label htmlFor={`${queryId}-sort`} className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
                Sort
              </label>
              <div className="relative">
                <select
                  id={`${queryId}-sort`}
                  name="sort"
                  value={sort}
                  onChange={(event) => {
                    sortTouched.current = true;
                    setSort(event.target.value as ArticleSearchFilters["sort"]);
                  }}
                  className="h-11 w-full appearance-none rounded-xl border border-slate-300 bg-slate-50 px-3 pr-9 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
                >
                  <option value="relevance">Relevant</option>
                  <option value="newest">Newest first</option>
                </select>
                {sort === "newest" ? (
                  <ArrowDownAZ className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                ) : (
                  <ArrowUp className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
                )}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={queryTooLong}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-50 lg:shrink-0"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            Search archive
          </button>
        </div>

        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label htmlFor={`${queryId}-from`} className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              From date
            </label>
            <input
              id={`${queryId}-from`}
              name="from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </div>
          <div>
            <label htmlFor={`${queryId}-to`} className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              To date
            </label>
            <input
              id={`${queryId}-to`}
              name="to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </div>
          <p className="text-xs leading-5 text-slate-500 sm:max-w-[15rem]">
            Leave dates blank to search the full archive. Filters apply when you submit.
          </p>
          <input type="hidden" name="page" value="1" />
        </div>
      </form>

    </div>
  );
}

function controllerAbort(
  controllerRef: { current: AbortController | null },
  generation: number,
  generationRef: { current: number },
) {
  if (generation === generationRef.current) {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }
}

export type { EsgArticleSearchProps };
