import { describe, expect, it } from "vitest";
import { getExcelDownloadState } from "./download-state";

const job = (
  overrides: Partial<{
    status: string;
    canDownload: boolean;
    usage: { flaggedCells?: number; flaggedEntries?: number } | null;
  }> = {},
) => ({
  status: "completed",
  canDownload: true,
  usage: null,
  ...overrides,
});

describe("Excel download state", () => {
  it("keeps an intentional partial draft visible while preview is delayed", () => {
    const state = getExcelDownloadState(
      job({ usage: { flaggedCells: 3, flaggedEntries: 2 } }),
    );

    expect(state).toMatchObject({
      partialDraftCount: 3,
      partialDraftCountKind: "cells",
      isPartialDraft: true,
      showDownload: true,
    });
  });

  it("keeps an intentional partial draft visible after preview flags its cells", () => {
    const state = getExcelDownloadState(
      job({ usage: { flaggedCells: 2, flaggedEntries: 1 } }),
      2,
    );

    expect(state.showDownload).toBe(true);
  });

  it("uses flagged entries as the count fallback", () => {
    const state = getExcelDownloadState(
      job({ usage: { flaggedEntries: 4 } }),
    );

    expect(state).toMatchObject({
      partialDraftCount: 4,
      partialDraftCountKind: "entries",
      isPartialDraft: true,
      showDownload: true,
    });
  });

  it("hides a normal complete download when preview exposes unexplained gaps", () => {
    const state = getExcelDownloadState(job(), 1);

    expect(state).toMatchObject({
      hasUnexplainedPreviewGaps: true,
      showDownload: false,
    });
  });

  it.each([
    ["queued", true],
    ["processing", true],
    ["error", true],
    ["completed", false],
  ])(
    "does not offer downloads for %s when the server disallows it",
    (status, canDownload) => {
      expect(
        getExcelDownloadState(job({ status, canDownload })).showDownload,
      ).toBe(false);
    },
  );
});
