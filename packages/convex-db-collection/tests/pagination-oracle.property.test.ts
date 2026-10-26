/**
 * Automatic pagination owes the same complete snapshot as an unpaginated
 * query. Convex's documented PaginationOptions fixes each range with
 * endCursor; SplitRequired means the current page is incomplete and cannot
 * be published. Our model is the latest input row array in rank order. The select
 * boundary observes page concatenation order; Collection rows are also compared
 * by key because Collection iteration order is not query order. The model does
 * not compute cursors or adapter sync operations.
 *
 * The provider fixture below answers mathematical rank intervals, rather than
 * following the adapter's page state. Histories replace up to eight distinct
 * keyed rows, moving their ranks and adding/removing keys. A three-row then
 * eight-row prefix and an empty final result force pending replacement and
 * empty readiness. Each row history crosses page sizes 1-2 and 3-4 with all
 * three split policies; callback direction and intervening rows vary freely.
 * A pump delivers every active subscription once per source revision, including
 * newly acquired ranges, before the exhaustion checkpoint. It never supplies
 * an endCursor unless production requested it. The real-backend receiving
 * witness in e2e/backend-oracle.test.ts checks these range premises with Convex.
 *
 * Limits: finite exhausted queries and one Collection. Continuous unbounded
 * growth and atomic publication across separate Collections are not promised.
 */
import fc from 'fast-check'
import { createCollection } from '@tanstack/db'
import { makeFunctionReference } from 'convex/server'
import { expect, it } from 'vitest'
import { convexPaginatedCollectionOptions } from '../src/index'
import { runOracleCampaign } from '../../db/tests/oracle-campaign'
import { withTestCleanup } from './helpers'
import type { PaginationOptions, PaginationResult } from 'convex/server'
import type { ConvexCollectionClient } from '../src/index'

type Row = { id: string; rank: number; text: string }
const query = makeFunctionReference<
  `query`,
  { paginationOpts: PaginationOptions },
  PaginationResult<Row>
>(`rows:list`)
type Slot = {
  options: PaginationOptions
  current?: PaginationResult<Row>
  callback: (value: PaginationResult<Row>) => void
  active: boolean
}
function provider(
  reverse: boolean,
  split: `none` | `required` | `recommended`,
) {
  const slots: Array<Slot> = []
  let rowVisits = 0
  const client = {
    onUpdate: (
      _query: unknown,
      args: { paginationOpts: PaginationOptions },
      callback: Slot[`callback`],
    ) => {
      const slot: Slot = {
        options: args.paginationOpts,
        callback,
        active: true,
      }
      slots.push(slot)
      return Object.assign(
        () => {
          slot.active = false
        },
        { getCurrentValue: () => slot.current },
      )
    },
  } as ConvexCollectionClient
  return {
    client,
    slots,
    get rowVisits() {
      return rowVisits
    },
    publish: async (rows: Array<Row>, checkpoint?: () => void) => {
      const served = new Set<Slot>()
      for (let turn = 0; turn < 100; turn++) {
        const pending = slots.filter((slot) => slot.active && !served.has(slot))
        if (reverse) pending.reverse()
        for (const slot of pending) {
          served.add(slot)
          const { cursor, endCursor, numItems } = slot.options
          const from = cursor === null ? -Infinity : Number(cursor)
          const to = endCursor == null ? Infinity : Number(endCursor)
          const interval = rows
            .filter((row) => row.rank > from && row.rank <= to)
            .sort((a, b) => a.rank - b.rank)
          const page =
            endCursor == null ? interval.slice(0, numItems) : interval
          const boundary = endCursor ?? String(page.at(-1)?.rank ?? from)
          // A split belongs strictly inside the returned cursor range. For an
          // unbounded query that range ends at the returned page's boundary,
          // not at the end of all rows matching the query.
          const needsSplit = split !== `none` && page.length > 2
          const splitCursor = needsSplit
            ? String(page[Math.floor((page.length - 1) / 2)]!.rank)
            : undefined
          if (splitCursor !== undefined) {
            expect(Number(splitCursor)).toBeGreaterThan(from)
            expect(Number(splitCursor)).toBeLessThan(Number(boundary))
          }
          slot.current = {
            page: new Proxy(needsSplit && split === `required` ? [] : page, {
              get(target, key, receiver) {
                if (typeof key === `string` && /^\d+$/.test(key)) rowVisits++
                return Reflect.get(target, key, receiver)
              },
            }),
            continueCursor: boundary,
            isDone: endCursor == null && page.length === interval.length,
            ...(needsSplit
              ? {
                  pageStatus:
                    split === `required`
                      ? (`SplitRequired` as const)
                      : (`SplitRecommended` as const),
                  splitCursor,
                }
              : {}),
          }
          slot.callback(slot.current)
        }
        await Promise.resolve()
        if (slots.some((slot) => slot.active && slot.current === undefined)) {
          // Drain the acquisition's scheduled flush before checking. Otherwise
          // the fixture could fill its new subscriptions before production ever
          // reaches the incomplete-range path, hiding partial publication.
          await Promise.resolve()
          checkpoint?.()
        }
        if (slots.every((slot) => !slot.active || served.has(slot))) return
      }
      throw new Error(`Pagination did not exhaust finite fixture`)
    },
  }
}

// Shrinking must retain the law mismatch even when disposal also fails.
it(`retains the primary comparison when cleanup also fails`, async () => {
  const primary = new Error(`row mismatch`)
  const cleanup = new Error(`release mismatch`)
  let lastReleased = false
  await expect(
    withTestCleanup(
      () => Promise.reject(primary),
      () => Promise.reject(cleanup),
      () => {
        lastReleased = true
      },
    ),
  ).rejects.toMatchObject({ cause: primary, errors: [primary, cleanup] })
  expect(lastReleased).toBe(true)
})

const snapshot = fc.shuffledSubarray([0, 1, 2, 3, 4, 5, 6, 7]).chain((ids) =>
  fc
    .array(fc.string({ maxLength: 8 }), {
      minLength: ids.length,
      maxLength: ids.length,
    })
    .map((texts) =>
      ids.map((id, rank): Row => ({
        id: String(id),
        rank,
        text: texts[rank]!,
      })),
    ),
)
// A three-row accepted snapshot followed by eight rows forces acquisition
// while a nonempty prior snapshot is visible. Each generated history uses a
// small page and a split-capable page with every split policy. This preserves
// page sizes 1-4 and makes both split premises constructive, not lucky samples.
const history = fc.record({
  snapshots: fc.array(snapshot, { minLength: 1, maxLength: 10 }),
  initialTexts: fc.array(fc.string({ maxLength: 8 }), {
    minLength: 8,
    maxLength: 8,
  }),
  smallPageSize: fc.integer({ min: 1, max: 2 }),
  splitPageSize: fc.integer({ min: 3, max: 4 }),
  reverse: fc.boolean(),
})
const rowStates = [
  `complete-nonempty-snapshot`,
  `complete-empty-snapshot`,
  `required-split`,
  `recommended-split`,
  `pending-range-with-prior-snapshot`,
  `public-snapshot-publication`,
] as const

function copyRows(rows: ReadonlyArray<Row>): Array<Row> {
  return rows.map(({ id, rank, text }) => ({ id, rank, text }))
}
function keyedRows(rows: ReadonlyArray<Row>): Array<Row> {
  return copyRows(rows).sort((a, b) => a.id.localeCompare(b.id))
}
function sameRows(
  left: ReadonlyArray<Row>,
  right: ReadonlyArray<Row>,
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.id === right[index]!.id &&
        row.rank === right[index]!.rank &&
        row.text === right[index]!.text,
    )
  )
}

// During one coherent source revision, observations may retain the prior
// complete snapshot and then expose the new complete snapshot. Repeated
// observations are permitted. Once the new snapshot appears, stale prior rows
// cannot reappear without another source revision. Keep every observation:
// overwriting one variable would hide a prefix immediately repaired in-turn.
function expectRevisionTrace(
  boundary: string,
  observations: ReadonlyArray<ReadonlyArray<Row>>,
  prior: ReadonlyArray<Row>,
  current: ReadonlyArray<Row>,
): void {
  let currentSeen = false
  for (const observation of observations) {
    if (sameRows(observation, current)) currentSeen = true
    else
      expect(
        observation,
        `${boundary}: complete monotone source snapshots`,
      ).toEqual(currentSeen ? current : prior)
  }
}

// Calibrate both recorders' shared trace relation without imposing one callback
// per revision. Repeated old/new snapshots are legal; prefixes and rollback
// after the new snapshot are not, even when a final callback repairs the result.
it.each([`select`, `Collection publication`])(
  `calibrates complete monotone snapshots at %s`,
  (boundary) => {
    const current = Array.from({ length: 3 }, (_, rank) => ({
      id: String(rank),
      rank,
      text: String(rank),
    }))
    expect(() =>
      expectRevisionTrace(boundary, [[], [], current, current], [], current),
    ).not.toThrow()
    expect(() =>
      expectRevisionTrace(
        boundary,
        [current.slice(0, 1), current],
        [],
        current,
      ),
    ).toThrow()
    expect(() =>
      expectRevisionTrace(boundary, [current, [], current], [], current),
    ).toThrow()
  },
)

// Calibration: publishing a one-row prefix before the full result, or
// republishing the empty prior snapshot after the full result, fails the select
// trace comparison at seed 20261022/path 0:0:0:0:0:0:0:0:0:0. The unchanged
// implementation passes that direct replay; setup errors are not counted.
it(`refines every published snapshot across reactive ranges and page splits`, async () => {
  await runOracleCampaign(
    `CONVEX_PAGINATION_ROWS`,
    rowStates,
    async (reach, parameters) => {
      const property = fc.asyncProperty(
        history,
        async ({
          snapshots,
          initialTexts,
          smallPageSize,
          splitPageSize,
          reverse,
        }) => {
          reach.beginHistory()
          const initial = initialTexts.map((text, rank): Row => ({
            id: String(rank),
            rank,
            text,
          }))
          const revisions = [initial.slice(0, 3), initial, ...snapshots, []]
          for (const pageSize of [smallPageSize, splitPageSize]) {
            for (const split of [`none`, `required`, `recommended`] as const) {
              const source = provider(reverse, split)
              let selected: ReadonlyArray<Row> = []
              let accepted: ReadonlyArray<Row> = []
              const selectTrace: Array<Array<Row>> = []
              const publicTrace: Array<Array<Row>> = []
              const collection = createCollection(
                convexPaginatedCollectionOptions({
                  client: source.client,
                  query,
                  queryArgs: {},
                  pageSize,
                  select: (rows) => {
                    selected = copyRows(rows)
                    selectTrace.push(copyRows(rows))
                    return rows
                  },
                  getKey: (row) => row.id,
                  gcTime: 0,
                }),
              )
              collection.startSyncImmediate()
              const subscription = collection.subscribeChanges(() => {
                publicTrace.push(keyedRows([...collection.values()]))
              })
              await withTestCleanup(
                async () => {
                  for (const rows of revisions) {
                    // Copy the model before passing source objects to production.
                    const expected = copyRows(rows).sort(
                      (a, b) => a.rank - b.rank,
                    )
                    const selectStart = selectTrace.length
                    const publicStart = publicTrace.length
                    await source.publish(rows, () => {
                      if (accepted.length > 0)
                        reach.reach(`pending-range-with-prior-snapshot`)
                      // No new complete result is available at this cut.
                      expect(selected).toEqual(accepted)
                      expect(keyedRows([...collection.values()])).toEqual(
                        keyedRows(accepted),
                      )
                    })
                    await collection.utils.awaitSync()
                    expectRevisionTrace(
                      `select`,
                      selectTrace.slice(selectStart),
                      accepted,
                      expected,
                    )
                    expectRevisionTrace(
                      `Collection publication`,
                      publicTrace.slice(publicStart),
                      keyedRows(accepted),
                      keyedRows(expected),
                    )
                    expect(selected).toEqual(expected)
                    expect(keyedRows([...collection.values()])).toEqual(
                      keyedRows(expected),
                    )
                    expect(collection.status).toBe(`ready`)
                    reach.reach(
                      expected.length === 0
                        ? `complete-empty-snapshot`
                        : `complete-nonempty-snapshot`,
                    )
                    if (publicTrace.length > publicStart)
                      reach.reach(`public-snapshot-publication`)
                    for (const slot of source.slots) {
                      if (slot.current?.pageStatus === `SplitRequired`)
                        reach.reach(`required-split`)
                      if (slot.current?.pageStatus === `SplitRecommended`)
                        reach.reach(`recommended-split`)
                    }
                    accepted = expected
                  }
                },
                () => subscription.unsubscribe(),
                async () => {
                  await collection.cleanup()
                  expect(source.slots.every((slot) => !slot.active)).toBe(true)
                },
              )
            }
          }
        },
      )
      await fc.assert(property, { numRuns: 60, ...parameters })
    },
    { fixedSeed: 20261022 },
  )
})

// A finite initial load must materialize its rows only after all ranges are
// available. Recopying every earlier prefix on each continuation makes initial
// acquisition quadratic. This work law follows the adapter's complete-snapshot
// design: incomplete rows cannot be published, so materializing them earns no
// useful output. Count numeric element reads at the provider boundary, rather
// than copying production's loop or predicting its number of subscriptions.
// This bounds row materialization, not cache lookups, RPC count, or elapsed time.
// Calibration: copying incomplete prefixes failed the row-visit comparison at
// seed 20261022/path 0:0:0:0, three rows at pageSize 1 read four elements.
// The same direct replay passes after deferring materialization until exhaustion.
it(`materializes complete rows once during finite initial pagination`, async () => {
  await runOracleCampaign(
    `CONVEX_PAGINATION_WORK`,
    [`initial-multi-range-exhaustion`] as const,
    async (reach, parameters) => {
      const initialWork = fc.asyncProperty(
        fc.integer({ min: 3, max: 40 }),
        fc.integer({ min: 1, max: 8 }),
        fc.boolean(),
        async (pageCount, pageSize, reverse) => {
          reach.beginHistory()
          const rows = Array.from(
            { length: pageCount * pageSize },
            (_, rank) => ({
              id: String(rank),
              rank,
              text: String(rank),
            }),
          )
          const source = provider(reverse, `none`)
          const collection = createCollection(
            convexPaginatedCollectionOptions({
              client: source.client,
              query,
              queryArgs: {},
              pageSize,
              getKey: (row) => row.id,
              gcTime: 0,
            }),
          )
          collection.startSyncImmediate()
          await withTestCleanup(
            async () => {
              await source.publish(rows)
              // Check before awaitSync's explicit cache refreshes. At initial exhaustion
              // there is exactly one useful materialization, the complete public result.
              expect(collection.size).toBe(rows.length)
              expect(source.rowVisits).toBe(rows.length)
              expect(
                source.slots.some((slot) => slot.options.cursor !== null),
              ).toBe(true)
              reach.reach(`initial-multi-range-exhaustion`)
            },
            async () => {
              await collection.cleanup()
            },
          )
        },
      )
      await fc.assert(initialWork, { numRuns: 60, ...parameters })
    },
    { fixedSeed: 20261022 },
  )
})

// A configured maxRows bounds the complete eager mirror's accepted row count.
// It is not a transport-byte or strict peak-memory bound: one provider response
// can itself be larger. The reference accepts a finite snapshot iff its row
// count fits, otherwise preserving the prior public rows. Growing a previously
// exhausted source must reject before opening any continuation beyond that cap.
// Calibration: omitting the row cap fails at the public error observation,
// seed 20261023/path 0:0, maxRows 1 followed by a two-row source snapshot.
it(`rejects an oversized eager mirror before continuing and preserves accepted rows`, async () => {
  await runOracleCampaign(
    `CONVEX_PAGINATION_BOUND`,
    [
      `accepted-at-cap`,
      `overflow-preserves-prior`,
      `recovered-after-shrink`,
    ] as const,
    async (reach, parameters) => {
      const rowBound = fc.asyncProperty(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        async (maxRows, pageSize, excess) => {
          reach.beginHistory()
          const rows = Array.from({ length: maxRows + excess }, (_, rank) => ({
            id: String(rank),
            rank,
            text: String(rank),
          }))
          const source = provider(false, `none`)
          const collection = createCollection(
            convexPaginatedCollectionOptions({
              client: source.client,
              query,
              queryArgs: {},
              pageSize,
              maxRows,
              getKey: (row) => row.id,
              gcTime: 0,
            }),
          )
          collection.startSyncImmediate()
          await withTestCleanup(
            async () => {
              const accepted = rows.slice(0, maxRows)
              await source.publish(accepted)
              await collection.utils.awaitSync()
              expect(
                [...collection.values()]
                  .map(({ id, rank, text }) => ({
                    id,
                    rank,
                    text,
                  }))
                  .sort((a, b) => a.rank - b.rank),
              ).toEqual(accepted)
              reach.reach(`accepted-at-cap`)
              await source.publish(rows)
              expect(collection.utils.getSyncError()).toBeInstanceOf(RangeError)
              expect(
                [...collection.values()]
                  .map(({ id, rank, text }) => ({
                    id,
                    rank,
                    text,
                  }))
                  .sort((a, b) => a.rank - b.rank),
              ).toEqual(accepted)
              reach.reach(`overflow-preserves-prior`)
              // One continuation at the cap may be necessary to distinguish an empty
              // remainder from an extra row. No cursor may advance past that first
              // excess row once its response establishes that the mirror is too large.
              for (const slot of source.slots) {
                if (slot.options.cursor !== null)
                  expect(Number(slot.options.cursor)).toBeLessThan(maxRows)
              }
              await expect(collection.utils.awaitSync()).rejects.toBeInstanceOf(
                RangeError,
              )
              // The row cap is a valid source error, not a terminal run failure.
              // Removing the excess rows permits this same subscription run to recover.
              await source.publish(accepted)
              await collection.utils.awaitSync()
              expect(collection.utils.getSyncError()).toBeUndefined()
              expect(collection.size).toBe(maxRows)
              reach.reach(`recovered-after-shrink`)
            },
            async () => {
              await collection.cleanup()
            },
          )
        },
      )
      await fc.assert(rowBound, { numRuns: 60, ...parameters })
    },
    { fixedSeed: 20261023 },
  )
})

it.each([0, -1, 1.5, Infinity, NaN])(
  `rejects invalid maxRows %s`,
  async (maxRows) => {
    const source = provider(false, `none`)
    const collection = createCollection(
      convexPaginatedCollectionOptions({
        client: source.client,
        query,
        queryArgs: {},
        maxRows,
        getKey: (row) => row.id,
      }),
    )
    try {
      await expect(collection.preload()).rejects.toThrow(`maxRows`)
      expect(source.slots).toHaveLength(0)
    } finally {
      await collection.cleanup()
    }
  },
)

// The omitted default needs both adjacent observations. Rejection at 10,001
// alone also accepts a wrong default of 9,999; acceptance at 10,000 rejects it.
// Calibration: defaults of 9,999 and 10,001 fail the accepted-error and
// over-cap-error comparisons respectively; the documented default passes both.
it(`accepts ten thousand rows and rejects the next row under the default cap`, async () => {
  const source = provider(false, `none`)
  const collection = createCollection(
    convexPaginatedCollectionOptions({
      client: source.client,
      query,
      queryArgs: {},
      pageSize: 10_001,
      getKey: (row) => row.id,
    }),
  )
  collection.startSyncImmediate()
  await withTestCleanup(
    async () => {
      const rows = Array.from({ length: 10_001 }, (_, rank) => ({
        id: String(rank),
        rank,
        text: String(rank),
      }))
      const accepted = rows.slice(0, 10_000)
      await source.publish(accepted)
      expect(collection.utils.getSyncError()).toBeUndefined()
      await collection.utils.awaitSync()
      expect(collection.status).toBe(`ready`)
      expect(keyedRows([...collection.values()])).toEqual(keyedRows(accepted))
      await source.publish(rows)
      expect(collection.utils.getSyncError()).toBeInstanceOf(RangeError)
      expect(keyedRows([...collection.values()])).toEqual(keyedRows(accepted))
      expect(source.slots).toHaveLength(1)
      await expect(collection.utils.awaitSync()).rejects.toBeInstanceOf(
        RangeError,
      )
    },
    () => collection.cleanup(),
  )
})
