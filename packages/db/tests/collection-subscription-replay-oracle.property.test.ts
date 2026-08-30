import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { ReverseIndex } from '../src/indexes/reverse-index.js'
import { attachLoadSubsetRequestSignal } from '../src/load-subset-request-provenance.js'
import { getStableExpressionHash } from '../src/query/ir-stable-identity.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { DeduplicatedLoadSubset } from '../src/query/subset-dedupe.js'
import { createTransaction } from '../src/transactions.js'
import { projectAtomicOrderedPublicationState } from './load-subset-full-flow-model.js'
import { oracleRandomParameters, readOracleRunConfig } from './oracle-config.js'
import { flushPromises } from './utils.js'
import type { Collection } from '../src/collection/index.js'
import type { OrderBy } from '../src/query/ir.js'
import type {
  ChangeMessageOrDeleteKeyMessage,
  LoadSubsetOptions,
  SyncMetadataApi,
} from '../src/types.js'
import type { LoadSubsetFullFlowEvent } from './load-subset-full-flow-model.js'

type ReplayRow = {
  id: `one` | `two`
  value: number
}

type ReplayDemandId = ReplayRow[`id`]

type ReplayLoad = {
  demandId: ReplayDemandId
  rows: ReadonlyArray<ReplayRow>
  outcome: `resolve` | `reject`
  writeBeforeSettlement?: boolean
}

type ReplayAttempt = {
  loads: ReadonlyArray<ReplayLoad>
}

type SourceAction =
  | { type: `put`; row: ReplayRow }
  | { type: `delete`; id: ReplayRow[`id`] }
  | { type: `request`; demandId: ReplayDemandId }

type SourceWriteOrigin =
  | { type: `initial`; demandId: ReplayDemandId }
  | { type: `replay`; demandId: ReplayDemandId; attemptIndex: number }
  | { type: `ordinary` }

type SourceWrite = {
  origin: SourceWriteOrigin
  installed: boolean
  rows: ReadonlyArray<ReplayRow>
}

type ReplayChange = {
  type: `insert` | `update` | `delete`
  key: string | number
  value: ReplayRow
  previousValue?: ReplayRow
}

type ReplayScenario = {
  initialRows: ReadonlyArray<ReplayRow>
  demandIds: ReadonlyArray<ReplayDemandId>
  attempts: ReadonlyArray<ReplayAttempt>
  settlementOrder: ReadonlyArray<number>
  settlementPhases: ReadonlyArray<number>
  releaseOnLastAttempt?: ReplayDemandId
  afterSettlement: ReadonlyArray<SourceAction>
}

type SequentialReplayLoad = {
  rows: ReadonlyArray<ReplayRow>
  outcome: `return` | `throw` | `resolve` | `reject`
}

type SequentialReplayScenario = {
  initialRows: ReadonlyArray<ReplayRow>
  loads: ReadonlyArray<SequentialReplayLoad>
}

type ReplayCompletionScenario = {
  delivery: `return` | `resolve`
  obsoleteBy:
    | `stay-active`
    | `release-snapshot`
    | `unsubscribe`
    | `request-abort`
    | `newer-truncate`
  failingUnload: `none` | `initial` | `first-replay`
}

type CleanupRestartScenario = {
  oldOutcome: `resolve` | `reject`
  newOutcome: `resolve` | `reject`
  settleOldFirst: boolean
}

type SharedSubscriptionScenario = {
  outcome: `resolve` | `reject`
  releaseCountBeforeSettlement: 0 | 1 | 2
}

type OptimisticReplayScenario = {
  operation: `insert` | `update` | `delete`
  outcome: `resolve` | `reject`
  serverRetainsTarget: boolean
  initialValue: number
  optimisticValue: number
  serverValue: number
}

type PendingReplay = {
  attemptIndex: number
  load: ReplayLoad
  signal: AbortSignal | undefined
  deferred: ReturnType<typeof createDeferred<void>>
  error: Error
  wroteRows: boolean
  settled: boolean
}

type NestedCleanupEdge = Readonly<{
  targets: ReadonlyArray<number>
  catchFailures: boolean
}>

type NestedCleanupGraph = Readonly<{
  id: string
  ids: ReadonlyArray<string>
  edges: ReadonlyMap<number, NestedCleanupEdge>
  failures: ReadonlyMap<number, unknown>
}>

async function exerciseNestedCleanupGraph({
  id,
  ids,
  edges,
  failures,
}: NestedCleanupGraph) {
  type Row = { id: string }
  let begin!: () => void
  let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  const wheres = ids.map(
    (rowId) => new Func(`eq`, [new PropRef([`id`]), new Value(rowId)]),
  )
  const replays = ids.map(() => createDeferred<void>())
  const loads: Array<LoadSubsetOptions> = []
  const unloads: Array<LoadSubsetOptions> = []
  const visitedEdges = new Set<number>()
  const failedOptions = new Set<LoadSubsetOptions>()
  type TestSubscription = ReturnType<
    ReturnType<typeof createCollection<Row>>[`subscribeChanges`]
  >
  const owner: { current?: TestSubscription } = {}
  const collection = createCollection<Row>({
    id,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: (options) => {
            loads.push(options)
            const index = loads.length - 1
            if (index < ids.length) {
              begin()
              write({ type: `insert`, value: { id: ids[index]! } })
              commit()
              return true
            }
            return replays[index - ids.length]!.promise
          },
          unloadSubset: (options) => {
            unloads.push(options)
            const index = loads.indexOf(options)
            const edge = edges.get(index)
            if (edge && !visitedEdges.has(index)) {
              visitedEdges.add(index)
              for (const target of edge.targets) {
                if (edge.catchFailures) {
                  try {
                    owner.current!.releaseSnapshot(wheres[target]!)
                  } catch {
                    // The graph decides whether this cleanup later throws its
                    // own failure or completes after handling nested failures.
                  }
                } else {
                  owner.current!.releaseSnapshot(wheres[target]!)
                }
              }
            }
            const failure = failures.get(index)
            if (failures.has(index) && !failedOptions.has(options)) {
              failedOptions.add(options)
              throw failure
            }
          },
        }
      },
    },
  })
  const visible = new Set<string>()
  const reported: Array<{ error: unknown; optionsIndex: number }> = []
  const subscription = collection.subscribeChanges((changes) => {
    for (const change of changes) {
      if (change.type === `delete`) visible.delete(String(change.key))
      else visible.add(String(change.key))
    }
  })
  owner.current = subscription
  subscription.on(`loadSubset:error`, ({ error, options }) =>
    reported.push({ error, optionsIndex: loads.indexOf(options) }),
  )

  try {
    for (const where of wheres) subscription.requestSnapshot({ where })
    begin()
    truncate()
    commit()
    await flushPromises()

    for (const replay of replays) replay.resolve()
    await flushPromises()

    const beforeRetry = unloads.map((options) => loads.indexOf(options))
    const status = subscription.status
    const publishedIds = [...visible].sort()
    subscription.unsubscribe()
    const afterRetry = unloads.map((options) => loads.indexOf(options))
    return { reported, beforeRetry, afterRetry, status, publishedIds }
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
}

type ReplayCallbackCleanupMode = `return` | `rethrow` | `distinct` | `same`

async function exerciseReplayCallbackCleanup({
  id,
  nestedFailure,
  outerFailure,
  mode,
}: {
  id: string
  nestedFailure: unknown
  outerFailure: unknown
  mode: ReplayCallbackCleanupMode
}) {
  type Row = { id: string; version: number }
  const whereA = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
  const whereB = new Func(`eq`, [new PropRef([`id`]), new Value(`b`)])
  let begin!: () => void
  let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  const loads: Array<LoadSubsetOptions> = []
  const unloads: Array<LoadSubsetOptions> = []
  let failedB = false
  let cleanupArmed = false
  let callbackCount = 0
  const collection = createCollection<Row>({
    id,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: (options) => {
            loads.push(options)
            const rowId = loads.length % 2 === 1 ? `b` : `a`
            begin()
            write({
              type: `insert`,
              value: { id: rowId, version: loads.length },
            })
            commit()
            return true
          },
          unloadSubset: (options) => {
            unloads.push(options)
            if (cleanupArmed && sameWhere(options.where, whereB) && !failedB) {
              failedB = true
              throw nestedFailure
            }
          },
        }
      },
    },
  })
  const visible = new Map<string, Row>()
  const reported: Array<{ error: unknown; optionsIndex: number }> = []
  const subscription = collection.subscribeChanges((changes) => {
    for (const change of changes) {
      if (change.type === `delete`) visible.delete(String(change.key))
      else visible.set(String(change.key), change.value)
    }
  })
  subscription.on(`loadSubset:error`, ({ error, options }) =>
    reported.push({ error, optionsIndex: loads.indexOf(options) }),
  )

  try {
    subscription.requestSnapshot({ where: whereB })
    subscription.requestSnapshot({
      where: whereA,
      onLoadSubsetResult: () => {
        callbackCount++
        if (callbackCount !== 2) return
        cleanupArmed = true
        let caught: unknown
        try {
          subscription.releaseSnapshot(whereB)
        } catch (error) {
          caught = error
        }
        if (mode === `rethrow`) throw caught
        if (mode === `distinct`) throw outerFailure
        if (mode === `same`) throw nestedFailure
      },
    })
    await flushPromises()

    begin()
    truncate()
    commit()
    await flushPromises()

    const visibleVersions = [...visible]
      .map(([rowId, row]) => [rowId, row.version] as const)
      .sort(([left], [right]) => left.localeCompare(right))
    const beforeRetry = unloads.map((options) => loads.indexOf(options))
    subscription.unsubscribe()
    const afterRetry = unloads.map((options) => loads.indexOf(options))
    return {
      reported,
      visibleVersions,
      beforeRetry,
      afterRetry,
      status: subscription.status,
    }
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
}

const rowArbitrary: fc.Arbitrary<ReplayRow> = fc.record({
  id: fc.constantFrom(`one` as const, `two` as const),
  value: fc.integer({ min: -2, max: 2 }),
})

const rowsArbitrary = fc.uniqueArray(rowArbitrary, {
  minLength: 0,
  maxLength: 2,
  selector: ({ id }) => id,
})

function replayLoadArbitrary(
  demandId: ReplayDemandId,
): fc.Arbitrary<ReplayLoad> {
  return fc.record({
    demandId: fc.constant(demandId),
    rows: fc
      .option(fc.integer({ min: -2, max: 2 }), { nil: undefined })
      .map((value) => (value === undefined ? [] : [{ id: demandId, value }])),
    outcome: fc.constantFrom(`resolve` as const, `reject` as const),
    writeBeforeSettlement: fc.boolean(),
  })
}

function sourceActionArbitrary(
  demandIds: ReadonlyArray<ReplayDemandId>,
): fc.Arbitrary<SourceAction> {
  return fc.oneof(
    fc
      .tuple(fc.constantFrom(...demandIds), fc.integer({ min: -2, max: 2 }))
      .map(([id, value]) => ({ type: `put` as const, row: { id, value } })),
    fc
      .constantFrom(...demandIds)
      .map((id) => ({ type: `delete` as const, id })),
  )
}

const replayScenarioArbitrary: fc.Arbitrary<ReplayScenario> = fc
  .uniqueArray(fc.constantFrom<ReplayDemandId>(`one`, `two`), {
    minLength: 1,
    maxLength: 2,
  })
  .chain((demandIds) =>
    fc
      .record({
        initialRows: rowsArbitrary,
        attempts: fc.array(
          fc
            .tuple(
              ...demandIds.map((demandId) => replayLoadArbitrary(demandId)),
            )
            .map((loads) => ({ loads })),
          { minLength: 1, maxLength: 3 },
        ),
        releaseOnLastAttempt: fc.option(fc.constantFrom(...demandIds), {
          nil: undefined,
        }),
      })
      .chain(({ initialRows, attempts, releaseOnLastAttempt }) => {
        const replayCount = attempts.length * demandIds.length
        const lastAttemptIndex = attempts.length - 1
        return fc
          .record({
            settlementOrder: fc.shuffledSubarray(
              Array.from({ length: replayCount }, (_, index) => index),
              { minLength: replayCount, maxLength: replayCount },
            ),
            rawSettlementPhases: fc.array(
              fc.integer({ min: 0, max: lastAttemptIndex }),
              { minLength: replayCount, maxLength: replayCount },
            ),
            afterSettlement:
              releaseOnLastAttempt === undefined
                ? fc.array(sourceActionArbitrary(demandIds), {
                    minLength: 0,
                    maxLength: 3,
                  })
                : fc.constant<ReadonlyArray<SourceAction>>([]),
          })
          .map(({ settlementOrder, rawSettlementPhases, afterSettlement }) => ({
            initialRows,
            demandIds,
            attempts,
            settlementOrder,
            settlementPhases: rawSettlementPhases.map((phase, replayIndex) =>
              Math.max(phase, Math.floor(replayIndex / demandIds.length)),
            ),
            releaseOnLastAttempt,
            afterSettlement,
          }))
      }),
  )

const sequentialReplayScenarioArbitrary: fc.Arbitrary<SequentialReplayScenario> =
  fc.record({
    initialRows: rowsArbitrary,
    loads: fc.array(
      fc.record({
        rows: rowsArbitrary,
        outcome: fc.constantFrom(
          `return` as const,
          `throw` as const,
          `resolve` as const,
          `reject` as const,
        ),
      }),
      { minLength: 1, maxLength: 3 },
    ),
  })

const replayCompletionScenarioArbitrary: fc.Arbitrary<ReplayCompletionScenario> =
  fc.record({
    delivery: fc.constantFrom(`return` as const, `resolve` as const),
    obsoleteBy: fc.constantFrom(
      `stay-active` as const,
      `release-snapshot` as const,
      `unsubscribe` as const,
      `request-abort` as const,
      `newer-truncate` as const,
    ),
    failingUnload: fc.constantFrom(
      `none` as const,
      `initial` as const,
      `first-replay` as const,
    ),
  })

const exhaustiveReplayCompletionScenarios: Array<ReplayCompletionScenario> = [
  `return` as const,
  `resolve` as const,
].flatMap((delivery) =>
  (
    [
      `stay-active`,
      `release-snapshot`,
      `unsubscribe`,
      `request-abort`,
      `newer-truncate`,
    ] as const
  ).flatMap((obsoleteBy) =>
    ([`none`, `initial`, `first-replay`] as const).map((failingUnload) => ({
      delivery,
      obsoleteBy,
      failingUnload,
    })),
  ),
)

const cleanupRestartScenarioArbitrary: fc.Arbitrary<CleanupRestartScenario> =
  fc.record({
    oldOutcome: fc.constantFrom(`resolve` as const, `reject` as const),
    newOutcome: fc.constantFrom(`resolve` as const, `reject` as const),
    settleOldFirst: fc.boolean(),
  })

const sharedSubscriptionScenarioArbitrary: fc.Arbitrary<SharedSubscriptionScenario> =
  fc.record({
    outcome: fc.constantFrom(`resolve` as const, `reject` as const),
    releaseCountBeforeSettlement: fc.constantFrom(
      0 as const,
      1 as const,
      2 as const,
    ),
  })

const optimisticReplayScenarioArbitrary: fc.Arbitrary<OptimisticReplayScenario> =
  fc
    .record({
      operation: fc.constantFrom(
        `insert` as const,
        `update` as const,
        `delete` as const,
      ),
      outcome: fc.constantFrom(`resolve` as const, `reject` as const),
      serverRetainsTarget: fc.boolean(),
      values: fc.uniqueArray(fc.integer({ min: -3, max: 3 }), {
        minLength: 3,
        maxLength: 3,
      }),
    })
    .map(({ operation, outcome, serverRetainsTarget, values }) => ({
      operation,
      outcome,
      serverRetainsTarget,
      initialValue: values[0]!,
      optimisticValue: values[1]!,
      serverValue: values[2]!,
    }))

function rowsById(
  rows: ReadonlyArray<ReplayRow>,
): Map<string | number, ReplayRow> {
  return new Map(rows.map((row) => [row.id, { ...row }]))
}

function sortedRows(
  rows: ReadonlyMap<string | number, ReplayRow>,
): Array<ReplayRow> {
  return [...rows.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
}

function publicationDiff(
  baseline: ReadonlyMap<string | number, ReplayRow>,
  finalRows: ReadonlyMap<string | number, ReplayRow>,
): Array<ReplayChange> {
  const changes: Array<ReplayChange> = []
  for (const [key, previousValue] of baseline) {
    const value = finalRows.get(key)
    if (!value) {
      changes.push({
        type: `delete`,
        key,
        value: { ...previousValue },
      })
    } else if (value.value !== previousValue.value) {
      changes.push({
        type: `update`,
        key,
        value: { ...value },
        previousValue: { ...previousValue },
      })
    }
  }
  for (const [key, value] of finalRows) {
    if (!baseline.has(key)) {
      changes.push({ type: `insert`, key, value: { ...value } })
    }
  }
  return changes
}

function sortedChanges(
  changes: ReadonlyArray<ReplayChange>,
): Array<ReplayChange> {
  return [...changes].sort((left, right) =>
    String(left.key).localeCompare(String(right.key)),
  )
}

function recordPublishedChanges(
  visible: Map<string | number, ReplayRow>,
  changes: ReadonlyArray<ReplayChange>,
): Array<ReplayChange> {
  const recorded = changes.map((change) => ({
    type: change.type,
    key: change.key,
    value: { id: change.value.id, value: change.value.value },
    ...(change.previousValue === undefined
      ? {}
      : {
          previousValue: {
            id: change.previousValue.id,
            value: change.previousValue.value,
          },
        }),
  }))
  for (const change of recorded) {
    if (change.type === `delete`) visible.delete(change.key)
    else visible.set(change.key, { ...change.value })
  }
  return recorded
}

function expectSameSubsetRequest(
  actual: LoadSubsetOptions,
  expected: LoadSubsetOptions,
): void {
  expect(sameWhere(actual.where, expected.where)).toBe(true)
  expect(actual.orderBy).toEqual(expected.orderBy)
  expect(actual.limit).toBe(expected.limit)
  expect(actual.cursor).toEqual(expected.cursor)
  expect(actual.offset).toBe(expected.offset)
}

function expectReplayRequestToRestart(
  actual: LoadSubsetOptions,
  stored: LoadSubsetOptions,
  expectedOffset = 0,
): void {
  expect(sameWhere(actual.where, stored.where)).toBe(true)
  expect(actual.orderBy).toEqual(stored.orderBy)
  expect(actual.limit).toBe(stored.limit)
  expect(actual.cursor).toBeUndefined()
  expect(actual.offset).toBe(expectedOffset)
}

function sameWhere(
  actual: LoadSubsetOptions[`where`],
  expected: LoadSubsetOptions[`where`],
): boolean {
  if (actual === undefined || expected === undefined) {
    return actual === expected
  }
  return getStableExpressionHash(actual) === getStableExpressionHash(expected)
}

async function runReplayScenario(scenario: ReplayScenario): Promise<void> {
  let begin!: () => void
  let write!: (
    message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
  ) => void
  let commit!: () => void
  let truncate!: () => void
  let loadCount = 0
  let unloadCount = 0
  const leases = new Map<
    LoadSubsetOptions,
    { acquisitions: number; releases: number }
  >()
  const queuedLoads: Array<{ attemptIndex: number; load: ReplayLoad }> = []
  const queuedReacquisitions = new Set<ReplayDemandId>()
  const pendingReplays: Array<PendingReplay> = []
  const sourceRows = new Map<string | number, ReplayRow>()
  const sourceWrites: Array<SourceWrite> = []
  const expectedSourceWrites: Array<SourceWrite> = []
  const demandWheres = new Map(
    scenario.demandIds.map((demandId) => [
      demandId,
      new Func(`eq`, [new PropRef([`id`]), new Value(demandId)]),
    ]),
  )
  const demandIdByWhereHash = new Map(
    [...demandWheres].map(([demandId, where]) => [
      getStableExpressionHash(where),
      demandId,
    ]),
  )
  const requestByDemand = new Map<ReplayDemandId, LoadSubsetOptions>()
  const activeDemandIds = new Set(scenario.demandIds)

  const recordExpectedSourceWrite = (
    rows: ReadonlyArray<ReplayRow>,
    origin: SourceWriteOrigin,
    installed: boolean,
  ) => {
    expectedSourceWrites.push({
      origin,
      installed,
      rows: rows.map((row) => ({ ...row })),
    })
  }

  const assertSourceWrites = () => {
    expect(sourceWrites).toEqual(expectedSourceWrites)
  }

  const applyRows = (
    rows: ReadonlyArray<ReplayRow>,
    origin: SourceWriteOrigin,
    signal?: AbortSignal,
  ): boolean => {
    const installed = !signal?.aborted
    sourceWrites.push({
      origin,
      installed,
      rows: rows.map((row) => ({ ...row })),
    })
    if (!installed || rows.length === 0) return installed
    begin()
    for (const row of rows) {
      write({
        type: sourceRows.has(row.id) ? `update` : `insert`,
        value: { ...row },
      })
    }
    commit()
    for (const row of rows) sourceRows.set(row.id, { ...row })
    return true
  }

  const collection: Collection<ReplayRow, string | number> =
    createCollection<ReplayRow>({
      id: `subscription-replay-oracle`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loadCount++
              const lease = leases.get(options) ?? {
                acquisitions: 0,
                releases: 0,
              }
              lease.acquisitions++
              leases.set(options, lease)
              const demandId =
                options.where === undefined
                  ? undefined
                  : demandIdByWhereHash.get(
                      getStableExpressionHash(options.where),
                    )
              if (demandId === undefined) {
                throw new Error(`Subset request did not preserve its demand`)
              }

              if (!requestByDemand.has(demandId)) {
                requestByDemand.set(demandId, options)
                applyRows(
                  scenario.initialRows.filter(({ id }) => id === demandId),
                  { type: `initial`, demandId },
                )
                return true
              }

              const queuedIndex = queuedLoads.findIndex(
                ({ load }) => load.demandId === demandId,
              )
              if (queuedIndex === -1) {
                if (queuedReacquisitions.delete(demandId)) {
                  expectSameSubsetRequest(
                    options,
                    requestByDemand.get(demandId)!,
                  )
                  return true
                }
                throw new Error(`Replay load was not queued for ${demandId}`)
              }
              const [queued] = queuedLoads.splice(queuedIndex, 1)
              if (!queued) throw new Error(`Replay queue changed unexpectedly`)
              expectSameSubsetRequest(options, requestByDemand.get(demandId)!)
              const pending: PendingReplay = {
                attemptIndex: queued.attemptIndex,
                load: queued.load,
                signal: options.signal,
                deferred: createDeferred<void>(),
                error: new Error(`Replay rejected`),
                wroteRows: false,
                settled: false,
              }
              pendingReplays.push(pending)
              return pending.deferred.promise
            },
            unloadSubset: (options) => {
              unloadCount++
              const lease = leases.get(options) ?? {
                acquisitions: 0,
                releases: 0,
              }
              lease.releases++
              leases.set(options, lease)
            },
          }
        },
      },
    })

  const visible = new Map<string | number, ReplayRow>()
  let publicationCount = 0
  const publicationBatches: Array<Array<ReplayChange>> = []
  const subscription = collection.subscribeChanges((changes) => {
    publicationCount++
    publicationBatches.push(recordPublishedChanges(visible, changes))
  })
  const reportedErrors: Array<unknown> = []
  subscription.on(`loadSubset:error`, ({ error }) => reportedErrors.push(error))
  let unsubscribed = false

  const assertPublished = (
    expected: ReadonlyMap<string | number, ReplayRow>,
  ) => {
    expect(sortedRows(visible)).toEqual(sortedRows(expected))
  }

  const assertSource = () => {
    const actual = rowsById(
      collection.toArray.map(({ id, value }) => ({ id, value })),
    )
    expect(sortedRows(actual)).toEqual(sortedRows(sourceRows))
  }

  const applySourceAction = (action: SourceAction): boolean => {
    if (action.type === `request`) return false
    if (action.type === `delete`) {
      const previous = sourceRows.get(action.id)
      if (!previous) return false
      begin()
      write({ type: `delete`, key: action.id })
      commit()
      sourceRows.delete(action.id)
      return true
    }

    const previous = sourceRows.get(action.row.id)
    if (previous?.value === action.row.value) return false
    applyRows([action.row], { type: `ordinary` })
    return true
  }

  try {
    for (const demandId of scenario.demandIds) {
      subscription.requestSnapshot({
        optimizedOnly: false,
        where: demandWheres.get(demandId),
      })
      recordExpectedSourceWrite(
        scenario.initialRows.filter(({ id }) => id === demandId),
        { type: `initial`, demandId },
        true,
      )
      assertSourceWrites()
    }
    const expectedPublished = rowsById(
      scenario.initialRows.filter(({ id }) => activeDemandIds.has(id)),
    )
    assertPublished(expectedPublished)
    assertSource()
    let expectedPublicationCount = publicationCount
    let lastReportedError: Error | undefined
    let modelSession:
      | {
          baseline: Map<string | number, ReplayRow>
          pending: Set<number>
          currentAttemptIndex: number
          publicationCount: number
          errors: Array<Error>
        }
      | undefined

    const writeReplayRows = (
      pending: PendingReplay,
      isCurrent: boolean,
    ): void => {
      if (pending.wroteRows) return
      const load = pending.load
      recordExpectedSourceWrite(
        load.rows,
        {
          type: `replay`,
          demandId: load.demandId,
          attemptIndex: pending.attemptIndex,
        },
        isCurrent,
      )
      const installed = applyRows(
        load.rows,
        {
          type: `replay`,
          demandId: load.demandId,
          attemptIndex: pending.attemptIndex,
        },
        pending.signal,
      )
      pending.wroteRows = true
      expect(installed).toBe(isCurrent)
      assertSourceWrites()
    }

    const settleReplay = async (replayIndex: number) => {
      const pending = pendingReplays[replayIndex]!
      const session = modelSession!
      const load = pending.load
      const isCurrent =
        pending.attemptIndex === session.currentAttemptIndex &&
        activeDemandIds.has(load.demandId)
      pending.settled = true
      if (load.outcome === `resolve`) {
        writeReplayRows(pending, isCurrent)
        pending.deferred.resolve()
      } else {
        if (isCurrent) {
          session.errors.push(pending.error)
        } else {
          expect(pending.signal?.aborted).toBe(true)
        }
        pending.deferred.reject(pending.error)
      }
      session.pending.delete(replayIndex)
      await flushPromises()
      assertSource()

      const hasPendingReplay = pendingReplays.some(({ settled }) => !settled)
      expect(subscription.status).toBe(
        hasPendingReplay ? `loadingSubset` : `ready`,
      )

      if (session.pending.size === 0) {
        const currentAttempt = scenario.attempts[session.currentAttemptIndex]!
        const currentAttemptSucceeds = currentAttempt.loads.every(
          ({ demandId, outcome }) =>
            !activeDemandIds.has(demandId) || outcome === `resolve`,
        )
        const previousPublication = new Map(expectedPublished)
        expectedPublished.clear()
        const nextRows = currentAttemptSucceeds
          ? rowsById(
              currentAttempt.loads.flatMap(({ demandId, rows }) =>
                activeDemandIds.has(demandId) ? rows : [],
              ),
            )
          : session.baseline
        for (const [id, row] of nextRows) {
          expectedPublished.set(id, { ...row })
        }

        if (currentAttemptSucceeds) {
          const expectedBatch = publicationDiff(
            previousPublication,
            expectedPublished,
          )
          expect(publicationCount - session.publicationCount).toBe(
            Number(expectedBatch.length > 0),
          )
          if (expectedBatch.length > 0) {
            expect(sortedChanges(publicationBatches.at(-1)!)).toEqual(
              sortedChanges(expectedBatch),
            )
          }
        } else {
          expect(publicationCount).toBe(session.publicationCount)
        }
        expectedPublicationCount = publicationCount
        lastReportedError = session.errors.at(-1) ?? lastReportedError
        modelSession = undefined
      } else {
        expect(publicationCount).toBe(session.publicationCount)
      }

      assertPublished(expectedPublished)
      expect(subscription.lastError).toBe(lastReportedError)
      expect(reportedErrors.at(-1)).toBe(lastReportedError)
    }

    for (const [attemptIndex, attempt] of scenario.attempts.entries()) {
      modelSession ??= {
        baseline: new Map(expectedPublished),
        pending: new Set(),
        currentAttemptIndex: attemptIndex,
        publicationCount: expectedPublicationCount,
        errors: [],
      }
      modelSession.currentAttemptIndex = attemptIndex

      for (const load of attempt.loads) {
        queuedLoads.push({ attemptIndex, load })
      }
      const firstReplayIndex = pendingReplays.length
      begin()
      truncate()
      commit()
      sourceRows.clear()
      await flushPromises()
      for (
        let replayIndex = firstReplayIndex;
        replayIndex < pendingReplays.length;
        replayIndex++
      ) {
        modelSession.pending.add(replayIndex)
        const pending = pendingReplays[replayIndex]!
        if (pending.load.writeBeforeSettlement) {
          writeReplayRows(pending, true)
        }
      }
      if (
        attemptIndex === scenario.attempts.length - 1 &&
        scenario.releaseOnLastAttempt !== undefined
      ) {
        subscription.releaseSnapshot(
          demandWheres.get(scenario.releaseOnLastAttempt)!,
        )
        activeDemandIds.delete(scenario.releaseOnLastAttempt)
      }
      assertSource()
      assertPublished(expectedPublished)
      expect(publicationCount).toBe(modelSession.publicationCount)
      expect(subscription.lastError).toBe(lastReportedError)
      expect(subscription.status).toBe(`loadingSubset`)

      for (const replayIndex of scenario.settlementOrder) {
        const replay = pendingReplays[replayIndex]
        if (
          replay &&
          !replay.settled &&
          scenario.settlementPhases[replayIndex] === attemptIndex
        ) {
          await settleReplay(replayIndex)
        }
      }
    }

    expect(modelSession).toBeUndefined()

    for (const action of scenario.afterSettlement) {
      const countBeforeAction = publicationCount
      const previousPublication = new Map(expectedPublished)
      if (action.type === `request`) {
        queuedReacquisitions.add(action.demandId)
        activeDemandIds.add(action.demandId)
        subscription.requestSnapshot({
          optimizedOnly: false,
          where: demandWheres.get(action.demandId),
        })
        const row = sourceRows.get(action.demandId)
        if (row) expectedPublished.set(action.demandId, { ...row })
      }
      const applied = applySourceAction(action)
      if (applied && action.type === `delete`) {
        expectedPublished.delete(action.id)
      } else if (applied && action.type === `put`) {
        recordExpectedSourceWrite([action.row], { type: `ordinary` }, true)
        assertSourceWrites()
        expectedPublished.set(action.row.id, { ...action.row })
      }
      assertSource()
      assertPublished(expectedPublished)
      const expectedBatch = publicationDiff(
        previousPublication,
        expectedPublished,
      )
      expect(publicationCount).toBe(
        countBeforeAction + Number(expectedBatch.length > 0),
      )
      if (expectedBatch.length > 0) {
        expect(sortedChanges(publicationBatches.at(-1)!)).toEqual(
          sortedChanges(expectedBatch),
        )
      }
    }

    subscription.unsubscribe()
    unsubscribed = true
    expect(unloadCount).toBe(loadCount)
    for (const lease of leases.values()) {
      expect(lease).toEqual({ acquisitions: 1, releases: 1 })
    }
    assertSourceWrites()
  } finally {
    for (const replay of pendingReplays) {
      if (!replay.settled) replay.deferred.resolve()
    }
    await flushPromises()
    if (!unsubscribed) subscription.unsubscribe()
    await collection.cleanup()
  }
}

async function runSequentialReplayScenario(
  scenario: SequentialReplayScenario,
): Promise<void> {
  let begin!: () => void
  let write!: (
    message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
  ) => void
  let commit!: () => void
  let truncate!: () => void
  let nextLoad: SequentialReplayLoad | undefined
  let nextError: Error | undefined
  let initialLoad = true
  const sourceRows = new Map<string | number, ReplayRow>()
  const leases = new Map<
    LoadSubsetOptions,
    { acquisitions: number; releases: number }
  >()
  const pending: Array<{
    load: SequentialReplayLoad
    deferred: ReturnType<typeof createDeferred<void>>
    error: Error
  }> = []

  const applyRows = (rows: ReadonlyArray<ReplayRow>) => {
    if (rows.length === 0) return
    begin()
    for (const row of rows) {
      write({
        type: sourceRows.has(row.id) ? `update` : `insert`,
        value: { ...row },
      })
    }
    commit()
    for (const row of rows) sourceRows.set(row.id, { ...row })
  }

  const collection = createCollection<ReplayRow>({
    id: `sequential-replay-oracle`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: (options) => {
            if (initialLoad) {
              initialLoad = false
              applyRows(scenario.initialRows)
              leases.set(options, { acquisitions: 1, releases: 0 })
              return true
            }

            const load = nextLoad
            if (!load) throw new Error(`Sequential replay was not queued`)
            const error = nextError
            if (!error)
              throw new Error(`Sequential replay error was not queued`)
            nextLoad = undefined
            nextError = undefined
            applyRows(load.rows)
            if (load.outcome === `throw`) {
              throw error
            }

            leases.set(options, { acquisitions: 1, releases: 0 })
            if (load.outcome === `return`) return true
            const deferred = createDeferred<void>()
            pending.push({ load, deferred, error })
            return deferred.promise
          },
          unloadSubset: (options) => {
            const lease = leases.get(options)
            if (!lease) {
              throw new Error(`Released an acquisition that never returned`)
            }
            lease.releases++
          },
        }
      },
    },
  })
  const visible = new Map<string | number, ReplayRow>()
  let publicationCount = 0
  const publicationBatches: Array<Array<ReplayChange>> = []
  const subscription = collection.subscribeChanges((changes) => {
    publicationCount++
    publicationBatches.push(recordPublishedChanges(visible, changes))
  })
  const reportedErrors: Array<unknown> = []
  subscription.on(`loadSubset:error`, ({ error }) => reportedErrors.push(error))
  let unsubscribed = false

  try {
    subscription.requestSnapshot({ optimizedOnly: false })
    const expectedPublished = rowsById(scenario.initialRows)
    let expectedLastError: unknown

    for (const load of scenario.loads) {
      const baseline = new Map(expectedPublished)
      const publicationBefore = publicationCount
      const pendingBefore = pending.length
      const expectedError = new Error(
        load.outcome === `throw`
          ? `Synchronous replay failure`
          : `Asynchronous replay failure`,
      )
      nextLoad = load
      nextError = expectedError
      begin()
      truncate()
      commit()
      sourceRows.clear()
      await flushPromises()

      const pendingLoad = pending[pendingBefore]
      if (load.outcome === `resolve`) pendingLoad?.deferred.resolve()
      if (load.outcome === `reject`) {
        pendingLoad?.deferred.reject(pendingLoad.error)
      }
      await flushPromises()

      const succeeded = load.outcome === `return` || load.outcome === `resolve`
      if (succeeded) {
        expectedPublished.clear()
        for (const [id, row] of sourceRows) {
          expectedPublished.set(id, { ...row })
        }
      } else {
        expectedPublished.clear()
        for (const [id, row] of baseline) expectedPublished.set(id, { ...row })
        expectedLastError = expectedError
      }

      const expectedBatch = succeeded
        ? publicationDiff(baseline, expectedPublished)
        : []
      expect(publicationCount - publicationBefore).toBe(
        Number(expectedBatch.length > 0),
      )
      if (expectedBatch.length > 0) {
        expect(sortedChanges(publicationBatches.at(-1)!)).toEqual(
          sortedChanges(expectedBatch),
        )
      }
      expect(sortedRows(visible)).toEqual(sortedRows(expectedPublished))
      expect(
        sortedRows(
          rowsById(collection.toArray.map(({ id, value }) => ({ id, value }))),
        ),
      ).toEqual(sortedRows(sourceRows))
      expect(subscription.status).toBe(`ready`)
      expect(subscription.lastError).toBe(expectedLastError)
      expect(reportedErrors.at(-1)).toBe(expectedLastError)
    }

    subscription.unsubscribe()
    unsubscribed = true
    for (const lease of leases.values()) {
      expect(lease).toEqual({ acquisitions: 1, releases: 1 })
    }
  } finally {
    for (const load of pending) load.deferred.resolve()
    await flushPromises()
    if (!unsubscribed) subscription.unsubscribe()
    await collection.cleanup()
  }
}

let replayCompletionHarnessId = 0

async function runReplayCompletionScenario(
  scenario: ReplayCompletionScenario,
): Promise<void> {
  let begin!: () => void
  let commit!: () => void
  let truncate!: () => void
  const requestAbortController = new AbortController()
  const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
  const loads: Array<LoadSubsetOptions> = []
  const leases = new Map<
    LoadSubsetOptions,
    { index: number; attempts: number; accepted: number; active: boolean }
  >()
  const pending: Array<ReturnType<typeof createDeferred<void>>> = []
  let actionRan = false
  let failedUnload = false

  const truncateSource = () => {
    begin()
    truncate()
    commit()
  }

  const runObsolescenceAction = () => {
    if (actionRan) return
    actionRan = true
    try {
      switch (scenario.obsoleteBy) {
        case `stay-active`:
          break
        case `release-snapshot`:
          subscription.releaseSnapshot(where)
          break
        case `unsubscribe`:
          subscription.unsubscribe()
          break
        case `request-abort`:
          requestAbortController.abort()
          break
        case `newer-truncate`:
          truncateSource()
          break
      }
    } catch {
      // A failed physical release remains active and must be retried below.
    }
  }

  const collection = createCollection<ReplayRow>({
    id: `replay-completion-authority-${replayCompletionHarnessId++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: (options) => {
            const index = loads.length
            loads.push(options)
            leases.set(options, {
              index,
              attempts: 0,
              accepted: 0,
              active: true,
            })
            if (index === 0) return true

            if (scenario.delivery === `return`) {
              if (index === 1) runObsolescenceAction()
              return true
            }

            const deferred = createDeferred<void>()
            pending.push(deferred)
            return deferred.promise
          },
          unloadSubset: (options) => {
            const lease = leases.get(options)
            if (!lease) throw new Error(`Unknown replay acquisition`)
            lease.attempts++
            const shouldFail =
              !failedUnload &&
              ((scenario.failingUnload === `initial` && lease.index === 0) ||
                (scenario.failingUnload === `first-replay` &&
                  lease.index === 1))
            if (shouldFail) {
              failedUnload = true
              throw new Error(`Physical release failed`)
            }
            lease.accepted++
            lease.active = false
          },
        }
      },
    },
  })
  const subscription = collection.subscribeChanges(() => {}, {
    includeInitialState: false,
  })

  try {
    subscription.requestSnapshot({
      where,
      signal: requestAbortController.signal,
      optimizedOnly: false,
    })
    truncateSource()
    await flushPromises()

    if (scenario.delivery === `resolve`) {
      runObsolescenceAction()
      await flushPromises()
      const settlementOrder =
        scenario.obsoleteBy === `newer-truncate`
          ? [...pending].reverse()
          : pending
      for (const deferred of settlementOrder) {
        deferred.resolve()
        await flushPromises()
      }
    }

    await flushPromises()
    expect(actionRan).toBe(true)
    expect(loads).toHaveLength(scenario.obsoleteBy === `newer-truncate` ? 3 : 2)

    for (let retry = 0; retry < 3; retry++) {
      try {
        subscription.unsubscribe()
      } catch {
        // Retrying a failed exact release is required and remains idempotent.
      }
      await flushPromises()
      if ([...leases.values()].every(({ active }) => !active)) break
    }

    for (const lease of leases.values()) {
      expect(lease.accepted).toBe(1)
      expect(lease.active).toBe(false)
      expect(lease.attempts).toBe(
        1 +
          Number(
            (scenario.failingUnload === `initial` && lease.index === 0) ||
              (scenario.failingUnload === `first-replay` && lease.index === 1),
          ),
      )
    }
  } finally {
    for (const deferred of pending) deferred.resolve()
    await flushPromises()
    try {
      subscription.unsubscribe()
    } catch {
      subscription.unsubscribe()
    }
    await collection.cleanup()
  }
}

async function runCleanupRestartScenario(
  scenario: CleanupRestartScenario,
): Promise<void> {
  const sessions: Array<{
    begin: () => void
    write: (message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>) => void
    commit: () => void
  }> = []
  const loads: Array<{
    session: number
    deferred: ReturnType<typeof createDeferred<void>>
  }> = []
  let session = 0
  const collection = createCollection<ReplayRow>({
    id: `cleanup-restart-oracle`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        const currentSession = session++
        sessions.push({ begin, write, commit })
        markReady()
        return {
          loadSubset: () => {
            const deferred = createDeferred<void>()
            loads.push({ session: currentSession, deferred })
            return deferred.promise
          },
        }
      },
    },
  })

  const settle = async (loadIndex: number, outcome: `resolve` | `reject`) => {
    const load = loads[loadIndex]!
    if (outcome === `resolve`) load.deferred.resolve()
    else load.deferred.reject(new Error(`session ${load.session} failed`))
    await flushPromises()
  }

  try {
    const oldResult = collection._sync.loadSubset({})
    expect(oldResult).toBeInstanceOf(Promise)
    if (oldResult instanceof Promise) void oldResult.catch(() => {})
    expect(collection.isLoadingSubset).toBe(true)

    await collection.cleanup()
    expect(collection.isLoadingSubset).toBe(false)

    collection.startSyncImmediate()
    const newResult = collection._sync.loadSubset({})
    expect(newResult).toBeInstanceOf(Promise)
    if (newResult instanceof Promise) void newResult.catch(() => {})
    expect(loads.map(({ session: loadSession }) => loadSession)).toEqual([0, 1])
    expect(collection.isLoadingSubset).toBe(true)

    const oldSession = sessions[0]!
    oldSession.begin()
    oldSession.write({ type: `insert`, value: { id: `one`, value: 1 } })
    oldSession.commit()
    expect(collection.toArray).toEqual([])

    const currentSession = sessions[1]!
    currentSession.begin()
    currentSession.write({ type: `insert`, value: { id: `two`, value: 2 } })
    currentSession.commit()
    expect(collection.toArray.map(({ id, value }) => ({ id, value }))).toEqual([
      { id: `two`, value: 2 },
    ])

    const settlementOrder = scenario.settleOldFirst ? [0, 1] : [1, 0]
    const outcomes = [scenario.oldOutcome, scenario.newOutcome] as const
    let newSettled = false
    for (const loadIndex of settlementOrder) {
      await settle(loadIndex, outcomes[loadIndex]!)
      if (loadIndex === 1) newSettled = true
      expect(collection.isLoadingSubset).toBe(!newSettled)
      expect(
        collection.toArray.map(({ id, value }) => ({ id, value })),
      ).toEqual([{ id: `two`, value: 2 }])
    }
  } finally {
    for (const { deferred } of loads) deferred.resolve()
    await flushPromises()
    await collection.cleanup()
  }
}

async function runSharedSubscriptionScenario(
  scenario: SharedSubscriptionScenario,
): Promise<void> {
  let begin!: () => void
  let write!: (
    message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
  ) => void
  let commit!: () => void
  const transport = createDeferred<void>()
  let transportOptions: LoadSubsetOptions | undefined
  let transportCalls = 0
  const unloads: Array<LoadSubsetOptions> = []
  const dedupe = new DeduplicatedLoadSubset({
    loadSubset: (options) => {
      transportCalls++
      transportOptions = options
      return transport.promise
    },
  })
  const collection = createCollection<ReplayRow>({
    id: `shared-subscription-oracle`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: dedupe.loadSubset,
          unloadSubset: (options) => unloads.push(options),
        }
      },
    },
  })
  const visible = [
    new Map<string | number, ReplayRow>(),
    new Map<string | number, ReplayRow>(),
  ] as const
  const subscribe = (rows: Map<string | number, ReplayRow>) =>
    collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === `delete`) rows.delete(change.key)
        else {
          rows.set(change.key, {
            id: change.value.id,
            value: change.value.value,
          })
        }
      }
    })
  const subscriptions = [subscribe(visible[0]), subscribe(visible[1])] as const
  const where = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
  let firstUnsubscribed = false
  let secondUnsubscribed = false

  try {
    subscriptions[0].requestSnapshot({ where })
    subscriptions[1].requestSnapshot({ where })
    expect(transportCalls).toBe(1)
    expect(subscriptions[0].status).toBe(`loadingSubset`)
    expect(subscriptions[1].status).toBe(`loadingSubset`)

    if (scenario.releaseCountBeforeSettlement >= 1) {
      subscriptions[0].unsubscribe()
      firstUnsubscribed = true
      expect(transportOptions?.signal?.aborted).toBe(false)
    }
    if (scenario.releaseCountBeforeSettlement === 2) {
      subscriptions[1].unsubscribe()
      secondUnsubscribed = true
      expect(transportOptions?.signal?.aborted).toBe(true)
    }

    const failure = new Error(`shared transport failed`)
    if (scenario.outcome === `resolve`) {
      if (!transportOptions?.signal?.aborted) {
        begin()
        write({ type: `insert`, value: { id: `one`, value: 1 } })
        commit()
      }
      transport.resolve()
    } else {
      transport.reject(
        transportOptions?.signal?.aborted
          ? new DOMException(`obsolete`, `AbortError`)
          : failure,
      )
    }
    await flushPromises()

    if (!secondUnsubscribed) {
      expect(subscriptions[1].status).toBe(`ready`)
      expect(subscriptions[1].lastError).toBe(
        scenario.outcome === `reject` ? failure : undefined,
      )
      expect([...visible[1].values()]).toEqual(
        scenario.outcome === `resolve` ? [{ id: `one`, value: 1 }] : [],
      )
    } else {
      expect(subscriptions[1].lastError).toBeUndefined()
      expect([...visible[1].values()]).toEqual([])
    }
    if (firstUnsubscribed) {
      expect(subscriptions[0].lastError).toBeUndefined()
    } else {
      expect(subscriptions[0].lastError).toBe(
        scenario.outcome === `reject` ? failure : undefined,
      )
    }

    if (!firstUnsubscribed) {
      subscriptions[0].unsubscribe()
      firstUnsubscribed = true
    }
    if (!secondUnsubscribed) {
      subscriptions[1].unsubscribe()
      secondUnsubscribed = true
    }
    expect(unloads).toHaveLength(2)
    expect(new Set(unloads).size).toBe(2)
  } finally {
    transport.resolve()
    await flushPromises()
    if (!firstUnsubscribed) subscriptions[0].unsubscribe()
    if (!secondUnsubscribed) subscriptions[1].unsubscribe()
    await collection.cleanup()
  }
}

function applyOptimisticOperation(
  source: ReadonlyMap<string | number, ReplayRow>,
  scenario: OptimisticReplayScenario,
): Map<string | number, ReplayRow> {
  const result = new Map(
    [...source].map(([key, row]) => [key, { ...row }] as const),
  )
  if (scenario.operation === `insert`) {
    result.set(`two`, { id: `two`, value: scenario.optimisticValue })
  } else if (scenario.operation === `update`) {
    result.set(`one`, { id: `one`, value: scenario.optimisticValue })
  } else {
    result.delete(`one`)
  }
  return result
}

async function runOptimisticReplayScenario(
  scenario: OptimisticReplayScenario,
): Promise<void> {
  let begin!: (options?: { immediate?: boolean }) => void
  let write!: (
    message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
  ) => void
  let commit!: () => void
  let truncate!: () => void
  let loadCount = 0
  const replay = createDeferred<void>()
  const replayFailure = new Error(`optimistic replay failed`)
  const mutation = createDeferred<void>()
  const initialSource = rowsById([{ id: `one`, value: scenario.initialValue }])
  const replayRows =
    scenario.operation === `insert`
      ? [
          { id: `one` as const, value: scenario.serverValue },
          ...(scenario.serverRetainsTarget
            ? [{ id: `two` as const, value: scenario.serverValue }]
            : []),
        ]
      : scenario.serverRetainsTarget
        ? [{ id: `one` as const, value: scenario.serverValue }]
        : []
  const replaySource = rowsById(replayRows)
  const collection = createCollection<ReplayRow>({
    id: `optimistic-replay-${scenario.operation}-${scenario.outcome}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: () => {
            loadCount++
            if (loadCount === 1) {
              begin()
              for (const row of initialSource.values()) {
                write({ type: `insert`, value: { ...row } })
              }
              commit()
              return true
            }
            return replay.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const visible = new Map<string | number, ReplayRow>()
  const batches: Array<Array<ReplayChange>> = []
  const subscription = collection.subscribeChanges((changes) => {
    batches.push(recordPublishedChanges(visible, changes))
  })
  const transaction = createTransaction({
    mutationFn: () => mutation.promise,
  })
  void transaction.isPersisted.promise.catch(() => {})
  let unsubscribed = false

  try {
    subscription.requestSnapshot({ optimizedOnly: false })
    expect(sortedRows(visible)).toEqual(sortedRows(initialSource))

    transaction.mutate(() => {
      if (scenario.operation === `insert`) {
        collection.insert({ id: `two`, value: scenario.optimisticValue })
      } else if (scenario.operation === `update`) {
        collection.update(`one`, (draft) => {
          draft.value = scenario.optimisticValue
        })
      } else {
        collection.delete(`one`)
      }
    })
    const optimisticBaseline = applyOptimisticOperation(initialSource, scenario)
    expect(sortedRows(visible)).toEqual(sortedRows(optimisticBaseline))
    expect(
      sortedRows(
        rowsById(collection.toArray.map(({ id, value }) => ({ id, value }))),
      ),
    ).toEqual(sortedRows(optimisticBaseline))
    batches.length = 0

    begin()
    truncate()
    commit()
    await flushPromises()
    // A loadSubset adapter must install its request-scoped rows before its
    // promise settles, even while a user mutation is still persisting.
    begin({ immediate: true })
    for (const row of replayRows) {
      write({ type: `insert`, value: { ...row } })
    }
    commit()
    if (scenario.outcome === `resolve`) replay.resolve()
    else replay.reject(replayFailure)
    await flushPromises()

    const expected = applyOptimisticOperation(
      scenario.outcome === `resolve` ? replaySource : initialSource,
      scenario,
    )
    const expectedBatch =
      scenario.outcome === `resolve`
        ? publicationDiff(optimisticBaseline, expected)
        : []
    expect(sortedRows(visible)).toEqual(sortedRows(expected))
    expect(batches.map(sortedChanges)).toEqual(
      expectedBatch.length > 0 ? [sortedChanges(expectedBatch)] : [],
    )
    expect(subscription.lastError).toBe(
      scenario.outcome === `reject` ? replayFailure : undefined,
    )

    subscription.unsubscribe()
    unsubscribed = true
  } finally {
    replay.resolve()
    mutation.resolve()
    await flushPromises()
    if (!unsubscribed) subscription.unsubscribe()
    await collection.cleanup()
  }
}

const { multiplier, replaySeed, replayPath } = readOracleRunConfig()
const generatedRuns = 30 * multiplier
const generatedTimeout = 5_000 * multiplier

describe(`CollectionSubscription replay oracle`, () => {
  it(`aborts an in-flight initial acquisition before its replay replaces it`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const loads: Array<{
      options: LoadSubsetOptions
      deferred: ReturnType<typeof createDeferred<void>>
    }> = []
    const collection = createCollection<ReplayRow>({
      id: `initial-acquisition-replay`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              const deferred = createDeferred<void>()
              loads.push({ options, deferred })
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key)
        else {
          visible.set(change.key, {
            id: change.value.id,
            value: change.value.value,
          })
        }
      }
    })

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(loads[0]?.options.signal?.aborted).toBe(true)

      begin()
      write({ type: `insert`, value: { id: `two`, value: 2 } })
      commit()
      loads[1]?.deferred.resolve()
      await flushPromises()

      if (!loads[0]?.options.signal?.aborted) {
        begin()
        write({ type: `insert`, value: { id: `one`, value: 1 } })
        commit()
      }
      loads[0]?.deferred.resolve()
      await flushPromises()

      expect(sortedRows(visible)).toEqual([{ id: `two`, value: 2 }])
      expect(subscription.status).toBe(`ready`)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`ignores ordered coverage from an initial acquisition retired by replay`, async () => {
    type Outcome = {
      hasMore: boolean
      appliedRowKeys: ReadonlyArray<ReplayRow[`id`]>
    }
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const loads: Array<{
      options: LoadSubsetOptions
      deferred: ReturnType<typeof createDeferred<Outcome>>
    }> = []
    const collection = createCollection<ReplayRow>({
      id: `retired-initial-ordered-coverage`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              const deferred = createDeferred<Outcome>()
              loads.push({ options, deferred })
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const index = collection.createIndex((row) => row.value, {
      indexType: BTreeIndex,
    })
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`value`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const visible = new Set<ReplayRow[`id`]>()
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        const key = change.key as ReplayRow[`id`]
        if (change.type === `delete`) visible.delete(key)
        else visible.add(key)
      }
    })
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      begin()
      write({ type: `insert`, value: { id: `one`, value: 1 } })
      commit()

      begin()
      truncate()
      commit()
      await flushPromises()
      expect(loads).toHaveLength(2)
      expect(loads[0]?.options.signal?.aborted).toBe(true)

      begin()
      write({ type: `insert`, value: { id: `two`, value: 2 } })
      commit()
      loads[1]?.deferred.resolve({
        hasMore: true,
        appliedRowKeys: [`two`],
      })
      await flushPromises()
      expect([...visible]).toEqual([])
      expect(subscription.orderedBoundaryKey).toBeUndefined()

      loads[0]?.deferred.resolve({
        hasMore: false,
        appliedRowKeys: [`one`],
      })
      await flushPromises()

      expect([...visible]).toEqual([])
      expect(subscription.orderedBoundaryKey).toBeUndefined()
    } finally {
      for (const load of loads) {
        load.deferred.resolve({ hasMore: false, appliedRowKeys: [] })
      }
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`preserves unbounded locale refinement when replaying a demand`, async () => {
    type LocaleRow = { id: string; label: string }
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const loads: Array<LoadSubsetOptions> = []
    const collection = createCollection<LocaleRow>({
      id: `unbounded-locale-replay`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const index = collection.createIndex((row) => row.label, {
      indexType: BTreeIndex,
    })
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`label`]),
        compareOptions: {
          direction: `asc`,
          nulls: `first`,
          stringSort: `locale`,
          locale: `en-US`,
          localeOptions: { numeric: true },
        },
      },
    ]
    const subscription = collection.subscribeChanges(() => {})
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({
        orderBy,
        limit: 1,
        minValues: [`item2`],
      })
      expect(loads).toHaveLength(1)
      expect(loads[0]?.limit).toBeUndefined()
      expect(loads[0]?.offset).toBeUndefined()
      expect(loads[0]?.cursor).toBeUndefined()

      begin()
      truncate()
      commit()
      await flushPromises()

      expect(loads).toHaveLength(2)
      expect(loads[1]?.limit).toBeUndefined()
      expect(loads[1]?.offset).toBeUndefined()
      expect(loads[1]?.cursor).toBeUndefined()
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([`return`, `resolve`] as const)(
    `does not publish ordered coverage after reentrant snapshot release: %s`,
    async (resultKind) => {
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
      ) => void
      let commit!: () => void
      let releaseDuringLoad = () => {}
      const loads: Array<LoadSubsetOptions> = []
      const where = new Func(`eq`, [new PropRef([`value`]), new Value(1)])
      const collection = createCollection<ReplayRow>({
        id: `reentrant-ordered-release-${resultKind}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            params.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (loads.length === 1) {
                  begin()
                  write({ type: `insert`, value: { id: `one`, value: 1 } })
                  commit()
                  releaseDuringLoad()
                }
                return resultKind === `return` ? true : Promise.resolve()
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.value, {
        indexType: BTreeIndex,
      })
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`value`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const published: Array<ReplayChange> = []
      const subscription = collection.subscribeChanges(
        (changes) => {
          published.push(...changes)
        },
        { whereExpression: where },
      )
      subscription.setOrderByIndex(index)
      releaseDuringLoad = () => subscription.releaseSnapshot(where)

      try {
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        await flushPromises()

        expect(loads).toHaveLength(1)
        expect(published).toEqual([])

        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        await flushPromises()
        expect(loads).toHaveLength(2)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`return`, `resolve`, `reject`] as const)(
    `does not report an ordered acquisition released during adapter entry: %s`,
    async (resultKind) => {
      type Row = { id: string; rank: number }
      const result = createDeferred<void>()
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      let releaseDuringLoad = () => {}
      const collection = createCollection<Row>({
        id: `reentrant-ordered-result-${resultKind}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                releaseDuringLoad()
                return resultKind === `return` ? true : result.promise
              },
              unloadSubset: (options) => {
                unloads.push(options)
              },
            }
          },
        },
      })
      const where = new Func(`gte`, [new PropRef([`rank`]), new Value(0)])
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const subscription = collection.subscribeChanges(() => {}, {
        whereExpression: where,
      })
      subscription.setOrderByIndex(index)
      releaseDuringLoad = () => subscription.releaseSnapshot(where)
      let resultCallbackCount = 0

      try {
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          onLoadSubsetResult: () => {
            resultCallbackCount++
          },
        })

        expect(loads).toHaveLength(1)
        expect(unloads).toEqual(loads)
        expect(loads[0]?.signal?.aborted).toBe(true)
        expect(resultCallbackCount).toBe(0)
        expect(subscription.status).toBe(`ready`)

        if (resultKind === `reject`) {
          result.reject(new Error(`obsolete ordered request`))
        } else {
          result.resolve()
        }
        await flushPromises()

        expect(resultCallbackCount).toBe(0)
        expect(subscription.status).toBe(`ready`)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([false, true] as const).flatMap((combinedPredicate) =>
      ([`where`, `exact`] as const).flatMap((releaseMode) =>
        ([`return`, `resolve`] as const).map(
          (resultKind) => [combinedPredicate, releaseMode, resultKind] as const,
        ),
      ),
    ),
  )(
    `does not publish an unordered snapshot after reentrant release: combined=%s release=%s result=%s`,
    async (combinedPredicate, releaseMode, resultKind) => {
      type Row = { id: string; value: number }
      let releaseDuringLoad = () => {}
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const requestWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
      const subscriptionWhere = combinedPredicate
        ? new Func(`gte`, [new PropRef([`value`]), new Value(0)])
        : undefined
      const callerAbort = new AbortController()
      const collection = createCollection<Row>({
        id: `reentrant-unordered-release-${combinedPredicate}-${releaseMode}-${resultKind}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            params.begin()
            params.write({
              type: `insert`,
              value: { id: `a`, value: 1 },
            })
            params.commit()
            params.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                releaseDuringLoad()
                return resultKind === `return` ? true : Promise.resolve()
              },
              unloadSubset: (options) => {
                unloads.push(options)
              },
            }
          },
        },
      })
      // Start sync and retain its ordinary source row independently of the
      // demand under test. The tested request must not publish that local row
      // after its own acquisition releases inside loadSubset.
      const sourceOwner = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      await flushPromises()
      let publicationCount = 0
      const subscription = collection.subscribeChanges(
        (changes) => {
          publicationCount += changes.length
        },
        { whereExpression: subscriptionWhere },
      )
      releaseDuringLoad = () =>
        subscription.releaseSnapshot(
          requestWhere,
          releaseMode === `exact` ? callerAbort.signal : undefined,
        )

      try {
        const requested = subscription.requestSnapshot({
          where: requestWhere,
          signal: callerAbort.signal,
        })
        await flushPromises()

        expect(requested).toBe(false)
        expect(loads).toHaveLength(1)
        expect(unloads).toEqual(loads)
        expect(loads[0]?.signal?.aborted).toBe(true)
        expect(publicationCount).toBe(0)
      } finally {
        subscription.unsubscribe()
        sourceOwner.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`release`, `unsubscribe`] as const)(
    `rolls back a synchronous start failure before reentrant error handling: %s`,
    async (reentrantAction) => {
      type Row = { id: string }
      const failure = new Error(`load failed before acquisition`)
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const collection = createCollection<Row>({
        id: `sync-start-failure-reentrant-${reentrantAction}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                throw failure
              },
              unloadSubset: (options) => {
                unloads.push(options)
              },
            }
          },
        },
      })
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
      const subscription = collection.subscribeChanges(() => {})
      subscription.on(`loadSubset:error`, () => {
        if (reentrantAction === `release`) subscription.releaseSnapshot(where)
        else subscription.unsubscribe()
      })

      try {
        expect(() => subscription.requestSnapshot({ where })).toThrow(failure)
        expect(loads).toHaveLength(1)
        expect(unloads).toEqual([])
        expect(loads[0]?.signal?.aborted).toBe(true)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`release-where`, `release-exact`, `unsubscribe`] as const).flatMap(
      (action) =>
        ([`return`, `resolve`, `reject`] as const).map(
          (resultKind) => [action, resultKind] as const,
        ),
    ),
  )(
    `does not continue an unordered snapshot after result-callback ownership loss: %s %s`,
    async (action, resultKind) => {
      type Row = { id: string; value: number }
      const result = createDeferred<void>()
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const callerAbort = new AbortController()
      const collection = createCollection<Row>({
        id: `unordered-result-callback-${action}-${resultKind}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            params.begin()
            params.write({ type: `insert`, value: { id: `a`, value: 1 } })
            params.commit()
            params.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return resultKind === `return` ? true : result.promise
              },
              unloadSubset: (options) => {
                unloads.push(options)
              },
            }
          },
        },
      })
      const sourceOwner = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      await flushPromises()
      const requestWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
      const subscriptionWhere = new Func(`gte`, [
        new PropRef([`value`]),
        new Value(0),
      ])
      let publicationCount = 0
      const statuses: Array<string> = []
      const subscription = collection.subscribeChanges(
        (changes) => {
          publicationCount += changes.length
        },
        { whereExpression: subscriptionWhere },
      )
      subscription.on(`status:change`, ({ status }) => statuses.push(status))

      try {
        const requested = subscription.requestSnapshot({
          where: requestWhere,
          signal: callerAbort.signal,
          onLoadSubsetResult: () => {
            if (action === `unsubscribe`) {
              subscription.unsubscribe()
            } else {
              subscription.releaseSnapshot(
                requestWhere,
                action === `release-exact` ? callerAbort.signal : undefined,
              )
            }
          },
        })

        expect(requested).toBe(false)
        expect(loads).toHaveLength(1)
        expect(unloads).toEqual(loads)
        expect(loads[0]?.signal?.aborted).toBe(true)
        expect(publicationCount).toBe(0)
        expect(statuses).toEqual([])

        if (resultKind === `reject`) {
          result.reject(new Error(`obsolete unordered result`))
        } else {
          result.resolve()
        }
        await flushPromises()

        expect(publicationCount).toBe(0)
        expect(statuses).toEqual([])
        expect(subscription.status).toBe(`ready`)
      } finally {
        subscription.unsubscribe()
        sourceOwner.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`release`, `unsubscribe`] as const).flatMap((action) =>
      ([`return`, `resolve`, `reject`] as const).map(
        (resultKind) => [action, resultKind] as const,
      ),
    ),
  )(
    `does not track an ordered result after its callback releases ownership: %s %s`,
    async (action, resultKind) => {
      type Row = { id: string; rank: number }
      const result = createDeferred<void>()
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const collection = createCollection<Row>({
        id: `ordered-result-callback-${action}-${resultKind}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return resultKind === `return` ? true : result.promise
              },
              unloadSubset: (options) => {
                unloads.push(options)
              },
            }
          },
        },
      })
      const where = new Func(`gte`, [new PropRef([`rank`]), new Value(0)])
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const statuses: Array<string> = []
      const subscription = collection.subscribeChanges(() => {}, {
        whereExpression: where,
      })
      subscription.setOrderByIndex(index)
      subscription.on(`status:change`, ({ status }) => statuses.push(status))
      let resultCallbackCount = 0

      try {
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          onLoadSubsetResult: () => {
            resultCallbackCount++
            if (action === `release`) subscription.releaseSnapshot(where)
            else subscription.unsubscribe()
          },
        })

        expect(resultCallbackCount).toBe(1)
        expect(loads).toHaveLength(1)
        expect(unloads).toEqual(loads)
        expect(loads[0]?.signal?.aborted).toBe(true)
        expect(statuses).toEqual([])

        if (resultKind === `reject`) {
          result.reject(new Error(`obsolete ordered result`))
        } else {
          result.resolve()
        }
        await flushPromises()

        expect(resultCallbackCount).toBe(1)
        expect(statuses).toEqual([])
        expect(subscription.status).toBe(`ready`)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`asc`, `desc`] as const)(
    `keeps failed ordered replay deltas inside the retained top-K window: %s`,
    async (direction) => {
      type Row = { id: `a` | `b` | `z`; rank: number }
      type Outcome = {
        hasMore: boolean
        appliedRowKeys: ReadonlyArray<Row[`id`]>
      }
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
      ) => void
      let commit!: () => void
      let truncate!: () => void
      let loadCount = 0
      const replay = createDeferred<Outcome>()
      const collection = createCollection<Row>({
        id: `failed-ordered-top-k-delta-${direction}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: () => {
                loadCount++
                if (loadCount === 1) {
                  begin()
                  write({ type: `insert`, value: { id: `a`, rank: 1 } })
                  commit()
                  return Promise.resolve({
                    hasMore: false,
                    appliedRowKeys: [`a`] as const,
                  })
                }
                return replay.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const ascendingIndex = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const index =
        direction === `asc` ? ascendingIndex : new ReverseIndex(ascendingIndex)
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction, nulls: `first` },
        },
      ]
      const visible = new Set<Row[`id`]>()
      const batches: Array<Array<Row[`id`]>> = []
      const subscription = collection.subscribeChanges((changes) => {
        batches.push(changes.map(({ key }) => key as Row[`id`]))
        for (const change of changes) {
          const key = change.key as Row[`id`]
          if (change.type === `delete`) visible.delete(key)
          else visible.add(key)
        }
      })
      subscription.setOrderByIndex(index)

      try {
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        await flushPromises()
        expect([...visible]).toEqual([`a`])

        begin()
        truncate()
        commit()
        await flushPromises()
        replay.reject(new Error(`ordered replay failed`))
        await flushPromises()

        const batchesBeforeDelta = batches.length
        // Reconfirm the retained public row in the new source generation. This
        // must not emit a duplicate, but it makes a later source delete real.
        begin()
        write({ type: `insert`, value: { id: `a`, rank: 1 } })
        commit()
        begin()
        write({
          type: `insert`,
          value: { id: `z`, rank: direction === `asc` ? 100 : -100 },
        })
        commit()

        expect([...visible]).toEqual([`a`])
        expect(batches).toHaveLength(batchesBeforeDelta)
        expect(subscription.orderedBoundaryKey).toBe(`a`)

        begin()
        write({
          type: `insert`,
          value: { id: `b`, rank: direction === `asc` ? 0 : 2 },
        })
        commit()
        expect([...visible]).toEqual([`b`])
        expect(subscription.orderedBoundaryKey).toBe(`b`)

        begin()
        write({ type: `delete`, key: `b` })
        commit()
        expect([...visible]).toEqual([`a`])
        expect(subscription.orderedBoundaryKey).toBe(`a`)

        begin()
        write({ type: `delete`, key: `a` })
        commit()
        expect([...visible]).toEqual([`z`])
        expect(subscription.orderedBoundaryKey).toBe(`z`)

        begin()
        write({ type: `insert`, value: { id: `a`, rank: 1 } })
        commit()
        expect([...visible]).toEqual([`a`])

        subscription.ensureOrderedWindowSize(2)
        expect([...visible]).toEqual([`a`, `z`])
        expect(subscription.orderedBoundaryKey).toBe(`z`)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`retains an empty failed ordered publication across invisible deltas`, async () => {
    type Row = {
      id: `private` | `invisible`
      rank: number
      route: `visible` | `invisible`
    }
    type Outcome = {
      hasMore: boolean
      appliedRowKeys: ReadonlyArray<Row[`id`]>
    }
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const replay = createDeferred<Outcome>()
    const laterLoad = createDeferred<Outcome>()
    const loadOptions: Array<LoadSubsetOptions> = []
    const collection = createCollection<Row>({
      id: `empty-failed-ordered-invisible-delta`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loadCount++
              loadOptions.push(options)
              if (loadCount === 1) {
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [] as const,
                })
              }
              return loadCount === 2 ? replay.promise : laterLoad.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const where = new Func(`eq`, [new PropRef([`route`]), new Value(`visible`)])
    let publishedChangeCount = 0
    const subscription = collection.subscribeChanges(
      (changes) => {
        publishedChangeCount += changes.length
      },
      { whereExpression: where },
    )
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()
      expect(publishedChangeCount).toBe(0)
      expect(subscription.orderedBoundaryKey).toBeUndefined()

      begin()
      truncate()
      commit()
      await flushPromises()
      begin()
      write({
        type: `insert`,
        value: { id: `private`, rank: 10, route: `visible` },
      })
      commit()
      replay.reject(new Error(`ordered replay failed`))
      await flushPromises()

      begin()
      write({
        type: `insert`,
        value: { id: `invisible`, rank: 0, route: `invisible` },
      })
      commit()

      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      expect(loadOptions).toHaveLength(3)
      expect(loadOptions[2]).toMatchObject({ offset: 0 })
      expect(loadOptions[2]?.cursor).toBeUndefined()
      expect(subscription.orderedBoundaryKey).toBeUndefined()
      expect(publishedChangeCount).toBe(0)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([
    `sync`,
    `async`,
    `ordinary`,
    `deduplicated`,
    `mixed-equal-batch`,
    `mixed-replacement-batch`,
    `mixed-metadata-batch`,
    `mixed-request-metadata-batch`,
    `deduplicated-after-release`,
    `deduplicated-after-failed-release`,
  ] as const)(
    `reconciles failed ordered publications for coverage and sibling-demand changes: %s`,
    async (writeTiming) => {
      type Row = { id: `a` | `x` | `y`; rank: number }
      type Outcome = {
        hasMore: boolean
        appliedRowKeys: ReadonlyArray<Row[`id`]>
      }
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
      ) => void
      let commit!: (signal?: AbortSignal) => true | Promise<void>
      let truncate!: () => void
      let metadata!: SyncMetadataApi<Row[`id`]>
      let loadCount = 0
      let throwOnUnload = false
      const loadOptions: Array<LoadSubsetOptions> = []
      const replayLoads: Array<ReturnType<typeof createDeferred<Outcome>>> = []
      let siblingLoad: ReturnType<typeof createDeferred<Outcome>> | undefined
      let deduplicatedOptions: LoadSubsetOptions | undefined
      const publishSiblingRow = (signal: AbortSignal | undefined) => {
        const outcome = {
          hasMore: false,
          appliedRowKeys: [`x`] as const,
        }
        begin()
        write({ type: `update`, value: { id: `x`, rank: -1 } })
        commit(signal)
        return outcome
      }
      const deduplicatedSiblingLoad = new DeduplicatedLoadSubset({
        loadSubset: (options) => {
          deduplicatedOptions = options
          if (
            writeTiming === `mixed-equal-batch` ||
            writeTiming === `mixed-replacement-batch` ||
            writeTiming === `mixed-metadata-batch` ||
            writeTiming === `mixed-request-metadata-batch` ||
            writeTiming === `deduplicated-after-release` ||
            writeTiming === `deduplicated-after-failed-release`
          ) {
            siblingLoad = createDeferred<Outcome>()
            return siblingLoad.promise
          }
          return Promise.resolve(publishSiblingRow(options.signal))
        },
      })
      const collection = createCollection<Row>({
        id: `failed-ordered-sibling-demand`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            metadata = params.metadata!
            params.markReady()
            return {
              loadSubset: (options) => {
                loadOptions.push(options)
                loadCount++
                if (loadCount === 1) {
                  begin()
                  write({ type: `insert`, value: { id: `a`, rank: 1 } })
                  commit()
                  return Promise.resolve({
                    hasMore: false,
                    appliedRowKeys: [`a`] as const,
                  })
                }
                if (
                  loadCount === 5 ||
                  ((writeTiming === `deduplicated-after-release` ||
                    writeTiming === `deduplicated-after-failed-release`) &&
                    loadCount === 6)
                ) {
                  if (writeTiming === `ordinary`) {
                    siblingLoad = createDeferred<Outcome>()
                    return siblingLoad.promise
                  }
                  if (
                    writeTiming === `deduplicated` ||
                    writeTiming === `mixed-equal-batch` ||
                    writeTiming === `mixed-replacement-batch` ||
                    writeTiming === `mixed-metadata-batch` ||
                    writeTiming === `mixed-request-metadata-batch` ||
                    writeTiming === `deduplicated-after-release` ||
                    writeTiming === `deduplicated-after-failed-release`
                  ) {
                    return deduplicatedSiblingLoad.loadSubset(options)
                  }
                  return writeTiming === `sync`
                    ? Promise.resolve(publishSiblingRow(options.signal))
                    : Promise.resolve().then(() =>
                        publishSiblingRow(options.signal),
                      )
                }
                if (loadCount === 2 || loadCount > 5) {
                  return Promise.resolve({
                    hasMore: false,
                    appliedRowKeys: [] as const,
                  })
                }
                const deferred = createDeferred<Outcome>()
                replayLoads.push(deferred)
                return deferred.promise
              },
              unloadSubset: () => {
                if (throwOnUnload) throw new Error(`release failed`)
              },
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const seedSiblingWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`a`),
      ])
      const visible = new Set<Row[`id`]>()
      const subscription = collection.subscribeChanges((changes) => {
        for (const change of changes) {
          const key = change.key as Row[`id`]
          if (change.type === `delete`) visible.delete(key)
          else visible.add(key)
        }
      })
      subscription.setOrderByIndex(index)
      let peerSubscription:
        | ReturnType<typeof collection.subscribeChanges>
        | undefined

      try {
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        subscription.requestSnapshot({ where: seedSiblingWhere })
        await flushPromises()
        expect([...visible]).toEqual([`a`])

        begin()
        truncate()
        commit()
        await flushPromises()
        expect(replayLoads).toHaveLength(2)

        begin()
        write({ type: `insert`, value: { id: `x`, rank: 0 } })
        commit()
        replayLoads[0]?.resolve({
          hasMore: false,
          appliedRowKeys: [`x`],
        })
        replayLoads[1]?.reject(new Error(`sibling replay failed`))
        await flushPromises()

        expect([...visible]).toEqual([`a`])
        expect.soft(subscription.hasOrderedCoverageForActiveWindow).toBe(false)
        expect.soft(subscription.orderedBoundaryKey).toBe(`a`)

        const xWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`x`)])
        subscription.requestSnapshot({ where: xWhere })
        await flushPromises()
        if (writeTiming === `ordinary`) {
          begin()
          write({ type: `update`, value: { id: `x`, rank: -1 } })
          commit()
          siblingLoad?.reject(new Error(`sibling acquisition failed`))
          await flushPromises()
        } else if (
          writeTiming === `mixed-equal-batch` ||
          writeTiming === `mixed-replacement-batch` ||
          writeTiming === `mixed-metadata-batch` ||
          writeTiming === `mixed-request-metadata-batch`
        ) {
          const hold = createDeferred<void>()
          const transaction = createTransaction({
            mutationFn: () => hold.promise,
          })
          transaction.mutate(() => collection.insert({ id: `y`, rank: 1_000 }))
          await flushPromises()

          begin()
          write({ type: `update`, value: { id: `x`, rank: -1 } })
          const firstReceipt = commit(
            writeTiming === `mixed-metadata-batch`
              ? deduplicatedOptions?.signal
              : undefined,
          )
          begin()
          if (
            writeTiming === `mixed-metadata-batch` ||
            writeTiming === `mixed-request-metadata-batch`
          ) {
            metadata.row.set(`x`, {
              source:
                writeTiming === `mixed-metadata-batch`
                  ? `ordinary-metadata`
                  : `request-metadata`,
            })
          } else {
            write({
              type: `update`,
              value: {
                id: `x`,
                rank: writeTiming === `mixed-equal-batch` ? -1 : -2,
              },
            })
          }
          const secondReceipt = commit(
            writeTiming === `mixed-metadata-batch`
              ? undefined
              : deduplicatedOptions?.signal,
          )

          hold.resolve()
          await transaction.isPersisted.promise
          if (firstReceipt !== true) await firstReceipt
          if (secondReceipt !== true) await secondReceipt
          siblingLoad?.resolve({ hasMore: false, appliedRowKeys: [`x`] })
          await flushPromises()
        } else if (
          writeTiming === `deduplicated-after-release` ||
          writeTiming === `deduplicated-after-failed-release`
        ) {
          const localLogicalSignal = loadOptions.at(-1)?.signal
          peerSubscription = collection.subscribeChanges(() => {})
          peerSubscription.requestSnapshot({ where: xWhere })
          await flushPromises()

          const hold = createDeferred<void>()
          const transaction = createTransaction({
            mutationFn: () => hold.promise,
          })
          transaction.mutate(() => collection.insert({ id: `y`, rank: 1_000 }))
          await flushPromises()

          begin()
          write({ type: `update`, value: { id: `x`, rank: -1 } })
          const requestReceipt = commit(deduplicatedOptions?.signal)
          if (writeTiming === `deduplicated-after-failed-release`) {
            throwOnUnload = true
            expect(() => subscription.releaseSnapshot(xWhere)).toThrow(
              `release failed`,
            )
            throwOnUnload = false
            expect(localLogicalSignal?.aborted).toBe(true)
            expect(deduplicatedOptions?.signal?.aborted).toBe(false)
          } else {
            subscription.releaseSnapshot(xWhere)
          }

          hold.resolve()
          await transaction.isPersisted.promise
          if (requestReceipt !== true) await requestReceipt
          siblingLoad?.resolve({ hasMore: false, appliedRowKeys: [`x`] })
          await flushPromises()
        }
        const hasOrdinaryAuthority =
          writeTiming === `ordinary` ||
          writeTiming === `mixed-equal-batch` ||
          writeTiming === `mixed-request-metadata-batch`
        const expectedBoundary = hasOrdinaryAuthority ? `x` : `a`
        const releasedBeforeApplication =
          writeTiming === `deduplicated-after-release` ||
          writeTiming === `deduplicated-after-failed-release`
        expect
          .soft([...visible].sort())
          .toEqual(releasedBeforeApplication ? [`a`] : [`a`, `x`])
        expect.soft(subscription.orderedBoundaryKey).toBe(expectedBoundary)

        subscription.releaseSnapshot(xWhere)
        expect
          .soft([...visible].sort())
          .toEqual(hasOrdinaryAuthority ? [`a`, `x`] : [`a`])
        expect.soft(subscription.orderedBoundaryKey).toBe(expectedBoundary)

        subscription.requestSnapshot({ where: xWhere })
        await flushPromises()
        expect([...visible].sort()).toEqual([`a`, `x`])

        begin()
        write({ type: `insert`, value: { id: `y`, rank: 200 } })
        commit()
        expect.soft([...visible].sort()).toEqual([`a`, `x`])

        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        await flushPromises()
        expect.soft(loadOptions.at(-1)).toMatchObject({
          offset: 1,
          cursor: { lastKey: expectedBoundary },
        })
      } finally {
        throwOnUnload = false
        subscription.unsubscribe()
        peerSubscription?.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`does not grant ordered authority to an aborted replay retained for cleanup`, async () => {
    type Row = { id: string; rank: number }
    type Outcome = {
      hasMore: boolean
      appliedRowKeys: ReadonlyArray<string>
    }
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: (signal?: AbortSignal) => true | Promise<void>
    let truncate!: () => void
    const replay = createDeferred<Outcome>()
    const loads: Array<LoadSubsetOptions> = []
    const physical = new AbortController()
    let failCleanup = false
    const collection = createCollection<Row>({
      id: `aborted-replay-cleanup-authority`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (loads.length === 1) {
                begin()
                write({ type: `insert`, value: { id: `a`, rank: 1 } })
                commit(options.signal)
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [`a`] as const,
                })
              }
              attachLoadSubsetRequestSignal(physical.signal, options.signal)
              return replay.promise
            },
            unloadSubset: () => {
              if (failCleanup) throw new Error(`cleanup failed`)
            },
          }
        },
      },
    })
    const where = new Func(`gte`, [new PropRef([`rank`]), new Value(0)])
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const visible = new Map<string, Row>()
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          const key = String(change.key)
          if (change.type === `delete`) visible.delete(key)
          else visible.set(key, change.value)
        }
      },
      { whereExpression: where },
    )
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()

      begin()
      truncate()
      commit()
      await flushPromises()
      failCleanup = true
      replay.resolve({ hasMore: false, appliedRowKeys: [] })
      await flushPromises()

      expect([...visible.keys()]).toEqual([`a`])
      expect(subscription.orderedBoundaryKey).toBe(`a`)
      expect(loads[1]?.signal?.aborted).toBe(true)
      expect(physical.signal.aborted).toBe(false)

      begin()
      write({ type: `insert`, value: { id: `x`, rank: 0 } })
      const receipt = commit(physical.signal)
      if (receipt !== true) await receipt
      await flushPromises()

      expect([...visible.keys()]).toEqual([`a`])
      expect(subscription.orderedBoundaryKey).toBe(`a`)
    } finally {
      failCleanup = false
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`publishes a replay replacement before reporting ready`, async () => {
    type Row = { id: string; rank: number }
    type Outcome = {
      hasMore: boolean
      appliedRowKeys: ReadonlyArray<string>
    }
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: (signal?: AbortSignal) => true | Promise<void>
    let truncate!: () => void
    const replay = createDeferred<Outcome>()
    const loads: Array<LoadSubsetOptions> = []
    const collection = createCollection<Row>({
      id: `replay-ready-after-publication`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (loads.length === 1) {
                begin()
                write({ type: `insert`, value: { id: `a`, rank: 1 } })
                commit(options.signal)
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [`a`] as const,
                })
              }
              return replay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const visible = new Map<string, Row>()
    const readyObservations: Array<{
      keys: ReadonlyArray<string>
      boundary: string | number | undefined
    }> = []
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        const key = String(change.key)
        if (change.type === `delete`) visible.delete(key)
        else visible.set(key, change.value)
      }
    })
    subscription.setOrderByIndex(index)
    subscription.on(`status:ready`, () => {
      readyObservations.push({
        keys: [...visible.keys()],
        boundary: subscription.orderedBoundaryKey,
      })
    })

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()
      expect([...visible.keys()]).toEqual([`a`])
      readyObservations.length = 0

      begin()
      truncate()
      commit()
      await flushPromises()
      begin()
      write({ type: `insert`, value: { id: `x`, rank: 0 } })
      const receipt = commit(loads[1]?.signal)
      if (receipt !== true) await receipt

      replay.resolve({ hasMore: false, appliedRowKeys: [`x`] })
      await flushPromises()

      expect(readyObservations).toEqual([{ keys: [`x`], boundary: `x` }])
      expect([...visible.keys()]).toEqual([`x`])
      expect(subscription.orderedBoundaryKey).toBe(`x`)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each(
    ([`throw`, `reject`] as const).flatMap((failureKind) =>
      ([`reentrant`, `next-turn`] as const).map(
        (listenerTiming) => [failureKind, listenerTiming] as const,
      ),
    ),
  )(
    `preserves demand started by a replay error listener: %s %s`,
    async (failureKind, listenerTiming) => {
      type Row = { id: string; rank: number }
      type Outcome = {
        hasMore: boolean
        appliedRowKeys: ReadonlyArray<string>
      }
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, string>,
      ) => void
      let commit!: (signal?: AbortSignal) => true | Promise<void>
      let truncate!: () => void
      const replay = createDeferred<Outcome>()
      const loads: Array<LoadSubsetOptions> = []
      const collection = createCollection<Row>({
        id: `replay-error-demand-${failureKind}-${listenerTiming}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (loads.length === 1) {
                  begin()
                  write({ type: `insert`, value: { id: `a`, rank: 1 } })
                  commit(options.signal)
                  return Promise.resolve({
                    hasMore: false,
                    appliedRowKeys: [`a`] as const,
                  })
                }
                if (loads.length === 2) {
                  if (failureKind === `throw`) {
                    throw new Error(`replay failed`)
                  }
                  return replay.promise
                }
                begin()
                write({ type: `insert`, value: { id: `x`, rank: 0 } })
                commit(options.signal)
                return true
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const orderedWhere = new Func(`gte`, [
        new PropRef([`rank`]),
        new Value(0),
      ])
      const additionalWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`x`),
      ])
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const visible = new Map<string, Row>()
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            const key = String(change.key)
            if (change.type === `delete`) visible.delete(key)
            else visible.set(key, change.value)
          }
        },
        { whereExpression: orderedWhere },
      )
      subscription.setOrderByIndex(index)
      let errorCount = 0
      subscription.on(`loadSubset:error`, () => {
        errorCount++
        const requestAdditional = () => {
          subscription.requestSnapshot({
            where: additionalWhere,
            optimizedOnly: false,
          })
        }
        if (listenerTiming === `next-turn`) queueMicrotask(requestAdditional)
        else requestAdditional()
      })

      try {
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        await flushPromises()
        begin()
        truncate()
        commit()
        await flushPromises()
        if (failureKind === `reject`) {
          replay.reject(new Error(`replay failed`))
        }
        await flushPromises()

        expect(errorCount).toBe(1)
        expect([...visible.keys()].sort()).toEqual([`a`, `x`])
        expect(subscription.orderedBoundaryKey).toBe(`a`)

        subscription.releaseSnapshot(additionalWhere)
        expect([...visible.keys()]).toEqual([`a`])
        expect(subscription.orderedBoundaryKey).toBe(`a`)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`first`, `last`] as const).flatMap((rejectionOrder) =>
      ([`reentrant`, `next-turn`] as const).map(
        (listenerTiming) => [rejectionOrder, listenerTiming] as const,
      ),
    ),
  )(
    `restores a multi-demand replay before reporting its error: %s %s`,
    async (rejectionOrder, listenerTiming) => {
      type Row = { id: string; value: number }
      const whereA = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
      const whereB = new Func(`eq`, [new PropRef([`id`]), new Value(`b`)])
      const whereX = new Func(`eq`, [new PropRef([`id`]), new Value(`x`)])
      const replayA = createDeferred<void>()
      const replayB = createDeferred<void>()
      let replaying = false
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, string>,
      ) => void
      let commit!: (signal?: AbortSignal) => true | Promise<void>
      let truncate!: () => void
      const loads: Array<LoadSubsetOptions> = []
      const collection = createCollection<Row>({
        id: `multi-demand-replay-error-${rejectionOrder}-${listenerTiming}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (sameWhere(options.where, whereX)) {
                  begin()
                  write({ type: `insert`, value: { id: `x`, value: 3 } })
                  return commit(options.signal)
                }
                if (replaying) {
                  return sameWhere(options.where, whereA)
                    ? replayA.promise
                    : replayB.promise
                }
                const id = sameWhere(options.where, whereA) ? `a` : `b`
                begin()
                write({
                  type: `insert`,
                  value: { id, value: id === `a` ? 1 : 2 },
                })
                return commit(options.signal)
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const visible = new Map<string, Row>()
      const errorObservations: Array<ReadonlyArray<string>> = []
      const subscription = collection.subscribeChanges((changes) => {
        for (const change of changes) {
          const key = String(change.key)
          if (change.type === `delete`) visible.delete(key)
          else visible.set(key, change.value)
        }
      })
      subscription.on(`loadSubset:error`, () => {
        const recover = () => {
          subscription.requestSnapshot({ where: whereX, optimizedOnly: false })
          errorObservations.push([...visible.keys()].sort())
        }
        if (listenerTiming === `next-turn`) queueMicrotask(recover)
        else recover()
      })

      try {
        subscription.requestSnapshot({ where: whereA })
        subscription.requestSnapshot({ where: whereB })
        await flushPromises()
        expect([...visible.keys()].sort()).toEqual([`a`, `b`])

        replaying = true
        begin()
        truncate()
        commit()
        await flushPromises()

        if (rejectionOrder === `first`) {
          replayA.reject(new Error(`first replay demand failed`))
          await flushPromises()
          expect(errorObservations).toEqual([])
          replayB.resolve()
        } else {
          replayB.resolve()
          await flushPromises()
          expect(errorObservations).toEqual([])
          replayA.reject(new Error(`last replay demand failed`))
        }
        await flushPromises()

        expect(errorObservations).toEqual([[`a`, `b`, `x`]])
        expect([...visible.keys()].sort()).toEqual([`a`, `b`, `x`])
        expect(loads).toHaveLength(5)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`return`, `throw`, `resolve`, `reject`] as const)(
    `settles callback-created ordered replay replacement in the same epoch: %s`,
    async (replacementResult) => {
      type Row = { id: string; rank: number }
      type Outcome = {
        hasMore: boolean
        appliedRowKeys: ReadonlyArray<string>
      }
      const where = new Func(`gte`, [new PropRef([`rank`]), new Value(0)])
      const whereX = new Func(`eq`, [new PropRef([`id`]), new Value(`x`)])
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const replacement = createDeferred<Outcome>()
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, string>,
      ) => void
      let commit!: (signal?: AbortSignal) => true | Promise<void>
      let truncate!: () => void
      const loads: Array<LoadSubsetOptions> = []
      const collection = createCollection<Row>({
        id: `callback-replay-replacement-${replacementResult}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (!options.orderBy) {
                  begin()
                  write({ type: `insert`, value: { id: `x`, rank: 2 } })
                  commit(options.signal)
                  return true
                }
                if (loads.length === 1) {
                  begin()
                  write({ type: `insert`, value: { id: `a`, rank: 1 } })
                  commit(options.signal)
                  return Promise.resolve({
                    hasMore: false,
                    appliedRowKeys: [`a`] as const,
                  })
                }
                if (loads.length === 2) return true

                begin()
                write({ type: `insert`, value: { id: `y`, rank: 1 } })
                commit(options.signal)
                if (replacementResult === `return`) return true
                if (replacementResult === `throw`) {
                  throw new Error(`replacement failed`)
                }
                return replacement.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const visible = new Map<string, Row>()
      const errorObservations: Array<ReadonlyArray<string>> = []
      let callbackCount = 0
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            const key = String(change.key)
            if (change.type === `delete`) visible.delete(key)
            else visible.set(key, change.value)
          }
        },
        { whereExpression: where },
      )
      subscription.setOrderByIndex(index)
      subscription.on(`loadSubset:error`, () => {
        subscription.requestSnapshot({ where: whereX, optimizedOnly: false })
        errorObservations.push([...visible.keys()].sort())
      })

      try {
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          onLoadSubsetResult: () => {
            callbackCount++
            if (callbackCount !== 2) return
            subscription.releaseSnapshot(where)
            subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
          },
        })
        await flushPromises()
        begin()
        truncate()
        commit()
        await flushPromises()

        if (replacementResult === `resolve`) {
          replacement.resolve({ hasMore: false, appliedRowKeys: [`y`] })
        } else if (replacementResult === `reject`) {
          replacement.reject(new Error(`replacement failed`))
        }
        await flushPromises()

        if (replacementResult === `return` || replacementResult === `resolve`) {
          expect(errorObservations).toEqual([])
          expect([...visible.keys()]).toEqual([`y`])
          expect(subscription.orderedBoundaryKey).toBe(`y`)

          begin()
          write({ type: `insert`, value: { id: `z`, rank: 0 } })
          commit()
          await flushPromises()
          expect([...visible.keys()]).toEqual([`z`])
          expect(subscription.orderedBoundaryKey).toBe(`z`)
        } else {
          expect(errorObservations).toEqual([[`x`]])
          expect([...visible.keys()]).toEqual([`x`])
        }
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`unordered`, `ordered`] as const).flatMap((demandKind) =>
      ([`error`, `nan`, `non-latest`] as const).map(
        (failureValue) => [demandKind, failureValue] as const,
      ),
    ),
  )(
    `reports one error when a callback-created start failure propagates: %s %s`,
    async (demandKind, failureValue) => {
      type Row = { id: string; rank: number; version: number }
      const whereOuter = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
      const whereNested = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`nested`),
      ])
      const whereNestedSecond = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`nested-second`),
      ])
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const startError: unknown =
        failureValue === `nan`
          ? Number.NaN
          : new Error(`callback-created start failed`)
      const secondStartError = new Error(`second callback-created start failed`)
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, string>,
      ) => void
      let commit!: (signal?: AbortSignal) => true | Promise<void>
      let truncate!: () => void
      let outerLoadCount = 0
      let callbackCount = 0
      const nestedOptions: Array<LoadSubsetOptions> = []
      const collection = createCollection<Row>({
        id: `propagated-callback-start-failure-${demandKind}-${failureValue}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                if (sameWhere(options.where, whereNested)) {
                  nestedOptions.push(options)
                  throw startError
                }
                if (sameWhere(options.where, whereNestedSecond)) {
                  nestedOptions.push(options)
                  throw secondStartError
                }
                outerLoadCount++
                begin()
                write({
                  type: `insert`,
                  value: { id: `a`, rank: 1, version: outerLoadCount },
                })
                commit(options.signal)
                return outerLoadCount === 1 ? Promise.resolve() : true
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const visible = new Map<string, Row>()
      const errors: Array<{ error: unknown; options: LoadSubsetOptions }> = []
      const subscription = collection.subscribeChanges((changes) => {
        for (const change of changes) {
          const key = String(change.key)
          if (change.type === `delete`) visible.delete(key)
          else visible.set(key, change.value)
        }
      })
      subscription.setOrderByIndex(index)
      subscription.on(`loadSubset:error`, ({ error, options }) =>
        errors.push({ error, options }),
      )
      const onLoadSubsetResult = () => {
        callbackCount++
        if (callbackCount !== 2) return
        if (failureValue !== `non-latest`) {
          subscription.requestSnapshot({ where: whereNested })
          return
        }
        let propagatedStartFailure: unknown
        try {
          subscription.requestSnapshot({ where: whereNested })
        } catch (error) {
          propagatedStartFailure = error
        }
        try {
          subscription.requestSnapshot({ where: whereNestedSecond })
        } catch {
          // Both attributed failures remain attached to their own options.
        }
        throw propagatedStartFailure
      }

      try {
        if (demandKind === `ordered`) {
          subscription.requestLimitedSnapshot({
            orderBy,
            limit: 1,
            onLoadSubsetResult,
          })
        } else {
          subscription.requestSnapshot({
            where: whereOuter,
            onLoadSubsetResult,
          })
        }
        await flushPromises()
        expect(visible.get(`a`)?.version).toBe(1)

        begin()
        truncate()
        commit()
        await flushPromises()

        const expectedErrors =
          failureValue === `non-latest`
            ? [startError, secondStartError]
            : [startError]
        expect(errors).toHaveLength(expectedErrors.length)
        for (const [observationIndex, error] of expectedErrors.entries()) {
          expect(Object.is(errors[observationIndex]?.error, error)).toBe(true)
          expect(errors[observationIndex]?.options).toBe(
            nestedOptions[observationIndex],
          )
        }
        expect(subscription.status).toBe(`ready`)
        expect(visible.get(`a`)?.version).toBe(1)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    (
      [`ordinary`, `cleanup`, `replay-entry`, `replay-callback`] as const
    ).flatMap((originContext) =>
      ([`sync`, `async`] as const).map(
        (propagation) => [originContext, propagation] as const,
      ),
    ),
  )(
    `reports one originating failure through recursive %s starts: %s`,
    async (originContext, propagation) => {
      type Row = { id: string }
      const whereOuter = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
      const whereMiddle = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`middle`),
      ])
      const whereInner = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`inner`),
      ])
      const failure = new Error(`recursive callback-created start failed`)
      const errors: Array<{ error: unknown; options: LoadSubsetOptions }> = []
      let begin!: () => void
      let commit!: () => true | Promise<void>
      let truncate!: () => void
      let callbackCount = 0
      let outerLoadCount = 0
      let innerOptions: LoadSubsetOptions | undefined
      const collection = createCollection<Row>({
        id: `recursive-start-failure-${originContext}-${propagation}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                if (sameWhere(options.where, whereInner)) {
                  innerOptions = options
                  throw failure
                }
                if (sameWhere(options.where, whereOuter)) {
                  outerLoadCount++
                  if (
                    originContext === `replay-entry` &&
                    outerLoadCount === 2
                  ) {
                    if (propagation === `async`) {
                      return (async () => {
                        requestInner()
                        await Promise.resolve()
                      })()
                    }
                    requestInner()
                  }
                }
                if (sameWhere(options.where, whereMiddle)) {
                  if (propagation === `async`) {
                    return (async () => {
                      requestInner()
                      await Promise.resolve()
                    })()
                  }
                  requestInner()
                }
                return true
              },
              unloadSubset: (options) => {
                if (
                  originContext === `cleanup` &&
                  sameWhere(options.where, whereOuter)
                ) {
                  requestMiddle()
                }
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {})
      const requestInner = () =>
        subscription.requestSnapshot({ where: whereInner })
      const requestMiddle = () =>
        subscription.requestSnapshot({ where: whereMiddle })
      subscription.on(`loadSubset:error`, ({ error, options }) => {
        errors.push({ error, options })
      })

      try {
        let thrown: unknown
        try {
          if (originContext === `ordinary`) {
            requestMiddle()
          } else if (originContext === `cleanup`) {
            subscription.requestSnapshot({ where: whereOuter })
            subscription.releaseSnapshot(whereOuter)
          } else {
            subscription.requestSnapshot({
              where: whereOuter,
              onLoadSubsetResult: () => {
                callbackCount++
                if (
                  originContext === `replay-callback` &&
                  callbackCount === 2
                ) {
                  requestMiddle()
                }
              },
            })
            begin()
            truncate()
            commit()
          }
        } catch (error) {
          thrown = error
        }
        await flushPromises()

        if (
          originContext === `cleanup` ||
          (originContext === `ordinary` && propagation === `sync`)
        ) {
          expect(Object.is(thrown, failure)).toBe(true)
        } else {
          expect(thrown).toBeUndefined()
        }
        expect(errors).toEqual([{ error: failure, options: innerOptions }])
        expect(subscription.lastError).toBe(failure)
        expect(subscription.lastErrorVersion).toBe(1)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`unordered`, `ordered`] as const).flatMap((demandKind) =>
      (
        [
          `distinct-error`,
          `shared-error`,
          `undefined`,
          `nan`,
          `string`,
        ] as const
      ).map((failureValues) => [demandKind, failureValues] as const),
    ),
  )(
    `attributes nested start and exact cleanup as separate callback failures: %s %s`,
    async (demandKind, failureValues) => {
      type Row = { id: string; rank: number; version: number }
      const whereOuter = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
      const whereNested = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`nested`),
      ])
      const whereCleanup = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`cleanup`),
      ])
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const startError: unknown =
        failureValues === `undefined`
          ? undefined
          : failureValues === `nan`
            ? Number.NaN
            : failureValues === `string`
              ? `shared failure`
              : new Error(`nested start failed`)
      const cleanupError: unknown =
        failureValues === `distinct-error`
          ? new Error(`exact cleanup failed`)
          : startError
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, string>,
      ) => void
      let commit!: (signal?: AbortSignal) => true | Promise<void>
      let truncate!: () => void
      let outerLoadCount = 0
      let callbackCount = 0
      let cleanupArmed = false
      let cleanupThrowCount = 0
      let nestedOptions: LoadSubsetOptions | undefined
      let cleanupOptions: LoadSubsetOptions | undefined
      const collection = createCollection<Row>({
        id: `callback-failure-occurrence-${demandKind}-${failureValues}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                if (sameWhere(options.where, whereNested)) {
                  nestedOptions = options
                  throw startError
                }
                if (
                  sameWhere(options.where, whereOuter) ||
                  options.orderBy !== undefined
                ) {
                  outerLoadCount++
                  begin()
                  write({
                    type: `insert`,
                    value: {
                      id: `a`,
                      rank: 1,
                      version: outerLoadCount,
                    },
                  })
                  commit(options.signal)
                }
                return true
              },
              unloadSubset: (options) => {
                if (
                  cleanupArmed &&
                  sameWhere(options.where, whereCleanup) &&
                  cleanupThrowCount === 0
                ) {
                  cleanupThrowCount++
                  cleanupOptions = options
                  throw cleanupError
                }
              },
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const visible = new Map<string, Row>()
      const errors: Array<{ error: unknown; options: LoadSubsetOptions }> = []
      const subscription = collection.subscribeChanges((changes) => {
        for (const change of changes) {
          const key = String(change.key)
          if (change.type === `delete`) visible.delete(key)
          else visible.set(key, change.value)
        }
      })
      subscription.setOrderByIndex(index)
      subscription.on(`loadSubset:error`, ({ error, options }) =>
        errors.push({ error, options }),
      )

      const onLoadSubsetResult = () => {
        callbackCount++
        if (callbackCount !== 2) return
        try {
          subscription.requestSnapshot({ where: whereNested })
        } catch {
          // The callback frame retains the attributed start failure while the
          // later cleanup supplies the propagated boundary token.
        }
        cleanupArmed = true
        subscription.releaseSnapshot(whereCleanup)
      }

      try {
        subscription.requestSnapshot({ where: whereCleanup })
        if (demandKind === `ordered`) {
          subscription.requestLimitedSnapshot({
            orderBy,
            limit: 1,
            onLoadSubsetResult,
          })
        } else {
          subscription.requestSnapshot({
            where: whereOuter,
            onLoadSubsetResult,
          })
        }
        await flushPromises()
        expect(visible.get(`a`)?.version).toBe(1)

        begin()
        truncate()
        commit()
        await flushPromises()

        expect(errors).toHaveLength(2)
        expect(Object.is(errors[0]?.error, startError)).toBe(true)
        expect(errors[0]?.options).toBe(nestedOptions)
        expect(Object.is(errors[1]?.error, cleanupError)).toBe(true)
        expect(errors[1]?.options).toBe(cleanupOptions)
        expect(cleanupThrowCount).toBe(1)
        expect(subscription.status).toBe(`ready`)
        expect(visible.get(`a`)?.version).toBe(1)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`unordered`, `ordered`] as const).flatMap((demandKind) =>
      ([`distinct`, `shared`] as const).map(
        (failureValues) => [demandKind, failureValues] as const,
      ),
    ),
  )(
    `reports every acquisition cleanup failure from one replay callback release: %s %s`,
    async (demandKind, failureValues) => {
      type Row = { id: string; rank: number; version: number }
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const replay = createDeferred<void>()
      const sharedFailure = new Error(`shared cleanup failure`)
      const replayFailure =
        failureValues === `shared`
          ? sharedFailure
          : new Error(`replay cleanup failed`)
      const initialFailure =
        failureValues === `shared`
          ? sharedFailure
          : new Error(`initial cleanup failed`)
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, string>,
      ) => void
      let commit!: (signal?: AbortSignal) => true | Promise<void>
      let truncate!: () => void
      let loadCount = 0
      let callbackCount = 0
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const failedOnce = new Set<LoadSubsetOptions>()
      const collection = createCollection<Row>({
        id: `multi-cleanup-callback-${demandKind}-${failureValues}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                loadCount++
                if (loadCount === 1) {
                  begin()
                  write({
                    type: `insert`,
                    value: { id: `a`, rank: 1, version: 1 },
                  })
                  commit(options.signal)
                  return Promise.resolve()
                }
                return replay.promise
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (failedOnce.has(options)) return
                failedOnce.add(options)
                if (options === loads[1]) throw replayFailure
                if (options === loads[0]) throw initialFailure
              },
            }
          },
        },
      })
      const visible = new Map<string, Row>()
      const errorObservations: Array<{
        error: unknown
        options: LoadSubsetOptions
        visibleVersion: number | undefined
      }> = []
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            const key = String(change.key)
            if (change.type === `delete`) visible.delete(key)
            else visible.set(key, change.value)
          }
        },
        { whereExpression: where },
      )
      subscription.on(`loadSubset:error`, ({ error, options }) => {
        errorObservations.push({
          error,
          options,
          visibleVersion: visible.get(`a`)?.version,
        })
      })
      if (demandKind === `ordered`) {
        const index = collection.createIndex((row) => row.rank, {
          indexType: BTreeIndex,
        })
        subscription.setOrderByIndex(index)
      }
      const onLoadSubsetResult = () => {
        callbackCount++
        if (callbackCount === 2) subscription.releaseSnapshot(where)
      }

      try {
        if (demandKind === `ordered`) {
          subscription.requestLimitedSnapshot({
            orderBy,
            limit: 1,
            onLoadSubsetResult,
          })
        } else {
          subscription.requestSnapshot({ where, onLoadSubsetResult })
        }
        await flushPromises()
        expect(visible.get(`a`)?.version).toBe(1)

        begin()
        truncate()
        commit()
        await flushPromises()
        replay.resolve()
        await flushPromises()
        await flushPromises()

        expect(errorObservations).toHaveLength(2)
        expect(Object.is(errorObservations[0]?.error, replayFailure)).toBe(true)
        expect(errorObservations[0]?.options).toBe(loads[1])
        expect(Object.is(errorObservations[1]?.error, initialFailure)).toBe(
          true,
        )
        expect(errorObservations[1]?.options).toBe(loads[0])
        const finalVisibleVersion = visible.get(`a`)?.version
        expect(
          errorObservations.map(({ visibleVersion }) => visibleVersion),
        ).toEqual([finalVisibleVersion, finalVisibleVersion])
        expect(subscription.status).toBe(`ready`)

        subscription.unsubscribe()
        expect(unloads.filter((options) => options === loads[1])).toHaveLength(
          2,
        )
        expect(unloads.filter((options) => options === loads[0])).toHaveLength(
          2,
        )
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`distinct`, `shared`, `undefined`] as const)(
    `aggregates every public unsubscribe cleanup failure and retries exact acquisitions: %s`,
    async (failureValues) => {
      type Row = { id: string }
      const whereA = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
      const whereB = new Func(`eq`, [new PropRef([`id`]), new Value(`b`)])
      const sharedFailure = new Error(`shared unsubscribe failure`)
      const failures: ReadonlyArray<unknown> =
        failureValues === `undefined`
          ? [undefined, undefined]
          : failureValues === `shared`
            ? [sharedFailure, sharedFailure]
            : [
                new Error(`first unsubscribe failure`),
                new Error(`second unsubscribe failure`),
              ]
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const failedOnce = new Set<LoadSubsetOptions>()
      const collection = createCollection<Row>({
        id: `aggregate-unsubscribe-cleanup-${failureValues}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (failedOnce.has(options)) return
                failedOnce.add(options)
                const index = loads.indexOf(options)
                if (index !== -1) throw failures[index]
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {})

      try {
        subscription.requestSnapshot({ where: whereA })
        subscription.requestSnapshot({ where: whereB })
        expect(loads).toHaveLength(2)

        let didThrow = false
        let thrownValue: unknown
        try {
          subscription.unsubscribe()
        } catch (error) {
          didThrow = true
          thrownValue = error
        }

        expect(didThrow).toBe(true)
        expect(thrownValue).toBeInstanceOf(AggregateError)
        const aggregateErrors = (thrownValue as AggregateError).errors
        expect(aggregateErrors).toHaveLength(2)
        expect(Object.is(aggregateErrors[0], failures[0])).toBe(true)
        expect(Object.is(aggregateErrors[1], failures[1])).toBe(true)
        expect(unloads).toEqual(loads)

        expect(() => subscription.unsubscribe()).not.toThrow()
        expect(unloads).toEqual([...loads, ...loads])
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`surfaces undefined teardown failure and retries its exact cleanup`, async () => {
    type Row = { id: string }
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    let loadedOptions: LoadSubsetOptions | undefined
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<Row>({
      id: `undefined-teardown-failure`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: (options) => {
              loadedOptions = options
              return true
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (unloads.length === 1) throw undefined
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})

    try {
      subscription.requestSnapshot({ where })
      let didThrow = false
      let thrownValue: unknown = Symbol(`not thrown`)
      try {
        subscription.unsubscribe()
      } catch (error) {
        didThrow = true
        thrownValue = error
      }

      expect(didThrow).toBe(true)
      expect(thrownValue).toBeUndefined()
      expect(unloads).toHaveLength(1)
      expect(unloads[0]).toBe(loadedOptions)

      expect(() => subscription.unsubscribe()).not.toThrow()
      expect(unloads).toHaveLength(2)
      expect(unloads[1]).toBe(loadedOptions)
    } finally {
      await collection.cleanup()
    }
  })

  it.each(
    ([`unordered`, `ordered`] as const).flatMap((demandKind) =>
      ([`resolve`, `reject`] as const).flatMap((settlement) =>
        ([`succeed`, `throw`] as const).map(
          (cleanup) => [demandKind, settlement, cleanup] as const,
        ),
      ),
    ),
  )(
    `keeps a self-released callback demand in the replay barrier: %s %s %s`,
    async (demandKind, settlement, cleanup) => {
      type Row = { id: string; value: number }
      const subscriptionWhere = new Func(`gte`, [
        new PropRef([`value`]),
        new Value(0),
      ])
      const whereA = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
      const whereB = new Func(`eq`, [new PropRef([`id`]), new Value(`b`)])
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`value`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const callbackDemand = createDeferred<void>()
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, string>,
      ) => void
      let commit!: (signal?: AbortSignal) => true | Promise<void>
      let truncate!: () => void
      let replaying = false
      let originalResultCount = 0
      let callbackDemandOptions: LoadSubsetOptions | undefined
      let cleanupFailuresRemaining = cleanup === `throw` ? 1 : 0
      const cleanupError = new Error(`callback cleanup failed`)
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const collection = createCollection<Row>({
        id: `self-released-callback-demand-${demandKind}-${settlement}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (loads.length === 3) {
                  callbackDemandOptions = options
                  return callbackDemand.promise
                }
                begin()
                write({ type: `insert`, value: { id: `a`, value: 1 } })
                commit(options.signal)
                return replaying ? true : Promise.resolve()
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (
                  options === callbackDemandOptions &&
                  cleanupFailuresRemaining > 0
                ) {
                  cleanupFailuresRemaining--
                  throw cleanupError
                }
              },
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.value, {
        indexType: BTreeIndex,
      })
      const visible = new Map<string, Row>()
      const errors: Array<unknown> = []
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            const key = String(change.key)
            if (change.type === `delete`) visible.delete(key)
            else visible.set(key, change.value)
          }
        },
        { whereExpression: subscriptionWhere },
      )
      subscription.setOrderByIndex(index)
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))

      try {
        subscription.requestSnapshot({
          where: whereA,
          optimizedOnly: false,
          onLoadSubsetResult: () => {
            originalResultCount++
            if (originalResultCount !== 2) return
            if (demandKind === `ordered`) {
              subscription.requestLimitedSnapshot({
                orderBy,
                limit: 1,
                onLoadSubsetResult: () =>
                  subscription.releaseSnapshot(subscriptionWhere),
              })
            } else {
              subscription.requestSnapshot({
                where: whereB,
                optimizedOnly: false,
                onLoadSubsetResult: () => subscription.releaseSnapshot(whereB),
              })
            }
          },
        })
        await flushPromises()

        replaying = true
        begin()
        truncate()
        commit()
        await flushPromises()

        expect(callbackDemandOptions?.signal?.aborted).toBe(true)
        expect(subscription.status).toBe(`loadingSubset`)
        expect([...visible.keys()]).toEqual([`a`])

        begin()
        write({ type: `insert`, value: { id: `z`, value: 3 } })
        commit()
        await flushPromises()
        expect([...visible.keys()]).toEqual([`a`])

        if (settlement === `resolve`) callbackDemand.resolve()
        else callbackDemand.reject(new Error(`released callback demand`))
        await flushPromises()

        expect(subscription.status).toBe(`ready`)
        expect([...visible.keys()]).toEqual([`a`])
        expect(errors).toEqual(cleanup === `throw` ? [cleanupError] : [])
        expect(
          unloads.filter((options) => options === callbackDemandOptions),
        ).toHaveLength(1)

        begin()
        write({ type: `insert`, value: { id: `w`, value: 4 } })
        commit()
        await flushPromises()
        expect([...visible.keys()].sort()).toEqual([`a`, `w`])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`succeed`, `throw`] as const)(
    `binds an overlapping callback cleanup error to its originating replay: %s`,
    async (cleanup) => {
      type Row = { id: string; value: number }
      const whereA = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
      const whereC = new Func(`eq`, [new PropRef([`id`]), new Value(`c`)])
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, string>,
      ) => void
      let commit!: (signal?: AbortSignal) => true | Promise<void>
      let truncate!: () => void
      let originalCallbackCount = 0
      let callbackDemandOptions: LoadSubsetOptions | undefined
      let cleanupFailuresRemaining = cleanup === `throw` ? 1 : 0
      const cleanupError = new Error(`overlapped callback cleanup failed`)
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const collection = createCollection<Row>({
        id: `overlapping-callback-cleanup-${cleanup}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (loads.length === 1) {
                  begin()
                  write({ type: `insert`, value: { id: `a`, value: 1 } })
                  commit(options.signal)
                  return Promise.resolve()
                }
                if (loads.length === 2) return true
                if (loads.length === 3) {
                  callbackDemandOptions = options
                  return true
                }

                begin()
                write({ type: `insert`, value: { id: `a`, value: 2 } })
                commit(options.signal)
                return true
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (
                  options === callbackDemandOptions &&
                  cleanupFailuresRemaining > 0
                ) {
                  cleanupFailuresRemaining--
                  throw cleanupError
                }
              },
            }
          },
        },
      })
      const visible = new Map<string, Row>()
      const errors: Array<unknown> = []
      const errorObservations: Array<ReadonlyArray<[string, number]>> = []
      const subscription = collection.subscribeChanges((changes) => {
        for (const change of changes) {
          const key = String(change.key)
          if (change.type === `delete`) visible.delete(key)
          else visible.set(key, change.value)
        }
      })
      subscription.on(`loadSubset:error`, ({ error }) => {
        errors.push(error)
        errorObservations.push(
          [...visible].map(([key, row]) => [key, row.value] as const),
        )
      })

      try {
        subscription.requestSnapshot({
          where: whereA,
          onLoadSubsetResult: () => {
            originalCallbackCount++
            if (originalCallbackCount !== 2) return
            subscription.requestSnapshot({
              where: whereC,
              onLoadSubsetResult: () => {
                // This overlapping replay becomes current before cleanup of
                // the callback-created demand can fail. The failure still
                // belongs to the replay that enrolled that demand.
                begin()
                truncate()
                commit()
                subscription.releaseSnapshot(whereC)
              },
            })
          },
        })
        await flushPromises()
        expect([...visible.keys()]).toEqual([`a`])
        expect(visible.get(`a`)?.value).toBe(1)

        begin()
        truncate()
        commit()
        await flushPromises()
        await flushPromises()

        expect(subscription.status).toBe(`ready`)
        expect([...visible.keys()]).toEqual([`a`])
        expect(visible.get(`a`)?.value).toBe(2)
        expect(errors).toEqual(cleanup === `throw` ? [cleanupError] : [])
        expect(errorObservations).toEqual(
          cleanup === `throw` ? [[[`a`, 2]]] : [],
        )
        expect(callbackDemandOptions?.signal?.aborted).toBe(true)
        expect(
          unloads.filter((options) => options === callbackDemandOptions),
        ).toHaveLength(1)

        if (cleanup === `throw`) {
          subscription.releaseSnapshot(whereC)
          subscription.releaseSnapshot(whereC)
          expect(
            unloads.filter((options) => options === callbackDemandOptions),
          ).toHaveLength(2)
        }
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`sync`, `async`] as const).flatMap((settlement) =>
      (
        [`none`, `cleanup-succeed`, `cleanup-throw`, `callback-throw`] as const
      ).map((callback) => [settlement, callback] as const),
    ),
  )(
    `settles a post-setup ordered continuation callback before publication: %s %s`,
    async (settlement, callback) => {
      type Row = {
        id: `a` | `b`
        rank: number
        version: number
      }
      type Outcome = {
        hasMore: boolean
        appliedRowKeys: ReadonlyArray<Row[`id`]>
      }
      const where = new Func(`gte`, [new PropRef([`rank`]), new Value(0)])
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const replayPage = createDeferred<Outcome>()
      const callbackError = new Error(`continuation callback failed`)
      const cleanupError = new Error(`continuation cleanup failed`)
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
      ) => void
      let commit!: (signal?: AbortSignal) => true | Promise<void>
      let truncate!: () => void
      let loadCount = 0
      let initialCallbackCount = 0
      let continuationOptions: LoadSubsetOptions | undefined
      let cleanupFailuresRemaining = callback === `cleanup-throw` ? 1 : 0
      let escapedCallbackError: unknown
      const unloads: Array<LoadSubsetOptions> = []
      const collection = createCollection<Row>({
        id: `post-setup-continuation-${settlement}-${callback}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                loadCount++
                begin()
                if (loadCount === 1) {
                  write({
                    type: `insert`,
                    value: { id: `a`, rank: 1, version: 1 },
                  })
                  write({
                    type: `insert`,
                    value: { id: `b`, rank: 2, version: 1 },
                  })
                  commit(options.signal)
                  return Promise.resolve({
                    hasMore: false,
                    appliedRowKeys: [`a`, `b`] as const,
                  })
                }
                if (loadCount === 2) {
                  write({
                    type: `insert`,
                    value: { id: `a`, rank: 1, version: 2 },
                  })
                  commit(options.signal)
                  return replayPage.promise
                }

                continuationOptions = options
                write({
                  type: `insert`,
                  value: { id: `b`, rank: 2, version: 2 },
                })
                commit(options.signal)
                return settlement === `sync` ? true : Promise.resolve()
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (
                  options === continuationOptions &&
                  cleanupFailuresRemaining > 0
                ) {
                  cleanupFailuresRemaining--
                  throw cleanupError
                }
              },
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const visible = new Map<Row[`id`], Row>()
      const errors: Array<unknown> = []
      const errorObservations: Array<ReadonlyArray<string>> = []
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            const key = change.key as Row[`id`]
            if (change.type === `delete`) visible.delete(key)
            else visible.set(key, change.value)
          }
        },
        { whereExpression: where },
      )
      subscription.setOrderByIndex(index)
      subscription.on(`loadSubset:error`, ({ error }) => {
        errors.push(error)
        errorObservations.push(
          [...visible.values()].map((row) => `${row.id}@${row.version}`),
        )
      })

      try {
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 2,
          onLoadSubsetResult: (result) => {
            initialCallbackCount++
            if (initialCallbackCount !== 2 || !(result instanceof Promise)) {
              return
            }
            void result.then(() => {
              try {
                subscription.requestLimitedSnapshot({
                  orderBy,
                  limit: 2,
                  onLoadSubsetResult: (_result, options) => {
                    if (callback === `callback-throw`) throw callbackError
                    if (callback.startsWith(`cleanup-`)) {
                      subscription.releaseSnapshot(where, options.signal)
                    }
                  },
                })
              } catch (error) {
                escapedCallbackError = error
              }
            })
          },
        })
        await flushPromises()
        expect(
          [...visible.values()].map((row) => `${row.id}@${row.version}`),
        ).toEqual([`a@1`, `b@1`])

        begin()
        truncate()
        commit()
        await flushPromises()
        replayPage.resolve({ hasMore: true, appliedRowKeys: [`a`] })
        await flushPromises()
        await flushPromises()

        const publishesReplacement =
          callback === `none` ||
          (callback === `cleanup-succeed` && settlement === `sync`)
        expect(subscription.status).toBe(`ready`)
        expect(escapedCallbackError).toBeUndefined()
        expect(
          [...visible.values()].map((row) => `${row.id}@${row.version}`),
        ).toEqual(publishesReplacement ? [`a@2`, `b@2`] : [`a@1`, `b@1`])
        const expectedError =
          callback === `cleanup-throw`
            ? cleanupError
            : callback === `callback-throw`
              ? callbackError
              : undefined
        expect(errors).toEqual(expectedError ? [expectedError] : [])
        expect(errorObservations).toEqual(expectedError ? [[`a@1`, `b@1`]] : [])

        if (callback.startsWith(`cleanup-`)) {
          expect(continuationOptions?.signal?.aborted).toBe(true)
          expect(
            unloads.filter((options) => options === continuationOptions),
          ).toHaveLength(1)
        }
        if (callback === `cleanup-throw`) {
          subscription.releaseSnapshot(where, continuationOptions?.signal)
          subscription.releaseSnapshot(where, continuationOptions?.signal)
          expect(
            unloads.filter((options) => options === continuationOptions),
          ).toHaveLength(2)
        }
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`revokes ordered authority when an additional demand replaces a candidate version`, async () => {
    type Row = { id: `a` | `x`; rank: number }
    type Outcome = {
      hasMore: boolean
      appliedRowKeys: ReadonlyArray<Row[`id`]>
    }
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
    ) => void
    let commit!: (signal?: AbortSignal) => true | Promise<void>
    let truncate!: () => void
    let loadCount = 0
    let loadingAdditional = false
    let physicalOptions: LoadSubsetOptions | undefined
    const loadOptions: Array<LoadSubsetOptions> = []
    const replayLoads: Array<ReturnType<typeof createDeferred<Outcome>>> = []
    const additionalLoad = createDeferred<Outcome>()
    const deduplicatedLoad = new DeduplicatedLoadSubset({
      loadSubset: (options) => {
        physicalOptions = options
        return additionalLoad.promise
      },
    })
    const collection = createCollection<Row>({
      id: `failed-ordered-candidate-replacement`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loadOptions.push(options)
              if (loadingAdditional) return deduplicatedLoad.loadSubset(options)
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `a`, rank: 1 } })
                commit()
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [`a`] as const,
                })
              }
              if (loadCount === 2) {
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [] as const,
                })
              }
              const deferred = createDeferred<Outcome>()
              replayLoads.push(deferred)
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const orderedWhere = new Func(`gte`, [
      new PropRef([`rank`]),
      new Value(-1_000),
    ])
    const seedSiblingWhere = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`x`),
    ])
    const sameKeyWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const visible = new Map<Row[`id`], Row>()
    const visibleRows = () =>
      [...visible.values()].map(({ id, rank }) => ({ id, rank }))
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          const key = change.key as Row[`id`]
          if (change.type === `delete`) visible.delete(key)
          else visible.set(key, change.value)
        }
      },
      { whereExpression: orderedWhere },
    )
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      subscription.requestSnapshot({ where: seedSiblingWhere })
      await flushPromises()

      begin()
      truncate()
      commit()
      await flushPromises()
      expect(replayLoads).toHaveLength(2)

      begin()
      write({ type: `insert`, value: { id: `x`, rank: 0 } })
      commit()
      replayLoads[0]?.resolve({ hasMore: false, appliedRowKeys: [`x`] })
      replayLoads[1]?.reject(new Error(`sibling replay failed`))
      await flushPromises()
      expect(visibleRows()).toEqual([{ id: `a`, rank: 1 }])

      subscription.releaseSnapshot(seedSiblingWhere)
      loadingAdditional = true
      subscription.requestSnapshot({ where: sameKeyWhere })
      await flushPromises()

      begin()
      write({ type: `update`, value: { id: `a`, rank: 100 } })
      const receipt = commit(physicalOptions?.signal)
      if (receipt !== true) await receipt
      additionalLoad.resolve({ hasMore: false, appliedRowKeys: [`a`] })
      await flushPromises()

      expect(visibleRows()).toEqual([{ id: `a`, rank: 100 }])
      expect(subscription.orderedBoundaryKey).toBeUndefined()

      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()
      expect(loadOptions.at(-1)).toMatchObject({ offset: 0 })
      expect(loadOptions.at(-1)?.cursor).toBeUndefined()

      subscription.releaseSnapshot(sameKeyWhere)
      expect(visibleRows()).toEqual([])
      expect(subscription.orderedBoundaryKey).toBeUndefined()
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`compiles an additional-demand predicate once per logical demand`, async () => {
    type Row = { id: string; rank: number }
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
    ) => void
    let commit!: () => void
    const collection = createCollection<Row>({
      id: `additional-demand-predicate-compilation`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          params.markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {},
          }
        },
      },
    })
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    let expressionReads = 0
    // Compilation reads the IR node type; the compiled evaluator does not.
    // Count those reads without exposing test instrumentation in production.
    const expression = new Proxy(
      new Func<boolean>(`eq`, [new PropRef([`id`]), new Value(`sibling`)]),
      {
        get(target, property, receiver) {
          if (property === `type`) expressionReads++
          return Reflect.get(target, property, receiver)
        },
      },
    )
    const subscription = collection.subscribeChanges(() => {})
    subscription.setOrderByIndex(index)

    const publish = (value: Row) => {
      begin()
      write({ type: `insert`, value })
      commit()
    }

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      subscription.requestSnapshot({ where: expression })
      const firstDemandReads = expressionReads
      expect(firstDemandReads).toBeGreaterThan(0)

      publish({ id: `sibling`, rank: 2 })
      publish({ id: `ordered`, rank: 1 })
      expect(expressionReads).toBe(firstDemandReads)

      subscription.releaseSnapshot(expression)
      const beforeReplacement = expressionReads
      subscription.requestSnapshot({ where: expression })
      expect(expressionReads).toBeGreaterThan(beforeReplacement)
      const replacementDemandReads = expressionReads

      publish({ id: `later`, rank: 0 })
      expect(expressionReads).toBe(replacementDemandReads)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`snapshots a logical demand before caller-owned predicate mutation`, async () => {
    type Row = { id: `a` | `b`; other: `a` | `b` }
    type Outcome = {
      hasMore: false
      appliedRowKeys: ReadonlyArray<Row[`id`]>
    }
    const rows: ReadonlyArray<Row> = [
      { id: `a`, other: `b` },
      { id: `b`, other: `a` },
    ]
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
    ) => void
    let commit!: (signal?: AbortSignal) => true | Promise<void>
    let truncate!: () => void
    const replay = createDeferred<Outcome>()
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<Row>({
      id: `logical-demand-predicate-snapshot`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          begin()
          for (const row of rows) write({ type: `insert`, value: row })
          commit()
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (loads.length === 1) {
                // Adapter code owns only this acquisition copy. Mutating it
                // must not rewrite the private demand used by later replay.
                ;((options.where as Func).args[0] as PropRef).path[0] = `other`
                return true
              }
              return replay.promise
            },
            unloadSubset: (options) => {
              unloads.push(options)
            },
          }
        },
      },
    })
    const visible = new Map<Row[`id`], Row>()
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        const key = change.key as Row[`id`]
        if (change.type === `delete`) visible.delete(key)
        else visible.set(key, change.value)
      }
    })
    const ref = new PropRef([`id`])
    const where = new Func<boolean>(`eq`, [ref, new Value(`a`)])

    try {
      subscription.requestSnapshot({ where })
      expect([...visible.keys()]).toEqual([`a`])

      ref.path[0] = `other`
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(loads).toHaveLength(2)

      begin()
      for (const row of rows) write({ type: `insert`, value: row })
      const receipt = commit(loads[1]?.signal)
      if (receipt !== true) await receipt
      replay.resolve({ hasMore: false, appliedRowKeys: [`a`, `b`] })
      await flushPromises()

      expect(((loads[1]?.where as Func).args[0] as PropRef).path).toEqual([
        `id`,
      ])
      expect([...visible.keys()]).toEqual([`a`])

      subscription.releaseSnapshot(where)
      expect(unloads.at(-1)).toBe(loads[1])
    } finally {
      replay.resolve({ hasMore: false, appliedRowKeys: [] })
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`snapshots mutable values beneath output-producing predicate functions`, async () => {
    type Row = { id: `row` }
    type Outcome = {
      hasMore: false
      appliedRowKeys: ReadonlyArray<Row[`id`]>
    }
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
    ) => void
    let commit!: (signal?: AbortSignal) => true | Promise<void>
    let truncate!: () => void
    const replay = createDeferred<Outcome>()
    const loads: Array<LoadSubsetOptions> = []
    const collection = createCollection<Row>({
      id: `logical-demand-value-snapshot`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          begin()
          write({ type: `insert`, value: { id: `row` } })
          commit()
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return loads.length === 1 ? true : replay.promise
            },
          }
        },
      },
    })
    const visible = new Map<Row[`id`], Row>()
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        const key = change.key as Row[`id`]
        if (change.type === `delete`) visible.delete(key)
        else visible.set(key, change.value)
      }
    })
    const bytes = Buffer.from([65])
    const where = new Func<boolean>(`eq`, [
      new Func(`concat`, [new Value(bytes)]),
      new Value(`A`),
    ])

    try {
      subscription.requestSnapshot({ where })
      expect([...visible.keys()]).toEqual([`row`])

      bytes[0] = 66
      begin()
      truncate()
      commit()
      await flushPromises()

      begin()
      write({ type: `insert`, value: { id: `row` } })
      const receipt = commit(loads[1]?.signal)
      if (receipt !== true) await receipt
      replay.resolve({ hasMore: false, appliedRowKeys: [`row`] })
      await flushPromises()

      expect([...visible.keys()]).toEqual([`row`])
    } finally {
      replay.resolve({ hasMore: false, appliedRowKeys: [] })
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([`reference-path`, `direction`] as const)(
    `snapshots ordered demand state before %s mutation`,
    async (mutation) => {
      type Row = {
        id: `a` | `b`
        rank: number
        other: number
        version: number
      }
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
      ) => void
      let commit!: () => void
      const collection = createCollection<Row>({
        id: `ordered-demand-snapshot-${mutation}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            begin()
            write({
              type: `insert`,
              value: { id: `a`, rank: 1, other: 2, version: 0 },
            })
            write({
              type: `insert`,
              value: { id: `b`, rank: 2, other: 1, version: 0 },
            })
            commit()
            params.markReady()
            return { loadSubset: () => true }
          },
        },
      })
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const orderRef = new PropRef<number>([`rank`])
      const compareOptions: OrderBy[number][`compareOptions`] = {
        direction: `asc`,
        nulls: `first`,
        stringSort: `lexical`,
      }
      const orderBy: OrderBy = [{ expression: orderRef, compareOptions }]
      const visible = new Map<Row[`id`], Row>()
      const subscription = collection.subscribeChanges((changes) => {
        for (const change of changes) {
          const key = change.key as Row[`id`]
          if (change.type === `delete`) visible.delete(key)
          else visible.set(key, change.value)
        }
      })
      subscription.setOrderByIndex(index)

      try {
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        expect([...visible.keys()]).toEqual([`a`])

        if (mutation === `reference-path`) orderRef.path[0] = `other`
        else compareOptions.direction = `desc`

        begin()
        write({
          type: `update`,
          value: { id: `b`, rank: 2, other: 1, version: 1 },
        })
        commit()

        expect([...visible.keys()]).toEqual([`a`])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`before-first-request`, `after-first-publication`] as const)(
    `keeps one ordered machine when caller state mutates %s`,
    async (timing) => {
      type Row = {
        id: `a` | `b`
        group: `keep` | `drop`
        alternate: `keep` | `drop`
        rank: number
        other: number
      }
      const loads: Array<LoadSubsetOptions> = []
      const collection = createCollection<Row>({
        id: `ordered-machine-${timing}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            params.begin()
            params.write({
              type: `insert`,
              value: {
                id: `a`,
                group: `keep`,
                alternate: `drop`,
                rank: 1,
                other: 2,
              },
            })
            params.write({
              type: `insert`,
              value: {
                id: `b`,
                group: `drop`,
                alternate: `keep`,
                rank: 2,
                other: 1,
              },
            })
            params.commit()
            params.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const whereRef = new PropRef<Row[`group`]>([`group`])
      const where = new Func<boolean>(`eq`, [
        whereRef,
        new Value<Row[`group`]>(`keep`),
      ])
      const orderRef = new PropRef<number>([`rank`])
      const compareOptions: OrderBy[number][`compareOptions`] = {
        direction: `asc`,
        nulls: `first`,
        stringSort: `lexical`,
      }
      const orderBy: OrderBy = [{ expression: orderRef, compareOptions }]
      const visible = new Map<Row[`id`], Row>()
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            const key = change.key as Row[`id`]
            if (change.type === `delete`) visible.delete(key)
            else visible.set(key, change.value)
          }
        },
        { whereExpression: where },
      )
      subscription.setOrderByIndex(index)
      const mutateCallerState = () => {
        whereRef.path[0] = `alternate`
        if (timing === `after-first-publication`) {
          orderRef.path[0] = `other`
          compareOptions.direction = `desc`
        }
      }

      try {
        if (timing === `before-first-request`) mutateCallerState()
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })

        if (timing === `after-first-publication`) {
          expect([...visible.keys()]).toEqual([`a`])
          mutateCallerState()
          subscription.requestLimitedSnapshot({ orderBy, limit: 2 })
        }

        const lastLoad = loads.at(-1)!
        const loadedWhere = lastLoad.where as Func<boolean>
        const loadedOrder = lastLoad.orderBy![0]!
        expect((loadedWhere.args[0] as PropRef).path).toEqual([`group`])
        expect((loadedOrder.expression as PropRef).path).toEqual([`rank`])
        expect(loadedOrder.compareOptions.direction).toBe(`asc`)
        expect([...visible.keys()]).toEqual([`a`])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`rejects unsupported structural demand constants before adapter entry`, async () => {
    type Row = { id: string }
    let loadCount = 0
    const collection = createCollection<Row>({
      id: `unsupported-structural-demand`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: () => {
              loadCount++
              return true
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})
    const value = { [Symbol.toPrimitive]: () => `A` }
    const where = new Func<boolean>(`eq`, [
      new Func(`concat`, [new Value(value)]),
      new Value(`A`),
    ])

    try {
      expect(() => subscription.requestSnapshot({ where })).toThrow(
        /snapshot structural expression value/i,
      )
      expect(loadCount).toBe(0)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`releases ordered publication authority before retrying failed adapter cleanup`, async () => {
    type Row = { id: string; rank: number }
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
    ) => void
    let commit!: () => void
    let loadCount = 0
    let unloadCount = 0
    let failNextUnload = true
    const collection = createCollection<Row>({
      id: `shared-ordered-release-cleanup-debt`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          params.markReady()
          return {
            loadSubset: () => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `a`, rank: 1 } })
                commit()
              }
              return Promise.resolve({
                hasMore: false,
                appliedRowKeys: [`a`] as const,
              })
            },
            unloadSubset: () => {
              unloadCount++
              if (failNextUnload) {
                failNextUnload = false
                throw new Error(`release failed`)
              }
            },
          }
        },
      },
    })
    const where = new Func(`gte`, [new PropRef([`rank`]), new Value(0)])
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const visible = [new Set<string>(), new Set<string>()]
    const createOrderedSubscription = (rows: Set<string>) => {
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            const key = String(change.key)
            if (change.type === `delete`) rows.delete(key)
            else rows.add(key)
          }
        },
        { whereExpression: where },
      )
      subscription.setOrderByIndex(index)
      return subscription
    }
    const first = createOrderedSubscription(visible[0]!)
    const second = createOrderedSubscription(visible[1]!)

    try {
      first.requestLimitedSnapshot({ orderBy, limit: 1 })
      second.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()
      expect(visible.map((rows) => [...rows])).toEqual([[`a`], [`a`]])

      expect(() => first.releaseSnapshot(where)).toThrow(`release failed`)
      expect([...visible[0]!]).toEqual([])
      expect(first.orderedBoundaryKey).toBeUndefined()
      expect([...visible[1]!]).toEqual([`a`])
      expect(second.orderedBoundaryKey).toBe(`a`)
      expect(collection.toArray.map(({ id }) => id)).toEqual([`a`])

      first.releaseSnapshot(where)
      expect([...visible[0]!]).toEqual([])
      expect(first.orderedBoundaryKey).toBeUndefined()
      expect([...visible[1]!]).toEqual([`a`])
      expect(second.orderedBoundaryKey).toBe(`a`)
      expect(collection.toArray.map(({ id }) => id)).toEqual([`a`])
      expect(unloadCount).toBe(2)
    } finally {
      failNextUnload = false
      first.unsubscribe()
      second.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`keeps reentrant release idempotent and retains a new same-predicate demand`, async () => {
    type Row = { id: string; value: number }
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const loads: Array<LoadSubsetOptions> = []
    let loadCount = 0
    let unloadCount = 0
    type TestSubscription = ReturnType<
      ReturnType<typeof createCollection<Row>>[`subscribeChanges`]
    >
    const owner: { current?: TestSubscription } = {}
    const collection = createCollection<Row>({
      id: `reentrant-release-same-predicate`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loadCount++
              loads.push(options)
              return true
            },
            unloadSubset: () => {
              unloadCount++
              if (unloadCount === 1) {
                owner.current!.releaseSnapshot(where)
                owner.current!.requestSnapshot({
                  where,
                  optimizedOnly: false,
                })
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})
    owner.current = subscription

    try {
      subscription.requestSnapshot({ where, optimizedOnly: false })
      subscription.releaseSnapshot(where)

      expect(loadCount).toBe(2)
      expect(unloadCount).toBe(1)
      expect(loads[0]?.signal?.aborted).toBe(true)
      expect(loads[1]?.signal?.aborted).toBe(false)

      subscription.unsubscribe()
      expect(unloadCount).toBe(2)
      expect(loads[1]?.signal?.aborted).toBe(true)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`retires the last ordered publication while replay is still pending`, async () => {
    type Row = { id: string; rank: number }
    type Outcome = { hasMore: boolean; appliedRowKeys: ReadonlyArray<string> }
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const replay = createDeferred<Outcome>()
    const loads: Array<LoadSubsetOptions> = []
    const collection = createCollection<Row>({
      id: `ordered-release-during-replay`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `a`, rank: 1 } })
                commit()
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [`a`],
                })
              }
              return replay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const where = new Func(`gte`, [new PropRef([`rank`]), new Value(0)])
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const visible = new Set<string>()
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          const key = String(change.key)
          if (change.type === `delete`) visible.delete(key)
          else visible.add(key)
        }
      },
      { whereExpression: where },
    )
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(loads).toHaveLength(2)

      subscription.releaseSnapshot(where)

      expect([...visible]).toEqual([])
      expect(subscription.orderedBoundaryKey).toBeUndefined()
      expect(subscription.orderedRowsNeeded).toBe(0)
      expect(loads.every(({ signal }) => signal?.aborted)).toBe(true)
    } finally {
      replay.resolve({ hasMore: false, appliedRowKeys: [] })
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not use ownerless source changes as a later ordered cursor`, async () => {
    type Row = { id: string; rank: number }
    type Outcome = { hasMore: boolean; appliedRowKeys: ReadonlyArray<string> }
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => void
    let loadCount = 0
    const secondLoad = createDeferred<Outcome>()
    const loads: Array<LoadSubsetOptions> = []
    const collection = createCollection<Row>({
      id: `ownerless-ordered-cursor`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `a`, rank: 1 } })
                commit()
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [`a`],
                })
              }
              return secondLoad.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const where = new Func(`gte`, [new PropRef([`rank`]), new Value(0)])
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const subscription = collection.subscribeChanges(() => {}, {
      whereExpression: where,
    })
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()
      subscription.releaseSnapshot(where)

      begin()
      write({ type: `insert`, value: { id: `x`, rank: 0 } })
      commit()

      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      expect(loads).toHaveLength(2)
      expect(loads[1]).toMatchObject({ offset: 0 })
      expect(loads[1]?.cursor).toBeUndefined()
      expect(subscription.orderedBoundaryKey).toBeUndefined()
    } finally {
      secondLoad.resolve({ hasMore: false, appliedRowKeys: [] })
      await flushPromises()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`publishes a same-version insert after retiring a failed publication`, async () => {
    type Row = { id: string; rank: number }
    type Outcome = { hasMore: boolean; appliedRowKeys: ReadonlyArray<string> }
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const replay = createDeferred<Outcome>()
    const collection = createCollection<Row>({
      id: `retired-failed-publication-reinsert`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: () => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `a`, rank: 1 } })
                commit()
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [`a`],
                })
              }
              if (loadCount === 2) return replay.promise
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const orderedWhere = new Func(`gte`, [new PropRef([`rank`]), new Value(0)])
    const additionalWhere = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`a`),
    ])
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const visible = new Set<string>()
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          const key = String(change.key)
          if (change.type === `delete`) visible.delete(key)
          else visible.add(key)
        }
      },
      { whereExpression: orderedWhere },
    )
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()
      begin()
      truncate()
      commit()
      await flushPromises()
      replay.reject(new Error(`ordered replay failed`))
      await flushPromises()

      subscription.releaseSnapshot(orderedWhere)
      subscription.requestSnapshot({
        where: additionalWhere,
        optimizedOnly: false,
      })
      await flushPromises()
      begin()
      write({ type: `insert`, value: { id: `a`, rank: 1 } })
      commit()

      expect(collection.toArray.map(({ id }) => id)).toEqual([`a`])
      expect([...visible]).toEqual([`a`])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`retries cleanup by exact acquisition without releasing a replacement owner`, async () => {
    type Row = { id: string; rank: number }
    const loads: Array<LoadSubsetOptions> = []
    const unloadSignals: Array<AbortSignal | undefined> = []
    let loadCount = 0
    let failFirstUnload = true
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => void
    const collection = createCollection<Row>({
      id: `exact-ordered-cleanup-retry`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `a`, rank: 1 } })
                commit()
              }
              return Promise.resolve({
                hasMore: false,
                appliedRowKeys: [`a`] as const,
              })
            },
            unloadSubset: (options) => {
              unloadSignals.push(options.signal)
              if (failFirstUnload) {
                failFirstUnload = false
                throw new Error(`release failed`)
              }
            },
          }
        },
      },
    })
    const where = new Func(`gte`, [new PropRef([`rank`]), new Value(0)])
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const visible = new Set<string>()
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          const key = String(change.key)
          if (change.type === `delete`) visible.delete(key)
          else visible.add(key)
        }
      },
      { whereExpression: where },
    )
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()
      expect(() => subscription.releaseSnapshot(where)).toThrow(
        `release failed`,
      )
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()

      const releaseExact = subscription.releaseSnapshot as (
        predicate: typeof where,
        signal: AbortSignal | undefined,
      ) => void
      releaseExact.call(subscription, where, loads[0]?.signal)

      expect(unloadSignals).toEqual([loads[0]?.signal, loads[0]?.signal])
      expect(loads[1]?.signal?.aborted).toBe(false)
      expect([...visible]).toEqual([`a`])
      expect(subscription.orderedBoundaryKey).toBe(`a`)
    } finally {
      failFirstUnload = false
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`keeps replay handoff cleanup idempotent under reentrant release`, async () => {
    type Row = { id: string; rank: number }
    type Outcome = { hasMore: boolean; appliedRowKeys: ReadonlyArray<string> }
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    let releaseReentered = false
    const replay = createDeferred<Outcome>()
    const loads: Array<LoadSubsetOptions> = []
    const unloadLabels: Array<`old` | `replay`> = []
    type TestSubscription = ReturnType<
      ReturnType<typeof createCollection<Row>>[`subscribeChanges`]
    >
    const owner: { current?: TestSubscription } = {}
    const collection = createCollection<Row>({
      id: `reentrant-replay-handoff-cleanup`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `a`, rank: 1 } })
                commit()
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [`a`],
                })
              }
              return replay.promise
            },
            unloadSubset: (options) => {
              const label =
                options.signal === loads[0]?.signal ? `old` : `replay`
              unloadLabels.push(label)
              if (label === `old` && !releaseReentered) {
                releaseReentered = true
                owner.current!.releaseSnapshot(where)
              }
            },
          }
        },
      },
    })
    const where = new Func(`gte`, [new PropRef([`rank`]), new Value(0)])
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const subscription = collection.subscribeChanges(() => {}, {
      whereExpression: where,
    })
    owner.current = subscription
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()
      begin()
      truncate()
      commit()
      await flushPromises()

      replay.resolve({ hasMore: false, appliedRowKeys: [`a`] })
      await flushPromises()

      expect(unloadLabels).toEqual([`old`, `replay`])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`reports every failed acquisition cleanup while abandoning a replay handoff`, async () => {
    type Row = { id: string; version: number }
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => true | Promise<void>
    let truncate!: () => void
    let loadCount = 0
    const replay = createDeferred<void>()
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const failed = new Set<LoadSubsetOptions>()
    const oldFailure = new Error(`old acquisition cleanup failed`)
    const replacementFailure = new Error(
      `replacement acquisition cleanup failed`,
    )
    const collection = createCollection<Row>({
      id: `replay-handoff-multiple-cleanup-failures`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              loadCount++
              begin()
              write({
                type: `insert`,
                value: { id: `a`, version: loadCount },
              })
              commit()
              return loadCount === 1 ? true : replay.promise
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (failed.has(options)) return
              failed.add(options)
              if (options === loads[0]) throw oldFailure
              if (options === loads[1]) throw replacementFailure
            },
          }
        },
      },
    })
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const visible = new Map<string, Row>()
    const reported: Array<{ error: unknown; options: LoadSubsetOptions }> = []
    let unsubscribed = false
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(String(change.key))
        else visible.set(String(change.key), change.value)
      }
    })
    subscription.on(`loadSubset:error`, ({ error, options }) =>
      reported.push({ error, options }),
    )

    try {
      subscription.requestSnapshot({ where })
      begin()
      truncate()
      commit()
      await flushPromises()

      replay.resolve()
      await flushPromises()

      expect(reported.map(({ error }) => error)).toEqual([
        oldFailure,
        replacementFailure,
      ])
      expect(reported[0]?.options).toBe(loads[0])
      expect(reported[1]?.options).toBe(loads[1])
      expect(visible.get(`a`)?.version).toBe(1)
      expect(subscription.status).toBe(`ready`)

      subscription.unsubscribe()
      unsubscribed = true
      expect(unloads).toEqual([loads[0], loads[1], loads[1], loads[0]])
    } finally {
      if (!unsubscribed) subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`attributes a reentrant replay handoff cleanup failure to its exact acquisition`, async () => {
    type Row = { id: string; version: number }
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => true | Promise<void>
    let truncate!: () => void
    let loadCount = 0
    let reentered = false
    let replacementFailed = false
    const replay = createDeferred<void>()
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const replacementFailure = new Error(`replacement cleanup failed`)
    type TestSubscription = ReturnType<
      ReturnType<typeof createCollection<Row>>[`subscribeChanges`]
    >
    const owner: { current?: TestSubscription } = {}
    const collection = createCollection<Row>({
      id: `reentrant-replay-handoff-cleanup-attribution`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              loadCount++
              begin()
              write({
                type: `insert`,
                value: { id: `a`, version: loadCount },
              })
              commit()
              return loadCount === 1 ? true : replay.promise
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (options === loads[0] && !reentered) {
                reentered = true
                owner.current!.releaseSnapshot(where)
                return
              }
              if (options === loads[1] && !replacementFailed) {
                replacementFailed = true
                throw replacementFailure
              }
            },
          }
        },
      },
    })
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const reported: Array<{ error: unknown; options: LoadSubsetOptions }> = []
    const subscription = collection.subscribeChanges(() => {}, {
      whereExpression: where,
    })
    owner.current = subscription
    subscription.on(`loadSubset:error`, ({ error, options }) =>
      reported.push({ error, options }),
    )

    try {
      subscription.requestSnapshot({ where })
      begin()
      truncate()
      commit()
      await flushPromises()

      replay.resolve()
      await flushPromises()

      expect(reported.map(({ error }) => error)).toEqual([replacementFailure])
      expect(reported[0]?.options).toBe(loads[1])
      expect(unloads).toEqual([loads[0], loads[1], loads[1]])
      expect(subscription.status).toBe(`ready`)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`preserves nested cleanup occurrences across another demand's replay handoff`, async () => {
    type Row = { id: string; version: number }
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => true | Promise<void>
    let truncate!: () => void
    let nested = false
    const replayA = createDeferred<void>()
    const replayB = createDeferred<void>()
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const failed = new Set<LoadSubsetOptions>()
    const pendingBFailure = new Error(`pending B cleanup failed`)
    const currentBFailure = new Error(`current B cleanup failed`)
    type TestSubscription = ReturnType<
      ReturnType<typeof createCollection<Row>>[`subscribeChanges`]
    >
    const owner: { current?: TestSubscription } = {}
    const collection = createCollection<Row>({
      id: `nested-demand-replay-handoff-cleanup`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              const id = loads.length % 2 === 1 ? `a` : `b`
              if (loads.length <= 2) {
                begin()
                write({ type: `insert`, value: { id, version: 1 } })
                commit()
                return true
              }
              return loads.length === 3 ? replayA.promise : replayB.promise
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (options === loads[0] && !nested) {
                nested = true
                owner.current!.releaseSnapshot(whereB)
              }
              if (failed.has(options)) return
              if (options === loads[3]) {
                failed.add(options)
                throw pendingBFailure
              }
              if (options === loads[1]) {
                failed.add(options)
                throw currentBFailure
              }
            },
          }
        },
      },
    })
    const whereA = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const whereB = new Func(`eq`, [new PropRef([`id`]), new Value(`b`)])
    const visible = new Set<string>()
    const reported: Array<{ error: unknown; options: LoadSubsetOptions }> = []
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(String(change.key))
        else visible.add(String(change.key))
      }
    })
    owner.current = subscription
    subscription.on(`loadSubset:error`, ({ error, options }) =>
      reported.push({ error, options }),
    )

    try {
      subscription.requestSnapshot({ where: whereA })
      subscription.requestSnapshot({ where: whereB })
      begin()
      truncate()
      commit()
      await flushPromises()

      replayA.resolve()
      replayB.resolve()
      await flushPromises()

      expect(reported.map(({ error }) => error)).toEqual([
        pendingBFailure,
        currentBFailure,
      ])
      expect(reported[0]?.options).toBe(loads[3])
      expect(reported[1]?.options).toBe(loads[1])
      expect(unloads.map((options) => loads.indexOf(options))).toEqual([
        0, 3, 1, 2, 3,
      ])
      expect([...visible].sort()).toEqual([`a`, `b`])
      expect(subscription.status).toBe(`ready`)

      subscription.unsubscribe()
      expect(unloads.map((options) => loads.indexOf(options))).toEqual([
        0, 3, 1, 2, 3, 0, 1,
      ])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([
    { mode: `propagates the nested failure`, behavior: `propagate` },
    { mode: `swallows the nested failure`, behavior: `swallow` },
    { mode: `replaces it with another failure`, behavior: `replace` },
  ])(
    `preserves cleanup provenance when an intermediate adapter $mode`,
    async ({ behavior }) => {
      type Row = { id: string }
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, string>,
      ) => void
      let commit!: () => true | Promise<void>
      let truncate!: () => void
      const ids = [`a`, `b`, `c`] as const
      const wheres = ids.map(
        (id) => new Func(`eq`, [new PropRef([`id`]), new Value(id)]),
      )
      const replays = ids.map(() => createDeferred<void>())
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const failed = new Set<LoadSubsetOptions>()
      const failureB = new Error(`B cleanup failed`)
      const failureC = new Error(`C cleanup failed`)
      let nestedA = false
      let nestedB = false
      type TestSubscription = ReturnType<
        ReturnType<typeof createCollection<Row>>[`subscribeChanges`]
      >
      const owner: { current?: TestSubscription } = {}
      const collection = createCollection<Row>({
        id: `deep-nested-replay-cleanup-${behavior}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                const index = loads.length - 1
                if (index < ids.length) {
                  begin()
                  write({ type: `insert`, value: { id: ids[index]! } })
                  commit()
                  return true
                }
                return replays[index - ids.length]!.promise
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (options === loads[0] && !nestedA) {
                  nestedA = true
                  owner.current!.releaseSnapshot(wheres[1]!)
                }
                if (options === loads[1] && !nestedB) {
                  nestedB = true
                  if (behavior !== `propagate`) {
                    try {
                      owner.current!.releaseSnapshot(wheres[2]!)
                    } catch {
                      // The cleanup boundary must retain the nested occurrence
                      // even when this adapter handles the propagated error.
                    }
                    if (behavior === `replace` && !failed.has(options)) {
                      failed.add(options)
                      throw failureB
                    }
                  } else {
                    owner.current!.releaseSnapshot(wheres[2]!)
                  }
                }
                if (options === loads[2] && !failed.has(options)) {
                  failed.add(options)
                  throw failureC
                }
              },
            }
          },
        },
      })
      const visible = new Set<string>()
      const reported: Array<{
        error: unknown
        options: LoadSubsetOptions
      }> = []
      const subscription = collection.subscribeChanges((changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(String(change.key))
          else visible.add(String(change.key))
        }
      })
      owner.current = subscription
      subscription.on(`loadSubset:error`, ({ error, options }) =>
        reported.push({ error, options }),
      )

      try {
        for (const where of wheres) subscription.requestSnapshot({ where })
        begin()
        truncate()
        commit()
        await flushPromises()

        for (const replay of replays) replay.resolve()
        await flushPromises()

        expect(reported.map(({ error }) => error)).toEqual(
          behavior === `replace` ? [failureC, failureB] : [failureC],
        )
        expect(reported.map(({ options }) => loads.indexOf(options))).toEqual(
          behavior === `replace` ? [2, 1] : [2],
        )
        expect(unloads.map((options) => loads.indexOf(options))).toEqual([
          0, 4, 1, 5, 2, 3,
        ])
        expect([...visible].sort()).toEqual(ids)
        expect(subscription.status).toBe(`ready`)

        subscription.unsubscribe()
        expect(unloads.map((options) => loads.indexOf(options))).toEqual([
          0,
          4,
          1,
          5,
          2,
          3,
          0,
          ...(behavior === `swallow` ? [] : [1]),
          2,
        ])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each(
    [
      { name: `Error`, failure: new Error(`callback cleanup payload`) },
      {
        name: `AggregateError`,
        failure: new AggregateError(
          [new Error(`callback cleanup inner payload`)],
          `callback cleanup payload`,
        ),
      },
      { name: `undefined`, failure: undefined },
      { name: `NaN`, failure: Number.NaN },
    ].flatMap(({ name, failure }) =>
      ([`return`, `rethrow`, `distinct`, `same`] as const).map((mode) => ({
        name,
        nestedFailure: failure,
        outerFailure:
          mode === `same` ? failure : new Error(`outer callback failed`),
        mode,
      })),
    ),
  )(
    `preserves caught replay-callback cleanup failures: $name $mode`,
    async ({ name, nestedFailure, outerFailure, mode }) => {
      const result = await exerciseReplayCallbackCleanup({
        id: `caught-callback-cleanup-${name}-${mode}`,
        nestedFailure,
        outerFailure,
        mode,
      })

      const expectedErrors =
        mode === `distinct`
          ? [nestedFailure, outerFailure]
          : mode === `same`
            ? [nestedFailure, nestedFailure]
            : [nestedFailure]
      expect(result.reported.map(({ error }) => error)).toEqual(expectedErrors)
      expect(result.reported.map(({ optionsIndex }) => optionsIndex)).toEqual(
        expectedErrors.length === 1 ? [2] : [2, 3],
      )
      expect(result.visibleVersions).toEqual([
        [`a`, 2],
        [`b`, 1],
      ])
      expect(result.beforeRetry).toEqual([0, 1, 2])
      expect(result.afterRetry).toEqual([0, 1, 2, 2, 3])
      expect(result.status).toBe(`ready`)
    },
  )

  it(`carries nested public teardown failures without exposing propagation tokens`, async () => {
    type Row = { id: string }
    const ids = [`a`, `b`, `c`] as const
    const wheres = ids.map(
      (id) => new Func(`eq`, [new PropRef([`id`]), new Value(id)]),
    )
    const failures = [
      new Error(`B cleanup failed`),
      new Error(`C cleanup failed`),
    ] as const
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const failed = new Set<LoadSubsetOptions>()
    let nested = false
    type TestSubscription = ReturnType<
      ReturnType<typeof createCollection<Row>>[`subscribeChanges`]
    >
    const owner: { current?: TestSubscription } = {}
    const collection = createCollection<Row>({
      id: `nested-public-teardown-cleanup`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => {
              unloads.push(options)
              const index = loads.indexOf(options)
              if (index === 0 && !nested) {
                nested = true
                owner.current!.unsubscribe()
              }
              if ((index === 1 || index === 2) && !failed.has(options)) {
                failed.add(options)
                throw failures[index - 1]
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})
    owner.current = subscription

    try {
      for (const where of wheres) subscription.requestSnapshot({ where })
      let thrown: unknown
      try {
        subscription.releaseSnapshot(wheres[0]!)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(AggregateError)
      expect((thrown as AggregateError).errors).toEqual(failures)
      expect(unloads.map((options) => loads.indexOf(options))).toEqual([
        0, 1, 2,
      ])

      subscription.unsubscribe()
      expect(unloads.map((options) => loads.indexOf(options))).toEqual([
        0, 1, 2, 0, 1, 2,
      ])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`carries a true cleanup failure across nested replay callback frames once`, async () => {
    type Row = { id: string }
    const whereA = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const whereB = new Func(`eq`, [new PropRef([`id`]), new Value(`b`)])
    const whereC = new Func(`eq`, [new PropRef([`id`]), new Value(`c`)])
    const cleanupFailure = new Error(`nested callback cleanup failed`)
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const reported: Array<{
      error: unknown
      options: LoadSubsetOptions
    }> = []
    let begin!: () => void
    let commit!: () => true | Promise<void>
    let truncate!: () => void
    let cleanupArmed = false
    let cleanupFailed = false
    let outerCallbackCount = 0
    const collection = createCollection<Row>({
      id: `nested-replay-callback-frame-cleanup`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (
                cleanupArmed &&
                sameWhere(options.where, whereC) &&
                !cleanupFailed
              ) {
                cleanupFailed = true
                throw cleanupFailure
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})
    subscription.on(`loadSubset:error`, ({ error, options }) =>
      reported.push({ error, options }),
    )
    let unsubscribed = false

    try {
      subscription.requestSnapshot({ where: whereC })
      subscription.requestSnapshot({
        where: whereA,
        onLoadSubsetResult: () => {
          outerCallbackCount++
          if (outerCallbackCount !== 2) return

          let propagatedCleanup: unknown
          subscription.requestSnapshot({
            where: whereB,
            onLoadSubsetResult: () => {
              cleanupArmed = true
              try {
                subscription.releaseSnapshot(whereC)
              } catch (error) {
                propagatedCleanup = error
              }
            },
          })
          throw propagatedCleanup
        },
      })

      begin()
      truncate()
      commit()
      await flushPromises()

      expect(reported).toHaveLength(1)
      expect(reported[0]!.error).toBe(cleanupFailure)
      expect(loads.indexOf(reported[0]!.options)).toBe(2)
      expect(unloads.map((options) => loads.indexOf(options))).toEqual([
        0, 1, 2,
      ])

      subscription.unsubscribe()
      unsubscribed = true
      expect(unloads.map((options) => loads.indexOf(options))).toEqual([
        0, 1, 2, 2, 3, 4,
      ])
    } finally {
      if (!unsubscribed) subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`aggregates unsubscribe listener failures after adapter cleanup`, async () => {
    type Row = { id: string }
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const cleanupFailure = new Error(`adapter cleanup failed`)
    const listenerFailure = new Error(`unsubscribe listener failed`)
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const deferredMicrotasks: Array<VoidFunction> = []
    let cleanupFailed = false
    const collection = createCollection<Row>({
      id: `unsubscribe-listener-cleanup-order`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (!cleanupFailed) {
                cleanupFailed = true
                throw cleanupFailure
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})
    subscription.on(`unsubscribed`, () => {
      throw listenerFailure
    })
    const queueMicrotaskSpy = vi
      .spyOn(globalThis, `queueMicrotask`)
      .mockImplementation((callback) => deferredMicrotasks.push(callback))

    try {
      subscription.requestSnapshot({ where })
      let thrown: unknown
      try {
        subscription.unsubscribe()
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(AggregateError)
      expect((thrown as AggregateError).errors).toEqual([
        cleanupFailure,
        listenerFailure,
      ])
      expect(deferredMicrotasks).toEqual([])
      expect(unloads).toEqual([loads[0]])

      subscription.unsubscribe()
      expect(unloads).toEqual([loads[0], loads[0]])
    } finally {
      queueMicrotaskSpy.mockRestore()
      try {
        subscription.unsubscribe()
      } catch {
        // The assertions above own the first teardown failure.
      }
      await collection.cleanup()
    }
  })

  it(`reports a queued sibling replay failure before callback teardown`, async () => {
    type Row = { id: `a` | `b` | `c` }
    const ids = [`a`, `b`, `c`] as const
    const wheres = ids.map(
      (id) => new Func(`eq`, [new PropRef([`id`]), new Value(id)]),
    )
    const replays = ids.map(() => createDeferred<void>())
    const failure = new Error(`queued sibling replay failed`)
    const loads: Array<LoadSubsetOptions> = []
    const reported: Array<{
      error: unknown
      options: LoadSubsetOptions
    }> = []
    let begin!: () => void
    let commit!: () => true | Promise<void>
    let truncate!: () => void
    const collection = createCollection<Row>({
      id: `queued-sibling-replay-before-unsubscribe`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              const loadIndex = loads.length - 1
              return loadIndex < ids.length
                ? true
                : replays[loadIndex - ids.length]!.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})
    subscription.on(`loadSubset:error`, ({ error, options }) =>
      reported.push({ error, options }),
    )

    try {
      for (const [index, where] of wheres.entries()) {
        subscription.requestSnapshot({
          where,
          ...(index === 1 && {
            onLoadSubsetResult: (result) => {
              if (result instanceof Promise) {
                void result.then(() => subscription.unsubscribe())
              }
            },
          }),
        })
      }

      begin()
      truncate()
      commit()
      await flushPromises()

      replays[0]!.reject(failure)
      await flushPromises()
      expect(reported).toEqual([])

      replays[1]!.resolve()
      await flushPromises()

      expect(reported).toEqual([{ error: failure, options: loads[3] }])
      expect(subscription.lastError).toBe(failure)
      expect(subscription.lastErrorVersion).toBe(1)

      replays[2]!.reject(new Error(`late obsolete replay failure`))
      await flushPromises()
      expect(reported).toEqual([{ error: failure, options: loads[3] }])
      expect(subscription.lastErrorVersion).toBe(1)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`reports queued and active replay failures in occurrence order`, async () => {
    type Row = { id: string }
    const whereA = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const whereB = new Func(`eq`, [new PropRef([`id`]), new Value(`b`)])
    const whereC = new Func(`eq`, [new PropRef([`id`]), new Value(`c`)])
    const whereNested = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`nested`),
    ])
    const replayFailure = new Error(`prior replay failed`)
    const cleanupFailure = new Error(`callback cleanup failed`)
    const startFailure = new Error(`callback start failed`)
    const loads: Array<LoadSubsetOptions> = []
    const reported: Array<{
      error: unknown
      options: LoadSubsetOptions
    }> = []
    let begin!: () => void
    let commit!: () => true | Promise<void>
    let truncate!: () => void
    let replaying = false
    let callbackCount = 0
    let cleanupFailed = false
    let nestedOptions: LoadSubsetOptions | undefined
    const collection = createCollection<Row>({
      id: `queued-and-active-replay-failure-order`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (sameWhere(options.where, whereNested)) {
                nestedOptions = options
                throw startFailure
              }
              if (replaying && sameWhere(options.where, whereA)) {
                throw replayFailure
              }
              return true
            },
            unloadSubset: (options) => {
              if (sameWhere(options.where, whereC) && !cleanupFailed) {
                cleanupFailed = true
                throw cleanupFailure
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})
    subscription.on(`loadSubset:error`, ({ error, options }) =>
      reported.push({ error, options }),
    )

    try {
      subscription.requestSnapshot({ where: whereA })
      subscription.requestSnapshot({
        where: whereB,
        onLoadSubsetResult: () => {
          callbackCount++
          if (callbackCount !== 2) return
          try {
            subscription.releaseSnapshot(whereC)
          } catch {
            // Teardown must retain this active callback-frame occurrence.
          }
          try {
            subscription.requestSnapshot({ where: whereNested })
          } catch {
            // This occurrence is both queued and reachable through the frame.
          }
          subscription.unsubscribe()
        },
      })
      subscription.requestSnapshot({ where: whereC })

      replaying = true
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(reported).toEqual([
        { error: replayFailure, options: loads[3] },
        { error: cleanupFailure, options: loads[2] },
        { error: startFailure, options: nestedOptions },
      ])
      expect(subscription.lastError).toBe(startFailure)
      expect(subscription.lastErrorVersion).toBe(3)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`finishes a queued replay error batch before reentrant listener teardown`, async () => {
    type Row = { id: `a` | `b` }
    const whereA = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const whereB = new Func(`eq`, [new PropRef([`id`]), new Value(`b`)])
    const replayA = createDeferred<void>()
    const replayB = createDeferred<void>()
    const failureA = new Error(`first queued replay failed`)
    const failureB = new Error(`second queued replay failed`)
    const cleanupFailure = new Error(`reentrant cleanup failed`)
    const listenerFailure = new Error(`reentrant error listener failed`)
    const loads: Array<LoadSubsetOptions> = []
    const reported: Array<{
      error: unknown
      options: LoadSubsetOptions
    }> = []
    const surfacedErrors: Array<unknown> = []
    const cleanupErrors: Array<unknown> = []
    const onceErrors: Array<unknown> = []
    const nativeQueueMicrotask = globalThis.queueMicrotask
    const queueMicrotaskSpy = vi
      .spyOn(globalThis, `queueMicrotask`)
      .mockImplementation((callback) =>
        nativeQueueMicrotask(() => {
          try {
            callback()
          } catch (error) {
            surfacedErrors.push(error)
          }
        }),
      )
    let begin!: () => void
    let commit!: () => true | Promise<void>
    let truncate!: () => void
    let replaying = false
    let terminalCalls = 0
    let unloadAttempts = 0
    const collection = createCollection<Row>({
      id: `queued-replay-errors-before-listener-teardown`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (!replaying) return true
              return sameWhere(options.where, whereA)
                ? replayA.promise
                : replayB.promise
            },
            unloadSubset: (options) => {
              if (!sameWhere(options.where, whereA)) return
              unloadAttempts++
              if (unloadAttempts <= 2) {
                throw cleanupFailure
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})
    subscription.on(`unsubscribed`, () => {
      terminalCalls++
    })
    subscription.on(`loadSubset:error`, ({ error, options }) => {
      reported.push({ error, options })
      if (reported.length === 1) {
        subscription.off(`loadSubset:error`, onceListener)
      }
      try {
        subscription.unsubscribe()
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError)
      }
      if (reported.length === 1) {
        throw listenerFailure
      }
    })
    const onceListener = ({ error }: { error: unknown }) => {
      onceErrors.push(error)
    }
    subscription.once(`loadSubset:error`, onceListener)

    try {
      subscription.requestSnapshot({ where: whereA })
      subscription.requestSnapshot({ where: whereB })
      replaying = true
      begin()
      truncate()
      commit()
      await flushPromises()

      replayA.reject(failureA)
      replayB.reject(failureB)
      await flushPromises()

      expect(reported.map(({ error }) => error)).toEqual([
        failureA,
        cleanupFailure,
        failureB,
      ])
      expect(reported[0]?.options).toBe(loads[2])
      expect(reported[1]?.options).toBe(loads[2])
      expect(reported[2]?.options).toBe(loads[3])
      expect(subscription.lastError).toBe(failureB)
      expect(subscription.lastErrorVersion).toBe(3)
      expect(terminalCalls).toBe(1)
      expect(surfacedErrors).toEqual([listenerFailure])
      expect(cleanupErrors).toEqual([cleanupFailure])
      expect(onceErrors).toEqual([])

      const attemptsBeforeRetry = unloadAttempts
      subscription.unsubscribe()
      expect(unloadAttempts).toBe(attemptsBeforeRetry + 1)
      expect(terminalCalls).toBe(1)
    } finally {
      queueMicrotaskSpy.mockRestore()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`reports a caught replay start failure before callback teardown`, async () => {
    type Row = { id: string }
    const whereA = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const whereNested = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`nested`),
    ])
    const failure = new Error(`nested replay start failed`)
    const reported: Array<{
      error: unknown
      options: LoadSubsetOptions
    }> = []
    let begin!: () => void
    let commit!: () => true | Promise<void>
    let truncate!: () => void
    let callbackCount = 0
    let caught = false
    let failedOptions: LoadSubsetOptions | undefined
    const collection = createCollection<Row>({
      id: `caught-replay-start-before-unsubscribe`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              if (sameWhere(options.where, whereNested)) {
                failedOptions = options
                throw failure
              }
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})
    subscription.on(`loadSubset:error`, ({ error, options }) =>
      reported.push({ error, options }),
    )

    try {
      subscription.requestSnapshot({
        where: whereA,
        onLoadSubsetResult: () => {
          callbackCount++
          if (callbackCount !== 2) return
          try {
            subscription.requestSnapshot({ where: whereNested })
          } catch {
            caught = true
          }
          subscription.unsubscribe()
        },
      })

      begin()
      truncate()
      commit()
      await flushPromises()

      expect(caught).toBe(true)
      expect(reported).toEqual([{ error: failure, options: failedOptions }])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`reports and retries caught replay cleanup before callback teardown`, async () => {
    type Row = { id: string }
    const whereA = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const whereB = new Func(`eq`, [new PropRef([`id`]), new Value(`b`)])
    const failure = new Error(`nested replay cleanup failed`)
    const reported: Array<{
      error: unknown
      options: LoadSubsetOptions
    }> = []
    const unloads: Array<LoadSubsetOptions> = []
    let begin!: () => void
    let commit!: () => true | Promise<void>
    let truncate!: () => void
    let callbackCount = 0
    let armed = false
    let failed = false
    let caught = false
    let failedOptions: LoadSubsetOptions | undefined
    const collection = createCollection<Row>({
      id: `caught-replay-cleanup-before-unsubscribe`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: () => true,
            unloadSubset: (options) => {
              unloads.push(options)
              if (armed && sameWhere(options.where, whereB) && !failed) {
                failed = true
                failedOptions = options
                throw failure
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})
    subscription.on(`loadSubset:error`, ({ error, options }) =>
      reported.push({ error, options }),
    )

    try {
      subscription.requestSnapshot({ where: whereB })
      subscription.requestSnapshot({
        where: whereA,
        onLoadSubsetResult: () => {
          callbackCount++
          if (callbackCount !== 2) return
          armed = true
          try {
            subscription.releaseSnapshot(whereB)
          } catch {
            caught = true
          }
          subscription.unsubscribe()
        },
      })

      begin()
      truncate()
      commit()
      await flushPromises()

      expect(caught).toBe(true)
      expect(reported).toEqual([{ error: failure, options: failedOptions }])
      expect(
        unloads.filter((options) => options === failedOptions),
      ).toHaveLength(2)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each(
    ([`adapter-entry`, `cleanup`, `result-callback`] as const).flatMap(
      (activeFrame) =>
        ([`before-failure`, `after-failure`] as const).map(
          (teardownOrder) => [activeFrame, teardownOrder] as const,
        ),
    ),
  )(
    `retains exact replay failures when teardown starts in %s %s`,
    async (activeFrame, teardownOrder) => {
      type Row = { id: string }
      const whereOuter = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`outer`),
      ])
      const whereCleanup = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`cleanup`),
      ])
      const whereInner = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`inner`),
      ])
      const whereAfterTeardown = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`after-teardown`),
      ])
      const failure = new Error(`failure while teardown is requested`)
      const reported: Array<{
        error: unknown
        options: LoadSubsetOptions
      }> = []
      const lifecycle: Array<`error` | `terminal`> = []
      const cleanupUnloads: Array<LoadSubsetOptions> = []
      let begin!: () => void
      let commit!: () => true | Promise<void>
      let truncate!: () => void
      let replaying = false
      let callbackCount = 0
      let failedOptions: LoadSubsetOptions | undefined
      let failureStarted = false
      let postTeardownRequestResult: boolean | undefined
      let postTeardownLoads = 0

      const requestInner = () =>
        subscription.requestSnapshot({ where: whereInner })
      const failWithinBoundary = (options: LoadSubsetOptions) => {
        if (failureStarted) return
        failureStarted = true
        if (teardownOrder === `before-failure`) {
          failedOptions = options
          subscription.unsubscribe()
          postTeardownRequestResult = subscription.requestSnapshot({
            where: whereAfterTeardown,
          })
          throw failure
        }
        try {
          requestInner()
        } catch {
          // The containing frame retains the exact inner occurrence.
        }
        subscription.unsubscribe()
        postTeardownRequestResult = subscription.requestSnapshot({
          where: whereAfterTeardown,
        })
      }

      const collection = createCollection<Row>({
        id: `teardown-during-${activeFrame}-${teardownOrder}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                if (sameWhere(options.where, whereAfterTeardown)) {
                  postTeardownLoads++
                }
                if (sameWhere(options.where, whereInner)) {
                  failedOptions = options
                  throw failure
                }
                if (
                  replaying &&
                  activeFrame === `adapter-entry` &&
                  sameWhere(options.where, whereOuter)
                ) {
                  failWithinBoundary(options)
                }
                if (
                  replaying &&
                  activeFrame === `cleanup` &&
                  sameWhere(options.where, whereOuter)
                ) {
                  subscription.releaseSnapshot(whereCleanup)
                }
                return true
              },
              unloadSubset: (options) => {
                if (!sameWhere(options.where, whereCleanup)) return
                cleanupUnloads.push(options)
                if (replaying && activeFrame === `cleanup`) {
                  failWithinBoundary(options)
                }
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {})
      subscription.on(`loadSubset:error`, ({ error, options }) => {
        lifecycle.push(`error`)
        reported.push({ error, options })
      })
      subscription.on(`unsubscribed`, () => {
        lifecycle.push(`terminal`)
        subscription.unsubscribe()
      })

      try {
        subscription.requestSnapshot({
          where: whereOuter,
          onLoadSubsetResult: (_result, options) => {
            callbackCount++
            if (
              replaying &&
              activeFrame === `result-callback` &&
              callbackCount === 2
            ) {
              failWithinBoundary(options)
            }
          },
        })
        subscription.requestSnapshot({ where: whereCleanup })

        replaying = true
        begin()
        truncate()
        commit()
        await flushPromises()
        await flushPromises()

        expect(reported).toEqual([{ error: failure, options: failedOptions }])
        expect(subscription.lastError).toBe(failure)
        expect(subscription.lastErrorVersion).toBe(1)
        expect(lifecycle).toEqual([`error`, `terminal`])
        expect(postTeardownRequestResult).toBe(false)
        expect(postTeardownLoads).toBe(0)

        const unloadsAfterDeferredTeardown = cleanupUnloads.length
        subscription.unsubscribe()
        expect(cleanupUnloads).toHaveLength(
          unloadsAfterDeferredTeardown +
            (activeFrame === `cleanup` && teardownOrder === `before-failure`
              ? 1
              : 0),
        )
        expect(lifecycle).toEqual([`error`, `terminal`])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`adapter-entry`, `cleanup`, `result-callback`] as const)(
    `retains teardown cleanup failures caught inside replay %s`,
    async (activeFrame) => {
      type Row = { id: string }
      const whereOuter = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`outer`),
      ])
      const whereActiveCleanup = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`active-cleanup`),
      ])
      const whereTeardownCleanup = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`teardown-cleanup`),
      ])
      const failure = new Error(`teardown cleanup failed`)
      const reported: Array<{
        error: unknown
        options: LoadSubsetOptions
      }> = []
      const lifecycle: Array<`error` | `terminal`> = []
      let begin!: () => void
      let commit!: () => true | Promise<void>
      let truncate!: () => void
      let replaying = false
      let callbackCount = 0
      let teardownStarted = false
      let teardownCleanupFailed = false
      let teardownCleanupOptions: LoadSubsetOptions | undefined
      let teardownCleanupUnloads = 0
      let caughtTeardownFailure: unknown

      const startTeardown = () => {
        if (teardownStarted) return
        teardownStarted = true
        try {
          subscription.unsubscribe()
        } catch (error) {
          // Adapter and callback code may catch the teardown failure,
          // but that cannot erase the exact cleanup occurrence it represents.
          caughtTeardownFailure = error
        }
      }

      const collection = createCollection<Row>({
        id: `caught-teardown-cleanup-during-${activeFrame}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                if (
                  replaying &&
                  activeFrame === `adapter-entry` &&
                  sameWhere(options.where, whereOuter)
                ) {
                  startTeardown()
                }
                if (
                  replaying &&
                  activeFrame === `cleanup` &&
                  sameWhere(options.where, whereOuter)
                ) {
                  subscription.releaseSnapshot(whereActiveCleanup)
                }
                return true
              },
              unloadSubset: (options) => {
                if (
                  replaying &&
                  activeFrame === `cleanup` &&
                  sameWhere(options.where, whereActiveCleanup)
                ) {
                  startTeardown()
                }
                if (!sameWhere(options.where, whereTeardownCleanup)) return
                teardownCleanupOptions = options
                teardownCleanupUnloads++
                if (!teardownCleanupFailed) {
                  teardownCleanupFailed = true
                  throw failure
                }
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {})
      subscription.on(`loadSubset:error`, ({ error, options }) => {
        lifecycle.push(`error`)
        reported.push({ error, options })
      })
      subscription.on(`unsubscribed`, () => lifecycle.push(`terminal`))

      try {
        subscription.requestSnapshot({
          where: whereOuter,
          onLoadSubsetResult: () => {
            callbackCount++
            if (
              replaying &&
              activeFrame === `result-callback` &&
              callbackCount === 2
            ) {
              startTeardown()
            }
          },
        })
        subscription.requestSnapshot({ where: whereActiveCleanup })
        subscription.requestSnapshot({ where: whereTeardownCleanup })

        replaying = true
        begin()
        truncate()
        commit()
        await flushPromises()
        await flushPromises()

        expect(caughtTeardownFailure).toBeDefined()
        expect(reported).toEqual([
          { error: failure, options: teardownCleanupOptions },
        ])
        expect(subscription.lastError).toBe(failure)
        expect(subscription.lastErrorVersion).toBe(1)
        expect(lifecycle).toEqual([`error`, `terminal`])

        subscription.unsubscribe()
        expect(teardownCleanupUnloads).toBe(2)
        expect(lifecycle).toEqual([`error`, `terminal`])
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([
    `propagate`,
    `return`,
    `throw-distinct`,
    `throw-same-payload`,
  ] as const)(
    `retains nested replay cleanup across adapter terminal form %s`,
    async (terminalForm) => {
      type Row = { id: string }
      const whereOuter = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`outer`),
      ])
      const whereCleanup = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`cleanup`),
      ])
      const whereInner = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`inner`),
      ])
      const nestedFailure = new Error(`nested cleanup failed`)
      const outerFailure = new Error(`outer replay failed`)
      const reported: Array<{
        error: unknown
        options: LoadSubsetOptions
      }> = []
      let begin!: () => void
      let commit!: () => true | Promise<void>
      let truncate!: () => void
      let replaying = false
      let outerLoads = 0
      let cleanupFailed = false
      let cleanupOptions: LoadSubsetOptions | undefined
      let replayOuterOptions: LoadSubsetOptions | undefined
      let cleanupUnloads = 0
      let caughtNestedFailure: unknown

      const collection = createCollection<Row>({
        id: `nested-cleanup-${terminalForm}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                if (sameWhere(options.where, whereInner)) {
                  subscription.releaseSnapshot(whereCleanup)
                  return true
                }
                if (!sameWhere(options.where, whereOuter)) return true
                outerLoads++
                if (!replaying || outerLoads !== 2) return true

                replayOuterOptions = options
                try {
                  subscription.requestSnapshot({ where: whereInner })
                } catch (error) {
                  caughtNestedFailure = error
                }

                if (terminalForm === `return`) return true
                if (terminalForm === `propagate`) throw caughtNestedFailure
                if (terminalForm === `throw-same-payload`) {
                  throw nestedFailure
                }
                throw outerFailure
              },
              unloadSubset: (options) => {
                if (!sameWhere(options.where, whereCleanup)) return
                cleanupUnloads++
                cleanupOptions ??= options
                if (!cleanupFailed) {
                  cleanupFailed = true
                  throw nestedFailure
                }
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {})
      subscription.on(`loadSubset:error`, ({ error, options }) =>
        reported.push({ error, options }),
      )

      try {
        subscription.requestSnapshot({ where: whereOuter })
        subscription.requestSnapshot({ where: whereCleanup })

        replaying = true
        begin()
        truncate()
        commit()
        await flushPromises()
        await flushPromises()

        expect(caughtNestedFailure).not.toBe(nestedFailure)
        const outerError =
          terminalForm === `throw-distinct`
            ? outerFailure
            : terminalForm === `throw-same-payload`
              ? nestedFailure
              : undefined
        expect(reported).toEqual([
          { error: nestedFailure, options: cleanupOptions },
          ...(outerError === undefined
            ? []
            : [{ error: outerError, options: replayOuterOptions }]),
        ])
        expect(subscription.lastErrorVersion).toBe(
          outerError === undefined ? 1 : 2,
        )

        subscription.releaseSnapshot(whereCleanup)
        expect(cleanupUnloads).toBe(2)
        expect(subscription.lastErrorVersion).toBe(
          outerError === undefined ? 1 : 2,
        )
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`dispatches the terminal event once under reentrant unsubscribe`, async () => {
    type Row = { id: string }
    const collection = createCollection<Row>({
      id: `reentrant-unsubscribe-listener`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          params.markReady()
          return { loadSubset: () => true }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})
    let calls = 0
    subscription.on(`unsubscribed`, () => {
      calls++
      subscription.unsubscribe()
    })

    expect(() => subscription.unsubscribe()).not.toThrow()
    expect(calls).toBe(1)
    await expect(collection.cleanup()).resolves.toBeUndefined()
  })

  it(`does not redispatch the terminal event while retrying cleanup debt`, async () => {
    type Row = { id: string }
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const cleanupFailure = new Error(`first cleanup attempt failed`)
    const events: Array<`first` | `retry`> = []
    let unloads = 0
    const collection = createCollection<Row>({
      id: `terminal-event-cleanup-retry`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {
              unloads++
              if (unloads === 1) throw cleanupFailure
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})
    subscription.requestSnapshot({ where })
    subscription.on(`unsubscribed`, () => events.push(`first`))

    expect(() => subscription.unsubscribe()).toThrow(cleanupFailure)
    subscription.on(`unsubscribed`, () => events.push(`retry`))
    expect(() => subscription.unsubscribe()).not.toThrow()

    expect(unloads).toBe(2)
    expect(events).toEqual([`first`])
    await expect(collection.cleanup()).resolves.toBeUndefined()
  })

  it(`preserves a synchronous acquisition failure nested inside cleanup`, async () => {
    type Row = { id: string }
    const whereA = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const whereB = new Func(`eq`, [new PropRef([`id`]), new Value(`b`)])
    const failure = new Error(`nested acquisition failed`)
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    let nestedOptions: LoadSubsetOptions | undefined
    type TestSubscription = ReturnType<
      ReturnType<typeof createCollection<Row>>[`subscribeChanges`]
    >
    const owner: { current?: TestSubscription } = {}
    const collection = createCollection<Row>({
      id: `synchronous-acquisition-failure-inside-cleanup`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (sameWhere(options.where, whereB)) {
                nestedOptions = options
                throw failure
              }
              return true
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (sameWhere(options.where, whereA)) {
                try {
                  owner.current!.requestSnapshot({ where: whereB })
                } catch {
                  // The surrounding cleanup boundary retains the attributed
                  // failure even after adapter code handles its propagation.
                }
              }
            },
          }
        },
      },
    })
    const reported: Array<{ error: unknown; options: LoadSubsetOptions }> = []
    const subscription = collection.subscribeChanges(() => {})
    owner.current = subscription
    subscription.on(`loadSubset:error`, (event) => reported.push(event))

    try {
      subscription.requestSnapshot({ where: whereA })
      let thrown: unknown
      try {
        subscription.releaseSnapshot(whereA)
      } catch (error) {
        thrown = error
      }

      expect(Object.is(thrown, failure)).toBe(true)
      expect(reported).toHaveLength(1)
      expect(Object.is(reported[0]?.error, failure)).toBe(true)
      expect(reported[0]?.options).toBe(nestedOptions)
      expect(unloads).toEqual([loads[0]])
      subscription.unsubscribe()
      expect(unloads).toEqual([loads[0]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`reports a promise-adopted acquisition failure nested inside cleanup once`, async () => {
    type Row = { id: string }
    const whereOuter = new Func(`eq`, [new PropRef([`id`]), new Value(`outer`)])
    const whereMiddle = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`middle`),
    ])
    const whereInner = new Func(`eq`, [new PropRef([`id`]), new Value(`inner`)])
    const failure = new Error(`nested asynchronous acquisition failed`)
    let innerOptions: LoadSubsetOptions | undefined
    type TestSubscription = ReturnType<
      ReturnType<typeof createCollection<Row>>[`subscribeChanges`]
    >
    const owner: { current?: TestSubscription } = {}
    const collection = createCollection<Row>({
      id: `promise-adopted-acquisition-failure-inside-cleanup`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: (options) => {
              if (sameWhere(options.where, whereInner)) {
                innerOptions = options
                throw failure
              }
              if (sameWhere(options.where, whereMiddle)) {
                return (async () => {
                  owner.current!.requestSnapshot({ where: whereInner })
                  await Promise.resolve()
                })()
              }
              return true
            },
            unloadSubset: (options) => {
              if (sameWhere(options.where, whereOuter)) {
                owner.current!.requestSnapshot({ where: whereMiddle })
              }
            },
          }
        },
      },
    })
    const reported: Array<{ error: unknown; options: LoadSubsetOptions }> = []
    const subscription = collection.subscribeChanges(() => {})
    owner.current = subscription
    subscription.on(`loadSubset:error`, ({ error, options }) =>
      reported.push({ error, options }),
    )

    try {
      subscription.requestSnapshot({ where: whereOuter })
      expect(() => subscription.releaseSnapshot(whereOuter)).toThrow(failure)
      await flushPromises()

      expect(reported).toHaveLength(1)
      expect(Object.is(reported[0]?.error, failure)).toBe(true)
      expect(reported[0]?.options).toBe(innerOptions)
      expect(subscription.lastError).toBe(failure)
      expect(subscription.lastErrorVersion).toBe(1)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each(
    ([`unordered`, `ordered`] as const).flatMap((demandKind) =>
      ([`throw`, `reject`] as const).map(
        (laterFailure) => [demandKind, laterFailure] as const,
      ),
    ),
  )(
    `does not let a retained propagation carrier erase a later %s %s`,
    async (demandKind, laterFailure) => {
      type Row = { id: string; rank: number }
      const whereOuter = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`outer`),
      ])
      const whereMiddle = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`middle`),
      ])
      const whereInner = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`inner`),
      ])
      const whereLater = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`later`),
      ])
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const failure = new Error(`retained carrier payload`)
      let retainedCarrier: unknown
      let innerOptions: LoadSubsetOptions | undefined
      let laterOptions: LoadSubsetOptions | undefined
      type TestSubscription = ReturnType<
        ReturnType<typeof createCollection<Row>>[`subscribeChanges`]
      >
      const owner: { current?: TestSubscription } = {}
      const collection = createCollection<Row>({
        id: `retained-propagation-carrier-${demandKind}-${laterFailure}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            params.markReady()
            return {
              loadSubset: (options) => {
                if (sameWhere(options.where, whereInner)) {
                  innerOptions = options
                  throw failure
                }
                if (sameWhere(options.where, whereMiddle)) {
                  try {
                    owner.current!.requestSnapshot({ where: whereInner })
                  } catch (error) {
                    retainedCarrier = error
                  }
                  return true
                }
                if (
                  sameWhere(options.where, whereLater) ||
                  (demandKind === `ordered` && options.orderBy !== undefined)
                ) {
                  laterOptions = options
                  if (laterFailure === `throw`) throw retainedCarrier
                  return Promise.reject(retainedCarrier)
                }
                return true
              },
              unloadSubset: (options) => {
                if (sameWhere(options.where, whereOuter)) {
                  owner.current!.requestSnapshot({ where: whereMiddle })
                }
              },
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const reported: Array<{ error: unknown; options: LoadSubsetOptions }> = []
      const subscription = collection.subscribeChanges(() => {})
      owner.current = subscription
      subscription.setOrderByIndex(index)
      subscription.on(`loadSubset:error`, ({ error, options }) =>
        reported.push({ error, options }),
      )

      try {
        subscription.requestSnapshot({ where: whereOuter })
        expect(() => subscription.releaseSnapshot(whereOuter)).toThrow(failure)
        expect(Object.is(retainedCarrier, failure)).toBe(false)

        const requestLater = () =>
          demandKind === `ordered`
            ? subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
            : subscription.requestSnapshot({ where: whereLater })
        if (laterFailure === `throw`) {
          expect(requestLater).toThrow(failure)
        } else {
          requestLater()
          await flushPromises()
        }

        expect(reported).toHaveLength(2)
        expect(Object.is(reported[0]?.error, failure)).toBe(true)
        expect(reported[0]?.options).toBe(innerOptions)
        expect(Object.is(reported[1]?.error, failure)).toBe(true)
        expect(reported[1]?.options).toBe(laterOptions)
        expect(subscription.lastError).toBe(failure)
        expect(subscription.lastErrorVersion).toBe(2)
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`keeps failures after asynchronous suspension as distinct adapter occurrences`, async () => {
    type Row = { id: string }
    const whereOuter = new Func(`eq`, [new PropRef([`id`]), new Value(`outer`)])
    const whereMiddle = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`middle`),
    ])
    const whereInner = new Func(`eq`, [new PropRef([`id`]), new Value(`inner`)])
    const failure = new Error(`shared asynchronous failure payload`)
    let middleOptions: LoadSubsetOptions | undefined
    let innerOptions: LoadSubsetOptions | undefined
    type TestSubscription = ReturnType<
      ReturnType<typeof createCollection<Row>>[`subscribeChanges`]
    >
    const owner: { current?: TestSubscription } = {}
    const collection = createCollection<Row>({
      id: `suspended-acquisition-failure-inside-cleanup`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: (options) => {
              if (sameWhere(options.where, whereInner)) {
                innerOptions = options
                throw failure
              }
              if (sameWhere(options.where, whereMiddle)) {
                middleOptions = options
                return (async () => {
                  await Promise.resolve()
                  owner.current!.requestSnapshot({ where: whereInner })
                })()
              }
              return true
            },
            unloadSubset: (options) => {
              if (sameWhere(options.where, whereOuter)) {
                owner.current!.requestSnapshot({ where: whereMiddle })
              }
            },
          }
        },
      },
    })
    const reported: Array<{ error: unknown; options: LoadSubsetOptions }> = []
    const subscription = collection.subscribeChanges(() => {})
    owner.current = subscription
    subscription.on(`loadSubset:error`, ({ error, options }) =>
      reported.push({ error, options }),
    )

    try {
      subscription.requestSnapshot({ where: whereOuter })
      subscription.releaseSnapshot(whereOuter)
      await flushPromises()

      expect(reported).toHaveLength(2)
      expect(Object.is(reported[0]?.error, failure)).toBe(true)
      expect(reported[0]?.options).toBe(innerOptions)
      expect(Object.is(reported[1]?.error, failure)).toBe(true)
      expect(reported[1]?.options).toBe(middleOptions)
      expect(subscription.lastError).toBe(failure)
      expect(subscription.lastErrorVersion).toBe(2)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it.each([
    { name: `Error`, failure: new Error(`shared cleanup payload`) },
    {
      name: `AggregateError`,
      failure: new AggregateError(
        [new Error(`inner cleanup payload`)],
        `shared cleanup payload`,
      ),
    },
    { name: `undefined`, failure: undefined },
    { name: `NaN`, failure: Number.NaN },
  ])(
    `distinguishes nested and outer cleanup occurrences with the same $name payload`,
    async ({ failure }) => {
      const result = await exerciseNestedCleanupGraph({
        id: `same-payload-nested-cleanup-${String(failure)}`,
        ids: [`a`, `b`],
        edges: new Map([[0, { targets: [1], catchFailures: true }]]),
        failures: new Map([
          [0, failure],
          [1, failure],
        ]),
      })

      expect(result.reported.map(({ error }) => error)).toEqual([
        failure,
        failure,
      ])
      expect(result.reported.map(({ optionsIndex }) => optionsIndex)).toEqual([
        1, 0,
      ])
      expect(result.beforeRetry).toEqual([0, 3, 1, 2])
      expect(result.afterRetry).toEqual([0, 3, 1, 2, 0, 1])
      expect(result.publishedIds).toEqual([`a`, `b`])
      expect(result.status).toBe(`ready`)
    },
  )

  it(`installs a completed handoff while retaining its nested cleanup failure`, async () => {
    const nestedFailure = new Error(`nested cleanup failed`)
    const result = await exerciseNestedCleanupGraph({
      id: `completed-handoff-with-nested-failure`,
      ids: [`a`, `b`],
      edges: new Map([[0, { targets: [1], catchFailures: true }]]),
      failures: new Map([[1, nestedFailure]]),
    })

    expect(result.reported).toEqual([{ error: nestedFailure, optionsIndex: 1 }])
    expect(result.beforeRetry).toEqual([0, 3, 1])
    expect(result.afterRetry).toEqual([0, 3, 1, 2, 1])
    expect(result.publishedIds).toEqual([`a`, `b`])
    expect(result.status).toBe(`ready`)
  })

  it(`preserves failure order and ownership through four cleanup levels`, async () => {
    const failureC = new Error(`C cleanup failed`)
    const failureD = new Error(`D cleanup failed`)
    const result = await exerciseNestedCleanupGraph({
      id: `four-level-nested-cleanup`,
      ids: [`a`, `b`, `c`, `d`],
      edges: new Map([
        [0, { targets: [1], catchFailures: false }],
        [1, { targets: [2], catchFailures: true }],
        [2, { targets: [3], catchFailures: true }],
      ]),
      failures: new Map([
        [2, failureC],
        [3, failureD],
      ]),
    })

    expect(result.reported).toEqual([
      { error: failureD, optionsIndex: 3 },
      { error: failureC, optionsIndex: 2 },
    ])
    expect(result.beforeRetry).toEqual([0, 5, 1, 6, 2, 7, 3, 4])
    expect(result.afterRetry).toEqual([0, 5, 1, 6, 2, 7, 3, 4, 0, 2, 3])
    expect(result.publishedIds).toEqual([`a`, `b`, `c`, `d`])
    expect(result.status).toBe(`ready`)
  })

  it(`preserves sibling cleanup failures in callback order`, async () => {
    const failureB = new Error(`B cleanup failed`)
    const failureC = new Error(`C cleanup failed`)
    const result = await exerciseNestedCleanupGraph({
      id: `sibling-nested-cleanup`,
      ids: [`a`, `b`, `c`],
      edges: new Map([[0, { targets: [1, 2], catchFailures: true }]]),
      failures: new Map([
        [1, failureB],
        [2, failureC],
      ]),
    })

    expect(result.reported).toEqual([
      { error: failureB, optionsIndex: 1 },
      { error: failureC, optionsIndex: 2 },
    ])
    expect(result.beforeRetry).toEqual([0, 4, 1, 5, 2])
    expect(result.afterRetry).toEqual([0, 4, 1, 5, 2, 3, 1, 2])
    expect(result.publishedIds).toEqual([`a`, `b`, `c`])
    expect(result.status).toBe(`ready`)
  })

  it(`collects inactive demand state after late replay cleanup succeeds`, async () => {
    type Row = { id: string; rank: number }
    type Outcome = { hasMore: boolean; appliedRowKeys: ReadonlyArray<string> }
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    let failReplayUnload = true
    const replay = createDeferred<Outcome>()
    const loads: Array<LoadSubsetOptions> = []
    const unloadSignals: Array<AbortSignal | undefined> = []
    const collection = createCollection<Row>({
      id: `late-replay-cleanup-collection`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `a`, rank: 1 } })
                commit()
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [`a`],
                })
              }
              return replay.promise
            },
            unloadSubset: (options) => {
              unloadSignals.push(options.signal)
              if (options.signal === loads[1]?.signal && failReplayUnload) {
                failReplayUnload = false
                throw new Error(`replay unload failed`)
              }
            },
          }
        },
      },
    })
    const where = new Func(`gte`, [new PropRef([`rank`]), new Value(0)])
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const subscription = collection.subscribeChanges(() => {}, {
      whereExpression: where,
    })
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()
      begin()
      truncate()
      commit()
      await flushPromises()

      expect(() => subscription.releaseSnapshot(where)).toThrow(
        `replay unload failed`,
      )
      replay.resolve({ hasMore: false, appliedRowKeys: [] })
      await flushPromises()

      expect(unloadSignals).toEqual([
        loads[1]?.signal,
        loads[0]?.signal,
        loads[1]?.signal,
      ])
      subscription.unsubscribe()
      expect(unloadSignals).toHaveLength(3)
    } finally {
      failReplayUnload = false
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`restores top-K admission when ordered demand restarts over a stale additional row`, async () => {
    type Row = { id: string; rank: number }
    let begin!: () => void
    let write!: (message: ChangeMessageOrDeleteKeyMessage<Row, string>) => void
    let commit!: (signal?: AbortSignal) => true | Promise<void>
    let truncate!: () => void
    let loadCount = 0
    const collection = createCollection<Row>({
      id: `ordered-restart-over-stale-additional-row`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `a`, rank: 1 } })
                commit(options.signal)
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [`a`] as const,
                })
              }
              if (loadCount === 2) return true
              if (loadCount === 3) {
                return Promise.reject(new Error(`ordered replay failed`))
              }
              if (loadCount === 4) {
                begin()
                write({ type: `insert`, value: { id: `a`, rank: 1 } })
                commit(options.signal)
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [`a`] as const,
                })
              }
              if (loadCount === 5) {
                begin()
                write({ type: `insert`, value: { id: `x`, rank: 0 } })
                write({ type: `insert`, value: { id: `y`, rank: 2 } })
                commit(options.signal)
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [`x`, `y`] as const,
                })
              }
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const orderedWhere = new Func(`gte`, [new PropRef([`rank`]), new Value(0)])
    const additionalWhere = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`a`),
    ])
    const orderBy: OrderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc`, nulls: `first` },
      },
    ]
    const index = collection.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
    })
    const visible = new Map<string, Row>()
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          const key = String(change.key)
          if (change.type === `delete`) visible.delete(key)
          else visible.set(key, change.value)
        }
      },
      { whereExpression: orderedWhere },
    )
    subscription.setOrderByIndex(index)

    try {
      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()
      subscription.requestSnapshot({ where: additionalWhere })
      await flushPromises()

      begin()
      truncate()
      commit()
      await flushPromises()
      subscription.releaseSnapshot(orderedWhere)

      expect([...visible.keys()]).toEqual([`a`])
      expect(subscription.orderedBoundaryKey).toBeUndefined()

      subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
      await flushPromises()

      expect([...visible.keys()].sort()).toEqual([`a`, `x`])
      expect(subscription.orderedBoundaryKey).toBe(`x`)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`rejects a reentrant subset acquisition after unsubscribe starts`, async () => {
    type Row = { id: string }
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`a`)])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    let acquireDuringUnload = () => {}
    let reentered = false
    const collection = createCollection<Row>({
      id: `unsubscribe-reentrant-acquisition`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => {
              unloads.push(options)
              if (!reentered) {
                reentered = true
                acquireDuringUnload()
              }
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {})
    acquireDuringUnload = () => {
      subscription.requestSnapshot({ where })
    }

    try {
      subscription.requestSnapshot({ where })
      subscription.unsubscribe()

      expect(loads).toHaveLength(1)
      expect(unloads).toEqual(loads)
      expect(loads[0]?.signal?.aborted).toBe(true)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`uses the published replacement as the baseline of a reentrant replay`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const replayLoads: Array<ReturnType<typeof createDeferred<void>>> = []
    const collection = createCollection<ReplayRow>({
      id: `reentrant-replay`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: () => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 1 } })
                commit()
                return true
              }

              const deferred = createDeferred<void>()
              replayLoads.push(deferred)
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    let startedNestedReplay = false
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key)
        else {
          visible.set(change.key, {
            id: change.value.id,
            value: change.value.value,
          })
        }
      }

      if (!startedNestedReplay && visible.get(`one`)?.value === 2) {
        startedNestedReplay = true
        begin()
        truncate()
        commit()
      }
    })

    try {
      subscription.requestSnapshot({ optimizedOnly: false })
      begin()
      truncate()
      commit()
      await flushPromises()
      begin()
      write({ type: `insert`, value: { id: `one`, value: 2 } })
      commit()
      replayLoads[0]?.resolve()
      await flushPromises()
      expect(startedNestedReplay).toBe(true)

      replayLoads[1]?.reject(new Error(`nested replay failed`))
      await flushPromises()
      begin()
      write({ type: `insert`, value: { id: `one`, value: 1 } })
      commit()

      expect(sortedRows(visible)).toEqual([{ id: `one`, value: 1 }])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`ignores an aborted released demand while publishing the remaining replay`, async () => {
    let begin!: () => void
    let write!: (
      message: ChangeMessageOrDeleteKeyMessage<ReplayRow, string>,
    ) => void
    let commit!: () => void
    let truncate!: () => void
    const replays: Array<{
      options: { signal?: AbortSignal }
      deferred: ReturnType<typeof createDeferred<void>>
    }> = []
    let loadCount = 0
    const collection = createCollection<ReplayRow>({
      id: `released-demand-replay`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: (options) => {
              loadCount++
              if (loadCount === 1) {
                begin()
                write({ type: `insert`, value: { id: `one`, value: 0 } })
                write({ type: `insert`, value: { id: `two`, value: 0 } })
                commit()
                return true
              }
              if (loadCount === 2) return true

              const deferred = createDeferred<void>()
              replays.push({ options, deferred })
              return deferred.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<string | number, ReplayRow>()
    const subscription = collection.subscribeChanges((changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key)
        else {
          visible.set(change.key, {
            id: change.value.id,
            value: change.value.value,
          })
        }
      }
    })
    const demandOne = new Func(`eq`, [new PropRef([`id`]), new Value(`one`)])
    const demandTwo = new Func(`eq`, [new PropRef([`id`]), new Value(`two`)])

    try {
      subscription.requestSnapshot({ where: demandOne })
      subscription.requestSnapshot({ where: demandTwo })
      begin()
      truncate()
      commit()
      await flushPromises()

      subscription.releaseSnapshot(demandOne)
      expect(replays[0]?.options.signal?.aborted).toBe(true)
      replays[0]?.deferred.reject(new DOMException(`obsolete`, `AbortError`))
      begin()
      write({ type: `insert`, value: { id: `two`, value: 2 } })
      commit()
      replays[1]?.deferred.resolve()
      await flushPromises()

      expect(sortedRows(visible)).toEqual([{ id: `two`, value: 2 }])
      expect(subscription.lastError).toBeUndefined()
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  const orderedReplayCases = ([`asc`, `desc`] as const).flatMap((direction) => [
    ...([`return`, `resolve`] as const).flatMap((delivery) =>
      ([`same`, `changed`] as const).map((identity) => ({
        name: `${direction} ${delivery} with ${identity} keys`,
        direction,
        delivery,
        identity,
      })),
    ),
    ...([`throw`, `reject`] as const).map((delivery) => ({
      name: `${direction} ${delivery}`,
      direction,
      delivery,
      identity: `none` as const,
    })),
  ])

  it.each(orderedReplayCases)(
    `restores ordered offset and cursor state after replay: $name`,
    async ({ direction, delivery, identity }) => {
      type OrderedReplayRow = {
        id: `one` | `two` | `three` | `four`
        value: number
      }
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<OrderedReplayRow, string>,
      ) => void
      let commit!: () => void
      let truncate!: () => void
      let loadCount = 0
      const loadOptions: Array<LoadSubsetOptions> = []
      const replayLoads: Array<
        ReturnType<
          typeof createDeferred<{
            hasMore: boolean
            appliedRowKeys: Array<OrderedReplayRow[`id`]>
          }>
        >
      > = []
      const replayRows: ReadonlyArray<OrderedReplayRow> =
        identity === `same`
          ? [
              { id: `one`, value: 1 },
              { id: `two`, value: 2 },
            ]
          : [
              { id: `three`, value: 1 },
              { id: `four`, value: 2 },
            ]
      let replayRowsInstalled = false
      const installReplayRows = () => {
        if (replayRowsInstalled || identity === `none`) return
        replayRowsInstalled = true
        begin()
        for (const row of replayRows) {
          write({ type: `insert`, value: row })
        }
        commit()
      }
      const collection = createCollection<OrderedReplayRow>({
        id: `ordered-replay-${direction}-${delivery}-${identity}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                loadCount++
                loadOptions.push(options)
                if (loadCount === 1) {
                  const row =
                    direction === `asc`
                      ? ({ id: `one`, value: 1 } as const)
                      : ({ id: `two`, value: 2 } as const)
                  begin()
                  write({ type: `insert`, value: row })
                  commit()
                  return Promise.resolve({
                    hasMore: true,
                    appliedRowKeys: [row.id],
                  })
                }
                if (loadCount === 2) {
                  const row =
                    direction === `asc`
                      ? ({ id: `two`, value: 2 } as const)
                      : ({ id: `one`, value: 1 } as const)
                  begin()
                  write({ type: `insert`, value: row })
                  commit()
                  return Promise.resolve({
                    hasMore: false,
                    appliedRowKeys: [row.id],
                  })
                }

                if (loadCount > 4) return true

                if (delivery === `return`) {
                  installReplayRows()
                  return true
                }
                if (delivery === `throw`) {
                  if (loadCount === 3) {
                    throw new Error(`ordered replay failed`)
                  }
                  return true
                }

                const deferred = createDeferred<{
                  hasMore: boolean
                  appliedRowKeys: Array<OrderedReplayRow[`id`]>
                }>()
                replayLoads.push(deferred)
                return deferred.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.value, {
        indexType: BTreeIndex,
      })
      const orderedIndex = direction === `asc` ? index : new ReverseIndex(index)
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`value`]),
          compareOptions: { direction, nulls: `first` },
        },
      ]
      const batches: Array<Array<OrderedReplayRow[`id`]>> = []
      const visibleIds = new Set<OrderedReplayRow[`id`]>()
      const publicationSnapshots: Array<Array<OrderedReplayRow[`id`]>> = []
      const subscription = collection.subscribeChanges((changes) => {
        batches.push(changes.map(({ value }) => value.id))
        for (const change of changes) {
          if (change.type === `delete`)
            visibleIds.delete(change.key as OrderedReplayRow[`id`])
          else visibleIds.add(change.key as OrderedReplayRow[`id`])
        }
        publicationSnapshots.push([...visibleIds].sort())
      })
      subscription.setOrderByIndex(orderedIndex)

      const initialIds =
        direction === `asc`
          ? ([`one`, `two`] as const)
          : ([`two`, `one`] as const)
      const replacementIds =
        direction === `asc`
          ? ([`three`, `four`] as const)
          : ([`four`, `three`] as const)
      const succeeds = delivery === `return` || delivery === `resolve`
      const expectedIds = identity === `changed` ? replacementIds : initialIds

      try {
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        await flushPromises()
        // A finite ordered result stays unpublished until the continuation
        // proves the complete boundary class used for the public-key tie-break.
        expect(batches).toEqual([])
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          minValues: [direction === `asc` ? 1 : 2],
        })
        await flushPromises()
        expect(batches).toEqual([[initialIds[0]]])
        expect(loadOptions[1]).toMatchObject({
          offset: 0,
          cursor: { lastKey: initialIds[0] },
        })

        begin()
        truncate()
        commit()
        await flushPromises()
        const replayOptions = loadOptions
          .slice(2)
          .filter((options) => options.limit !== undefined)
        expectReplayRequestToRestart(replayOptions[0]!, loadOptions[0]!)
        expectReplayRequestToRestart(
          replayOptions[1]!,
          loadOptions[1]!,
          // A synchronous first replay acquisition can establish private
          // current-generation progress before the second one is rebuilt.
          delivery === `return` ? 1 : 0,
        )

        if (delivery === `resolve` || delivery === `reject`) {
          const batchesBeforeResize = batches.length
          subscription.ensureOrderedWindowSize(2)
          subscription.ensureOrderedWindowSize(1)
          expect(batches).toHaveLength(batchesBeforeResize)
        }

        if (delivery === `resolve`) {
          expect(replayLoads).toHaveLength(2)
          installReplayRows()
          replayLoads[0]?.resolve({
            hasMore: true,
            appliedRowKeys: [expectedIds[0]],
          })
          replayLoads[1]?.resolve({
            hasMore: false,
            appliedRowKeys: [expectedIds[1]],
          })
        } else if (delivery === `reject`) {
          expect(replayLoads).toHaveLength(2)
          replayLoads[0]?.reject(new Error(`ordered replay failed`))
          replayLoads[1]?.resolve({
            hasMore: false,
            appliedRowKeys: [initialIds[1]],
          })
        } else {
          expect(replayLoads).toEqual([])
        }
        await flushPromises()
        expect(collection.toArray.map(({ id }) => id).sort()).toEqual(
          succeeds ? [...expectedIds].sort() : [],
        )
        expect(publicationSnapshots).toEqual(
          delivery === `resolve`
            ? [[initialIds[0]], [...expectedIds].sort()]
            : delivery === `return` && identity === `changed`
              ? [[initialIds[0]], [expectedIds[0]]]
              : [[initialIds[0]]],
        )

        const loadCountBeforeWiden = loadOptions.length
        subscription.requestLimitedSnapshot({
          orderBy,
          limit: 1,
          minValues: [direction === `asc` ? 2 : 1],
        })
        if (succeeds) {
          expect(loadOptions).toHaveLength(loadCountBeforeWiden)
        } else {
          expect(loadOptions[loadCountBeforeWiden]).toMatchObject({
            offset: 1,
            cursor: { lastKey: initialIds[0] },
          })
        }
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it.each([`resolve`, `reject`] as const)(
    `keeps an empty ordered publication private until every replay demand settles: %s`,
    async (otherOutcome) => {
      type Row = {
        id: `new-ordered`
        rank: number
        route: `ordered` | `other`
      }
      type Outcome = {
        hasMore: boolean
        appliedRowKeys: ReadonlyArray<Row[`id`]>
      }
      let begin!: () => void
      let write!: (
        message: ChangeMessageOrDeleteKeyMessage<Row, Row[`id`]>,
      ) => void
      let commit!: () => void
      let truncate!: () => void
      let initialLoads = 2
      const history: Array<LoadSubsetFullFlowEvent> = [
        {
          type: `stagePublicationRows`,
          publicationId: `initial`,
          demandId: `ordered`,
          rows: [],
        },
        { type: `commitPublication`, publicationId: `initial` },
        {
          type: `requestDemand`,
          ownerId: `other-owner`,
          sessionId: `session`,
          demandId: `other`,
          attemptId: `other-attempt`,
          alreadyAborted: false,
        },
        {
          type: `stagePublicationRows`,
          publicationId: `initial`,
          demandId: `other`,
          rows: [],
        },
        { type: `commitPublication`, publicationId: `initial` },
      ]
      const expectedBoundary = () =>
        projectAtomicOrderedPublicationState(history, {
          demandId: `ordered`,
          direction: `asc`,
          initialWindowSize: 1,
        }).currentPublication?.orderedBoundary?.key
      const replayLoads: Array<{
        options: LoadSubsetOptions
        deferred: ReturnType<typeof createDeferred<Outcome>>
      }> = []
      const collection = createCollection<Row>({
        id: `empty-ordered-replay-${otherOutcome}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        sync: {
          sync: (params) => {
            begin = params.begin
            write = params.write
            commit = params.commit
            truncate = params.truncate
            params.markReady()
            return {
              loadSubset: (options) => {
                if (initialLoads > 0) {
                  initialLoads--
                  return Promise.resolve({
                    hasMore: false,
                    appliedRowKeys: [],
                  })
                }
                const deferred = createDeferred<Outcome>()
                replayLoads.push({ options, deferred })
                return deferred.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const index = collection.createIndex((row) => row.rank, {
        indexType: BTreeIndex,
      })
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`rank`]),
          compareOptions: { direction: `asc`, nulls: `first` },
        },
      ]
      const otherWhere = new Func(`eq`, [
        new PropRef([`route`]),
        new Value(`other`),
      ])
      const visible = new Set<Row[`id`]>()
      const subscription = collection.subscribeChanges((changes) => {
        for (const change of changes) {
          const key = change.key as Row[`id`]
          if (change.type === `delete`) visible.delete(key)
          else visible.add(key)
        }
      })
      subscription.setOrderByIndex(index)

      try {
        subscription.requestLimitedSnapshot({ orderBy, limit: 1 })
        subscription.requestSnapshot({ where: otherWhere })
        await flushPromises()
        expect([...visible]).toEqual([])
        expect(subscription.orderedBoundaryKey).toBeUndefined()

        begin()
        truncate()
        commit()
        await flushPromises()
        expect(replayLoads).toHaveLength(2)
        history.push({
          type: `beginReplacement`,
          publicationId: `replacement`,
          demandIds: [`ordered`, `other`],
        })

        const orderedReplay = replayLoads.find(({ options }) => options.orderBy)
        const otherReplay = replayLoads.find(({ options }) => !options.orderBy)
        if (!orderedReplay || !otherReplay) {
          throw new Error(`Expected ordered and additional replay demands`)
        }

        begin()
        write({
          type: `insert`,
          value: { id: `new-ordered`, rank: 1, route: `ordered` },
        })
        commit()
        history.push({
          type: `stagePublicationRows`,
          publicationId: `replacement`,
          demandId: `ordered`,
          rows: [{ key: `new-ordered`, orderValue: 1 }],
        })
        orderedReplay.deferred.resolve({
          hasMore: false,
          appliedRowKeys: [`new-ordered`],
        })
        history.push({
          type: `settleReplacement`,
          publicationId: `replacement`,
          demandId: `ordered`,
          outcome: `success`,
          extent: `exhausted`,
        })
        await flushPromises()

        expect([...visible]).toEqual([])
        expect(subscription.orderedBoundaryKey).toBe(expectedBoundary())

        if (otherOutcome === `resolve`) {
          otherReplay.deferred.resolve({
            hasMore: false,
            appliedRowKeys: [],
          })
          history.push({
            type: `settleReplacement`,
            publicationId: `replacement`,
            demandId: `other`,
            outcome: `success`,
            extent: `exhausted`,
          })
        } else {
          otherReplay.deferred.reject(new Error(`other replay failed`))
          history.push({
            type: `settleReplacement`,
            publicationId: `replacement`,
            demandId: `other`,
            outcome: `failure`,
          })
        }
        await flushPromises()

        expect([...visible]).toEqual(
          otherOutcome === `resolve` ? [`new-ordered`] : [],
        )
        expect(subscription.orderedBoundaryKey).toBe(expectedBoundary())

        if (otherOutcome === `resolve`) {
          // Fail the next generation so the changed-key publication becomes
          // the retained restoration baseline, then widen it. The request must
          // continue from the new public key and prefix.
          begin()
          truncate()
          commit()
          await flushPromises()
          const nextReplayLoads = replayLoads.slice(2)
          expect(nextReplayLoads).toHaveLength(2)
          history.push({
            type: `beginReplacement`,
            publicationId: `failed-replacement`,
            demandIds: [`ordered`, `other`],
          })
          const nextOrderedReplay = nextReplayLoads.find(
            ({ options }) => options.orderBy,
          )
          const nextOtherReplay = nextReplayLoads.find(
            ({ options }) => !options.orderBy,
          )
          if (!nextOrderedReplay || !nextOtherReplay) {
            throw new Error(`Expected the next ordered and additional replays`)
          }
          nextOrderedReplay.deferred.reject(new Error(`next replay failed`))
          history.push({
            type: `settleReplacement`,
            publicationId: `failed-replacement`,
            demandId: `ordered`,
            outcome: `failure`,
          })
          nextOtherReplay.deferred.resolve({
            hasMore: false,
            appliedRowKeys: [],
          })
          history.push({
            type: `settleReplacement`,
            publicationId: `failed-replacement`,
            demandId: `other`,
            outcome: `success`,
            extent: `exhausted`,
          })
          await flushPromises()
          expect(subscription.orderedBoundaryKey).toBe(expectedBoundary())

          const loadCountBeforeWiden = replayLoads.length
          subscription.requestLimitedSnapshot({
            orderBy,
            limit: 1,
            minValues: [1],
          })
          expect(replayLoads[loadCountBeforeWiden]?.options).toMatchObject({
            offset: 1,
            cursor: { lastKey: `new-ordered` },
          })
          replayLoads[loadCountBeforeWiden]?.deferred.resolve({
            hasMore: false,
            appliedRowKeys: [],
          })
          await flushPromises()
        }
      } finally {
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`publishes a same-key replacement after a failed replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandIds: [`one`],
      attempts: [
        {
          loads: [{ demandId: `one`, rows: [], outcome: `reject` }],
        },
      ],
      settlementOrder: [0],
      settlementPhases: [0],
      afterSettlement: [{ type: `put`, row: { id: `one`, value: 2 } }],
    })
  })

  it(`does not let an unpublished truncate delete suppress a later insert`, async () => {
    await runReplayScenario({
      initialRows: [],
      demandIds: [`two`, `one`],
      attempts: [
        {
          loads: [
            {
              demandId: `two`,
              rows: [{ id: `two`, value: -1 }],
              outcome: `resolve`,
            },
            { demandId: `one`, rows: [], outcome: `reject` },
          ],
        },
        {
          loads: [
            { demandId: `two`, rows: [], outcome: `resolve` },
            {
              demandId: `one`,
              rows: [{ id: `one`, value: -1 }],
              outcome: `resolve`,
            },
          ],
        },
      ],
      settlementOrder: [0, 1, 2, 3],
      settlementPhases: [0, 0, 1, 1],
      afterSettlement: [{ type: `put`, row: { id: `two`, value: 1 } }],
    })
  })

  it(`lets the newest successful replay replace an older failed replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandIds: [`one`],
      attempts: [
        {
          loads: [{ demandId: `one`, rows: [], outcome: `reject` }],
        },
        {
          loads: [
            {
              demandId: `one`,
              rows: [{ id: `one`, value: 2 }],
              outcome: `resolve`,
            },
          ],
        },
      ],
      settlementOrder: [1, 0],
      settlementPhases: [1, 1],
      afterSettlement: [],
    })
  })

  it(`ignores an obsolete replay that settles after the newest replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 0 }],
      demandIds: [`one`],
      attempts: [
        {
          loads: [
            {
              demandId: `one`,
              rows: [{ id: `one`, value: 1 }],
              outcome: `resolve`,
            },
          ],
        },
        {
          loads: [
            {
              demandId: `one`,
              rows: [{ id: `one`, value: 2 }],
              outcome: `resolve`,
            },
          ],
        },
      ],
      settlementOrder: [1, 0],
      settlementPhases: [1, 1],
      afterSettlement: [],
    })
  })

  it(`releases every successful overlapping replay acquisition`, async () => {
    await runReplayScenario({
      initialRows: [],
      demandIds: [`one`],
      attempts: [
        {
          loads: [{ demandId: `one`, rows: [], outcome: `resolve` }],
        },
        {
          loads: [{ demandId: `one`, rows: [], outcome: `resolve` }],
        },
      ],
      settlementOrder: [1, 0],
      settlementPhases: [1, 1],
      afterSettlement: [],
    })
  })

  it(`uses the newest complete multi-demand replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandIds: [`one`, `two`],
      attempts: [
        {
          loads: [
            {
              demandId: `one`,
              rows: [{ id: `one`, value: 2 }],
              outcome: `resolve`,
            },
            { demandId: `two`, rows: [], outcome: `reject` },
          ],
        },
        {
          loads: [
            {
              demandId: `one`,
              rows: [{ id: `one`, value: 3 }],
              outcome: `resolve`,
            },
            {
              demandId: `two`,
              rows: [{ id: `two`, value: 4 }],
              outcome: `resolve`,
            },
          ],
        },
      ],
      settlementOrder: [2, 3, 0, 1],
      settlementPhases: [1, 1, 1, 1],
      afterSettlement: [],
    })
  })

  it(`excludes rows written before their replay demand is released`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `two`, value: 0 }],
      demandIds: [`one`, `two`],
      attempts: [
        {
          loads: [
            {
              demandId: `one`,
              rows: [{ id: `one`, value: 1 }],
              outcome: `reject`,
              writeBeforeSettlement: true,
            },
            {
              demandId: `two`,
              rows: [{ id: `two`, value: 2 }],
              outcome: `resolve`,
            },
          ],
        },
      ],
      settlementOrder: [0, 1],
      settlementPhases: [0, 0],
      releaseOnLastAttempt: `one`,
      afterSettlement: [{ type: `request`, demandId: `one` }],
    })
  })

  it(`replaces a retained snapshot with a later empty replay`, async () => {
    await runReplayScenario({
      initialRows: [{ id: `one`, value: 1 }],
      demandIds: [`one`],
      attempts: [
        {
          loads: [{ demandId: `one`, rows: [], outcome: `reject` }],
        },
        {
          loads: [{ demandId: `one`, rows: [], outcome: `resolve` }],
        },
      ],
      settlementOrder: [0, 1],
      settlementPhases: [0, 1],
      afterSettlement: [],
    })
  })

  fcTest.prop([replayScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1756,
  })(
    `matches replay and ownership laws for a fixed seed`,
    runReplayScenario,
    generatedTimeout,
  )

  fcTest.prop(
    [replayScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed, replayPath),
  )(
    `matches replay and ownership laws for a random or replayed seed`,
    runReplayScenario,
    generatedTimeout,
  )

  fcTest.prop(
    [sequentialReplayScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed, replayPath),
  )(
    `matches synchronous, asynchronous, and partial-failure replay laws`,
    runSequentialReplayScenario,
    generatedTimeout,
  )

  it(`releases every exact acquisition once across bounded replay completion histories`, async () => {
    for (const scenario of exhaustiveReplayCompletionScenarios) {
      await runReplayCompletionScenario(scenario)
    }
  })

  fcTest.prop([replayCompletionScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1761,
  })(
    `preserves replay completion authority for a fixed seed`,
    runReplayCompletionScenario,
  )

  fcTest.prop(
    [replayCompletionScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed, replayPath),
  )(
    `preserves replay completion authority for a random or replayed seed`,
    runReplayCompletionScenario,
  )

  fcTest.prop([cleanupRestartScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1757,
  })(
    `isolates cleanup and restart sessions for a fixed seed`,
    runCleanupRestartScenario,
    generatedTimeout,
  )

  fcTest.prop(
    [cleanupRestartScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed, replayPath),
  )(
    `isolates cleanup and restart sessions for a random or replayed seed`,
    runCleanupRestartScenario,
    generatedTimeout,
  )

  fcTest.prop([sharedSubscriptionScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1758,
  })(
    `keeps shared transport and logical ownership distinct for a fixed seed`,
    runSharedSubscriptionScenario,
    generatedTimeout,
  )

  fcTest.prop(
    [sharedSubscriptionScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed, replayPath),
  )(
    `keeps shared transport and logical ownership distinct for a random or replayed seed`,
    runSharedSubscriptionScenario,
    generatedTimeout,
  )

  fcTest.prop([optimisticReplayScenarioArbitrary], {
    numRuns: generatedRuns,
    seed: 1759,
  })(
    `preserves optimistic overlays across replay outcomes for a fixed seed`,
    runOptimisticReplayScenario,
    generatedTimeout,
  )

  fcTest.prop(
    [optimisticReplayScenarioArbitrary],
    oracleRandomParameters(generatedRuns, replaySeed, replayPath),
  )(
    `preserves optimistic overlays across replay outcomes for a random or replayed seed`,
    runOptimisticReplayScenario,
    generatedTimeout,
  )
})
