import { beforeEach, describe, expect, it } from "vitest"
import {
  PerformanceMarkTracer,
  addTracer,
  setTracingEnabled,
  withSpan,
  withSpanAsync,
} from "../src/index.js"

describe(`withSpan`, () => {
  beforeEach(() => {
    setTracingEnabled(false)
  })

  it(`should execute function when tracing is disabled`, () => {
    let executed = false
    const result = withSpan(`test`, () => {
      executed = true
      return `success`
    })

    expect(executed).toBe(true)
    expect(result).toBe(`success`)
  })

  it(`should execute function when tracing is enabled`, () => {
    setTracingEnabled(true)
    addTracer(new PerformanceMarkTracer())

    let executed = false
    const result = withSpan(`test`, () => {
      executed = true
      return `success`
    })

    expect(executed).toBe(true)
    expect(result).toBe(`success`)
  })

  it(`should handle async functions`, async () => {
    setTracingEnabled(true)
    addTracer(new PerformanceMarkTracer())

    let executed = false
    const result = await withSpanAsync(`test`, async () => {
      executed = true
      return Promise.resolve(`success`)
    })

    expect(executed).toBe(true)
    expect(result).toBe(`success`)
  })

  it(`should handle errors in functions`, () => {
    setTracingEnabled(true)
    addTracer(new PerformanceMarkTracer())

    expect(() => {
      withSpan(`test`, () => {
        throw new Error(`test error`)
      })
    }).toThrow(`test error`)
  })
})
