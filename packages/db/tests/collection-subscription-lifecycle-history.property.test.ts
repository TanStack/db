import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { flushPromises } from './utils.js'
import {
  oraclePropertyOptions,
  oracleRandomParameters,
  readOracleRunConfig,
} from './oracle-config.js'
import type { LoadSubsetOptions, SyncConfig } from '../src/types.js'

type DemandName = `a` | `b`
type SettlementOutcome = `resolve` | `reject`
type AttemptScope = `current` | `obsolete`

type AsyncLifecycleCommand =
  | { type: `request`; demand: DemandName }
  | { type: `abort`; demand: DemandName }
  | { type: `release`; demand: DemandName }
  | {
      type: `settle`
      demand: DemandName
      scope: AttemptScope
      outcome: SettlementOutcome
    }
  | { type: `truncate` }
  | { type: `cleanup` }
  | { type: `restart` }
  | { type: `unsubscribe` }

const asyncLifecycleCommandArbitrary: fc.Arbitrary<AsyncLifecycleCommand> =
  fc.oneof(
    fc.record({
      type: fc.constant(`request` as const),
      demand: fc.constantFrom(`a` as const, `b` as const),
    }),
    fc.record({
      type: fc.constant(`release` as const),
      demand: fc.constantFrom(`a` as const, `b` as const),
    }),
    fc.record({
      type: fc.constant(`abort` as const),
      demand: fc.constantFrom(`a` as const, `b` as const),
    }),
    fc.record({
      type: fc.constant(`settle` as const),
      demand: fc.constantFrom(`a` as const, `b` as const),
      scope: fc.constantFrom(`current` as const, `obsolete` as const),
      outcome: fc.constantFrom(`resolve` as const, `reject` as const),
    }),
    fc.constant({ type: `truncate` as const }),
    fc.constant({ type: `cleanup` as const }),
    fc.constant({ type: `restart` as const }),
    fc.constant({ type: `unsubscribe` as const }),
  )

const asyncLifecycleHistoryArbitrary = fc.array(
  // External abort has one known replay bug cataloged below. Keep the broad
  // green history property useful until that red is fixed, then remove this
  // filter so abort participates in arbitrary interleavings too.
  asyncLifecycleCommandArbitrary.filter(({ type }) => type !== `abort`),
  { minLength: 1, maxLength: 20 },
)

type Attempt = {
  id: number
  session: number
  demand: DemandName
  ownerId?: number
  options: LoadSubsetOptions
  deferred: ReturnType<typeof createDeferred<void>>
  failure: Error
  settled: boolean
  gating: boolean
  reportable: boolean
  shouldBeAborted: boolean
}

type Owner = {
  id: number
  demand: DemandName
  abortController: AbortController
  acquisition?: Attempt
}

type EffectiveCoverage = {
  types: Set<AsyncLifecycleCommand[`type`]>
  partialRestart: boolean
  duplicateOwner: boolean
  requestWhileCleaned: boolean
  overlappingReplay: boolean
}

function classifyAsyncLifecycleHistory(
  history: ReadonlyArray<AsyncLifecycleCommand>,
): EffectiveCoverage {
  const owners: Array<DemandName> = []
  const pending: Array<{ session: number; demand: DemandName }> = []
  const types = new Set<AsyncLifecycleCommand[`type`]>()
  let session = 0
  let active = true
  let unsubscribed = false
  let partialRestart = false
  let duplicateOwner = false
  let requestWhileCleaned = false
  let overlappingReplay = false

  for (const command of history) {
    if (unsubscribed) break
    if (command.type === `request`) {
      types.add(command.type)
      duplicateOwner ||= owners.includes(command.demand)
      requestWhileCleaned ||= !active
      owners.push(command.demand)
      if (active) pending.push({ session, demand: command.demand })
    } else if (command.type === `abort`) {
      if (!owners.includes(command.demand)) continue
      types.add(command.type)
    } else if (command.type === `release`) {
      const owner = owners.indexOf(command.demand)
      if (owner === -1) continue
      types.add(command.type)
      owners.splice(owner, 1)
    } else if (command.type === `settle`) {
      const attempt = pending.find(
        (candidate) =>
          candidate.demand === command.demand &&
          (command.scope === `current`
            ? candidate.session === session
            : candidate.session !== session),
      )
      if (!attempt) continue
      types.add(command.type)
      pending.splice(pending.indexOf(attempt), 1)
    } else if (command.type === `cleanup`) {
      if (!active) continue
      types.add(command.type)
      active = false
    } else if (command.type === `restart`) {
      if (active) continue
      types.add(command.type)
      partialRestart ||= pending.some((attempt) => attempt.session === session)
      active = true
      session++
      pending.push(...owners.map((demand) => ({ session, demand })))
    } else if (command.type === `truncate`) {
      if (!active || owners.length === 0) continue
      types.add(command.type)
      overlappingReplay ||= pending.some(
        (attempt) => attempt.session === session,
      )
      pending.push(...owners.map((demand) => ({ session, demand })))
    } else {
      types.add(command.type)
      unsubscribed = true
    }
  }

  return {
    types,
    partialRestart,
    duplicateOwner,
    requestWhileCleaned,
    overlappingReplay,
  }
}

if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
  fc.statistics(
    asyncLifecycleHistoryArbitrary,
    (history) => {
      const coverage = classifyAsyncLifecycleHistory(history)
      return [
        ...coverage.types,
        `partial-restart=${coverage.partialRestart}`,
        `duplicate-owner=${coverage.duplicateOwner}`,
        `request-while-cleaned=${coverage.requestWhileCleaned}`,
        `overlapping-replay=${coverage.overlappingReplay}`,
      ]
    },
    oraclePropertyOptions(1_000, `subscription-lifecycle.history-statistics`),
  )
}

async function runAsyncLifecycleHistory(
  history: ReadonlyArray<AsyncLifecycleCommand>,
): Promise<void> {
  const where = {
    a: new Func(`eq`, [new PropRef([`id`]), new Value(`a`)]),
    b: new Func(`eq`, [new PropRef([`id`]), new Value(`b`)]),
  }
  const demandForWhere = new Map<unknown, DemandName>([
    [where.a, `a`],
    [where.b, `b`],
  ])
  const attempts: Array<Attempt> = []
  const owners: Array<Owner> = []
  const unloadIds: Array<number | `unacquired`> = []
  const expectedUnloadIds: Array<number> = []
  const errors: Array<{ attemptId: number; error: unknown }> = []
  const expectedErrors: Array<{ attemptId: number; error: unknown }> = []
  const statuses: Array<string> = []
  const expectedStatuses: Array<string> = []
  let expectedStatus = `ready`
  let session = -1
  let active = false
  let unsubscribed = false
  let nextOwnerId = 0
  let nextAttemptId = 0
  let syncOps:
    | Parameters<SyncConfig<{ id: string }, string>[`sync`]>[0]
    | undefined

  const attemptByOptions = new Map<LoadSubsetOptions, Attempt>()
  const collection = createCollection<{ id: string }, string>({
    id: `generated-async-demand-lifecycle`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (operations) => {
        session++
        active = true
        syncOps = operations
        operations.markReady()
        const ownSession = session
        return {
          loadSubset: (options) => {
            const demand = demandForWhere.get(options.where)
            if (!demand) throw new Error(`unknown generated async demand`)
            const id = nextAttemptId++
            const deferred = createDeferred<void>()
            void deferred.promise.catch(() => undefined)
            const attempt: Attempt = {
              id,
              session: ownSession,
              demand,
              options,
              deferred,
              failure: new Error(`attempt ${id} failed`),
              settled: false,
              gating: true,
              reportable: true,
              shouldBeAborted: false,
            }
            attempts.push(attempt)
            attemptByOptions.set(options, attempt)
            return deferred.promise
          },
          unloadSubset: (options) => {
            const attempt = attemptByOptions.get(options)
            unloadIds.push(attempt?.id ?? `unacquired`)
          },
        }
      },
    },
  })
  const subscription = collection.subscribeChanges(() => {}, {
    includeInitialState: false,
  })
  subscription.on(`status:change`, ({ status }) => statuses.push(status))
  subscription.on(`loadSubset:error`, ({ options, error }) => {
    const attempt = attemptByOptions.get(options)
    if (!attempt) throw new Error(`unknown generated async error`)
    errors.push({ attemptId: attempt.id, error })
  })

  const setExpectedStatus = () => {
    if (unsubscribed) return
    const next =
      active && attempts.some((attempt) => attempt.gating && !attempt.settled)
        ? `loadingSubset`
        : `ready`
    if (next !== expectedStatus) {
      expectedStatus = next
      expectedStatuses.push(next)
    }
  }

  const assertState = (command: AsyncLifecycleCommand) => {
    setExpectedStatus()
    expect(
      attempts.map(({ session: attemptSession, demand }) => ({
        session: attemptSession,
        demand,
      })),
      JSON.stringify({ history, command }),
    ).toHaveLength(nextAttemptId)
    expect(unloadIds, JSON.stringify({ history, command })).toEqual(
      expectedUnloadIds,
    )
    expect(errors, JSON.stringify({ history, command })).toEqual(expectedErrors)
    expect(statuses, JSON.stringify({ history, command })).toEqual(
      expectedStatuses,
    )
    expect(subscription.status, JSON.stringify({ history, command })).toBe(
      expectedStatus,
    )
    expect(subscription.lastError, JSON.stringify({ history, command })).toBe(
      expectedErrors.at(-1)?.error,
    )
    for (const attempt of attempts) {
      expect(
        attempt.options.signal?.aborted,
        JSON.stringify({ history, command, attemptId: attempt.id }),
      ).toBe(attempt.shouldBeAborted)
    }
  }

  try {
    for (const command of history) {
      if (unsubscribed) break
      const attemptsBefore = attempts.length

      if (command.type === `request`) {
        const owner: Owner = {
          id: nextOwnerId++,
          demand: command.demand,
          abortController: new AbortController(),
        }
        owners.push(owner)
        subscription.requestSnapshot({
          where: where[command.demand],
          signal: owner.abortController.signal,
        })
        const started = attempts.slice(attemptsBefore)
        expect(
          started.map(({ demand }) => demand),
          JSON.stringify({ history, command }),
        ).toEqual(active ? [command.demand] : [])
        if (active) {
          owner.acquisition = started[0]
          started[0]!.ownerId = owner.id
        }
      } else if (command.type === `abort`) {
        const owner = owners.find(
          (candidate) =>
            candidate.demand === command.demand &&
            !candidate.abortController.signal.aborted,
        )
        if (!owner) continue
        owner.abortController.abort()
        if (owner.acquisition) {
          owner.acquisition.shouldBeAborted = true
          owner.acquisition.reportable = false
        }
      } else if (command.type === `release`) {
        const ownerIndex = owners.findIndex(
          ({ demand }) => demand === command.demand,
        )
        if (ownerIndex === -1) continue
        const [owner] = owners.splice(ownerIndex, 1)
        subscription.releaseSnapshot(where[command.demand])
        for (const attempt of attempts) {
          if (attempt.ownerId !== owner!.id) continue
          attempt.gating = false
          attempt.reportable = false
        }
        if (owner!.acquisition) {
          owner!.acquisition.shouldBeAborted = true
          expectedUnloadIds.push(owner!.acquisition.id)
        }
      } else if (command.type === `settle`) {
        const attempt = attempts.find(
          (candidate) =>
            !candidate.settled &&
            candidate.demand === command.demand &&
            (command.scope === `current`
              ? candidate.session === session
              : candidate.session !== session),
        )
        if (!attempt) continue
        attempt.settled = true
        attempt.gating = false
        if (command.outcome === `resolve`) {
          attempt.deferred.resolve()
        } else {
          if (attempt.reportable && attempt.session === session) {
            expectedErrors.push({
              attemptId: attempt.id,
              error: attempt.failure,
            })
          }
          attempt.deferred.reject(attempt.failure)
        }
      } else if (command.type === `cleanup`) {
        if (!active) continue
        for (const attempt of attempts) {
          if (attempt.session !== session) continue
          attempt.gating = false
          attempt.reportable = false
          attempt.shouldBeAborted = true
        }
        for (const owner of owners) owner.acquisition = undefined
        await collection.cleanup()
        active = false
      } else if (command.type === `restart`) {
        if (active) continue
        collection.startSyncImmediate()
        await flushPromises()
        const started = attempts.slice(attemptsBefore)
        expect(
          started.map(({ demand }) => demand),
          JSON.stringify({ history, command }),
        ).toEqual(owners.map(({ demand }) => demand))
        for (let index = 0; index < owners.length; index++) {
          owners[index]!.acquisition = started[index]
          started[index]!.ownerId = owners[index]!.id
        }
      } else if (command.type === `truncate`) {
        if (!active || !syncOps || owners.length === 0) continue
        const previous = owners.map(({ acquisition }) => acquisition)
        const replayOwners = owners.filter(
          ({ abortController }) => !abortController.signal.aborted,
        )
        syncOps.begin()
        syncOps.truncate()
        const receipt = syncOps.commit()
        if (receipt !== true) await receipt
        await flushPromises()
        const started = attempts.slice(attemptsBefore)
        expect(
          started.map(({ demand }) => demand),
          JSON.stringify({ history, command }),
        ).toEqual(replayOwners.map(({ demand }) => demand))
        let replayIndex = 0
        for (let index = 0; index < owners.length; index++) {
          const prior = previous[index]
          if (prior) {
            prior.shouldBeAborted = true
            prior.reportable = false
            expectedUnloadIds.push(prior.id)
          }
          const owner = owners[index]!
          if (owner.abortController.signal.aborted) {
            owner.acquisition = undefined
          } else {
            owner.acquisition = started[replayIndex]
            started[replayIndex]!.ownerId = owner.id
            replayIndex++
          }
        }
      } else {
        for (const attempt of attempts) {
          if (attempt.session !== session) continue
          attempt.gating = false
          attempt.reportable = false
        }
        for (const owner of owners) {
          if (!owner.acquisition) continue
          owner.acquisition.shouldBeAborted = true
          expectedUnloadIds.push(owner.acquisition.id)
        }
        owners.length = 0
        subscription.unsubscribe()
        unsubscribed = true
      }

      await flushPromises()
      assertState(command)
    }
  } finally {
    for (const attempt of attempts) attempt.deferred.resolve()
    await flushPromises()
    if (!unsubscribed) subscription.unsubscribe()
    await collection.cleanup()
  }
}

const fixedHistories: ReadonlyArray<ReadonlyArray<AsyncLifecycleCommand>> = [
  [
    { type: `request`, demand: `a` },
    { type: `settle`, demand: `a`, scope: `current`, outcome: `reject` },
    { type: `cleanup` },
    { type: `restart` },
    { type: `settle`, demand: `a`, scope: `current`, outcome: `resolve` },
  ],
  [
    { type: `request`, demand: `a` },
    { type: `request`, demand: `b` },
    { type: `settle`, demand: `a`, scope: `current`, outcome: `resolve` },
    { type: `cleanup` },
    { type: `restart` },
    { type: `settle`, demand: `b`, scope: `obsolete`, outcome: `reject` },
    { type: `settle`, demand: `a`, scope: `current`, outcome: `resolve` },
    { type: `settle`, demand: `b`, scope: `current`, outcome: `reject` },
  ],
  [
    { type: `request`, demand: `a` },
    { type: `request`, demand: `a` },
    { type: `truncate` },
    { type: `release`, demand: `a` },
    { type: `request`, demand: `b` },
    { type: `truncate` },
    { type: `settle`, demand: `a`, scope: `current`, outcome: `resolve` },
    { type: `settle`, demand: `b`, scope: `current`, outcome: `resolve` },
    { type: `unsubscribe` },
  ],
  [
    { type: `cleanup` },
    { type: `request`, demand: `a` },
    { type: `restart` },
    { type: `settle`, demand: `a`, scope: `current`, outcome: `resolve` },
    { type: `truncate` },
    { type: `cleanup` },
    { type: `restart` },
    { type: `release`, demand: `a` },
  ],
  [
    { type: `request`, demand: `a` },
    { type: `abort`, demand: `a` },
    { type: `settle`, demand: `a`, scope: `current`, outcome: `reject` },
    { type: `release`, demand: `a` },
  ],
]

describe(`CollectionSubscription async lifecycle history oracle`, () => {
  it(`covers the fixed cross-phase lifecycle histories`, async () => {
    for (const history of fixedHistories) {
      await runAsyncLifecycleHistory(history)
    }
  })

  it(`covers every command and named cross-phase boundary`, () => {
    const coverage = fixedHistories.map(classifyAsyncLifecycleHistory)
    const commandTypes = new Set(coverage.flatMap(({ types }) => [...types]))

    expect(commandTypes).toEqual(
      new Set<AsyncLifecycleCommand[`type`]>([
        `request`,
        `abort`,
        `release`,
        `settle`,
        `truncate`,
        `cleanup`,
        `restart`,
        `unsubscribe`,
      ]),
    )
    expect(coverage.some(({ partialRestart }) => partialRestart)).toBe(true)
    expect(coverage.some(({ duplicateOwner }) => duplicateOwner)).toBe(true)
    expect(
      coverage.some(({ requestWhileCleaned }) => requestWhileCleaned),
    ).toBe(true)
    expect(coverage.some(({ overlappingReplay }) => overlappingReplay)).toBe(
      true,
    )
  })

  it(`does not release an unacquired replacement after an aborted demand replays`, async () => {
    await runAsyncLifecycleHistory([
      { type: `request`, demand: `a` },
      { type: `abort`, demand: `a` },
      { type: `truncate` },
      { type: `release`, demand: `a` },
    ])
  })

  const { multiplier, ...replay } = readOracleRunConfig()
  const runs = 80 * multiplier

  fcTest.prop([asyncLifecycleHistoryArbitrary], {
    numRuns: runs,
    seed: 1_657_003,
  })(
    `matches ownership and settlement laws for a fixed seed`,
    runAsyncLifecycleHistory,
    120_000,
  )

  fcTest.prop(
    [asyncLifecycleHistoryArbitrary],
    oracleRandomParameters(
      runs,
      replay,
      `subscription-lifecycle.async-history`,
    ),
  )(
    `matches ownership and settlement laws for a random or replayed seed`,
    runAsyncLifecycleHistory,
    120_000,
  )
})
