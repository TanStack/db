import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import {
  abortReplayHistory,
  abortedRestartHistory,
  createLifecycleModel,
  greenLifecycleHistories,
  greenLifecycleHistoryArbitrary,
  pendingSupersessionHistory,
  reduceLifecycle,
  syncLifecycleHistory,
  syncLifecycleHistoryArbitrary,
} from './collection-subscription-lifecycle-grammar.js'
import { flushPromises } from './utils.js'
import {
  oraclePropertyOptions,
  oracleRandomParameters,
  readOracleRunConfig,
} from './oracle-config.js'
import type { LoadSubsetOptions, SyncConfig } from '../src/types.js'
import type {
  DemandName,
  LifecycleCommand,
  LifecycleLoadEvent,
  LifecycleTraceEvent,
  LifecycleUnloadEvent,
} from './collection-subscription-lifecycle-grammar.js'

type RuntimeAttempt = {
  options: LoadSubsetOptions
  deferred?: ReturnType<typeof createDeferred<void>>
}

async function runHistory(
  history: ReadonlyArray<LifecycleCommand>,
  options: {
    acquisitionMode?: `async-pending` | `sync-success`
    ignoreStatusTrace?: boolean
  } = {},
): Promise<Set<string>> {
  const acquisitionMode = options.acquisitionMode ?? `async-pending`
  const model = createLifecycleModel(acquisitionMode)
  const where = {
    a: new Func(`eq`, [new PropRef([`id`]), new Value(`a`)]),
    b: new Func(`eq`, [new PropRef([`id`]), new Value(`b`)]),
  }
  const demandForWhere = new Map<unknown, DemandName>([
    [where.a, `a`],
    [where.b, `b`],
  ])
  const runtimeAttempts = new Map<number, RuntimeAttempt>()
  const attemptByOptions = new Map<LoadSubsetOptions, number>()
  const ownerControllers = new Map<number, AbortController>()
  const observedLoads: Array<LifecycleLoadEvent> = []
  const observedUnloads: Array<
    LifecycleUnloadEvent | { attemptId: `unacquired`; handlerSession: number }
  > = []
  const observedErrors: Array<{
    attemptId: number | `unacquired`
    error: unknown
  }> = []
  const observedResults: Array<number | `unacquired`> = []
  const observedStatuses: Array<string> = []
  const observedTrace: Array<
    | LifecycleTraceEvent
    | { type: `unload`; attemptId: `unacquired`; handlerSession: number }
    | { type: `error`; attemptId: `unacquired` }
    | { type: `result`; attemptId: `unacquired` }
  > = []
  let nextObservedAttemptId = 0
  let observedReplay = 0
  let observedSession = -1
  let observedActive = true
  let syncOps:
    | Parameters<SyncConfig<{ id: string }, string>[`sync`]>[0]
    | undefined

  const collection = createCollection<{ id: string }, string>({
    id: `generated-async-demand-lifecycle`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (operations) => {
        const handlerSession = ++observedSession
        syncOps = operations
        operations.markReady()
        return {
          loadSubset: (options) => {
            const demand = demandForWhere.get(options.where)
            if (!demand) throw new Error(`adapter load lost its demand`)
            const observed: LifecycleLoadEvent = {
              id: nextObservedAttemptId++,
              demand,
              session: handlerSession,
              replay: observedReplay,
            }
            const deferred =
              acquisitionMode === `async-pending`
                ? createDeferred<void>()
                : undefined
            void deferred?.promise.catch(() => undefined)
            runtimeAttempts.set(observed.id, { options, deferred })
            attemptByOptions.set(options, observed.id)
            observedLoads.push(observed)
            observedTrace.push({ type: `load`, ...observed })
            return deferred?.promise ?? true
          },
          unloadSubset: (options) => {
            const unload = {
              attemptId: attemptByOptions.get(options) ?? `unacquired`,
              handlerSession,
            } as const
            observedUnloads.push(unload)
            observedTrace.push({ type: `unload`, ...unload })
          },
        }
      },
    },
  })
  const publications: Array<unknown> = []
  const subscription = collection.subscribeChanges(
    (changes) => {
      publications.push(changes)
      observedTrace.push({ type: `publication` })
    },
    { includeInitialState: false },
  )
  subscription.on(`status:change`, ({ status }) => {
    observedStatuses.push(status)
    observedTrace.push({ type: `status`, status })
  })
  subscription.on(`loadSubset:error`, ({ options, error }) => {
    const attemptId = attemptByOptions.get(options) ?? `unacquired`
    observedErrors.push({ attemptId, error })
    observedTrace.push({ type: `error`, attemptId })
  })

  const assertState = (command: LifecycleCommand) => {
    const context = JSON.stringify({
      history,
      command,
      observedTrace,
      expectedTrace: model.trace,
    })
    expect(observedLoads, context).toEqual(model.loads)
    expect(observedUnloads, context).toEqual(model.unloads)
    expect(observedErrors, context).toEqual(model.errors)
    expect(observedResults, context).toEqual(model.results)
    if (!options.ignoreStatusTrace) {
      expect(observedStatuses, context).toEqual(model.statuses)
    }
    expect(subscription.status, context).toBe(model.status)
    expect(subscription.lastError, context).toBe(model.lastError)
    expect(collection.status, context).toBe(model.collectionStatus)
    expect(publications, context).toEqual(
      Array.from({ length: model.publications }, () => []),
    )
    expect([...observedTrace], context).toEqual([...model.trace])
    for (const attempt of model.attempts) {
      expect(
        runtimeAttempts.get(attempt.id)?.options.signal?.aborted,
        context,
      ).toBe(attempt.aborted)
    }
  }

  try {
    for (const command of history) {
      const effect = reduceLifecycle(model, command)
      if (command.type === `request`) {
        const controller = new AbortController()
        if (effect.ownerId !== undefined) {
          ownerControllers.set(effect.ownerId, controller)
        }
        const result = subscription.requestSnapshot({
          where: where[command.demand],
          signal: controller.signal,
          onLoadSubsetResult: (_result, requestOptions) => {
            const attemptId =
              attemptByOptions.get(requestOptions) ?? `unacquired`
            observedResults.push(attemptId)
            observedTrace.push({ type: `result`, attemptId })
          },
        })
        expect(result).toBe(effect.requestResult)
      } else if (command.type === `abort`) {
        if (effect.ownerId !== undefined) {
          ownerControllers.get(effect.ownerId)?.abort()
        }
      } else if (command.type === `release`) {
        subscription.releaseSnapshot(where[command.demand])
      } else if (command.type === `settle` && effect.attemptId !== undefined) {
        const runtime = runtimeAttempts.get(effect.attemptId)
        if (!runtime) throw new Error(`model selected an unobserved attempt`)
        const attempt = model.attempts[effect.attemptId]!
        if (!runtime.deferred) {
          throw new Error(`model selected an already settled acquisition`)
        }
        if (command.outcome === `resolve`) runtime.deferred.resolve()
        else runtime.deferred.reject(attempt.failure)
      } else if (command.type === `truncate`) {
        if (observedActive) observedReplay++
        syncOps?.begin()
        syncOps?.truncate()
        const receipt = syncOps?.commit()
        if (receipt !== true) await receipt
      } else if (command.type === `cleanup`) {
        await collection.cleanup()
        observedActive = false
      } else if (command.type === `restart`) {
        if (!observedActive) {
          observedReplay = 0
          observedActive = true
        }
        collection.startSyncImmediate()
      } else if (command.type === `unsubscribe`) {
        subscription.unsubscribe()
      }
      await flushPromises()
      assertState(command)
    }
  } finally {
    for (const { deferred } of runtimeAttempts.values()) deferred?.resolve()
    await flushPromises()
    subscription.unsubscribe()
    await collection.cleanup()
  }
  return model.reach
}

if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
  fc.statistics(
    greenLifecycleHistoryArbitrary,
    (history) => {
      const model = createLifecycleModel()
      for (const command of history) reduceLifecycle(model, command)
      return [...model.reach]
    },
    oraclePropertyOptions(1_000, `subscription-lifecycle.history-statistics`),
  )
}

describe(`CollectionSubscription async lifecycle history oracle`, () => {
  it(`covers every required command and cross-phase transition`, async () => {
    const reach = new Set<string>()
    for (const history of greenLifecycleHistories) {
      for (const label of await runHistory(history)) reach.add(label)
    }
    for (const history of [pendingSupersessionHistory, abortReplayHistory]) {
      const model = createLifecycleModel()
      for (const command of history) reduceLifecycle(model, command)
      for (const label of model.reach) reach.add(label)
    }
    expect(reach).toEqual(
      new Set([
        ...[
          `request`,
          `abort`,
          `release`,
          `settle`,
          `truncate`,
          `cleanup`,
          `restart`,
          `unsubscribe`,
        ].map((type) => `command:${type}`),
        `duplicate-owner`,
        `request-while-cleaned`,
        `overlapping-replay`,
        `partial-generation-supersession`,
      ]),
    )
  })

  it(`retires pending acquisition status when replay supersedes it`, async () => {
    await runHistory(pendingSupersessionHistory)
  })

  it(`does not create loading work when an aborted demand replays`, async () => {
    await runHistory(abortReplayHistory)
  })

  it(`does not create loading work when an aborted demand restarts`, async () => {
    await runHistory(abortedRestartHistory)
  })

  it(`does not release an unacquired replacement after an aborted demand replays`, async () => {
    await runHistory(abortReplayHistory, { ignoreStatusTrace: true })
  })

  it(`does not create loading work for synchronous replay`, async () => {
    await runHistory(syncLifecycleHistory, { acquisitionMode: `sync-success` })
  })

  const { multiplier, ...replay } = readOracleRunConfig()
  const runs = 80 * multiplier

  fcTest.prop([greenLifecycleHistoryArbitrary], {
    numRuns: runs,
    seed: 1_657_003,
  })(
    `matches the pure lifecycle model for a fixed seed`,
    async (history) => {
      await runHistory(history)
    },
    120_000,
  )
  fcTest.prop(
    [greenLifecycleHistoryArbitrary],
    oracleRandomParameters(
      runs,
      replay,
      `subscription-lifecycle.async-history`,
    ),
  )(
    `matches the pure lifecycle model for a random or replayed seed`,
    async (history) => {
      await runHistory(history)
    },
    120_000,
  )
  fcTest.prop([syncLifecycleHistoryArbitrary], {
    numRuns: runs,
    seed: 1_657_004,
  })(
    `matches synchronous success histories for a fixed seed`,
    async (history) => {
      await runHistory(history, { acquisitionMode: `sync-success` })
    },
    120_000,
  )
  fcTest.prop(
    [syncLifecycleHistoryArbitrary],
    oracleRandomParameters(runs, replay, `subscription-lifecycle.sync-history`),
  )(
    `matches synchronous success histories for a random or replayed seed`,
    async (history) => {
      await runHistory(history, { acquisitionMode: `sync-success` })
    },
    120_000,
  )
})
