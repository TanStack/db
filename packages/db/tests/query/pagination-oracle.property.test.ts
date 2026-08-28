import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq } from '../../src/query/builder/functions.js'
import { PropRef } from '../../src/query/ir.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import { makeComparator } from '../../src/utils/comparison.js'
import {
  oracleRandomParameters,
  readOracleRunConfig,
} from '../oracle-config.js'
import { evaluateReferenceExpression } from '../reference-expression.js'
import { TraceAssertionError } from '../trace-runner.js'
import { flushPromises, mockSyncCollectionOptions } from '../utils.js'
import type { LoadSubsetOptions, LoadSubsetResult } from '../../src/types.js'

type PageRow = {
  id: number
  rank: number
}

type MultiOrderRow = {
  id: number
  primary: number | null
  secondary: number | null
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

type LocaleCursorRow = {
  id: number
  label: string
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

type PaginationWindow = {
  offset: number
  limit: number
}

type PaginationScenario = {
  ranks: ReadonlyArray<number>
  direction: `asc` | `desc`
  windows: ReadonlyArray<PaginationWindow>
}

type PaginationAction =
  | ({ type: `window` } & PaginationWindow)
  | { type: `put`; id: number; rank: number }
  | { type: `delete`; id: number }

type PaginationStateScenario = {
  ranks: ReadonlyArray<number>
  direction: `asc` | `desc`
  initialWindow: PaginationWindow
  actions: ReadonlyArray<PaginationAction>
}

type PendingCursorLoad = {
  options: LoadSubsetOptions
  deferred: ReturnType<typeof createDeferred<void>>
  settled?: boolean
}

type PendingMutation =
  | { type: `insert`; row: PageRow }
  | { type: `delete`; id: number }
  | { type: `update`; row: PageRow }

type PendingMutationScenario = {
  ranks: ReadonlyArray<number>
  direction: `asc` | `desc`
  limit: number
  mutation: PendingMutation
  responseOutcome: `resolve` | `reject`
}

class DeliveredRowsTraceAssertionError extends TraceAssertionError {
  constructor(
    cause: unknown,
    readonly deliveredRows: ReadonlyArray<PageRow>,
  ) {
    super(0, cause)
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

const scenarioArbitrary: fc.Arbitrary<PaginationScenario> = fc.record({
  ranks: fc.array(fc.integer({ min: -2, max: 2 }), {
    minLength: 1,
    maxLength: 12,
  }),
  direction: fc.constantFrom(`asc`, `desc`),
  windows: fc.array(
    fc.record({
      offset: fc.integer({ min: 0, max: 12 }),
      limit: fc.integer({ min: 0, max: 8 }),
    }),
    { minLength: 1, maxLength: 12 },
  ),
})

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

const stateScenarioArbitrary: fc.Arbitrary<PaginationStateScenario> = fc.record(
  {
    ranks: fc.array(fc.integer({ min: -2, max: 2 }), {
      minLength: 1,
      maxLength: 12,
    }),
    direction: fc.constantFrom(`asc`, `desc`),
    initialWindow: windowArbitrary,
    actions: fc.array(paginationActionArbitrary, {
      minLength: 1,
      maxLength: 20,
    }),
  },
)

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

type CleanupTarget = {
  cleanup: () => unknown
}

async function cleanupAll(
  ...targets: ReadonlyArray<CleanupTarget>
): Promise<void> {
  const results = await Promise.allSettled(
    targets.map((target) => Promise.resolve().then(() => target.cleanup())),
  )
  const rejection = results.find(
    (result): result is PromiseRejectedResult => result.status === `rejected`,
  )
  if (rejection) throw rejection.reason
}

const { multiplier, replaySeed } = readOracleRunConfig()
const orderedScenarioRuns = 12 * multiplier
const transitionScenarioRuns = 8 * multiplier
const orderedScenarioRandomParameters = oracleRandomParameters(
  orderedScenarioRuns,
  replaySeed,
)

let collectionSequence = 0

function referenceWindow(
  rows: ReadonlyArray<PageRow>,
  direction: `asc` | `desc`,
  window: PaginationWindow,
): Array<number> {
  return referenceWindowRows(rows, direction, window).map(({ id }) => id)
}

function referenceWindowRows(
  rows: ReadonlyArray<PageRow>,
  direction: `asc` | `desc`,
  window: PaginationWindow,
): Array<PageRow> {
  return [...rows]
    .sort(
      (left, right) =>
        (left.rank - right.rank) * (direction === `asc` ? 1 : -1) ||
        left.id - right.id,
    )
    .slice(window.offset, window.offset + window.limit)
    .map((row) => ({ ...row }))
}

function rowsForLoadSubset<TRow extends { id: number }>(
  rows: ReadonlyArray<TRow>,
  options: LoadSubsetOptions,
): Array<TRow> {
  if (!options.cursor) {
    const start = options.offset ?? 0
    const end =
      options.limit === undefined ? rows.length : start + options.limit
    return rows.slice(start, end)
  }

  const current = rows.filter((row) =>
    Boolean(evaluateReferenceExpression(options.cursor!.whereCurrent, row)),
  )
  const from = rows.filter((row) =>
    Boolean(evaluateReferenceExpression(options.cursor!.whereFrom, row)),
  )
  const limitedFrom =
    options.limit === undefined ? from : from.slice(0, options.limit)
  const requested = new Map<number, TRow>()
  for (const row of [...current, ...limitedFrom]) requested.set(row.id, row)
  return [...requested.values()]
}

function withAppliedSubsetEvidence<TRow extends { id: number }>(
  rows: () => ReadonlyArray<TRow>,
  options: LoadSubsetOptions,
  settled: Promise<void>,
) {
  return settled.then(() => {
    const authoritative = rows()
    const requested = rowsForLoadSubset(authoritative, options)
    const hasMore = options.cursor
      ? authoritative.filter((row) =>
          Boolean(evaluateReferenceExpression(options.cursor!.whereFrom, row)),
        ).length > (options.limit ?? Number.POSITIVE_INFINITY)
      : authoritative.length >
        (options.offset ?? 0) + (options.limit ?? Number.POSITIVE_INFINITY)
    return {
      hasMore,
      appliedRowKeys: requested.map(({ id }) => id),
    }
  })
}

function createConformingOrderedSource<TRow extends { id: number }>(
  id: string,
  rows: ReadonlyArray<TRow>,
  autoIndex: `eager` | `off` = `eager`,
) {
  const requests: Array<LoadSubsetOptions> = []
  const delivered = new Set<number>()
  const source = createCollection<TRow>({
    id,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            requests.push(options)
            const requested = rowsForLoadSubset(rows, options)
            begin()
            for (const row of requested) {
              if (delivered.has(row.id)) continue
              delivered.add(row.id)
              write({ type: `insert`, value: row })
            }
            const receipt = commit(options.signal)
            const hasMore = options.cursor
              ? rows.filter((row) =>
                  Boolean(
                    evaluateReferenceExpression(options.cursor!.whereFrom, row),
                  ),
                ).length > (options.limit ?? Number.POSITIVE_INFINITY)
              : rows.length >
                (options.offset ?? 0) +
                  (options.limit ?? Number.POSITIVE_INFINITY)
            return Promise.resolve(receipt).then(() => ({
              hasMore,
              appliedRowKeys: requested.map(({ id: key }) => key),
            }))
          },
        }
      },
    },
  })

  return { requests, source }
}

async function runPaginationScenario(
  scenario: PaginationScenario,
): Promise<void> {
  const rows = scenario.ranks.map((rank, index) => ({ id: index + 1, rank }))
  const initialWindow = scenario.windows[0]!
  const source = createCollection(
    mockSyncCollectionOptions({
      id: `pagination-oracle-source-${collectionSequence++}`,
      initialData: rows.map((row) => ({ ...row })),
      getKey: (row: PageRow) => row.id,
      autoIndex: `eager`,
    }),
  )
  const live = createLiveQueryCollection((query) =>
    query
      .from({ row: source })
      .orderBy(({ row }) => row.rank, scenario.direction)
      .orderBy(({ row }) => row.id, `asc`)
      .offset(initialWindow.offset)
      .limit(initialWindow.limit)
      .select(({ row }) => ({ id: row.id, rank: row.rank })),
  )

  try {
    await live.preload()
    expect(Array.from(live.values(), ({ id }) => id)).toEqual(
      referenceWindow(rows, scenario.direction, initialWindow),
    )

    for (const window of scenario.windows.slice(1)) {
      const result = live.utils.setWindow(window)
      if (result instanceof Promise) await result

      expect(Array.from(live.values(), ({ id }) => id)).toEqual(
        referenceWindow(rows, scenario.direction, window),
      )
    }
  } finally {
    await cleanupAll(live, source)
  }
}

async function expectMultiOrderBoundaryMatches(): Promise<void> {
  await runMultiOrderScenario({
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
  })
}

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

  try {
    await live.preload()
    try {
      expect(Array.from(live.values(), ({ id }) => id)).toEqual(
        referenceMultiOrder(scenario),
      )
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    await cleanupAll(live, source)
  }
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
            return withAppliedSubsetEvidence(
              () => orderedRows,
              options,
              deferred.promise,
            )
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

  try {
    const preload = live.preload()
    expect(pending).toHaveLength(1)
    // Settling one request can append its boundary-refinement request.
    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let index = 0; index < pending.length; index++) {
      const request = pending[index]!
      begin()
      for (const row of rowsForLoadSubset(orderedRows, request.options)) {
        if (delivered.has(row.id)) continue
        delivered.add(row.id)
        write({ type: `insert`, value: { ...row } })
      }
      commit()
      request.settled = true
      request.deferred.resolve()
      await flushPromises()
    }
    await preload

    try {
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    for (const request of pending) request.deferred.resolve()
    await cleanupAll(live, source)
  }
}

async function runPaginationStateScenario(
  scenario: PaginationStateScenario,
): Promise<void> {
  const rows = new Map<number, PageRow>(
    scenario.ranks.map((rank, index) => [index + 1, { id: index + 1, rank }]),
  )
  let currentWindow = scenario.initialWindow
  const sourceOptions = mockSyncCollectionOptions({
    id: `pagination-state-oracle-source-${collectionSequence++}`,
    initialData: [...rows.values()].map((row) => ({ ...row })),
    getKey: (row: PageRow) => row.id,
    autoIndex: `eager` as const,
  })
  const source = createCollection(sourceOptions)
  const live = createLiveQueryCollection((query) =>
    query
      .from({ row: source })
      .orderBy(({ row }) => row.rank, scenario.direction)
      .orderBy(({ row }) => row.id, `asc`)
      .offset(currentWindow.offset)
      .limit(currentWindow.limit)
      .select(({ row }) => ({ id: row.id, rank: row.rank })),
  )

  const expectCurrentWindow = (checkpoint: number) => {
    try {
      expect(
        Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
      ).toEqual(
        referenceWindowRows(
          [...rows.values()],
          scenario.direction,
          currentWindow,
        ),
      )
    } catch (error) {
      throw new TraceAssertionError(checkpoint, error)
    }
  }

  try {
    await live.preload()
    expectCurrentWindow(0)

    for (const [index, action] of scenario.actions.entries()) {
      if (action.type === `window`) {
        currentWindow = { offset: action.offset, limit: action.limit }
        const result = live.utils.setWindow(currentWindow)
        if (result instanceof Promise) await result
      } else if (action.type === `put`) {
        const row = { id: action.id, rank: action.rank }
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
    }
  } finally {
    await cleanupAll(live, source)
  }
}

async function runOnDemandPaginationScenario(
  scenario: PaginationScenario,
): Promise<void> {
  const authoritativeRows = scenario.ranks.map((rank, index) => ({
    id: index + 1,
    rank,
  }))
  const directionFactor = scenario.direction === `asc` ? 1 : -1
  const orderedRows = [...authoritativeRows].sort(
    (left, right) =>
      (left.rank - right.rank) * directionFactor || left.id - right.id,
  )
  const deliveredIds = new Set<number>()
  const loads: Array<LoadSubsetOptions> = []
  const initialWindow = scenario.windows[0]!

  const source = createCollection<PageRow>({
    id: `pagination-on-demand-oracle-source-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            loads.push({ ...options })
            const requested = rowsForLoadSubset(orderedRows, options)

            const settled = new Promise<void>((resolve) => {
              queueMicrotask(() => {
                begin()
                for (const row of requested) {
                  if (deliveredIds.has(row.id)) continue
                  deliveredIds.add(row.id)
                  write({ type: `insert`, value: { ...row } })
                }
                commit()
                resolve()
              })
            })
            return withAppliedSubsetEvidence(
              () => orderedRows,
              options,
              settled,
            )
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
      .offset(initialWindow.offset)
      .limit(initialWindow.limit)
      .select(({ row }) => ({ id: row.id, rank: row.rank })),
  )

  try {
    await live.preload()
    if (initialWindow.limit > 0) {
      expect(loads.length).toBeGreaterThan(0)
    }
    try {
      expect(Array.from(live.values(), ({ id }) => id)).toEqual(
        referenceWindow(authoritativeRows, scenario.direction, initialWindow),
      )
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }

    for (const [index, window] of scenario.windows.slice(1).entries()) {
      const result = live.utils.setWindow(window)
      if (result instanceof Promise) await result

      try {
        expect(Array.from(live.values(), ({ id }) => id)).toEqual(
          referenceWindow(authoritativeRows, scenario.direction, window),
        )
      } catch (error) {
        throw new TraceAssertionError(index + 1, error)
      }
    }

    const expectedOrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: scenario.direction, nulls: `first` },
      },
      {
        expression: new PropRef([`id`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    for (const load of loads)
      expect(load.orderBy).toMatchObject(expectedOrderBy)
  } finally {
    await cleanupAll(live, source)
  }
}

async function expectOnDemandWindowsAreCompletionOrderIndependent(
  deliveryOrder: `forward` | `reverse`,
): Promise<void> {
  const authoritativeRows: Array<PageRow> = [
    { id: 1, rank: 0 },
    { id: 2, rank: 1 },
    { id: 3, rank: 2 },
    { id: 4, rank: 3 },
  ]
  const pending: Array<PendingCursorLoad> = []
  const deliveredIds = new Set<number>([1])
  let begin!: () => void
  let write!: (message: { type: `insert`; value: PageRow }) => void
  let commit!: () => void
  const apply = (options: LoadSubsetOptions) => {
    begin()
    for (const row of rowsForLoadSubset(authoritativeRows, options)) {
      if (deliveredIds.has(row.id)) continue
      deliveredIds.add(row.id)
      write({ type: `insert`, value: { ...row } })
    }
    commit()
  }
  const source = createCollection<PageRow>({
    id: `pagination-completion-order-source-${collectionSequence++}`,
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
        write({ type: `insert`, value: { ...authoritativeRows[0]! } })
        commit()
        params.markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const deferred = createDeferred<void>()
            pending.push({ options, deferred })
            return withAppliedSubsetEvidence(
              () => authoritativeRows,
              options,
              deferred.promise,
            )
          },
        }
      },
    },
  })
  const createLive = (limit: number) =>
    createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.rank, `asc`)
        .orderBy(({ row }) => row.id, `asc`)
        .limit(limit),
    )
  const firstLive = createLive(2)
  const secondLive = createLive(3)

  try {
    const first = firstLive.preload()
    const second = secondLive.preload()
    expect(pending).toHaveLength(2)

    const indices = deliveryOrder === `forward` ? [0, 1] : [1, 0]
    for (const index of indices) {
      const request = pending[index]!
      apply(request.options)
      request.deferred.resolve()
      await flushPromises()
    }
    for (let index = 2; index < pending.length; index++) {
      const request = pending[index]!
      apply(request.options)
      request.deferred.resolve()
      await flushPromises()
    }
    await first
    await second

    expect(Array.from(firstLive.values(), ({ id }) => id)).toEqual([1, 2])
    expect(Array.from(secondLive.values(), ({ id }) => id)).toEqual([1, 2, 3])
  } finally {
    for (const request of pending) request.deferred.resolve()
    await cleanupAll(firstLive, secondLive, source)
  }
}

async function runAdversarialOrderedProviderScenario(options: {
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
  providerPageCap?: number
  reportedExtent?: `computed` | `continues` | `unknown` | `exhausted`
  widenTo?: number
  expectNoProgress?: boolean
}): Promise<Array<LoadSubsetOptions>> {
  const loads: Array<LoadSubsetOptions> = []
  const delivered = new Set(options.initialRows?.map(({ id }) => id) ?? [])
  const source = createCollection<AdversarialOrderedRow>({
    id: `pagination-adversarial-order-source-${collectionSequence++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
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
          loadSubset: (loadOptions: LoadSubsetOptions) => {
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
            const providerMatch = options.useOffsetWhenAvailable
              ? options.providerRows.slice(
                  loadOptions.offset ?? 0,
                  loadOptions.limit === undefined
                    ? undefined
                    : (loadOptions.offset ?? 0) + loadOptions.limit,
                )
              : rowsForLoadSubset(options.providerRows, loadOptions)
            const requested =
              options.providerPageCap === undefined
                ? providerMatch
                : providerMatch.slice(0, options.providerPageCap)
            begin()
            for (const row of requested) {
              if (delivered.has(row.id)) continue
              delivered.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            const receipt = commit()
            const requestedIds = requested.map(({ id }) => id)
            const hasMore =
              options.reportedExtent === undefined ||
              options.reportedExtent === `computed`
                ? requestedIds.length < options.providerRows.length
                : options.reportedExtent === `continues`
                  ? true
                  : options.reportedExtent === `exhausted`
                    ? false
                    : undefined
            return Promise.resolve(receipt).then(() => ({
              hasMore,
              appliedRowKeys: requestedIds,
            }))
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection((query) => {
    const from = query.from({ row: source })
    const ordered =
      options.order.kind === `locale`
        ? from.orderBy(({ row }) => row.label, {
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

  try {
    await live.preload()
    expect(Array.from(live.values(), ({ id }) => id)).toEqual(
      options.expectedIds,
    )
    if (options.widenTo !== undefined) {
      const loadCount = loads.length
      const widened = live.utils.setWindow({
        offset: 0,
        limit: options.widenTo,
      })
      if (widened instanceof Promise) await widened
      if (options.expectNoProgress) {
        expect(live.utils.lastSubsetError).toMatchObject({
          name: `OrderedLoadNoProgressError`,
        })
      }
      expect(loads.length).toBeGreaterThan(loadCount)
    }
    // Snapshot observations before cleanup. Teardown must not create fresh
    // source demand, and callers must not mistake such work for the scenario's
    // final refinement request.
    return [...loads]
  } finally {
    await cleanupAll(live, source)
  }
}

async function runPendingMutationScenario(
  scenario: PendingMutationScenario,
  timing: `before-response` | `after-response`,
  finalLimitAfterMutation?: number,
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
  const deliveredIds = new Set<number>([firstDelivered.id])
  // A rejected initial subset load is fatal. Establish a ready baseline first
  // so reject scenarios exercise subscription-scoped window recovery.
  let initialCoverageRequests = scenario.responseOutcome === `reject` ? 2 : 0
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
            if (initialCoverageRequests > 0) {
              initialCoverageRequests--
              return Promise.resolve({
                hasMore: true,
                appliedRowKeys: [firstDelivered.id],
              })
            }
            const deferred = createDeferred<void>()
            pending.push({ options, deferred })
            return withAppliedSubsetEvidence(
              () =>
                referenceWindowRows([...rows.values()], scenario.direction, {
                  offset: 0,
                  limit: rows.size,
                }),
              options,
              deferred.promise,
            )
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
      .limit(scenario.responseOutcome === `reject` ? 1 : scenario.limit),
  )
  const outstanding: Array<Promise<unknown>> = []

  const applyMutation = () => {
    const { mutation } = scenario
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
  }

  const settlePending = async () => {
    // Settling one request can append its boundary-refinement request.
    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let index = 0; index < pending.length; index++) {
      const request = pending[index]!
      if (request.settled) continue
      request.settled = true
      const orderedRows = referenceWindowRows(
        [...rows.values()],
        scenario.direction,
        {
          offset: 0,
          limit: rows.size,
        },
      )
      begin()
      for (const row of rowsForLoadSubset(orderedRows, request.options)) {
        if (deliveredIds.has(row.id)) continue
        deliveredIds.add(row.id)
        write({ type: `insert`, value: { ...row } })
      }
      commit()
      request.deferred.resolve()
      await flushPromises()
    }
  }

  try {
    const preload = live.preload()
    outstanding.push(preload)
    let finalLimit = scenario.limit
    if (scenario.responseOutcome === `resolve`) {
      expect(pending).toHaveLength(1)
      if (timing === `before-response`) applyMutation()
      await settlePending()
      await preload
      if (timing === `after-response`) {
        applyMutation()
        await flushPromises()
        if (finalLimitAfterMutation !== undefined) {
          finalLimit = finalLimitAfterMutation
          const widened = live.utils.setWindow({
            offset: 0,
            limit: finalLimit,
          })
          if (widened instanceof Promise) outstanding.push(widened)
        }
        await settlePending()
        await Promise.all(outstanding)
      }
    } else {
      await preload
      expect(pending).toHaveLength(0)
      finalLimit += 1
      const failedWindow = live.utils.setWindow({
        offset: 0,
        limit: finalLimit,
      })
      expect(failedWindow).toBeInstanceOf(Promise)
      const cursorError = new Error(`cursor failed`)
      const observedFailure = (failedWindow as Promise<void>).then(
        () => undefined,
        (error: unknown) => error,
      )
      outstanding.push((failedWindow as Promise<void>).catch(() => {}))
      expect(pending).toHaveLength(1)
      if (timing === `before-response`) applyMutation()
      pending[0]!.settled = true
      pending[0]!.deferred.reject(cursorError)
      if (timing === `after-response`) applyMutation()
      await flushPromises()
      await settlePending()
      expect(await observedFailure).toBe(cursorError)

      const retry = live.utils.setWindow({ offset: 0, limit: finalLimit })
      let retrySettled = retry === true
      const observedRetry =
        retry instanceof Promise
          ? retry.then(
              () => {
                retrySettled = true
              },
              (error: unknown) => {
                retrySettled = true
                throw error
              },
            )
          : undefined
      if (pending.length === 2) {
        await settlePending()
      } else {
        await flushPromises()
        expect(retrySettled).toBe(true)
      }
      if (observedRetry) {
        outstanding.push(observedRetry)
        await observedRetry
      }
    }

    try {
      expect(
        Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
      ).toEqual(
        referenceWindowRows([...rows.values()], scenario.direction, {
          offset: 0,
          limit: finalLimit,
        }),
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
  } finally {
    for (const request of pending) request.deferred.resolve()
    await Promise.allSettled(outstanding)
    await cleanupAll(live, source)
  }
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
  let initialCoverageRequests = 2
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
            if (initialCoverageRequests > 0) {
              initialCoverageRequests--
              return Promise.resolve({
                hasMore: true,
                appliedRowKeys: [1],
              })
            }
            const deferred = createDeferred<void>()
            pending.push({ options, deferred })
            return withAppliedSubsetEvidence(
              () =>
                referenceWindowRows([...rows.values()], `asc`, {
                  offset: 0,
                  limit: rows.size,
                }),
              options,
              deferred.promise,
            )
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
      .limit(1),
  )

  const settle = async (request: PendingCursorLoad): Promise<void> => {
    request.settled = true
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

    pending[0]!.settled = true
    pending[0]!.deferred.reject(cursorError)
    await flushPromises()
    for (let index = 1; index < pending.length; index++) {
      if (!pending[index]!.settled) await settle(pending[index]!)
    }
    expect(await observedFailure).toBe(cursorError)

    const retry = live.utils.setWindow({ offset: 0, limit: 3 })
    for (let index = 1; index < pending.length; index++) {
      if (!pending[index]!.settled) await settle(pending[index]!)
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
  const deliveredIds = new Set<number>([firstDelivered.id])
  const outstanding: Array<Promise<unknown>> = []
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
            pending.push({ options, deferred })
            return withAppliedSubsetEvidence(
              () =>
                referenceWindowRows([...rows.values()], scenario.direction, {
                  offset: 0,
                  limit: rows.size,
                }),
              options,
              deferred.promise,
            )
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
    request.settled = true
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
    request.deferred.resolve()
    await flushPromises()
  }

  const track = (result: true | Promise<void>): void => {
    if (result instanceof Promise) outstanding.push(result)
  }

  try {
    outstanding.push(live.preload())
    expect(pending).toHaveLength(1)

    updateFirstDelivered(scenario.firstRank)
    track(live.utils.setWindow({ offset: 0, limit: scenario.narrowLimit }))
    track(live.utils.setWindow({ offset: 0, limit: scenario.wideLimit }))
    expect(pending).toHaveLength(1)
    updateFirstDelivered(scenario.secondRank)

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

    try {
      const actual = Array.from(live.values(), ({ id, rank }) => ({ id, rank }))
      const expected = referenceWindowRows(
        [...rows.values()],
        scenario.direction,
        { offset: 0, limit: scenario.wideLimit },
      )
      expect(actual).toEqual(expected)
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
  } finally {
    for (const request of pending) request.deferred.resolve()
    await Promise.allSettled(outstanding)
    await cleanupAll(live, source)
  }
}

function changedRankValue(previous: number, requested: number): number {
  return requested === previous
    ? requested === 2
      ? -2
      : requested + 1
    : requested
}

async function expectInflightRequestFillsNewWindow(): Promise<void> {
  const rows: Array<PageRow> = [
    { id: 1, rank: 0 },
    { id: 2, rank: 1 },
    { id: 3, rank: 2 },
    { id: 4, rank: 3 },
  ]
  const pending: Array<PendingCursorLoad> = []
  const deliveredIds = new Set<number>([1])
  let begin!: () => void
  let write!: (message: { type: `insert`; value: PageRow }) => void
  let commit!: () => void
  const source = createCollection<PageRow>({
    id: `pagination-late-window-source-${collectionSequence++}`,
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
        write({ type: `insert`, value: { ...rows[0]! } })
        commit()
        params.markReady()
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            const deferred = createDeferred<void>()
            pending.push({ options, deferred })
            return withAppliedSubsetEvidence(
              () => rows,
              options,
              deferred.promise,
            )
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
    begin()
    for (const row of rowsForLoadSubset(rows, request.options)) {
      if (deliveredIds.has(row.id)) continue
      deliveredIds.add(row.id)
      write({ type: `insert`, value: { ...row } })
    }
    commit()
    request.deferred.resolve()
    await Promise.resolve()
  }

  try {
    const preload = live.preload()
    expect(pending).toHaveLength(1)
    const setWindow = live.utils.setWindow({ offset: 2, limit: 2 })
    expect(setWindow).toBeInstanceOf(Promise)
    await flushPromises()
    expect(pending).toHaveLength(1)

    await settle(pending[0]!)
    await flushPromises()
    expect(pending).toHaveLength(2)
    await settle(pending[1]!)
    await preload
    if (setWindow instanceof Promise) await setWindow

    try {
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([3, 4])
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    for (const request of pending) request.deferred.resolve()
    await cleanupAll(live, source)
  }
}

describe(`pagination recomputation oracle`, () => {
  it(`observes cleanup failure after every teardown settles`, async () => {
    const firstFailure = new Error(`first cleanup failed`)
    const secondFailure = new Error(`second cleanup failed`)
    const laterCleanup = createDeferred<void>()
    const events: Array<string> = []
    const unhandled: Array<unknown> = []
    const recordUnhandled = (reason: unknown) => unhandled.push(reason)
    const targets: ReadonlyArray<CleanupTarget> = [
      {
        cleanup: async () => {
          events.push(`first`)
          await laterCleanup.promise
          throw firstFailure
        },
      },
      {
        cleanup: () => {
          events.push(`second`)
          throw secondFailure
        },
      },
      {
        cleanup: () => {
          events.push(`third`)
        },
      },
    ]
    const observeFirstFailure = (cleanup: Promise<void>) =>
      cleanup.then(
        () => {
          throw new Error(`expected cleanup to reject`)
        },
        (error: unknown) => expect(error).toBe(firstFailure),
      )
    let cleanupFinished = false
    process.on(`unhandledRejection`, recordUnhandled)

    try {
      const cleanup = cleanupAll(...targets).finally(() => {
        cleanupFinished = true
      })
      const observedFailure = observeFirstFailure(cleanup)

      await flushPromises()
      expect(events).toEqual([`first`, `second`, `third`])
      expect(cleanupFinished).toBe(false)
      expect(unhandled).toEqual([])

      laterCleanup.resolve()
      await observedFailure
      await flushPromises()
      expect(cleanupFinished).toBe(true)
      expect(unhandled).toEqual([])

      await observeFirstFailure(cleanupAll(...targets))
      await flushPromises()
      expect(events).toEqual([
        `first`,
        `second`,
        `third`,
        `first`,
        `second`,
        `third`,
      ])
      expect(unhandled).toEqual([])
    } finally {
      laterCleanup.resolve()
      process.off(`unhandledRejection`, recordUnhandled)
    }
  })

  it(`refills a joined result window through a contract-compliant source`, async () => {
    type ParentRow = { id: number; rank: number; groupId: number }
    type ChildRow = { id: number; groupId: number }
    const parents = [
      { id: 1, rank: 0, groupId: 1 },
      { id: 2, rank: 1, groupId: 2 },
      { id: 3, rank: 2, groupId: 3 },
      { id: 4, rank: 3, groupId: 4 },
    ] satisfies ReadonlyArray<ParentRow>
    const { requests, source: parentSource } = createConformingOrderedSource(
      `pagination-joined-underfill-source-${collectionSequence++}`,
      parents,
    )
    const childSource = createCollection(
      mockSyncCollectionOptions({
        id: `pagination-joined-underfill-child-${collectionSequence++}`,
        initialData: [
          { id: 20, groupId: 2 },
          { id: 30, groupId: 3 },
          { id: 40, groupId: 4 },
        ] satisfies ReadonlyArray<ChildRow>,
        getKey: (row: ChildRow) => row.id,
      }),
    )
    const live = createLiveQueryCollection((query) =>
      query
        .from({ parent: parentSource })
        .innerJoin({ child: childSource }, ({ parent, child }) =>
          eq(parent.groupId, child.groupId),
        )
        .orderBy(({ parent }) => parent.rank, `asc`)
        .orderBy(({ parent }) => parent.id, `asc`)
        .limit(2)
        .select(({ parent }) => ({ id: parent.id })),
    )

    try {
      await live.preload()
      await flushPromises()

      expect(Array.from(live.values(), ({ id }) => id)).toEqual([2, 3])
      expect(requests).toHaveLength(2)
      expect(requests[0]?.limit).toBe(2)
      expect(requests[1]?.cursor).toBeDefined()
    } finally {
      await cleanupAll(live, childSource, parentSource)
    }
  })

  it(`loads the full ordered source when no continuation index exists`, async () => {
    type ParentRow = { id: number; rank: number; groupId: number }
    type ChildRow = { id: number; groupId: number }
    const parents = [
      { id: 1, rank: 0, groupId: 1 },
      { id: 2, rank: 1, groupId: 2 },
      { id: 3, rank: 2, groupId: 3 },
      { id: 4, rank: 3, groupId: 4 },
    ] satisfies ReadonlyArray<ParentRow>
    const { requests, source: parentSource } = createConformingOrderedSource(
      `pagination-no-index-underfill-source-${collectionSequence++}`,
      parents,
      `off`,
    )
    const childSource = createCollection(
      mockSyncCollectionOptions({
        id: `pagination-no-index-underfill-child-${collectionSequence++}`,
        initialData: [
          { id: 20, groupId: 2 },
          { id: 30, groupId: 3 },
          { id: 40, groupId: 4 },
        ] satisfies ReadonlyArray<ChildRow>,
        getKey: (row: ChildRow) => row.id,
      }),
    )
    const live = createLiveQueryCollection((query) =>
      query
        .from({ parent: parentSource })
        .innerJoin({ child: childSource }, ({ parent, child }) =>
          eq(parent.groupId, child.groupId),
        )
        .orderBy(({ parent }) => parent.rank, `asc`)
        .orderBy(({ parent }) => parent.id, `asc`)
        .limit(2)
        .select(({ parent }) => ({ id: parent.id })),
    )

    try {
      await live.preload()
      await flushPromises()

      expect(Array.from(live.values(), ({ id }) => id)).toEqual([2, 3])
      expect(requests).toHaveLength(1)
      expect(requests[0]?.limit).toBeUndefined()
    } finally {
      await cleanupAll(live, childSource, parentSource)
    }
  })

  it(`refines a joined foreign order term through the source tie class`, async () => {
    type ParentRow = { id: number; sourceRank: number; childId: number }
    type ChildRow = { id: number; score: number }
    const parents = [
      { id: 1, sourceRank: 0, childId: 1 },
      { id: 2, sourceRank: 0, childId: 2 },
      { id: 3, sourceRank: 0, childId: 3 },
      { id: 4, sourceRank: 0, childId: 4 },
    ] satisfies ReadonlyArray<ParentRow>
    const { requests, source: parentSource } = createConformingOrderedSource(
      `pagination-joined-foreign-order-source-${collectionSequence++}`,
      parents,
    )
    const childSource = createCollection(
      mockSyncCollectionOptions({
        id: `pagination-joined-foreign-order-child-${collectionSequence++}`,
        initialData: [
          { id: 1, score: 10 },
          { id: 2, score: 20 },
          { id: 3, score: 0 },
          { id: 4, score: 30 },
        ] satisfies ReadonlyArray<ChildRow>,
        getKey: (row: ChildRow) => row.id,
      }),
    )
    const live = createLiveQueryCollection((query) =>
      query
        .from({ parent: parentSource })
        .leftJoin({ child: childSource }, ({ parent, child }) =>
          eq(parent.childId, child.id),
        )
        .orderBy(({ parent }) => parent.sourceRank, `asc`)
        .orderBy(({ child }) => child.score, `asc`)
        .orderBy(({ parent }) => parent.id, `asc`)
        .limit(2)
        .select(({ parent }) => ({ id: parent.id })),
    )

    try {
      await live.preload()
      await flushPromises()

      expect(Array.from(live.values(), ({ id }) => id)).toEqual([3, 1])
      expect(requests).toHaveLength(2)
      expect(requests[0]?.orderBy).toHaveLength(1)
      expect(requests[1]?.cursor).toBeDefined()
    } finally {
      await cleanupAll(live, childSource, parentSource)
    }
  })

  it(`materializes an empty source window`, async () => {
    await runPaginationScenario({
      ranks: [],
      direction: `asc`,
      windows: [{ offset: 0, limit: 3 }],
    })
  })

  it(`materializes an offset past the final row`, async () => {
    await runPaginationScenario({
      ranks: [0, 1],
      direction: `asc`,
      windows: [{ offset: 4, limit: 2 }],
    })
  })

  it(`materializes an initially empty zero-limit window`, async () => {
    await runPaginationScenario({
      ranks: [0, 1, 2],
      direction: `asc`,
      windows: [{ offset: 0, limit: 0 }],
    })
  })

  it(`clears and restores a nonempty window across a zero limit`, async () => {
    await runPaginationScenario({
      ranks: [0, 1, 2],
      direction: `asc`,
      windows: [
        { offset: 0, limit: 2 },
        { offset: 0, limit: 0 },
        { offset: 1, limit: 1 },
      ],
    })
  })

  it(`discovered trace: loads an on-demand window after a zero limit`, async () => {
    await runOnDemandPaginationScenario({
      ranks: [0, 0],
      direction: `asc`,
      windows: [
        { offset: 1, limit: 0 },
        { offset: 0, limit: 2 },
      ],
    })
  })

  it(`widens an offset on-demand window after starting at zero limit`, async () => {
    await runOnDemandPaginationScenario({
      ranks: [-1, 0, 0, 0, -1, 0],
      direction: `asc`,
      windows: [
        { offset: 1, limit: 0 },
        { offset: 4, limit: 1 },
        { offset: 4, limit: 2 },
        { offset: 0, limit: 0 },
      ],
    })
  })

  it(`keeps synchronous limited satisfaction local to the active window`, async () => {
    const rows: Array<PageRow> = [
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
      { id: 3, rank: 3 },
    ]
    const requests: Array<LoadSubsetOptions> = []
    const delivered = new Set<number>()
    const source = createCollection<PageRow>({
      id: `pagination-sync-limited-source-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              requests.push(options)
              begin()
              for (const row of rowsForLoadSubset(rows, options)) {
                if (delivered.has(row.id)) continue
                delivered.add(row.id)
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
        .orderBy(({ row }) => row.id, `asc`)
        .limit(1),
    )

    try {
      await live.preload()
      await flushPromises()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])
      expect(source._sync.getLoadSubsetCoverage()).toEqual([])

      const widened = live.utils.setWindow({ offset: 0, limit: 2 })
      if (widened instanceof Promise) await widened
      await flushPromises()

      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])
      expect(requests).toHaveLength(2)
      expect(requests[0]?.limit).toBe(1)
      expect(requests[1]).toMatchObject({ limit: 2, offset: 0 })
      expect(requests[1]?.cursor).toBeUndefined()
    } finally {
      await cleanupAll(live, source)
    }
  })

  it(`admits only applied rows when the source extent is unknown`, async () => {
    const providerRows: Array<PageRow> = [
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
      { id: 3, rank: 3 },
    ]
    const delivered = new Set<number>()
    const source = createCollection<PageRow>({
      id: `pagination-unknown-extent-source-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 99, rank: -1 } })
          commit()
          markReady()
          return {
            loadSubset: (options: LoadSubsetOptions) => {
              const requested = rowsForLoadSubset(providerRows, options)
              begin()
              for (const row of requested) {
                if (delivered.has(row.id)) continue
                delivered.add(row.id)
                write({ type: `insert`, value: { ...row } })
              }
              const receipt = commit()
              return Promise.resolve(receipt).then(() => ({
                hasMore: undefined,
                appliedRowKeys: requested.map(({ id }) => id),
              }))
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

    try {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])
    } finally {
      await cleanupAll(live, source)
    }
  })

  it.each([
    [`unknown`, undefined, [1, 2, 3], `covering`],
    [`unknown`, undefined, [1, 2, 3], `narrower`],
    [`continues`, true, [1, 2, 3], `covering`],
    [`continues`, true, [1, 2, 3], `narrower`],
    [`exhausted`, false, [99, 1, 2], `covering`],
    [`exhausted`, false, [99, 1, 2], `narrower`],
  ] satisfies ReadonlyArray<
    readonly [
      string,
      boolean | undefined,
      ReadonlyArray<number>,
      `covering` | `narrower`,
    ]
  >)(
    `projects a shared covering acquisition into exact and narrower windows (%s, release %s first)`,
    async (_extent, hasMore, expectedCovering, releaseFirst) => {
      const providerRows: Array<PageRow> = [
        { id: 1, rank: 1 },
        { id: 2, rank: 2 },
        { id: 3, rank: 3 },
        { id: 4, rank: 4 },
      ]
      const settlement = createDeferred<void>()
      const physicalLoads: Array<LoadSubsetOptions> = []
      let begin!: () => void
      let write!: (change: { type: `insert`; value: PageRow }) => void
      let commit!: () => void
      let deduplicated!: DeduplicatedLoadSubset
      const source = createCollection<PageRow>({
        id: `pagination-shared-provenance-source-${collectionSequence++}`,
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
            write({ type: `insert`, value: { id: 99, rank: -1 } })
            commit()
            params.markReady()
            deduplicated = new DeduplicatedLoadSubset({
              loadSubset: (options) => {
                physicalLoads.push(options)
                const requested = rowsForLoadSubset(providerRows, options)
                begin()
                for (const row of requested) {
                  write({ type: `insert`, value: { ...row } })
                }
                const receipt = commit()
                return Promise.all([receipt, settlement.promise]).then(
                  () =>
                    ({
                      hasMore,
                      appliedRowKeys: requested.map(({ id }) => id),
                    }) satisfies LoadSubsetResult,
                )
              },
            })
            return {
              loadSubset: (options) => deduplicated.loadSubset(options),
            }
          },
        },
      })
      const covering = createLiveQueryCollection((query) =>
        query
          .from({ row: source })
          .orderBy(({ row }) => row.rank, `asc`)
          .orderBy(({ row }) => row.id, `asc`)
          .limit(3),
      )
      const narrower = createLiveQueryCollection((query) =>
        query
          .from({ row: source })
          .orderBy(({ row }) => row.rank, `asc`)
          .orderBy(({ row }) => row.id, `asc`)
          .limit(2),
      )

      try {
        const coveringReady = covering.preload()
        const narrowerReady = narrower.preload()
        await flushPromises()
        expect(physicalLoads).toHaveLength(1)
        settlement.resolve()
        await Promise.all([coveringReady, narrowerReady])
        expect(Array.from(covering.values(), ({ id }) => id)).toEqual(
          expectedCovering,
        )
        expect(Array.from(narrower.values(), ({ id }) => id)).toEqual(
          expectedCovering.slice(0, 2),
        )

        const covered = createLiveQueryCollection((query) =>
          query
            .from({ row: source })
            .orderBy(({ row }) => row.rank, `asc`)
            .orderBy(({ row }) => row.id, `asc`)
            .limit(1),
        )
        try {
          await covered.preload()
          expect(Array.from(covered.values(), ({ id }) => id)).toEqual(
            expectedCovering.slice(0, 1),
          )
        } finally {
          await cleanupAll(covered)
        }

        if (releaseFirst === `covering`) {
          await cleanupAll(covering)
          expect(Array.from(narrower.values(), ({ id }) => id)).toEqual(
            expectedCovering.slice(0, 2),
          )
        } else {
          await cleanupAll(narrower)
          expect(Array.from(covering.values(), ({ id }) => id)).toEqual(
            expectedCovering,
          )
        }
      } finally {
        await cleanupAll(covering, narrower, source)
      }
    },
  )

  it(`tracks an asynchronous prefix refresh after synchronous satisfaction`, async () => {
    const rows: Array<PageRow> = [
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
      { id: 3, rank: 3 },
    ]
    const requests: Array<LoadSubsetOptions> = []
    const delivered = new Set<number>()
    const refinement = createDeferred<void>()
    let loadCount = 0
    const source = createCollection<PageRow>({
      id: `pagination-async-refinement-source-${collectionSequence++}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          const publish = (options: LoadSubsetOptions) => {
            const appliedRowKeys: Array<number> = []
            begin()
            for (const row of rowsForLoadSubset(rows, options)) {
              if (delivered.has(row.id)) continue
              delivered.add(row.id)
              appliedRowKeys.push(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            commit()
            return appliedRowKeys
          }

          return {
            loadSubset: (options: LoadSubsetOptions) => {
              requests.push(options)
              loadCount += 1
              if (loadCount === 1) {
                publish(options)
                return true
              }

              return refinement.promise.then(() => ({
                hasMore: false,
                appliedRowKeys: publish(options),
              }))
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
        .limit(1),
    )

    try {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])
      expect(requests.map(({ limit }) => limit)).toEqual([1])

      const widened = live.utils.setWindow({ offset: 0, limit: 2 })
      expect(widened).toBeInstanceOf(Promise)
      await flushPromises()
      expect(requests.map(({ limit }) => limit)).toEqual([1, 2])
      expect(requests[1]).toMatchObject({ offset: 0 })
      expect(requests[1]?.cursor).toBeUndefined()
      const settledBeforeRefinement = await Promise.race([
        Promise.resolve(widened).then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 10)),
      ])
      expect(settledBeforeRefinement).toBe(false)

      refinement.resolve()
      if (widened instanceof Promise) await widened
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])
    } finally {
      await cleanupAll(live, source)
    }
  })

  it(`refines locale-ordered continuations locally when predicate IR cannot express the collation`, async () => {
    const rows: Array<LocaleCursorRow> = [
      { id: 1, label: `item2` },
      { id: 2, label: `item10` },
      { id: 3, label: `item11` },
    ]
    const pending: Array<PendingCursorLoad> = []
    const delivered = new Set<number>()
    let begin!: () => void
    let write!: (message: { type: `insert`; value: LocaleCursorRow }) => void
    let commit!: () => void
    const source = createCollection<LocaleCursorRow>({
      id: `pagination-locale-cursor-source-${collectionSequence++}`,
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
              return withAppliedSubsetEvidence(
                () => rows,
                options,
                deferred.promise,
              )
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.label, {
          direction: `asc`,
          nulls: `first`,
          stringSort: `locale`,
          locale: `en-US`,
          localeOptions: { numeric: true },
        })
        .orderBy(({ row }) => row.id, `asc`)
        .limit(1),
    )

    try {
      const preload = live.preload()
      expect(pending).toHaveLength(1)
      // Settling one request can append its boundary-refinement request.
      // eslint-disable-next-line @typescript-eslint/prefer-for-of
      for (let index = 0; index < pending.length; index++) {
        const request = pending[index]!
        begin()
        for (const row of rowsForLoadSubset(rows, request.options)) {
          if (delivered.has(row.id)) continue
          delivered.add(row.id)
          write({ type: `insert`, value: { ...row } })
        }
        commit()
        request.deferred.resolve()
        await flushPromises()
      }
      await preload

      expect(pending).toHaveLength(2)
      const refinement = pending[1]!
      expect(refinement.options.cursor).toBeUndefined()
      expect(refinement.options.limit).toBeUndefined()
      expect(refinement.options.offset).toBeUndefined()

      const transportCount = pending.length
      const widened = live.utils.setWindow({ offset: 0, limit: 2 })
      expect(widened).toBe(true)

      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])
      expect(pending).toHaveLength(transportCount)
    } finally {
      for (const request of pending) request.deferred.resolve()
      await cleanupAll(live, source)
    }
  })

  const nullableBoundaryRows: ReadonlyArray<MultiOrderRow> = [
    { id: 1, primary: null, secondary: 2 },
    { id: 2, primary: null, secondary: 0 },
    { id: 3, primary: null, secondary: 1 },
    { id: 4, primary: 1, secondary: null },
    { id: 5, primary: 1, secondary: 0 },
    { id: 6, primary: 2, secondary: 0 },
  ]

  it.each([
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
  ] satisfies ReadonlyArray<readonly [string, MultiOrderScenario]>)(
    `%s`,
    async (_name, scenario) => runMultiOrderScenario(scenario),
  )

  fcTest.prop([multiOrderScenarioArbitrary], {
    numRuns: orderedScenarioRuns,
    seed: 1663,
  })(
    `matches multi-column nullable ordering for a fixed seed`,
    runMultiOrderScenario,
  )

  fcTest.prop(
    [multiOrderScenarioArbitrary],
    oracleRandomParameters(orderedScenarioRuns, replaySeed),
  )(
    `matches multi-column nullable ordering for a random or replayed seed`,
    runMultiOrderScenario,
  )

  fcTest.prop([nullableCursorScenarioArbitrary], {
    numRuns: transitionScenarioRuns,
    seed: 1665,
  })(
    `matches nullable cursor ordering while an async response is pending for a fixed seed`,
    runNullableCursorScenario,
  )

  fcTest.prop(
    [nullableCursorScenarioArbitrary],
    oracleRandomParameters(transitionScenarioRuns, replaySeed),
  )(
    `matches nullable cursor ordering while an async response is pending for a random or replayed seed`,
    runNullableCursorScenario,
  )

  it.each([
    [`boundary insert`, { type: `insert`, row: { id: 5, rank: 0.5 } }],
    [`visible delete`, { type: `delete`, id: 1 }],
    [
      `boundary-crossing rank update`,
      { type: `update`, row: { id: 4, rank: 0.5 } },
    ],
  ] satisfies ReadonlyArray<readonly [string, PendingMutation]>)(
    `%s converges before and after a pending response`,
    async (_name, mutation) => {
      const scenario: PendingMutationScenario = {
        ranks: [0, 1, 2, 3],
        direction: `asc`,
        limit: 3,
        mutation,
        responseOutcome: `resolve`,
      }
      await runPendingMutationScenario(scenario, `before-response`)
      await runPendingMutationScenario(scenario, `after-response`)
    },
  )

  it.each([
    [`insert`, { type: `insert`, row: { id: 9, rank: 0.5 } }],
    [`delete`, { type: `delete`, id: 1 }],
    [`rank update`, { type: `update`, row: { id: 2, rank: 10 } }],
  ] satisfies ReadonlyArray<readonly [string, PendingMutation]>)(
    `revalidates a finite ordered prefix after a settled SSE %s`,
    async (_name, mutation) => {
      await runPendingMutationScenario(
        {
          ranks: [0, 1, 2, 3, 4, 5, 6, 7],
          direction: `asc`,
          limit: 2,
          mutation,
          responseOutcome: `resolve`,
        },
        `after-response`,
      )
    },
  )

  it(`retains a finite inactive prefix across shrink, SSE, and re-expansion`, async () => {
    const rows = new Map<number, PageRow>(
      Array.from({ length: 5 }, (_, index) => [
        index + 1,
        { id: index + 1, rank: index + 1 },
      ]),
    )
    const delivered = new Set<number>()
    let begin!: () => void
    let write!: (message: { type: `insert`; value: PageRow }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-retained-prefix-live-${collectionSequence++}`,
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
              const ordered = [...rows.values()].sort(
                (left, right) => left.rank - right.rank || left.id - right.id,
              )
              const requested = rowsForLoadSubset(ordered, options)
              begin()
              for (const row of requested) {
                if (delivered.has(row.id)) continue
                delivered.add(row.id)
                write({ type: `insert`, value: { ...row } })
              }
              const receipt = commit()
              return Promise.resolve(receipt).then(() => ({
                hasMore: requested.length < ordered.length,
                appliedRowKeys: requested.map(({ id }) => id),
              }))
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
        .limit(3),
    )

    try {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2, 3])

      await live.utils.setWindow({ offset: 0, limit: 1 })
      const inserted = { id: 9, rank: 2.5 }
      rows.set(inserted.id, inserted)
      delivered.add(inserted.id)
      begin()
      write({ type: `insert`, value: inserted })
      commit()
      await flushPromises()

      await live.utils.setWindow({ offset: 0, limit: 3 })
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2, 9])
    } finally {
      await cleanupAll(live, source)
    }
  })

  it.each([`asc`, `desc`] as const)(
    `refreshes from the start when one SSE batch moves the retained prefix (%s)`,
    async (direction) => {
      const rows = new Map<number, PageRow>(
        Array.from({ length: 6 }, (_, index) => [
          index + 1,
          { id: index + 1, rank: index + 1 },
        ]),
      )
      const delivered = new Set<number>()
      const loads: Array<LoadSubsetOptions> = []
      let begin!: () => void
      let write!: (message: {
        type: `insert` | `update`
        value: PageRow
      }) => void
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
                return withAppliedSubsetEvidence(
                  () =>
                    referenceWindowRows([...rows.values()], direction, {
                      offset: 0,
                      limit: rows.size,
                    }),
                  options,
                  settled,
                )
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
        expect(loads.at(-1)).toMatchObject({ offset: 0, limit: 2 })
        expect(loads.at(-1)?.cursor).toBeUndefined()
      } finally {
        await cleanupAll(live, source)
      }
    },
  )

  it.each([
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
  >)(
    `keeps an SSE %s that arrives during boundary refinement`,
    async (_name, mutation, expectedIds, expectedWideIds) => {
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
                return withAppliedSubsetEvidence(
                  () =>
                    referenceWindowRows([...rows.values()], `asc`, {
                      offset: 0,
                      limit: rows.size,
                    }),
                  options,
                  deferred.promise,
                )
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
        expect(pending).toHaveLength(3)
        expect(pending[2]?.options).toMatchObject({ offset: 0, limit: 2 })
        expect(pending[2]?.options.cursor).toBeUndefined()
        for (let index = 2; index < pending.length; index++) {
          await settle(pending[index]!)
        }
        await preload

        expect(Array.from(live.values(), ({ id }) => id)).toEqual(expectedIds)

        const pendingBeforeWiden = pending.length
        const widened = live.utils.setWindow({ offset: 0, limit: 3 })
        await flushPromises()
        expect(pending).toHaveLength(pendingBeforeWiden + 1)
        expect(pending[pendingBeforeWiden]?.options.offset).toBe(3)
        expect(pending[pendingBeforeWiden]?.options.cursor).toBeDefined()
        for (let index = pendingBeforeWiden; index < pending.length; index++) {
          await settle(pending[index]!)
        }
        if (widened instanceof Promise) await widened
        expect(Array.from(live.values(), ({ id }) => id)).toEqual(
          expectedWideIds,
        )
      } finally {
        for (const request of pending) request.deferred.resolve()
        await cleanupAll(live, source)
      }
    },
  )

  it(`does not use a new row beyond finite coverage as a widening boundary`, async () => {
    await runPendingMutationScenario(
      {
        ranks: [0, 1, 2, 3, 4, 5, 6, 7],
        direction: `asc`,
        limit: 2,
        mutation: { type: `insert`, row: { id: 9, rank: 4.5 } },
        responseOutcome: `resolve`,
      },
      `after-response`,
      5,
    )
  })

  it(`discovered trace: a settled rank update refreshes top-k membership`, async () => {
    const scenario: PendingMutationScenario = {
      ranks: [0, 0, 1],
      direction: `desc`,
      limit: 1,
      mutation: { type: `update`, row: { id: 3, rank: 0 } },
      responseOutcome: `resolve`,
    }
    await runPendingMutationScenario(scenario, `after-response`)
  })

  it(`a rejected cursor does not treat a live insert as remote coverage`, async () => {
    const scenario: PendingMutationScenario = {
      ranks: [0, -1, 0],
      direction: `asc`,
      limit: 1,
      mutation: { type: `insert`, row: { id: 4, rank: 0 } },
      responseOutcome: `reject`,
    }

    await runPendingMutationScenario(scenario, `before-response`)
  })

  fcTest.prop([pendingMutationScenarioArbitrary, responseTimingArbitrary], {
    numRuns: transitionScenarioRuns,
    seed: 1660,
  })(
    `matches recomputation when source mutations cross a pending cursor response for a fixed seed`,
    runPendingMutationScenario,
  )

  it.each(
    ([`insert`, `update`, `delete`] as const).flatMap((mutationKind) =>
      ([`resolve`, `reject`] as const).flatMap((responseOutcome) =>
        ([`before-response`, `after-response`] as const).map(
          (timing) => [mutationKind, responseOutcome, timing] as const,
        ),
      ),
    ),
  )(
    `covers pending %s with a %s response %s deterministically`,
    async (mutationKind, responseOutcome, timing) => {
      const mutation: PendingMutation =
        mutationKind === `insert`
          ? { type: `insert`, row: { id: 5, rank: -1 } }
          : mutationKind === `update`
            ? { type: `update`, row: { id: 2, rank: -1 } }
            : { type: `delete`, id: 2 }
      await runPendingMutationScenario(
        {
          ranks: [0, 1, 2, 3],
          direction: `asc`,
          limit: 2,
          mutation,
          responseOutcome,
        },
        timing,
      )
    },
  )

  fcTest.prop(
    [pendingMutationScenarioArbitrary, responseTimingArbitrary],
    oracleRandomParameters(transitionScenarioRuns, replaySeed),
  )(
    `matches recomputation when source mutations cross a pending cursor response for a random or replayed seed`,
    runPendingMutationScenario,
  )

  it(
    `discovered trace: retries a rejected cursor after a source and window transition`,
    runRejectedCursorRetryAfterMutation,
  )

  fcTest.prop([pendingHistoryScenarioArbitrary], {
    numRuns: transitionScenarioRuns,
    seed: 1664,
  })(
    `matches recomputation across multi-action pending histories for a fixed seed`,
    runPendingHistoryScenario,
  )

  fcTest.prop(
    [pendingHistoryScenarioArbitrary],
    oracleRandomParameters(transitionScenarioRuns, replaySeed),
  )(
    `matches recomputation across multi-action pending histories for a random or replayed seed`,
    runPendingHistoryScenario,
  )

  it(
    `discovered trace: an in-flight request does not underfill a new window`,
    expectInflightRequestFillsNewWindow,
  )

  it(`discovered trace: a row moving across an offset window must refill its boundary`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 0, 0],
      direction: `desc`,
      initialWindow: { offset: 1, limit: 1 },
      actions: [{ type: `put`, id: 1, rank: -1 }],
    }
    await runPaginationStateScenario(scenario)
  })

  it(`retains authoritative rows when a later window admits a prior insert`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 0],
      direction: `asc`,
      initialWindow: { offset: 0, limit: 1 },
      actions: [
        { type: `put`, id: 3, rank: 1 },
        { type: `window`, offset: 0, limit: 3 },
      ],
    }
    await runPaginationStateScenario(scenario)
  })

  it(`restores an out-of-window insert when a later offset selects it`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 0],
      direction: `asc`,
      initialWindow: { offset: 0, limit: 1 },
      actions: [
        { type: `put`, id: 3, rank: 1 },
        { type: `window`, offset: 2, limit: 1 },
      ],
    }
    await runPaginationStateScenario(scenario)
  })

  it(`restores an out-of-window rank update when a later offset selects it`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 0, 0],
      direction: `asc`,
      initialWindow: { offset: 0, limit: 1 },
      actions: [
        { type: `put`, id: 2, rank: 1 },
        { type: `window`, offset: 2, limit: 1 },
      ],
    }
    await runPaginationStateScenario(scenario)
  })

  it(`discovered trace: inserting at an empty offset boundary refills the window`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 0],
      direction: `asc`,
      initialWindow: { offset: 0, limit: 1 },
      actions: [
        { type: `put`, id: 3, rank: 1 },
        { type: `window`, offset: 3, limit: 1 },
        { type: `put`, id: 4, rank: 1 },
      ],
    }
    await runPaginationStateScenario(scenario)
  })

  it(`discovered trace: an insert before a later offset does not skip its new boundary`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [-1, -1, 0, -1, 0, -1, 0, 1, 1],
      direction: `asc`,
      initialWindow: { offset: 0, limit: 3 },
      actions: [
        { type: `put`, id: 10, rank: 0 },
        { type: `window`, offset: 8, limit: 1 },
      ],
    }

    await runPaginationStateScenario(scenario)
  })

  it(`discovered trace: an async cursor loads the full offset window`, async () => {
    const scenario: PaginationScenario = {
      ranks: [0, 0, 0, 0, 0, 0, 1],
      direction: `asc`,
      windows: [
        { offset: 0, limit: 1 },
        { offset: 2, limit: 5 },
      ],
    }
    await runOnDemandPaginationScenario(scenario)
  })

  it(`discovered trace: an async cursor crosses an offset before filling one row`, async () => {
    const scenario: PaginationScenario = {
      ranks: [0, 0, -1],
      direction: `asc`,
      windows: [
        { offset: 0, limit: 1 },
        { offset: 2, limit: 1 },
      ],
    }
    await runOnDemandPaginationScenario(scenario)
  })

  fcTest.prop([scenarioArbitrary], {
    numRuns: orderedScenarioRuns,
    seed: 1657,
  })(
    `matches full recomputation across ordered windows for a fixed seed`,
    runPaginationScenario,
  )

  fcTest.prop([scenarioArbitrary], orderedScenarioRandomParameters)(
    `matches full recomputation across ordered windows for a random or replayed seed`,
    runPaginationScenario,
  )

  fcTest.prop([stateScenarioArbitrary], {
    numRuns: transitionScenarioRuns,
    seed: 1658,
  })(
    `matches full recomputation across source and window transitions for a fixed seed`,
    runPaginationStateScenario,
  )

  fcTest.prop(
    [stateScenarioArbitrary],
    oracleRandomParameters(transitionScenarioRuns, replaySeed),
  )(
    `matches full recomputation across source and window transitions for a random or replayed seed`,
    runPaginationStateScenario,
  )

  it(`discovered trace: a rank update must refill a top-1 window`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 0],
      direction: `asc`,
      initialWindow: { offset: 0, limit: 1 },
      actions: [{ type: `put`, id: 1, rank: 1 }],
    }
    await runPaginationStateScenario(scenario)
  })

  it(`ignores an out-of-window insert when refilling after a delete`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [100, 90, 80, 70],
      direction: `desc`,
      initialWindow: { offset: 0, limit: 3 },
      actions: [
        { type: `put`, id: 5, rank: 10 },
        { type: `delete`, id: 2 },
      ],
    }
    await runPaginationStateScenario(scenario)
  })

  it(`ignores an out-of-window rank update when refilling after a delete`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 0, 0],
      direction: `asc`,
      initialWindow: { offset: 0, limit: 1 },
      actions: [
        { type: `put`, id: 2, rank: 1 },
        { type: `delete`, id: 1 },
      ],
    }

    await runPaginationStateScenario(scenario)
  })

  it(`ignores an out-of-window rank update when the visible row leaves`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 0, 0],
      direction: `asc`,
      initialWindow: { offset: 0, limit: 1 },
      actions: [
        { type: `put`, id: 2, rank: 1 },
        { type: `put`, id: 1, rank: 2 },
      ],
    }

    await runPaginationStateScenario(scenario)
  })

  it(`refills untouched rows when widening after an out-of-window rank update`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 0, 0],
      direction: `desc`,
      initialWindow: { offset: 0, limit: 1 },
      actions: [
        { type: `put`, id: 2, rank: -1 },
        { type: `window`, offset: 0, limit: 3 },
      ],
    }

    await runPaginationStateScenario(scenario)
  })

  it(`rebuilds the full boundary when widening after an out-of-window rank update`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [1, 0, 1, 0, 1],
      direction: `desc`,
      initialWindow: { offset: 0, limit: 1 },
      actions: [
        { type: `put`, id: 3, rank: 0 },
        { type: `window`, offset: 0, limit: 4 },
      ],
    }

    await runPaginationStateScenario(scenario)
  })

  it(`ignores an out-of-window insert when widening a tied window`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 0],
      direction: `asc`,
      initialWindow: { offset: 0, limit: 1 },
      actions: [
        { type: `put`, id: 3, rank: 0 },
        { type: `window`, offset: 0, limit: 2 },
      ],
    }
    await runPaginationStateScenario(scenario)
  })

  it(`expands a multi-column boundary before choosing top-K`, async () => {
    await expectMultiOrderBoundaryMatches()
  })

  it(`expands a provider tie before applying the public-key tie-breaker`, async () => {
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
    expect(loads[1]?.cursor).toBeDefined()
  })

  it(`does not derive an ordered boundary from another demand's local row`, async () => {
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
  })

  it(`refines an initial locale window without trusting provider collation`, async () => {
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
  })

  it.each([`continues`, `unknown`] as const)(
    `does not treat an unbounded capped locale request as full coverage when extent is %s`,
    async (reportedExtent) => {
      const loads = await runAdversarialOrderedProviderScenario({
        providerRows: [
          { id: 1, rank: 0, label: `item2` },
          { id: 2, rank: 0, label: `item10` },
          { id: 3, rank: 0, label: `item11` },
        ],
        order: { kind: `locale` },
        limit: 1,
        expectedIds: [1],
        providerPageCap: 1,
        reportedExtent,
        widenTo: 2,
        expectNoProgress: true,
      })

      expect(loads[1]?.limit).toBeUndefined()
      expect(loads[1]?.offset).toBeUndefined()
      expect(loads.map(({ limit }) => limit)).toEqual([1, undefined, undefined])
      expect(loads.slice(1).every(({ cursor }) => cursor === undefined)).toBe(
        true,
      )
    },
  )

  it(`refines an initial reference-ordered window locally`, async () => {
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
  })

  it.each(
    ([`asc`, `desc`] as const).flatMap((direction) =>
      ([`first`, `last`] as const).map((nulls) => ({ direction, nulls })),
    ),
  )(
    `refines invalid Date ties with an unbounded local-order request ($direction, nulls $nulls)`,
    async ({ direction, nulls }) => {
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
    },
  )

  it(`keeps ascending public-key ties when reusing a descending index`, async () => {
    const rows: Array<PageRow> = [
      { id: 3, rank: 1 },
      { id: 1, rank: 0 },
      { id: 2, rank: 0 },
    ]
    const source = createCollection(
      mockSyncCollectionOptions({
        id: `pagination-reversed-index-ties-${collectionSequence++}`,
        initialData: rows,
        getKey: (row: PageRow) => row.id,
      }),
    )
    source.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
      options: {
        compareOptions: {
          direction: `asc`,
          nulls: `first`,
          stringSort: `locale`,
        },
      },
    })
    const live = createLiveQueryCollection((query) =>
      query
        .from({ row: source })
        .orderBy(({ row }) => row.rank, `desc`)
        .limit(2),
    )

    try {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([3, 1])
    } finally {
      await cleanupAll(live, source)
    }
  })

  it.each([{ ids: [1, Number.NaN] }, { ids: [Number.NaN, 1] }])(
    `keeps finite public keys before NaN across insertion order`,
    async ({ ids }) => {
      const source = createCollection(
        mockSyncCollectionOptions({
          id: `pagination-nan-key-order-${collectionSequence++}`,
          initialData: ids.map((id) => ({ id, rank: 0 })),
          getKey: (row: PageRow) => row.id,
          autoIndex: `eager`,
        }),
      )
      const live = createLiveQueryCollection((query) =>
        query
          .from({ row: source })
          .orderBy(({ row }) => row.rank, `asc`)
          .limit(1),
      )

      try {
        await live.preload()
        expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])
      } finally {
        await cleanupAll(live, source)
      }
    },
  )

  it(`stabilizes an on-demand window with a NaN public-key tie`, async () => {
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
  })

  it.each([
    { direction: `asc`, nulls: `first`, expectedIds: [1, 2] },
    { direction: `asc`, nulls: `last`, expectedIds: [2, 3] },
    { direction: `desc`, nulls: `first`, expectedIds: [1, 3] },
    { direction: `desc`, nulls: `last`, expectedIds: [3, 2] },
  ] as const)(
    `keeps null placement and $direction across source refinement ($nulls)`,
    async ({ direction, nulls, expectedIds }) => {
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
    },
  )

  fcTest.prop([scenarioArbitrary], {
    numRuns: transitionScenarioRuns,
    seed: 1659,
  })(
    `matches full recomputation when exact async cursor loads widen ordered coverage for a fixed seed`,
    runOnDemandPaginationScenario,
  )

  fcTest.prop(
    [scenarioArbitrary],
    oracleRandomParameters(transitionScenarioRuns, replaySeed),
  )(
    `matches full recomputation when exact async cursor loads widen ordered coverage for a random or replayed seed`,
    runOnDemandPaginationScenario,
  )

  it.each([`forward`, `reverse`] as const)(
    `keeps concurrent on-demand windows correct under %s completion`,
    expectOnDemandWindowsAreCompletionOrderIndependent,
  )
})
