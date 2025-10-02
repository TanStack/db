import { SpanStatusCode, context, trace } from "@opentelemetry/api"
import type { Span, SpanContext } from "@opentelemetry/api"

const TRACER = trace.getTracer(`@tanstack/offline-transactions`, `0.0.1`)

export interface SpanAttrs {
  [key: string]: string | number | boolean | undefined
}

interface WithSpanOptions {
  parentContext?: SpanContext
}

function getParentContext(options?: WithSpanOptions) {
  if (options?.parentContext) {
    const parentSpan = trace.wrapSpanContext(options.parentContext)
    return trace.setSpan(context.active(), parentSpan)
  }

  return context.active()
}

/**
 * Lightweight span wrapper with error handling.
 * Uses OpenTelemetry API which is no-op when tracing is disabled.
 *
 * By default, creates spans at the current context level (siblings).
 * Use withNestedSpan if you want parent-child relationships.
 */
export async function withSpan<T>(
  name: string,
  attrs: SpanAttrs,
  fn: (span: Span) => Promise<T>,
  options?: WithSpanOptions
): Promise<T> {
  const parentCtx = getParentContext(options)
  const span = TRACER.startSpan(name, undefined, parentCtx)

  // Filter out undefined attributes
  const filteredAttrs: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) {
      filteredAttrs[key] = value
    }
  }

  span.setAttributes(filteredAttrs)

  try {
    const result = await fn(span)
    span.setStatus({ code: SpanStatusCode.OK })
    return result
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    })
    span.recordException(error as Error)
    throw error
  } finally {
    span.end()
  }
}

/**
 * Like withSpan but propagates context so child spans nest properly.
 * Use this when you want operations inside fn to be child spans.
 */
export async function withNestedSpan<T>(
  name: string,
  attrs: SpanAttrs,
  fn: (span: Span) => Promise<T>,
  options?: WithSpanOptions
): Promise<T> {
  const parentCtx = getParentContext(options)
  const span = TRACER.startSpan(name, undefined, parentCtx)

  // Filter out undefined attributes
  const filteredAttrs: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) {
      filteredAttrs[key] = value
    }
  }

  span.setAttributes(filteredAttrs)

  // Set the span as active context so child spans nest properly
  const ctx = trace.setSpan(parentCtx, span)

  try {
    // Execute the function within the span's context
    const result = await context.with(ctx, () => fn(span))
    span.setStatus({ code: SpanStatusCode.OK })
    return result
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    })
    span.recordException(error as Error)
    throw error
  } finally {
    span.end()
  }
}

/**
 * Creates a synchronous span for non-async operations
 */
export function withSyncSpan<T>(
  name: string,
  attrs: SpanAttrs,
  fn: (span: Span) => T,
  options?: WithSpanOptions
): T {
  const parentCtx = getParentContext(options)
  const span = TRACER.startSpan(name, undefined, parentCtx)

  // Filter out undefined attributes
  const filteredAttrs: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined) {
      filteredAttrs[key] = value
    }
  }

  span.setAttributes(filteredAttrs)

  try {
    const result = fn(span)
    span.setStatus({ code: SpanStatusCode.OK })
    return result
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    })
    span.recordException(error as Error)
    throw error
  } finally {
    span.end()
  }
}

/**
 * Get the current tracer instance
 */
export function getTracer() {
  return TRACER
}
