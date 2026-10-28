// Shared harness for the nested Collection space tests: facade-map spying and a
// fixture wrapper with cleanup. The space law is owned by
// includes-space-oracle.test.ts; ordinary setup tests live in includes-space.test.ts.
import { vi } from 'vitest'
import { BucketFacadeAdapter } from '../../src/query/live/bucket-facade-adapter.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { createNestedCollectionFixture } from './includes-space-oracle-fixture.js'

// Inspect retained adapter state only in tests; diagnostics need no runtime API.
export type AdapterState = {
  getEntry: (...args: Array<unknown>) => { collection: object }
  entries: Map<string, Map<string, unknown>>
  retiredEntries: Map<string, Map<string, unknown>>
}

export function countEntries(entries: AdapterState[`entries`]): number {
  return [...entries.values()].reduce(
    (total, buckets) => total + buckets.size,
    0,
  )
}

export function spyFacadeEntries() {
  return vi.spyOn(
    BucketFacadeAdapter.prototype as unknown as AdapterState,
    `getEntry`,
  )
}

export async function withSpaceFixture(
  rootCount: number,
  inspect: (
    fixture: Awaited<ReturnType<typeof createNestedCollectionFixture>>,
    entries: ReturnType<typeof spyFacadeEntries>,
  ) => Promise<void>,
  leafCount = 10,
) {
  const entries = spyFacadeEntries()
  let fixture:
    Awaited<ReturnType<typeof createNestedCollectionFixture>> | undefined
  return withHistoryCleanup(
    async () => {
      fixture = await createNestedCollectionFixture(rootCount, leafCount)
      await inspect(fixture, entries)
    },
    () => [() => fixture?.cleanup(), () => entries.mockRestore()],
  )
}
