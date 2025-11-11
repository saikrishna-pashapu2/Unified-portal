export type JobStatus = "queued" | "processing" | "done" | "error";

export type Job = {
  id: string;
  status: JobStatus;
  error?: string;
  // NEW: hold the result in memory (no need to write to C:\Temp)
  buffer?: Buffer;
  filename?: string;
  createdAt: number;
  // Progress tracking
  progress?: {
    current: number;
    total: number;
    currentCompany?: string;
  };
};

// Singleton pattern to ensure only one JOBS Map across all route handlers
const globalForJobs = globalThis as unknown as {
  jobsMap: Map<string, Job> | undefined;
};

export const JOBS = globalForJobs.jobsMap ?? new Map<string, Job>();

if (process.env.NODE_ENV !== "production") {
  globalForJobs.jobsMap = JOBS;
}

// Clean up jobs older than 1 hour
const JOB_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export function cleanupOldJobs() {
  const now = Date.now();
  const toDelete: string[] = [];
  
  JOBS.forEach((job, id) => {
    if (now - job.createdAt > JOB_EXPIRY_MS) {
      toDelete.push(id);
    }
  });
  
  toDelete.forEach(id => JOBS.delete(id));
}

// Run cleanup every 10 minutes (only set up once)
if (!globalForJobs.jobsMap) {
  setInterval(cleanupOldJobs, 10 * 60 * 1000);
}