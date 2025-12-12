import type { Toucan } from "@hono/sentry";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    sentry: Toucan;
  }
}
