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
 * keyed rows, moving their ranks and adding/removing keys. Page sizes 1-4,
 * forward/reverse delivery, and required/recommended/no splits vary separately.
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
const history = fc.record({
  snapshots: fc.array(snapshot, { minLength: 1, maxLength: 10 }),
  pageSize: fc.integer({ min: 1, max: 4 }),
  reverse: fc.boolean(),
  split: fc.constantFrom(
    `none` as const,
    `required` as const,
    `recommended` as const,
  ),
})
// Calibration on the legal provider grammar: reversing page order fails the
// select-boundary comparison at seed 20261022/path 0:1:0:2:3:1:1:1. Publishing
// an available prefix before a missing range fails the intermediate checkpoint
// at seed 20261022/path 0:1:3:1:2:5:7:3:3:0:1:1. Both are assertion failures
// after reaching the named observation, not setup errors or timeouts.
const property = fc.asyncProperty(
  history,
  async ({ snapshots, pageSize, reverse, split }) => {
    const source = provider(reverse, split)
    let selected: ReadonlyArray<Row> = []
    let accepted: ReadonlyArray<Row> = []
    let pendingCheckpoints = 0
    const collection = createCollection(
      convexPaginatedCollectionOptions({
        client: source.client,
        query,
        queryArgs: {},
        pageSize,
        select: (rows) => {
          selected = rows
          return rows
        },
        getKey: (row) => row.id,
        gcTime: 0,
      }),
    )
    collection.startSyncImmediate()
    await withTestCleanup(
      async () => {
        for (const rows of snapshots) {
          await source.publish(rows, () => {
            pendingCheckpoints++
            // A newly acquired range has no result yet. The last complete
            // snapshot, including its order at select, must remain authoritative.
            expect(selected).toEqual(accepted)
            expect(
              [...collection.values()]
                .map(({ id, rank, text }) => ({ id, rank, text }))
                .sort((a, b) => a.id.localeCompare(b.id)),
            ).toEqual([...accepted].sort((a, b) => a.id.localeCompare(b.id)))
          })
          await collection.utils.awaitSync()
          expect(selected).toEqual([...rows].sort((a, b) => a.rank - b.rank))
          accepted = [...rows].sort((a, b) => a.rank - b.rank)
          const actual = [...collection.values()]
            .map(({ id, rank, text }) => ({ id, rank, text }))
            .sort((a, b) => a.id.localeCompare(b.id))
          const expected = [...rows].sort((a, b) => a.id.localeCompare(b.id))
          expect(actual).toEqual(expected)
          expect(collection.status).toBe(`ready`)
        }
        if (snapshots[0]!.length > pageSize)
          expect(pendingCheckpoints).toBeGreaterThan(0)
      },
      async () => {
        await collection.cleanup()
        expect(source.slots.every((slot) => !slot.active)).toBe(true)
      },
    )
  },
)

it(`refines exhausted snapshots across reactive ranges and page splits`, async () => {
  const seed = process.env.CONVEX_PAGINATION_ROWS_SEED
  const path = process.env.CONVEX_PAGINATION_ROWS_PATH
  if (seed) await fc.assert(property, { seed: Number(seed), path, numRuns: 60 })
  else {
    await fc.assert(property, { seed: 20261022, numRuns: 60 })
    await fc.assert(property, { numRuns: 60 })
  }
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
const initialWork = fc.asyncProperty(
  fc.integer({ min: 3, max: 40 }),
  fc.integer({ min: 1, max: 8 }),
  fc.boolean(),
  async (pageCount, pageSize, reverse) => {
    const rows = Array.from({ length: pageCount * pageSize }, (_, rank) => ({
      id: String(rank),
      rank,
      text: String(rank),
    }))
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
      },
      async () => {
        await collection.cleanup()
      },
    )
  },
)
it(`materializes complete rows once during finite initial pagination`, async () => {
  const seed = process.env.CONVEX_PAGINATION_WORK_SEED
  const path = process.env.CONVEX_PAGINATION_WORK_PATH
  if (seed)
    await fc.assert(initialWork, { seed: Number(seed), path, numRuns: 60 })
  else {
    await fc.assert(initialWork, { seed: 20261022, numRuns: 60 })
    await fc.assert(initialWork, { numRuns: 60 })
  }
})

// A configured maxRows bounds the complete eager mirror's accepted row count.
// It is not a transport-byte or strict peak-memory bound: one provider response
// can itself be larger. The reference accepts a finite snapshot iff its row
// count fits, otherwise preserving the prior public rows. Growing a previously
// exhausted source must reject before opening any continuation beyond that cap.
// Calibration: omitting the row cap fails at the public error observation,
// seed 20261023/path 0:0, maxRows 1 followed by a two-row source snapshot.
const rowBound = fc.asyncProperty(
  fc.integer({ min: 1, max: 20 }),
  fc.integer({ min: 1, max: 6 }),
  fc.integer({ min: 1, max: 6 }),
  async (maxRows, pageSize, excess) => {
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
      },
      async () => {
        await collection.cleanup()
      },
    )
  },
)
it(`rejects an oversized eager mirror before continuing and preserves accepted rows`, async () => {
  const seed = process.env.CONVEX_PAGINATION_BOUND_SEED
  const path = process.env.CONVEX_PAGINATION_BOUND_PATH
  if (seed) await fc.assert(rowBound, { seed: Number(seed), path, numRuns: 60 })
  else {
    await fc.assert(rowBound, { seed: 20261023, numRuns: 60 })
    await fc.assert(rowBound, { numRuns: 60 })
  }
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

it(`defaults the eager mirror cap to ten thousand rows`, async () => {
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
  try {
    await source.publish(
      Array.from({ length: 10_001 }, (_, rank) => ({
        id: String(rank),
        rank,
        text: String(rank),
      })),
    )
    expect(collection.utils.getSyncError()).toBeInstanceOf(RangeError)
    expect(collection.size).toBe(0)
    expect(source.slots).toHaveLength(1)
  } finally {
    await collection.cleanup()
  }
})
