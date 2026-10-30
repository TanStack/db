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
 * Its direct optimized snapshot and on-demand request must use the later
 * eligible reader; registration order cannot hide a valid physical plan. An
 * eager-auto witness starts with only the reverse index and requires a new
 * ordered reader after query compilation.
 * The on-demand adapter confirms a finite request without adding rows because
 * all three are already installed. This witness does not cover provider paging
 * from an incomplete source or later source changes.
 */
import { expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import {
  createLiveQueryCollection,
  liveQueryCollectionOptions,
} from '../../src/query/live-query-collection.js'
import { PropRef } from '../../src/query/ir.js'
import { declareOracle } from '../oracle-declaration.js'
import { createOracleReach } from '../oracle-reach.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'
import type { CollectionConfig, LoadSubsetOptions } from '../../src/types.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'

type Row = { id: number; rank: number }

const rows: ReadonlyArray<Row> = [
  { id: 30, rank: 30 },
  { id: 20, rank: 20 },
  { id: 10, rank: 10 },
]

// The query's rank order comes from its declaration, not index traversal.
// The model sorts the rows by rank and keeps the first two ids of the window.
function expectedRankWindowIds(): Array<number> {
  return [...rows]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 2)
    .map((row) => row.id)
}

// Each public window must equal the model's prediction for the same rows.
function expectRankWindow(actualIds: unknown): void {
  expect(actualIds).toEqual(expectedRankWindowIds())
}

declareOracle({
  check: [expectRankWindow, expectMaterializedWindow],
  model: [expectedRankWindowIds, expectedMaterializedWindow],
  grammar: [indexConfigurations],
})

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
      expectRankWindow(direct.map((change) => change.value.id))

      live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(2),
      )
      await live.preload()
      expectRankWindow([...live.values()].map((row) => row.id))
    }, [() => live?.cleanup(), () => source.cleanup()])
  },
)

it(`uses a later eligible index after an unusable matching index`, async () => {
  const requests: Array<LoadSubsetOptions> = []
  const source = makeSource(`on-demand`, `scan`, (request) =>
    requests.push(request),
  )
  let live: ReturnType<typeof createLiveQueryCollection> | undefined
  let unusableRead: { mockRestore: () => void } | undefined
  let usableRead: { mockRestore: () => void } | undefined
  await withOracleCleanup(async () => {
    const unusable = source.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
      options: { compareFn: (a: number, b: number) => b - a },
    })
    const orderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc` as const, nulls: `first` as const },
      },
    ]
    expect(
      source.currentStateAsChanges({ orderBy, limit: 2, optimizedOnly: true }),
    ).toBeUndefined()
    const usable = source.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    unusableRead = vi.spyOn(unusable, `takeFromStart`)
    usableRead = vi.spyOn(usable, `takeFromStart`)

    // A direct optimized snapshot has the same eligibility law as the live
    // query: registration order cannot hide a later usable reader.
    const direct = source.currentStateAsChanges({
      orderBy,
      limit: 2,
      optimizedOnly: true,
    })
    expectRankWindow(direct?.map((change) => change.value.id))

    live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(2),
    )
    await live.preload()

    expectRankWindow([...live.values()].map((row) => row.id))
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

it(`eager indexing creates an ordered reader when only a custom reader exists`, async () => {
  const source = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `custom-index-order-selection-eager-auto`,
      getKey: (row) => row.id,
      initialData: [...rows],
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
    }),
  )
  let live: ReturnType<typeof createLiveQueryCollection> | undefined
  await withOracleCleanup(async () => {
    await source.stateWhenReady()
    source.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
      options: { compareFn: (a: number, b: number) => b - a },
    })
    live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(2),
    )
    await live.preload()
    expectRankWindow([...live.values()].map((row) => row.id))
    expect(
      [...source.indexes.values()].filter(
        (index) =>
          index.matchesField([`rank`]) && index.supportsOrderOptimization,
      ),
    ).toHaveLength(1)
    const direct = source.currentStateAsChanges({
      orderBy: [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ],
      limit: 2,
      optimizedOnly: true,
    })
    expectRankWindow(direct?.map((change) => change.value.id))
  }, [() => live?.cleanup(), () => source.cleanup()])
})

/**
 * Explicit indexing settings belong to the output live-query Collection.
 * This extends the Collection indexing contract to the two convenience APIs
 * (maintainer decision for https://github.com/TanStack/db/issues/2292).
 * Omission keeps indexing off; eager needs a constructor; a constructor alone
 * permits manual indexes without enabling automatic creation.
 *
 * The finite grammar exhausts mode × constructor × construction path. These
 * axes distinguish dropped settings, unwanted defaults, and a single-path fix.
 * Eager without a constructor is deliberately an admission-rejection case.
 * The source uses eager BasicIndex so accidental inheritance is observable.
 * After preload and a source update, downstream consumers read two projected
 * fields with both null placements, then repeat a read to check index reuse.
 * This does not measure elapsed time, incomplete providers, or arbitrary
 * comparators; the existing selection witnesses above cover reader admission.
 */
type MaterializedRow = { id: number; rank: number | null; score: number | null }
type IndexSettings = Pick<
  CollectionConfig<MaterializedRow>,
  `autoIndex` | `defaultIndexType`
>

function indexConfigurations(): Array<
  IndexSettings & { path: `direct` | `options` }
> {
  return ([undefined, `off`, `eager`] as const).flatMap((autoIndex) =>
    [undefined, BasicIndex, BTreeIndex].flatMap((defaultIndexType) =>
      ([`direct`, `options`] as const).map((path) => ({
        autoIndex,
        defaultIndexType,
        path,
      })),
    ),
  )
}

// Full recomputation uses only the projected values and the declared null
// placement. Distinct non-null values avoid an unrelated tie-order promise.
function expectedMaterializedWindow(
  values: ReadonlyArray<MaterializedRow>,
  field: `rank` | `score`,
  nulls: `first` | `last`,
) {
  return [...values]
    .sort((a, b) => {
      const left = a[field]
      const right = b[field]
      if (left === right) return 0
      if (left === null) return nulls === `first` ? -1 : 1
      if (right === null) return nulls === `first` ? 1 : -1
      return left - right
    })
    .slice(0, 2)
    .map(({ id }) => id)
}

function expectMaterializedWindow(
  actual: unknown,
  values: ReadonlyArray<MaterializedRow>,
  field: `rank` | `score`,
  nulls: `first` | `last`,
) {
  expect(actual).toEqual(expectedMaterializedWindow(values, field, nulls))
}

it.each(indexConfigurations())(
  `applies output indexing: $path, mode=$autoIndex, constructor=$defaultIndexType.name`,
  async (settings) => {
    const reach = createOracleReach(
      `live-query.output-indexing.${settings.path}`,
      [`configured`],
    )
    reach.beginHistory()
    const sourceRows: Array<MaterializedRow> = [
      { id: 1, rank: 30, score: 10 },
      { id: 2, rank: null, score: 30 },
      { id: 3, rank: 10, score: null },
    ]
    const source = createCollection(
      mockSyncCollectionOptions<MaterializedRow>({
        id: `output-indexing-${settings.path}-${settings.autoIndex}-${settings.defaultIndexType?.name}`,
        getKey: (row) => row.id,
        initialData: sourceRows.map((row) => ({ ...row })),
        autoIndex: `eager`,
        defaultIndexType: BasicIndex,
      }),
    )
    const config = {
      ...settings,
      query: (q: InitialQueryBuilder) =>
        q.from({ row: source }).fn.select(({ row }) => ({
          id: row.id,
          rank: row.rank === null ? null : -row.rank,
          score: row.score,
        })),
    }
    const create = () =>
      settings.path === `direct`
        ? createLiveQueryCollection(config)
        : createCollection(liveQueryCollectionOptions(config))
    let cached: ReturnType<typeof create> | undefined
    await withOracleCleanup(async () => {
      await source.preload()
      const invalid =
        settings.autoIndex === `eager` && !settings.defaultIndexType
      if (invalid) {
        expect(() => {
          cached = create()
        }).toThrow(/requires defaultIndexType/)
      } else {
        cached = create()
        await cached.preload()
        expect(cached.config.autoIndex).toBe(settings.autoIndex ?? `off`)
        expect(cached.config.defaultIndexType).toBe(settings.defaultIndexType)
        for (const updated of [false, true]) {
          if (updated) {
            sourceRows[0] = { id: 1, rank: 5, score: 5 }
            source.utils.begin()
            source.utils.write({ type: `update`, value: { ...sourceRows[0] } })
            source.utils.commit()
          }
          const values = sourceRows.map((row) => ({
            ...row,
            rank: row.rank === null ? null : -row.rank,
          }))
          for (const [field, nulls] of [
            [`rank`, `first`],
            [`rank`, `last`],
            [`score`, `first`],
            [`score`, `last`],
            [`rank`, `first`],
          ] as const) {
            const page = createLiveQueryCollection((q) =>
              q
                .from({ row: cached! })
                .orderBy(({ row }) => row[field], {
                  direction: `asc`,
                  nulls,
                })
                .limit(2),
            )
            await withOracleCleanup(async () => {
              await page.preload()
              expectMaterializedWindow(
                page.toArray.map((row) => row.id),
                values,
                field,
                nulls,
              )
              const optimized = cached!.currentStateAsChanges({
                orderBy: [
                  {
                    expression: new PropRef([field]),
                    compareOptions: { direction: `asc`, nulls },
                  },
                ],
                limit: 2,
                optimizedOnly: true,
              })
              if (settings.autoIndex === `eager`) {
                expectMaterializedWindow(
                  optimized?.map((change) => change.value.id),
                  values,
                  field,
                  nulls,
                )
              } else {
                expect(optimized).toBeUndefined()
              }
            }, [() => page.cleanup()])
          }
        }
        const eager = settings.autoIndex === `eager`
        expect(cached.indexes.size).toBe(eager ? 4 : 0)
        // A constructor alone must remain useful for an explicit manual index.
        if (!eager && settings.defaultIndexType) {
          const index = cached.createIndex((row) => row.rank)
          expect(index).toBeInstanceOf(settings.defaultIndexType)
        }
        for (const index of cached.indexes.values()) {
          expect(index).toBeInstanceOf(settings.defaultIndexType!)
        }
      }
      expect(source.config.autoIndex).toBe(`eager`)
      expect(source.config.defaultIndexType).toBe(BasicIndex)
      expect(source.indexes.size).toBe(0)
      reach.reach(`configured`)
    }, [() => cached?.cleanup(), () => source.cleanup()])
    reach.assertReached()
  },
)
