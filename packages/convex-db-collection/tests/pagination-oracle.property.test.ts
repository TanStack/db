/**
 * Automatic pagination owes the same complete snapshot as an unpaginated
 * query. Convex's documented PaginationOptions fixes each range with
 * endCursor; SplitRequired means the current page is incomplete and cannot
 * be published. Our model is the latest input row array, sorted only for the
 * public comparison. It does not compute cursors or adapter sync operations.
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
    publish: async (rows: Array<Row>) => {
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
          const needsSplit = split !== `none` && interval.length > 2
          slot.current = {
            page: needsSplit && split === `required` ? [] : page,
            continueCursor: boundary,
            isDone: endCursor == null && page.length === interval.length,
            ...(needsSplit
              ? {
                  pageStatus:
                    split === `required`
                      ? (`SplitRequired` as const)
                      : (`SplitRecommended` as const),
                  splitCursor: String(
                    interval[Math.floor((interval.length - 1) / 2)]!.rank,
                  ),
                }
              : {}),
          }
          slot.callback(slot.current)
        }
        await Promise.resolve()
        if (slots.every((slot) => !slot.active || served.has(slot))) return
      }
      throw new Error(`Pagination did not exhaust finite fixture`)
    },
  }
}

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
// Calibration: disabling continuation failed at public-row comparison with
// seed 20261022/path 5:1:1:3:10:1:1:1:1:1:1:1. Ignoring SplitRequired failed
// there with path 14:1:0:2:5:1:1:2. Both reached the exhausted checkpoint;
// neither failure was a setup error or timeout.
const property = fc.asyncProperty(
  history,
  async ({ snapshots, pageSize, reverse, split }) => {
    const source = provider(reverse, split)
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
    try {
      for (const rows of snapshots) {
        await source.publish(rows)
        await collection.utils.awaitSync()
        const actual = [...collection.values()]
          .map(({ id, rank, text }) => ({ id, rank, text }))
          .sort((a, b) => a.id.localeCompare(b.id))
        const expected = [...rows].sort((a, b) => a.id.localeCompare(b.id))
        expect(actual).toEqual(expected)
        expect(collection.status).toBe(`ready`)
      }
    } finally {
      await collection.cleanup()
      expect(source.slots.every((slot) => !slot.active)).toBe(true)
    }
  },
)

it(`refines exhausted snapshots across reactive ranges and page splits`, async () => {
  const seed = process.env.CONVEX_ORACLE_SEED
  const path = process.env.CONVEX_ORACLE_PATH
  if (seed) await fc.assert(property, { seed: Number(seed), path, numRuns: 60 })
  else {
    await fc.assert(property, { seed: 20261022, numRuns: 60 })
    await fc.assert(property, { numRuns: 60 })
  }
})
