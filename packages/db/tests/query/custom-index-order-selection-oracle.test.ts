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
import { expect, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import {
  createLiveQueryCollection,
  liveQueryCollectionOptions,
} from '../../src/query/live-query-collection.js'
import { PropRef } from '../../src/query/ir.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'
import {
  expectIndexingAdmission,
  expectIndexingConfiguration,
  expectedIndexing,
} from '../conformance/indexing-config-oracle.js'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import {
  configurations,
  expectMaterializedIndexes,
  expectMaterializedWindow,
  expectedMaterializedIndexes,
  orderedReads,
} from './custom-index-order-selection-model-oracle.js'
import type { MaterializedRow } from './custom-index-order-selection-model-oracle.js'
import type { LoadSubsetOptions } from '../../src/types.js'
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
  oracleAssertion(`expectRankWindow comparison 1`, () =>
    expect(actualIds).toEqual(expectedRankWindowIds()),
  )
}

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

const rankWindowCells = ([`eager`, `on-demand`] as const).flatMap((mode) =>
  ([`scan`, `reverse manual index`] as const).map((path) => ({ mode, path })),
)

// The production driver of one rank-window cell: a direct ordered snapshot
// and a live query, each compared with `expectedRankWindowIds`.
async function runRankWindowCell({
  mode,
  path,
}: (typeof rankWindowCells)[number]): Promise<void> {
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
}

// A named history: an unusable matching index registered before a usable one.
async function runLaterEligibleIndexHistory(): Promise<void> {
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
}

// A named history: eager indexing beside a custom-order reader.
async function runEagerOrderedReaderHistory(): Promise<void> {
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
}

// Reader selection: a bounded public window follows the query's declared
// rank order, whatever index traversal a source offers.
const rankWindowLaw = {
  statement: `A bounded ordered read returns the query's declared rank order, whatever custom-order or later-registered indexes the source holds.`,
  authority: `The orderBy/limit contract in docs/guides/live-queries.md; an index is a physical route, not a result contract.`,
}
oracleProperty({
  id: `custom-index-order.rank-window`,
  law: {
    ...rankWindowLaw,
    limits: `Eager and on-demand sources, each scanned or read through a reverse manual index.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexes/basic-index.ts',
    'src/indexes/btree-index.ts',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
    'src/query/live-query-collection.ts#liveQueryCollectionOptions',
  ],
  histories: rankWindowCells,
  label: ({ mode, path }) =>
    `keeps bounded public rank order with ${mode} ${path}`,
  resolve: (cell) => ({ cell }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`custom index order selection`, plan, observe, () =>
      runRankWindowCell(plan.cell),
    ),
  check: forwardAssertionJudgment,
})
oracleProperty({
  id: `custom-index-order.later-eligible`,
  law: {
    ...rankWindowLaw,
    limits: `One on-demand history with an unusable matching index registered before a usable one.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexes/basic-index.ts',
    'src/indexes/btree-index.ts',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
    'src/query/live-query-collection.ts#liveQueryCollectionOptions',
  ],
  histories: [`uses a later eligible index after an unusable matching index`],
  label: (name) => name,
  resolve: (name) => ({ name }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`custom index order selection`, plan, observe, () =>
      runLaterEligibleIndexHistory(),
    ),
  check: forwardAssertionJudgment,
})
oracleProperty({
  id: `custom-index-order.eager-reader`,
  law: {
    ...rankWindowLaw,
    limits: `One eager-indexing history whose only rank index has a custom order.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexes/basic-index.ts',
    'src/indexes/btree-index.ts',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
    'src/query/live-query-collection.ts#liveQueryCollectionOptions',
  ],
  histories: [
    `eager indexing creates an ordered reader when only a custom reader exists`,
  ],
  label: (name) => name,
  resolve: (name) => ({ name }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`custom index order selection`, plan, observe, () =>
      runEagerOrderedReaderHistory(),
    ),
  check: forwardAssertionJudgment,
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
async function runMaterializedIndexHistory(
  settings: (typeof configurations)[number],
  reached: (state: string) => void,
): Promise<void> {
  const expected = expectedIndexing(settings)
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
    const initialSourceIndexes = source.indexes.size
    const admission: { rejected: boolean; error?: unknown } = {
      rejected: false,
    }
    try {
      cached = create()
    } catch (error) {
      admission.rejected = true
      admission.error = error
    }
    oracleAssertion(`output indexing admission`, () =>
      expectIndexingAdmission(admission, settings),
    )
    if (expected.rejects) {
      reached(`rejected`)
    } else {
      await cached!.preload()
      oracleAssertion(`output indexing configuration`, () =>
        expectIndexingConfiguration(cached!, settings),
      )
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
        for (const [field, nulls] of orderedReads) {
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
            expectMaterializedWindow(
              optimized?.map((change) => change.value.id),
              values,
              field,
              nulls,
              expectedMaterializedIndexes(settings).optimized,
            )
            reached(`output-read`)
          }, [() => page.cleanup()])
        }
      }
      expectMaterializedIndexes(cached!.indexes.size, settings)
      // A constructor alone must remain useful for an explicit manual index.
      if (!expected.automaticIndexes && settings.defaultIndexType) {
        const index = cached!.createIndex((row) => row.rank)
        oracleAssertion(`runMaterializedIndexHistory comparison 4`, () =>
          expect(index).toBeInstanceOf(settings.defaultIndexType),
        )
      }
      for (const index of cached!.indexes.values()) {
        oracleAssertion(`runMaterializedIndexHistory comparison 5`, () =>
          expect(index).toBeInstanceOf(settings.defaultIndexType!),
        )
      }
    }
    oracleAssertion(`runMaterializedIndexHistory comparison 6`, () =>
      expect(source.config.autoIndex).toBe(`eager`),
    )
    oracleAssertion(`runMaterializedIndexHistory comparison 7`, () =>
      expect(source.config.defaultIndexType).toBe(BasicIndex),
    )
    oracleAssertion(`runMaterializedIndexHistory comparison 8`, () =>
      expect(source.indexes.size).toBe(initialSourceIndexes),
    )
  }, [() => cached?.cleanup(), () => source.cleanup()])
}

// Constructor identities stay in the resolved production plan. Enumerated
// histories name the exact position in the existing mode/constructor/path
// grammar, preserving its order and all eighteen combinations as plain data.
// The grammar, model, and comparisons live in
// custom-index-order-selection-model-oracle.ts; their checker calibration is
// in custom-index-order-selection-model.test.ts.
oracleProperty({
  id: `live-query.output-indexing`,
  law: {
    statement: `Explicit output indexing settings govern admission, optimized ordering, index construction and reuse without changing source settings.`,
    authority: `The Collection indexing contract and the maintainer decision for issue 2292 stated above.`,
    limits: `The unchanged eighteen finite mode/constructor/construction combinations, projected rank/score reads and one source update.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexes/basic-index.ts',
    'src/indexes/btree-index.ts',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
    'src/query/live-query-collection.ts#liveQueryCollectionOptions',
  ],
  histories: configurations.map((_settings, configuration) => ({
    configuration,
  })),
  label: ({ configuration }) => {
    const settings = configurations[configuration]!
    return `${settings.path}/${settings.autoIndex ?? `default`}/${settings.defaultIndexType?.name ?? `none`}`
  },
  resolve: ({ configuration }) => ({
    settings: configurations[configuration]!,
  }),
  model: recordedAssertionJudgment,
  driver: (plan: { settings: (typeof configurations)[number] }, observe) =>
    recordAssertionJudgment(
      `output live-query indexing`,
      plan,
      observe,
      async () => {
        const reached = new Set<string>()
        await runMaterializedIndexHistory(plan.settings, (state) =>
          reached.add(state),
        )
        const state = expectedIndexing(plan.settings).rejects
          ? `rejected`
          : `output-read`
        oracleAssertion(`output indexing reached ${state}`, () =>
          expect(reached.has(state)).toBe(true),
        )
      },
    ),
  check: forwardAssertionJudgment,
})
