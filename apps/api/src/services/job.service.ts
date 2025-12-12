/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
/**
 * Job Service
 *
 * Handles job CRUD operations in Redis.
 *
 * Note: ESLint rules are disabled due to ioredis type definitions
 * not being fully compatible with strict TypeScript settings.
 */
import { env } from "../config/env.ts";
import { redis, RedisKeys } from "../lib/redis.ts";

// Job status enum
export type JobStatus = "queued" | "processing" | "completed" | "failed";

// Job data stored in Redis
export interface JobData {
  id: string;
  fileId: number;
  userId: string;
  status: JobStatus;
  progress: number;
  downloadUrl: string | null;
  error: string | null;
  canRetry: boolean;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

// Redis hash data structure
interface RedisJobHash {
  id: string;
  fileId: string;
  userId: string;
  status: string;
  progress: string;
  downloadUrl: string;
  error: string;
  canRetry: string;
  attempts: string;
  createdAt: string;
  updatedAt: string;
}

// Create a new job in Redis
export const createJob = async (
  jobId: string,
  fileId: number,
  userId: string,
): Promise<JobData> => {
  const now = Date.now();
  const job: JobData = {
    id: jobId,
    fileId,
    userId,
    status: "queued",
    progress: 0,
    downloadUrl: null,
    error: null,
    canRetry: false,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };

  const key = RedisKeys.job(jobId);
  await redis.hset(key, {
    id: job.id,
    fileId: String(job.fileId),
    userId: job.userId,
    status: job.status,
    progress: String(job.progress),
    downloadUrl: job.downloadUrl ?? "",
    error: job.error ?? "",
    canRetry: String(job.canRetry),
    attempts: String(job.attempts),
    createdAt: String(job.createdAt),
    updatedAt: String(job.updatedAt),
  });
  await redis.expire(key, env.JOB_TTL_SECONDS);

  console.log(
    `[JobService] Created job ${jobId} for file_id=${fileId.toString()}`,
  );
  return job;
};

// Get job by ID
export const getJob = async (jobId: string): Promise<JobData | null> => {
  const key = RedisKeys.job(jobId);
  const data = await redis.hgetall(key);

  // Check if data exists and has required fields
  if (Object.keys(data).length === 0) {
    return null;
  }

  const jobData = data as unknown as RedisJobHash;

  return {
    id: jobData.id,
    fileId: parseInt(jobData.fileId, 10),
    userId: jobData.userId,
    status: jobData.status as JobStatus,
    progress: parseInt(jobData.progress, 10),
    downloadUrl: jobData.downloadUrl || null,
    error: jobData.error || null,
    canRetry: jobData.canRetry === "true",
    attempts: parseInt(jobData.attempts, 10),
    createdAt: parseInt(jobData.createdAt, 10),
    updatedAt: parseInt(jobData.updatedAt, 10),
  };
};

// Update job status
export const updateJobStatus = async (
  jobId: string,
  status: JobStatus,
  additionalData?: Partial<{
    progress: number;
    downloadUrl: string;
    error: string;
    canRetry: boolean;
    attempts: number;
  }>,
): Promise<void> => {
  const key = RedisKeys.job(jobId);
  const updates: Record<string, string> = {
    status,
    updatedAt: String(Date.now()),
  };

  if (additionalData?.progress !== undefined) {
    updates.progress = String(additionalData.progress);
  }
  if (additionalData?.downloadUrl !== undefined) {
    updates.downloadUrl = additionalData.downloadUrl;
  }
  if (additionalData?.error !== undefined) {
    updates.error = additionalData.error;
  }
  if (additionalData?.canRetry !== undefined) {
    updates.canRetry = String(additionalData.canRetry);
  }
  if (additionalData?.attempts !== undefined) {
    updates.attempts = String(additionalData.attempts);
  }

  await redis.hset(key, updates);

  // Publish update for SSE subscribers
  const updatePayload = {
    status,
    ...additionalData,
  };
  await redis.publish(
    RedisKeys.jobUpdates(jobId),
    JSON.stringify(updatePayload),
  );

  console.log(`[JobService] Updated job ${jobId}: status=${status}`);
};

// Update job progress
export const updateJobProgress = async (
  jobId: string,
  progress: number,
): Promise<void> => {
  const key = RedisKeys.job(jobId);
  const updates = {
    progress: String(progress),
    updatedAt: String(Date.now()),
  };

  await redis.hset(key, updates);

  // Publish progress update for SSE subscribers
  await redis.publish(
    RedisKeys.jobUpdates(jobId),
    JSON.stringify({ progress, status: "processing" }),
  );
};

// Mark job as processing
export const markJobProcessing = async (jobId: string): Promise<void> => {
  await updateJobStatus(jobId, "processing", { progress: 0 });

  // Add to processing set for watchdog monitoring
  await redis.zadd(RedisKeys.jobsProcessing, Date.now(), jobId);
};

// Mark job as completed
export const markJobCompleted = async (
  jobId: string,
  downloadUrl: string,
): Promise<void> => {
  await updateJobStatus(jobId, "completed", {
    progress: 100,
    downloadUrl,
  });

  // Remove from processing set
  await redis.zrem(RedisKeys.jobsProcessing, jobId);
};

// Mark job as failed
export const markJobFailed = async (
  jobId: string,
  error: string,
  canRetry: boolean = true,
  attempts?: number,
): Promise<void> => {
  await updateJobStatus(jobId, "failed", {
    error,
    canRetry,
    attempts,
  });

  // Remove from processing set
  await redis.zrem(RedisKeys.jobsProcessing, jobId);
};

// Check and set idempotency key
export const checkIdempotencyKey = async (
  idempotencyKey: string,
): Promise<string | null> => {
  const key = RedisKeys.idempotency(idempotencyKey);
  const existingJobId = await redis.get(key);
  return existingJobId;
};

// Set idempotency key
export const setIdempotencyKey = async (
  idempotencyKey: string,
  jobId: string,
): Promise<void> => {
  const key = RedisKeys.idempotency(idempotencyKey);
  await redis.set(key, jobId, "EX", env.JOB_TTL_SECONDS);
};

// Rate limiting: check user active jobs
export const checkUserRateLimit = async (
  userId: string,
): Promise<{ allowed: boolean; activeJobs: number }> => {
  const key = RedisKeys.userActiveJobs(userId);
  const activeJobsStr = await redis.get(key);
  const activeJobs = parseInt(activeJobsStr ?? "0", 10);

  return {
    allowed: activeJobs < env.MAX_CONCURRENT_DOWNLOADS_PER_USER,
    activeJobs,
  };
};

// Rate limiting: increment user active jobs
export const incrementUserActiveJobs = async (
  userId: string,
): Promise<void> => {
  const key = RedisKeys.userActiveJobs(userId);
  await redis.incr(key);
  // Set TTL for safety (in case decrement fails)
  await redis.expire(key, env.JOB_TTL_SECONDS);
};

// Rate limiting: decrement user active jobs
export const decrementUserActiveJobs = async (
  userId: string,
): Promise<void> => {
  const key = RedisKeys.userActiveJobs(userId);
  const current = await redis.decr(key);
  // Clean up if count reaches 0 or goes negative
  if (current <= 0) {
    await redis.del(key);
  }
};

// Get stuck jobs (for watchdog)
export const getStuckJobs = async (
  stuckThresholdMs: number = 10 * 60 * 1000,
): Promise<string[]> => {
  const threshold = Date.now() - stuckThresholdMs;
  const stuckJobs = await redis.zrangebyscore(
    RedisKeys.jobsProcessing,
    0,
    threshold,
  );
  return stuckJobs;
};
