/**
 * Next.js Instrumentation
 * 
 * This file runs once when the server starts, perfect for initializing
 * background workers like our alert scheduler.
 * 
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import { env } from "@/lib/config/env";

export const runtime = "nodejs";

export async function register() {
  // Only run in Node.js runtime (not Edge)
  if (
    env.NEXT_RUNTIME === 'nodejs' &&
    env.ENABLE_ALERT_SCHEDULER === 'true' &&
    env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { startAlertScheduler } = await import('./lib/alert-scheduler');
    
    // Start the alert scheduler
    startAlertScheduler();
  }
}
