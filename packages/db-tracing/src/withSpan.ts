import { globalTracerRegistry } from './registry.js'

export function withSpan<T>(
  name: string, 
  fn: () => T, 
  attributes?: Record<string, any>
): T {
  const spans = globalTracerRegistry.startSpan(name, attributes)
  try {
    const result = fn()
    return result
  } finally {
    spans.forEach(span => span.end())
  }
}

export async function withSpanAsync<T>(
  name: string, 
  fn: () => Promise<T>, 
  attributes?: Record<string, any>
): Promise<T> {
  const spans = globalTracerRegistry.startSpan(name, attributes)
  try {
    const result = await fn()
    return result
  } finally {
    spans.forEach(span => span.end())
  }
}