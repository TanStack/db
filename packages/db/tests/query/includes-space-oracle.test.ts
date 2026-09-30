import { describe, expect, it, vi } from 'vitest'
import { CollectionImpl } from '../../src/collection/index.js'
import { BucketFacadeAdapter } from '../../src/query/live/bucket-facade-adapter.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import { createNestedCollectionFixture } from './includes-space-oracle-fixture.js'

/**
 * # Does nested Collection materialization retain only reachable facades?
 *
 * The nested-materialization contract in ARCHITECTURE.md gives one Collection
 * facade to each active bucket and releases retired buckets. Its space law
 * bounds retained facades by reachable relationships. A facade must not be
 * created per leaf or retained for a retired bucket at initial publication.
 *
 * The default fixture has two branches per root, five twigs per branch, and
 * ten leaves per twig. Facades exist for the root-to-branch, branch-to-twig, and
 * twig-to-leaf buckets. The expected count is therefore `roots + branches +
 * twigs`. Changing leaf count from zero to one to ten changes public row
 * volume while keeping those relationship buckets and their facade count.
 *
 * This oracle also checks setup ownership. All four source preloads must settle
 * before cleanup starts. A preload or index-creation failure cleans every
 * source, restores test instrumentation, preserves the first failure, and
 * reports cleanup failures separately.
 *
 * Facade-map inspection is a test diagnostic, not a runtime API. The count is a
 * bounded space invariant for this fixed topology, not a general heap measure.
 * It does not measure retained D2 rows, demand, or route churn.
 */

// Inspect retained adapter state only in tests; diagnostics need no runtime API.
type AdapterState = {
  getEntry: (...args: Array<unknown>) => { collection: object }
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
  leafCount = 10,
) {
  const entries = spyFacadeEntries()
  let fixture:
    | Awaited<ReturnType<typeof createNestedCollectionFixture>>
    | undefined
  return withHistoryCleanup(
    async () => {
      fixture = await createNestedCollectionFixture(rootCount, leafCount)
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

  it.each([0, 1, 20])(
    `constructs exactly one facade per reachable bucket for %i roots`,
    async (rootCount) => {
      await withSpaceFixture(rootCount, async (fixture, entries) => {
        await fixture.live.preload()

        const adapters = new Set(entries.mock.contexts as Array<AdapterState>)
        const created = new Set(
          entries.mock.results
            .filter((result) => result.type === `return`)
            .map((result) => result.value),
        )
        expect(created.size).toBe(fixture.expectedFacadeCount)
        expect(
          new Set([...created].map((entry) => entry.collection)).size,
        ).toBe(fixture.expectedFacadeCount)
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
    },
  )

  // A leaf-based facade rule predicts 0 or 100 for the endpoints, not 13.
  // Read the leaf rows too, so a fixture that ignores leafCount cannot pass.
  it.each([0, 1, 10])(
    `keeps facade count at thirteen when each twig has %i leaves`,
    async (leafCount) => {
      await withSpaceFixture(
        1,
        async (fixture, entries) => {
          await fixture.live.preload()
          const twigs = fixture.live.toArray.flatMap((root) =>
            root.branches.toArray.flatMap((branch) => branch.twigs.toArray),
          )
          expect(twigs).toHaveLength(10)
          expect(
            twigs.reduce(
              (total, twig) => total + twig.leaves.toArray.length,
              0,
            ),
          ).toBe(10 * leafCount)
          // A facade-per-leaf result must fail the same count comparison.
          expect(() => expect(10 * leafCount).toBe(13)).toThrow()

          const adapters = new Set(entries.mock.contexts as Array<AdapterState>)
          const created = new Set(
            entries.mock.results
              .filter((result) => result.type === `return`)
              .map((result) => result.value),
          )
          expect(created.size).toBe(13)
          expect(
            new Set([...created].map((entry) => entry.collection)).size,
          ).toBe(13)
          expect(
            [...adapters].reduce(
              (total, adapter) => total + countEntries(adapter.entries),
              0,
            ),
          ).toBe(13)
        },
        leafCount,
      )
    },
  )

  for (const { phase, index } of [
    { phase: `preload`, index: 0 },
    { phase: `preload-rejection`, index: 0 },
    { phase: `createIndex`, index: 0 },
    { phase: `createIndex`, index: 1 },
    { phase: `createIndex`, index: 2 },
  ] as const) {
    it.each([false, true])(
      `cleans every source and restores its spy after ${phase} ${index} fails (cleanup failure=%s)`,
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
            : phase === `createIndex`
              ? (() => {
                  const originalIndex = CollectionImpl.prototype.createIndex
                  const spy = vi.spyOn(CollectionImpl.prototype, `createIndex`)
                  for (let prior = 0; prior < index; prior++)
                    spy.mockImplementationOnce(originalIndex)
                  return spy.mockImplementationOnce(() => {
                    throw primary
                  })
                })()
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
