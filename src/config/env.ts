import { z } from "zod";

// Helper for optional URL that treats empty string as undefined
const optionalUrl = z
  .string()
  .optional()
  .transform((val) => (val === "" ? undefined : val))
  .pipe(z.url().optional());

// Environment schema
export const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  // S3/MinIO Configuration
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: optionalUrl,
  S3_BUCKET_NAME: z.string().default(""),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),

  // Redis Configuration
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),

  // Observability
  SENTRY_DSN: optionalUrl,
  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,

  // Request Configuration
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(100),
  CORS_ORIGINS: z
    .string()
    .default("*")
    .transform((val) => (val === "*" ? "*" : val.split(","))),

  // Download Configuration
  DOWNLOAD_DELAY_MIN_MS: z.coerce.number().int().min(0).default(10000),
  DOWNLOAD_DELAY_MAX_MS: z.coerce.number().int().min(0).default(200000),
  DOWNLOAD_DELAY_ENABLED: z.coerce.boolean().default(true),

  // Job Configuration
  JOB_TTL_SECONDS: z.coerce.number().int().min(60).default(86400), // 24 hours
  JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
  JOB_BACKOFF_DELAY_MS: z.coerce.number().int().min(100).default(1000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).default(5),
  MAX_CONCURRENT_DOWNLOADS_PER_USER: z.coerce.number().int().min(1).default(3),
  PRESIGNED_URL_EXPIRY_SECONDS: z.coerce.number().int().min(60).default(3600),
});

// Parse and validate environment
export const env = EnvSchema.parse(process.env);

// Type export for use in other modules
export type Env = z.infer<typeof EnvSchema>;

