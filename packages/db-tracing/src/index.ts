import { globalTracerRegistry } from "./registry.js"
import type { Tracer } from "./types.js"

export { globalTracerRegistry } from "./registry.js"
export { withSpan, withSpanAsync, withCurrentContext } from "./withSpan.js"
export { PerformanceMarkTracer } from "./tracers/performance-mark.js"
export { OpenTelemetryTracer } from "./tracers/open-telemetry.js"
export { createHoneycombTracer, setupHoneycombFromEnv } from "./tracers/honeycomb.js"
export type { Tracer, Span, TracingConfig } from "./types.js"

// Convenience functions
export function setTracingEnabled(enabled: boolean) {
  globalTracerRegistry.setEnabled(enabled)
}

export function addTracer(tracer: Tracer) {
  globalTracerRegistry.addTracer(tracer)
}

export function removeTracer(tracer: Tracer) {
  globalTracerRegistry.removeTracer(tracer)
}
