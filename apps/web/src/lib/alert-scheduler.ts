import cron from 'node-cron';

/**
 * Alert Scheduler Worker
 * 
 * This worker runs inside the Next.js application and schedules alert processing
 * using node-cron. No external cron daemon needed!
 * 
 * Schedules:
 * - Alert Processing: Every hour at :00 minutes
 * - Email Queue Processing: Every 5 minutes
 */

const APP_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

// Use globalThis to persist state across module reloads in development
// This ensures the scheduler state is maintained even when Next.js hot-reloads modules
declare global {
  var alertSchedulerState: {
    isStarted: boolean;
    alertProcessingTask: any;
    emailQueueTask: any;
    weeklyDigestTask: any;
  } | undefined;
}

// Initialize or retrieve persistent state
if (!globalThis.alertSchedulerState) {
  globalThis.alertSchedulerState = {
    isStarted: false,
    alertProcessingTask: null,
    emailQueueTask: null,
    weeklyDigestTask: null,
  };
}
// Convenience accessors
const getState = () => globalThis.alertSchedulerState!;
const setState = (updates: Partial<typeof globalThis.alertSchedulerState>) => {
  Object.assign(globalThis.alertSchedulerState!, updates);
};

async function callEndpoint(path: string, name: string) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.error(`Cannot trigger ${name}: CRON_SECRET is not configured`);
    return;
  }

  try {
    const url = `${APP_URL}${path}`;
    const now = new Date();
    const dubaiTime = now.toLocaleString('en-US', { timeZone: 'Asia/Dubai', hour12: false });
    console.log(`[UTC: ${now.toISOString()} | Dubai: ${dubaiTime}] Triggering ${name}...`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cronSecret}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    const endTime = new Date();
    const endDubaiTime = endTime.toLocaleString('en-US', { timeZone: 'Asia/Dubai', hour12: false });
    
    if (response.ok) {
      console.log(`[UTC: ${endTime.toISOString()} | Dubai: ${endDubaiTime}] ✅ ${name} completed:`, data);
    } else {
      console.error(`[UTC: ${endTime.toISOString()} | Dubai: ${endDubaiTime}] ❌ ${name} failed:`, data);
    }
  } catch (error) {
    const errorTime = new Date();
    const errorDubaiTime = errorTime.toLocaleString('en-US', { timeZone: 'Asia/Dubai', hour12: false });
    console.error(`[UTC: ${errorTime.toISOString()} | Dubai: ${errorDubaiTime}] ❌ ${name} error:`, error);
  }
}

export function startAlertScheduler() {
  // Check if tasks are already running
  const state = getState();
  const hasRunningTasks = state.alertProcessingTask !== null || state.emailQueueTask !== null || state.weeklyDigestTask !== null;
  
  // Prevent multiple starts
  if (state.isStarted || hasRunningTasks) {
    console.log('⚠️  Alert scheduler already started, skipping...');
    return { success: false, message: 'Scheduler already running' };
  }

  console.log('🚀 Starting Alert Scheduler...');
  if (!process.env.CRON_SECRET?.trim()) {
    console.error('Alert Scheduler not started: CRON_SECRET is not configured');
    return { success: false, message: 'CRON_SECRET is not configured' };
  }
  
  // Alert Processing - Every 5 minutes
  // Cron: "*/5 * * * *" = Every 5 minutes
  const alertTask = cron.schedule('*/5 * * * *', async () => {
    await callEndpoint('/api/cron/process-alerts', 'Alert Processing');
  }, {
    timezone: "Asia/Dubai", // Adjust to your timezone
  });
  
  setState({ alertProcessingTask: alertTask });
  console.log('✅ Alert Processing scheduled: Every 5 minutes');

  // Email Queue Processing - Every 5 minutes
  // Cron: "*/5 * * * *" = Every 5 minutes
  const emailTask = cron.schedule('*/5 * * * *', async () => {
    await callEndpoint('/api/cron/process-queue', 'Email Queue Processing');
  }, {
    timezone: "Asia/Dubai", // Adjust to your timezone
  });
  
  setState({ emailQueueTask: emailTask });
  console.log('✅ Email Queue Processing scheduled: Every 5 minutes');

  // Weekly Digest Generation - Every Monday at 9am GST
  // Cron: "0 9 * * 1" = At 09:00 on Monday
  const digestTask = cron.schedule('0 9 * * 1', async () => {
    await callEndpoint('/api/cron/generate-digest', 'Weekly Digest Generation');
  }, {
    timezone: "Asia/Dubai",
  });
  
  setState({ weeklyDigestTask: digestTask });
  console.log('✅ Weekly Digest Generation scheduled: Every Monday at 9am GST');

  setState({ isStarted: true });
  console.log('🎉 Alert Scheduler started successfully!');
  console.log(`📍 Timezone: Asia/Dubai`);
  
  return { success: true, message: 'Scheduler started successfully' };
}

export function stopAlertScheduler() {
  // Check if any tasks are actually running
  const state = getState();
  const hasRunningTasks = state.alertProcessingTask !== null || state.emailQueueTask !== null || state.weeklyDigestTask !== null;
  
  if (!state.isStarted && !hasRunningTasks) {
    console.log('⚠️  Alert scheduler not running');
    return { success: false, message: 'Scheduler not running' };
  }

  console.log('🛑 Stopping Alert Scheduler...');
  
  // Stop the cron tasks
  if (state.alertProcessingTask) {
    state.alertProcessingTask.stop();
    setState({ alertProcessingTask: null });
    console.log('✅ Alert Processing task stopped');
  }
  
  if (state.emailQueueTask) {
    state.emailQueueTask.stop();
    setState({ emailQueueTask: null });
    console.log('✅ Email Queue Processing task stopped');
  }
  
  if (state.weeklyDigestTask) {
    state.weeklyDigestTask.stop();
    setState({ weeklyDigestTask: null });
    console.log('✅ Weekly Digest Generation task stopped');
  }
  
  setState({ isStarted: false });
  console.log('🛑 Alert Scheduler stopped successfully');
  
  return { success: true, message: 'Scheduler stopped successfully' };
}

export function getSchedulerStatus() {
  // Check actual task status, not just the flag
  const state = getState();
  const hasRunningTasks = state.alertProcessingTask !== null || state.emailQueueTask !== null || state.weeklyDigestTask !== null;
  
  return {
    isRunning: state.isStarted || hasRunningTasks, // Running if flag is set OR tasks exist
    tasks: {
      alertProcessing: state.alertProcessingTask !== null,
      emailQueue: state.emailQueueTask !== null,
      weeklyDigest: state.weeklyDigestTask !== null,
    },
  };
}
