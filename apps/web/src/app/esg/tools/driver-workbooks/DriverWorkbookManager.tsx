"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileSpreadsheet,
  History,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Upload,
  Users,
  X,
} from "lucide-react";
import type {
  DriverCatalogDiff,
  DriverCatalogListResponse,
  DriverCatalogPreviewResponse,
  DriverCatalogVersion,
  WorkbookValidationIssue,
} from "@/lib/esg-drivers/catalog-contracts";
import type { WorkbookDriver } from "@/lib/esg-drivers/workbook-types";
import {
  activationLabel,
  catalogErrorMessage,
  formatCatalogAttribution,
  versionLabel,
} from "./catalog-client";

const CATALOG_PATH = "/api/esg/drivers/workbooks";
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export interface DriverWorkbookManagerProps {
  open: boolean;
  catalog: DriverCatalogListResponse | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onRefresh: () => Promise<DriverCatalogListResponse | null>;
  onLoadMore: () => Promise<DriverCatalogListResponse | null>;
  openerRef?: RefObject<HTMLButtonElement>;
}

interface PreviewState {
  response: DriverCatalogPreviewResponse;
  source: "upload" | "history";
}

export function DriverWorkbookManager({
  open,
  catalog,
  loading,
  error: catalogError,
  onClose,
  onRefresh,
  onLoadMore,
  openerRef,
}: DriverWorkbookManagerProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmationActionRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const versionPreviewAbortRef = useRef<AbortController | null>(null);
  const versionPreviewRequestRef = useRef(0);
  const confirmationReturnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loadingVersionId, setLoadingVersionId] = useState("");
  const [activating, setActivating] = useState(false);
  const [confirmingActivation, setConfirmingActivation] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);

  const cancelVersionPreview = useCallback(() => {
    versionPreviewRequestRef.current += 1;
    versionPreviewAbortRef.current?.abort();
    versionPreviewAbortRef.current = null;
    setLoadingVersionId("");
  }, []);

  const handleClose = useCallback(() => {
    cancelVersionPreview();
    onClose();
  }, [cancelVersionPreview, onClose]);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      closeButtonRef.current?.focus();
      setActionError("");
      setUploadError("");
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    cancelVersionPreview();
    setPreview(null);
    setConfirmingActivation(false);
    confirmationReturnFocusRef.current = null;
    requestAnimationFrame(() => openerRef?.current?.focus());
  }, [cancelVersionPreview, open, openerRef]);

  useEffect(() => {
    return () => {
      versionPreviewRequestRef.current += 1;
      versionPreviewAbortRef.current?.abort();
      versionPreviewAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (confirmingActivation) {
      requestAnimationFrame(() => confirmationActionRef.current?.focus());
      return;
    }
    const returnFocus = confirmationReturnFocusRef.current;
    confirmationReturnFocusRef.current = null;
    requestAnimationFrame(() => {
      if (returnFocus?.isConnected && dialogRef.current?.contains(returnFocus)) {
        returnFocus.focus();
        return;
      }
      if (open) (confirmationTriggerRef.current || closeButtonRef.current)?.focus();
    });
  }, [confirmingActivation, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !uploading && !activating) handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activating, handleClose, open, uploading]);

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!event.currentTarget.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function beginActivationConfirmation() {
    const active = document.activeElement;
    confirmationReturnFocusRef.current = active instanceof HTMLElement ? active : null;
    setConfirmingActivation(true);
  }

  function dismissActivationConfirmation() {
    setConfirmingActivation(false);
  }

  if (!open) return null;

  const activeVersion = catalog?.active;
  const versions = catalog?.versions || [];
  const previewResponse = preview?.response || null;
  const previewedVersion = previewResponse?.version || null;
  const previewIsActive = Boolean(previewedVersion?.isActive);
  const canActivate = Boolean(previewResponse && !previewIsActive && !activating);

  function clearPreview() {
    if (uploading || activating) return;
    cancelVersionPreview();
    setPreview(null);
    setConfirmingActivation(false);
    setShowAllChanges(false);
    setActionError("");
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    cancelVersionPreview();
    setActionError("");
    setUploadError("");
    setPreview(null);
    setConfirmingActivation(false);
    setShowAllChanges(false);
    setSelectedFile(null);
    if (!file) return;
    const extensionValid = /\.xlsx$/i.test(file.name);
    if (!extensionValid) {
      setUploadError("Choose an .xlsx workbook. Other file types are not accepted.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setUploadError("The workbook is larger than the 5 MiB limit.");
      event.target.value = "";
      return;
    }
    setSelectedFile(file);
  }

  async function previewUpload() {
    if (!selectedFile || uploading) return;
    cancelVersionPreview();
    setUploading(true);
    setActionError("");
    setUploadError("");
    try {
      const body = new FormData();
      body.append("file", selectedFile);
      const response = await fetch(CATALOG_PATH, {
        method: "POST",
        body,
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(catalogErrorMessage(data, "Unable to validate this workbook."));
      }
      setPreview({ response: data as DriverCatalogPreviewResponse, source: "upload" });
      setConfirmingActivation(false);
      setShowAllChanges(false);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error: unknown) {
      setUploadError(error instanceof Error ? error.message : "Unable to validate this workbook.");
    } finally {
      setUploading(false);
    }
  }

  async function previewVersion(version: DriverCatalogVersion) {
    if (loadingVersionId || uploading || activating) return;
    versionPreviewAbortRef.current?.abort();
    const controller = new AbortController();
    versionPreviewAbortRef.current = controller;
    const requestId = versionPreviewRequestRef.current + 1;
    versionPreviewRequestRef.current = requestId;
    setLoadingVersionId(version.id);
    setActionError("");
    setUploadError("");
    try {
      const response = await fetch(`${CATALOG_PATH}/${encodeURIComponent(version.id)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (controller.signal.aborted || versionPreviewRequestRef.current !== requestId) return;
      if (!response.ok) {
        throw new Error(catalogErrorMessage(data, "Unable to preview this workbook version."));
      }
      setPreview({ response: data as DriverCatalogPreviewResponse, source: "history" });
      setConfirmingActivation(false);
      setShowAllChanges(false);
    } catch (error: unknown) {
      if (controller.signal.aborted || versionPreviewRequestRef.current !== requestId) return;
      setActionError(error instanceof Error ? error.message : "Unable to preview this workbook version.");
    } finally {
      if (versionPreviewAbortRef.current === controller) {
        versionPreviewAbortRef.current = null;
        setLoadingVersionId((current) => (current === version.id ? "" : current));
      }
    }
  }

  async function activatePreview() {
    if (!previewResponse || !canActivate || !confirmingActivation) return;
    setActivating(true);
    setActionError("");
    try {
      const response = await fetch(
        `${CATALOG_PATH}/${encodeURIComponent(previewResponse.version.id)}/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: previewResponse.revision }),
          cache: "no-store",
        },
      );
      const data = await response.json().catch(() => ({}));
      if (response.status === 409) {
        setPreview(null);
        setConfirmingActivation(false);
        await onRefresh();
        throw new Error(
          "This workbook changed while you were reviewing it. Refresh the catalog and preview the latest version before activating.",
        );
      }
      if (!response.ok) {
        throw new Error(catalogErrorMessage(data, "Unable to activate this workbook."));
      }
      setPreview(null);
      setConfirmingActivation(false);
      setSelectedFile(null);
      await onRefresh();
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Unable to activate this workbook.");
    } finally {
      setActivating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[#101812]/75 px-4 py-6 backdrop-blur-sm sm:py-10"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !uploading && !activating) handleClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="driver-workbook-manager-title"
        onKeyDown={handleDialogKeyDown}
        className="w-full max-w-5xl overflow-hidden rounded-[10px] border border-[#243026] bg-[#f8faf5] shadow-[0_28px_100px_rgba(9,18,12,0.38)]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#304235] bg-[#172019] px-5 py-5 text-white sm:px-7">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[#d6ff66]">
              <FileSpreadsheet className="h-4 w-4" />
              Shared driver catalog
            </p>
            <h2 id="driver-workbook-manager-title" className="mt-2 text-2xl font-semibold tracking-tight">
              Manage driver workbooks
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#c8d8cc]">
              Any signed-in user can upload a validated .xlsx workbook and propose the next shared catalog.
              Activation is always explicit and keeps every previous version available.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            disabled={uploading || activating}
            className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-[5px] border border-white/15 text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close workbook manager"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-5 p-5 sm:p-7 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-5">
            {catalogError && (
              <div className="flex items-start gap-3 rounded-[7px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">The shared catalog could not be loaded.</p>
                  <p className="mt-1 leading-5">{catalogError}</p>
                  <button
                    type="button"
                    onClick={() => void onRefresh()}
                    disabled={loading}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold underline underline-offset-2 disabled:opacity-60"
                  >
                    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Retry catalog request
                  </button>
                </div>
              </div>
            )}

            <section className="rounded-[8px] border border-[#cfd8d0] bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#68756c]">Current active workbook</p>
                  {loading && !activeVersion ? (
                    <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#68756c]">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading catalog…
                    </p>
                  ) : activeVersion ? (
                    <>
                      <h3 className="mt-2 break-words text-xl font-semibold text-[#172019]">{activeVersion.workbook}</h3>
                      <p className="mt-1 text-sm text-[#536156]">Version {versionLabel(activeVersion)}</p>
                    </>
                  ) : (
                    <p className="mt-3 text-sm font-semibold text-[#68756c]">No active workbook is available.</p>
                  )}
                </div>
                {activeVersion && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e4f4dd] px-3 py-1 text-xs font-bold text-[#24643d]">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Active
                  </span>
                )}
              </div>
              {activeVersion && (
                <div className="mt-5 grid gap-3 border-t border-[#e3e9e3] pt-4 text-xs text-[#536156] sm:grid-cols-3">
                  <Attribution icon={<Users className="h-3.5 w-3.5" />} label="Uploaded by" value={formatCatalogAttribution(activeVersion.uploadedBy, activeVersion.uploadedAt)} />
                  <Attribution icon={<FileSpreadsheet className="h-3.5 w-3.5" />} label="Coverage" value={`${activeVersion.driverCount} drivers · ${activeVersion.sheetCount} sheets`} />
                  <Attribution icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Sources" value={`${activeVersion.sourceCount} linked sources`} />
                </div>
              )}
            </section>

            <section className="rounded-[8px] border border-[#cfd8d0] bg-white p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[6px] bg-[#e4f4dd] text-[#24643d]"><Upload className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-[#172019]">Upload a new workbook</h3>
                <p className="mt-1 text-sm leading-5 text-[#68756c]">
                    Upload an .xlsx file up to 5 MiB. The workbook is checked against the shared driver layout and shown as a draft preview before anyone activates it.
                  </p>
                  <p className="mt-2 text-xs leading-5 text-[#536156]">
                    Expected columns: A Driver Section/Country · B Driver Type · C Driver Name · D Driver Logic · E Evidence/KPI · F Key Sources · G+ Link. The sheet name selects the sector; blank section or type cells continue the previous value. Limits: names/types 160 characters · logic/evidence 2,000 · key sources 4,096.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1">
                  <span className="sr-only">Workbook file</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={handleFileChange}
                    disabled={uploading || activating}
                    className="block w-full rounded-[5px] border border-[#cfd8d0] bg-[#fbfcf8] px-3 py-2 text-sm text-[#344139] file:mr-3 file:rounded-[4px] file:border-0 file:bg-[#172019] file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void previewUpload()}
                  disabled={!selectedFile || uploading || activating}
                  className="inline-flex h-11 flex-none items-center justify-center gap-2 rounded-[5px] bg-[#172019] px-4 text-sm font-bold text-white transition hover:bg-[#2a382e] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {uploading ? "Checking workbook" : "Validate workbook"}
                </button>
              </div>
              {selectedFile && !uploadError && (
                <p className="mt-2 text-xs font-semibold text-[#536156]">Selected {selectedFile.name} · {formatBytes(selectedFile.size)}</p>
              )}
              {uploadError && <IssueNotice message={uploadError} tone="error" />}
            </section>

            {previewResponse && (
              <CatalogPreview
                preview={previewResponse}
                source={preview?.source || "history"}
                confirming={confirmingActivation}
                activating={activating}
                showAllChanges={showAllChanges}
                canActivate={canActivate}
                confirmationTriggerRef={confirmationTriggerRef}
                confirmationActionRef={confirmationActionRef}
                onClear={clearPreview}
                onConfirm={beginActivationConfirmation}
                onCancelConfirm={dismissActivationConfirmation}
                onActivate={() => void activatePreview()}
                onShowAllChanges={() => setShowAllChanges((value) => !value)}
              />
            )}
            {actionError && <IssueNotice message={actionError} tone="error" />}
          </div>

          <aside className="min-w-0 rounded-[8px] border border-[#cfd8d0] bg-[#fbfcf8] p-5">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[#536156]" />
              <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#536156]">Workbook history</h3>
            </div>
            <p className="mt-2 text-sm leading-5 text-[#68756c]">Preview an earlier version to compare it with the active workbook, then use the same explicit activation step to roll back.</p>
            <div className="mt-4 space-y-2">
              {versions.length === 0 && !loading ? (
                <p className="rounded-[6px] border border-dashed border-[#cfd8d0] px-3 py-4 text-sm text-[#68756c]">No workbook versions found.</p>
              ) : (
                versions.map((version) => (
                  <HistoryVersionCard
                    key={version.id}
                    version={version}
                    loading={loadingVersionId === version.id}
                    onPreview={() => void previewVersion(version)}
                  />
                ))
              )}
            </div>
            {catalog?.nextCursor && (
              <button
                type="button"
                onClick={() => void onLoadMore()}
                disabled={loading || Boolean(loadingVersionId)}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-[5px] border border-[#bfcac1] px-3 py-2 text-xs font-bold text-[#344139] transition hover:border-[#172019] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Load older versions
              </button>
            )}
            {catalog?.activations && catalog.activations.length > 0 && (
              <div className="mt-6 border-t border-[#e0e7e0] pt-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#68756c]">Recent activations</p>
                <div className="mt-2 space-y-2">
                  {catalog.activations.slice(0, 5).map((activation) => (
                    <div key={activation.id} className="rounded-[5px] bg-white px-3 py-2 text-xs text-[#536156]">
                      <p className="font-semibold text-[#344139]">{activation.workbook}</p>
                      <p className="mt-1 flex items-center gap-1.5"><Clock3 className="h-3 w-3" />{activationLabel(activation)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}

function CatalogPreview({
  preview,
  source,
  confirming,
  activating,
  showAllChanges,
  canActivate,
  confirmationTriggerRef,
  confirmationActionRef,
  onClear,
  onConfirm,
  onCancelConfirm,
  onActivate,
  onShowAllChanges,
}: {
  preview: DriverCatalogPreviewResponse;
  source: "upload" | "history";
  confirming: boolean;
  activating: boolean;
  showAllChanges: boolean;
  canActivate: boolean;
  confirmationTriggerRef: RefObject<HTMLButtonElement>;
  confirmationActionRef: RefObject<HTMLButtonElement>;
  onClear: () => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onActivate: () => void;
  onShowAllChanges: () => void;
}) {
  const { version, diff, warnings } = preview;
  const extendedDiff = diff as ExtendedCatalogDiff;
  const changes = showAllChanges ? diff.changes : diff.changes.slice(0, 8);
  const hasMoreChanges = diff.changes.length > changes.length || diff.truncated;
  return (
    <section className="overflow-hidden rounded-[8px] border border-[#9eb69f] bg-white">
      <div className="border-b border-[#d8e3d8] bg-[#eef6eb] px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#24643d]">{source === "upload" ? "Upload preview · draft" : "History preview"}</p>
            <h3 className="mt-1 break-words text-lg font-semibold text-[#172019]">{version.workbook}</h3>
            <p className="mt-1 text-xs text-[#536156]">Version {versionLabel(version)} · {formatCatalogAttribution(version.uploadedBy, version.uploadedAt)}</p>
          </div>
          <button type="button" onClick={onClear} disabled={activating} className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] text-[#536156] hover:bg-white" aria-label="Close workbook preview"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <DiffStat label="Drivers added" value={diff.addedDrivers} tone="green" />
          <DiffStat label="Drivers removed" value={diff.removedDrivers} tone="red" />
          <DiffStat label="Drivers changed" value={diff.changedDrivers} tone="amber" />
          <DiffStat label="Warnings" value={warnings.length} tone={warnings.length > 0 ? "amber" : "green"} />
        </div>
      </div>

      <div className="space-y-4 p-5">
        {version.isActive && (
          <IssueNotice message="This version is already active. Choose an older version or upload a new workbook to create an activation candidate." tone="info" />
        )}
        {warnings.length > 0 && <IssueList title={`${warnings.length} validation warning${warnings.length === 1 ? "" : "s"}`} issues={warnings} tone="warning" />}
        {warnings.length === 0 && <p className="flex items-center gap-2 text-sm font-semibold text-[#24643d]"><CheckCircle2 className="h-4 w-4" /> Workbook passed validation with no warnings.</p>}

        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#68756c]">Driver changes</p>
            <span className="text-xs font-semibold text-[#68756c]">{diff.changes.length} detail{diff.changes.length === 1 ? "" : "s"}</span>
          </div>
          {changes.length > 0 ? (
            <div className="mt-2 space-y-2">
              {changes.map((change, index) => (
                <div key={`${change.kind}-${change.sheet}-${change.driverName}-${index}`} className="rounded-[5px] border border-[#e0e7e0] bg-[#fbfcf8] px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <ChangeKind kind={change.kind} />
                    <span className="font-semibold text-[#172019]">{change.driverName}</span>
                    <span className="text-xs text-[#68756c]">{change.sheet}</span>
                  </div>
                  {change.fields.length > 0 && <p className="mt-1 text-xs text-[#536156]">Fields: {change.fields.join(", ")}</p>}
                  {change.fields.length > 0 && (change.before || change.after) && (
                    <div className="mt-2 space-y-1 border-t border-[#e0e7e0] pt-2 text-xs leading-5 text-[#536156]">
                      {(change as ExtendedCatalogChange).detailsTruncated && <p className="font-semibold text-[#805d00]">Some before/after values are shortened in this preview.</p>}
                      {change.fields.map((field) => (
                        <p key={field}>
                          <span className="font-bold text-[#344139]">{field}:</span>{" "}
                          {change.before ? <span className="text-[#8c2f2a]">{workbookFieldValue(change.before, field) || "(blank)"}</span> : <span className="text-[#8c2f2a]">(added)</span>}
                          <span className="px-1 text-[#68756c]">→</span>
                          {change.after ? <span className="text-[#24643d]">{workbookFieldValue(change.after, field) || "(blank)"}</span> : <span className="text-[#24643d]">(removed)</span>}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : extendedDiff.truncated ? (
            <p className="mt-2 rounded-[5px] border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">The server omitted some change details from this preview. Review the counts and activate only when the available detail is sufficient.</p>
          ) : extendedDiff.reorderedSheets && extendedDiff.reorderedSheets.length > 0 ? (
            <p className="mt-2 rounded-[5px] bg-[#fbfcf8] px-3 py-3 text-sm text-[#536156]">No driver row changes. Sheet order changed: <span className="font-semibold text-[#344139]">{extendedDiff.reorderedSheets.join(", ")}</span>.</p>
          ) : (
            <p className="mt-2 rounded-[5px] bg-[#fbfcf8] px-3 py-3 text-sm text-[#68756c]">No driver row changes compared with the active workbook.</p>
          )}
          {hasMoreChanges && (
            <button type="button" onClick={onShowAllChanges} className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-[#24643d] underline underline-offset-2">
              {showAllChanges ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {showAllChanges ? "Show fewer changes" : `Show all changes${diff.truncated ? " (some omitted by the server)" : ""}`}
            </button>
          )}
          {extendedDiff.truncated && <p className="mt-2 text-xs font-semibold text-[#805d00]">Some change rows are omitted by the server; the counts above include the complete comparison.</p>}
        </div>

        {(diff.addedSources > 0 || diff.removedSources > 0 || Boolean(extendedDiff.sourceChanges?.length)) && (
          <div className="rounded-[5px] border border-[#e0e7e0] bg-[#fbfcf8] px-3 py-3 text-sm text-[#536156]">
            <p className="font-semibold text-[#344139]">Source links</p>
            <p className="mt-1">{diff.addedSources} added · {diff.removedSources} removed</p>
            {extendedDiff.sourceChanges && extendedDiff.sourceChanges.length > 0 && <ul className="mt-2 space-y-1 text-xs leading-5">{extendedDiff.sourceChanges.slice(0, 20).map((change, index) => <li key={`${change.sheet}-${change.url}-${index}`}><span className="font-bold">{change.kind === "added" ? "Added" : "Removed"}</span> in {change.sheet}: <span className="break-all">{change.url}</span></li>)}</ul>}
            {(diff.addedSourceUrls.length > 0 || diff.removedSourceUrls.length > 0) && <p className="mt-1 text-xs leading-5">{diff.addedSourceUrls.length > 0 && `Added: ${diff.addedSourceUrls.slice(0, 3).join(", ")}`}{diff.removedSourceUrls.length > 0 && ` Removed: ${diff.removedSourceUrls.slice(0, 3).join(", ")}`}</p>}
          </div>
        )}

        {!version.isActive && (
          <div className="border-t border-[#e0e7e0] pt-4">
            {!confirming ? (
              <button ref={confirmationTriggerRef} type="button" onClick={onConfirm} disabled={!canActivate} className="inline-flex h-11 items-center justify-center gap-2 rounded-[5px] bg-[#172019] px-4 text-sm font-bold text-white transition hover:bg-[#2a382e] disabled:cursor-not-allowed disabled:opacity-50">
                <ShieldCheck className="h-4 w-4" /> Review activation
              </button>
            ) : (
              <div className="rounded-[6px] border border-[#c8d992] bg-[#f7fbe8] p-4" role="alertdialog" aria-labelledby="activate-workbook-title">
                <p id="activate-workbook-title" className="flex items-start gap-2 text-sm font-bold text-[#344139]"><AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-[#8a6b00]" />Activate this shared workbook?</p>
                <p className="mt-2 text-sm leading-6 text-[#536156]">This changes the workbook used for everyone&apos;s <strong>new</strong> jobs. Running jobs, retried jobs, and saved jobs keep the workbook version they already recorded.</p>
                <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button type="button" onClick={onCancelConfirm} disabled={activating} className="inline-flex h-10 items-center justify-center rounded-[5px] border border-[#bfcac1] px-4 text-sm font-bold text-[#344139] hover:bg-white disabled:opacity-60">Keep reviewing</button>
                  <button ref={confirmationActionRef} type="button" onClick={onActivate} disabled={activating} className="inline-flex h-10 items-center justify-center gap-2 rounded-[5px] bg-[#24643d] px-4 text-sm font-bold text-white hover:bg-[#1d5333] disabled:cursor-wait disabled:opacity-60">
                    {activating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    {activating ? "Activating shared workbook" : "Activate shared workbook"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

type ExtendedCatalogChange = DriverCatalogDiff["changes"][number] & {
  detailsTruncated?: boolean;
};

type ExtendedCatalogDiff = DriverCatalogDiff & {
  reorderedSheets?: string[];
  sourceChanges?: Array<{ sheet: string; url: string; kind: "added" | "removed" }>;
};

function HistoryVersionCard({ version, loading, onPreview }: { version: DriverCatalogVersion; loading: boolean; onPreview: () => void }) {
  return (
    <div className="rounded-[6px] border border-[#d8e1d8] bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#172019]">{version.workbook}</p>
          <p className="mt-1 text-xs text-[#68756c]">v{versionLabel(version)} · {version.driverCount} drivers</p>
          <p className="mt-1 truncate text-xs text-[#68756c]">{formatCatalogAttribution(version.uploadedBy, version.uploadedAt)}</p>
        </div>
        {version.isActive ? (
          <span className="inline-flex flex-none items-center gap-1 rounded-full bg-[#e4f4dd] px-2 py-1 text-[10px] font-bold text-[#24643d]"><CheckCircle2 className="h-3 w-3" /> Active</span>
        ) : (
          <button type="button" onClick={onPreview} disabled={loading} className="inline-flex h-8 flex-none items-center gap-1.5 rounded-[4px] border border-[#bfcac1] px-2.5 text-xs font-bold text-[#344139] transition hover:border-[#172019] hover:bg-[#f4f7f3] disabled:cursor-wait disabled:opacity-60">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
            Preview
          </button>
        )}
      </div>
    </div>
  );
}

function Attribution({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="min-w-0"><p className="flex items-center gap-1.5 font-bold uppercase tracking-[0.08em] text-[#68756c]">{icon}{label}</p><p className="mt-1 truncate font-semibold text-[#344139]" title={value}>{value}</p></div>;
}

function DiffStat({ label, value, tone }: { label: string; value: number; tone: "green" | "red" | "amber" }) {
  const style = { green: "bg-[#e4f4dd] text-[#24643d]", red: "bg-[#fbe7e5] text-[#8c2f2a]", amber: "bg-[#fff4d8] text-[#805d00]" }[tone];
  return <div className={`rounded-[5px] px-3 py-2 ${style}`}><span className="block text-lg font-bold">{value}</span><span className="block text-[10px] font-bold uppercase tracking-[0.08em]">{label}</span></div>;
}

function ChangeKind({ kind }: { kind: DriverCatalogDiff["changes"][number]["kind"] }) {
  const style = { added: "bg-[#e4f4dd] text-[#24643d]", removed: "bg-[#fbe7e5] text-[#8c2f2a]", changed: "bg-[#fff4d8] text-[#805d00]" }[kind];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${style}`}>{kind}</span>;
}

function IssueNotice({ message, tone }: { message: string; tone: "error" | "warning" | "info" }) {
  const style = tone === "error" ? "border-red-200 bg-red-50 text-red-800" : tone === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-[#cfded0] bg-[#f4f8f1] text-[#536156]";
  return <div className={`mt-3 flex items-start gap-2 rounded-[5px] border px-3 py-2.5 text-sm ${style}`} role={tone === "error" ? "alert" : undefined}><AlertCircle className="mt-0.5 h-4 w-4 flex-none" /><span>{message}</span></div>;
}

function IssueList({ title, issues, tone }: { title: string; issues: WorkbookValidationIssue[]; tone: "warning" }) {
  return <div className="rounded-[5px] border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950"><p className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" />{title}</p><ul className="mt-2 space-y-1 text-xs leading-5">{issues.slice(0, 12).map((issue, index) => <li key={`${issue.sheet || "sheet"}-${issue.cell || index}-${index}`}><span className="font-bold">{[issue.sheet, issue.cell].filter(Boolean).join(" ") || "Workbook"}:</span> {issue.message}</li>)}</ul>{issues.length > 12 && <p className="mt-2 text-xs font-semibold">Showing the first 12 warnings.</p>}</div>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function workbookFieldValue(driver: unknown, field: string): string {
  const fieldMap: Record<string, keyof WorkbookDriver> = {
    "Driver Section": "section",
    "Driver Type": "type",
    "Driver Name": "name",
    "Driver Logic": "logic",
    "Evidence/KPI": "evidenceKpi",
    "Key Sources": "keySources",
    Link: "sourceUrls",
    Links: "sourceUrls",
  };
  const key = fieldMap[field] || fieldMap[Object.keys(fieldMap).find((known) => known.toLowerCase() === field.toLowerCase()) || ""];
  if (typeof driver === "string") return driver;
  if (!driver || typeof driver !== "object" || !key) return "";
  const value = (driver as WorkbookDriver)[key];
  if (Array.isArray(value)) return value.join(", ");
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
