import { expect } from 'vitest'
import type { ConformanceResult, LiveQueryDriver } from './contract'

/** Check raw absence separately from a framework's persistent empty containers. */
export function expectDisabledResult(
  result: ConformanceResult,
  representation: LiveQueryDriver['disabledRepresentation'],
) {
  expect(result.status).toBe(`disabled`)
  expect(result.isEnabled).toBe(false)
  expect(result.isReady).toBe(true)
  expect(result.isLoadingError).toBe(false)
  // A disabled query has no query definition, so it has no aliases to report.
  expect(result.errors).toBeUndefined()
  if (representation === `absent`) {
    expect(result.data).toBeUndefined()
    expect(result.state).toBeUndefined()
  } else {
    expect(representation).toBe(`empty-reactive`)
    expect(result.data).toEqual([])
    expect(result.state).toBeInstanceOf(Map)
    expect([...result.state!]).toEqual([])
    expect(result.state!.size).toBe(0)
  }
}
