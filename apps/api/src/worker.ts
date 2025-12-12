/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/**
 * Background Worker Process
 *
 * This worker processes download jobs from the BullMQ queue.
 * Run separately from the API server: npm run start:worker
 */

import type { Job } from "bullmq";
import { Worker } from "bullmq";
import { env } from "./config/env.ts";
import type { DownloadJobData } from "./lib/queue.ts";
import { DOWNLOAD_QUEUE_NAME } from "./lib/queue.ts";
import { createBullMQConnection, closeRedis } from "./lib/redis.ts";
import {
  checkS3Availability,
  generatePresignedUrl,
  closeS3,
} from "./lib/s3.ts";
import {
  markJobProcessing,
  markJobCompleted,
  markJobFailed,
  updateJobProgress,
  decrementUserActiveJobs,
} from "./services/job.service.ts";

// Worker configuration
const PROGRESS_UPDATE_INTERVAL_MS = 2000; // Update progress every 2 seconds

// Sleep helper
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Get random delay based on environment configuration
const getRandomDelay = (): number => {
  if (!env.DOWNLOAD_DELAY_ENABLED) return 0;
  const min = env.DOWNLOAD_DELAY_MIN_MS;
  const max = env.DOWNLOAD_DELAY_MAX_MS;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Process a download job
const processDownloadJob = async (
  job: Job<DownloadJobData>,
): Promise<{ downloadUrl: string }> => {
  const { jobId, fileId, userId } = job.data;
  const startTime = Date.now();

  console.log(
    `[Worker] Processing job ${jobId} for file_id=${fileId.toString()}, user=${userId}`,
  );

  // Mark job as processing
  await markJobProcessing(jobId);

  // Get simulated processing delay
  const totalDelayMs = getRandomDelay();
  const delaySec = (totalDelayMs / 1000).toFixed(1);
  console.log(`[Worker] Job ${jobId}: simulated delay=${delaySec}s`);

  // Simulate long-running download with progress updates
  const progressIntervals = Math.max(
    1,
    Math.floor(totalDelayMs / PROGRESS_UPDATE_INTERVAL_MS),
  );
  const delayPerInterval = totalDelayMs / progressIntervals;

  for (let i = 1; i <= progressIntervals; i++) {
    await sleep(delayPerInterval);

    // Calculate progress (0-90% during processing, 100% on completion)
    const progress = Math.min(Math.floor((i / progressIntervals) * 90), 90);

    // Update job progress in Redis (broadcasts to SSE subscribers)
    await updateJobProgress(jobId, progress);

    // Also update BullMQ job progress for monitoring
    await job.updateProgress(progress);

    console.log(`[Worker] Job ${jobId}: progress=${progress.toString()}%`);
  }

  // Check if file exists in S3
  const s3Result = await checkS3Availability(fileId);

  if (!s3Result.available) {
    throw new Error(`File not found in storage: file_id=${fileId.toString()}`);
  }

  // Generate presigned URL for direct download
  const downloadUrl = await generatePresignedUrl(fileId);

  // Mark job as completed
  await markJobCompleted(jobId, downloadUrl);

  const processingTimeMs = Date.now() - startTime;
  console.log(
    `[Worker] Job ${jobId} completed in ${processingTimeMs.toString()}ms, url generated`,
  );

  return { downloadUrl };
};

// Create worker instance
const worker = new Worker<DownloadJobData>(
  DOWNLOAD_QUEUE_NAME,
  processDownloadJob,
  {
    connection: createBullMQConnection(),
    concurrency: env.WORKER_CONCURRENCY,
    stalledInterval: 30000, // Check for stalled jobs every 30s
    maxStalledCount: 2, // Retry stalled job twice before failing
  },
);

// Worker event handlers
worker.on("ready", () => {
  console.log(
    `[Worker] Ready and waiting for jobs (concurrency: ${env.WORKER_CONCURRENCY.toString()})`,
  );
});

worker.on("active", (job) => {
  console.log(`[Worker] Job ${job.data.jobId} started processing`);
});

worker.on("progress", (job, progress) => {
  const progressValue = typeof progress === "number" ? progress : 0;
  console.log(
    `[Worker] Job ${job.data.jobId} progress: ${progressValue.toString()}%`,
  );
});

worker.on("completed", (job) => {
  const { jobId, userId } = job.data;
  console.log(`[Worker] Job ${jobId} completed successfully`);

  // Decrement user's active job count
  decrementUserActiveJobs(userId).catch((err: unknown) => {
    console.error(
      `[Worker] Failed to decrement active jobs for user ${userId}:`,
      err,
    );
  });
});

worker.on("failed", (job, err) => {
  if (!job) {
    console.error("[Worker] Job failed with no job data:", err);
    return;
  }

  const { jobId, fileId, userId } = job.data;
  const maxAttempts = job.opts.attempts ?? env.JOB_MAX_ATTEMPTS;
  const attemptsLeft = maxAttempts - job.attemptsMade;

  console.error(
    `[Worker] Job ${jobId} failed (attempt ${job.attemptsMade.toString()}/${maxAttempts.toString()}):`,
    err.message,
  );

  // Mark job as failed in Redis
  const canRetry = attemptsLeft > 0;
  markJobFailed(jobId, err.message, canRetry, job.attemptsMade).catch(
    (markErr: unknown) => {
      console.error(`[Worker] Failed to mark job ${jobId} as failed:`, markErr);
    },
  );

  // Decrement user's active job count on final failure
  if (!canRetry) {
    decrementUserActiveJobs(userId).catch((decErr: unknown) => {
      console.error(
        `[Worker] Failed to decrement active jobs for user ${userId}:`,
        decErr,
      );
    });
    console.log(
      `[Worker] Job ${jobId} exhausted all retries for file_id=${fileId.toString()}`,
    );
  }
});

worker.on("error", (err) => {
  console.error("[Worker] Worker error:", err);
});

worker.on("stalled", (jobId) => {
  console.warn(`[Worker] Job ${jobId} has stalled`);
});

// ============ Graceful Shutdown ============
/* eslint-disable n/no-process-exit */

// Track shutdown state to prevent multiple shutdowns
let isShuttingDown = false;
const SHUTDOWN_TIMEOUT_MS = 30000;

const shutdown = (signal: string): void => {
  if (isShuttingDown) {
    console.log(`[Worker] Shutdown already in progress, ignoring ${signal}`);
    return;
  }
  isShuttingDown = true;

  console.log(`\n[Worker] ${signal} received. Starting graceful shutdown...`);

  // Set timeout for forced shutdown
  const forceExitTimeout = setTimeout(() => {
    console.error("[Worker] Forced shutdown after timeout");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  // Close worker (waits for active jobs to complete)
  worker
    .close()
    .then(() => {
      console.log("[Worker] Worker closed");
      return closeRedis();
    })
    .then(() => {
      closeS3();
      console.log("[Worker] Graceful shutdown completed");
      clearTimeout(forceExitTimeout);
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error("[Worker] Error during shutdown:", error);
      clearTimeout(forceExitTimeout);
      process.exit(1);
    });
};

// Register shutdown handlers
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});

// ============ Uncaught Error Handlers ============

// Handle uncaught exceptions - log and exit gracefully
process.on("uncaughtException", (error: Error) => {
  console.error("[Worker] Uncaught Exception:", error);
  // Attempt graceful shutdown before exiting
  if (!isShuttingDown) {
    shutdown("uncaughtException");
  } else {
    process.exit(1);
  }
});

// Handle unhandled promise rejections - log and exit gracefully
process.on(
  "unhandledRejection",
  (reason: unknown, promise: Promise<unknown>) => {
    console.error(
      "[Worker] Unhandled Rejection at:",
      promise,
      "reason:",
      reason,
    );
    // Attempt graceful shutdown before exiting
    if (!isShuttingDown) {
      shutdown("unhandledRejection");
    } else {
      process.exit(1);
    }
  },
);

// Log startup info
console.log(`[Worker] Starting download worker...`);
console.log(`[Worker] Environment: ${env.NODE_ENV}`);
console.log(`[Worker] Redis: ${env.REDIS_HOST}:${env.REDIS_PORT.toString()}`);
console.log(`[Worker] Concurrency: ${env.WORKER_CONCURRENCY.toString()}`);
console.log(
  `[Worker] Delay range: ${(env.DOWNLOAD_DELAY_MIN_MS / 1000).toString()}s - ${(env.DOWNLOAD_DELAY_MAX_MS / 1000).toString()}s`,
);
console.log(`[Worker] Max attempts: ${env.JOB_MAX_ATTEMPTS.toString()}`);
