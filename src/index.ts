/**
 * Main API Server
 *
 * Handles HTTP requests for the download service.
 * Run: npm run start
 */

import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { sentry } from "@hono/sentry";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { rateLimiter } from "hono-rate-limiter";

// Type augmentation for Hono context
import "./types/hono.d.ts";

import { env } from "./config/env.ts";
import { closeQueue } from "./lib/queue.ts";
import { closeRedis } from "./lib/redis.ts";
import { closeS3 } from "./lib/s3.ts";
import { startTelemetry, shutdownTelemetry } from "./lib/telemetry.ts";
import { downloadRouter } from "./routes/download.routes.ts";
import { healthRouter } from "./routes/health.routes.ts";

// Start OpenTelemetry
startTelemetry();

// Create main Hono app
const app = new OpenAPIHono();

// ============ Middleware ============

// Request ID middleware - adds unique ID to each request
app.use(async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  await next();
});

// Security headers middleware (helmet-like)
app.use(secureHeaders());

// CORS middleware
app.use(
  cors({
    origin: env.CORS_ORIGINS,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-ID",
      "X-Idempotency-Key",
      "X-User-ID",
    ],
    exposeHeaders: [
      "X-Request-ID",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
    ],
    maxAge: 86400,
  }),
);

// Request timeout middleware (skip for SSE endpoints)
app.use(async (c, next) => {
  // Skip timeout for SSE endpoints
  if (c.req.path.includes("/subscribe/")) {
    await next();
    return;
  }
  return timeout(env.REQUEST_TIMEOUT_MS)(c, next);
});

// Rate limiting middleware (skip for SSE endpoints)
app.use(async (c, next) => {
  // Skip rate limiting for SSE endpoints
  if (c.req.path.includes("/subscribe/")) {
    await next();
    return;
  }
  return rateLimiter({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: "draft-6",
    keyGenerator: (ctx) =>
      ctx.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      ctx.req.header("x-real-ip") ??
      "anonymous",
  })(c, next);
});

// OpenTelemetry middleware
app.use(
  httpInstrumentationMiddleware({
    serviceName: "delineate-hackathon-challenge",
  }),
);

// Sentry middleware
app.use(
  sentry({
    dsn: env.SENTRY_DSN,
  }),
);

// ============ Error Handler ============

app.onError((err, c) => {
  c.get("sentry").captureException(err);
  const requestId = c.get("requestId") as string | undefined;

  console.error(`[Error] ${err.message}`, {
    requestId,
    path: c.req.path,
    method: c.req.method,
  });

  return c.json(
    {
      error: "Internal Server Error",
      message:
        env.NODE_ENV === "development"
          ? err.message
          : "An unexpected error occurred",
      requestId,
    },
    500,
  );
});

// ============ Routes ============

// Mount health routes
app.route("/", healthRouter);

// Mount download routes
app.route("/", downloadRouter);

// ============ OpenAPI Documentation ============

if (env.NODE_ENV !== "production") {
  app.doc("/openapi", {
    openapi: "3.0.0",
    info: {
      title: "Delineate Hackathon Challenge API",
      version: "2.0.0",
      description: `
# Long-Running Download API

This API implements an async job-based architecture for handling long-running downloads.

## Key Features

- **Non-blocking API**: Immediate 202 response with job ID
- **Real-time updates**: SSE streaming for progress
- **Polling fallback**: GET /status/:jobId for environments that don't support SSE
- **Idempotency**: X-Idempotency-Key header prevents duplicate jobs
- **Rate limiting**: Per-user concurrent download limits

## Recommended Flow

1. **Create job**: POST /v1/download
2. **Subscribe to updates**: GET /v1/download/subscribe/:jobId (SSE)
3. **Or poll status**: GET /v1/download/status/:jobId
4. **Download file**: Use returned presigned URL

## Legacy Endpoints

The following endpoints are kept for backward compatibility:
- POST /v1/download/initiate
- POST /v1/download/check
- POST /v1/download/start (blocking - not recommended)
      `,
    },
    servers: [
      {
        url: `http://localhost:${env.PORT.toString()}`,
        description: "Local server",
      },
    ],
  });

  // Scalar API docs
  app.get("/docs", Scalar({ url: "/openapi" }));
}

// ============ Graceful Shutdown ============

const gracefulShutdown = (server: ServerType) => (signal: string) => {
  console.log(`\n[Server] ${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(() => {
    console.log("[Server] HTTP server closed");

    // Shutdown components in parallel
    Promise.all([shutdownTelemetry(), closeRedis(), closeQueue()])
      .then(() => {
        // Close S3 client
        closeS3();
        console.log("[Server] Graceful shutdown completed");
      })
      .catch((error: unknown) => {
        console.error("[Server] Error during shutdown:", error);
      });
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error("[Server] Forced shutdown after timeout");
  }, 30000);
};

// ============ Start Server ============

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`[Server] Running on http://localhost:${info.port.toString()}`);
    console.log(`[Server] Environment: ${env.NODE_ENV}`);
    console.log(
      `[Server] Redis: ${env.REDIS_HOST}:${env.REDIS_PORT.toString()}`,
    );
    if (env.NODE_ENV !== "production") {
      console.log(
        `[Server] API docs: http://localhost:${info.port.toString()}/docs`,
      );
    }
  },
);

// Register shutdown handlers
const shutdown = gracefulShutdown(server);
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
