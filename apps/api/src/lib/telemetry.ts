import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const SERVICE_NAME = "delineate-hackathon-challenge";

// Initialize OpenTelemetry SDK
export const otelSDK = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
  }),
  traceExporter: new OTLPTraceExporter(),
});

export const startTelemetry = () => {
  otelSDK.start();
  console.log("[OpenTelemetry] SDK started");
};

export const shutdownTelemetry = async () => {
  await otelSDK.shutdown();
  console.log("[OpenTelemetry] SDK shut down");
};

