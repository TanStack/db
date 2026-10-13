import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { withOracleCleanup } from '../utils.js'
import type { LoadSubsetOptions } from '../../src/types.js'

/**
 * A live query ordered by a numeric field publishes the requested slice of
 * the provider's rows in ascending numeric order. The live-query architecture's
 * ordered-request and atomic-window laws require the completed setWindow()
 * result to include already cached rows as well as newly loaded rows. An index
 * with a custom reverse comparator cannot stand in for that ordinary order.
 *
 * The bounded history caches ranks 20 and 40, installs indexes in one of four
 * legal layouts, preloads a one-row window, then moves to offset one with two
 * rows. A controlled provider fulfills each exact request from four immutable
 * source rows; it never rewrites cached rows. A plain numeric sort and slice
 * predicts both public checkpoints independently of index selection. Public
 * snapshots and publication batches are compared after preload and after the
 * window promise settles. This checks BasicIndex and BTreeIndex; it does not
 * claim arbitrary comparators, ties, mutations, or remote provider behavior.
 */
type Row = { id: number; rank: number }
type IndexType = typeof BasicIndex | typeof BTreeIndex
type Layout =
  `custom-first` | `ordinary-first` | `no-index` | `eager-custom-only`

const rows: ReadonlyArray<Row> = [
  { id: 1, rank: 10 },
  { id: 2, rank: 20 },
  { id: 3, rank: 30 },
  { id: 4, rank: 40 },
]
const expected = [...rows].sort((a, b) => a.rank - b.rank || a.id - b.id)
const expectedWindow = (offset: number, limit: number) =>
  expected.slice(offset, offset + limit).map(({ id }) => id)

// This adapter models only the request grammar exercised here: a whole-source
// request, a finite prefix, or a cursor's current tie plus following rows.
// Its answers come from source facts and the request predicate, never indexes.
function requestedRows(options: LoadSubsetOptions): Array<Row> {
  if (options.orderBy) {
    expect(options.orderBy).toHaveLength(1)
    expect(options.orderBy[0]!.expression).toMatchObject({
      type: `ref`,
      path: [`rank`],
    })
    expect(options.orderBy[0]!.compareOptions.direction).toBe(`asc`)
  }
  const matching = options.where
    ? expected.filter(
        (row) => evaluateReferenceExpression(options.where!, row) === true,
      )
    : expected
  if (!options.cursor) {
    const start = options.offset ?? 0
    return matching.slice(
      start,
      options.limit === undefined ? undefined : start + options.limit,
    )
  }
  const current = matching.filter((row) =>
    Boolean(evaluateReferenceExpression(options.cursor!.whereCurrent, row)),
  )
  const following = matching
    .filter((row) =>
      Boolean(evaluateReferenceExpression(options.cursor!.whereFrom, row)),
    )
    .slice(0, options.limit)
  return [
    ...new Map([...current, ...following].map((row) => [row.id, row])).values(),
  ]
}

async function observeWindowMove(
  indexType: IndexType,
  layout: Layout,
  suffix: string,
) {
  const replies: Array<Array<number>> = []
  const writes: Array<number> = []
  const delivered = new Set([2, 4])
  const source = createCollection<Row>({
    id: `custom-window-source-${suffix}-${layout}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: layout === `eager-custom-only` ? `eager` : `off`,
    defaultIndexType: indexType,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of rows.filter(({ id }) => delivered.has(id))) {
          write({ type: `insert`, value: row })
        }
        commit()
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const reply = requestedRows(options)
            replies.push(reply.map(({ id }) => id))
            begin()
            for (const row of reply) {
              if (delivered.has(row.id)) continue
              delivered.add(row.id)
              writes.push(row.id)
              write({ type: `insert`, value: row })
            }
            const receipt = commit(options.signal)
            return receipt === true ? Promise.resolve() : receipt
          },
        }
      },
    },
  })
  await source.stateWhenReady()
  const custom = () =>
    source.createIndex((row) => row.rank, {
      indexType,
      options: { compareFn: (a: number, b: number) => b - a },
    })
  const ordinary = () => source.createIndex((row) => row.rank, { indexType })
  if (layout === `custom-first`) {
    custom()
    ordinary()
  } else if (layout === `ordinary-first`) {
    ordinary()
    custom()
  } else if (layout === `eager-custom-only`) {
    custom()
  }

  const live = createLiveQueryCollection((query) =>
    query
      .from({ row: source })
      .orderBy(({ row }) => row.rank, `asc`)
      .offset(0)
      .limit(1)
      .select(({ row }) => ({ id: row.id, rank: row.rank })),
  )
  const publications: Array<Array<number>> = []
  let subscription: ReturnType<typeof live.subscribeChanges> | undefined
  return withOracleCleanup(async () => {
    await live.preload()
    const initial = Array.from(live.values(), ({ id }) => id)
    subscription = live.subscribeChanges(() => {
      publications.push(Array.from(live.values(), ({ id }) => id))
    })
    publications.length = 0
    await live.utils.setWindow({ offset: 1, limit: 2 })
    const moved = Array.from(live.values(), ({ id }) => id)

    // The finite provider answer contains the cached rank-20 row, while
    // its write stream does not. This reaches the cached-row merge path.
    expect(replies.some((reply) => reply.join(`,`) === `1,2,3`)).toBe(true)
    expect(writes).toEqual([1, 3])
    expect(initial).toEqual(expectedWindow(0, 1))
    expect(moved).toEqual(expectedWindow(1, 2))
    expect(publications).toEqual([expectedWindow(1, 2)])
    if (layout === `eager-custom-only`) {
      expect(source.indexes.size).toBe(2)
    }
  }, [
    () => subscription?.unsubscribe(),
    () => live.cleanup(),
    () => source.cleanup(),
  ])
}

describe.each([
  [`BasicIndex`, BasicIndex],
  [`BTreeIndex`, BTreeIndex],
] as const)(`%s ordered live window index selection`, (name, indexType) => {
  it.each([
    `custom-first`,
    `ordinary-first`,
    `no-index`,
    `eager-custom-only`,
  ] as const)(`publishes the complete moved window with %s`, async (layout) => {
    await observeWindowMove(indexType, layout, name)
  })
})
