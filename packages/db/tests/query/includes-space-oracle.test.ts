import { describe, expect, it, vi } from 'vitest'
import { BucketFacadeAdapter } from '../../src/query/live/bucket-facade-adapter.js'
import { createNestedCollectionFixture } from './includes-space-oracle-fixture.js'

// Inspect retained adapter state only in tests; diagnostics need no runtime API.
type AdapterState = {
  getEntry: (...args: Array<unknown>) => object
  entries: Map<string, Map<string, unknown>>
  retiredEntries: Map<string, Map<string, unknown>>
}

function countEntries(entries: AdapterState[`entries`]): number {
  return [...entries.values()].reduce(
    (total, buckets) => total + buckets.size,
    0,
  )
}

describe(`nested Collection materialization space oracle`, () => {
  it(`constructs exactly one facade per reachable bucket`, async () => {
    const entries = vi.spyOn(
      BucketFacadeAdapter.prototype as unknown as AdapterState,
      `getEntry`,
    )
    const fixture = await createNestedCollectionFixture(20)
    try {
      await fixture.live.preload()

      const adapters = new Set(entries.mock.contexts as Array<AdapterState>)
      const created = new Set(
        entries.mock.results
          .filter((result) => result.type === `return`)
          .map((result) => result.value),
      )
      expect(created.size).toBe(fixture.expectedFacadeCount)
      expect(
        [...adapters].reduce(
          (n, adapter) => n + countEntries(adapter.entries),
          0,
        ),
      ).toBe(fixture.expectedFacadeCount)
      expect(
        [...adapters].reduce(
          (n, adapter) => n + countEntries(adapter.retiredEntries),
          0,
        ),
      ).toBe(0)
    } finally {
      try {
        await fixture.cleanup()
      } finally {
        entries.mockRestore()
      }
    }
  })
})
