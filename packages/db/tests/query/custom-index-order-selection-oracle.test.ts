/**
 * An index may choose how to store rows, but it cannot change a query's
 * declared order. For a bounded `orderBy(rank)` query, the public window is
 * the ascending ranks from the source rows, regardless of a manual index's
 * callback. The live-query guide defines `orderBy` and `limit`; the live-query
 * architecture treats index selection as physical planning.
 *
 * The Collection API also exposes an ordered, limited direct snapshot through
 * `currentStateAsChanges`. The model sorts a plain array by numeric rank and
 * slices it. Its two distinct ranks avoid any promise about callback ordering
 * within an equality class. The legal history starts one ready, eager source,
 * then reads a direct snapshot and compiles one limited live query. A scan and
 * a source with a reverse-order BTree index exercise both public paths. The
 * exact public row IDs must equal the model at the direct-read and post-preload
 * checkpoints. The reverse index is the hostile planner control: taking its
 * first entry as the first query row would expose rank 30 instead of rank 10.
 * This witness does not cover on-demand acquisition or later source changes.
 */
import { expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { PropRef } from '../../src/query/ir.js'
import { mockSyncCollectionOptions } from '../utils.js'

type Row = { id: number; rank: number }

const rows: ReadonlyArray<Row> = [
  { id: 30, rank: 30 },
  { id: 10, rank: 10 },
]

// The query's rank order comes from its declaration, not index traversal.
const expectedIds = [...rows]
  .sort((a, b) => a.rank - b.rank)
  .slice(0, 1)
  .map((row) => row.id)

it.each([`scan`, `reverse manual index`] as const)(
  `keeps bounded public rank order with %s`,
  async (path) => {
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `custom-index-order-selection-${path}`,
        getKey: (row) => row.id,
        initialData: [...rows],
        autoIndex: `off`,
      }),
    )
    let live: ReturnType<typeof createLiveQueryCollection> | undefined
    try {
      await source.stateWhenReady()
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
        limit: 1,
      })!
      expect(direct.map((change) => change.value.id)).toEqual(expectedIds)

      live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(1),
      )
      await live.preload()
      expect([...live.values()].map((row) => row.id)).toEqual(expectedIds)
    } finally {
      await live?.cleanup()
      await source.cleanup()
    }
  },
)
