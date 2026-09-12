import { describe, expect, it, vi } from 'vitest'
import { CollectionImpl } from '../../src/collection/index.js'
import { BucketFacadeAdapter } from '../../src/query/live/bucket-facade-adapter.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
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

function spyFacadeEntries() {
  return vi.spyOn(
    BucketFacadeAdapter.prototype as unknown as AdapterState,
    `getEntry`,
  )
}

async function withSpaceFixture(
  rootCount: number,
  inspect: (
    fixture: Awaited<ReturnType<typeof createNestedCollectionFixture>>,
    entries: ReturnType<typeof spyFacadeEntries>,
  ) => Promise<void>,
) {
  const entries = spyFacadeEntries()
  let fixture:
    | Awaited<ReturnType<typeof createNestedCollectionFixture>>
    | undefined
  return withHistoryCleanup(
    async () => {
      fixture = await createNestedCollectionFixture(rootCount)
      await inspect(fixture, entries)
    },
    () => [() => fixture?.cleanup(), () => entries.mockRestore()],
  )
}

describe(`nested Collection materialization space oracle`, () => {
  it(`constructs exactly one facade per reachable bucket`, async () => {
    await withSpaceFixture(20, async (fixture, entries) => {
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
    })
  })

  for (const phase of [
    `preload`,
    `preload-rejection`,
    `createIndex`,
  ] as const) {
    it.each([false, true])(
      `cleans every source and restores its spy after ${phase} fails (cleanup failure=%s)`,
      async (failCleanup) => {
        const primary = new Error(`space setup failure`)
        const secondary = new Error(`space cleanup failure`)
        const originalEntry = (
          BucketFacadeAdapter.prototype as unknown as AdapterState
        ).getEntry
        const originalCleanup = CollectionImpl.prototype.cleanup
        const cleanup = vi.spyOn(CollectionImpl.prototype, `cleanup`)
        if (failCleanup)
          cleanup.mockImplementationOnce(async function (this: CollectionImpl) {
            await originalCleanup.call(this)
            throw secondary
          })
        const setup =
          phase === `preload-rejection`
            ? vi
                .spyOn(CollectionImpl.prototype, `preload`)
                .mockRejectedValueOnce(primary)
            : vi
                .spyOn(CollectionImpl.prototype, phase)
                .mockImplementationOnce(() => {
                  throw primary
                })
        await withHistoryCleanup(
          async () => {
            const result = withSpaceFixture(1, () =>
              Promise.reject(
                new Error(`failed setup must not reach inspection`),
              ),
            )
            if (failCleanup) {
              const failure: unknown = await result.catch(
                (error: unknown) => error,
              )
              expect(failure).toBeInstanceOf(AggregateError)
              if (!(failure instanceof AggregateError)) throw failure
              expect(failure.cause).toBe(primary)
              expect(failure.errors).toHaveLength(2)
              expect(failure.errors[0]).toBe(primary)
              expect(failure.errors[1]).toBe(secondary)
            } else {
              await expect(result).rejects.toBe(primary)
            }
            expect(cleanup).toHaveBeenCalledTimes(4)
            expect(new Set(cleanup.mock.contexts).size).toBe(4)
            expect(
              (BucketFacadeAdapter.prototype as unknown as AdapterState)
                .getEntry,
            ).toBe(originalEntry)
          },
          () => [() => setup.mockRestore(), () => cleanup.mockRestore()],
        )
      },
    )
  }
})
