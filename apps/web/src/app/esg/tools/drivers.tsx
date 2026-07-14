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
  Download,
  ExternalLink,
  FileText,
  Globe2,
  History,
  Languages,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
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
import {
  ESG_DRIVER_COUNTRY_OPTIONS,
  ESG_DRIVER_SECTOR_OPTIONS,
} from "@/lib/esg-drivers/coverage";
import {
  canResumePartialDriverJob,
  driverPollRetryDelay,
  driverResumePath,
  isCancellableDriverJob,
  isCurrentDriverRequest,
  mergeDriverHistoryPage,
  shouldPollDriverJob,
  trackedDriverJobForScreen,
} from "./drivers-client";

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
  needsAttention: boolean;
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
  const [resultJobId, setResultJobId] = useState("");
  const [resultResumable, setResultResumable] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyCompleted, setHistoryCompleted] = useState(0);
  const [historyNeedsAttention, setHistoryNeedsAttention] = useState(0);
  const [expandedDriverId, setExpandedDriverId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DriverViewMode>("deck");
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [loadingJob, setLoadingJob] = useState(false);
  const [startingGeneration, setStartingGeneration] = useState(false);
  const [deletingJobId, setDeletingJobId] = useState("");
  const [exportingJobId, setExportingJobId] = useState("");
  const [resumingJobId, setResumingJobId] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<HistoryItem | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [historyLoadError, setHistoryLoadError] = useState("");
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const pollFailureCountRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const historyAbortRef = useRef<AbortController | null>(null);
  const historyEpochRef = useRef(0);
  const activeJobRef = useRef(currentJobId);
  const runningJobRef = useRef("");
  const requestEpochRef = useRef(0);

  const isRunning = Boolean(
    status && (status.status === "queued" || status.status === "processing"),
  );
  const shouldPoll = shouldPollDriverJob({
    jobId,
    status: status?.status,
    loadingJob,
    hasMatchingResult: Boolean(result && resultJobId === jobId),
  });
  const canRetryMissingDrivers = Boolean(
    result &&
      canResumePartialDriverJob({
        completion: result.completion,
        status: status?.status,
        jobId: currentJobId || jobId,
        resultJobId,
        resumable: resultResumable,
      }),
  );
  const isRtl = isRtlLanguage(result?.language || language);

  useEffect(() => {
    runningJobRef.current = isRunning ? jobId : "";
  }, [isRunning, jobId]);

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

  // Drivers are shown in the detail view ordered by confidence (highest first).
  // The raw `result` order is left untouched for export/history.
  const sortedDrivers = useMemo(
    () =>
      result
        ? [...result.drivers].sort(
            (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
          )
        : [],
    [result],
  );

  const safeSlideIndex = result
    ? Math.min(activeSlideIndex, Math.max(sortedDrivers.length - 1, 0))
    : 0;
  const activeDriver = sortedDrivers[safeSlideIndex] || null;
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

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    pollFailureCountRef.current = 0;
  }, []);

  const loadHistory = useCallback(
    async (options: { append?: boolean; cursor?: string | null } = {}) => {
      const append = Boolean(options.append && options.cursor);
      historyAbortRef.current?.abort();
      const controller = new AbortController();
      historyAbortRef.current = controller;
      const requestEpoch = historyEpochRef.current + 1;
      historyEpochRef.current = requestEpoch;
      if (append) {
        setLoadingHistory(false);
        setLoadingMoreHistory(true);
      } else {
        setLoadingMoreHistory(false);
        setLoadingHistory(true);
      }
      setHistoryLoadError("");

      try {
        const params = new URLSearchParams({ limit: "20" });
        if (append && options.cursor) params.set("cursor", options.cursor);
        const response = await fetch(`/api/esg/drivers/history?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Unable to load driver history.");
        }
        if (controller.signal.aborted || requestEpoch !== historyEpochRef.current) {
          return;
        }

        const jobs: HistoryItem[] = Array.isArray(data.jobs) ? data.jobs : [];
        setHistory((current) => {
          if (!append) return jobs;
          return mergeDriverHistoryPage(current, jobs);
        });
        setHistoryNextCursor(
          typeof data.nextCursor === "string" && data.nextCursor ? data.nextCursor : null,
        );
        setHistoryTotal((current) =>
          Number.isFinite(Number(data.total))
            ? Math.max(0, Number(data.total))
            : append
              ? current + jobs.length
              : jobs.length,
        );
        if (Number.isFinite(Number(data.completed))) {
          setHistoryCompleted(Math.max(0, Number(data.completed)));
        }
        if (Number.isFinite(Number(data.needsAttention))) {
          setHistoryNeedsAttention(Math.max(0, Number(data.needsAttention)));
        }
      } catch (err: unknown) {
        if (controller.signal.aborted || requestEpoch !== historyEpochRef.current) {
          return;
        }
        setHistoryLoadError(
          err instanceof Error ? err.message : "Unable to load driver history.",
        );
      } finally {
        if (historyAbortRef.current === controller) {
          historyAbortRef.current = null;
          if (append) setLoadingMoreHistory(false);
          else setLoadingHistory(false);
        }
      }
    },
    [],
  );

  const loadResult = useCallback(
    async (
      activeJobId: string,
      options: { signal?: AbortSignal; requestEpoch?: number } = {},
    ): Promise<boolean> => {
      const response = await fetch(
        `/api/esg/drivers/result?jobId=${encodeURIComponent(activeJobId)}`,
        { cache: "no-store", signal: options.signal },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.result) {
        throw new Error(data.error || "Result is not ready yet.");
      }
      if (!isCurrentDriverRequest({
        activeJobId: activeJobRef.current,
        requestedJobId: activeJobId,
        activeEpoch: requestEpochRef.current,
        requestEpoch: options.requestEpoch,
        aborted: options.signal?.aborted,
      })) {
        return false;
      }

      setResult(data.result);
      setResultJobId(activeJobId);
      setResultResumable(data.resumable === true);
      setExpandedDriverId(null);
      setActiveSlideIndex(0);
      setViewMode("deck");
      setError("");
      return true;
    },
    [],
  );

  const loadJob = useCallback(
    async (activeJobId: string, requestEpoch: number, signal: AbortSignal) => {
      setLoadingJob(true);
      setError("");
      try {
        const response = await fetch(
          `/api/esg/drivers/status?jobId=${encodeURIComponent(activeJobId)}`,
          { cache: "no-store", signal },
        );
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || "Unable to load job status.");
        }
        if (!isCurrentDriverRequest({
          activeJobId: activeJobRef.current,
          requestedJobId: activeJobId,
          activeEpoch: requestEpochRef.current,
          requestEpoch,
          aborted: signal.aborted,
        })) {
          return;
        }

        setJobId(activeJobId);
        setStatus(data);

        if (data.status === "done") {
          try {
            await loadResult(activeJobId, { signal, requestEpoch });
          } catch (err: unknown) {
            if (!signal.aborted && activeJobRef.current === activeJobId) {
              setResult(null);
              setResultJobId("");
              setResultResumable(false);
              setError(
                err instanceof Error
                  ? `Generation completed, but the result could not be loaded: ${err.message}`
                  : "Generation completed, but the result could not be loaded.",
              );
            }
          }
        } else {
          setResult(null);
          setResultJobId("");
          setResultResumable(false);
          if (data.status === "error") {
            setError(data.error || "Generation failed.");
          } else if (data.status === "cancelled") {
            setError(data.error || "Generation was cancelled.");
          } else {
            setError("");
          }
        }
      } catch (err: unknown) {
        if (signal.aborted || requestEpoch !== requestEpochRef.current) return;
        setResult(null);
        setResultJobId("");
        setResultResumable(false);
        setError(err instanceof Error ? err.message : "Failed to load job.");
      } finally {
        if (requestEpoch === requestEpochRef.current) setLoadingJob(false);
      }
    },
    [loadResult],
  );

  const pollStatus = useCallback(
    async (activeJobId: string, signal: AbortSignal): Promise<boolean> => {
      const response = await fetch(
        `/api/esg/drivers/status?jobId=${encodeURIComponent(activeJobId)}`,
        { cache: "no-store", signal },
      );
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          if (activeJobRef.current === activeJobId) {
            setError(data.error || "Unable to load job status.");
          }
          return false;
        }
        throw new Error(data.error || "Unable to load job status.");
      }
      if (!isCurrentDriverRequest({
        activeJobId: activeJobRef.current,
        requestedJobId: activeJobId,
        activeEpoch: requestEpochRef.current,
        aborted: signal.aborted,
      })) {
        return false;
      }

      setStatus(data);

      if (data.status === "done") {
        try {
          const loaded = await loadResult(activeJobId, { signal });
          if (loaded) {
            void loadHistory();
            if (currentJobId !== activeJobId) navigateJob(activeJobId);
            return false;
          }
          return false;
        } catch (err: unknown) {
          if (!signal.aborted && activeJobRef.current === activeJobId) {
            setError(
              err instanceof Error
                ? `Generation completed, but the result could not be loaded: ${err.message}`
                : "Generation completed, but the result could not be loaded.",
            );
          }
          throw err;
        }
      }

      if (data.status === "error") {
        setError(data.error || "Generation failed.");
        void loadHistory();
        return false;
      }
      if (data.status === "cancelled") {
        setError(data.error || "Generation was cancelled.");
        void loadHistory();
        return false;
      }

      setError("");
      return true;
    },
    [currentJobId, loadHistory, loadResult, navigateJob],
  );

  useEffect(() => {
    if (screen === "home") void loadHistory();
    return () => historyAbortRef.current?.abort();
  }, [loadHistory, screen]);

  useEffect(() => {
    stopPolling();
    loadAbortRef.current?.abort();
    const requestEpoch = requestEpochRef.current + 1;
    requestEpochRef.current = requestEpoch;
    const trackedJobId = trackedDriverJobForScreen({
      routeJobId: currentJobId,
      screen,
      runningJobId: runningJobRef.current,
    });
    activeJobRef.current = trackedJobId;

    if (!currentJobId) {
      if (screen === "home") {
        setResult(null);
        setResultJobId("");
        setResultResumable(false);
        setStatus(null);
        setJobId("");
        setError("");
      } else {
        // Keep an already-running job observable while the setup screen is
        // open. This prevents the form from becoming permanently disabled
        // after its poll was stopped during navigation.
        activeJobRef.current = trackedJobId;
      }
      return;
    }
    const controller = new AbortController();
    loadAbortRef.current = controller;
    void loadJob(currentJobId, requestEpoch, controller.signal);
    return () => controller.abort();
  }, [currentJobId, loadJob, screen, stopPolling]);

  useEffect(() => {
    if (!jobId || !shouldPoll || activeJobRef.current !== jobId) {
      stopPolling();
      return;
    }

    let disposed = false;
    const runPoll = async () => {
      if (disposed || activeJobRef.current !== jobId) return;
      const controller = new AbortController();
      pollAbortRef.current = controller;
      let continuePolling = true;
      try {
        continuePolling = await pollStatus(jobId, controller.signal);
        pollFailureCountRef.current = 0;
      } catch (err: unknown) {
        if (!controller.signal.aborted && activeJobRef.current === jobId) {
          pollFailureCountRef.current += 1;
          setError(
            err instanceof Error
              ? `Status check failed; retrying: ${err.message}`
              : "Status check failed; retrying.",
          );
        }
      } finally {
        if (pollAbortRef.current === controller) pollAbortRef.current = null;
      }

      if (!disposed && continuePolling && activeJobRef.current === jobId) {
        const retryDelay = driverPollRetryDelay(pollFailureCountRef.current);
        pollRef.current = setTimeout(() => {
          void runPoll();
        }, retryDelay);
      }
    };

    pollRef.current = setTimeout(() => {
      void runPoll();
    }, 0);

    return () => {
      disposed = true;
      stopPolling();
    };
  }, [jobId, pollStatus, screen, shouldPoll, stopPolling]);

  useEffect(() => {
    if (!result) return;
    setActiveSlideIndex((current) =>
      Math.min(current, Math.max(result.drivers.length - 1, 0)),
    );
  }, [result]);

  async function startGeneration(event: FormEvent) {
    event.preventDefault();
    if (
      !country.trim() ||
      !sector.trim() ||
      !language.trim() ||
      isRunning ||
      startingGeneration
    ) {
      return;
    }

    setStartingGeneration(true);
    setError("");
    setResult(null);
    setResultJobId("");
    setResultResumable(false);
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

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to start generation.");
      }

      stopPolling();
      loadAbortRef.current?.abort();
      requestEpochRef.current += 1;
      activeJobRef.current = data.jobId;
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start generation.");
    } finally {
      setStartingGeneration(false);
    }
  }

  async function cancelActiveGeneration() {
    if (!jobId || deletingJobId) return;
    setDeletingJobId(jobId);
    setError("");
    try {
      const response = await fetch(
        `/api/esg/drivers/${encodeURIComponent(jobId)}`,
        { method: "DELETE", cache: "no-store" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Failed to cancel generation.");
      }
      setStatus((current) =>
        current ? { ...current, stage: "cancelling" } : current,
      );
      setError("Cancellation requested. The job will stop shortly.");
      void loadHistory();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to cancel generation.",
      );
    } finally {
      setDeletingJobId("");
    }
  }

  function openHistoryItem(item: HistoryItem) {
    stopPolling();
    loadAbortRef.current?.abort();
    requestEpochRef.current += 1;
    activeJobRef.current = item.id;
    setError(item.error || "");
    setResult(null);
    setResultJobId("");
    setResultResumable(false);
    setJobId(item.id);
    // Reflect the opened job's scope so the processing view shows the right
    // country/sector when a still-running job is reopened from history.
    if (item.country) setCountry(item.country);
    if (item.sector) setSector(item.sector);
    if (item.language) setLanguage(item.language);
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

      if (data.status === "cancelling") {
        setHistory((current) =>
          current.map((job) =>
            job.id === item.id ? { ...job, stage: "cancelling" } : job,
          ),
        );
        setDeleteCandidate(null);
        if (jobId === item.id || currentJobId === item.id) {
          setStatus((current) =>
            current ? { ...current, stage: "cancelling" } : current,
          );
          setError("Cancellation requested. The job will remain in history until it stops.");
        }
        void loadHistory();
        return;
      }

      setHistory((current) => current.filter((job) => job.id !== item.id));
      setHistoryTotal((current) => Math.max(0, current - 1));
      if (item.status === "done") {
        setHistoryCompleted((current) => Math.max(0, current - 1));
      }
      if (item.needsAttention) {
        setHistoryNeedsAttention((current) => Math.max(0, current - 1));
      }
      setDeleteCandidate(null);

      if (jobId === item.id || currentJobId === item.id) {
        stopPolling();
        activeJobRef.current = "";
        setJobId("");
        setStatus(null);
        setResult(null);
        setResultJobId("");
        setResultResumable(false);
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

  async function exportDriverPack() {
    const activeJobId = currentJobId || jobId;
    if (!activeJobId || exportingJobId) return;
    if (!result || resultJobId !== activeJobId) {
      setError("The displayed result does not match this job. Reload the job before exporting.");
      return;
    }

    setError("");
    setExportingJobId(activeJobId);

    try {
      const response = await fetch(
        `/api/esg/drivers/${encodeURIComponent(activeJobId)}/export`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to export driver pack.");
      }

      const blob = await response.blob();
      const filename =
        parseDownloadFilename(response.headers.get("content-disposition")) ||
        buildFallbackExportFilename(result, activeJobId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to export driver pack.");
    } finally {
      setExportingJobId("");
    }
  }

  async function retryMissingDrivers() {
    const parentJobId = currentJobId || jobId;
    if (
      resumingJobId ||
      !result ||
      !canResumePartialDriverJob({
        completion: result.completion,
        status: status?.status,
        jobId: parentJobId,
        resultJobId,
        resumable: resultResumable,
      })
    ) {
      return;
    }

    setError("");
    setResumingJobId(parentJobId);

    try {
      const response = await fetch(driverResumePath(parentJobId), {
        method: "POST",
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Failed to retry missing drivers.");
      }

      const childJobId = typeof data.jobId === "string" ? data.jobId.trim() : "";
      if (!childJobId) {
        throw new Error("The retry job was created without a valid job ID.");
      }

      stopPolling();
      loadAbortRef.current?.abort();
      requestEpochRef.current += 1;
      activeJobRef.current = childJobId;
      setResult(null);
      setResultJobId("");
      setResultResumable(false);
      setExpandedDriverId(null);
      setActiveSlideIndex(0);
      setJobId(childJobId);
      setStatus({
        jobId: childJobId,
        status: data.job?.status || "queued",
        progress: data.job?.progress || 0,
        stage: data.job?.stage || "queued",
        error: null,
        activity: Array.isArray(data.job?.activity) ? data.job.activity : [],
      });
      navigateJob(childJobId);
      void loadHistory();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to retry missing drivers.");
    } finally {
      setResumingJobId("");
    }
  }

  return (
    <div className="min-h-[calc(100vh-65px)] bg-[#eef2ee] text-[#172019]">
      <DriversTopBar
        screen={screen}
        result={result}
        exporting={Boolean(exportingJobId)}
        onBack={navigateHome}
        onExport={exportDriverPack}
        onNew={navigateNew}
      />

      {screen === "home" && (
        <DriversHome
          history={history}
          historyTotal={historyTotal}
          historyCompleted={historyCompleted}
          historyNeedsAttention={historyNeedsAttention}
          nextCursor={historyNextCursor}
          loadingHistory={loadingHistory}
          loadingMoreHistory={loadingMoreHistory}
          deletingJobId={deletingJobId}
          deleteError={historyError}
          loadError={historyLoadError}
          onNew={navigateNew}
          onLoadMore={() =>
            void loadHistory({ append: true, cursor: historyNextCursor })
          }
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
          isRunning={isRunning || startingGeneration}
          starting={startingGeneration}
          canceling={Boolean(deletingJobId && deletingJobId === jobId)}
          onBack={navigateHome}
          onCancel={() => void cancelActiveGeneration()}
          onCountryChange={setCountry}
          onLanguageChange={setLanguage}
          onSectorChange={setSector}
          onSubmit={startGeneration}
        />
      )}

      {screen === "detail" && (
        <DriverDetailPage
          result={result}
          drivers={sortedDrivers}
          status={status}
          error={error}
          loadingJob={loadingJob}
          country={country}
          sector={sector}
          language={language}
          canceling={Boolean(deletingJobId && deletingJobId === jobId)}
          onCancel={() => void cancelActiveGeneration()}
          viewMode={viewMode}
          activeDriver={activeDriver}
          activeDriverSources={activeDriverSources}
          activeAccuracyReview={activeAccuracyReview}
          activeSlideIndex={safeSlideIndex}
          expandedDriverId={expandedDriverId}
          evidenceById={evidenceById}
          isRtl={isRtl}
          accuracySummary={accuracySummary}
          canRetryMissingDrivers={canRetryMissingDrivers}
          resumingMissingDrivers={Boolean(resumingJobId)}
          onBack={navigateHome}
          onNew={navigateNew}
          onRetryMissingDrivers={() => void retryMissingDrivers()}
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
  exporting,
  onBack,
  onExport,
  onNew,
}: {
  screen: DriverScreen;
  result: EsgDriverResult | null;
  exporting: boolean;
  onBack: () => void;
  onExport: () => void;
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
          {screen === "detail" && result && (
            <button
              type="button"
              onClick={onExport}
              disabled={exporting}
              className="inline-flex h-10 items-center gap-2 rounded-[5px] border border-white/15 px-3 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export Excel
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
  const isActive = isCancellableDriverJob(item.status);

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
                {isActive ? "Cancel generation" : "Delete driver pack"}
              </p>
              <h2
                id="delete-driver-title"
                className="mt-1 text-xl font-semibold tracking-tight"
              >
                {isActive ? "Stop this generation job?" : "Remove this generated deck?"}
              </h2>
            </div>
          </div>
        </div>

        <div className="px-5 py-5">
          <p className="text-sm leading-6 text-[#344139]">
            {isActive
              ? "This requests cancellation for the active ESG driver job for "
              : "This will permanently delete the saved ESG driver pack for "}
            <span className="font-bold text-[#172019]">
              {item.country} / {item.sector}
            </span>
            {isActive
              ? ". The job remains visible as cancelling until the worker confirms it stopped; you can then delete the cancelled record."
              : ". The generated drivers, evidence, and source trace will be removed from history."}
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
              {isActive ? "Cancel generation" : "Delete pack"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DriversHome({
  history,
  historyTotal,
  historyCompleted,
  historyNeedsAttention,
  nextCursor,
  loadingHistory,
  loadingMoreHistory,
  deletingJobId,
  deleteError,
  loadError,
  onNew,
  onLoadMore,
  onOpenHistoryItem,
  onDeleteHistoryItem,
}: {
  history: HistoryItem[];
  historyTotal: number;
  historyCompleted: number;
  historyNeedsAttention: number;
  nextCursor: string | null;
  loadingHistory: boolean;
  loadingMoreHistory: boolean;
  deletingJobId: string;
  deleteError: string;
  loadError: string;
  onNew: () => void;
  onLoadMore: () => void;
  onOpenHistoryItem: (item: HistoryItem) => void;
  onDeleteHistoryItem: (item: HistoryItem) => void;
}) {
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
          <MetricRow label="Total jobs" value={historyTotal} />
          <MetricRow label="Completed" value={historyCompleted} />
          <MetricRow label="Needs attention" value={historyNeedsAttention} />
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

        {loadError && (
          <div className="mb-3 rounded-[6px] border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            {loadError}
          </div>
        )}

        {!loadingHistory && !loadError && history.length === 0 ? (
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
          <>
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
            {nextCursor && (
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMoreHistory}
                  className="inline-flex h-10 items-center gap-2 rounded-[5px] border border-[#bfcac1] bg-[#fbfcf8] px-4 text-sm font-bold text-[#172019] transition hover:border-[#172019] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loadingMoreHistory && <Loader2 className="h-4 w-4 animate-spin" />}
                  Load older jobs
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Live processing page — the full-width "agent at work" experience.
// ---------------------------------------------------------------------------

type ProcessingSlotState =
  | "queued"
  | "researching"
  | "drafting"
  | "reviewing"
  | "accepted"
  | "omitted";

interface ProcessingSlot {
  number: number;
  section?: string;
  title?: string;
  state: ProcessingSlotState;
  confidence?: number;
}

const PROCESSING_SECTION_PLAN: Array<{
  section: string;
  label: string;
  quota: number;
}> = [
  { section: "Global Drivers", label: "Global Drivers", quota: 3 },
  { section: "Regulatory Requirements", label: "Regulatory", quota: 3 },
  { section: "Climate Risks", label: "Climate Risks", quota: 2 },
  { section: "Capital Markets", label: "Capital Markets", quota: 2 },
  { section: "Supply Chain", label: "Supply Chain", quota: 2 },
];

const PROCESSING_TOTAL_DRIVERS = PROCESSING_SECTION_PLAN.reduce(
  (sum, item) => sum + item.quota,
  0,
);

function slotStateFromKind(
  kind: EsgDriverActivityKindLike,
  outcome?: string,
): ProcessingSlotState | null {
  switch (kind) {
    case "accepted":
      return "accepted";
    case "omitted":
      return "omitted";
    case "review":
      return "reviewing";
    case "draft":
      return "drafting";
    case "search":
    case "search-results":
    case "source":
    case "selection":
    case "fallback":
      return "researching";
    default:
      return outcome === "running" ? "researching" : null;
  }
}

type EsgDriverActivityKindLike = NonNullable<
  EsgDriverJobActivity["detail"]
>["kind"];

interface ProcessingModel {
  slots: ProcessingSlot[];
  sections: Array<{
    section: string;
    label: string;
    quota: number;
    accepted: number;
    state: "queued" | "researching" | "in progress" | "needs source" | "covered";
  }>;
  stats: {
    searches: number;
    sourcesApproved: number;
    reviews: number;
    accepted: number;
  };
  acceptedCount: number;
  startedAt: number | null;
}

function deriveProcessingModel(activity: EsgDriverJobActivity[]): ProcessingModel {
  const slotMap = new Map<number, ProcessingSlot>();
  const approvedSourceUrls = new Set<string>();
  let searches = 0;
  let reviews = 0;
  let startedAt: number | null = null;

  for (const event of activity) {
    const parsed = Date.parse(event.timestamp);
    if (!Number.isNaN(parsed)) {
      startedAt = startedAt === null ? parsed : Math.min(startedAt, parsed);
    }
    const detail = event.detail;
    if (!detail) continue;
    if (detail.kind === "search") searches += 1;
    if (detail.kind === "review") reviews += 1;
    if (detail.kind === "source" && detail.outcome === "accepted") {
      for (const result of detail.results || []) {
        approvedSourceUrls.add(result.url || result.title);
      }
    }

    const number = detail.driverNumber;
    if (typeof number === "number" && number > 0) {
      const nextState = slotStateFromKind(detail.kind, detail.outcome);
      const existing = slotMap.get(number);
      const locked = existing?.state === "accepted" || existing?.state === "omitted";
      slotMap.set(number, {
        number,
        section: detail.section || existing?.section,
        title: detail.title || existing?.title,
        confidence:
          typeof detail.confidence === "number"
            ? detail.confidence
            : existing?.confidence,
        state: locked ? existing!.state : nextState || existing?.state || "queued",
      });
    }
  }

  const slots: ProcessingSlot[] = Array.from(
    { length: PROCESSING_TOTAL_DRIVERS },
    (_, index) =>
      slotMap.get(index + 1) || { number: index + 1, state: "queued" },
  );

  const sections = PROCESSING_SECTION_PLAN.map((plan) => {
    const sectionSlots = slots.filter((slot) => slot.section === plan.section);
    const accepted = sectionSlots.filter((slot) => slot.state === "accepted").length;
    const researching = sectionSlots.some((slot) => slot.state === "researching");
    const omitted = sectionSlots.some((slot) => slot.state === "omitted");
    const state =
      accepted >= plan.quota
        ? "covered"
        : researching
          ? "researching"
          : omitted
            ? "needs source"
            : accepted > 0
              ? "in progress"
              : "queued";
    return { ...plan, accepted, state } as ProcessingModel["sections"][number];
  });

  const acceptedCount = slots.filter((slot) => slot.state === "accepted").length;

  return {
    slots,
    sections,
    stats: {
      searches,
      sourcesApproved: approvedSourceUrls.size,
      reviews,
      accepted: acceptedCount,
    },
    acceptedCount,
    startedAt,
  };
}

function activityVisual(kind: EsgDriverActivityKindLike): {
  Icon: typeof Search;
  tone: string;
} {
  switch (kind) {
    case "selection":
      return { Icon: Layers3, tone: "text-[#8fb4ff]" };
    case "search":
    case "search-results":
      return { Icon: Search, tone: "text-[#8fb4ff]" };
    case "source":
      return { Icon: BookOpen, tone: "text-[#d6ff66]" };
    case "draft":
      return { Icon: FileText, tone: "text-[#e7c86b]" };
    case "review":
      return { Icon: ShieldCheck, tone: "text-[#7fd4a3]" };
    case "fallback":
      return { Icon: RefreshCw, tone: "text-[#e7c86b]" };
    case "accepted":
      return { Icon: CheckCircle2, tone: "text-[#a4f04a]" };
    case "omitted":
      return { Icon: AlertTriangle, tone: "text-[#f0a4a4]" };
    default:
      return { Icon: Sparkles, tone: "text-[#c8d8cc]" };
  }
}

function outcomeBadge(outcome?: string): { label: string; className: string } | null {
  switch (outcome) {
    case "accepted":
    case "passed":
      return {
        label: outcome,
        className: "border-[#a4f04a]/40 bg-[#a4f04a]/10 text-[#c4ff8a]",
      };
    case "rejected":
    case "failed":
      return {
        label: outcome,
        className: "border-[#f0a4a4]/40 bg-[#f0a4a4]/10 text-[#ffc4c4]",
      };
    case "found":
      return {
        label: "found",
        className: "border-[#8fb4ff]/40 bg-[#8fb4ff]/10 text-[#bcd3ff]",
      };
    case "warning":
      return {
        label: "warning",
        className: "border-[#e7c86b]/40 bg-[#e7c86b]/10 text-[#f5dd94]",
      };
    case "running":
      return {
        label: "running",
        className: "border-[#d6ff66]/40 bg-[#d6ff66]/10 text-[#d6ff66]",
      };
    default:
      return null;
  }
}

function relativeTimeLabel(timestamp: string, now: number): string {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return "";
  const seconds = Math.max(0, Math.round((now - parsed) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatElapsed(startedAt: number | null, now: number): string {
  if (startedAt === null) return "0:00";
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const SLOT_STATE_STYLE: Record<
  ProcessingSlotState,
  { label: string; dot: string; text: string }
> = {
  queued: { label: "Queued", dot: "bg-white/25", text: "text-[#8fa093]" },
  researching: { label: "Researching", dot: "bg-[#8fb4ff] animate-pulse", text: "text-[#bcd3ff]" },
  drafting: { label: "Drafting", dot: "bg-[#e7c86b] animate-pulse", text: "text-[#f5dd94]" },
  reviewing: { label: "Reviewing", dot: "bg-[#7fd4a3] animate-pulse", text: "text-[#a6ecc6]" },
  accepted: { label: "Accepted", dot: "bg-[#a4f04a]", text: "text-[#c4ff8a]" },
  omitted: { label: "No source", dot: "bg-[#f0a4a4]", text: "text-[#ffc4c4]" },
};

function ProgressRing({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <div className="relative h-[92px] w-[92px] flex-none">
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="7"
        />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="#d6ff66"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-lg font-bold text-white">{clamped}%</span>
      </div>
    </div>
  );
}

function ProcessingStatTile({
  label,
  value,
  Icon,
}: {
  label: string;
  value: string | number;
  Icon: typeof Search;
}) {
  return (
    <div className="rounded-[6px] border border-white/10 bg-white/[0.04] px-3.5 py-3">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#8fa093]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="mt-1 block font-mono text-xl font-bold text-white">
        {value}
      </span>
    </div>
  );
}

function ProcessingView({
  country,
  sector,
  language,
  status,
  error,
  starting,
  canceling,
  onCancel,
}: {
  country: string;
  sector: string;
  language: string;
  status: DriverStatus | null;
  error: string;
  starting: boolean;
  canceling: boolean;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const activity = useMemo(() => status?.activity ?? [], [status?.activity]);
  const model = useMemo(() => deriveProcessingModel(activity), [activity]);
  const progress = status?.progress ?? 0;
  const stage = status?.stage || (starting ? "Starting generation" : "Working");
  const isCancelling = status?.stage === "cancelling" || canceling;

  const timeline = useMemo(
    () => [...activity].slice(-80).reverse(),
    [activity],
  );
  const latest = timeline[0];

  return (
    <main className="px-5 py-6 xl:px-7">
      <div className="mx-auto max-w-[1400px] space-y-5">
        {/* Hero */}
        <section className="overflow-hidden rounded-[10px] border border-[#243026] bg-gradient-to-br from-[#101a13] to-[#172019] text-white">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
            <div className="flex items-center gap-4">
              <ProgressRing progress={progress} />
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#d6ff66]">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#d6ff66] opacity-70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[#d6ff66]" />
                  </span>
                  {isCancelling ? "Cancelling" : "Agent working"}
                </p>
                <h2 className="mt-1.5 truncate text-2xl font-semibold tracking-tight">
                  {stage}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <ScopeChip icon={<Globe2 className="h-3.5 w-3.5" />} value={country} />
                  <ScopeChip icon={<BriefcaseBusiness className="h-3.5 w-3.5" />} value={sector} />
                  <ScopeChip icon={<Languages className="h-3.5 w-3.5" />} value={language} />
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 font-mono text-[#c8d8cc]">
                    <Clock3 className="h-3.5 w-3.5" />
                    {formatElapsed(model.startedAt, now)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <span className="block font-mono text-2xl font-bold text-[#d6ff66]">
                  {model.acceptedCount}
                  <span className="text-base text-[#8fa093]">/{PROCESSING_TOTAL_DRIVERS}</span>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#8fa093]">
                  Drivers ready
                </span>
              </div>
              <button
                type="button"
                onClick={onCancel}
                disabled={canceling || isCancelling}
                className="inline-flex h-10 items-center gap-2 rounded-[5px] border border-red-300/30 bg-red-500/10 px-4 text-sm font-bold text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {canceling ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
                {isCancelling ? "Stopping…" : "Stop"}
              </button>
            </div>
          </div>

          {/* Progress bar */}
          <div className="px-6 py-4">
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#89c94a] to-[#d6ff66] transition-all duration-700 ease-out"
                style={{ width: `${Math.max(3, Math.min(100, progress))}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <ProcessingStatTile label="Searches" value={model.stats.searches} Icon={Search} />
              <ProcessingStatTile label="Sources kept" value={model.stats.sourcesApproved} Icon={BookOpen} />
              <ProcessingStatTile label="Reviews" value={model.stats.reviews} Icon={ShieldCheck} />
              <ProcessingStatTile label="Accepted" value={`${model.stats.accepted}/${PROCESSING_TOTAL_DRIVERS}`} Icon={CheckCircle2} />
            </div>
          </div>
        </section>

        {error && !isCancelling && (
          <div className="flex items-start gap-2 rounded-[8px] border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          {/* Live thinking timeline */}
          <section className="rounded-[10px] border border-[#243026] bg-[#101a13] text-white">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#d6ff66]">
                Agent activity
              </p>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#8fa093]">
                {activity.length} steps
              </span>
            </div>
            {latest && (
              <div className="border-b border-white/10 bg-white/[0.03] px-5 py-3">
                <p className="flex items-center gap-2 text-sm text-[#e7f0e8]">
                  <Loader2 className="h-4 w-4 flex-none animate-spin text-[#d6ff66]" />
                  <span className="truncate">
                    {latest.detail?.title || latest.stage}
                  </span>
                </p>
              </div>
            )}
            <div className="max-h-[620px] overflow-y-auto px-5 py-4">
              {timeline.length === 0 ? (
                <p className="flex items-center gap-2 py-8 text-sm text-[#8fa093]">
                  <Loader2 className="h-4 w-4 animate-spin text-[#d6ff66]" />
                  Waiting for the agent to begin research…
                </p>
              ) : (
                <ol className="relative space-y-1">
                  {timeline.map((event, index) => (
                    <ProcessingTimelineEvent
                      key={event.id || `${event.timestamp}-${index}`}
                      event={event}
                      now={now}
                      isLast={index === timeline.length - 1}
                    />
                  ))}
                </ol>
              )}
            </div>
          </section>

          {/* Overview column */}
          <div className="space-y-5">
            <section className="rounded-[10px] border border-[#243026] bg-[#101a13] p-5 text-white">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#d6ff66]">
                Section coverage
              </p>
              <div className="mt-3 space-y-2">
                {model.sections.map((section) => (
                  <ProcessingSectionRow key={section.section} section={section} />
                ))}
              </div>
            </section>

            <section className="rounded-[10px] border border-[#243026] bg-[#101a13] p-5 text-white">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#d6ff66]">
                Driver slots
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {model.slots.map((slot) => (
                  <ProcessingSlotCard key={slot.number} slot={slot} />
                ))}
              </div>
              <p className="mt-4 text-xs leading-5 text-[#8fa093]">
                The full driver page opens automatically when generation finishes.
              </p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function ScopeChip({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 font-semibold text-white">
      <span className="text-[#8fb49a]">{icon}</span>
      {value || "—"}
    </span>
  );
}

function ProcessingSectionRow({
  section,
}: {
  section: ProcessingModel["sections"][number];
}) {
  const pct = Math.min(100, Math.round((section.accepted / section.quota) * 100));
  const stateStyle: Record<string, string> = {
    covered: "text-[#c4ff8a]",
    researching: "text-[#bcd3ff]",
    "in progress": "text-[#f5dd94]",
    "needs source": "text-[#ffc4c4]",
    queued: "text-[#8fa093]",
  };
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-[#e7f0e8]">{section.label}</span>
        <span className={`font-mono ${stateStyle[section.state]}`}>
          {section.accepted}/{section.quota}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            section.state === "covered" ? "bg-[#a4f04a]" : "bg-[#d6ff66]/70"
          }`}
          style={{ width: `${Math.max(section.state === "queued" ? 0 : 6, pct)}%` }}
        />
      </div>
    </div>
  );
}

function ProcessingSlotCard({ slot }: { slot: ProcessingSlot }) {
  const style = SLOT_STATE_STYLE[slot.state];
  return (
    <div className="rounded-[6px] border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-bold text-[#8fa093]">
          D{slot.number}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
          <span className={`text-[10px] font-bold uppercase tracking-wider ${style.text}`}>
            {style.label}
          </span>
        </span>
      </div>
      <p className="mt-1.5 line-clamp-2 min-h-[2.2rem] text-[11px] leading-[1.1rem] text-[#c8d8cc]">
        {slot.title || (slot.section ? slot.section : "Awaiting selection")}
      </p>
      {typeof slot.confidence === "number" && slot.state === "accepted" && (
        <span className="mt-1 inline-block font-mono text-[10px] text-[#a4f04a]">
          {Math.round(slot.confidence)}% confidence
        </span>
      )}
    </div>
  );
}

function ProcessingTimelineEvent({
  event,
  now,
  isLast,
}: {
  event: EsgDriverJobActivity;
  now: number;
  isLast: boolean;
}) {
  const detail = event.detail;
  const kind = detail?.kind || "system";
  const { Icon, tone } = activityVisual(kind);
  const badge = outcomeBadge(detail?.outcome);
  const results = (detail?.results || []).slice(0, 4);
  const reasons = (detail?.reasons || []).slice(0, 3);

  return (
    <li className="relative flex gap-3 pb-4">
      {!isLast && (
        <span className="absolute left-[13px] top-7 h-[calc(100%-1rem)] w-px bg-white/10" />
      )}
      <span
        className={`relative z-10 flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full border border-white/10 bg-[#172019] ${tone}`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold leading-5 text-[#e7f0e8]">
            {detail?.title || event.stage}
          </p>
          <span className="mt-0.5 flex-none font-mono text-[10px] text-[#748076]">
            {relativeTimeLabel(event.timestamp, now)}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {typeof detail?.driverNumber === "number" && (
            <span className="rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-[#8fa093]">
              D{detail.driverNumber}
            </span>
          )}
          {detail?.section && (
            <span className="text-[10px] font-medium text-[#8fa093]">
              {detail.section}
            </span>
          )}
          {badge && (
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${badge.className}`}
            >
              {badge.label}
            </span>
          )}
          {typeof detail?.confidence === "number" && (
            <span className="font-mono text-[10px] text-[#a4f04a]">
              {Math.round(detail.confidence)}%
            </span>
          )}
        </div>

        {detail?.detail && (
          <p className="mt-1.5 text-xs leading-5 text-[#a9bcae]">{detail.detail}</p>
        )}

        {detail?.query && (
          <p className="mt-1.5 flex items-start gap-1.5 rounded-[4px] border border-white/10 bg-black/20 px-2 py-1 font-mono text-[11px] text-[#bcd3ff]">
            <Search className="mt-0.5 h-3 w-3 flex-none" />
            <span className="break-words">{detail.query}</span>
          </p>
        )}

        {results.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {results.map((result, index) => (
              <li
                key={`${result.url || result.title}-${index}`}
                className="flex items-center gap-1.5 text-[11px] text-[#c8d8cc]"
              >
                <span
                  className={`h-1 w-1 flex-none rounded-full ${
                    result.outcome === "accepted"
                      ? "bg-[#a4f04a]"
                      : result.outcome === "rejected"
                        ? "bg-[#f0a4a4]"
                        : "bg-white/30"
                  }`}
                />
                <span className="truncate">
                  {result.domain && (
                    <span className="text-[#8fb49a]">{result.domain} · </span>
                  )}
                  {result.title}
                </span>
              </li>
            ))}
          </ul>
        )}

        {reasons.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {reasons.map((reason, index) => (
              <li key={index} className="text-[11px] leading-4 text-[#c1a3a3]">
                — {reason}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function NewDriverPage({
  country,
  sector,
  language,
  status,
  error,
  isRunning,
  starting,
  canceling,
  onBack,
  onCancel,
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
  starting: boolean;
  canceling: boolean;
  onBack: () => void;
  onCancel: () => void;
  onCountryChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onSectorChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const jobActive =
    starting ||
    (status?.status === "queued" || status?.status === "processing");

  // While the agent is working, take over the full width with a dedicated
  // processing page instead of a cramped status sidebar.
  if (jobActive) {
    return (
      <ProcessingView
        country={country}
        sector={sector}
        language={language}
        status={status}
        error={error}
        starting={starting}
        canceling={canceling}
        onCancel={onCancel}
      />
    );
  }

  return (
    <main className="px-5 py-6 xl:px-7">
      <div className="mx-auto max-w-3xl">
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
              options={ESG_DRIVER_COUNTRY_OPTIONS}
              disabled={isRunning}
            />
            <SetupField
              icon={<BriefcaseBusiness className="h-4 w-4" />}
              label="Sector"
              value={sector}
              onChange={onSectorChange}
              placeholder="Banking"
              options={ESG_DRIVER_SECTOR_OPTIONS}
              disabled={isRunning}
            />
            <SetupField
              icon={<Languages className="h-4 w-4" />}
              label="Language"
              value={language}
              onChange={onLanguageChange}
              placeholder="English"
              options={LANGUAGE_OPTIONS}
              disabled={isRunning}
            />

            <p className="text-xs leading-5 text-[#68756c]">
              Type any country and sector. The agent builds the deck from the
              reviewed workbook sources — global drivers apply everywhere, and
              country- or sector-specific drivers are added when they match.
            </p>

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

          {error && (
            <div className="mt-6 flex items-start gap-2 rounded-[5px] border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
              <span>{error}</span>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function DriverDetailPage({
  result,
  drivers,
  status,
  error,
  loadingJob,
  country,
  sector,
  language,
  canceling,
  onCancel,
  viewMode,
  activeDriver,
  activeDriverSources,
  activeAccuracyReview,
  activeSlideIndex,
  expandedDriverId,
  evidenceById,
  isRtl,
  accuracySummary,
  canRetryMissingDrivers,
  resumingMissingDrivers,
  onBack,
  onNew,
  onRetryMissingDrivers,
  onSlideChange,
  onViewModeChange,
  onExpandedDriverChange,
}: {
  result: EsgDriverResult | null;
  drivers: EsgDriver[];
  status: DriverStatus | null;
  error: string;
  loadingJob: boolean;
  country: string;
  sector: string;
  language: string;
  canceling: boolean;
  onCancel: () => void;
  viewMode: DriverViewMode;
  activeDriver: EsgDriver | null;
  activeDriverSources: EsgDriverSource[];
  activeAccuracyReview: AccuracyReview | null;
  activeSlideIndex: number;
  expandedDriverId: string | null;
  evidenceById: Map<string, EsgDriverSource>;
  isRtl: boolean;
  accuracySummary: AccuracySummary | null;
  canRetryMissingDrivers: boolean;
  resumingMissingDrivers: boolean;
  onBack: () => void;
  onNew: () => void;
  onRetryMissingDrivers: () => void;
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
    const jobStatus = status?.status;
    // While the job is still running, show the full processing view (never the
    // legacy status panel). A finished job with the result still loading gets a
    // brief loading state; anything else is a terminal message.
    if (jobStatus === "queued" || jobStatus === "processing") {
      return (
        <ProcessingView
          country={country}
          sector={sector}
          language={language}
          status={status}
          error={error}
          starting={false}
          canceling={canceling}
          onCancel={onCancel}
        />
      );
    }
    if (jobStatus === "done") {
      return <LoadingState label="Loading driver pack" />;
    }
    return (
      <main className="px-5 py-6 xl:px-7">
        <EmptyError
          error={error || status?.stage || "Driver pack is not available."}
          onBack={onBack}
          onNew={onNew}
        />
      </main>
    );
  }

  const expectedDriverCount = result.expectedDriverCount ?? 12;
  const omittedDriverIds = (result.slotFailures || [])
    .map((failure) => failure.driverId)
    .join(", ");
  return (
    <main className="grid min-h-[calc(100vh-151px)] grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_360px]">
      <aside className="border-b border-[#d7ddd6] bg-[#f8faf5] lg:border-b-0 lg:border-r">
        <div className="sticky top-0 space-y-5 p-4 lg:max-h-[calc(100vh-88px)] lg:overflow-y-auto">
          <DeckBrief result={result} summary={accuracySummary} />
          <ViewToggle viewMode={viewMode} onViewModeChange={onViewModeChange} />
          <SlideRail
            drivers={drivers}
            evidenceById={evidenceById}
            activeSlideIndex={activeSlideIndex}
            onSlideChange={onSlideChange}
          />
        </div>
      </aside>

      <section className="min-w-0 bg-[#eef2ee]">
        {result.completion === "partial" && (
          <div className="border-b border-amber-300 bg-amber-50 px-5 py-3 text-sm text-amber-950">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-4xl leading-5">
                <span className="font-bold">Partial approved-source pack:</span>{" "}
                {result.drivers.length} of {expectedDriverCount} drivers were generated.
                {omittedDriverIds ? ` Omitted: ${omittedDriverIds}.` : ""} Every
                displayed driver passed the individual source and quality gates.
                {canRetryMissingDrivers && (
                  <span className="mt-1 block text-xs text-amber-800">
                    Retrying creates a new job and keeps this approved pack unchanged.
                  </span>
                )}
              </div>
              {canRetryMissingDrivers && (
                <button
                  type="button"
                  onClick={onRetryMissingDrivers}
                  disabled={resumingMissingDrivers}
                  className="inline-flex h-10 flex-none items-center justify-center gap-2 rounded-[5px] bg-[#172019] px-4 text-sm font-bold text-white transition hover:bg-[#2a382e] disabled:cursor-wait disabled:opacity-65"
                >
                  {resumingMissingDrivers ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {resumingMissingDrivers ? "Creating retry job" : "Retry missing drivers"}
                </button>
              )}
            </div>
          </div>
        )}
        {error && (
          <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}
        {viewMode === "deck" ? (
          <DeckCanvas
            activeDriver={activeDriver}
            activeDriverSources={activeDriverSources}
            activeReview={activeAccuracyReview}
            activeSlideIndex={activeSlideIndex}
            drivers={drivers}
            isRtl={isRtl}
            showEmbeddedEvidence={false}
            onSlideChange={onSlideChange}
          />
        ) : (
          <DriversMatrix
            drivers={drivers}
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
  options,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled: boolean;
  options?: readonly string[];
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#68756c]">
        {icon}
        {label}
      </span>
      {options ? (
        <>
          {/* Free text with suggestions: any country/sector is allowed; the
              reviewed options are offered as autocomplete hints only. */}
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            list={`${label}-options`}
            className="h-12 w-full rounded-[5px] border border-[#cfd8d0] bg-white px-3 text-base font-semibold text-[#172019] outline-none transition focus:border-[#172019] focus:ring-2 focus:ring-[#d6ff66]/40"
            placeholder={placeholder}
            disabled={disabled}
            aria-label={label}
            autoComplete="off"
          />
          <datalist id={`${label}-options`}>
            {options.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </>
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-12 w-full rounded-[5px] border border-[#cfd8d0] bg-white px-3 text-base font-semibold text-[#172019] outline-none transition focus:border-[#172019] focus:ring-2 focus:ring-[#d6ff66]/40"
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
    </label>
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
        <MetricTile
          label="Drivers"
          value={
            result.completion === "partial"
              ? `${result.drivers.length}/${result.expectedDriverCount ?? 12}`
              : result.drivers.length
          }
        />
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

function MetricTile({ label, value }: { label: string; value: number | string }) {
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
                  {driver.driverSection} / {driver.driverType}
                </span>
                <span className="mt-0.5 line-clamp-2 text-sm font-semibold leading-5">
                  {driver.driverTitle}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span
                  className={`font-mono text-[10px] font-bold ${
                    selected ? "text-[#d6ff66]" : "text-[#667468]"
                  }`}
                  title="Confidence"
                >
                  {Math.round(driver.confidence)}%
                </span>
                <StatusDot review={review} />
              </span>
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
            <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6b786d]">
              {driver.driverSection} / {driver.driverType}
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
                        <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#75857a]">
                          {driver.driverSection} / {driver.driverType}
                        </span>
                        <span className="mt-1 block">{driver.driverTitle}</span>
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
        : status === "cancelled"
          ? "bg-[#ece7f6] text-[#5f4c8a]"
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
            {source.approvalId && (
              <span className="mt-2 inline-flex rounded-[4px] bg-[#e0f5e6] px-2 py-1 text-[11px] font-bold text-[#16734a]">
                Approved source
              </span>
            )}
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

function parseDownloadFilename(contentDisposition: string | null): string {
  if (!contentDisposition) return "";
  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].replace(/^"|"$/g, ""));
    } catch {
      return utf8Match[1].replace(/^"|"$/g, "");
    }
  }

  const match = contentDisposition.match(/filename="([^"]+)"/i);
  return match?.[1] || "";
}

function buildFallbackExportFilename(
  result: EsgDriverResult | null,
  jobId: string,
): string {
  if (!result) return `esg-drivers-${jobId}.xlsx`;
  const generatedDate = result.generatedAt.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const parts = [
    "esg-drivers",
    result.country,
    result.sector,
    result.language,
    generatedDate,
    jobId.slice(0, 8),
  ]
    .map(slugifyFilenamePart)
    .filter(Boolean);
  return `${parts.join("-") || `esg-drivers-${jobId}`}.xlsx`;
}

function slugifyFilenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
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
