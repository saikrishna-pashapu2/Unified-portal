import { describe, expect, it } from "vitest";
import {
  canResumePartialDriverJob,
  driverPollRetryDelay,
  driverResumePath,
  isCancellableDriverJob,
  isCurrentDriverRequest,
  mergeDriverHistoryPage,
  shouldPollDriverJob,
  trackedDriverJobForScreen,
} from "../drivers-client";

describe("ESG drivers client lifecycle", () => {
  it("rejects a stale result after the user switches jobs", () => {
    expect(
      isCurrentDriverRequest({
        activeJobId: "job-b",
        requestedJobId: "job-a",
        activeEpoch: 4,
        requestEpoch: 3,
      }),
    ).toBe(false);
  });

  it("rejects aborted and superseded requests even for the same job", () => {
    expect(
      isCurrentDriverRequest({
        activeJobId: "job-a",
        requestedJobId: "job-a",
        activeEpoch: 5,
        requestEpoch: 4,
      }),
    ).toBe(false);
    expect(
      isCurrentDriverRequest({
        activeJobId: "job-a",
        requestedJobId: "job-a",
        activeEpoch: 5,
        requestEpoch: 5,
        aborted: true,
      }),
    ).toBe(false);
  });

  it("keeps polling a completed job until its matching result loads", () => {
    expect(
      shouldPollDriverJob({
        jobId: "job-a",
        status: "done",
        loadingJob: false,
        hasMatchingResult: false,
      }),
    ).toBe(true);
    expect(
      shouldPollDriverJob({
        jobId: "job-a",
        status: "done",
        loadingJob: false,
        hasMatchingResult: true,
      }),
    ).toBe(false);
  });

  it.each(["error", "cancelled"] as const)(
    "stops polling a terminal %s job",
    (status) => {
      expect(
        shouldPollDriverJob({
          jobId: "job-a",
          status,
          loadingJob: false,
          hasMatchingResult: false,
        }),
      ).toBe(false);
    },
  );

  it("distinguishes cancellation requests from permanent deletion", () => {
    expect(isCancellableDriverJob("queued")).toBe(true);
    expect(isCancellableDriverJob("processing")).toBe(true);
    expect(isCancellableDriverJob("done")).toBe(false);
    expect(isCancellableDriverJob("error")).toBe(false);
    expect(isCancellableDriverJob("cancelled")).toBe(false);
  });

  it("allows resume only for the displayed completed partial job", () => {
    expect(
      canResumePartialDriverJob({
        completion: "partial",
        status: "done",
        jobId: "job-a",
        resultJobId: "job-a",
        resumable: true,
      }),
    ).toBe(true);

    expect(
      canResumePartialDriverJob({
        completion: "complete",
        status: "done",
        jobId: "job-a",
        resultJobId: "job-a",
        resumable: true,
      }),
    ).toBe(false);
    expect(
      canResumePartialDriverJob({
        completion: "partial",
        status: "processing",
        jobId: "job-a",
        resultJobId: "job-a",
        resumable: true,
      }),
    ).toBe(false);
    expect(
      canResumePartialDriverJob({
        completion: "partial",
        status: "done",
        jobId: "job-b",
        resultJobId: "job-a",
        resumable: true,
      }),
    ).toBe(false);
    expect(
      canResumePartialDriverJob({
        completion: "partial",
        status: "done",
        jobId: "job-a",
        resultJobId: "job-a",
        resumable: false,
      }),
    ).toBe(false);
  });

  it("builds an encoded resume endpoint for the parent job", () => {
    expect(driverResumePath("parent/job #1")).toBe(
      "/api/esg/drivers/parent%2Fjob%20%231/resume",
    );
  });

  it("keeps a running job tracked on setup but releases it on history", () => {
    expect(
      trackedDriverJobForScreen({
        routeJobId: "",
        screen: "new",
        runningJobId: "job-a",
      }),
    ).toBe("job-a");
    expect(
      trackedDriverJobForScreen({
        routeJobId: "",
        screen: "home",
        runningJobId: "job-a",
      }),
    ).toBe("");
  });

  it("backs off repeated transient polling failures", () => {
    expect(driverPollRetryDelay(0)).toBe(1_800);
    expect(driverPollRetryDelay(1)).toBe(3_600);
    expect(driverPollRetryDelay(2)).toBe(7_200);
    expect(driverPollRetryDelay(20)).toBe(10_000);
  });

  it("deduplicates cursor pages while updating repeated jobs", () => {
    expect(
      mergeDriverHistoryPage(
        [
          { id: "a", stage: "queued" },
          { id: "b", stage: "done" },
        ],
        [
          { id: "b", stage: "updated" },
          { id: "c", stage: "done" },
        ],
      ),
    ).toEqual([
      { id: "a", stage: "queued" },
      { id: "b", stage: "updated" },
      { id: "c", stage: "done" },
    ]);
  });
});
