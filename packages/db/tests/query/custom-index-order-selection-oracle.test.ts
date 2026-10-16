/**
 * An index may choose how to store rows, but it cannot change a query's
 * declared order. For a bounded `orderBy(rank)` query, the public window is
 * the ascending ranks from the source rows, regardless of a manual index's
 * callback. The live-query guide defines `orderBy` and `limit`; the live-query
 * architecture treats index selection as physical planning.
 *
 * The Collection API also exposes an ordered, limited direct snapshot through
 * `currentStateAsChanges`. The model sorts a plain array by numeric rank and
 * slices it. Its three distinct ranks avoid any promise about callback ordering
 * within an equality class. The legal history starts one ready source, then
 * reads a direct snapshot and compiles one limited live query. Eager and
 * prepopulated on-demand sources each run with a scan and a reverse-order
 * BTree index. Three distinct ranks and a two-row window can expose a reversed
 * prefix whose membership and order differ from the query's prefix. The public row
 * IDs must equal the model at the direct-read and post-preload checkpoints.
 * Taking the reverse index's first two entries as the query window would
 * expose ranks 30 and 20 instead of 10 and 20. The oracle checks the public
 * result and allows any physical plan that produces it.
 * A second witness registers an unusable reverse index before a usable index.
 * Its on-demand request must retain the bounded order so registration order
 * cannot hide a later eligible physical plan.
 * The on-demand adapter confirms a finite request without adding rows because
 * all three are already installed. This witness does not cover provider paging
 * from an incomplete source or later source changes.
 */
import { expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { PropRef } from '../../src/query/ir.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'
import type { LoadSubsetOptions } from '../../src/types.js'

type Row = { id: number; rank: number }

const rows: ReadonlyArray<Row> = [
  { id: 30, rank: 30 },
  { id: 20, rank: 20 },
  { id: 10, rank: 10 },
]

// The query's rank order comes from its declaration, not index traversal.
const expectedIds = [...rows]
  .sort((a, b) => a.rank - b.rank)
  .slice(0, 2)
  .map((row) => row.id)

function makeSource(
  mode: `eager` | `on-demand`,
  path: `scan` | `reverse manual index`,
  onLoadSubset?: (options: LoadSubsetOptions) => void,
) {
  const id = `custom-index-order-selection-${mode}-${path}`
  if (mode === `eager`) {
    return createCollection(
      mockSyncCollectionOptions<Row>({
        id,
        getKey: (row) => row.id,
        initialData: [...rows],
        autoIndex: `off`,
      }),
    )
  }
  return createCollection<Row>({
    id,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `off`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of rows) write({ type: `insert`, value: row })
        commit()
        markReady()
        return {
          loadSubset: (options) => {
            onLoadSubset?.(options)
            return true
          },
          unloadSubset: () => {},
        }
      },
    },
  })
}

it.each(
  ([`eager`, `on-demand`] as const).flatMap((mode) =>
    ([`scan`, `reverse manual index`] as const).map((path) => ({ mode, path })),
  ),
)(
  `keeps bounded public rank order with $mode $path`,
  async ({ mode, path }) => {
    const source = makeSource(mode, path)
    let live: ReturnType<typeof createLiveQueryCollection> | undefined
    await withOracleCleanup(async () => {
      if (mode === `eager`) await source.stateWhenReady()
      else expect(source.isReady()).toBe(true)
      if (path === `reverse manual index`) {
        source.createIndex((row) => row.rank, {
          indexType: BTreeIndex,
          options: { compareFn: (a: number, b: number) => b - a },
        })
      }

      const direct = source.currentStateAsChanges({
        orderBy: [
          {
            expression: new PropRef([`rank`]),
            compareOptions: { direction: `asc`, nulls: `first` },
          },
        ],
        limit: 2,
      })!
      expect(direct.map((change) => change.value.id)).toEqual(expectedIds)

      live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(2),
      )
      await live.preload()
      expect([...live.values()].map((row) => row.id)).toEqual(expectedIds)
    }, [() => live?.cleanup(), () => source.cleanup()])
  },
)

it(`uses a later eligible index after an unusable matching index`, async () => {
  const requests: Array<LoadSubsetOptions> = []
  const source = makeSource(`on-demand`, `scan`, (request) =>
    requests.push(request),
  )
  let live: ReturnType<typeof createLiveQueryCollection> | undefined
  let unusableRead: ReturnType<typeof vi.spyOn> | undefined
  let usableRead: ReturnType<typeof vi.spyOn> | undefined
  await withOracleCleanup(async () => {
    const unusable = source.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
      options: { compareFn: (a: number, b: number) => b - a },
    })
    const usable = source.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    unusableRead = vi.spyOn(unusable, `takeFromStart`)
    usableRead = vi.spyOn(usable, `takeFromStart`)

    live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(2),
    )
    await live.preload()

    expect([...live.values()].map((row) => row.id)).toEqual(expectedIds)
    expect(
      requests.some((request) => request.orderBy && request.limit === 2),
    ).toBe(true)
    expect(
      requests.some(
        (request) =>
          request.where === undefined &&
          request.orderBy === undefined &&
          request.limit === undefined,
      ),
    ).toBe(false)
    expect(usableRead).toHaveBeenCalled()
    expect(unusableRead).not.toHaveBeenCalled()
  }, [
    () => usableRead?.mockRestore(),
    () => unusableRead?.mockRestore(),
    () => live?.cleanup(),
    () => source.cleanup(),
  ])
})
