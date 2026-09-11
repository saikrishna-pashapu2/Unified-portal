"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { cellTranslationReason } from "./cell-feedback";
import WorkbookInspection from "./WorkbookInspection";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  LoaderCircle,
  Table2,
  ShieldCheck,
} from "lucide-react";
import type {
  CellView,
  ExcelJobView,
  Inspection,
  Selection,
  TableView,
} from "@/lib/xlsx-translator/types";

type Preview = {
  range: string;
  cells: Array<
    CellView & {
      translated: string;
      translationPending?: boolean;
      translationUnavailable?: boolean;
    }
  >;
  merges: string[];
  translationWarning?: string;
  unavailableCells?: number;
};
type LocalSelection = Selection & { columnText?: string };
type Plan = {
  selectionKey: string;
  selectedCells: number;
  protectedCells: number;
  uniqueTexts: number;
  characters: number;
  batches: number;
  maxRequests: number;
  examples: Array<{ text: string; context: string; language: string }>;
};
type Recovery = {
  key: string;
  maxRequests: number;
  pendingEntries: number;
  savedCells: number;
  exhaustedBatches: number;
};
type Addition = {
  key: string;
  targetLang: string;
  selections: Selection[];
  selectedCells: number;
  protectedCells: number;
  uniqueTexts: number;
  maxRequests: number;
  replacingCells: number;
};
const control =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-40 disabled:cursor-not-allowed";
const action =
  "rounded-lg bg-[#bd8425] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40";
const column = (n: number) => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
function position(a: string) {
  const m = /([A-Z]+)(\d+)/.exec(a);
  return m
    ? {
        row: Number(m[2]),
        col: Array.from(m[1]).reduce(
          (n, c) => n * 26 + c.charCodeAt(0) - 64,
          0,
        ),
      }
    : { row: 1, col: 1 };
}

async function request(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 45000);
  init?.signal?.addEventListener("abort", abort, { once: true });
  if (init?.signal?.aborted) abort();
  try {
    const r = await fetch(url, {
      cache: "no-store",
      ...init,
      signal: controller.signal,
    });
    const p = await r.json();
    if (!r.ok)
      throw Object.assign(new Error(p.error || "Request failed."), {
        status: r.status,
      });
    return p;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", abort);
  }
}

export default function ExcelTranslationClient({ jobId }: { jobId: string }) {
  const base = `/api/xlsx-translator/${encodeURIComponent(jobId)}`;
  const [job, setJob] = useState<ExcelJobView | null>(null),
    [inspection, setInspection] = useState<Inspection | null>(null);
  const [sheet, setSheet] = useState(""),
    [target, setTarget] = useState("Russian"),
    [selections, setSelections] = useState<LocalSelection[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null),
    [plan, setPlan] = useState<Plan | null>(null),
    [error, setError] = useState(""),
    [requestBusy, setBusy] = useState(false),
    [previewBusy, setPreviewBusy] = useState(false);
  const [row, setRow] = useState(1),
    [col, setCol] = useState(1),
    [mode, setMode] = useState<"original" | "translated" | "compare">(
      "original",
    );
  const [showHidden, setShowHidden] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [picked, setPicked] = useState<Selection[]>([]);
  const [addition, setAddition] = useState<Addition | null>(null);
  // Saved selections describe past work; the continuing chooser starts empty.
  const [nextSelections, setNextSelections] = useState<LocalSelection[]>([]);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [inspectionRevision, setInspectionRevision] = useState(0);
  const [focused, setFocused] = useState<string | null>(null);
  const [selectionInfo, setSelectionInfo] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [statusUncertain, setStatusUncertain] = useState(false);
  const busy = requestBusy || statusUncertain;
  const lastPreviewKey = useRef("");
  const confirmationRef = useRef<HTMLDivElement>(null);
  const selectionKey = JSON.stringify({ selections, target });
  const active = job?.status === "queued" || job?.status === "processing",
    draft = job?.status === "draft";
  const chooserSelections = draft ? selections : nextSelections;
  const canChoose = !busy && !active && (draft || !!job?.canExtend);
  const hasTranslation = job?.hasTranslation ?? job?.status === "completed";
  const sheetInfo = inspection?.sheets.find((s) => s.name === sheet);
  const max = position(sheetInfo?.range.split(":").at(-1) || "A1");
  const range = `${column(col)}${row}:${column(Math.min(col + 15, max.col))}${Math.min(row + 39, max.row)}`;
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setError("");
    void request(`${base}?view=inspect`, { signal: controller.signal })
      .then((p) => {
        if (!live) return;
        setJob(p.job);
        setTarget(p.job.targetLang);
        setInspection(p.inspection);
        setSelections(p.selections || []);
        setSheet(
          p.inspection.sheets.find((s: { hidden: boolean }) => !s.hidden)
            ?.name || p.inspection.sheets[0].name,
        );
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
      controller.abort();
    };
  }, [base, inspectionRevision]);
  useEffect(() => {
    if (!active && !statusUncertain) return;
    let live = true;
    let inFlight = false;
    const poll = () => {
      if (inFlight) return;
      inFlight = true;
      void request(statusUncertain ? `${base}?view=inspect` : base)
        .then((p) => {
          if (live) {
            const next = statusUncertain ? p.job : p;
            setJob(next);
            if (statusUncertain) {
              setSelections(p.selections || []);
              setPlan(null);
              setAddition(null);
              setRecovery(null);
              setPicked([]);
              setNextSelections([]);
              setFocused(null);
              setSelectionInfo("");
              setStatusUncertain(false);
              setPreviewRevision((n) => n + 1);
            }
            setStatusError("");
            if (next.status === "completed") setMode("translated");
          }
        })
        .catch(
          () =>
            live &&
            setStatusError(
              "Connection interrupted. Checking job status again automatically; saved results are retained.",
            ),
        )
        .finally(() => {
          inFlight = false;
        });
    };
    const timer = setInterval(poll, 3000);
    if (statusUncertain) poll();
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [base, active, statusUncertain]);
  useEffect(() => {
    setPlan(null);
  }, [selections, target]);
  useEffect(() => {
    if (!plan && !addition) return;
    confirmationRef.current?.scrollIntoView({ block: "nearest" });
    confirmationRef.current?.focus({ preventScroll: true });
  }, [plan, addition]);
  useEffect(() => {
    if (!sheet) return;
    const controller = new AbortController();
    const key = `${base}:${sheet}:${range}`;
    if (lastPreviewKey.current !== key) setPreview(null);
    lastPreviewKey.current = key;
    let retry: ReturnType<typeof setTimeout> | undefined;
    async function refresh(attempt = 0) {
      setPreviewBusy(true);
      if (!attempt) setPreviewError("");
      try {
        const next = await request(
          `${base}?view=preview&sheet=${encodeURIComponent(sheet)}&range=${range}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setPreview(next);
        setPreviewError("");
      } catch (e) {
        if (controller.signal.aborted) return;
        const code = (e as { status?: number }).status;
        if (
          attempt < 3 &&
          (!code || code >= 500 || code === 408 || code === 429)
        ) {
          setPreviewError(
            `Connection interrupted. Retrying preview (${attempt + 1}/3)…`,
          );
          retry = setTimeout(
            () => void refresh(attempt + 1),
            1000 * 2 ** attempt,
          );
        } else
          setPreviewError(
            "Could not refresh the preview. Saved results are retained; retry the preview without translating again.",
          );
      } finally {
        if (!controller.signal.aborted) setPreviewBusy(false);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      if (retry) clearTimeout(retry);
    };
  }, [
    base,
    sheet,
    range,
    job?.status,
    job?.usage?.completedBatches,
    job?.usage?.translatedCells,
    previewRevision,
  ]);
  useEffect(() => {
    if (!hasTranslation) setMode("original");
  }, [hasTranslation]);
  const changeSheet = (name: string) => {
    setAddition(null);
    setFocused(null);
    setSelectionInfo("");
    setSheet(name);
    setRow(1);
    setCol(1);
  };
  function editSelections(update: SetStateAction<LocalSelection[]>) {
    if (!canChoose) return;
    setPlan(null);
    setAddition(null);
    setPicked([]);
    setFocused(null);
    setSelectionInfo("");
    (draft ? setSelections : setNextSelections)(update);
  }
  const updateSelection = (original: LocalSelection, next: LocalSelection) =>
    editSelections((items) => items.map((s) => (s === original ? next : s)));
  const addSelection = (range: string) =>
    editSelections((items) =>
      items.some((s) => s.sheet === sheet && s.range === range)
        ? items
        : [...items, { sheet, range, sourceLanguage: "Auto" }],
    );
  async function post(which: string, scope = selections) {
    if (which === "resume" && !recovery) return;
    if (which === "start" && plan?.selectionKey !== selectionKey) {
      setError("Review the current selection before starting.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const p = await request(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: which,
          targetLang: target,
          selections: scope,
          confirmationKey: which === "resume" ? recovery?.key : undefined,
        }),
      });
      if (which === "plan")
        setPlan({
          ...p,
          selectionKey: JSON.stringify({ selections: scope, target }),
        });
      else if (which === "recovery-plan") setRecovery(p);
      else {
        if (which === "start" || which === "resume") {
          setJob((j) =>
            j
              ? { ...j, status: "queued", canExtend: false, canDownload: false }
              : j,
          );
          setPicked([]);
          setNextSelections([]);
          setFocused(null);
          setSelectionInfo("");
        }
        try {
          setJob(await request(base));
          setStatusError("");
        } catch {
          setStatusError(
            "Your action was accepted, but job status could not refresh. Checking again automatically; do not submit the translation again.",
          );
          setStatusUncertain(true);
        }
        if (which === "restore") setMode("original");
        if (which === "recheck") setMode("translated");
        setPlan(null);
        setRecovery(null);
      }
    } catch (e) {
      const code = (e as { status?: number }).status;
      if (
        ["start", "resume", "restore", "recheck", "cancel"].includes(which) &&
        (!code || code >= 500 || code === 408)
      ) {
        setStatusError(
          "The response was interrupted. Checking the saved job before allowing another action; no translation request will be repeated automatically.",
        );
        setStatusUncertain(true);
      } else setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  function selectCell(address: string, additive = false) {
    if (busy) return;
    const cell = preview?.cells.find((c) => c.address === address);
    setPlan(null);
    setFocused(address);
    setAddition(null);
    const reason = cellTranslationReason(
      cell,
      draft ? target : job?.targetLang || target,
    );
    if (reason || active || !(draft || job?.canExtend)) {
      setSelectionInfo(
        reason ||
          (active
            ? "This workbook is processing. You can select more cells when it finishes."
            : "Cell translation is not available for this job. Refresh after restarting the web app and worker."),
      );
      if (!additive) setPicked([]);
      return;
    }
    setSelectionInfo("");
    if (
      additive &&
      picked.length >= 200 &&
      !picked.some((s) => s.sheet === sheet && s.range === address)
    ) {
      setSelectionInfo(
        "Up to 200 cells can be selected at once. Translate this selection before selecting more.",
      );
      return;
    }
    setPicked((items) =>
      !additive
        ? [{ sheet, range: address, sourceLanguage: "Auto" }]
        : items.some((s) => s.sheet === sheet && s.range === address)
          ? items.filter((s) => s.sheet !== sheet || s.range !== address)
          : items.length >= 200
            ? items
            : [...items, { sheet, range: address, sourceLanguage: "Auto" }],
    );
  }
  async function reviewScope(scope: Selection[]) {
    if (!canChoose) return;
    if (draft) {
      setSelections(scope);
      await post("plan", scope);
      return;
    }
    setBusy(true);
    setError("");
    setAddition(null);
    setNextSelections(scope);
    try {
      setAddition(
        await request(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "addition-plan", selections: scope }),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not review selection.");
    } finally {
      setBusy(false);
    }
  }
  async function confirmAddition() {
    if (!addition || busy) return;
    setBusy(true);
    setError("");
    try {
      await request(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          selections: addition.selections,
          confirmationKey: addition.key,
        }),
      });
      setJob((j) =>
        j
          ? { ...j, status: "queued", canExtend: false, canDownload: false }
          : j,
      );
      setSelections((s) => [...s, ...addition.selections]);
      setPicked([]);
      setNextSelections([]);
      setFocused(null);
      setSelectionInfo("");
      setAddition(null);
      setRecovery(null);
      try {
        const refreshed = await request(`${base}?view=inspect`);
        setJob(refreshed.job);
        setSelections(refreshed.selections || []);
        setStatusError("");
      } catch {
        setStatusError(
          "Additional translation was accepted, but job status could not refresh. Checking again automatically; do not submit it again.",
        );
        setStatusUncertain(true);
      }
      setPicked([]);
      setAddition(null);
      setRecovery(null);
      setPreviewRevision((n) => n + 1);
    } catch (e) {
      const code = (e as { status?: number }).status;
      if (!code || code >= 500 || code === 408) {
        setStatusError(
          "The response was interrupted. Checking whether the addition was saved before allowing another action; no translation request will be repeated automatically.",
        );
        setStatusUncertain(true);
      } else
        setError(e instanceof Error ? e.message : "Could not add translation.");
    } finally {
      setBusy(false);
    }
  }
  const cells = useMemo(
    () => new Map(preview?.cells.map((c) => [c.address, c]) || []),
    [preview],
  );
  const merges = useMemo(() => {
    const anchors = new Map<string, { rows: number; cols: number }>(),
      covered = new Set<string>();
    for (const m of preview?.merges || []) {
      const [a, b] = m.split(":").map(position);
      anchors.set(`${column(a.col)}${a.row}`, {
        rows: b.row - a.row + 1,
        cols: b.col - a.col + 1,
      });
      for (let r = a.row; r <= b.row; r++)
        for (let c = a.col; c <= b.col; c++)
          if (r !== a.row || c !== a.col) covered.add(`${column(c)}${r}`);
    }
    return { anchors, covered };
  }, [preview]);
  if (!inspection || !job)
    return (
      <WorkbookInspection
        error={error}
        onRetry={() => {
          setError("");
          setInspectionRevision((n) => n + 1);
        }}
      />
    );
  return (
    <main className="min-h-screen bg-[#f3f0e8] text-slate-950">
      <header className="bg-[#132a33] px-6 py-7 text-white">
        <div className="w-full min-w-0">
          <Link
            href="/esg/tools/pdf-translator-2"
            className="inline-flex items-center gap-2 text-sm text-slate-300"
          >
            <ArrowLeft size={16} /> Translation workspace
          </Link>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.2em] text-[#f1ce84]">
                Excel ·{" "}
                {job.status === "draft"
                  ? "Select before translating"
                  : job.status}
              </p>
              <h1 className="mt-2 break-all font-serif text-2xl">
                {job.filename}
              </h1>
              <p className="mt-2 text-sm text-slate-300">
                {inspection.sheetCount} worksheets ·{" "}
                {inspection.formulaCount.toLocaleString()} formulas ·{" "}
                {inspection.mergeCount.toLocaleString()} merged ranges
              </p>
            </div>
            {job.canDownload && !preview?.unavailableCells && (
              <a
                href={`${base}?view=download`}
                className="inline-flex items-center gap-2 rounded-lg bg-[#e0b65f] px-4 py-3 font-bold text-[#132a33]"
              >
                <Download size={18} /> Download translated Excel
              </a>
            )}
          </div>
        </div>
      </header>
      <div className="w-full min-w-0 space-y-5 p-3 sm:p-5">
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </div>
        )}
        {!draft && (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            {selections.length > 0 && (
              <p className="mb-3 text-xs text-slate-600">
                Translation scope:{" "}
                {selections
                  .map(
                    (s) =>
                      `${s.sheet} · ${s.columns?.length ? "columns " + s.columns.map(column).join(", ") : "all columns in range"} · ${s.range}`,
                  )
                  .join("; ")}
                . Other columns remain unchanged.
              </p>
            )}
            <div className="flex flex-wrap justify-between gap-3">
              <p role="status" className="text-sm">
                {job.status === "completed" && preview?.unavailableCells
                  ? "Some selected cells need review. The original text is shown where saved translations are missing; a complete download is not available."
                  : job.message}
              </p>
              {active && (
                <button
                  disabled={busy}
                  onClick={() => void post("cancel")}
                  className={control}
                >
                  Cancel translation
                </button>
              )}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full bg-[#bd8425]"
                style={{ width: `${job.progress}%` }}
              />
            </div>
            {job.canRestoreDraft && (
              <button
                className={`${action} mt-3`}
                disabled={busy}
                onClick={() => void post("restore")}
              >
                Return to review — no API calls
              </button>
            )}
            {job.canRecheckSaved && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <button
                  className={control}
                  disabled={busy}
                  onClick={() => void post("recheck")}
                >
                  Recheck saved results — no API calls
                </button>
                <p className="mt-2 text-xs text-slate-600">
                  Checks existing responses with the current validation rules.
                  If all selected text passes, the download is finalized without
                  translating again. No extra requests or changes to past usage.
                </p>
              </div>
            )}
            {job.canReviewRecovery && !recovery && (
              <button
                className={`${control} mt-3`}
                disabled={busy}
                onClick={() => void post("recovery-plan")}
              >
                Review resume options — no API calls
              </button>
            )}
            {job.canReviewRecovery && recovery && (
              <div
                className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4"
                aria-label="Recovery confirmation"
              >
                <h2 className="font-serif text-lg">
                  Resume without repeating saved cells
                </h2>
                <p className="mt-2 text-sm">
                  Keep {recovery.savedCells} changed cells. Process{" "}
                  {recovery.pendingEntries} unresolved text entries with at most{" "}
                  {recovery.maxRequests} additional Luna requests. Normal API
                  charges apply.
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  This one-time recovery allows one extra request for each of
                  the {recovery.exhaustedBatches} already exhausted batches.
                  Other batches keep their original two-request limit. All
                  previous usage remains counted; completion is not guaranteed.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className={action}
                    disabled={busy}
                    onClick={() => void post("resume")}
                  >
                    Confirm paid recovery
                  </button>
                  <button
                    className={control}
                    disabled={busy}
                    onClick={() => setRecovery(null)}
                  >
                    Not now
                  </button>
                </div>
              </div>
            )}
            {job.usage && (
              <p className="mt-3 text-xs text-slate-500">
                {job.usage.requests} API requests ·{" "}
                {job.usage.inputTokens.toLocaleString()} input tokens ·{" "}
                {job.usage.outputTokens.toLocaleString()} output tokens ·{" "}
                {job.usage.translatedCells} changed cells. Token totals cover
                received responses; timed-out calls may still be billed.
              </p>
            )}
          </section>
        )}
        <section
          aria-label="Translation selection"
          className="rounded-2xl border border-slate-200 bg-[#fffdf8] p-5"
        >
          <fieldset disabled={!canChoose} className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <h2 className="font-serif text-2xl">
                  Choose what to translate
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {draft
                    ? "Only selected cells change. The complete workbook is retained in your download."
                    : active
                      ? "Translation is running. This chooser will be ready for your next selection when it finishes."
                      : job.canExtend
                        ? "Choose another worksheet, table or range in this workbook. Previous translations stay saved unless you select those cells again."
                        : "Selection is currently read-only. Resolve the job status above before adding more translations."}
                </p>
              </div>
              <label className="text-sm font-semibold">
                Target language
                <select
                  aria-label="Excel target language"
                  value={target}
                  disabled={!draft || busy}
                  aria-describedby={
                    !draft ? "workbook-fixed-target" : undefined
                  }
                  onChange={(e) => setTarget(e.target.value)}
                  className={`${control} ml-3`}
                >
                  {["Russian", "English", "Arabic"].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
                {!draft && (
                  <span
                    id="workbook-fixed-target"
                    className="mt-2 block text-xs font-normal text-slate-500"
                  >
                    Target language stays the same for this workbook.
                  </span>
                )}
              </label>
            </div>
            <details className="mt-4 rounded-lg bg-slate-100 p-3 text-xs text-slate-600">
              <summary className="cursor-pointer font-semibold">
                Workbook safeguards and limitations
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {inspection.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
                <li>
                  Exact workbook formatting is retained. Longer translations may
                  need row-height adjustment in Excel; no automatic shrinking is
                  applied.
                </li>
              </ul>
            </details>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="text-sm">
                Worksheet{" "}
                <select
                  aria-label="Worksheet to select tables"
                  value={sheet}
                  onChange={(e) => changeSheet(e.target.value)}
                  className={control}
                >
                  {inspection.sheets
                    .filter((s) => showHidden || !s.hidden || s.name === sheet)
                    .map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name}
                        {s.hidden ? " (hidden)" : ""}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-xs">
                <input
                  type="checkbox"
                  checked={showHidden}
                  onChange={(e) => setShowHidden(e.target.checked)}
                />{" "}
                Show hidden worksheets
              </label>
              <button
                onClick={() => sheetInfo && addSelection(sheetInfo.range)}
                className={control}
              >
                Select whole worksheet
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sheetInfo?.tables.map((t: TableView) => (
                <button
                  key={t.id}
                  onClick={() => {
                    addSelection(t.range);
                    const p = position(t.range.split(":")[0]);
                    setRow(p.row);
                    setCol(p.col);
                  }}
                  className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-amber-500"
                >
                  <div className="flex items-center gap-2">
                    <Table2 size={17} className="text-[#9a6718]" />
                    <span className="truncate text-sm font-semibold">
                      {t.label}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-xs">
                    {t.range} · {t.rows.toLocaleString()} rows × {t.columns}{" "}
                    columns
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {Object.entries(t.languages)
                      .map(([l, n]) => `${l}: ${n}`)
                      .join(" · ") || "Numeric / identifier cells"}
                  </p>
                  <p className="mt-2 text-xs font-bold text-[#9a6718]">
                    {t.kind === "table" ? "Excel table" : "Suggested region"} ·
                    Add selection
                  </p>
                </button>
              ))}
            </div>
            {chooserSelections.length > 0 && (
              <div className="mt-5 space-y-3 border-t border-slate-200 pt-4">
                <h3 className="font-semibold">
                  {draft ? "Selected ranges" : "New selected ranges"} (
                  {chooserSelections.length})
                </h3>
                {chooserSelections.map((s, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-3 rounded-lg bg-white p-3 text-sm"
                  >
                    <span className="min-w-24 font-semibold">{s.sheet}</span>
                    <label>
                      Range{" "}
                      <input
                        aria-label={`Range for selection ${i + 1}`}
                        value={s.range}
                        onChange={(e) =>
                          updateSelection(s, {
                            ...s,
                            range: e.target.value.toUpperCase(),
                          })
                        }
                        className={`${control} w-36`}
                      />
                    </label>
                    <label>
                      Columns{" "}
                      <input
                        aria-label={`Columns for selection ${i + 1}`}
                        placeholder="All, or B,D"
                        value={
                          s.columnText ?? s.columns?.map(column).join(",") ?? ""
                        }
                        aria-invalid={s.columns?.includes(0) || undefined}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          const valid =
                            !v ||
                            /^[A-Za-z]{1,3}(\s*,\s*[A-Za-z]{1,3})*$/.test(v);
                          updateSelection(s, {
                            ...s,
                            columnText: e.target.value,
                            columns: !valid
                              ? [0]
                              : v
                                ? v
                                    .split(",")
                                    .map(
                                      (c) =>
                                        position(c.trim().toUpperCase() + "1")
                                          .col,
                                    )
                                : undefined,
                          });
                        }}
                        className={`${control} w-32`}
                      />
                    </label>
                    <label>
                      Source{" "}
                      <select
                        aria-label={`Source language for selection ${i + 1}`}
                        value={s.sourceLanguage || "Auto"}
                        onChange={(e) =>
                          updateSelection(s, {
                            ...s,
                            sourceLanguage: e.target
                              .value as Selection["sourceLanguage"],
                          })
                        }
                        className={control}
                      >
                        {["Auto", "Uzbek", "Russian", "Arabic", "English"].map(
                          (l) => (
                            <option key={l}>{l}</option>
                          ),
                        )}
                      </select>
                    </label>
                    <button
                      onClick={() =>
                        editSelections((items) =>
                          items.filter((_, j) => j !== i),
                        )
                      }
                      className="ml-auto text-xs text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            {!draft && !chooserSelections.length && (
              <p className="mt-4 text-sm text-slate-500">
                No new ranges selected. Choose a table above, select a whole
                worksheet, or click cells in the preview below.
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <button
                disabled={!chooserSelections.length || !canChoose}
                onClick={() => void reviewScope(chooserSelections)}
                className={action}
              >
                {busy ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  "Review selection"
                )}
              </button>
              <span className="inline-flex items-center gap-2 text-xs text-slate-500">
                <ShieldCheck size={15} /> No translation API calls until you
                confirm the selection.
              </span>
            </div>
            {draft && plan && plan.selectionKey === selectionKey && (
              <div
                ref={confirmationRef}
                tabIndex={-1}
                className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
              >
                <h3 className="font-semibold">
                  Confirm translation to {target}
                </h3>
                <p className="mt-2 text-sm">
                  {plan.selectedCells.toLocaleString()} selected cells ·{" "}
                  {plan.protectedCells.toLocaleString()} protected ·{" "}
                  {plan.uniqueTexts.toLocaleString()} unique text/context pairs
                  · {plan.batches} batches
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  At most {plan.maxRequests} API requests, including recovery.
                  Completed batches are saved. This incurs normal API charges.
                </p>
                {plan.protectedCells > 0 && (
                  <p className="mt-3 text-sm font-semibold text-amber-900">
                    Protected cells will stay unchanged. This includes English,
                    numbers, identifiers, rich text, table headers, and text
                    already in the target language. Check the sample below
                    before confirming.
                  </p>
                )}
                <details className="mt-3 text-sm">
                  <summary>Sample text to translate</summary>
                  {plan.examples.map((e, i) => (
                    <p key={i} className="mt-2 break-words">
                      <span className="text-xs text-slate-500">
                        {e.context} · {e.language}
                      </span>
                      <br />
                      {e.text}
                    </p>
                  ))}
                </details>
                <button
                  disabled={busy || !plan.uniqueTexts}
                  onClick={() => void post("start")}
                  className={`${action} mt-4`}
                >
                  Confirm and translate selected cells
                </button>
              </div>
            )}
          </fieldset>
        </section>
        <section
          aria-label="Workbook preview"
          className="w-full min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
            <div>
              <h2 className="font-serif text-xl">Workbook preview</h2>
              <p className="text-xs text-slate-500">
                Cell-grid preview · values-only download preserves formatting.
                Formulas become saved values across every worksheet.
              </p>
            </div>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {(["original", "translated", "compare"] as const).map((m) => (
                <button
                  key={m}
                  aria-pressed={mode === m}
                  disabled={m !== "original" && !hasTranslation}
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-2 text-xs font-semibold capitalize disabled:opacity-40 disabled:cursor-not-allowed ${mode === m ? "bg-[#132a33] text-white" : "text-slate-600"}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          {(draft || job.canExtend) && (
            <div className="space-y-3 border-b border-slate-200 bg-[#fffdf8] px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  className={control}
                  disabled={busy}
                  onClick={() =>
                    void reviewScope([
                      {
                        sheet,
                        range: sheetInfo?.range || "A1",
                        sourceLanguage: "Auto",
                      },
                    ])
                  }
                >
                  Translate this worksheet
                </button>
                <button
                  className={control}
                  disabled={busy || previewBusy || !preview}
                  onClick={() => {
                    setPlan(null);
                    const eligible =
                      preview?.cells.filter(
                        (c) =>
                          !merges.covered.has(c.address) &&
                          !cellTranslationReason(
                            c,
                            draft ? target : job.targetLang,
                          ),
                      ) || [];
                    setPicked(
                      eligible.slice(0, 200).map((c) => ({
                        sheet,
                        range: c.address,
                        sourceLanguage: "Auto",
                      })),
                    );
                    setFocused(null);
                    setAddition(null);
                    setSelectionInfo(
                      eligible.length > 200
                        ? "Selected the first 200 eligible visible cells. Translate this selection before selecting more."
                        : eligible.length
                          ? ""
                          : "No eligible text in this view. Click a cell to see why it is preserved.",
                    );
                  }}
                >
                  Select visible text
                </button>
                {picked.length > 0 && (
                  <button
                    className={control}
                    disabled={busy}
                    onClick={() => {
                      setPlan(null);
                      setPicked([]);
                      setFocused(null);
                      setSelectionInfo("");
                      setAddition(null);
                    }}
                  >
                    Clear cell selection
                  </button>
                )}
                <span className="text-xs text-slate-600">
                  Click a cell to translate or see why it is preserved. Ctrl /
                  Cmd + click selects multiple cells (up to 200).
                </span>
              </div>
              {picked.length > 0 && (
                <p className="break-words text-xs text-slate-600">
                  Selected:{" "}
                  {picked.map((s) => `${s.sheet}!${s.range}`).join(", ")}
                </p>
              )}
              {addition && (
                <div
                  role="region"
                  aria-label="Additional translation confirmation"
                  ref={confirmationRef}
                  tabIndex={-1}
                  className="rounded-lg border border-amber-200 bg-amber-50 p-4"
                >
                  <h3 className="font-serif text-lg">
                    Translate more in this workbook
                  </h3>
                  <p className="mt-2 break-words text-sm">
                    Scope:{" "}
                    {addition.selections
                      .map((s) => `${s.sheet}!${s.range}`)
                      .join(", ")}{" "}
                    · Target: {addition.targetLang}
                  </p>
                  <p className="mt-2 text-sm">
                    {addition.uniqueTexts} text entries ·{" "}
                    {addition.protectedCells} protected cells skipped · at most{" "}
                    {addition.maxRequests} additional Luna requests. Normal API
                    charges apply.
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    {addition.replacingCells} previously translated cells are
                    selected for replacement. Other saved translations and all
                    usage totals are retained. The updated download is available
                    after all required cells pass validation.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className={action}
                      disabled={busy || active}
                      onClick={() => void confirmAddition()}
                    >
                      Confirm additional translation
                    </button>
                    <button
                      className={control}
                      disabled={busy}
                      onClick={() => setAddition(null)}
                    >
                      Cancel addition
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {(focused || picked.length > 0 || selectionInfo) && (
            <div
              role="region"
              aria-label="Cell actions"
              className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-semibold text-sm text-amber-950">
                  {picked.length > 1
                    ? `${picked.length} cells selected`
                    : focused
                      ? `${sheet}!${focused}`
                      : `${picked.length} cells selected`}
                </p>
                <p role="status" className="mt-1 text-xs text-slate-600">
                  {selectionInfo ||
                    `Translate to ${draft ? target : job.targetLang}. Review the scope and request allowance before confirming.`}
                </p>
              </div>
              {picked.length > 0 && (draft || job.canExtend) && (
                <button
                  className={`${action} inline-flex items-center gap-2`}
                  disabled={busy}
                  onClick={() => void reviewScope(picked)}
                >
                  {busy && (
                    <LoaderCircle
                      size={15}
                      className="motion-safe:animate-spin"
                    />
                  )}
                  {picked.length === 1
                    ? `Translate ${picked[0].range}`
                    : `Translate selected cells (${picked.length})`}
                </button>
              )}
            </div>
          )}
          {statusError && (
            <p role="status" className="px-4 py-3 text-sm text-amber-900">
              {statusError}
            </p>
          )}
          {previewError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              <span>{previewError}</span>
              <button
                className={control}
                disabled={previewBusy}
                onClick={() => setPreviewRevision((n) => n + 1)}
              >
                Retry preview
              </button>
            </div>
          )}
          {preview?.translationWarning && (
            <p
              role="alert"
              className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {preview.translationWarning}
            </p>
          )}
          {!hasTranslation ? (
            <p
              role="status"
              className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"
            >
              No translated cells are available yet. Showing original content
              only.
            </p>
          ) : job.status !== "completed" ? (
            <p
              role="status"
              className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              Partial translation preview. Validated cells are shown; unfinished
              selected cells are marked as{" "}
              {active ? "pending" : "needing review"}.
            </p>
          ) : null}
          <div className="flex gap-1 overflow-x-auto border-b border-slate-200 p-2">
            {inspection.sheets
              .filter((s) => !s.hidden || showHidden)
              .map((s) => (
                <button
                  key={s.name}
                  disabled={busy}
                  onClick={() => changeSheet(s.name)}
                  className={`shrink-0 rounded-md px-4 py-2 text-xs font-semibold ${sheet === s.name ? "bg-amber-100 text-amber-900" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  {s.name}
                </button>
              ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 p-3 text-xs">
            <button
              disabled={row <= 1}
              onClick={() => setRow(Math.max(1, row - 40))}
              className={control}
            >
              Previous rows
            </button>
            <span>{range}</span>
            <button
              disabled={row + 39 >= max.row}
              onClick={() => setRow(row + 40)}
              className={control}
            >
              Next rows
            </button>
            <button
              disabled={col <= 1}
              onClick={() => setCol(Math.max(1, col - 16))}
              className={control}
            >
              Previous columns
            </button>
            <button
              disabled={col + 15 >= max.col}
              onClick={() => setCol(col + 16)}
              className={control}
            >
              Next columns
            </button>
            {previewBusy && <LoaderCircle size={16} className="animate-spin" />}
          </div>
          <div
            className="max-h-[65vh] overflow-auto border-t border-slate-200"
            aria-busy={previewBusy}
          >
            <table
              role="grid"
              aria-label="Workbook cells"
              aria-multiselectable="true"
              className="w-full border-collapse text-xs"
            >
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr>
                  <th className="border border-slate-200 px-2 py-2">#</th>
                  {Array.from(
                    { length: Math.max(0, Math.min(16, max.col - col + 1)) },
                    (_, i) => (
                      <th key={i} className="border border-slate-200 px-4 py-2">
                        {column(col + i)}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {Array.from(
                  { length: Math.max(0, Math.min(40, max.row - row + 1)) },
                  (_, ri) => (
                    <tr key={ri}>
                      <th className="sticky left-0 border border-slate-200 bg-slate-50 px-2">
                        {row + ri}
                      </th>
                      {Array.from(
                        {
                          length: Math.max(0, Math.min(16, max.col - col + 1)),
                        },
                        (_, ci) => {
                          const address = `${column(col + ci)}${row + ri}`,
                            c = cells.get(address),
                            merge = merges.anchors.get(address);
                          if (merges.covered.has(address)) return null;
                          const selectable =
                            (draft || job.canExtend) &&
                            !busy &&
                            !cellTranslationReason(
                              c,
                              draft ? target : job.targetLang,
                            );
                          const reason = cellTranslationReason(
                            c,
                            draft ? target : job.targetLang,
                          );
                          const pending = !!c?.translationPending;
                          const unavailable =
                            !!c?.translationUnavailable || (pending && !active);
                          const selected = picked.some(
                            (s) => s.sheet === sheet && s.range === address,
                          );
                          return (
                            <td
                              key={ci}
                              role="gridcell"
                              aria-label={`${sheet}!${address}`}
                              aria-selected={selected}
                              tabIndex={c?.text.trim() ? 0 : -1}
                              data-address={address}
                              rowSpan={merge?.rows}
                              colSpan={merge?.cols}
                              onClick={(e) => {
                                selectCell(address, e.ctrlKey || e.metaKey);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  selectCell(address, e.ctrlKey || e.metaKey);
                                }
                                const delta = {
                                  ArrowDown: [1, 0],
                                  ArrowUp: [-1, 0],
                                  ArrowLeft: [0, -1],
                                  ArrowRight: [0, 1],
                                }[e.key];
                                if (delta) {
                                  e.preventDefault();
                                  const nextRow = row + ri + delta[0],
                                    nextCol = col + ci + delta[1];
                                  if (nextRow < 1 || nextCol < 1) return;
                                  const nextAddress = `${column(nextCol)}${nextRow}`;
                                  const grid = e.currentTarget.closest("table");
                                  grid
                                    ?.querySelector<HTMLElement>(
                                      `[data-address="${nextAddress}"]`,
                                    )
                                    ?.focus();
                                }
                              }}
                              title={
                                c
                                  ? `${address} · ${reason || (selectable ? "Click to select for translation" : "Click for details")}`
                                  : address
                              }
                              className={`min-w-32 max-w-96 whitespace-pre-wrap break-words border border-slate-200 px-3 py-2 align-top focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber-600 ${c?.text.trim() ? "cursor-pointer" : ""} ${selected ? "ring-2 ring-inset ring-amber-500" : focused === address ? "ring-1 ring-inset ring-slate-400" : ""}`}
                              style={{
                                fontWeight: c?.style.bold ? "bold" : undefined,
                                fontStyle: c?.style.italic
                                  ? "italic"
                                  : undefined,
                                color: c?.style.color,
                                backgroundColor: c?.style.fill,
                              }}
                            >
                              {c && (pending || unavailable) ? (
                                <>
                                  <div>{c.text}</div>
                                  <span
                                    role="status"
                                    className="mt-2 inline-flex items-center gap-1.5 rounded bg-amber-50 px-1.5 py-1 text-[11px] font-medium text-amber-900"
                                  >
                                    {!unavailable && active && (
                                      <LoaderCircle
                                        aria-hidden="true"
                                        size={12}
                                        className="motion-safe:animate-spin"
                                      />
                                    )}
                                    {unavailable
                                      ? "Needs review · original shown"
                                      : job.status === "queued"
                                        ? "Queued"
                                        : "Translating…"}
                                  </span>
                                </>
                              ) : mode === "compare" &&
                                c &&
                                c.text !== c.translated ? (
                                <>
                                  <div className="text-slate-400">{c.text}</div>
                                  <div className="mt-2 border-t border-amber-200 pt-2">
                                    {c.translated}
                                  </div>
                                </>
                              ) : mode === "original" ? (
                                c?.text
                              ) : (
                                c?.translated
                              )}
                            </td>
                          );
                        },
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
