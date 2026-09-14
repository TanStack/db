import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq } from '../../src/query/builder/functions.js'
import { PropRef } from '../../src/query/ir.js'
import { makeComparator } from '../../src/utils/comparison.js'
import {
  oracleRandomParameters,
  readOracleRunConfig,
} from '../oracle-config.js'
import { evaluateReferenceExpression } from '../reference-expression.js'
import { TraceAssertionError } from '../trace-runner.js'
import { flushPromises, mockSyncCollectionOptions } from '../utils.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import type { Deferred } from '../../src/deferred.js'
import type {
  ChangeMessage,
  LoadSubsetOptions,
  SyncConfig,
} from '../../src/types.js'

type PageRow = {
  id: number
  rank: number
  keep?: boolean
}

type PublicPageRow = Pick<PageRow, `id` | `rank`>
type PublicPageChange = {
  type: `insert` | `update` | `delete`
  key: number
  value: PublicPageRow
  previousValue?: PublicPageRow
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
  keeps?: ReadonlyArray<boolean>
  direction: `asc` | `desc`
  windows: ReadonlyArray<PaginationWindow>
  explicitPublicKeyOrder?: boolean
  includeFilter?: boolean
  reverseInsertion?: boolean
  reverseProviderTies?: boolean
  localRowsBeforeFirstRequest?: ReadonlyArray<PageRow>
}

type PaginationAction =
  | ({ type: `window` } & PaginationWindow)
  | { type: `put`; id: number; rank: number; keep?: boolean }
  | { type: `delete`; id: number }

type PaginationStateScenario = {
  ranks: ReadonlyArray<number>
  keeps?: ReadonlyArray<boolean>
  direction: `asc` | `desc`
  initialWindow: PaginationWindow
  actions: ReadonlyArray<PaginationAction>
  explicitPublicKeyOrder?: boolean
  includeFilter?: boolean
  reverseInsertion?: boolean
}

type PaginationStructure = Pick<
  PaginationScenario,
  `explicitPublicKeyOrder` | `includeFilter` | `reverseInsertion`
>

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

const { multiplier, ...replay } = readOracleRunConfig()
const orderedScenarioRuns = 12 * multiplier
const transitionScenarioRuns = 8 * multiplier

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
    .map(({ id, rank }) => ({ id, rank }))
}

function projectPageRow(row: PageRow): PublicPageRow {
  return { id: row.id, rank: row.rank }
}

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
    } else if (next.rank !== row.rank) {
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

function visibleRows(
  rows: ReadonlyArray<PageRow>,
  includeFilter: boolean | undefined,
): Array<PageRow> {
  return includeFilter ? rows.filter(({ keep }) => keep) : [...rows]
}

function rowsForLoadSubset<TRow extends { id: number }>(
  rows: ReadonlyArray<TRow>,
  options: LoadSubsetOptions,
): Array<TRow> {
  const matchingRows = options.where
    ? rows.filter(
        (row) => evaluateReferenceExpression(options.where!, row) === true,
      )
    : rows
  if (!options.cursor) {
    const start = options.offset ?? 0
    const end =
      options.limit === undefined ? matchingRows.length : start + options.limit
    return matchingRows.slice(start, end)
  }

  const current = matchingRows.filter((row) =>
    Boolean(evaluateReferenceExpression(options.cursor!.whereCurrent, row)),
  )
  const from = matchingRows.filter((row) =>
    Boolean(evaluateReferenceExpression(options.cursor!.whereFrom, row)),
  )
  const limitedFrom =
    options.limit === undefined ? from : from.slice(0, options.limit)
  const requested = new Map<number, TRow>()
  for (const row of [...current, ...limitedFrom]) requested.set(row.id, row)
  return [...requested.values()]
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
            return receipt === true ? Promise.resolve() : receipt
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

  try {
    await live.preload()
    expect(Array.from(live.values(), ({ id, rank }) => ({ id, rank }))).toEqual(
      referenceWindowRows(expectedRows, scenario.direction, initialWindow),
    )

    for (const window of scenario.windows.slice(1)) {
      const result = live.utils.setWindow(window)
      if (result instanceof Promise) await result

      expect(
        Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
      ).toEqual(referenceWindowRows(expectedRows, scenario.direction, window))
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

  try {
    const preload = live.preload()
    expect(pending.length).toBeGreaterThan(0)
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
      .offset(currentWindow.offset)
      .limit(currentWindow.limit)
      .select(({ row }) => ({ id: row.id, rank: row.rank }))
  })
  const publications: Array<{
    changes: Array<PublicPageChange>
    rows: Array<PublicPageRow>
  }> = []
  let publicationSubscription:
    | ReturnType<typeof live.subscribeChanges>
    | undefined

  const readCurrentWindow = () =>
    Array.from(live.values(), ({ id, rank }) => ({ id, rank }))

  const expectCurrentWindow = (checkpoint: number) => {
    try {
      expect(readCurrentWindow()).toEqual(
        referenceWindowRows(
          visibleRows([...rows.values()], scenario.includeFilter),
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
    expect(live.status).toBe(`ready`)
    expect(live.utils.lastSubsetError).toBeUndefined()
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
      expect(live.status).toBe(`ready`)
      expect(live.utils.lastSubsetError).toBeUndefined()
      const afterRows = readCurrentWindow()
      const expectedChanges = expectedPageChanges(beforeRows, afterRows)
      expect(publications.slice(publicationCount)).toEqual(
        expectedChanges.length > 0
          ? [{ changes: expectedChanges, rows: afterRows }]
          : [],
      )
    }
  } finally {
    publicationSubscription?.unsubscribe()
    await cleanupAll(live, source)
  }
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

  try {
    const preloadPublicationCount = publications.length
    const preload = live.preload()
    expect(Array.from(live.values())).toHaveLength(0)
    await preload
    expect(live.status).toBe(`ready`)
    expect(live.utils.lastSubsetError).toBeUndefined()
    if (initialWindow.limit > 0) {
      expect(loads.length).toBeGreaterThan(0)
    }
    try {
      expect(
        Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
      ).toEqual(
        referenceWindowRows(expectedRows, scenario.direction, initialWindow),
      )
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
    const initialExpected = referenceWindowRows(
      expectedRows,
      scenario.direction,
      initialWindow,
    )
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
    ])

    if (scenario.localRowsBeforeFirstRequest) {
      expect(loads).toHaveLength(0)
      const publicationCount = publications.length
      begin()
      for (const row of scenario.localRowsBeforeFirstRequest) {
        deliveredIds.add(row.id)
        write({ type: `insert`, value: { ...row } })
      }
      commit()
      expect(publications).toHaveLength(publicationCount)
      expect(Array.from(live.values())).toHaveLength(0)
    }

    for (const [index, window] of scenario.windows.slice(1).entries()) {
      const before = Array.from(live.values(), ({ id, rank }) => ({ id, rank }))
      const publicationCount = publications.length
      const result = live.utils.setWindow(window)
      if (result instanceof Promise) {
        expect(
          Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
        ).toEqual(before)
      }
      if (result instanceof Promise) await result
      expect(live.status).toBe(`ready`)
      expect(live.utils.lastSubsetError).toBeUndefined()

      try {
        expect(
          Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
        ).toEqual(referenceWindowRows(expectedRows, scenario.direction, window))
      } catch (error) {
        throw new TraceAssertionError(index + 1, error)
      }
      const after = referenceWindowRows(
        expectedRows,
        scenario.direction,
        window,
      )
      const expectedChanges = expectedPageChanges(before, after)
      expect(publications.slice(publicationCount)).toEqual(
        expectedChanges.length > 0
          ? [{ changes: expectedChanges, rows: after, status: `ready` }]
          : [],
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
        expect(load.orderBy).toMatchObject(expectedOrderBy)
      } else if (load.where) {
        // Boundary refinement asks for the complete tie class with an exact
        // predicate. Prefix and cursor requests still carry the source order.
        expect(load.limit).toBeUndefined()
      } else {
        // If the same finite prefix cannot fill the local window, one
        // unbounded request safely establishes the remaining source rows.
        expect(load.cursor).toBeUndefined()
        expect(load.limit).toBeUndefined()
        expect(load.offset).toBeUndefined()
      }
    }
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
    ).toBeLessThanOrEqual(scenario.windows.length * (expectedRows.length + 2))
    assertLoads?.(loads)
  } finally {
    publicationSubscription.unsubscribe()
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
            return deferred.promise
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
  },
  fault?: `post-cleanup-request`,
): Promise<Array<LoadSubsetOptions>> {
  const loads: Array<LoadSubsetOptions> = []
  let recordedProvider!: (options: LoadSubsetOptions) => Promise<void>
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

  return withHistoryCleanup(
    async () => {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual(
        options.expectedIds,
      )
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

async function runPendingMutationScenario(
  scenario: PendingMutationScenario,
  timing: `before-response` | `after-response`,
  finalLimitAfterMutation?: number,
  explicitPublicKeyOrder = true,
  transport: `cursor` | `offset` | `key` = `cursor`,
  fault?:
    | `held-publication`
    | `held-window`
    | `early-settlement`
    | `wrong-rejection`
    | `callback-key`
    | `callback-value`
    | `delete-value`
    | `final-value`,
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
  const physicallySettled = new Set<PendingCursorLoad>()
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
        }
      },
    },
  })
  const live = createLiveQueryCollection((query) => {
    const ordered = query
      .from({ row: source })
      .orderBy(({ row }) => row.rank, scenario.direction)
    return (
      explicitPublicKeyOrder
        ? ordered.orderBy(({ row }) => row.id, `asc`)
        : ordered
    ).limit(scenario.responseOutcome === `reject` ? 1 : scenario.limit)
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
          ![`$key`, `$collectionId`, `$origin`, `$synced`].includes(key),
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
      const options = { ...request.options }
      if (transport !== `cursor`) {
        // Model providers whose opaque continuation token is indexed by the
        // last fetched row key, rather than by the predicate expression.
        if (transport === `key` && options.cursor) {
          const boundary = orderedRows.findIndex(
            ({ id }) => id === options.cursor!.lastKey,
          )
          expect(boundary).toBeGreaterThanOrEqual(0)
          options.offset = boundary + 1
        }
        options.cursor = undefined
      }
      begin()
      for (const row of rowsForLoadSubset(orderedRows, options)) {
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
        expect(pending).toHaveLength(1)
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
        expect(pending).toHaveLength(0)
        finalLimit += 1
        stage = `failed-window`
        const failedWindow = live.utils.setWindow({
          offset: 0,
          limit: finalLimit,
        })
        observe(`failed-window`, failedWindow)
        capture(`failed-window-call`)
        expect(failedWindow).toBeInstanceOf(Promise)
        const observedFailure = (failedWindow as Promise<void>).then(
          () => undefined,
          (error: unknown) => error,
        )
        expect(pending).toHaveLength(1)
        if (timing === `before-response`) applyMutation()
        pending[0]!.settled = true
        pending[0]!.deferred.reject(cursorError)
        capture(`provider-reject-call`)
        if (timing === `after-response`) applyMutation()
        await flushPromises()
        await settlePending()
        capture(`recovery-drain`)
        expect(await observedFailure).toBe(cursorError)
        expect(live.status).toBe(`ready`)
        expect(live.utils.lastSubsetError).toBe(cursorError)

        stage = `retry`
        const retry = live.utils.setWindow({ offset: 0, limit: finalLimit })
        const observedRetry = observe(`retry`, retry)
        capture(`retry-call`)
        await flushPromises()
        await settlePending()
        await flushPromises()
        await observedRetry
        expect(live.status).toBe(`ready`)
        expect(live.utils.lastSubsetError).toBe(cursorError)
      }

      await Promise.all(outstanding)
      capture(`final`)
      const heldCut = () => {
        const cut = cuts.find(({ held, phase }) => held && phase !== `callback`)
        expect(cut, `held mutation cut reached`).toBeDefined()
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
        expect(outcome?.state, `failed caller reached`).toBe(`rejected`)
        outcome!.error = new Error(`cursor failed`)
      }
      if (fault === `callback-key` || fault === `callback-value`) {
        const cut = cuts.find(({ changes }) => changes.length > 0)
        expect(cut, `mutation callback reached`).toBeDefined()
        if (fault === `callback-key`)
          cut!.changes[0]!.key = String(cut!.changes[0]!.key)
        else cut!.changes[0]!.value.rank = 999
      }
      if (fault === `delete-value`) {
        const change = cuts
          .flatMap((cut) => cut.changes)
          .find((message) => message.type === `delete`)
        expect(change, `mutation delete callback reached`).toBeDefined()
        change!.value = { ...change!.value, rank: 999 }
      }
      if (fault === `final-value`) cuts.at(-1)!.rows[0]!.rank = 999

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

      // Judge recorded public observations after the driver: assertions never
      // throw into the runtime's listener/error handling. Later mutation repair
      // and retry cuts retain raw replicas; their endpoints keep the old law.
      const replica = new Map<unknown, Record<string, unknown>>()
      let initialPublished = false
      for (const cut of cuts) {
        for (const change of cut.changes) {
          expect(typeof change.key, `mutation native callback key`).toBe(
            `number`,
          )
          expect(change.key, `mutation callback key owns value`).toBe(
            change.value.id,
          )
          expect(replica.has(change.key), `mutation callback predecessor`).toBe(
            change.type !== `insert`,
          )
          if (change.type === `delete`) {
            expect(
              change.value,
              `mutation deleted callback full value`,
            ).toStrictEqual(replica.get(change.key))
            replica.delete(change.key)
          } else replica.set(change.key, change.value)
        }
        if (cut.phase === `callback` || cut.phase === `final`) {
          const byId = (
            a: Record<string, unknown>,
            b: Record<string, unknown>,
          ) => (a.id as number) - (b.id as number)
          expect(
            [...replica.values()].sort(byId),
            `mutation callback replica full values`,
          ).toStrictEqual([...cut.rows].sort(byId))
        }
        if (cut.stage === `initial`) {
          const preloadState = cut.outcomes.find(
            ({ label }) => label === `preload`,
          )!.state
          if (cut.held) {
            expect(cut.rows, `held mutation publication`).toStrictEqual([])
            expect(preloadState, `held mutation logical settlement`).toBe(
              `pending`,
            )
          } else if (cut.rows.length > 0 || preloadState === `fulfilled`) {
            expect(
              cut.rows,
              `complete initial mutation publication`,
            ).toStrictEqual(cut.expected)
          }
          if (initialPublished)
            expect(
              cut.rows.length,
              `initial mutation publication cannot withdraw`,
            ).toBeGreaterThan(0)
          if (cut.rows.length > 0) initialPublished = true
          expect(cut.window, `held mutation window`).toStrictEqual({
            offset: 0,
            limit: initialLimit,
          })
        } else if (cut.stage === `failed-window`) {
          expect(
            cut.rows,
            `failed mutation keeps complete baseline`,
          ).toStrictEqual([{ ...firstDelivered }])
          expect(cut.window, `held mutation window`).toStrictEqual({
            offset: 0,
            limit: 1,
          })
          const failed = cut.outcomes.find(
            ({ label }) => label === `failed-window`,
          )
          if (cut.held && failed)
            expect(failed.state, `held mutation logical settlement`).not.toBe(
              `fulfilled`,
            )
        }
      }
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
      )
      for (const outcome of outcomes) {
        if (outcome.label === `failed-window`) {
          expect(outcome.state, `failed mutation caller state`).toBe(`rejected`)
          expect(outcome.error, `failed mutation caller exact error`).toBe(
            cursorError,
          )
        } else
          expect(outcome.state, `mutation caller fulfilled`).toBe(`fulfilled`)
      }
      expect(cuts.at(-1)!.rows, `complete final mutation values`).toStrictEqual(
        referenceWindowRows([...rows.values()], scenario.direction, {
          offset: 0,
          limit: finalLimit,
        }),
      )
      expect(
        cuts.at(-1)!.window,
        `complete final mutation window`,
      ).toStrictEqual({ offset: 0, limit: finalLimit })
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
          ![`$key`, `$collectionId`, `$origin`, `$synced`].includes(key),
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
      expect(pending).toHaveLength(1)

      updateFirstDelivered(scenario.firstRank)
      capture(`first-update`)
      track(live.utils.setWindow({ offset: 0, limit: scenario.narrowLimit }))
      capture(`narrow`)
      track(live.utils.setWindow({ offset: 0, limit: scenario.wideLimit }))
      capture(`wide`)
      expect(pending.length).toBeGreaterThan(0)
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
      expect(
        outcomes.every(({ settled, rejected }) => settled && !rejected),
        `all logical requests fulfilled`,
      ).toBe(true)

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
        expect(index, `complete callback reached`).toBeGreaterThanOrEqual(0)
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
        expect(changed, `real callback reached`).toBeDefined()
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
          expect(
            cut.rows.length,
            `published window cannot withdraw`,
          ).toBeGreaterThan(0)
        if (cut.rows.length > 0) published = true
        for (const change of cut.changes) {
          expect(typeof change.key, `native callback key`).toBe(`number`)
          expect(change.key, `callback key owns value`).toBe(change.value.id)
          expect(
            replica.has(change.key),
            `callback operation predecessor`,
          ).toBe(change.type !== `insert`)
          if (change.type === `delete`) replica.delete(change.key)
          else replica.set(change.key, change.value)
        }
        if (cut.phase === `callback`) {
          const byId = (
            left: Record<string, unknown>,
            right: Record<string, unknown>,
          ) => (left.id as number) - (right.id as number)
          expect(
            [...replica.values()].sort(byId),
            `callback replica full values`,
          ).toStrictEqual([...cut.rows].sort(byId))
        }
        if (cut.held) {
          expect(
            cut.rows,
            `held initial publication ${cut.phase}`,
          ).toStrictEqual([])
          expect(cut.window, `held initial window ${cut.phase}`).toStrictEqual({
            offset: 0,
            limit: scenario.initialLimit,
          })
          expect(cut.settled, `held logical settlement ${cut.phase}`).toBe(
            false,
          )
        } else if (
          cut.rows.length === 0 &&
          !cut.windowSettled &&
          cut.phase !== `final`
        ) {
          expect(cut.window, `unpublished initial window`).toStrictEqual({
            offset: 0,
            limit: scenario.initialLimit,
          })
        } else {
          expect(cut.rows, `complete publication ${cut.phase}`).toStrictEqual(
            completeRows,
          )
          // getWindow reports Promise-settled state, not the publication callback.
          const target = { offset: 0, limit: scenario.wideLimit }
          if (cut.windowSettled || cut.phase === `final`) {
            expect(
              cut.window,
              `settled complete window ${cut.phase}`,
            ).toStrictEqual(target)
          } else {
            expect(
              [target, { offset: 0, limit: scenario.initialLimit }],
              `pending window metadata ${cut.phase}`,
            ).toContainEqual(cut.window)
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
    expect(pending.length).toBeGreaterThan(0)

    for (let index = 0; index < pending.length; index++) {
      if (index > rows.length * 2) {
        throw new Error(`Ordered continuation exceeded its work bound`)
      }
      await settle(pending[index]!)
      await flushPromises()
    }
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
  it.each([
    { label: `Error`, reason: new Error(`first cleanup failed`) },
    { label: `undefined`, reason: undefined },
    { label: `null`, reason: null },
    { label: `false`, reason: false },
    { label: `zero`, reason: 0 },
    { label: `NaN`, reason: Number.NaN },
    { label: `empty string`, reason: `` },
  ])(
    `observes $label cleanup failure after every teardown settles`,
    async ({ reason: firstFailure }) => {
      const secondFailure = new Error(`second cleanup failed`)
      const firstFailureRelease = createDeferred<void>()
      const lastCleanupRelease = createDeferred<void>()
      const repeatedFirstFailureRelease = createDeferred<void>()
      const repeatedLastCleanupRelease = createDeferred<void>()
      const events: Array<string> = []
      const unhandled: Array<unknown> = []
      const recordUnhandled = (reason: unknown) => unhandled.push(reason)
      const createTargets = (
        firstRelease: Deferred<void>,
        lastRelease: Deferred<void>,
      ): ReadonlyArray<CleanupTarget> => [
        {
          cleanup: async () => {
            events.push(`first`)
            await firstRelease.promise
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
          cleanup: async () => {
            events.push(`third`)
            await lastRelease.promise
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
        const cleanup = cleanupAll(
          ...createTargets(firstFailureRelease, lastCleanupRelease),
        ).finally(() => {
          cleanupFinished = true
        })
        const observedFailure = observeFirstFailure(cleanup)

        await flushPromises()
        expect(events).toEqual([`first`, `second`, `third`])
        expect(cleanupFinished).toBe(false)
        expect(unhandled).toEqual([])

        firstFailureRelease.resolve()
        await flushPromises()
        expect(cleanupFinished).toBe(false)
        expect(unhandled).toEqual([])

        lastCleanupRelease.resolve()
        await observedFailure
        await flushPromises()
        expect(cleanupFinished).toBe(true)
        expect(unhandled).toEqual([])

        let repeatedCleanupFinished = false
        const repeatedCleanup = cleanupAll(
          ...createTargets(
            repeatedFirstFailureRelease,
            repeatedLastCleanupRelease,
          ),
        ).finally(() => {
          repeatedCleanupFinished = true
        })
        const repeatedObservedFailure = observeFirstFailure(repeatedCleanup)
        await flushPromises()
        expect(events).toEqual([
          `first`,
          `second`,
          `third`,
          `first`,
          `second`,
          `third`,
        ])
        expect(repeatedCleanupFinished).toBe(false)
        expect(unhandled).toEqual([])

        repeatedFirstFailureRelease.resolve()
        await flushPromises()
        expect(repeatedCleanupFinished).toBe(false)
        expect(unhandled).toEqual([])

        repeatedLastCleanupRelease.resolve()
        await repeatedObservedFailure
        await flushPromises()
        expect(repeatedCleanupFinished).toBe(true)
        expect(unhandled).toEqual([])
      } finally {
        firstFailureRelease.resolve()
        lastCleanupRelease.resolve()
        repeatedFirstFailureRelease.resolve()
        repeatedLastCleanupRelease.resolve()
        process.off(`unhandledRejection`, recordUnhandled)
      }
    },
  )

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
      expect(requests).toHaveLength(1)
      expect(requests[0]?.limit).toBeUndefined()
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
      expect(requests).toHaveLength(1)
      expect(requests[0]?.limit).toBeUndefined()
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

  it(`does not refetch when live insertion fills a settled empty window`, async () => {
    let sync!: Parameters<SyncConfig<PageRow, number>[`sync`]>[0]
    const requests: Array<LoadSubsetOptions> = []
    const source = createCollection<PageRow, number>({
      id: `settled-empty-window`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          sync = operations
          operations.markReady()
          return {
            loadSubset: (options) => {
              requests.push(options)
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    )
    try {
      await live.preload()
      expect(live.toArray).toEqual([])
      expect(requests).toHaveLength(1)

      sync.begin()
      sync.write({ type: `insert`, value: { id: 1, rank: 1 } })
      const receipt = sync.commit()
      if (receipt !== true) await receipt
      await flushPromises()

      expect(live.toArray.map(({ id, rank }) => ({ id, rank }))).toEqual([
        { id: 1, rank: 1 },
      ])
      expect(live.utils.lastSubsetError).toBeUndefined()
      // Correct rows alone would miss a repeated prefix and boundary fetch.
      expect(
        requests.map(({ limit, offset, orderBy, where, cursor }) => ({
          limit,
          offset,
          ordered: Boolean(orderBy),
          filtered: Boolean(where),
          cursor: Boolean(cursor),
        })),
      ).toEqual([
        { limit: 1, offset: 0, ordered: true, filtered: false, cursor: false },
      ])
    } finally {
      await cleanupAll(live, source)
    }
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

  it(`advances past an implicit public-key tie class`, async () => {
    await runPaginationScenario({
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
    })
  })

  it(`keeps implicit ties stable across filtered source mutations`, async () => {
    await runPaginationStateScenario({
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
    })
  })

  it.each([
    {
      name: `enters the filter`,
      keeps: [false, true],
      action: { type: `put` as const, id: 1, rank: 0, keep: true },
      expected: [1, 2],
    },
    {
      name: `leaves the filter`,
      keeps: [true, true],
      action: { type: `put` as const, id: 1, rank: 0, keep: false },
      expected: [2],
    },
  ])(`updates a row that $name`, async ({ keeps, action, expected }) => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 1],
      keeps,
      direction: `asc`,
      includeFilter: true,
      explicitPublicKeyOrder: true,
      reverseInsertion: false,
      initialWindow: { offset: 0, limit: 2 },
      actions: [action],
    }
    await runPaginationStateScenario(scenario)

    const finalRows = scenario.ranks.map((rank, index) => ({
      id: index + 1,
      rank,
      keep: index === 0 ? action.keep : keeps[index],
    }))
    expect(
      referenceWindow(
        visibleRows(finalRows, true),
        scenario.direction,
        scenario.initialWindow,
      ),
    ).toEqual(expected)
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

  it(`starts an on-demand source prefix after opening a zero window with a local row`, async () => {
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
  })

  it.each(
    ([`asc`, `desc`] as const).flatMap((direction) =>
      ([`sync`, `async`] as const).map((replayDelivery) => ({
        direction,
        replayDelivery,
      })),
    ),
  )(
    `keeps a failed $direction window private after $replayDelivery source replay until explicit retry`,
    async ({ direction, replayDelivery }) => {
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
        await expect(
          live.utils.setWindow({ offset: 0, limit: 2 }),
        ).rejects.toBe(failure)
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
    },
  )

  it.each([
    { offset: 0, limit: 1, failureKind: `error` as const },
    { offset: 2, limit: 1, failureKind: `error` as const },
    { offset: 0, limit: 1, failureKind: `abort` as const },
    { offset: 2, limit: 1, failureKind: `abort` as const },
  ])(
    `recovers the first $failureKind-rejected ordered request for window $offset:$limit from the full source`,
    async ({ failureKind, ...window }) => {
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
                for (const row of rowsForLoadSubset(
                  authoritativeRows,
                  options,
                )) {
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
    },
  )

  it.each([`error`, `AbortError`] as const)(
    `does not derive a retry cursor from rows written by a %s request`,
    async (failureKind) => {
      const authoritativeRows: Array<PageRow> = [
        { id: 1, rank: 0 },
        { id: 2, rank: 1 },
        { id: 3, rank: 2 },
        { id: 4, rank: 99 },
      ]
      const requests: Array<LoadSubsetOptions> = []
      const unloaded: Array<LoadSubsetOptions> = []
      const deliveredIds = new Set<number>()
      const rejectedPage = createDeferred<void>()
      let rejectNextPage = false
      let begin!: () => void
      let write!: (message: { type: `insert`; value: PageRow }) => void
      let commit!: () => void
      let truncate!: () => void
      const source = createCollection<PageRow>({
        id: `pagination-rejected-partial-page-${collectionSequence++}`,
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
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: (options: LoadSubsetOptions) => {
                requests.push(options)
                if (rejectNextPage) {
                  rejectNextPage = false
                  begin()
                  deliveredIds.add(4)
                  write({ type: `insert`, value: { ...authoritativeRows[3]! } })
                  commit()
                  return rejectedPage.promise
                }

                begin()
                for (const row of rowsForLoadSubset(
                  authoritativeRows,
                  options,
                )) {
                  if (deliveredIds.has(row.id)) continue
                  deliveredIds.add(row.id)
                  write({ type: `insert`, value: { ...row } })
                }
                commit()
                return true
              },
              unloadSubset: (options) => unloaded.push(options),
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

      try {
        await live.preload()
        const initialRequestCount = requests.length
        expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])

        rejectNextPage = true
        const failed = live.utils.setWindow({ offset: 0, limit: 4 })
        expect(failed).toBeInstanceOf(Promise)
        const failure =
          failureKind === `AbortError`
            ? new DOMException(`partial ordered request canceled`, `AbortError`)
            : new Error(`partial ordered request failed`)
        rejectedPage.reject(failure)
        await expect(failed).rejects.toBe(failure)
        await flushPromises()
        expect(requests).toHaveLength(initialRequestCount + 1)

        // Replay can replace the failed request's physical options object
        // before the explicit retry retires its logical demand.
        const beforeFailedReplay = requests.length
        deliveredIds.clear()
        begin()
        truncate()
        commit()
        await flushPromises()
        const failedReplayRequests = requests.slice(beforeFailedReplay)
        // The settled first row permits a three-row continuation. Replay
        // must preserve that exact demand even after its first attempt fails.
        const replayedFailedRequest = failedReplayRequests.find(
          ({ limit, cursor }) => limit === 3 && cursor !== undefined,
        )
        expect(replayedFailedRequest).toBeDefined()
        expect(replayedFailedRequest).toMatchObject({ offset: 1, limit: 3 })
        expect(replayedFailedRequest?.cursor).toEqual(
          requests[initialRequestCount]?.cursor,
        )

        const releasesBeforeRetry = unloaded.length
        const requestsBeforeRetry = requests.length
        const retry = live.utils.setWindow({ offset: 0, limit: 2 })
        if (retry instanceof Promise) await retry
        expect(unloaded.slice(releasesBeforeRetry)).toEqual([
          replayedFailedRequest,
        ])
        expect(requests).toHaveLength(requestsBeforeRetry)
        expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])

        const beforeWiden = requests.length
        const widen = live.utils.setWindow({ offset: 0, limit: 3 })
        if (widen instanceof Promise) await widen
        expect(requests).toHaveLength(beforeWiden)
        expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2, 3])

        const beforeReplay = requests.length
        deliveredIds.clear()
        begin()
        truncate()
        commit()
        await flushPromises()
        expect(
          requests.slice(beforeReplay).every(({ cursor }) => !cursor),
        ).toBe(true)
      } finally {
        rejectedPage.resolve()
        await cleanupAll(live, source)
      }
    },
  )

  it.each(
    ([`asc`, `desc`] as const).flatMap((direction) =>
      ([`throw`, `reject`] as const).map((delivery) => ({
        direction,
        delivery,
      })),
    ),
  )(
    `holds a $direction page and concurrent live insert when its boundary refinement fails by $delivery`,
    async ({ direction, delivery }) => {
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
        await expect(
          live.utils.setWindow({ offset: 0, limit: 2 }),
        ).rejects.toBe(failure)
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
    },
  )

  it(`recovers a failed tie boundary from the authoritative full source`, async () => {
    const authoritativeRows: Array<PageRow> = [
      { id: 1, rank: -1 },
      // A provider may return equal-order rows in any order. The local public
      // key tie-breaker must choose id 2 after boundary refinement.
      { id: 4, rank: 0 },
      { id: 3, rank: 0 },
      { id: 2, rank: 0 },
      { id: 6, rank: 1 },
      { id: 5, rank: 99 },
    ]
    const deliveredIds = new Set<number>()
    const requests: Array<LoadSubsetOptions> = []
    const failedPage = createDeferred<void>()
    let rejectNextPage = false
    let begin!: () => void
    let write!: (message: { type: `insert` | `delete`; value: PageRow }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-recovered-prefix-tie-${collectionSequence++}`,
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
              if (rejectNextPage) {
                rejectNextPage = false
                begin()
                deliveredIds.add(5)
                write({ type: `insert`, value: { id: 5, rank: 99 } })
                commit()
                return failedPage.promise
              }

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
        .limit(1),
    )

    try {
      await live.preload()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])

      rejectNextPage = true
      const failed = live.utils.setWindow({ offset: 0, limit: 3 })
      expect(failed).toBeInstanceOf(Promise)
      failedPage.reject(new Error(`later page failed`))
      await expect(failed).rejects.toThrow(`later page failed`)

      const retry = live.utils.setWindow({ offset: 0, limit: 2 })
      if (retry instanceof Promise) await retry
      const recoveryRequest = requests.at(-1)
      expect(recoveryRequest?.limit).toBeUndefined()
      expect(recoveryRequest?.offset).toBeUndefined()
      expect(recoveryRequest?.cursor).toBeUndefined()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])

      const deleted = authoritativeRows.filter(({ id }) =>
        [1, 2, 3].includes(id),
      )
      for (const row of deleted) {
        authoritativeRows.splice(authoritativeRows.indexOf(row), 1)
        deliveredIds.delete(row.id)
      }
      begin()
      for (const row of deleted) write({ type: `delete`, value: { ...row } })
      commit()
      await flushPromises()
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([4, 6])
    } finally {
      failedPage.resolve()
      await cleanupAll(live, source)
    }
  })

  it(`rejects a reentrant window move when an ordered request writes and then throws`, async () => {
    const authoritativeRows: Array<PageRow> = [
      { id: 1, rank: 0 },
      { id: 2, rank: 1 },
      { id: 3, rank: 2 },
    ]
    const requests: Array<LoadSubsetOptions> = []
    const deliveredIds = new Set<number>()
    const failure = new Error(`ordered request threw after writing`)
    let reentrantError: unknown
    let throwNextPage = false
    let begin!: () => void
    let write!: (message: { type: `insert`; value: PageRow }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-synchronous-partial-page-${collectionSequence++}`,
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
              if (throwNextPage) {
                throwNextPage = false
                begin()
                deliveredIds.add(3)
                write({ type: `insert`, value: { ...authoritativeRows[2]! } })
                commit()
                try {
                  live.utils.setWindow({ offset: 0, limit: 3 })
                } catch (error) {
                  reentrantError = error
                }
                throw failure
              }

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
        .limit(1),
    )

    try {
      await live.preload()
      const initialRequestCount = requests.length
      throwNextPage = true

      expect(() => live.utils.setWindow({ offset: 0, limit: 2 })).toThrow(
        failure,
      )
      expect(reentrantError).toMatchObject({ name: `SetWindowReentrancyError` })
      expect(requests).toHaveLength(initialRequestCount + 1)
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])

      const retry = live.utils.setWindow({ offset: 0, limit: 2 })
      if (retry instanceof Promise) await retry
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])
    } finally {
      await cleanupAll(live, source)
    }
  })

  it.each(
    ([`sync`, `async`] as const).flatMap((delivery) =>
      [1, 2].map((requestNumber) => ({ delivery, requestNumber })),
    ),
  )(
    `rejects a window move reentered from startup request $requestNumber after $delivery delivery`,
    async ({ delivery, requestNumber }) => {
      const authoritativeRows: Array<PageRow> = [
        { id: 1, rank: 0 },
        { id: 2, rank: 1 },
      ]
      const delivered = new Set<number>()
      let nestedResult: true | Promise<void> | undefined
      let nestedError: unknown
      let requests = 0
      let firstRequestSettled = false
      function createWindowedQuery() {
        return createLiveQueryCollection((query) =>
          query
            .from({ row: source })
            .orderBy(({ row }) => row.rank)
            .limit(1),
        )
      }
      const source = createCollection<PageRow>({
        id: `pagination-initial-request-reentrancy-${collectionSequence++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                requests++
                if (requests === requestNumber) {
                  if (delivery === `async` && requestNumber === 2) {
                    expect(firstRequestSettled).toBe(true)
                  }
                  try {
                    nestedResult = live.utils.setWindow({ offset: 0, limit: 2 })
                  } catch (error) {
                    nestedError = error
                  }
                }
                const fresh = rowsForLoadSubset(
                  authoritativeRows,
                  options,
                ).filter(({ id }) => !delivered.has(id))
                if (fresh.length === 0) return true
                begin()
                for (const row of fresh) {
                  delivered.add(row.id)
                  write({ type: `insert`, value: { ...row } })
                }
                commit()
                return delivery === `async`
                  ? Promise.resolve().then(() => {
                      firstRequestSettled = true
                    })
                  : true
              },
            }
          },
        },
      })
      const live = createWindowedQuery()

      try {
        await live.preload()
        expect(requests).toBeGreaterThanOrEqual(requestNumber)
        expect(nestedResult).toBeUndefined()
        expect(nestedError).toMatchObject({ name: `SetWindowReentrancyError` })
        expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
        expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])
        await live.utils.setWindow({ offset: 0, limit: 2 })
        expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
        expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])
      } finally {
        await cleanupAll(live, source)
      }
    },
  )

  it(`rejects a window move reentered from a public change callback`, async () => {
    const authoritativeRows: Array<PageRow> = [
      { id: 1, rank: 0, keep: true },
      { id: 2, rank: 1, keep: true },
    ]
    const delivered = new Set<number>()
    let begin!: () => void
    let write!: (message: {
      type: `update`
      value: PageRow
      previousValue: PageRow
    }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-publication-reentrancy-${collectionSequence++}`,
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
            loadSubset: (options) => {
              const fresh = rowsForLoadSubset(
                authoritativeRows,
                options,
              ).filter(({ id }) => !delivered.has(id))
              if (fresh.length === 0) return true
              begin()
              for (const row of fresh) {
                delivered.add(row.id)
                operations.write({ type: `insert`, value: { ...row } })
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
        .orderBy(({ row }) => row.rank)
        .limit(1),
    )
    let nestedResult: true | Promise<void> | undefined
    let nestedError: unknown

    try {
      await live.preload()
      const subscription = live.subscribeChanges(() => {
        try {
          nestedResult = live.utils.setWindow({ offset: 0, limit: 2 })
        } catch (error) {
          nestedError = error
        }
      })
      const previous = authoritativeRows[0]!
      const current = { ...previous, keep: false }
      authoritativeRows[0] = current
      begin()
      write({ type: `update`, value: current, previousValue: previous })
      commit()
      subscription.unsubscribe()

      expect(nestedResult).toBeUndefined()
      expect(nestedError).toMatchObject({ name: `SetWindowReentrancyError` })
      expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
    } finally {
      await cleanupAll(live, source)
    }
  })

  it.each([`return-only`, `write-after-cleanup`])(
    `does not settle a window move after its sync session is cleaned up: %s`,
    async (delivery) => {
      const authoritativeRows: Array<PageRow> = [
        { id: 1, rank: 0 },
        { id: 2, rank: 1 },
      ]
      const delivered = new Set<number>()
      let cleanUpDuringNextRequest = false
      let cleanupPromise: Promise<void> | undefined
      function createWindowedQuery() {
        return createLiveQueryCollection((query) =>
          query
            .from({ row: source })
            .orderBy(({ row }) => row.rank)
            .limit(1),
        )
      }
      const source = createCollection<PageRow>({
        id: `pagination-window-cleanup-${collectionSequence++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                if (cleanUpDuringNextRequest) {
                  cleanUpDuringNextRequest = false
                  cleanupPromise = live.cleanup()
                  if (delivery === `return-only`) return true
                }
                const fresh = rowsForLoadSubset(
                  authoritativeRows,
                  options,
                ).filter(({ id }) => !delivered.has(id))
                if (fresh.length === 0) return true
                begin()
                for (const row of fresh) {
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
      const live = createWindowedQuery()

      try {
        await live.preload()
        cleanUpDuringNextRequest = true
        const move = live.utils.setWindow({ offset: 0, limit: 2 })
        expect(cleanUpDuringNextRequest).toBe(false)
        expect(cleanupPromise).toBeInstanceOf(Promise)
        await cleanupPromise

        expect(move).toBeInstanceOf(Promise)
        await expect(move).rejects.toMatchObject({ name: `AbortError` })
        expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
      } finally {
        await cleanupAll(live, source)
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
    let deferLoads = false
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
            begin()
            for (const row of rowsForLoadSubset(rows, options)) {
              if (delivered.has(row.id)) continue
              delivered.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            commit()
          }

          return {
            loadSubset: (options: LoadSubsetOptions) => {
              requests.push(options)
              if (!deferLoads) {
                publish(options)
                return true
              }

              return refinement.promise.then(() => publish(options))
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
      const initialRequestCount = requests.length
      expect(initialRequestCount).toBeGreaterThan(0)
      expect(
        requests.every(
          ({ limit, where }) => limit !== undefined || where !== undefined,
        ),
      ).toBe(true)
      deferLoads = true

      const widened = live.utils.setWindow({ offset: 0, limit: 2 })
      expect(widened).toBeInstanceOf(Promise)
      await flushPromises()
      expect(requests.length).toBeGreaterThan(initialRequestCount)
      const widenedRequest = requests
        .slice(initialRequestCount)
        .find(({ limit }) => limit === 2)
      expect(widenedRequest).toBeDefined()
      expect(widenedRequest?.offset).toBeUndefined()
      expect(widenedRequest?.cursor).toBeUndefined()
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
              return deferred.promise
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

      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1])
      expect(pending.length).toBeLessThanOrEqual(rows.length * 2)
      expect(
        pending.some(
          ({ options }) =>
            options.limit === undefined && options.where === undefined,
        ),
      ).toBe(true)

      const transportCount = pending.length
      const widened = live.utils.setWindow({ offset: 0, limit: 2 })
      for (let index = transportCount; index < pending.length; index++) {
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
      if (widened instanceof Promise) await widened

      expect(Array.from(live.values(), ({ id }) => id)).toEqual([1, 2])
      expect(pending.length).toBeLessThanOrEqual(rows.length * 3)
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
    oracleRandomParameters(
      orderedScenarioRuns,
      replay,
      `pagination.multi-order`,
    ),
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
    oracleRandomParameters(
      transitionScenarioRuns,
      replay,
      `pagination.nullable-cursor`,
    ),
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

  it.each(
    ([`resolve`, `reject`] as const).flatMap((responseOutcome) =>
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
      ).map(([fault, message]) => ({ responseOutcome, fault, message })),
    ),
  )(
    `rejects a reached $fault in a $responseOutcome mutation history`,
    async ({ responseOutcome, fault, message }) => {
      const scenario: PendingMutationScenario = {
        ranks: [0, 1, 2, 3],
        direction: `asc`,
        limit: 2,
        mutation: { type: `insert`, row: { id: 5, rank: -1 } },
        responseOutcome,
      }
      await runPendingMutationScenario(scenario, `before-response`)
      await expect(
        runPendingMutationScenario(
          scenario,
          `before-response`,
          undefined,
          true,
          `cursor`,
          fault,
        ),
      ).rejects.toThrow(message)
    },
  )

  it(`rejects a wrong deleted payload before removing its replica row`, async () => {
    const scenario: PendingMutationScenario = {
      ranks: [0, 1, 2, 3],
      direction: `asc`,
      limit: 2,
      mutation: { type: `delete`, id: 1 },
      responseOutcome: `resolve`,
    }
    await runPendingMutationScenario(scenario, `after-response`)
    await expect(
      runPendingMutationScenario(
        scenario,
        `after-response`,
        undefined,
        true,
        `cursor`,
        `delete-value`,
      ),
    ).rejects.toThrow(/mutation deleted callback full value/)
  })

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
              return Promise.resolve(receipt)
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
          loads.some(
            ({ limit, cursor }) => limit === 2 && cursor === undefined,
          ),
        ).toBe(true)
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
            ({ options }) =>
              options.limit === 2 && options.cursor === undefined,
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
        if (mutation.type === `insert`) {
          expect(pending.length).toBeGreaterThan(pendingBeforeWiden)
          expect(
            pending
              .slice(pendingBeforeWiden)
              .some(({ options }) => options.limit === 3),
          ).toBe(true)
        } else {
          expect(
            pending.some(
              ({ options }) =>
                options.limit === undefined &&
                options.where === undefined &&
                options.cursor === undefined,
            ),
          ).toBe(true)
          expect(widened).toBe(true)
          expect(pending).toHaveLength(pendingBeforeWiden)
        }
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
    oracleRandomParameters(
      transitionScenarioRuns,
      replay,
      `pagination.pending-mutation`,
    ),
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

  it.each([
    [`partial-publication`, `held initial publication`],
    [`wrong-window`, `held initial window`],
    [`early-settlement`, `held logical settlement`],
    [`wrong-final-value`, `complete publication final`],
    [`wrong-callback-value`, `callback replica full values`],
    [`wrong-callback-key`, `native callback key`],
    [`retracted-publication`, `published window cannot withdraw`],
  ] as const)(
    `rejects %s in a captured pending history`,
    async (fault, message) => {
      const scenario: PendingHistoryScenario = {
        ranks: [0, 0, 1, 2],
        direction: `asc`,
        initialLimit: 2,
        narrowLimit: 1,
        wideLimit: 4,
        firstRank: 2,
        secondRank: -2,
      }
      await runPendingHistoryScenario(scenario)
      await expect(
        runPendingHistoryScenario(scenario, fault),
      ).rejects.toThrowError(message)
    },
  )

  fcTest.prop(
    [pendingHistoryScenarioArbitrary],
    oracleRandomParameters(
      transitionScenarioRuns,
      replay,
      `pagination.pending-history`,
    ),
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

  it.each(
    [`asc`, `desc`].flatMap((direction) =>
      [false, true].flatMap((explicitPublicKeyOrder) =>
        [false, true].map((includeFilter) => ({
          direction: direction as `asc` | `desc`,
          explicitPublicKeyOrder,
          includeFilter,
        })),
      ),
    ),
  )(
    `bounds requests for an underfilled source: $direction, explicit key=$explicitPublicKeyOrder, filter=$includeFilter`,
    async (structure) => {
      await runOnDemandPaginationScenario({
        ...structure,
        ranks: [0, 0],
        keeps: [true, false],
        windows: [{ offset: 0, limit: 3 }],
      })
    },
  )

  it.each(
    paginationStructures.map((structure, index) => ({
      name: `key=${structure.explicitPublicKeyOrder ? `explicit` : `implicit`}, filter=${structure.includeFilter ? `on` : `off`}, insertion=${structure.reverseInsertion ? `reverse` : `forward`}`,
      structure,
      index,
    })),
  )(`covers $name`, async ({ structure, index }) => {
    const cellRuns = Math.max(1, Math.ceil(transitionScenarioRuns / 8))
    await fc.assert(
      fc.asyncProperty(scenarioPayloadArbitrary, async (scenario) => {
        const complete = { ...scenario, ...structure }
        await runPaginationScenario(complete)
        await runOnDemandPaginationScenario(complete)
      }),
      { numRuns: cellRuns, seed: 16_570 + index },
    )
    await fc.assert(
      fc.asyncProperty(stateScenarioPayloadArbitrary, async (scenario) => {
        await runPaginationStateScenario({ ...scenario, ...structure })
      }),
      { numRuns: cellRuns, seed: 16_580 + index },
    )
  })

  fcTest.prop([scenarioArbitrary], {
    numRuns: orderedScenarioRuns,
    seed: 1657,
  })(
    `matches full recomputation across ordered windows for a fixed seed`,
    runPaginationScenario,
  )

  fcTest.prop(
    [scenarioArbitrary],
    oracleRandomParameters(
      orderedScenarioRuns,
      replay,
      `pagination.ordered-window`,
    ),
  )(
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
    oracleRandomParameters(
      transitionScenarioRuns,
      replay,
      `pagination.window-transition`,
    ),
  )(
    `matches full recomputation across source and window transitions for a random or replayed seed`,
    runPaginationStateScenario,
  )

  it.each(
    ([`asc`, `desc`] as const).flatMap((direction) =>
      ([`pages`, `widen`] as const).flatMap((mode) =>
        [3, 10].map((pageSize) => ({ direction, mode, pageSize })),
      ),
    ),
  )(
    `fetches linear row volume while traversing settled pages: %j`,
    async ({ direction, mode, pageSize }) => {
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
      const live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank, direction)
          .limit(pageSize),
      )
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
          (total, request) =>
            total + rowsForLoadSubset(ordered, request).length,
          0,
        )
        expect(returnedRows).toBeLessThanOrEqual(rows.length + 2 * pageCount)
        expect(requests.some((request) => request.cursor !== undefined)).toBe(
          true,
        )
      } finally {
        await live.cleanup()
        await source.cleanup()
      }
    },
  )

  it.each(
    ([`asc`, `desc`] as const).flatMap((direction) =>
      [false, true].flatMap((explicitPublicKeyOrder) =>
        [false, true].flatMap((tied) =>
          [1, 2].map((limit) => ({
            direction,
            explicitPublicKeyOrder,
            tied,
            limit,
          })),
        ),
      ),
    ),
  )(
    `keeps eager window membership when moving past an intervening insert: %j`,
    async ({ direction, explicitPublicKeyOrder, tied, limit }) => {
      const sign = direction === `asc` ? 1 : -1
      await runPaginationStateScenario({
        direction,
        initialWindow: { offset: 0, limit: 1 },
        actions: [
          { type: `put`, id: 3, rank: sign * (tied ? 1 : 2), keep: false },
          { type: `window`, offset: 1, limit },
          { type: `put`, id: 1, rank: 0, keep: false },
        ],
        ranks: [0, sign],
        keeps: [false, false],
        explicitPublicKeyOrder,
        includeFilter: false,
        reverseInsertion: false,
      })
    },
  )

  it.each(
    ([`asc`, `desc`] as const).flatMap((direction) =>
      ([`before-response`, `after-response`] as const).flatMap((timing) =>
        [0.5, 100].flatMap((rank) =>
          ([`cursor`, `offset`, `key`] as const).map((transport) => ({
            direction,
            timing,
            rank,
            transport,
          })),
        ),
      ),
    ),
  )(
    `keeps live observations separate from a settled acquisition: %j`,
    async ({ direction, timing, rank, transport }) => {
      const sign = direction === `asc` ? 1 : -1
      await runPendingMutationScenario(
        {
          ranks: [0, sign, 2 * sign, 3 * sign],
          direction,
          limit: 1,
          mutation: { type: `insert`, row: { id: 9, rank: sign * rank } },
          responseOutcome: `resolve`,
        },
        timing,
        3,
        false,
        transport,
      )
    },
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

  it(`refills an implicit tie window when a visible row moves below it`, async () => {
    await runPaginationStateScenario({
      ranks: [0, 0, 0, -1, 0],
      direction: `desc`,
      explicitPublicKeyOrder: false,
      includeFilter: false,
      reverseInsertion: false,
      initialWindow: { offset: 0, limit: 4 },
      actions: [{ type: `put`, id: 1, rank: -2, keep: false }],
    })
  })

  it.each([`resolve`, `reject`] as const)(
    `keeps the last complete implicit window while background recovery %ss`,
    async (settlement) => {
      const authoritativeRows = new Map<number, PageRow>([
        [1, { id: 1, rank: 0, keep: true }],
        [2, { id: 2, rank: 1, keep: true }],
      ])
      const recovery = createDeferred<void>()
      const recoveryError = new Error(`background recovery failed`)
      const loads: Array<LoadSubsetOptions> = []
      const delivered = new Set<number>()
      let recovering = false
      let begin!: () => void
      let write!: (message: {
        type: `insert` | `update`
        value: PageRow
      }) => void
      let commit!: () => void
      const source = createCollection<PageRow>({
        id: `pagination-background-prefix-recovery-${collectionSequence++}`,
        getKey: ({ id }) => id,
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
                loads.push(options)
                const isFullSource =
                  options.where === undefined &&
                  options.limit === undefined &&
                  options.cursor === undefined
                const applyRows = () => {
                  const rows = rowsForLoadSubset(
                    [...authoritativeRows.values()],
                    options,
                  )
                  begin()
                  for (const row of rows) {
                    if (delivered.has(row.id)) continue
                    delivered.add(row.id)
                    write({ type: `insert`, value: { ...row } })
                  }
                  commit()
                }
                if (!recovering || !isFullSource) {
                  applyRows()
                  return true
                }
                return recovery.promise.then(() => {
                  if (settlement === `reject`) throw recoveryError
                  applyRows()
                })
              },
            }
          },
        },
      })
      const live = createLiveQueryCollection((query) =>
        query
          .from({ row: source })
          .orderBy(({ row }) => row.rank, `asc`)
          .limit(1)
          .select(({ row }) => ({
            id: row.id,
            rank: row.rank,
            keep: row.keep,
          })),
      )
      const publications: Array<Array<PublicPageRow>> = []
      const subscription = live.subscribeChanges(
        () => publications.push(live.toArray.map(projectPageRow)),
        { includeInitialState: false },
      )

      try {
        await live.preload()
        expect(live.toArray.map(projectPageRow)).toEqual([{ id: 1, rank: 0 }])
        publications.length = 0
        const loadsBeforeMutation = loads.length

        recovering = true
        const moved = { id: 1, rank: 10, keep: true }
        authoritativeRows.set(1, moved)
        begin()
        write({ type: `update`, value: { ...moved } })
        commit()
        await flushPromises()

        const recoveryLoads = loads.slice(loadsBeforeMutation)
        expect(recoveryLoads).toHaveLength(1)
        expect(recoveryLoads[0]?.where).toBeUndefined()
        expect(recoveryLoads[0]?.limit).toBeUndefined()
        expect(recoveryLoads[0]?.cursor).toBeUndefined()
        expect(live.toArray.map(projectPageRow)).toEqual([{ id: 1, rank: 0 }])
        expect(publications).toEqual([])

        recovery.resolve()
        await flushPromises()

        if (settlement === `resolve`) {
          expect(live.toArray.map(projectPageRow)).toEqual([{ id: 2, rank: 1 }])
          expect(publications).toEqual([[{ id: 2, rank: 1 }]])
          expect(live.utils.lastSubsetError).toBeUndefined()
        } else {
          expect(live.toArray.map(projectPageRow)).toEqual([{ id: 1, rank: 0 }])
          expect(publications).toEqual([])
          expect(live.utils.lastSubsetError).toBe(recoveryError)
        }
      } finally {
        recovery.resolve()
        subscription.unsubscribe()
        await cleanupAll(live, source)
      }
    },
  )

  it(`does not recover the full source when a visible row keeps its order`, async () => {
    const loads: Array<LoadSubsetOptions> = []
    let begin!: () => void
    let write!: (message: { type: `insert` | `update`; value: PageRow }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-stable-order-update-${collectionSequence++}`,
      getKey: ({ id }) => id,
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
              loads.push(options)
              begin()
              write({
                type: `insert`,
                value: { id: 1, rank: 0, keep: true },
              })
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
        .limit(1),
    )

    try {
      await live.preload()
      const loadsBeforeMutation = loads.length
      begin()
      write({ type: `update`, value: { id: 1, rank: 0, keep: false } })
      commit()
      await flushPromises()

      expect(
        live.toArray.map(({ id, rank, keep }) => ({ id, rank, keep })),
      ).toEqual([{ id: 1, rank: 0, keep: false }])
      expect(loads).toHaveLength(loadsBeforeMutation)
    } finally {
      await cleanupAll(live, source)
    }
  })

  it.each([
    [`top-one`, [0, 0], { offset: 0, limit: 1 }, 1, 1],
    [`offset`, [0, 0, 1], { offset: 1, limit: 1 }, 2, 2],
  ] as const)(
    `refills an implicit %s tie window after a rank update`,
    async (_name, ranks, initialWindow, id, rank) => {
      await runPaginationStateScenario({
        ranks: [...ranks],
        direction: `asc`,
        explicitPublicKeyOrder: false,
        includeFilter: false,
        reverseInsertion: false,
        initialWindow,
        actions: [{ type: `put`, id, rank, keep: false }],
      })
    },
  )

  it(`opens an implicit tie window from zero at the lowest public key`, async () => {
    await runPaginationStateScenario({
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
    })
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

  it(`rejects a real provider entry hidden by a copied pre-cleanup trace`, async () => {
    const scenario = {
      providerRows: [
        { id: 1, rank: 1, label: `first` },
        { id: 2, rank: 2, label: `second` },
      ],
      order: { kind: `rank`, direction: `asc`, nulls: `first` } as const,
      limit: 1,
      expectedIds: [1],
    }
    expect(
      (await runAdversarialOrderedProviderScenario(scenario)).length,
    ).toBeGreaterThan(0)
    await expect(
      runAdversarialOrderedProviderScenario(scenario, `post-cleanup-request`),
    ).rejects.toMatchObject({ name: `AssertionError` })
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
    expect(loads[1]?.where).toBeDefined()
    expect(loads[1]?.cursor).toBeUndefined()
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

  it(`uses an ascending index for a bounded descending demand`, async () => {
    const rows: Array<PageRow> = [
      { id: 3, rank: 1 },
      { id: 1, rank: 0 },
      { id: 2, rank: 0 },
    ]
    const loads: Array<LoadSubsetOptions> = []
    const loaded = new Set<number>()
    let begin!: () => void
    let write!: (message: { type: `insert`; value: PageRow }) => void
    let commit!: () => void
    const source = createCollection<PageRow>({
      id: `pagination-reversed-index-ties-${collectionSequence++}`,
      getKey: (row: PageRow) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              begin()
              for (const row of rowsForLoadSubset(rows, options)) {
                if (loaded.has(row.id)) continue
                loaded.add(row.id)
                write({ type: `insert`, value: row })
              }
              commit()
              return true
            },
          }
        },
      },
    })
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
      expect(loads.length).toBeGreaterThan(0)
      expect(
        loads.every(
          ({ limit, where }) => limit !== undefined || where !== undefined,
        ),
        JSON.stringify(
          loads.map(({ limit, offset, cursor, orderBy, where }) => ({
            limit,
            offset,
            cursor: cursor !== undefined,
            orderBy: orderBy !== undefined,
            where: where !== undefined,
          })),
        ),
      ).toBe(true)
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
    oracleRandomParameters(
      transitionScenarioRuns,
      replay,
      `pagination.async-cursor`,
    ),
  )(
    `matches full recomputation when exact async cursor loads widen ordered coverage for a random or replayed seed`,
    runOnDemandPaginationScenario,
  )

  it.each([`forward`, `reverse`] as const)(
    `keeps concurrent on-demand windows correct under %s completion`,
    expectOnDemandWindowsAreCompletionOrderIndependent,
  )
})
