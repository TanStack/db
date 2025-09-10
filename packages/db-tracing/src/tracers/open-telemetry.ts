import type { Span, Tracer } from "../types.js"
import type { Span as OtelSpan, Tracer as OtelTracer } from "@opentelemetry/api"
import { context, trace } from "@opentelemetry/api"

export class OpenTelemetryTracer implements Tracer {
  constructor(private otelTracer: OtelTracer) {}

  startSpan(name: string, attributes?: Record<string, any>): Span {
    const activeContext = context.active()
    const activeSpan = trace.getSpan(activeContext)
    
    let span: OtelSpan
    
    if (activeSpan) {
      // There's an active span, create a child span
      span = this.otelTracer.startSpan(name, { attributes }, activeContext)
    } else {
      // No active span, create a root span with no parent context
      span = this.otelTracer.startSpan(name, { attributes })
    }
    
    return {
      name,
      end: () => span.end(),
      setAttributes: (attrs) => span.setAttributes(attrs),
      // Store the actual OpenTelemetry span for context management
      span,
    }
  }
}
