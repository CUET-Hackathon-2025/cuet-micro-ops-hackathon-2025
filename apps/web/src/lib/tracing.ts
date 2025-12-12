import { context, trace, SpanStatusCode, type Span } from "@opentelemetry/api"
import { WebTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-web"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { ZoneContextManager } from "@opentelemetry/context-zone"
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch"
import { registerInstrumentations } from "@opentelemetry/instrumentation"
import { setCurrentTraceId } from "./sentry"

const SERVICE_NAME = "observability-dashboard"
const OTEL_EXPORTER_URL = import.meta.env.VITE_OTEL_EXPORTER_URL as string | undefined

let provider: WebTracerProvider | null = null
let isInitialized = false

export function initTracing() {
  if (isInitialized) {
    console.warn("[OpenTelemetry] Already initialized")
    return
  }

  // Configure span processors
  const spanProcessors = []

  // Configure OTLP exporter if URL is provided
  if (OTEL_EXPORTER_URL) {
    const exporter = new OTLPTraceExporter({
      url: `${OTEL_EXPORTER_URL}/v1/traces`,
      headers: {},
    })
    spanProcessors.push(new SimpleSpanProcessor(exporter))
    console.log(`[OpenTelemetry] Configured OTLP exporter: ${OTEL_EXPORTER_URL}`)
  } else {
    console.warn("[OpenTelemetry] No exporter URL configured. Traces will not be exported.")
  }

  // Create and configure the tracer provider with span processors
  provider = new WebTracerProvider({
    spanProcessors,
  })

  // Register the provider with zone context manager for async context propagation
  provider.register({
    contextManager: new ZoneContextManager(),
  })

  // Register fetch instrumentation for automatic trace propagation
  registerInstrumentations({
    instrumentations: [
      new FetchInstrumentation({
        // Propagate trace context to backend
        propagateTraceHeaderCorsUrls: [
          /localhost/,
          /127\.0\.0\.1/,
          new RegExp(import.meta.env.VITE_API_URL?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') ?? ""),
        ],
        // Clear timing info to avoid CORS issues
        clearTimingResources: true,
        // Add custom attributes to fetch spans
        applyCustomAttributesOnSpan: (span, request, response) => {
          if (request instanceof Request) {
            span.setAttribute("http.request.url", request.url)
          }
          if (response && response.status !== undefined) {
            span.setAttribute("http.response.status_code", response.status)
          }
        },
      }),
    ],
  })

  isInitialized = true
  console.log("[OpenTelemetry] Initialized successfully")
}

// Get the tracer instance
export function getTracer() {
  return trace.getTracer(SERVICE_NAME, "1.0.0")
}

// Create a span for user interactions
export function startSpan(name: string, fn: (span: Span) => void | Promise<void>): void | Promise<void> {
  const tracer = getTracer()
  return tracer.startActiveSpan(name, async (span) => {
    try {
      // Set trace ID in Sentry for correlation
      const traceId = span.spanContext().traceId
      setCurrentTraceId(traceId)
      
      await fn(span)
      span.setStatus({ code: SpanStatusCode.OK })
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : "Unknown error",
      })
      span.recordException(error as Error)
      throw error
    } finally {
      span.end()
      setCurrentTraceId(null)
    }
  })
}

// Extract current trace ID for display in UI
export function getCurrentTraceId(): string | null {
  const currentSpan = trace.getActiveSpan()
  if (currentSpan) {
    return currentSpan.spanContext().traceId
  }
  return null
}

// Create a W3C traceparent header value
export function createTraceparent(): string | null {
  const currentSpan = trace.getActiveSpan()
  if (!currentSpan) {
    return null
  }
  
  const spanContext = currentSpan.spanContext()
  const version = "00"
  const traceId = spanContext.traceId
  const spanId = spanContext.spanId
  const flags = spanContext.traceFlags.toString(16).padStart(2, "0")
  
  return `${version}-${traceId}-${spanId}-${flags}`
}

// Get current context for manual propagation
export function getCurrentContext() {
  return context.active()
}

// Add custom attributes to the current span
export function addSpanAttributes(attributes: Record<string, string | number | boolean>) {
  const currentSpan = trace.getActiveSpan()
  if (currentSpan) {
    Object.entries(attributes).forEach(([key, value]) => {
      currentSpan.setAttribute(key, value)
    })
  }
}

// Record an event in the current span
export function recordSpanEvent(name: string, attributes?: Record<string, string | number | boolean>) {
  const currentSpan = trace.getActiveSpan()
  if (currentSpan) {
    currentSpan.addEvent(name, attributes)
  }
}

// Shutdown tracing (call on app unmount)
export function shutdownTracing() {
  if (provider) {
    provider.shutdown().then(() => {
      console.log("[OpenTelemetry] Shutdown complete")
    })
  }
}
