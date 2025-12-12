import { z } from "@hono/zod-openapi";

// ============ Error Response Schema ============
export const ErrorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  })
  .openapi("ErrorResponse");

// ============ Health Response Schema ============
export const HealthResponseSchema = z
  .object({
    status: z.enum(["healthy", "unhealthy"]),
    checks: z.object({
      storage: z.enum(["ok", "error"]),
      redis: z.enum(["ok", "error"]),
      queue: z.enum(["ok", "error"]),
    }),
  })
  .openapi("HealthResponse");

// ============ Legacy Download Schemas ============
export const DownloadInitiateRequestSchema = z
  .object({
    file_ids: z
      .array(z.number().int().min(10000).max(100000000))
      .min(1)
      .max(1000)
      .openapi({ description: "Array of file IDs (10K to 100M)" }),
  })
  .openapi("DownloadInitiateRequest");

export const DownloadInitiateResponseSchema = z
  .object({
    jobId: z.string().openapi({ description: "Unique job identifier" }),
    status: z.enum(["queued", "processing"]),
    totalFileIds: z.number().int(),
  })
  .openapi("DownloadInitiateResponse");

export const DownloadCheckRequestSchema = z
  .object({
    file_id: z
      .number()
      .int()
      .min(10000)
      .max(100000000)
      .openapi({ description: "Single file ID to check (10K to 100M)" }),
  })
  .openapi("DownloadCheckRequest");

export const DownloadCheckResponseSchema = z
  .object({
    file_id: z.number().int(),
    available: z.boolean(),
    s3Key: z
      .string()
      .nullable()
      .openapi({ description: "S3 object key if available" }),
    size: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "File size in bytes" }),
  })
  .openapi("DownloadCheckResponse");

export const DownloadStartRequestSchema = z
  .object({
    file_id: z
      .number()
      .int()
      .min(10000)
      .max(100000000)
      .openapi({ description: "File ID to download (10K to 100M)" }),
  })
  .openapi("DownloadStartRequest");

export const DownloadStartResponseSchema = z
  .object({
    file_id: z.number().int(),
    status: z.enum(["completed", "failed"]),
    downloadUrl: z
      .string()
      .nullable()
      .openapi({ description: "Presigned download URL if successful" }),
    size: z
      .number()
      .int()
      .nullable()
      .openapi({ description: "File size in bytes" }),
    processingTimeMs: z
      .number()
      .int()
      .openapi({ description: "Time taken to process the download in ms" }),
    message: z.string().openapi({ description: "Status message" }),
  })
  .openapi("DownloadStartResponse");

// ============ Async Download Schemas (New Architecture) ============
export const AsyncDownloadRequestSchema = z
  .object({
    file_id: z
      .number()
      .int()
      .min(10000)
      .max(100000000)
      .openapi({ description: "File ID to download (10K to 100M)" }),
  })
  .openapi("AsyncDownloadRequest");

export const AsyncDownloadResponseSchema = z
  .object({
    jobId: z.string().openapi({ description: "Unique job identifier" }),
    fileId: z.number().int(),
    status: z.enum(["queued", "processing"]),
    isNew: z
      .boolean()
      .openapi({ description: "Whether this is a new job or existing one" }),
    createdAt: z
      .number()
      .int()
      .openapi({ description: "Unix timestamp in ms" }),
    statusUrl: z.string().openapi({ description: "URL to poll for status" }),
    subscribeUrl: z.string().openapi({ description: "SSE subscription URL" }),
  })
  .openapi("AsyncDownloadResponse");

export const JobStatusResponseSchema = z
  .object({
    jobId: z.string(),
    fileId: z.number().int(),
    status: z.enum(["queued", "processing", "completed", "failed"]),
    progress: z.number().int().min(0).max(100),
    downloadUrl: z
      .string()
      .nullable()
      .openapi({ description: "Presigned download URL when completed" }),
    error: z
      .string()
      .nullable()
      .openapi({ description: "Error message when failed" }),
    canRetry: z
      .boolean()
      .openapi({ description: "Whether job can be retried" }),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .openapi("JobStatusResponse");

export const RateLimitErrorSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    retryAfter: z.number().int().openapi({ description: "Seconds to wait" }),
  })
  .openapi("RateLimitError");

// ============ SSE Event Types ============
export interface SSEStatusEvent {
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
}

export interface SSEProgressEvent {
  status: "processing";
  progress: number;
}

export interface SSECompleteEvent {
  status: "completed";
  progress: 100;
  downloadUrl: string;
}

export interface SSEErrorEvent {
  status: "failed";
  error: string;
  canRetry: boolean;
}

export type SSEEvent =
  | SSEStatusEvent
  | SSEProgressEvent
  | SSECompleteEvent
  | SSEErrorEvent;
