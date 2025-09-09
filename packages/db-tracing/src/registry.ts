import type { Tracer, Span, TracingConfig } from './types.js'

class GlobalTracerRegistry {
  private config: TracingConfig = { enabled: false, tracers: [] }
  
  setConfig(config: TracingConfig) {
    this.config = config
  }
  
  setEnabled(enabled: boolean) {
    this.config.enabled = enabled
  }
  
  addTracer(tracer: Tracer) {
    this.config.tracers.push(tracer)
  }
  
  removeTracer(tracer: Tracer) {
    const index = this.config.tracers.indexOf(tracer)
    if (index > -1) {
      this.config.tracers.splice(index, 1)
    }
  }
  
  startSpan(name: string, attributes?: Record<string, any>): Span[] {
    if (!this.config.enabled) return []
    
    return this.config.tracers.map(tracer => tracer.startSpan(name, attributes))
  }
}

export const globalTracerRegistry = new GlobalTracerRegistry()