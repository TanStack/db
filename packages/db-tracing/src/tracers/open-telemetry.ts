import type { Span, Tracer } from "../types.js"
import type { Span as OtelSpan, Tracer as OtelTracer } from "@opentelemetry/api"
import { context } from "@opentelemetry/api"

export class OpenTelemetryTracer implements Tracer {
  constructor(private otelTracer: OtelTracer) {}

  startSpan(name: string, attributes?: Record<string, any>): Span {
    // Use the current active context to ensure proper parent-child relationships
    const span: OtelSpan = this.otelTracer.startSpan(name, { attributes }, context.active())
    return {
      name,
      end: () => span.end(),
      setAttributes: (attrs) => span.setAttributes(attrs),
      // Store the actual OpenTelemetry span for context management
      span,
    }
  }
}
