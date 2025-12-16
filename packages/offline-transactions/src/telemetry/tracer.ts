export interface SpanAttrs {
  [key: string]: string | number | boolean | undefined
}

interface WithSpanOptions {
  parentContext?: any
}

// No-op span implementation
const noopSpan = {
  setAttribute: () => {},
  setAttributes: () => {},
  setStatus: () => {},
  recordException: () => {},
  end: () => {},
}

/**
 * Lightweight span wrapper with error handling.
 * No-op implementation - telemetry has been removed.
 *
 * By default, creates spans at the current context level (siblings).
 * Use withNestedSpan if you want parent-child relationships.
 */
export async function withSpan<T>(
  name: string,
  attrs: SpanAttrs,
  fn: (span: any) => Promise<T>,
  _options?: WithSpanOptions,
): Promise<T> {
  return await fn(noopSpan)
}

/**
 * Like withSpan but propagates context so child spans nest properly.
 * No-op implementation - telemetry has been removed.
 */
export async function withNestedSpan<T>(
  name: string,
  attrs: SpanAttrs,
  fn: (span: any) => Promise<T>,
  _options?: WithSpanOptions,
): Promise<T> {
  return await fn(noopSpan)
}

/**
 * Creates a synchronous span for non-async operations
 * No-op implementation - telemetry has been removed.
 */
export function withSyncSpan<T>(
  name: string,
  attrs: SpanAttrs,
  fn: (span: any) => T,
  _options?: WithSpanOptions,
): T {
  return fn(noopSpan)
}

/**
 * Get the current tracer instance
 * No-op implementation - telemetry has been removed.
 */
export function getTracer() {
  return null
}
