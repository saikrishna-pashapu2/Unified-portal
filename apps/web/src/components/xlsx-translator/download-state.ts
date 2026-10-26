import type { ExcelJobView } from "@/lib/xlsx-translator/types";

export type ExcelDownloadState = {
  /** Number shown to users for source-language cells or entries in a partial draft. */
  partialDraftCount: number;
  partialDraftCountKind: "cells" | "entries";
  isPartialDraft: boolean;
  hasUnexplainedPreviewGaps: boolean;
  showDownload: boolean;
};

type ExcelDownloadJob = {
  status: string;
  canDownload: boolean;
  usage?: Pick<
    NonNullable<ExcelJobView["usage"]>,
    "flaggedCells" | "flaggedEntries"
  > | null;
};

/**
 * Keep the server's canDownload decision authoritative while allowing a
 * deliberate partial draft to remain downloadable when the preview is still
 * loading or reports the flagged source-language cells.
 */
export function getExcelDownloadState(
  job: ExcelDownloadJob,
  unavailableCells?: number,
): ExcelDownloadState {
  const flaggedCells = Math.max(0, job.usage?.flaggedCells ?? 0);
  const flaggedEntries = Math.max(0, job.usage?.flaggedEntries ?? 0);
  const partialDraftCountKind = flaggedCells > 0 ? "cells" : "entries";
  const partialDraftCount =
    flaggedCells > 0 ? flaggedCells : flaggedEntries;
  const completed = job.status === "completed";
  const isPartialDraft =
    completed && job.canDownload && partialDraftCount > 0;
  const hasUnexplainedPreviewGaps =
    completed && !isPartialDraft && (unavailableCells ?? 0) > 0;

  return {
    partialDraftCount,
    partialDraftCountKind,
    isPartialDraft,
    hasUnexplainedPreviewGaps,
    showDownload: completed && job.canDownload && !hasUnexplainedPreviewGaps,
  };
}
