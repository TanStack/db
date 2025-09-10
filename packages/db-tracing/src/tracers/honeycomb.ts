import * as opentelemetry from "@opentelemetry/sdk-node"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { trace } from "@opentelemetry/api"
import { OpenTelemetryTracer } from "./open-telemetry.js"
import type { Tracer } from "../types.js"

export interface HoneycombConfig {
  apiKey: string
  dataset?: string
  serviceName?: string
}

/**
 * Creates a Honeycomb OpenTelemetry tracer setup
 * @param config - Honeycomb configuration
 * @returns Promise that resolves when tracing is initialized
 */
export async function createHoneycombTracer(config: HoneycombConfig): Promise<Tracer> {
  const {
    serviceName = "tanstack-db-benchmarks",
  } = config


  // Create OTLP exporter for Honeycomb using standard environment variables
  // Following Honeycomb's official guide - let environment variables handle everything
  const traceExporter = new OTLPTraceExporter()


  // Create the Node SDK
  const sdk = new opentelemetry.NodeSDK({
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // we recommend disabling fs autoinstrumentation since it can be noisy
        // and expensive during startup
        "@opentelemetry/instrumentation-fs": {
          enabled: false,
        },
      }),
    ],
    serviceName,
  })

  // Initialize the SDK
  sdk.start()

  // Get the tracer
  const otelTracer = trace.getTracer("tanstack-db", "1.0.0")

  // Add a small delay to ensure SDK is fully initialized
  await new Promise(resolve => setTimeout(resolve, 100))

  // Return our wrapper tracer
  return new OpenTelemetryTracer(otelTracer)
}

/**
 * Convenience function to setup Honeycomb tracing from environment variables
 * Following Honeycomb's official guide - environment variables handle everything
 * @returns Promise that resolves when tracing is initialized
 */
export async function setupHoneycombFromEnv(): Promise<Tracer> {
  // Verify required environment variables are set
  if (!process.env.OTEL_SERVICE_NAME) {
    throw new Error("OTEL_SERVICE_NAME environment variable is required")
  }
  
  if (!process.env.OTEL_EXPORTER_OTLP_HEADERS || !process.env.OTEL_EXPORTER_OTLP_HEADERS.includes("x-honeycomb-team=")) {
    throw new Error("OTEL_EXPORTER_OTLP_HEADERS with x-honeycomb-team is required")
  }

  return createHoneycombTracer({
    apiKey: "dummy", // Not used since we rely on environment variables
    serviceName: process.env.OTEL_SERVICE_NAME,
  })
}
