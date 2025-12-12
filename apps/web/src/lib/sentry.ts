import * as Sentry from "@sentry/react";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export function initSentry() {
  if (!SENTRY_DSN) {
    console.warn("[Sentry] No DSN configured. Sentry will not capture errors.");
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,

    // Performance Monitoring
    tracesSampleRate: 1.0, // Capture 100% of transactions in development

    // Session Replay - capture 10% of sessions, 100% on error
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    // Enable profiling for performance
    profilesSampleRate: 1.0,

    // Integration configuration
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],

    // Filter out noise
    ignoreErrors: [
      // Browser extensions
      /^chrome-extension:\/\//,
      /^moz-extension:\/\//,
      // Network errors that are expected
      "Network request failed",
      "Failed to fetch",
    ],

    // Add trace context from OpenTelemetry
    beforeSend(event, hint) {
      // Get trace ID from the current span if available
      const traceId = getCurrentTraceId();
      if (traceId) {
        event.tags = {
          ...event.tags,
          trace_id: traceId,
        };
      }

      // Log errors to console in development
      if (import.meta.env.DEV) {
        console.error("[Sentry] Captured error:", hint.originalException);
      }

      return event;
    },
  });

  console.log("[Sentry] Initialized successfully");
}

// Store for current trace ID (set by OpenTelemetry integration)
let _currentTraceId: string | null = null;

export function setCurrentTraceId(traceId: string | null) {
  _currentTraceId = traceId;
}

export function getCurrentTraceId(): string | null {
  return _currentTraceId;
}

// Custom error logging for business logic errors
export function logError(error: Error, context?: Record<string, unknown>) {
  Sentry.captureException(error, {
    tags: {
      type: "business_logic",
      trace_id: getCurrentTraceId() ?? undefined,
    },
    extra: context,
  });
}

// Log a message with context
export function logMessage(
  message: string,
  level: Sentry.SeverityLevel = "info",
  context?: Record<string, unknown>,
) {
  Sentry.captureMessage(message, {
    level,
    tags: {
      trace_id: getCurrentTraceId() ?? undefined,
    },
    extra: context,
  });
}

// Set user context for better error tracking
export function setUser(
  user: { id: string; email?: string; username?: string } | null,
) {
  Sentry.setUser(user);
}

// Show user feedback dialog
export function showFeedbackDialog(options?: {
  title?: string;
  subtitle?: string;
  submitButtonLabel?: string;
}) {
  const eventId = Sentry.lastEventId();
  if (eventId) {
    Sentry.showReportDialog({
      eventId,
      title: options?.title ?? "It looks like we're having issues.",
      subtitle:
        options?.subtitle ??
        "Our team has been notified. If you'd like to help, tell us what happened below.",
      submitButtonLabel: options?.submitButtonLabel ?? "Submit Feedback",
    });
  }
}

// Add breadcrumb for tracking user actions
export function addBreadcrumb(
  message: string,
  category: string,
  data?: Record<string, unknown>,
) {
  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: "info",
  });
}

// Export Sentry for direct access if needed
export { Sentry };
