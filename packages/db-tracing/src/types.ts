export interface Span {
  name: string
  end: () => void
  setAttributes: (attributes: Record<string, any>) => void
}

export interface Tracer {
  startSpan: (name: string, attributes?: Record<string, any>) => Span
}

export interface TracingConfig {
  enabled: boolean
  tracers: Array<Tracer>
}
