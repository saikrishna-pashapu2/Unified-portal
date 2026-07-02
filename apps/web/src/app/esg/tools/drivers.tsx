"use client";

import {
  Fragment,
  FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  BriefcaseBusiness,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  Globe2,
  History,
  Languages,
  Layers3,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
} from "lucide-react";
import type {
  EsgDriver,
  EsgDriverJobActivity,
  EsgDriverJobStatus,
  EsgDriverResult,
  EsgDriverSource,
} from "@/lib/esg-drivers/types";

interface DriverStatus {
  jobId: string;
  status: EsgDriverJobStatus;
  progress: number;
  stage: string;
  error: string | null;
  activity: EsgDriverJobActivity[];
}

interface HistoryItem {
  id: string;
  country: string;
  sector: string;
  language: string;
  status: EsgDriverJobStatus;
  progress: number;
  stage: string;
  error: string | null;
  latestActivity: EsgDriverJobActivity | null;
  driverCount: number;
  createdAt: string | null;
  completedAt: string | null;
}

type DriverViewMode = "deck" | "matrix";
type AccuracyLevel = "strong" | "checked" | "limited";
type DriverScreen = "home" | "new" | "detail";

interface AccuracyReview {
  level: AccuracyLevel;
  label: string;
  reasons: string[];
}

interface AccuracySummary {
  strong: number;
  checked: number;
  limited: number;
  flaggedDrivers: Array<{
    id: string;
    title: string;
    reasons: string[];
  }>;
}

const LANGUAGE_OPTIONS = ["English", "Russian", "Arabic"];

export default function EsgDriversTool() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentJobId = searchParams.get("jobId") || "";
  const requestedView = searchParams.get("view");
  const screen: DriverScreen = currentJobId
    ? "detail"
    : requestedView === "new"
      ? "new"
      : "home";

  const [country, setCountry] = useState("UAE");
  const [sector, setSector] = useState("Banking");
  const [language, setLanguage] = useState("English");
  const [jobId, setJobId] = useState("");
  const [status, setStatus] = useState<DriverStatus | null>(null);
  const [result, setResult] = useState<EsgDriverResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expandedDriverId, setExpandedDriverId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DriverViewMode>("deck");
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<HistoryItem | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRunning = Boolean(
    status && (status.status === "queued" || status.status === "processing"),
  );
  const isRtl = isRtlLanguage(result?.language || language);

  const evidenceById = useMemo(() => {
    const map = new Map<string, EsgDriverSource>();
    for (const source of result?.evidence || []) {
      map.set(source.id, source);
    }
    return map;
  }, [result]);

  const accuracySummary = useMemo(() => {
    if (!result) return null;
    return buildAccuracySummary(result.drivers, evidenceById);
  }, [result, evidenceById]);

  const safeSlideIndex = result
    ? Math.min(activeSlideIndex, Math.max(result.drivers.length - 1, 0))
    : 0;
  const activeDriver = result?.drivers[safeSlideIndex] || null;
  const activeDriverSources = useMemo(
    () => (activeDriver ? getDriverSources(activeDriver, evidenceById) : []),
    [activeDriver, evidenceById],
  );
  const activeAccuracyReview = useMemo(
    () => (activeDriver ? getAccuracyReview(activeDriver, activeDriverSources) : null),
    [activeDriver, activeDriverSources],
  );

  const navigateHome = useCallback(() => {
    router.push(makeDriversHref());
  }, [router]);

  const navigateNew = useCallback(() => {
    router.push(makeDriversHref({ view: "new" }));
  }, [router]);

  const navigateJob = useCallback(
    (id: string) => {
      router.push(makeDriversHref({ jobId: id }));
    },
    [router],
  );

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const response = await fetch("/api/esg/drivers/history", {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = await response.json();
      setHistory(Array.isArray(data.jobs) ? data.jobs : []);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const loadResult = useCallback(async (activeJobId: string) => {
    setError("");
    const response = await fetch(
      `/api/esg/drivers/result?jobId=${encodeURIComponent(activeJobId)}`,
      { cache: "no-store" },
    );
    const data = await response.json();

    if (!response.ok || !data.result) {
      throw new Error(data.error || "Result is not ready yet.");
    }

    setResult(data.result);
    setExpandedDriverId(null);
    setActiveSlideIndex(0);
    setViewMode("deck");
  }, []);

  const loadJob = useCallback(
    async (activeJobId: string) => {
      setLoadingJob(true);
      setError("");
      try {
        const response = await fetch(
          `/api/esg/drivers/status?jobId=${encodeURIComponent(activeJobId)}`,
          { cache: "no-store" },
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Unable to load job status.");
        }

        setJobId(activeJobId);
        setStatus(data);

        if (data.status === "done") {
          await loadResult(activeJobId);
        } else {
          setResult(null);
        }
      } catch (err: unknown) {
        setResult(null);
        setError(err instanceof Error ? err.message : "Failed to load job.");
      } finally {
        setLoadingJob(false);
      }
    },
    [loadResult],
  );

  const pollStatus = useCallback(
    async (activeJobId: string) => {
      const response = await fetch(
        `/api/esg/drivers/status?jobId=${encodeURIComponent(activeJobId)}`,
        { cache: "no-store" },
      );
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Unable to load job status.");
        return;
      }

      setStatus(data);

      if (data.status === "done") {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        await loadResult(activeJobId);
        void loadHistory();
        if (currentJobId !== activeJobId) navigateJob(activeJobId);
      }

      if (data.status === "error") {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setError(data.error || "Generation failed.");
        void loadHistory();
      }
    },
    [currentJobId, loadHistory, loadResult, navigateJob],
  );

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!currentJobId) {
      if (screen === "home") {
        setResult(null);
        setStatus(null);
        setJobId("");
        setError("");
      }
      return;
    }
    void loadJob(currentJobId);
  }, [currentJobId, loadJob, screen]);

  useEffect(() => {
    if (!jobId || !isRunning) return;

    pollRef.current = setInterval(() => {
      void pollStatus(jobId);
    }, 1600);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [jobId, isRunning, pollStatus]);

  useEffect(() => {
    if (!result) return;
    setActiveSlideIndex((current) =>
      Math.min(current, Math.max(result.drivers.length - 1, 0)),
    );
  }, [result]);

  async function startGeneration(event: FormEvent) {
    event.preventDefault();
    if (!country.trim() || !sector.trim() || !language.trim() || isRunning) return;

    setError("");
    setResult(null);
    setExpandedDriverId(null);
    setActiveSlideIndex(0);
    setStatus(null);

    try {
      const response = await fetch("/api/esg/drivers/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: country.trim(),
          sector: sector.trim(),
          language: language.trim(),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to start generation.");
      }

      setJobId(data.jobId);
      setStatus({
        jobId: data.jobId,
        status: data.job?.status || "queued",
        progress: data.job?.progress || 0,
        stage: data.job?.stage || "queued",
        error: null,
        activity: Array.isArray(data.job?.activity) ? data.job.activity : [],
      });
      navigateJob(data.jobId);
      void loadHistory();
      void pollStatus(data.jobId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start generation.");
    }
  }

  function openHistoryItem(item: HistoryItem) {
    setError(item.error || "");
    setJobId(item.id);
    setStatus({
      jobId: item.id,
      status: item.status,
      progress: item.progress,
      stage: item.stage,
      error: item.error,
      activity: item.latestActivity ? [item.latestActivity] : [],
    });
    navigateJob(item.id);
  }

  function requestDeleteHistoryItem(item: HistoryItem) {
    setHistoryError("");
    setDeleteCandidate(item);
  }

  async function deleteHistoryItem(item: HistoryItem) {
    if (deletingJobId) return;

    setHistoryError("");
    setDeletingJobId(item.id);

    try {
      const response = await fetch(
        `/api/esg/drivers/${encodeURIComponent(item.id)}`,
        {
          method: "DELETE",
          cache: "no-store",
        },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete driver pack.");
      }

      setHistory((current) => current.filter((job) => job.id !== item.id));
      setDeleteCandidate(null);

      if (jobId === item.id || currentJobId === item.id) {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        setJobId("");
        setStatus(null);
        setResult(null);
        setError("");
        navigateHome();
      }
    } catch (err: unknown) {
      setHistoryError(
        err instanceof Error ? err.message : "Failed to delete driver pack.",
      );
    } finally {
      setDeletingJobId("");
    }
  }

  return (
    <div className="min-h-[calc(100vh-65px)] bg-[#eef2ee] text-[#172019]">
      <DriversTopBar
        screen={screen}
        result={result}
        onBack={navigateHome}
        onNew={navigateNew}
      />

      {screen === "home" && (
        <DriversHome
          history={history}
          loadingHistory={loadingHistory}
          deletingJobId={deletingJobId}
          deleteError={historyError}
          onNew={navigateNew}
          onOpenHistoryItem={openHistoryItem}
          onDeleteHistoryItem={requestDeleteHistoryItem}
        />
      )}

      {screen === "new" && (
        <NewDriverPage
          country={country}
          sector={sector}
          language={language}
          status={status}
          error={error}
          isRunning={isRunning}
          onBack={navigateHome}
          onCountryChange={setCountry}
          onLanguageChange={setLanguage}
          onSectorChange={setSector}
          onSubmit={startGeneration}
        />
      )}

      {screen === "detail" && (
        <DriverDetailPage
          result={result}
          status={status}
          error={error}
          loadingJob={loadingJob}
          viewMode={viewMode}
          activeDriver={activeDriver}
          activeDriverSources={activeDriverSources}
          activeAccuracyReview={activeAccuracyReview}
          activeSlideIndex={safeSlideIndex}
          expandedDriverId={expandedDriverId}
          evidenceById={evidenceById}
          isRtl={isRtl}
          accuracySummary={accuracySummary}
          onBack={navigateHome}
          onNew={navigateNew}
          onSlideChange={setActiveSlideIndex}
          onViewModeChange={setViewMode}
          onExpandedDriverChange={setExpandedDriverId}
        />
      )}

      <DeleteDriverModal
        item={deleteCandidate}
        error={historyError}
        deleting={Boolean(deleteCandidate && deletingJobId === deleteCandidate.id)}
        onCancel={() => {
          if (deletingJobId) return;
          setDeleteCandidate(null);
          setHistoryError("");
        }}
        onConfirm={() => {
          if (deleteCandidate) void deleteHistoryItem(deleteCandidate);
        }}
      />
    </div>
  );
}

function DriversTopBar({
  screen,
  result,
  onBack,
  onNew,
}: {
  screen: DriverScreen;
  result: EsgDriverResult | null;
  onBack: () => void;
  onNew: () => void;
}) {
  return (
    <header className="border-b border-[#27352d] bg-[#101812] text-white">
      <div className="flex min-h-[86px] flex-col justify-between gap-4 px-5 py-4 xl:flex-row xl:items-center xl:px-7">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#9bc6a8]">
            <Layers3 className="h-4 w-4" />
            ESG Driver Studio
          </div>
          <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-white">
            {screen === "home"
              ? "Generated driver library"
              : screen === "new"
                ? "New driver pack"
                : result
                  ? `${result.country} / ${result.sector}`
                  : "Driver pack"}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {screen !== "home" && (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex h-10 items-center gap-2 rounded-[5px] border border-white/15 px-3 text-sm font-bold text-white transition hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" />
              History
            </button>
          )}
          <button
            type="button"
            onClick={onNew}
            className="inline-flex h-10 items-center gap-2 rounded-[5px] bg-[#d6ff66] px-4 text-sm font-bold text-[#101812] transition hover:bg-[#e4ff91]"
          >
            <Plus className="h-4 w-4" />
            New driver
          </button>
        </div>
      </div>
    </header>
  );
}

function DeleteDriverModal({
  item,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  item: HistoryItem | null;
  deleting: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#101812]/70 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-driver-title"
    >
      <div className="w-full max-w-[520px] overflow-hidden rounded-[8px] border border-[#26342d] bg-[#fbfcf8] shadow-[0_28px_90px_rgba(9,18,12,0.34)]">
        <div className="border-b border-[#d8e1d8] bg-[#172019] px-5 py-4 text-white">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[6px] bg-red-500/15 text-red-200">
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#d6ff66]">
                Delete driver pack
              </p>
              <h2
                id="delete-driver-title"
                className="mt-1 text-xl font-semibold tracking-tight"
              >
                Remove this generated deck?
              </h2>
            </div>
          </div>
        </div>

        <div className="px-5 py-5">
          <p className="text-sm leading-6 text-[#344139]">
            This will permanently delete the saved ESG driver pack for{" "}
            <span className="font-bold text-[#172019]">
              {item.country} / {item.sector}
            </span>
            . The generated drivers, evidence, and source trace will be removed
            from history.
          </p>

          <div className="mt-4 grid gap-2 rounded-[6px] border border-[#d9e1da] bg-white p-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="font-semibold text-[#68756c]">Language</span>
              <span className="font-bold text-[#172019]">{item.language}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="font-semibold text-[#68756c]">Created</span>
              <span className="font-bold text-[#172019]">
                {formatDate(item.createdAt)}
              </span>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-[6px] border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={deleting}
              className="inline-flex h-10 items-center justify-center rounded-[5px] border border-[#c7d1c9] px-4 text-sm font-bold text-[#344139] transition hover:border-[#172019] hover:bg-[#eef2ee] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={deleting}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[5px] bg-[#b8322b] px-4 text-sm font-bold text-white transition hover:bg-[#982820] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete pack
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DriversHome({
  history,
  loadingHistory,
  deletingJobId,
  deleteError,
  onNew,
  onOpenHistoryItem,
  onDeleteHistoryItem,
}: {
  history: HistoryItem[];
  loadingHistory: boolean;
  deletingJobId: string;
  deleteError: string;
  onNew: () => void;
  onOpenHistoryItem: (item: HistoryItem) => void;
  onDeleteHistoryItem: (item: HistoryItem) => void;
}) {
  const completed = history.filter((item) => item.status === "done").length;
  const failed = history.filter((item) => item.status === "error").length;
  const latest = history[0];

  return (
    <main className="px-5 py-6 xl:px-7">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-[8px] border border-[#222d25] bg-[#172019] p-6 text-white">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#d6ff66]">
            Driver history
          </p>
          <h2 className="mt-3 max-w-4xl text-3xl font-semibold leading-tight">
            Open previous ESG driver packs or start a fresh country-sector deck.
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-[#c8d8cc]">
            Each generated pack opens as a full driver page with slides, evidence,
            source links, and source details.
          </p>
          <button
            type="button"
            onClick={onNew}
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-[5px] bg-[#d6ff66] px-4 text-sm font-bold text-[#101812] transition hover:bg-[#e4ff91]"
          >
            <Sparkles className="h-4 w-4" />
            Generate new drivers
          </button>
        </div>

        <div className="grid gap-3 rounded-[8px] border border-[#cfd8d0] bg-[#fbfcf8] p-4">
          <MetricRow label="Total jobs" value={history.length} />
          <MetricRow label="Completed" value={completed} />
          <MetricRow label="Needs attention" value={failed} />
          <div className="border-t border-[#d8e0d9] pt-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#68756c]">
              Latest
            </p>
            <p className="mt-1 text-sm font-semibold text-[#172019]">
              {latest ? `${latest.country} / ${latest.sector}` : "No jobs yet"}
            </p>
            <p className="text-xs text-[#68756c]">
              {latest ? formatDate(latest.createdAt) : "Start with New driver"}
            </p>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-[#68756c]" />
            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-[#536156]">
              Generated drivers
            </h3>
          </div>
          {loadingHistory && <Loader2 className="h-4 w-4 animate-spin text-[#68756c]" />}
        </div>

        {deleteError && (
          <div className="mb-3 rounded-[6px] border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {deleteError}
          </div>
        )}

        {history.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-[#bfcac1] bg-[#fbfcf8] p-10 text-center">
            <FileText className="mx-auto h-9 w-9 text-[#748176]" />
            <p className="mt-3 text-lg font-semibold text-[#172019]">
              No generated driver packs yet
            </p>
            <p className="mt-1 text-sm text-[#68756c]">
              Create one from country, sector, and language.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {history.map((item) => (
              <article
                key={item.id}
                className="group rounded-[8px] border border-[#d7dfd8] bg-[#fbfcf8] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#172019] hover:shadow-[0_16px_45px_rgba(28,38,31,0.12)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenHistoryItem(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="truncate text-lg font-semibold text-[#172019]">
                      {item.country} / {item.sector}
                    </p>
                    <p className="mt-1 text-sm text-[#68756c]">
                      {item.language} - {formatDate(item.createdAt)}
                    </p>
                  </button>
                  <div className="flex flex-none items-center gap-2">
                    <StatusPill status={item.status} />
                    <button
                      type="button"
                      onClick={() => onDeleteHistoryItem(item)}
                      disabled={deletingJobId === item.id}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[5px] border border-[#d7dfd8] text-[#68756c] transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                      title="Delete driver pack"
                      aria-label={`Delete ${item.country} / ${item.sector} driver pack`}
                    >
                      {deletingJobId === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-2">
                  <SmallStat label="Drivers" value={item.driverCount || 0} />
                  <SmallStat label="Progress" value={item.progress || 0} suffix="%" />
                  <SmallStat
                    label="Done"
                    value={item.completedAt ? formatDate(item.completedAt) : "-"}
                  />
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-[#dbe3dc] pt-3 text-sm font-bold text-[#536156]">
                  <span className="min-w-0 truncate">
                    {item.latestActivity?.stage || item.stage || item.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenHistoryItem(item)}
                    className="inline-flex items-center gap-1 text-[#172019]"
                  >
                    Open
                    <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function NewDriverPage({
  country,
  sector,
  language,
  status,
  error,
  isRunning,
  onBack,
  onCountryChange,
  onLanguageChange,
  onSectorChange,
  onSubmit,
}: {
  country: string;
  sector: string;
  language: string;
  status: DriverStatus | null;
  error: string;
  isRunning: boolean;
  onBack: () => void;
  onCountryChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onSectorChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <main className="px-5 py-6 xl:px-7">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-[8px] border border-[#222d25] bg-[#fbfcf8] p-6">
          <button
            type="button"
            onClick={onBack}
            className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#536156] hover:text-[#172019]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to generated drivers
          </button>

          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#68756c]">
            New driver pack
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#172019]">
            Enter scope details
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#68756c]">
            The agent will research fresh ESG signals and generate the driver deck
            using the Excel-style archetypes.
          </p>

          <form onSubmit={onSubmit} className="mt-8 grid gap-4">
            <SetupField
              icon={<Globe2 className="h-4 w-4" />}
              label="Country"
              value={country}
              onChange={onCountryChange}
              placeholder="UAE"
              disabled={isRunning}
            />
            <SetupField
              icon={<BriefcaseBusiness className="h-4 w-4" />}
              label="Sector"
              value={sector}
              onChange={onSectorChange}
              placeholder="Banking"
              disabled={isRunning}
            />
            <SetupField
              icon={<Languages className="h-4 w-4" />}
              label="Language"
              value={language}
              onChange={onLanguageChange}
              placeholder="English"
              list="driver-languages"
              disabled={isRunning}
            />
            <datalist id="driver-languages">
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>

            <button
              type="submit"
              disabled={
                isRunning || !country.trim() || !sector.trim() || !language.trim()
              }
              className="mt-2 inline-flex h-12 w-fit items-center gap-2 rounded-[5px] bg-[#172019] px-5 text-sm font-bold text-white transition hover:bg-[#2a382e] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate driver pack
            </button>
          </form>
        </section>

        <aside className="rounded-[8px] border border-[#cfd8d0] bg-[#172019] p-5 text-white">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#d6ff66]">
            Generation status
          </p>
          {status ? (
	            <div className="mt-4">
	              <ProgressStrip status={status} />
	              <LiveActivityFeed
	                activity={status.activity}
	                className="mt-4"
	                tone="dark"
	              />
	              <p className="mt-4 text-sm leading-6 text-[#c8d8cc]">
	                When generation completes, the full driver page opens automatically.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-[#c8d8cc]">
              No active generation. Submit the details to start research and drafting.
            </p>
          )}

          {error && (
            <div className="mt-4 rounded-[5px] border border-red-300/40 bg-red-500/15 px-3 py-2 text-sm text-red-100">
              {error}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function DriverDetailPage({
  result,
  status,
  error,
  loadingJob,
  viewMode,
  activeDriver,
  activeDriverSources,
  activeAccuracyReview,
  activeSlideIndex,
  expandedDriverId,
  evidenceById,
  isRtl,
  accuracySummary,
  onBack,
  onNew,
  onSlideChange,
  onViewModeChange,
  onExpandedDriverChange,
}: {
  result: EsgDriverResult | null;
  status: DriverStatus | null;
  error: string;
  loadingJob: boolean;
  viewMode: DriverViewMode;
  activeDriver: EsgDriver | null;
  activeDriverSources: EsgDriverSource[];
  activeAccuracyReview: AccuracyReview | null;
  activeSlideIndex: number;
  expandedDriverId: string | null;
  evidenceById: Map<string, EsgDriverSource>;
  isRtl: boolean;
  accuracySummary: AccuracySummary | null;
  onBack: () => void;
  onNew: () => void;
  onSlideChange: (index: number) => void;
  onViewModeChange: (mode: DriverViewMode) => void;
  onExpandedDriverChange: (driverId: string | null) => void;
}) {
  if (loadingJob && !result && !status) {
    return <LoadingState label="Loading driver pack" />;
  }

  if (error && !result) {
    return (
      <main className="px-5 py-6 xl:px-7">
        <EmptyError error={error} onBack={onBack} onNew={onNew} />
      </main>
    );
  }

  if (!result || !activeDriver || !activeAccuracyReview) {
    return (
      <main className="px-5 py-6 xl:px-7">
        <PendingJob status={status} error={error} onBack={onBack} />
      </main>
    );
  }

  return (
    <main className="grid min-h-[calc(100vh-151px)] grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_360px]">
      <aside className="border-b border-[#d7ddd6] bg-[#f8faf5] lg:border-b-0 lg:border-r">
        <div className="sticky top-0 space-y-5 p-4 lg:max-h-[calc(100vh-88px)] lg:overflow-y-auto">
          <DeckBrief result={result} summary={accuracySummary} />
          <ViewToggle viewMode={viewMode} onViewModeChange={onViewModeChange} />
          <SlideRail
            drivers={result.drivers}
            evidenceById={evidenceById}
            activeSlideIndex={activeSlideIndex}
            onSlideChange={onSlideChange}
          />
        </div>
      </aside>

      <section className="min-w-0 bg-[#eef2ee]">
        {viewMode === "deck" ? (
          <DeckCanvas
            activeDriver={activeDriver}
            activeDriverSources={activeDriverSources}
            activeReview={activeAccuracyReview}
            activeSlideIndex={activeSlideIndex}
            drivers={result.drivers}
            isRtl={isRtl}
            showEmbeddedEvidence={false}
            onSlideChange={onSlideChange}
          />
        ) : (
          <DriversMatrix
            drivers={result.drivers}
            evidenceById={evidenceById}
            expandedDriverId={expandedDriverId}
            isRtl={isRtl}
            onExpandedDriverChange={onExpandedDriverChange}
          />
        )}
      </section>

      <aside className="border-t border-[#d7ddd6] bg-[#fbfcf8] 2xl:border-l 2xl:border-t-0">
        <EvidenceInspector
          driver={activeDriver}
          sources={activeDriverSources}
          review={activeAccuracyReview}
        />
      </aside>
    </main>
  );
}

function SetupField({
  icon,
  label,
  value,
  onChange,
  placeholder,
  disabled,
  list,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled: boolean;
  list?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#68756c]">
        {icon}
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-[5px] border border-[#cfd8d0] bg-white px-3 text-base font-semibold text-[#172019] outline-none transition focus:border-[#172019] focus:ring-2 focus:ring-[#d6ff66]/40"
        placeholder={placeholder}
        list={list}
        disabled={disabled}
      />
    </label>
  );
}

function ProgressStrip({ status }: { status: DriverStatus }) {
  const Icon =
    status.status === "done"
      ? CheckCircle2
      : status.status === "error"
        ? AlertCircle
        : Search;

  return (
    <div className="grid gap-2 rounded-[5px] border border-white/10 bg-white/[0.06] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-white">
          <Icon className="h-4 w-4 flex-none text-[#d6ff66]" />
          <span className="truncate">{status.stage}</span>
        </div>
        <span className="font-mono text-xs text-[#d6ff66]">{status.progress}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-[#d6ff66] transition-all"
          style={{ width: `${status.progress}%` }}
        />
      </div>
    </div>
  );
}

function LiveActivityFeed({
  activity,
  tone = "light",
  className = "",
}: {
  activity: EsgDriverJobActivity[];
  tone?: "light" | "dark";
  className?: string;
}) {
  const visibleActivity = activity.slice(-8).reverse();
  const isDark = tone === "dark";

  if (visibleActivity.length === 0) {
    return (
      <div
        className={`${className} rounded-[6px] border ${
          isDark
            ? "border-white/10 bg-white/[0.04] text-[#c8d8cc]"
            : "border-[#d7dfd8] bg-[#fbfcf8] text-[#68756c]"
        } p-3 text-sm`}
      >
        Waiting for agent activity.
      </div>
    );
  }

  return (
    <section
      className={`${className} rounded-[6px] border ${
        isDark ? "border-white/10 bg-white/[0.04]" : "border-[#d7dfd8] bg-[#fbfcf8]"
      } p-3`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p
          className={`text-[10px] font-bold uppercase tracking-[0.16em] ${
            isDark ? "text-[#d6ff66]" : "text-[#536156]"
          }`}
        >
          Agent activity
        </p>
        <span
          className={`font-mono text-[10px] ${
            isDark ? "text-[#9bb7a3]" : "text-[#7b897f]"
          }`}
        >
          live
        </span>
      </div>

      <ol className="space-y-2">
        {visibleActivity.map((event, index) => {
          const active = index === 0 && event.status !== "done" && event.status !== "error";
          return (
            <li key={event.id} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2">
              <span
                className={`mt-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full ${
                  active
                    ? "bg-[#d6ff66] text-[#172019]"
                    : isDark
                      ? "bg-white/10 text-[#d6ff66]"
                      : "bg-[#e7ede7] text-[#2f6f46]"
                }`}
              >
                {active ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3 w-3" />
                )}
              </span>
              <span className="min-w-0">
                <span
                  className={`block truncate text-sm font-semibold ${
                    isDark ? "text-white" : "text-[#172019]"
                  }`}
                >
                  {event.stage}
                </span>
                <span
                  className={`mt-0.5 flex items-center gap-2 text-[11px] ${
                    isDark ? "text-[#9fb3a6]" : "text-[#77867b]"
                  }`}
                >
                  <Clock3 className="h-3 w-3" />
                  {formatActivityTime(event.timestamp)}
                  <span className="font-mono">{event.progress}%</span>
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function DeckBrief({
  result,
  summary,
}: {
  result: EsgDriverResult;
  summary: AccuracySummary | null;
}) {
  return (
    <section>
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#6b786d]">
        Current driver
      </p>
      <h2 className="mt-2 text-xl font-semibold leading-tight text-[#172019]">
        {result.country} / {result.sector}
      </h2>
      <p className="mt-1 text-sm text-[#68756c]">
        Generated {formatDate(result.generatedAt)} - {result.language}
      </p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MetricTile label="Drivers" value={result.drivers.length} />
        <MetricTile label="Sources" value={result.evidence.length} />
        <MetricTile label="Avg" value={averageConfidence(result.drivers)} />
      </div>

      {summary && (
        <div className="mt-3 grid grid-cols-3 gap-1 text-center text-[11px] font-bold">
          <span className="rounded-[4px] bg-[#e0f5e6] px-2 py-1 text-[#16734a]">
            {summary.strong} strong
          </span>
          <span className="rounded-[4px] bg-[#fff0bf] px-2 py-1 text-[#8a5d00]">
            {summary.checked} checked
          </span>
          <span className="rounded-[4px] bg-[#ffe3e1] px-2 py-1 text-[#a33d35]">
            {summary.limited} limited
          </span>
        </div>
      )}
    </section>
  );
}

function MetricTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-l border-[#cdd6ce] pl-2">
      <p className="font-mono text-lg font-bold text-[#172019]">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#77867b]">
        {label}
      </p>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between border-b border-[#d8e0d9] pb-3">
      <span className="text-sm font-semibold text-[#536156]">{label}</span>
      <span className="font-mono text-2xl font-bold text-[#172019]">{value}</span>
    </div>
  );
}

function SmallStat({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number | string;
  suffix?: string;
}) {
  return (
    <div className="rounded-[5px] bg-[#eef2ee] px-2 py-2">
      <p className="truncate text-sm font-bold text-[#172019]">
        {value}
        {suffix}
      </p>
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#68756c]">
        {label}
      </p>
    </div>
  );
}

function ViewToggle({
  viewMode,
  onViewModeChange,
}: {
  viewMode: DriverViewMode;
  onViewModeChange: (mode: DriverViewMode) => void;
}) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-[6px] border border-[#cfd8d0] bg-white p-1">
      <button
        type="button"
        onClick={() => onViewModeChange("deck")}
        className={`inline-flex items-center justify-center gap-2 rounded-[4px] px-3 py-2 text-sm font-bold transition ${
          viewMode === "deck"
            ? "bg-[#172019] text-white"
            : "text-[#536156] hover:bg-[#edf2ed]"
        }`}
      >
        <BookOpen className="h-4 w-4" />
        Deck
      </button>
      <button
        type="button"
        onClick={() => onViewModeChange("matrix")}
        className={`inline-flex items-center justify-center gap-2 rounded-[4px] px-3 py-2 text-sm font-bold transition ${
          viewMode === "matrix"
            ? "bg-[#172019] text-white"
            : "text-[#536156] hover:bg-[#edf2ed]"
        }`}
      >
        <Table2 className="h-4 w-4" />
        Matrix
      </button>
    </div>
  );
}

function SlideRail({
  drivers,
  evidenceById,
  activeSlideIndex,
  onSlideChange,
}: {
  drivers: EsgDriver[];
  evidenceById: Map<string, EsgDriverSource>;
  activeSlideIndex: number;
  onSlideChange: (index: number) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#6b786d]">
          Driver sections
        </p>
        <span className="font-mono text-[11px] text-[#7a887d]">
          {activeSlideIndex + 1}/{drivers.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {drivers.map((driver, index) => {
          const review = getAccuracyReview(driver, getDriverSources(driver, evidenceById));
          const selected = index === activeSlideIndex;

          return (
            <button
              key={driver.id}
              type="button"
              onClick={() => onSlideChange(index)}
              className={`group grid w-full grid-cols-[28px_minmax(0,1fr)_auto] gap-2 rounded-[5px] border px-2 py-2 text-left transition ${
                selected
                  ? "border-[#172019] bg-[#172019] text-white"
                  : "border-[#d9e1da] bg-white text-[#172019] hover:border-[#6e8173]"
              }`}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-[4px] font-mono text-[11px] font-bold ${
                  selected ? "bg-white text-[#172019]" : "bg-[#eef2ee] text-[#667468]"
                }`}
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span
                  className={`block truncate text-[11px] font-bold uppercase tracking-[0.08em] ${
                    selected ? "text-[#d6ff66]" : "text-[#75857a]"
                  }`}
                >
                  {driver.driverSection}
                </span>
                <span className="mt-0.5 line-clamp-2 text-sm font-semibold leading-5">
                  {driver.driverTitle}
                </span>
              </span>
              <StatusDot review={review} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DeckCanvas({
  activeDriver,
  activeDriverSources,
  activeReview,
  activeSlideIndex,
  drivers,
  isRtl,
  showEmbeddedEvidence = true,
  onSlideChange,
}: {
  activeDriver: EsgDriver;
  activeDriverSources: EsgDriverSource[];
  activeReview: AccuracyReview;
  activeSlideIndex: number;
  drivers: EsgDriver[];
  isRtl: boolean;
  showEmbeddedEvidence?: boolean;
  onSlideChange: (index: number) => void;
}) {
  const previousDisabled = activeSlideIndex === 0;
  const nextDisabled = activeSlideIndex >= drivers.length - 1;
  const direction = isRtl ? "rtl" : "ltr";

  return (
    <div className="px-5 py-5 xl:px-7">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#627166]">
            <BookOpen className="h-4 w-4" />
            Driver {activeSlideIndex + 1} of {drivers.length}
          </div>
          <p className="mt-1 text-sm text-[#68756c]">
            {activeDriver.driverSection} / {activeDriver.driverType}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSlideChange(activeSlideIndex - 1)}
            disabled={previousDisabled}
            className="inline-flex h-10 items-center gap-2 rounded-[5px] border border-[#cfd8d0] bg-white px-3 text-sm font-bold text-[#172019] transition hover:border-[#172019] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </button>
          <button
            type="button"
            onClick={() => onSlideChange(activeSlideIndex + 1)}
            disabled={nextDisabled}
            className="inline-flex h-10 items-center gap-2 rounded-[5px] bg-[#172019] px-3 text-sm font-bold text-white transition hover:bg-[#2a382e] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <article className="mx-auto max-w-[980px] overflow-hidden rounded-[8px] border border-[#222d25] bg-[#fbfcf8] shadow-[0_24px_70px_rgba(28,38,31,0.18)]">
        <div className="p-6 md:p-8">
          <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-wrap gap-2">
              <SlideChip>{activeDriver.driverSection}</SlideChip>
              <SlideChip>{activeDriver.driverType}</SlideChip>
              {activeDriver.driverLogicId && (
                <SlideChip>{activeDriver.driverLogicId}</SlideChip>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <ConfidenceBadge value={activeDriver.confidence} />
              <AccuracyBadge review={activeReview} />
            </div>
          </div>

          <h2
            className="max-w-[820px] break-words text-[clamp(1.65rem,2.4vw,2.55rem)] font-semibold leading-[1.1] tracking-tight text-[#111812]"
            dir={direction}
          >
            {activeDriver.driverTitle}
          </h2>
          <p
            className="mt-6 max-w-[820px] text-[clamp(0.98rem,1.3vw,1.12rem)] leading-7 text-[#253029]"
            dir={direction}
          >
            {activeDriver.driverText}
          </p>

          <div className="mt-7 grid gap-5 border-t border-[#d9dfd8] pt-6 lg:grid-cols-2">
            <InfoBlock
              label="Evidence / KPI"
              value={activeDriver.evidenceKpi}
              direction={direction}
              strong
            />
            <InfoBlock
              label="Country / Sector relevance"
              value={activeDriver.countrySectorRelevance}
              direction={direction}
            />
          </div>

          <div className="mt-6 rounded-[6px] bg-[#172019] p-5 text-white">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.55fr)]">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#d6ff66]">
                  Logic
                </p>
                <p className="mt-2 text-sm leading-6 text-[#dce8df]">
                  {activeDriver.driverLogic || "Excel-style driver archetype"}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#d6ff66]">
                  Source strength
                </p>
                <p className="mt-2 text-sm leading-6 text-[#dce8df]">
                  Evidence, source links, and confidence checks are completed before
                  the driver is displayed.
                </p>
              </div>
            </div>
          </div>

          <footer className="mt-6 grid gap-4 border-t border-[#d9dfd8] pt-5 md:grid-cols-[minmax(0,1fr)_260px]">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#68756c]">
                Source names
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activeDriver.keySources.slice(0, 4).map((source) => (
                  <span
                    key={source}
                    className="max-w-full truncate rounded-[4px] bg-[#edf2ed] px-2 py-1 text-xs font-semibold text-[#253029]"
                  >
                    {source}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#68756c]">
                Footnotes
              </p>
              <SourceLinkList driver={activeDriver} />
            </div>
          </footer>
        </div>
      </article>

      {showEmbeddedEvidence && (
        <div className="mx-auto mt-4 max-w-[980px]">
          <EvidenceInspector
            driver={activeDriver}
            sources={activeDriverSources}
            review={activeReview}
          />
        </div>
      )}
    </div>
  );
}

function InfoBlock({
  label,
  value,
  direction,
  strong = false,
}: {
  label: string;
  value: string;
  direction: "ltr" | "rtl";
  strong?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#68756c]">
        {label}
      </p>
      <p
        className={`mt-2 text-sm leading-6 ${
          strong ? "font-semibold text-[#172019]" : "text-[#3e4941]"
        }`}
        dir={direction}
      >
        {value}
      </p>
    </div>
  );
}

function SlideChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[4px] border border-[#d7dfd6] bg-white px-2 py-1 text-xs font-bold text-[#344139]">
      {children}
    </span>
  );
}

function EvidenceInspector({
  driver,
  sources,
  review,
}: {
  driver: EsgDriver | null;
  sources: EsgDriverSource[];
  review: AccuracyReview | null;
}) {
  return (
    <div className="h-full bg-[#fbfcf8] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#6b786d]">
            Evidence inspector
          </p>
          <h3 className="mt-1 text-lg font-semibold text-[#172019]">
            {driver ? "Selected driver" : "No driver selected"}
          </h3>
        </div>
        {review && <AccuracyBadge review={review} />}
      </div>

      {driver ? (
        <div className="space-y-4">
          <div className="rounded-[6px] border border-[#d6ded7] bg-white p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#6b786d]">
              Driver
            </p>
            <p className="mt-2 text-sm font-semibold leading-5 text-[#172019]">
              {driver.driverTitle}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ConfidenceBadge value={driver.confidence} />
              <span className="rounded-[4px] bg-[#eef2ee] px-2 py-1 text-xs font-semibold text-[#536156]">
                {driver.lastChecked}
              </span>
            </div>
          </div>

          <SourceDetailGrid sources={sources} compact />
        </div>
      ) : (
        <div className="rounded-[6px] border border-dashed border-[#cfd8d0] bg-white px-4 py-8 text-sm leading-6 text-[#68756c]">
          Evidence snippets, source dates, and URLs appear here after a driver is
          selected.
        </div>
      )}
    </div>
  );
}

function DriversMatrix({
  drivers,
  evidenceById,
  expandedDriverId,
  isRtl,
  onExpandedDriverChange,
}: {
  drivers: EsgDriver[];
  evidenceById: Map<string, EsgDriverSource>;
  expandedDriverId: string | null;
  isRtl: boolean;
  onExpandedDriverChange: (driverId: string | null) => void;
}) {
  return (
    <div className="p-5 xl:p-7">
      <div className="mb-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#627166]">
        <Table2 className="h-4 w-4" />
        Driver matrix
      </div>
      <div className="overflow-hidden rounded-[8px] border border-[#cfd8d0] bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-[1500px] divide-y divide-[#dce3dc] text-sm">
            <thead className="bg-[#172019] text-white">
              <tr>
                {[
                  "Section",
                  "Type",
                  "Title",
                  "Driver Text",
                  "Relevance",
                  "Evidence/KPI",
                  "Sources",
                  "Links",
                  "Confidence",
                  "Checked",
                ].map((header) => (
                  <th
                    key={header}
                    className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-[0.1em] text-[#d6ff66]"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e5ebe5]">
              {drivers.map((driver) => {
                const expanded = expandedDriverId === driver.id;
                const sources = getDriverSources(driver, evidenceById);

                return (
                  <Fragment key={driver.id}>
                    <tr className="align-top hover:bg-[#f7faf6]">
                      <td className="w-44 px-3 py-3 font-semibold text-[#172019]">
                        <button
                          type="button"
                          onClick={() =>
                            onExpandedDriverChange(expanded ? null : driver.id)
                          }
                          className="inline-flex items-start gap-1 text-left"
                        >
                          {expanded ? (
                            <ChevronDown className="mt-0.5 h-4 w-4 text-[#637269]" />
                          ) : (
                            <ChevronRight className="mt-0.5 h-4 w-4 text-[#637269]" />
                          )}
                          {driver.driverSection}
                        </button>
                      </td>
                      <td className="w-36 px-3 py-3 text-[#536156]">
                        {driver.driverType}
                      </td>
                      <td
                        className="w-60 px-3 py-3 font-semibold text-[#172019]"
                        dir={isRtl ? "rtl" : "ltr"}
                      >
                        {driver.driverTitle}
                      </td>
                      <td
                        className="w-[300px] px-3 py-3 leading-6 text-[#344139]"
                        dir={isRtl ? "rtl" : "ltr"}
                      >
                        {driver.driverText}
                      </td>
                      <td
                        className="w-[260px] px-3 py-3 leading-6 text-[#536156]"
                        dir={isRtl ? "rtl" : "ltr"}
                      >
                        {driver.countrySectorRelevance}
                      </td>
                      <td
                        className="w-64 px-3 py-3 leading-6 text-[#344139]"
                        dir={isRtl ? "rtl" : "ltr"}
                      >
                        {driver.evidenceKpi}
                      </td>
                      <td className="w-52 px-3 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {driver.keySources.slice(0, 4).map((source) => (
                            <span
                              key={source}
                              className="rounded-[4px] bg-[#eef2ee] px-2 py-1 text-xs font-semibold text-[#536156]"
                            >
                              {source}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="w-60 px-3 py-3">
                        <SourceLinkList driver={driver} />
                      </td>
                      <td className="w-28 px-3 py-3">
                        <ConfidenceBadge value={driver.confidence} />
                      </td>
                      <td className="w-28 px-3 py-3 text-[#536156]">
                        {driver.lastChecked}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-[#f7faf6]">
                        <td colSpan={10} className="px-4 py-4">
                          <SourceDetailGrid sources={sources} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PendingJob({
  status,
  error,
  onBack,
}: {
  status: DriverStatus | null;
  error: string;
  onBack: () => void;
}) {
  return (
    <div className="rounded-[8px] border border-[#cfd8d0] bg-[#172019] p-6 text-white">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[#c8d8cc] hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to generated drivers
      </button>
      <h2 className="text-2xl font-semibold">
        {status?.status === "error" ? "Generation failed" : "Driver pack is processing"}
      </h2>
      <p className="mt-2 text-sm text-[#c8d8cc]">
        {status?.stage || "Waiting for job status."}
      </p>
	      {status && (
	        <div className="mt-5 space-y-4">
	          <ProgressStrip status={status} />
	          <LiveActivityFeed activity={status.activity} tone="dark" />
	        </div>
	      )}
      {error && (
        <div className="mt-5 rounded-[5px] border border-red-300/40 bg-red-500/15 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}
    </div>
  );
}

function EmptyError({
  error,
  onBack,
  onNew,
}: {
  error: string;
  onBack: () => void;
  onNew: () => void;
}) {
  return (
    <div className="rounded-[8px] border border-red-200 bg-white p-8">
      <AlertCircle className="h-8 w-8 text-red-600" />
      <h2 className="mt-4 text-2xl font-semibold text-[#172019]">
        Could not open driver pack
      </h2>
      <p className="mt-2 text-sm text-[#68756c]">{error}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 items-center gap-2 rounded-[5px] border border-[#cfd8d0] px-3 text-sm font-bold"
        >
          <ArrowLeft className="h-4 w-4" />
          History
        </button>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex h-10 items-center gap-2 rounded-[5px] bg-[#172019] px-3 text-sm font-bold text-white"
        >
          <Plus className="h-4 w-4" />
          New driver
        </button>
      </div>
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <main className="flex min-h-[420px] items-center justify-center">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#172019]" />
        <p className="mt-3 text-sm font-semibold text-[#536156]">{label}</p>
      </div>
    </main>
  );
}

function StatusPill({ status }: { status: EsgDriverJobStatus }) {
  const classes =
    status === "done"
      ? "bg-[#e0f5e6] text-[#16734a]"
      : status === "error"
        ? "bg-[#ffe3e1] text-[#a33d35]"
        : "bg-[#e6edf8] text-[#315a91]";

  return (
    <span className={`rounded-[4px] px-2 py-1 text-xs font-bold ${classes}`}>
      {status}
    </span>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const classes =
    value >= 75
      ? "bg-[#e0f5e6] text-[#16734a]"
      : value >= 55
        ? "bg-[#fff0bf] text-[#8a5d00]"
        : "bg-[#ffe3e1] text-[#a33d35]";

  return (
    <span className={`rounded-[4px] px-2 py-1 text-xs font-bold ${classes}`}>
      {value}
    </span>
  );
}

function AccuracyBadge({ review }: { review: AccuracyReview }) {
  const classes =
    review.level === "strong"
      ? "bg-[#e0f5e6] text-[#16734a]"
      : review.level === "checked"
        ? "bg-[#fff0bf] text-[#8a5d00]"
        : "bg-[#ffe3e1] text-[#a33d35]";
  const Icon = review.level === "strong" ? ShieldCheck : CheckCircle2;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[4px] px-2 py-1 text-xs font-bold ${classes}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {review.label}
    </span>
  );
}

function StatusDot({ review }: { review: AccuracyReview }) {
  const classes =
    review.level === "strong"
      ? "bg-[#33a766]"
      : review.level === "checked"
        ? "bg-[#d99a15]"
        : "bg-[#d94d42]";

  return <span className={`mt-1 h-2.5 w-2.5 rounded-full ${classes}`} />;
}

function SourceLinkList({ driver }: { driver: EsgDriver }) {
  return (
    <div className="mt-2 space-y-1" dir="ltr">
      {driver.sourceLinks.slice(0, 2).map((link, index) => (
        <a
          key={`${driver.id}-${link}`}
          href={link}
          target="_blank"
          rel="noreferrer"
          className="flex min-w-0 items-center gap-1 text-xs font-bold text-[#1f5fb8] hover:underline"
        >
          <ExternalLink className="h-3 w-3 flex-none" />
          <span className="truncate">
            {index + 1}. {sourceLinkLabel(link)}
          </span>
        </a>
      ))}
    </div>
  );
}

function SourceDetailGrid({
  sources,
  compact = false,
}: {
  sources: EsgDriverSource[];
  compact?: boolean;
}) {
  if (sources.length === 0) {
    return (
      <div className="rounded-[6px] border border-[#d6ded7] bg-white p-4 text-sm text-[#68756c]">
        No parsed source detail available.
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-3" : "grid gap-3 lg:grid-cols-2"}>
      {sources.map((source) => (
        <SourceDetail
          key={source.id}
          source={source}
          compact={compact}
          defaultExpanded={!compact}
        />
      ))}
    </div>
  );
}

function SourceDetail({
  source,
  compact = false,
  defaultExpanded = true,
}: {
  source: EsgDriverSource;
  compact?: boolean;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const snippet = readableSnippet(source);
  const panelId = `source-detail-${source.id.replace(/[^a-z0-9_-]/gi, "-")}`;

  return (
    <div className="overflow-hidden rounded-[6px] border border-[#d6ded7] bg-white">
      <div className="flex items-start gap-2 p-3">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="grid min-w-0 flex-1 grid-cols-[18px_minmax(0,1fr)] gap-2 text-left"
        >
          <span className="mt-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-[4px] bg-[#eef2ee] text-[#536156]">
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold leading-5 text-[#172019]">
              [{source.id}] {source.title}
            </span>
            <span className="mt-1 block text-xs text-[#68756c]">
              {source.domain} - Updated {sourceDisplayDate(source)}
            </span>
          </span>
        </button>
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-[5px] border border-[#cfd8d0] text-[#536156] hover:border-[#172019]"
          title="Open source"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {!expanded && compact && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mx-3 mb-3 flex w-[calc(100%-1.5rem)] items-center justify-between rounded-[5px] bg-[#f4f7f3] px-3 py-2 text-xs font-bold text-[#536156] transition hover:bg-[#eef2ee] hover:text-[#172019]"
        >
          <span>Show parsed evidence</span>
          <ChevronDown className="h-4 w-4" />
        </button>
      )}

      <div
        id={panelId}
        className={expanded ? "border-t border-[#e2e8e2] p-3 pt-3" : "hidden"}
      >
        <p className="text-sm leading-6 text-[#344139]">{snippet}</p>
        <p
          className="mt-3 line-clamp-2 break-all text-xs font-semibold text-[#1f5fb8]"
          dir="ltr"
        >
          {source.url}
        </p>
      </div>

      <div
        className={`grid grid-cols-3 gap-1 text-center text-[11px] font-bold text-[#536156] ${
          expanded ? "border-t border-[#edf2ed] p-3 pt-2" : "px-3 pb-3"
        }`}
      >
        <span className="rounded-[4px] bg-[#eef2ee] px-2 py-1">
          A {source.authorityScore}
        </span>
        <span className="rounded-[4px] bg-[#eef2ee] px-2 py-1">
          F {source.freshnessScore}
        </span>
        <span className="rounded-[4px] bg-[#eef2ee] px-2 py-1">
          R {source.relevanceScore}
        </span>
      </div>
    </div>
  );
}

function getDriverSources(
  driver: EsgDriver,
  evidenceById: Map<string, EsgDriverSource>,
): EsgDriverSource[] {
  const byRef = driver.sourceRefs
    .map((ref) => evidenceById.get(ref))
    .filter((source): source is EsgDriverSource => Boolean(source));

  if (byRef.length > 0) return byRef;

  return Array.from(evidenceById.values()).filter((source) =>
    driver.sourceLinks.includes(source.url),
  );
}

function buildAccuracySummary(
  drivers: EsgDriver[],
  evidenceById: Map<string, EsgDriverSource>,
): AccuracySummary {
  const summary: AccuracySummary = {
    strong: 0,
    checked: 0,
    limited: 0,
    flaggedDrivers: [],
  };

  for (const driver of drivers) {
    const review = getAccuracyReview(driver, getDriverSources(driver, evidenceById));
    summary[review.level] += 1;

    if (review.level !== "strong") {
      summary.flaggedDrivers.push({
        id: driver.id,
        title: driver.driverTitle,
        reasons: review.reasons,
      });
    }
  }

  return summary;
}

function getAccuracyReview(
  driver: EsgDriver,
  sources: EsgDriverSource[],
): AccuracyReview {
  const reasons: string[] = [];
  reasons.push(...(driver.validationWarnings || []));
  const hasGenericSource = driver.keySources.some(isGenericSourceLabel);
  const hasSpecificEvidence = /\d|%|co2|co₂|scope|ifrs|issb|gri|ndc|net zero|cbam|2030|2040|2050/i.test(
    driver.evidenceKpi,
  );
  const broadProjection =
    /\b(projected|expected|survey|studies indicate|could lead|could result|market is)\b/i.test(
      driver.evidenceKpi,
    ) && !sources.some((source) => source.authorityScore >= 70);

  if (sources.length === 0) {
    reasons.push("no parsed source detail");
  }

  if (hasGenericSource) {
    reasons.push("generic source label");
  }

  if (!hasSpecificEvidence) {
    reasons.push("evidence/KPI is not specific");
  }

  if (broadProjection) {
    reasons.push("projection needs direct citation");
  }

  if (driver.confidence < 70) {
    reasons.push(`confidence ${driver.confidence}`);
  }

  const weakSourceMix =
    sources.length > 0 &&
    sources.every((source) => source.authorityScore < 60 && source.sourceScore < 60);
  if (weakSourceMix) {
    reasons.push("weak source mix");
  }

  const uniqueReasons = uniqueStrings(reasons);

  if (driver.confidence >= 80 && uniqueReasons.length === 0) {
    return { level: "strong", label: "Strong", reasons: [] };
  }

  if (
    driver.confidence < 70 ||
    hasGenericSource ||
    broadProjection ||
    uniqueReasons.length >= 2
  ) {
    return {
      level: "limited",
      label: "Limited",
      reasons: uniqueReasons.length > 0 ? uniqueReasons : ["source support is limited"],
    };
  }

  return {
    level: "checked",
    label: "Checked",
    reasons: uniqueReasons.length > 0 ? uniqueReasons : ["moderate confidence"],
  };
}

function isGenericSourceLabel(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    /^source\s*\d*$/.test(normalized) ||
    normalized === "research firm" ||
    normalized === "market research firm" ||
    normalized === "investment research firm" ||
    normalized === "climate research firm" ||
    normalized === "regulatory body" ||
    normalized === "industry body" ||
    normalized === "industry report" ||
    normalized === "consulting firm" ||
    normalized.includes("research firm")
  );
}

function readableSnippet(source: EsgDriverSource): string {
  const text = source.contentSnippet || source.snippet;
  const cleaned = text.replace(/\s+/g, " ").trim();

  if (!cleaned) return "No readable snippet was extracted. Open the source to inspect it.";
  if (isLikelyGarbled(cleaned)) {
    return "Preview unavailable because the source text could not be parsed cleanly. Open the original source to inspect the evidence.";
  }

  return cleaned.length > 620 ? `${cleaned.slice(0, 620).trim()}...` : cleaned;
}

function isLikelyGarbled(text: string): boolean {
  const sample = text.slice(0, 700);
  const oddChars = sample.match(/[^\w\s.,;:!?%$€£()+\-/"'&]/g)?.length || 0;
  const letters = sample.match(/[a-z]/gi)?.length || 0;
  const spaces = sample.match(/\s/g)?.length || 0;
  const replacement = sample.includes("�");

  return replacement || oddChars > sample.length * 0.16 || letters < 30 || spaces < 8;
}

function sourceDisplayDate(source: EsgDriverSource): string {
  return (
    source.updatedDate ||
    source.lastModified ||
    source.publishedDate ||
    source.retrievedAt.slice(0, 10) ||
    "unknown"
  );
}

function sourceLinkLabel(link: string): string {
  const host = getHostname(link);
  return host || link;
}

function getHostname(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function averageConfidence(drivers: EsgDriver[]): number {
  if (drivers.length === 0) return 0;
  return Math.round(
    drivers.reduce((sum, driver) => sum + driver.confidence, 0) / drivers.length,
  );
}

function makeDriversHref(params?: { view?: "new"; jobId?: string }): string {
  const search = new URLSearchParams({ tool: "drivers" });
  if (params?.view) search.set("view", params.view);
  if (params?.jobId) search.set("jobId", params.jobId);
  return `/esg/tools?${search.toString()}`;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isRtlLanguage(language: string): boolean {
  return /arabic|ar\b|hebrew|urdu|persian|farsi/i.test(language);
}
