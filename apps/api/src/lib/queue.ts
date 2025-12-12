/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
/**
 * BullMQ Queue Configuration
 *
 * Note: ESLint rules are disabled for some operations due to ioredis type definitions
 * not being fully compatible with strict TypeScript settings.
 */
import { Queue, QueueEvents } from "bullmq";
import type Redis from "ioredis";
import { env } from "../config/env.ts";
import { createBullMQConnection } from "./redis.ts";

// Queue name constant
export const DOWNLOAD_QUEUE_NAME = "downloads";

// Create Redis connection for queue
const queueConnection: Redis = createBullMQConnection();

// Download queue with BullMQ
export const downloadQueue: Queue = new Queue(DOWNLOAD_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: env.JOB_MAX_ATTEMPTS,
    backoff: {
      type: "exponential",
      delay: env.JOB_BACKOFF_DELAY_MS,
    },
    removeOnComplete: {
      age: env.JOB_TTL_SECONDS,
      count: 1000,
    },
    removeOnFail: {
      age: env.JOB_TTL_SECONDS * 7, // Keep failed jobs for 7x longer
      count: 5000,
    },
  },
});

// Queue events for monitoring
export const downloadQueueEvents: QueueEvents = new QueueEvents(
  DOWNLOAD_QUEUE_NAME,
  {
    connection: createBullMQConnection(),
  },
);

// Job data interface
export interface DownloadJobData {
  jobId: string;
  fileId: number;
  userId: string;
  idempotencyKey?: string;
  createdAt: number;
}

// Add job to queue
export const addDownloadJob = async (data: DownloadJobData): Promise<void> => {
  await downloadQueue.add("download", data, {
    jobId: data.jobId, // Use our jobId as BullMQ jobId for easy lookup
  });
  console.log(
    `[Queue] Added job ${data.jobId} for file_id=${data.fileId.toString()} to queue`,
  );
};

// Queue health check
export const checkQueueHealth = async (): Promise<boolean> => {
  try {
    await downloadQueue.getJobCounts();
    return true;
  } catch (error) {
    console.error("[Queue] Health check failed:", error);
    return false;
  }
};

// Get queue stats
export const getQueueStats = async (): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> => {
  const counts = await downloadQueue.getJobCounts();
  return {
    waiting: counts.waiting,
    active: counts.active,
    completed: counts.completed,
    failed: counts.failed,
    delayed: counts.delayed,
  };
};

// Graceful shutdown
export const closeQueue = async (): Promise<void> => {
  await downloadQueue.close();
  await downloadQueueEvents.close();
  await queueConnection.quit();
  console.log("[Queue] Closed successfully");
};
