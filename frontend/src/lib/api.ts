import { getTracer, createTraceparent } from "./tracing"
import { logError, addBreadcrumb } from "./sentry"
import type { SpanStatusCode } from "@opentelemetry/api"

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000"

// API Response Types
export interface HealthResponse {
  status: "healthy" | "unhealthy"
  checks: {
    storage: "ok" | "error"
  }
}

export interface DownloadInitiateRequest {
  file_ids: number[]
}

export interface DownloadInitiateResponse {
  jobId: string
  status: "queued" | "processing"
  totalFileIds: number
}

export interface DownloadCheckRequest {
  file_id: number
}

export interface DownloadCheckResponse {
  file_id: number
  available: boolean
  s3Key: string | null
  size: number | null
}

export interface DownloadStartRequest {
  file_id: number
}

export interface DownloadStartResponse {
  file_id: number
  status: "completed" | "failed"
  downloadUrl: string | null
  size: number | null
  processingTimeMs: number
  message: string
}

export interface ApiError {
  error: string
  message: string
  requestId?: string
}

// Track API metrics locally
export interface ApiMetrics {
  endpoint: string
  method: string
  status: number
  duration: number
  timestamp: Date
  traceId: string | null
  success: boolean
}

const metricsStore: ApiMetrics[] = []
const MAX_METRICS = 100

function recordMetric(metric: ApiMetrics) {
  metricsStore.push(metric)
  if (metricsStore.length > MAX_METRICS) {
    metricsStore.shift()
  }
}

export function getMetrics(): ApiMetrics[] {
  return [...metricsStore]
}

export function clearMetrics() {
  metricsStore.length = 0
}

// Error log for dashboard display
export interface ErrorLogEntry {
  id: string
  timestamp: Date
  message: string
  endpoint: string
  traceId: string | null
  status?: number
}

const errorLog: ErrorLogEntry[] = []
const MAX_ERRORS = 50

function recordError(entry: Omit<ErrorLogEntry, "id">) {
  errorLog.unshift({
    ...entry,
    id: crypto.randomUUID(),
  })
  if (errorLog.length > MAX_ERRORS) {
    errorLog.pop()
  }
}

export function getErrorLog(): ErrorLogEntry[] {
  return [...errorLog]
}

export function clearErrorLog() {
  errorLog.length = 0
}

// Generic fetch wrapper with tracing and error handling
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data: T; traceId: string | null }> {
  const url = `${API_URL}${endpoint}`
  const startTime = performance.now()
  let traceId: string | null = null
  
  // Add breadcrumb for Sentry
  addBreadcrumb(`API Request: ${options.method ?? "GET"} ${endpoint}`, "http", {
    url,
    method: options.method ?? "GET",
  })

  // Create traceparent header for W3C Trace Context propagation
  const traceparent = createTraceparent()
  
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...options.headers,
  }
  
  if (traceparent) {
    ;(headers as Record<string, string>)["traceparent"] = traceparent
    // Extract trace ID from traceparent (format: 00-traceId-spanId-flags)
    const parts = traceparent.split("-")
    if (parts.length >= 2) {
      traceId = parts[1]
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    })

    const duration = performance.now() - startTime

    // Record metrics
    recordMetric({
      endpoint,
      method: options.method ?? "GET",
      status: response.status,
      duration,
      timestamp: new Date(),
      traceId,
      success: response.ok,
    })

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({
        error: "Unknown error",
        message: response.statusText,
      }))) as ApiError

      const error = new Error(errorData.message ?? "API request failed")
      ;(error as Error & { status: number }).status = response.status
      ;(error as Error & { apiError: ApiError }).apiError = errorData

      // Record error
      recordError({
        timestamp: new Date(),
        message: errorData.message,
        endpoint,
        traceId,
        status: response.status,
      })

      // Log to Sentry
      logError(error, {
        endpoint,
        status: response.status,
        traceId,
        apiError: errorData,
      })

      throw error
    }

    const data = (await response.json()) as T
    return { data, traceId }
  } catch (error) {
    const duration = performance.now() - startTime

    // Record failed metric
    recordMetric({
      endpoint,
      method: options.method ?? "GET",
      status: 0,
      duration,
      timestamp: new Date(),
      traceId,
      success: false,
    })

    if (!(error instanceof Error && "status" in error)) {
      // Network error or other non-HTTP error
      const networkError = error instanceof Error ? error : new Error("Network error")
      
      recordError({
        timestamp: new Date(),
        message: networkError.message,
        endpoint,
        traceId,
      })

      logError(networkError, {
        endpoint,
        traceId,
        type: "network_error",
      })
    }

    throw error
  }
}

// API Methods
export async function checkHealth(): Promise<{ data: HealthResponse; traceId: string | null }> {
  return apiFetch<HealthResponse>("/health")
}

export async function initiateDownload(
  fileIds: number[]
): Promise<{ data: DownloadInitiateResponse; traceId: string | null }> {
  const tracer = getTracer()
  
  return new Promise((resolve, reject) => {
    tracer.startActiveSpan("download.initiate", async (span) => {
      try {
        span.setAttribute("download.file_count", fileIds.length)
        
        const result = await apiFetch<DownloadInitiateResponse>("/v1/download/initiate", {
          method: "POST",
          body: JSON.stringify({ file_ids: fileIds }),
        })
        
        span.setAttribute("download.job_id", result.data.jobId)
        span.setStatus({ code: 1 as SpanStatusCode }) // OK
        span.end()
        resolve(result)
      } catch (error) {
        span.setStatus({
          code: 2 as SpanStatusCode, // ERROR
          message: error instanceof Error ? error.message : "Unknown error",
        })
        span.recordException(error as Error)
        span.end()
        reject(error)
      }
    })
  })
}

export async function checkDownload(
  fileId: number,
  triggerSentryTest = false
): Promise<{ data: DownloadCheckResponse; traceId: string | null }> {
  const tracer = getTracer()
  
  return new Promise((resolve, reject) => {
    tracer.startActiveSpan("download.check", async (span) => {
      try {
        span.setAttribute("download.file_id", fileId)
        span.setAttribute("download.sentry_test", triggerSentryTest)
        
        const queryParams = triggerSentryTest ? "?sentry_test=true" : ""
        const result = await apiFetch<DownloadCheckResponse>(
          `/v1/download/check${queryParams}`,
          {
            method: "POST",
            body: JSON.stringify({ file_id: fileId }),
          }
        )
        
        span.setAttribute("download.available", result.data.available)
        span.setStatus({ code: 1 as SpanStatusCode })
        span.end()
        resolve(result)
      } catch (error) {
        span.setStatus({
          code: 2 as SpanStatusCode,
          message: error instanceof Error ? error.message : "Unknown error",
        })
        span.recordException(error as Error)
        span.end()
        reject(error)
      }
    })
  })
}

export async function startDownload(
  fileId: number
): Promise<{ data: DownloadStartResponse; traceId: string | null }> {
  const tracer = getTracer()
  
  return new Promise((resolve, reject) => {
    tracer.startActiveSpan("download.start", async (span) => {
      try {
        span.setAttribute("download.file_id", fileId)
        
        const result = await apiFetch<DownloadStartResponse>("/v1/download/start", {
          method: "POST",
          body: JSON.stringify({ file_id: fileId }),
        })
        
        span.setAttribute("download.status", result.data.status)
        span.setAttribute("download.processing_time_ms", result.data.processingTimeMs)
        span.setStatus({ code: 1 as SpanStatusCode })
        span.end()
        resolve(result)
      } catch (error) {
        span.setStatus({
          code: 2 as SpanStatusCode,
          message: error instanceof Error ? error.message : "Unknown error",
        })
        span.recordException(error as Error)
        span.end()
        reject(error)
      }
    })
  })
}

