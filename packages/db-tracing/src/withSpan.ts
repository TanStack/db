import { globalTracerRegistry } from "./registry.js"
import { context, trace } from "@opentelemetry/api"

/**
 * Wraps a callback function to preserve the current OpenTelemetry context
 * This is useful for async callbacks that need to maintain tracing context
 */
export function withCurrentContext<TArgs extends any[], TReturn>(
  callback: (...args: TArgs) => TReturn
): (...args: TArgs) => TReturn {
  const currentContext = context.active()
  return (...args: TArgs) => {
    return context.with(currentContext, () => callback(...args))
  }
}

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
      // Create a new context with this span as the active span
      const newContext = trace.setSpan(context.active(), otelSpan.span)
      return context.with(newContext, fn)
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
      // Create a new context with this span as the active span
      const newContext = trace.setSpan(context.active(), otelSpan.span)
      return await context.with(newContext, fn)
    }
    return await fn()
  } finally {
    spans.forEach((span) => span.end())
  }
}
