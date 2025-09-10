import { beforeEach, describe, expect, it } from "vitest"
import {
  PerformanceMarkTracer,
  addTracer,
  globalTracerRegistry,
  removeTracer,
  setTracingEnabled,
} from "../src/index.js"

describe(`Global Tracer Registry`, () => {
  beforeEach(() => {
    // Reset registry state
    setTracingEnabled(false)
    // Clear any existing tracers
    const tracers = (globalTracerRegistry as any).config.tracers
    tracers.length = 0
  })

  it(`should start with tracing disabled`, () => {
    const spans = globalTracerRegistry.startSpan(`test`)
    expect(spans).toEqual([])
  })

  it(`should enable tracing when set to true`, () => {
    setTracingEnabled(true)
    const tracer = new PerformanceMarkTracer()
    addTracer(tracer)

    const spans = globalTracerRegistry.startSpan(`test`)
    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe(`test`)
  })

  it(`should add and remove tracers`, () => {
    setTracingEnabled(true)
    const tracer = new PerformanceMarkTracer()

    addTracer(tracer)
    let spans = globalTracerRegistry.startSpan(`test`)
    expect(spans).toHaveLength(1)

    removeTracer(tracer)
    spans = globalTracerRegistry.startSpan(`test`)
    expect(spans).toHaveLength(0)
  })
})
