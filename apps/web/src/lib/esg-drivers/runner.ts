import "server-only";

import { generateEsgDriverResult } from "./generator";
import { generateEsgDriverResult as generateLegacyEsgDriverResult } from "./harness";
import {
  completeEsgDriverJob,
  getEsgDriverJob,
  updateEsgDriverJobCheckpoint,
  updateEsgDriverJobProgress,
} from "./jobs";
import type {
  AnyEsgDriverCheckpoint,
  EsgDriverProgressDetail,
  GenerateEsgDriversInput,
} from "./types";
import type { ClaimedBackgroundJob } from "@/lib/jobs/queue";
import { throwIfJobCancelled } from "@/lib/jobs/queue";
import { assertWorkbookResult } from './result-integrity';
import { canonicalizeEsgDriverCountry, canonicalizeEsgDriverSector } from './coverage';

function payloadMatchesPinnedScope(
  payload: GenerateEsgDriversInput,
  checkpoint: Extract<AnyEsgDriverCheckpoint, { version: 2 }>,
): boolean {
  // The v3/v4 compatibility queues may contain payloads written before the
  // request schema canonicalized bundled aliases (for example, "United Arab
  // Emirates" alongside a checkpoint's "UAE"). Restrict normalization to the
  // checkpoint's own labels so custom uploaded labels can never be rewritten by
  // a bundled alias.
  const country = canonicalizeEsgDriverCountry(payload.country, [checkpoint.input.country]);
  const sector = canonicalizeEsgDriverSector(payload.sector, [checkpoint.input.sector]);
  return country === checkpoint.input.country && sector === checkpoint.input.sector && payload.language === checkpoint.input.language;
}

export async function runEsgDriverGenerationJob(
  job: ClaimedBackgroundJob<GenerateEsgDriversInput>,
): Promise<{ queueCompleted: boolean; result: Record<string, unknown> }> {
  try {
    const existing = await getEsgDriverJob(job.id, job.userId, {
      includeCheckpoint: true,
    });
    const checkpoint = existing?.checkpoint;
    if (job.jobType === "esg_driver_excel_v5" && checkpoint?.version !== 2) {
      throw new Error("ESG Driver v5 jobs require an immutable workbook checkpoint.");
    }
    if (checkpoint?.version === 2) {
      const payload = job.payload as GenerateEsgDriversInput & {
        catalogVersionId?: unknown;
        workbookSha256?: unknown;
      };
      if (!payloadMatchesPinnedScope(payload, checkpoint)) {
        throw new Error("ESG Driver queue payload does not match its pinned workbook checkpoint.");
      }
      if (payload.expectedWorkbookVersion && payload.expectedWorkbookVersion !== checkpoint.catalogVersion) {
        throw new Error("ESG Driver queue payload has an invalid pinned workbook version.");
      }
      if (payload.catalogVersionId !== undefined && payload.catalogVersionId !== checkpoint.catalogVersionId) {
        throw new Error("ESG Driver queue payload has an invalid pinned workbook catalog id.");
      }
      if (payload.workbookSha256 !== undefined && payload.workbookSha256 !== checkpoint.workbookSha256) {
        throw new Error("ESG Driver queue payload has an invalid pinned workbook hash.");
      }
    }
    if (existing?.status === "done" && existing.result) {
      if (existing.checkpoint?.version === 2) {
        assertWorkbookResult(existing.result, existing.checkpoint, true);
      }
      return {
        queueCompleted: false,
        result: { generatedDrivers: existing.result.drivers.length, reused: true },
      };
    }
    await throwIfJobCancelled(job.id, job.leaseOwner);
    let reportedProgress =
      existing?.checkpoint && Number.isFinite(existing.progress)
        ? Math.max(5, Math.min(99, Math.floor(existing.progress)))
        : 5;
    await updateEsgDriverJobProgress(job.id, job.leaseOwner, {
      status: "processing",
      progress: reportedProgress,
      stage: existing?.checkpoint?.version === 2 && existing.checkpoint.slots.length ? "resuming from checkpoint" : "starting",
    });

    // The unversioned queue and v3/v4 rows may still carry the original
    // selection-runtime checkpoint. Keep those jobs on the legacy harness;
    // version 5 is always the catalog-pinned workbook workflow above.
    const generate = job.jobType !== "esg_driver_excel_v5" && checkpoint?.version !== 2
      ? generateLegacyEsgDriverResult
      : generateEsgDriverResult;
    const result = await (generate as typeof generateEsgDriverResult)(job.payload, {
      checkpoint: existing?.checkpoint ?? undefined,
      onProgress: async (
        stage: string,
        progress: number,
        detail?: EsgDriverProgressDetail,
      ) => {
        await throwIfJobCancelled(job.id, job.leaseOwner);
        // A claimed retry keeps its durable progress floor. Restored slots are
        // intentionally skipped by the harness, so early selection callbacks
        // must not make a resumed job appear to restart from zero.
        reportedProgress = Math.max(
          reportedProgress,
          Math.max(0, Math.min(99, Math.floor(progress))),
        );
        await updateEsgDriverJobProgress(job.id, job.leaseOwner, {
          status: "processing",
          progress: reportedProgress,
          stage,
          detail,
        });
      },
      onCheckpoint: async (checkpoint: AnyEsgDriverCheckpoint) => {
        await throwIfJobCancelled(job.id, job.leaseOwner);
        await updateEsgDriverJobCheckpoint(
          job.id,
          job.leaseOwner,
          checkpoint,
        );
      },
    });

    await throwIfJobCancelled(job.id, job.leaseOwner);
    const completed = await completeEsgDriverJob(job.id, job.leaseOwner, result);
    if (!completed) {
      // Classify a cancellation separately; every other failed completion is a
      // lost lease and must not mutate the domain row.
      await throwIfJobCancelled(job.id, job.leaseOwner);
      throw new Error("Unable to commit ESG driver result.");
    }
    return {
      queueCompleted: true,
      result: {
        generatedDrivers: result.drivers.length,
        expectedDrivers: result.expectedDriverCount ?? result.drivers.length,
        completion: result.completion ?? "complete",
        catalogVersion: result.catalogVersion,
      },
    };
  } catch (error: any) {
    console.error("[esg-drivers] generation failed:", error);
    throw error;
  }
}
