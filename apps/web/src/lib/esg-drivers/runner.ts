import "server-only";

import { generateEsgDriverResult } from "./generator";
import {
  completeEsgDriverJob,
  getEsgDriverJob,
  updateEsgDriverJobCheckpoint,
  updateEsgDriverJobProgress,
} from "./jobs";
import type {
  EsgDriverCheckpoint,
  EsgDriverProgressDetail,
  GenerateEsgDriversInput,
} from "./types";
import type { ClaimedBackgroundJob } from "@/lib/jobs/queue";
import { throwIfJobCancelled } from "@/lib/jobs/queue";

export async function runEsgDriverGenerationJob(
  job: ClaimedBackgroundJob<GenerateEsgDriversInput>,
): Promise<{ queueCompleted: boolean; result: Record<string, unknown> }> {
  try {
    const existing = await getEsgDriverJob(job.id, job.userId, {
      includeCheckpoint: true,
    });
    if (existing?.status === "done" && existing.result) {
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
      stage: existing?.checkpoint ? "resuming from checkpoint" : "starting",
    });

    const result = await generateEsgDriverResult(job.payload, {
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
      onCheckpoint: async (checkpoint: EsgDriverCheckpoint) => {
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
