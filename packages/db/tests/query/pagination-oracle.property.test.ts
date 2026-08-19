import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/index.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { PropRef } from '../../src/query/ir.js'
import { expectAssertionFailure } from '../expected-failure.js'
import { TraceAssertionError } from '../trace-runner.js'
import { flushPromises, mockSyncCollectionOptions } from '../utils.js'
import type { BasicExpression } from '../../src/query/ir.js'
import type { LoadSubsetOptions } from '../../src/types.js'

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

type Window = {
  offset: number
  limit: number
}

type PaginationScenario = {
  ranks: ReadonlyArray<number>
  direction: `asc` | `desc`
  windows: ReadonlyArray<Window>
}

type PaginationAction =
  | ({ type: `window` } & Window)
  | { type: `put`; id: number; rank: number }
  | { type: `delete`; id: number }

type PaginationStateScenario = {
  ranks: ReadonlyArray<number>
  direction: `asc` | `desc`
  initialWindow: Window
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

const windowArbitrary: fc.Arbitrary<Window> = fc.record({
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

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function readSeed(): number | undefined {
  const raw = process.env.TANSTACK_DB_ORACLE_SEED
  if (raw === undefined) return undefined

  const seed = Number(raw)
  if (!Number.isSafeInteger(seed)) {
    throw new Error(`TANSTACK_DB_ORACLE_SEED must be an integer`)
  }
  return seed
}

const multiplier = readPositiveInteger(`TANSTACK_DB_ORACLE_RUNS_MULTIPLIER`, 1)
const runs = 12 * multiplier
const replaySeed = readSeed()
const randomParameters =
  replaySeed === undefined
    ? { numRuns: runs }
    : { numRuns: runs, seed: replaySeed }

let collectionSequence = 0

function referenceWindow(
  rows: ReadonlyArray<PageRow>,
  direction: `asc` | `desc`,
  window: Window,
): Array<number> {
  return referenceWindowRows(rows, direction, window).map(({ id }) => id)
}

function referenceWindowRows(
  rows: ReadonlyArray<PageRow>,
  direction: `asc` | `desc`,
  window: Window,
): Array<PageRow> {
  const directionFactor = direction === `asc` ? 1 : -1
  return [...rows]
    .sort(
      (left, right) =>
        (left.rank - right.rank) * directionFactor || left.id - right.id,
    )
    .slice(window.offset, window.offset + window.limit)
    .map((row) => ({ ...row }))
}

function readReference(expression: BasicExpression, row: PageRow): unknown {
  if (expression.type === `val`) return expression.value
  if (expression.type === `ref`) {
    let value: unknown = row
    for (const segment of expression.path) {
      if (typeof value !== `object` || value === null) return undefined
      value = (value as Record<string, unknown>)[segment]
    }
    return value
  }

  const args = expression.args.map((argument) => readReference(argument, row))
  switch (expression.name) {
    case `and`:
      return args.every(Boolean)
    case `or`:
      return args.some(Boolean)
    case `eq`:
      return args[0] === args[1]
    case `gt`:
      return compareReferenceValues(args[0], args[1]) > 0
    case `gte`:
      return compareReferenceValues(args[0], args[1]) >= 0
    case `lt`:
      return compareReferenceValues(args[0], args[1]) < 0
    case `lte`:
      return compareReferenceValues(args[0], args[1]) <= 0
    default:
      throw new Error(`unsupported reference expression: ${expression.name}`)
  }
}

function compareReferenceValues(left: unknown, right: unknown): number {
  if (typeof left === `number` && typeof right === `number`) {
    return left === right ? 0 : left < right ? -1 : 1
  }
  if (typeof left === `string` && typeof right === `string`) {
    return left === right ? 0 : left < right ? -1 : 1
  }
  throw new Error(`cursor comparison requires like-typed numbers or strings`)
}

function rowsForLoadSubset(
  rows: ReadonlyArray<PageRow>,
  options: LoadSubsetOptions,
): Array<PageRow> {
  if (!options.cursor) {
    const start = options.offset ?? 0
    const end =
      options.limit === undefined ? rows.length : start + options.limit
    return rows.slice(start, end)
  }

  const current = rows.filter((row) =>
    Boolean(readReference(options.cursor!.whereCurrent, row)),
  )
  const from = rows.filter((row) =>
    Boolean(readReference(options.cursor!.whereFrom, row)),
  )
  const limitedFrom =
    options.limit === undefined ? from : from.slice(0, options.limit)
  const requested = new Map<number, PageRow>()
  for (const row of [...current, ...limitedFrom]) requested.set(row.id, row)
  return [...requested.values()]
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
    for (const window of scenario.windows) {
      const result = live.utils.setWindow(window)
      if (result instanceof Promise) await result

      expect(Array.from(live.values(), ({ id }) => id)).toEqual(
        referenceWindow(rows, scenario.direction, window),
      )
    }
  } finally {
    live.cleanup()
    source.cleanup()
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
    live.cleanup()
    source.cleanup()
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
    live.cleanup()
    source.cleanup()
  }
}

type ReferencePaginationState = {
  rows: Map<number, PageRow>
  window: Window
}

function replayReferenceState(
  scenario: PaginationStateScenario,
  actionCount: number,
): ReferencePaginationState {
  const state: ReferencePaginationState = {
    rows: new Map(
      scenario.ranks.map((rank, index) => [index + 1, { id: index + 1, rank }]),
    ),
    window: { ...scenario.initialWindow },
  }

  for (const action of scenario.actions.slice(0, actionCount)) {
    if (action.type === `window`) {
      state.window = { offset: action.offset, limit: action.limit }
    } else if (action.type === `put`) {
      state.rows.set(action.id, { id: action.id, rank: action.rank })
    } else {
      state.rows.delete(action.id)
    }
  }
  return state
}

function isPageRowArray(value: unknown): value is Array<PageRow> {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        typeof row === `object` &&
        row !== null &&
        `id` in row &&
        typeof row.id === `number` &&
        `rank` in row &&
        typeof row.rank === `number`,
    )
  )
}

type PageRowDifference = {
  checkpoint: number
  actual: Array<PageRow>
  expected: Array<PageRow>
}

function readPageRowDifference(error: unknown): PageRowDifference | undefined {
  if (
    !(error instanceof TraceAssertionError) ||
    error.checkpoint < 1 ||
    typeof error.cause !== `object` ||
    error.cause === null ||
    !(`actual` in error.cause) ||
    !(`expected` in error.cause) ||
    !isPageRowArray(error.cause.actual) ||
    !isPageRowArray(error.cause.expected)
  ) {
    return undefined
  }

  return {
    checkpoint: error.checkpoint,
    actual: error.cause.actual,
    expected: error.cause.expected,
  }
}

function sameRows(
  left: ReadonlyArray<PageRow>,
  right: ReadonlyArray<PageRow>,
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (row, index) =>
        row.id === right[index]!.id && row.rank === right[index]!.rank,
    )
  )
}

function comparePageRows(
  left: PageRow,
  right: PageRow,
  direction: `asc` | `desc`,
): number {
  const directionFactor = direction === `asc` ? 1 : -1
  return (left.rank - right.rank) * directionFactor || left.id - right.id
}

function replayOrderedSubscriptionWindow(
  scenario: PaginationStateScenario,
  actionCount: number,
): Array<PageRow> {
  const rows = new Map<number, PageRow>(
    scenario.ranks.map((rank, index) => [index + 1, { id: index + 1, rank }]),
  )
  const initialRows = [...rows.values()]
  const sentRows = new Map(
    referenceWindowRows(initialRows, scenario.direction, {
      offset: 0,
      limit: scenario.initialWindow.offset + scenario.initialWindow.limit,
    }).map((row) => [row.id, row]),
  )
  const sentIds = new Set(sentRows.keys())
  let biggest = referenceWindowRows(
    [...sentRows.values()],
    scenario.direction,
    { offset: 0, limit: sentRows.size },
  ).at(-1)
  let window = { ...scenario.initialWindow }

  const currentResult = () =>
    referenceWindowRows([...sentRows.values()], scenario.direction, window)

  const refill = () => {
    while (biggest !== undefined && currentResult().length < window.limit) {
      const needed = window.limit - currentResult().length
      const orderedRows = referenceWindowRows(
        [...rows.values()],
        scenario.direction,
        { offset: 0, limit: rows.size },
      )
      const atCursor = orderedRows.filter(
        (row) => row.rank === biggest!.rank && !sentIds.has(row.id),
      )
      const afterCursor = orderedRows
        .filter(
          (row) =>
            comparePageRows(
              { id: 0, rank: row.rank },
              { id: 0, rank: biggest!.rank },
              scenario.direction,
            ) > 0 && !sentIds.has(row.id),
        )
        .slice(0, Math.max(0, needed - atCursor.length))
      const loaded = [...atCursor, ...afterCursor]
      if (loaded.length === 0) break

      for (const row of loaded) {
        sentIds.add(row.id)
        sentRows.set(row.id, { ...row })
        if (comparePageRows(biggest, row, scenario.direction) < 0) {
          biggest = row
        }
      }
    }
  }

  for (const action of scenario.actions.slice(0, actionCount)) {
    if (action.type === `window`) {
      window = { offset: action.offset, limit: action.limit }
    } else if (action.type === `put`) {
      const previous = rows.get(action.id)
      if (previous?.rank !== action.rank) {
        const row = { id: action.id, rank: action.rank }
        rows.set(action.id, row)
        sentIds.add(row.id)
        sentRows.set(row.id, { ...row })
        if (
          biggest === undefined ||
          comparePageRows(biggest, row, scenario.direction) < 0
        ) {
          biggest = row
        }
      }
    } else {
      rows.delete(action.id)
      if (sentIds.delete(action.id)) sentRows.delete(action.id)
    }
    refill()
  }

  return currentResult()
}

function isKnownOrderedSubscriptionCoverageFailure(
  scenario: PaginationStateScenario,
  error: unknown,
): boolean {
  const difference = readPageRowDifference(error)
  if (!difference) return false

  const fullState = replayReferenceState(scenario, difference.checkpoint)
  const expected = referenceWindowRows(
    [...fullState.rows.values()],
    scenario.direction,
    fullState.window,
  )
  const defective = replayOrderedSubscriptionWindow(
    scenario,
    difference.checkpoint,
  )
  return (
    !sameRows(defective, expected) &&
    sameRows(difference.actual, defective) &&
    sameRows(difference.expected, expected)
  )
}

function isNumberArray(value: unknown): value is Array<number> {
  return Array.isArray(value) && value.every((item) => typeof item === `number`)
}

function isKnownOnDemandOffsetUnderfetch(
  scenario: PaginationScenario,
  error: unknown,
): boolean {
  if (
    !(error instanceof TraceAssertionError) ||
    error.checkpoint < 1 ||
    typeof error.cause !== `object` ||
    error.cause === null ||
    !(`actual` in error.cause) ||
    !(`expected` in error.cause) ||
    !isNumberArray(error.cause.actual) ||
    !isNumberArray(error.cause.expected)
  ) {
    return false
  }

  const actual = error.cause.actual
  const expected = error.cause.expected
  const window = scenario.windows[error.checkpoint]
  if (window === undefined) return false
  const authoritative = referenceWindow(
    scenario.ranks.map((rank, index) => ({ id: index + 1, rank })),
    scenario.direction,
    window,
  )
  const defective = replayOnDemandPaginationWindow(scenario, error.checkpoint)
  return (
    expected.length === authoritative.length &&
    expected.every((id, index) => id === authoritative[index]) &&
    (defective.length !== authoritative.length ||
      defective.some((id, index) => id !== authoritative[index])) &&
    actual.length === defective.length &&
    actual.every((id, index) => id === defective[index])
  )
}

function replayOnDemandPaginationWindow(
  scenario: PaginationScenario,
  checkpoint: number,
): Array<number> {
  const authoritativeRows = referenceWindowRows(
    scenario.ranks.map((rank, index) => ({ id: index + 1, rank })),
    scenario.direction,
    { offset: 0, limit: scenario.ranks.length },
  )
  const initialWindow = scenario.windows[0]!
  const delivered = new Map(
    authoritativeRows
      .slice(0, initialWindow.offset + initialWindow.limit)
      .map((row) => [row.id, row]),
  )
  let biggest = referenceWindowRows(
    [...delivered.values()],
    scenario.direction,
    { offset: 0, limit: delivered.size },
  ).at(-1)

  if (initialWindow.limit === 0) {
    return referenceWindow(
      [...delivered.values()],
      scenario.direction,
      scenario.windows[checkpoint]!,
    )
  }

  for (const window of scenario.windows.slice(0, checkpoint + 1)) {
    const current = referenceWindowRows(
      [...delivered.values()],
      scenario.direction,
      window,
    )
    const needed = window.limit - current.length
    if (needed <= 0 || biggest === undefined) continue

    const atCursor = authoritativeRows.filter(
      (row) => row.rank === biggest!.rank,
    )
    const afterCursor = authoritativeRows
      .filter((row) => comparePageRows(biggest!, row, scenario.direction) < 0)
      .slice(0, needed)
    for (const row of [...atCursor, ...afterCursor]) {
      if (!delivered.has(row.id)) delivered.set(row.id, row)
      if (comparePageRows(biggest, row, scenario.direction) < 0) biggest = row
    }
  }

  const window = scenario.windows[checkpoint]!
  return referenceWindow([...delivered.values()], scenario.direction, window)
}

function assertionDifference(
  checkpoint: number,
  actual: unknown,
  expected: unknown,
): TraceAssertionError {
  try {
    expect(actual).toEqual(expected)
  } catch (error) {
    return new TraceAssertionError(checkpoint, error)
  }
  throw new Error(`test difference must not be equal`)
}

async function runPaginationStateScenarioWithKnownFailures(
  scenario: PaginationStateScenario,
): Promise<void> {
  try {
    await runPaginationStateScenario(scenario)
  } catch (error) {
    if (isKnownOrderedSubscriptionCoverageFailure(scenario, error)) return
    throw error
  }
}

async function runOnDemandPaginationScenarioWithKnownFailures(
  scenario: PaginationScenario,
): Promise<void> {
  try {
    await runOnDemandPaginationScenario(scenario)
  } catch (error) {
    if (isKnownOnDemandOffsetUnderfetch(scenario, error)) return
    throw error
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

            return new Promise<void>((resolve) => {
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
    expect(loads.length).toBeGreaterThan(0)

    for (const [index, window] of scenario.windows.entries()) {
      const result = live.utils.setWindow(window)
      if (result instanceof Promise) await result

      try {
        expect(Array.from(live.values(), ({ id }) => id)).toEqual(
          referenceWindow(authoritativeRows, scenario.direction, window),
        )
      } catch (error) {
        throw new TraceAssertionError(index, error)
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
    for (const load of loads) expect(load.orderBy).toEqual(expectedOrderBy)
  } finally {
    live.cleanup()
    source.cleanup()
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
      await Promise.resolve()
    }
    await first
    await second

    expect(Array.from(firstLive.values(), ({ id }) => id)).toEqual([1, 2])
    expect(Array.from(secondLive.values(), ({ id }) => id)).toEqual([1, 2, 3])
  } finally {
    for (const request of pending) request.deferred.resolve()
    firstLive.cleanup()
    secondLive.cleanup()
    source.cleanup()
  }
}

async function runPendingMutationScenario(
  mutation: PendingMutation,
  timing: `before-response` | `after-response`,
): Promise<void> {
  const rows = new Map<number, PageRow>([
    [1, { id: 1, rank: 0 }],
    [2, { id: 2, rank: 1 }],
    [3, { id: 3, rank: 2 }],
    [4, { id: 4, rank: 3 }],
  ])
  const pending: Array<PendingCursorLoad> = []
  const deliveredIds = new Set<number>([1])
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
        write({ type: `insert`, value: { ...rows.get(1)! } })
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
      .limit(3),
  )

  const applyMutation = () => {
    begin()
    if (mutation.type === `delete`) {
      const row = rows.get(mutation.id)
      if (!row) throw new Error(`Cannot delete missing authoritative row`)
      rows.delete(mutation.id)
      deliveredIds.delete(mutation.id)
      write({ type: `delete`, value: { ...row } })
    } else {
      rows.set(mutation.row.id, { ...mutation.row })
      if (mutation.type === `insert`) deliveredIds.add(mutation.row.id)
      write({ type: mutation.type, value: { ...mutation.row } })
    }
    commit()
  }

  const settlePending = async () => {
    for (const request of pending) {
      if (request.settled) continue
      request.settled = true
      const orderedRows = referenceWindowRows([...rows.values()], `asc`, {
        offset: 0,
        limit: rows.size,
      })
      begin()
      for (const row of rowsForLoadSubset(orderedRows, request.options)) {
        if (deliveredIds.has(row.id)) continue
        deliveredIds.add(row.id)
        write({ type: `insert`, value: { ...row } })
      }
      commit()
      request.deferred.resolve()
      await Promise.resolve()
    }
  }

  try {
    const preload = live.preload()
    expect(pending).toHaveLength(1)

    if (timing === `before-response`) applyMutation()
    await settlePending()
    await preload
    if (timing === `after-response`) {
      applyMutation()
      await Promise.resolve()
      await settlePending()
    }

    try {
      expect(
        Array.from(live.values(), ({ id, rank }) => ({ id, rank })),
      ).toEqual(
        referenceWindowRows([...rows.values()], `asc`, {
          offset: 0,
          limit: 3,
        }),
      )
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    for (const request of pending) request.deferred.resolve()
    live.cleanup()
    source.cleanup()
  }
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
    expect(pending).toHaveLength(1)

    await settle(pending[0]!)
    await preload
    if (setWindow instanceof Promise) await setWindow
    expect(pending).toHaveLength(1)

    try {
      expect(Array.from(live.values(), ({ id }) => id)).toEqual([3, 4])
    } catch (error) {
      throw new TraceAssertionError(0, error)
    }
  } finally {
    for (const request of pending) request.deferred.resolve()
    live.cleanup()
    source.cleanup()
  }
}

describe(`pagination recomputation oracle`, () => {
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
    await expectAssertionFailure(runOnDemandPaginationScenario, {
      checkpoint: 1,
      classify: ({ actual, expected }) =>
        isNumberArray(actual) &&
        actual.join(`,`) === `1` &&
        isNumberArray(expected) &&
        expected.join(`,`) === `1,2`,
    })({
      ranks: [0, 0],
      direction: `asc`,
      windows: [
        { offset: 1, limit: 0 },
        { offset: 0, limit: 2 },
      ],
    })
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
      true,
    ],
    [
      `orders a descending nullable boundary by its second term`,
      {
        rows: nullableBoundaryRows,
        primary: { direction: `desc`, nulls: `first` },
        secondary: { direction: `desc`, nulls: `first` },
        limit: 1,
      },
      false,
    ],
    [
      `orders an ascending and descending mixed nullable boundary`,
      {
        rows: nullableBoundaryRows,
        primary: { direction: `asc`, nulls: `first` },
        secondary: { direction: `desc`, nulls: `first` },
        limit: 1,
      },
      false,
    ],
    [
      `discovered trace: orders a descending and ascending mixed nullable boundary`,
      {
        rows: nullableBoundaryRows,
        primary: { direction: `desc`, nulls: `first` },
        secondary: { direction: `asc`, nulls: `first` },
        limit: 1,
      },
      true,
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
      false,
    ],
  ] satisfies ReadonlyArray<readonly [string, MultiOrderScenario, boolean]>)(
    `%s`,
    async (_name, scenario, expectsFailure) => {
      if (!expectsFailure) {
        await runMultiOrderScenario(scenario)
        return
      }
      await expectAssertionFailure(runMultiOrderScenario, {
        checkpoint: 0,
        classify: ({ actual, expected }) =>
          isNumberArray(actual) &&
          actual.length === 1 &&
          actual[0] === 1 &&
          isNumberArray(expected) &&
          expected.length === 1 &&
          expected[0] === 2,
      })(scenario)
    },
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
      await runPendingMutationScenario(mutation, `before-response`)
      await runPendingMutationScenario(mutation, `after-response`)
    },
  )

  it(
    `discovered trace: an in-flight request does not underfill a new window`,
    expectAssertionFailure(expectInflightRequestFillsNewWindow, {
      checkpoint: 0,
      classify: ({ actual, expected }) =>
        isNumberArray(actual) &&
        actual.length === 0 &&
        isNumberArray(expected) &&
        expected.join(`,`) === `3,4`,
    }),
  )

  it(`rejects collateral loss from the ordered-subscription classifier`, () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 1, 2],
      direction: `asc`,
      initialWindow: { offset: 0, limit: 3 },
      actions: [{ type: `put`, id: 4, rank: 2 }],
    }
    const expected = [
      { id: 1, rank: 0 },
      { id: 2, rank: 1 },
      { id: 3, rank: 2 },
    ]

    expect(
      isKnownOrderedSubscriptionCoverageFailure(
        scenario,
        assertionDifference(1, [expected[0]!], expected),
      ),
    ).toBe(false)
  })

  it(`rejects arbitrary leading loss after an offset shift`, () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 1, 2, 3],
      direction: `asc`,
      initialWindow: { offset: 0, limit: 1 },
      actions: [
        { type: `put`, id: 5, rank: -1 },
        { type: `window`, offset: 1, limit: 3 },
      ],
    }
    const expected = [
      { id: 1, rank: 0 },
      { id: 2, rank: 1 },
      { id: 3, rank: 2 },
    ]

    expect(
      isKnownOrderedSubscriptionCoverageFailure(
        scenario,
        assertionDifference(2, [expected[2]!], expected),
      ),
    ).toBe(false)
  })

  it(`rejects excessive suffix loss from the on-demand classifier`, () => {
    const scenario: PaginationScenario = {
      ranks: [0, 1, 2, 3],
      direction: `asc`,
      windows: [
        { offset: 0, limit: 1 },
        { offset: 1, limit: 3 },
      ],
    }

    expect(
      isKnownOnDemandOffsetUnderfetch(
        scenario,
        assertionDifference(1, [2], [2, 3, 4]),
      ),
    ).toBe(false)
  })

  it(`rejects a corrupted expectation from the on-demand classifier`, () => {
    const scenario: PaginationScenario = {
      ranks: [0, 0, 0, 0, 0, 0, 1],
      direction: `asc`,
      windows: [
        { offset: 0, limit: 1 },
        { offset: 2, limit: 5 },
      ],
    }

    expect(
      isKnownOnDemandOffsetUnderfetch(
        scenario,
        assertionDifference(1, [3, 4, 5, 6], [3, 4, 5, 6, 99]),
      ),
    ).toBe(false)
  })

  it(`discovered trace: a row moving across an offset window must refill its boundary`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 0, 0],
      direction: `desc`,
      initialWindow: { offset: 1, limit: 1 },
      actions: [{ type: `put`, id: 1, rank: -1 }],
    }
    await expectAssertionFailure(runPaginationStateScenario, {
      checkpoint: 1,
      classify: ({ actual, expected }) =>
        isPageRowArray(actual) &&
        isPageRowArray(expected) &&
        sameRows(actual, [{ id: 1, rank: -1 }]) &&
        sameRows(expected, [{ id: 3, rank: 0 }]),
    })(scenario)
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
    await expectAssertionFailure(runPaginationStateScenario, {
      checkpoint: 2,
      classify: ({ actual, expected }) =>
        isPageRowArray(actual) &&
        isPageRowArray(expected) &&
        sameRows(actual, [
          { id: 1, rank: 0 },
          { id: 3, rank: 1 },
        ]) &&
        sameRows(expected, [
          { id: 1, rank: 0 },
          { id: 2, rank: 0 },
          { id: 3, rank: 1 },
        ]),
    })(scenario)
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
    await expectAssertionFailure(runPaginationStateScenario, {
      checkpoint: 2,
      classify: ({ actual, expected }) =>
        isPageRowArray(actual) &&
        actual.length === 0 &&
        isPageRowArray(expected) &&
        sameRows(expected, [{ id: 3, rank: 1 }]),
    })(scenario)
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
    await expectAssertionFailure(runPaginationStateScenario, {
      checkpoint: 2,
      classify: ({ actual, expected }) =>
        isPageRowArray(actual) &&
        actual.length === 0 &&
        isPageRowArray(expected) &&
        sameRows(expected, [{ id: 2, rank: 1 }]),
    })(scenario)
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
    await expectAssertionFailure(runPaginationStateScenario, {
      checkpoint: 3,
      classify: ({ actual, expected }) =>
        isPageRowArray(actual) &&
        actual.length === 0 &&
        isPageRowArray(expected) &&
        sameRows(expected, [{ id: 4, rank: 1 }]),
    })(scenario)
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

    await expectAssertionFailure(runPaginationStateScenario, {
      checkpoint: 2,
      classify: ({ actual, expected }) =>
        isPageRowArray(actual) &&
        sameRows(actual, [{ id: 9, rank: 1 }]) &&
        isPageRowArray(expected) &&
        sameRows(expected, [{ id: 8, rank: 1 }]),
    })(scenario)
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
    await expectAssertionFailure(runOnDemandPaginationScenario, {
      checkpoint: 1,
      classify: ({ actual, expected }) =>
        isNumberArray(actual) &&
        isNumberArray(expected) &&
        actual.join(`,`) === `3,4,5,6` &&
        expected.join(`,`) === `3,4,5,6,7`,
    })(scenario)
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
    await expectAssertionFailure(runOnDemandPaginationScenario, {
      checkpoint: 1,
      classify: ({ actual, expected }) =>
        isNumberArray(actual) &&
        actual.length === 0 &&
        isNumberArray(expected) &&
        expected.join(`,`) === `2`,
    })(scenario)
  })

  fcTest.prop([scenarioArbitrary], { numRuns: runs, seed: 1657 })(
    `matches full recomputation across ordered windows for a fixed seed`,
    runPaginationScenario,
  )

  fcTest.prop([scenarioArbitrary], randomParameters)(
    `matches full recomputation across ordered windows for a random or replayed seed`,
    runPaginationScenario,
  )

  fcTest.prop([stateScenarioArbitrary], {
    numRuns: 8 * multiplier,
    seed: 1658,
  })(
    `matches full recomputation across source and window transitions for a fixed seed`,
    runPaginationStateScenarioWithKnownFailures,
  )

  fcTest.prop(
    [stateScenarioArbitrary],
    replaySeed === undefined
      ? { numRuns: 8 * multiplier }
      : { numRuns: 8 * multiplier, seed: replaySeed },
  )(
    `matches full recomputation across source and window transitions for a random or replayed seed`,
    runPaginationStateScenarioWithKnownFailures,
  )

  it(`discovered trace: a rank update must refill a top-1 window`, async () => {
    const scenario: PaginationStateScenario = {
      ranks: [0, 0],
      direction: `asc`,
      initialWindow: { offset: 0, limit: 1 },
      actions: [{ type: `put`, id: 1, rank: 1 }],
    }
    const staleMembership = [{ id: 1, rank: 1 }]
    const expected = [{ id: 2, rank: 0 }]

    await expectAssertionFailure(runPaginationStateScenario, {
      checkpoint: 1,
      classify: (difference) =>
        isPageRowArray(difference.actual) &&
        isPageRowArray(difference.expected) &&
        sameRows(difference.actual, staleMembership) &&
        sameRows(difference.expected, expected),
    })(scenario)
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
    const defective = [
      { id: 1, rank: 100 },
      { id: 3, rank: 80 },
      { id: 5, rank: 10 },
    ]
    const expected = [
      { id: 1, rank: 100 },
      { id: 3, rank: 80 },
      { id: 4, rank: 70 },
    ]

    await expectAssertionFailure(runPaginationStateScenario, {
      checkpoint: 2,
      classify: (difference) =>
        isPageRowArray(difference.actual) &&
        isPageRowArray(difference.expected) &&
        sameRows(difference.actual, defective) &&
        sameRows(difference.expected, expected),
    })(scenario)
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

    await expectAssertionFailure(runPaginationStateScenario, {
      checkpoint: 2,
      classify: ({ actual, expected }) =>
        isPageRowArray(actual) &&
        sameRows(actual, [{ id: 2, rank: 1 }]) &&
        isPageRowArray(expected) &&
        sameRows(expected, [{ id: 3, rank: 0 }]),
    })(scenario)
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

    await expectAssertionFailure(runPaginationStateScenario, {
      checkpoint: 2,
      classify: ({ actual, expected }) =>
        isPageRowArray(actual) &&
        sameRows(actual, [{ id: 2, rank: 1 }]) &&
        isPageRowArray(expected) &&
        sameRows(expected, [{ id: 3, rank: 0 }]),
    })(scenario)
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

    await expectAssertionFailure(runPaginationStateScenario, {
      checkpoint: 2,
      classify: ({ actual, expected }) =>
        isPageRowArray(actual) &&
        sameRows(actual, [
          { id: 1, rank: 0 },
          { id: 2, rank: -1 },
        ]) &&
        isPageRowArray(expected) &&
        sameRows(expected, [
          { id: 1, rank: 0 },
          { id: 3, rank: 0 },
          { id: 2, rank: -1 },
        ]),
    })(scenario)
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

    await expectAssertionFailure(runPaginationStateScenario, {
      checkpoint: 2,
      classify: ({ actual, expected }) =>
        isPageRowArray(actual) &&
        sameRows(actual, [
          { id: 1, rank: 1 },
          { id: 2, rank: 0 },
          { id: 3, rank: 0 },
          { id: 4, rank: 0 },
        ]) &&
        isPageRowArray(expected) &&
        sameRows(expected, [
          { id: 1, rank: 1 },
          { id: 5, rank: 1 },
          { id: 2, rank: 0 },
          { id: 3, rank: 0 },
        ]),
    })(scenario)
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
    const defective = [
      { id: 1, rank: 0 },
      { id: 3, rank: 0 },
    ]
    const expected = [
      { id: 1, rank: 0 },
      { id: 2, rank: 0 },
    ]

    await expectAssertionFailure(runPaginationStateScenario, {
      checkpoint: 2,
      classify: (difference) =>
        isPageRowArray(difference.actual) &&
        isPageRowArray(difference.expected) &&
        sameRows(difference.actual, defective) &&
        sameRows(difference.expected, expected),
    })(scenario)
  })

  it(`expands a multi-column boundary before choosing top-K`, async () => {
    await expectAssertionFailure(expectMultiOrderBoundaryMatches, {
      checkpoint: 0,
      classify: ({ actual, expected }) =>
        Array.isArray(actual) &&
        actual.every((value) => typeof value === `number`) &&
        Array.isArray(expected) &&
        expected.every((value) => typeof value === `number`) &&
        actual.join(`,`) === `2,3,1,4` &&
        expected.join(`,`) === `2,3,1,5`,
    })()
  })

  fcTest.prop([scenarioArbitrary], {
    numRuns: 8 * multiplier,
    seed: 1659,
  })(
    `matches full recomputation when exact async cursor loads widen ordered coverage for a fixed seed`,
    runOnDemandPaginationScenarioWithKnownFailures,
  )

  fcTest.prop(
    [scenarioArbitrary],
    replaySeed === undefined
      ? { numRuns: 8 * multiplier }
      : { numRuns: 8 * multiplier, seed: replaySeed },
  )(
    `matches full recomputation when exact async cursor loads widen ordered coverage for a random or replayed seed`,
    runOnDemandPaginationScenarioWithKnownFailures,
  )

  it.each([`forward`, `reverse`] as const)(
    `keeps concurrent on-demand windows correct under %s completion`,
    expectOnDemandWindowsAreCompletionOrderIndependent,
  )
})
