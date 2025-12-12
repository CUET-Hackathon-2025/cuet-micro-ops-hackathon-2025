import axios, { type AxiosError, type AxiosRequestConfig } from "axios";
import { getTracer, createTraceparent } from "./tracing";
import { logError, addBreadcrumb } from "./sentry";
import type { SpanStatusCode } from "@opentelemetry/api";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

// Create axios instance with defaults
const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 120000, // 2 minutes for long-running downloads
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor to add trace headers
apiClient.interceptors.request.use((config) => {
  const traceparent = createTraceparent();
  if (traceparent) {
    config.headers.set("traceparent", traceparent);
  }
  return config;
});

// API Response Types
export interface HealthResponse {
  status: "healthy" | "unhealthy";
  checks: {
    storage: "ok" | "error";
    redis?: "ok" | "error";
  };
}

export interface DownloadInitiateRequest {
  file_ids: number[];
}

export interface DownloadInitiateResponse {
  jobId: string;
  status: "queued" | "processing";
  totalFileIds: number;
}

export interface DownloadCheckRequest {
  file_id: number;
}

export interface DownloadCheckResponse {
  file_id: number;
  available: boolean;
  s3Key: string | null;
  size: number | null;
}

export interface DownloadStartRequest {
  file_id: number;
}

export interface DownloadStartResponse {
  file_id: number;
  status: "completed" | "failed";
  downloadUrl: string | null;
  size: number | null;
  processingTimeMs: number;
  message: string;
}

// New Async Download Types
export interface AsyncDownloadRequest {
  file_id: number;
}

export interface AsyncDownloadResponse {
  jobId: string;
  fileId: number;
  status: "queued" | "processing";
  isNew: boolean;
  createdAt: number;
  statusUrl: string;
  subscribeUrl: string;
}

export interface JobStatusResponse {
  jobId: string;
  fileId: number;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  downloadUrl?: string;
  error?: string;
  canRetry?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SSEUpdate {
  status?: string;
  progress?: number;
  downloadUrl?: string;
  error?: string;
  canRetry?: boolean;
  timestamp?: number;
}

export interface ApiError {
  error: string;
  message: string;
  requestId?: string;
}

// Track API metrics locally
export interface ApiMetrics {
  endpoint: string;
  method: string;
  status: number;
  duration: number;
  timestamp: Date;
  traceId: string | null;
  success: boolean;
}

const metricsStore: ApiMetrics[] = [];
const MAX_METRICS = 100;

function recordMetric(metric: ApiMetrics) {
  metricsStore.push(metric);
  if (metricsStore.length > MAX_METRICS) {
    metricsStore.shift();
  }
}

export function getMetrics(): ApiMetrics[] {
  return [...metricsStore];
}

export function clearMetrics() {
  metricsStore.length = 0;
}

// Error log for dashboard display
export interface ErrorLogEntry {
  id: string;
  timestamp: Date;
  message: string;
  endpoint: string;
  traceId: string | null;
  status?: number;
}

const errorLog: ErrorLogEntry[] = [];
const MAX_ERRORS = 50;

function recordError(entry: Omit<ErrorLogEntry, "id">) {
  errorLog.unshift({
    ...entry,
    id: crypto.randomUUID(),
  });
  if (errorLog.length > MAX_ERRORS) {
    errorLog.pop();
  }
}

export function getErrorLog(): ErrorLogEntry[] {
  return [...errorLog];
}

export function clearErrorLog() {
  errorLog.length = 0;
}

// Extract trace ID from traceparent header
function extractTraceId(traceparent: string | null): string | null {
  if (!traceparent) return null;
  const parts = traceparent.split("-");
  return parts.length >= 2 ? parts[1] : null;
}

// Generic axios wrapper with tracing and error handling
async function apiFetch<T>(
  endpoint: string,
  config: AxiosRequestConfig = {},
): Promise<{ data: T; traceId: string | null }> {
  const startTime = performance.now();
  const traceparent = createTraceparent();
  const traceId = extractTraceId(traceparent);

  // Add breadcrumb for Sentry
  addBreadcrumb(`API Request: ${config.method ?? "GET"} ${endpoint}`, "http", {
    url: `${API_URL}${endpoint}`,
    method: config.method ?? "GET",
  });

  try {
    const response = await apiClient.request<T>({
      url: endpoint,
      ...config,
    });

    const duration = performance.now() - startTime;

    // Record metrics
    recordMetric({
      endpoint,
      method: config.method ?? "GET",
      status: response.status,
      duration,
      timestamp: new Date(),
      traceId,
      success: true,
    });

    return { data: response.data, traceId };
  } catch (error) {
    const duration = performance.now() - startTime;
    const axiosError = error as AxiosError<ApiError>;
    const status = axiosError.response?.status ?? 0;
    const errorMessage =
      axiosError.response?.data?.message ?? axiosError.message;

    // Record failed metric
    recordMetric({
      endpoint,
      method: config.method ?? "GET",
      status,
      duration,
      timestamp: new Date(),
      traceId,
      success: false,
    });

    // Record error
    recordError({
      timestamp: new Date(),
      message: errorMessage,
      endpoint,
      traceId,
      status,
    });

    // Log to Sentry
    logError(axiosError, {
      endpoint,
      status,
      traceId,
      apiError: axiosError.response?.data,
    });

    throw error;
  }
}

// API Methods
export async function checkHealth(): Promise<{
  data: HealthResponse;
  traceId: string | null;
}> {
  return apiFetch<HealthResponse>("/health");
}

export async function initiateDownload(
  fileIds: number[],
): Promise<{ data: DownloadInitiateResponse; traceId: string | null }> {
  const tracer = getTracer();

  return new Promise((resolve, reject) => {
    tracer.startActiveSpan("download.initiate", async (span) => {
      try {
        span.setAttribute("download.file_count", fileIds.length);

        const result = await apiFetch<DownloadInitiateResponse>(
          "/v1/download/initiate",
          {
            method: "POST",
            data: { file_ids: fileIds },
          },
        );

        span.setAttribute("download.job_id", result.data.jobId);
        span.setStatus({ code: 1 as SpanStatusCode }); // OK
        span.end();
        resolve(result);
      } catch (error) {
        span.setStatus({
          code: 2 as SpanStatusCode, // ERROR
          message: error instanceof Error ? error.message : "Unknown error",
        });
        span.recordException(error as Error);
        span.end();
        reject(error);
      }
    });
  });
}

export async function checkDownload(
  fileId: number,
  triggerSentryTest = false,
): Promise<{ data: DownloadCheckResponse; traceId: string | null }> {
  const tracer = getTracer();

  return new Promise((resolve, reject) => {
    tracer.startActiveSpan("download.check", async (span) => {
      try {
        span.setAttribute("download.file_id", fileId);
        span.setAttribute("download.sentry_test", triggerSentryTest);

        const queryParams = triggerSentryTest ? "?sentry_test=true" : "";
        const result = await apiFetch<DownloadCheckResponse>(
          `/v1/download/check${queryParams}`,
          {
            method: "POST",
            data: { file_id: fileId },
          },
        );

        span.setAttribute("download.available", result.data.available);
        span.setStatus({ code: 1 as SpanStatusCode });
        span.end();
        resolve(result);
      } catch (error) {
        span.setStatus({
          code: 2 as SpanStatusCode,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        span.recordException(error as Error);
        span.end();
        reject(error);
      }
    });
  });
}

export async function startDownload(
  fileId: number,
): Promise<{ data: DownloadStartResponse; traceId: string | null }> {
  const tracer = getTracer();

  return new Promise((resolve, reject) => {
    tracer.startActiveSpan("download.start", async (span) => {
      try {
        span.setAttribute("download.file_id", fileId);

        const result = await apiFetch<DownloadStartResponse>(
          "/v1/download/start",
          {
            method: "POST",
            data: { file_id: fileId },
          },
        );

        span.setAttribute("download.status", result.data.status);
        span.setAttribute(
          "download.processing_time_ms",
          result.data.processingTimeMs,
        );
        span.setStatus({ code: 1 as SpanStatusCode });
        span.end();
        resolve(result);
      } catch (error) {
        span.setStatus({
          code: 2 as SpanStatusCode,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        span.recordException(error as Error);
        span.end();
        reject(error);
      }
    });
  });
}

// New Async Download API
export async function createAsyncDownload(
  fileId: number,
  idempotencyKey?: string,
): Promise<{ data: AsyncDownloadResponse; traceId: string | null }> {
  const tracer = getTracer();

  return new Promise((resolve, reject) => {
    tracer.startActiveSpan("download.create_async", async (span) => {
      try {
        span.setAttribute("download.file_id", fileId);

        const headers: Record<string, string> = {};
        if (idempotencyKey) {
          headers["x-idempotency-key"] = idempotencyKey;
        }

        const result = await apiFetch<AsyncDownloadResponse>("/v1/download", {
          method: "POST",
          data: { file_id: fileId },
          headers,
        });

        span.setAttribute("download.job_id", result.data.jobId);
        span.setAttribute("download.is_new", result.data.isNew);
        span.setStatus({ code: 1 as SpanStatusCode });
        span.end();
        resolve(result);
      } catch (error) {
        span.setStatus({
          code: 2 as SpanStatusCode,
          message: error instanceof Error ? error.message : "Unknown error",
        });
        span.recordException(error as Error);
        span.end();
        reject(error);
      }
    });
  });
}

export async function getJobStatus(
  jobId: string,
): Promise<{ data: JobStatusResponse; traceId: string | null }> {
  return apiFetch<JobStatusResponse>(`/v1/download/status/${jobId}`);
}

// SSE subscription for real-time job updates
export function subscribeToJobUpdates(
  jobId: string,
  callbacks: {
    onStatus?: (data: SSEUpdate) => void;
    onProgress?: (data: SSEUpdate) => void;
    onComplete?: (data: SSEUpdate) => void;
    onError?: (data: SSEUpdate) => void;
    onHeartbeat?: () => void;
    onConnectionError?: (error: Error) => void;
  },
): () => void {
  const url = `${API_URL}/v1/download/subscribe/${jobId}`;
  const eventSource = new EventSource(url);

  eventSource.addEventListener("status", (event) => {
    try {
      const data = JSON.parse(event.data) as SSEUpdate;
      callbacks.onStatus?.(data);
    } catch (e) {
      console.error("[SSE] Failed to parse status event:", e);
    }
  });

  eventSource.addEventListener("progress", (event) => {
    try {
      const data = JSON.parse(event.data) as SSEUpdate;
      callbacks.onProgress?.(data);
    } catch (e) {
      console.error("[SSE] Failed to parse progress event:", e);
    }
  });

  eventSource.addEventListener("complete", (event) => {
    try {
      const data = JSON.parse(event.data) as SSEUpdate;
      callbacks.onComplete?.(data);
      eventSource.close();
    } catch (e) {
      console.error("[SSE] Failed to parse complete event:", e);
    }
  });

  eventSource.addEventListener("error", (event) => {
    if (eventSource.readyState === EventSource.CLOSED) {
      return;
    }

    // Check if it's an SSE event with error data
    if (event instanceof MessageEvent && event.data) {
      try {
        const data = JSON.parse(event.data) as SSEUpdate;
        callbacks.onError?.(data);
        eventSource.close();
        return;
      } catch {
        // Not a JSON error, handle as connection error
      }
    }

    callbacks.onConnectionError?.(new Error("SSE connection error"));
  });

  eventSource.addEventListener("heartbeat", () => {
    callbacks.onHeartbeat?.();
  });

  eventSource.onerror = () => {
    if (eventSource.readyState === EventSource.CLOSED) {
      return;
    }
    callbacks.onConnectionError?.(new Error("SSE connection failed"));
  };

  // Return cleanup function
  return () => {
    eventSource.close();
  };
}

// Export API URL for components
export { API_URL };
