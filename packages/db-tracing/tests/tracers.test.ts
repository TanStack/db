import { describe, expect, it } from "vitest"
import { PerformanceMarkTracer } from "../src/tracers/performance-mark.js"

describe(`PerformanceMarkTracer`, () => {
  it(`should create spans with performance marks`, () => {
    const tracer = new PerformanceMarkTracer()
    const span = tracer.startSpan(`test-span`)

    expect(span.name).toBe(`test-span`)
    expect(typeof span.end).toBe(`function`)
    expect(typeof span.setAttributes).toBe(`function`)

    // Should not throw when ending span
    expect(() => span.end()).not.toThrow()
  })

  it(`should handle setAttributes as no-op`, () => {
    const tracer = new PerformanceMarkTracer()
    const span = tracer.startSpan(`test-span`)

    expect(() => span.setAttributes({ key: `value` })).not.toThrow()
  })
})
