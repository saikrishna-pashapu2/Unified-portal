"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  FolderOpen,
  Languages,
  LoaderCircle,
  RefreshCw,
  Search,
  Sheet,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { MAX_PDF_UPLOAD_BYTES } from "@/lib/pdfx-v2/constants";
import {
  PDFX_V2_SUPPORTED_LANGUAGES,
  type PdfxV2TargetLanguage,
} from "@/lib/pdfx-v2/types";
import {
  ACTIVE_HISTORY_STATUSES,
  HISTORY_FILTERS,
  MAX_HISTORY_SEARCH_LENGTH,
  type HistoryFilter,
  type HistoryItem,
  type HistoryKind,
  type HistoryResponse,
} from "@/lib/document-translator/history";
import styles from "./TranslatorHome.module.css";

type Query = {
  page: number;
  size: number;
  status: HistoryFilter;
  kind: HistoryKind;
  search: string;
};
const INITIAL_QUERY: Query = {
  page: 1,
  size: 25,
  status: "all",
  kind: "all",
  search: "",
};

export default function PdfTranslator2Client() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadGuard = useRef(false);
  const deleteGuard = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [targetLang, setTargetLang] = useState<PdfxV2TargetLanguage>("Russian");
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState<Query>(INITIAL_QUERY);
  const [searchText, setSearchText] = useState("");
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [resolvedKey, setResolvedKey] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  const requestKey = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.size),
    status: query.status,
    kind: query.kind,
    q: query.search,
  }).toString();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const search = searchText.trim();
      setQuery((current) =>
        current.search === search ? current : { ...current, page: 1, search },
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    setHistoryLoading(true);
    setHistoryError("");
    void (async () => {
      try {
        const response = await fetch(
          "/api/document-translator/history?" + requestKey,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error("History unavailable");
        const payload = (await response.json()) as HistoryResponse;
        if (
          !Array.isArray(payload.items) ||
          !Number.isFinite(payload.total) ||
          !payload.counts
        )
          throw new Error("Invalid history response");
        if (!current) return;
        const lastPage = Math.max(1, Math.ceil(payload.total / query.size));
        if (query.page > lastPage) {
          setQuery((value) => ({ ...value, page: lastPage }));
          return;
        }
        setData(payload);
        setResolvedKey(requestKey);
      } catch {
        if (current)
          setHistoryError(
            "We couldn’t load your translation history. Your saved documents have not been changed.",
          );
      } finally {
        window.clearTimeout(timeout);
        if (current) setHistoryLoading(false);
      }
    })();
    return () => {
      current = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [requestKey, refreshVersion, query.page, query.size]);

  const currentData = resolvedKey === requestKey ? data : null;
  const busy =
    historyLoading ||
    searchText.trim() !== query.search ||
    (!currentData && !historyError);
  const pages = Math.max(1, Math.ceil((currentData?.total ?? 0) / query.size));
  const filtered =
    query.status !== "all" || query.kind !== "all" || !!query.search;
  const isExcel = !!file && /\.xlsx$/i.test(file.name);
  const refresh = () => setRefreshVersion((value) => value + 1);
  const resetFilters = () => {
    setSearchText("");
    setQuery((current) => ({ ...INITIAL_QUERY, size: current.size }));
  };

  const chooseFile = (next: File | null) => {
    if (uploadGuard.current) return;
    setError("");
    if (inputRef.current) inputRef.current.value = "";
    if (!next) return setFile(null);
    if (!/\.(pdf|xlsx)$/i.test(next.name)) {
      setFile(null);
      setError("Choose a PDF or XLSX document.");
      return;
    }
    if (next.size < 1) {
      setFile(null);
      setError("The selected document is empty.");
      return;
    }
    if (next.size > MAX_PDF_UPLOAD_BYTES) {
      setFile(null);
      setError("The selected document exceeds 512 MB.");
      return;
    }
    setFile(next);
  };

  const submit = async () => {
    if (!file || uploadGuard.current) return;
    uploadGuard.current = true;
    setSubmitting(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("targetLang", targetLang);
      form.append("expectedKind", isExcel ? "xlsx" : "pdf");
      const response = await fetch("/api/pdfx-v2/upload", {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => ({}))) as {
        jobId?: string;
        kind?: string;
        error?: string;
      };
      if (!response.ok || !payload.jobId)
        throw new Error(payload.error ?? "Upload failed");
      router.push(
        "/esg/tools/pdf-translator-2/" +
          (payload.kind === "xlsx" ? "excel/" : "") +
          encodeURIComponent(payload.jobId),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed");
      uploadGuard.current = false;
      setSubmitting(false);
    }
  };

  const deleteTranslation = async (item: HistoryItem) => {
    if (ACTIVE_HISTORY_STATUSES.has(item.status) || deleteGuard.current) return;
    if (
      !window.confirm(
        "Delete “" +
          item.filename +
          "”?\n\nThe saved source, translated file, and results will be permanently removed.",
      )
    )
      return;
    deleteGuard.current = true;
    setDeletingId(item.id);
    setDeleteError("");
    try {
      const endpoint =
        item.kind === "xlsx" ? "/api/xlsx-translator/" : "/api/pdfx-v2/jobs/";
      const response = await fetch(endpoint + encodeURIComponent(item.id), {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Unable to delete this translation.");
      setHistoryLoading(true);
      refresh(); // The next read clamps the page if its last item was removed.
    } catch (caught) {
      setDeleteError(
        caught instanceof Error
          ? caught.message
          : "Unable to delete this translation.",
      );
    } finally {
      deleteGuard.current = false;
      setDeletingId(null);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.frame}>
        <header className={styles.header}>
          <div>
            <Link href="/esg/tools" className={styles.back}>
              <ArrowLeft size={14} aria-hidden="true" /> All ESG tools
            </Link>
            <p className={styles.eyebrow}>Your document workspace</p>
            <h1>
              Document translator<span>.</span>
            </h1>
            <p className={styles.subtitle}>
              Translate PDFs and selected Excel content, all in one place.
            </p>
          </div>
          <div className={styles.formatNote}>
            <span>
              <FileText size={17} aria-hidden="true" /> PDF
            </span>
            <span>
              <Sheet size={17} aria-hidden="true" /> Excel
            </span>
          </div>
        </header>

        <section
          className={styles.uploadPanel}
          aria-labelledby="new-translation-title"
        >
          <div className={styles.uploadArea}>
            <div className={styles.sectionHeading}>
              <h2 id="new-translation-title">Start something new</h2>
              <span>01 / UPLOAD</span>
            </div>
            <button
              type="button"
              disabled={submitting}
              className={[
                styles.dropzone,
                dragging ? styles.dragging : "",
                file ? styles.fileChosen : "",
              ].join(" ")}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!submitting) setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (submitting) return;
                if (event.dataTransfer.files.length > 1) {
                  setError("Choose one document at a time.");
                  return;
                }
                chooseFile(event.dataTransfer.files[0] ?? null);
              }}
            >
              <span className={styles.documentStack} aria-hidden="true">
                <span className={styles.backSheet}>
                  <Sheet size={26} />
                </span>
                <span className={styles.frontSheet}>
                  {file ? (
                    isExcel ? (
                      <Sheet size={27} />
                    ) : (
                      <FileText size={27} />
                    )
                  ) : (
                    <Languages size={27} />
                  )}
                  <i />
                  <i />
                  <i />
                </span>
                <span className={styles.uploadBubble}>
                  {file ? <Check size={14} /> : <UploadCloud size={16} />}
                </span>
              </span>
              <span className={styles.dropCopy}>
                <strong title={file?.name}>
                  {file ? file.name : "Drop your document here"}
                </strong>
                <span>
                  {file ? (
                    (file.size / 1_048_576).toFixed(2) +
                    " MB · Click to replace"
                  ) : (
                    <>
                      <b>Browse files</b> or drag and drop
                    </>
                  )}
                </span>
                <small>
                  {file
                    ? isExcel
                      ? "Excel workbook · ready to inspect"
                      : "PDF document · ready to translate"
                    : "PDF or XLSX · up to 512 MB"}
                </small>
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              tabIndex={-1}
              aria-label="Upload document"
              accept=".pdf,application/pdf,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className={styles.srOnly}
              disabled={submitting}
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <div className={styles.uploadFootnote}>
              <span>
                {file ? (
                  <>
                    <CheckCircle2 size={14} aria-hidden="true" /> Document
                    selected
                  </>
                ) : (
                  "Normal or scanned PDFs. Native Excel workbooks."
                )}
              </span>
              {file && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => chooseFile(null)}
                >
                  <X size={13} aria-hidden="true" /> Remove
                </button>
              )}
            </div>
          </div>
          <div className={styles.settings}>
            <p className={styles.stepLabel}>02 / TRANSLATE</p>
            <label htmlFor="translation-language">
              <Languages size={16} aria-hidden="true" /> Target language
            </label>
            <select
              id="translation-language"
              value={targetLang}
              disabled={submitting}
              onChange={(event) =>
                setTargetLang(event.target.value as PdfxV2TargetLanguage)
              }
            >
              {PDFX_V2_SUPPORTED_LANGUAGES.map((language) => (
                <option key={language}>{language}</option>
              ))}
            </select>
            <p className={styles.selectionHint}>
              {isExcel
                ? "Choose your worksheets, tables or cells after upload."
                : "Choose the language for your translated document."}
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!file || submitting}
              onClick={() => void submit()}
            >
              <span>
                {submitting
                  ? "Uploading & inspecting…"
                  : isExcel
                    ? "Choose Excel content"
                    : "Translate document"}
              </span>
              {submitting ? (
                <LoaderCircle
                  size={18}
                  className={styles.spin}
                  aria-hidden="true"
                />
              ) : (
                <ArrowRight size={18} aria-hidden="true" />
              )}
            </button>
            {error && (
              <p role="alert" className={styles.uploadError}>
                <AlertCircle size={16} aria-hidden="true" />
                {error}
              </p>
            )}
          </div>
        </section>

        <section className={styles.library} aria-labelledby="history-title">
          <div className={styles.libraryHeading}>
            <div>
              <div className={styles.titleWithCount}>
                <h2 id="history-title">Your translations</h2>
                {data && (
                  <span className={styles.totalBadge}>{data.allTotal}</span>
                )}
              </div>
              <p>Every saved document, not just the recent ones.</p>
            </div>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={historyLoading}
              onClick={refresh}
            >
              <RefreshCw
                size={15}
                className={historyLoading ? styles.spin : ""}
                aria-hidden="true"
              />
              Refresh
            </button>
          </div>
          <div className={styles.historyCard}>
            <div className={styles.filters}>
              <div
                className={styles.tabs}
                aria-label="Filter translation history"
              >
                {HISTORY_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    aria-pressed={query.status === filter.key}
                    className={
                      query.status === filter.key ? styles.selectedTab : ""
                    }
                    onClick={() =>
                      setQuery((current) => ({
                        ...current,
                        page: 1,
                        status: filter.key,
                      }))
                    }
                  >
                    {filter.label}
                    <span>
                      {currentData ? currentData.counts[filter.key] : "–"}
                    </span>
                  </button>
                ))}
              </div>
              <div className={styles.searchRow}>
                <label className={styles.searchBox}>
                  <Search size={17} aria-hidden="true" />
                  <span className={styles.srOnly}>Search all translations</span>
                  <input
                    type="search"
                    placeholder="Search by document name…"
                    maxLength={MAX_HISTORY_SEARCH_LENGTH}
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                  />
                </label>
                <label className={styles.kindFilter}>
                  <span className={styles.srOnly}>Document type</span>
                  <select
                    value={query.kind}
                    onChange={(event) =>
                      setQuery((current) => ({
                        ...current,
                        page: 1,
                        kind: event.target.value as HistoryKind,
                      }))
                    }
                  >
                    <option value="all">All file types</option>
                    <option value="pdf">PDF documents</option>
                    <option value="xlsx">Excel workbooks</option>
                  </select>
                </label>
                <span className={styles.sortLabel}>Newest first</span>
                {filtered && (
                  <button
                    type="button"
                    className={styles.clearButton}
                    onClick={resetFilters}
                  >
                    <X size={13} aria-hidden="true" />
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            {(historyError || deleteError) && (
              <div role="alert" className={styles.historyError}>
                <AlertCircle size={17} aria-hidden="true" />
                <div>
                  {deleteError || historyError}
                  {historyError && currentData && (
                    <small>Showing the last successfully loaded results.</small>
                  )}
                </div>
                {historyError && (
                  <button type="button" onClick={refresh}>
                    Try again
                  </button>
                )}
              </div>
            )}
            <div className={styles.results} aria-busy={busy}>
              {busy && !currentData ? (
                <div
                  className={styles.skeleton}
                  role="status"
                  aria-label="Loading translation history"
                >
                  {Array.from({ length: 5 }, (_, i) => (
                    <div key={i}>
                      <i />
                      <span />
                      <b />
                    </div>
                  ))}
                </div>
              ) : currentData?.items.length ? (
                <table className={styles.table}>
                  <caption className={styles.srOnly}>
                    Saved translation documents, newest first
                  </caption>
                  <colgroup>
                    <col className={styles.nameColumn} />
                    <col className={styles.languageColumn} />
                    <col className={styles.dateColumn} />
                    <col className={styles.statusColumn} />
                    <col className={styles.actionsColumn} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">Document</th>
                      <th scope="col">Language</th>
                      <th scope="col">Created</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className={styles.srOnly}>Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentData.items.map((item) => (
                      <HistoryRow
                        key={item.kind + item.id}
                        item={item}
                        deleting={deletingId === item.id}
                        deleteDisabled={deletingId !== null || historyLoading}
                        onDelete={() => void deleteTranslation(item)}
                      />
                    ))}
                  </tbody>
                </table>
              ) : (
                !historyError && (
                  <div className={styles.emptyState}>
                    {filtered ? (
                      <Search size={28} aria-hidden="true" />
                    ) : (
                      <FolderOpen size={30} aria-hidden="true" />
                    )}
                    <h3>
                      {filtered
                        ? "No documents match those filters"
                        : "Your document library starts here"}
                    </h3>
                    <p>
                      {filtered
                        ? "Try another name, status or file type. Search includes all saved translations."
                        : "Upload a PDF or Excel workbook above. Your translations will be saved here."}
                    </p>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={
                        filtered
                          ? resetFilters
                          : () => inputRef.current?.click()
                      }
                    >
                      {filtered ? "Clear filters" : "Choose a document"}
                      <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </div>
                )
              )}
            </div>

            <footer className={styles.pagination}>
              <p aria-live="polite">
                {currentData ? (
                  currentData.total ? (
                    <>
                      Showing{" "}
                      <strong>
                        {(query.page - 1) * query.size + 1}–
                        {Math.min(query.page * query.size, currentData.total)}
                      </strong>{" "}
                      of <strong>{currentData.total}</strong>{" "}
                      {filtered ? "matches" : "documents"}
                    </>
                  ) : (
                    "0 matching documents"
                  )
                ) : historyError ? (
                  "History unavailable"
                ) : (
                  "Loading documents…"
                )}
              </p>
              <div className={styles.pageControls}>
                <label>
                  Per page
                  <select
                    aria-label="Documents per page"
                    value={query.size}
                    onChange={(event) =>
                      setQuery((current) => ({
                        ...current,
                        page: 1,
                        size: Number(event.target.value),
                      }))
                    }
                  >
                    {[10, 25, 50].map((size) => (
                      <option key={size}>{size}</option>
                    ))}
                  </select>
                </label>
                <nav aria-label="Translation history pages">
                  <button
                    type="button"
                    aria-label="First page"
                    disabled={busy || query.page <= 1}
                    onClick={() =>
                      setQuery((current) => ({ ...current, page: 1 }))
                    }
                  >
                    <ChevronsLeft size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Previous page"
                    disabled={busy || query.page <= 1}
                    onClick={() =>
                      setQuery((current) => ({
                        ...current,
                        page: current.page - 1,
                      }))
                    }
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <span>
                    Page <b>{query.page}</b> of {currentData ? pages : "–"}
                  </span>
                  <button
                    type="button"
                    aria-label="Next page"
                    disabled={busy || !currentData || query.page >= pages}
                    onClick={() =>
                      setQuery((current) => ({
                        ...current,
                        page: current.page + 1,
                      }))
                    }
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Last page"
                    disabled={busy || !currentData || query.page >= pages}
                    onClick={() =>
                      setQuery((current) => ({ ...current, page: pages }))
                    }
                  >
                    <ChevronsRight size={16} aria-hidden="true" />
                  </button>
                </nav>
              </div>
            </footer>
          </div>
        </section>
        <p className={styles.libraryFootnote}>
          <FolderOpen size={13} aria-hidden="true" /> Your history includes
          saved PDF and Excel jobs across all dates.
        </p>
      </div>
    </main>
  );
}

function HistoryRow({
  item,
  deleting,
  deleteDisabled,
  onDelete,
}: {
  item: HistoryItem;
  deleting: boolean;
  deleteDisabled: boolean;
  onDelete: () => void;
}) {
  const active = ACTIVE_HISTORY_STATUSES.has(item.status);
  const href =
    "/esg/tools/pdf-translator-2/" +
    (item.kind === "xlsx" ? "excel/" : "") +
    encodeURIComponent(item.id);
  const date = new Date(item.created_at);
  const validDate = !Number.isNaN(date.getTime());
  const progress = Math.round(Math.max(0, Math.min(100, item.progress || 0)));
  return (
    <tr className={styles.historyRow}>
      <td className={styles.documentCell}>
        <div
          className={[
            styles.fileIcon,
            item.kind === "xlsx" ? styles.excelIcon : styles.pdfIcon,
          ].join(" ")}
          aria-hidden="true"
        >
          {item.kind === "xlsx" ? <Sheet size={21} /> : <FileText size={21} />}
        </div>
        <div className={styles.documentDetails}>
          <Link
            href={href}
            title={item.filename}
            className={styles.documentName}
          >
            {item.filename}
          </Link>
          <p>
            {item.kind === "xlsx"
              ? "Excel workbook"
              : "PDF" +
                (item.total_pages
                  ? " · " +
                    item.total_pages +
                    (item.total_pages === 1 ? " page" : " pages")
                  : "")}
            {item.status === "draft" && <span> · Choose your content</span>}
          </p>
          {item.message && <small title={item.message}>{item.message}</small>}
        </div>
      </td>
      <td className={styles.languageCell}>
        <span className={styles.mobileLabel}>Language</span>
        {item.target_lang}
      </td>
      <td className={styles.dateCell}>
        <time dateTime={validDate ? date.toISOString() : undefined}>
          {validDate
            ? new Intl.DateTimeFormat(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              }).format(date)
            : "Unknown date"}
          {validDate && (
            <small>
              {new Intl.DateTimeFormat(undefined, {
                hour: "numeric",
                minute: "2-digit",
              }).format(date)}
            </small>
          )}
        </time>
      </td>
      <td className={styles.statusCell}>
        <StatusPill status={item.status} />
        {active && (
          <div className={styles.progress}>
            <span>
              <i style={{ width: progress + "%" }} />
            </span>
            <small>{progress}%</small>
          </div>
        )}
      </td>
      <td className={styles.actionsCell}>
        <div>
          <Link
            href={href}
            className={styles.iconButton}
            aria-label={"Open translation " + item.filename}
            title="Open document"
          >
            <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
          <button
            type="button"
            className={[styles.iconButton, styles.deleteButton].join(" ")}
            disabled={active || deleteDisabled}
            onClick={onDelete}
            aria-label={"Delete translation " + item.filename}
            title={
              active
                ? "Stop the translation before deleting"
                : "Delete translation"
            }
          >
            {deleting ? (
              <LoaderCircle
                size={15}
                className={styles.spin}
                aria-hidden="true"
              />
            ) : (
              <Trash2 size={15} aria-hidden="true" />
            )}
          </button>
        </div>
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: string }) {
  const active = ACTIVE_HISTORY_STATUSES.has(status);
  const label =
    (
      {
        completed: "Completed",
        processing: "Translating",
        queued: "Queued",
        cancelling: "Stopping",
        draft: "Draft",
        error: "Needs attention",
        cancelled: "Cancelled",
      } as Record<string, string>
    )[status] ?? "Unknown";
  const tone =
    status === "completed"
      ? styles.completeStatus
      : active
        ? styles.activeStatus
        : status === "draft"
          ? styles.draftStatus
          : styles.attentionStatus;
  return (
    <span className={[styles.statusPill, tone].join(" ")}>
      {status === "completed" ? (
        <Check size={12} aria-hidden="true" />
      ) : (
        <i aria-hidden="true" />
      )}
      {label}
    </span>
  );
}
