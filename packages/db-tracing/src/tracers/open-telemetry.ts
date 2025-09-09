import type { Span, Tracer } from "../types.js"
import type { Span as OtelSpan, Tracer as OtelTracer } from "@opentelemetry/api"

export class OpenTelemetryTracer implements Tracer {
  constructor(private otelTracer: OtelTracer) {}

  startSpan(name: string, attributes?: Record<string, any>): Span {
    const span: OtelSpan = this.otelTracer.startSpan(name, { attributes })
    return {
      name,
      end: () => span.end(),
      setAttributes: (attrs) => span.setAttributes(attrs),
    }
  }
}
