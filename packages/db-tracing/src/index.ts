export { globalTracerRegistry } from './registry.js'
export { withSpan, withSpanAsync } from './withSpan.js'
export { PerformanceMarkTracer } from './tracers/performance-mark.js'
export { OpenTelemetryTracer } from './tracers/open-telemetry.js'
export type { Tracer, Span, TracingConfig } from './types.js'

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