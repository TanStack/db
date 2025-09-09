import type { Span, Tracer } from "../types.js"

export class PerformanceMarkTracer implements Tracer {
  startSpan(name: string, _attributes?: Record<string, any>): Span {
    const startMark = `${name}-start`
    const endMark = `${name}-end`
    performance.mark(startMark)

    return {
      name,
      end: () => {
        performance.mark(endMark)
        performance.measure(name, startMark, endMark)
      },
      setAttributes: () => {}, // No-op for performance marks
    }
  }
}
