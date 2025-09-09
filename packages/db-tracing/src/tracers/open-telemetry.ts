import type { Tracer, Span } from '../types.js'

export class OpenTelemetryTracer implements Tracer {
  constructor(private otelTracer: any) {} // Use any for now to avoid OTEL dependency
  
  startSpan(name: string, attributes?: Record<string, any>): Span {
    const span = this.otelTracer.startSpan(name, attributes)
    return {
      name,
      end: () => span.end(),
      setAttributes: (attrs) => span.setAttributes(attrs)
    }
  }
}