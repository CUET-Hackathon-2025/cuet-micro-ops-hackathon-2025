/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
/**
 * Download Routes
 *
 * Handles all download-related endpoints including legacy sync and new async APIs.
 *
 * Note: ESLint rules are disabled for Redis operations due to ioredis type definitions
 * not being fully compatible with strict TypeScript settings.
 */
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import Redis from "ioredis";
import { env } from "../config/env.ts";
import { addDownloadJob } from "../lib/queue.ts";
import { RedisKeys } from "../lib/redis.ts";
import { checkS3Availability } from "../lib/s3.ts";
import {
  AsyncDownloadRequestSchema,
  AsyncDownloadResponseSchema,
  DownloadCheckRequestSchema,
  DownloadCheckResponseSchema,
  DownloadInitiateRequestSchema,
  DownloadInitiateResponseSchema,
  DownloadStartRequestSchema,
  DownloadStartResponseSchema,
  ErrorResponseSchema,
  JobStatusResponseSchema,
  RateLimitErrorSchema,
} from "../schemas/index.ts";
import {
  checkIdempotencyKey,
  checkUserRateLimit,
  createJob,
  getJob,
  incrementUserActiveJobs,
  setIdempotencyKey,
} from "../services/job.service.ts";

const downloadRouter = new OpenAPIHono();

// ============ Helper Functions ============
const getRandomDelay = (): number => {
  if (!env.DOWNLOAD_DELAY_ENABLED) return 0;
  const min = env.DOWNLOAD_DELAY_MIN_MS;
  const max = env.DOWNLOAD_DELAY_MAX_MS;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Get user ID from request (simplified - in production use auth)
const getUserId = (c: Context): string => {
  return (
    c.req.header("x-user-id") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "anonymous"
  );
};

// SSE update interface
interface SSEUpdate {
  status?: string;
  progress?: number;
  downloadUrl?: string;
  error?: string;
  canRetry?: boolean;
}

// ============ Legacy Routes (Kept for Backward Compatibility) ============

const downloadInitiateRoute = createRoute({
  method: "post",
  path: "/v1/download/initiate",
  tags: ["Download (Legacy)"],
  summary: "Initiate download job (Legacy)",
  description: "Legacy endpoint - Initiates a download job for multiple IDs",
  request: {
    body: {
      content: {
        "application/json": {
          schema: DownloadInitiateRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Download job initiated",
      content: {
        "application/json": {
          schema: DownloadInitiateResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const downloadCheckRoute = createRoute({
  method: "post",
  path: "/v1/download/check",
  tags: ["Download (Legacy)"],
  summary: "Check download availability",
  description:
    "Checks if a single ID is available for download in S3. Add ?sentry_test=true to trigger an error for Sentry testing.",
  request: {
    query: z.object({
      sentry_test: z.string().optional(),
    }),
    body: {
      content: {
        "application/json": {
          schema: DownloadCheckRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Availability check result",
      content: {
        "application/json": {
          schema: DownloadCheckResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const downloadStartRoute = createRoute({
  method: "post",
  path: "/v1/download/start",
  tags: ["Download (Legacy)"],
  summary: "Start file download (Legacy - Blocking)",
  description: `Legacy blocking endpoint. Processing time varies between ${(env.DOWNLOAD_DELAY_MIN_MS / 1000).toString()}s and ${(env.DOWNLOAD_DELAY_MAX_MS / 1000).toString()}s.
    **Recommended**: Use POST /v1/download for non-blocking async downloads.`,
  request: {
    body: {
      content: {
        "application/json": {
          schema: DownloadStartRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Download completed",
      content: {
        "application/json": {
          schema: DownloadStartResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// ============ New Async Routes (Recommended) ============

const asyncDownloadRoute = createRoute({
  method: "post",
  path: "/v1/download",
  tags: ["Download (Async)"],
  summary: "Create async download job",
  description: `Creates a non-blocking download job. Returns immediately with jobId and URLs for status polling and SSE subscription.
    Use X-Idempotency-Key header to prevent duplicate jobs on retries.`,
  request: {
    headers: z.object({
      "x-idempotency-key": z.string().optional().openapi({
        description: "Optional idempotency key to prevent duplicate jobs",
      }),
      "x-user-id": z.string().optional().openapi({
        description: "Optional user ID for rate limiting",
      }),
    }),
    body: {
      content: {
        "application/json": {
          schema: AsyncDownloadRequestSchema,
        },
      },
    },
  },
  responses: {
    202: {
      description: "Job created successfully",
      content: {
        "application/json": {
          schema: AsyncDownloadResponseSchema,
        },
      },
    },
    200: {
      description: "Existing job returned (idempotent request)",
      content: {
        "application/json": {
          schema: AsyncDownloadResponseSchema,
        },
      },
    },
    429: {
      description: "Rate limited - too many concurrent downloads",
      content: {
        "application/json": {
          schema: RateLimitErrorSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const jobStatusRoute = createRoute({
  method: "get",
  path: "/v1/download/status/:jobId",
  tags: ["Download (Async)"],
  summary: "Get job status",
  description: "Poll for the current status of a download job",
  request: {
    params: z.object({
      jobId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Job status",
      content: {
        "application/json": {
          schema: JobStatusResponseSchema,
        },
      },
    },
    404: {
      description: "Job not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

const sseSubscribeRoute = createRoute({
  method: "get",
  path: "/v1/download/subscribe/:jobId",
  tags: ["Download (Async)"],
  summary: "Subscribe to job updates (SSE)",
  description: `Server-Sent Events stream for real-time job progress updates.
    Events: status, progress, complete, error`,
  request: {
    params: z.object({
      jobId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "SSE stream",
      content: {
        "text/event-stream": {
          schema: z.string(),
        },
      },
    },
    404: {
      description: "Job not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// ============ Route Handlers ============

// Legacy: Initiate
downloadRouter.openapi(downloadInitiateRoute, (c) => {
  const { file_ids } = c.req.valid("json");
  const jobId = crypto.randomUUID();
  return c.json(
    {
      jobId,
      status: "queued" as const,
      totalFileIds: file_ids.length,
    },
    200,
  );
});

// Legacy: Check
downloadRouter.openapi(downloadCheckRoute, async (c) => {
  const { sentry_test } = c.req.valid("query");
  const { file_id } = c.req.valid("json");

  if (sentry_test === "true") {
    throw new Error(
      `Sentry test error triggered for file_id=${file_id.toString()}`,
    );
  }

  const s3Result = await checkS3Availability(file_id);
  return c.json({ file_id, ...s3Result }, 200);
});

// Legacy: Start (blocking)
downloadRouter.openapi(downloadStartRoute, async (c) => {
  const { file_id } = c.req.valid("json");
  const startTime = Date.now();

  const delayMs = getRandomDelay();
  console.log(
    `[Download] Starting file_id=${file_id.toString()} | delay=${(delayMs / 1000).toFixed(1)}s`,
  );

  await sleep(delayMs);

  const s3Result = await checkS3Availability(file_id);
  const processingTimeMs = Date.now() - startTime;

  console.log(
    `[Download] Completed file_id=${file_id.toString()}, time=${processingTimeMs.toString()}ms`,
  );

  if (s3Result.available) {
    return c.json(
      {
        file_id,
        status: "completed" as const,
        downloadUrl: `https://storage.example.com/${s3Result.s3Key ?? ""}?token=${crypto.randomUUID()}`,
        size: s3Result.size,
        processingTimeMs,
        message: `Download ready after ${(processingTimeMs / 1000).toFixed(1)} seconds`,
      },
      200,
    );
  } else {
    return c.json(
      {
        file_id,
        status: "failed" as const,
        downloadUrl: null,
        size: null,
        processingTimeMs,
        message: `File not found after ${(processingTimeMs / 1000).toFixed(1)} seconds`,
      },
      200,
    );
  }
});

// New: Async Download (non-blocking)
downloadRouter.openapi(asyncDownloadRoute, async (c) => {
  const { file_id } = c.req.valid("json");
  const idempotencyKey = c.req.header("x-idempotency-key");
  const userId = getUserId(c);

  // Check idempotency key first
  if (idempotencyKey) {
    const existingJobId = await checkIdempotencyKey(idempotencyKey);
    if (existingJobId) {
      const existingJob = await getJob(existingJobId);
      if (existingJob) {
        console.log(
          `[Download] Returning existing job ${existingJobId} for idempotency key`,
        );
        return c.json(
          {
            jobId: existingJob.id,
            fileId: existingJob.fileId,
            status: existingJob.status === "queued" ? "queued" : "processing",
            isNew: false,
            createdAt: existingJob.createdAt,
            statusUrl: `/v1/download/status/${existingJob.id}`,
            subscribeUrl: `/v1/download/subscribe/${existingJob.id}`,
          },
          200,
        );
      }
    }
  }

  // Check rate limit
  const rateLimit = await checkUserRateLimit(userId);
  if (!rateLimit.allowed) {
    return c.json(
      {
        error: "Too Many Requests",
        message: `Maximum ${env.MAX_CONCURRENT_DOWNLOADS_PER_USER.toString()} concurrent downloads allowed`,
        retryAfter: 30,
      },
      429,
    );
  }

  // Create new job
  const jobId = crypto.randomUUID();
  const now = Date.now();

  // Create job in Redis
  await createJob(jobId, file_id, userId);

  // Set idempotency key if provided
  if (idempotencyKey) {
    await setIdempotencyKey(idempotencyKey, jobId);
  }

  // Increment user active jobs
  await incrementUserActiveJobs(userId);

  // Add to queue
  await addDownloadJob({
    jobId,
    fileId: file_id,
    userId,
    idempotencyKey,
    createdAt: now,
  });

  console.log(
    `[Download] Created async job ${jobId} for file_id=${file_id.toString()}, user=${userId}`,
  );

  return c.json(
    {
      jobId,
      fileId: file_id,
      status: "queued" as const,
      isNew: true,
      createdAt: now,
      statusUrl: `/v1/download/status/${jobId}`,
      subscribeUrl: `/v1/download/subscribe/${jobId}`,
    },
    202,
  );
});

// New: Job Status (polling)
downloadRouter.openapi(jobStatusRoute, async (c) => {
  const { jobId } = c.req.valid("param");

  const job = await getJob(jobId);
  if (!job) {
    return c.json(
      {
        error: "Not Found",
        message: "Job not found or expired",
        requestId: c.get("requestId"),
      },
      404,
    );
  }

  return c.json(
    {
      jobId: job.id,
      fileId: job.fileId,
      status: job.status,
      progress: job.progress,
      downloadUrl: job.downloadUrl,
      error: job.error,
      canRetry: job.canRetry,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
    200,
  );
});

// New: SSE Subscribe (real-time updates)
downloadRouter.openapi(sseSubscribeRoute, async (c) => {
  const { jobId } = c.req.valid("param");

  // Verify job exists
  const job = await getJob(jobId);
  if (!job) {
    return c.json(
      {
        error: "Not Found",
        message: "Job not found or expired",
        requestId: c.get("requestId"),
      },
      404,
    );
  }

  // If job is already completed or failed, send final state
  if (job.status === "completed" || job.status === "failed") {
    return streamSSE(c, async (stream) => {
      const eventType = job.status === "completed" ? "complete" : "error";
      const data =
        job.status === "completed"
          ? { status: job.status, progress: 100, downloadUrl: job.downloadUrl }
          : { status: job.status, error: job.error, canRetry: job.canRetry };

      await stream.writeSSE({
        event: eventType,
        data: JSON.stringify(data),
      });
    });
  }

  // Stream real-time updates via Redis pub/sub
  return streamSSE(c, async (stream) => {
    // Create a dedicated Redis connection for subscription
    const subscriber: Redis = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD ?? undefined,
      db: env.REDIS_DB,
    });

    const channel = RedisKeys.jobUpdates(jobId);
    let isActive = true;

    // Send initial status
    await stream.writeSSE({
      event: "status",
      data: JSON.stringify({
        status: job.status,
        progress: job.progress,
      }),
    });

    // Subscribe to job updates
    await subscriber.subscribe(channel);

    subscriber.on("message", (_channel: string, message: string) => {
      if (!isActive) return;

      try {
        const update = JSON.parse(message) as SSEUpdate;
        let eventType = "progress";

        if (update.status === "completed") {
          eventType = "complete";
        } else if (update.status === "failed") {
          eventType = "error";
        } else if (
          update.status === "queued" ||
          update.status === "processing"
        ) {
          eventType = "status";
        }

        stream
          .writeSSE({
            event: eventType,
            data: message,
          })
          .catch((err: unknown) => {
            console.error("[SSE] Error writing to stream:", err);
          });

        // Close stream on terminal states
        if (update.status === "completed" || update.status === "failed") {
          isActive = false;
          subscriber.unsubscribe(channel).catch(() => {});
          subscriber.quit().catch(() => {});
        }
      } catch (err) {
        console.error("[SSE] Error processing message:", err);
      }
    });

    // Handle client disconnect
    stream.onAbort(() => {
      isActive = false;
      subscriber.unsubscribe(channel).catch(() => {});
      subscriber.quit().catch(() => {});
      console.log(`[SSE] Client disconnected from job ${jobId}`);
    });

    // Keep connection alive with heartbeat
    const heartbeatInterval = setInterval(() => {
      if (!isActive) {
        clearInterval(heartbeatInterval);
        return;
      }
      stream
        .writeSSE({
          event: "heartbeat",
          data: JSON.stringify({ timestamp: Date.now() }),
        })
        .catch(() => {
          isActive = false;
          clearInterval(heartbeatInterval);
        });
    }, 15000);

    // Clean up on stream end
    stream.onAbort(() => {
      clearInterval(heartbeatInterval);
    });
  });
});

export { downloadRouter };
