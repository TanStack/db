import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex, ReverseIndex } from '../../src/index.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { createEffect } from '../../src/query/effect.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import { LIVE_QUERY_INTERNAL } from '../../src/query/live/internal.js'
import { computeOrderedLoadCursor } from '../../src/query/live/utils.js'
import { WindowState } from '../../src/query/live/window-state.js'
import { evaluateReferenceExpression } from '../reference-expression.js'
import {
  projectAdapterLifecycle,
  projectAtomicOrderedPublicationState,
  projectAtomicOrderedPublications,
  projectAuthorizedContinuationStarts,
  projectOrderedContinuationEvidence,
  projectOrderedPublicationBoundary,
  projectRetainedRowKeys,
  projectReusableDemands,
  projectTransportLoads,
} from '../load-subset-full-flow-model.js'
import { flushPromises, mockSyncCollectionOptions } from '../utils.js'
import {
  oracleRandomParameters,
  readOracleRunConfig,
} from '../oracle-config.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import type { LoadSubsetOptions, WritableDeep } from '../../src/types.js'
import type { LoadSubsetFullFlowEvent } from '../load-subset-full-flow-model.js'

type AdapterLifecycleEvent =
  | { type: `start`; options: LoadSubsetOptions }
  | { type: `release`; options: LoadSubsetOptions }

function eventTypes(
  events: ReadonlyArray<AdapterLifecycleEvent>,
): Array<AdapterLifecycleEvent[`type`]> {
  return events.map((event) => event.type)
}

function visibleRows<Row extends { id: string; value: number }>(
  values: Iterable<Row>,
): Array<{ id: string; value: number }> {
  return Array.from(values, ({ id, value }) => ({ id, value }))
}

type TruncateCoverageScenario = {
  oldRequest: `none` | `settles-late`
  freshResult: `authoritative` | `unknown` | `reject`
  settlementOrder: `old-first` | `fresh-first`
}

const truncateCoverageScenarioArbitrary: fc.Arbitrary<TruncateCoverageScenario> =
  fc.record({
    oldRequest: fc.constantFrom(`none` as const, `settles-late` as const),
    freshResult: fc.constantFrom(
      `authoritative` as const,
      `unknown` as const,
      `reject` as const,
    ),
    settlementOrder: fc.constantFrom(
      `old-first` as const,
      `fresh-first` as const,
    ),
  })

const exhaustiveTruncateCoverageScenarios: Array<TruncateCoverageScenario> = [
  `none` as const,
  `settles-late` as const,
].flatMap((oldRequest) =>
  ([`authoritative`, `unknown`, `reject`] as const).flatMap((freshResult) =>
    ([`old-first`, `fresh-first`] as const).map((settlementOrder) => ({
      oldRequest,
      freshResult,
      settlementOrder,
    })),
  ),
)

const { multiplier: fullFlowMultiplier, replaySeed: fullFlowReplaySeed } =
  readOracleRunConfig()

let truncateCoverageHarnessId = 0

async function runTruncateCoverageScenario(
  scenario: TruncateCoverageScenario,
): Promise<void> {
  type Row = { id: string; value: number }
  type AdapterResult = {
    hasMore: boolean | undefined
    appliedRowKeys: ReadonlyArray<string>
  }
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  const pending = new Map<
    LoadSubsetOptions,
    ReturnType<typeof createDeferred<AdapterResult>>
  >()
  const unloadSubset = vi.fn()
  const source = createCollection<Row>({
    id: `truncate-coverage-oracle-${truncateCoverageHarnessId++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: (options) => {
            const request = createDeferred<AdapterResult>()
            pending.set(options, request)
            return request.promise
          },
          unloadSubset,
        }
      },
    },
  })
  const initialOptions = { limit: 1 }
  const oldOptions = { limit: 2 }
  const freshOptions = { limit: 3 }
  const histories: Array<LoadSubsetFullFlowEvent> = []
  const activeOptions: Array<LoadSubsetOptions> = []

  const request = (ownerId: string, options: LoadSubsetOptions) => {
    histories.push({
      type: `requestDemand`,
      ownerId,
      sessionId: `session`,
      demandId: `prefix-${options.limit}`,
      alreadyAborted: false,
    })
    activeOptions.push(options)
    const result = source._sync.loadSubset(options)
    if (result === true) throw new Error(`Expected a controlled async request`)
    return result
  }

  const apply = async (
    ownerId: string,
    options: LoadSubsetOptions,
    rows: ReadonlyArray<Row>,
    hasMore: boolean | undefined,
  ) => {
    begin()
    for (const row of rows) write({ type: `insert`, value: row })
    const applied = commit()
    if (applied !== true) await applied
    pending.get(options)!.resolve({
      hasMore,
      appliedRowKeys: rows.map(({ id }) => id),
    })
    histories.push({
      type:
        hasMore === undefined ? `applyUnprovenRows` : `applyAuthoritativeRows`,
      ownerId,
      demandId: `prefix-${options.limit}`,
      rowKeys: rows.map(({ id }) => id),
    })
  }

  const reject = (ownerId: string, options: LoadSubsetOptions) => {
    pending.get(options)!.reject(new Error(`fresh replay failed`))
    histories.push({
      type: `rejectDemand`,
      ownerId,
      demandId: `prefix-${options.limit}`,
    })
  }

  const expectModel = () => {
    const actualReusable = activeOptions
      .filter(
        (options) => source._sync.getLoadSubsetOutcome(options) !== undefined,
      )
      .map((options) => `prefix-${options.limit}`)
      .sort()
    expect(actualReusable).toEqual(projectReusableDemands(histories))
    expect(Array.from(source.keys()).sort()).toEqual(
      projectRetainedRowKeys(histories),
    )
  }

  try {
    const initialLoad = request(`initial`, initialOptions)
    await apply(`initial`, initialOptions, [{ id: `initial`, value: 1 }], false)
    await initialLoad
    expectModel()

    const oldLoad =
      scenario.oldRequest === `settles-late`
        ? request(`old`, oldOptions)
        : undefined

    begin()
    truncate()
    const truncated = commit()
    if (truncated !== true) await truncated
    histories.push({ type: `truncateSource`, sessionId: `session` })
    expectModel()

    const freshLoad = request(`fresh`, freshOptions)
    const settleOld = async () => {
      if (!oldLoad) return
      await apply(`old`, oldOptions, [{ id: `old`, value: 2 }], false)
      await oldLoad
      expectModel()
    }
    const settleFresh = async () => {
      if (scenario.freshResult === `reject`) {
        reject(`fresh`, freshOptions)
        await expect(freshLoad).rejects.toThrow(`fresh replay failed`)
      } else {
        await apply(
          `fresh`,
          freshOptions,
          [{ id: `fresh`, value: 3 }],
          scenario.freshResult === `authoritative` ? false : undefined,
        )
        await freshLoad
      }
      expectModel()
    }

    if (scenario.settlementOrder === `fresh-first`) {
      await settleFresh()
      await settleOld()
    } else {
      await settleOld()
      await settleFresh()
    }

    for (const options of activeOptions) {
      source._sync.unloadSubset(options)
      histories.push({
        type: `releaseDemand`,
        ownerId:
          options === initialOptions
            ? `initial`
            : options === oldOptions
              ? `old`
              : `fresh`,
        demandId: `prefix-${options.limit}`,
        rowKeys:
          options === initialOptions
            ? [`initial`]
            : options === oldOptions
              ? [`old`]
              : scenario.freshResult === `reject`
                ? []
                : [`fresh`],
        finalRowOwner: true,
        invalidatesAdapterEvidence: true,
      })
    }
    expect(unloadSubset.mock.calls.map(([options]) => options)).toEqual(
      activeOptions,
    )
    expectModel()
  } finally {
    for (const pendingRequest of pending.values()) {
      pendingRequest.reject(new Error(`test cleanup`))
    }
    await source.cleanup()
  }
}

it(`does not release physical work when an already-aborted demand skips adapter start`, async () => {
  const ownerId = `aborted-owner`
  const requestEvent: LoadSubsetFullFlowEvent = {
    type: `requestDemand`,
    ownerId,
    sessionId: `session-1`,
    demandId: `all-rows`,
    alreadyAborted: true,
  }
  const history: ReadonlyArray<LoadSubsetFullFlowEvent> = [
    requestEvent,
    {
      type: `releaseDemand`,
      ownerId,
      demandId: `all-rows`,
      rowKeys: [],
      finalRowOwner: false,
      invalidatesAdapterEvidence: false,
    },
  ]
  const adapterEvents: Array<AdapterLifecycleEvent> = []
  const collection = createCollection<{ id: string }>({
    id: `full-flow-aborted-before-start`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ markReady }) => {
        markReady()
        return {
          loadSubset: (options) => {
            adapterEvents.push({ type: `start`, options })
            return true
          },
          unloadSubset: (options) => {
            adapterEvents.push({ type: `release`, options })
          },
        }
      },
    },
  })
  const subscription = collection.subscribeChanges(() => {}, {
    includeInitialState: false,
  })
  const request = new AbortController()
  request.abort()

  try {
    subscription.requestSnapshot({
      signal: request.signal,
      optimizedOnly: false,
    })
    expect(eventTypes(adapterEvents)).toEqual(
      projectAdapterLifecycle([requestEvent]).map(({ type }) =>
        type === `invoke` ? `start` : `release`,
      ),
    )

    subscription.unsubscribe()

    // A skipped adapter call creates no physical resource to release.
    expect(eventTypes(adapterEvents)).toEqual(
      projectAdapterLifecycle(history).map(({ type }) =>
        type === `invoke` ? `start` : `release`,
      ),
    )
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

it.each([127, 128, 129])(
  `freezes a %i-byte equality constant across local filtering and adapter acquisition`,
  async (byteLength) => {
    type Row = { id: `original` | `changed`; token: Uint8Array }
    const originalToken = new Uint8Array(byteLength).fill(1)
    const changedToken = new Uint8Array(byteLength).fill(2)
    const callerToken = new Uint8Array(originalToken)
    const rows: ReadonlyArray<Row> = [
      { id: `original`, token: originalToken },
      { id: `changed`, token: changedToken },
    ]
    let acquired: LoadSubsetOptions | undefined
    const collection = createCollection<Row>({
      id: `frozen-binary-equality-${byteLength}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          rows.forEach((value) => write({ type: `insert`, value }))
          commit()
          markReady()
          return {
            loadSubset: (options) => {
              acquired = options
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Set<Row[`id`]>()
    const where = new Func<boolean>(`eq`, [
      new PropRef([`token`]),
      new Value(callerToken),
    ])
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key as Row[`id`])
          else visible.add(change.key as Row[`id`])
        }
      },
      { whereExpression: where },
    )

    try {
      callerToken.fill(2)
      subscription.requestSnapshot({ optimizedOnly: false })

      expect([...visible]).toEqual([`original`])
      const acquiredValue = (
        (acquired?.where as Func | undefined)?.args[1] as
          | Value<Uint8Array>
          | undefined
      )?.value
      expect(acquiredValue).toEqual(originalToken)
      expect(acquiredValue).not.toBe(callerToken)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  },
)

it(`rejects unsupported relational coercion before adapter entry`, async () => {
  let adapterCalls = 0
  const collection = createCollection<{ id: string; value: number }>({
    id: `unsupported-relational-coercion`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            adapterCalls += 1
            return true
          },
        }
      },
    },
  })
  const coercion = { [Symbol.toPrimitive]: () => 1 }

  try {
    expect(() =>
      collection.subscribeChanges(() => {}, {
        whereExpression: new Func(`gt`, [
          new PropRef([`value`]),
          new Value(coercion),
        ]),
      }),
    ).toThrow(/Cannot snapshot structural expression value/)
    expect(adapterCalls).toBe(0)
    expect(collection.subscriberCount).toBe(0)
  } finally {
    await collection.cleanup()
  }
})

it(`reloads authoritative rows after final-owner cleanup invalidates retained adapter coverage`, async () => {
  type Row = { id: string; value: number }
  const row: Row = { id: `row`, value: 1 }
  const history: ReadonlyArray<LoadSubsetFullFlowEvent> = [
    {
      type: `requestDemand`,
      ownerId: `owner-1`,
      sessionId: `session-1`,
      demandId: `all-rows`,
      alreadyAborted: false,
    },
    {
      type: `applyAuthoritativeRows`,
      ownerId: `owner-1`,
      demandId: `all-rows`,
      rowKeys: [row.id],
    },
    {
      type: `releaseDemand`,
      ownerId: `owner-1`,
      demandId: `all-rows`,
      rowKeys: [row.id],
      finalRowOwner: true,
      invalidatesAdapterEvidence: true,
    },
    {
      type: `restartSession`,
      previousSessionId: `session-1`,
      nextSessionId: `session-2`,
    },
    {
      type: `requestDemand`,
      ownerId: `owner-2`,
      sessionId: `session-2`,
      demandId: `all-rows`,
      alreadyAborted: false,
    },
    {
      type: `applyAuthoritativeRows`,
      ownerId: `owner-2`,
      demandId: `all-rows`,
      rowKeys: [row.id],
    },
  ]
  let transportLoads = 0
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>

  const deduplicated = new DeduplicatedLoadSubset({
    loadSubset: async () => {
      transportLoads++
      begin()
      write({ type: `insert`, value: row })
      const applied = commit()
      if (applied !== true) await applied
      return { hasMore: false, appliedRowKeys: [row.id] }
    },
  })
  const source = createCollection<Row>({
    id: `full-flow-dedupe-remount-source`,
    getKey: (value) => value.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: deduplicated.loadSubset,
          unloadSubset: deduplicated.unloadSubset,
        }
      },
    },
  })
  const createLive = (id: string) =>
    createLiveQueryCollection({
      id,
      query: (q) => q.from({ row: source }),
      startSync: true,
    })
  const first = createLive(`full-flow-dedupe-remount-first`)
  let second: ReturnType<typeof createLive> | undefined

  try {
    await first.preload()
    expect(visibleRows(first.values())).toEqual([row])
    expect(transportLoads).toBe(1)

    await first.cleanup()
    expect(Array.from(source.values())).toEqual([])

    second = createLive(`full-flow-dedupe-remount-second`)
    await second.preload()

    // The adapter must either replay retained evidence or fetch it again.
    expect(transportLoads).toBe(projectTransportLoads(history))
    expect(visibleRows(second.values()).map(({ id }) => id)).toEqual(
      projectRetainedRowKeys(history),
    )
  } finally {
    await Promise.all([
      first.cleanup(),
      second?.cleanup() ?? Promise.resolve(),
      source.cleanup(),
    ])
  }
})
it(`does not let an ordered continuation from a cleaned session start new work after restart`, async () => {
  type Row = { id: number; rank: number }
  const history: ReadonlyArray<LoadSubsetFullFlowEvent> = [
    {
      type: `requestDemand`,
      ownerId: `owner-1`,
      sessionId: `session-1`,
      demandId: `top-1`,
      alreadyAborted: false,
    },
    {
      type: `scheduleContinuation`,
      taskId: `load-1-settlement`,
      sessionId: `session-1`,
      windowRevision: 0,
    },
    { type: `cleanupSession`, sessionId: `session-1` },
    {
      type: `restartSession`,
      previousSessionId: `session-1`,
      nextSessionId: `session-2`,
    },
    {
      type: `requestDemand`,
      ownerId: `owner-2`,
      sessionId: `session-2`,
      demandId: `top-1`,
      alreadyAborted: false,
    },
    { type: `runContinuation`, taskId: `load-1-settlement` },
  ]
  const pending: Array<ReturnType<typeof createDeferred<void>>> = []
  const source = createCollection<Row>({
    id: `full-flow-stale-ordered-continuation-source`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            const deferred = createDeferred<void>()
            pending.push(deferred)
            return deferred.promise.then(() => ({
              hasMore: false,
              appliedRowKeys: [],
            }))
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `full-flow-stale-ordered-continuation-live`,
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    startSync: true,
  })
  const firstPreload = live.preload().catch(() => undefined)
  let secondPreload: Promise<unknown> | undefined

  try {
    expect(pending).toHaveLength(1)
    await live.cleanup()

    secondPreload = live.preload()
    expect(pending).toHaveLength(2)

    const requestsBeforeStaleSettlement = pending.length
    pending[0]!.resolve()
    await flushPromises()

    expect(pending).toHaveLength(
      requestsBeforeStaleSettlement +
        projectAuthorizedContinuationStarts(history),
    )
  } finally {
    for (const request of pending) request.resolve()
    await flushPromises()
    await Promise.all([
      firstPreload,
      secondPreload?.catch(() => undefined) ?? Promise.resolve(),
      live.cleanup(),
      source.cleanup(),
    ])
  }
})

it.each([`sync`, `async`] as const)(
  `keeps an outcome-free %s completion local to its exact ordered window`,
  async (settlement) => {
    type Row = { id: number; rank: number }
    const remoteRows: ReadonlyArray<Row> = [
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
      { id: 3, rank: 3 },
    ]
    const loadedKeys = new Set<number>()
    const demands: Array<LoadSubsetOptions> = []
    const source = createCollection<Row>({
      id: `full-flow-outcome-free-${settlement}-source`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          const applyRequestedPrefix = (options: LoadSubsetOptions) => {
            demands.push(options)
            const requestedPrefix = options.limit ?? remoteRows.length
            begin()
            for (const row of remoteRows.slice(0, requestedPrefix)) {
              if (loadedKeys.has(row.id)) continue
              write({ type: `insert`, value: row })
              loadedKeys.add(row.id)
            }
            commit()
          }
          return {
            loadSubset: (options) => {
              if (settlement === `sync`) {
                applyRequestedPrefix(options)
                return true
              }
              return Promise.resolve().then(() => {
                applyRequestedPrefix(options)
              })
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const live = createLiveQueryCollection({
      id: `full-flow-outcome-free-${settlement}-live`,
      query: (q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(1),
      startSync: true,
    })

    try {
      await live.preload()
      expect(live.toArray.map(({ id }) => id)).toEqual([1])
      expect(demands).toHaveLength(1)
      expect(demands[0]?.cursor).toBeUndefined()

      await live.utils.setWindow({ offset: 0, limit: 2 })

      expect(live.toArray.map(({ id }) => id)).toEqual([1, 2])
      expect(demands).toHaveLength(2)
      expect(demands[1]).toMatchObject({ limit: 2, offset: 0 })
      expect(demands[1]?.cursor).toBeUndefined()
    } finally {
      await live.cleanup()
      await source.cleanup()
    }
  },
)

it.each([
  {
    name: `continues past an excluded source row`,
    middleEligible: false,
    expectedCalls: 3,
    expectedCursorKeys: [undefined, 1, 3],
    expectedIds: [1, 2],
  },
  {
    name: `keeps the same source progress when that row is eligible`,
    middleEligible: true,
    expectedCalls: 3,
    expectedCursorKeys: [undefined, 1, undefined],
    expectedIds: [1, 3],
  },
] as const)(`$name after a short non-exhausted page`, async (scenario) => {
  type Row = { id: number; rank: number; eligible: boolean }
  const remoteRows: ReadonlyArray<Row> = [
    { id: 1, rank: 1, eligible: true },
    { id: 3, rank: 1, eligible: scenario.middleEligible },
    { id: 2, rank: 2, eligible: true },
  ]
  const calls: Array<LoadSubsetOptions> = []
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-short-continuation-source`,
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
          loadSubset: async (options) => {
            calls.push(options)
            await Promise.resolve()
            const rows =
              calls.length === 1
                ? [remoteRows[0]!]
                : calls.length === 2
                  ? [remoteRows[1]!]
                  : [remoteRows[2]!]
            begin()
            for (const row of rows) write({ type: `insert`, value: row })
            const applied = commit()
            if (applied !== true) await applied
            return {
              hasMore: calls.length < 3,
              appliedRowKeys: rows.map(({ id }) => id),
            }
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `full-flow-short-continuation-live`,
    query: (q) =>
      q
        .from({ row: source })
        .where(({ row }) => eq(row.eligible, true))
        .orderBy(({ row }) => row.rank)
        .limit(2),
    startSync: true,
  })

  try {
    await live.preload()
    await flushPromises()

    expect(calls).toHaveLength(scenario.expectedCalls)
    expect(calls.map(({ cursor }) => cursor?.lastKey)).toEqual(
      scenario.expectedCursorKeys,
    )
    expect(live.toArray.map(({ id }) => id)).toEqual(scenario.expectedIds)
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
})

type OrderedConsumer = `live-collection` | `effect`

type OrderedConsumerParityScenario = {
  middleCount: 0 | 1 | 2 | 3
  middleEligible: boolean
  tied: boolean
}

type OrderedConsumerParityObservation = {
  cursorKeys: Array<string | number | undefined>
  limits: Array<number | undefined>
  visibleIds: Array<number>
  ready: boolean
}

const orderedConsumerParityScenarioArbitrary: fc.Arbitrary<OrderedConsumerParityScenario> =
  fc.record({
    middleCount: fc.constantFrom(
      0 as const,
      1 as const,
      2 as const,
      3 as const,
    ),
    middleEligible: fc.boolean(),
    tied: fc.boolean(),
  })

const exhaustiveOrderedConsumerParityScenarios: ReadonlyArray<OrderedConsumerParityScenario> =
  ([0, 1, 2, 3] as const).flatMap((middleCount) =>
    [false, true].flatMap((middleEligible) =>
      [false, true].map((tied) => ({
        middleCount,
        middleEligible,
        tied,
      })),
    ),
  )

let orderedConsumerParityHarnessId = 0

async function runTiedContinuationConsumer(
  consumer: OrderedConsumer,
  scenario: OrderedConsumerParityScenario,
): Promise<OrderedConsumerParityObservation> {
  type Row = { id: number; rank: number; eligible: boolean }
  const firstRow: Row = { id: 1, rank: 1, eligible: true }
  const middleRows: ReadonlyArray<Row> = Array.from(
    { length: scenario.middleCount },
    (_, index) => ({
      id: index + 3,
      rank: scenario.tied ? 1 : index + 2,
      eligible: scenario.middleEligible,
    }),
  )
  const finalRow: Row = {
    id: 2,
    rank: scenario.tied ? 2 : scenario.middleCount + 2,
    eligible: true,
  }
  const pageRows = [firstRow, ...middleRows, finalRow]
  const calls: Array<LoadSubsetOptions> = []
  const pending: Array<{
    request: ReturnType<
      typeof createDeferred<{
        hasMore: boolean
        appliedRowKeys: ReadonlyArray<number>
      }>
    >
    result: {
      hasMore: boolean
      appliedRowKeys: ReadonlyArray<number>
    }
    rowToApply?: Row
  }> = []
  const visible = new Map<number, Row>()
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-effect-parity-${consumer}-${orderedConsumerParityHarnessId++}`,
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
        for (const row of middleRows) {
          write({ type: `insert`, value: row })
        }
        commit()
        params.markReady()
        return {
          loadSubset: (options) => {
            const pageIndex = calls.length
            calls.push(options)
            const row = pageRows[pageIndex]
            if (pageIndex === 0) {
              if (!row) throw new Error(`Ordered consumer exceeded its pages`)
              begin()
              write({ type: `insert`, value: row })
              commit()
            }
            const request = createDeferred<{
              hasMore: boolean
              appliedRowKeys: ReadonlyArray<number>
            }>()
            pending.push({
              request,
              result: {
                hasMore: pageIndex < pageRows.length - 1,
                appliedRowKeys: row ? [row.id] : [],
              },
              rowToApply: pageIndex === pageRows.length - 1 ? row : undefined,
            })
            return request.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const query = (q: InitialQueryBuilder) =>
    q
      .from({ row: source })
      .where(({ row }) => eq(row.eligible, true))
      .orderBy(({ row }) => row.rank)
      .limit(2)

  let live: ReturnType<typeof createLiveQueryCollection> | undefined
  let preloadPromise: Promise<unknown> | undefined
  let preloadSettled = consumer === `effect`
  let effect: ReturnType<typeof createEffect> | undefined
  if (consumer === `live-collection`) {
    live = createLiveQueryCollection({
      id: `full-flow-effect-parity-live`,
      query,
      startSync: true,
    })
    preloadPromise = live.preload()
    void preloadPromise.then(
      () => {
        preloadSettled = true
      },
      () => {},
    )
  } else {
    effect = createEffect<Row, number>({
      query,
      onBatch: (events) => {
        for (const event of events) {
          if (event.type === `exit`) visible.delete(event.key)
          else visible.set(event.key, event.value)
        }
      },
    })
  }

  try {
    await flushPromises()
    let settled = 0
    while (settled < pending.length) {
      if (settled > pageRows.length) {
        throw new Error(`Ordered consumer did not reach a fixed point`)
      }
      const page = pending[settled]!
      settled++
      if (page.rowToApply) {
        begin()
        write({ type: `insert`, value: page.rowToApply })
        const applied = commit()
        if (applied !== true) await applied
      }
      page.request.resolve(page.result)
      await flushPromises()
    }
    if (preloadPromise && preloadSettled) await preloadPromise
    return {
      cursorKeys: calls.map(({ cursor }) => cursor?.lastKey),
      limits: calls.map(({ limit }) => limit),
      visibleIds: live
        ? live.toArray.map(({ id }) => id)
        : [...visible.keys()].sort((a, b) => a - b),
      ready: preloadSettled,
    }
  } finally {
    if (live) await live.cleanup()
    if (effect) await effect.dispose()
    await source.cleanup()
  }
}

function projectOrderedConsumerParity(
  scenario: OrderedConsumerParityScenario,
): Pick<
  OrderedConsumerParityObservation,
  `cursorKeys` | `visibleIds` | `ready`
> {
  if (scenario.middleEligible && scenario.middleCount > 0) {
    return {
      cursorKeys: [undefined, 1],
      visibleIds: [1, 3],
      ready: true,
    }
  }

  return {
    cursorKeys: [
      undefined,
      1,
      ...Array.from({ length: scenario.middleCount }, (_, index) => index + 3),
    ],
    visibleIds: [1, 2],
    ready: true,
  }
}

async function assertOrderedConsumerParity(
  scenario: OrderedConsumerParityScenario,
): Promise<void> {
  const [live, effect] = await Promise.all([
    runTiedContinuationConsumer(`live-collection`, scenario),
    runTiedContinuationConsumer(`effect`, scenario),
  ])
  const expected = projectOrderedConsumerParity(scenario)

  expect({
    cursorKeys: live.cursorKeys,
    visibleIds: live.visibleIds,
    ready: live.ready,
  }).toEqual(expected)
  expect(effect).toEqual(live)
}

it(`keeps ordered continuation progress equal across collection consumers`, async () => {
  const scenario: OrderedConsumerParityScenario = {
    middleCount: 2,
    middleEligible: false,
    tied: true,
  }
  const [live, effect] = await Promise.all([
    runTiedContinuationConsumer(`live-collection`, scenario),
    runTiedContinuationConsumer(`effect`, scenario),
  ])

  expect(live.cursorKeys).toEqual([undefined, 1, 3, 4])
  expect(live.visibleIds).toEqual([1, 2])
  expect(effect).toEqual(live)
})

it(`keeps consumer parity when only the middle rows become eligible`, async () => {
  const scenario: OrderedConsumerParityScenario = {
    middleCount: 2,
    middleEligible: true,
    tied: true,
  }
  const [live, effect] = await Promise.all([
    runTiedContinuationConsumer(`live-collection`, scenario),
    runTiedContinuationConsumer(`effect`, scenario),
  ])

  expect(live.cursorKeys).toEqual([undefined, 1])
  expect(live.visibleIds).toEqual([1, 3])
  expect(effect).toEqual(live)
})

it(`exhausts bounded ordered continuation histories across collection consumers`, async () => {
  for (const scenario of exhaustiveOrderedConsumerParityScenarios) {
    await assertOrderedConsumerParity(scenario)
  }
})

fcTest.prop([orderedConsumerParityScenarioArbitrary], {
  numRuns: 12 * fullFlowMultiplier,
  seed: 17785,
})(
  `keeps ordered collection consumers equal for a fixed seed`,
  assertOrderedConsumerParity,
)

fcTest.prop(
  [orderedConsumerParityScenarioArbitrary],
  oracleRandomParameters(12 * fullFlowMultiplier, fullFlowReplaySeed),
)(
  `keeps ordered collection consumers equal for a random or replayed seed`,
  assertOrderedConsumerParity,
)

it(`retries an evidence-free Effect continuation after prefix refinement`, async () => {
  type Row = { id: number; rank: number; label: string }
  type Result = {
    hasMore: boolean
    appliedRowKeys: ReadonlyArray<number>
  }
  const firstRow: Row = {
    id: 1,
    rank: 1,
    label: `before`,
  }
  const updatedFirstRow: Row = { ...firstRow, label: `after` }
  const secondRow: Row = {
    id: 2,
    rank: 2,
    label: `second`,
  }
  const calls: Array<LoadSubsetOptions> = []
  const pending: Array<ReturnType<typeof createDeferred<Result>>> = []
  const visible = new Map<number, Row>()
  let begin!: () => void
  let write!: (
    message:
      | { type: `insert`; value: Row }
      | { type: `update`; value: Row; previousValue: Row },
  ) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-effect-prefix-refinement`,
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
          loadSubset: (options) => {
            calls.push(options)
            if (calls.length === 1) {
              begin()
              write({ type: `insert`, value: firstRow })
              commit()
            }
            const request = createDeferred<Result>()
            pending.push(request)
            return request.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(2),
    onBatch: (events) => {
      for (const event of events) {
        if (event.type === `exit`) visible.delete(event.key)
        else visible.set(event.key, event.value)
      }
    },
  })

  try {
    await flushPromises()
    expect(pending).toHaveLength(1)
    pending[0]!.resolve({ hasMore: true, appliedRowKeys: [firstRow.id] })
    await flushPromises()
    expect(pending).toHaveLength(2)
    pending[1]!.resolve({ hasMore: true, appliedRowKeys: [firstRow.id] })
    await flushPromises()
    expect(pending).toHaveLength(3)
    pending[2]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    expect(calls).toHaveLength(3)

    begin()
    write({
      type: `update`,
      value: updatedFirstRow,
      previousValue: firstRow,
    })
    const updated = commit()
    if (updated !== true) await updated
    await flushPromises()

    expect(calls).toHaveLength(4)
    begin()
    write({ type: `insert`, value: secondRow })
    const applied = commit()
    if (applied !== true) await applied
    pending[3]!.resolve({ hasMore: false, appliedRowKeys: [secondRow.id] })
    await flushPromises()

    expect([...visible.values()].map(({ id }) => id)).toEqual([1, 2])
  } finally {
    await effect.dispose()
    await source.cleanup()
  }
})

it(`retries an evidence-free ordered Effect after truncate`, async () => {
  type Row = { id: number; rank: number }
  type Result = {
    hasMore: boolean
    appliedRowKeys: ReadonlyArray<number>
  }
  const finalRow: Row = { id: 2, rank: 2 }
  const calls: Array<LoadSubsetOptions> = []
  const pending: Array<ReturnType<typeof createDeferred<Result>>> = []
  const visible = new Map<number, Row>()
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  const source = createCollection<Row>({
    id: `full-flow-effect-truncate-reset`,
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
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: (options) => {
            calls.push(options)
            const request = createDeferred<Result>()
            pending.push(request)
            return request.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    onBatch: (events) => {
      for (const event of events) {
        if (event.type === `exit`) visible.delete(event.key)
        else visible.set(event.key, event.value)
      }
    },
  })

  try {
    await flushPromises()
    expect(pending).toHaveLength(1)
    pending[0]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    expect(pending).toHaveLength(2)
    pending[1]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    expect(calls).toHaveLength(2)

    begin()
    truncate()
    const replacement = commit()
    await flushPromises()
    // Both retained logical demands replay, but Effect must not add a third
    // transport until those replacement acquisitions have settled.
    expect(pending).toHaveLength(4)

    pending[2]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    expect(pending).toHaveLength(4)
    pending[3]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    expect(pending).toHaveLength(5)

    begin()
    write({ type: `insert`, value: finalRow })
    const applied = commit()
    if (applied !== true) await applied
    pending[4]!.resolve({ hasMore: false, appliedRowKeys: [finalRow.id] })
    if (replacement !== true) await replacement
    await flushPromises()

    expect([...visible.keys()]).toEqual([finalRow.id])
    expect(calls).toHaveLength(5)
  } finally {
    await effect.dispose()
    await source.cleanup()
  }
})

it(`rechecks an ordered Effect after synchronous truncate replay`, async () => {
  type Row = { id: number; rank: number }
  type Result = {
    hasMore: boolean
    appliedRowKeys: ReadonlyArray<number>
  }
  const finalRow: Row = { id: 2, rank: 2 }
  const pending: Array<ReturnType<typeof createDeferred<Result>>> = []
  const visible = new Map<number, Row>()
  let calls = 0
  let replaying = false
  let replayCalls = 0
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  const source = createCollection<Row>({
    id: `full-flow-effect-sync-truncate-reset`,
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
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: () => {
            calls++
            if (!replaying) {
              const request = createDeferred<Result>()
              pending.push(request)
              return request.promise
            }

            replayCalls++
            if (replayCalls === 3) {
              begin()
              write({ type: `insert`, value: finalRow })
              commit()
            }
            return true
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    onBatch: (events) => {
      for (const event of events) {
        if (event.type === `exit`) visible.delete(event.key)
        else visible.set(event.key, event.value)
      }
    },
  })

  try {
    await flushPromises()
    pending[0]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    pending[1]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    expect(calls).toBe(2)

    replaying = true
    begin()
    truncate()
    const replacement = commit()
    await flushPromises()
    if (replacement !== true) await replacement

    expect(replayCalls).toBe(3)
    expect(calls).toBe(5)
    expect([...visible.keys()]).toEqual([finalRow.id])
  } finally {
    await effect.dispose()
    await source.cleanup()
  }
})

it(`replaces an ordered Effect only after a rejected continuation disposes it`, async () => {
  type Row = { id: number; rank: number }
  const firstRow: Row = { id: 1, rank: 1 }
  const replacementRow: Row = { id: 2, rank: 2 }
  const failure = new Error(`ordered continuation failed`)
  let calls = 0
  let begin!: () => void
  let write!: (
    message: { type: `insert`; value: Row } | { type: `delete`; value: Row },
  ) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-effect-rejection-reset`,
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
          loadSubset: () => {
            calls++
            if (calls === 2) return Promise.reject(failure)
            const row = calls === 1 ? firstRow : replacementRow
            begin()
            write({ type: `insert`, value: row })
            commit()
            return Promise.resolve()
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const errors: Array<Error> = []
  const first = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    onBatch: () => {},
    onSourceError: (error) => errors.push(error),
  })
  let second: ReturnType<typeof createEffect<Row, number>> | undefined

  try {
    await flushPromises()
    expect(calls).toBe(1)

    begin()
    write({ type: `delete`, value: firstRow })
    const removed = commit()
    if (removed !== true) await removed
    await flushPromises()

    expect(calls).toBe(2)
    expect(errors).toEqual([failure])
    expect(first.disposed).toBe(true)

    const visible = new Map<number, Row>()
    second = createEffect<Row, number>({
      query: (q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(1),
      onBatch: (events) => {
        for (const event of events) {
          if (event.type === `exit`) visible.delete(event.key)
          else visible.set(event.key, event.value)
        }
      },
    })
    await flushPromises()

    expect(calls).toBe(3)
    expect(second.disposed).toBe(false)
    expect([...visible.keys()]).toEqual([replacementRow.id])
  } finally {
    await first.dispose()
    if (second) await second.dispose()
    await source.cleanup()
  }
})

it(`does not continue an ordered Effect after teardown`, async () => {
  type Row = { id: number; rank: number }
  const row: Row = { id: 1, rank: 1 }
  const pending = createDeferred<{
    hasMore: boolean
    appliedRowKeys: ReadonlyArray<number>
  }>()
  let calls = 0
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-effect-teardown-fence`,
    getKey: (value) => value.id,
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
          loadSubset: () => {
            calls++
            begin()
            write({ type: `insert`, value: row })
            commit()
            return pending.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row: value }) => value.rank)
        .limit(2),
    onBatch: () => {},
  })

  try {
    await flushPromises()
    expect(calls).toBe(1)
    await effect.dispose()

    pending.resolve({ hasMore: true, appliedRowKeys: [row.id] })
    await flushPromises()

    expect(calls).toBe(1)
  } finally {
    await effect.dispose()
    await source.cleanup()
  }
})

it(`continues across every excluded source row beyond the visible target`, async () => {
  type Row = { id: number; rank: number; eligible: boolean }
  const remoteRows: ReadonlyArray<Row> = [
    { id: 1, rank: 1, eligible: true },
    { id: 2, rank: 2, eligible: false },
    { id: 3, rank: 3, eligible: false },
    { id: 4, rank: 4, eligible: true },
  ]
  const calls: Array<LoadSubsetOptions> = []
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-excluded-progress-source`,
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
          loadSubset: async (options) => {
            calls.push(options)
            await Promise.resolve()
            const lastKey = options.cursor?.lastKey
            const rowIndex =
              lastKey === undefined
                ? 0
                : remoteRows.findIndex(({ id }) => id === lastKey) + 1
            const row = remoteRows[rowIndex]
            if (!row) throw new Error(`Expected another remote row`)
            begin()
            write({ type: `insert`, value: row })
            const applied = commit()
            if (applied !== true) await applied
            return {
              hasMore: rowIndex < remoteRows.length - 1,
              appliedRowKeys: [row.id],
            }
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `full-flow-excluded-progress-live`,
    query: (q) =>
      q
        .from({ row: source })
        .where(({ row }) => eq(row.eligible, true))
        .orderBy(({ row }) => row.rank)
        .limit(2),
    startSync: true,
  })

  try {
    await live.preload()
    await flushPromises()

    expect(calls).toHaveLength(4)
    expect(calls.map(({ cursor }) => cursor?.lastKey)).toEqual([
      undefined,
      1,
      2,
      3,
    ])
    expect(live.toArray.map(({ id }) => id)).toEqual([1, 4])
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
})

it(`does not repeat an evidence-free ordered continuation`, async () => {
  type Row = { id: number; rank: number }
  const row: Row = { id: 1, rank: 1 }
  const calls: Array<LoadSubsetOptions> = []
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-no-progress-source`,
    getKey: (value) => value.id,
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
          loadSubset: async (options) => {
            calls.push(options)
            await Promise.resolve()
            const rows = calls.length === 1 ? [row] : []
            begin()
            for (const value of rows) write({ type: `insert`, value })
            const applied = commit()
            if (applied !== true) await applied
            return {
              hasMore: true,
              appliedRowKeys: rows.map(({ id }) => id),
            }
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `full-flow-no-progress-live`,
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row: value }) => value.rank)
        .limit(2),
    startSync: true,
  })

  try {
    await live.preload()
    await flushPromises()

    expect(calls).toHaveLength(2)
    expect(live.toArray.map(({ id }) => id)).toEqual([1])
    expect(live.utils.lastSubsetError).toMatchObject({
      message: expect.stringContaining(`made no ordered progress`),
    })
    const [subscription] = Object.values(
      live.utils[LIVE_QUERY_INTERNAL].getBuilder().subscriptions,
    )
    expect(subscription?.hasOrderedCoverageForActiveWindow).toBe(false)
    expect(subscription?.orderedRowsNeeded).toBe(1)

    await live.utils.setWindow({ offset: 0, limit: 3 })
    await flushPromises()

    expect(calls).toHaveLength(3)
    expect(calls[2]?.cursor?.lastKey).toBe(1)
    expect(subscription?.hasOrderedCoverageForActiveWindow).toBe(false)
    expect(subscription?.orderedRowsNeeded).toBe(2)
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
})

type OrderedContinuationEvidenceScenario = {
  targetSize: number
  eligibleKeys: ReadonlyArray<string>
  pages: ReadonlyArray<{
    requestedPrefix: number
    appliedKeys: ReadonlyArray<string>
    extent: `continues` | `exhausted`
  }>
}

const orderedEvidenceKeyArbitrary = fc.constantFrom(`a`, `b`, `c`, `d`)
const orderedContinuationEvidenceScenarioArbitrary: fc.Arbitrary<OrderedContinuationEvidenceScenario> =
  fc.record({
    targetSize: fc.integer({ min: 1, max: 4 }),
    eligibleKeys: fc.uniqueArray(orderedEvidenceKeyArbitrary, {
      minLength: 0,
      maxLength: 4,
    }),
    pages: fc.array(
      fc.record({
        requestedPrefix: fc.integer({ min: 1, max: 4 }),
        appliedKeys: fc.uniqueArray(orderedEvidenceKeyArbitrary, {
          minLength: 0,
          maxLength: 4,
        }),
        extent: fc.constantFrom(`continues` as const, `exhausted` as const),
      }),
      { minLength: 1, maxLength: 4 },
    ),
  })

if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
  fc.statistics(
    orderedContinuationEvidenceScenarioArbitrary,
    ({ eligibleKeys, pages }) => [
      `empty-continuation=${pages.some(
        (page) => page.extent === `continues` && page.appliedKeys.length === 0,
      )}`,
      `short-continuation=${pages.some(
        (page) =>
          page.extent === `continues` &&
          page.appliedKeys.length < page.requestedPrefix,
      )}`,
      `excluded-applied-row=${pages.some((page) =>
        page.appliedKeys.some((key) => !eligibleKeys.includes(key)),
      )}`,
      `exhaustion=${pages.some((page) => page.extent === `exhausted`)}`,
    ],
    oracleRandomParameters(1_000, fullFlowReplaySeed),
  )
}

let orderedEvidenceHarnessId = 0

type OrderedEvidenceRow = {
  id: string
  rank: number
  eligible: boolean
}

function assertOrderedContinuationEvidence(
  window: WindowState<WritableDeep<OrderedEvidenceRow>, string | number>,
  scenario: OrderedContinuationEvidenceScenario,
  sourceOrder: ReadonlyArray<string> = [`a`, `b`, `c`, `d`],
): void {
  const eligibleKeys = new Set(scenario.eligibleKeys)
  const [initial, ...continuations] = scenario.pages
  if (!initial) throw new Error(`Expected an initial evidence page`)
  window.recordInitialCoverage(
    initial.appliedKeys,
    initial.extent === `exhausted`,
  )
  if (initial.extent !== `exhausted`) {
    for (const page of continuations) {
      window.recordContinuationCoverage(
        page.appliedKeys,
        page.extent === `exhausted`,
        page.requestedPrefix,
        window.coverageRevision,
      )
      if (page.extent === `exhausted`) break
    }
  }

  const expected = projectOrderedContinuationEvidence({
    sourceOrder,
    eligibleKeys,
    targetSize: scenario.targetSize,
    pages: scenario.pages,
  })
  const actualKeys = window
    .reconcile(new Map())
    .filter((change) => change.type === `insert`)
    .map(({ key }) => key)

  expect(actualKeys).toEqual(expected.visibleKeys)
  expect(window.requestBoundary()?.key).toBe(expected.boundaryKey)
  expect(window.coveredPrefixSize).toBe(expected.coveredPrefixSize)
  expect(window.coversActiveWindow).toBe(expected.coversTarget)
  expect(window.rowsNeeded()).toBe(expected.rowsNeeded)
}

async function runOrderedContinuationEvidenceScenario(
  scenario: OrderedContinuationEvidenceScenario,
): Promise<void> {
  const sourceOrder = [`a`, `b`, `c`, `d`]
  const eligibleKeys = new Set(scenario.eligibleKeys)
  const rows: Array<OrderedEvidenceRow> = sourceOrder.map((id, index) => ({
    id,
    rank: index + 1,
    eligible: eligibleKeys.has(id),
  }))
  const source = createCollection(
    mockSyncCollectionOptions<OrderedEvidenceRow>({
      id: `ordered-evidence-oracle-${orderedEvidenceHarnessId++}`,
      initialData: rows,
      getKey: (row) => row.id,
    }),
  )
  await source.preload()
  const orderBy = [
    {
      expression: new PropRef([`rank`]),
      compareOptions: { direction: `asc` as const, nulls: `first` as const },
    },
  ]
  const where = new Func(`eq`, [new PropRef([`eligible`]), new Value(true)])
  const window = new WindowState(source, orderBy, where, scenario.targetSize)

  try {
    assertOrderedContinuationEvidence(window, scenario)
  } finally {
    await source.cleanup()
  }
}

it(`exhausts the bounded ordered-evidence model`, async () => {
  const boundedKeys = [`a`, `b`] as const
  const keySets: Array<Array<(typeof boundedKeys)[number]>> = [[]]
  for (const key of boundedKeys) {
    keySets.push(...keySets.map((keys) => [...keys, key]))
  }
  const pages = [1, 2].flatMap((requestedPrefix) =>
    keySets.flatMap((appliedKeys) =>
      ([`continues`, `exhausted`] as const).map((extent) => ({
        requestedPrefix,
        appliedKeys,
        extent,
      })),
    ),
  )
  const histories = [
    ...pages.map((page) => [page]),
    ...pages.flatMap((first) => pages.map((second) => [first, second])),
  ]
  const sourceOrder = [...boundedKeys]
  let checked = 0

  for (const eligible of keySets) {
    const eligibleKeys = new Set<string>(eligible)
    const rows: Array<OrderedEvidenceRow> = sourceOrder.map((id, index) => ({
      id,
      rank: index + 1,
      eligible: eligibleKeys.has(id),
    }))
    const source = createCollection(
      mockSyncCollectionOptions<OrderedEvidenceRow>({
        id: `ordered-evidence-exhaustive-${orderedEvidenceHarnessId++}`,
        initialData: rows,
        getKey: (row) => row.id,
      }),
    )
    await source.preload()
    const orderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc` as const, nulls: `first` as const },
      },
    ]
    const where = new Func(`eq`, [new PropRef([`eligible`]), new Value(true)])

    try {
      for (const targetSize of [1, 2]) {
        for (const evidencePages of histories) {
          const scenario: OrderedContinuationEvidenceScenario = {
            targetSize,
            eligibleKeys: eligible,
            pages: evidencePages,
          }
          assertOrderedContinuationEvidence(
            new WindowState(source, orderBy, where, targetSize),
            scenario,
            sourceOrder,
          )
          checked++
        }
      }
    } finally {
      await source.cleanup()
    }
  }

  expect(checked).toBe(2_176)
})

type AutomaticOrderedProgressState = {
  demandedPrefix: number
  refillLimit: number
  boundary?: { rank: number; key: string }
}

function assertAutomaticOrderedProgress(
  states: ReadonlyArray<AutomaticOrderedProgressState>,
): void {
  const orderByInfo = {
    orderBy: [
      {
        expression: new PropRef([`rank`]),
        compareOptions: {
          direction: `asc` as const,
          nulls: `first` as const,
        },
      },
    ],
    offset: 0,
    valueExtractorForRawRow: (row: Record<string, unknown>) => row.rank,
  }
  let lastLoadRequestKey: string | undefined
  let lastAcceptedIdentity: string | undefined

  for (const state of states) {
    const identity = JSON.stringify({
      demandedPrefix: state.demandedPrefix,
      rank: state.boundary?.rank ?? null,
      key: state.boundary?.key ?? null,
    })
    const request = computeOrderedLoadCursor(
      orderByInfo,
      state.boundary,
      lastLoadRequestKey,
      `row`,
      state.refillLimit,
      state.demandedPrefix,
      state.boundary?.key,
    )
    const shouldStart = identity !== lastAcceptedIdentity

    expect(request !== undefined).toBe(shouldStart)
    if (request) {
      lastLoadRequestKey = request.loadRequestKey
      lastAcceptedIdentity = identity
    }
  }
}

const automaticOrderedProgressStateArbitrary: fc.Arbitrary<AutomaticOrderedProgressState> =
  fc.record({
    demandedPrefix: fc.integer({ min: 1, max: 4 }),
    refillLimit: fc.integer({ min: 1, max: 4 }),
    boundary: fc.option(
      fc.record({
        rank: fc.integer({ min: -1, max: 2 }),
        key: fc.constantFrom(`a`, `b`, `c`),
      }),
      { nil: undefined },
    ),
  })

it(`exhausts the bounded automatic-progress transition law`, () => {
  const boundaries: ReadonlyArray<AutomaticOrderedProgressState[`boundary`]> = [
    undefined,
    { rank: 0, key: `a` },
    { rank: 0, key: `b` },
    { rank: 1, key: `a` },
  ]
  const states = [1, 2].flatMap((demandedPrefix) =>
    [1, 2].flatMap((refillLimit) =>
      boundaries.map((boundary) => ({
        demandedPrefix,
        refillLimit,
        boundary,
      })),
    ),
  )
  let checked = 0

  for (const first of states) {
    for (const second of states) {
      assertAutomaticOrderedProgress([first, second])
      checked++
    }
  }

  expect(checked).toBe(256)
})

fcTest.prop(
  [
    fc.array(automaticOrderedProgressStateArbitrary, {
      minLength: 1,
      maxLength: 8,
    }),
  ],
  {
    numRuns: 128 * fullFlowMultiplier,
    seed: 17784,
  },
)(
  `starts automatic continuation only for new semantic progress with a fixed seed`,
  assertAutomaticOrderedProgress,
)

fcTest.prop(
  [
    fc.array(automaticOrderedProgressStateArbitrary, {
      minLength: 1,
      maxLength: 8,
    }),
  ],
  oracleRandomParameters(128 * fullFlowMultiplier, fullFlowReplaySeed),
)(
  `starts automatic continuation only for new semantic progress with a random or replayed seed`,
  assertAutomaticOrderedProgress,
)

fcTest.prop([orderedContinuationEvidenceScenarioArbitrary], {
  numRuns: 64 * fullFlowMultiplier,
  seed: 17783,
})(
  `derives ordered progress from applied eligible evidence for a fixed seed`,
  runOrderedContinuationEvidenceScenario,
)

fcTest.prop(
  [orderedContinuationEvidenceScenarioArbitrary],
  oracleRandomParameters(64 * fullFlowMultiplier, fullFlowReplaySeed),
)(
  `derives ordered progress from applied eligible evidence for a random or replayed seed`,
  runOrderedContinuationEvidenceScenario,
)

type OrderedBoundaryProvenanceScenario = {
  direction: `asc` | `desc`
  offset: 0 | 1
  tied: boolean
  addedRowPlacement: `before` | `after`
  replayFailure: `throw` | `reject`
}

const orderedBoundaryProvenanceArbitrary: fc.Arbitrary<OrderedBoundaryProvenanceScenario> =
  fc.record({
    direction: fc.constantFrom(`asc` as const, `desc` as const),
    offset: fc.constantFrom(0 as const, 1 as const),
    tied: fc.boolean(),
    addedRowPlacement: fc.constantFrom(`before` as const, `after` as const),
    replayFailure: fc.constantFrom(`throw` as const, `reject` as const),
  })

const exhaustiveOrderedBoundaryProvenanceScenarios: ReadonlyArray<OrderedBoundaryProvenanceScenario> =
  ([`asc`, `desc`] as const).flatMap((direction) =>
    ([0, 1] as const).flatMap((offset) =>
      [false, true].flatMap((tied) =>
        ([`before`, `after`] as const).flatMap((addedRowPlacement) =>
          ([`throw`, `reject`] as const).map((replayFailure) => ({
            direction,
            offset,
            tied,
            addedRowPlacement,
            replayFailure,
          })),
        ),
      ),
    ),
  )

let orderedBoundaryHarnessId = 0

async function runOrderedBoundaryProvenanceScenario(
  scenario: OrderedBoundaryProvenanceScenario,
): Promise<void> {
  type Row = {
    id: `a` | `b` | `c` | `z`
    rank: number
    route: `ordered` | `unrelated`
  }
  const orderedRows: ReadonlyArray<Row> = [
    { id: `a`, rank: scenario.tied ? 5 : 1, route: `ordered` },
    { id: `b`, rank: scenario.tied ? 5 : 2, route: `ordered` },
    { id: `c`, rank: scenario.tied ? 5 : 3, route: `ordered` },
  ]
  const addedRow: Row = {
    id: `z`,
    rank:
      scenario.addedRowPlacement === `before`
        ? scenario.direction === `asc`
          ? 0
          : 6
        : scenario.direction === `asc`
          ? scenario.tied
            ? 5
            : 99
          : scenario.tied
            ? 5
            : -99,
    route: `unrelated`,
  }
  const orderedForDirection = [...orderedRows].sort((left, right) => {
    const valueOrder =
      scenario.direction === `asc`
        ? left.rank - right.rank
        : right.rank - left.rank
    return valueOrder || left.id.localeCompare(right.id)
  })
  const rowsAfterAdditionalDemand = [...orderedRows, addedRow].sort(
    (left, right) => {
      const valueOrder =
        scenario.direction === `asc`
          ? left.rank - right.rank
          : right.rank - left.rank
      return valueOrder || left.id.localeCompare(right.id)
    },
  )
  const prefixSize = scenario.offset + 1
  const expectedOrderedPrefix = (
    scenario.addedRowPlacement === `before`
      ? rowsAfterAdditionalDemand
      : orderedForDirection
  ).slice(0, prefixSize)
  const history: Array<LoadSubsetFullFlowEvent> = [
    {
      type: `stagePublicationRows`,
      publicationId: `initial-publication`,
      demandId: `ordered-window`,
      rows: orderedForDirection.slice(0, prefixSize).map((row) => ({
        key: row.id,
        orderValue: row.rank,
      })),
    },
    { type: `commitPublication`, publicationId: `initial-publication` },
    // A later row before the prefix changes the ordered publication. A row
    // after it remains only unordered-retention data and cannot move its
    // continuation boundary.
    ...(scenario.addedRowPlacement === `before`
      ? ([
          {
            type: `stagePublicationRows`,
            publicationId: `additional-publication`,
            demandId: `ordered-window`,
            rows: expectedOrderedPrefix.map((row) => ({
              key: row.id,
              orderValue: row.rank,
            })),
          },
        ] satisfies Array<LoadSubsetFullFlowEvent>)
      : []),
    {
      type: `stagePublicationRows`,
      publicationId: `additional-publication`,
      demandId: `unordered-retention`,
      rows: [{ key: addedRow.id, orderValue: addedRow.rank }],
    },
    { type: `commitPublication`, publicationId: `additional-publication` },
    { type: `truncateSource`, sessionId: `session` },
    {
      type: `stagePublicationRows`,
      publicationId: `failed-replacement`,
      demandId: `ordered-window`,
      rows: [
        {
          key: expectedOrderedPrefix.at(-1)!.id,
          orderValue:
            expectedOrderedPrefix.at(-1)!.rank +
            (scenario.direction === `asc` ? 100 : -100),
        },
      ],
    },
    {
      type: `rejectDemand`,
      ownerId: `ordered-owner`,
      demandId: `ordered-window`,
    },
  ]
  const expectedBoundary = projectOrderedPublicationBoundary(history, {
    demandId: `ordered-window`,
    direction: scenario.direction,
    prefixSize,
  })
  if (!expectedBoundary) throw new Error(`Expected an ordered boundary`)
  const partialReplayRow: Row = {
    id: expectedBoundary.key as Row[`id`],
    rank:
      expectedBoundary.orderValue + (scenario.direction === `asc` ? 100 : -100),
    route: expectedBoundary.key === addedRow.id ? `unrelated` : `ordered`,
  }

  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  let phase: `initial` | `replay` | `probe` = `initial`
  const loadOptions: Array<LoadSubsetOptions> = []
  const visible = new Map<Row[`id`], Row>()
  const applyRows = async (rows: ReadonlyArray<Row>) => {
    begin()
    for (const row of rows) write({ type: `insert`, value: row })
    const receipt = commit()
    if (receipt !== true) await receipt
  }
  const source = createCollection<Row>({
    id: `ordered-boundary-provenance-${orderedBoundaryHarnessId++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
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
            if (phase === `initial`) {
              const rows = options.orderBy ? orderedRows : [addedRow]
              return applyRows(rows).then(() => ({
                hasMore: false,
                appliedRowKeys: rows.map(({ id }) => id),
              }))
            }
            if (phase === `replay` && options.orderBy) {
              if (scenario.replayFailure === `throw`) {
                begin()
                write({ type: `insert`, value: partialReplayRow })
                const receipt = commit()
                if (receipt !== true) void receipt.catch(() => {})
                throw new Error(`ordered replay failed`)
              }
              return applyRows([partialReplayRow]).then(() =>
                Promise.reject(new Error(`ordered replay failed`)),
              )
            }
            return Promise.resolve({
              hasMore: false,
              appliedRowKeys: [],
            })
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const index = source.createIndex((row) => row.rank, {
    indexType: BTreeIndex,
  })
  const orderedIndex =
    scenario.direction === `asc` ? index : new ReverseIndex(index)
  const orderBy = [
    {
      expression: new PropRef([`rank`]),
      compareOptions: {
        direction: scenario.direction,
        nulls: `first` as const,
      },
    },
  ]
  const unrelatedWhere = new Func(`eq`, [
    new PropRef([`route`]),
    new Value(`unrelated`),
  ])
  const subscription = source.subscribeChanges((changes) => {
    for (const change of changes) {
      if (change.type === `delete`) visible.delete(change.key as Row[`id`])
      else visible.set(change.key as Row[`id`], change.value)
    }
  })
  subscription.setOrderByIndex(orderedIndex)

  try {
    subscription.requestLimitedSnapshot({
      orderBy,
      limit: 1,
      offset: scenario.offset,
    })
    await flushPromises()
    subscription.requestSnapshot({
      where: unrelatedWhere,
      optimizedOnly: false,
    })
    await flushPromises()

    expect([...visible.keys()].sort()).toEqual(
      [
        ...new Set([
          ...rowsAfterAdditionalDemand.slice(0, prefixSize).map(({ id }) => id),
          addedRow.id,
        ]),
      ].sort(),
    )
    expect((subscription.orderedBoundaryRow as Row | undefined)?.id).toBe(
      expectedBoundary.key,
    )
    expect((subscription.orderedBoundaryRow as Row | undefined)?.rank).toBe(
      expectedBoundary.orderValue,
    )

    phase = `replay`
    begin()
    truncate()
    const receipt = commit()
    if (receipt !== true) await receipt
    await flushPromises()

    phase = `probe`
    const beforeProbe = loadOptions.length
    subscription.requestLimitedSnapshot({
      orderBy,
      limit: 1,
      offset: scenario.offset,
    })
    await flushPromises()

    expect(loadOptions).toHaveLength(beforeProbe + 1)
    const cursor = loadOptions.at(-1)?.cursor
    expect(cursor?.lastKey).toBe(expectedBoundary.key)
    expect(cursor?.whereCurrent).toBeDefined()
    expect(cursor?.whereFrom).toBeDefined()
    expect(
      evaluateReferenceExpression(cursor!.whereCurrent, {
        rank: expectedBoundary.orderValue,
      }),
    ).toBe(true)
    expect(
      evaluateReferenceExpression(cursor!.whereCurrent, {
        rank: expectedBoundary.orderValue + 1,
      }),
    ).toBe(false)
    expect(
      evaluateReferenceExpression(cursor!.whereFrom, {
        rank:
          expectedBoundary.orderValue + (scenario.direction === `asc` ? 1 : -1),
      }),
    ).toBe(true)
  } finally {
    subscription.unsubscribe()
    await source.cleanup()
  }
}

it(`keeps failed-replay cursors scoped to the last complete ordered publication`, async () => {
  for (const scenario of exhaustiveOrderedBoundaryProvenanceScenarios) {
    await runOrderedBoundaryProvenanceScenario(scenario)
  }
})

fcTest.prop([orderedBoundaryProvenanceArbitrary], {
  numRuns: 32 * fullFlowMultiplier,
  seed: 1778,
})(
  `keeps ordered boundary provenance for a fixed seed`,
  runOrderedBoundaryProvenanceScenario,
)

fcTest.prop(
  [orderedBoundaryProvenanceArbitrary],
  oracleRandomParameters(32 * fullFlowMultiplier, fullFlowReplaySeed),
)(
  `keeps ordered boundary provenance for a random or replayed seed`,
  runOrderedBoundaryProvenanceScenario,
)

type AtomicOrderedReplayScenario = {
  direction: `asc` | `desc`
  initialPublication?: `empty` | `nonempty`
  callerContinuation?: `none` | `min-values` | `offset` | `both`
  resizeOrder: `grow-shrink` | `shrink-grow`
  overlap: boolean
  currentOutcome: `resolve` | `reject`
  currentExtent: `exhausted` | `continues`
  emptyContinuingReplay?: boolean
  settleCurrentFirst: boolean
  sourceDelta: boolean
  otherDemand: `none` | `active` | `released`
  otherOutcome?: `resolve` | `reject`
  demandSettlementOrder?: `ordered-first` | `other-first`
  releaseAfterOrdered?: boolean
  terminal?: `settle` | `unsubscribe`
}

const atomicOrderedReplayArbitrary: fc.Arbitrary<AtomicOrderedReplayScenario> =
  fc.record({
    direction: fc.constantFrom(`asc` as const, `desc` as const),
    initialPublication: fc.constantFrom(`empty` as const, `nonempty` as const),
    callerContinuation: fc.constantFrom(
      `none` as const,
      `min-values` as const,
      `offset` as const,
      `both` as const,
    ),
    resizeOrder: fc.constantFrom(
      `grow-shrink` as const,
      `shrink-grow` as const,
    ),
    overlap: fc.boolean(),
    currentOutcome: fc.constantFrom(`resolve` as const, `reject` as const),
    currentExtent: fc.constantFrom(`exhausted` as const, `continues` as const),
    emptyContinuingReplay: fc.boolean(),
    settleCurrentFirst: fc.boolean(),
    sourceDelta: fc.boolean(),
    otherDemand: fc.constantFrom(
      `none` as const,
      `active` as const,
      `released` as const,
    ),
  })

const exhaustiveAtomicOrderedReplayScenarios: ReadonlyArray<AtomicOrderedReplayScenario> =
  ([`empty`, `nonempty`] as const).flatMap((initialPublication) =>
    ([`asc`, `desc`] as const).flatMap((direction) =>
      ([`grow-shrink`, `shrink-grow`] as const).flatMap((resizeOrder) =>
        [false, true].flatMap((overlap) =>
          ([`resolve`, `reject`] as const).flatMap((currentOutcome) =>
            ([`exhausted`, `continues`] as const).flatMap((currentExtent) =>
              [false, true].flatMap((settleCurrentFirst) =>
                [false, true].flatMap((sourceDelta) =>
                  ([`none`, `active`, `released`] as const).map(
                    (otherDemand) => ({
                      direction,
                      initialPublication,
                      resizeOrder,
                      overlap,
                      currentOutcome,
                      currentExtent,
                      settleCurrentFirst,
                      sourceDelta,
                      otherDemand,
                    }),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  )

let atomicReplayHarnessId = 0

async function runAtomicOrderedReplayScenario(
  scenario: AtomicOrderedReplayScenario,
): Promise<void> {
  type Row = {
    id:
      | `old-a`
      | `old-b`
      | `new-a`
      | `new-b`
      | `delta`
      | `tail`
      | `obsolete`
      | `partial`
      | `old-other`
      | `new-other`
    rank: number
    route: `ordered` | `other`
  }
  type Outcome = {
    hasMore: boolean
    appliedRowKeys: ReadonlyArray<Row[`id`]>
  }
  type PendingReplay = {
    options: LoadSubsetOptions
    deferred: ReturnType<typeof createDeferred<Outcome>>
  }
  type PendingAttempt = {
    publicationId: string
    acquisitions: ReadonlyArray<PendingReplay>
    ordered: PendingReplay
  }

  const initialRows: ReadonlyArray<Row> =
    scenario.initialPublication === `empty`
      ? []
      : [
          { id: `old-a`, rank: 1, route: `ordered` },
          { id: `old-b`, rank: 2, route: `ordered` },
        ]
  const replacementRows: ReadonlyArray<Row> = [
    { id: `new-a`, rank: 1, route: `ordered` },
    { id: `new-b`, rank: 2, route: `ordered` },
  ]
  const sourceDelta: Row = {
    id: `delta`,
    rank: scenario.direction === `asc` ? 0 : 3,
    route: `ordered`,
  }
  const continuationRow: Row = {
    id: `tail`,
    rank: scenario.direction === `asc` ? 3 : 0,
    route: `ordered`,
  }
  const obsoleteRow: Row = {
    id: `obsolete`,
    rank: scenario.direction === `asc` ? -1 : 4,
    route: `ordered`,
  }
  const partialRow: Row = {
    id: `partial`,
    rank: scenario.direction === `asc` ? -2 : 5,
    route: `ordered`,
  }
  const initialOtherRow: Row = {
    id: `old-other`,
    rank: scenario.direction === `asc` ? 100 : -100,
    route: `other`,
  }
  const initialOtherRows =
    scenario.initialPublication === `empty` ? [] : [initialOtherRow]
  const replacementOtherRow: Row = {
    id: `new-other`,
    rank: scenario.direction === `asc` ? 101 : -101,
    route: `other`,
  }
  const orderRows = (rows: ReadonlyArray<Row>) =>
    [...rows].sort((left, right) => {
      const valueOrder =
        scenario.direction === `asc`
          ? left.rank - right.rank
          : right.rank - left.rank
      return valueOrder || left.id.localeCompare(right.id)
    })
  const toModelRows = (rows: ReadonlyArray<Row>) =>
    rows.map(({ id: key, rank: orderValue }) => ({ key, orderValue }))

  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  let initialOrderedLoad = true
  let initialOtherLoad = true
  let replacementSequence = 0
  let unsubscribed = false
  const pending: Array<PendingReplay> = []
  const history: Array<LoadSubsetFullFlowEvent> = [
    {
      type: `stagePublicationRows`,
      publicationId: `initial`,
      demandId: `ordered`,
      rows: toModelRows(initialRows),
    },
    { type: `commitPublication`, publicationId: `initial` },
  ]

  const applyRows = async (rows: ReadonlyArray<Row>) => {
    begin()
    for (const row of rows) write({ type: `insert`, value: row })
    const receipt = commit()
    if (receipt !== true) await receipt
  }

  const collection = createCollection<Row>({
    id: `atomic-ordered-replay-${atomicReplayHarnessId++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: (options) => {
            if (initialOrderedLoad && options.orderBy) {
              initialOrderedLoad = false
              return applyRows(initialRows).then(() => ({
                hasMore: false,
                appliedRowKeys: initialRows.map(({ id }) => id),
              }))
            }
            if (initialOtherLoad && !options.orderBy) {
              initialOtherLoad = false
              return applyRows(initialOtherRows).then(() => ({
                hasMore: false,
                appliedRowKeys: initialOtherRows.map(({ id }) => id),
              }))
            }
            const deferred = createDeferred<Outcome>()
            pending.push({ options, deferred })
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
  const orderedIndex =
    scenario.direction === `asc` ? index : new ReverseIndex(index)
  const orderBy = [
    {
      expression: new PropRef([`rank`]),
      compareOptions: {
        direction: scenario.direction,
        nulls: `first` as const,
      },
    },
  ]
  const callerContinuation = scenario.callerContinuation ?? `min-values`
  const callerContinuationOptions = {
    ...(callerContinuation === `min-values` || callerContinuation === `both`
      ? { minValues: [scenario.direction === `asc` ? 0 : 3] }
      : {}),
    ...(callerContinuation === `offset` || callerContinuation === `both`
      ? { offset: 1 }
      : {}),
  }
  const initialWindowSize =
    callerContinuation === `offset` || callerContinuation === `both` ? 2 : 1
  const otherWhere = new Func(`eq`, [
    new PropRef([`route`]),
    new Value(`other`),
  ])
  const visible = new Map<Row[`id`], Row>()
  const publications: Array<
    ReadonlyArray<{ key: string; orderValue: number }>
  > = []
  const subscription = collection.subscribeChanges((changes) => {
    // The projection models semantic publications. requestSnapshot may invoke
    // the callback with an empty transport batch, which cannot change readers.
    if (changes.length === 0) return
    for (const change of changes) {
      const key = change.key as Row[`id`]
      if (change.type === `delete`) visible.delete(key)
      else visible.set(key, change.value)
    }
    publications.push(toModelRows(orderRows([...visible.values()])))
  })
  subscription.setOrderByIndex(orderedIndex)

  const expectedPublicationProjection = () =>
    projectAtomicOrderedPublicationState(history, {
      demandId: `ordered`,
      direction: scenario.direction,
      initialWindowSize,
    })
  const expectedPublications = () =>
    projectAtomicOrderedPublications(history, {
      demandId: `ordered`,
      direction: scenario.direction,
      initialWindowSize,
    })
  const expectPublicationHistory = () => {
    const projection = expectedPublicationProjection()
    const expected = projection.publications
    expect(publications).toEqual(expected)
    if (unsubscribed) return

    // Normal progress may move past the visible prefix. During replacement or
    // after replay failure, however, continuation state belongs to the exact
    // retained publication. Assert its optional boundary, including the empty
    // publication's meaningful `undefined` value.
    if (projection.retainsPreviousPublication) {
      expect(subscription.orderedBoundaryKey).toBe(
        projection.currentPublication?.orderedBoundary?.key,
      )
    }
  }
  const beginReplacement = async () => {
    const pendingStart = pending.length
    begin()
    truncate()
    const receipt = commit()
    if (receipt !== true) await receipt
    await flushPromises()
    const acquisitions = pending.slice(pendingStart)
    const ordered = acquisitions.find(({ options }) => options.orderBy)
    if (!ordered) throw new Error(`Expected an ordered replacement acquisition`)
    expect(ordered.options.offset).toBe(0)
    expect(ordered.options.cursor).toBeUndefined()
    const publicationId = `replacement-${replacementSequence++}`
    history.push({
      type: `beginReplacement`,
      publicationId,
      demandIds: acquisitions.map((acquisition) =>
        acquisition === ordered ? `ordered` : `other`,
      ),
    })
    expectPublicationHistory()
    return { publicationId, acquisitions, ordered } satisfies PendingAttempt
  }
  const settle = async (
    replay: PendingAttempt,
    outcome: `success` | `failure` | `abort`,
    rows: ReadonlyArray<Row>,
    extent: `exhausted` | `continues` = `exhausted`,
    otherOutcome: `success` | `failure` = outcome === `success`
      ? `success`
      : `failure`,
    demandOrder: `ordered-first` | `other-first` = `ordered-first`,
    releaseOtherAfterOrdered = false,
    appliedOrderedRowKeys: ReadonlyArray<Row[`id`]> = replacementRows.map(
      ({ id }) => id,
    ),
    stageEmptyRows = false,
  ) => {
    if (rows.length > 0) await applyRows(rows)
    if (rows.length > 0 || stageEmptyRows) {
      history.push({
        type: `stagePublicationRows`,
        publicationId: replay.publicationId,
        demandId: `ordered`,
        rows: toModelRows(rows),
      })
      expectPublicationHistory()
    }
    const acquisitions = [...replay.acquisitions].sort((left, right) => {
      const leftOrdered = left === replay.ordered
      const rightOrdered = right === replay.ordered
      if (leftOrdered === rightOrdered) return 0
      const orderedFirst = demandOrder === `ordered-first`
      return leftOrdered === orderedFirst ? -1 : 1
    })
    for (const acquisition of acquisitions) {
      const isOrdered = acquisition === replay.ordered
      const demandId = isOrdered ? `ordered` : `other`
      const desiredOutcome = isOrdered ? outcome : otherOutcome
      const aborted = acquisition.options.signal?.aborted ?? false
      const settledOutcome = aborted ? `abort` : desiredOutcome
      if (settledOutcome === `success`) {
        acquisition.deferred.resolve({
          hasMore: isOrdered ? extent === `continues` : false,
          appliedRowKeys: isOrdered
            ? appliedOrderedRowKeys
            : [replacementOtherRow.id],
        })
      } else {
        const error = new Error(
          settledOutcome === `abort`
            ? `obsolete replay aborted`
            : `replay failed`,
        )
        if (settledOutcome === `abort`) error.name = `AbortError`
        acquisition.deferred.reject(error)
      }
      history.push(
        settledOutcome === `success`
          ? {
              type: `settleReplacement`,
              publicationId: replay.publicationId,
              demandId,
              outcome: settledOutcome,
              extent: isOrdered ? extent : `exhausted`,
            }
          : {
              type: `settleReplacement`,
              publicationId: replay.publicationId,
              demandId,
              outcome: settledOutcome,
            },
      )
      await flushPromises()
      expectPublicationHistory()

      if (isOrdered && releaseOtherAfterOrdered) {
        subscription.releaseSnapshot(otherWhere)
        const released = replay.acquisitions.find(
          (candidate) => candidate !== replay.ordered,
        )
        expect(released?.options.signal?.aborted).toBe(true)
        history.push({
          type: `releaseDemand`,
          ownerId: `other-owner`,
          demandId: `other`,
          rowKeys: [replacementOtherRow.id],
          finalRowOwner: true,
          invalidatesAdapterEvidence: true,
        })
        expectPublicationHistory()
      }
    }
  }

  try {
    subscription.requestLimitedSnapshot({
      orderBy,
      limit: 1,
      ...callerContinuationOptions,
    })
    await flushPromises()
    expectPublicationHistory()

    if (scenario.otherDemand !== `none`) {
      history.push({
        type: `requestDemand`,
        ownerId: `other-owner`,
        sessionId: `atomic-session`,
        demandId: `other`,
        alreadyAborted: false,
      })
      subscription.requestSnapshot({ where: otherWhere })
      await flushPromises()
      history.push(
        {
          type: `stagePublicationRows`,
          publicationId: `initial`,
          demandId: `other`,
          rows: toModelRows(initialOtherRows),
        },
        { type: `commitPublication`, publicationId: `initial` },
      )
      expectPublicationHistory()
    }

    const firstReplay = await beginReplacement()
    if (scenario.overlap) {
      await applyRows([obsoleteRow])
      history.push({
        type: `stagePublicationRows`,
        publicationId: firstReplay.publicationId,
        demandId: `ordered`,
        rows: toModelRows([obsoleteRow]),
      })
      expectPublicationHistory()
    }
    const currentReplay = scenario.overlap
      ? await beginReplacement()
      : firstReplay
    if (scenario.overlap) {
      expect(
        firstReplay.acquisitions.every(
          ({ options }) => options.signal?.aborted,
        ),
      ).toBe(true)
    }

    const resizeSizes =
      scenario.resizeOrder === `grow-shrink`
        ? ([2, 0] as const)
        : ([0, 2] as const)
    for (const size of resizeSizes) {
      history.push({ type: `resizeOrderedWindow`, size })
      subscription.ensureOrderedWindowSize(size)
      expectPublicationHistory()
    }

    if (scenario.otherDemand !== `none`) {
      await applyRows([replacementOtherRow])
      history.push({
        type: `stagePublicationRows`,
        publicationId: currentReplay.publicationId,
        demandId: `other`,
        rows: toModelRows([replacementOtherRow]),
      })
      expectPublicationHistory()
      if (scenario.otherDemand === `released`) {
        subscription.releaseSnapshot(otherWhere)
        history.push({
          type: `releaseDemand`,
          ownerId: `other-owner`,
          demandId: `other`,
          rowKeys: [replacementOtherRow.id],
          finalRowOwner: true,
          invalidatesAdapterEvidence: true,
        })
        expectPublicationHistory()
      }
    }

    if (scenario.sourceDelta) {
      await applyRows([sourceDelta])
      history.push({
        type: `stagePublicationRows`,
        publicationId: currentReplay.publicationId,
        demandId: `ordered`,
        rows: toModelRows([sourceDelta]),
      })
      expectPublicationHistory()
    }

    if (scenario.terminal === `unsubscribe`) {
      await applyRows([partialRow])
      history.push({
        type: `stagePublicationRows`,
        publicationId: currentReplay.publicationId,
        demandId: `ordered`,
        rows: toModelRows([partialRow]),
      })
      expectPublicationHistory()
      subscription.unsubscribe()
      unsubscribed = true
      history.push({ type: `cleanupSession`, sessionId: `atomic-session` })
      expectPublicationHistory()
      expect(
        currentReplay.acquisitions.every(
          ({ options }) => options.signal?.aborted,
        ),
      ).toBe(true)
      await applyRows([continuationRow])
      history.push({
        type: `stagePublicationRows`,
        publicationId: currentReplay.publicationId,
        demandId: `ordered`,
        rows: toModelRows([partialRow, continuationRow]),
      })
      expectPublicationHistory()
      await settle(currentReplay, `abort`, [])
      if (scenario.overlap) await settle(firstReplay, `abort`, [])
      expectPublicationHistory()
      return
    }

    const hasEmptyContinuingReplay =
      scenario.emptyContinuingReplay === true &&
      scenario.currentOutcome === `resolve` &&
      scenario.currentExtent === `continues` &&
      scenario.sourceDelta === false &&
      scenario.otherDemand === `none`
    const finalRows = hasEmptyContinuingReplay
      ? []
      : [...replacementRows, ...(scenario.sourceDelta ? [sourceDelta] : [])]
    const partialFailureRows: ReadonlyArray<Row> = [
      {
        id: `new-a`,
        rank: scenario.direction === `asc` ? 99 : -99,
        route: `ordered`,
      },
    ]
    const settleCurrent = () =>
      settle(
        currentReplay,
        scenario.currentOutcome === `resolve` ? `success` : `failure`,
        scenario.currentOutcome === `resolve` ? finalRows : partialFailureRows,
        scenario.currentExtent,
        scenario.otherOutcome === `resolve`
          ? `success`
          : scenario.otherOutcome === `reject`
            ? `failure`
            : scenario.currentOutcome === `resolve`
              ? `success`
              : `failure`,
        scenario.demandSettlementOrder,
        scenario.releaseAfterOrdered,
        hasEmptyContinuingReplay ? [] : replacementRows.map(({ id }) => id),
        hasEmptyContinuingReplay,
      )
    const settleObsolete = () => settle(firstReplay, `abort`, [])

    if (!scenario.overlap) {
      await settleCurrent()
    } else if (scenario.settleCurrentFirst) {
      await settleCurrent()
      await settleObsolete()
    } else {
      await settleObsolete()
      await settleCurrent()
    }

    if (
      scenario.currentOutcome === `resolve` &&
      scenario.currentExtent === `continues`
    ) {
      if (!hasEmptyContinuingReplay) {
        await applyRows([continuationRow])
        history.push({
          type: `stagePublicationRows`,
          publicationId: currentReplay.publicationId,
          demandId: `ordered`,
          rows: toModelRows([...finalRows, continuationRow]),
        })
        expectPublicationHistory()
      }
      subscription.requestLimitedSnapshot({
        orderBy,
        limit: 2,
        trackLoadSubsetPromise: false,
        ...callerContinuationOptions,
      })
      await flushPromises()
      const continuation = pending.at(-1)
      if (!continuation || continuation === currentReplay.ordered) {
        throw new Error(`Expected an ordered continuation acquisition`)
      }
      if (hasEmptyContinuingReplay) {
        expect(continuation.options.offset).toBe(0)
        expect(continuation.options.cursor).toBeUndefined()
        expect(subscription.orderedRetainedWindowSize).toBe(2)
        expectPublicationHistory()
        return
      }
      const expectedPrivateBoundary = orderRows(finalRows).slice(0, 2).at(-1)!
      // Applied-but-unrefined rows establish a private cursor, not an admitted
      // local prefix, so offset remains zero until refinement settles.
      expect(continuation.options.offset).toBe(0)
      expect(continuation.options.cursor?.lastKey).toBe(
        expectedPrivateBoundary.id,
      )
      expect(continuation.options.cursor?.whereCurrent).toBeDefined()
      expect(continuation.options.cursor?.whereFrom).toBeDefined()
      expect(
        evaluateReferenceExpression(continuation.options.cursor!.whereCurrent, {
          rank: expectedPrivateBoundary.rank,
        }),
      ).toBe(true)
      expect(
        evaluateReferenceExpression(continuation.options.cursor!.whereCurrent, {
          rank: scenario.direction === `asc` ? 0 : 3,
        }),
      ).toBe(false)
      expect(
        evaluateReferenceExpression(continuation.options.cursor!.whereFrom, {
          rank:
            expectedPrivateBoundary.rank +
            (scenario.direction === `asc` ? 1 : -1),
        }),
      ).toBe(true)
      expect(
        evaluateReferenceExpression(continuation.options.cursor!.whereFrom, {
          rank: expectedPrivateBoundary.rank,
        }),
      ).toBe(false)
      expect(
        evaluateReferenceExpression(continuation.options.cursor!.whereFrom, {
          rank: scenario.direction === `asc` ? 0 : 3,
        }),
      ).toBe(false)
      continuation.deferred.resolve({
        hasMore: true,
        appliedRowKeys: [continuationRow.id],
      })
      history.push({
        type: `establishReplacementCoverage`,
        publicationId: currentReplay.publicationId,
      })
      await flushPromises()
      expectPublicationHistory()
    }

    const finalProjection = expectedPublicationProjection()
    if (finalProjection.retainsPreviousPublication) {
      const pendingStart = pending.length
      subscription.requestLimitedSnapshot({
        orderBy,
        limit: 1,
        ...callerContinuationOptions,
        trackLoadSubsetPromise: false,
      })
      await flushPromises()
      const restoration = pending[pendingStart]
      if (!restoration) {
        throw new Error(`Expected a retained-publication restoration request`)
      }
      expect(restoration.options.offset).toBe(
        finalProjection.currentPublication?.orderedPrefixSize ?? 0,
      )
      expect(subscription.orderedRetainedWindowSize).toBe(
        Math.max(
          2,
          (finalProjection.currentPublication?.orderedPrefixSize ?? 0) + 1,
        ),
      )
      const expectedBoundary =
        finalProjection.currentPublication?.orderedBoundary
      if (expectedBoundary === undefined) {
        expect(restoration.options.cursor).toBeUndefined()
      } else {
        expect(restoration.options.cursor).toBeDefined()
        expect(restoration.options.cursor?.lastKey).toBe(expectedBoundary.key)
        expect(
          evaluateReferenceExpression(
            restoration.options.cursor!.whereCurrent,
            { rank: expectedBoundary.orderValue },
          ),
        ).toBe(true)
        expect(
          evaluateReferenceExpression(
            restoration.options.cursor!.whereCurrent,
            { rank: scenario.direction === `asc` ? 0 : 3 },
          ),
        ).toBe(false)
        expect(
          evaluateReferenceExpression(restoration.options.cursor!.whereFrom, {
            rank:
              expectedBoundary.orderValue +
              (scenario.direction === `asc` ? 1 : -1),
          }),
        ).toBe(true)
        expect(
          evaluateReferenceExpression(restoration.options.cursor!.whereFrom, {
            rank: expectedBoundary.orderValue,
          }),
        ).toBe(false)
        expect(
          evaluateReferenceExpression(restoration.options.cursor!.whereFrom, {
            rank: scenario.direction === `asc` ? 0 : 3,
          }),
        ).toBe(false)
      }
    }

    const expectedKeys = expectedPublications().map((rows) =>
      rows.map(({ key }) => key),
    )
    expect(publications.map((rows) => rows.map(({ key }) => key))).toEqual(
      expectedKeys,
    )
    expect(publications).toHaveLength(expectedPublications().length)
  } finally {
    for (const replay of pending)
      replay.deferred.resolve({
        hasMore: false,
        appliedRowKeys: [],
      })
    await flushPromises()
    if (!unsubscribed) subscription.unsubscribe()
    await collection.cleanup()
  }
}

const mixedDemandSettlementScenarios: ReadonlyArray<AtomicOrderedReplayScenario> =
  ([`asc`, `desc`] as const).flatMap((direction) => [
    ...([`ordered-first`, `other-first`] as const).flatMap(
      (demandSettlementOrder) => [
        {
          direction,
          resizeOrder: `grow-shrink` as const,
          overlap: false,
          currentOutcome: `resolve` as const,
          currentExtent: `exhausted` as const,
          settleCurrentFirst: false,
          sourceDelta: false,
          otherDemand: `active` as const,
          otherOutcome: `reject` as const,
          demandSettlementOrder,
        },
        {
          direction,
          resizeOrder: `grow-shrink` as const,
          overlap: false,
          currentOutcome: `reject` as const,
          currentExtent: `exhausted` as const,
          settleCurrentFirst: false,
          sourceDelta: false,
          otherDemand: `active` as const,
          otherOutcome: `resolve` as const,
          demandSettlementOrder,
        },
      ],
    ),
    {
      direction,
      resizeOrder: `grow-shrink` as const,
      overlap: false,
      currentOutcome: `resolve` as const,
      currentExtent: `exhausted` as const,
      settleCurrentFirst: false,
      sourceDelta: false,
      otherDemand: `active` as const,
      otherOutcome: `reject` as const,
      demandSettlementOrder: `ordered-first` as const,
      releaseAfterOrdered: true,
    },
  ])

it(`does not reuse caller or public continuation state when an active replacement has no progress`, async () => {
  for (const direction of [`asc`, `desc`] as const) {
    for (const callerContinuation of [
      `none`,
      `min-values`,
      `offset`,
      `both`,
    ] as const) {
      await runAtomicOrderedReplayScenario({
        direction,
        initialPublication: `nonempty`,
        callerContinuation,
        resizeOrder: `grow-shrink`,
        overlap: false,
        currentOutcome: `resolve`,
        currentExtent: `continues`,
        emptyContinuingReplay: true,
        settleCurrentFirst: false,
        sourceDelta: false,
        otherDemand: `none`,
      })
    }
  }
})

it(`uses only private boundary semantics when an active replacement has progress`, async () => {
  for (const direction of [`asc`, `desc`] as const) {
    for (const callerContinuation of [`min-values`, `both`] as const) {
      await runAtomicOrderedReplayScenario({
        direction,
        initialPublication: `nonempty`,
        callerContinuation,
        resizeOrder: `shrink-grow`,
        overlap: false,
        currentOutcome: `resolve`,
        currentExtent: `continues`,
        settleCurrentFirst: false,
        sourceDelta: false,
        otherDemand: `none`,
      })
    }
  }
})

it(`restores failed replay continuation only from the last complete publication`, async () => {
  for (const direction of [`asc`, `desc`] as const) {
    for (const initialPublication of [`empty`, `nonempty`] as const) {
      for (const callerContinuation of [
        `none`,
        `min-values`,
        `offset`,
        `both`,
      ] as const) {
        await runAtomicOrderedReplayScenario({
          direction,
          initialPublication,
          callerContinuation,
          resizeOrder: `grow-shrink`,
          overlap: false,
          currentOutcome: `reject`,
          currentExtent: `continues`,
          settleCurrentFirst: false,
          sourceDelta: false,
          otherDemand: `none`,
        })
      }
    }
  }
})

it(`keeps mixed demand settlements inside one replacement epoch`, async () => {
  for (const scenario of mixedDemandSettlementScenarios) {
    await runAtomicOrderedReplayScenario(scenario)
  }
})

it(`discards pending replacement epochs on teardown`, async () => {
  for (const direction of [`asc`, `desc`] as const) {
    for (const overlap of [false, true]) {
      await runAtomicOrderedReplayScenario({
        direction,
        resizeOrder: `grow-shrink`,
        overlap,
        currentOutcome: `resolve`,
        currentExtent: `exhausted`,
        settleCurrentFirst: false,
        sourceDelta: false,
        otherDemand: `none`,
        terminal: `unsubscribe`,
      })
    }
  }
})

it(`keeps ordered replacement publication atomic across every bounded history`, async () => {
  for (const scenario of exhaustiveAtomicOrderedReplayScenarios) {
    await runAtomicOrderedReplayScenario(scenario)
  }
}, 30_000)

fcTest.prop([atomicOrderedReplayArbitrary], {
  numRuns: 32 * fullFlowMultiplier,
  seed: 17781,
})(
  `keeps ordered replacement publication atomic for a fixed seed`,
  runAtomicOrderedReplayScenario,
)

fcTest.prop(
  [atomicOrderedReplayArbitrary],
  oracleRandomParameters(32 * fullFlowMultiplier, fullFlowReplaySeed),
)(
  `keeps ordered replacement publication atomic for a random or replayed seed`,
  runAtomicOrderedReplayScenario,
)

it(`matches the truncate evidence model across every bounded settlement history`, async () => {
  for (const scenario of exhaustiveTruncateCoverageScenarios) {
    await runTruncateCoverageScenario(scenario)
  }
})

fcTest.prop([truncateCoverageScenarioArbitrary], {
  numRuns: 12 * fullFlowMultiplier,
  seed: 1774,
})(`fences pre-truncate evidence for a fixed seed`, runTruncateCoverageScenario)

fcTest.prop(
  [truncateCoverageScenarioArbitrary],
  oracleRandomParameters(12 * fullFlowMultiplier, fullFlowReplaySeed),
)(
  `fences pre-truncate evidence for a random or replayed seed`,
  runTruncateCoverageScenario,
)
