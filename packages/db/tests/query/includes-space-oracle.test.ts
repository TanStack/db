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
  // Exhaust the setup ownership boundary: four sources, every distinct
  // failing/held pair, and both synchronous and asynchronous failures.
  for (const failed of [0, 1, 2, 3]) {
    for (const held of [0, 1, 2, 3].filter((index) => index !== failed)) {
      it.each([`throw`, `reject`] as const)(
        `settles held source ${held} before cleanup after source ${failed} %s`,
        async (mode) => {
          const primary = new Error(`first preload failure`)
          let release!: () => void
          const gate = new Promise<void>((resolve) => {
            release = resolve
          })
          const original = CollectionImpl.prototype.preload
          let started = 0
          const preload = vi
            .spyOn(CollectionImpl.prototype, `preload`)
            .mockImplementation(function (this: CollectionImpl) {
              const index = started++
              if (index === held) return gate
              if (index === failed) {
                if (mode === `throw`) throw primary
                return Promise.reject(primary)
              }
              return original.call(this)
            })
          const cleanup = vi.spyOn(CollectionImpl.prototype, `cleanup`)
          let settled = false
          const result = createNestedCollectionFixture(1).then(
            async (fixture) => {
              settled = true
              await fixture.cleanup()
              return undefined
            },
            (error: unknown) => {
              settled = true
              return error
            },
          )
          try {
            // Let every runnable preload and failure continuation run, without
            // releasing the held source. This is a host cut, not a sleep budget.
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
            expect(started).toBe(4)
            expect(settled).toBe(false)
            expect(cleanup).not.toHaveBeenCalled()
            release()
            expect(await result).toBe(primary)
            expect(cleanup).toHaveBeenCalledTimes(4)
            expect(new Set(cleanup.mock.contexts).size).toBe(4)
          } finally {
            release()
            await result
            preload.mockRestore()
            cleanup.mockRestore()
          }
        },
      )
    }
  }

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
