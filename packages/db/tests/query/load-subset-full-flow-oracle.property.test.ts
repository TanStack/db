import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import { createDeferred } from '../../src/deferred.js'
import {
  projectAdapterLifecycle,
  projectRetainedRowKeys,
  projectReusableDemands,
  projectTransportLoads,
} from '../load-subset-full-flow-model.js'
import {
  oracleRandomParameters,
  readOracleRunConfig,
} from '../oracle-config.js'
import type { LoadSubsetOptions } from '../../src/types.js'
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

const { multiplier: truncateMultiplier, replaySeed: truncateReplaySeed } =
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

it(`matches the truncate evidence model across every bounded settlement history`, async () => {
  for (const scenario of exhaustiveTruncateCoverageScenarios) {
    await runTruncateCoverageScenario(scenario)
  }
})

fcTest.prop([truncateCoverageScenarioArbitrary], {
  numRuns: 12 * truncateMultiplier,
  seed: 1774,
})(`fences pre-truncate evidence for a fixed seed`, runTruncateCoverageScenario)

fcTest.prop(
  [truncateCoverageScenarioArbitrary],
  oracleRandomParameters(12 * truncateMultiplier, truncateReplaySeed),
)(
  `fences pre-truncate evidence for a random or replayed seed`,
  runTruncateCoverageScenario,
)
