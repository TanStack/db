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
  id: number
  ownerId: number
  demand: DemandName
  options: LoadSubsetOptions
  deferred?: ReturnType<typeof createDeferred<void>>
  failure: Error
  settled: boolean
}
type RuntimeOwner = {
  id: number
  demand: DemandName
  controller: AbortController
  aborted: boolean
  attemptId?: number
}

async function runHistory(
  history: ReadonlyArray<LifecycleCommand>,
  options: {
    acquisitionMode?: `async-pending` | `sync-success`
    traceProjection?: `all` | `without-status`
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
  const runtimeOwners: Array<RuntimeOwner> = []
  const attemptByOptions = new Map<LoadSubsetOptions, number>()
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
  let nextObservedOwnerId = 0
  let observedReplay = 0
  let observedSession = -1
  let observedActive = true
  let observedUnsubscribed = false
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
            const owner = runtimeOwners.find(
              (candidate) =>
                candidate.demand === demand &&
                !candidate.aborted &&
                candidate.attemptId === undefined,
            )
            if (!owner) throw new Error(`adapter load has no runtime owner`)
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
            runtimeAttempts.set(observed.id, {
              id: observed.id,
              ownerId: owner.id,
              demand,
              options,
              deferred,
              failure: new Error(`attempt ${observed.id} failed`),
              settled: acquisitionMode === `sync-success`,
            })
            owner.attemptId = observed.id
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
    expect(
      observedErrors.map(({ attemptId, error }) => ({
        attemptId,
        message: error instanceof Error ? error.message : String(error),
      })),
      context,
    ).toEqual(
      model.errors.map(({ attemptId, error }) => ({
        attemptId,
        message: error.message,
      })),
    )
    expect(observedResults, context).toEqual(model.results)
    if (options.traceProjection !== `without-status`) {
      expect(observedStatuses, context).toEqual(model.statuses)
    }
    expect(subscription.status, context).toBe(model.status)
    expect(
      subscription.lastError instanceof Error
        ? subscription.lastError.message
        : undefined,
      context,
    ).toBe(model.lastError?.message)
    expect(collection.status, context).toBe(model.collectionStatus)
    expect(publications, context).toEqual(
      Array.from({ length: model.publications }, () => []),
    )
    const projectTrace = <T extends { type: string }>(
      trace: ReadonlyArray<T>,
    ) =>
      options.traceProjection === `without-status`
        ? trace.filter(({ type }) => type !== `status`)
        : [...trace]
    expect(projectTrace(observedTrace), context).toEqual(
      projectTrace(model.trace),
    )
    for (const attempt of model.attempts) {
      expect(
        runtimeAttempts.get(attempt.id)?.options.signal?.aborted,
        context,
      ).toBe(attempt.aborted)
    }
  }

  const selectRuntimeAttempt = (
    command: Extract<LifecycleCommand, { type: `settle` }>,
  ): RuntimeAttempt | undefined => {
    if (observedUnsubscribed) return undefined
    const currentAttemptIds = new Set(
      runtimeOwners.flatMap(({ attemptId }) =>
        attemptId === undefined ? [] : [attemptId],
      ),
    )
    const candidates = [...runtimeAttempts.values()].filter(
      (attempt) =>
        !attempt.settled &&
        attempt.demand === command.demand &&
        (command.scope === `current`
          ? currentAttemptIds.has(attempt.id)
          : !currentAttemptIds.has(attempt.id)),
    )
    return command.age === `oldest` ? candidates[0] : candidates.at(-1)
  }

  try {
    for (const command of history) {
      const runtimeOwner =
        command.type === `request`
          ? {
              id: nextObservedOwnerId++,
              demand: command.demand,
              controller: new AbortController(),
              aborted: false,
            }
          : command.type === `abort`
            ? runtimeOwners.find(
                ({ demand, aborted }) => demand === command.demand && !aborted,
              )
            : command.type === `release`
              ? runtimeOwners.find(({ demand }) => demand === command.demand)
              : undefined
      if (command.type === `request` && !model.unsubscribed) {
        runtimeOwners.push(runtimeOwner!)
      }
      const runtimeAttempt =
        command.type === `settle` ? selectRuntimeAttempt(command) : undefined
      const effect = reduceLifecycle(model, command)
      if (command.type === `request`) {
        expect(effect.ownerId).toBe(
          model.unsubscribed ? undefined : runtimeOwner?.id,
        )
        const result = subscription.requestSnapshot({
          where: where[command.demand],
          signal: runtimeOwner?.controller.signal,
          onLoadSubsetResult: (_result, requestOptions) => {
            const attemptId =
              attemptByOptions.get(requestOptions) ?? `unacquired`
            observedResults.push(attemptId)
            observedTrace.push({ type: `result`, attemptId })
          },
        })
        expect(result).toBe(effect.requestResult)
      } else if (command.type === `abort`) {
        expect(effect.ownerId).toBe(runtimeOwner?.id)
        if (runtimeOwner) {
          runtimeOwner.aborted = true
          runtimeOwner.controller.abort()
        }
      } else if (command.type === `release`) {
        expect(effect.ownerId).toBe(runtimeOwner?.id)
        if (runtimeOwner) {
          runtimeOwners.splice(runtimeOwners.indexOf(runtimeOwner), 1)
        }
        subscription.releaseSnapshot(where[command.demand])
      } else if (command.type === `settle`) {
        expect(effect.attemptId).toBe(runtimeAttempt?.id)
        if (effect.attemptId === undefined) {
          // Neither model found an effective settlement.
        } else if (!runtimeAttempt?.deferred) {
          throw new Error(`model selected an already settled acquisition`)
        } else {
          runtimeAttempt.settled = true
          if (command.outcome === `resolve`) runtimeAttempt.deferred.resolve()
          else runtimeAttempt.deferred.reject(runtimeAttempt.failure)
        }
      } else if (command.type === `truncate`) {
        if (observedActive) {
          observedReplay++
          for (const owner of runtimeOwners) owner.attemptId = undefined
        }
        syncOps?.begin()
        syncOps?.truncate()
        const receipt = syncOps?.commit()
        if (receipt !== true) await receipt
      } else if (command.type === `cleanup`) {
        if (observedActive) {
          for (const owner of runtimeOwners) owner.attemptId = undefined
        }
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
        observedUnsubscribed = true
        runtimeOwners.length = 0
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
        `partial-generation-supersession`,
      ]),
    )
  })

  it(`names the known-red overlapping replay transition without claiming it passed`, () => {
    const model = createLifecycleModel()
    for (const command of pendingSupersessionHistory) {
      reduceLifecycle(model, command)
    }
    expect(model.reach).toContain(`overlapping-replay`)
  })

  it.each([
    {
      name: `one demand after one replay`,
      history: [
        { type: `request`, demand: `a` },
        { type: `truncate` },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
      ] satisfies Array<LifecycleCommand>,
    },
    {
      name: `duplicate owners after overlapping replay`,
      history: pendingSupersessionHistory,
    },
  ])(`retires obsolete pending status for $name`, async ({ history }) => {
    await runHistory(history)
  })

  it.each([
    { name: `truncate replay`, history: abortReplayHistory },
    { name: `cleanup restart`, history: abortedRestartHistory },
  ])(
    `does not create loading work for an aborted demand on $name`,
    async ({ history }) => {
      await runHistory(history)
    },
  )

  it(`does not release an unacquired replacement after an aborted demand replays`, async () => {
    await runHistory(abortReplayHistory, { traceProjection: `without-status` })
  })

  it.each([
    {
      name: `one-demand truncate`,
      history: [
        { type: `request`, demand: `a` },
        { type: `truncate` },
      ] satisfies Array<LifecycleCommand>,
    },
    {
      name: `one-demand cleanup restart`,
      history: [
        { type: `request`, demand: `a` },
        { type: `cleanup` },
        { type: `restart` },
      ] satisfies Array<LifecycleCommand>,
    },
    { name: `multi-demand replay and release`, history: syncLifecycleHistory },
  ])(
    `does not create loading work for synchronous $name`,
    async ({ history }) => {
      await runHistory(history, { acquisitionMode: `sync-success` })
    },
  )

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
