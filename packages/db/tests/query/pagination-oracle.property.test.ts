import { fc } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { BTreeIndex } from '../../src/index.js'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq } from '../../src/query/builder/functions.js'
import { PropRef } from '../../src/query/ir.js'
import { makeComparator } from '../../src/utils/comparison.js'
import { oracleProperty } from '../oracle-config.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { TraceAssertionError } from '../trace-runner.js'
import { flushPromises, mockSyncCollectionOptions } from '../utils.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import {
  compareAt,
  observeComparison,
  recordedComparison,
  rejectAt,
} from './ordered-comparison-oracle.js'
import { cleanupAll } from './pagination-support.js'
import {
  compareCustomCollationStrings,
  createConformingOrderedSource,
  customCollationProviderRows,
  projectPageRow,
  rowsForLoadSubset,
} from './pagination-fixtures.js'
import {
  classifyWhereOnlyRepairRequest,
  eagerNaNWindowCases,
  expectFilteredBoundedRepairTrace,
  expectPredicateBehavior,
  expectWindowRows,
  expectedOrderSignature,
  filterUpdateCases,
  filterUpdateScenario,
  orderSignature,
  referenceWindow,
  referenceWindowRows,
  visibleRows,
} from './pagination-model-oracle.js'
import { registerLimitAdmissionOracle } from './limit-admission-oracle.js'
import type { PageRow } from './pagination-support.js'
import type {
  CustomCollationRow,
  MultiOrderRow,
  PendingCursorLoad,
  PublicPageRow,
} from './pagination-fixtures.js'
import type {
  PaginationAction,
  PaginationStateScenario,
  PaginationWindow,
  PendingMutation,
  PendingMutationResult,
  PendingMutationScenario,
} from './pagination-model-oracle.js'
import type { Observation } from '../oracle-property.js'
import type {
  ChangeMessage,
  LoadSubsetOptions,
  SyncConfig,
} from '../../src/types.js'

/**
 * # Does an ordered window equal independent recomputation?
 *
 * A page is not whatever rows the loader happened to retain. It is the result
 * of filtering the authoritative finite source, sorting with the declared
 * terms and public-key tie-breaker, then slicing by offset and limit. Window
 * changes, source inserts, updates, deletes, ties, nulls, NaN, locale order, and
 * failed requests must all preserve that definition.
 *
 * Authority: `query/live/ARCHITECTURE.md`, especially Ordered loading and
 * Atomic window publication, defines the value, acquisition, repair, and
 * publication laws. `docs/guides/live-queries.md` gives NaN the PostgreSQL
 * float order: NaN equals itself and follows finite values in ascending order.
 * This oracle establishes those laws only for the bounded
 * row/history grammar below and the in-memory on-demand adapter seam. It does
 * not establish a backend's physical query plan, latency, complete SQL
 * predicate semantics, or behavior outside the generated and named domains.
 *
 * Plain arrays and standalone comparisons form the value oracle. One
 * reference-object fixture primes `makeComparator`'s runtime-local order; it
 * checks local refinement after that order is fixed, not comparator semantics.
 * Separate state nodes track requested windows, authoritative coverage,
 * pending acquisition, and public batches. The production drivers cross scan
 * and indexed routes, direct and joined queries, delivery timing, reentry,
 * restart, rejection, and abort. They compare exact request options,
 * acquisition releases, visible rows, readiness, errors, and every
 * publication cut.
 *
 * Finite products cover boundary cells; fixed and random fast-check histories
 * explore adjacent legal actions. Fault probes establish that wrong order,
 * false coverage, duplicate work, partial publication, and bad delete payloads
 * are observable. The model does not infer rows beyond provider evidence.
 *
 * The fixed C-01 through C-09 custom-collation histories declare an independent
 * rank relation and literal public-key sequences. It crosses ascending and
 * descending order, scan and auto-index execution, inherited and per-order
 * configuration, bounded and unbounded queries, a later ordered source that
 * inherits the leading source's default, an output Collection with a different
 * downstream default, comparator-equal keys, and hostile provider order. It
 * also requires exactly one initial filtered full-source acquisition. These
 * histories establish local custom ordering only; it does not authorize custom
 * cursor pagination, comparator-aware range predicates, or backend collation
 * parity.
 */

type PublicPageChange = {
  type: `insert` | `update` | `delete`
  key: number
  value: PublicPageRow
  previousValue?: PublicPageRow
}

type MultiOrderTerm = {
  direction: `asc` | `desc`
  nulls: `first` | `last`
}

type MultiOrderScenario = {
  rows: ReadonlyArray<MultiOrderRow>
  primary: MultiOrderTerm
  secondary: MultiOrderTerm
  limit: number
}

type NullableCursorRow = {
  id: number
  rank: number | null
}

type AdversarialOrderedRow = {
  id: number
  rank: number | null | object
  label: string
}

type NullableCursorScenario = {
  rank: number
  direction: `asc` | `desc`
}

type PaginationScenario = {
  ranks: ReadonlyArray<number>
  keeps?: ReadonlyArray<boolean>
  direction: `asc` | `desc`
  windows: ReadonlyArray<PaginationWindow>
  explicitPublicKeyOrder?: boolean
  includeFilter?: boolean
  reverseInsertion?: boolean
  reverseProviderTies?: boolean
  localRowsBeforeFirstRequest?: ReadonlyArray<PageRow>
}

type PaginationStructure = Pick<
  PaginationScenario,
  `explicitPublicKeyOrder` | `includeFilter` | `reverseInsertion`
>
function expectPendingMutationRequestWork(
  result: PendingMutationResult,
  scenario: PendingMutationScenario,
  explicitPublicKeyOrder = true,
) {
  compareAt(`pagination-oracle.property.test.ts:247`, () =>
    expect(result.mutationRepairRequests.length).toBeLessThanOrEqual(
      (scenario.ranks.length + 1) * 8,
    ),
  )
  for (const request of result.mutationRepairRequests) {
    if (request.orderBy) {
      compareAt(`pagination-oracle.property.test.ts:252`, () =>
        expect(orderSignature(request)).toStrictEqual(
          expectedOrderSignature(scenario.direction, explicitPublicKeyOrder),
        ),
      )
      compareAt(`pagination-oracle.property.test.ts:255`, () =>
        expect(request.limit).toBeDefined(),
      )
      if (!request.cursor)
        compareAt(`pagination-oracle.property.test.ts:256`, () =>
          expect([undefined, 0]).toContain(request.offset),
        )
    } else if (request.where) {
      compareAt(`pagination-oracle.property.test.ts:258`, () =>
        expect(request.limit).toBeUndefined(),
      )
      compareAt(`pagination-oracle.property.test.ts:259`, () =>
        expect(request.cursor).toBeUndefined(),
      )
      compareAt(`pagination-oracle.property.test.ts:260`, () =>
        expect(request.offset).toBeUndefined(),
      )
      const kind = classifyWhereOnlyRepairRequest(request, scenario)
      if (kind === `filtered-full-source`) {
        expectPredicateBehavior(
          request.where,
          [
            { id: 101, rank: -1_000_000, keep: true },
            { id: 102, rank: 1_000_000, keep: true },
          ],
          [
            { id: 101, rank: -1_000_000, keep: false },
            { id: 102, rank: 1_000_000, keep: false },
          ],
        )
      } else if (scenario.includeFilter) {
        expectPredicateBehavior(
          request.where,
          [],
          [
            { id: 101, rank: -1_000_000, keep: false },
            { id: 102, rank: 1_000_000, keep: false },
          ],
        )
      }
    } else {
      compareAt(`pagination-oracle.property.test.ts:285`, () =>
        expect(request.orderBy).toBeUndefined(),
      )
      compareAt(`pagination-oracle.property.test.ts:286`, () =>
        expect(request.where).toBeUndefined(),
      )
      compareAt(`pagination-oracle.property.test.ts:287`, () =>
        expect(request.limit).toBeUndefined(),
      )
      compareAt(`pagination-oracle.property.test.ts:288`, () =>
        expect(request.cursor).toBeUndefined(),
      )
      compareAt(`pagination-oracle.property.test.ts:289`, () =>
        expect(request.offset).toBeUndefined(),
      )
    }
  }
}

class DeliveredRowsTraceAssertionError extends TraceAssertionError {
  constructor(
    cause: unknown,
    readonly deliveredRows: ReadonlyArray<PageRow>,
  ) {
    super(0, cause)
    if (cause instanceof Error) {
      this.message += `: ${cause.message}; delivered=${JSON.stringify(deliveredRows)}`
    }
  }
}

class PendingMutationTraceAssertionError extends DeliveredRowsTraceAssertionError {}

class PendingHistoryTraceAssertionError extends DeliveredRowsTraceAssertionError {}

type PendingHistoryScenario = {
  ranks: ReadonlyArray<number>
  direction: `asc` | `desc`
  initialLimit: number
  narrowLimit: number
  wideLimit: number
  firstRank: number
  secondRank: number
}

const initialRowsArbitrary = fc.array(
  fc.record({
    rank: fc.integer({ min: -2, max: 2 }),
    keep: fc.boolean(),
  }),
  {
    minLength: 1,
    maxLength: 12,
  },
)

const scenarioPayloadArbitrary: fc.Arbitrary<PaginationScenario> = fc
  .record({
    rows: initialRowsArbitrary,
    direction: fc.constantFrom(`asc` as const, `desc` as const),
    reverseProviderTies: fc.boolean(),
    windows: fc.array(
      fc.record({
        offset: fc.integer({ min: 0, max: 12 }),
        limit: fc.integer({ min: 0, max: 8 }),
      }),
      { minLength: 1, maxLength: 12 },
    ),
  })
  .map(({ rows, ...scenario }) => ({
    ...scenario,
    ranks: rows.map(({ rank }) => rank),
    keeps: rows.map(({ keep }) => keep),
  }))

const paginationStructures: ReadonlyArray<PaginationStructure> = [
  ...[false, true].flatMap((explicitPublicKeyOrder) =>
    [false, true].flatMap((includeFilter) =>
      [false, true].map((reverseInsertion) => ({
        explicitPublicKeyOrder,
        includeFilter,
        reverseInsertion,
      })),
    ),
  ),
]

const paginationStructureArbitrary: fc.Arbitrary<PaginationStructure> =
  fc.record({
    explicitPublicKeyOrder: fc.boolean(),
    includeFilter: fc.boolean(),
    reverseInsertion: fc.boolean(),
  })

const scenarioArbitrary: fc.Arbitrary<PaginationScenario> = fc
  .tuple(scenarioPayloadArbitrary, paginationStructureArbitrary)
  .map(([scenario, structure]) => ({ ...scenario, ...structure }))

const windowArbitrary: fc.Arbitrary<PaginationWindow> = fc.record({
  offset: fc.integer({ min: 0, max: 12 }),
  limit: fc.integer({ min: 0, max: 8 }),
})

const paginationActionArbitrary: fc.Arbitrary<PaginationAction> = fc.oneof(
  {
    weight: 2,
    arbitrary: windowArbitrary.map((window) => ({
      type: `window` as const,
      ...window,
    })),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      type: fc.constant(`put` as const),
      id: fc.integer({ min: 1, max: 16 }),
      rank: fc.integer({ min: -2, max: 2 }),
      keep: fc.boolean(),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      type: fc.constant(`delete` as const),
      id: fc.integer({ min: 1, max: 16 }),
    }),
  },
)

const stateScenarioPayloadArbitrary: fc.Arbitrary<PaginationStateScenario> = fc
  .record({
    rows: initialRowsArbitrary,
    direction: fc.constantFrom(`asc` as const, `desc` as const),
    initialWindow: windowArbitrary,
    actions: fc.array(paginationActionArbitrary, {
      minLength: 1,
      maxLength: 20,
    }),
  })
  .map(({ rows, ...scenario }) => ({
    ...scenario,
    ranks: rows.map(({ rank }) => rank),
    keeps: rows.map(({ keep }) => keep),
  }))

const stateScenarioArbitrary: fc.Arbitrary<PaginationStateScenario> = fc
  .tuple(stateScenarioPayloadArbitrary, paginationStructureArbitrary)
  .map(([scenario, structure]) => ({ ...scenario, ...structure }))

const pendingMutationScenarioArbitrary: fc.Arbitrary<PendingMutationScenario> =
  fc
    .record({
      ranks: fc.array(fc.integer({ min: -2, max: 2 }), {
        minLength: 3,
        maxLength: 8,
      }),
      direction: fc.constantFrom(`asc` as const, `desc` as const),
      requestedLimit: fc.integer({ min: 1, max: 8 }),
      mutationKind: fc.constantFrom(
        `insert` as const,
        `update` as const,
        `delete` as const,
      ),
      responseOutcome: fc.constantFrom(`resolve` as const, `reject` as const),
      targetIndex: fc.nat({ max: 7 }),
      rank: fc.integer({ min: -2, max: 2 }),
    })
    .map(
      ({
        ranks,
        direction,
        requestedLimit,
        mutationKind,
        responseOutcome,
        targetIndex,
        rank,
      }) => {
        const id = (targetIndex % ranks.length) + 1
        const previousRank = ranks[id - 1]!
        const changedRank =
          rank === previousRank ? (rank === 2 ? -2 : rank + 1) : rank
        const mutation: PendingMutation =
          mutationKind === `insert`
            ? { type: `insert`, row: { id: ranks.length + 1, rank } }
            : mutationKind === `update`
              ? { type: `update`, row: { id, rank: changedRank } }
              : { type: `delete`, id }
        return {
          ranks,
          direction,
          limit: Math.min(requestedLimit, ranks.length - 2),
          mutation,
          responseOutcome,
        }
      },
    )

const pendingHistoryScenarioArbitrary: fc.Arbitrary<PendingHistoryScenario> = fc
  .record({
    ranks: fc.array(fc.integer({ min: -2, max: 2 }), {
      minLength: 4,
      maxLength: 8,
    }),
    direction: fc.constantFrom(`asc` as const, `desc` as const),
    requestedInitialLimit: fc.integer({ min: 2, max: 7 }),
    requestedNarrowLimit: fc.integer({ min: 1, max: 6 }),
    requestedWideLimit: fc.integer({ min: 3, max: 8 }),
    firstRank: fc.integer({ min: -2, max: 2 }),
    secondRank: fc.integer({ min: -2, max: 2 }),
  })
  .map(
    ({
      ranks,
      direction,
      requestedInitialLimit,
      requestedNarrowLimit,
      requestedWideLimit,
      firstRank,
      secondRank,
    }) => {
      const initialLimit = Math.min(requestedInitialLimit, ranks.length - 1)
      return {
        ranks,
        direction,
        initialLimit,
        narrowLimit: Math.min(requestedNarrowLimit, initialLimit - 1),
        wideLimit: Math.max(
          initialLimit + 1,
          Math.min(requestedWideLimit, ranks.length),
        ),
        firstRank,
        secondRank,
      }
    },
  )

const responseTimingArbitrary = fc.constantFrom(
  `before-response` as const,
  `after-response` as const,
)

const nullableNumberArbitrary = fc.option(fc.integer({ min: -2, max: 2 }), {
  nil: null,
})

const multiOrderTermArbitrary: fc.Arbitrary<MultiOrderTerm> = fc.record({
  direction: fc.constantFrom(`asc` as const, `desc` as const),
  nulls: fc.constantFrom(`first` as const, `last` as const),
})

const multiOrderScenarioArbitrary: fc.Arbitrary<MultiOrderScenario> = fc
  .record({
    rows: fc.uniqueArray(
      fc.record({
        id: fc.integer({ min: 1, max: 12 }),
        primary: nullableNumberArbitrary,
        secondary: nullableNumberArbitrary,
      }),
      {
        minLength: 2,
        maxLength: 10,
        selector: ({ id }) => id,
      },
    ),
    primary: multiOrderTermArbitrary,
    secondary: multiOrderTermArbitrary,
    requestedLimit: fc.integer({ min: 1, max: 10 }),
  })
  .filter(({ rows }) =>
    rows.some(
      ({ primary, secondary }) => primary === null || secondary === null,
    ),
  )
  .map(({ rows, primary, secondary, requestedLimit }) => ({
    rows,
    primary,
    secondary,
    limit: Math.min(requestedLimit, rows.length),
  }))

const nullableCursorScenarioArbitrary: fc.Arbitrary<NullableCursorScenario> =
  fc.record({
    rank: fc.integer({ min: -2, max: 2 }),
    direction: fc.constantFrom(`asc` as const, `desc` as const),
  })

let collectionSequence = 0

function normalizePageChanges(
  changes: ReadonlyArray<ChangeMessage<PageRow, number>>,
): Array<PublicPageChange> {
  return changes
    .map((change) => ({
      type: change.type,
      key: change.key,
      value: projectPageRow(change.value),
      ...(change.previousValue !== undefined
        ? { previousValue: projectPageRow(change.previousValue) }
        : {}),
    }))
    .sort((left, right) => left.key - right.key)
}

function expectedPageChanges(
  before: ReadonlyArray<PublicPageRow>,
  after: ReadonlyArray<PublicPageRow>,
): Array<PublicPageChange> {
  const beforeById = new Map(before.map((row) => [row.id, row]))
  const afterById = new Map(after.map((row) => [row.id, row]))
  const changes: Array<PublicPageChange> = []

  for (const row of before) {
    const next = afterById.get(row.id)
    if (!next) {
      changes.push({ type: `delete`, key: row.id, value: row })
    } else if (
      next.rank !== row.rank &&
      !(Number.isNaN(next.rank) && Number.isNaN(row.rank))
    ) {
      changes.push({
        type: `update`,
        key: row.id,
        value: next,
        previousValue: row,
      })
    }
  }
  for (const row of after) {
    if (!beforeById.has(row.id)) {
      changes.push({ type: `insert`, key: row.id, value: row })
    }
  }
  return changes.sort((left, right) => left.key - right.key)
}

function isKeptRow(id: number): boolean {
  return id % 3 !== 0
}

async function runPaginationScenario(
  scenario: PaginationScenario,
): Promise<void> {
  const rows = scenario.ranks.map((rank, index) => ({
    id: index + 1,
    rank,
    keep: scenario.keeps?.[index] ?? isKeptRow(index + 1),
  }))
  const initialRows = scenario.reverseInsertion ? [...rows].reverse() : rows
  const expectedRows = visibleRows(rows, scenario.includeFilter)
  const initialWindow = scenario.windows[0]!
  const source = createCollection(
    mockSyncCollectionOptions({
      id: `pagination-oracle-source-${collectionSequence++}`,
      initialData: initialRows.map((row) => ({ ...row })),
      getKey: (row: PageRow) => row.id,
      autoIndex: `eager`,
    }),
  )
  const cleanups: Array<() => unknown> = [() => source.cleanup()]
  await withHistoryCleanup(
    async () => {
      const live = createLiveQueryCollection((query) => {
        const from = query.from({ row: source })
        const filtered = scenario.includeFilter
          ? from.where(({ row }) => eq(row.keep, true))
          : from
        const ordered = filtered.orderBy(
          ({ row }) => row.rank,
          scenario.direction,
        )
        return (
          scenario.explicitPublicKeyOrder === false
            ? ordered
            : ordered.orderBy(({ row }) => row.id, `asc`)
        )
          .offset(initialWindow.offset)
          .limit(initialWindow.limit)
          .select(({ row }) => ({ id: row.id, rank: row.rank }))
      })
      cleanups.unshift(() => live.cleanup())
      await live.preload()
      expectWindowRows(
        Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
        referenceWindowRows(expectedRows, scenario.direction, initialWindow),
      )

      for (const window of scenario.windows.slice(1)) {
        const result = live.utils.setWindow(window)
        if (result instanceof Promise) await result

        expectWindowRows(
          Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
          referenceWindowRows(expectedRows, scenario.direction, window),
        )
      }
    },
    () => cleanups,
  )
}

/**
 * The check: after every window change, the rows that a live query publishes
 * must equal the model's window over the authoritative rows. The driver runs
 * one history, and `referenceWindowRows` predicts each window from the rows.
 */
function compareNullableNumber(
  left: number | null,
  right: number | null,
  term: MultiOrderTerm,
): number {
  if (left === null || right === null) {
    if (left === right) return 0
    return left === null
      ? term.nulls === `first`
        ? -1
        : 1
      : term.nulls === `first`
        ? 1
        : -1
  }
  const compared = left === right ? 0 : left < right ? -1 : 1
  return term.direction === `asc` ? compared : -compared
}

function referenceMultiOrder(scenario: MultiOrderScenario): Array<number> {
  return [...scenario.rows]
    .sort(
      (left, right) =>
        compareNullableNumber(left.primary, right.primary, scenario.primary) ||
        compareNullableNumber(
          left.secondary,
          right.secondary,
          scenario.secondary,
        ) ||
        left.id - right.id,
    )
    .slice(0, scenario.limit)
    .map(({ id }) => id)
}

async function runMultiOrderScenario(
  scenario: MultiOrderScenario,
): Promise<void> {
  const source = createCollection(
    mockSyncCollectionOptions({
      id: `pagination-multi-order-oracle-source-${collectionSequence++}`,
      initialData: scenario.rows.map((row) => ({ ...row })),
      getKey: (row: MultiOrderRow) => row.id,
      autoIndex: `eager`,
    }),
  )
  const live = createLiveQueryCollection((query) =>
    query
      .from({ row: source })
      .orderBy(({ row }) => row.primary, scenario.primary)
      .orderBy(({ row }) => row.secondary, scenario.secondary)
      .orderBy(({ row }) => row.id, `asc`)
      .limit(scenario.limit)
      .select(({ row }) => ({ id: row.id })),
  )

  const work = async () => {
    await live.preload()
    try {
      compareAt(`pagination-oracle.property.test.ts:924`, () =>
        expect(Array.from(live.values(), ({ id }) => id)).toEqual(
          referenceMultiOrder(scenario),
        ),
      )
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  }
  await withHistoryCleanup(work, () => [
    () => live.cleanup(),
    () => source.cleanup(),
  ])
}

async function runNullableCursorScenario(
  scenario: NullableCursorScenario,
): Promise<void> {
  const rows: Array<NullableCursorRow> = [
    { id: 1, rank: null },
    { id: 2, rank: scenario.rank },
  ]
  const orderedRows = [...rows].sort(
    (left, right) =>
      compareNullableNumber(left.rank, right.rank, {
        direction: scenario.direction,
        nulls: `first`,
      }) || left.id - right.id,
  )
  const pending: Array<PendingCursorLoad> = []
  const delivered = new Set<number>()
  let begin!: () => void
  let write!: (message: { type: `insert`; value: NullableCursorRow }) => void
  let commit!: () => void
  const source = createCollection<NullableCursorRow>({
    id: `pagination-nullable-cursor-source-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const deferred = createDeferred<void>()
            pending.push({ options, deferred })
            return deferred.promise
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection((query) =>
    query
      .from({ row: source })
      .orderBy(({ row }) => row.rank, {
        direction: scenario.direction,
        nulls: `first`,
      })
      .orderBy(({ row }) => row.id, `asc`)
      .limit(1),
  )

  const work = async () => {
    const preload = live.preload()
    compareAt(`pagination-oracle.property.test.ts:992`, () =>
      expect(pending.length).toBeGreaterThan(0),
    )
    // Settling one request can append its boundary-refinement request.
    for (const request of pending) {
      begin()
      for (const row of rowsForLoadSubset(orderedRows, request.options)) {
        if (delivered.has(row.id)) continue
        delivered.add(row.id)
        write({ type: `insert`, value: { ...row } })
      }
      commit()
      request.responseStarted = true
      request.deferred.resolve()
      await flushPromises()
    }
    await preload

    try {
      compareAt(`pagination-oracle.property.test.ts:1011`, () =>
        expect(Array.from(live.values(), ({ id }) => id)).toEqual([1]),
      )
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  }
  await withHistoryCleanup(work, () => [
    () => {
      for (const request of pending) request.deferred.resolve()
    },
    () => live.cleanup(),
    () => source.cleanup(),
  ])
}

async function runPaginationStateScenario(
  scenario: PaginationStateScenario,
): Promise<void> {
  const rows = new Map<number, PageRow>(
    scenario.ranks.map((rank, index) => [
      index + 1,
      {
        id: index + 1,
        rank,
        keep: scenario.keeps?.[index] ?? isKeptRow(index + 1),
      },
    ]),
  )
  const initialRows = [...rows.values()]
  if (scenario.reverseInsertion) initialRows.reverse()
  let currentWindow = scenario.initialWindow
  const sourceOptions = mockSyncCollectionOptions({
    id: `pagination-state-oracle-source-${collectionSequence++}`,
    initialData: initialRows.map((row) => ({ ...row })),
    getKey: (row: PageRow) => row.id,
    autoIndex: `eager` as const,
  })
  const source = createCollection(sourceOptions)
  const cleanups: Array<() => unknown> = [() => source.cleanup()]
  await withHistoryCleanup(
    async () => {
      const live = createLiveQueryCollection((query) => {
        const from = query.from({ row: source })
        const filtered = scenario.includeFilter
          ? from.where(({ row }) => eq(row.keep, true))
          : from
        const ordered = filtered.orderBy(
          ({ row }) => row.rank,
          scenario.direction,
        )
        return (
          scenario.explicitPublicKeyOrder === false
            ? ordered
            : ordered.orderBy(({ row }) => row.id, `asc`)
        )
          .offset(currentWindow.offset)
          .limit(currentWindow.limit)
          .select(({ row }) => ({ id: row.id, rank: row.rank }))
      })
      cleanups.unshift(() => live.cleanup())
      const publications: Array<{
        changes: Array<PublicPageChange>
        rows: Array<PublicPageRow>
      }> = []
      let publicationSubscription:
        ReturnType<typeof live.subscribeChanges> | undefined

      const readCurrentWindow = () =>
        Array.from(live.values(), ({ id, rank }) => ({ id, rank }))

      const expectCurrentWindow = (checkpoint: number) => {
        try {
          compareAt(`pagination-oracle.property.test.ts:1082`, () =>
            expect(readCurrentWindow()).toEqual(
              referenceWindowRows(
                visibleRows([...rows.values()], scenario.includeFilter),
                scenario.direction,
                currentWindow,
              ),
            ),
          )
        } catch (error) {
          throw new TraceAssertionError(checkpoint, error)
        }
      }

      try {
        await live.preload()
        expectCurrentWindow(0)
        compareAt(`pagination-oracle.property.test.ts:1097`, () =>
          expect(live.status).toBe(`ready`),
        )
        compareAt(`pagination-oracle.property.test.ts:1098`, () =>
          expect(live.utils.lastSubsetError).toBeUndefined(),
        )
        publicationSubscription = live.subscribeChanges(
          (changes) =>
            publications.push({
              changes: normalizePageChanges(
                changes as Array<ChangeMessage<PageRow, number>>,
              ),
              rows: readCurrentWindow(),
            }),
          { includeInitialState: false },
        )

        for (const [index, action] of scenario.actions.entries()) {
          const beforeRows = readCurrentWindow()
          const publicationCount = publications.length
          if (action.type === `window`) {
            currentWindow = { offset: action.offset, limit: action.limit }
            const result = live.utils.setWindow(currentWindow)
            if (result instanceof Promise) await result
          } else if (action.type === `put`) {
            const row = {
              id: action.id,
              rank: action.rank,
              keep: action.keep ?? isKeptRow(action.id),
            }
            const type = rows.has(action.id) ? `update` : `insert`
            rows.set(action.id, row)
            sourceOptions.utils.begin()
            sourceOptions.utils.write({ type, value: { ...row } })
            sourceOptions.utils.commit()
          } else {
            const row = rows.get(action.id)
            if (row) {
              rows.delete(action.id)
              sourceOptions.utils.begin()
              sourceOptions.utils.write({ type: `delete`, value: { ...row } })
              sourceOptions.utils.commit()
            }
          }
          expectCurrentWindow(index + 1)
          compareAt(`pagination-oracle.property.test.ts:1138`, () =>
            expect(live.status).toBe(`ready`),
          )
          compareAt(`pagination-oracle.property.test.ts:1139`, () =>
            expect(live.utils.lastSubsetError).toBeUndefined(),
          )
          const afterRows = readCurrentWindow()
          const expectedChanges = expectedPageChanges(beforeRows, afterRows)
          compareAt(`pagination-oracle.property.test.ts:1142`, () =>
            expect(publications.slice(publicationCount)).toEqual(
              expectedChanges.length > 0
                ? [{ changes: expectedChanges, rows: afterRows }]
                : [],
            ),
          )
        }
      } finally {
        publicationSubscription?.unsubscribe()
      }
    },
    () => cleanups,
  )
}

async function runOnDemandPaginationScenario(
  scenario: PaginationScenario,
  assertLoads?: (loads: ReadonlyArray<LoadSubsetOptions>) => void,
): Promise<void> {
  const authoritativeRows = scenario.ranks.map((rank, index) => ({
    id: index + 1,
    rank,
    keep: scenario.keeps?.[index] ?? isKeptRow(index + 1),
  }))
  const expectedRows = visibleRows(authoritativeRows, scenario.includeFilter)
  const directionFactor = scenario.direction === `asc` ? 1 : -1
  const orderedRows = [...authoritativeRows].sort(
    (left, right) =>
      (left.rank - right.rank) * directionFactor ||
      (left.id - right.id) *
        (scenario.explicitPublicKeyOrder === false &&
        scenario.reverseProviderTies
          ? -1
          : 1),
  )
  const deliveredIds = new Set<number>()
  const loads: Array<LoadSubsetOptions> = []
  const initialWindow = scenario.windows[0]!
  let begin!: () => void
  let write!: (message: { type: `insert`; value: PageRow }) => void
  let commit!: () => void

  const source = createCollection<PageRow>({
    id: `pagination-on-demand-oracle-source-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        begin = operations.begin
        write = operations.write
        commit = operations.commit
        const { markReady } = operations
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            loads.push({ ...options })
            const requested = rowsForLoadSubset(orderedRows, options)
            const delivered = scenario.reverseInsertion
              ? [...requested].reverse()
              : requested

            const settled = new Promise<void>((resolve) => {
              queueMicrotask(() => {
                begin()
                for (const row of delivered) {
                  if (deliveredIds.has(row.id)) continue
                  deliveredIds.add(row.id)
                  write({ type: `insert`, value: { ...row } })
                }
                commit()
                resolve()
              })
            })
            return settled
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection((query) => {
    const from = query.from({ row: source })
    const filtered = scenario.includeFilter
      ? from.where(({ row }) => eq(row.keep, true))
      : from
    const ordered = filtered.orderBy(({ row }) => row.rank, scenario.direction)
    return (
      scenario.explicitPublicKeyOrder === false
        ? ordered
        : ordered.orderBy(({ row }) => row.id, `asc`)
    )
      .offset(initialWindow.offset)
      .limit(initialWindow.limit)
      .select(({ row }) => ({ id: row.id, rank: row.rank }))
  })
  const publications: Array<{
    changes: Array<PublicPageChange>
    rows: Array<PublicPageRow>
    status: string
  }> = []
  const publicationSubscription = live.subscribeChanges(
    (changes) => {
      const rows = Array.from(live.values(), ({ id, rank }) => ({ id, rank }))
      publications.push({
        changes: normalizePageChanges(
          changes as Array<ChangeMessage<PageRow, number>>,
        ),
        rows,
        status: live.status,
      })
    },
    { includeInitialState: false },
  )

  const work = async () => {
    const preloadPublicationCount = publications.length
    const preload = live.preload()
    compareAt(`pagination-oracle.property.test.ts:1260`, () =>
      expect(Array.from(live.values())).toHaveLength(0),
    )
    await preload
    compareAt(`pagination-oracle.property.test.ts:1262`, () =>
      expect(live.status).toBe(`ready`),
    )
    compareAt(`pagination-oracle.property.test.ts:1263`, () =>
      expect(live.utils.lastSubsetError).toBeUndefined(),
    )
    if (initialWindow.limit > 0) {
      compareAt(`pagination-oracle.property.test.ts:1265`, () =>
        expect(loads.length).toBeGreaterThan(0),
      )
    }
    try {
      compareAt(`pagination-oracle.property.test.ts:1268`, () =>
        expect(
          Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
        ).toEqual(
          referenceWindowRows(expectedRows, scenario.direction, initialWindow),
        ),
      )
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
    const initialExpected = referenceWindowRows(
      expectedRows,
      scenario.direction,
      initialWindow,
    )
    compareAt(`pagination-oracle.property.test.ts:1281`, () =>
      expect(publications.slice(preloadPublicationCount)).toEqual([
        ...(initialExpected.length > 0
          ? [
              {
                changes: expectedPageChanges([], initialExpected),
                rows: initialExpected,
                status: `loading`,
              },
            ]
          : []),
        // A real source acquisition uses one empty batch to wake subscriptions
        // when the initial source set becomes ready, even if it produced no
        // visible rows. A zero window needs no acquisition or wake-up.
        ...(initialWindow.limit > 0
          ? [{ changes: [], rows: initialExpected, status: `ready` }]
          : []),
      ]),
    )

    if (scenario.localRowsBeforeFirstRequest) {
      compareAt(`pagination-oracle.property.test.ts:1300`, () =>
        expect(loads).toHaveLength(0),
      )
      const publicationCount = publications.length
      begin()
      for (const row of scenario.localRowsBeforeFirstRequest) {
        deliveredIds.add(row.id)
        write({ type: `insert`, value: { ...row } })
      }
      commit()
      compareAt(`pagination-oracle.property.test.ts:1308`, () =>
        expect(publications).toHaveLength(publicationCount),
      )
      compareAt(`pagination-oracle.property.test.ts:1309`, () =>
        expect(Array.from(live.values())).toHaveLength(0),
      )
    }

    for (const [index, window] of scenario.windows.slice(1).entries()) {
      const before = Array.from(live.values(), ({ id, rank }) => ({ id, rank }))
      const publicationCount = publications.length
      const result = live.utils.setWindow(window)
      if (result instanceof Promise) {
        compareAt(`pagination-oracle.property.test.ts:1317`, () =>
          expect(
            Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
          ).toEqual(before),
        )
      }
      if (result instanceof Promise) await result
      compareAt(`pagination-oracle.property.test.ts:1322`, () =>
        expect(live.status).toBe(`ready`),
      )
      compareAt(`pagination-oracle.property.test.ts:1323`, () =>
        expect(live.utils.lastSubsetError).toBeUndefined(),
      )

      try {
        compareAt(`pagination-oracle.property.test.ts:1326`, () =>
          expect(
            Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
          ).toEqual(
            referenceWindowRows(expectedRows, scenario.direction, window),
          ),
        )
      } catch (error) {
        throw new TraceAssertionError(index + 1, error)
      }
      const after = referenceWindowRows(
        expectedRows,
        scenario.direction,
        window,
      )
      const expectedChanges = expectedPageChanges(before, after)
      compareAt(`pagination-oracle.property.test.ts:1338`, () =>
        expect(publications.slice(publicationCount)).toEqual(
          expectedChanges.length > 0
            ? [{ changes: expectedChanges, rows: after, status: `ready` }]
            : [],
        ),
      )
    }

    const expectedOrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: scenario.direction, nulls: `first` },
      },
      ...(scenario.explicitPublicKeyOrder === false
        ? []
        : [
            {
              expression: new PropRef([`id`]),
              compareOptions: { direction: `asc`, nulls: `first` },
            },
          ]),
    ]
    for (const load of loads) {
      if (load.orderBy) {
        compareAt(`pagination-oracle.property.test.ts:1361`, () =>
          expect(load.orderBy).toMatchObject(expectedOrderBy),
        )
      } else if (load.where) {
        // Boundary refinement asks for the complete tie class with an exact
        // predicate. Prefix and cursor requests still carry the source order.
        compareAt(`pagination-oracle.property.test.ts:1365`, () =>
          expect(load.limit).toBeUndefined(),
        )
      } else {
        // If the same finite prefix cannot fill the local window, one
        // unbounded request safely establishes the remaining source rows.
        compareAt(`pagination-oracle.property.test.ts:1369`, () =>
          expect(load.cursor).toBeUndefined(),
        )
        compareAt(`pagination-oracle.property.test.ts:1370`, () =>
          expect(load.limit).toBeUndefined(),
        )
        compareAt(`pagination-oracle.property.test.ts:1371`, () =>
          expect(load.offset).toBeUndefined(),
        )
      }
    }
    compareAt(`pagination-oracle.property.test.ts:1374`, () =>
      expect(
        loads.length,
        JSON.stringify(
          loads.map(({ limit, offset, cursor, where }) => ({
            limit,
            offset,
            cursor,
            where,
          })),
        ),
      ).toBeLessThanOrEqual(
        scenario.windows.length * (expectedRows.length + 2),
      ),
    )
    assertLoads?.(loads)
  }
  await withHistoryCleanup(work, () => [
    () => publicationSubscription.unsubscribe(),
    () => live.cleanup(),
    () => source.cleanup(),
  ])
}

async function runAdversarialOrderedProviderScenario(
  options: {
    providerRows: ReadonlyArray<AdversarialOrderedRow>
    initialRows?: ReadonlyArray<AdversarialOrderedRow>
    order:
      | { kind: `rank`; direction: `asc` | `desc`; nulls: `first` | `last` }
      | {
          kind: `reference`
          direction?: `asc` | `desc`
          nulls?: `first` | `last`
        }
      | { kind: `locale` }
    limit: number
    expectedIds: ReadonlyArray<number>
    useOffsetWhenAvailable?: boolean
    inheritSourceLocale?: boolean
    autoIndex?: `off` | `eager`
  },
  fault?: `post-cleanup-request`,
): Promise<Array<LoadSubsetOptions>> {
  const loads: Array<LoadSubsetOptions> = []
  const autoIndex = options.autoIndex ?? `eager`
  let recordedProvider!: (options: LoadSubsetOptions) => Promise<void>
  const delivered = new Set(options.initialRows?.map(({ id }) => id) ?? [])
  const source = createCollection<AdversarialOrderedRow>({
    id: `pagination-adversarial-order-source-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex,
    defaultIndexType: autoIndex === `eager` ? BTreeIndex : undefined,
    defaultStringCollation: options.inheritSourceLocale
      ? {
          locale: `en-US`,
          localeOptions: { numeric: true },
        }
      : undefined,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        if (options.initialRows?.length) {
          begin()
          for (const row of options.initialRows) {
            write({ type: `insert`, value: { ...row } })
          }
          commit()
        }
        markReady()
        return {
          loadSubset: (recordedProvider = (loadOptions: LoadSubsetOptions) => {
            loads.push(loadOptions)
            if (loads.length > options.providerRows.length * 4 + 4) {
              throw new Error(
                `Ordered refinement exceeded its finite source work bound: ${JSON.stringify(
                  loads.map(({ limit, offset, cursor }) => ({
                    limit,
                    offset,
                    lastKey: cursor?.lastKey,
                  })),
                )}`,
              )
            }
            const providerRows = loadOptions.where
              ? options.providerRows.filter(
                  (row) =>
                    evaluateReferenceExpression(loadOptions.where!, row) ===
                    true,
                )
              : options.providerRows
            const providerMatch = options.useOffsetWhenAvailable
              ? providerRows.slice(
                  loadOptions.offset ?? 0,
                  loadOptions.limit === undefined
                    ? undefined
                    : (loadOptions.offset ?? 0) + loadOptions.limit,
                )
              : rowsForLoadSubset(options.providerRows, loadOptions)
            const requested = providerMatch
            begin()
            for (const row of requested) {
              if (delivered.has(row.id)) continue
              delivered.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            const receipt = commit()
            return receipt === true ? Promise.resolve() : receipt
          }),
        }
      },
    },
  })
  const live = createLiveQueryCollection((query) => {
    const from = query.from({ row: source })
    const ordered =
      options.order.kind === `locale`
        ? options.inheritSourceLocale
          ? from.orderBy(({ row }) => row.label)
          : from.orderBy(({ row }) => row.label, {
              direction: `asc`,
              nulls: `first`,
              stringSort: `locale`,
              locale: `en-US`,
              localeOptions: { numeric: true },
            })
        : from.orderBy(
            ({ row }) => row.rank,
            options.order.kind === `reference`
              ? {
                  direction: options.order.direction ?? `asc`,
                  nulls: options.order.nulls ?? `first`,
                }
              : {
                  direction: options.order.direction,
                  nulls: options.order.nulls,
                },
          )
    return ordered.limit(options.limit).select(({ row }) => ({ id: row.id }))
  })

  return withHistoryCleanup(
    async () => {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual(
        options.expectedIds,
      )
      if (options.inheritSourceLocale) {
        expect(Reflect.ownKeys(source.compareOptions).sort()).toEqual([
          `locale`,
          `localeOptions`,
          `stringSort`,
        ])
        expect(source.compareOptions).toStrictEqual({
          stringSort: `locale`,
          locale: `en-US`,
          localeOptions: { numeric: true },
        })
        if (autoIndex === `eager`)
          expect(
            source.indexes.size,
            `auto-index path reached`,
          ).toBeGreaterThan(0)
        else expect(source.indexes.size, `scan path reached`).toBe(0)
      }
      // Keep the pre-cleanup snapshot, but judge disposal against the live recorder.
      return [...loads]
    },
    () => {
      const beforeCleanup = loads.length
      return [
        () => live.cleanup(),
        () => {
          if (fault === `post-cleanup-request`)
            return recordedProvider(loads[0]!)
          return undefined
        },
        () => source.cleanup(),
        () =>
          expect(loads.length, `no provider start during disposal`).toBe(
            beforeCleanup,
          ),
      ]
    },
  )
}

async function runCustomCollationScenario(options: {
  direction: `asc` | `desc`
  autoIndex: `off` | `eager`
  sourceDefault: boolean
  bounded: boolean
  outputDefault?: `lexical`
}): Promise<void> {
  const loads: Array<LoadSubsetOptions> = []
  const delivered = new Set<number>()
  const source = createCollection<CustomCollationRow>({
    id: `pagination-custom-collation-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: options.autoIndex,
    defaultIndexType: options.autoIndex === `eager` ? BTreeIndex : undefined,
    defaultStringCollation: options.sourceDefault
      ? {
          stringSort: `custom`,
          compare: compareCustomCollationStrings,
        }
      : { stringSort: `lexical` },
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: (loadOptions: LoadSubsetOptions) => {
            loads.push(loadOptions)
            const matchingRows = loadOptions.where
              ? customCollationProviderRows.filter(
                  (row) =>
                    evaluateReferenceExpression(loadOptions.where!, row) ===
                    true,
                )
              : customCollationProviderRows
            // Deliberately honor only the provider's hostile physical order.
            // A finite first request therefore cannot establish local custom
            // collation coverage.
            const requestedRows = matchingRows.slice(
              loadOptions.offset ?? 0,
              loadOptions.limit === undefined
                ? undefined
                : (loadOptions.offset ?? 0) + loadOptions.limit,
            )
            begin()
            for (const row of requestedRows) {
              if (delivered.has(row.id)) continue
              delivered.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            const receipt = commit()
            return receipt === true ? Promise.resolve() : receipt
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    defaultStringCollation:
      options.outputDefault === `lexical`
        ? { stringSort: `lexical` }
        : undefined,
    query: (query) => {
      const filtered = query
        .from({ row: source })
        .where(({ row }) => eq(row.keep, true))
      const ordered = options.sourceDefault
        ? filtered.orderBy(({ row }) => row.label, {
            direction: options.direction,
            nulls: `first`,
          })
        : filtered.orderBy(({ row }) => row.label, {
            direction: options.direction,
            nulls: `first`,
            stringSort: `custom`,
            compare: compareCustomCollationStrings,
          })
      if (options.bounded) {
        return ordered.limit(4).select(({ row }) => ({
          id: row.id,
          label: row.label,
        }))
      }
      return ordered.select(({ row }) => ({
        id: row.id,
        label: row.label,
      }))
    },
  })

  try {
    await live.preload()
    const expectedIds =
      options.direction === `asc` ? [2, 3, 4, 1] : [1, 4, 2, 3]
    expect(Array.from(live.values(), ({ id }) => id)).toEqual(expectedIds)
    if (options.autoIndex === `eager`) {
      expect(source.indexes.size, `auto-index path reached`).toBeGreaterThan(0)
    } else {
      expect(source.indexes.size, `scan path reached`).toBe(0)
    }
    expect(loads).toHaveLength(1)
    expect(loads[0]?.where).toBeDefined()
    expect(loads[0]?.orderBy).toBeUndefined()
    expect(loads[0]?.limit).toBeUndefined()
    expect(loads[0]?.offset).toBeUndefined()
    expect(loads[0]?.cursor).toBeUndefined()
  } finally {
    await cleanupAll(live, source)
  }
}

async function runPendingMutationScenario(
  scenario: PendingMutationScenario,
  timing: `before-response` | `after-response`,
  finalLimitAfterMutation?: number,
  explicitPublicKeyOrder = true,
  transport: `cursor` | `offset` = `cursor`,
  fault?:
    | `held-publication`
    | `held-window`
    | `early-settlement`
    | `wrong-rejection`
    | `callback-key`
    | `callback-value`
    | `delete-value`
    | `final-value`,
): Promise<PendingMutationResult> {
  const rows = new Map<number, PageRow>(
    scenario.ranks.map((rank, index) => [
      index + 1,
      {
        id: index + 1,
        rank,
        ...(scenario.includeFilter ? { keep: true } : {}),
      },
    ]),
  )
  const firstDeliveredId = referenceWindowRows(
    [...rows.values()],
    scenario.direction,
    { offset: 0, limit: 1 },
  )[0]!.id
  const firstDelivered = { ...rows.get(firstDeliveredId)! }
  const pending: Array<PendingCursorLoad> = []
  let mutationRequestStart: number | undefined
  const physicallySettled = new Set<PendingCursorLoad>()
  const released: Array<LoadSubsetOptions> = []
  const deliveredIds = new Set<number>([firstDelivered.id])
  // A rejected initial subset load is fatal. Establish a ready baseline first
  // so reject scenarios exercise subscription-scoped window recovery.
  let capturePending = scenario.responseOutcome === `resolve`
  let begin!: () => void
  let write!: (message: {
    type: `insert` | `update` | `delete`
    value: PageRow
  }) => void
  let commit!: () => void

  const source = createCollection<PageRow>({
    id: `pagination-event-order-source-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        begin()
        write({ type: `insert`, value: { ...firstDelivered } })
        commit()
        params.markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            if (!capturePending) return true
            const deferred = createDeferred<void>()
            const request = { options, deferred }
            pending.push(request)
            void deferred.promise.then(
              () => physicallySettled.add(request),
              () => physicallySettled.add(request),
            )
            return deferred.promise
          },
          unloadSubset: (options: LoadSubsetOptions) => {
            released.push(options)
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection((query) => {
    const from = query.from({ row: source })
    const filtered = scenario.includeFilter
      ? from.where(({ row }) => eq(row.keep, true))
      : from
    const ordered = filtered.orderBy(({ row }) => row.rank, scenario.direction)
    return (
      explicitPublicKeyOrder
        ? ordered.orderBy(({ row }) => row.id, `asc`)
        : ordered
    )
      .limit(scenario.responseOutcome === `reject` ? 1 : scenario.limit)
      .select(({ row }) => ({ id: row.id, rank: row.rank }))
  })
  const outstanding: Array<Promise<unknown>> = []
  const outcomes: Array<{
    label: string
    state: `pending` | `fulfilled` | `rejected`
    error?: unknown
  }> = []
  type MutationStage = `initial` | `failed-window` | `later` | `retry`
  let stage: MutationStage = `initial`
  const initialLimit =
    scenario.responseOutcome === `reject` ? 1 : scenario.limit
  const cuts: Array<{
    phase: string
    stage: MutationStage
    held: boolean
    rows: Array<Record<string, unknown>>
    expected: Array<PageRow>
    window: unknown
    outcomes: typeof outcomes
    changes: Array<{
      type: `insert` | `update` | `delete`
      key: unknown
      value: Record<string, unknown>
    }>
  }> = []
  const copyRow = (row: PageRow): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(row).filter(
        ([key]) =>
          ![
            `keep`,
            `$key`,
            `$collectionId`,
            `$origin`,
            `$hasPendingWrites`,
          ].includes(key),
      ),
    )
  const capture = (
    phase: string,
    changes: ReadonlyArray<ChangeMessage<PageRow>> = [],
  ) => {
    cuts.push({
      phase,
      stage,
      held: pending.some((request) => !physicallySettled.has(request)),
      rows: Array.from(live.values(), copyRow),
      expected: referenceWindowRows([...rows.values()], scenario.direction, {
        offset: 0,
        limit: initialLimit,
      }).map((row) => ({ ...row })),
      window: { ...live.utils.getWindow() },
      outcomes: outcomes.map((outcome) => ({ ...outcome })),
      changes: changes.map(({ type, key, value }) => ({
        type,
        key,
        value: copyRow(value),
      })),
    })
  }
  const observe = (label: string, result: true | Promise<void>) => {
    const outcome: (typeof outcomes)[number] = { label, state: `pending` }
    outcomes.push(outcome)
    if (result === true) {
      outcome.state = `fulfilled`
      capture(`${label}-fulfilled`)
      return Promise.resolve()
    }
    const observed = result.then(
      () => {
        outcome.state = `fulfilled`
        capture(`${label}-fulfilled`)
      },
      (error: unknown) => {
        outcome.state = `rejected`
        outcome.error = error
        capture(`${label}-rejected`)
      },
    )
    outstanding.push(observed)
    return observed
  }
  let subscription: ReturnType<typeof live.subscribeChanges> | undefined
  const cursorError = new Error(`cursor failed`)

  const applyMutation = () => {
    const { mutation } = scenario
    mutationRequestStart ??= pending.length
    begin()
    if (mutation.type === `delete`) {
      const row = rows.get(mutation.id)
      if (!row) throw new Error(`Cannot delete missing authoritative row`)
      rows.delete(mutation.id)
      deliveredIds.delete(mutation.id)
      write({ type: `delete`, value: { ...row } })
    } else {
      rows.set(mutation.row.id, { ...mutation.row })
      deliveredIds.add(mutation.row.id)
      write({ type: mutation.type, value: { ...mutation.row } })
    }
    commit()
    capture(`mutation-commit`)
  }

  const settlePending = async () => {
    // Settling one request can append its boundary-refinement request.
    for (let index = 0; index < pending.length; index++) {
      if (index > (scenario.ranks.length + 1) * 8) {
        throw new Error(`Pending mutation exceeded finite provider work bound`)
      }
      const request = pending[index]!
      if (request.responseStarted) continue
      request.responseStarted = true
      const orderedRows = [...rows.values()].sort(
        (left, right) =>
          (left.rank - right.rank) * (scenario.direction === `asc` ? 1 : -1) ||
          left.id - right.id,
      )
      const options = { ...request.options }
      if (transport !== `cursor`) {
        options.cursor = undefined
      }
      begin()
      const selected = rowsForLoadSubset(orderedRows, options)
      const responseRows =
        options.orderBy && scenario.orderedResponseLimit !== undefined
          ? (options.cursor
              ? selected.filter(({ id }) => !deliveredIds.has(id))
              : selected
            ).slice(0, scenario.orderedResponseLimit)
          : selected
      for (const row of responseRows) {
        if (deliveredIds.has(row.id)) continue
        deliveredIds.add(row.id)
        write({ type: `insert`, value: { ...row } })
      }
      commit()
      capture(`provider-commit`)
      request.deferred.resolve()
      capture(`provider-resolve-call`)
      await flushPromises()
      capture(`provider-drain`)
    }
  }

  return withHistoryCleanup(
    async () => {
      const preload = live.preload()
      observe(`preload`, preload)
      subscription = live.subscribeChanges(
        (changes) => capture(`callback`, changes),
        { includeInitialState: true },
      )
      capture(`preload-call`)
      let finalLimit = scenario.limit
      if (scenario.responseOutcome === `resolve`) {
        compareAt(`pagination-oracle.property.test.ts:2035`, () =>
          expect(pending).toHaveLength(1),
        )
        if (timing === `before-response`) applyMutation()
        await settlePending()
        await preload
        capture(`initial-complete`)
        stage = `later`
        if (timing === `after-response`) {
          applyMutation()
          await flushPromises()
        }
        if (finalLimitAfterMutation !== undefined) {
          finalLimit = finalLimitAfterMutation
          const widened = live.utils.setWindow({
            offset: 0,
            limit: finalLimit,
          })
          observe(`widen`, widened)
          capture(`widen-call`)
        }
        await settlePending()
        await Promise.all(outstanding)
      } else {
        await preload
        await flushPromises()
        capturePending = true
        compareAt(`pagination-oracle.property.test.ts:2060`, () =>
          expect(pending).toHaveLength(0),
        )
        finalLimit += 1
        stage = `failed-window`
        const failedWindow = live.utils.setWindow({
          offset: 0,
          limit: finalLimit,
        })
        observe(`failed-window`, failedWindow)
        capture(`failed-window-call`)
        compareAt(`pagination-oracle.property.test.ts:2069`, () =>
          expect(failedWindow).toBeInstanceOf(Promise),
        )
        const observedFailure = (failedWindow as Promise<void>).then(
          () => undefined,
          (error: unknown) => error,
        )
        compareAt(`pagination-oracle.property.test.ts:2074`, () =>
          expect(pending).toHaveLength(1),
        )
        if (timing === `before-response`) applyMutation()
        pending[0]!.responseStarted = true
        pending[0]!.deferred.reject(cursorError)
        capture(`provider-reject-call`)
        if (timing === `after-response`) applyMutation()
        await flushPromises()
        await settlePending()
        capture(`recovery-drain`)
        const observedFailureValue = await observedFailure
        compareAt(`pagination-oracle.property.test.ts:2083`, () =>
          expect(observedFailureValue).toBe(cursorError),
        )
        compareAt(`pagination-oracle.property.test.ts:2084`, () =>
          expect(live.status).toBe(`ready`),
        )
        compareAt(`pagination-oracle.property.test.ts:2085`, () =>
          expect(live.utils.lastSubsetError).toBe(cursorError),
        )

        stage = `retry`
        const retry = live.utils.setWindow({ offset: 0, limit: finalLimit })
        const observedRetry = observe(`retry`, retry)
        capture(`retry-call`)
        await flushPromises()
        await settlePending()
        await flushPromises()
        await observedRetry
        compareAt(`pagination-oracle.property.test.ts:2095`, () =>
          expect(live.status).toBe(`ready`),
        )
        compareAt(`pagination-oracle.property.test.ts:2096`, () =>
          expect(live.utils.lastSubsetError).toBe(cursorError),
        )
      }

      await Promise.all(outstanding)
      capture(`final`)
      const heldCut = () => {
        const cut = cuts.find(({ held, phase }) => held && phase !== `callback`)
        compareAt(`pagination-oracle.property.test.ts:2103`, () =>
          expect(cut, `held mutation cut reached`).toBeDefined(),
        )
        return cut!
      }
      if (fault === `held-publication`)
        heldCut().rows =
          scenario.responseOutcome === `resolve` ? [{ ...firstDelivered }] : []
      if (fault === `held-window`) heldCut().window = { offset: 0, limit: 999 }
      if (fault === `early-settlement`) {
        const cut = heldCut()
        const outcome = cut.outcomes.find(
          ({ label }) =>
            label ===
            (scenario.responseOutcome === `resolve`
              ? `preload`
              : `failed-window`),
        )!
        outcome.state = `fulfilled`
      }
      if (fault === `wrong-rejection`) {
        const outcome = outcomes.find(({ label }) => label === `failed-window`)
        compareAt(`pagination-oracle.property.test.ts:2123`, () =>
          expect(outcome?.state, `failed caller reached`).toBe(`rejected`),
        )
        outcome!.error = new Error(`cursor failed`)
      }
      if (fault === `callback-key` || fault === `callback-value`) {
        const cut = cuts.find(({ changes }) => changes.length > 0)
        compareAt(`pagination-oracle.property.test.ts:2128`, () =>
          expect(cut, `mutation callback reached`).toBeDefined(),
        )
        if (fault === `callback-key`)
          cut!.changes[0]!.key = String(cut!.changes[0]!.key)
        else cut!.changes[0]!.value.rank = 999
      }
      if (fault === `delete-value`) {
        const change = cuts
          .flatMap((cut) => cut.changes)
          .find((message) => message.type === `delete`)
        compareAt(`pagination-oracle.property.test.ts:2137`, () =>
          expect(change, `mutation delete callback reached`).toBeDefined(),
        )
        change!.value = { ...change!.value, rank: 999 }
      }
      if (fault === `final-value`) cuts.at(-1)!.rows[0]!.rank = 999

      try {
        compareAt(`pagination-oracle.property.test.ts:2143`, () =>
          expect(
            Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
          ).toEqual(
            referenceWindowRows([...rows.values()], scenario.direction, {
              offset: 0,
              limit: finalLimit,
            }),
          ),
        )
      } catch (error) {
        throw new PendingMutationTraceAssertionError(
          error,
          referenceWindowRows(
            [...rows.values()].filter(({ id }) => deliveredIds.has(id)),
            scenario.direction,
            { offset: 0, limit: deliveredIds.size },
          ),
        )
      }

      // Judge recorded public observations after the driver: assertions never
      // throw into the runtime's listener/error handling. Later mutation repair
      // and retry cuts retain raw replicas; their endpoints keep the old law.
      const replica = new Map<unknown, Record<string, unknown>>()
      let initialPublished = false
      for (const cut of cuts) {
        for (const change of cut.changes) {
          compareAt(`pagination-oracle.property.test.ts:2169`, () =>
            expect(typeof change.key, `mutation native callback key`).toBe(
              `number`,
            ),
          )
          compareAt(`pagination-oracle.property.test.ts:2172`, () =>
            expect(change.key, `mutation callback key owns value`).toBe(
              change.value.id,
            ),
          )
          compareAt(`pagination-oracle.property.test.ts:2175`, () =>
            expect(
              replica.has(change.key),
              `mutation callback predecessor`,
            ).toBe(change.type !== `insert`),
          )
          if (change.type === `delete`) {
            compareAt(`pagination-oracle.property.test.ts:2179`, () =>
              expect(
                change.value,
                `mutation deleted callback full value`,
              ).toStrictEqual(replica.get(change.key)),
            )
            replica.delete(change.key)
          } else replica.set(change.key, change.value)
        }
        if (cut.phase === `callback` || cut.phase === `final`) {
          const byId = (
            a: Record<string, unknown>,
            b: Record<string, unknown>,
          ) => (a.id as number) - (b.id as number)
          compareAt(`pagination-oracle.property.test.ts:2191`, () =>
            expect(
              [...replica.values()].sort(byId),
              `mutation callback replica full values`,
            ).toStrictEqual([...cut.rows].sort(byId)),
          )
        }
        if (cut.stage === `initial`) {
          const preloadState = cut.outcomes.find(
            ({ label }) => label === `preload`,
          )!.state
          if (cut.held) {
            compareAt(`pagination-oracle.property.test.ts:2201`, () =>
              expect(cut.rows, `held mutation publication`).toStrictEqual([]),
            )
            compareAt(`pagination-oracle.property.test.ts:2202`, () =>
              expect(preloadState, `held mutation logical settlement`).toBe(
                `pending`,
              ),
            )
          } else if (cut.rows.length > 0 || preloadState === `fulfilled`) {
            compareAt(`pagination-oracle.property.test.ts:2206`, () =>
              expect(
                cut.rows,
                `complete initial mutation publication`,
              ).toStrictEqual(cut.expected),
            )
          }
          if (initialPublished)
            compareAt(`pagination-oracle.property.test.ts:2212`, () =>
              expect(
                cut.rows.length,
                `initial mutation publication cannot withdraw`,
              ).toBeGreaterThan(0),
            )
          if (cut.rows.length > 0) initialPublished = true
          compareAt(`pagination-oracle.property.test.ts:2217`, () =>
            expect(cut.window, `held mutation window`).toStrictEqual({
              offset: 0,
              limit: initialLimit,
            }),
          )
        } else if (cut.stage === `failed-window`) {
          compareAt(`pagination-oracle.property.test.ts:2222`, () =>
            expect(
              cut.rows,
              `failed mutation keeps complete baseline`,
            ).toStrictEqual([{ ...firstDelivered }]),
          )
          compareAt(`pagination-oracle.property.test.ts:2226`, () =>
            expect(cut.window, `held mutation window`).toStrictEqual({
              offset: 0,
              limit: 1,
            }),
          )
          const failed = cut.outcomes.find(
            ({ label }) => label === `failed-window`,
          )
          if (cut.held && failed)
            compareAt(`pagination-oracle.property.test.ts:2234`, () =>
              expect(failed.state, `held mutation logical settlement`).not.toBe(
                `fulfilled`,
              ),
            )
        }
      }
      compareAt(`pagination-oracle.property.test.ts:2239`, () =>
        expect(
          outcomes.map(({ label }) => label),
          `all mutation callers observed`,
        ).toStrictEqual(
          scenario.responseOutcome === `reject`
            ? [`preload`, `failed-window`, `retry`]
            : [
                `preload`,
                ...(finalLimitAfterMutation === undefined ? [] : [`widen`]),
              ],
        ),
      )
      for (const outcome of outcomes) {
        if (outcome.label === `failed-window`) {
          compareAt(`pagination-oracle.property.test.ts:2252`, () =>
            expect(outcome.state, `failed mutation caller state`).toBe(
              `rejected`,
            ),
          )
          compareAt(`pagination-oracle.property.test.ts:2253`, () =>
            expect(outcome.error, `failed mutation caller exact error`).toBe(
              cursorError,
            ),
          )
        } else
          compareAt(`pagination-oracle.property.test.ts:2257`, () =>
            expect(outcome.state, `mutation caller fulfilled`).toBe(
              `fulfilled`,
            ),
          )
      }
      compareAt(`pagination-oracle.property.test.ts:2259`, () =>
        expect(
          cuts.at(-1)!.rows,
          `complete final mutation values`,
        ).toStrictEqual(
          referenceWindowRows([...rows.values()], scenario.direction, {
            offset: 0,
            limit: finalLimit,
          }),
        ),
      )
      compareAt(`pagination-oracle.property.test.ts:2265`, () =>
        expect(
          cuts.at(-1)!.window,
          `complete final mutation window`,
        ).toStrictEqual({ offset: 0, limit: finalLimit }),
      )
      return {
        mutationRepairRequests:
          mutationRequestStart === undefined
            ? []
            : pending.slice(mutationRequestStart).map(({ options }) => options),
        releasedBeforeCleanup: [...released],
      }
    },
    () => [
      () => subscription?.unsubscribe(),
      () => live.cleanup(),
      () => {
        for (const request of pending) request.deferred.resolve()
      },
      () => Promise.all(outstanding),
      () => source.cleanup(),
    ],
  )
}

async function runRejectedCursorRetryAfterMutation(): Promise<void> {
  const rows = new Map<number, PageRow>([
    [1, { id: 1, rank: 0 }],
    [2, { id: 2, rank: 1 }],
    [3, { id: 3, rank: 2 }],
    [4, { id: 4, rank: 3 }],
  ])
  const pending: Array<PendingCursorLoad> = []
  const deliveredIds = new Set<number>([1])
  // Keep the rejected cursor in the incremental path rather than failing the
  // live query's initial preload.
  let capturePending = false
  let begin!: () => void
  let write!: (message: { type: `insert` | `update`; value: PageRow }) => void
  let commit!: () => void
  const source = createCollection<PageRow>({
    id: `pagination-rejected-cursor-source-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        begin()
        write({ type: `insert`, value: { ...rows.get(1)! } })
        commit()
        params.markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            if (!capturePending) return true
            const deferred = createDeferred<void>()
            pending.push({ options, deferred })
            return deferred.promise
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection((query) =>
    query
      .from({ row: source })
      .orderBy(({ row }) => row.rank, `asc`)
      .limit(1),
  )

  const settle = async (request: PendingCursorLoad): Promise<void> => {
    request.responseStarted = true
    begin()
    const orderedRows = referenceWindowRows([...rows.values()], `asc`, {
      offset: 0,
      limit: rows.size,
    })
    for (const row of rowsForLoadSubset(orderedRows, request.options)) {
      if (deliveredIds.has(row.id)) continue
      deliveredIds.add(row.id)
      write({ type: `insert`, value: { ...row } })
    }
    commit()
    request.deferred.resolve()
    await flushPromises()
  }

  try {
    await live.preload()
    await flushPromises()
    capturePending = true
    expect(pending).toHaveLength(0)

    const failedWindow = live.utils.setWindow({ offset: 0, limit: 2 })
    expect(failedWindow).toBeInstanceOf(Promise)
    const cursorError = new Error(`cursor failed`)
    const observedFailure = (failedWindow as Promise<void>).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(pending).toHaveLength(1)

    rows.set(1, { id: 1, rank: 3 })
    begin()
    write({ type: `update`, value: { id: 1, rank: 3 } })
    commit()

    pending[0]!.responseStarted = true
    pending[0]!.deferred.reject(cursorError)
    await flushPromises()
    for (let index = 1; index < pending.length; index++) {
      if (!pending[index]!.responseStarted) await settle(pending[index]!)
    }
    expect(await observedFailure).toBe(cursorError)

    const retry = live.utils.setWindow({ offset: 0, limit: 3 })
    for (let index = 1; index < pending.length; index++) {
      if (!pending[index]!.responseStarted) await settle(pending[index]!)
    }
    if (retry instanceof Promise) await retry

    try {
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([2, 3, 1])
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    for (const request of pending) request.deferred.resolve()
    await cleanupAll(live, source)
  }
}

async function runPendingHistoryScenario(
  scenario: PendingHistoryScenario,
  fault?:
    | `partial-publication`
    | `wrong-window`
    | `early-settlement`
    | `wrong-final-value`
    | `wrong-callback-value`
    | `wrong-callback-key`
    | `retracted-publication`,
): Promise<void> {
  const rows = new Map<number, PageRow>(
    scenario.ranks.map((rank, index) => [index + 1, { id: index + 1, rank }]),
  )
  const firstDelivered = referenceWindowRows(
    [...rows.values()],
    scenario.direction,
    { offset: 0, limit: 1 },
  )[0]!
  const pending: Array<PendingCursorLoad> = []
  const fulfilled = new Set<PendingCursorLoad>()
  const deliveredIds = new Set<number>([firstDelivered.id])
  const outstanding: Array<Promise<unknown>> = []
  const outcomes: Array<{
    settled: boolean
    error?: unknown
    rejected?: true
  }> = []
  const cuts: Array<{
    phase: string
    held: boolean
    rows: Array<Record<string, unknown>>
    window: unknown
    settled: boolean
    windowSettled: boolean
    changes: Array<{
      type: `insert` | `update` | `delete`
      key: unknown
      value: Record<string, unknown>
    }>
  }> = []
  let begin!: () => void
  let write!: (message: { type: `insert` | `update`; value: PageRow }) => void
  let commit!: () => void
  const source = createCollection<PageRow>({
    id: `pagination-pending-history-source-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        begin()
        write({ type: `insert`, value: { ...firstDelivered } })
        commit()
        params.markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const deferred = createDeferred<void>()
            const request = { options, deferred }
            pending.push(request)
            // Observe physical fulfillment before handing its Promise to the loader.
            void deferred.promise.then(
              () => fulfilled.add(request),
              () => {},
            )
            return deferred.promise
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection((query) =>
    query
      .from({ row: source })
      .orderBy(({ row }) => row.rank, scenario.direction)
      .orderBy(({ row }) => row.id, `asc`)
      .limit(scenario.initialLimit),
  )
  const copyRow = (row: PageRow): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(row).filter(
        ([key]) =>
          ![`$key`, `$collectionId`, `$origin`, `$hasPendingWrites`].includes(
            key,
          ),
      ),
    )
  const capture = (
    phase: string,
    changes: ReadonlyArray<ChangeMessage<PageRow>> = [],
  ) => {
    cuts.push({
      phase,
      held: pending.some((request) => !fulfilled.has(request)),
      rows: Array.from(live.values(), copyRow),
      window: { ...live.utils.getWindow() },
      settled: outcomes.some((outcome) => outcome.settled),
      windowSettled: outcomes.length === 3 && outcomes[2]!.settled,
      changes: changes.map(({ type, key, value }) => ({
        type,
        key,
        value: copyRow(value),
      })),
    })
  }
  let subscription: ReturnType<typeof live.subscribeChanges> | undefined

  const updateFirstDelivered = (rank: number): void => {
    const previous = rows.get(firstDelivered.id)!
    const changedRank = changedRankValue(previous.rank, rank)
    const next = { ...previous, rank: changedRank }
    rows.set(next.id, next)
    begin()
    write({ type: `update`, value: { ...next } })
    commit()
  }

  const settle = async (request: PendingCursorLoad): Promise<void> => {
    request.responseStarted = true
    const orderedRows = referenceWindowRows(
      [...rows.values()],
      scenario.direction,
      { offset: 0, limit: rows.size },
    )
    begin()
    for (const row of rowsForLoadSubset(orderedRows, request.options)) {
      if (deliveredIds.has(row.id)) continue
      deliveredIds.add(row.id)
      write({ type: `insert`, value: { ...row } })
    }
    commit()
    capture(`provider-commit`)
    request.deferred.resolve()
    capture(`provider-resolve-call`)
    await flushPromises()
    capture(`provider-drain`)
  }

  const track = (result: true | Promise<void>): void => {
    const outcome: { settled: boolean; error?: unknown; rejected?: true } = {
      settled: false,
    }
    outcomes.push(outcome)
    if (result instanceof Promise) {
      outstanding.push(
        result.then(
          () => {
            outcome.settled = true
            capture(`logical-settlement`)
          },
          (error: unknown) => {
            outcome.settled = true
            outcome.rejected = true
            outcome.error = error
          },
        ),
      )
    } else outcome.settled = true
  }

  return withHistoryCleanup(
    async () => {
      track(live.preload())
      subscription = live.subscribeChanges(
        (changes) => capture(`callback`, changes),
        { includeInitialState: false },
      )
      capture(`initial-held`)
      compareAt(`pagination-oracle.property.test.ts:2573`, () =>
        expect(pending).toHaveLength(1),
      )

      updateFirstDelivered(scenario.firstRank)
      capture(`first-update`)
      track(live.utils.setWindow({ offset: 0, limit: scenario.narrowLimit }))
      capture(`narrow`)
      track(live.utils.setWindow({ offset: 0, limit: scenario.wideLimit }))
      capture(`wide`)
      compareAt(`pagination-oracle.property.test.ts:2581`, () =>
        expect(pending.length).toBeGreaterThan(0),
      )
      updateFirstDelivered(scenario.secondRank)
      capture(`second-update`)

      await settle(pending[0]!)
      for (let index = 1; index < pending.length; index++) {
        if (index > rows.size * 4) {
          throw new Error(
            `Ordered continuation exceeded its finite source work bound: ${JSON.stringify(
              pending.map(({ options }) => ({
                limit: options.limit,
                offset: options.offset,
                lastKey: options.cursor?.lastKey,
              })),
            )}`,
          )
        }
        await settle(pending[index]!)
      }
      await Promise.all(outstanding)
      capture(`final`)
      compareAt(`pagination-oracle.property.test.ts:2602`, () =>
        expect(
          outcomes.every(({ settled, rejected }) => settled && !rejected),
          `all logical requests fulfilled`,
        ).toBe(true),
      )

      // Corrupt captured real observations, never the runtime or the authority.
      if (fault === `partial-publication`)
        cuts.find(({ held }) => held)!.rows = [{ ...firstDelivered }]
      if (fault === `wrong-window`)
        cuts.find(({ held }) => held)!.window = {
          offset: 0,
          limit: scenario.wideLimit,
        }
      if (fault === `early-settlement`)
        cuts.find(({ held }) => held)!.settled = true
      if (fault === `wrong-final-value`) cuts.at(-1)!.rows[0]!.rank = 99999
      if (fault === `retracted-publication`) {
        const index = cuts.findIndex(
          (cut) => cut.phase === `callback` && cut.rows.length > 0,
        )
        compareAt(`pagination-oracle.property.test.ts:2622`, () =>
          expect(index, `complete callback reached`).toBeGreaterThanOrEqual(0),
        )
        const complete = cuts[index]!
        cuts.splice(
          index + 1,
          0,
          {
            ...complete,
            rows: [],
            changes: complete.rows.map((value) => ({
              type: `delete`,
              key: value.id,
              value,
            })),
          },
          {
            ...complete,
            changes: complete.rows.map((value) => ({
              type: `insert`,
              key: value.id,
              value,
            })),
          },
        )
      }
      if (fault === `wrong-callback-value` || fault === `wrong-callback-key`) {
        const changed = cuts.find((cut) => cut.changes.length > 0)
        compareAt(`pagination-oracle.property.test.ts:2648`, () =>
          expect(changed, `real callback reached`).toBeDefined(),
        )
        const change = changed!.changes[0]!
        if (fault === `wrong-callback-key`) change.key = String(change.key)
        else change.value.rank = 99999
      }
      const completeRows = referenceWindowRows(
        [...rows.values()],
        scenario.direction,
        { offset: 0, limit: scenario.wideLimit },
      )
      const replica = new Map<unknown, Record<string, unknown>>()
      let published = false
      for (const cut of cuts) {
        if (published)
          compareAt(`pagination-oracle.property.test.ts:2662`, () =>
            expect(
              cut.rows.length,
              `published window cannot withdraw`,
            ).toBeGreaterThan(0),
          )
        if (cut.rows.length > 0) published = true
        for (const change of cut.changes) {
          compareAt(`pagination-oracle.property.test.ts:2668`, () =>
            expect(typeof change.key, `native callback key`).toBe(`number`),
          )
          compareAt(`pagination-oracle.property.test.ts:2669`, () =>
            expect(change.key, `callback key owns value`).toBe(change.value.id),
          )
          compareAt(`pagination-oracle.property.test.ts:2670`, () =>
            expect(
              replica.has(change.key),
              `callback operation predecessor`,
            ).toBe(change.type !== `insert`),
          )
          if (change.type === `delete`) replica.delete(change.key)
          else replica.set(change.key, change.value)
        }
        if (cut.phase === `callback`) {
          const byId = (
            left: Record<string, unknown>,
            right: Record<string, unknown>,
          ) => (left.id as number) - (right.id as number)
          compareAt(`pagination-oracle.property.test.ts:2682`, () =>
            expect(
              [...replica.values()].sort(byId),
              `callback replica full values`,
            ).toStrictEqual([...cut.rows].sort(byId)),
          )
        }
        if (cut.held) {
          compareAt(`pagination-oracle.property.test.ts:2688`, () =>
            expect(
              cut.rows,
              `held initial publication ${cut.phase}`,
            ).toStrictEqual([]),
          )
          compareAt(`pagination-oracle.property.test.ts:2692`, () =>
            expect(
              cut.window,
              `held initial window ${cut.phase}`,
            ).toStrictEqual({
              offset: 0,
              limit: scenario.initialLimit,
            }),
          )
          compareAt(`pagination-oracle.property.test.ts:2696`, () =>
            expect(cut.settled, `held logical settlement ${cut.phase}`).toBe(
              false,
            ),
          )
        } else if (
          cut.rows.length === 0 &&
          !cut.windowSettled &&
          cut.phase !== `final`
        ) {
          compareAt(`pagination-oracle.property.test.ts:2704`, () =>
            expect(cut.window, `unpublished initial window`).toStrictEqual({
              offset: 0,
              limit: scenario.initialLimit,
            }),
          )
        } else {
          compareAt(`pagination-oracle.property.test.ts:2709`, () =>
            expect(cut.rows, `complete publication ${cut.phase}`).toStrictEqual(
              completeRows,
            ),
          )
          // getWindow reports Promise-settled state, not the publication callback.
          const target = { offset: 0, limit: scenario.wideLimit }
          if (cut.windowSettled || cut.phase === `final`) {
            compareAt(`pagination-oracle.property.test.ts:2715`, () =>
              expect(
                cut.window,
                `settled complete window ${cut.phase}`,
              ).toStrictEqual(target),
            )
          } else {
            compareAt(`pagination-oracle.property.test.ts:2720`, () =>
              expect(
                [target, { offset: 0, limit: scenario.initialLimit }],
                `pending window metadata ${cut.phase}`,
              ).toContainEqual(cut.window),
            )
          }
        }
      }

      try {
        const actual = Array.from(live.values(), ({ id, rank }) => ({
          id,
          rank,
        }))
        const expected = referenceWindowRows(
          [...rows.values()],
          scenario.direction,
          { offset: 0, limit: scenario.wideLimit },
        )
        compareAt(`pagination-oracle.property.test.ts:2738`, () =>
          expect(actual).toEqual(expected),
        )
      } catch (error) {
        throw new PendingHistoryTraceAssertionError(
          error,
          referenceWindowRows(
            [...rows.values()].filter(({ id }) => deliveredIds.has(id)),
            scenario.direction,
            { offset: 0, limit: scenario.wideLimit },
          ),
        )
      }
    },
    () => [
      () => subscription?.unsubscribe(),
      () => live.cleanup(),
      () => {
        for (const request of pending) request.deferred.resolve()
      },
      () => Promise.all(outstanding),
      () => source.cleanup(),
    ],
  )
}

function changedRankValue(previous: number, requested: number): number {
  return requested === previous
    ? requested === 2
      ? -2
      : requested + 1
    : requested
}

/**
 * Registration support for the named histories below. It transports the
 * file's existing judgment (`ordered-comparison-oracle.ts`): the named driver
 * keeps its model, production path, assertions, and cleanup, and only an
 * assertion at an explicit `compareAt` cut becomes a violation.
 */
function orderedComparison<THistory extends object>(
  run: (history: THistory) => Promise<unknown>,
) {
  return {
    model: (history: THistory, observations: ReadonlyArray<Observation>) =>
      recordedComparison(history, observations),
    driver: (
      history: THistory,
      observe: (checkpoint: string, value: unknown) => void,
    ) => observeComparison(history, observe, () => run(history)),
  }
}

/** The law of a property whose histories are named regressions or cells. */
function namedHistoriesLaw(statement: string) {
  return {
    statement,
    authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
    limits: `Named histories that the generated grammars cannot take back; each runs through the same driver and its existing comparison.`,
  }
}

/** One call of runPendingMutationScenario, with the arguments an old test passed. */
type PendingMutationRun = {
  scenario: PendingMutationScenario
  timing: `before-response` | `after-response`
  finalLimitAfterMutation?: number
  explicitPublicKeyOrder?: boolean
  transport?: `cursor` | `offset`
}

/** A named pending-mutation history: the driver calls of one old test, in order. */
type PendingMutationFixedHistory = {
  name: string
  runs: ReadonlyArray<PendingMutationRun>
}

type PendingMutationFault = NonNullable<
  Parameters<typeof runPendingMutationScenario>[5]
>

async function runPendingMutationRuns(
  history: PendingMutationFixedHistory,
): Promise<void> {
  for (const run of history.runs) {
    await runPendingMutationScenario(
      run.scenario,
      run.timing,
      run.finalLimitAfterMutation,
      run.explicitPublicKeyOrder,
      run.transport,
    )
  }
}

/**
 * A calibration's mutant driver: on the premise that the old fault test ran,
 * it runs production with the fault and accepts exactly the old matcher
 * (`rejects.toThrow(message)`). Every other history runs clean.
 */
function pendingMutationFaultDriver(
  premise: string,
  fault: PendingMutationFault,
  message: RegExp,
  checkpoint: string,
) {
  return (
    history: PendingMutationFixedHistory,
    observe: (checkpoint: string, value: unknown) => void,
  ) =>
    observeComparison(history, observe, async () => {
      if (history.name !== premise) return runPendingMutationRuns(history)
      const [run] = history.runs
      try {
        await runPendingMutationScenario(
          run!.scenario,
          run!.timing,
          undefined,
          true,
          `cursor`,
          fault,
        )
      } catch (error) {
        if (error instanceof Error && message.test(error.message))
          rejectAt(checkpoint, error)
        throw error
      }
    })
}

registerLimitAdmissionOracle()

describe(`pagination recomputation oracle`, () => {
  // Named regressions and boundary cells of the ordered-window law. Each
  // replays runPaginationScenario, whose comparison is referenceWindowRows.
  // The generated grammar maps its payload without an unmapper, so it cannot
  // take these histories back; they run as one enumerated source.
  const orderedWindowFixedHistories: ReadonlyArray<{
    name: string
    scenario: PaginationScenario
  }> = [
    {
      name: `materializes an empty source window`,
      scenario: {
        ranks: [],
        direction: `asc`,
        windows: [{ offset: 0, limit: 3 }],
      },
    },
    {
      name: `materializes an offset past the final row`,
      scenario: {
        ranks: [0, 1],
        direction: `asc`,
        windows: [{ offset: 4, limit: 2 }],
      },
    },
    {
      name: `materializes an initially empty zero-limit window`,
      scenario: {
        ranks: [0, 1, 2],
        direction: `asc`,
        windows: [{ offset: 0, limit: 0 }],
      },
    },
    {
      name: `clears and restores a nonempty window across a zero limit`,
      scenario: {
        ranks: [0, 1, 2],
        direction: `asc`,
        windows: [
          { offset: 0, limit: 2 },
          { offset: 0, limit: 0 },
          { offset: 1, limit: 1 },
        ],
      },
    },
    {
      name: `advances past an implicit public-key tie class`,
      scenario: {
        ranks: [1, 2, 3, 4, 5, 5, 5, 5, 5, 5, 11, 12, 13, 14, 15, 16],
        direction: `asc`,
        explicitPublicKeyOrder: false,
        includeFilter: true,
        reverseInsertion: true,
        windows: [
          { offset: 0, limit: 5 },
          { offset: 5, limit: 5 },
          { offset: 10, limit: 5 },
        ],
      },
    },
    // The eager NaN window cells. Their model expectations are checked in
    // pagination-model.test.ts.
    ...eagerNaNWindowCases.map(({ direction, ranks, limit }) => ({
      name: `orders a ${direction} eager window with a NaN or finite middle rank`,
      scenario: {
        ranks,
        direction,
        explicitPublicKeyOrder: false,
        windows: [
          { offset: 0, limit },
          { offset: 1, limit },
        ],
      },
    })),
  ]

  oracleProperty({
    id: `pagination.ordered-window-fixed`,
    law: {
      statement: `matches full recomputation across ordered windows for named regressions`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `Named histories that the generated window grammar cannot take back; each replays runPaginationScenario and its comparison.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: orderedWindowFixedHistories,
    label: ({ name }) => name,
    ...orderedComparison(
      ({ scenario }: (typeof orderedWindowFixedHistories)[number]) =>
        runPaginationScenario(scenario),
    ),
    check: (_history, _observations, verdict) => verdict,
  })

  // Named regressions and boundary cells of the window-transition law. Each
  // replays runPaginationStateScenario and its recomputation comparison. The
  // generated grammar maps its payload without an unmapper, so it cannot take
  // these histories back; they run as one enumerated source.
  const windowTransitionFixedHistories: ReadonlyArray<{
    name: string
    scenario: PaginationStateScenario
  }> = [
    {
      name: `keeps a NaN window coherent through equal and changed source ranks`,
      scenario: {
        ranks: [10, 20, NaN, 30, 40],
        direction: `desc`,
        explicitPublicKeyOrder: false,
        initialWindow: { offset: 0, limit: 3 },
        actions: [
          { type: `put`, id: 3, rank: NaN },
          { type: `put`, id: 3, rank: 35 },
          { type: `put`, id: 3, rank: NaN },
          { type: `delete`, id: 3 },
        ],
      },
    },
    {
      name: `keeps implicit ties stable across filtered source mutations`,
      scenario: {
        ranks: [0, 0, 0, 1, 1, 1],
        direction: `asc`,
        explicitPublicKeyOrder: false,
        includeFilter: true,
        reverseInsertion: true,
        initialWindow: { offset: 0, limit: 3 },
        actions: [
          { type: `put`, id: 7, rank: 0 },
          { type: `delete`, id: 2 },
          { type: `window`, offset: 1, limit: 3 },
        ],
      },
    },
    {
      name: `discovered trace: a row moving across an offset window must refill its boundary`,
      scenario: {
        ranks: [0, 0, 0],
        direction: `desc`,
        initialWindow: { offset: 1, limit: 1 },
        actions: [{ type: `put`, id: 1, rank: -1 }],
      },
    },
    {
      name: `retains authoritative rows when a later window admits a prior insert`,
      scenario: {
        ranks: [0, 0],
        direction: `asc`,
        initialWindow: { offset: 0, limit: 1 },
        actions: [
          { type: `put`, id: 3, rank: 1 },
          { type: `window`, offset: 0, limit: 3 },
        ],
      },
    },
    {
      name: `restores an out-of-window insert when a later offset selects it`,
      scenario: {
        ranks: [0, 0],
        direction: `asc`,
        initialWindow: { offset: 0, limit: 1 },
        actions: [
          { type: `put`, id: 3, rank: 1 },
          { type: `window`, offset: 2, limit: 1 },
        ],
      },
    },
    {
      name: `restores an out-of-window rank update when a later offset selects it`,
      scenario: {
        ranks: [0, 0, 0],
        direction: `asc`,
        initialWindow: { offset: 0, limit: 1 },
        actions: [
          { type: `put`, id: 2, rank: 1 },
          { type: `window`, offset: 2, limit: 1 },
        ],
      },
    },
    {
      name: `discovered trace: inserting at an empty offset boundary refills the window`,
      scenario: {
        ranks: [0, 0],
        direction: `asc`,
        initialWindow: { offset: 0, limit: 1 },
        actions: [
          { type: `put`, id: 3, rank: 1 },
          { type: `window`, offset: 3, limit: 1 },
          { type: `put`, id: 4, rank: 1 },
        ],
      },
    },
    {
      name: `discovered trace: an insert before a later offset does not skip its new boundary`,
      scenario: {
        ranks: [-1, -1, 0, -1, 0, -1, 0, 1, 1],
        direction: `asc`,
        initialWindow: { offset: 0, limit: 3 },
        actions: [
          { type: `put`, id: 10, rank: 0 },
          { type: `window`, offset: 8, limit: 1 },
        ],
      },
    },
    {
      name: `discovered trace: a rank update must refill a top-1 window`,
      scenario: {
        ranks: [0, 0],
        direction: `asc`,
        initialWindow: { offset: 0, limit: 1 },
        actions: [{ type: `put`, id: 1, rank: 1 }],
      },
    },
    {
      name: `refills an implicit tie window when a visible row moves below it`,
      scenario: {
        ranks: [0, 0, 0, -1, 0],
        direction: `desc`,
        explicitPublicKeyOrder: false,
        includeFilter: false,
        reverseInsertion: false,
        initialWindow: { offset: 0, limit: 4 },
        actions: [{ type: `put`, id: 1, rank: -2, keep: false }],
      },
    },
    {
      name: `opens an implicit tie window from zero at the lowest public key`,
      scenario: {
        ranks: [0],
        direction: `asc`,
        explicitPublicKeyOrder: false,
        includeFilter: false,
        reverseInsertion: false,
        initialWindow: { offset: 0, limit: 0 },
        actions: [
          { type: `put`, id: 2, rank: 0, keep: false },
          { type: `window`, offset: 0, limit: 1 },
          { type: `delete`, id: 1 },
        ],
      },
    },
    {
      name: `ignores an out-of-window insert when refilling after a delete`,
      scenario: {
        ranks: [100, 90, 80, 70],
        direction: `desc`,
        initialWindow: { offset: 0, limit: 3 },
        actions: [
          { type: `put`, id: 5, rank: 10 },
          { type: `delete`, id: 2 },
        ],
      },
    },
    {
      name: `ignores an out-of-window rank update when refilling after a delete`,
      scenario: {
        ranks: [0, 0, 0],
        direction: `asc`,
        initialWindow: { offset: 0, limit: 1 },
        actions: [
          { type: `put`, id: 2, rank: 1 },
          { type: `delete`, id: 1 },
        ],
      },
    },
    {
      name: `ignores an out-of-window rank update when the visible row leaves`,
      scenario: {
        ranks: [0, 0, 0],
        direction: `asc`,
        initialWindow: { offset: 0, limit: 1 },
        actions: [
          { type: `put`, id: 2, rank: 1 },
          { type: `put`, id: 1, rank: 2 },
        ],
      },
    },
    {
      name: `refills untouched rows when widening after an out-of-window rank update`,
      scenario: {
        ranks: [0, 0, 0],
        direction: `desc`,
        initialWindow: { offset: 0, limit: 1 },
        actions: [
          { type: `put`, id: 2, rank: -1 },
          { type: `window`, offset: 0, limit: 3 },
        ],
      },
    },
    {
      name: `rebuilds the full boundary when widening after an out-of-window rank update`,
      scenario: {
        ranks: [1, 0, 1, 0, 1],
        direction: `desc`,
        initialWindow: { offset: 0, limit: 1 },
        actions: [
          { type: `put`, id: 3, rank: 0 },
          { type: `window`, offset: 0, limit: 4 },
        ],
      },
    },
    {
      name: `ignores an out-of-window insert when widening a tied window`,
      scenario: {
        ranks: [0, 0],
        direction: `asc`,
        initialWindow: { offset: 0, limit: 1 },
        actions: [
          { type: `put`, id: 3, rank: 0 },
          { type: `window`, offset: 0, limit: 2 },
        ],
      },
    },
    // Rows entering and leaving the filter. Their model expectations are
    // checked in pagination-model.test.ts.
    ...filterUpdateCases.map((row) => ({
      name: `updates a row that ${row.name}`,
      scenario: filterUpdateScenario(row),
    })),
    ...([`asc`, `desc`] as const).flatMap((direction) =>
      [false, true].flatMap((explicitPublicKeyOrder) =>
        [false, true].flatMap((tied) =>
          [1, 2].map((limit) => {
            const sign = direction === `asc` ? 1 : -1
            return {
              name: `keeps eager window membership when moving past an intervening insert: ${JSON.stringify({ direction, explicitPublicKeyOrder, tied, limit })}`,
              scenario: {
                direction,
                initialWindow: { offset: 0, limit: 1 },
                actions: [
                  {
                    type: `put` as const,
                    id: 3,
                    rank: sign * (tied ? 1 : 2),
                    keep: false,
                  },
                  { type: `window` as const, offset: 1, limit },
                  { type: `put` as const, id: 1, rank: 0, keep: false },
                ],
                ranks: [0, sign],
                keeps: [false, false],
                explicitPublicKeyOrder,
                includeFilter: false,
                reverseInsertion: false,
              },
            }
          }),
        ),
      ),
    ),
    ...(
      [
        [`top-one`, [0, 0], { offset: 0, limit: 1 }, 1, 1],
        [`offset`, [0, 0, 1], { offset: 1, limit: 1 }, 2, 2],
      ] as const
    ).map(([name, ranks, initialWindow, id, rank]) => ({
      name: `refills an implicit ${name} tie window after a rank update`,
      scenario: {
        ranks: [...ranks],
        direction: `asc` as const,
        explicitPublicKeyOrder: false,
        includeFilter: false,
        reverseInsertion: false,
        initialWindow,
        actions: [{ type: `put` as const, id, rank, keep: false }],
      },
    })),
  ]

  oracleProperty({
    id: `pagination.window-transition-fixed`,
    law: {
      statement: `matches full recomputation across source and window transitions for named regressions`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `Named histories that the generated transition grammar cannot take back; each replays runPaginationStateScenario and its comparison.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: windowTransitionFixedHistories,
    label: ({ name }) => name,
    ...orderedComparison(
      ({ scenario }: (typeof windowTransitionFixedHistories)[number]) =>
        runPaginationStateScenario(scenario),
    ),
    check: (_history, _observations, verdict) => verdict,
  })

  // Named regressions of the on-demand cursor law. Each replays
  // runOnDemandPaginationScenario and its recomputation comparison. The
  // generated grammar maps its payload without an unmapper, so it cannot take
  // these histories back; they run as one enumerated source.
  const asyncCursorFixedHistories: ReadonlyArray<{
    name: string
    scenario: PaginationScenario
  }> = [
    {
      name: `discovered trace: loads an on-demand window after a zero limit`,
      scenario: {
        ranks: [0, 0],
        direction: `asc`,
        windows: [
          { offset: 1, limit: 0 },
          { offset: 0, limit: 2 },
        ],
      },
    },
    {
      name: `widens an offset on-demand window after starting at zero limit`,
      scenario: {
        ranks: [-1, 0, 0, 0, -1, 0],
        direction: `asc`,
        windows: [
          { offset: 1, limit: 0 },
          { offset: 4, limit: 1 },
          { offset: 4, limit: 2 },
          { offset: 0, limit: 0 },
        ],
      },
    },
    {
      name: `discovered trace: an async cursor loads the full offset window`,
      scenario: {
        ranks: [0, 0, 0, 0, 0, 0, 1],
        direction: `asc`,
        windows: [
          { offset: 0, limit: 1 },
          { offset: 2, limit: 5 },
        ],
      },
    },
    {
      name: `discovered trace: an async cursor crosses an offset before filling one row`,
      scenario: {
        ranks: [0, 0, -1],
        direction: `asc`,
        windows: [
          { offset: 0, limit: 1 },
          { offset: 2, limit: 1 },
        ],
      },
    },
    ...[`asc`, `desc`].flatMap((direction) =>
      [false, true].flatMap((explicitPublicKeyOrder) =>
        [false, true].map((includeFilter) => {
          const structure = {
            direction: direction as `asc` | `desc`,
            explicitPublicKeyOrder,
            includeFilter,
          }
          return {
            name: `bounds requests for an underfilled source: ${structure.direction}, explicit key=${structure.explicitPublicKeyOrder}, filter=${structure.includeFilter}`,
            scenario: {
              ...structure,
              ranks: [0, 0],
              keeps: [true, false],
              windows: [{ offset: 0, limit: 3 }],
            },
          }
        }),
      ),
    ),
  ]

  oracleProperty({
    id: `pagination.async-cursor-fixed`,
    law: {
      statement: `matches full recomputation when exact async cursor loads widen ordered coverage for named regressions`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `Named histories that the generated window grammar cannot take back; each replays runOnDemandPaginationScenario and its comparison.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: asyncCursorFixedHistories,
    label: ({ name }) => name,
    ...orderedComparison(
      ({ scenario }: (typeof asyncCursorFixedHistories)[number]) =>
        runOnDemandPaginationScenario(scenario),
    ),
    check: (_history, _observations, verdict) => verdict,
  })

  async function runZeroWindowLocalPrefix(): Promise<void> {
    await runOnDemandPaginationScenario(
      {
        ranks: [0, 1],
        direction: `asc`,
        explicitPublicKeyOrder: false,
        windows: [
          { offset: 0, limit: 0 },
          { offset: 0, limit: 1 },
        ],
        localRowsBeforeFirstRequest: [{ id: 2, rank: 1 }],
      },
      (loads) => {
        expect(loads[0]?.cursor).toBeUndefined()
        expect(loads[0]?.offset).toBe(0)
        expect(loads[0]?.limit).toBe(1)
      },
    )
  }

  oracleProperty({
    id: `pagination.zero-window-local-prefix`,
    law: namedHistoriesLaw(
      `starts an on-demand source prefix after opening a zero window with a local row`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: [
      {
        name: `starts an on-demand source prefix after opening a zero window with a local row`,
      },
    ],
    label: ({ name }) => name,
    ...orderedComparison(runZeroWindowLocalPrefix),
    check: (_history, _observations, verdict) => verdict,
  })

  const failedWindowReplayCases = ([`asc`, `desc`] as const).flatMap(
    (direction) =>
      ([`sync`, `async`] as const).map((replayDelivery) => ({
        direction,
        replayDelivery,
      })),
  )

  async function runFailedWindowReplay({
    direction,
    replayDelivery,
  }: (typeof failedWindowReplayCases)[number]): Promise<void> {
    const rows: Array<PageRow> = [
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
    ]
    const failure = new Error(`window acquisition failed`)
    const replayGate = createDeferred<void>()
    let operations!: Parameters<SyncConfig<PageRow, number>[`sync`]>[0]
    let loads = 0
    const source = createCollection<PageRow, number>({
      id: `pagination-failed-window-replay-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (sync) => {
          operations = sync
          sync.markReady()
          return {
            loadSubset: (options) => {
              loads++
              sync.begin()
              for (const row of loads === 1 ? rows.slice(0, 1) : rows) {
                sync.write({ type: `insert`, value: { ...row } })
              }
              const receipt = sync.commit(options.signal)
              if (loads === 1) return Promise.reject(failure)
              if (replayDelivery === `sync`) return receipt
              return replayGate.promise.then(async () => {
                if (receipt !== true) await receipt
              })
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank, direction)
        .limit(0)
        .select(({ row }) => ({ id: row.id, rank: row.rank }))
        .distinct(),
    )
    const publications: Array<Array<number>> = []
    const subscriber = live.subscribeChanges(() => {
      publications.push(Array.from(live.values(), ({ id }) => id))
    })
    const assertHeld = () => {
      expect(Array.from(live.values())).toEqual([])
      expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 0 })
      expect(publications).toEqual([])
    }
    try {
      await live.preload()
      await expect(live.utils.setWindow({ offset: 0, limit: 2 })).rejects.toBe(
        failure,
      )
      assertHeld()
      operations.begin()
      operations.truncate()
      const receipt = operations.commit()
      if (receipt !== true) await receipt
      await flushPromises()
      assertHeld()
      replayGate.resolve()
      await flushPromises()
      await flushPromises()
      expect(loads).toBe(2)
      assertHeld()

      await live.utils.setWindow({ offset: 0, limit: 2 })
      const expected = referenceWindow(rows, direction, {
        offset: 0,
        limit: 2,
      })
      expect(Array.from(live.values(), ({ id }) => id)).toEqual(expected)
      expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
      expect(publications).toEqual([expected])
    } finally {
      replayGate.resolve()
      subscriber.unsubscribe()
      await cleanupAll(live, source)
    }
  }

  oracleProperty({
    id: `pagination.failed-window-replay`,
    law: namedHistoriesLaw(
      `keeps a failed window private after source replay until explicit retry`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: failedWindowReplayCases,
    label: (row) =>
      `keeps a failed ${String(row.direction)} window private after ${String(row.replayDelivery)} source replay until explicit retry`,
    ...orderedComparison(runFailedWindowReplay),
    check: (_history, _observations, verdict) => verdict,
  })

  const rejectedFirstPrefixCases = [
    { offset: 0, limit: 1, failureKind: `error` as const },
    { offset: 2, limit: 1, failureKind: `error` as const },
    { offset: 0, limit: 1, failureKind: `abort` as const },
    { offset: 2, limit: 1, failureKind: `abort` as const },
  ]

  async function runRejectedFirstPrefix({
    failureKind,
    ...window
  }: (typeof rejectedFirstPrefixCases)[number]): Promise<void> {
    const authoritativeRows: Array<PageRow> = [
      { id: 1, rank: 0 },
      { id: 2, rank: 1 },
      { id: 3, rank: 2 },
      { id: 4, rank: 3 },
    ]
    const requests: Array<LoadSubsetOptions> = []
    const firstRequest = createDeferred<void>()
    const deliveredIds = new Set<number>([4])
    let begin!: () => void
    let write!: (message: { type: `insert`; value: PageRow }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-rejected-first-prefix-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          operations.markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              requests.push(options)
              if (requests.length === 1) return firstRequest.promise

              begin()
              for (const row of rowsForLoadSubset(authoritativeRows, options)) {
                if (deliveredIds.has(row.id)) continue
                deliveredIds.add(row.id)
                write({ type: `insert`, value: { ...row } })
              }
              commit()
              return true
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.rank, `asc`)
        .limit(0),
    )

    try {
      await live.preload()
      begin()
      write({ type: `insert`, value: { ...authoritativeRows[3]! } })
      commit()

      const requestedPrefix = window.offset + window.limit
      const failed = live.utils.setWindow(window)
      expect(failed).toBeInstanceOf(Promise)
      expect(requests[0]).toMatchObject({
        offset: 0,
        limit: requestedPrefix,
      })
      expect(requests[0]?.cursor).toBeUndefined()
      const failure =
        failureKind === `abort`
          ? new DOMException(`first ordered request canceled`, `AbortError`)
          : new Error(`first ordered request failed`)
      firstRequest.reject(failure)
      await expect(failed).rejects.toBe(failure)

      const retry = live.utils.setWindow(window)
      if (retry instanceof Promise) await retry
      expect(requests[1]?.limit).toBeUndefined()
      expect(requests[1]?.offset).toBeUndefined()
      expect(requests[1]?.cursor).toBeUndefined()
      expect(requests).toHaveLength(2)
      expect(Array.from(live.values(), ({ id }) => id)).toEqual(
        referenceWindow(authoritativeRows, `asc`, window),
      )
    } finally {
      firstRequest.resolve()
      await cleanupAll(live, source)
    }
  }

  oracleProperty({
    id: `pagination.rejected-first-prefix`,
    law: namedHistoriesLaw(
      `recovers the first rejected ordered request for a window from the full source`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: rejectedFirstPrefixCases,
    label: (row) =>
      `recovers the first ${String(row.failureKind)}-rejected ordered request for window ${String(row.offset)}:${String(row.limit)} from the full source`,
    ...orderedComparison(runRejectedFirstPrefix),
    check: (_history, _observations, verdict) => verdict,
  })

  const filteredBoundedRepairCases = [
    [`visible delete`, { type: `delete`, id: 1 }],
    [
      `visible rank update`,
      { type: `update`, row: { id: 2, rank: 4, keep: true } },
    ],
  ] satisfies ReadonlyArray<readonly [string, PendingMutation]>

  async function runFilteredBoundedRepair([
    _name,
    mutation,
  ]: (typeof filteredBoundedRepairCases)[number]): Promise<void> {
    const result = await runPendingMutationScenario(
      {
        ranks: [0, 1, 2, 3],
        direction: `asc`,
        limit: 3,
        mutation,
        responseOutcome: `resolve`,
        includeFilter: true,
      },
      `after-response`,
    )

    expectFilteredBoundedRepairTrace(result, `asc`, 3)
  }

  oracleProperty({
    id: `pagination.filtered-bounded-repair`,
    law: namedHistoriesLaw(
      `repairs an expressible order with a bounded prefix request`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: filteredBoundedRepairCases,
    label: (row) =>
      `${String(row[0])} repairs an expressible order with a bounded prefix request`,
    ...orderedComparison(runFilteredBoundedRepair),
    check: (_history, _observations, verdict) => verdict,
  })

  async function runUnderfilledBoundedRepair(): Promise<void> {
    const result = await runPendingMutationScenario(
      {
        ranks: [0, 1, 2],
        direction: `asc`,
        limit: 10,
        mutation: { type: `delete`, id: 1 },
        responseOutcome: `resolve`,
      },
      `after-response`,
      undefined,
      false,
    )

    expectPendingMutationRequestWork(
      result,
      {
        ranks: [0, 1, 2],
        direction: `asc`,
        limit: 10,
        mutation: { type: `delete`, id: 1 },
        responseOutcome: `resolve`,
      },
      false,
    )
    expect(result.releasedBeforeCleanup).toHaveLength(3)
  }

  oracleProperty({
    id: `pagination.underfilled-bounded-repair`,
    law: namedHistoriesLaw(
      `finishes bounded repair when a visible delete leaves the source underfilled`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: [
      {
        name: `finishes bounded repair when a visible delete leaves the source underfilled`,
      },
    ],
    label: ({ name }) => name,
    ...orderedComparison(runUnderfilledBoundedRepair),
    check: (_history, _observations, verdict) => verdict,
  })

  const cappedPrefixRepairCases = [false, true].map(
    (explicitPublicKeyOrder) => ({ explicitPublicKeyOrder }),
  )

  async function runCappedPrefixRepair({
    explicitPublicKeyOrder,
  }: (typeof cappedPrefixRepairCases)[number]): Promise<void> {
    const result = await runPendingMutationScenario(
      {
        ranks: [0, 1, 1, 2],
        direction: `asc`,
        limit: 3,
        mutation: { type: `delete`, id: 1 },
        responseOutcome: `resolve`,
        orderedResponseLimit: 1,
      },
      `after-response`,
      undefined,
      explicitPublicKeyOrder,
    )
    const requests = result.mutationRepairRequests

    expect(
      requests.map((request) =>
        request.orderBy ? (request.cursor ? `refill` : `prefix`) : `tie`,
      ),
    ).toEqual([`prefix`, `tie`, `refill`, `tie`])
    const [prefix, firstTie, refill, secondTie] = requests
    expect(orderSignature(prefix!)).toStrictEqual(
      expectedOrderSignature(`asc`, explicitPublicKeyOrder),
    )
    expect(prefix!.where).toBeUndefined()
    expect(prefix!.limit).toBe(3)
    expect(prefix!.refetch).toBe(true)
    expect(prefix!.cursor).toBeUndefined()
    expect(prefix!.offset).toBeUndefined()
    expectPredicateBehavior(
      firstTie!.where,
      [{ id: 2, rank: 1 }],
      [
        { id: 1, rank: 0 },
        { id: 4, rank: 2 },
      ],
    )
    expect(firstTie!.orderBy).toBeUndefined()
    expect(firstTie!.limit).toBeUndefined()
    expect(firstTie!.refetch).toBe(true)
    expect(firstTie!.cursor).toBeUndefined()
    expect(firstTie!.offset).toBeUndefined()
    expect(orderSignature(refill!)).toStrictEqual(
      expectedOrderSignature(`asc`, explicitPublicKeyOrder),
    )
    expect(refill?.limit).toBe(1)
    expect(refill?.refetch).toBe(true)
    expect(refill?.cursor).toBeDefined()
    expectPredicateBehavior(
      secondTie!.where,
      [{ id: 4, rank: 2 }],
      [{ id: 2, rank: 1 }],
    )
    expect(secondTie!.orderBy).toBeUndefined()
    expect(secondTie!.limit).toBeUndefined()
    expect(secondTie!.refetch).toBe(true)
    expect(secondTie!.cursor).toBeUndefined()
    expect(secondTie!.offset).toBeUndefined()
  }

  oracleProperty({
    id: `pagination.capped-prefix-repair`,
    law: namedHistoriesLaw(
      `repairs a capped prefix through its first-column tie and cursor refill`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: cappedPrefixRepairCases,
    label: (row) =>
      `repairs a capped prefix through its first-column tie and cursor refill (explicit key=${String(row.explicitPublicKeyOrder)})`,
    ...orderedComparison(runCappedPrefixRepair),
    check: (_history, _observations, verdict) => verdict,
  })

  const boundaryRefinementFailureCases = ([`asc`, `desc`] as const).flatMap(
    (direction) =>
      ([`throw`, `reject`] as const).map((delivery) => ({
        direction,
        delivery,
      })),
  )

  async function runBoundaryRefinementFailure({
    direction,
    delivery,
  }: (typeof boundaryRefinementFailureCases)[number]): Promise<void> {
    const sign = direction === `asc` ? 1 : -1
    const rows: Array<PageRow> = [
      { id: 1, rank: sign },
      { id: 2, rank: 2 * sign },
    ]
    const liveInsert: PageRow = { id: 0, rank: 0 }
    const delivered = new Set<number>()
    const failure = new Error(`later boundary failed`)
    let widening = false
    let failedBoundary: LoadSubsetOptions | undefined
    let suppliedPage: Array<PageRow> | undefined
    const source = createCollection<PageRow>({
      id: `pagination-boundary-publication-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              const selected = rowsForLoadSubset(rows, options)
              if (
                widening &&
                options.where &&
                !options.orderBy &&
                selected.some(({ id }) => id === 2) &&
                !failedBoundary
              ) {
                failedBoundary = options
                if (delivery === `throw`) throw failure
                return Promise.reject(failure)
              }
              const newRows = selected.filter(({ id }) => !delivered.has(id))
              begin()
              for (const row of newRows) {
                delivered.add(row.id)
                write({ type: `insert`, value: { ...row } })
              }
              if (widening && options.orderBy && !suppliedPage) {
                suppliedPage = newRows
                rows.push(liveInsert)
                delivered.add(liveInsert.id)
                write({ type: `insert`, value: { ...liveInsert } })
              }
              const receipt = commit(options.signal)
              // Make the page asynchronous so the failure is in its later
              // refinement, not the synchronous setWindow call stack.
              return Promise.resolve(receipt).then(() => undefined)
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank, direction)
        .limit(1),
    )
    const publications: Array<Array<number>> = []
    const subscription = live.subscribeChanges(() => {
      publications.push(Array.from(live.values(), ({ id }) => id))
    })
    try {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])
      publications.length = 0
      widening = true
      await expect(live.utils.setWindow({ offset: 0, limit: 2 })).rejects.toBe(
        failure,
      )
      expect(suppliedPage?.map(({ id }) => id)).toEqual([2])
      expect(failedBoundary).toBeDefined()
      expect(
        rowsForLoadSubset(rows, failedBoundary!).map(({ id }) => id),
      ).toEqual([2])
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])
      expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
      expect(publications).toEqual([])
      await live.utils.setWindow({ offset: 0, limit: 2 })
      const expected = referenceWindow(rows, direction, {
        offset: 0,
        limit: 2,
      })
      expect(Array.from(live.values(), ({ id }) => id)).toEqual(expected)
      expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
      expect(publications).toEqual([expected])
    } finally {
      subscription.unsubscribe()
      await cleanupAll(live, source)
    }
  }

  oracleProperty({
    id: `pagination.boundary-refinement-failure`,
    law: namedHistoriesLaw(
      `holds a page and concurrent live insert when its boundary refinement fails`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: boundaryRefinementFailureCases,
    label: (row) =>
      `holds a ${String(row.direction)} page and concurrent live insert when its boundary refinement fails by ${String(row.delivery)}`,
    ...orderedComparison(runBoundaryRefinementFailure),
    check: (_history, _observations, verdict) => verdict,
  })

  const nullableBoundaryRows: ReadonlyArray<MultiOrderRow> = [
    { id: 1, primary: null, secondary: 2 },
    { id: 2, primary: null, secondary: 0 },
    { id: 3, primary: null, secondary: 1 },
    { id: 4, primary: 1, secondary: null },
    { id: 5, primary: 1, secondary: 0 },
    { id: 6, primary: 2, secondary: 0 },
  ]

  // Named nullable multi-column boundaries. Each replays runMultiOrderScenario
  // and its referenceMultiOrder comparison. The generated grammar maps its
  // rows without an unmapper, so it cannot take these histories back.
  const multiOrderFixedHistories: ReadonlyArray<{
    name: string
    scenario: MultiOrderScenario
  }> = [
    ...(
      [
        [
          `discovered trace: orders an ascending nullable boundary by its second term`,
          {
            rows: nullableBoundaryRows,
            primary: { direction: `asc`, nulls: `first` },
            secondary: { direction: `asc`, nulls: `first` },
            limit: 1,
          },
        ],
        [
          `orders a descending nullable boundary by its second term`,
          {
            rows: nullableBoundaryRows,
            primary: { direction: `desc`, nulls: `first` },
            secondary: { direction: `desc`, nulls: `first` },
            limit: 1,
          },
        ],
        [
          `orders an ascending and descending mixed nullable boundary`,
          {
            rows: nullableBoundaryRows,
            primary: { direction: `asc`, nulls: `first` },
            secondary: { direction: `desc`, nulls: `first` },
            limit: 1,
          },
        ],
        [
          `discovered trace: orders a descending and ascending mixed nullable boundary`,
          {
            rows: nullableBoundaryRows,
            primary: { direction: `desc`, nulls: `first` },
            secondary: { direction: `asc`, nulls: `first` },
            limit: 1,
          },
        ],
        [
          `uses the public key to break a complete tuple tie`,
          {
            rows: [
              { id: 2, primary: 0, secondary: 0 },
              { id: 1, primary: 0, secondary: 0 },
            ],
            primary: { direction: `asc`, nulls: `last` },
            secondary: { direction: `asc`, nulls: `last` },
            limit: 1,
          },
        ],
        [
          `discovered trace: places nulls last in an ascending nullable boundary`,
          {
            rows: nullableBoundaryRows,
            primary: { direction: `asc`, nulls: `last` },
            secondary: { direction: `asc`, nulls: `last` },
            limit: 1,
          },
        ],
        [
          `places nulls last in a descending nullable boundary`,
          {
            rows: nullableBoundaryRows,
            primary: { direction: `desc`, nulls: `last` },
            secondary: { direction: `desc`, nulls: `last` },
            limit: 1,
          },
        ],
      ] satisfies ReadonlyArray<readonly [string, MultiOrderScenario]>
    ).map(([name, scenario]) => ({ name, scenario })),
    {
      name: `expands a multi-column boundary before choosing top-K`,
      scenario: {
        rows: [
          { id: 1, primary: 0, secondary: 2 },
          { id: 2, primary: 0, secondary: 0 },
          { id: 3, primary: 0, secondary: 1 },
          { id: 4, primary: 1, secondary: 1 },
          { id: 5, primary: 1, secondary: 0 },
          { id: 6, primary: 2, secondary: 0 },
        ],
        primary: { direction: `asc`, nulls: `first` },
        secondary: { direction: `asc`, nulls: `first` },
        limit: 4,
      },
    },
  ]

  oracleProperty({
    id: `pagination.multi-order-fixed`,
    law: {
      statement: `matches multi-column nullable ordering for named boundaries`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `Named histories that the generated multi-order grammar cannot take back; each replays runMultiOrderScenario and its comparison.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: multiOrderFixedHistories,
    label: ({ name }) => name,
    ...orderedComparison(
      ({ scenario }: (typeof multiOrderFixedHistories)[number]) =>
        runMultiOrderScenario(scenario),
    ),
    check: (_history, _observations, verdict) => verdict,
  })

  oracleProperty({
    id: `pagination.multi-order`,
    law: {
      statement: `matches multi-column nullable ordering for a random or replayed seed`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: {
      arbitrary: multiOrderScenarioArbitrary,
      runs: 12,
      fixedSeeds: [1663],
    },
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, async () => {
        const scenario = history

        await runMultiOrderScenario(scenario)
      }),
    check: (_history, _observations, verdict) => verdict,
  })

  oracleProperty({
    id: `pagination.nullable-cursor`,
    law: {
      statement: `matches nullable cursor ordering while an async response is pending for a random or replayed seed`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: {
      arbitrary: nullableCursorScenarioArbitrary,
      runs: 8,
      fixedSeeds: [1665],
    },
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, async () => {
        const scenario = history

        await runNullableCursorScenario(scenario)
      }),
    check: (_history, _observations, verdict) => verdict,
  })

  // Named pending-mutation regressions. Each history lists the calls of
  // runPendingMutationScenario that its old test made, with the same
  // arguments; that driver keeps its own recomputation comparison. The
  // generated grammar maps its payload without an unmapper, so it cannot take
  // these histories back.
  const pendingMutationFixedHistories: ReadonlyArray<PendingMutationFixedHistory> =
    [
      ...(
        [
          [`boundary insert`, { type: `insert`, row: { id: 5, rank: 0.5 } }],
          [`visible delete`, { type: `delete`, id: 1 }],
          [
            `boundary-crossing rank update`,
            { type: `update`, row: { id: 4, rank: 0.5 } },
          ],
        ] satisfies ReadonlyArray<readonly [string, PendingMutation]>
      ).map(([name, mutation]) => {
        const scenario: PendingMutationScenario = {
          ranks: [0, 1, 2, 3],
          direction: `asc`,
          limit: 3,
          mutation,
          responseOutcome: `resolve`,
        }
        return {
          name: `${name} converges before and after a pending response`,
          runs: [
            { scenario, timing: `before-response` as const },
            { scenario, timing: `after-response` as const },
          ],
        }
      }),
      ...(
        [
          [`insert`, { type: `insert`, row: { id: 9, rank: 0.5 } }],
          [`delete`, { type: `delete`, id: 1 }],
          [`rank update`, { type: `update`, row: { id: 2, rank: 10 } }],
        ] satisfies ReadonlyArray<readonly [string, PendingMutation]>
      ).map(([name, mutation]) => ({
        name: `revalidates a finite ordered prefix after a settled SSE ${name}`,
        runs: [
          {
            scenario: {
              ranks: [0, 1, 2, 3, 4, 5, 6, 7],
              direction: `asc` as const,
              limit: 2,
              mutation,
              responseOutcome: `resolve` as const,
            },
            timing: `after-response` as const,
          },
        ],
      })),
      {
        name: `does not use a new row beyond finite coverage as a widening boundary`,
        runs: [
          {
            scenario: {
              ranks: [0, 1, 2, 3, 4, 5, 6, 7],
              direction: `asc`,
              limit: 2,
              mutation: { type: `insert`, row: { id: 9, rank: 4.5 } },
              responseOutcome: `resolve`,
            },
            timing: `after-response`,
            finalLimitAfterMutation: 5,
          },
        ],
      },
      {
        name: `discovered trace: a settled rank update refreshes top-k membership`,
        runs: [
          {
            scenario: {
              ranks: [0, 0, 1],
              direction: `desc`,
              limit: 1,
              mutation: { type: `update`, row: { id: 3, rank: 0 } },
              responseOutcome: `resolve`,
            },
            timing: `after-response`,
          },
        ],
      },
      {
        name: `a rejected cursor does not treat a live insert as remote coverage`,
        runs: [
          {
            scenario: {
              ranks: [0, -1, 0],
              direction: `asc`,
              limit: 1,
              mutation: { type: `insert`, row: { id: 4, rank: 0 } },
              responseOutcome: `reject`,
            },
            timing: `before-response`,
          },
        ],
      },
      ...([`insert`, `update`, `delete`] as const).flatMap((mutationKind) =>
        ([`resolve`, `reject`] as const).flatMap((responseOutcome) =>
          ([`before-response`, `after-response`] as const).map((timing) => {
            const mutation: PendingMutation =
              mutationKind === `insert`
                ? { type: `insert`, row: { id: 5, rank: -1 } }
                : mutationKind === `update`
                  ? { type: `update`, row: { id: 2, rank: -1 } }
                  : { type: `delete`, id: 2 }
            return {
              name: `covers pending ${mutationKind} with a ${responseOutcome} response ${timing} deterministically`,
              runs: [
                {
                  scenario: {
                    ranks: [0, 1, 2, 3],
                    direction: `asc` as const,
                    limit: 2,
                    mutation,
                    responseOutcome,
                  },
                  timing,
                },
              ],
            }
          }),
        ),
      ),
      ...([`asc`, `desc`] as const).flatMap((direction) =>
        ([`before-response`, `after-response`] as const).flatMap((timing) =>
          [0.5, 100].flatMap((rank) =>
            ([`cursor`, `offset`] as const).map((transport) => {
              const sign = direction === `asc` ? 1 : -1
              return {
                name: `keeps live observations separate from a settled acquisition: ${JSON.stringify({ direction, timing, rank, transport })}`,
                runs: [
                  {
                    scenario: {
                      ranks: [0, sign, 2 * sign, 3 * sign],
                      direction,
                      limit: 1,
                      mutation: {
                        type: `insert` as const,
                        row: { id: 9, rank: sign * rank },
                      },
                      responseOutcome: `resolve` as const,
                    },
                    timing,
                    finalLimitAfterMutation: 3,
                    explicitPublicKeyOrder: false,
                    transport,
                  },
                ],
              }
            }),
          ),
        ),
      ),
    ]

  oracleProperty({
    id: `pagination.pending-mutation-fixed`,
    law: {
      statement: `matches recomputation when source mutations cross a pending cursor response for named regressions`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `Named histories that the generated pending-mutation grammar cannot take back; each replays runPendingMutationScenario with its old arguments and that driver's comparison.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: pendingMutationFixedHistories,
    label: ({ name }) => name,
    ...orderedComparison(runPendingMutationRuns),
    check: (_history, _observations, verdict) => verdict,
  })

  // A reached fault must be rejected. Each calibration corrupts production
  // through runPendingMutationScenario's fault argument, on the history whose
  // clean run the old test made first, and accepts exactly the old matcher.
  const pendingMutationCalibrationHistories: ReadonlyArray<PendingMutationFixedHistory> =
    [
      ...([`resolve`, `reject`] as const).map((responseOutcome) => ({
        name: `inserts before a pending ${responseOutcome} response (calibration premise)`,
        runs: [
          {
            scenario: {
              ranks: [0, 1, 2, 3],
              direction: `asc` as const,
              limit: 2,
              mutation: { type: `insert` as const, row: { id: 5, rank: -1 } },
              responseOutcome,
            },
            timing: `before-response` as const,
          },
        ],
      })),
      {
        name: `deletes a visible row after a pending response (calibration premise)`,
        runs: [
          {
            scenario: {
              ranks: [0, 1, 2, 3],
              direction: `asc`,
              limit: 2,
              mutation: { type: `delete`, id: 1 },
              responseOutcome: `resolve`,
            },
            timing: `after-response`,
          },
        ],
      },
    ]

  oracleProperty({
    id: `pagination.pending-mutation-calibration`,
    law: {
      statement: `matches recomputation when source mutations cross a pending cursor response, and rejects each reached publication fault`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The three calibration premises of the old fault tests; each fault runs on the premise whose clean run its old test made.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: pendingMutationCalibrationHistories,
    label: ({ name }) => name,
    ...orderedComparison(runPendingMutationRuns),
    check: (_history, _observations, verdict) => verdict,
    calibrations: [
      ...([`resolve`, `reject`] as const).flatMap((responseOutcome) =>
        (
          [
            [
              `held-publication`,
              /held mutation publication|failed mutation keeps complete baseline/,
            ],
            [`held-window`, /held mutation window/],
            [`early-settlement`, /held mutation logical settlement/],
            [`callback-key`, /mutation native callback key/],
            [`callback-value`, /mutation callback replica full values/],
            [
              `final-value`,
              /mutation callback replica full values|complete final mutation values/,
            ],
            ...(responseOutcome === `reject`
              ? [
                  [
                    `wrong-rejection`,
                    /failed mutation caller exact error/,
                  ] as const,
                ]
              : []),
          ] as const
        ).map(([fault, message]) => ({
          name: `rejects a reached ${fault} in a ${responseOutcome} mutation history`,
          law: `calibration ${fault} ${responseOutcome}`,
          driver: pendingMutationFaultDriver(
            `inserts before a pending ${responseOutcome} response (calibration premise)`,
            fault,
            message,
            `calibration ${fault} ${responseOutcome}`,
          ),
        })),
      ),
      {
        name: `rejects a wrong deleted payload before removing its replica row`,
        law: `calibration delete-value`,
        driver: pendingMutationFaultDriver(
          `deletes a visible row after a pending response (calibration premise)`,
          `delete-value`,
          /mutation deleted callback full value/,
          `calibration delete-value`,
        ),
      },
    ],
  })

  const ssePrefixRefreshCases = ([`asc`, `desc`] as const).map((direction) => ({
    direction,
  }))

  async function runSsePrefixRefresh({
    direction,
  }: (typeof ssePrefixRefreshCases)[number]): Promise<void> {
    const rows = new Map<number, PageRow>(
      Array.from({ length: 6 }, (_, index) => [
        index + 1,
        { id: index + 1, rank: index + 1 },
      ]),
    )
    const delivered = new Set<number>()
    const loads: Array<LoadSubsetOptions> = []
    let begin!: () => void
    let write!: (message: { type: `insert` | `update`; value: PageRow }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-batch-prefix-refresh-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          params.markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              loads.push(options)
              const settled = new Promise<void>((resolve) => {
                queueMicrotask(() => {
                  const ordered = referenceWindowRows(
                    [...rows.values()],
                    direction,
                    { offset: 0, limit: rows.size },
                  )
                  begin()
                  for (const row of rowsForLoadSubset(ordered, options)) {
                    if (delivered.has(row.id)) continue
                    delivered.add(row.id)
                    write({ type: `insert`, value: { ...row } })
                  }
                  commit()
                  resolve()
                })
              })
              return settled
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.rank, direction)
        .orderBy(({ row }) => row.id, `asc`)
        .limit(2),
    )

    try {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual(
        direction === `asc` ? [1, 2] : [6, 5],
      )

      begin()
      const movedIds = direction === `asc` ? [1, 2, 3, 4] : [3, 4, 5, 6]
      for (const id of movedIds) {
        const row = {
          id,
          rank: direction === `asc` ? 100 + id : -100 - id,
        }
        rows.set(id, row)
        write({ type: `update`, value: { ...row } })
      }
      commit()
      for (let index = 0; index < 5; index++) await flushPromises()

      expect(Array.from(live.values(), ({ id }) => id)).toEqual(
        direction === `asc` ? [5, 6] : [2, 1],
      )
      expect(
        loads.some(({ limit, cursor }) => limit === 2 && cursor === undefined),
      ).toBe(true)
    } finally {
      await cleanupAll(live, source)
    }
  }

  oracleProperty({
    id: `pagination.sse-prefix-refresh`,
    law: namedHistoriesLaw(
      `refreshes from the start when one SSE batch moves the retained prefix`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: ssePrefixRefreshCases,
    label: (row) =>
      `refreshes from the start when one SSE batch moves the retained prefix (${String(row.direction)})`,
    ...orderedComparison(runSsePrefixRefresh),
    check: (_history, _observations, verdict) => verdict,
  })

  const sseBoundaryRefinementCases = [
    [`insert`, { type: `insert`, row: { id: 7, rank: 0 } }, [7, 1], [7, 1, 2]],
    [`update`, { type: `update`, row: { id: 2, rank: -1 } }, [2, 1], [2, 1, 3]],
    [`delete`, { type: `delete`, id: 1 }, [2, 3], [2, 3, 4]],
  ] satisfies ReadonlyArray<
    readonly [
      string,
      PendingMutation,
      ReadonlyArray<number>,
      ReadonlyArray<number>,
    ]
  >

  async function runSseBoundaryRefinement([
    _name,
    mutation,
    expectedIds,
    expectedWideIds,
  ]: (typeof sseBoundaryRefinementCases)[number]): Promise<void> {
    const rows = new Map<number, PageRow>(
      Array.from({ length: 6 }, (_, index) => [
        index + 1,
        { id: index + 1, rank: index + 1 },
      ]),
    )
    const delivered = new Set<number>()
    const pending: Array<PendingCursorLoad> = []
    let begin!: () => void
    let write!: (message: {
      type: `insert` | `update` | `delete`
      value: PageRow
    }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-pending-refinement-sse-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          params.markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              const deferred = createDeferred<void>()
              pending.push({ options, deferred })
              return deferred.promise
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.rank, `asc`)
        .orderBy(({ row }) => row.id, `asc`)
        .limit(2),
    )

    const settle = async (request: PendingCursorLoad) => {
      const ordered = referenceWindowRows([...rows.values()], `asc`, {
        offset: 0,
        limit: rows.size,
      })
      begin()
      for (const row of rowsForLoadSubset(ordered, request.options)) {
        if (delivered.has(row.id)) continue
        delivered.add(row.id)
        write({ type: `insert`, value: { ...row } })
      }
      commit()
      request.deferred.resolve()
      await flushPromises()
    }

    try {
      const preload = live.preload()
      expect(pending).toHaveLength(1)
      await settle(pending[0]!)
      expect(pending).toHaveLength(2)

      begin()
      if (mutation.type === `delete`) {
        const row = rows.get(mutation.id)!
        rows.delete(mutation.id)
        delivered.delete(mutation.id)
        write({ type: `delete`, value: { ...row } })
      } else {
        rows.set(mutation.row.id, { ...mutation.row })
        delivered.add(mutation.row.id)
        write({ type: mutation.type, value: { ...mutation.row } })
      }
      commit()

      await settle(pending[1]!)
      expect(
        pending.some(
          ({ options }) => options.limit === 2 && options.cursor === undefined,
        ),
      ).toBe(true)
      for (let index = 2; index < pending.length; index++) {
        await settle(pending[index]!)
      }
      await preload

      expect(Array.from(live.values(), ({ id }) => id)).toEqual(expectedIds)

      const pendingBeforeWiden = pending.length
      const widened = live.utils.setWindow({ offset: 0, limit: 3 })
      await flushPromises()
      if (mutation.type !== `insert`) {
        // When an SSE update or delete arrives during boundary refinement, after the
        // boundary settles, the loader uses a bounded prefix repair instead of
        // full-source: orderBy is defined, limit is defined (= offset + limit),
        // and cursor/offset/where are undefined.
        expect(
          pending.some(
            ({ options }) =>
              options.orderBy !== undefined &&
              options.limit !== undefined &&
              options.where === undefined &&
              options.cursor === undefined &&
              options.offset === undefined,
          ),
        ).toBe(true)
      }
      if (mutation.type === `insert`) {
        expect(widened).toBe(true)
        expect(pending).toHaveLength(pendingBeforeWiden)
      } else {
        // The bounded repair proves coverage only through its own prefix,
        // so widening continues with finite requests. None reads the full
        // source.
        for (let index = pendingBeforeWiden; index < pending.length; index++) {
          await settle(pending[index]!)
        }
        await widened
        const widening = pending.slice(pendingBeforeWiden)
        expect(widening.length).toBeGreaterThan(0)
        expect(
          widening.every(
            ({ options }) =>
              options.orderBy !== undefined || options.where !== undefined,
          ),
        ).toBe(true)
      }
      expect(Array.from(live.values(), ({ id }) => id)).toEqual(expectedWideIds)
    } finally {
      for (const request of pending) request.deferred.resolve()
      await cleanupAll(live, source)
    }
  }

  oracleProperty({
    id: `pagination.sse-boundary-refinement`,
    law: namedHistoriesLaw(
      `keeps an SSE mutation that arrives during boundary refinement`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: sseBoundaryRefinementCases,
    label: (row) =>
      `keeps an SSE ${String(row[0])} that arrives during boundary refinement`,
    ...orderedComparison(runSseBoundaryRefinement),
    check: (_history, _observations, verdict) => verdict,
  })

  oracleProperty({
    id: `pagination.pending-mutation`,
    law: {
      statement: `matches recomputation when source mutations cross a pending cursor response for a random or replayed seed`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: {
      arbitrary: fc.tuple(
        pendingMutationScenarioArbitrary,
        responseTimingArbitrary,
      ),
      runs: 8,
      fixedSeeds: [1660],
    },
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, async () => {
        const [scenario, timing] = history

        const result = await runPendingMutationScenario(scenario, timing)
        expectPendingMutationRequestWork(result, scenario)
      }),
    check: (_history, _observations, verdict) => verdict,
  })

  oracleProperty({
    id: `pagination.rejected-cursor-retry`,
    law: namedHistoriesLaw(
      `discovered trace: retries a rejected cursor after a source and window transition`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: [
      {
        name: `discovered trace: retries a rejected cursor after a source and window transition`,
      },
    ],
    label: ({ name }) => name,
    ...orderedComparison(runRejectedCursorRetryAfterMutation),
    check: (_history, _observations, verdict) => verdict,
  })

  // A captured pending history must reject each publication fault. The
  // premise is the clean history that the old calibration ran first; each
  // calibration accepts exactly the old matcher.
  const pendingHistoryCalibrationHistories: ReadonlyArray<{
    name: string
    scenario: PendingHistoryScenario
  }> = [
    {
      name: `captured pending history (calibration premise)`,
      scenario: {
        ranks: [0, 0, 1, 2],
        direction: `asc`,
        initialLimit: 2,
        narrowLimit: 1,
        wideLimit: 4,
        firstRank: 2,
        secondRank: -2,
      },
    },
  ]

  oracleProperty({
    id: `pagination.pending-history-fixed`,
    law: {
      statement: `matches recomputation across multi-action pending histories, and rejects each captured publication fault`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The one captured pending history of the old calibrations, replayed through runPendingHistoryScenario and its comparison.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: pendingHistoryCalibrationHistories,
    label: ({ name }) => name,
    ...orderedComparison(
      ({ scenario }: (typeof pendingHistoryCalibrationHistories)[number]) =>
        runPendingHistoryScenario(scenario),
    ),
    check: (_history, _observations, verdict) => verdict,
    calibrations: (
      [
        [`partial-publication`, `held initial publication`],
        [`wrong-window`, `held initial window`],
        [`early-settlement`, `held logical settlement`],
        [`wrong-final-value`, `complete publication final`],
        [`wrong-callback-value`, `callback replica full values`],
        [`wrong-callback-key`, `native callback key`],
        [`retracted-publication`, `published window cannot withdraw`],
      ] as const
    ).map(([fault, message]) => ({
      name: `rejects ${fault} in a captured pending history`,
      law: `calibration ${fault}`,
      driver: (
        history: (typeof pendingHistoryCalibrationHistories)[number],
        observe: (checkpoint: string, value: unknown) => void,
      ) =>
        observeComparison(history, observe, async () => {
          try {
            await runPendingHistoryScenario(history.scenario, fault)
          } catch (error) {
            // Exactly the old matcher, toThrowError(message).
            if (error instanceof Error && error.message.includes(message))
              rejectAt(`calibration ${fault}`, error)
            throw error
          }
        }),
    })),
  })

  oracleProperty({
    id: `pagination.pending-history`,
    law: {
      statement: `matches recomputation across multi-action pending histories for a random or replayed seed`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: {
      arbitrary: pendingHistoryScenarioArbitrary,
      runs: 8,
      fixedSeeds: [1664],
    },
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, async () => {
        const scenario = history

        await runPendingHistoryScenario(scenario)
      }),
    check: (_history, _observations, verdict) => verdict,
  })

  for (const [index, structure] of paginationStructures.entries()) {
    const name = `key=${structure.explicitPublicKeyOrder ? `explicit` : `implicit`}, filter=${structure.includeFilter ? `on` : `off`}, insertion=${structure.reverseInsertion ? `reverse` : `forward`}`
    const runWindowCell = async (scenario: PaginationScenario) => {
      const complete = { ...scenario, ...structure }
      await runPaginationScenario(complete)
      await runOnDemandPaginationScenario(complete)
    }
    const runStateCell = async (scenario: PaginationStateScenario) => {
      await runPaginationStateScenario({ ...scenario, ...structure })
    }

    oracleProperty({
      id: `pagination.matrix.window-${index}`,
      law: {
        statement: `covers ${name} window paths for a random or replayed seed [pagination.matrix.window-${index}]`,
        authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
        limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
      },
      owns: [
        'src/collection/index.ts#createCollection',
        'src/indexes/btree-index.ts',
        'src/query/live-query-collection.ts#createLiveQueryCollection',
        'src/utils/comparison.ts#makeComparator',
      ],
      histories: {
        arbitrary: scenarioPayloadArbitrary,
        runs: 1,
        fixedSeeds: [16_570 + index],
      },
      model: (history, observations) =>
        recordedComparison(history, observations),
      driver: async (history, observe) =>
        observeComparison(history, observe, async () => {
          const scenario = history

          await runWindowCell(scenario)
        }),
      check: (_history, _observations, verdict) => verdict,
    })

    oracleProperty({
      id: `pagination.matrix.state-${index}`,
      law: {
        statement: `covers ${name} state paths for a random or replayed seed [pagination.matrix.state-${index}]`,
        authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
        limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
      },
      owns: [
        'src/collection/index.ts#createCollection',
        'src/indexes/btree-index.ts',
        'src/query/live-query-collection.ts#createLiveQueryCollection',
        'src/utils/comparison.ts#makeComparator',
      ],
      histories: {
        arbitrary: stateScenarioPayloadArbitrary,
        runs: 1,
        fixedSeeds: [16_580 + index],
      },
      model: (history, observations) =>
        recordedComparison(history, observations),
      driver: async (history, observe) =>
        observeComparison(history, observe, async () => {
          const scenario = history

          await runStateCell(scenario)
        }),
      check: (_history, _observations, verdict) => verdict,
    })
  }

  oracleProperty({
    id: `pagination.ordered-window`,
    law: {
      statement: `matches full recomputation across ordered windows for a random or replayed seed`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: { arbitrary: scenarioArbitrary, runs: 12, fixedSeeds: [1657] },
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, async () => {
        const scenario = history

        await runPaginationScenario(scenario)
      }),
    check: (_history, _observations, verdict) => verdict,
  })

  oracleProperty({
    id: `pagination.window-transition`,
    law: {
      statement: `matches full recomputation across source and window transitions for a random or replayed seed`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: {
      arbitrary: stateScenarioArbitrary,
      runs: 8,
      fixedSeeds: [1658],
    },
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, async () => {
        const scenario = history

        await runPaginationStateScenario(scenario)
      }),
    check: (_history, _observations, verdict) => verdict,
  })

  const linearRowVolumeCases = ([`asc`, `desc`] as const).flatMap((direction) =>
    ([`pages`, `widen`] as const).flatMap((mode) =>
      [false, true].flatMap((explicitPublicKeyOrder) =>
        [3, 10].map((pageSize) => ({
          direction,
          mode,
          explicitPublicKeyOrder,
          pageSize,
        })),
      ),
    ),
  )

  async function runLinearRowVolume({
    direction,
    mode,
    explicitPublicKeyOrder,
    pageSize,
  }: (typeof linearRowVolumeCases)[number]): Promise<void> {
    const pageCount = 10
    const rows = Array.from({ length: pageCount * pageSize }, (_, rank) => ({
      id: rank + 1,
      rank,
    }))
    const ordered = direction === `asc` ? rows : [...rows].reverse()
    const { source, requests } = createConformingOrderedSource(
      `pagination-transfer-${collectionSequence++}`,
      ordered,
    )
    const live = createLiveQueryCollection((q) => {
      const orderedQuery = q
        .from({ row: source })
        .orderBy(({ row }) => row.rank, direction)
      return (
        explicitPublicKeyOrder
          ? orderedQuery.orderBy(({ row }) => row.id, direction)
          : orderedQuery
      ).limit(pageSize)
    })
    try {
      await live.preload()
      for (let page = 0; page < pageCount; page++) {
        const offset = mode === `pages` ? page * pageSize : 0
        const limit = mode === `pages` ? pageSize : (page + 1) * pageSize
        if (page > 0) await live.utils.setWindow({ offset, limit })
        expect([...live.values()].map(projectPageRow)).toEqual(
          ordered.slice(offset, offset + limit),
        )
      }
      // Count every provider-returned row, including duplicates and tie
      // probes. Request counts alone cannot detect repeated growing prefixes.
      const returnedRows = requests.reduce(
        (total, request) => total + rowsForLoadSubset(ordered, request).length,
        0,
      )
      expect(returnedRows).toBeLessThanOrEqual(rows.length + 2 * pageCount)
      expect(
        requests
          .filter(({ orderBy }) => orderBy !== undefined)
          .every(({ limit }) => limit !== undefined),
      ).toBe(true)
      expect(requests.some((request) => request.cursor !== undefined)).toBe(
        true,
      )
    } finally {
      await live.cleanup()
      await source.cleanup()
    }
  }

  oracleProperty({
    id: `pagination.linear-row-volume`,
    law: namedHistoriesLaw(
      `fetches linear row volume while traversing settled pages`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: linearRowVolumeCases,
    label: (row) =>
      `fetches linear row volume while traversing settled pages: ${JSON.stringify(row)}`,
    ...orderedComparison(runLinearRowVolume),
    check: (_history, _observations, verdict) => verdict,
  })

  const optimisticPrefixRefillCases = (
    [`delete`, `move-after`] as const
  ).flatMap((mutation) => [1, 2].map((count) => ({ mutation, count })))

  async function runOptimisticPrefixRefill({
    mutation,
    count,
  }: (typeof optimisticPrefixRefillCases)[number]): Promise<void> {
    const remote = [1, 2, 3, 4, 5].map((id) => ({ id, rank: id }))
    const delivered = new Set<number>()
    const requests: Array<LoadSubsetOptions> = []
    const heldMutation = createDeferred<void>()
    let sourceOps!: Parameters<
      SyncConfig<(typeof remote)[number], number>[`sync`]
    >[0]
    const source = createCollection({
      id: `pagination-optimistic-prefix-${collectionSequence++}`,
      getKey: (row: (typeof remote)[number]) => row.id,
      syncMode: `on-demand`,
      onDelete: async () => heldMutation.promise,
      onUpdate: async () => heldMutation.promise,
      sync: {
        sync: (operations) => {
          sourceOps = operations
          const { begin, write, commit, markReady } = operations
          markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              requests.push(options)
              const orderedRemote = [...remote].sort(
                (left, right) => left.rank - right.rank,
              )
              const fresh = rowsForLoadSubset(orderedRemote, options).filter(
                ({ id }) => !delivered.has(id),
              )
              if (fresh.length > 0) {
                begin()
                for (const row of fresh) {
                  delivered.add(row.id)
                  write({ type: `insert`, value: row })
                }
                return commit(options.signal)
              }
              return true
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(count),
    )
    try {
      await live.preload()
      expect([...live.values()].map(({ id }) => id)).toEqual(
        remote.slice(0, count).map(({ id }) => id),
      )
      const affected = remote.slice(0, count)
      const transactions = affected.map(({ id }) => {
        if (mutation === `delete`) return source.delete(id)
        else
          return source.update(id, (draft) => {
            draft.rank = 100 + id
          })
      })
      await flushPromises()

      const expected = remote
        .map((row) =>
          row.id <= count && mutation === `move-after`
            ? { ...row, rank: 100 + row.id }
            : row,
        )
        .filter(({ id }) => mutation !== `delete` || id > count)
        .sort((left, right) => left.rank - right.rank)
        .slice(0, count)
        .map(({ id }) => id)
      expect(
        requests.some((request) =>
          rowsForLoadSubset(remote, request).some(
            ({ id }) => id === expected.at(-1),
          ),
        ),
      ).toBe(true)

      // Accept the local mutations in one authoritative source transaction.
      // Provider responses submitted while they were pending may finish
      // afterward; the final public window must still match the model.
      sourceOps.begin()
      for (const row of affected) {
        if (mutation === `delete`) {
          remote.splice(
            remote.findIndex(({ id }) => id === row.id),
            1,
          )
          sourceOps.write({ type: `delete`, value: row })
        } else {
          const updated = { ...row, rank: 100 + row.id }
          remote[remote.findIndex(({ id }) => id === row.id)] = updated
          sourceOps.write({ type: `update`, value: updated })
        }
      }
      const receipt = sourceOps.commit()
      heldMutation.resolve()
      await Promise.all(transactions.map((tx) => tx.when(`settled`)))
      await receipt
      await flushPromises()
      expect([...live.values()].map(({ id }) => id)).toEqual(expected)
    } finally {
      heldMutation.resolve()
      await live.cleanup()
      await source.cleanup()
    }
  }

  oracleProperty({
    id: `pagination.optimistic-prefix-refill`,
    law: namedHistoriesLaw(
      `refills an ordered window past pending optimistic rows`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: optimisticPrefixRefillCases,
    label: (row) =>
      `refills an ordered window past ${String(row.count)} pending optimistic ${String(row.mutation)} row(s)`,
    ...orderedComparison(runOptimisticPrefixRefill),
    check: (_history, _observations, verdict) => verdict,
  })

  const optimisticProviderCoverageCases = (
    [`insert-before`, `move-after`] as const
  ).flatMap((mutation) =>
    [1, 2].flatMap((count) =>
      (mutation === `insert-before` ? [0, 1] : [count]).flatMap(
        (initialLimit) =>
          ([`cursor`, `offset`] as const).map((transport) => ({
            mutation,
            count,
            initialLimit,
            transport,
          })),
      ),
    ),
  )

  async function runOptimisticProviderCoverage({
    mutation,
    count,
    initialLimit,
    transport,
  }: (typeof optimisticProviderCoverageCases)[number]): Promise<void> {
    const remote = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, rank: id }))
    const finalLimit = mutation === `insert-before` ? count + 2 : count + 1
    const delivered = new Set<number>()
    const requests: Array<LoadSubsetOptions> = []
    const heldMutation = createDeferred<void>()
    let sourceOps!: Parameters<
      SyncConfig<(typeof remote)[number], number>[`sync`]
    >[0]
    const source = createCollection({
      id: `pagination-optimistic-continuation-${collectionSequence++}`,
      getKey: (row: (typeof remote)[number]) => row.id,
      syncMode: `on-demand`,
      onInsert: async () => heldMutation.promise,
      onUpdate: async () => heldMutation.promise,
      sync: {
        sync: (operations) => {
          sourceOps = operations
          const { begin, write, commit, markReady } = operations
          markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              requests.push(options)
              const orderedRemote = [...remote].sort(
                (left, right) => left.rank - right.rank,
              )
              const page = rowsForLoadSubset(
                orderedRemote,
                transport === `offset`
                  ? { ...options, cursor: undefined }
                  : options,
              )
              const fresh = page.filter(({ id }) => !delivered.has(id))
              if (fresh.length === 0) return true
              begin()
              for (const row of fresh) {
                delivered.add(row.id)
                write({ type: `insert`, value: row })
              }
              return commit(options.signal)
            },
          }
        },
      },
    })
    source.createIndex((row) => row.rank, { indexType: BTreeIndex })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(initialLimit),
    )
    try {
      await live.preload()
      expect([...live.values()].map(({ id }) => id)).toEqual(
        remote.slice(0, initialLimit).map(({ id }) => id),
      )

      const changed = Array.from({ length: count }, (_, index) =>
        mutation === `insert-before`
          ? { id: -index, rank: -index }
          : { id: index + 1, rank: 100 + index },
      )
      const transactions = changed.map((row) =>
        mutation === `insert-before`
          ? source.insert(row)
          : source.update(row.id, (draft) => {
              draft.rank = row.rank
            }),
      )
      await flushPromises()
      const priorRequestCount = requests.length
      const windowResult = live.utils.setWindow({
        offset: 0,
        limit: finalLimit,
      })
      if (windowResult instanceof Promise) {
        void windowResult.catch(() => undefined)
      }
      await flushPromises()

      const expectedRemote =
        mutation === `insert-before`
          ? [...remote, ...changed]
          : remote.map((row) =>
              row.id <= count ? { ...row, rank: 100 + row.id - 1 } : row,
            )
      const expected = expectedRemote
        .sort((left, right) => left.rank - right.rank)
        .slice(0, finalLimit)
        .map(({ id }) => id)
      const lastUnchangedSourceId = expected
        .filter((id) => !changed.some((row) => row.id === id))
        .at(-1)!
      if (mutation === `insert-before` || count === 1) {
        expect(
          delivered.has(lastUnchangedSourceId) ||
            requests
              .slice(priorRequestCount)
              .some((request) =>
                rowsForLoadSubset(
                  remote,
                  transport === `offset`
                    ? { ...request, cursor: undefined }
                    : request,
                ).some(({ id }) => id === lastUnchangedSourceId),
              ),
        ).toBe(true)
      }
      sourceOps.begin()
      for (const row of changed) {
        if (mutation === `insert-before`) {
          remote.push(row)
          sourceOps.write({ type: `insert`, value: row })
        } else {
          remote[remote.findIndex(({ id }) => id === row.id)] = row
          sourceOps.write({ type: `update`, value: row })
        }
      }
      const receipt = sourceOps.commit()
      heldMutation.resolve()
      await Promise.all(transactions.map((tx) => tx.when(`settled`)))
      await receipt
      await windowResult
      await flushPromises()

      // The public view is checked after source acceptance, so a missing
      // provider row cannot hide behind the local overlay.
      expect([...live.values()].map(({ id }) => id)).toEqual(expected)
    } finally {
      heldMutation.resolve()
      await live.cleanup()
      await source.cleanup()
    }
  }

  oracleProperty({
    id: `pagination.optimistic-provider-coverage`,
    law: namedHistoriesLaw(
      `does not count optimistic rows as provider coverage after a window`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: optimisticProviderCoverageCases,
    label: (row) =>
      `does not count ${String(row.count)} optimistic ${String(row.mutation)} row(s) as ${String(row.transport)} provider coverage after a ${String(row.initialLimit)}-row window`,
    ...orderedComparison(runOptimisticProviderCoverage),
    check: (_history, _observations, verdict) => verdict,
  })

  // A copied pre-cleanup trace must not hide a real provider entry. The
  // premise is the clean run that the old calibration made first, with its
  // assertion that the provider was asked at all.
  const postCleanupCalibrationHistories = [
    {
      name: `real provider entry (calibration premise)`,
      options: {
        providerRows: [
          { id: 1, rank: 1, label: `first` },
          { id: 2, rank: 2, label: `second` },
        ],
        order: { kind: `rank`, direction: `asc`, nulls: `first` } as const,
        limit: 1,
        expectedIds: [1],
      },
    },
  ]

  async function runPostCleanupPremise(
    history: (typeof postCleanupCalibrationHistories)[number],
  ): Promise<void> {
    expect(
      (await runAdversarialOrderedProviderScenario(history.options)).length,
    ).toBeGreaterThan(0)
  }

  oracleProperty({
    id: `pagination.post-cleanup-calibration`,
    law: namedHistoriesLaw(
      `rejects a real provider entry hidden by a copied pre-cleanup trace`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: postCleanupCalibrationHistories,
    label: ({ name }) => name,
    ...orderedComparison(runPostCleanupPremise),
    check: (_history, _observations, verdict) => verdict,
    calibrations: [
      {
        name: `rejects a real provider entry hidden by a copied pre-cleanup trace`,
        law: `calibration post-cleanup-request`,
        driver: (history, observe) =>
          observeComparison(history, observe, async () => {
            try {
              await runAdversarialOrderedProviderScenario(
                history.options,
                `post-cleanup-request`,
              )
            } catch (error) {
              // Exactly the old matcher, toMatchObject({ name: 'AssertionError' }).
              if (error instanceof Error && error.name === `AssertionError`)
                rejectAt(`calibration post-cleanup-request`, error)
              throw error
            }
          }),
      },
    ],
  })

  async function runProviderTieExpansion(): Promise<void> {
    const loads = await runAdversarialOrderedProviderScenario({
      providerRows: [
        { id: 2, rank: 0, label: `second` },
        { id: 1, rank: 0, label: `first` },
        { id: 3, rank: 1, label: `third` },
      ],
      order: { kind: `rank`, direction: `asc`, nulls: `first` },
      limit: 1,
      expectedIds: [1],
    })

    expect(loads).toHaveLength(2)
    expect(loads[1]?.where).toBeDefined()
    expect(loads[1]?.cursor).toBeUndefined()
  }

  oracleProperty({
    id: `pagination.provider-tie-expansion`,
    law: namedHistoriesLaw(
      `expands a provider tie before applying the public-key tie-breaker`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: [
      {
        name: `expands a provider tie before applying the public-key tie-breaker`,
      },
    ],
    label: ({ name }) => name,
    ...orderedComparison(runProviderTieExpansion),
    check: (_history, _observations, verdict) => verdict,
  })

  async function runForeignLocalBoundary(): Promise<void> {
    const unrelated = { id: 100, rank: 100, label: `unrelated` }
    const loads = await runAdversarialOrderedProviderScenario({
      providerRows: [
        { id: 1, rank: 1, label: `first` },
        { id: 2, rank: 2, label: `second` },
        unrelated,
      ],
      initialRows: [unrelated],
      order: { kind: `rank`, direction: `asc`, nulls: `first` },
      limit: 1,
      expectedIds: [1],
    })

    expect(loads[0]?.offset).toBe(0)
    expect(loads[0]?.cursor).toBeUndefined()
  }

  oracleProperty({
    id: `pagination.foreign-local-boundary`,
    law: namedHistoriesLaw(
      `does not derive an ordered boundary from another demand's local row`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: [
      {
        name: `does not derive an ordered boundary from another demand's local row`,
      },
    ],
    label: ({ name }) => name,
    ...orderedComparison(runForeignLocalBoundary),
    check: (_history, _observations, verdict) => verdict,
  })

  async function runLocaleInitialWindow(): Promise<void> {
    const loads = await runAdversarialOrderedProviderScenario({
      // Lexical provider order disagrees with locale numeric order.
      providerRows: [
        { id: 2, rank: 0, label: `item10` },
        { id: 1, rank: 0, label: `item2` },
      ],
      order: { kind: `locale` },
      limit: 1,
      expectedIds: [1],
      useOffsetWhenAvailable: true,
    })

    expect(loads).toHaveLength(2)
    expect(loads[1]?.limit).toBeUndefined()
    expect(loads[1]?.offset).toBeUndefined()
    expect(loads[1]?.cursor).toBeUndefined()
  }

  oracleProperty({
    id: `pagination.locale-initial-window`,
    law: namedHistoriesLaw(
      `refines an initial locale window without trusting provider collation`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: [
      {
        name: `refines an initial locale window without trusting provider collation`,
      },
    ],
    label: ({ name }) => name,
    ...orderedComparison(runLocaleInitialWindow),
    check: (_history, _observations, verdict) => verdict,
  })

  const customCollationCells = [
    {
      cell: `C-01 inherited ascending scan`,
      direction: `asc`,
      autoIndex: `off`,
      sourceDefault: true,
      bounded: true,
    },
    {
      cell: `C-02 inherited descending scan`,
      direction: `desc`,
      autoIndex: `off`,
      sourceDefault: true,
      bounded: true,
    },
    {
      cell: `C-03 inherited ascending index`,
      direction: `asc`,
      autoIndex: `eager`,
      sourceDefault: true,
      bounded: true,
    },
    {
      cell: `C-04 inherited descending index`,
      direction: `desc`,
      autoIndex: `eager`,
      sourceDefault: true,
      bounded: true,
    },
    {
      cell: `C-05 per-order override`,
      direction: `asc`,
      autoIndex: `eager`,
      sourceDefault: false,
      bounded: true,
    },
    {
      cell: `C-06 inherited unbounded order`,
      direction: `asc`,
      autoIndex: `off`,
      sourceDefault: true,
      bounded: false,
    },
    {
      cell: `C-07 explicit unbounded order`,
      direction: `asc`,
      autoIndex: `eager`,
      sourceDefault: false,
      bounded: false,
    },
    {
      cell: `C-09 output default does not override source inheritance`,
      direction: `asc`,
      autoIndex: `off`,
      sourceDefault: true,
      bounded: false,
      outputDefault: `lexical`,
    },
  ] as const

  async function runCustomCollationCell({
    direction,
    autoIndex,
    sourceDefault,
    bounded,
    outputDefault,
  }: (typeof customCollationCells)[number] & {
    outputDefault?: `lexical`
  }): Promise<void> {
    await runCustomCollationScenario({
      direction,
      autoIndex,
      sourceDefault,
      bounded,
      outputDefault,
    })
  }

  oracleProperty({
    id: `pagination.custom-collation`,
    law: namedHistoriesLaw(
      `uses one filtered full-source acquisition for custom collation`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: customCollationCells,
    label: (row) =>
      `uses one filtered full-source acquisition for custom collation (${String(row.cell)})`,
    ...orderedComparison(runCustomCollationCell),
    check: (_history, _observations, verdict) => verdict,
  })

  async function runInheritedLocale(): Promise<void> {
    const defaultOnly = createCollection<{ id: number }>({
      getKey: (row) => row.id,
      defaultStringCollation: { stringSort: `locale` },
      sync: { sync: () => {} },
    })
    try {
      expect(defaultOnly.compareOptions).toStrictEqual({
        stringSort: `locale`,
      })
    } finally {
      await defaultOnly.cleanup()
    }

    const labels = [`item10`, `item2`]
    expect(
      [...labels].sort(new Intl.Collator(`en-US`, { numeric: true }).compare),
      `numeric locale control`,
    ).toEqual([`item2`, `item10`])
    expect([...labels].sort(), `lexical hostile control`).toEqual([
      `item10`,
      `item2`,
    ])

    for (const autoIndex of [`off`, `eager`] as const) {
      const loads = await runAdversarialOrderedProviderScenario({
        // The provider's lexical prefix disagrees with inherited locale order.
        providerRows: [
          { id: 2, rank: 0, label: `item10` },
          { id: 1, rank: 0, label: `item2` },
        ],
        order: { kind: `locale` },
        limit: 1,
        expectedIds: [1],
        useOffsetWhenAvailable: true,
        inheritSourceLocale: true,
        autoIndex,
      })

      expect(loads).toHaveLength(2)
      expect(loads[0]?.orderBy?.[0]?.compareOptions).toStrictEqual({
        direction: `asc`,
        nulls: `first`,
        stringSort: `locale`,
        locale: `en-US`,
        localeOptions: { numeric: true },
      })
      expect(loads[1]?.limit).toBeUndefined()
      expect(loads[1]?.offset).toBeUndefined()
      expect(loads[1]?.cursor).toBeUndefined()
    }
  }

  oracleProperty({
    id: `pagination.inherited-locale`,
    law: namedHistoriesLaw(
      `inherits collection locale options through scan and auto-index ordering`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: [
      {
        name: `inherits collection locale options through scan and auto-index ordering`,
      },
    ],
    label: ({ name }) => name,
    ...orderedComparison(runInheritedLocale),
    check: (_history, _observations, verdict) => verdict,
  })

  async function runReferenceInitialWindow(): Promise<void> {
    const first = { value: `first` }
    const second = { value: `second` }
    // Fix their runtime reference order before the provider returns the
    // opposite prefix.
    makeComparator({ direction: `asc`, nulls: `first` })(first, second)

    const loads = await runAdversarialOrderedProviderScenario({
      providerRows: [
        { id: 2, rank: second, label: `second` },
        { id: 1, rank: first, label: `first` },
      ],
      order: { kind: `reference` },
      limit: 1,
      expectedIds: [1],
      useOffsetWhenAvailable: true,
    })

    expect(loads).toHaveLength(2)
    expect(loads[1]?.limit).toBeUndefined()
    expect(loads[1]?.offset).toBeUndefined()
  }

  oracleProperty({
    id: `pagination.reference-initial-window`,
    law: namedHistoriesLaw(
      `refines an initial reference-ordered window locally`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: [
      { name: `refines an initial reference-ordered window locally` },
    ],
    label: ({ name }) => name,
    ...orderedComparison(runReferenceInitialWindow),
    check: (_history, _observations, verdict) => verdict,
  })

  const invalidDateTieCases = ([`asc`, `desc`] as const).flatMap((direction) =>
    ([`first`, `last`] as const).map((nulls) => ({ direction, nulls })),
  )

  async function runInvalidDateTies({
    direction,
    nulls,
  }: (typeof invalidDateTieCases)[number]): Promise<void> {
    const invalid = new Date(Number.NaN)
    const loads = await runAdversarialOrderedProviderScenario({
      providerRows: [
        { id: 2, rank: invalid, label: `second` },
        { id: 1, rank: invalid, label: `first` },
      ],
      order: { kind: `reference`, direction, nulls },
      limit: 1,
      expectedIds: [1],
      useOffsetWhenAvailable: true,
    })

    expect(loads).toHaveLength(2)
    expect(loads[1]?.limit).toBeUndefined()
    expect(loads[1]?.offset).toBeUndefined()
  }

  oracleProperty({
    id: `pagination.invalid-date-ties`,
    law: namedHistoriesLaw(
      `refines invalid Date ties with an unbounded local-order request`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: invalidDateTieCases,
    label: (row) =>
      `refines invalid Date ties with an unbounded local-order request (${String(row.direction)}, nulls ${String(row.nulls)})`,
    ...orderedComparison(runInvalidDateTies),
    check: (_history, _observations, verdict) => verdict,
  })

  async function runNanKeyTie(): Promise<void> {
    const loads = await runAdversarialOrderedProviderScenario({
      providerRows: [
        { id: 1, rank: 0, label: `finite` },
        { id: Number.NaN, rank: 0, label: `nan` },
      ],
      order: { kind: `rank`, direction: `asc`, nulls: `first` },
      limit: 1,
      expectedIds: [1],
    })

    expect(loads).toHaveLength(2)
  }

  oracleProperty({
    id: `pagination.nan-key-tie`,
    law: namedHistoriesLaw(
      `stabilizes an on-demand window with a NaN public-key tie`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: [
      { name: `stabilizes an on-demand window with a NaN public-key tie` },
    ],
    label: ({ name }) => name,
    ...orderedComparison(runNanKeyTie),
    check: (_history, _observations, verdict) => verdict,
  })

  const nullPlacementCases = [
    { direction: `asc`, nulls: `first`, expectedIds: [1, 2] },
    { direction: `asc`, nulls: `last`, expectedIds: [2, 3] },
    { direction: `desc`, nulls: `first`, expectedIds: [1, 3] },
    { direction: `desc`, nulls: `last`, expectedIds: [3, 2] },
  ] as const

  async function runNullPlacementRefinement({
    direction,
    nulls,
    expectedIds,
  }: (typeof nullPlacementCases)[number]): Promise<void> {
    const providerRows = [
      { id: 1, rank: null, label: `null` },
      { id: 2, rank: 0, label: `zero` },
      { id: 3, rank: 1, label: `one` },
    ].sort(
      (left, right) =>
        compareNullableNumber(left.rank, right.rank, { direction, nulls }) ||
        left.id - right.id,
    )
    await runAdversarialOrderedProviderScenario({
      providerRows,
      order: { kind: `rank`, direction, nulls },
      limit: 2,
      expectedIds,
    })
  }

  oracleProperty({
    id: `pagination.null-placement-refinement`,
    law: namedHistoriesLaw(
      `keeps null placement and direction across source refinement`,
    ),
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: nullPlacementCases,
    label: (row) =>
      `keeps null placement and ${String(row.direction)} across source refinement (${String(row.nulls)})`,
    ...orderedComparison(runNullPlacementRefinement),
    check: (_history, _observations, verdict) => verdict,
  })

  oracleProperty({
    id: `pagination.async-cursor`,
    law: {
      statement: `matches full recomputation when exact async cursor loads widen ordered coverage for a random or replayed seed`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/utils/comparison.ts#makeComparator',
    ],
    histories: { arbitrary: scenarioArbitrary, runs: 8, fixedSeeds: [1659] },
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, async () => {
        const scenario = history

        await runOnDemandPaginationScenario(scenario)
      }),
    check: (_history, _observations, verdict) => verdict,
  })
})
