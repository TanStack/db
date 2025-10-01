import { OfflineRetrySpanProcessor } from './otel-offline-processor'

export interface InitWebTracingOptions {
  endpoint: string
  headers?: Record<string, string>
  serviceName?: string
  sampleRatio?: number
  onlineDetector?: {
    subscribe: (callback: () => void) => () => void
  }
}

let offlineProcessor: OfflineRetrySpanProcessor | null = null

export async function initWebTracing(
  options: InitWebTracingOptions
): Promise<void> {
  const {
    endpoint,
    headers = {},
    serviceName = `@tanstack/offline-transactions-example`,
    sampleRatio = 1.0,
    onlineDetector,
  } = options

  // Dynamic imports to keep bundle size minimal
  const { WebTracerProvider } = await import(`@opentelemetry/sdk-trace-web`)
  const { OTLPTraceExporter } = await import(
    `@opentelemetry/exporter-trace-otlp-http`
  )
  const { BatchSpanProcessor } = await import(`@opentelemetry/sdk-trace-web`)
  const { Resource } = await import(`@opentelemetry/resources`)
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import(
    `@opentelemetry/semantic-conventions`
  )
  const { registerInstrumentations } = await import(
    `@opentelemetry/instrumentation`
  )
  const { TraceIdRatioBasedSampler } = await import(
    `@opentelemetry/sdk-trace-web`
  )

  // Create resource with service identification
  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: `0.0.1`,
  })

  // Configure OTLP exporter
  const exporter = new OTLPTraceExporter({
    url: endpoint,
    headers,
  })

  // Create tracer provider with sampling
  const provider = new WebTracerProvider({
    resource,
    sampler: new TraceIdRatioBasedSampler(sampleRatio),
  })

  // Add batch span processor for efficient export
  provider.addSpanProcessor(new BatchSpanProcessor(exporter))

  // Add offline retry processor for storing failed spans
  offlineProcessor = new OfflineRetrySpanProcessor(exporter)
  provider.addSpanProcessor(offlineProcessor as any)

  // Start periodic retry attempts
  offlineProcessor.startPeriodicRetry(30000)

  // If online detector provided, retry on connectivity change
  if (onlineDetector) {
    onlineDetector.subscribe(async () => {
      console.log('Connectivity changed, retrying stored spans')
      if (offlineProcessor) {
        const count = await offlineProcessor.retryStoredSpans()
        if (count > 0) {
          console.log(`Successfully sent ${count} stored spans`)
        }
      }
    })
  }

  // Register the provider globally
  provider.register()

  // Auto-instrument fetch calls
  registerInstrumentations({
    instrumentations: [],
  })

  const pendingCount = await offlineProcessor.getPendingCount()
  console.log(
    `OpenTelemetry initialized: ${endpoint} (${pendingCount} spans pending retry)`
  )
}

export function getOfflineProcessor(): OfflineRetrySpanProcessor | null {
  return offlineProcessor
}
