import { globalTracerRegistry } from "./registry.js"
import { context, trace } from "@opentelemetry/api"

export function withSpan<T>(
  name: string,
  fn: () => T,
  attributes?: Record<string, any>
): T {
  const spans = globalTracerRegistry.startSpan(name, attributes)
  if (spans.length === 0) {
    // No tracing enabled, just run the function
    return fn()
  }

  try {
    // Activate the span context for OpenTelemetry tracers
    const otelSpan = spans.find(span => span.span) as any
    if (otelSpan?.span) {
      return context.with(trace.setSpan(context.active(), otelSpan.span), fn)
    }
    return fn()
  } finally {
    spans.forEach((span) => span.end())
  }
}

export async function withSpanAsync<T>(
  name: string,
  fn: () => Promise<T>,
  attributes?: Record<string, any>
): Promise<T> {
  const spans = globalTracerRegistry.startSpan(name, attributes)
  if (spans.length === 0) {
    // No tracing enabled, just run the function
    return await fn()
  }

  try {
    // Activate the span context for OpenTelemetry tracers
    const otelSpan = spans.find(span => span.span) as any
    if (otelSpan?.span) {
      return await context.with(trace.setSpan(context.active(), otelSpan.span), fn)
    }
    return await fn()
  } finally {
    spans.forEach((span) => span.end())
  }
}
