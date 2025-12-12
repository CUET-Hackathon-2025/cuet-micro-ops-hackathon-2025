/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
/**
 * Redis Client Configuration
 *
 * Note: ESLint rules are disabled for this file due to ioredis type definitions
 * not being fully compatible with strict TypeScript settings.
 */
import type { RedisOptions } from "ioredis";
import Redis from "ioredis";
import { env } from "../config/env.ts";

// Redis connection configuration
const redisConfig: RedisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD ?? undefined,
  db: env.REDIS_DB,
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
  retryStrategy: (times: number) => {
    if (times > 10) {
      console.error("[Redis] Max retry attempts reached");
      return null;
    }
    const delay = Math.min(times * 100, 3000);
    console.log(`[Redis] Retrying connection in ${delay.toString()}ms...`);
    return delay;
  },
};

// Create Redis client for general use
export const redis: Redis = new Redis(redisConfig);

// Create separate Redis connection for BullMQ (required)
export const createBullMQConnection = (): Redis => new Redis(redisConfig);

// Redis health check
export const checkRedisHealth = async (): Promise<boolean> => {
  try {
    const result = await redis.ping();
    return result === "PONG";
  } catch (error) {
    console.error("[Redis] Health check failed:", error);
    return false;
  }
};

// Redis key prefixes
export const RedisKeys = {
  job: (jobId: string) => `job:${jobId}`,
  idempotency: (key: string) => `idempotency:${key}`,
  userActiveJobs: (userId: string) => `user:${userId}:active`,
  jobsProcessing: "jobs:processing",
  jobUpdates: (jobId: string) => `job:updates:${jobId}`,
} as const;

// Graceful shutdown
export const closeRedis = async (): Promise<void> => {
  await redis.quit();
  console.log("[Redis] Connection closed");
};

// Event listeners
redis.on("connect", () => {
  console.log("[Redis] Connected successfully");
});

redis.on("error", (err: Error) => {
  console.error("[Redis] Connection error:", err.message);
});

redis.on("close", () => {
  console.log("[Redis] Connection closed");
});
