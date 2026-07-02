import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getPerfTraceSnapshot,
  recordPerfCount,
  resetPerfTrace,
  setPerfTracingEnabled,
  withPerfSpanAsync,
} from '../../../src/query/live/perf.js'
import { recordPerfCount as recordIvmPerfCount } from '../../../../db-ivm/src/perf.js'

describe(`perf trace aggregation`, () => {
  beforeEach(() => {
    resetPerfTrace()
    setPerfTracingEnabled(false)
  })

  afterEach(() => {
    resetPerfTrace()
    setPerfTracingEnabled(false)
  })

  it(`does not aggregate metrics while disabled`, () => {
    recordPerfCount(`disabled.counter`)

    expect(getPerfTraceSnapshot().metrics).toEqual([])
  })

  it(`aggregates repeated metrics by name, kind, and tags`, () => {
    setPerfTracingEnabled(true)

    recordPerfCount(`example.counter`, 2, { path: `a` })
    recordPerfCount(`example.counter`, 3, { path: `a` })

    const metric = getPerfTraceSnapshot().metrics.find(
      (entry) => entry.name === `example.counter`,
    )

    expect(metric).toMatchObject({
      kind: `counter`,
      calls: 2,
      total: 5,
      min: 2,
      max: 3,
      last: 3,
      tags: { path: `a` },
    })
  })

  it(`completes async spans`, async () => {
    setPerfTracingEnabled(true)

    const result = await withPerfSpanAsync(`example.async`, {}, async () => {
      return 42
    })

    const metric = getPerfTraceSnapshot().metrics.find(
      (entry) => entry.name === `example.async`,
    )

    expect(result).toBe(42)
    expect(metric).toMatchObject({
      kind: `span`,
      calls: 1,
    })
    expect(metric?.total).toBeGreaterThanOrEqual(0)
  })

  it(`shares one sink with db-ivm instrumentation`, () => {
    setPerfTracingEnabled(true)

    recordIvmPerfCount(`ivm.counter`, 4, { package: `db-ivm` })

    const metric = getPerfTraceSnapshot().metrics.find(
      (entry) => entry.name === `ivm.counter`,
    )

    expect(metric).toMatchObject({
      kind: `counter`,
      calls: 1,
      total: 4,
      tags: { package: `db-ivm` },
    })
  })
})
