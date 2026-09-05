import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import {
  abortReplayHistory,
  abortedRestartHistory,
  compoundLifecycleCoverageHistories,
  createLifecycleModel,
  greenLifecycleHistories,
  greenLifecycleHistoryArbitrary,
  mixedAbortedRestartHistory,
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
  LifecycleResultEvent,
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
  current: boolean
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
    continueAfterMismatch?: boolean
  } = {},
): Promise<Set<string>> {
  const acquisitionMode = options.acquisitionMode ?? `async-pending`
  const check = options.continueAfterMismatch ? expect.soft : expect
  const failures = new Map<number, Error>()
  const failureForAttempt = (attemptId: number): Error => {
    const existing = failures.get(attemptId)
    if (existing) return existing
    const failure = new Error(`attempt ${attemptId} failed`)
    failures.set(attemptId, failure)
    return failure
  }
  const model = createLifecycleModel(acquisitionMode, failureForAttempt)
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
  const observedResults: Array<
    LifecycleResultEvent | { attemptId: `unacquired`; resultKind: string }
  > = []
  const observedStatuses: Array<string> = []
  const observedTrace: Array<
    | LifecycleTraceEvent
    | { type: `unload`; attemptId: `unacquired`; handlerSession: number }
    | { type: `error`; attemptId: `unacquired` }
    | { type: `result`; attemptId: `unacquired`; resultKind: string }
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
              failure: failureForAttempt(observed.id),
              settled: acquisitionMode === `sync-success`,
              current: true,
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
    check(observedLoads, context).toEqual(model.loads)
    check(observedUnloads, context).toEqual(model.unloads)
    check(
      observedErrors.map(({ attemptId }) => attemptId),
      context,
    ).toEqual(model.errors.map(({ attemptId }) => attemptId))
    for (const [index, { error }] of observedErrors.entries()) {
      check(error, context).toBe(model.errors[index]?.error)
    }
    check(observedResults, context).toEqual(model.results)
    check(observedStatuses, context).toEqual(model.statuses)
    check(subscription.status, context).toBe(model.status)
    check(subscription.lastError, context).toBe(model.lastError)
    check(collection.status, context).toBe(model.collectionStatus)
    check(publications, context).toEqual(
      Array.from({ length: model.publications }, () => []),
    )
    check(observedTrace, context).toEqual(model.trace)
    for (const attempt of model.attempts) {
      check(
        runtimeAttempts.get(attempt.id)?.options.signal?.aborted,
        context,
      ).toBe(attempt.aborted)
    }
  }

  const selectRuntimeAttempt = (
    command: Extract<LifecycleCommand, { type: `settle` }>,
  ): RuntimeAttempt | undefined => {
    if (observedUnsubscribed) return undefined
    const candidates = [...runtimeAttempts.values()].filter(
      (attempt) =>
        !attempt.settled &&
        attempt.demand === command.demand &&
        attempt.current === (command.scope === `current`),
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
        check(effect.ownerId).toBe(
          model.unsubscribed ? undefined : runtimeOwner?.id,
        )
        const result = subscription.requestSnapshot({
          where: where[command.demand],
          signal: runtimeOwner?.controller.signal,
          onLoadSubsetResult: (result, requestOptions) => {
            const attemptId =
              attemptByOptions.get(requestOptions) ?? `unacquired`
            const resultKind = result === true ? `true` : `promise`
            observedResults.push({ attemptId, resultKind })
            observedTrace.push({ type: `result`, attemptId, resultKind })
          },
        })
        check(result).toBe(effect.requestResult)
      } else if (command.type === `abort`) {
        check(effect.ownerId).toBe(runtimeOwner?.id)
        if (runtimeOwner) {
          runtimeOwner.aborted = true
          runtimeOwner.controller.abort()
        }
      } else if (command.type === `release`) {
        check(effect.ownerId).toBe(runtimeOwner?.id)
        if (runtimeOwner) {
          if (runtimeOwner.attemptId !== undefined) {
            runtimeAttempts.get(runtimeOwner.attemptId)!.current = false
          }
          runtimeOwners.splice(runtimeOwners.indexOf(runtimeOwner), 1)
        }
        subscription.releaseSnapshot(where[command.demand])
      } else if (command.type === `settle`) {
        check(effect.attemptId).toBe(runtimeAttempt?.id)
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
          for (const owner of runtimeOwners) {
            if (owner.attemptId !== undefined) {
              runtimeAttempts.get(owner.attemptId)!.current = false
            }
            owner.attemptId = undefined
          }
        }
        syncOps?.begin()
        syncOps?.truncate()
        const receipt = syncOps?.commit()
        if (receipt !== true) await receipt
      } else if (command.type === `cleanup`) {
        if (observedActive) {
          for (const owner of runtimeOwners) {
            if (owner.attemptId !== undefined) {
              runtimeAttempts.get(owner.attemptId)!.current = false
            }
            owner.attemptId = undefined
          }
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
        for (const attempt of runtimeAttempts.values()) attempt.current = false
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
    for (const history of [
      ...greenLifecycleHistories,
      ...compoundLifecycleCoverageHistories,
    ]) {
      for (const label of await runHistory(history)) reach.add(label)
    }
    const commands = [
      `request`,
      `abort`,
      `release`,
      `settle`,
      `truncate`,
      `cleanup`,
      `restart`,
      `unsubscribe`,
    ]
    const required = new Set([
      ...commands.map((type) => `command:${type}`),
      ...commands.map((type) => `effective:${type}`),
      ...commands.map((type) => `noop:${type}`),
      `settle-scope:current`,
      `settle-scope:obsolete`,
      `settle-age:oldest`,
      `settle-age:newest`,
      `settle-outcome:resolve`,
      `settle-outcome:reject`,
      ...([`current`, `obsolete`] as const).flatMap((scope) =>
        ([`oldest`, `newest`] as const).flatMap((age) =>
          ([`resolve`, `reject`] as const).map(
            (outcome) => `settle:${scope}:${age}:${outcome}`,
          ),
        ),
      ),
      `attempt-session:initial`,
      `attempt-session:restarted`,
      `attempt-replay:initial`,
      `attempt-replay:replayed`,
      `attempt-location:initial:initial`,
      `attempt-location:initial:replayed`,
      `attempt-location:restarted:initial`,
      `attempt-location:restarted:replayed`,
      `duplicate-owner`,
      `request-while-cleaned`,
      `partial-generation-supersession`,
    ])
    expect([...required].filter((label) => !reach.has(label))).toEqual([])
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

  it(`releases exact current ownership after overlapping replay status diverges`, async () => {
    await runHistory(
      [
        ...pendingSupersessionHistory,
        { type: `cleanup` },
        { type: `restart` },
        { type: `release`, demand: `a` },
        { type: `unsubscribe` },
      ],
      { continueAfterMismatch: true },
    )
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
    await runHistory(
      [
        ...abortReplayHistory,
        { type: `cleanup` },
        { type: `restart` },
        { type: `unsubscribe` },
      ],
      { continueAfterMismatch: true },
    )
  })

  it(`replays a live peer without reacquiring an aborted demand`, async () => {
    await runHistory([
      { type: `request`, demand: `a` },
      { type: `request`, demand: `b` },
      { type: `abort`, demand: `a` },
      {
        type: `settle`,
        demand: `a`,
        scope: `current`,
        age: `oldest`,
        outcome: `reject`,
      },
      { type: `truncate` },
      {
        type: `settle`,
        demand: `b`,
        scope: `current`,
        age: `oldest`,
        outcome: `resolve`,
      },
      { type: `release`, demand: `a` },
      { type: `release`, demand: `b` },
    ])
  })

  it(`restarts a live peer without reacquiring an aborted demand and completes teardown`, async () => {
    await runHistory(mixedAbortedRestartHistory, {
      continueAfterMismatch: true,
    })
  })

  const syncReplayScenarios = ([`truncate`, `restart`] as const).flatMap(
    (transition) =>
      ([1, 2] as const).flatMap((ownerCount) =>
        ([false, true] as const).map((abortFirst) => {
          const history: Array<LifecycleCommand> = [
            { type: `request`, demand: `a` },
            ...(ownerCount === 2
              ? ([{ type: `request`, demand: `b` }] as const)
              : []),
            ...(abortFirst ? ([{ type: `abort`, demand: `a` }] as const) : []),
            ...(transition === `truncate`
              ? ([{ type: `truncate` }] as const)
              : ([{ type: `cleanup` }, { type: `restart` }] as const)),
          ]
          return { transition, ownerCount, abortFirst, history }
        }),
      ),
  )

  it.each(syncReplayScenarios)(
    `does not create loading work for synchronous $transition with $ownerCount owner(s), abort=$abortFirst`,
    async ({ history }) => {
      await runHistory(history, { acquisitionMode: `sync-success` })
    },
  )

  it(`preserves physical ownership after a synchronous replay status mismatch`, async () => {
    await runHistory(syncLifecycleHistory, {
      acquisitionMode: `sync-success`,
      continueAfterMismatch: true,
    })
  })

  it.each([
    {
      name: `same-key owners across truncate`,
      history: [
        { type: `request`, demand: `a` },
        { type: `request`, demand: `a` },
        { type: `truncate` },
        { type: `release`, demand: `a` },
        { type: `release`, demand: `a` },
        { type: `cleanup` },
        { type: `restart` },
        { type: `unsubscribe` },
      ],
    },
    {
      name: `same-key owners across restart`,
      history: [
        { type: `request`, demand: `a` },
        { type: `request`, demand: `a` },
        { type: `cleanup` },
        { type: `restart` },
        { type: `release`, demand: `a` },
        { type: `release`, demand: `a` },
        { type: `unsubscribe` },
      ],
    },
    {
      name: `detached last-owner abort across restart`,
      history: [
        { type: `request`, demand: `a` },
        { type: `cleanup` },
        { type: `abort`, demand: `a` },
        { type: `restart` },
        { type: `release`, demand: `a` },
        { type: `unsubscribe` },
      ],
    },
  ] satisfies ReadonlyArray<{
    name: string
    history: ReadonlyArray<LifecycleCommand>
  }>)(
    `continues through the full synchronous replay suffix for $name`,
    async ({ history }) => {
      await runHistory(history, {
        acquisitionMode: `sync-success`,
        continueAfterMismatch: true,
      })
    },
  )

  it(`keeps a new snapshot private after failed restart`, async () => {
    // Minimized from seed 317005625 at 100×. The mismatch is an empty
    // notification, not lost rows: failed replacement must keep reads private.
    await runHistory(
      [
        { type: `request`, demand: `b` },
        { type: `cleanup` },
        { type: `restart` },
        {
          type: `settle`,
          demand: `b`,
          scope: `current`,
          age: `oldest`,
          outcome: `reject`,
        },
        { type: `request`, demand: `a` },
        {
          type: `settle`,
          demand: `a`,
          scope: `current`,
          age: `oldest`,
          outcome: `resolve`,
        },
        { type: `release`, demand: `a` },
        { type: `release`, demand: `b` },
        { type: `cleanup` },
        { type: `restart` },
        { type: `unsubscribe` },
      ],
      { continueAfterMismatch: true },
    )
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
