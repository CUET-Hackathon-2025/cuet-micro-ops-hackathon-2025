import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { checkQueueHealth, getQueueStats } from "../lib/queue.ts";
import { checkRedisHealth } from "../lib/redis.ts";
import { checkS3Health } from "../lib/s3.ts";
import { HealthResponseSchema } from "../schemas/index.ts";

const healthRouter = new OpenAPIHono();

// Message response schema
const MessageResponseSchema = z
  .object({
    message: z.string(),
  })
  .openapi("MessageResponse");

// Root route
const rootRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["General"],
  summary: "Root endpoint",
  description: "Returns a welcome message",
  responses: {
    200: {
      description: "Successful response",
      content: {
        "application/json": {
          schema: MessageResponseSchema,
        },
      },
    },
  },
});

// Health check route
const healthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Health"],
  summary: "Health check endpoint",
  description:
    "Returns the health status of the service and its dependencies (storage, redis, queue)",
  responses: {
    200: {
      description: "Service is healthy",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
    503: {
      description: "Service is unhealthy",
      content: {
        "application/json": {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

// Queue stats route (for debugging/monitoring)
const queueStatsRoute = createRoute({
  method: "get",
  path: "/health/queue",
  tags: ["Health"],
  summary: "Queue statistics",
  description: "Returns current queue statistics",
  responses: {
    200: {
      description: "Queue statistics",
      content: {
        "application/json": {
          schema: z.object({
            waiting: z.number().int(),
            active: z.number().int(),
            completed: z.number().int(),
            failed: z.number().int(),
            delayed: z.number().int(),
          }),
        },
      },
    },
  },
});

// Route handlers
healthRouter.openapi(rootRoute, (c) => {
  return c.json({ message: "Hello Hono!" }, 200);
});

healthRouter.openapi(healthRoute, async (c) => {
  // Run health checks in parallel
  const [storageHealthy, redisHealthy, queueHealthy] = await Promise.all([
    checkS3Health(),
    checkRedisHealth(),
    checkQueueHealth(),
  ]);

  const allHealthy = storageHealthy && redisHealthy && queueHealthy;
  const status = allHealthy ? "healthy" : "unhealthy";
  const httpStatus = allHealthy ? 200 : 503;

  return c.json(
    {
      status,
      checks: {
        storage: storageHealthy ? "ok" : "error",
        redis: redisHealthy ? "ok" : "error",
        queue: queueHealthy ? "ok" : "error",
      },
    },
    httpStatus,
  );
});

healthRouter.openapi(queueStatsRoute, async (c) => {
  const stats = await getQueueStats();
  return c.json(stats, 200);
});

export { healthRouter };
