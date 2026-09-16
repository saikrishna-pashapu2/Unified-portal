'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileText,
  Languages,
  RotateCcw,
  StopCircle,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { PdfLayoutCanvas } from '@/components/pdfx-v2/PdfLayoutCanvas';
import {
  clampLayoutZoomPercent,
  DEFAULT_LAYOUT_ZOOM_PERCENT,
  LAYOUT_ZOOM_STEP_PERCENT,
  MAX_LAYOUT_ZOOM_PERCENT,
  MIN_LAYOUT_ZOOM_PERCENT,
} from '@/components/pdfx-v2/layout-geometry';
import type { StoredPdfPageLayout } from '@/lib/pdfx-v2/schemas';
type JobStatus = {
  id: string;
  filename: string;
  targetLang: string;
  status: string;
  stage: string;
  message: string | null;
  progress: number;
  totalPages: number;
  currentPage: number;
  completedPages: number;
  attempts: number;
  maxAttempts: number;
};

type PageData = {
  pageNumber: number;
  status: string;
  originalText: string;
  translatedText: string;
  sourceLayout: StoredPdfPageLayout | null;
  translatedLayout: StoredPdfPageLayout | null;
  warnings: unknown;
};

type PaneKey = 'source' | 'original' | 'translated';
type PaneVisibility = Record<PaneKey, boolean>;
const ACTIVE = new Set(['queued', 'processing', 'cancelling']);
const PANE_LABELS: Record<PaneKey, string> = {
  source: 'Source PDF',
  original: 'Original text',
  translated: 'Translated text',
};

export default function PdfTranslator2Job({ jobId }: { jobId: string }) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [pages, setPages] = useState<PageData[]>([]);
  const [selectedPage, setSelectedPage] = useState(1);
  const [visiblePanes, setVisiblePanes] = useState<PaneVisibility>({
    source: false,
    original: true,
    translated: true,
  });
  const [layoutZoomPercent, setLayoutZoomPercent] = useState(MIN_LAYOUT_ZOOM_PERCENT);
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const refresh = useCallback(async () => {
    const [statusResponse, pagesResponse] = await Promise.all([
      fetch(`/api/pdfx-v2/status?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' }),
      fetch(`/api/pdfx-v2/pages?jobId=${encodeURIComponent(jobId)}&page=${selectedPage}`, { cache: 'no-store' }),
    ]);
    const statusPayload = await statusResponse.json().catch(() => ({})) as { job?: JobStatus; error?: string };
    if (!statusResponse.ok || !statusPayload.job) throw new Error(statusPayload.error ?? 'Unable to load job');
    setJob(statusPayload.job);
    if (pagesResponse.ok) {
      const pagePayload = await pagesResponse.json() as { pages?: PageData[] };
      setPages(pagePayload.pages ?? []);
    }
    return statusPayload.job;
  }, [jobId, selectedPage]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const current = await refresh();
        setError('');
        if (!stopped && ACTIVE.has(current.status)) timer = setTimeout(() => void poll(), 1800);
      } catch (caught) {
        if (!stopped) {
          setError(caught instanceof Error ? caught.message : 'Unable to load translation');
          timer = setTimeout(() => void poll(), 4000);
        }
      }
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [refresh]);

  const cancel = async () => {
    setCancelling(true);
    const response = await fetch('/api/pdfx-v2/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      setError(payload.error ?? 'Unable to cancel');
    }
    setCancelling(false);
    void refresh();
  };

  const togglePane = (pane: PaneKey) => {
    setVisiblePanes((current) => {
      const openCount = Object.values(current).filter(Boolean).length;
      if (current[pane] && openCount === 1) return current;
      return { ...current, [pane]: !current[pane] };
    });
  };

  const changePage = (nextPage: number) => {
    const safePage = Math.max(1, Math.min(job?.totalPages || 1, nextPage));
    setSelectedPage(safePage);
    requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  const zoomIn = useCallback(() => {
    setLayoutZoomPercent((current) => clampLayoutZoomPercent(current + LAYOUT_ZOOM_STEP_PERCENT));
  }, []);
  const zoomOut = useCallback(() => {
    setLayoutZoomPercent((current) => clampLayoutZoomPercent(current - LAYOUT_ZOOM_STEP_PERCENT));
  }, []);
  const fitZoom = useCallback(() => setLayoutZoomPercent(MIN_LAYOUT_ZOOM_PERCENT), []);
  const readableZoom = useCallback(() => setLayoutZoomPercent(DEFAULT_LAYOUT_ZOOM_PERCENT), []);

  const page = pages.find((item) => item.pageNumber === selectedPage);
  const isActive = !!job && ACTIVE.has(job.status);
  const visiblePaneCount = Object.values(visiblePanes).filter(Boolean).length;
  const hasVisibleTextPane = visiblePanes.original || visiblePanes.translated;
  const workspaceColumns = visiblePaneCount === 3
    ? 'xl:grid-cols-[minmax(300px,.82fr)_minmax(0,1fr)_minmax(0,1fr)]'
    : visiblePaneCount === 2
      ? 'lg:grid-cols-2'
      : 'grid-cols-1';

  return (
    <main className="min-h-[calc(100vh-65px)] bg-[#f3f0e8] text-slate-950">
      <header className="border-b border-slate-900/10 bg-white">
        <div className="mx-auto max-w-[1700px] px-4 py-5 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <Link href="/esg/tools/pdf-translator-2" aria-label="Back to PDF Translator" className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /></Link>
              <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[.18em] text-amber-700">OpenAI PDF Translator</p><h1 className="truncate font-serif text-2xl">{job?.filename ?? 'Loading translation…'}</h1></div>
            </div>
            <div className="flex items-center gap-2">
              {isActive && <button type="button" disabled={cancelling} onClick={() => void cancel()} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"><StopCircle className="h-4 w-4" />Cancel</button>}
              {job?.status === 'completed' && <a href={`/api/pdfx-v2/download?jobId=${encodeURIComponent(jobId)}`} className="inline-flex items-center gap-2 rounded-lg bg-[#132a33] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1c3a45]"><Download className="h-4 w-4" />Download PDF</a>}
            </div>
          </div>

          {job && (
            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <div className="mb-2 flex justify-between gap-4 text-xs"><span className="font-medium text-slate-700">{job.message ?? job.stage}</span><span className="font-mono font-bold">{job.progress}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-600 transition-all duration-500" style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} /></div>
              </div>
              <div className="text-xs text-slate-500">Page {job.currentPage || '—'} / {job.totalPages} · attempt {Math.max(job.attempts, 1)} of {job.maxAttempts || 3}</div>
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1700px] px-4 py-5 sm:px-7">
        {error && <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertTriangle className="h-5 w-5" />{error}<button type="button" onClick={() => void refresh()} className="ml-auto inline-flex items-center gap-1 font-semibold"><RotateCcw className="h-4 w-4" />Retry</button></div>}
        {job?.status === 'completed' && <div className="mb-4 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><CheckCircle2 className="h-5 w-5" />Every accepted page passed structure, numeric, and target-language validation.</div>}
        {job?.status === 'error' && <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><span><strong>Translation stopped safely.</strong> {job.message} {job.completedPages > 0 ? `${job.completedPages} completed ${job.completedPages === 1 ? 'page was' : 'pages were'} retained.` : 'No page reached a completed checkpoint.'}</span></div>}

        <div className="sticky top-[65px] z-30 mb-4 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur" aria-label="Document review controls">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Previous page" disabled={selectedPage <= 1} onClick={() => changePage(selectedPage - 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"><ChevronLeft className="h-4 w-4" /></button>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                <span>Page</span>
                <select value={selectedPage} onChange={(event) => changePage(Number(event.target.value))} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-200">
                  {Array.from({ length: job?.totalPages ?? 0 }, (_, index) => index + 1).map((number) => {
                    return <option key={number} value={number}>{number}</option>;
                  })}
                </select>
                <span>of {job?.totalPages || '—'}</span>
              </label>
              <button type="button" aria-label="Next page" disabled={selectedPage >= (job?.totalPages || 1)} onClick={() => changePage(selectedPage + 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div
                aria-label="Original and translated text zoom"
                className="mr-1 flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5"
                role="toolbar"
                title="Review zoom only. Translation coordinates and the downloaded PDF are unchanged."
              >
                <button
                  type="button"
                  aria-label="Fit text pages to panel width"
                  aria-pressed={layoutZoomPercent === MIN_LAYOUT_ZOOM_PERCENT}
                  disabled={!hasVisibleTextPane}
                  onClick={fitZoom}
                  className={`h-8 rounded-md px-2.5 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ${layoutZoomPercent === MIN_LAYOUT_ZOOM_PERCENT ? 'bg-[#132a33] text-white' : 'text-slate-600 hover:bg-white hover:text-slate-950'}`}
                >
                  Fit
                </button>
                <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-slate-200" />
                <button
                  type="button"
                  aria-label="Zoom text pages out"
                  disabled={!hasVisibleTextPane || layoutZoomPercent <= MIN_LAYOUT_ZOOM_PERCENT}
                  onClick={zoomOut}
                  className="grid h-8 w-8 place-items-center rounded-md text-slate-600 transition hover:bg-white hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <output
                  aria-atomic="true"
                  aria-live="polite"
                  className="min-w-[3.5rem] text-center font-mono text-xs font-bold tabular-nums text-slate-900"
                >
                  {layoutZoomPercent}%
                </output>
                <button
                  type="button"
                  aria-label="Zoom text pages in"
                  disabled={!hasVisibleTextPane || layoutZoomPercent >= MAX_LAYOUT_ZOOM_PERCENT}
                  onClick={zoomIn}
                  className="grid h-8 w-8 place-items-center rounded-md text-slate-600 transition hover:bg-white hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-slate-200" />
                <button
                  type="button"
                  aria-label={`Set readable text zoom to ${DEFAULT_LAYOUT_ZOOM_PERCENT} percent`}
                  aria-pressed={layoutZoomPercent === DEFAULT_LAYOUT_ZOOM_PERCENT}
                  disabled={!hasVisibleTextPane}
                  onClick={readableZoom}
                  className={`h-8 rounded-md px-2.5 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ${layoutZoomPercent === DEFAULT_LAYOUT_ZOOM_PERCENT ? 'bg-[#132a33] text-white' : 'text-slate-600 hover:bg-white hover:text-slate-950'}`}
                >
                  Readable
                </button>
              </div>
              <span className="mr-1 hidden text-xs font-semibold text-slate-400 sm:inline">Visible panels</span>
              {(Object.keys(PANE_LABELS) as PaneKey[]).map((paneKey) => (
                <PaneToggle key={paneKey} label={PANE_LABELS[paneKey]} visible={visiblePanes[paneKey]} disabled={visiblePanes[paneKey] && visiblePaneCount === 1} onClick={() => togglePane(paneKey)} />
              ))}
            </div>
          </div>
        </div>

        <div ref={workspaceRef} className={`grid scroll-mt-36 items-start gap-4 ${workspaceColumns}`}>
          {visiblePanes.source && (
            <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <PaneHeader title="Source PDF" detail="Selected page" icon={<FileText className="h-4 w-4" />} collapseDisabled={visiblePaneCount === 1} onCollapse={() => togglePane('source')} />
              <PagePreview
                alt={`Original source PDF, page ${selectedPage}`}
                src={previewUrl(jobId, selectedPage, 'source')}
              />
            </section>
          )}
          {visiblePanes.original && (
            <LayoutPane
              title="Original text"
              tone="original"
              layout={page?.sourceLayout}
              text={page?.originalText ?? ''}
              emptyLabel={isActive ? 'This page has not been extracted yet.' : 'No original text was extracted.'}
              collapseDisabled={visiblePaneCount === 1}
              zoomPercent={layoutZoomPercent}
              onFitZoom={fitZoom}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onCollapse={() => togglePane('original')}
            />
          )}
          {visiblePanes.translated && (
            <LayoutPane
              title={`Translated text · ${job?.targetLang ?? ''}`}
              tone="translated"
              layout={page?.translatedLayout}
              text={page?.translatedText ?? ''}
              emptyLabel={isActive ? 'This page has not been translated yet.' : 'No translated text is available.'}
              collapseDisabled={visiblePaneCount === 1}
              zoomPercent={layoutZoomPercent}
              onFitZoom={fitZoom}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onCollapse={() => togglePane('translated')}
            />
          )}
        </div>
      </div>
    </main>
  );
}

function previewUrl(jobId: string, pageNumber: number, document: 'source' | 'translated') {
  return `/api/pdfx-v2/preview?jobId=${encodeURIComponent(jobId)}&page=${pageNumber}&document=${document}`;
}

function PaneToggle({ label, visible, disabled, onClick }: { label: string; visible: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={visible} disabled={disabled} onClick={onClick} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${visible ? 'border-[#132a33] bg-[#132a33] text-white' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900'}`}>
      {visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}{label}
    </button>
  );
}

function PaneHeader({ title, detail, icon, collapseDisabled, onCollapse }: { title: string; detail?: string; icon: ReactNode; collapseDisabled: boolean; onCollapse: () => void }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4">
      <div className="flex items-center gap-2 text-sm font-bold">{icon}<span>{title}</span>{detail && <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{detail}</span>}</div>
      <button type="button" disabled={collapseDisabled} onClick={onCollapse} aria-label={`Collapse ${title}`} title={collapseDisabled ? 'Keep at least one panel visible' : `Collapse ${title}`} className="rounded-md p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-35"><EyeOff className="h-4 w-4" /></button>
    </div>
  );
}

function LayoutPane({ title, tone, layout, text, emptyLabel, collapseDisabled, zoomPercent, onFitZoom, onZoomIn, onZoomOut, onCollapse }: { title: string; tone: 'original' | 'translated'; layout?: StoredPdfPageLayout | null; text: string; emptyLabel: string; collapseDisabled: boolean; zoomPercent: number; onFitZoom: () => void; onZoomIn: () => void; onZoomOut: () => void; onCollapse: () => void }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className={`flex min-h-12 items-center justify-between gap-3 rounded-t-xl border-b px-4 ${tone === 'translated' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
        <div className="flex min-w-0 items-center gap-2 text-sm font-bold"><Languages className={`h-4 w-4 shrink-0 ${tone === 'translated' ? 'text-amber-700' : 'text-slate-500'}`} /><span className="truncate">{title}</span></div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Layout · {zoomPercent}%</span>
          <button type="button" disabled={collapseDisabled} onClick={onCollapse} aria-label={`Collapse ${title}`} title={collapseDisabled ? 'Keep at least one panel visible' : `Collapse ${title}`} className="rounded-md p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-35"><EyeOff className="h-4 w-4" /></button>
        </div>
      </div>
      <PdfLayoutCanvas
        emptyLabel={emptyLabel}
        label={title}
        layout={layout}
        onFitZoom={onFitZoom}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        text={text}
        variant={tone}
        zoomPercent={zoomPercent}
      />
    </section>
  );
}

function PagePreview({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="bg-slate-200 p-2 sm:p-3">
      {/* The browser uses the PNG's intrinsic page ratio. This avoids the
          nested PDF-viewer scrollbars and shows the exact persisted page. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="block h-auto w-full bg-white shadow-sm" />
    </div>
  );
}
