import "server-only";

import { generateEsgDriverResult } from "./generator";
import {
  completeEsgDriverJob,
  failEsgDriverJob,
  updateEsgDriverJobProgress,
} from "./jobs";
import type { GenerateEsgDriversInput } from "./types";

export async function runEsgDriverGenerationJob(
  jobId: string,
  input: GenerateEsgDriversInput,
): Promise<void> {
  try {
    await updateEsgDriverJobProgress(jobId, {
      status: "processing",
      progress: 5,
      stage: "starting",
    });

    const result = await generateEsgDriverResult(input, async (stage, progress) => {
      await updateEsgDriverJobProgress(jobId, {
        status: "processing",
        progress,
        stage,
      });
    });

    await completeEsgDriverJob(jobId, result);
  } catch (error: any) {
    console.error("[esg-drivers] generation failed:", error);
    await failEsgDriverJob(
      jobId,
      error?.message || "ESG driver generation failed.",
    );
  }
}
