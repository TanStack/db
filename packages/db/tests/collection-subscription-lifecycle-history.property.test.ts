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
type AttemptScope = `current` | `obsolete`
type AttemptAge = `oldest` | `newest`
type Command =
  | { type: `request`; demand: DemandName }
  | { type: `abort`; demand: DemandName }
  | { type: `release`; demand: DemandName }
  | {
      type: `settle`
      demand: DemandName
      scope: AttemptScope
      age: AttemptAge
      outcome: `resolve` | `reject`
    }
  | { type: `truncate` }
  | { type: `cleanup` }
  | { type: `restart` }
  | { type: `unsubscribe` }

type Owner = {
  id: number
  demand: DemandName
  aborted: boolean
  attemptId?: number
}
type Attempt = {
  id: number
  ownerId: number
  demand: DemandName
  session: number
  replay: number
  settled: boolean
  gating: boolean
  reportable: boolean
  aborted: boolean
  failure: Error
}
type LoadEvent = Pick<Attempt, `id` | `demand` | `session` | `replay`>
type UnloadEvent = { attemptId: number; handlerSession: number }
type ErrorEvent = { attemptId: number; error: Error }
type Model = {
  active: boolean
  unsubscribed: boolean
  session: number
  replay: number
  publicationBarrierOpen: boolean
  nextOwnerId: number
  nextAttemptId: number
  owners: Array<Owner>
  attempts: Array<Attempt>
  loads: Array<LoadEvent>
  unloads: Array<UnloadEvent>
  errors: Array<ErrorEvent>
  results: Array<number>
  publications: number
  statuses: Array<string>
  status: string
  collectionStatus: `ready` | `cleaned-up`
  lastError?: Error
  reach: Set<string>
}
type Effect = { ownerId?: number; attemptId?: number; requestResult?: boolean }

const commandArbitrary: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    type: fc.constant(`request` as const),
    demand: fc.constantFrom(`a` as const, `b` as const),
  }),
  fc.record({
    type: fc.constant(`abort` as const),
    demand: fc.constantFrom(`a` as const, `b` as const),
  }),
  fc.record({
    type: fc.constant(`release` as const),
    demand: fc.constantFrom(`a` as const, `b` as const),
  }),
  fc.record({
    type: fc.constant(`settle` as const),
    demand: fc.constantFrom(`a` as const, `b` as const),
    scope: fc.constantFrom(`current` as const, `obsolete` as const),
    age: fc.constantFrom(`oldest` as const, `newest` as const),
    outcome: fc.constantFrom(`resolve` as const, `reject` as const),
  }),
  fc.constant({ type: `truncate` as const }),
  fc.constant({ type: `cleanup` as const }),
  fc.constant({ type: `restart` as const }),
  fc.constant({ type: `unsubscribe` as const }),
)
function createModel(): Model {
  return {
    active: true,
    unsubscribed: false,
    session: 0,
    replay: 0,
    publicationBarrierOpen: false,
    nextOwnerId: 0,
    nextAttemptId: 0,
    owners: [],
    attempts: [],
    loads: [],
    unloads: [],
    errors: [],
    results: [],
    publications: 0,
    statuses: [],
    status: `ready`,
    collectionStatus: `ready`,
    reach: new Set(),
  }
}

function setStatus(model: Model): void {
  if (model.unsubscribed) return
  const status =
    model.active && model.attempts.some(({ gating }) => gating)
      ? `loadingSubset`
      : `ready`
  if (status !== model.status) {
    model.status = status
    model.statuses.push(status)
  }
}

function startAttempt(model: Model, owner: Owner): Attempt {
  const id = model.nextAttemptId++
  const attempt: Attempt = {
    id,
    ownerId: owner.id,
    demand: owner.demand,
    session: model.session,
    replay: model.replay,
    settled: false,
    gating: true,
    reportable: true,
    aborted: false,
    failure: new Error(`attempt ${id} failed`),
  }
  model.attempts.push(attempt)
  model.loads.push({
    id,
    demand: attempt.demand,
    session: attempt.session,
    replay: attempt.replay,
  })
  owner.attemptId = id
  return attempt
}

function retireAttempt(model: Model, owner: Owner, unload: boolean): void {
  if (owner.attemptId === undefined) return
  const attempt = model.attempts[owner.attemptId]
  owner.attemptId = undefined
  if (!attempt) throw new Error(`model lost attempt`)
  attempt.gating = false
  attempt.reportable = false
  attempt.aborted = true
  if (unload) {
    model.unloads.push({ attemptId: attempt.id, handlerSession: model.session })
  }
}

function selectAttempt(
  model: Model,
  command: Extract<Command, { type: `settle` }>,
): Attempt | undefined {
  const currentAttemptIds = new Set(
    model.owners.flatMap(({ attemptId }) =>
      attemptId === undefined ? [] : [attemptId],
    ),
  )
  const candidates = model.attempts.filter(
    (attempt) =>
      !attempt.settled &&
      attempt.demand === command.demand &&
      (command.scope === `current`
        ? currentAttemptIds.has(attempt.id)
        : !currentAttemptIds.has(attempt.id)),
  )
  return command.age === `oldest` ? candidates[0] : candidates.at(-1)
}

/** Pure reference transition. It never reads adapter callbacks or SUT state. */
function reduce(model: Model, command: Command): Effect {
  model.reach.add(`command:${command.type}`)
  if (model.unsubscribed) {
    if (command.type === `cleanup` && model.active) {
      model.active = false
      model.collectionStatus = `cleaned-up`
    } else if (command.type === `restart` && !model.active) {
      model.active = true
      model.session++
      model.replay = 0
      model.publicationBarrierOpen = false
      model.collectionStatus = `ready`
    }
    return { requestResult: false }
  }

  if (command.type === `request`) {
    if (model.owners.some(({ demand }) => demand === command.demand)) {
      model.reach.add(`duplicate-owner`)
    }
    if (!model.active) model.reach.add(`request-while-cleaned`)
    const owner: Owner = {
      id: model.nextOwnerId++,
      demand: command.demand,
      aborted: false,
    }
    model.owners.push(owner)
    if (model.active) model.results.push(startAttempt(model, owner).id)
    if (!model.publicationBarrierOpen) model.publications++
    setStatus(model)
    return { ownerId: owner.id, requestResult: true }
  }

  if (command.type === `abort`) {
    const owner = model.owners.find(
      ({ demand, aborted }) => demand === command.demand && !aborted,
    )
    if (!owner) return {}
    owner.aborted = true
    if (owner.attemptId !== undefined) {
      const attempt = model.attempts[owner.attemptId]!
      attempt.aborted = true
      attempt.reportable = false
    }
    return { ownerId: owner.id }
  }

  if (command.type === `release`) {
    const index = model.owners.findIndex(
      ({ demand }) => demand === command.demand,
    )
    if (index === -1) return {}
    const [owner] = model.owners.splice(index, 1)
    retireAttempt(model, owner!, true)
    if (
      model.publicationBarrierOpen &&
      model.owners.every(({ attemptId }) =>
        attemptId === undefined ? true : model.attempts[attemptId]!.settled,
      )
    ) {
      model.publicationBarrierOpen = false
    }
    setStatus(model)
    return { ownerId: owner!.id }
  }

  if (command.type === `settle`) {
    const attempt = selectAttempt(model, command)
    if (!attempt) return {}
    attempt.settled = true
    attempt.gating = false
    if (
      command.outcome === `reject` &&
      attempt.reportable &&
      !attempt.aborted
    ) {
      model.lastError = attempt.failure
      model.errors.push({ attemptId: attempt.id, error: attempt.failure })
    }
    if (
      model.publicationBarrierOpen &&
      model.owners.every(({ attemptId }) =>
        attemptId === undefined ? true : model.attempts[attemptId]!.settled,
      )
    ) {
      model.publicationBarrierOpen = false
    }
    setStatus(model)
    return { attemptId: attempt.id }
  }

  if (command.type === `truncate`) {
    if (!model.active) return {}
    if (
      model.replay > 0 &&
      model.attempts.some(
        ({ session, settled }) => session === model.session && !settled,
      )
    ) {
      model.reach.add(`overlapping-replay`)
    }
    model.replay++
    model.publicationBarrierOpen = model.owners.some(({ aborted }) => !aborted)
    for (const owner of model.owners) {
      retireAttempt(model, owner, true)
      if (!owner.aborted) startAttempt(model, owner)
    }
    setStatus(model)
    return {}
  }

  if (command.type === `cleanup`) {
    if (!model.active) return {}
    const current = model.attempts.filter(
      ({ session }) => session === model.session,
    )
    if (
      current.some(({ settled }) => settled) &&
      current.some(({ settled }) => !settled)
    ) {
      model.reach.add(`partial-generation-supersession`)
    }
    for (const owner of model.owners) retireAttempt(model, owner, false)
    model.active = false
    model.publicationBarrierOpen = false
    model.collectionStatus = `cleaned-up`
    setStatus(model)
    return {}
  }

  if (command.type === `restart`) {
    if (model.active) return {}
    model.active = true
    model.session++
    model.replay = 0
    model.publicationBarrierOpen = model.owners.some(({ aborted }) => !aborted)
    model.collectionStatus = `ready`
    if (!model.unsubscribed) model.publications++
    for (const owner of model.owners) {
      if (!owner.aborted) startAttempt(model, owner)
    }
    setStatus(model)
    return {}
  }

  for (const owner of model.owners) retireAttempt(model, owner, true)
  model.owners.length = 0
  model.unsubscribed = true
  return {}
}

function crossesPendingReplaySupersession(
  history: ReadonlyArray<Command>,
): boolean {
  const model = createModel()
  for (const command of history) {
    if (
      command.type === `truncate` &&
      model.active &&
      model.owners.some(({ attemptId }) =>
        attemptId === undefined ? false : !model.attempts[attemptId]!.settled,
      )
    ) {
      return true
    }
    reduce(model, command)
  }
  return false
}

const historyArbitrary = fc
  .array(
    // Remove this filter when the named abort/replay red below turns green.
    commandArbitrary.filter(({ type }) => type !== `abort`),
    { minLength: 1, maxLength: 20 },
  )
  // Obsolete non-cooperative loads currently keep readiness gated. A focused
  // red below owns that class while other histories continue to fuzz.
  .filter((history) => !crossesPendingReplaySupersession(history))

type RuntimeAttempt = {
  options: LoadSubsetOptions
  deferred: ReturnType<typeof createDeferred<void>>
}

async function runHistory(
  history: ReadonlyArray<Command>,
  options: { ignoreStatusTrace?: boolean } = {},
): Promise<Set<string>> {
  const model = createModel()
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
  const observedLoads: Array<LoadEvent> = []
  const observedUnloads: Array<
    UnloadEvent | { attemptId: `unacquired`; handlerSession: number }
  > = []
  const observedErrors: Array<{
    attemptId: number | `unacquired`
    error: unknown
  }> = []
  const observedResults: Array<number | `unacquired`> = []
  const observedStatuses: Array<string> = []
  let observedSession = -1
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
            const expected = model.loads[observedLoads.length]
            if (!expected) throw new Error(`unexpected adapter load`)
            const demand = demandForWhere.get(options.where)
            if (
              demand !== expected.demand ||
              handlerSession !== expected.session
            ) {
              throw new Error(`adapter load did not match the model`)
            }
            const deferred = createDeferred<void>()
            void deferred.promise.catch(() => undefined)
            runtimeAttempts.set(expected.id, { options, deferred })
            attemptByOptions.set(options, expected.id)
            observedLoads.push(expected)
            return deferred.promise
          },
          unloadSubset: (options) => {
            observedUnloads.push({
              attemptId: attemptByOptions.get(options) ?? `unacquired`,
              handlerSession,
            })
          },
        }
      },
    },
  })
  const publications: Array<unknown> = []
  const subscription = collection.subscribeChanges(
    (changes) => publications.push(changes),
    { includeInitialState: false },
  )
  subscription.on(`status:change`, ({ status }) =>
    observedStatuses.push(status),
  )
  subscription.on(`loadSubset:error`, ({ options, error }) => {
    observedErrors.push({
      attemptId: attemptByOptions.get(options) ?? `unacquired`,
      error,
    })
  })

  const assertState = (command: Command) => {
    const context = JSON.stringify({ history, command })
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
    for (const attempt of model.attempts) {
      expect(
        runtimeAttempts.get(attempt.id)?.options.signal?.aborted,
        context,
      ).toBe(attempt.aborted)
    }
  }

  try {
    for (const command of history) {
      const effect = reduce(model, command)
      if (command.type === `request`) {
        const controller = new AbortController()
        if (effect.ownerId !== undefined) {
          ownerControllers.set(effect.ownerId, controller)
        }
        const result = subscription.requestSnapshot({
          where: where[command.demand],
          signal: controller.signal,
          onLoadSubsetResult: (_result, options) => {
            observedResults.push(attemptByOptions.get(options) ?? `unacquired`)
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
        if (command.outcome === `resolve`) runtime.deferred.resolve()
        else runtime.deferred.reject(attempt.failure)
      } else if (command.type === `truncate`) {
        syncOps?.begin()
        syncOps?.truncate()
        const receipt = syncOps?.commit()
        if (receipt !== true) await receipt
      } else if (command.type === `cleanup`) {
        await collection.cleanup()
      } else if (command.type === `restart`) {
        collection.startSyncImmediate()
      } else if (command.type === `unsubscribe`) {
        subscription.unsubscribe()
      }
      await flushPromises()
      assertState(command)
    }
  } finally {
    for (const { deferred } of runtimeAttempts.values()) deferred.resolve()
    await flushPromises()
    subscription.unsubscribe()
    await collection.cleanup()
  }
  return model.reach
}

const settle = (
  demand: DemandName,
  scope: AttemptScope,
  age: AttemptAge,
  outcome: `resolve` | `reject`,
): Command => ({ type: `settle`, demand, scope, age, outcome })

const greenFixedHistories: ReadonlyArray<ReadonlyArray<Command>> = [
  [
    { type: `request`, demand: `a` },
    { type: `request`, demand: `b` },
    settle(`a`, `current`, `oldest`, `resolve`),
    { type: `cleanup` },
    { type: `restart` },
    settle(`b`, `obsolete`, `oldest`, `reject`),
    settle(`a`, `current`, `oldest`, `resolve`),
    settle(`b`, `current`, `oldest`, `reject`),
  ],
  [
    { type: `cleanup` },
    { type: `request`, demand: `a` },
    { type: `restart` },
    settle(`a`, `current`, `oldest`, `resolve`),
    { type: `truncate` },
    { type: `cleanup` },
    { type: `restart` },
    { type: `release`, demand: `a` },
    { type: `unsubscribe` },
  ],
  [
    { type: `request`, demand: `a` },
    settle(`a`, `current`, `oldest`, `reject`),
    { type: `cleanup` },
    { type: `restart` },
    settle(`a`, `current`, `oldest`, `resolve`),
  ],
]
const pendingSupersessionHistory: ReadonlyArray<Command> = [
  { type: `request`, demand: `a` },
  { type: `request`, demand: `a` },
  { type: `truncate` },
  { type: `truncate` },
  settle(`a`, `current`, `newest`, `resolve`),
  settle(`a`, `current`, `oldest`, `reject`),
  { type: `release`, demand: `a` },
]
const abortReplayHistory: ReadonlyArray<Command> = [
  { type: `request`, demand: `a` },
  { type: `abort`, demand: `a` },
  settle(`a`, `current`, `oldest`, `reject`),
  { type: `truncate` },
  { type: `release`, demand: `a` },
]

if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
  fc.statistics(
    historyArbitrary,
    (history) => {
      const model = createModel()
      for (const command of history) reduce(model, command)
      return [...model.reach]
    },
    oraclePropertyOptions(1_000, `subscription-lifecycle.history-statistics`),
  )
}

describe(`CollectionSubscription async lifecycle history oracle`, () => {
  it(`covers every required command and cross-phase transition`, async () => {
    const reach = new Set<string>()
    for (const history of greenFixedHistories) {
      for (const label of await runHistory(history)) reach.add(label)
    }
    for (const history of [pendingSupersessionHistory, abortReplayHistory]) {
      const model = createModel()
      for (const command of history) reduce(model, command)
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

  it(`does not release an unacquired replacement after an aborted demand replays`, async () => {
    await runHistory(abortReplayHistory, { ignoreStatusTrace: true })
  })

  const { multiplier, ...replay } = readOracleRunConfig()
  const runs = 80 * multiplier

  fcTest.prop([historyArbitrary], { numRuns: runs, seed: 1_657_003 })(
    `matches the pure lifecycle model for a fixed seed`,
    async (history) => {
      await runHistory(history)
    },
    120_000,
  )
  fcTest.prop(
    [historyArbitrary],
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
})
