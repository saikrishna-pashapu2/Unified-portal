import type { EsgDriverJobStatus } from "@/lib/esg-drivers/types";

export function isCurrentDriverRequest(input: {
  activeJobId: string;
  requestedJobId: string;
  activeEpoch: number;
  requestEpoch?: number;
  aborted?: boolean;
}): boolean {
  return Boolean(
    !input.aborted &&
      input.activeJobId === input.requestedJobId &&
      (input.requestEpoch === undefined ||
        input.requestEpoch === input.activeEpoch),
  );
}

export function shouldPollDriverJob(input: {
  jobId: string;
  status: EsgDriverJobStatus | null | undefined;
  loadingJob: boolean;
  hasMatchingResult: boolean;
}): boolean {
  if (!input.jobId || input.loadingJob || !input.status) return false;
  if (input.status === "queued" || input.status === "processing") return true;
  return input.status === "done" && !input.hasMatchingResult;
}

export function isCancellableDriverJob(status: EsgDriverJobStatus): boolean {
  return status === "queued" || status === "processing";
}

export function canResumePartialDriverJob(input: {
  completion: "complete" | "partial" | undefined;
  status: EsgDriverJobStatus | null | undefined;
  jobId: string;
  resultJobId: string;
  resumable: boolean;
}): boolean {
  return Boolean(
    input.resumable &&
      input.completion === "partial" &&
      input.status === "done" &&
      input.jobId &&
      input.jobId === input.resultJobId,
  );
}

export function driverResumePath(jobId: string): string {
  return `/api/esg/drivers/${encodeURIComponent(jobId)}/resume`;
}

export function trackedDriverJobForScreen(input: {
  routeJobId: string;
  screen: "home" | "new" | "detail";
  runningJobId: string;
}): string {
  if (input.routeJobId) return input.routeJobId;
  return input.screen === "new" ? input.runningJobId : "";
}

export function driverPollRetryDelay(failureCount: number): number {
  const failures = Math.max(0, Math.min(Math.floor(failureCount), 3));
  return Math.min(10_000, 1_800 * 2 ** failures);
}

export function mergeDriverHistoryPage<T extends { id: string }>(
  current: T[],
  incoming: T[],
): T[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return Array.from(byId.values());
}
