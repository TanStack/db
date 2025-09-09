import type { Tracer, Span } from '../types.js'

export class PerformanceMarkTracer implements Tracer {
  startSpan(name: string, attributes?: Record<string, any>): Span {
    const startMark = `${name}-start`
    const endMark = `${name}-end`
    performance.mark(startMark)
    
    return {
      name,
      end: () => {
        performance.mark(endMark)
        performance.measure(name, startMark, endMark)
      },
      setAttributes: () => {} // No-op for performance marks
    }
  }
}